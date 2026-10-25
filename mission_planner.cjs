#!/usr/bin/env node
/*
 mission_planner.cjs - fly the planned mission in every forecast scenario
 ========================================================================
 Step 2 of the Drone Scout mission planner. Loads the REAL Flight Lab
 simulator (app.js, unchanged) headless and, for every hour of the launch
 window and every forecast scenario from earth2_weather.py:

   1. sets wind, wind direction and gusts from the forecast,
   2. adjusts hover power for air density and battery capacity for temperature,
   3. flies the full survey (takeoff, lanes, captures, return, landing,
      battery swaps if the reserve is reached),
   4. records battery use, flight time, path, tracking error and drone stress,
   5. decides CLEARED / CONDITIONAL / NOT CLEARED and the battery you need.

 It also flies a calm-weather baseline so you can see what the weather costs.

 Usage:
   node mission_planner.cjs --forecast forecast_scenarios.json [options]
     --map field|cherry|rect survey map (default field = FIELDimageR potato trial)
     --size WxH              with --map rect: field size in metres, e.g. 400x300
     --area x,y,W,H          survey rectangle in map metres (default: whole map)
     --base-config file      configuration saved from Flight Lab (your aircraft)
     --batteries N           batteries you will carry (default 2)
     --start-pct P           charge of the first battery, % (default 100)
     --out folder            output folder (default .)

 Outputs:
   mission_plan.json         every run, every metric, per-hour decisions
   mission_plan.html         readable report (open in a browser)
   replay_*.json             Flight Lab configurations to replay a scenario visually
*/
'use strict';
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');

// ------------------------------------------------------------------ arguments
const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
if (!opt.forecast) { console.error('Usage: node mission_planner.cjs --forecast forecast_scenarios.json [--map field|cherry] [--out dir]'); process.exit(1); }
const HERE = __dirname, OUT = path.resolve(opt.out || '.');
const MAPNAME = opt.map || 'field', BATTERIES = +(opt.batteries || 2), START_PCT = +(opt['start-pct'] || 100);
const forecast = JSON.parse(fs.readFileSync(opt.forecast, 'utf8'));
if (forecast.schema !== 'drone-scout-forecast-v1') throw Error('Not a forecast_scenarios.json file');
let base = {};
if (opt['base-config']) { const b = JSON.parse(fs.readFileSync(opt['base-config'], 'utf8')); if (b.schema !== 'drone-scout-config-v1') throw Error('--base-config must be saved from Flight Lab'); base = b.values; }
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ load the real simulator headless
const ctxProxy = new Proxy({}, { get: (_, k) => k === 'measureText' ? () => ({ width: 20 }) : () => {} });
const element = () => ({ style: {}, children: [], classList: { toggle() {}, remove() {}, add() {} }, tHead: {}, tBodies: [{}], getContext: () => ctxProxy, addEventListener() {}, appendChild() {}, setAttribute() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }), querySelector: () => null, querySelectorAll: () => [] });
const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
const context = vm.createContext({ console, Math, Date, JSON, Uint8Array, Float64Array, Buffer, atob: s => Buffer.from(s, 'base64').toString('binary'), window: {}, document: { getElementById: el, createElement: element, querySelectorAll: () => [], querySelector: () => null, addEventListener() {} }, addEventListener() {}, devicePixelRatio: 1, setTimeout() {}, requestAnimationFrame() {} });
const read = f => fs.readFileSync(path.join(HERE, f), 'utf8');
let appSrc = read('app.js'); appSrc = appSrc.slice(0, appSrc.lastIndexOf('(async()=>'));
vm.runInContext(appSrc, context);
vm.runInContext(read('drone_data.js'), context);
const run = s => vm.runInContext(s, context);
run('renderPlan=()=>PLAN=plan();syncCfg=()=>{};draw=()=>{};cards=()=>{};renderTable=()=>{};updateButtons=()=>{};log=()=>{};');

