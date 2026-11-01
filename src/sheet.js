// The sheet: an elastic membrane of lines, simulated on a grid (a damped wave equation), pinned to a
// hoop, resting on a shape that morphs from one equation to the next. Hands push it from beneath;
// the pearl and the ink roll, bounce and get tossed on top of it. Nothing here touches the DOM.

export const N = 128;              // grid resolution
export const L = 24;               // the sheet spans -L/2 … L/2 in x (across) and y (away from you)
export const HALF = L / 2;
const DX = L / (N - 1);
const INV_DX2 = 1 / (DX * DX);
const TAU = Math.PI * 2;

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const g2 = (x, y, cx, cy, sx, sy) => { const dx = (x - cx) / sx, dy = (y - cy) / sy; return Math.exp(-(dx * dx + dy * dy)); };

// the ghost face from the visualizer, as a relief (eyes and mouth are hollows)
export function faceH(x, y) {
  let h = 0.55 * g2(x, y, 0, 0.02, 0.36, 0.48);
  h += 0.16 * g2(x, y, 0, 0.13, 0.30, 0.05);
  h -= 0.46 * (g2(x, y, -0.15, 0.045, 0.085, 0.06) + g2(x, y, 0.15, 0.045, 0.085, 0.06));
  h += 0.32 * g2(x, y, 0, -0.035, 0.035, 0.11);
  h += 0.16 * g2(x, y, 0, -0.13, 0.06, 0.045);
  h += 0.12 * (g2(x, y, -0.2, -0.08, 0.09, 0.07) + g2(x, y, 0.2, -0.08, 0.09, 0.07));
  h -= 0.30 * g2(x, y, 0, -0.265, 0.12, 0.05);
  h += 0.09 * g2(x, y, 0, -0.225, 0.13, 0.025);
  h += 0.09 * g2(x, y, 0, -0.31, 0.11, 0.028);
  h += 0.16 * g2(x, y, 0, -0.43, 0.13, 0.075);
  return h;
}
export const FACE_S = 16;   // the face spans about ±0.45·FACE_S

// ——————————————————————————————————————————— resting shapes: the equations the sheet morphs between
// s = { phase (radians, turns with the music), beat (0..1 pulse), sway (-1..1 on the bar) }
const R2 = (x, y) => (x * x + y * y) / (HALF * HALF);
export const SHAPES = {
  bowl: (x, y) => -2.6 * Math.max(0, 1 - R2(x, y)),
  dome: (x, y) => 2.2 * Math.max(0, 1 - R2(x, y)),
  saddle: (x, y) => (2.6 * (x * x - y * y)) / (HALF * HALF),
  tilt: (x, y, s) => (1.5 * x * s.sway) / HALF * Math.max(0, 1 - Math.pow(Math.abs(y) / HALF, 6)),
  swells: (x, y, s) => 0.85 * Math.sin(y * 0.6 - s.phase) * Math.max(0, 1 - R2(x, y) * 0.6),
  rings: (x, y, s) => 0.8 * Math.sin(Math.hypot(x, y) * 0.95 - s.phase) * Math.max(0, 1 - R2(x, y)),
  ridges: (x, y) => 0.75 * Math.cos(Math.hypot(x, y) * 1.15) * Math.max(0, 1 - R2(x, y)),
  funnel: (x, y, s) => {
    const r = Math.min(1, Math.hypot(x, y) / HALF), a = Math.atan2(y, x + 1e-6);
    return -3.4 * (1 - r) * (1 - r) + 0.55 * Math.sin(3 * a + r * 9 - s.phase) * r * (1 - r) * 4;
  },
  face: (x, y) => faceH(x / FACE_S, y / FACE_S) * 7.5,
  hollow: (x, y) => -faceH(x / FACE_S, y / FACE_S) * 7.5,
  drum: (x, y, s) => s.beat * 0.9 * Math.max(0, 1 - R2(x, y)),
};
export const SHAPE_NAMES = Object.keys(SHAPES);

