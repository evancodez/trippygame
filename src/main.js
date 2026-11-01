import { Input } from './input.js';
import { Renderer, hexToRgb } from './render.js';
import { Sound } from './audio.js';
import { UI, h, fmtScore } from './ui.js';
import { Game } from './game.js';
import { SONGS, PALETTES, freeSong } from './scenes.js';
import { bot } from './bot.js';
import { HALF } from './sheet.js';
import { analyzeAudio } from './analysis.js';

const canvas = document.getElementById('sheet');
let renderer;
try { renderer = new Renderer(canvas); } catch (e) { document.getElementById('fatal').hidden = false; throw e; }
const input = new Input(canvas);
const sound = new Sound();
const ui = new UI(document.getElementById('overlay'), sound);

// ———————————————————————————————————————— saved progress + settings
const SAVE_KEY = 'underneath.save.v1';
const save = (() => {
  const d = { unlocked: 1, best: {}, settings: { music: 0.6, sfx: 0.8, shake: true, calm: false, quality: 'auto', unlockAll: false, palette: 'bone' } };
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s) return { ...d, ...s, settings: { ...d.settings, ...s.settings } }; } catch {}
  return d;
})();
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} };
const S = save.settings;

// ———————————————————————————————————————— state
let mode = 'title';          // title | select | play | pause | results
let game = null;
let kind = 'attract';        // attract | song | free | track
let songIndex = 0;
let trackName = '';
const botMem = {};
let time = 0, flash = 0, fade = 1, shake = 0, staticAmt = 0, endT = 0;
let hudHidden = false;
let palette = null, paletteTo = null;
let pearlRot = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const glyph = () => (input.state.device === 'pad'
  ? { push: 'R2 (or ✕)', press: 'L2 (or □)', go: '✕', back: '○' }
  : { push: 'the left mouse button (or space)', press: 'the right mouse button (or shift)', go: 'enter', back: 'esc' });
const rumble = (a, b, ms) => { if (kind !== 'attract') input.rumble(a, b, ms); };

function setPalette(name, instant) {
  const p = PALETTES[name] || PALETTES.bone;
  paletteTo = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, hexToRgb(v)]));
  if (instant || !palette) palette = JSON.parse(JSON.stringify(paletteTo));
}

// ———————————————————————————————————————— starting
function attract() {
  kind = 'attract';
  game = new Game(freeSong(S.palette), { seed: (Math.random() * 1e9) | 0, free: true });
  setPalette(S.palette, !palette);
}

function begin(g, k, pal) {
  game = g; kind = k; mode = 'play';
  ui.hide(); ui.caption('');
  fade = 1; endT = 0;
  setPalette(pal);
}

function startSong(i) {
  songIndex = i;
  const s = SONGS[i];
  sound.start(); sound.stop(); sound.play(s.music, s.energy);
  begin(new Game(s, { seed: 100 + i }), 'song', s.palette);
  ui.toast(`<small>${s.sub}</small><b>${s.name}</b><em>${s.blurb}</em>`, 3200);
}

function startFree() {
  sound.start(); sound.stop(); sound.play(0, 0.5);
  begin(new Game(freeSong(S.palette), { seed: (Math.random() * 1e9) | 0, free: true }), 'free', S.palette);
  ui.toast('<small>∞</small><b>Free</b><em>every scene, nothing to lose</em>', 2800);
}

function startTrack(buffer, an, name) {
  trackName = name;
  const song = freeSong(S.palette);
  song.name = name;
  begin(new Game(song, { seed: 4242, free: true }), 'track', S.palette);
  sound.playTrack(buffer, an);
  ui.toast(`<small>♪ ${Math.round(an.bpm)} bpm</small><b>${name}</b><em>the sheet moves to your song</em>`, 3400);
}

function restart() {
  if (kind === 'song') startSong(songIndex);
  else if (kind === 'free') startFree();
  else if (kind === 'track' && sound.track) startTrack(sound.track.buffer, sound.track.an, trackName);
}

// ———————————————————————————————————————— screens
function titleScreen() {
  mode = 'title';
  if (kind !== 'attract') attract();
  ui.setHud(''); ui.caption('');
  const g = glyph();
  ui.show({
    class: 'title',
    top: h('div', { class: 'logo' }, 'underneath'),
    subtitle: 'you are the hand beneath the sheet',
    items: [
      { label: 'Songs', sub: 'five songs, a scene a phrase', action: () => { sound.start(); selectScreen(); } },
      { label: 'Free', sub: 'every scene, nothing to lose', action: () => startFree() },
      { label: 'Your song', sub: 'drop in an mp3', action: () => { sound.start(); pickSong(); } },
      { label: 'How to play', action: () => { sound.start(); howScreen(titleScreen); } },
      { label: 'Settings', action: () => { sound.start(); settingsScreen(titleScreen); } },
    ],
    footer: `mouse, keyboard or a PS5 controller · <b>${g.go}</b> to choose`,
  });
}

