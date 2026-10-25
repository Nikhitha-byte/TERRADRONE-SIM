// mission_report.cjs - renders mission_plan.json as a self-contained HTML page (Flight Lab styling)
'use strict';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (v, d = 1) => v === null || v === undefined || Number.isNaN(v) ? '–' : (+v).toFixed(d);
const ICON = { GO: '✓', CAUTION: '!', 'NO-GO': '✕' };
const LBL = { GO: 'CLEARED', CAUTION: 'CONDITIONAL', 'NO-GO': 'NOT CLEARED' };
const chip = s => `<span class="chip s-${s.replace('-', '')}"><b>${ICON[s]}</b>${LBL[s]}</span>`;

function batteryChart(hours, calmNeed) {
  // (hours, calmNeed are rescaled locally when the job spans several batteries)
  const W = 760, H = 260, L = 52, R = 120, T = 16, B = 58, n = hours.length;
  const has = h => h.battery_needed_pct.median !== null;
  const top = Math.max(calmNeed, ...hours.filter(has).map(h => h.battery_needed_pct.p90));
  const BAT = top > 150;                       // big jobs: plot in batteries, not percent
  const u = v => BAT ? v / 100 : v, unit = v => BAT ? (+v).toFixed(v < 10 ? 1 : 0) + '×' : (+v).toFixed(0) + '%';
  const maxY = BAT ? Math.ceil(u(top) + 0.5) : Math.max(110, top + 10);
  hours = hours.map(h => ({ ...h, battery_needed_pct: has(h) ? { p10: u(h.battery_needed_pct.p10), median: u(h.battery_needed_pct.median), p90: u(h.battery_needed_pct.p90) } : h.battery_needed_pct }));
  calmNeed = u(calmNeed);
  const x = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1)), y = v => T + (H - T - B) * (1 - v / maxY);
  const ticks = [], stepT = BAT ? Math.max(1, Math.ceil(maxY / 6)) : (maxY > 160 ? 50 : 25); for (let v = 0; v <= maxY; v += stepT) ticks.push(v);
  // split into runs of consecutive hours that have finished scenarios (gaps = no run finished)
  const segs = []; hours.forEach((h, i) => { if (!has(h)) return; const last = segs[segs.length - 1]; if (last && last[last.length - 1] === i - 1) last.push(i); else segs.push([i]); });
  const band = segs.map(sg => `<polygon class="band" points="${sg.map(i => `${x(i)},${y(hours[i].battery_needed_pct.p90)}`).join(' ')} ${sg.map(i => `${x(i)},${y(hours[i].battery_needed_pct.p10)}`).reverse().join(' ')}"/>`).join('');
  const line = segs.map(sg => `<polyline class="line" points="${sg.map(i => `${x(i)},${y(hours[i].battery_needed_pct.median)}`).join(' ')}"/>`).join('');
  const lastI = [...hours.keys()].filter(i => has(hours[i])).pop();
  return `<figure class="chart" id="bchart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Battery needed per launch hour">
  ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="ax" text-anchor="end">${unit(v)}</text>`).join('')}
  <line x1="${L}" x2="${W - R}" y1="${y(u(100))}" y2="${y(u(100))}" class="ref"/><text x="${W - R + 6}" y="${y(u(100)) + 4}" class="reflab">one full battery</text>
  <line x1="${L}" x2="${W - R}" y1="${y(calmNeed)}" y2="${y(calmNeed)}" class="ref calm"/><text x="${W - R + 6}" y="${y(calmNeed) + 4}" class="reflab">calm weather</text>
  ${band}${line}
  ${hours.map((h, i) => has(h) ? `<circle cx="${x(i)}" cy="${y(h.battery_needed_pct.median)}" r="4.5" class="dot"/>` : `<text x="${x(i)}" y="${y(maxY * 0.08)}" class="ax" text-anchor="middle">none finished</text>`).join('')}
  ${lastI !== undefined ? `<text x="${x(lastI) + 8}" y="${y(hours[lastI].battery_needed_pct.median) - 8}" class="endlab">${unit(hours[lastI].battery_needed_pct.median)}</text>` : ''}
  ${hours.map((h, i) => `<text x="${x(i)}" y="${H - B + 18}" class="ax" text-anchor="middle">${esc(h.valid_local.slice(-5))}</text>
     <text x="${x(i)}" y="${H - B + 38}" class="st s-${h.status.replace('-', '')}" text-anchor="middle">${ICON[h.status]} ${LBL[h.status]}</text>`).join('')}
  ${hours.map((h, i) => `<rect x="${x(i) - (W - L - R) / Math.max(1, n - 1) / 2}" y="${T}" width="${(W - L - R) / Math.max(1, n - 1)}" height="${H - T - B}" class="hit" data-i="${i}"/>`).join('')}
  </svg><div class="tip" hidden></div>
  <figcaption>${BAT ? 'Batteries' : 'Share of one battery'} needed to finish the survey and keep the return-home reserve, per launch hour. Line: median scenario. Shaded band: range across forecast scenarios (10th–90th percentile).</figcaption></figure>`;
}

function pathMap(plan, worst) {
  const m = plan.map, a = m.survey_area || { x: 0, y: 0, W: m.W, H: m.H };
  const pts = [...(plan.calm_baseline.path || []), ...((worst && worst.result.path) || []), [-5, -5], [m.W, m.H], [0, 0]];
  const minX = Math.min(...pts.map(p => p[0])) - 6, maxX = Math.max(...pts.map(p => p[0])) + 6, minY = Math.min(...pts.map(p => p[1])) - 6, maxY = Math.max(...pts.map(p => p[1])) + 6;
  const VW = 760, sc = Math.min(VW / (maxX - minX), 420 / (maxY - minY)), VH = (maxY - minY) * sc;
  const X = v => (v - minX) * sc, Y = v => (v - minY) * sc, poly = p => (p || []).map(q => `${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(' ');
  const wdir = worst ? worst.sim_values.wdir : 0, th = (wdir + 180) * Math.PI / 180, cx = VW - 50, cy = 40, ax = Math.sin(th) * 22, ay = -Math.cos(th) * 22;
  return `<figure class="chart"><svg viewBox="0 0 ${VW} ${VH.toFixed(0)}" role="img" aria-label="Flight paths, calm versus worst forecast scenario">
   <rect x="${X(0)}" y="${Y(0)}" width="${m.W * sc}" height="${m.H * sc}" class="field"/>
   <rect x="${X(a.x)}" y="${Y(a.y)}" width="${a.W * sc}" height="${a.H * sc}" class="aoi"/>
   <polyline points="${poly(plan.calm_baseline.path)}" class="pcalm"/>
   ${worst ? `<polyline points="${poly(worst.result.path)}" class="pworst"/>` : ''}
   <circle cx="${X(-5)}" cy="${Y(-5)}" r="5" class="home"/><text x="${X(-5) + 9}" y="${Y(-5) + 4}" class="ax">home</text>
   ${worst && worst.sim_values.wind > 0 ? `<g class="wind"><line x1="${cx - ax}" y1="${cy - ay}" x2="${cx + ax}" y2="${cy + ay}"/><circle cx="${cx + ax}" cy="${cy + ay}" r="3"/><text x="${cx}" y="${cy + 38}" text-anchor="middle" class="ax">wind ${f(worst.sim_values.wind)} m/s from ${worst.sim_values.wdir}°</text></g>` : ''}
  </svg><div class="legend"><span><i class="lw"></i>Worst forecast scenario at ${esc(plan.planned_hour)}</span><span><i class="lc"></i>Calm weather</span><span><i class="la"></i>Survey area</span></div>
  <figcaption>Flown paths from the simulator in local map metres (top of map = heading set in the forecast step).</figcaption></figure>`;
}