// ——————————————————————————————————————————— a hand, seen from above, as a soft relief (0..1)
// local space: fingers point +y; the palm is at the origin
const FINGERS = [[-0.62, 0.72, -0.78, 1.85, 0.3], [-0.2, 0.86, -0.24, 2.2, 0.31], [0.22, 0.86, 0.26, 2.12, 0.31], [0.6, 0.74, 0.76, 1.72, 0.28], [0.85, -0.15, 1.6, 0.55, 0.32]];
function segDist(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}
export function handShape(lx, ly) {
  let v = Math.exp(-Math.pow(segDist(lx, ly, 0, -0.45, 0, 0.35) / 1.0, 2) * 1.6);
  for (const f of FINGERS) v = Math.max(v, Math.exp(-Math.pow(segDist(lx, ly, f[0], f[1], f[2], f[3]) / f[4], 2) * 1.4));
  return v;
}
export const HAND_REACH = 2.9;

// ——————————————————————————————————————————— holes: eyes (where things should go) and tears (where they shouldn't)
export function holeSD(o, x, y) {
  const c = Math.cos(o.ang), s = Math.sin(o.ang);
  const lx = (x - o.x) * c + (y - o.y) * s, ly = -(x - o.x) * s + (y - o.y) * c;
  if (o.kind === 'eye') {
    const b = Math.max(0.02, o.b * o.open);
    return (Math.hypot(lx / o.a, ly / b) - 1) * Math.min(o.a, b);
  }
  const wob = 1 + 0.18 * Math.sin(Math.atan2(ly, lx) * 5 + o.x) + 0.08 * Math.sin(Math.atan2(ly, lx) * 11 + o.y);
  return (Math.hypot(lx / o.a, ly / o.b) - wob) * Math.min(o.a, o.b);
}

// ——————————————————————————————————————————— bodies: the pearl, the ink
export const PHYS = { g: 24, rest: 0.18, roll: 0.35, air: 0.05, maxV: 30, dimple: 34, rimH: 0.45, rimR: 0.35 };

export class Body {
  constructor(kind, x, y, z, r) {
    Object.assign(this, { kind, x, y, z, r, vx: 0, vy: 0, vz: 0, grounded: false, air: 0, falling: null, gone: false, impact: 0 });
  }
}

export class Sheet {
  constructor() {
    this.u = new Float32Array(N * N);      // displacement from the resting shape
    this.uv = new Float32Array(N * N);     // its velocity
    this.f = new Float32Array(N * N);      // forces for this step
    this.base = new Float32Array(N * N);   // the resting shape
    this.baseV = new Float32Array(N * N);  // how fast the resting shape is moving
    this.h = new Float32Array(N * N);      // base + u, for the picture
    this.c2 = 9 * 9; this.damp = 1.7; this.k = 5;
    this.w = { flat: 1 };                  // shape weights (glided by the game)
    this.s = { phase: 0, beat: 0, sway: 0 };
    this.holes = [];
    this.hands = [];
    this.bodies = [];
    this.events = [];
    this.rebuildBase(0);
  }

  // ——— the resting shape, recomputed each frame from the weighted equations
  baseAt(x, y) {
    let z = 0;
    for (const k in this.w) { const w = this.w[k]; if (w > 0.001 && SHAPES[k]) z += w * SHAPES[k](x, y, this.s); }
    return z;
  }
  rebuildBase(dt) {
    const { base, baseV } = this;
    for (let j = 0; j < N; j++) {
      const y = -HALF + j * DX;
      for (let i = 0; i < N; i++) {
        const id = j * N + i, z = this.baseAt(-HALF + i * DX, y);
        baseV[id] = dt > 0 ? clamp((z - base[id]) / dt, -12, 12) : 0;
        base[id] = z;
      }
    }
  }

  // ——— sampling (bilinear, so the physics feels exactly the surface the shader draws)
  sample(arr, x, y) {
    const gx = clamp((x + HALF) / DX, 0, N - 1.001), gy = clamp((y + HALF) / DX, 0, N - 1.001);
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, id = j * N + i;
    return (arr[id] * (1 - fx) + arr[id + 1] * fx) * (1 - fy) + (arr[id + N] * (1 - fx) + arr[id + N + 1] * fx) * fy;
  }
  height(x, y) { return this.sample(this.base, x, y) + this.sample(this.u, x, y); }
  vel(x, y) { return this.sample(this.baseV, x, y) + this.sample(this.uv, x, y); }
  slope(x, y, e = 0.12) { return [(this.height(x + e, y) - this.height(x - e, y)) / (2 * e), (this.height(x, y + e) - this.height(x, y - e)) / (2 * e)]; }
  inside(x, y, m = 0) { return Math.abs(x) < HALF - m && Math.abs(y) < HALF - m; }
  holeAt(x, y, margin = 0) {
    for (const o of this.holes) if (!o.hidden && (o.kind !== 'eye' || o.open > 0.3) && holeSD(o, x, y) < -margin) return o;
    return null;
  }