function selectScreen() {
  mode = 'select';
  if (kind !== 'attract') attract();
  ui.setHud('');
  const unlocked = S.unlockAll ? SONGS.length : save.unlocked;
  const g = glyph();
  ui.show({
    class: 'select', title: 'Songs', grid: SONGS.length, back: titleScreen,
    items: SONGS.map((s, i) => {
      const b = save.best[s.id], locked = i >= unlocked;
      const marks = b ? '◆'.repeat(b.marks) + '◇'.repeat(3 - b.marks) : '◇◇◇';
      const card = h('div', { class: `dream-card pal-${s.palette}${locked ? ' locked' : ''}` },
        h('div', { class: 'dream-art' }, h('span', {}, s.sub)),
        h('b', {}, s.name),
        h('small', {}, locked ? 'finish the one before' : s.blurb),
        h('div', { class: 'dream-stats' }, h('span', {}, b ? fmtScore(b.score) : locked ? 'locked' : `${s.scenes.length} scenes`), h('span', { class: 'marks' }, marks)));
      return { card, disabled: locked, action: () => startSong(i) };
    }),
    focus: Math.min(unlocked - 1, Math.max(0, SONGS.findIndex(s => !save.best[s.id]))),
    footer: `<b>${g.go}</b> to play · <b>${g.back}</b> to go back`,
  });
}

function howScreen(back) {
  ui.show({
    class: 'controls', title: 'How to play', back,
    body: h('div', { class: 'controls-table', html: `
      <div><b>Move your hand</b><span>move the mouse · or WASD / arrows</span><span>left stick · d-pad</span></div>
      <div><b>Push up</b><span>hold left mouse · space</span><span>squeeze R2 (or ✕) — harder squeeze, higher push</span></div>
      <div><b>Press down</b><span>hold right mouse · shift</span><span>squeeze L2 (or □)</span></div>
      <div><b>Pause · restart</b><span>esc · R</span><span>options · create</span></div>
      <div><b>Hide everything</b><span>H</span><span>—</span></div>
      <p>You're <b>underneath</b> the sheet. You never touch the pearl — you move the fabric. Push up just behind it and it rolls away from your hand. Press down ahead of it and it falls into the well you made.</p>
      <p>A push that starts <b>on the beat</b> snaps up hard enough to throw the pearl — and keeps your streak going. Watch the lines thicken on the beat, or just listen.</p>
      <p>Each scene is one phrase of the song. Finish before it ends for points; miss and you lose one of your three lights. The sheet changes shape between scenes — read the slopes from how the lines bend.</p>` }),
    items: [{ label: 'Back', action: back }],
  });
}

function settingsScreen(back) {
  const pals = Object.keys(PALETTES);
  ui.show({
    class: 'settings', title: 'Settings', back,
    items: [
      { label: 'Music', value: S.music, min: 0, max: 1, step: 0.1, onChange: v => { S.music = v; sound.setVolumes(S.music, S.sfx); persist(); } },
      { label: 'Sounds', value: S.sfx, min: 0, max: 1, step: 0.1, onChange: v => { S.sfx = v; sound.setVolumes(S.music, S.sfx); persist(); } },
      { label: 'Detail', value: ['low', 'auto', 'high'].indexOf(S.quality), min: 0, max: 2, step: 1, format: v => ['low', 'auto', 'high'][Math.round(v)], onChange: v => { S.quality = ['low', 'auto', 'high'][Math.round(v)]; scale = 1; resize(); persist(); } },
      { label: 'Colors in Free', value: pals.indexOf(S.palette), min: 0, max: pals.length - 1, step: 1, format: v => pals[Math.round(v)], onChange: v => { S.palette = pals[Math.round(v)]; if (kind === 'attract') setPalette(S.palette); persist(); } },
      { label: 'Screen shake', toggle: S.shake, onChange: v => { S.shake = v; persist(); } },
      { label: 'Reduce flashing', toggle: S.calm, onChange: v => { S.calm = v; persist(); } },
      { label: 'Unlock every song', toggle: S.unlockAll, onChange: v => { S.unlockAll = v; persist(); } },
      { label: 'Back', action: back },
    ],
  });
}

