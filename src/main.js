import { Input } from './input.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { UI, h, fmtTime, fmtScore } from './ui.js';
import { Ride, PHYS, autopilot } from './ride.js';
import { DREAMS, DRIFT_LOOKS, PALETTES, driftDream, songDream } from './dreams.js';
import { toWorld, upAt, curlK } from './sea.js';
import { analyzeAudio } from './analysis.js';
import { MAX } from './shader.js';

const canvas = document.getElementById('sea');
let renderer;
try { renderer = new Renderer(canvas); } catch (e) {
  document.getElementById('fatal').hidden = false;
  throw e;
}
const input = new Input(canvas);
const sound = new Sound();
const ui = new UI(document.getElementById('overlay'), sound);

// ———————————————————————————————————————— saved progress + settings
const SAVE_KEY = 'sealines.save.v1';
const save = (() => {
  const d = { unlocked: 1, best: {}, settings: { music: 0.6, sfx: 0.8, shake: true, calm: false, quality: 'auto', mouseSteer: true, unlockAll: false, palette: 'bone' } };
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s) return { ...d, ...s, settings: { ...d.settings, ...s.settings } }; } catch {}
  return d;
})();
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} };
const S = save.settings;
input.mouseSteer = S.mouseSteer;

// ———————————————————————————————————————— state
let mode = 'title';           // title | select | ride | pause | results
let ride = null;              // the ride on screen (behind the menus it's the autopilot)
let kind = 'attract';         // attract | dream | drift | song
let dreamIndex = 0;
let songName = '';
const cam = { u: 0, n: 3, v: -8, init: false, lookX: 0, lookY: 0, fov: 1 };
let time = 0, flash = 0, fade = 1, shake = 0, invertAmt = 0, staticAmt = 0;
let introT = 1, endT = 0;
let hudHidden = false;
let lastBeat = -1;
let lastMult = 1;
let fadingShown = false;

const keyName = () => (input.state.device === 'pad' ? 'pad' : 'keys');
const glyph = () => (keyName() === 'pad'
  ? { go: '✕', back: '○', dive: '✕ / R2', flip: '□', pause: 'options' }
  : { go: 'enter', back: 'esc', dive: 'space', flip: 'E', pause: 'esc' });

function rumble(a, b, ms) { if (kind !== 'attract') input.rumble(a, b, ms); }

// ———————————————————————————————————————— starting rides
function attract() {
  kind = 'attract';
  ride = new Ride(driftDream(S.palette), { seed: (Math.random() * 1e9) | 0 });
  ride.ball.n = 2;
  cam.init = false;
  introT = 1; endT = 0;
  input.playing = false;
}

function begin(r, k) {
  ride = r;
  kind = k;
  mode = 'ride';
  ui.hide();
  ui.caption('');
  cam.init = false;
  introT = 0; endT = 0; fade = 1; lastMult = 1; fadingShown = false;
  input.playing = true;
}

function startDream(i) {
  dreamIndex = i;
  const d = DREAMS[i];
  sound.start();
  sound.stop();
  sound.play(d.song, 0.3);
  begin(new Ride(d, { seed: 1000 + i * 77 + ((Math.random() * 1000) | 0) }), 'dream');
  ui.toast(`<small>${d.sub}</small><b>${d.name}</b><em>${d.blurb}</em>`, 3400);
}

function startDrift() {
  sound.start();
  sound.stop();
  sound.play(0, 0.5);
  begin(new Ride(driftDream(S.palette), { seed: (Math.random() * 1e9) | 0 }), 'drift');
  ui.toast('<small>∞</small><b>Drift</b><em>no fading, no score. just the sea.</em>', 3000);
  setTimeout(() => mode === 'ride' && kind === 'drift' && ui.caption(`<b>1–9</b> change the sea · <b>[ ]</b> colors · drop a song anywhere · <b>H</b> hides everything`, 9000), 3200);
}

function startSong(buffer, an, name) {
  songName = name;
  const d = songDream(an, name);
  d.palette = S.palette;
  begin(new Ride(d, { seed: 4242 }), 'song');
  sound.playTrack(buffer, an);
  ui.toast(`<small>♪ ${Math.round(an.bpm)} bpm</small><b>${name}</b><em>${d.sections.length} sections, cut from your song</em>`, 3600);
}

