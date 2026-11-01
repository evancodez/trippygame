// The songs. Each is a run of scenes; a scene is one musical phrase (in bars of 6/8 at 70 bpm,
// ~1.7 s a bar) in which the sheet becomes a new equation and you get one thing to do.
// The sheet is 24 × 24: x runs across, y runs away from you; the middle is 0, 0.
//
//   shape   resting shape weights (bowl, dome, saddle, tilt, swells, rings, ridges, funnel, face, hollow)
//   lines   how the fabric is drawn (LINE_LOOKS)
//   goal    eye (pearl into an eye) · pearls (every pearl into an eye) · gather (touch every light) · ink (feed the ink to the eyes)
//   eyes    [x, y, half-width, half-height, angle]   tears [x, y, rx, ry]   motes [x, y, height]   ink [x, y]
//   blink   'bar' (open for the first half of each bar) or 'beat'     drift [dx, dy, cycles per bar]
//   hidden  the eye can't be seen until your hand finds it          rival [x, y]: another hand
//   drum    the sheet thumps on every beat

const H = Math.PI / 2;
// the visualizer's line equation, as named looks (they morph into each other between scenes)
export const LINE_LOOKS = {
  silk:     { freq: 17, linA: H, wLin: 1, wRad: 0, radLog: 0, radInv: 0, wAng: 0, spokes: 6, check: 0, checkA: H, moire: 0, moireOff: 0.3, contour: 0, twist: 0, bulge: 0, refract: 0.9, engrave: 0.55, thick: 0, flow: 0.15 },
  diag:     { freq: 15, linA: 0.75, wLin: 1, wRad: 0, radLog: 0, radInv: 0, wAng: 0, spokes: 6, check: 0, checkA: H, moire: 0, moireOff: 0.3, contour: 0, twist: 0.6, bulge: 0, refract: 0.9, engrave: 0.6, thick: 0, flow: 0.2 },
  rings:    { freq: 14, linA: H, wLin: 0, wRad: 1, radLog: 0, radInv: 0, wAng: 0, spokes: 6, check: 0, checkA: H, moire: 0, moireOff: 0.3, contour: 0, twist: 0, bulge: 0, refract: 0.8, engrave: 0.6, thick: 0, flow: 0.35 },
  tunnel:   { freq: 9, linA: H, wLin: 0, wRad: 1, radLog: 0.4, radInv: 0.5, wAng: 0, spokes: 6, check: 0, checkA: H, moire: 0, moireOff: 0.3, contour: 0, twist: 0, bulge: 0.3, refract: 0.7, engrave: 0.6, thick: 0, flow: 0.5 },
  spiral:   { freq: 11, linA: H, wLin: 0, wRad: 1, radLog: 0.2, radInv: 0, wAng: 1, spokes: 3, check: 0, checkA: H, moire: 0, moireOff: 0.3, contour: 0, twist: 0.4, bulge: 0, refract: 0.8, engrave: 0.6, thick: 0, flow: 0.4 },
  check:    { freq: 12, linA: H, wLin: 1, wRad: 0, radLog: 0, radInv: 0, wAng: 0, spokes: 6, check: 1, checkA: H, moire: 0, moireOff: 0.3, contour: 0, twist: 0, bulge: 0.35, refract: 0.9, engrave: 0.5, thick: 0, flow: 0.1 },
  moire:    { freq: 16, linA: H, wLin: 0, wRad: 1, radLog: 0, radInv: 0, wAng: 0, spokes: 6, check: 0, checkA: H, moire: 1, moireOff: 0.35, contour: 0, twist: 0, bulge: 0, refract: 0.8, engrave: 0.6, thick: 0, flow: 0.3 },
  contour:  { freq: 12, linA: H, wLin: 0.25, wRad: 0, radLog: 0, radInv: 0, wAng: 0, spokes: 6, check: 0, checkA: H, moire: 0, moireOff: 0.3, contour: 1, twist: 0, bulge: 0, refract: 0.5, engrave: 0.8, thick: 0, flow: 0.2 },
};