// ------------------------------------------------------------------ maps (same geometry and samplers as Flight Lab)
function decodeGrayPng(b64) {          // 8-bit greyscale, non-interlaced PNG (the cherry NDVI raster)
  const b = Buffer.from(b64, 'base64'), w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  if (b[24] !== 8 || b[25] !== 0 || b[28] !== 0) throw Error('Unexpected PNG format');
  const idat = []; let p = 8;
  while (p < b.length) { const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8); if (type === 'IDAT') idat.push(b.slice(p + 8, p + 8 + len)); p += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)], row = raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1));
    for (let x = 0; x < w; x++) {
      const a = x ? out[y * w + x - 1] : 0, up = y ? out[(y - 1) * w + x] : 0, c = x && y ? out[(y - 1) * w + x - 1] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out[y * w + x] = v & 255;
    }
  }
  return { w, h, q: out };
}
if (MAPNAME === 'field') {
  run(`(()=>{const FI=window.REAL.fieldimager.ex2,b=atob(FI.canopy),can=Uint8Array.from(b,c=>c.charCodeAt(0));
   MAP={name:'FIELDimageR potato trial',W:FI.w*FI.gsd,H:FI.h*FI.gsd,sum:[],valid:()=>1,layer:{},
   sample(x0,y0,x1,y1){let s=0,n=0;for(let j=Math.max(0,Math.floor(y0/FI.cell_m));j<Math.min(FI.gh,Math.ceil(y1/FI.cell_m));j++)for(let i=Math.max(0,Math.floor(x0/FI.cell_m));i<Math.min(FI.gw,Math.ceil(x1/FI.cell_m));i++){s+=can[j*FI.gw+i]/100;n++}
   return{valid:Math.max(0,Math.min(x1,this.W)-Math.max(x0,0))*Math.max(0,Math.min(y1,this.H)-Math.max(y0,0))/((x1-x0)*(y1-y0)),name:'canopy_cover',value:n?s/n:null}}}})()`);
} else if (MAPNAME === 'cherry') {
  vm.runInContext(read('drone_data5.js'), context);
  const R5 = context.window.REAL5, png = decodeGrayPng(R5.nd);
  context.__cherryQ = png.q;
  run(`(()=>{const R=window.REAL5,cw=R.w,ch=R.h,cg=R.gsd,q=__cherryQ;
   MAP={name:'Cherry orchard, Kerasia',W:cw*cg,H:ch*cg,sum:[],layer:{},
   valid:(x,y)=>{const i=Math.floor(x/cg),j=Math.floor(y/cg);return i>=0&&j>=0&&i<cw&&j<ch&&q[j*cw+i]>0?1:0},
   sample(x0,y0,x1,y1){let s=0,n=0,t=0;const a=Math.max(0,Math.floor(x0/cg)),b=Math.min(cw,Math.ceil(x1/cg)),c=Math.max(0,Math.floor(y0/cg)),d=Math.min(ch,Math.ceil(y1/cg));
    for(let j=c;j<d;j+=2)for(let i=a;i<b;i+=2){t++;const v=q[j*cw+i];if(v>0){s+=R.ndlo+v/255*(R.ndhi-R.ndlo);n++}}
    return{valid:t?n/t:0,name:'ndvi',value:n?s/n:null}}}})()`);
} else if (MAPNAME === 'rect') {
  const [W, H] = String(opt.size || '300x200').toLowerCase().split('x').map(Number);
  if (!(W > 5 && H > 5)) throw Error('--size must look like 400x300 (metres)');
  context.__rect = { W, H };
  run(`MAP={name:'Rectangular field '+__rect.W+' x '+__rect.H+' m',W:__rect.W,H:__rect.H,sum:[],layer:{},valid:()=>1,
   sample:(x0,y0,x1,y1)=>({valid:1,name:'no_imagery',value:null})}`);
} else throw Error('--map must be field, cherry or rect');
const AOI = opt.area ? (() => { const [x, y, W, H] = opt.area.split(',').map(Number); return { x, y, W, H }; })() : null;
const mapInfo = JSON.parse(run('JSON.stringify({name:MAP.name,W:MAP.W,H:MAP.H})'));