function restart() {
  if (kind === 'dream') startDream(dreamIndex);
  else if (kind === 'drift') startDrift();
  else if (kind === 'song' && sound.track) { const { buffer, an } = sound.track; startSong(buffer, an, songName); }
}

// ———————————————————————————————————————— screens
function titleScreen() {
  mode = 'title';
  if (!ride || kind !== 'attract') attract();
  ui.setHud('');
  ui.caption('');
  const g = glyph();
  ui.show({
    class: 'title',
    top: h('div', { class: 'logo', html: 'sea<br>of lines' }),
    subtitle: 'ride a pearl across a dream made of lines',
    items: [
      { label: 'Dream', sub: 'five dreams, each a song', action: () => { sound.start(); selectScreen(); } },
      { label: 'Drift', sub: 'free ride, no fading', action: () => startDrift() },
      { label: 'Your song', sub: 'drop in an mp3 — the sea is cut from it', action: () => { sound.start(); pickSong(); } },
      { label: 'How to ride', action: () => { sound.start(); controlsScreen(titleScreen); } },
      { label: 'Settings', action: () => { sound.start(); settingsScreen(titleScreen); } },
    ],
    footer: `keyboard + mouse or a PS5 controller · <b>${g.go}</b> to choose`,
  });
}

function selectScreen() {
  mode = 'select';
  if (!ride || kind !== 'attract') attract();
  ui.setHud('');
  const unlocked = S.unlockAll ? DREAMS.length : save.unlocked;
  const g = glyph();
  ui.show({
    class: 'select',
    title: 'Dreams',
    grid: DREAMS.length,
    back: titleScreen,
    items: DREAMS.map((d, i) => {
      const b = save.best[d.id];
      const locked = i >= unlocked;
      const marks = b ? '◆'.repeat(b.marks) + '◇'.repeat(3 - b.marks) : '◇◇◇';
      const card = h('div', { class: `dream-card pal-${d.palette}${locked ? ' locked' : ''}` },
        h('div', { class: 'dream-art' }, h('span', {}, d.sub)),
        h('b', {}, d.name),
        h('small', {}, locked ? 'clear the one before to wake this one' : d.blurb),
        h('div', { class: 'dream-stats' }, h('span', {}, b ? fmtScore(b.score) : locked ? 'locked' : 'new'), h('span', { class: 'marks' }, marks)));
      return { card, disabled: locked, action: () => startDream(i) };
    }),
    focus: Math.min(unlocked - 1, Math.max(0, DREAMS.findIndex(d => !save.best[d.id]))),
    footer: `<b>${g.go}</b> to dream · <b>${g.back}</b> to go back`,
  });
}

function controlsScreen(back) {
  ui.show({
    class: 'controls',
    title: 'How to ride',
    back,
    body: h('div', { class: 'controls-table', html: `
      <div><b>Steer</b><span>← → · A D · or point with the mouse</span><span>left stick · d-pad</span></div>
      <div><b>Dive</b><span>hold space · S · or the left mouse button</span><span>hold ✕ · R2</span></div>
      <div><b>Flip the sea</b><span>E · Q · shift · or right-click</span><span>□ · ○ · L1 · R1</span></div>
      <div><b>Look</b><span>—</span><span>right stick</span></div>
      <div><b>Pause · restart</b><span>esc · R</span><span>options · create</span></div>
      <div><b>Hide everything</b><span>H</span><span>—</span></div>
      <p><b>Dive</b> makes you heavy. Hold it going down the far side of a wave and you'll pick up speed, let go going up the near side and you'll fly off the top. Land going <i>with</i> the slope for a smooth landing; land against it and it hurts.</p>
      <p><b>Flip</b> turns the sea inside out: every crest becomes a trough and every trough a crest. Flip while you're sitting low in a trough and the sea throws you into the air.</p>
      <p>Orbs, rings, smooth landings and air keep the dream going. If it thins out, the static closes in — catch something quick.</p>` }),
    items: [{ label: 'Back', action: back }],
  });
}

