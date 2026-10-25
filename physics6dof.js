/* physics6dof.js - 6-degree-of-freedom quadcopter physics for Drone Scout
   =======================================================================
   A rigid-body quadcopter (DJI P4 Multispectral reference) flying the same survey
   route as Flight Lab, integrated with 4th-order Runge-Kutta at 500 Hz.

   State (13 + 4):  position p, velocity v (world), attitude quaternion q (body->world),
                    body rates w, and the thrust of each of the 4 motors.
   Equations:       p' = v
                    v' = ( R(q) [0,0,sum T_i] + F_drag(v - wind) ) / m - g z
                    q' = 1/2 q (x) [0, w]
                    w' = J^-1 ( tau - w x J w )
                    T_i' = (T_cmd,i - T_i) / tau_motor            (motor spin-up lag)
   Disturbances:    mean wind from the forecast + Dryden low-altitude turbulence
                    (MIL-HDBK-1797 length scales and intensities), GNSS position noise.
   Flight control:  cascaded - route guidance -> velocity PI -> thrust vector ->
                    geometric attitude control on SO(3) (Lee et al., 2010) -> motor mixer.
   Power:           momentum theory per rotor, P_i ~ T_i^1.5 / sqrt(2 rho A), scaled so that
                    hover matches Flight Lab's hover power at sea level (so air density matters).

   Frames: world X = map right, Y = map up (-map y), Z = up. Body: x forward, y left, z up.
   Works in the browser (window.Physics6DOF) and in Node (module.exports).
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Physics6DOF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const G = 9.81, D2R = Math.PI / 180;

// ---------------------------------------------------------------- airframe parameters
// tag: SPEC = DJI P4 Multispectral spec, DERIVED = computed from spec, ASSUMED = modelling choice
const AIRFRAME = {
  arm_m:        { v: 0.175,  tag: 'DERIVED', note: 'half of the 350 mm motor-to-motor diagonal' },
  inertia:      { v: [0.0115, 0.0115, 0.0210], tag: 'ASSUMED', note: 'kg m^2, typical for a 1.4 kg / 350 mm quad' },
  prop_radius:  { v: 0.1194, tag: 'DERIVED', note: '9.4-inch propellers' },
  thrust_to_weight: { v: 2.0, tag: 'ASSUMED', note: 'max thrust of all motors / weight' },
  motor_tau_s:  { v: 0.035,  tag: 'ASSUMED', note: 'motor + propeller spin-up time constant' },
  yaw_moment_m: { v: 0.016,  tag: 'ASSUMED', note: 'propeller drag torque per newton of thrust' },
  rotor_drag:   { v: 0.20,   tag: 'ASSUMED', note: 'N per m/s of airspeed (blade flapping / induced drag)' },
  body_CdA:     { v: 0.050,  tag: 'ASSUMED', note: 'm^2; with rotor drag needs ~31 deg tilt at 14 m/s' },
  max_tilt_deg: { v: 35,     tag: 'ASSUMED', note: 'flight controller tilt limit' },
};

// ---------------------------------------------------------------- small vector / quaternion helpers
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(a[0], a[1], a[2]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
const qnorm = q => { const n = Math.hypot(q[0], q[1], q[2], q[3]); return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; };
function qToR(q) { // rotation matrix rows, body -> world
  const [w, x, y, z] = q;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
          [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
          [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
}
const Rv = (R, v) => [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2], R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2], R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]];
const RTv = (R, v) => [R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2], R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2], R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2]];
const col = (R, j) => [R[0][j], R[1][j], R[2][j]];
function eulerZYX(R) { // roll, pitch, yaw (rad), aerospace convention
  return [Math.atan2(R[2][1], R[2][2]), Math.asin(clamp(-R[2][0], -1, 1)), Math.atan2(R[1][0], R[0][0])];
}
function inv4(m) { // 4x4 inverse by Gauss-Jordan
  const a = m.map((r, i) => [...r, ...[0, 1, 2, 3].map(j => (i === j ? 1 : 0))]);
  for (let c = 0; c < 4; c++) {
    let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]]; const d = a[c][c];
    for (let j = 0; j < 8; j++) a[c][j] /= d;
    for (let r = 0; r < 4; r++) if (r !== c) { const f = a[r][c]; for (let j = 0; j < 8; j++) a[r][j] -= f * a[c][j]; }
  }
  return a.map(r => r.slice(4));
}
function rng(seed) {
  let s = seed >>> 0 || 1;
  const u = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => { let a = 0; while (!a) a = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()); };
}

// ---------------------------------------------------------------- simulator
/*
 cfg = {
   C:      Flight Lab configuration values (mass, phov, pload, kv, eta, capmAh, vnom, vmax, vup, vdown,
           acc, dec, vtr, start, rthres, crit, gnss, gtau ...)
   route:  [{x, y, z, type}]  map metres (x right, y down), z up; first point = home on the ground
   laneSpeed: survey speed on 'lane' segments (Flight Lab PLAN.vs)
   wind:   { speed, fromDeg, gustSigma }  speed at flight level (m/s), direction FROM relative to map-up,
           gustSigma = forecast 1-sigma gust (m/s); speed 0 and gustSigma 0 = calm
   rho:    air density kg/m^3 (default 1.225)
   seed, dt (s, default 0.002), logEvery (s, default 0.05), gnssNoise (default true), turbulence (default true)
 }
*/
function create(cfg) {
  const C = cfg.C, dt = cfg.dt || 0.002, logEvery = cfg.logEvery || 0.05, rho = cfg.rho || 1.225;
  const m = C.mass, J = AIRFRAME.inertia.v, l = AIRFRAME.arm_m.v, A = Math.PI * AIRFRAME.prop_radius.v ** 2;
  const Tmax = AIRFRAME.thrust_to_weight.v * m * G / 4, tauM = AIRFRAME.motor_tau_s.v, kq = AIRFRAME.yaw_moment_m.v;
  const kRot = AIRFRAME.rotor_drag.v, CdA = AIRFRAME.body_CdA.v, tanTilt = Math.tan(AIRFRAME.max_tilt_deg.v * D2R);
  // motors in X layout: angle, spin direction (+1 = CCW reaction torque +z)
  const MOT = [[45, -1], [135, 1], [225, -1], [315, 1]].map(([a, s]) => ({ r: [l * Math.cos(a * D2R), l * Math.sin(a * D2R), 0], s }));
  // wrench = M * thrusts ; [T, tau_x, tau_y, tau_z]
  const M = [[1, 1, 1, 1], MOT.map(o => o.r[1]), MOT.map(o => -o.r[0]), MOT.map(o => o.s * kq)];
  const Minv = inv4(M);
  // power scale: hover at sea level = Flight Lab hover power (C.phov)
  const Th = m * G / 4, kP = C.phov / (4 * Th ** 1.5 / Math.sqrt(2 * 1.225 * A));
  const E0 = C.energy ?? C.capmAh * C.vnom / 1000;

  // world-frame helpers (map <-> world)
  const W = p => [p.x, -p.y, p.z ?? 0];
  const route = cfg.route.map(p => ({ ...p, w: W(p) }));
  const home = route[0].w;

  // wind (world frame). fromDeg is relative to map-up, clockwise; blows TOWARD fromDeg+180
  const ws = cfg.wind?.speed || 0, toDir = ((cfg.wind?.fromDeg || 0) + 180) * D2R;
  const meanWind = [Math.sin(toDir) * ws, Math.cos(toDir) * ws, 0];
  const turbOn = cfg.turbulence !== false && (ws > 0 || (cfg.wind?.gustSigma || 0) > 0);
  const randn = rng(cfg.seed || 7), randnG = rng((cfg.seed || 7) + 101);   // separate streams: same GNSS noise with or without wind

  // Dryden low-altitude model (MIL-HDBK-1797), h in feet
  function dryden(hm) {
    const h = Math.max(3.05, hm) / 0.3048, W20 = ws * Math.pow(6.1 / Math.max(hm, 6.1), 0.14) / 0.3048; // ft/s
    const sw = 0.1 * W20, su = sw / Math.pow(0.177 + 0.000823 * h, 0.4);
    const Lu = h / Math.pow(0.177 + 0.000823 * h, 1.2), Lw = h;
    const sH = Math.max(su * 0.3048, cfg.wind?.gustSigma || 0);   // forecast gust sigma is a floor
    return { sH, sW: sw * 0.3048, Lu: Lu * 0.3048, Lw: Lw * 0.3048 };
  }

  // ---------------- state
  const S = { t: 0, p: [...home], v: [0, 0, 0], q: [1, 0, 0, 0], w: [0, 0, 0], T: [0, 0, 0, 0],
    gust: [0, 0, 0], gn: [0, 0], vi: [0, 0, 0], seg: 1, phase: 'takeoff', landed: false, done: false,
    E: E0 * (C.start ?? 100) / 100, used: 0, emergency: false, rthReserve: false, yawD: 0, onGround: true,
    lastLog: -1, maxTilt: 0, peakP: 0, crossSq: 0, crossN: 0, satT: 0, airT: 0 };
  // initial heading toward the first route leg
  if (route.length > 2) { const d = sub(route[2].w, route[1].w); S.yawD = Math.atan2(d[1], d[0]); S.q = [Math.cos(S.yawD / 2), 0, 0, Math.sin(S.yawD / 2)]; }
  const trace = [];

  // ---------------- guidance + control (evaluated once per step, held during RK4)
  function control() {
    const R = qToR(S.q), b3 = col(R, 2);
    const meas = [S.p[0] + S.gn[0], S.p[1] + S.gn[1], S.p[2]];        // GNSS-noisy position
    const tgt = route[S.seg], prev = route[S.seg - 1];
    const vlim = Math.min(C.vmax, tgt.type === 'lane' ? cfg.laneSpeed || C.vtr : C.vtr);
    let vdes = [0, 0, 0], xt = 0, along = 0, dist = 0;
    const hz = [tgt.w[0] - prev.w[0], tgt.w[1] - prev.w[1]], L = Math.hypot(hz[0], hz[1]);
    if (L > 1 && tgt.type !== 'takeoff' && tgt.type !== 'land') {
      const u = [hz[0] / L, hz[1] / L], n = [-u[1], u[0]];
      along = (tgt.w[0] - meas[0]) * u[0] + (tgt.w[1] - meas[1]) * u[1];
      xt = (meas[0] - prev.w[0]) * n[0] + (meas[1] - prev.w[1]) * n[1];
      dist = Math.hypot(tgt.w[0] - meas[0], tgt.w[1] - meas[1]);
      const spd = Math.min(vlim, Math.sqrt(2 * C.dec * Math.max(0, along)), Math.max(0.3, dist));
      S.vi[2] = clamp(S.vi[2] + xt * dt, -8, 8);
      const corr = clamp(-(C.kp ?? 0.8) * xt - (C.ki ?? 0.05) * S.vi[2], -3, 3);
      vdes = [u[0] * spd + n[0] * corr, u[1] * spd + n[1] * corr, 0];
      if (along < 0) vdes = [clamp((tgt.w[0] - meas[0]) * 0.8, -2, 2), clamp((tgt.w[1] - meas[1]) * 0.8, -2, 2), 0];
      S.yawD = Math.atan2(u[1], u[0]);
      if (tgt.type === 'lane') { S.crossSq += xt * xt; S.crossN++; }
    } else {
      dist = Math.hypot(tgt.w[0] - meas[0], tgt.w[1] - meas[1]);
      vdes = [clamp((tgt.w[0] - meas[0]) * 0.8, -2, 2), clamp((tgt.w[1] - meas[1]) * 0.8, -2, 2), 0];
    }
    vdes[2] = tgt.type === 'land' ? -Math.min(C.vdown, Math.max(0.25, S.p[2] * 0.65)) : clamp((tgt.w[2] - S.p[2]) * 1.2, -C.vdown, C.vup);
    // waypoint switching (same rule as Flight Lab)
    if (tgt.type !== 'land' && Math.abs(S.p[2] - tgt.w[2]) < 0.6 && (dist < 1 || (L > 1 && along < 0.25 && Math.abs(xt) < 2))) {
      if (S.seg < route.length - 1) { S.seg++; S.vi[2] = 0; }
    }
    // velocity loop -> desired acceleration (PI; integral learns the wind)
    const ev = sub(vdes, S.v);
    // manoeuvre acceleration limited like Flight Lab (C.acc); the integral term (wind) gets the rest
    let ac = [2.2 * ev[0], 2.2 * ev[1]]; const acn = Math.hypot(ac[0], ac[1]), alim = C.acc || 3;
    if (acn > alim) { ac = [ac[0] * alim / acn, ac[1] * alim / acn]; }
    // anti-windup: learn the wind only while the controller is not at its limit
    else for (let k = 0; k < 2; k++) S.vi[k] = clamp(S.vi[k] + ev[k] * dt, -8, 8);
    let a = [ac[0] + 0.9 * S.vi[0], ac[1] + 0.9 * S.vi[1], clamp(3.0 * ev[2], -0.3 * G, 0.5 * G)];   // vertical accel limits keep thrust (and tilt authority) sensible
    const ah = Math.hypot(a[0], a[1]), amax = G * tanTilt;
    if (ah > amax) { a[0] *= amax / ah; a[1] *= amax / ah; }
    // thrust vector and desired attitude
    let f = [m * a[0], m * a[1], m * (a[2] + G)];
    f[2] = Math.max(f[2], 0.25 * m * G);
    const fh = Math.hypot(f[0], f[1]);
    if (fh > f[2] * tanTilt) { f[0] *= f[2] * tanTilt / fh; f[1] *= f[2] * tanTilt / fh; }
    const Tc = Math.max(0, dot(f, b3));
    const b3d = mul(f, 1 / norm(f)), xc = [Math.cos(S.yawD), Math.sin(S.yawD), 0];
    let b2d = cross(b3d, xc); b2d = mul(b2d, 1 / norm(b2d)); const b1d = cross(b2d, b3d);
    const Rd = [[b1d[0], b2d[0], b3d[0]], [b1d[1], b2d[1], b3d[1]], [b1d[2], b2d[2], b3d[2]]];
    // geometric attitude error e_R = 1/2 vee(Rd^T R - R^T Rd)
    const RdT_R = [0, 1, 2].map(i => [0, 1, 2].map(j => Rd[0][i] * R[0][j] + Rd[1][i] * R[1][j] + Rd[2][i] * R[2][j]));
    const eR = [0.5 * (RdT_R[2][1] - RdT_R[1][2]), 0.5 * (RdT_R[0][2] - RdT_R[2][0]), 0.5 * (RdT_R[1][0] - RdT_R[0][1])];
    const kR = [64, 64, 16], kW = [14, 14, 7];
    const Jw = [J[0] * S.w[0], J[1] * S.w[1], J[2] * S.w[2]], gyro = cross(S.w, Jw);
    const tau = [0, 1, 2].map(i => J[i] * (-kR[i] * eR[i] - kW[i] * S.w[i]) + gyro[i]);
    // mixer: thrusts that produce [Tc, tau]
    const wrench = [Tc, ...tau];
    const Tcmd = Minv.map(r => clamp(r[0] * wrench[0] + r[1] * wrench[1] + r[2] * wrench[2] + r[3] * wrench[3], 0, Tmax));
    return { Tcmd, cross: xt, vdes, tgt };
  }

  // ---------------- rigid-body derivatives
  function deriv(st, Tcmd, wind) {
    const R = qToR(st.q), Tsum = st.T[0] + st.T[1] + st.T[2] + st.T[3];
    const vrel = sub(st.v, wind), sp = norm(vrel);
    const drag = add(mul(vrel, -kRot * Tsum / (m * G)), mul(vrel, -0.5 * rho * CdA * sp));
    const acc = add(mul(add(Rv(R, [0, 0, Tsum]), drag), 1 / m), [0, 0, -G]);
    const tau = [0, 0, 0];
    MOT.forEach((o, i) => { const tq = cross(o.r, [0, 0, st.T[i]]); tau[0] += tq[0]; tau[1] += tq[1]; tau[2] += tq[2] + o.s * kq * st.T[i]; });
    const Jw = [J[0] * st.w[0], J[1] * st.w[1], J[2] * st.w[2]], gyro = cross(st.w, Jw);
    const dw = [0, 1, 2].map(i => (tau[i] - gyro[i]) / J[i]);
    const dq = qmul(st.q, [0, ...st.w]).map(x => 0.5 * x);
    const dT = st.T.map((T, i) => (Tcmd[i] - T) / tauM);
    return { p: st.v, v: acc, q: dq, w: dw, T: dT };
  }
  const axpy = (st, d, h) => ({ p: add(st.p, mul(d.p, h)), v: add(st.v, mul(d.v, h)), q: st.q.map((x, i) => x + d.q[i] * h),
    w: add(st.w, mul(d.w, h)), T: st.T.map((x, i) => x + d.T[i] * h) });

  function log(R, P, cross, wind) {
    const [roll, pitch, yaw] = eulerZYX(R), b3 = col(R, 2), fwd = [Math.cos(S.yawD), Math.sin(S.yawD), 0], rgt = [Math.sin(S.yawD), -Math.cos(S.yawD), 0];
    const tilt = Math.acos(clamp(b3[2], -1, 1));
    trace.push({ t: +S.t.toFixed(3), x: S.p[0], y: -S.p[1], z: S.p[2], vx: S.v[0], vy: -S.v[1], vz: S.v[2],
      roll: roll / D2R, pitch: pitch / D2R, yaw: yaw / D2R, heading: ((90 - yaw / D2R) % 360 + 360) % 360, tilt: tilt / D2R,
      // display angles for Flight Lab's aircraft view: lean toward travel / to the right
      dispPitch: Math.atan2(dot(b3, fwd), b3[2]), dispRoll: Math.atan2(dot(b3, rgt), b3[2]), dispYaw: Math.PI / 2 - yaw,
      p: S.w[0] / D2R, q: S.w[1] / D2R, r: S.w[2] / D2R, T: [...S.T], power: P,
      battery: 100 * S.E / E0, energy_wh: S.used, wx: wind[0], wy: -wind[1], wz: wind[2],
      airspeed: norm(sub(S.v, wind)), groundspeed: Math.hypot(S.v[0], S.v[1]), cross, seg: S.seg, phase: S.phase });
  }

  // ---------------- one integration step
  function step() {
    // disturbances (held constant over the step)
    if (turbOn) {
      const d = dryden(S.p[2]), V = Math.max(2, norm(sub(S.v, meanWind)));
      const ah = Math.exp(-dt * V / d.Lu), aw = Math.exp(-dt * V / d.Lw);
      S.gust[0] = S.gust[0] * ah + d.sH * Math.sqrt(1 - ah * ah) * randn();
      S.gust[1] = S.gust[1] * ah + d.sH * Math.sqrt(1 - ah * ah) * randn();
      S.gust[2] = S.gust[2] * aw + d.sW * Math.sqrt(1 - aw * aw) * randn();
    }
    if (cfg.gnssNoise !== false && C.gnss > 0) {
      const an = Math.exp(-dt / (C.gtau || 15)), sn = C.gnss * Math.sqrt(1 - an * an);
      S.gn[0] = S.gn[0] * an + sn * randnG(); S.gn[1] = S.gn[1] * an + sn * randnG();
    }
    const hfac = clamp(S.p[2] / 10, 0, 1);                 // wind fades toward the ground
    const wind = add(mul(meanWind, hfac), mul(S.gust, hfac));
    const { Tcmd, cross } = control();
    // RK4
    const s0 = { p: S.p, v: S.v, q: S.q, w: S.w, T: S.T };
    const k1 = deriv(s0, Tcmd, wind), k2 = deriv(axpy(s0, k1, dt / 2), Tcmd, wind),
      k3 = deriv(axpy(s0, k2, dt / 2), Tcmd, wind), k4 = deriv(axpy(s0, k3, dt), Tcmd, wind);
    const comb = key => s0[key].map((x, i) => x + dt / 6 * (k1[key][i] + 2 * k2[key][i] + 2 * k3[key][i] + k4[key][i]));
    S.p = comb('p'); S.v = comb('v'); S.q = qnorm(comb('q')); S.w = comb('w'); S.T = comb('T');
    // ground contact
    if (S.p[2] <= 0) { S.p[2] = 0; if (S.v[2] < 0) S.v[2] = 0; if (S.onGround || S.phase === 'land') { S.v[0] *= 0.5; S.v[1] *= 0.5; S.w = mul(S.w, 0.5); } }
    else if (S.p[2] > 0.15) S.onGround = false;
    // power and battery (momentum theory, profile term as Flight Lab)
    const R = qToR(S.q), vair = norm(sub(S.v, wind));
    const Pind = kP * S.T.reduce((s, T) => s + Math.pow(Math.max(T, 0), 1.5), 0) / Math.sqrt(2 * rho * A);
    const P = (C.pload || 0) + Pind * (1 + (C.kv || 0) * vair * vair);
    S.E = Math.max(0, S.E - P * dt / 3600); S.used += P * dt / 3600; S.peakP = Math.max(S.peakP, P);
    S.t += dt;
    if (S.p[2] > 0.5) { S.airT += dt; if (Math.max(...S.T) >= 0.98 * Tmax) S.satT += dt; }
    const tilt = Math.acos(clamp(R[2][2], -1, 1)); if (S.p[2] > 0.5) S.maxTilt = Math.max(S.maxTilt, tilt);
    // phases, reserve and landing
    const tgt = route[S.seg], soc = 100 * S.E / E0;
    S.phase = tgt.type === 'takeoff' ? 'takeoff' : tgt.type === 'land' ? 'land' : tgt.type === 'rth' ? 'rth' : 'survey';
    if (!S.emergency && soc <= (C.crit ?? 10)) {
      S.emergency = true; route.splice(S.seg, route.length, { x: S.p[0], y: -S.p[1], z: 0, type: 'land', w: [S.p[0], S.p[1], 0] }); S.seg = Math.min(S.seg, route.length - 1);
    } else if (!S.rthReserve && !S.emergency && soc <= (C.rthres ?? 15) && S.phase === 'survey') {
      S.rthReserve = true; const h = route[route.length - 1];
      route.splice(S.seg, route.length, { x: h.x, y: h.y, z: C.alt, type: 'rth', w: [h.w[0], h.w[1], C.alt] }, h); S.seg = Math.min(S.seg, route.length - 1);
    }
    if (tgt.type === 'land' && S.p[2] <= 0.02 && S.t > 2) { S.done = true; S.landed = true; S.T = [0, 0, 0, 0]; }
    if (S.t - S.lastLog >= logEvery - 1e-9 || S.done) { S.lastLog = S.t; log(R, P, cross, wind); }
  }

  return {
    trace, state: S, airframe: AIRFRAME, dt,
    run(maxSteps = Infinity, tmax = Infinity) { let n = 0; while (!S.done && n < maxSteps && S.t < tmax) { step(); n++; } return S.done || S.t >= tmax; },
    summary() {
      const tr = trace, last = tr[tr.length - 1] || {};
      return { completed: S.done && !S.emergency && !S.rthReserve, emergency: S.emergency, rth_reserve: S.rthReserve,
        duration_s: S.t, energy_wh: S.used, battery_end_pct: 100 * S.E / E0, peak_power_w: S.peakP,
        max_tilt_deg: S.maxTilt / D2R, track_rms_m: S.crossN ? Math.sqrt(S.crossSq / S.crossN) : 0,
        max_roll_deg: Math.max(0, ...tr.map(r => Math.abs(r.roll))), max_pitch_deg: Math.max(0, ...tr.map(r => Math.abs(r.pitch))),
        max_rate_dps: Math.max(0, ...tr.map(r => Math.hypot(r.p, r.q))), max_motor_n: Math.max(0, ...tr.map(r => Math.max(...r.T))), motor_saturation_pct: S.airT ? 100 * S.satT / S.airT : 0,
        motor_limit_n: Tmax, end: { x: last.x, y: last.y } };
    },
  };
}

