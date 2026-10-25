// Physics checks for physics6dof.js - compares the simulator with hand-derivable answers.
const assert = require('node:assert/strict'), path = require('node:path');
const P = require(path.join(__dirname, '..', 'physics6dof.js'));
const C = { mass: 1.487, phov: 165, pload: 12, kv: 0.004, eta: 0.85, capmAh: 5870, vnom: 15.2, vmax: 14, vup: 6, vdown: 3,
  acc: 3, dec: 3, vtr: 8, start: 100, rthres: 15, crit: 10, gnss: 0.75, gtau: 15, kp: 0.8, ki: 0.05, alt: 30 };
C.energy = C.capmAh * C.vnom / 1000;
const g = 9.81, A = P.AIRFRAME, hoverRoute = alt => [{ x: 0, y: 0, z: 0, type: 'home' }, { x: 0, y: 0, z: alt, type: 'takeoff' }];
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); assert.ok(ok, name + ': ' + detail); };
const tail = (tr, s) => tr.filter(r => r.t >= tr[tr.length - 1].t - s);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

// 1. Hover equilibrium: each motor carries m g / 4, attitude level, hover power = Flight Lab hover power
{ const sim = P.create({ C, route: hoverRoute(10), wind: { speed: 0 }, gnssNoise: false, turbulence: false });
  sim.run(Infinity, 25); const r = tail(sim.trace, 5);
  const Tm = mean(r.map(x => mean(x.T))), want = C.mass * g / 4;
  check('hover thrust per motor = m g / 4', Math.abs(Tm - want) / want < 0.005, `${Tm.toFixed(3)} N vs ${want.toFixed(3)} N`);
  check('hover altitude held', Math.abs(mean(r.map(x => x.z)) - 10) < 0.05, `${mean(r.map(x => x.z)).toFixed(3)} m`);
  check('hover level attitude', Math.max(...r.map(x => x.tilt)) < 0.05, `max tilt ${Math.max(...r.map(x => x.tilt)).toFixed(4)} deg`);
  const Pw = mean(r.map(x => x.power));
  check('hover power = phov + payload (Flight Lab)', Math.abs(Pw - (C.phov + C.pload)) < 1.0, `${Pw.toFixed(2)} W vs ${C.phov + C.pload} W`); }

// 2. Steady wind: tilt angle must satisfy tan(theta) = Drag / (m g), drag evaluated at the wind speed
{ const Wd = 8, sim = P.create({ C, route: hoverRoute(30), wind: { speed: Wd, fromDeg: 270 }, gnssNoise: false, turbulence: false });
  sim.run(Infinity, 60); const r = tail(sim.trace, 10), tilt = mean(r.map(x => x.tilt));
  let th = 0; for (let i = 0; i < 50; i++) { const Tsum = C.mass * g / Math.cos(th); const D = A.rotor_drag.v * Tsum / (C.mass * g) * Wd + 0.5 * 1.225 * A.body_CdA.v * Wd * Wd; th = Math.atan(D / (C.mass * g)); }
  check('steady-wind tilt matches tan(theta) = D / (m g)', Math.abs(tilt - th * 180 / Math.PI) < 0.3, `${tilt.toFixed(2)} deg vs analytic ${(th * 180 / Math.PI).toFixed(2)} deg`);
  const drift = Math.max(...r.map(x => Math.hypot(x.x, x.y)));
  check('position held against 8 m/s wind (integral action)', drift < 0.3, `max offset ${drift.toFixed(3)} m`);
  const lean = mean(r.map(x => x.vx)), dir = r[0].wx;
  check('wind blows toward +x (from 270 deg = map left)', dir > 7.9, `wind x ${dir.toFixed(2)} m/s`); }

// 3. Air density: induced power scales with 1/sqrt(rho)
{ const pw = rho => { const s = P.create({ C, route: hoverRoute(10), rho, gnssNoise: false, turbulence: false }); s.run(Infinity, 20); return mean(tail(s.trace, 4).map(x => x.power)) - C.pload; };
  const ratio = pw(1.05) / pw(1.225), want = Math.sqrt(1.225 / 1.05);
  check('hover power ~ 1/sqrt(air density)', Math.abs(ratio - want) < 0.002, `ratio ${ratio.toFixed(4)} vs ${want.toFixed(4)}`); }