function settingsScreen(back) {
  ui.show({
    class: 'settings',
    title: 'Settings',
    back,
    items: [
      { label: 'Music', value: S.music, min: 0, max: 1, step: 0.1, onChange: v => { S.music = v; sound.setVolumes(S.music, S.sfx); persist(); } },
      { label: 'Sounds', value: S.sfx, min: 0, max: 1, step: 0.1, onChange: v => { S.sfx = v; sound.setVolumes(S.music, S.sfx); persist(); } },
      { label: 'Detail', value: ['low', 'auto', 'high'].indexOf(S.quality), min: 0, max: 2, step: 1, format: v => ['low', 'auto', 'high'][Math.round(v)], onChange: v => { S.quality = ['low', 'auto', 'high'][Math.round(v)]; scale = 1; persist(); } },
      { label: 'Colors in Drift', value: Object.keys(PALETTES).indexOf(S.palette), min: 0, max: Object.keys(PALETTES).length - 1, step: 1, format: v => Object.keys(PALETTES)[Math.round(v)], onChange: v => { S.palette = Object.keys(PALETTES)[Math.round(v)]; persist(); } },
      { label: 'Steer with the mouse', toggle: S.mouseSteer, onChange: v => { S.mouseSteer = v; input.mouseSteer = v; persist(); } },
      { label: 'Screen shake', toggle: S.shake, onChange: v => { S.shake = v; persist(); } },
      { label: 'Reduce flashing', toggle: S.calm, onChange: v => { S.calm = v; persist(); } },
      { label: 'Unlock every dream', toggle: S.unlockAll, onChange: v => { S.unlockAll = v; persist(); } },
      { label: 'Back', action: back },
    ],
  });
}

function pauseScreen() {
  mode = 'pause';
  sound.suspend();
  input.playing = false;
  const name = kind === 'dream' ? DREAMS[dreamIndex].name : kind === 'song' ? songName : 'Drift';
  ui.show({
    class: 'pause',
    title: 'Paused',
    subtitle: name,
    back: resume,
    items: [
      { label: 'Keep riding', action: resume },
      { label: 'Start over', action: () => { sound.resume(); restart(); } },
      { label: 'How to ride', action: () => controlsScreen(pauseScreen) },
      { label: 'Settings', action: () => settingsScreen(pauseScreen) },
      { label: 'Wake up', sub: 'back to the title', action: () => { sound.resume(); sound.stop(); titleScreen(); } },
    ],
  });
}
function resume() { ui.hide(); mode = 'ride'; sound.resume(); input.playing = true; }

function resultsScreen() {
  mode = 'results';
  input.playing = false;
  ui.setHud('');
  ui.caption('');
  const r = ride, st = r.stats, cleared = r.done === 'clear';
  const d = r.dream;
  let marks = 0, prev = null;
  if (kind === 'dream') {
    marks = cleared ? 1 + (r.score >= d.par ? 1 : 0) + (r.score >= d.par * 1.6 ? 1 : 0) : 0;
    prev = save.best[d.id];
    if (cleared) {
      save.best[d.id] = { score: Math.max(prev?.score || 0, Math.round(r.score)), marks: Math.max(prev?.marks || 0, marks) };
      save.unlocked = Math.max(save.unlocked, Math.min(DREAMS.length, dreamIndex + 2));
      persist();
    }
  }
  const last = kind === 'dream' && dreamIndex === DREAMS.length - 1;
  const stat = (k, v, em) => h('div', {}, h('small', {}, k), h('b', {}, v), em ? h('em', {}, em) : null);
  ui.show({
    class: 'results',
    title: cleared ? (last ? 'and then you woke, smiling' : 'the dream lets you go') : 'you woke up',
    subtitle: `${d.sub} · ${d.name}${cleared ? '' : ` · ${Math.round(r.progress * 100)}% of the way`}`,
    body: h('div', {},
      h('div', { class: 'big-score' }, fmtScore(r.score), kind === 'dream' && cleared ? h('span', { class: 'marks' }, '◆'.repeat(marks) + '◇'.repeat(3 - marks)) : null,
        prev && cleared && r.score > prev.score ? h('em', {}, 'new best') : null),
      h('div', { class: 'results-grid' },
        stat('distance', `${Math.round(st.dist)} m`), stat('orbs', st.orbs), stat('rings', st.rings),
        stat('smooth landings', st.smooth), stat('flip pops', st.pops), stat('longest air', `${st.bestAir.toFixed(1)} s`))),
    items: [
      ...(cleared && kind === 'dream' && !last ? [{ label: 'Next dream', action: () => startDream(dreamIndex + 1) }] : []),
      { label: cleared ? 'Ride it again' : 'Try again', action: restart },
      { label: kind === 'dream' ? 'Dreams' : 'Title', action: kind === 'dream' ? () => { sound.stop(); selectScreen(); } : () => { sound.stop(); titleScreen(); } },
    ],
  });
}

