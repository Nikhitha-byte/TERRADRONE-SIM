/* physics_view.js - "05 / Physics (6-DOF)" panel for Drone Scout Flight Lab
   Load after app.js, physics6dof.js and planner.js.
   For the hour and scenario selected in the Mission planner it flies the survey twice with
   the 6-DOF rigid-body model (physics6dof.js): once in no wind (the original path) and once in the
   forecast weather. It then shows how far the weather pushed the drone off its original path,
   how it tilted and rotated, motor load, power and battery, and plays the flight back on the
   map and the 3D aircraft view. Results download as CSV for MATLAB. */
(() => {
'use strict';
if (!window.Physics6DOF || !window.DronePlanner) { console.warn('physics_view.js needs physics6dof.js and planner.js'); return; }
const PH = window.Physics6DOF, NOWIND = '#199e70', SUG = '#d95926', FCST = '#3987e5';   // green = no wind, orange = recommended path, blue = selected window
const V = { res: null, busy: false, t: 0, playing: false, speed: 10, show: true, lastFrame: 0 };
const f = (v, d = 1) => v === null || v === undefined || !isFinite(v) ? '–' : (+v).toFixed(d);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------ panel
const css = document.createElement('style');
css.textContent = `
#physics .tw{max-height:none}#physics .ptable{width:100%;border-collapse:collapse;font:12.5px var(--mono)}#physics .ptable th,#physics .ptable td{padding:7px 14px;border-bottom:1px solid var(--line);text-align:right}
#physics .ptable th:first-child,#physics .ptable td:first-child{text-align:left;font-family:var(--sans);color:#c9d4db}#physics .ptable thead th{color:var(--muted);font-weight:500;background:var(--panel2)}
#physics .sw{display:inline-block;width:12px;height:3px;margin-right:6px;vertical-align:middle;border-radius:2px}
#physics .charts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border-top:1px solid var(--line)}
#physics .ch{padding:12px 14px 6px;border-right:1px solid var(--line);position:relative;min-width:0}#physics .ch:last-child{border-right:0}
#physics .ch h3{font:500 12px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
#physics svg{display:block;width:100%;height:auto;cursor:crosshair}#physics .grid{stroke:#1d272e}#physics .ax{fill:var(--muted);font:10px var(--mono)}
#physics .cur{stroke:var(--fg);stroke-width:1}#physics .hov{stroke:#8a99a4;stroke-width:1;stroke-dasharray:2 2}
#physics .tip{position:absolute;pointer-events:none;background:#0d1215;border:1px solid var(--line2);border-radius:6px;padding:6px 8px;font:11.5px var(--mono);color:var(--fg);white-space:nowrap;z-index:2}
#physics .play{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:12px 20px;border-top:1px solid var(--line)}#physics .play input[type=range]{flex:1;min-width:160px;accent-color:${FCST}}
#physics .now{font:12.5px var(--mono);color:#c9d4db;min-width:320px}
#physics .lg2{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12.5px;color:var(--muted);padding:10px 20px}
#physics details{padding:0 20px 14px}#physics details summary{cursor:pointer;color:var(--muted);font-size:12.5px;padding:8px 0}
#physics .progress{height:3px;background:var(--line)}#physics .progress>div{height:3px;background:${FCST};width:0}
@media(max-width:900px){#physics .charts{grid-template-columns:1fr}#physics .ch{border-right:0;border-bottom:1px solid var(--line)}#physics .now{min-width:0}}`;
document.head.appendChild(css);

const panel = document.createElement('section');
panel.className = 'panel'; panel.id = 'physics';
panel.innerHTML = `
<div class="ph"><h2>05 / Physics (6-DOF)</h2><span class="sub">rigid-body flight: no wind · recommended path · selected window</span></div>
<div class="bar"><button class="btn primary" id="ph-run" disabled>Run 6-DOF physics</button><span class="note" id="ph-status" style="margin:0">Plan a launch window above, pick an hour and scenario, then run the physics.</span></div>
<div class="progress"><div id="ph-prog"></div></div>
<div id="ph-body" hidden>
 <div class="lg2"><span><i class="sw" style="background:${NOWIND}"></i>No wind (original path)</span><span id="ph-lsug"><i class="sw" style="background:${SUG}"></i>Recommended path</span><span><i class="sw" style="background:${FCST}"></i>Selected window (bright = flown so far)</span></div><div class="lg2" style="padding-top:0"><span id="ph-which"></span></div>
 <div class="tw"><table class="ptable" id="ph-table"></table></div>
 <div class="play"><button class="btn" id="ph-play">▶ Play</button><div class="seg sm" id="ph-speed" role="group" aria-label="Playback speed"><button data-s="1" aria-pressed="false">×1</button><button data-s="10" aria-pressed="true">×10</button><button data-s="60" aria-pressed="false">×60</button></div>
  <input type="range" id="ph-scrub" min="0" max="1000" value="0" aria-label="Playback time"><span class="now" id="ph-now"></span>
  <button class="btn" id="ph-map" aria-pressed="true">Show on map: on</button><button class="btn" id="ph-csv">Download CSV (MATLAB)</button></div>
 <div class="charts"><div class="ch" id="ph-c1"></div><div class="ch" id="ph-c2"></div><div class="ch" id="ph-c3"></div></div>
 <details><summary>Model, equations and airframe parameters</summary><div id="ph-model" class="note" style="padding:0"></div></details>
</div>`;
document.getElementById('planner').after(panel);
const q = id => document.getElementById('ph-' + id);

// ------------------------------------------------------------------ selection tracking
function refreshButton() {
  const s = DronePlanner.selection();
  q('run').disabled = V.busy || !s || s.stale;
  if (!V.busy && s && !V.res) q('status').textContent = `Ready: ${s.hourLabel}, scenario ${s.member + 1}. Flies the survey with full rigid-body physics.`;
  if (V.res && s && (V.res.sel.hourIndex !== s.hourIndex || V.res.sel.member !== s.member)) q('status').textContent = `Showing ${V.res.sel.hourLabel}, scenario ${V.res.sel.member + 1}. Selection changed: run again to update.`;
}
DronePlanner.listeners.push(refreshButton);

// ------------------------------------------------------------------ running
q('run').onclick = () => {
  const s = DronePlanner.selection(); if (!s || V.busy) return;
  if (s.stale) { q('status').textContent = 'The survey area changed since planning. Plan again first.'; return; }
  V.busy = true; V.playing = false; refreshButton();
  const plan = PLAN, home = HOME(), base = s.base;
  const est = plan.T, dt = est > 300 ? 0.004 : 0.002, logEvery = Math.max(0.05, est * 1.6 / 5000), tmax = est * 4 + 300;
  const mk = (C, wind, rho, member) => PH.create({ C, route: PH.routeFromPlan(plan.wps, home, base.alt), laneSpeed: plan.vs, wind, rho,
    seed: base.seed + member + 1, dt, logEvery });
  const forRun = run => mk({ ...base, capmAh: run.v.capmAh, energy: run.v.capmAh * base.vnom / 1000, phov: base.phov },   // physics applies air density itself
    { speed: run.v.wind, fromDeg: run.v.wdir, gustSigma: run.v.gust }, run.w.air_density_kgm3 || 1.225, run.member);
  const same = !!s.suggested && s.suggested.hourIndex === s.hourIndex && s.suggested.member === s.member;
  const jobs = [{ id: 'nom', label: 'no-wind', sim: mk({ ...base, energy: base.capmAh * base.vnom / 1000 }, { speed: 0, gustSigma: 0 }, 1.225, s.member) }];
  if (s.suggested && !same) jobs.push({ id: 'sg', label: 'recommended', sim: forRun(s.suggested.run) });
  jobs.push({ id: 'fc', label: 'selected window', sim: forRun(s.run) });
  const sims = jobs.map(j => j.sim);
  let k = 0;
  const tick = () => {
    const t0 = performance.now();
    try {
      while (k < sims.length && performance.now() - t0 < 45) { if (sims[k].run(4000, tmax)) k++; }
    } catch (e) { V.busy = false; q('status').textContent = 'Physics run failed: ' + e.message; console.error(e); refreshButton(); return; }
    const prog = (k + (k < sims.length ? Math.min(1, sims[k].state.t / Math.max(1, est * 1.2)) : 0)) / sims.length;
    q('prog').style.width = (100 * prog).toFixed(1) + '%';
    q('status').textContent = k < sims.length ? `Integrating ${jobs[k].label} flight (${k + 1} of ${sims.length})… ${mmss(sims[k].state.t)} simulated` : 'Done.';
    if (k < sims.length) { setTimeout(tick, 0); return; }
    finish(s, jobs, same);
  };
  setTimeout(tick, 0);
};

function deviation(nom, fc) { // distance from each forecast point to the no-wind path (grid-indexed polyline)
  const cell = 4, grid = new Map(), key = (i, j) => i + ',' + j;
  for (let i = 1; i < nom.length; i++) {
    const a = nom[i - 1], b = nom[i];
    const x0 = Math.floor(Math.min(a.x, b.x) / cell), x1 = Math.floor(Math.max(a.x, b.x) / cell), y0 = Math.floor(Math.min(a.y, b.y) / cell), y1 = Math.floor(Math.max(a.y, b.y) / cell);
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const k = key(gx, gy); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  }
  const segDist = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy; let t = L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
  return fc.map(p => {
    const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
    for (let r = 1; r < 60; r++) {
      let best = Infinity;
      for (let i = gx - r; i <= gx + r; i++) for (let j = gy - r; j <= gy + r; j++) { const l = grid.get(key(i, j)); if (l) for (const s of l) best = Math.min(best, segDist(p, nom[s - 1], nom[s])); }
      if (best <= (r - 0.5) * cell) return best;
      if (r === 59) return best;
    }
    return 0;
  });
}

function finish(sel, jobs, same) {
  const J = Object.fromEntries(jobs.map(j => [j.id, j.sim])), n = J.nom, fc = J.fc, sg = J.sg || null;
  const devOf = sim => { const d = deviation(n.trace, sim.trace); sim.trace.forEach((r, i) => { r.dev = d[i]; }); return { max: Math.max(...d), mean: d.reduce((a, b) => a + b, 0) / d.length }; };
  const df = devOf(fc), ds = sg ? devOf(sg) : null;
  n.trace.forEach(r => { r.dev = 0; });
  V.res = { sel, same, sugInfo: sel.suggested, key: sel.key, nom: n.trace, sg: sg ? sg.trace : null, fc: fc.trace,
    sn: n.summary(), ss: sg ? sg.summary() : null, sf: fc.summary(), df, ds,
    dur: Math.max(...jobs.map(j => j.sim.state.t)), dt: fc.dt, airframe: fc.airframe };
  V.busy = false; V.t = 0; V.show = true; window.DronePhysicsActive = true;
  q('body').hidden = false;
  q('status').textContent = `Flown with 6-DOF physics (RK4, ${Math.round(1 / V.res.dt)} Hz): no wind, ${sel.suggested ? (same ? 'the selected window (it is the recommended path)' : 'recommended path ' + sel.suggested.hourLabel + ' and selected window ' + sel.hourLabel) : 'selected window ' + sel.hourLabel + ' (no hour is cleared, so no recommended path)'}.`;
  const wx = r => `${f(r.v.wind)} m/s from ${r.v.wdir}°, gusts ±${f(r.v.gust)}`;
  q('lsug').hidden = !sg && !same;
  q('lsug').innerHTML = `<i class="sw" style="background:${SUG}"></i>Recommended path${sel.suggested ? ' · ' + esc(sel.suggested.hourLabel) : ''}${same ? ' (same as selected)' : ''}`;
  q('which').textContent = `Selected ${sel.hourLabel}, scenario ${sel.member + 1}: ${wx(sel.run)}${sg ? ` · Recommended ${sel.suggested.hourLabel}: ${wx(sel.suggested.run)}` : ''}`;
  renderTable(); renderCharts(); renderModel(); seek(0); refreshButton(); draw();
}

// ------------------------------------------------------------------ comparison table
function renderTable() {
  const R = V.res, out = s => s.emergency ? '<span class="s-NOGO">emergency landing</span>' : s.rth_reserve ? 'returned at battery reserve' : s.completed ? 'survey complete' : 'not finished';
  const cols = [{ s: R.sn, d: null, c: NOWIND, h: 'No wind' }];
  if (R.ss) cols.push({ s: R.ss, d: R.ds, c: SUG, h: 'Recommended · ' + R.sugInfo.hourLabel.slice(-5) });
  cols.push({ s: R.sf, d: R.df, c: FCST, h: (R.same ? 'Selected = recommended · ' : 'Selected · ') + R.sel.hourLabel.slice(-5) });
  const rows = [
    ['Outcome', c => out(c.s)],
    ['Flight time', c => mmss(c.s.duration_s)],
    ['Energy used', c => f(c.s.energy_wh) + ' Wh'],
    ['Battery at landing', c => f(c.s.battery_end_pct, 0) + ' %'],
    ['Peak power', c => f(c.s.peak_power_w, 0) + ' W'],
    ['Max tilt', c => f(c.s.max_tilt_deg) + '°'],
    ['Max roll / pitch', c => f(c.s.max_roll_deg) + '° / ' + f(c.s.max_pitch_deg) + '°'],
    ['Max rotation rate', c => f(c.s.max_rate_dps, 0) + ' °/s'],
    ['Lane tracking error (RMS)', c => f(c.s.track_rms_m, 2) + ' m'],
    ['Distance from no-wind path', c => c.d ? `max ${f(c.d.max)} m · mean ${f(c.d.mean, 2)} m` : '0 m'],
    ['Motors at thrust limit', c => f(c.s.motor_saturation_pct, 1) + ' % of flight'],
  ];
  q('table').innerHTML = `<thead><tr><th></th>${cols.map(c => `<th><i class="sw" style="background:${c.c}"></i>${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><td>${r[0]}</td>${cols.map(c => `<td>${r[1](c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

// ------------------------------------------------------------------ charts (time on x, shared cursor)
const CH = [
  { id: 'c1', title: 'Distance from no-wind path (m)', series: [{ run: 'sg', key: 'dev', color: SUG, name: 'Recommended' }, { run: 'fc', key: 'dev', color: FCST, name: 'Selected' }] },
  { id: 'c2', title: 'Tilt from level (°)', series: [{ run: 'nom', key: 'tilt', color: NOWIND, name: 'No wind' }, { run: 'sg', key: 'tilt', color: SUG, name: 'Recommended' }, { run: 'fc', key: 'tilt', color: FCST, name: 'Selected' }] },
  { id: 'c3', title: 'Electrical power (W)', series: [{ run: 'nom', key: 'power', color: NOWIND, name: 'No wind' }, { run: 'sg', key: 'power', color: SUG, name: 'Recommended' }, { run: 'fc', key: 'power', color: FCST, name: 'Selected' }] },
];
const GW = 420, GH = 170, L = 40, R = 10, T = 8, B = 22;
const down = (tr, n = 500) => { const k = Math.max(1, Math.ceil(tr.length / n)); return tr.filter((_, i) => i % k === 0 || i === tr.length - 1); };
function renderCharts() {
  const X = t => L + (GW - L - R) * t / V.res.dur;
  CH.forEach(c0 => {
    const c = { ...c0, series: c0.series.filter(s => V.res[s.run]) };
    const all = c.series.flatMap(s => V.res[s.run].map(r => r[s.key]));
    const top = Math.max(1, ...all) * 1.08, Y = v => T + (GH - T - B) * (1 - v / top);
    const step = niceStep(top / 4); let g = '';
    for (let v = 0; v <= top; v += step) g += `<line class="grid" x1="${L}" x2="${GW - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 5}" y="${Y(v) + 3}" text-anchor="end">${+v.toFixed(2)}</text>`;
    const tStep = niceStep(V.res.dur / 4);
    for (let t = 0; t <= V.res.dur; t += tStep) g += `<text class="ax" x="${X(t)}" y="${GH - 6}" text-anchor="middle">${mmss(t)}</text>`;
    const lines = c.series.map(s => `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${down(V.res[s.run]).map(r => X(r.t).toFixed(1) + ',' + Y(r[s.key]).toFixed(1)).join(' ')}"/>`).join('');
    const el = q(c.id);
    el.innerHTML = `<h3>${c.title}</h3><svg viewBox="0 0 ${GW} ${GH}" role="img" aria-label="${c.title} over time">${g}${lines}<line class="hov" y1="${T}" y2="${GH - B}" x1="-9" x2="-9"/><line class="cur" y1="${T}" y2="${GH - B}" x1="${L}" x2="${L}"/></svg><div class="tip" hidden></div>`;
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), hov = el.querySelector('.hov');
    const tAt = e => { const b = svg.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * GW; return Math.max(0, Math.min(V.res.dur, (x - L) / (GW - L - R) * V.res.dur)); };
    svg.onmousemove = e => {
      const t = tAt(e), b = el.getBoundingClientRect(), sb = svg.getBoundingClientRect();
      hov.setAttribute('x1', X(t)); hov.setAttribute('x2', X(t));
      tip.innerHTML = `<b>${mmss(t)}</b>` + c.series.map(s => { const r = sample(V.res[s.run], t); return `<br><i class="sw" style="background:${s.color}"></i>${s.name} ${f(r[s.key], c.id === 'c3' ? 0 : 2)}`; }).join('');
      tip.hidden = false; let x = e.clientX - b.left + 12; if (x > b.width - 150) x = e.clientX - b.left - 150; tip.style.left = x + 'px'; tip.style.top = (sb.top - b.top + 10) + 'px';
    };
    svg.onmouseleave = () => { tip.hidden = true; hov.setAttribute('x1', -9); hov.setAttribute('x2', -9); };
    svg.onclick = e => seek(tAt(e));
  });
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }
function idxAt(tr, t) { let lo = 0, hi = tr.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tr[mid].t <= t) lo = mid; else hi = mid - 1; } return lo; }
const sample = (tr, t) => tr[idxAt(tr, t)];

