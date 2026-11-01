// The sea: one surface, written twice — here in JavaScript for the physics, and in shader.js in GLSL
// for the picture. The two must stay in step, line for line, so what you see is what you ride.
//
// Track space: u runs across the track (it repeats every W, so the edge ridges are one ridge seen from
// both sides, and a fully curled sea is a tube of circumference W), n is height, v runs forward.
import { Params } from './params.js';

export const W = 28;
const TAU = Math.PI * 2;
export const wrapU = u => u - W * Math.floor(u / W + 0.5);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / Math.max(k, 1e-5); return Math.min(a, b) - h * h * k * 0.25; };
const g2 = (x, y, cx, cy, sx, sy) => { const dx = (x - cx) / sx, dy = (y - cy) / sy; return Math.exp(-(dx * dx + dy * dy)); };

// the ghost face, as a relief (eyes and mouth are hollows). The mask it's pressed into is drawn
// only by the shader — it rises out of the sea ahead and you pass straight through it.
export function faceH(x, y, eyes, mouth) {
  const m = mouth, e = Math.max(eyes, 0.08);
  let h = 0.55 * g2(x, y, 0, 0.02, 0.36, 0.48);
  h += 0.16 * g2(x, y, 0, 0.13, 0.30, 0.05);
  h -= 0.46 * (g2(x, y, -0.15, 0.045, 0.085, 0.06 * e) + g2(x, y, 0.15, 0.045, 0.085, 0.06 * e));
  h += 0.32 * g2(x, y, 0, -0.035, 0.035, 0.11);
  h += 0.16 * g2(x, y, 0, -0.13, 0.06, 0.045);
  h += 0.12 * (g2(x, y, -0.2, -0.08, 0.09, 0.07) + g2(x, y, 0.2, -0.08, 0.09, 0.07));
  h -= 0.30 * g2(x, y, 0, -0.265, 0.12, 0.016 + 0.055 * m);
  h += 0.09 * g2(x, y, 0, -0.225 + 0.02 * m, 0.13, 0.025);
  h += 0.09 * g2(x, y, 0, -0.31 - 0.03 * m, 0.11, 0.028);
  h += 0.16 * g2(x, y, 0, -0.43, 0.13, 0.075);
  return h;
}

// ———————————————————————————————————————————— a hand reaching up out of the sea
// The hand's own space (from the visualizer): palm in the xy plane facing +z, fingers along +y.
// Its joints only change when it curls, so they're worked out once per frame into capsules.
const FINGER_LEN = [0.95, 1.06, 0.99, 0.78];
function rotYZ(d, a) { const c = Math.cos(a), s = Math.sin(a); return [d[0], c * d[1] - s * d[2], s * d[1] + c * d[2]]; }
function rotXY(d, a) { const c = Math.cos(a), s = Math.sin(a); return [c * d[0] - s * d[1], s * d[0] + c * d[1], d[2]]; }
const norm3 = d => { const l = Math.hypot(d[0], d[1], d[2]); return [d[0] / l, d[1] / l, d[2] / l]; };

export function handBones(curl, spread) {
  const caps = [];   // [ax, ay, az, bx, by, bz, r, k]
  for (let i = 0; i < 4; i++) {
    const len = FINGER_LEN[i] * 0.245, c = curl * (1 + 0.12 * (i - 1.5));
    let a = [-0.066 + i * 0.044, 0.085, 0];
    let dir = norm3([(i - 1.5) * spread * 0.2, 1, 0]);
    let r = 0.0235 - i * 0.0013, seg = 0.46;
    for (let j = 0; j < 3; j++) {
      dir = rotYZ(dir, c * (j === 0 ? 0.55 : 0.95));
      const b = [a[0] + dir[0] * len * seg, a[1] + dir[1] * len * seg, a[2] + dir[2] * len * seg];
      caps.push([...a, ...b, r, 0.016]);
      a = b; r *= 0.9; seg = j === 0 ? 0.32 : 0.23;
    }
  }
  let a = [0.07, -0.055, 0.012], dir = norm3([0.85, 0.6, 0.3]), r = 0.028;
  for (let j = 0; j < 2; j++) {
    dir = rotYZ(rotXY(dir, curl * 0.6), curl * 0.35);
    const l = j === 0 ? 0.095 : 0.075;
    const b = [a[0] + dir[0] * l, a[1] + dir[1] * l, a[2] + dir[2] * l];
    caps.push([...a, ...b, r, 0.018]);
    a = b; r *= 0.85;
  }
  return caps;
}