  // ——— a push from beneath (or a press from above) at x, y
  forceHand(H) {
    const amt = H.push > 0.01 ? H.push * H.power : H.press > 0.01 ? -H.press * 2.4 : 0;
    if (Math.abs(amt) < 0.01) return;
    const { u, uv, f } = this;
    const c = Math.cos(-H.ang), s = Math.sin(-H.ang);
    const i0 = Math.max(1, Math.floor((H.x - HAND_REACH + HALF) / DX)), i1 = Math.min(N - 2, Math.ceil((H.x + HAND_REACH + HALF) / DX));
    const j0 = Math.max(1, Math.floor((H.y - HAND_REACH + HALF) / DX)), j1 = Math.min(N - 2, Math.ceil((H.y + HAND_REACH + HALF) / DX));
    for (let j = j0; j <= j1; j++) {
      const dy = -HALF + j * DX - H.y;
      for (let i = i0; i <= i1; i++) {
        const dx = -HALF + i * DX - H.x;
        const lx = dx * c - dy * s, ly = dx * s + dy * c;
        const shape = handShape(lx, ly);
        if (shape < 0.02) continue;
        const id = j * N + i, target = amt * shape;
        // a hand can only push the fabric its own way: up from beneath, or down from above
        if (amt > 0 ? u[id] < target : u[id] > target) f[id] += 420 * (target - u[id]) - 22 * uv[id];
      }
    }
  }