function pauseScreen() {
  mode = 'pause';
  sound.suspend();
  ui.show({
    class: 'pause', title: 'Paused', subtitle: game.song.name, back: resume,
    items: [
      { label: 'Keep playing', action: resume },
      { label: 'Start over', action: () => { sound.resume(); restart(); } },
      { label: 'How to play', action: () => howScreen(pauseScreen) },
      { label: 'Settings', action: () => settingsScreen(pauseScreen) },
      { label: 'Leave', sub: 'back to the title', action: () => { sound.resume(); sound.stop(); titleScreen(); } },
    ],
  });
}
function resume() { ui.hide(); mode = 'play'; sound.resume(); }

function resultsScreen() {
  mode = 'results';
  ui.setHud(''); ui.caption('');
  const g = game, st = g.stats, done = g.done === 'end';
  const s = g.song;
  let marks = 0, prev = null;
  if (kind === 'song') {
    marks = done ? g.lights : 0;
    prev = save.best[s.id];
    if (done) {
      save.best[s.id] = { score: Math.max(prev?.score || 0, g.score), marks: Math.max(prev?.marks || 0, marks) };
      save.unlocked = Math.max(save.unlocked, Math.min(SONGS.length, songIndex + 2));
      persist();
    }
  }
  const last = kind === 'song' && songIndex === SONGS.length - 1;
  const stat = (k, v) => h('div', {}, h('small', {}, k), h('b', {}, v));
  ui.show({
    class: 'results',
    title: done ? (last ? 'the sheet goes still' : 'the song ends') : 'the lights went out',
    subtitle: `${s.sub} · ${s.name}`,
    body: h('div', {},
      h('div', { class: 'big-score' }, fmtScore(g.score), kind === 'song' && done ? h('span', { class: 'marks' }, '◆'.repeat(marks) + '◇'.repeat(3 - marks)) : null,
        prev && done && g.score > prev.score ? h('em', {}, 'new best') : null),
      h('div', { class: 'results-grid' },
        stat('scenes', `${st.scenes} / ${s.scenes.length}`), stat('best beat streak', g.best), stat('lights gathered', st.motes),
        stat('ink fed', st.ink), stat('pearls lost', st.lost), stat('longest throw', `${st.air.toFixed(1)} s`))),
    items: [
      ...(done && kind === 'song' && !last ? [{ label: 'Next song', action: () => startSong(songIndex + 1) }] : []),
      { label: done ? 'Play it again' : 'Try again', action: restart },
      { label: 'Songs', action: () => { sound.stop(); selectScreen(); } },
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
    startTrack(decoded, an, name);
  } catch (err) {
    console.error(err);
    ui.toast('<b>couldn’t read that song</b><em>try an mp3 or wav</em>', 3000);
  }
}

// ———————————————————————————————————————— events → sound, feel, words
function handleEvents() {
  const live = kind !== 'attract';
  for (const e of game.events) {
    if (!live) continue;
    switch (e.type) {
      case 'scene': {
        const sc = e.scene;
        if (sc.caption) ui.caption(sc.caption(glyph()), 9000);
        else ui.caption('');
        if (kind === 'song') sound.setEnergy(Math.min(1, game.song.energy + e.index * 0.06));
        flash = Math.max(flash, 0.06);
        break;
      }
      case 'snap': sound.sfx('snap', e); ui.pop(e.streak > 1 ? `on the beat ×${e.streak}` : 'on the beat', 'hot'); rumble(0.7, 0.4, 110); shake = Math.max(shake, 0.12); break;
      case 'push': sound.sfx('push'); rumble(0.15, 0.05, 60); break;
      case 'land': sound.sfx('land', e); if (e.speed > 6) rumble(Math.min(1, e.speed / 16), 0.1, 70); break;
      case 'clack': sound.sfx('clack', e); break;
      case 'air': sound.sfx('air'); ui.pop(`thrown ${e.air.toFixed(1)}s`); break;
      case 'drop': sound.sfx('drop'); break;
      case 'eye': sound.sfx('eye'); flash = Math.max(flash, 0.25); rumble(0.5, 1, 350); if (e.need > 1 && e.have < e.need) ui.pop(`${e.have} / ${e.need}`, 'hot'); break;
      case 'mote': sound.sfx('mote'); rumble(0.05, 0.3, 50); break;
      case 'fed': sound.sfx('fed'); ui.pop('fed', 'hot'); rumble(0.4, 0.6, 200); break;
      case 'clear': sound.sfx('clear'); ui.pop(`+${fmtScore(e.points)}`, 'mult'); ui.caption(''); break;
      case 'miss': sound.sfx('miss'); ui.pop('the phrase ends', 'bad'); flash = 0; shake = Math.max(shake, 0.3); rumble(0.8, 0.2, 300); break;
      case 'lost': sound.sfx('lost'); ui.pop('lost it', 'bad'); shake = Math.max(shake, 0.25); rumble(0.9, 0.3, 220); break;
      case 'arrive': sound.sfx('arrive'); break;
      case 'inkup': sound.sfx('inkup'); break;
      case 'rival': sound.sfx('rival'); break;
      case 'found': sound.sfx('found'); ui.pop('found it', 'hot'); rumble(0.2, 0.6, 200); break;
      case 'woke': sound.sfx('woke'); rumble(1, 1, 600); break;
      case 'end': sound.sfx('end'); rumble(0.3, 0.8, 500); break;
      default:
    }
  }
  game.events.length = 0;
  if (!S.shake) shake = 0;
}

// ———————————————————————————————————————— camera + pointing at the sheet
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
let cam = null;
function camera() {
  const aspect = canvas.width / canvas.height;
  const bar = game ? game.bars : 0;
  const sway = Math.sin(bar * Math.PI) * 0.5;                      // the 6/8 sway, one way per bar
  const lean = aspect < 1 ? 1 + (1 - aspect) * 0.9 : 1;
  const pos = [sway + (Math.random() - 0.5) * shake, -24.5 * lean + (Math.random() - 0.5) * shake, 25.5 * lean];
  const look = [sway * 0.4, 1.4, -1];
  const fwd = norm([look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]]);
  const roll = Math.sin(bar * Math.PI) * 0.012;
  const upW = [Math.sin(roll), 0, Math.cos(roll)];
  const right = norm(cross(fwd, upW));
  const up = cross(right, fwd);
  const fov = Math.max(0.42, 0.66 / aspect);
  cam = { pos, right, up, fwd, fov };
  return cam;
}
// where on the sheet is the pointer?
function pointOnSheet(clientX, clientY) {
  if (!cam || !game) return null;
  const r = canvas.getBoundingClientRect();
  const ux = (clientX - r.left - r.width / 2) / r.height, uy = -(clientY - r.top - r.height / 2) / r.height;
  const d = norm([0, 1, 2].map(i => cam.fwd[i] + (ux * cam.right[i] + uy * cam.up[i]) * cam.fov * 2));
  let z = 0, x = 0, y = 0;
  for (let k = 0; k < 3; k++) {
    const t = (z - cam.pos[2]) / d[2];
    x = cam.pos[0] + d[0] * t; y = cam.pos[1] + d[1] * t;
    z = game.sheet.height(Math.max(-HALF, Math.min(HALF, x)), Math.max(-HALF, Math.min(HALF, y)));
  }
  return [x, y];
}

// the pearl's spin, for the band around it
function spinPearl(dt) {
  const p = game.pearls[0];
  if (!p) return;
  const sp = Math.hypot(p.vx, p.vy);
  if (sp < 0.01 || !p.grounded) return;
  const ax = -p.vy / sp, ay = p.vx / sp, a = (sp * dt) / p.r;
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const Rm = [t * ax * ax + c, t * ax * ay, s * ay, t * ax * ay, t * ay * ay + c, -s * ax, -s * ay, s * ax, c];
  const R = pearlRot, o = new Array(9);
  for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) o[r * 3 + q] = Rm[r * 3] * R[q] + Rm[r * 3 + 1] * R[3 + q] + Rm[r * 3 + 2] * R[6 + q];
  pearlRot = o;
}