// 4. Turbulence: stronger gusts -> more attitude activity and more position error
{ const act = sig => { const s = P.create({ C, route: hoverRoute(30), wind: { speed: 5, fromDeg: 0, gustSigma: sig }, gnssNoise: false, seed: 3 }); s.run(Infinity, 90); const r = tail(s.trace, 60), mr = mean(r.map(x => x.roll)), mp = mean(r.map(x => x.pitch));
  return { att: Math.sqrt(mean(r.map(x => (x.roll - mr) ** 2 + (x.pitch - mp) ** 2))), pos: Math.sqrt(mean(r.map(x => x.x ** 2 + x.y ** 2))) }; };
  const lo = act(0.3), hi = act(2.0);
  check('gusts increase attitude activity', hi.att > 2 * lo.att, `rms ${lo.att.toFixed(2)} -> ${hi.att.toFixed(2)} deg`);
  check('gusts increase position error', hi.pos > lo.pos, `rms ${lo.pos.toFixed(2)} -> ${hi.pos.toFixed(2)} m`); }

// 5. Full survey route: completes, lands at home, tracks lanes
{ const wps = []; for (let i = 0; i < 4; i++) { const x = 10 + i * 8; wps.push({ x, y: i % 2 ? 80 : 10, type: 'lane0' }, { x, y: i % 2 ? 10 : 80, type: 'lane' }); }
  const route = P.routeFromPlan(wps, { x: -5, y: -5 }, 30);
  const calm = P.create({ C, route, laneSpeed: 5, wind: { speed: 0 }, seed: 1 }); calm.run(Infinity, 1200);
  const sc = calm.summary(), end = calm.trace[calm.trace.length - 1];
  check('survey completes and lands', sc.completed, `state done=${calm.state.done}, ${sc.duration_s.toFixed(0)} s`);
  check('lands at home', Math.hypot(end.x + 5, end.y + 5) < 2, `${Math.hypot(end.x + 5, end.y + 5).toFixed(2)} m from home`);
  check('calm lane tracking error small', sc.track_rms_m < 1.0, `${sc.track_rms_m.toFixed(2)} m RMS (GNSS noise 0.75 m)`);
  const windy = P.create({ C, route: P.routeFromPlan(wps, { x: -5, y: -5 }, 30), laneSpeed: 5, wind: { speed: 9, fromDeg: 270, gustSigma: 1.8 }, seed: 1 }); windy.run(Infinity, 1200);
  const sw = windy.summary();
  check('wind costs energy', sw.energy_wh > sc.energy_wh * 1.03, `${sc.energy_wh.toFixed(2)} -> ${sw.energy_wh.toFixed(2)} Wh`);
  check('wind increases tilt', sw.max_tilt_deg > sc.max_tilt_deg + 3, `${sc.max_tilt_deg.toFixed(1)} -> ${sw.max_tilt_deg.toFixed(1)} deg`);
  check('motors stay within limits', sw.max_motor_n <= sw.motor_limit_n + 1e-9, `${sw.max_motor_n.toFixed(2)} of ${sw.motor_limit_n.toFixed(2)} N`);
  results.push({ name: 'info: calm vs windy survey', ok: true, detail: `${(sc.duration_s / 60).toFixed(2)} vs ${(sw.duration_s / 60).toFixed(2)} min, ${sc.energy_wh.toFixed(1)} vs ${sw.energy_wh.toFixed(1)} Wh, track ${sc.track_rms_m.toFixed(2)} vs ${sw.track_rms_m.toFixed(2)} m` }); }

console.table(results.map(r => ({ check: r.name, result: r.ok ? 'PASS' : 'FAIL', detail: r.detail })));
console.log('ALL PHYSICS CHECKS PASS');