// ------------------------------------------------------------------ physics adjustments from the forecast
const DEF = JSON.parse(run('JSON.stringify(DEF)'));
const snapTo = (v, lo, hi, st) => Math.min(hi, Math.max(lo, Math.round(v / st) * st));
function scenarioValues(w, seed) {
  const v = { ...DEF, ...base };
  v.wind = w.sim.wind; v.wdir = w.sim.wdir; v.gust = w.sim.gust; v.seed = seed; v.start = START_PCT;
  // Hover (induced) power scales ~ 1/sqrt(air density)  [DERIVED, momentum theory]
  const rho = w.air_density_kgm3 || 1.225;
  v.phov = snapTo((base.phov ?? DEF.phov) * Math.sqrt(1.225 / rho), 50, 500, 5);
  // LiPo capacity falls in the cold: -0.75 %/degC below 20 C, floor 80 %  [ASSUMED]
  const T = w.temperature_c ?? 20, capF = T < 20 ? Math.max(0.8, 1 - 0.0075 * (20 - T)) : 1;
  v.capmAh = snapTo((base.capmAh ?? DEF.capmAh) * capF, 1000, 20000, 10);
  return { values: v, capacity_factor: +capF.toFixed(3) };
}

// in-simulator flight loop: identical step() and DT as the browser app
run(`globalThis.__fly=function(maxB){
 let used=0,peakP=0,sumP=0,n=0,sat=0,flyN=0,maxTilt=0,minSoc=100,bats=1,rthBattery=false,swaps=[];const path=[];
 for(let i=0;i<400000;i++){
  if(!['fly','rth','landing'].includes(S.phase)){
   if(S.phase==='landed'&&S.resume&&bats<maxB){bats++;swaps.push(+S.t.toFixed(0));C.start=100;swapBattery();continue}
   break}
  const E0=S.E;step(DT);used+=Math.max(0,E0-S.E);
  if(S.P>peakP)peakP=S.P;sumP+=S.P;n++;
  if(S.phase==='fly'&&S.z>C.alt*.9){flyN++;if(S.vair>=C.vmax*.98)sat++}
  const tilt=Math.max(Math.abs(S.roll||0),Math.abs(S.pitch||0));if(tilt>maxTilt)maxTilt=tilt;
  const soc=S.E/C.energy*100;if(soc<minSoc)minSoc=soc;
  if(S.phase==='rth'&&S.resume&&!S.emergency)rthBattery=true;
  if(i%25===0)path.push([+S.x.toFixed(1),+S.y.toFixed(1)]);
 }
 return{state:S.phase,emergency:!!S.emergency,duration_s:S.t,energy_used_wh:used,peak_power_w:peakP,mean_power_w:n?sumP/n:0,
  saturation_pct:flyN?100*sat/flyN:0,max_tilt_deg:maxTilt*180/Math.PI,min_battery_pct:minSoc,end_battery_pct:S.E/C.energy*100,
  batteries_used:bats,swap_times_s:swaps,battery_rth:rthBattery,track_rms_m:S.ctn?Math.sqrt(S.ct2/S.ctn):0,
  captures:CAPS.length,coverage_pct:typeof covPct==='function'?covPct():null,planned_photos:PLAN.photos,energy_wh_per_battery:C.energy,path}}`);

function fly(values) {
  context.__vals = values; context.__aoi = AOI;
  run('Object.assign(C,DEF,__vals);AOI=__aoi;normalizeConfig();resetMission();startMission();');
  const r = run('__fly(12)');   // always finish the job; compare with batteries carried afterwards
  const k = Math.ceil(r.path.length / 1200); if (k > 1) r.path = r.path.filter((_, i) => i % k === 0 || i === r.path.length - 1);
  return r;
}