function sdCapsule(px, py, pz, c) {
  const pax = px - c[0], pay = py - c[1], paz = pz - c[2];
  const bax = c[3] - c[0], bay = c[4] - c[1], baz = c[5] - c[2];
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - c[6];
}
function sdRoundBox(px, py, pz, bx, by, bz, r) {
  const qx = Math.abs(px) - bx, qy = Math.abs(py) - by, qz = Math.abs(pz) - bz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}
const PALM_HEEL = [-0.035, -0.08, 0, 0.04, -0.085, 0, 0.045];
const ARM = [0, -0.1, -0.01, 0, -0.32, -0.42, 0.058];

export function handSDF(x, y, z, caps) {
  let d = sdRoundBox(x, y + 0.01, z, 0.068, 0.08, 0.017, 0.03);
  d = smin(d, sdCapsule(x, y, z, PALM_HEEL), 0.04);
  for (const c of caps) d = smin(d, sdCapsule(x, y, z, c), c[7]);
  return smin(d, sdCapsule(x, y, z, ARM), 0.05);
}

// hand placement: pos (u, n, v), size s, pitch (0 = fingers straight up, palm toward you;
// more leans the fingers away so the palm becomes a ramp), rise 0..1 out of the sea
export function handLocal(H, u, n, v) {
  const du = wrapU(u - H.u) / H.s, dn = (n - H.n) / H.s, dv = (v - H.v) / H.s;
  const c = Math.cos(H.pitch), s = Math.sin(H.pitch);
  return [du, c * dn + s * dv, s * dn - c * dv];
}
export function handDist(H, u, n, v) {
  const [x, y, z] = handLocal(H, u, n, v);
  const bound = Math.hypot(x, y - 0.03, z + 0.12) - 0.42;
  if (bound > 0.12) return bound * H.s;
  return handSDF(x, y, z, H.caps) * H.s;
}

// ———————————————————————————————————————————— the sea
export class Sea {
  constructor() {
    this.params = new Params();
    this.p = this.params.v;
    this.time = 0;
    this.flip = { active: false, u: 0, v: 0, r: 0, from: 1, to: 1 };
    this.ripples = [];   // { u, v, age, amp }
    this.pillars = [];   // { u, v, r, top, topMax, rise, sink }
    this.hands = [];     // { u, n, v, s, pitch, curl, spread, rise, caps }
    this.rings = [];     // { u, n, v, R }
  }

  get side() { return this.flip.to; }

  startFlip(u, v) {
    const f = this.flip;
    const from = f.to;   // a wave still spreading is overtaken (it's far out in the fog by then)
    Object.assign(f, { active: true, u, v, r: 0, from, to: -from });
  }

  ripple(u, v, amp) {
    this.ripples.push({ u, v, age: 0, amp });
    if (this.ripples.length > 8) this.ripples.shift();
  }

  advance(dt, dBars) {
    this.time += dt;
    this.params.advance(dt, dBars);
    const f = this.flip;
    if (f.active) { f.r += 55 * dt; if (f.r > 260) { f.active = false; f.from = f.to; } }
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter(r => r.age < 4.5);
  }

  sideAt(u, v) {
    const f = this.flip;
    if (!f.active) return f.to;
    const d = Math.hypot(wrapU(u - f.u), v - f.v);
    const k = 1 - smooth(f.r - 2.5, f.r + 2.5, d);
    return f.from + (f.to - f.from) * k;
  }

