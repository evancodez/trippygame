// The dreams. Each is a run of sections timed in bars of music (70 bpm, 6/8 — a bar is ~1.7 s).
// A section names a "look" for the sea (the equation it glides into), what to scatter on it,
// and maybe a caption. The physics and the picture both read the same values, so a look is
// a new landscape to ride, not just a new picture.

// every surface + line knob, at rest — looks are written on top of this so nothing lingers
const BASE = {
  swell: 0, swellK: 0.14, swellU: 0.6, chop: 0, chopK: 0.32, dunes: 0, dunesK: 0.28, dunesN: 4,
  vortex: 0, terrace: 0, terraceS: 1.4, face: 0, curl: 0, twist: 0, bendV: 0, bendH: 0, ceil: 0,
  freq: 0.9, lCross: 1, lLanes: 0, lContour: 0, lRings: 0, check: 0, moire: 0, thick: 0, stat: 0, hot: 0.35,
  swellRate: 1.2, chopRate: 0.8, swayRate: 0.5, flowRate: 0, engrave: 0.7, wall: 1,
};
const L = o => ({ ...BASE, ...o });

export const LOOKS = {
  calm:     L({ swell: 0.8, swellK: 0.11, swellU: 0.4 }),
  silk:     L({ swell: 1.7, swellK: 0.13, swellU: 0.7 }),
  rollers:  L({ swell: 2.4, swellK: 0.12, swellU: 0.9, chop: 0.25, swellRate: 1.4 }),
  chop:     L({ swell: 1.1, chop: 0.9, lCross: 0, lRings: 1, freq: 0.75 }),
  moire:    L({ swell: 1.5, chop: 0.4, lCross: 0.4, lRings: 0.6, moire: 0.8, freq: 1.1 }),
  dunes:    L({ swell: 0.6, dunes: 1.5, dunesN: 4, dunesK: 0.26, lCross: 1, check: 0.85, freq: 0.7 }),
  vortex:   L({ swell: 1.0, vortex: 1.3, vortexP: 64, lCross: 0, lRings: 1, freq: 0.8 }),
  steps:    L({ swell: 2.2, swellK: 0.1, terrace: 1, terraceS: 1.5, lCross: 0, lContour: 1, freq: 1.0, engrave: 1.0 }),
  lanes:    L({ swell: 1.6, chop: 0.3, lCross: 0, lLanes: 1, freq: 1.0 }),
  contour:  L({ swell: 1.9, dunes: 0.5, lCross: 0, lContour: 1, freq: 1.1 }),
  tube:     L({ swell: 1.3, swellK: 0.16, curl: 1, wall: 0, lCross: 0.6, lLanes: 0.4, twist: 2, freq: 1.0 }),
  tubeRings: L({ swell: 0.8, chop: 0.4, curl: 1, wall: 0, lCross: 1, lLanes: 0, twist: 0, freq: 0.8, check: 0.6 }),
  between:  L({ swell: 1.8, ceil: 1, lCross: 0.5, lLanes: 0.5, freq: 0.9, bendV: -0.002 }),
  fold:     L({ swell: 2.0, swellK: 0.12, bendV: 0.0065, lCross: 1, freq: 0.9 }),
  turn:     L({ swell: 1.6, chop: 0.3, bendH: 0.004, lCross: 0.8, lLanes: 0.2, freq: 1.0 }),
  face:     L({ swell: 1.0, swellK: 0.1, face: 1, faceS: 30, lCross: 1, freq: 1.0, engrave: 1.0, bendV: 0.002 }),
};

// light, ink, fog, accent
export const PALETTES = {
  bone:   { paper: '#f2f0ea', ink: '#0b0b0b', fog: '#f2f0ea', accent: '#e0104f' },
  night:  { paper: '#060608', ink: '#ece9e2', fog: '#060608', accent: '#2ee6c9' },
  sepia:  { paper: '#efe4d0', ink: '#1d140d', fog: '#efe4d0', accent: '#ff4d2e' },
  chrome: { paper: '#0b0c0f', ink: '#d6dae2', fog: '#000000', accent: '#c6f03a' },
  cherry: { paper: '#6e0221', ink: '#ffd9df', fog: '#3a0010', accent: '#ffffff' },
};

// what to scatter, ready made
const ORBS = (gap = 28, kinds = ['line', 'arc', 'slalom']) => ({ gap, kinds });
const RINGS = (gap = 80, lift = [0, 1.5], R = [2.6, 3.2]) => ({ gap, lift, R });
const PILLARS = (chance = 0.5, top = [3, 8], r = [0.9, 1.6]) => ({ chance, top, r });
const HAND = (bar, u = 0, extra = {}) => ({ bar, u, s: 36, pitch: 0.8, curl: 0.2, spread: 0.8, ...extra });

const key = d => (d === 'pad' ? { dive: '✕ or R2', flip: '□', steer: 'the left stick' } : { dive: 'Space (or hold the mouse)', flip: 'E (or right-click)', steer: '← → or A D' });