function renderModel() {
  const A = V.res.airframe;
  q('model').innerHTML = `<p><b>State</b>: position, velocity, attitude quaternion, body rates and the thrust of each motor (17 states), integrated with 4th-order Runge–Kutta at ${Math.round(1 / V.res.dt)} Hz.</p>
  <p><b>Equations</b>: p′ = v · v′ = (R(q)·[0,0,ΣTᵢ] + F<sub>drag</sub>(v − wind))/m − g · q′ = ½ q⊗[0,ω] · ω′ = J⁻¹(τ − ω×Jω) · Tᵢ′ = (Tᵢ,cmd − Tᵢ)/τ<sub>motor</sub></p>
  <p><b>Disturbances</b>: forecast mean wind at flight altitude + Dryden low-altitude turbulence (MIL-HDBK-1797 length scales; the forecast gust σ is used as a floor) + GNSS position noise. <b>Control</b>: route guidance → velocity PI (learns the wind) → thrust vector (35° tilt limit) → geometric attitude control on SO(3) → X-quad motor mixer with thrust limits. <b>Power</b>: momentum theory per rotor, Pᵢ ∝ Tᵢ<sup>1.5</sup>/√(2ρA), calibrated to Flight Lab's hover power at sea level, so thinner air costs more.</p>
  <table class="ptable"><thead><tr><th>Parameter</th><th>Value</th><th>Basis</th></tr></thead><tbody>${Object.entries(A).map(([k, v]) => `<tr><td>${esc(v.note)}</td><td>${Array.isArray(v.v) ? v.v.join(' / ') : v.v}</td><td><span class="tag t-${v.tag === 'DERIVED' ? 'DERIVED' : 'ASSUMED'}">${v.tag}</span></td></tr>`).join('')}</tbody></table>
  <p>Checked against hand calculations in <code>tests/physics.test.cjs</code>: hover thrust = mg/4, steady-wind tilt = atan(drag/weight), hover power ∝ 1/√ρ.</p>`;
}

