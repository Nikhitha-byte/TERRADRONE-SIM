/* planner.js - Mission Planner panel for Drone Scout Flight Lab
   ---------------------------------------------------------------
   Load after app.js. Adds "04 / Mission planner":
   1. Load forecast_scenarios.json (from earth2_weather.py) - or it is picked up
      automatically when the page is served next to it.
   2. Choose the map and draw a survey area as usual (Draw survey area).
   3. "Plan launch window" flies the survey in every forecast scenario for every
      launch hour with Flight Lab's own step(), using your current aircraft settings.
   4. Drag the time slider / pick a scenario to see the decision, battery and the
      planned paths on the map; "Fly this in the simulator" replays it live.
   The live simulation state is saved before planning and restored afterwards. */
(() => {
'use strict';
const P = { forecast: null, result: null, hour: 0, member: 'median', overlay: true, busy: false, snapshot: null };
const ICON = { GO: '✓', CAUTION: '!', 'NO-GO': '✕' }, cls = s => s.replace('-', '');
// Flight-release vocabulary shown to the operator (internal codes stay GO / CAUTION / NO-GO)
const LBL = { GO: 'CLEARED', CAUTION: 'CONDITIONAL', 'NO-GO': 'NOT CLEARED' };
const f = (v, d = 1) => v === null || v === undefined || !isFinite(v) ? '–' : (+v).toFixed(d);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const snapTo = (v, lo, hi, st) => Math.min(hi, Math.max(lo, Math.round(v / st) * st));
const pct = (a, q) => { const s = a.filter(x => x !== null).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };

// ------------------------------------------------------------------ panel
const css = document.createElement('style');
css.textContent = `
#planner .pinfo{display:flex;flex-wrap:wrap;gap:4px 18px;padding:10px 20px;font:12.5px var(--mono);color:var(--muted);border-bottom:1px solid var(--line)}
#planner .pinfo b{color:var(--fg);font-weight:500}
#planner .stale{color:var(--warn)}
#planner .hours{display:flex;gap:6px;overflow-x:auto;padding:14px 20px 6px}
#planner .hr{flex:1 0 86px;text-align:left;background:var(--panel2);border:1px solid var(--line2);border-radius:6px;padding:7px 9px;color:var(--fg);cursor:pointer;font:12px var(--mono)}
#planner .hr[aria-pressed="true"]{border-color:var(--blue);box-shadow:inset 0 -2px 0 var(--blue);background:#16263a}
#planner .hr .t{display:block;color:var(--muted);font-size:11px}#planner .hr .b{display:block;font-size:13px;margin-top:2px}
#planner .chip{display:inline-flex;gap:4px;align-items:center;font:600 11px var(--mono);padding:1px 6px;border-radius:4px;white-space:nowrap}
#planner .s-GO{color:var(--ok)}#planner .s-CAUTION{color:var(--warn)}#planner .s-NOGO{color:#ff6b7f}
#planner .chip.s-GO{background:#17342a}#planner .chip.s-CAUTION{background:#352a17}#planner .chip.s-NOGO{background:#3a1820}
#planner .slider{display:flex;align-items:center;gap:12px;padding:6px 20px 12px}#planner .slider input{flex:1;accent-color:var(--blue)}
#planner .verdict{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);border-top:1px solid var(--line)}
#planner .vd{padding:16px 20px;border-right:1px solid var(--line)}#planner .vd .big{font:600 30px var(--mono);display:flex;gap:10px;align-items:center}
#planner .vd ul{margin:8px 0 0;padding-left:18px;font-size:13px;color:#c9d4db}
#planner .pchart svg{display:block;width:100%;height:auto}#planner .pchart{padding:6px 20px 4px}
#planner .pchart .grid{stroke:#1d272e}#planner .pchart .ax{fill:var(--muted);font:10.5px var(--mono)}#planner .pchart .band{fill:var(--blue);opacity:.12}
#planner .pchart .line{fill:none;stroke:var(--blue);stroke-width:2;stroke-linejoin:round}#planner .pchart .dot{fill:var(--blue);stroke:var(--panel);stroke-width:2}
#planner .pchart .sel{stroke:var(--fg);stroke-width:1}#planner .pchart .ref{stroke:#5a6872}#planner .pchart .hit{fill:transparent;cursor:pointer}
#planner .lg{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--muted);padding:4px 20px 12px}#planner .lg i{display:inline-block;width:16px;height:3px;margin-right:6px;vertical-align:middle}
#planner .progress{height:3px;background:var(--line)}#planner .progress>div{height:3px;background:var(--blue);width:0}
@media(max-width:700px){#planner .verdict{grid-template-columns:1fr}#planner .vd{border-right:0;border-bottom:1px solid var(--line)}}`;
document.head.appendChild(css);

const panel = document.createElement('section');
panel.className = 'panel'; panel.id = 'planner';
panel.innerHTML = `
<div class="ph"><h2>04 / Mission planner</h2><span class="sub" id="pl-sub">forecast → fly every scenario → go / no-go</span></div>
<div class="bar">
 <label class="btn" for="pl-file">Load forecast</label><input id="pl-file" type="file" accept=".json,application/json" hidden>
 <span class="eyebrow">Batteries</span><input id="pl-bat" type="number" min="1" max="12" value="2" style="width:58px;font:13.5px var(--mono);color:var(--fg);background:var(--well);border:1px solid var(--line2);border-radius:4px;padding:6px 7px">
 <button class="btn primary" id="pl-run" disabled>Plan launch window</button>
 <span class="note" id="pl-status" style="margin:0">Load forecast_scenarios.json from earth2_weather.py. Draw a survey area first if you want only part of the field.</span>
</div>
<div class="progress"><div id="pl-prog"></div></div>
<div class="pinfo" id="pl-info"></div>
<div id="pl-body" hidden>
 <div class="hours" id="pl-hours" role="group" aria-label="Launch hour"></div>
 <div class="slider"><span class="eyebrow">Launch time</span><input type="range" id="pl-slider" min="0" max="0" value="0" aria-label="Launch hour"><span id="pl-slabel" style="font:13px var(--mono);min-width:150px"></span></div>
 <div class="pchart" id="pl-chart"></div>
 <div class="bar"><span class="eyebrow">Scenario</span><div class="seg sm" id="pl-members" role="group" aria-label="Forecast scenario"></div>
  <button class="btn" id="pl-overlay" aria-pressed="true">Paths on map: on</button>
  <button class="btn primary" id="pl-fly">Fly this in the simulator</button></div>
 <div class="verdict"><div class="vd" id="pl-verdict"></div><div class="cards" id="pl-cards" style="border-top:0"></div></div>
 <div class="lg"><span><i style="background:#199e70"></i>No wind (original path)</span><span><i style="background:#d95926"></i>Recommended path (<span id="pl-sugl">best hour</span>)</span><span><i style="background:#3987e5"></i>Selected path / live simulator path</span></div>
</div>`;
const firstSection = document.querySelector('.layout .col section');
firstSection.after(panel);
const q = id => document.getElementById('pl-' + id);

// ------------------------------------------------------------------ forecast loading
function setForecast(fc, name) {
  if (!fc || fc.schema !== 'drone-scout-forecast-v1') throw Error('Choose a forecast_scenarios.json made by earth2_weather.py');
  P.forecast = fc; P.result = null; q('body').hidden = true; q('run').disabled = false;
  q('status').textContent = `Loaded ${name}. Draw a survey area if needed, then plan.`;
  renderInfo();
}
q('file').onchange = async e => { const fl = e.target.files[0]; if (!fl) return; try { setForecast(JSON.parse(await fl.text()), fl.name) } catch (err) { q('status').textContent = err.message } e.target.value = '' };
if (location.protocol.startsWith('http')) fetch('forecast_scenarios.json').then(r => r.ok ? r.json() : null).then(j => j && setForecast(j, 'forecast_scenarios.json')).catch(() => {});

const areaKey = () => MAP ? MAP.name + '|' + (AOI ? [AOI.x, AOI.y, AOI.W, AOI.H].map(v => v.toFixed(1)).join(',') : 'full') : '';
function renderInfo() {
  const fc = P.forecast; if (!fc || !MAP) { q('info').innerHTML = ''; return; }
  const a = AOI ? `drawn area ${AOI.W.toFixed(0)} × ${AOI.H.toFixed(0)} m` : `full map ${MAP.W.toFixed(0)} × ${MAP.H.toFixed(0)} m`;
  const stale = P.result && P.result.key !== areaKey();
  q('info').innerHTML = `<span>Field <b>${esc(fc.field.name)}</b> ${f(fc.field.lat, 3)}, ${f(fc.field.lon, 3)}</span><span>Weather <b>${esc(fc.source.model)}</b> · start ${esc(fc.init_utc)}</span><span>Window <b>${esc(fc.hours[0].valid_local)}</b> +${fc.hours.length - 1} h · ${fc.hours[0].members.length} scenario${fc.hours[0].members.length > 1 ? 's' : ''}/h</span><span>Survey <b>${esc(MAP.name)}</b>, ${a}</span>${stale ? '<span class="stale">Map or area changed since planning: plan again</span>' : ''}`;
}

// ------------------------------------------------------------------ running Flight Lab's own simulator off-screen
const DUMMY = new Proxy({}, { get: () => () => {} });
function saveLive() {
  return { C: { ...C }, S, CAPS, HIST, TELEMETRY, covCells, covValid, covHit, PLAN, rng, REV, revCtx, runStarted, paused,
    log, updateButtons, ensureRev };
}
function restoreLive(s) {
  Object.keys(C).forEach(k => delete C[k]); Object.assign(C, s.C);
  S = s.S; CAPS = s.CAPS; HIST = s.HIST; TELEMETRY = s.TELEMETRY; covCells = s.covCells; covValid = s.covValid; covHit = s.covHit;
  PLAN = s.PLAN; rng = s.rng; REV = s.REV; revCtx = s.revCtx; runStarted = s.runStarted; paused = s.paused;
  log = s.log; updateButtons = s.updateButtons; ensureRev = s.ensureRev;
}
function scenarioValues(base, w, seed) {
  const v = { ...base, wind: w.sim.wind, wdir: w.sim.wdir, gust: w.sim.gust, seed };
  const rho = w.air_density_kgm3 || 1.225, T = w.temperature_c ?? 20;
  v.phov = snapTo(base.phov * Math.sqrt(1.225 / rho), 50, 500, 5);                    // DERIVED: induced power ~ 1/sqrt(rho)
  v.capmAh = snapTo(base.capmAh * (T < 20 ? Math.max(0.8, 1 - 0.0075 * (20 - T)) : 1), 1000, 20000, 10); // ASSUMED cold LiPo
  return v;
}
function flyOffscreen(values) {
  Object.assign(C, values); normalizeConfig(); derive();
  rng = mulberry(C.seed); S = newState(); CAPS = []; HIST = []; TELEMETRY = []; covCells = null; initCoverage(); PLAN = plan();
  startMission();
  let used = 0, peakP = 0, sat = 0, flyN = 0, maxTilt = 0, minSoc = 100, bats = 1; const swaps = [], path = [];
  for (let i = 0; i < 400000; i++) {
    if (!['fly', 'rth', 'landing'].includes(S.phase)) {
      if (S.phase === 'landed' && S.resume && bats < 12) { bats++; swaps.push(S.t); C.start = 100; swapBattery(); continue; }
      break;
    }
    const E0 = S.E; step(DT); used += Math.max(0, E0 - S.E);
    if (S.P > peakP) peakP = S.P;
    if (S.phase === 'fly' && S.z > C.alt * .9) { flyN++; if (S.vair >= C.vmax * .98) sat++; }
    const tilt = Math.max(Math.abs(S.roll || 0), Math.abs(S.pitch || 0)); if (tilt > maxTilt) maxTilt = tilt;
    const soc = S.E / C.energy * 100; if (soc < minSoc) minSoc = soc;
    if (i % 10 === 0) path.push([S.x, S.y]);
  }
  path.push([S.x, S.y]);
  return { state: S.phase, emergency: !!S.emergency, dur: S.t, used, energy: C.energy, peakP, sat: flyN ? 100 * sat / flyN : 0,
    tilt: maxTilt * 180 / Math.PI, minSoc, bats, swaps, track: S.ctn ? Math.sqrt(S.ct2 / S.ctn) : 0, cov: covPct(), caps: CAPS.length, path };
}
const VIS_MIN_KM = 4.83;   // FAA 14 CFR 107.51(c): 3 statute miles from the control station
const visOf = w => w.visibility_km ?? Math.min(50, 1 / (1 / (50 * Math.exp(-4.6 * (w.dust_risk_0_1 || 0))) + (w.rain_mm_h > 0.05 ? 1 / (12 * Math.pow(w.rain_mm_h, -0.65)) : 0)));
function judge(w, r, v, carried) {
  const no = [], ca = [], gp = w.wind_flight_level_ms + 2 * w.gust_sigma_ms;
  if (gp > 10) no.push(`gusts to ${gp.toFixed(1)} m/s exceed the 10 m/s rating`);
  if (w.rain_mm_h > 0.5) no.push(`rain ${w.rain_mm_h.toFixed(1)} mm/h (not rain-rated)`);
  if (w.temperature_c < 0 || w.temperature_c > 40) no.push(`${w.temperature_c} °C outside 0–40 °C`);
  if (r.emergency) no.push('emergency landing in the field: reserve not enough against the wind');
  else if (r.state !== 'done') no.push('survey cannot be finished');
  else if (r.bats > carried) no.push(`needs ${r.bats} batteries, carrying ${carried}`);
  else if (r.bats === carried && carried > 1) ca.push(`uses all ${carried} batteries`);
  if (r.sat > 5) ca.push(`full airspeed ${r.sat.toFixed(0)} % of survey time`);
  if (r.tilt > 30) ca.push(`tilts up to ${r.tilt.toFixed(0)}°: under 5° of control margin left (35° limit)`);
  if (r.track > 2) ca.push(`track error ${r.track.toFixed(1)} m: overlap at risk`);
  if (r.state === 'done' && r.cov < 95) ca.push(`coverage ${r.cov.toFixed(0)} %`);
  const vis = visOf(w);
  if (vis < VIS_MIN_KM) no.push(`visibility ${vis.toFixed(1)} km is below the FAA 3-mile (4.8 km) minimum${w.dust_risk_0_1 > 0.3 ? ': blowing dust' : w.rain_mm_h > 0.5 ? ': rain' : ''}`);
  else if (vis < 8) ca.push(`hazy, visibility ${vis.toFixed(1)} km: keep the drone in sight, images lose contrast`);
  if (w.dust_risk_0_1 > 0.5 && vis >= VIS_MIN_KM) ca.push('dust: grit in motors, hazy images');
  if (w.temperature_c < 10) ca.push('cold: warm the batteries');
  return { status: no.length ? 'NO-GO' : ca.length ? 'CAUTION' : 'GO', reasons: [...no, ...ca] };
}

q('run').onclick = () => {
  if (!P.forecast || P.busy || !MAP) return;
  P.busy = true; q('run').disabled = true;
  const live = saveLive(), carried = Math.max(1, Math.min(12, +q('bat').value || 2));
  const base = { ...live.C }; base.start = base.start ?? 100;
  log = () => {}; updateButtons = () => {}; ensureRev = () => { revCtx = DUMMY };
  const jobs = [{ hour: -1, member: -1 }];
  P.forecast.hours.forEach((h, hi) => h.members.forEach((_, m) => jobs.push({ hour: hi, member: m })));
  const out = { key: areaKey(), carried, base, hours: P.forecast.hours.map(h => ({ ...h, runs: [] })), calm: null };
  let j = 0;
  const tick = () => {
    const t0 = performance.now();
    try {
      while (j < jobs.length && performance.now() - t0 < 40) {
        const jb = jobs[j++];
        if (jb.hour < 0) {
          const v = { ...base, wind: 0, gust: 0, seed: base.seed };
          const r = flyOffscreen(v); out.calm = { ...r, need: 100 * r.used / r.energy + v.rthres };
        } else {
          const w = out.hours[jb.hour].members[jb.member], v = scenarioValues(base, w, base.seed + jb.member + 1);
          const r = flyOffscreen(v), need = r.state === 'done' ? 100 * r.used / r.energy + v.rthres : null;
          out.hours[jb.hour].runs[jb.member] = { member: jb.member, w, v, r, need, ...judge(w, r, v, carried) };
        }
        Object.keys(C).forEach(k => delete C[k]); Object.assign(C, live.C);
      }
    } catch (err) { restoreLive(live); P.busy = false; q('run').disabled = false; q('status').textContent = 'Planning failed: ' + err.message; console.error(err); return; }
    q('prog').style.width = (100 * j / jobs.length).toFixed(1) + '%';
    q('status').textContent = `Flying scenario ${j} of ${jobs.length}…`;
    if (j < jobs.length) { setTimeout(tick, 0); return; }
    restoreLive(live);
    summarise(out); P.result = out; P.busy = false; q('run').disabled = false;
    const best = out.best;
    q('status').textContent = `Planned ${jobs.length} flights. ${out.hours[0].status === 'NO-GO' && best.status !== 'NO-GO' ? 'Recommended launch: ' + best.valid_local + '.' : ''}`;
    P.hour = 0; P.member = 'median'; q('body').hidden = false; renderAll(); draw();
  };
  setTimeout(tick, 0);
};

function summarise(out) {
  const rank = { GO: 0, CAUTION: 1, 'NO-GO': 2 };
  out.hours.forEach(h => {
    const n = h.runs.length, nNo = h.runs.filter(r => r.status === 'NO-GO').length, nCa = h.runs.filter(r => r.status === 'CAUTION').length;
    h.status = nNo / n >= .5 ? 'NO-GO' : (nNo > 0 || nCa / n >= .5) ? 'CAUTION' : 'GO';
    const need = h.runs.map(r => r.need);
    h.need = { p10: pct(need, .1), med: pct(need, .5), p90: pct(need, .9) };
    h.emerg = h.runs.filter(r => r.r.emergency).length;
    const sev = r => (r.r.emergency ? 1e6 : 0) + (r.need ?? 5e5);
    const sorted = [...h.runs].sort((a, b) => sev(a) - sev(b));
    h.medianRun = sorted[Math.floor((sorted.length - 1) / 2)]; h.worstRun = sorted[sorted.length - 1];
    const tally = {}; h.runs.forEach(r => r.reasons.forEach(x => { const k = x.replace(/[\d.]+/g, '#'); (tally[k] ||= { x, n: 0 }).n++ }));
    h.reasons = Object.values(tally).sort((a, b) => b.n - a.n).map(t => t.x + (n > 1 ? ` (${t.n}/${n})` : ''));
  });
  out.best = [...out.hours].sort((a, b) => rank[a.status] - rank[b.status] || (a.need.p90 ?? 1e9) - (b.need.p90 ?? 1e9))[0];
}

// ------------------------------------------------------------------ rendering
const chip = s => `<span class="chip s-${cls(s)}">${ICON[s]} ${LBL[s]}</span>`;
const big = () => P.result && Math.max(P.result.calm.need, ...P.result.hours.map(h => h.need.p90 ?? 0)) > 150;
const needTxt = v => v === null ? 'no finish' : big() ? (v / 100).toFixed(1) + '×' : v.toFixed(0) + '%';
const selRun = () => { const h = P.result.hours[P.hour]; return P.member === 'median' ? h.medianRun : P.member === 'worst' ? h.worstRun : h.runs[P.member]; };

function renderAll() {
  const R = P.result; if (!R) return; renderInfo();
  q('hours').innerHTML = R.hours.map((h, i) => `<button class="hr" data-i="${i}" aria-pressed="${i === P.hour}"><span class="t">${esc(h.valid_local.slice(4))}</span>${chip(h.status)}<span class="b">${needTxt(h.need.med)}</span></button>`).join('');
  q('slider').max = R.hours.length - 1; q('slider').value = P.hour; q('slabel').textContent = R.hours[P.hour].valid_local + (R.best === R.hours[P.hour] && R.best.status !== 'NO-GO' ? ' · best' : '');
  const n = R.hours[P.hour].runs.length;
  q('members').innerHTML = ['median', 'worst', ...Array.from({ length: n }, (_, i) => i)].map(m => `<button data-m="${m}" aria-pressed="${String(m) === String(P.member)}">${m === 'median' ? 'Median' : m === 'worst' ? 'Worst' : '#' + (m + 1)}</button>`).join('');
  const sl = document.getElementById('pl-sugl'); if (sl) sl.textContent = R.best && R.best.status !== 'NO-GO' ? R.best.valid_local + ', median scenario' : 'none: no hour is cleared';
  renderChart(); renderDetail();
  (window.DronePlanner.listeners || []).forEach(fn => { try { fn() } catch (e) { console.error(e) } });
}
function renderChart() {
  const R = P.result, H = R.hours, B = big(), u = v => v === null ? null : B ? v / 100 : v;
  const W = 720, Ht = 170, L = 46, Rr = 92, T = 10, Bm = 24, n = H.length;
  const top = Math.max(u(R.calm.need), ...H.map(h => u(h.need.p90) ?? 0));
  const maxY = B ? Math.ceil(top + .5) : Math.max(110, top + 10), st = B ? Math.max(1, Math.ceil(maxY / 4)) : 50;
  const x = i => L + (n === 1 ? (W - L - Rr) / 2 : i * (W - L - Rr) / (n - 1)), y = v => T + (Ht - T - Bm) * (1 - v / maxY);
  const has = i => H[i].need.med !== null, segs = [];
  H.forEach((h, i) => { if (!has(i)) return; const l = segs[segs.length - 1]; if (l && l[l.length - 1] === i - 1) l.push(i); else segs.push([i]); });
  let s = '';
  for (let v = 0; v <= maxY; v += st) s += `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${B ? v + '×' : v + '%'}</text>`;
  s += `<line class="ref" x1="${L}" x2="${W - Rr}" y1="${y(u(100))}" y2="${y(u(100))}"/><text class="ax" x="${W - Rr + 6}" y="${y(u(100)) + 4}">one battery</text>`;
  s += `<line class="ref" stroke-dasharray="2 3" x1="${L}" x2="${W - Rr}" y1="${y(u(R.calm.need))}" y2="${y(u(R.calm.need))}"/><text class="ax" x="${W - Rr + 6}" y="${y(u(R.calm.need)) + 4}">calm</text>`;
  s += `<line class="sel" x1="${x(P.hour)}" x2="${x(P.hour)}" y1="${T}" y2="${Ht - Bm}"/>`;
  segs.forEach(sg => { s += `<polygon class="band" points="${sg.map(i => x(i) + ',' + y(u(H[i].need.p90))).join(' ')} ${sg.map(i => x(i) + ',' + y(u(H[i].need.p10))).reverse().join(' ')}"/><polyline class="line" points="${sg.map(i => x(i) + ',' + y(u(H[i].need.med))).join(' ')}"/>` });
  H.forEach((h, i) => { s += has(i) ? `<circle class="dot" cx="${x(i)}" cy="${y(u(h.need.med))}" r="4.5"/>` : `<text class="ax" x="${x(i)}" y="${y(maxY * .1)}" text-anchor="middle">✕</text>`;
    s += `<text class="ax" x="${x(i)}" y="${Ht - 8}" text-anchor="middle">${esc(h.valid_local.slice(-5))}</text><rect class="hit" data-i="${i}" x="${x(i) - (W - L - Rr) / Math.max(1, n - 1) / 2}" y="0" width="${(W - L - Rr) / Math.max(1, n - 1)}" height="${Ht}"><title>${esc(h.valid_local)} · ${LBL[h.status]} · ${needTxt(h.need.med)}</title></rect>` });
  q('chart').innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" role="img" aria-label="${B ? 'Batteries' : 'Battery'} needed per launch hour">${s}</svg>`;
}
function renderDetail() {
  const h = P.result.hours[P.hour], r = selRun(), R = P.result;
  q('verdict').innerHTML = `<div class="eyebrow">${esc(h.valid_local)} · all ${h.runs.length} scenarios</div>
   <div class="big s-${cls(h.status)}">${ICON[h.status]} ${LBL[h.status]}</div>
   ${h.reasons.length ? `<ul>${h.reasons.slice(0, 5).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="note">Every forecast scenario completes the survey inside the aircraft and regulatory limits.</p>'}
   ${R.best !== h && R.best.status !== 'NO-GO' ? `<p class="note">Recommended launch hour: <b>${esc(R.best.valid_local)}</b> (${LBL[R.best.status]}).</p>` : ''}`;
  const c = (k, v, s) => `<div class="card"><div class="eyebrow">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const rr = r.r, w = r.w;
  q('cards').innerHTML =
    c(`Scenario ${r.member + 1}`, `<span class="chip s-${cls(r.status)}">${ICON[r.status]} ${LBL[r.status]}</span>`, esc(r.reasons[0] || 'within limits')) +
    c('Battery needed', needTxt(r.need), `calm ${needTxt(R.calm.need)} · ${rr.bats} batter${rr.bats > 1 ? 'ies' : 'y'}`) +
    c('Flight time', f(rr.dur / 60) + '<small>min</small>', `calm ${f(R.calm.dur / 60)} min`) +
    c('Wind at altitude', f(w.wind_flight_level_ms) + '<small>m/s</small>', `from ${f(w.wind_from_true_deg, 0)}° · gust ±${f(w.gust_sigma_ms)}`) +
    c('Rain · temp', f(w.rain_mm_h) + '<small>mm/h</small>', `${f(w.temperature_c, 0)} °C · dust ${f(w.dust_risk_0_1, 2)}`) +
    c('Lowest battery', f(rr.minSoc, 0) + '<small>%</small>', `peak ${f(rr.peakP, 0)} W · ${f(rr.peakP / r.v.vnom / (r.v.capmAh / 1000), 2)} C`) +
    c('Track error', f(rr.track, 2) + '<small>m</small>', `vs ${f(R.calm.track, 2)} m with no wind · max tilt ${f(rr.tilt, 0)}°`) +
    c('Coverage', f(rr.cov, 0) + '<small>%</small>', `${rr.caps} captures`);
  q('overlay').textContent = 'Paths on map: ' + (P.overlay ? 'on' : 'off'); q('overlay').setAttribute('aria-pressed', String(P.overlay));
}

// ------------------------------------------------------------------ interaction
const pickHour = i => { P.hour = Math.max(0, Math.min(P.result.hours.length - 1, i)); renderAll(); draw(); };
q('hours').onclick = e => { const b = e.target.closest('.hr'); if (b) pickHour(+b.dataset.i) };
q('slider').oninput = e => pickHour(+e.target.value);
q('chart').onclick = e => { const r = e.target.closest('.hit'); if (r) pickHour(+r.dataset.i) };
q('members').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.member = /^\d+$/.test(b.dataset.m) ? +b.dataset.m : b.dataset.m; renderAll(); draw(); };
q('overlay').onclick = () => { P.overlay = !P.overlay; renderDetail(); draw(); };
q('fly').onclick = () => {
  if (!P.result) return; const r = selRun();
  if (P.result.key !== areaKey()) { q('status').textContent = 'The map or survey area changed since planning. Plan again first.'; return; }
  Object.assign(C, r.v); normalizeConfig(); derive(); resetMission(); startMission(); paused = false; updateButtons();
  notice(`Flying ${P.result.hours[P.hour].valid_local}, scenario ${r.member + 1}: wind ${r.v.wind} m/s from ${r.v.wdir}°, gusts ±${r.v.gust}. Aircraft settings now include this weather.`);
  document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
addEventListener('keydown', e => { if (!P.result || !['ArrowLeft', 'ArrowRight'].includes(e.key) || e.target.closest('input,select,textarea')) return; pickHour(P.hour + (e.key === 'ArrowRight' ? 1 : -1)); });

// ------------------------------------------------------------------ API for physics_view.js
window.DronePlanner = {
  listeners: [],
  selection() {
    if (!P.result) return null; const h = P.result.hours[P.hour], r = selRun();
    const b = P.result.best, sug = b && b.status !== 'NO-GO' ? { hourLabel: b.valid_local, hourIndex: P.result.hours.indexOf(b), member: b.medianRun.member, run: b.medianRun } : null;
    return { key: P.result.key, hourLabel: h.valid_local, hourIndex: P.hour, member: r.member, run: r, status: h.status, suggested: sug, base: P.result.base, stale: P.result.key !== areaKey() };
  },
};

// ------------------------------------------------------------------ planned paths on the Flight Lab map
const baseDraw = draw;
draw = function () {
  baseDraw();
  renderInfo();
  if (!P.result || !P.overlay || window.DronePhysicsActive || !MAP || !cw || P.result.key !== areaKey()) return;
  const h = P.result.hours[P.hour], sel = selRun(), c = mx, ox = (cw - (MAP.W + 2 * VIEWM) * SC) / 2, X = x => ox + (x + VIEWM) * SC, Y = y => (y + VIEWM) * SC;
  const line = (p, col, w) => { if (!p.length) return; c.beginPath(); c.moveTo(X(p[0][0]), Y(p[0][1])); for (let i = 1; i < p.length; i++) c.lineTo(X(p[i][0]), Y(p[i][1])); c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round'; c.stroke(); };
  c.save();
  const GREEN = '#199e70', ORANGE = '#d95926', BLUE = '#3987e5', best = P.result.best, sug = best && best.status !== 'NO-GO' ? best.medianRun : null;
  if (P.result.calm) line(P.result.calm.path, GREEN, 1.8);                                  // original path, no wind
  if (sug) line(sug.r.path, ORANGE, 2.2);                                                    // suggested path for the day
  line(sel.r.path, BLUE, 1.8);                                                               // selected path
  const end = sel.r.path[sel.r.path.length - 1];
  if (sel.r.emergency && end) { c.fillStyle = '#d92b45'; c.beginPath(); c.arc(X(end[0]), Y(end[1]), 5, 0, Math.PI * 2); c.fill(); c.fillStyle = '#dce4e9'; c.font = '12px "IBM Plex Mono",monospace'; c.fillText('emergency landing', X(end[0]) + 8, Y(end[1]) + 4); }
  c.restore();
};
})();