// route helper: Flight Lab plan -> 6-DOF route (home on ground, climb, survey, return, land)
function routeFromPlan(wps, home, alt) {
  return [{ x: home.x, y: home.y, z: 0, type: 'home' }, { x: home.x, y: home.y, z: alt, type: 'takeoff' },
    ...wps.map((w, i) => ({ x: w.x, y: w.y, z: alt, type: i === 0 ? 'transit' : w.type })),
    { x: home.x, y: home.y, z: alt, type: 'rth' }, { x: home.x, y: home.y, z: 0, type: 'land' }];
}

// CSV for MATLAB / Excel. x right, y down (map metres); yaw_deg = ZYX yaw, counter-clockwise from map-right;
// heading_deg = clockwise from map-up (same as Flight Lab's YAW readout)
function toCSV(trace) {
  const h = 't_s,x_m,y_m,alt_m,vx_ms,vy_ms,vz_ms,roll_deg,pitch_deg,yaw_deg,heading_deg,tilt_deg,p_dps,q_dps,r_dps,T1_N,T2_N,T3_N,T4_N,power_w,battery_pct,energy_wh,wind_x_ms,wind_y_ms,wind_z_ms,airspeed_ms,groundspeed_ms,cross_track_m,phase';
  const f = v => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(5));
  return h + '\n' + trace.map(r => [r.t, r.x, r.y, r.z, r.vx, r.vy, r.vz, r.roll, r.pitch, r.yaw, r.heading, r.tilt, r.p, r.q, r.r, ...r.T, r.power, r.battery, r.energy_wh, r.wx, r.wy, r.wz, r.airspeed, r.groundspeed, r.cross].map(f).join(',') + ',' + r.phase).join('\n');
}

return { create, routeFromPlan, toCSV, AIRFRAME };
});