// ------------------------------------------------------------------ playback (drives Flight Lab's map and 3D aircraft)
function seek(t) {
  V.t = Math.max(0, Math.min(V.res.dur, t));
  q('scrub').value = Math.round(1000 * V.t / V.res.dur);
  const r = sample(V.res.fc, V.t);
  q('now').textContent = `${mmss(V.t)} · alt ${f(r.z)} m · roll ${f(r.roll)}° pitch ${f(r.pitch)}° heading ${f(r.heading, 0)}° · ${f(r.groundspeed)} m/s · ${f(r.power, 0)} W · ${f(r.battery, 0)} % · off-path ${f(r.dev, 2)} m`;
  const X = L + (GW - L - R) * V.t / V.res.dur;
  document.querySelectorAll('#physics .cur').forEach(l => { l.setAttribute('x1', X); l.setAttribute('x2', X); });
  draw(); drawAircraft();
}
q('scrub').oninput = e => { V.playing = false; q('play').textContent = '▶ Play'; seek(+e.target.value / 1000 * V.res.dur); };
q('play').onclick = () => { if (!V.res) return; if (V.t >= V.res.dur) V.t = 0; V.playing = !V.playing; q('play').textContent = V.playing ? '❚❚ Pause' : '▶ Play'; V.lastFrame = performance.now(); if (V.playing) requestAnimationFrame(loop); };
q('speed').onclick = e => { const b = e.target.closest('button'); if (!b) return; V.speed = +b.dataset.s; [...q('speed').children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
q('map').onclick = () => { V.show = !V.show; window.DronePhysicsActive = V.show; q('map').textContent = 'Show on map: ' + (V.show ? 'on' : 'off'); q('map').setAttribute('aria-pressed', String(V.show)); draw(); drawAircraft(); };
function loop(now) {
  if (!V.playing) return;
  const dt = Math.min(0.1, (now - V.lastFrame) / 1000); V.lastFrame = now;
  seek(V.t + dt * V.speed);
  if (V.t >= V.res.dur) { V.playing = false; q('play').textContent = '▶ Play'; return; }
  requestAnimationFrame(loop);
}
q('csv').onclick = () => {
  const runs = [['nowind', V.res.nom], ...(V.res.sg ? [['suggested', V.res.sg]] : []), [V.res.same ? 'selected_suggested' : 'selected', V.res.fc]];
  const head = PH.toCSV(V.res.nom).split('\n')[0];
  const body = runs.map(([name, tr]) => PH.toCSV(tr).split('\n').slice(1).map((l, i) => name + ',' + l + ',' + (+(tr[i].dev || 0).toFixed(4))).join('\n')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['run,' + head + ',offpath_m\n' + body], { type: 'text/csv' }));
  a.download = `physics_6dof_${V.res.sel.hourLabel.replace(/[^\w]+/g, '_')}_s${V.res.sel.member + 1}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

// swap the playback state into Flight Lab's drawing for one frame, then restore the live state
const active = () => V.res && V.show && V.res.key === DronePlanner.selection()?.key && !['fly', 'rth', 'landing'].includes(S.phase);
function withPlayback(fn) {
  if (!active()) return fn();
  const i = idxAt(V.res.fc, V.t), r = V.res.fc[i];
  const keep = { x: S.x, y: S.y, z: S.z, roll: S.roll, pitch: S.pitch, yaw: S.yaw, t: S.t, trail: S.trail, P: S.P }, keepPaused = paused;
  const keepC = { wind: C.wind, wdir: C.wdir }, sv = V.res.sel.run.v;
  Object.assign(S, { x: r.x, y: r.y, z: r.z, roll: r.dispRoll, pitch: r.dispPitch, yaw: r.dispYaw, t: r.t, trail: [], P: r.power });
  Object.assign(C, { wind: sv.wind, wdir: sv.wdir });                 // map wind arrow shows the forecast
  paused = !V.playing;
  try { fn(); } finally { Object.assign(S, keep); Object.assign(C, keepC); paused = keepPaused; }
}
const baseDraw = draw, baseAircraft = drawAircraft;
draw = function () {
  withPlayback(baseDraw);
  if (!active() || !MAP || !cw) return;
  const c = mx, ox = (cw - (MAP.W + 2 * VIEWM) * SC) / 2, X = x => ox + (x + VIEWM) * SC, Y = y => (y + VIEWM) * SC;
  const line = (tr, col, w, a = 1) => { c.beginPath(); tr.forEach((p, i) => i ? c.lineTo(X(p.x), Y(p.y)) : c.moveTo(X(p.x), Y(p.y))); c.globalAlpha = a; c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round'; c.stroke(); c.globalAlpha = 1; };
  c.save();
  const i = idxAt(V.res.fc, V.t);
  line(down(V.res.nom, 3000), NOWIND, 1.8);
  if (V.res.sg) line(down(V.res.sg, 3000), SUG, 2.0);
  line(down(V.res.fc, 3000), FCST, 1.2, 0.35);
  line(down(V.res.fc.slice(0, i + 1), 3000), FCST, 2.2);
  if (V.res.sf.emergency) { const e = V.res.fc[V.res.fc.length - 1]; c.fillStyle = '#d92b45'; c.beginPath(); c.arc(X(e.x), Y(e.y), 5, 0, 7); c.fill(); }
  c.restore();
};
const note = document.querySelector('.modelnote'), noteText = note ? note.textContent : '';
drawAircraft = function () {
  withPlayback(baseAircraft);
  if (note) note.textContent = active() ? 'Attitude from the 6-DOF physics playback (rigid body, RK4). Roll and pitch here are the lean toward travel and to the right.' : noteText;
};
})();