module.exports = function render(plan) {
  const hrs = plan.hours, P = hrs[0], calm = plan.calm_baseline;
  const sev = r => (r.result.emergency ? 1e6 : 0) + (r.battery_needed_pct ?? 5e5);
  const worst = [...P.runs].sort((a, b) => sev(b) - sev(a))[0];
  const best = hrs.find(h => h.valid_local === plan.recommended_hour);
  const BIG = Math.max(calm.battery_needed_pct, ...hrs.map(h => h.battery_needed_pct.p90 ?? 0)) > 150;
  const data = hrs.map(h => ({ t: h.valid_local, s: h.status, m: h.battery_needed_pct.median, lo: h.battery_needed_pct.p10, hi: h.battery_needed_pct.p90, w: h.wind_ms, g: h.gust_ms, r: h.rain_max_mm_h, d: h.flight_min.median, e: h.emergencies, n: h.scenarios }));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Drone Scout · Mission Plan</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{--bg:#0b0f12;--panel:#11171b;--panel2:#161e23;--well:#0d1215;--line:#212c33;--line2:#2d3b45;--fg:#dce4e9;--muted:#8a99a4;--dim:#5a6872;--blue:#4f93e0;--ok:#3cc06a;--warn:#e8bf3a;--crit:#d92b45;--orange:#f26a2e;
--mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;--sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:dark}
*{box-sizing:border-box}body{margin:0 auto;max-width:1200px;padding:26px 16px 40px;background:radial-gradient(ellipse at 15% 0,#14232b 0,transparent 40%),var(--bg);color:var(--fg);font:15px/1.55 var(--sans)}
.eyebrow{font:12px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}h1{font-size:30px;margin:4px 0 2px;letter-spacing:-.6px}h1 span{font-weight:400;color:var(--muted);font-size:22px}
.lead{color:var(--muted);margin:0 0 18px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;margin-top:16px;overflow:hidden}
.ph{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 16px;padding:13px 18px;border-bottom:1px solid var(--line)}.ph h2{font-size:15px;margin:0}.ph .sub{font:12.5px var(--mono);color:var(--muted)}
.hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,2fr);gap:0}.verdict{padding:22px;border-right:1px solid var(--line)}
.big{font:600 40px var(--mono);letter-spacing:-1px;display:flex;align-items:center;gap:12px}.big .ic{font-size:26px;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:#0b0f12}
.c-GO{color:var(--ok)}.c-CAUTION{color:var(--warn)}.c-NOGO{color:var(--crit)}.b-GO{background:var(--ok)}.b-CAUTION{background:var(--warn)}.b-NOGO{background:var(--crit)}
.rec{margin:12px 0 0;font-size:15px}.reasons{margin:12px 0 0;padding-left:18px;color:#c9d4db;font-size:13.5px}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.card{padding:16px 18px;border-bottom:1px solid var(--line);border-right:1px solid var(--line);min-width:0}
.card .v{font:500 24px var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}.card .v small{font-size:13px;color:var(--muted);margin-left:3px}.card .s{font:12px var(--mono);color:var(--muted)}
.chip{display:inline-flex;align-items:center;gap:5px;font:600 11.5px var(--mono);padding:2px 8px;border-radius:4px;white-space:nowrap}.chip b{font-size:11px}
.s-GO{color:var(--ok)}.s-CAUTION{color:var(--warn)}.s-NOGO{color:#ff6b7f}.chip.s-GO{background:#17342a}.chip.s-CAUTION{background:#352a17}.chip.s-NOGO{background:#3a1820}
.chart{margin:0;padding:14px 18px 10px;position:relative}.chart svg{width:100%;height:auto;display:block;max-height:460px}figcaption{font-size:12.5px;color:var(--muted);margin-top:6px}
.grid{stroke:#1d272e;stroke-width:1}.ax{fill:var(--muted);font:11px var(--mono)}.ref{stroke:#5a6872;stroke-width:1}.ref.calm{stroke:#8a99a4;stroke-dasharray:2 3}.reflab{fill:var(--muted);font:11px var(--sans)}
.band{fill:var(--blue);opacity:.12}.line{fill:none;stroke:var(--blue);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.dot{fill:var(--blue);stroke:var(--panel);stroke-width:2}.endlab{fill:var(--fg);font:12px var(--mono)}
.st{font:600 10.5px var(--mono)}.st.s-GO{fill:var(--ok)}.st.s-CAUTION{fill:var(--warn)}.st.s-NOGO{fill:#ff6b7f}
.hit{fill:transparent;cursor:crosshair}.hit:hover{fill:#ffffff08}
.tip{position:absolute;pointer-events:none;background:#0d1215;border:1px solid var(--line2);border-radius:6px;padding:8px 10px;font:12px var(--mono);color:var(--fg);min-width:190px;box-shadow:0 6px 18px #0008}
.field{fill:#13221a;stroke:#2a3b33}.aoi{fill:none;stroke:#3d5260;stroke-width:1}.pcalm{fill:none;stroke:#8a99a4;stroke-width:1.5;opacity:.8}.pworst{fill:none;stroke:var(--blue);stroke-width:2;stroke-linejoin:round}
.home{fill:var(--warn);stroke:var(--panel);stroke-width:2}.wind line{stroke:var(--fg);stroke-width:2}.wind circle{fill:var(--fg)}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--muted);margin-top:8px}.legend i{display:inline-block;width:16px;height:3px;margin-right:7px;vertical-align:middle}.lw{background:var(--blue)}.lc{background:#8a99a4}.la{border:1px solid #3d5260;height:10px!important}
.tw{overflow:auto}table{width:100%;border-collapse:collapse;font:12.5px var(--mono)}th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th{color:var(--muted);font-weight:500;background:var(--panel2);position:sticky;top:0}th:first-child,td:first-child{text-align:left}
td.why{text-align:left;white-space:normal;min-width:260px;font-family:var(--sans);font-size:12.5px;color:#c9d4db}tr.planned td{background:#15202a}
.note{font-size:12.5px;color:var(--muted);padding:12px 18px;margin:0}.tag{font:600 10px var(--mono);padding:1px 5px;border-radius:3px;margin-right:4px}.t-D{background:#6aa8f0;color:#071a2b}.t-A{background:#e8bf3a;color:#2b1f03}.t-S{background:#3cc06a;color:#06210f}
dl.m{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;padding:14px 18px;margin:0;font-size:13px}dl.m dt{color:var(--muted)}dl.m dd{margin:0}
@media(max-width:820px){.hero{grid-template-columns:1fr}.verdict{border-right:0;border-bottom:1px solid var(--line)}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.big{font-size:32px}}
</style></head><body>
<div class="eyebrow">UF / IFAS Drone Scout · pre-flight planning</div>
<h1>Mission Plan <span>${esc(plan.field.name)} · ${esc(plan.planned_hour)}</span></h1>
<p class="lead">${esc(plan.map.name)} survey at ${f(plan.field.flight_altitude_m, 0)} m · field ${f(plan.field.lat, 4)}, ${f(plan.field.lon, 4)} · weather from <b>${esc(plan.forecast_source.model)}</b> (${esc(plan.forecast_source.kind)}, started ${esc(plan.forecast_init_utc)}) · ${P.scenarios} forecast scenario${P.scenarios > 1 ? 's' : ''} per hour · flown in the Flight Lab simulator</p>

<section class="panel"><div class="hero"><div class="verdict">
 <div class="eyebrow">Planned launch · ${esc(plan.planned_hour)}</div>
 <div class="big c-${P.status.replace('-', '')}"><span class="ic b-${P.status.replace('-', '')}">${ICON[P.status]}</span>${LBL[P.status]}</div>
 <p class="rec"><b>${esc(plan.recommendation)}</b></p>
 ${P.reasons.length ? `<ul class="reasons">${P.reasons.slice(0, 6).map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p class="reasons" style="padding:0">All forecast scenarios finish the survey inside the aircraft limits with reserve to spare.</p>'}
</div><div class="cards">
 <div class="card"><div class="eyebrow">${BIG ? 'Battery packs needed' : 'Battery needed'}</div><div class="v">${!P.completed ? '<span class="c-NOGO">no finish</span>' : BIG ? f(P.battery_needed_pct.p90 / 100, 1) + '<small>× worst case</small>' : f(P.battery_needed_pct.p90, 0) + '<small>% worst case</small>'}</div><div class="s">${P.completed ? 'median ' + (BIG ? f(P.battery_needed_pct.median / 100, 1) + '×' : f(P.battery_needed_pct.median, 0) + ' %') + ' · ' : ''}calm ${BIG ? f(calm.battery_needed_pct / 100, 1) + '×' : f(calm.battery_needed_pct, 0) + ' %'}${P.emergencies ? ' · ' + P.emergencies + ' emergency' : ''}</div></div>
 <div class="card"><div class="eyebrow">Extra drain vs calm</div><div class="v">${P.extra_energy_vs_calm_pct === null ? '–' : (P.extra_energy_vs_calm_pct >= 0 ? '+' : '') + f(P.extra_energy_vs_calm_pct, 0) + '<small>%</small>'}</div><div class="s">${f(calm.energy_wh, 1)} Wh in calm air</div></div>
 <div class="card"><div class="eyebrow">Batteries</div><div class="v">${P.batteries_needed ?? '–'}<small>of ${plan.batteries_available}</small></div><div class="s">first starts at ${plan.first_battery_start_pct} %</div></div>
 <div class="card"><div class="eyebrow">Flight time</div><div class="v">${f(P.flight_min.median, 1)}<small>min</small></div><div class="s">up to ${f(P.flight_min.max, 1)} · calm ${f(calm.duration_min, 1)}</div></div>
 <div class="card"><div class="eyebrow">Wind at altitude</div><div class="v">${f(P.wind_ms, 1)}<small>m/s</small></div><div class="s">gusts ±${f(P.gust_ms, 1)} · rated 10</div></div>
 <div class="card"><div class="eyebrow">Rain · temp</div><div class="v">${f(P.rain_max_mm_h, 1)}<small>mm/h</small></div><div class="s">${f(P.temp_c, 0)} °C · visibility ${f(P.vis_km, 1)} km</div></div>
</div></div></section>

<section class="panel"><div class="ph"><h2>Launch window</h2><span class="sub">hover an hour for details</span></div>${batteryChart(hrs, calm.battery_needed_pct)}
<div class="tw"><table><thead><tr><th>Launch</th><th>Decision</th><th>Wind m/s</th><th>Gust σ</th><th>Rain mm/h</th><th>Temp °C</th><th>Vis km</th><th>${BIG ? 'Packs needed ×' : 'Battery needed %'}</th><th>Flight min</th><th>Batteries</th><th>Track err m</th><th>Max tilt °</th><th>Peak C</th><th>Why</th></tr></thead><tbody>
${hrs.map((h, i) => `<tr${i === 0 ? ' class="planned"' : ''}><td>${esc(h.valid_local)}${i === 0 ? ' · planned' : ''}${best && h === best && i ? ' · best' : ''}</td><td>${chip(h.status)}</td><td>${f(h.wind_ms)}</td><td>${f(h.gust_ms)}</td><td>${f(h.rain_max_mm_h)}</td><td>${f(h.temp_c, 0)}</td><td>${f(h.vis_km, 1)}</td><td>${h.completed ? (BIG ? `${f(h.battery_needed_pct.median / 100, 1)} <span style="color:var(--muted)">(${f(h.battery_needed_pct.p10 / 100, 1)}–${f(h.battery_needed_pct.p90 / 100, 1)})</span>` : `${f(h.battery_needed_pct.median, 0)} <span style="color:var(--muted)">(${f(h.battery_needed_pct.p10, 0)}–${f(h.battery_needed_pct.p90, 0)})</span>`) : 'not finished'}${h.emergencies ? `<br><span class="s-NOGO">${h.emergencies}/${h.scenarios} emergency</span>` : ''}</td><td>${f(h.flight_min.median)}</td><td>${h.batteries_needed ?? '–'}</td><td>${f(h.track_rms_m, 2)}</td><td>${f(h.max_tilt_deg, 0)}</td><td>${f(h.peak_c_rate, 2)}</td><td class="why">${esc(h.reasons.slice(0, 2).join(' · ') || '—')}</td></tr>`).join('')}
</tbody></table></div></section>

<section class="panel"><div class="ph"><h2>Flight path · planned hour</h2><span class="sub">worst-case scenario vs calm</span></div>${pathMap(plan, worst)}</section>

<section class="panel"><div class="ph"><h2>Drone condition after the run · planned hour</h2><span class="sub">one row per forecast scenario</span></div>
<div class="tw"><table><thead><tr><th>Scenario</th><th>Decision</th><th>Wind / gust</th><th>Battery used %</th><th>Lowest %</th><th>Lands with %</th><th>Peak power W</th><th>Peak current A</th><th>Peak C-rate</th><th>Full-throttle %</th><th>Max tilt °</th><th>Track err m</th><th>Coverage %</th></tr></thead><tbody>
${P.runs.map(r => `<tr><td>${r.member + 1}</td><td>${chip(r.status)}</td><td>${f(r.weather.wind_flight_level_ms)} / ±${f(r.weather.gust_sigma_ms)}</td><td>${f(100 * r.result.energy_used_wh / r.result.energy_wh_per_battery, 0)}</td><td>${f(r.result.min_battery_pct, 0)}</td><td>${f(r.result.end_battery_pct, 0)}</td><td>${f(r.result.peak_power_w, 0)}</td><td>${f(r.peak_current_a, 1)}</td><td>${f(r.peak_c_rate, 2)}</td><td>${f(r.result.saturation_pct, 0)}</td><td>${f(r.result.max_tilt_deg, 0)}</td><td>${f(r.result.track_rms_m, 2)}</td><td>${f(r.result.coverage_pct, 0)}</td></tr>`).join('')}
</tbody></table></div>
<p class="note">Battery used is across all batteries flown. Peak C-rate is peak current ÷ pack capacity. Full-throttle % is survey time spent at maximum airspeed, where the aircraft has no spare authority for gusts. The simulator does not model motor or airframe wear; these are the stress indicators it can measure.</p></section>

<section class="panel"><div class="ph"><h2>How this was worked out</h2><span class="sub">replay any scenario in Flight Lab</span></div>
<dl class="m">
<dt>Simulator</dt><dd>${esc(plan.method.simulator)}; weather inputs: ${esc(plan.method.weather_inputs)}</dd>
<dt>Air density</dt><dd><span class="tag t-D">DERIVED</span>${esc(plan.method.air_density.replace('DERIVED: ', ''))}</dd>
<dt>Cold battery</dt><dd><span class="tag t-A">ASSUMED</span>${esc(plan.method.cold_battery.replace('ASSUMED: ', ''))}</dd>
<dt>Battery needed</dt><dd>${esc(plan.method.battery_needed)}</dd>
<dt>Hour decision</dt><dd>${esc(plan.method.hour_decision)}</dd>
<dt>Visibility</dt><dd><span class="tag t-A">ASSUMED</span>${esc((plan.method.visibility || '').replace('ASSUMED: ', ''))}</dd>
<dt>Limits</dt><dd><span class="tag t-S">SPEC</span>${esc(plan.method.limits)}</dd>
<dt>Replay</dt><dd>In Flight Lab: Aircraft configuration → Load configuration → ${Object.values(plan.replay_configs).map(esc).join(' or ')}</dd>
</dl></section>
<script>
const D=${JSON.stringify(data)};const fig=document.getElementById('bchart'),tip=fig.querySelector('.tip');
fig.querySelectorAll('.hit').forEach(r=>{r.addEventListener('mousemove',e=>{const d=D[+r.dataset.i],b=fig.getBoundingClientRect();
 tip.innerHTML='<b>'+d.t+'</b> · '+({GO:'CLEARED',CAUTION:'CONDITIONAL','NO-GO':'NOT CLEARED'}[d.s])+'<br>'+(d.m===null?'no scenario finished the survey':'battery needed '+d.m.toFixed(0)+' % ('+d.lo.toFixed(0)+'–'+d.hi.toFixed(0)+')<br>flight '+d.d.toFixed(1)+' min')+'<br>wind '+d.w.toFixed(1)+' m/s, gust ±'+d.g.toFixed(1)+' · rain '+d.r.toFixed(1)+' mm/h'+(d.e?'<br>'+d.e+' of '+d.n+' scenarios end in an emergency landing':'');
 tip.hidden=false;let x=e.clientX-b.left+14;if(x>b.width-210)x=e.clientX-b.left-214;tip.style.left=x+'px';tip.style.top=(e.clientY-b.top+10)+'px'});
 r.addEventListener('mouseleave',()=>tip.hidden=true)});
</script></body></html>`;
};