export const DREAMS = [
  {
    id: 'silk', name: 'Silk', sub: 'I', palette: 'bone', song: 0, drain: 0.02, par: 9000,
    blurb: 'a calm sea of lines. learn to fall well.',
    sections: [
      { bars: 6, look: 'calm', energy: 0.25, caption: d => `steer with ${key(d).steer}` },
      { bars: 10, look: 'silk', energy: 0.4, spawn: { orbs: ORBS(26, ['line', 'arc']) }, caption: d => `hold <b>${key(d).dive}</b> going downhill — let go at the top of a wave to fly` },
      { bars: 10, look: 'rollers', energy: 0.5, spawn: { orbs: ORBS(30), rings: RINGS(70) }, caption: () => 'land on the far side of a wave, going with it. rings throw you forward' },
      { bars: 10, look: 'dunes', energy: 0.55, spawn: { orbs: ORBS(24, ['slalom', 'line']), rings: RINGS(90, [0.5, 2.5]) } },
      { bars: 12, look: 'silk', energy: 0.75, set: { lLanes: 0.3, lCross: 0.7 }, spawn: { pillars: PILLARS(0.55), orbs: ORBS(30) }, caption: () => 'columns rise on the beat. weave.' },
      { bars: 8, look: 'fold', energy: 0.8, spawn: { rings: RINGS(55, [2, 5]), orbs: ORBS(26, ['arc', 'high']) }, caption: () => 'the sea folds up ahead' },
      { bars: 6, look: 'calm', energy: 0.3 },
    ],
  },
  {
    id: 'moire', name: 'Moiré', sub: 'II', palette: 'night', song: 1, drain: 0.022, par: 11000,
    blurb: 'interference. every hill is a valley from the other side.',
    sections: [
      { bars: 6, look: 'chop', energy: 0.35, spawn: { orbs: ORBS(28) } },
      { bars: 10, look: 'moire', energy: 0.5, spawn: { orbs: ORBS(26), rings: RINGS(80) }, caption: d => `press <b>${key(d).flip}</b> to turn the sea inside out — crests become troughs` },
      { bars: 10, look: 'vortex', energy: 0.6, spawn: { orbs: ORBS(24, ['high', 'arc']), rings: RINGS(70, [1, 3]) }, caption: () => 'flip while you sit in a trough and it throws you into the air' },
      { bars: 10, look: 'dunes', energy: 0.65, set: { moire: 0.6, lRings: 0.4, lCross: 0.6 }, spawn: { orbs: ORBS(22, ['high', 'slalom']), pillars: PILLARS(0.35) } },
      { bars: 10, look: 'steps', energy: 0.8, spawn: { pillars: PILLARS(0.45, [4, 9]), rings: RINGS(70, [0.5, 3]) } },
      { bars: 8, look: 'turn', energy: 0.85, set: { moire: 0.5 }, spawn: { rings: RINGS(50, [0, 3]), orbs: ORBS(24) } },
      { bars: 6, look: 'chop', energy: 0.3 },
    ],
  },
  {
    id: 'hands', name: 'Hands', sub: 'III', palette: 'sepia', song: 2, drain: 0.024, par: 12000,
    blurb: 'something underneath is reaching up.',
    sections: [
      { bars: 6, look: 'lanes', energy: 0.35, spawn: { orbs: ORBS(28) } },
      { bars: 12, look: 'silk', energy: 0.5, set: { lCross: 0.5, lContour: 0.5 }, hands: [HAND(1, 0), HAND(6, -5, { pitch: 0.95, curl: 0.35 })], spawn: { orbs: ORBS(30, ['arc']) }, caption: () => 'the sea has hands. ride up the palm and off the fingers' },
      { bars: 10, look: 'steps', energy: 0.65, hands: [HAND(2, 6, { s: 30 })], spawn: { pillars: PILLARS(0.4), orbs: ORBS(26) } },
      { bars: 10, look: 'contour', energy: 0.7, hands: [HAND(1, -6), HAND(5, 6, { pitch: 0.8 })], spawn: { rings: RINGS(60, [1, 4]), orbs: ORBS(24, ['high', 'arc']) } },
      { bars: 8, look: 'rollers', energy: 0.85, hands: [HAND(2, 0, { s: 44, curl: 0.45 })], spawn: { pillars: PILLARS(0.5), rings: RINGS(70) } },
      { bars: 6, look: 'lanes', energy: 0.3 },
    ],
  },
  {
    id: 'tunnel', name: 'Tunnel', sub: 'IV', palette: 'chrome', song: 3, drain: 0.025, par: 13000,
    blurb: 'the sea rolls itself up. there is no down.',
    sections: [
      { bars: 6, look: 'chop', energy: 0.4, spawn: { orbs: ORBS(26) } },
      { bars: 12, look: 'tube', energy: 0.6, morph: 4, spawn: { orbs: ORBS(22, ['slalom', 'line']), rings: RINGS(70, [0, 2]) }, caption: d => `the sea rolls into a tunnel. ${key(d).steer} takes you all the way around` },
      { bars: 10, look: 'tubeRings', energy: 0.7, spawn: { rings: RINGS(50, [0, 1.5]), pillars: PILLARS(0.45, [2.5, 5]) } },
      { bars: 10, look: 'between', energy: 0.75, morph: 4, spawn: { orbs: ORBS(24, ['high', 'arc']), rings: RINGS(60, [1, 4]) }, caption: () => 'between two seas' },
      { bars: 10, look: 'tube', energy: 0.9, set: { twist: 4, freq: 1.2, swell: 1.8 }, spawn: { pillars: PILLARS(0.6, [2.5, 4.5]), orbs: ORBS(22) } },
      { bars: 6, look: 'calm', energy: 0.3, morph: 4 },
    ],
  },
  {
    id: 'cherry', name: 'Cherry', sub: 'V', palette: 'cherry', song: 4, drain: 0.027, par: 15000,
    blurb: 'everything at once, and then a face.',
    sections: [
      { bars: 6, look: 'silk', energy: 0.45, spawn: { orbs: ORBS(26) } },
      { bars: 10, look: 'moire', energy: 0.6, hands: [HAND(2, 5), HAND(6, -5)], spawn: { orbs: ORBS(24), rings: RINGS(70) } },
      { bars: 10, look: 'tube', energy: 0.75, spawn: { rings: RINGS(55, [0, 2]), pillars: PILLARS(0.4, [2.5, 4.5]) } },
      { bars: 12, look: 'face', energy: 0.65, morph: 5, face: 190, spawn: { orbs: ORBS(30, ['arc']) }, caption: () => 'a face rises out of the sea. ride through it' },
      { bars: 10, look: 'face', energy: 0.8, set: { swell: 1.6 }, face: 200, spawn: { orbs: ORBS(26, ['high']) }, caption: d => `another. turn the sea inside out (<b>${key(d).flip}</b>) and it becomes a hollow mask — it still looks out at you` },
      { bars: 8, look: 'rollers', energy: 1, spawn: { rings: RINGS(45, [0, 4]), pillars: PILLARS(0.6), orbs: ORBS(22) } },
      { bars: 6, look: 'calm', energy: 0.3 },
    ],
  },
];

