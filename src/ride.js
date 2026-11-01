// A ride through one dream: the pearl's physics, what's scattered on the sea, score, and lucidity.
// Runs headless too (see .claude/sim.mjs) — nothing here touches the DOM.
import { Sea, W, wrapU, handBones } from './sea.js';
import { LOOKS, PALETTES } from './dreams.js';

export const PHYS = {
  r: 0.55,          // the pearl
  g: 30,            // gravity
  diveG: 2.7,       // gravity while diving
  cruise: 12,       // the current always nudges you forward to this speed
  thrust: 8,
  steerG: 30, steerAir: 13, grip: 3.2,
  drag: 0.03, quad: 0.0012,
  maxV: 50,
  popMax: 17,       // how hard the sea may shove you when it turns inside out
  ringBoost: 5,
};
const STEP = 1 / 120;
const AHEAD = 125;

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const easeOutBack = x => { const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const ease = x => x * x * (3 - 2 * x);

// 3×3 rotations (row-major arrays)
const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
function axisAngle(ax, ay, az, a) {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay,
    t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax,
    t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c];
}
function mul3(A, B) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return o;
}
function orthonormalize(M) {
  let x = [M[0], M[3], M[6]], y = [M[1], M[4], M[7]];
  const nx = Math.hypot(...x); x = x.map(v => v / nx);
  const d = x[0] * y[0] + x[1] * y[1] + x[2] * y[2]; y = y.map((v, i) => v - d * x[i]);
  const ny = Math.hypot(...y); y = y.map(v => v / ny);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

export class Ride {
  constructor(dream, { seed = 1, free = false } = {}) {
    this.dream = dream;
    this.free = free || !!dream.free;
    this.rng = mulberry32(seed);
    this.sea = new Sea();
    this.sea.params.to({ ...LOOKS.calm, ...(PALETTES[dream.palette] || PALETTES.bone) }, 0);
    this.ball = { u: 0, n: 8, v: 0, vu: 0, vn: 0, vv: 10, ground: false, groundT: 0, airT: 0, rot: I3(), spin: [1, 0, 0, 0], N: [0, 1, 0] };
    this.secStart = [];
    let acc = 0;
    for (const s of dream.sections) { this.secStart.push(acc); acc += s.bars; }
    this.totalBars = acc;
    this.sec = -1;
    this.bars = 0;
    this.barLen = dream.barLen || 60 / 70 * 2;
    this.clock = null;
    this.time = 0;
    this.acc = 0;
    this.pendingBars = 0;
    this.score = 0; this.combo = 0; this.lucid = 1;
    this.stats = { orbs: 0, rings: 0, smooth: 0, pops: 0, flips: 0, bestAir: 0, dist: 0, rough: 0, bonks: 0 };
    this.orbs = [];
    this.spawn = {};
    this.next = { orb: 45, ring: 70 };
    this.pendingHands = [];
    this.flipQ = false; this.flipCool = 0; this.flipT = -10; this.popped = true;
    this.events = [];
    this.done = null;
    this.doneT = 0;
    this.fading = 0;
    this.forcedLook = null;
  }

  get mult() { return 1 + Math.min(7, Math.floor(this.combo / 2)); }
  get progress() { return this.free ? 0 : clamp(this.bars / this.totalBars, 0, 1); }
  emit(type, o = {}) { this.events.push({ type, ...o }); }

  // ———————————————————————————————————————— the dream's script
  enter(i) {
    this.sec = i;
    const s = this.dream.sections[i];
    const set = { ...LOOKS[s.look], ...(s.set || {}) };
    if (s.palette) Object.assign(set, PALETTES[s.palette]);
    const P = this.sea.p;
    if (s.face && (P.face < 0.05 || P.faceV < this.ball.v - 20)) this.sea.params.to({ faceV: this.ball.v + s.face }, 0);
    this.sea.params.to(set, (s.morph ?? 3) * this.barLen);
    this.spawn = s.spawn || {};
    for (const h of s.hands || []) this.pendingHands.push({ ...h, atBar: this.secStart[i] + h.bar });
    this.emit('section', { index: i, caption: s.caption, energy: s.energy ?? 0.5, look: s.look });
  }

  // drift: jump straight to a look
  setLook(name) {
    this.forcedLook = name;
    this.sea.params.to(LOOKS[name], 2.5 * this.barLen);
    if (name === 'face') this.sea.params.to({ faceV: this.ball.v + 130 }, 0);
    this.emit('section', { index: -1, look: name, energy: 0.6 });
  }

  director() {
    const secs = this.dream.sections;
    if (this.free && this.bars >= this.totalBars) { this.bars -= this.totalBars; this.sec = -1; this.pendingHands = []; }
    while (this.sec + 1 < secs.length && this.bars >= this.secStart[this.sec + 1]) {
      if (this.forcedLook) { this.sec++; continue; }
      this.enter(this.sec + 1);
    }
    if (!this.free && !this.done && this.bars >= this.totalBars) this.finish('clear');
  }

  finish(how) {
    if (this.done) return;
    this.done = how;
    this.doneT = 0;
    if (how === 'clear') this.score += Math.round(this.lucid * 2000);
    this.emit(how === 'clear' ? 'clear' : 'woke');
  }

  // ———————————————————————————————————————— per frame
  // music: { bars (a clock that only goes up), barLen, beat (0..1 pulse), beatHit, loud (0..1 or null) }
  update(dt, inp, music) {
    if (this.clock == null) this.clock = music.bars;
    const dBars = clamp(music.bars - this.clock, 0, 0.5);
    this.clock = music.bars;
    if (music.barLen) this.barLen = music.barLen;
    if (!this.done) this.bars += dBars;
    this.pendingBars += dBars;
    this.director();
    if (music.loud != null) this.sea.p.amp = 0.7 + 0.6 * music.loud;
    if (music.beatHit && !this.done) this.onBeat();
    if (inp.flipPressed) this.flipQ = true;
    this.beat = music.beat || 0;

    this.acc = Math.min(this.acc + dt, STEP * 12);
    const n = Math.floor(this.acc / STEP);
    for (let i = 0; i < n; i++) this.step(STEP, this.done ? { x: 0, dive: false } : inp, this.pendingBars / (n - i), i === n - 1);
    if (n) this.pendingBars = 0;
    this.acc -= n * STEP;
    this.animate(dt);
    this.time += dt;
    if (this.done) this.doneT += dt;
  }

  onBeat() {
    const sp = this.spawn.pillars;
    const pil = this.sea.pillars;
    if (sp && this.rng() < sp.chance && pil.length < 10) {
      const b = this.ball, R = this.rng;
      const v = b.v + 55 + R() * 40;
      let u = (R() - 0.5) * 20;
      for (const g of this.sea.rings) if (Math.abs(g.v - v) < 10 && Math.abs(wrapU(g.u - u)) < 5) u = wrapU(u + W / 2);
      const top = this.sea.height(u, v) + sp.top[0] + R() * (sp.top[1] - sp.top[0]);
      pil.push({ u, v, r: sp.r[0] + R() * (sp.r[1] - sp.r[0]), topMax: top, top: -3, rise: 0 });
    }
  }

  spawnOrbs(v0, kind) {
    const R = this.rng;
    const lane = (R() - 0.5) * 16;
    const add = (u, v, off) => this.orbs.push({ u, v, off, n: 0, alive: 1, phase: R() * 6 });
    if (kind === 'line') for (let i = 0; i < 6; i++) add(lane, v0 + i * 3.4, 0.9);
    else if (kind === 'arc') for (let i = 0; i < 7; i++) add(lane, v0 + i * 3, 1 + 5 * Math.sin((i / 6) * Math.PI));
    else if (kind === 'slalom') for (let i = 0; i < 8; i++) add(lane * 0.5 + 6 * Math.sin(i * 0.8), v0 + i * 3.6, 0.9);
    else if (kind === 'high') for (let i = 0; i < 5; i++) add(lane * 0.5, v0 + i * 2.8, 6.5 + i * 0.3);
  }

  animate(dt) {
    const b = this.ball, sea = this.sea, R = this.rng, sp = this.spawn;
    const ahead = b.v + AHEAD;
    // scatter
    if (sp.orbs) while (this.next.orb < ahead) { this.spawnOrbs(this.next.orb, sp.orbs.kinds[Math.floor(R() * sp.orbs.kinds.length)]); this.next.orb += sp.orbs.gap * (0.8 + R() * 0.45); }
    else this.next.orb = Math.max(this.next.orb, ahead);
    if (sp.rings) while (this.next.ring < ahead) {
      const g = sp.rings;
      this.sea.rings.push({ u: (R() - 0.5) * 14, v: this.next.ring, R: g.R[0] + R() * (g.R[1] - g.R[0]), lift: g.lift[0] + R() * (g.lift[1] - g.lift[0]), n: 0, glow: 0, passed: false });
      this.next.ring += g.gap * (0.8 + R() * 0.45);
    }
    else this.next.ring = Math.max(this.next.ring, ahead);
    for (let i = this.pendingHands.length - 1; i >= 0; i--) {
      const h = this.pendingHands[i];
      if (this.bars < h.atBar || sea.hands.length >= 3) continue;
      this.pendingHands.splice(i, 1);
      sea.hands.push({ u: h.u, v: b.v + 120, s: h.s, pitch: h.pitch, curl0: h.curl, curl: h.curl, spread: h.spread, rise: 0, n: -h.s, caps: handBones(h.curl, h.spread) });
      this.emit('hand');
    }
    // move things
    for (const o of this.orbs) o.n = sea.height(o.u, o.v) + o.off + 0.22 * Math.sin(this.time * 2.2 + o.phase);
    // rings stand half sunk, arches you roll through
    for (const g of sea.rings) { g.n = sea.height(g.u, g.v) + g.R * 0.45 + g.lift; g.glow = Math.max(0, g.glow - dt * 1.5); }
    for (const c of sea.pillars) {
      c.rise = clamp(c.rise + (c.v < b.v - 10 ? -1.6 : 1.3) * dt, 0, 1);
      c.top = -3 + (c.topMax + 3) * easeOutBack(c.rise);
    }
    for (const H of sea.hands) {
      H.rise = clamp(H.rise + (b.v - H.v > 28 ? -0.5 : H.v - b.v < 115 ? 0.32 : 0) * dt, 0, 1);
      H.n = (ease(H.rise) * 0.56 - 0.42) * H.s;
      const curl = H.curl0 + 0.22 * (this.beat || 0);
      if (Math.abs(curl - H.curl) > 0.01) { H.curl = curl; H.caps = handBones(H.curl, H.spread); }
    }
    // the mask: it blinks, it sings along, and it lets go once you pass through
    const P = sea.p;
    if (P.face > 0.01) {
      const blink = (this.time % 4.3) < 0.16 ? 0.08 : 1;
      P.eyes += (blink - P.eyes) * Math.min(1, dt * 25);
      P.mouth = Math.min(1, 0.15 + 0.7 * (this.beat || 0));
      if (this.faceAt !== P.faceV) { this.faceAt = P.faceV; this.faceGone = false; }
      if (!this.faceGone && b.v > P.faceV - 2) { this.faceGone = true; sea.params.to({ face: 0 }, 1.4); this.emit('through'); }
    }
    // forget what's behind
    const behind = b.v - 25;
    this.orbs = this.orbs.filter(o => o.v > behind && o.alive > 0);
    sea.rings = sea.rings.filter(g => g.v > behind);
    sea.pillars = sea.pillars.filter(c => c.v > behind || c.rise > 0);
    sea.hands = sea.hands.filter(H => !(H.v < b.v && H.rise <= 0));
  }

  // ———————————————————————————————————————— physics, 120 times a second
  step(dt, inp, dBars, last) {
    const b = this.ball, sea = this.sea;
    const pu = b.u, pn = b.n, pv = b.v;
    const F0 = sea.F(pu, pn, pv);
    sea.advance(dt, dBars);
    this.flipCool -= dt;
    if (this.flipQ && !this.done) {
      this.flipQ = false;
      if (this.flipCool <= 0) {
        sea.startFlip(b.u, b.v);
        this.flipCool = 0.55; this.flipT = this.time; this.popped = false;
        this.stats.flips++;
        this.emit('flip', { side: sea.side });
      }
    }

    // forces
    const g = PHYS.g * (inp.dive ? PHYS.diveG : 1);
    b.vn -= g * dt;
    if (b.vv < PHYS.cruise && !this.done) b.vv += PHYS.thrust * dt * (b.ground ? 1 : 0.35);
    const steer = clamp(inp.x || 0, -1, 1);
    b.vu += steer * (b.ground ? PHYS.steerG : PHYS.steerAir) * dt;
    if (b.ground) b.vu *= Math.exp(-dt * (Math.abs(steer) > 0.1 ? 0.4 : PHYS.grip));
    if (this.done) { b.vv *= Math.exp(-dt * 0.6); b.vu *= Math.exp(-dt * 1.5); }
    let sp = Math.hypot(b.vu, b.vn, b.vv);
    const k = Math.exp(-dt * (PHYS.drag + PHYS.quad * sp));
    b.vu *= k; b.vn *= k; b.vv *= k;
    const v0 = b.v;
    b.u += b.vu * dt; b.n += b.vn * dt; b.v += b.vv * dt;

    // touch the sea (and whatever stands in it)
    let contact = false, impact = 0, surfV = 0;
    const F = sea.F(b.u, b.n, b.v);
    if (F < PHYS.r + 0.4) {
      const G = sea.gradF(b.u, b.n, b.v);
      const gl = Math.hypot(G[0], G[1], G[2]) || 1;
      const dist = F / gl;
      if (dist < PHYS.r) {
        const N = [G[0] / gl, G[1] / gl, G[2] / gl];
        // how fast the surface itself is coming at us (waves rolling in, the sea turning over)
        surfV = clamp((F0 - sea.F(pu, pn, pv)) / gl / dt, -PHYS.popMax, PHYS.popMax);
        // nudge out of it
        const push = PHYS.r - dist;
        b.u += N[0] * push; b.n += N[1] * push; b.v += N[2] * push;
        const vN = b.vu * N[0] + b.vn * N[1] + b.vv * N[2];
        const rel = vN - Math.max(0, surfV);
        if (rel < 0) {
          impact = -rel;
          b.vu -= N[0] * rel; b.vn -= N[1] * rel; b.vv -= N[2] * rel;
        }
        b.N = N;
        contact = true;
        // did we hit something standing in the sea?
        const objD = Math.min(sea.objects(b.u, b.n, b.v), sea.ringDist(b.u, b.n, b.v));
        if (objD < PHYS.r + 0.15 && impact > 7 && N[1] < 0.6) this.bonk(impact);
      }
    }
    this.land(contact, impact, sp, surfV, dt);

    // never faster than maxV
    sp = Math.hypot(b.vu, b.vn, b.vv);
    if (sp > PHYS.maxV) { const s = PHYS.maxV / sp; b.vu *= s; b.vn *= s; b.vv *= s; }

    // rings: pass through the middle
    for (const r of sea.rings) {
      if (r.passed || !(v0 < r.v && b.v >= r.v)) continue;
      const d = Math.hypot(wrapU(b.u - r.u), b.n - r.n);
      if (d < r.R - 0.2) {
        r.passed = true; r.glow = 1;
        b.vv += PHYS.ringBoost;
        this.combo++;
        this.stats.rings++;
        this.gain(150, 0.08);
        this.emit('ring', { u: r.u, n: r.n, v: r.v });
      }
    }
    // orbs: just touch them
    for (const o of this.orbs) {
      if (o.alive <= 0) continue;
      const d = Math.hypot(wrapU(b.u - o.u), b.n - o.n, b.v - o.v);
      if (d < 1.35) { o.alive = 0; this.stats.orbs++; this.gain(10, 0.01); this.emit('orb', { u: o.u, n: o.n, v: o.v }); }
    }

    // roll
    const vt = Math.hypot(b.vu, b.vv);
    if (b.ground) {
      const N = b.N;
      let ax = N[1] * b.vv - N[2] * b.vn, ay = N[2] * b.vu - N[0] * b.vv, az = N[0] * b.vn - N[1] * b.vu;
      const al = Math.hypot(ax, ay, az);
      if (al > 1e-4) b.spin = [ax / al, ay / al, az / al, al / PHYS.r];
    }
    if (b.spin[3] > 0) b.rot = mul3(axisAngle(b.spin[0], b.spin[1], b.spin[2], b.spin[3] * dt), b.rot);
    if (last) b.rot = orthonormalize(b.rot);

    // score + lucidity
    this.stats.dist += Math.max(0, b.v - v0);
    if (!this.done) {
      this.score += Math.max(0, b.v - v0) * 0.5;
      if (!this.free) {
        const slow = clamp((14 - vt) / 14, 0, 1);
        this.lucid -= dt * this.dream.drain * (1 + 1.5 * slow);
        // at zero the static closes in — three seconds to catch something before you wake
        if (this.lucid <= 0) { this.lucid = 0; this.fading += dt; if (this.fading > 3) this.finish('woke'); }
        else this.fading = 0;
      }
    }
  }

  land(contact, impact, speed, surfV, dt) {
    const b = this.ball;
    if (contact) {
      if (b.airT > 0.5 && !this.done) {
        const q = impact / Math.max(speed, 1);
        const air = b.airT;
        if (q < 0.33 && impact < 15) {
          // a smooth landing: you go with the wave, and it pays you for it
          const s = Math.min(1.07, PHYS.maxV / Math.max(1, Math.hypot(b.vu, b.vn, b.vv)));
          b.vu *= s; b.vn *= s; b.vv *= s;
          this.combo++;
          this.stats.smooth++;
          this.gain(60, 0.02);
          this.emit('smooth', { air });
        } else if (q > 0.62 && impact > 9) {
          this.combo = 0;
          this.stats.rough++;
          if (!this.free) this.lucid = Math.max(0, this.lucid - 0.02);
          this.emit('rough', { impact });
        } else this.emit('land', { impact });
        if (air > 0.75) {
          this.gain(Math.round(air * 80), (air - 0.5) * 0.03);
          if (air > 1.2) this.combo++;
          this.emit('air', { air });
        }
        this.stats.bestAir = Math.max(this.stats.bestAir, air);
        if (impact > 6) this.sea.ripple(b.u, b.v, Math.min(0.7, impact * 0.03));
      }
      // turned the sea over while sitting in a trough: it throws you
      if (!this.popped && this.time - this.flipT < 0.35 && surfV > 6) {
        this.popped = true;
        this.combo++;
        this.stats.pops++;
        this.gain(120, 0.05);
        this.emit('pop', { power: surfV });
      }
      b.groundT = 0.1;
      b.airT = 0;
    } else {
      b.groundT -= dt;
      b.airT += dt;
    }
    b.ground = b.groundT > 0;
  }

  bonk(impact) {
    if (this.done || this.time - (this.lastBonk || -9) < 0.5) return;
    this.lastBonk = this.time;
    this.combo = 0;
    this.stats.bonks++;
    if (!this.free) this.lucid = Math.max(0, this.lucid - 0.05);
    this.emit('bonk', { impact });
  }

  gain(points, lucid) {
    this.score += points * this.mult;
    this.lucid = Math.min(1, this.lucid + lucid + (this.fading > 0 ? 0.025 : 0));
  }
}

// ———————————————————————————————————————— the autopilot (the title screen rides itself; the sim uses it too)
export function autopilot(ride, skill = 1) {
  const b = ride.ball, sea = ride.sea;
  const sp = Math.hypot(b.vu, b.vv) || 1;
  const du = b.vu / sp, dv = b.vv / sp;
  const slopeAt = (u, v) => { const [hu, hv] = sea.slope(u, v); return hu * du + hv * dv; };
  // Tiny-Wings rules: press down the far side of every wave, float up the near side,
  // and in the air, come down early if the ground ahead is falling away
  let dive;
  if (b.ground) dive = slopeAt(b.u, b.v) < -0.02;
  else { const T = 0.3; dive = b.vn < 3 && slopeAt(b.u + b.vu * T, b.v + b.vv * T) < -0.05; }
  if (skill < 1 && ride.rng() > skill) dive = !dive;
  // aim at the next ring, else the next orbs
  let target = null, best = 1e9;
  for (const r of sea.rings) { const dvr = r.v - b.v; if (dvr > 3 && dvr < 70 && !r.passed && dvr < best) { best = dvr; target = r; } }
  if (!target) for (const o of ride.orbs) { const dvo = o.v - b.v; if (o.alive && dvo > 2 && dvo < 40 && dvo < best) { best = dvo; target = o; } }
  // and steer around columns
  let avoid = 0;
  for (const c of sea.pillars) {
    const dvc = c.v - b.v, duc = wrapU(c.u - b.u);
    if (dvc > 0 && dvc < 22 && Math.abs(duc) < c.r + 2.2 && c.top > sea.height(c.u, c.v) + 0.5) avoid -= Math.sign(duc || 1) * (1 - dvc / 22) * 2;
  }
  let steer = target ? wrapU(target.u - b.u) * 0.3 - b.vu * 0.12 : -wrapU(b.u) * 0.08 - b.vu * 0.1;
  steer = clamp((steer + avoid) * Math.min(1, skill + 0.2), -1, 1);
  // sitting in a deep trough with the flip ready: pop
  const flipPressed = skill > 0.5 && b.ground && ride.flipCool <= 0 && sea.height(b.u, b.v) < -1.5 && ride.rng() < 0.1;
  return { x: steer, y: 0, dive, flipPressed };
}