// ———————————————————————————————————————— your own song
const fileInput = document.getElementById('songFile');
function pickSong() { fileInput.value = ''; fileInput.click(); }
fileInput.addEventListener('change', () => fileInput.files[0] && loadSong(fileInput.files[0]));
addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('audio') || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name));
  if (f) loadSong(f);
});
async function loadSong(file) {
  sound.start();
  const name = file.name.replace(/\.[^.]+$/, '');
  try {
    ui.toast(`<small>listening</small><b>${name}</b><em>finding the beat…</em>`, 60000);
    const buf = await file.arrayBuffer();
    const [an, decoded] = await Promise.all([
      analyzeAudio(buf, step => ui.toast(`<small>listening</small><b>${name}</b><em>${step.toLowerCase()}…</em>`, 60000)),
      sound.ctx.decodeAudioData(buf.slice(0)),
    ]);
    startSong(decoded, an, name);
  } catch (err) {
    console.error(err);
    ui.toast(`<b>couldn't read that song</b><em>try an mp3 or wav</em>`, 3000);
  }
}

// drift: number keys pick the sea, brackets the colors
addEventListener('keydown', e => {
  if (mode !== 'ride' || !ride || kind !== 'drift') return;
  const n = '1234567890'.indexOf(e.key);
  if (n >= 0 && DRIFT_LOOKS[n]) { ride.setLook(DRIFT_LOOKS[n]); ui.caption(`the sea: <b>${DRIFT_LOOKS[n]}</b>`, 2000); }
  if (e.key === '[' || e.key === ']') {
    const names = Object.keys(PALETTES);
    S.palette = names[(names.indexOf(S.palette) + (e.key === ']' ? 1 : names.length - 1)) % names.length];
    ride.sea.params.to(PALETTES[S.palette], 1.5);
    persist();
    ui.caption(`colors: <b>${S.palette}</b>`, 2000);
  }
});

// ———————————————————————————————————————— things happening on the sea
function handleEvents() {
  const live = kind !== 'attract';
  for (const e of ride.events) {
    if (!live) continue;
    switch (e.type) {
      case 'section':
        if (kind === 'dream' || kind === 'song') sound.setEnergy(e.energy);
        if (e.caption) ui.caption(e.caption(keyName()), 8000);
        break;
      case 'orb': sound.sfx('orb'); break;
      case 'ring': sound.sfx('ring'); ui.pop('ring', 'ring'); flash = Math.max(flash, 0.1); rumble(0.15, 0.5, 120); break;
      case 'smooth': sound.sfx('smooth'); ui.pop('smooth'); rumble(0.05, 0.35, 70); break;
      case 'rough': sound.sfx('rough'); ui.pop('rough', 'bad'); shake = Math.max(shake, 0.35); rumble(0.8, 0.3, 160); break;
      case 'land': sound.sfx('land', e); if (e.impact > 8) rumble(0.3, 0.1, 70); break;
      case 'air': if (e.air > 1) ui.pop(`air ${e.air.toFixed(1)}s`); sound.sfx('air'); break;
      case 'flip': sound.sfx('flip'); rumble(0.35, 0.35, 140); break;
      case 'pop': sound.sfx('pop'); ui.pop('flip pop', 'hot'); shake = Math.max(shake, 0.25); rumble(0.9, 0.6, 180); break;
      case 'bonk': sound.sfx('bonk'); ui.pop('bonk', 'bad'); shake = Math.max(shake, 0.45); rumble(1, 0.5, 220); break;
      case 'hand': sound.sfx('hand'); break;
      case 'through': sound.sfx('through'); flash = Math.max(flash, 0.3); ui.pop('through', 'hot'); rumble(0.4, 0.9, 300); break;
      case 'clear': sound.sfx('clear'); rumble(0.3, 0.8, 500); break;
      case 'woke': sound.sfx('woke'); rumble(1, 1, 600); break;
      default:
    }
  }
  ride.events.length = 0;
  if (!live) return;
  const m = ride.mult;
  if (m > lastMult) ui.pop(`×${m}`, 'mult');
  lastMult = m;
  if (ride.fading > 0 && !fadingShown) { fadingShown = true; sound.sfx('fade'); ui.pop('fading — catch something', 'bad'); }
  if (ride.fading === 0) fadingShown = false;
  if (!S.shake) shake = 0;
}