// free ride: the sea wanders through every look, sixteen bars each (or pick one with 1–9)
export const DRIFT_LOOKS = ['silk', 'moire', 'vortex', 'dunes', 'tube', 'steps', 'between', 'fold', 'face', 'chop', 'contour', 'tubeRings', 'turn', 'rollers', 'lanes'];

export function driftDream(palette = 'bone') {
  return {
    id: 'drift', name: 'Drift', sub: '∞', palette, song: 0, drain: 0, free: true, par: 0,
    sections: DRIFT_LOOKS.map((look, i) => ({
      bars: 16, look, energy: 0.4 + 0.4 * ((i * 7) % 5) / 4, morph: 4,
      face: look === 'face' ? 130 : undefined,
      spawn: { orbs: ORBS(28), rings: RINGS(80, [0, 3]), pillars: i % 3 === 2 ? PILLARS(0.35) : null },
      hands: look === 'contour' || look === 'lanes' ? [HAND(3, 0), HAND(9, -6)] : undefined,
    })),
  };
}

// a dream cut from your own song: its sections become the sea's sections, louder parts get rougher seas
const QUIET = ['calm', 'silk', 'lanes', 'contour', 'between'];
const MID = ['moire', 'dunes', 'vortex', 'tubeRings', 'fold', 'face'];
const LOUD = ['rollers', 'steps', 'tube', 'turn', 'chop'];
export function songDream(an, name = 'your song') {
  const barLen = an.beatPeriod * (an.meter === 3 ? 3 : 4);
  const bounds = [0, ...an.boundaries.filter(t => t > 8 && t < an.duration - 8), an.duration];
  const sections = [];
  let seed = 7;
  const pick = list => list[(seed = (seed * 9301 + 49297) % 233280) % list.length];
  for (let i = 0; i < bounds.length - 1; i++) {
    const t0 = bounds[i], t1 = bounds[i + 1];
    let loud = 0, n = 0;
    for (let t = t0; t < t1; t += 0.5) { loud += an.slow[Math.min(an.slow.length - 1, Math.floor(t * an.fps))] || 0; n++; }
    loud /= Math.max(1, n);
    const look = pick(loud < 0.35 ? QUIET : loud < 0.65 ? MID : LOUD);
    const bars = Math.max(2, Math.round((t1 - t0) / barLen));
    sections.push({
      bars, look, energy: loud, morph: Math.min(4, bars / 2),
      face: look === 'face' ? 140 : undefined,
      spawn: { orbs: ORBS(26), rings: loud > 0.3 ? RINGS(loud > 0.6 ? 55 : 80, [0, 3]) : null, pillars: loud > 0.55 ? PILLARS(0.45) : null },
      hands: look === 'contour' || look === 'lanes' || look === 'silk' ? [HAND(2, 0)] : undefined,
    });
  }
  return { id: 'song', name, sub: '♪', palette: 'bone', song: -1, drain: 0.014, par: 0, sections, barLen };
}