// ———————————————————————————————————————— HUD
const SHAPE_EQ = { bowl: '−2.6(1 − r²)', dome: '2.2(1 − r²)', saddle: '2.6(x² − y²)', tilt: '1.5x·sin(πt)', swells: '.85 sin(.6y − φ)', rings: '.8 sin(.95r − φ)', ridges: '.75 cos(1.15r)', funnel: '−3.4(1 − r)² + swirl', face: 'face(x, y)', hollow: '−face(x, y)', drum: 'beat·(1 − r²)' };
function eq() {
  const parts = Object.entries(game.shape.v).filter(([, w]) => w > 0.05).map(([k, w]) => `${w < 0.97 ? w.toFixed(2).replace(/^0/, '') + '·' : ''}${SHAPE_EQ[k] || k}`);
  return `z = ${parts.join(' + ') || '0'} + you`;
}
function hud() {
  if (kind === 'attract' || mode !== 'play' || hudHidden) { ui.setHud(''); return; }
  const g = game, left = g.phraseLeft;
  const lights = g.free ? '' : `<div class="lights">${'<i class="on"></i>'.repeat(Math.max(0, g.lights))}${'<i></i>'.repeat(3 - Math.max(0, g.lights))}</div>`;
  ui.setHud(`
    <div class="hud-l"><div class="dream"><small>${g.song.sub}</small> ${g.song.name} <span class="scene">${g.scene + 1}/${g.song.scenes.length}</span></div><div class="goal">${g.state === 'play' ? g.goalText() : g.state === 'between' ? '…' : ''}</div><div class="eq">${eq()}</div></div>
    <div class="hud-r"><div class="score">${fmtScore(g.score)}</div><div class="mult${g.streak > 1 ? ' on' : ''}">${g.streak > 0 ? `beat ×${g.streak}` : ''}</div></div>
    ${lights}
    <div class="hud-b"><div class="phrase"><i style="transform:scaleX(${left.toFixed(3)})"></i></div></div>`);
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
  const avg = perfT / perfN; perfT = 0; perfN = 0;
  const lo = S.quality === 'low' ? 0.4 : 0.5, hi = S.quality === 'high' ? 1 : 0.85;
  if (avg > 1 / 50 && avg < 0.25 && scale > lo) { scale = Math.max(lo, scale * 0.85); resize(); perfGrace = 1; }
  else if (avg < 1 / 58 && scale < hi) { scale = Math.min(hi, scale * 1.08); resize(); perfGrace = 2; }
}