// ———————————————————————————————————————— the camera
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mix = (a, b, t) => a + (b - a) * t;
const ease = x => x * x * (3 - 2 * x);

function camera(dt, inp) {
  const b = ride.ball, sea = ride.sea, P = sea.p;
  const sp = Math.hypot(b.vu, b.vv);
  const back = 6.4 + sp * 0.05, high = 2.2 + sp * 0.025;
  if (!cam.init) { cam.u = b.u; cam.v = b.v - back; cam.n = b.n + high; cam.init = true; }
  cam.u += (b.u - cam.u) * (1 - Math.exp(-dt * 3.5));
  cam.v = b.v - back;
  const ground = sea.height(cam.u, cam.v);
  cam.n += (Math.max(b.n + high * 0.8, ground + 1.8) - cam.n) * (1 - Math.exp(-dt * 3.5));
  cam.n = Math.max(cam.n, ground + 1.1);
  cam.lookX += ((inp.look?.x || 0) - cam.lookX) * (1 - Math.exp(-dt * 6));
  cam.lookY += ((inp.look?.y || 0) - cam.lookY) * (1 - Math.exp(-dt * 6));
  let pu = cam.u, pn = cam.n, pv = cam.v;
  let lu = b.u + cam.lookX * 6, ln = b.n + 0.9 + cam.lookY * 4, lv = b.v + 9 + sp * 0.12;
  // a mask rising ahead pulls your eyes up to it
  const ahead = P.faceV - b.v;
  if (P.face > 0.02 && ahead > 0 && ahead < 220) ln += P.face * Math.min(1, ahead / 60) * Math.min(1, (220 - ahead) / 60) * P.faceS * 0.18;
  // the opening swoop: from high above, down behind the pearl
  if (introT < 1) {
    const e = ease(introT);
    pn = mix(b.n + 26, pn, e); pv = mix(b.v - 30, pv, e); ln = mix(b.n, ln, e); lv = mix(b.v + 30, lv, e);
  }
  // the end: rise and look up at the sun (or into the static)
  if (ride.done && kind !== 'attract') {
    const e = ease(Math.min(1, endT / 3));
    pn += e * 7; ln += e * 16; lv += e * 30;
  }
  const curl = P.curl;
  let pos = toWorld(pu, pn, pv, curl);
  const look = toWorld(lu, ln, lv, curl);
  const upv = upAt(pu, curl);
  if (shake > 0.001) pos = pos.map(x => x + (Math.random() - 0.5) * shake * 0.5);
  const fwd = norm(sub(look, pos));
  const right = norm(cross(upv, fwd));
  const up = cross(fwd, right);
  const fovDeg = 60 + Math.min(24, sp * 0.45) - (introT < 1 ? (1 - ease(introT)) * 12 : 0);
  return { pos, right, up, fwd, fov: Math.tan((fovDeg * Math.PI) / 360) };
}

// where something appears once the bent rays have bent (so orbs and the pearl sit where the sea is)
function apparent(p, c, P) {
  const s2 = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  return [p[0] - 0.5 * P.bendH * s2, p[1] + 0.5 * P.bendV * s2, p[2]];
}