  // ——— one physics step
  step(dt) {
    const { u, uv, f } = this;
    f.fill(0);
    for (const H of this.hands) this.forceHand(H);
    // the pearl and the ink weigh the fabric down a little (so it sags under them, and rings when they land)
    for (const b of this.bodies) {
      if (!b.grounded || b.falling) continue;
      const w = PHYS.dimple * (b.kind === 'pearl' ? 1 : 0.6) * (1 + Math.min(2, b.impact * 0.15));
      const gi = Math.round((b.x + HALF) / DX), gj = Math.round((b.y + HALF) / DX);
      for (let j = Math.max(1, gj - 6); j <= Math.min(N - 2, gj + 6); j++) for (let i = Math.max(1, gi - 6); i <= Math.min(N - 2, gi + 6); i++) {
        const dx = -HALF + i * DX - b.x, dy = -HALF + j * DX - b.y;
        f[j * N + i] -= w * Math.exp(-(dx * dx + dy * dy) / 0.5);
      }
      b.impact *= 0.8;
    }
    const c2 = this.c2, damp = this.damp, k = this.k;
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1, id = j * N + 1; i < N - 1; i++, id++) {
        const lap = (u[id - 1] + u[id + 1] + u[id - N] + u[id + N] - 4 * u[id]) * INV_DX2;
        uv[id] += (c2 * lap - damp * uv[id] - k * u[id] + f[id]) * dt;
      }
    }
    for (let j = 1; j < N - 1; j++) for (let i = 1, id = j * N + 1; i < N - 1; i++, id++) u[id] += uv[id] * dt;
    for (const b of this.bodies) this.stepBody(b, dt);
    this.collideBodies();
  }

  // a sudden ring of force, e.g. a slap on the beat
  pulse(x, y, amp, radius = 2) {
    const { uv } = this;
    const gi = Math.round((x + HALF) / DX), gj = Math.round((y + HALF) / DX), R = Math.ceil(radius * 2 / DX);
    for (let j = Math.max(1, gj - R); j <= Math.min(N - 2, gj + R); j++) for (let i = Math.max(1, gi - R); i <= Math.min(N - 2, gi + R); i++) {
      const dx = -HALF + i * DX - x, dy = -HALF + j * DX - y;
      uv[j * N + i] += amp * Math.exp(-(dx * dx + dy * dy) / (radius * radius));
    }
  }

  stepBody(b, dt) {
    if (b.gone) return;
    b.vz -= PHYS.g * dt;
    const air = Math.exp(-dt * PHYS.air);
    b.vx *= air; b.vy *= air; b.vz *= air;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.falling) {
      if (b.z < this.sample(this.base, b.falling.x, b.falling.y) - 5) { b.gone = true; this.events.push({ type: 'fell', body: b, hole: b.falling }); }
      return;
    }
    const inside = this.inside(b.x, b.y);
    if (!inside) {
      // over the hoop: fall off the edge into the dark
      if (b.z < -10) { b.gone = true; this.events.push({ type: 'fell', body: b, hole: null }); }
      b.grounded = false;
      return;
    }
    // into a hole?
    const hole = this.holeAt(b.x, b.y, b.r * 0.35);
    const H = this.height(b.x, b.y);
    if (hole && b.z - b.r < H + 0.3) {
      b.falling = hole;
      b.grounded = false;
      this.events.push({ type: 'drop', body: b, hole });
      return;
    }
    // the hoop: a rim that throws things back in (unless they come in high)
    const m = HALF - b.r - PHYS.rimR;
    const rimTop = this.sample(this.base, clamp(b.x, -HALF, HALF), clamp(b.y, -HALF, HALF)) + PHYS.rimH + PHYS.rimR;
    if (b.z - b.r < rimTop) {
      if (b.x > m) { b.x = m; if (b.vx > 0) b.vx *= -0.5; }
      if (b.x < -m) { b.x = -m; if (b.vx < 0) b.vx *= -0.5; }
      if (b.y > m) { b.y = m; if (b.vy > 0) b.vy *= -0.5; }
      if (b.y < -m) { b.y = -m; if (b.vy < 0) b.vy *= -0.5; }
    }
    // the fabric
    const [sx, sy] = this.slope(b.x, b.y);
    const nl = Math.hypot(sx, sy, 1), nx = -sx / nl, ny = -sy / nl, nz = 1 / nl;
    const rest = H + b.r * nl;               // a ball resting on a slope sits a little higher
    if (b.z < rest) {
      const vs = this.vel(b.x, b.y);
      const vn = b.vx * nx + b.vy * ny + (b.vz - vs) * nz;
      b.z = rest;
      if (vn < 0) {
        const e = -vn > 3 ? PHYS.rest : 0;
        b.vx -= nx * vn * (1 + e); b.vy -= ny * vn * (1 + e); b.vz -= nz * vn * (1 + e);
        if (!b.grounded && b.air > 0.25) this.events.push({ type: 'land', body: b, speed: -vn, air: b.air });
        b.impact = Math.max(b.impact, -vn);
      }
      const fr = Math.exp(-dt * PHYS.roll);
      b.vx *= fr; b.vy *= fr;
      b.grounded = true;
      b.air = 0;
    } else {
      b.grounded = b.z < rest + 0.06;
      if (!b.grounded) b.air += dt;
    }
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    if (sp > PHYS.maxV) { const k = PHYS.maxV / sp; b.vx *= k; b.vy *= k; b.vz *= k; }
  }

  collideBodies() {
    const B = this.bodies;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j];
      if (a.gone || b.gone || a.falling || b.falling) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz), m = a.r + b.r;
      if (d >= m || d < 1e-5) continue;
      const nx = dx / d, ny = dy / d, nz = dz / d, push = (m - d) / 2;
      a.x -= nx * push; a.y -= ny * push; a.z -= nz * push;
      b.x += nx * push; b.y += ny * push; b.z += nz * push;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const ma = a.kind === 'pearl' ? 1 : 0.7, mb = b.kind === 'pearl' ? 1 : 0.7, J = (-1.6 * rv) / (1 / ma + 1 / mb);
        a.vx -= (J / ma) * nx; a.vy -= (J / ma) * ny; a.vz -= (J / ma) * nz;
        b.vx += (J / mb) * nx; b.vy += (J / mb) * ny; b.vz += (J / mb) * nz;
        this.events.push({ type: 'clack', a, b, speed: -rv });
      }
    }
  }

  // base + u, for the picture
  pack() { const { h, base, u } = this; for (let i = 0; i < h.length; i++) h[i] = base[i] + u[i]; return h; }
}