// ------------------------------------------------------------------ decision rules
const P4M = { maxWind: 10, tmin: 0, tmax: 40 };
const VIS_MIN_KM = 4.83;   // FAA 14 CFR 107.51(c): 3 statute miles from the control station
const visOf = w => w.visibility_km ?? Math.min(50, 1 / (1 / (50 * Math.exp(-4.6 * (w.dust_risk_0_1 || 0))) + (w.rain_mm_h > 0.05 ? 1 / (12 * Math.pow(w.rain_mm_h, -0.65)) : 0)));
function judge(w, r, v) {
  const no = [], caution = [];
  const gustPeak = w.wind_flight_level_ms + 2 * w.gust_sigma_ms;
  if (gustPeak > P4M.maxWind) no.push(`gusts to ${gustPeak.toFixed(1)} m/s exceed the ${P4M.maxWind} m/s wind rating`);
  if (w.rain_mm_h > 0.5) no.push(`rain ${w.rain_mm_h.toFixed(1)} mm/h (aircraft not rain-rated)`);
  if (w.temperature_c < P4M.tmin || w.temperature_c > P4M.tmax) no.push(`${w.temperature_c} °C is outside the 0–40 °C operating range`);
  if (r.emergency) no.push('emergency landing in the field: return-home reserve not enough against this wind');
  else if (r.state !== 'done') no.push('survey cannot be finished even with 12 battery swaps');
  else if (r.batteries_used > BATTERIES) no.push(`needs ${r.batteries_used} batteries, you are carrying ${BATTERIES}`);
  else if (r.batteries_used === BATTERIES && BATTERIES > 1) caution.push(`uses all ${BATTERIES} batteries, no spare (swaps at ${r.swap_times_s.map(s => Math.round(s / 60) + ' min').join(', ')})`);
  if (r.state === 'done' && r.end_battery_pct < v.rthres + 5) caution.push(`lands with only ${r.end_battery_pct.toFixed(0)} % left`);
  if (r.saturation_pct > 5) caution.push(`at full airspeed ${r.saturation_pct.toFixed(0)} % of survey time: no margin for gusts`);
  if (r.max_tilt_deg > 30) caution.push(`tilts up to ${r.max_tilt_deg.toFixed(0)}°: under 5° of control margin left (35° limit)`);
  if (r.track_rms_m > 2) caution.push(`track error ${r.track_rms_m.toFixed(1)} m RMS: image overlap at risk`);
  if (r.coverage_pct !== null && r.state === 'done' && r.coverage_pct < 95) caution.push(`coverage ${r.coverage_pct.toFixed(0)} %`);
  const vis = visOf(w);
  if (vis < VIS_MIN_KM) no.push(`visibility ${vis.toFixed(1)} km is below the FAA 3-mile (4.8 km) minimum${w.dust_risk_0_1 > 0.3 ? ': blowing dust' : w.rain_mm_h > 0.5 ? ': rain' : ''}`);
  else if (vis < 8) caution.push(`hazy, visibility ${vis.toFixed(1)} km: keep the drone in sight, images lose contrast`);
  if (w.dust_risk_0_1 > 0.5 && vis >= VIS_MIN_KM) caution.push('dust: grit in motors, hazy images');
  if (w.temperature_c < 10) caution.push('cold: keep batteries warm before launch');
  return { status: no.length ? 'NO-GO' : caution.length ? 'CAUTION' : 'GO', reasons: [...no, ...caution] };
}
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };

// ------------------------------------------------------------------ calm baseline
const calmW = { sim: { wind: 0, wdir: 0, gust: 0 }, air_density_kgm3: 1.225, temperature_c: 20, wind_flight_level_ms: 0, gust_sigma_ms: 0, rain_mm_h: 0, dust_risk_0_1: 0 };
const calmS = scenarioValues(calmW, (base.seed ?? DEF.seed));
const calm = fly(calmS.values);
const calmNeeded = 100 * calm.energy_used_wh / calm.energy_wh_per_battery + calmS.values.rthres;
console.log(`Map: ${mapInfo.name} (${mapInfo.W.toFixed(0)} x ${mapInfo.H.toFixed(0)} m). Calm baseline: ${(calm.duration_s / 60).toFixed(1)} min, ${calm.energy_used_wh.toFixed(1)} Wh, needs ${calmNeeded.toFixed(0)} % of a battery.`);