function frameData(c) {
  const sea = ride.sea, P = sea.p, b = ride.ball;
  const curl = P.curl;
  const bw = apparent(toWorld(b.u, b.n, b.v, curl), c.pos, P);
  const th = b.u * curlK(curl), cs = Math.cos(th), sn = Math.sin(th);
  const R = b.rot;
  // (C·R) row-major is the transpose GL wants: body = Rᵀ Cᵀ world
  const CR = [cs * R[0] - sn * R[3], cs * R[1] - sn * R[4], cs * R[2] - sn * R[5],
    sn * R[0] + cs * R[3], sn * R[1] + cs * R[4], sn * R[2] + cs * R[5], R[6], R[7], R[8]];
  const orbs = ride.orbs.filter(o => o.alive > 0 && o.v > b.v - 6 && o.v < b.v + 150)
    .sort((x, y) => Math.abs(x.v - b.v) - Math.abs(y.v - b.v)).slice(0, MAX.orbs)
    .map(o => [...apparent(toWorld(o.u, o.n, o.v, curl), c.pos, P), o.alive]);
  const f = sea.flip;
  const lucid = ride.free ? 1 : ride.lucid;
  return {
    time, params: sea.params.pack(), cam: c,
    ball: { pos: [...bw, PHYS.r], track: [b.u, b.v, b.n - PHYS.r - sea.height(b.u, b.v), 0], rot: CR },
    orbs, rings: sea.rings, pillars: sea.pillars, hands: sea.hands, ripples: sea.ripples,
    flip: [f.u, f.v, f.r, f.active ? 1 : 0], sides: [f.from, f.to],
    music: [S.calm ? sound.beat * 0.4 : sound.beat, 0, sound.energy, lucid],
    fx: [S.calm ? 0 : Math.min(0.5, flash), fade, invertAmt, staticAmt],
    colorFlip: S.calm ? 0 : 1,
    quality: S.quality === 'high' ? 1 : S.quality === 'low' ? 0.35 : 0.75,
  };
}

// ———————————————————————————————————————— HUD
function eqString(P, side) {
  const n = x => x.toFixed(2).replace(/^0\./, '.').replace(/^-0\./, '−.');
  const parts = [];
  const amp = P.amp;
  if (P.swell > 0.05) parts.push(`${n(P.swell * amp)}·sin(${n(P.swellK)}v − φ)`);
  if (P.chop > 0.05) parts.push(`${n(P.chop * amp)}·sin(${n(P.chopK)}v + 3θ)·sin(…)`);
  if (P.dunes > 0.05) parts.push(`${n(P.dunes * amp)}·sin(${Math.round(P.dunesN)}θ)·sin(${n(P.dunesK)}v)`);
  if (P.vortex > 0.05) parts.push(`−${n(P.vortex * amp)}·e<sup>−r²</sup>·swirl`);
  if (P.face > 0.05) parts.push(`${n(P.face)}·face(u, v)`);
  let s = parts.join(' + ') || '0';
  if (P.terrace > 0.05) s = `⌊${s}⌉`;
  if (side < 0) s = `−(${s})`;
  let space = '';
  if (P.curl > 0.05) space += ` · rolled ${Math.round(P.curl * 100)}%`;
  if (Math.abs(P.bendV) > 0.001) space += P.bendV > 0 ? ' · folding up' : ' · falling away';
  if (P.ceil > 0.05) space += ' · two seas';
  return `h = ${s}${space}`;
}

function hud() {
  if (kind === 'attract' || mode !== 'ride' || hudHidden) { ui.setHud(''); return; }
  const P = ride.sea.p, d = ride.dream;
  const lucid = ride.free ? 1 : ride.lucid;
  const sp = Math.hypot(ride.ball.vu, ride.ball.vv);
  ui.setHud(`
    <div class="hud-l"><div class="dream"><small>${d.sub}</small> ${d.name}</div><div class="eq">${eqString(P, ride.sea.side)}</div></div>
    ${ride.free ? `<div class="hud-r"><div class="speed">${Math.round(sp)}<small> m/s</small></div></div>`
      : `<div class="hud-r"><div class="score">${fmtScore(ride.score)}</div><div class="mult${ride.mult > 1 ? ' on' : ''}">×${ride.mult}</div></div>`}
    ${ride.free ? '' : `<div class="hud-b"><div class="lucid${lucid < 0.25 ? ' low' : ''}"><i style="transform:scaleX(${lucid.toFixed(3)})"></i></div>
      <div class="prog"><i style="left:${(ride.progress * 100).toFixed(1)}%"></i></div></div>`}`);
}

// ———————————————————————————————————————— the loop
let scale = 1;
const dpr = () => Math.min(devicePixelRatio || 1, 1.5);
function resize() { renderer.resize(innerWidth * dpr() * scale, innerHeight * dpr() * scale); }
addEventListener('resize', resize);
resize();