  // the sea before it is turned inside out (u already wrapped)
  baseH(u, v) {
    const P = this.p;
    const U = (u * TAU) / W;
    let h = 0;
    if (P.swell > 0) {
      const s = v * P.swellK - P.ph1 + P.swellU * Math.sin(U + P.ph3);
      h += P.swell * (Math.sin(s) + 0.3 * Math.sin(2 * s + 1.3 + Math.cos(2 * U - P.ph3)));
    }
    if (P.chop > 0) h += P.chop * Math.sin(v * P.chopK + 3 * U - P.ph2) * Math.sin(v * P.chopK * 0.7 - 2 * U + P.ph2 * 0.8);
    if (P.dunes > 0) h += P.dunes * Math.sin(U * Math.floor(P.dunesN + 0.5)) * Math.sin(v * P.dunesK - P.ph2 * 0.5);
    if (P.vortex > 0) {
      const c = (Math.floor(v / P.vortexP) + 0.5) * P.vortexP;
      const dy = v - c, r = Math.hypot(u, dy), a = Math.atan2(dy, u + 1e-6);
      h -= P.vortex * Math.exp((-r * r) / 70) * (2.2 + 0.7 * Math.sin(3 * a + r * 0.7 - 2 * P.ph1));
    }
    if (P.terrace > 0) {
      const q = h / P.terraceS, st = Math.floor(q) + smooth(0.3, 0.7, q - Math.floor(q));
      h += (st * P.terraceS - h) * P.terrace;
    }
    return h;
  }

  height(u, v) {
    u = wrapU(u);
    const P = this.p;
    let h = this.baseH(u, v) * this.sideAt(u, v) * P.amp;
    if (P.wall > 0) { const w = smooth(W / 2 - 6, W / 2, Math.abs(u)); h += P.wall * w * w * 7; }
    for (const r of this.ripples) {
      const x = Math.hypot(wrapU(u - r.u), v - r.v) - r.age * 13;
      h += r.amp * Math.min(1, r.age * 4) * Math.sin(x * 1.3) * Math.exp(-(x * x) / (2 + r.age * 2)) * Math.exp(-r.age * 0.8);
    }
    return h;
  }

  objects(u, n, v) {
    let d = 1e3;
    for (const c of this.pillars) {
      if (c.top < -1.5) continue;
      const wx = Math.hypot(wrapU(u - c.u), v - c.v) - c.r + 0.45, wy = n - c.top + 0.45;
      d = Math.min(d, Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - 0.45);
    }
    for (const H of this.hands) if (H.rise > 0.001) d = Math.min(d, handDist(H, u, n, v));
    return d;
  }

  ringDist(u, n, v) {
    let d = 1e3;
    for (const g of this.rings) {
      const q = Math.hypot(wrapU(u - g.u), n - g.n) - g.R;
      d = Math.min(d, Math.hypot(q, v - g.v) - 0.3);
    }
    return d;
  }

  // the same function the shader marches (its zero set is the visible surface)
  F(u, n, v) {
    const d = smin((n - this.height(u, v)) * 0.6, this.objects(u, n, v), this.p.soft);
    return Math.min(d, this.ringDist(u, n, v));
  }

  // gradient of F (not normalized) — its length turns F into a distance
  gradF(u, n, v, e = 0.04) {
    return [
      (this.F(u + e, n, v) - this.F(u - e, n, v)) / (2 * e),
      (this.F(u, n + e, v) - this.F(u, n - e, v)) / (2 * e),
      (this.F(u, n, v + e) - this.F(u, n, v - e)) / (2 * e),
    ];
  }

  // the sea's slope along the track and across it at (u, v)
  slope(u, v, e = 0.2) {
    return [(this.height(u + e, v) - this.height(u - e, v)) / (2 * e), (this.height(u, v + e) - this.height(u, v - e)) / (2 * e)];
  }
}

// ———————————————————————————————————————————— bending space (the curl), shared with the camera
// curl 0 is flat; curl 1 rolls the strip of width W into a tube of radius W / 2π around an axis above it.
export function curlK(curl) { return (curl * TAU) / W; }

// track (u, n, v) → world (x, y, z)
export function toWorld(u, n, v, curl) {
  const k = curlK(curl);
  if (k < 1e-4) return [u, n, v];
  const R = 1 / k, th = u * k;
  return [(R - n) * Math.sin(th), R - (R - n) * Math.cos(th), v];
}
// the local "up" of the sea at u (where gravity points away from)
export function upAt(u, curl) {
  const th = u * curlK(curl);
  return [-Math.sin(th), Math.cos(th), 0];
}