// ------------------------------------------------------------------ every hour x every scenario
const hours = forecast.hours.map((h, hi) => {
  const runs = h.members.map((w, m) => {
    const s = scenarioValues(w, (base.seed ?? DEF.seed) + m + 1);
    const r = fly(s.values);
    // battery needed only means something for a survey that actually finished
    const needed = r.state === 'done' ? 100 * r.energy_used_wh / r.energy_wh_per_battery + s.values.rthres : null;
    const j = judge(w, r, s.values);
    const peakA = r.peak_power_w / s.values.vnom;
    return { member: m, weather: w, sim_values: { wind: s.values.wind, wdir: s.values.wdir, gust: s.values.gust, phov: s.values.phov, capmAh: s.values.capmAh },
      capacity_factor: s.capacity_factor, result: { ...r, path: hi === 0 || m === 0 ? r.path : undefined },
      battery_needed_pct: needed, extra_energy_vs_calm_pct: needed === null ? null : 100 * (r.energy_used_wh / calm.energy_used_wh - 1),
      peak_current_a: peakA, peak_c_rate: peakA / (s.values.capmAh / 1000), ...j, _values: s.values };
  });
  const nNo = runs.filter(r => r.status === 'NO-GO').length, nCa = runs.filter(r => r.status === 'CAUTION').length;
  const status = nNo / runs.length >= 0.5 ? 'NO-GO' : (nNo > 0 || nCa / runs.length >= 0.5) ? 'CAUTION' : 'GO';
  const reasonCount = {};
  runs.forEach(r => r.reasons.forEach(x => { const key = x.replace(/[\d.]+/g, '#'); (reasonCount[key] ||= { text: x, n: 0 }).n++; }));
  const ok = runs.filter(r => r.battery_needed_pct !== null), need = ok.map(r => r.battery_needed_pct), dur = ok.map(r => r.result.duration_s / 60);
  return { valid_local: h.valid_local, valid_utc: h.valid_utc, status, scenarios: runs.length, nogo: nNo, caution: nCa,
    emergencies: runs.filter(r => r.result.emergency).length, completed: ok.length,
    reasons: Object.values(reasonCount).sort((a, b) => b.n - a.n).map(r => `${r.text}${runs.length > 1 ? ` (${r.n}/${runs.length} scenarios)` : ''}`),
    battery_needed_pct: { p10: pct(need, .1), median: pct(need, .5), p90: pct(need, .9) },
    flight_min: { median: pct(dur, .5), max: dur.length ? Math.max(...dur) : null },
    extra_energy_vs_calm_pct: pct(ok.map(r => r.extra_energy_vs_calm_pct), .5),
    batteries_needed: ok.length ? Math.max(...ok.map(r => r.result.batteries_used)) : null,
    wind_ms: pct(runs.map(r => r.weather.wind_flight_level_ms), .5), gust_ms: pct(runs.map(r => r.weather.gust_sigma_ms), .5),
    rain_max_mm_h: Math.max(...runs.map(r => r.weather.rain_mm_h)), temp_c: pct(runs.map(r => r.weather.temperature_c), .5),
    dust: pct(runs.map(r => r.weather.dust_risk_0_1), .5), vis_km: Math.min(...runs.map(r => visOf(r.weather))),
    track_rms_m: pct(runs.map(r => r.result.track_rms_m), .9), max_tilt_deg: Math.max(...runs.map(r => r.result.max_tilt_deg)),
    peak_c_rate: Math.max(...runs.map(r => r.peak_c_rate)), saturation_pct: Math.max(...runs.map(r => r.result.saturation_pct)),
    runs };
});

// ------------------------------------------------------------------ recommendation
const rank = { GO: 0, CAUTION: 1, 'NO-GO': 2 }, LBL = { GO: 'CLEARED', CAUTION: 'CONDITIONAL', 'NO-GO': 'NOT CLEARED' };
const planned = hours[0];
const p90 = h => h.battery_needed_pct.p90 ?? 1e9;
const best = [...hours].sort((a, b) => rank[a.status] - rank[b.status] || p90(a) - p90(b))[0];
const recommendation = best.status === 'NO-GO'
  ? 'No launch hour in this window is cleared. Pick another day.'
  : best === planned ? `Fly as planned at ${planned.valid_local}.` : `Move the launch to ${best.valid_local} (${LBL[best.status]}).`;