let perfT = 0, perfN = 0, perfGrace = 2;
function adapt(dt) {
  if ((perfGrace -= dt) > 0) return;
  perfT += dt; perfN++;
  if (perfT < 0.75) return;
  const avg = perfT / perfN;
  perfT = 0; perfN = 0;
  const lo = S.quality === 'low' ? 0.4 : 0.5, hi = S.quality === 'high' ? 1 : 0.85;
  if (avg > 1 / 50 && avg < 0.25 && scale > lo) { scale = Math.max(lo, scale * 0.85); resize(); perfGrace = 1; }
  else if (avg < 1 / 58 && scale < hi) { scale = Math.min(hi, scale * 1.08); resize(); perfGrace = 2; }
}

let last = performance.now(), hudTick = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  const inp = input.poll();
  sound.tick(dt);

  const bars = sound.bars;
  const beat = Math.floor(bars * 2);
  const music = { bars, barLen: sound.barLen, beat: sound.beat, beatHit: beat !== lastBeat && lastBeat >= 0, loud: sound.loud };
  lastBeat = beat;

  if (mode === 'ride') {
    if (inp.hidePressed) { hudHidden = !hudHidden; document.body.classList.toggle('bare', hudHidden); }
    if (inp.pausePressed && !ride.done) pauseScreen();
    else if (inp.restartPressed && !ride.done) restart();
    else {
      const control = ride.done ? { x: 0, dive: false } : { x: inp.x, dive: inp.dive, flipPressed: inp.flipPressed };
      ride.update(dt, control, music);
      handleEvents();
      if (kind === 'song' && sound.songOver) ride.finish('clear');
      if (ride.done) { endT += dt; if (endT > (ride.done === 'woke' ? 2.4 : 3.2)) resultsScreen(); }
    }
    sound.setWind(Math.hypot(ride.ball.vu, ride.ball.vn, ride.ball.vv), !ride.ball.ground);
  } else if (mode === 'pause') {
    ui.drive(inp);
  } else {
    ui.drive(inp);
    if (ride) { ride.update(dt, kind === 'attract' ? autopilot(ride) : { x: 0, dive: false }, music); ride.events.length = 0; }
    sound.setWind(0, false);
  }

  if (ride) {
    introT = Math.min(1, introT + dt / 2.2);
    shake *= Math.exp(-dt * 6);
    flash *= Math.exp(-dt * 5);
    invertAmt += ((ride.sea.side < 0 && !S.calm ? 1 : 0) - invertAmt) * (1 - Math.exp(-dt * 2.5));
    const lucid = ride.free || kind === 'attract' ? 1 : ride.lucid;
    let st = Math.max(0, (0.2 - lucid) / 0.2) * 0.35 + Math.min(1, ride.fading / 3) * 0.6;
    if (ride.done === 'woke') st = Math.max(st, Math.min(1, endT / 1.6));
    if (mode !== 'ride' && kind !== 'attract' && ride.done !== 'woke') st = 0;
    staticAmt += (st - staticAmt) * (1 - Math.exp(-dt * 4));
    const fadeTarget = mode === 'pause' ? 0.45 : ride.done === 'clear' && mode === 'ride' ? Math.min(1, Math.max(0, (endT - 2.2) / 1)) : (mode === 'title' || mode === 'select') ? 0.12 : 0;
    fade += (fadeTarget - fade) * (1 - Math.exp(-dt * 3));
    const c = camera(dt, mode === 'ride' ? inp : { look: { x: 0, y: 0 } });
    renderer.draw(frameData(c));
  }
  if ((hudTick += dt) > 0.1) { hudTick = 0; hud(); }
  if (captureCb) { captureCb(canvas.toDataURL('image/jpeg', 0.9)); captureCb = null; }
  adapt(dt);
  requestAnimationFrame(frame);
}
let captureCb = null;

// browsers only let sound start after a click or key press; catch the first one
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (sound.ctx && !sound.running && !sound.paused) sound.ctx.resume(); });

input.onPad = pad => ui.toast(pad ? `<small>controller</small><b>connected</b><em>${pad.id.split('(')[0].trim()}</em>` : '<b>controller disconnected</b>');
sound.setVolumes(S.music, S.sfx);
titleScreen();
requestAnimationFrame(frame);

window.sea = { get ride() { return ride; }, startDream, startDrift, loadSong, DREAMS, cam, input, capture: () => new Promise(r => { captureCb = r; }) };