let last = performance.now(), hudTick = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; time += dt;
  const inp = input.poll();
  sound.tick(dt);
  const music = { bars: sound.bars, barLen: sound.barLen };

  if (mode === 'play') {
    if (inp.hidePressed) { hudHidden = !hudHidden; document.body.classList.toggle('bare', hudHidden); }
    if (inp.pausePressed && !game.done) pauseScreen();
    else if (inp.restartPressed && !game.done) restart();
    else {
      const control = { mx: inp.mx, my: inp.my, push: inp.pushAmt, press: inp.pressAmt };
      if (inp.useMouse) control.target = pointOnSheet(inp.mouse.x, inp.mouse.y);
      game.update(dt, control, music);
      handleEvents();
      if (kind === 'track' && sound.songOver) game.finish('end');
      if (game.done) { endT += dt; if (endT > 2.6) resultsScreen(); }
      sound.hum(game.hand.push, game.hand.press);
    }
    canvas.style.cursor = inp.useMouse ? 'none' : 'default';
  } else {
    ui.drive(inp);
    if (mode !== 'pause' && game) { game.update(dt, kind === 'attract' ? bot(game, botMem) : { mx: 0, my: 0, push: 0, press: 0 }, music); game.events.length = 0; }
    sound.hum(0, 0);
    canvas.style.cursor = 'default';
  }

  if (game) {
    spinPearl(dt);
    shake *= Math.exp(-dt * 6);
    flash *= Math.exp(-dt * 5);
    let st = 0;
    if (game.done === 'woke') st = Math.min(1, endT / 1.8);
    if (!game.free && game.lights === 1 && game.state === 'play') st = Math.max(st, (1 - game.phraseLeft) * 0.25);
    staticAmt += (st - staticAmt) * (1 - Math.exp(-dt * 4));
    const fadeTarget = mode === 'pause' ? 0.45 : game.done === 'end' && mode === 'play' ? Math.min(1, Math.max(0, (endT - 1.6) / 1)) : (mode === 'title' || mode === 'select') ? 0.1 : 0;
    fade += (fadeTarget - fade) * (1 - Math.exp(-dt * 3));
    for (const k in paletteTo) palette[k] = palette[k].map((x, i) => x + (paletteTo[k][i] - x) * Math.min(1, dt * 2));
    const c = camera();
    const beatPulse = S.calm ? 0 : Math.pow(1 - game.beatPhase, 4);
    renderer.draw({
      heights: game.sheet.pack(), time, cam: c,
      lines: { ...game.lines.v, phase: game.lines.v.flow * game.bars * Math.PI },
      palette,
      holes: game.sheet.holes,
      pearls: game.pearls, inks: game.inks,
      motes: game.motes.map(m => ({ ...m, alpha: m.alive ? Math.min(1, m.t * 2) : 0 })).filter(m => m.alpha > 0),
      hands: kind === 'attract' && mode !== 'play' ? [game.hand] : game.sheet.hands,
      pearlRot,
      fx: [S.calm ? 0 : Math.min(0.45, flash), fade, staticAmt, beatPulse],
      steps: S.quality === 'high' ? 140 : S.quality === 'low' ? 60 : 100,
    });
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
attract();
titleScreen();
requestAnimationFrame(frame);

window.under = { get game() { return game; }, startSong, startFree, loadSong, SONGS, capture: () => new Promise(r => { captureCb = r; }) };