// ------------------------------------------------------------------ replay configs for Flight Lab
const writeReplay = (name, run_) => { fs.writeFileSync(path.join(OUT, name), JSON.stringify({ schema: 'drone-scout-config-v1', profile: `Mission planner replay: ${run_.weather ? 'forecast scenario ' + (run_.member + 1) : 'calm'}`, source: 'https://ag.dji.com/p4-multispectral/specs', values: run_._values }, null, 2)); return name; };
const sev = r => (r.result.emergency ? 1e6 : 0) + (r.battery_needed_pct ?? 5e5);
const worstPlanned = [...planned.runs].sort((a, b) => sev(b) - sev(a))[0];
const replays = { planned_worst: writeReplay('replay_planned_worst.json', worstPlanned) };
if (best !== planned && best.status !== 'NO-GO') replays.recommended_median = writeReplay('replay_recommended.json', [...best.runs].sort((a, b) => sev(a) - sev(b))[Math.floor(best.runs.length / 2)]);

// ------------------------------------------------------------------ outputs
const plan = { schema: 'drone-scout-mission-plan-v1', generated: new Date().toISOString(),
  field: forecast.field, forecast_source: forecast.source, forecast_init_utc: forecast.init_utc,
  map: { ...mapInfo, survey_area: AOI }, batteries_available: BATTERIES, first_battery_start_pct: START_PCT,
  calm_baseline: { duration_min: calm.duration_s / 60, energy_wh: calm.energy_used_wh, battery_needed_pct: calmNeeded, path: calm.path },
  planned_hour: planned.valid_local, decision: planned.status, recommendation, recommended_hour: best.valid_local, replay_configs: replays,
  method: {
    simulator: 'Flight Lab app.js step() run headless, unchanged, DT 0.1 s',
    weather_inputs: 'wind, wind direction, gust sigma per forecast scenario',
    air_density: 'DERIVED: hover power x sqrt(1.225/rho)', cold_battery: 'ASSUMED: capacity -0.75 %/degC below 20 C, floor 80 %',
    battery_needed: 'energy used / battery energy + return-home reserve (rthres)',
    hour_decision: 'NOT CLEARED if >= half the scenarios are NOT CLEARED; CONDITIONAL if any NOT CLEARED or >= half CONDITIONAL; else CLEARED',
    limits: 'DJI P4 Multispectral: 10 m/s wind, 0-40 C, not rain-rated; FAA 14 CFR 107.51(c): visibility at least 3 statute miles (4.8 km)',
    visibility: 'ASSUMED: dust + rain light extinction (dust risk 0.5 ~ 5 km, rain 7 mm/h ~ 3.5 km)' },
  hours: hours.map(h => ({ ...h, runs: h.runs.map(({ _values, ...r }) => r) })) };
fs.writeFileSync(path.join(OUT, 'mission_plan.json'), JSON.stringify(plan, null, 2));
fs.writeFileSync(path.join(OUT, 'mission_plan.html'), require('./mission_report.cjs')(plan));

console.log(`\n${'launch (local)'.padEnd(18)}${'status'.padEnd(12)}${'wind'.padStart(6)}${'gust'.padStart(6)}${'rain'.padStart(6)}${'vis'.padStart(6)}${'battery needed'.padStart(18)}${'flight'.padStart(8)}`);
for (const h of hours) console.log(`${h.valid_local.padEnd(18)}${LBL[h.status].padEnd(12)}${h.wind_ms.toFixed(1).padStart(6)}${h.gust_ms.toFixed(1).padStart(6)}${h.rain_max_mm_h.toFixed(1).padStart(6)}${h.vis_km.toFixed(1).padStart(6)}${(h.completed ? h.battery_needed_pct.median.toFixed(0) + ' % (≤' + h.battery_needed_pct.p90.toFixed(0) + ')' : 'no run finished').padStart(18)}${(h.completed ? h.flight_min.median.toFixed(1) + 'm' : '–').padStart(8)}${h.emergencies ? '  ' + h.emergencies + ' emergency landing' + (h.emergencies > 1 ? 's' : '') : ''}`);
console.log(`\nPlanned ${planned.valid_local}: ${LBL[planned.status]}${planned.reasons.length ? ' — ' + planned.reasons.slice(0, 3).join('; ') : ''}`);
console.log(`Recommendation: ${recommendation}`);
console.log(`Wrote mission_plan.json, mission_plan.html, ${Object.values(replays).join(', ')} to ${OUT}`);