const s = (bars, o) => ({ bars, ...o });
const ring = (n, r, z = 0.9, a0 = 0) => Array.from({ length: n }, (_, i) => [Math.cos(a0 + (i / n) * Math.PI * 2) * r, Math.sin(a0 + (i / n) * Math.PI * 2) * r, z]);
// the face's eyes and mouth, where faceH puts them (FACE_S = 16)
const FACE_EYES = [[-2.4, 0.75, 1.25, 0.75], [2.4, 0.75, 1.25, 0.75]];

export const SONGS = [
  {
    id: 'silk', name: 'Silk', sub: 'I', palette: 'bone', music: 0, energy: 0.35,
    blurb: 'learn the fabric',
    scenes: [
      s(14, { lines: 'silk', pearl: [0, -5], eyes: [[0, 6]], caption: d => `you're underneath the sheet. hold <b>${d.push}</b> just behind the pearl and it rolls away from your hand` }),
      s(12, { lines: 'silk', pearl: [-7, -7], motes: [[-4, -4], [-1, -1], [2, 2], [5, 5]], goal: 'gather', caption: () => 'roll it through the lights' }),
      s(12, { shape: { bowl: 1 }, lines: 'rings', pearl: [-7, 0], eyes: [[5, 5]], caption: d => `the sheet is a bowl now. hold <b>${d.press}</b> to press a well into it and catch the pearl` }),
      s(12, { shape: { swells: 1 }, lines: 'diag', pearl: [0, -7], motes: [[-6, 0], [-3, 3], [0, 5], [3, 3], [6, 0]], goal: 'gather', caption: () => 'it breathes with the music' }),
      s(12, { drum: true, lines: 'check', pearl: [0, -3], motes: [[-4, 2, 3], [0, 4, 3.6], [4, 2, 3]], goal: 'gather', caption: d => `push right on the beat and your hand snaps up — hard enough to throw` }),
      s(14, { lines: 'tunnel', pearl: [0, -7], eyes: [[0, 5]], blink: 'bar', caption: () => 'this eye is only open for the first half of every bar' }),
    ],
  },
  {
    id: 'moire', name: 'Moiré', sub: 'II', palette: 'night', music: 1, energy: 0.5,
    blurb: 'tears, ink, and an eye you can’t see',
    scenes: [
      s(14, { lines: 'moire', pearl: [0, -8], eyes: [[0, 7]], tears: [[0, 0, 2.4, 1.3], [-6, 3], [6, 3]], caption: () => 'tears in the fabric. it falls through those' }),
      s(16, { lines: 'rings', pearl: [0, -8], eyes: [[0, 4]], ink: [[-7, 7], [7, 7]], goal: 'ink', caption: () => 'ink hates your light and wants the pearl. herd it into the eye' }),
      s(12, { shape: { saddle: 1 }, lines: 'diag', pearl: [0, 0], motes: ring(6, 6.5), goal: 'gather' }),
      s(14, { lines: 'spiral', pearl: [-6, -7], eyes: [[3, 4]], drift: [5, 4, 0.12], caption: () => 'eyes wander' }),
      s(16, { lines: 'moire', pearl: [0, -7], eyes: [[5, 6]], hidden: true, caption: () => 'there’s an eye under here somewhere. feel for it with your hand' }),
      s(16, { shape: { rings: 1 }, lines: 'rings', pearl: [0, -8], eyes: [[0, 7]], tears: [[-4, 1], [4, 1], [0, 3.5, 1.5, 0.9]], ink: [[-8, 8]], blink: 'bar' }),
    ],
  },
  {
    id: 'hands', name: 'Hands', sub: 'III', palette: 'sepia', music: 2, energy: 0.6,
    blurb: 'someone else is under here too',
    scenes: [
      s(16, { lines: 'silk', pearl: [0, -5], eyes: [[0, 6]], rival: [0, 9], caption: () => 'another hand. it doesn’t want this' }),
      s(14, { shape: { tilt: 1 }, lines: 'diag', pearl: [-6, -6], motes: [[6, -6], [6, 0], [6, 6], [-6, 6]], goal: 'gather', caption: () => 'the sheet sways on the bar' }),
      s(16, { lines: 'contour', pearls: [[-5, -6], [5, -6]], eyes: [[-5, 6], [5, 6]], goal: 'pearls', caption: () => 'two pearls, two eyes' }),
      s(16, { shape: { dome: 1 }, lines: 'rings', pearl: [0, 0], eyes: [[-8, 8], [8, 8]], rival: [0, -9] }),
      s(16, { lines: 'check', pearl: [0, -7], eyes: [[0, 7]], rival: [0, 9], ink: [[-7, 4], [7, 4]] }),
    ],
  },
  {
    id: 'vortex', name: 'Vortex', sub: 'IV', palette: 'chrome', music: 3, energy: 0.7,
    blurb: 'whirlpools and ridges',
    scenes: [
      s(14, { shape: { funnel: 1 }, lines: 'spiral', pearl: [-8, -8], eyes: [[0, 0, 1.6, 1.1]], blink: 'beat', caption: () => 'a whirlpool. its eye blinks on the beat' }),
      s(14, { shape: { ridges: 1 }, lines: 'rings', pearl: [0, 0], motes: ring(4, 9.2, 0.9, 0.785), goal: 'gather', caption: () => 'ridges. throw it over them' }),
      s(14, { shape: { funnel: 0.7 }, drum: true, lines: 'tunnel', pearl: [0, -9], motes: ring(5, 4.5, 3.2), tears: [[-7, 6], [7, 6]], goal: 'gather' }),
      s(16, { shape: { rings: 1 }, lines: 'moire', pearl: [0, -8], eyes: [[0, 6]], ink: [[-8, 0], [8, 0], [0, 9]], goal: 'ink' }),
      s(16, { drum: true, lines: 'spiral', pearl: [0, -6], eyes: [[0, 4]], drift: [6, 3, 0.1], rival: [0, 9] }),
    ],
  },
  {
    id: 'cherry', name: 'Cherry', sub: 'V', palette: 'cherry', music: 4, energy: 0.8,
    blurb: 'a face rises out of the sheet',
    scenes: [
      s(12, { shape: { swells: 1 }, lines: 'silk', pearl: [0, -7], motes: [[-7, 2], [-3, 6], [3, 6], [7, 2], [0, 0, 3]], goal: 'gather' }),
      s(18, { shape: { face: 1 }, morph: 4, lines: 'silk', pearl: [0, -9.5], eyes: [FACE_EYES[1]], caption: () => 'a face rises out of the sheet. give it back an eye' }),
      s(14, { shape: { face: 1 }, lines: 'contour', pearl: [-7, -8], eyes: [[0, -4.2, 1.9, 0.75]], blink: 'beat', caption: () => 'it sings. feed it on the beat' }),
      s(18, { shape: { hollow: 1 }, morph: 3, lines: 'silk', pearls: [[-6, -8], [6, -8]], eyes: FACE_EYES, goal: 'pearls', caption: () => 'now it’s pressed in, hollow — and it still seems to look at you' }),
      s(18, { shape: { swells: 0.7 }, drum: true, lines: 'moire', pearl: [0, -8], eyes: [[0, 6]], drift: [5, 2, 0.1], tears: [[-6, 0], [6, 0]], ink: [[-9, 9], [9, 9]], rival: [0, 10] }),
    ],
  },
];

// light, ink, the dark underneath, accent, and the second accent (the other hand)
export const PALETTES = {
  bone:   { paper: '#f2f0ea', ink: '#0b0b0b', void: '#050505', accent: '#e0104f', rival: '#2f5cff' },
  night:  { paper: '#0b0b0d', ink: '#ece9e2', void: '#000000', accent: '#2ee6c9', rival: '#ff4d6d' },
  sepia:  { paper: '#efe4d0', ink: '#1d140d', void: '#0d0805', accent: '#ff5a1f', rival: '#3a7bff' },
  chrome: { paper: '#0c0d10', ink: '#d6dae2', void: '#000000', accent: '#c6f03a', rival: '#ff3d9a' },
  cherry: { paper: '#7a0326', ink: '#ffd9df', void: '#1a0008', accent: '#ffffff', rival: '#36e0c8' },
};

// free play: every scene of every song, one after another, nothing to lose
export function freeSong(palette = 'bone') {
  return { id: 'free', name: 'Free', sub: '∞', palette, music: 0, energy: 0.5, scenes: SONGS.flatMap(x => x.scenes).map(sc => ({ ...sc, caption: undefined })) };
}
