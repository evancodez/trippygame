// Every knob of the sea in one list. A section of a dream is just a set of these values, and moving
// from one section to the next is every value gliding to its new target — so the equation itself
// re-forms under you instead of cutting to a new picture.
//
// Surface knobs are read by both the physics (sea.js) and the shader, so what you see is what you ride.

const P = (name, def, label = null) => ({ name, def, label });
const C = (name, def) => ({ name, def, color: true });

export const PARAMS = [
  // ——— the surface: h(u, v) where u runs across the track and v along it
  P('swell', 0, 'swell'), P('swellK', 0.14), P('swellU', 0.6),   // long rolling waves: height, waves per unit, sideways sway
  P('chop', 0, 'chop'), P('chopK', 0.32),                        // crossing diagonal waves
  P('dunes', 0, 'dunes'), P('dunesK', 0.28), P('dunesN', 4),     // an egg-crate of bumps
  P('vortex', 0, 'vortex'), P('vortexP', 70),                    // whirlpools, one every vortexP units
  P('terrace', 0, 'steps'), P('terraceS', 1.4),                  // quantize the sea into stairs
  P('face', 0, 'face'), P('faceV', -1e4), P('faceS', 30),        // the ghost face, lying in the sea
  P('eyes', 1), P('mouth', 0),
  P('wall', 1),                                                  // the ridges that keep you on the track
  P('amp', 1),                                                   // overall height (the music leans on this)
  // phases (never set directly — they are the integrals of the rates below)
  P('ph1', 0), P('ph2', 0), P('ph3', 0), P('phL', 0),
  // ——— the shape of space
  P('curl', 0, 'curl'),       // 0 flat → 1 the sea rolled into a tube
  P('twist', 0),              // barber-pole the lines
  P('bendV', 0),              // >0: the sea ahead folds up into the sky; <0: it falls away like a planet
  P('bendH', 0),              // the road seems to turn
  P('ceil', 0),               // a second sea hanging upside down above you
  // ——— the lines painted on everything
  P('freq', 0.9), P('lCross', 1), P('lLanes', 0), P('lContour', 0), P('lRings', 0),
  P('check', 0), P('moire', 0), P('thick', 0), P('engrave', 0.7), P('stat', 0), P('hot', 0.35),
  // ——— look
  C('paper', '#f2f0ea'), C('ink', '#0b0b0b'), C('fog', '#f2f0ea'), C('accent', '#e0104f'),
  P('fogD', 0.011), P('sun', 1), P('soft', 1.6),
  // ——— speeds (per bar of music) that drive the phases
  P('swellRate', 1.2), P('chopRate', 0.8), P('swayRate', 0.5), P('flowRate', 0),
];

export const RATES = { swellRate: 'ph1', chopRate: 'ph2', swayRate: 'ph3', flowRate: 'phL' };
export const BY_NAME = Object.fromEntries(PARAMS.map(p => [p.name, p]));

export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// shader slots: one float per number, three per color
export const SLOTS = [];
for (const p of PARAMS) {
  if (p.color) ['r', 'g', 'b'].forEach((c, i) => SLOTS.push({ name: p.name, ch: i, macro: `${p.name}_${c}`.toUpperCase() }));
  else SLOTS.push({ name: p.name, macro: p.name.toUpperCase() });
}
export const SLOT_COUNT = SLOTS.length;
export const shaderDefines = () => SLOTS.map((s, i) => `#define ${s.macro} uP[${i}]`).join('\n');

const EASE = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// Live values + glides. Colors are stored as [r, g, b].
export class Params {
  constructor() {
    this.v = {};
    for (const p of PARAMS) this.v[p.name] = p.color ? hexToRgb(p.def) : p.def;
    this.glides = {};
    this.out = new Float32Array(SLOT_COUNT);
  }

  // glide to a new set of values over `dur` seconds (0 = jump)
  to(set, dur = 3) {
    for (const [k, raw] of Object.entries(set || {})) {
      const p = BY_NAME[k];
      if (!p) { console.warn('unknown sea param', k); continue; }
      const val = p.color ? hexToRgb(raw) : raw;
      if (dur <= 0) { this.v[k] = val; delete this.glides[k]; continue; }
      const from = Array.isArray(this.v[k]) ? [...this.v[k]] : this.v[k];
      this.glides[k] = { from, to: val, t: 0, dur };
    }
  }

  // dt seconds of real time, dBars bars of music
  advance(dt, dBars) {
    for (const [k, g] of Object.entries(this.glides)) {
      g.t += dt;
      const e = EASE(Math.min(1, g.t / g.dur));
      this.v[k] = Array.isArray(g.to) ? g.to.map((x, i) => g.from[i] + (x - g.from[i]) * e) : g.from + (g.to - g.from) * e;
      if (g.t >= g.dur) delete this.glides[k];
    }
    for (const [rate, ph] of Object.entries(RATES)) this.v[ph] += this.v[rate] * dBars * Math.PI * 2;
  }

  pack() {
    SLOTS.forEach((s, i) => { const x = this.v[s.name]; this.out[i] = s.ch != null ? x[s.ch] : x; });
    return this.out;
  }

  snapshot() { return JSON.parse(JSON.stringify(this.v)); }
}
