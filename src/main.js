import { Input } from './input.js';
import { Game, PHYS } from './game.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { UI, h, fmtTime } from './ui.js';
import { LEVELS } from './levels.js';

const canvas = document.getElementById('game');
let renderer;
try { renderer = new Renderer(canvas); } catch (e) {
  document.getElementById('fatal').hidden = false;
  throw e;
}
const input = new Input(canvas);
const sound = new Sound();
const ui = new UI(document.getElementById('overlay'), sound);

// ------------------------------------------------------------------ saved progress + settings
const SAVE_KEY = 'phosphene.save.v1';
const save = (() => {
  const d = { unlocked: 1, best: {}, settings: { music: 0.55, sfx: 0.8, shake: true, unlockAll: false } };
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s) return { ...d, ...s, settings: { ...d.settings, ...s.settings } }; } catch {}
  return d;
})();
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} };

// ------------------------------------------------------------------ state
let mode = 'title';        // title | select | play | pause | complete
let game = null;
let levelIndex = 0;
const cam = { x: 0, y: 0, lead: 0 };
const BASE_VIEW_H = 14;
let VIEW_H = 14;   // grows on narrow screens so you can always see ~18 tiles across
let rings = [];
let flash = 0, fade = 1, shake = 0;
let intro = 0;             // 0 → 1 as a level opens (the sheet swings from 3D to flat)
let outro = -1;
let time = 0;
let hintsShown = new Set();
let demo = null;           // the drifting level behind the title screen

function ring(x, y, kind) { rings.push({ x, y, t: time, kind }); if (rings.length > 10) rings.shift(); }

// ------------------------------------------------------------------ screens
const deviceWord = () => (input.state.device === 'gamepad' ? { go: '✕', back: '○' } : { go: 'Space / Enter', back: 'Esc' });

function titleScreen() {
  mode = 'title';
  demo = new Game(LEVELS[0]);
  demo.p.dead = 5;
  renderer.setLevel(demo);
  cam.x = 12; cam.y = 9;
  ui.setHud('');
  ui.show({
    class: 'title',
    title: '<span class="logo">PHOSPHENE</span>',
    subtitle: 'a platformer inside an optical illusion',
    items: [
      { label: 'Play', action: () => { sound.start(); sound.play(0, 0.3); selectScreen(); } },
      { label: 'Controls', action: () => { sound.start(); controlsScreen(titleScreen); } },
      { label: 'Settings', action: () => { sound.start(); settingsScreen(titleScreen); } },
    ],
    footer: `Keyboard + mouse or a PS5 controller · ${deviceWord().go} to start`,
  });
}

function selectScreen() {
  mode = 'select';
  if (!demo) { demo = new Game(LEVELS[0]); demo.p.dead = 5; }
  renderer.setLevel(demo);
  ui.setHud('');
  const unlocked = save.settings.unlockAll ? LEVELS.length : save.unlocked;
  ui.show({
    class: 'select',
    title: 'Worlds',
    grid: 5,
    back: titleScreen,
    items: LEVELS.map((L, i) => {
      const b = save.best[L.id];
      const locked = i >= unlocked;
      const card = h('div', { class: `world-card theme-${L.theme}${locked ? ' locked' : ''}` },
        h('div', { class: 'world-art' }, h('span', {}, String(i + 1))),
        h('b', {}, L.name),
        h('small', {}, L.subtitle),
        h('div', { class: 'world-stats' },
          locked ? h('span', {}, 'locked') : b ? [h('span', {}, fmtTime(b.time)), h('span', { class: 'prisms' }, '◆'.repeat(b.prisms) + '◇'.repeat(3 - b.prisms))] : h('span', {}, 'new')));
      return { card, disabled: locked, action: () => startLevel(i) };
    }),
    focus: Math.min(unlocked - 1, LEVELS.findIndex(L => !save.best[L.id]) >= 0 ? LEVELS.findIndex(L => !save.best[L.id]) : 0),
    footer: `${deviceWord().go} to play · ${deviceWord().back} to go back`,
  });
}

function controlsScreen(back) {
  ui.show({
    class: 'controls',
    title: 'Controls',
    back,
    body: h('div', { class: 'controls-table', html: `
      <div><b>Move</b><span>← → · A D</span><span>Left stick · D-pad</span></div>
      <div><b>Jump</b><span>Space · Z · K</span><span>✕</span></div>
      <div><b>Dash</b><span>Shift · X · J (+ direction)</span><span>□ (+ direction)</span></div>
      <div><b>Lens</b><span>Hold mouse button · F — aim with the mouse</span><span>Hold L2 / R2 — aim with the right stick</span></div>
      <div><b>Flip the world</b><span>E · C · Q</span><span>△ · L1 · R1</span></div>
      <div><b>Restart</b><span>R</span><span>Create</span></div>
      <div><b>Pause</b><span>Esc · P</span><span>Options</span></div>
      <p>Jumps are forgiving: you can still jump a moment after leaving a ledge, and a jump pressed just before landing still counts. Wall-jump by jumping into a wall. A dash goes straight through eyes.</p>` }),
    items: [{ label: 'Back', action: back }],
  });
}

function settingsScreen(back) {
  const s = save.settings;
  ui.show({
    class: 'settings',
    title: 'Settings',
    back,
    items: [
      { label: 'Music', value: s.music, min: 0, max: 1, step: 0.1, onChange: v => { s.music = v; sound.setVolumes(s.music, s.sfx); persist(); } },
      { label: 'Sound effects', value: s.sfx, min: 0, max: 1, step: 0.1, onChange: v => { s.sfx = v; sound.setVolumes(s.music, s.sfx); persist(); } },
      { label: 'Screen shake', toggle: s.shake, onChange: v => { s.shake = v; persist(); } },
      { label: 'Unlock all worlds', toggle: s.unlockAll, onChange: v => { s.unlockAll = v; persist(); } },
      { label: 'Back', action: back },
    ],
  });
}

function pauseScreen() {
  mode = 'pause';
  ui.show({
    class: 'pause',
    title: 'Paused',
    subtitle: `${LEVELS[levelIndex].name} · ${fmtTime(game.clock)}`,
    back: resume,
    items: [
      { label: 'Resume', action: resume },
      { label: 'Restart world', action: () => startLevel(levelIndex) },
      { label: 'Worlds', action: () => { sound.play(0, 0.3); selectScreen(); } },
      { label: 'Controls', action: () => controlsScreen(pauseScreen) },
      { label: 'Settings', action: () => settingsScreen(pauseScreen) },
    ],
  });
}
function resume() { ui.hide(); mode = 'play'; }

function completeScreen() {
  mode = 'complete';
  const L = LEVELS[levelIndex];
  const r = { time: game.clock, orbs: game.got.orbs, prisms: game.got.prisms, deaths: game.deaths };
  const prev = save.best[L.id];
  save.best[L.id] = {
    time: prev ? Math.min(prev.time, r.time) : r.time,
    orbs: Math.max(prev?.orbs || 0, r.orbs),
    prisms: Math.max(prev?.prisms || 0, r.prisms),
  };
  save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, levelIndex + 2));
  persist();
  const last = levelIndex === LEVELS.length - 1;
  ui.setHud('');
  ui.show({
    class: 'complete',
    title: last ? 'You woke up.' : 'World cleared',
    subtitle: L.name,
    body: h('div', { class: 'results' },
      h('div', {}, h('small', {}, 'time'), h('b', {}, fmtTime(r.time)), prev && r.time < prev.time ? h('em', {}, 'new best') : null),
      h('div', {}, h('small', {}, 'orbs'), h('b', {}, `${r.orbs} / ${game.total.orbs}`)),
      h('div', {}, h('small', {}, 'prisms'), h('b', { class: 'prisms' }, '◆'.repeat(r.prisms) + '◇'.repeat(game.total.prisms - r.prisms))),
      h('div', {}, h('small', {}, 'deaths'), h('b', {}, String(r.deaths)))),
    items: [
      last ? { label: 'Worlds', action: selectScreen } : { label: 'Next world', action: () => startLevel(levelIndex + 1) },
      { label: 'Play again', action: () => startLevel(levelIndex) },
      { label: 'Worlds', action: selectScreen, class: last ? 'hidden' : '' },
    ].filter(it => it.class !== 'hidden'),
  });
}

// ------------------------------------------------------------------ playing a world
function startLevel(i) {
  levelIndex = i;
  const L = LEVELS[i];
  game = new Game(L);
  renderer.setLevel(game);
  cam.x = game.p.x + 4; cam.y = game.p.y + 3; cam.lead = 0;
  rings = []; flash = 0; fade = 1; shake = 0; intro = 0; outro = -1;
  hintsShown = new Set();
  mode = 'play';
  ui.hide();
  sound.start();
  sound.stop();
  sound.play(L.theme, L.energy);
  ui.toast(`<small>${L.subtitle}</small><b>${L.name}</b>`);
}

function restart() {
  ui.hint('');
  startLevel(levelIndex);
}

// where should the lens be? (mouse, right stick, or just ahead of you)
function lensAim(inp) {
  if (!game.def.lens) return null;
  const p = game.p;
  if (inp.mouseAim) {
    const r = canvas.getBoundingClientRect();
    const sx = (inp.mouse.x - r.left - r.width / 2) / r.height, sy = (r.height / 2 - (inp.mouse.y - r.top)) / r.height;
    return { x: cam.x + sx * VIEW_H, y: cam.y + sy * VIEW_H };
  }
  if (Math.hypot(inp.aim.x, inp.aim.y) > 0.25) return { x: p.x + inp.aim.x * 6.5, y: p.y + 0.7 + inp.aim.y * 6.5 };
  return { x: p.x + p.facing * 2.3, y: p.y + 0.4 + inp.y * 2.6 };
}

function handleEvents() {
  const S = save.settings;
  for (const e of game.events) {
    switch (e.type) {
      case 'jump': sound.sfx('jump'); break;
      case 'walljump': sound.sfx('walljump'); ring(e.x, e.y, 4); break;
      case 'land': if (e.speed > 10) { sound.sfx('land', e); if (e.speed > 18) { shake = Math.max(shake, 0.12); input.rumble(0.3, 0.1, 60); } ring(e.x, e.y, 4); } break;
      case 'dash': sound.sfx('dash'); shake = Math.max(shake, 0.1); input.rumble(0.2, 0.5, 90); break;
      case 'orb': sound.sfx('orb'); ring(e.x, e.y, 0); break;
      case 'prism': sound.sfx('prism'); ring(e.x, e.y, 1); flash = 0.25; input.rumble(0.4, 0.6, 160); break;
      case 'checkpoint': sound.sfx('checkpoint'); ring(e.x, e.y, 1); break;
      case 'die': sound.sfx('die'); shake = 0.5; flash = 0.35; ring(e.x, e.y, 3); input.rumble(1, 0.8, 260); break;
      case 'spawn': sound.sfx('spawn'); break;
      case 'flip': sound.sfx('flip'); input.rumble(0.25, 0.25, 90); break;
      case 'deny': sound.sfx('deny'); shake = Math.max(shake, 0.08); break;
      case 'bounce': sound.sfx('bounce'); ring(e.x, e.y, 4); input.rumble(0.5, 0.2, 90); break;
      case 'pop': sound.sfx('pop'); ring(e.x, e.y, 2); shake = Math.max(shake, 0.15); input.rumble(0.6, 0.6, 120); break;
      case 'rise': if (Math.random() < 0.5) sound.sfx('rise'); break;
      case 'crack': sound.sfx('crack'); break;
      case 'bonk': sound.sfx('bonk'); break;
      case 'chase': sound.sfx('chase'); shake = 0.3; ui.hint('The static is coming. <b>Run.</b>'); break;
      case 'goal': sound.sfx('goal'); ring(e.x, e.y, 3); outro = 0; flash = 0.4; input.rumble(0.5, 0.9, 400); break;
      default:
    }
  }
  game.events.length = 0;
  if (!S.shake) shake = 0;
}

function updateCamera(dt) {
  const p = game.p;
  const aspect = canvas.width / canvas.height;
  const halfW = (VIEW_H * aspect) / 2, halfH = VIEW_H / 2;
  cam.lead += ((p.dead < 0 ? p.vx * 0.28 : 0) + (game.chase?.started ? 3 : 0) - cam.lead) * (1 - Math.exp(-dt * 2.5));
  const tx = p.x + cam.lead, ty = p.y + 1.8;
  cam.x += (tx - cam.x) * (1 - Math.exp(-dt * 6));
  cam.y += (ty - cam.y) * (1 - Math.exp(-dt * (Math.abs(ty - cam.y) > 3 ? 6 : 3.5)));
  cam.x = game.w < halfW * 2 ? game.w / 2 : Math.min(game.w - halfW, Math.max(halfW, cam.x));
  cam.y = Math.min(Math.max(game.h - halfH, halfH - 1.5), Math.max(halfH - 1.5, cam.y));
}

function updateHud() {
  const L = LEVELS[levelIndex];
  ui.setHud(`
    <div class="hud-left"><small>${L.subtitle}</small><b>${L.name}</b><span class="t">${fmtTime(game.clock)}</span></div>
    <div class="hud-right"><span class="orbs"><i></i>${game.got.orbs}<small>/${game.total.orbs}</small></span>
    <span class="prisms">${'◆'.repeat(game.got.prisms)}${'◇'.repeat(game.total.prisms - game.got.prisms)}</span>
    <span class="deaths">✕ ${game.deaths}</span></div>`);
  for (const hn of game.hints) {
    if (!hintsShown.has(hn.x) && game.p.x >= hn.x) { hintsShown.add(hn.x); ui.hint(hn.text); }
  }
}

// ------------------------------------------------------------------ the loop
let scale = Math.min(devicePixelRatio || 1, 1.5);
function resize() {
  renderer.resize(innerWidth * scale, innerHeight * scale);
  VIEW_H = Math.min(26, Math.max(BASE_VIEW_H, 18 / (innerWidth / innerHeight)));
}
addEventListener('resize', resize);
resize();

let perfT = 0, perfN = 0, perfGrace = 2;
function adapt(dt) {
  if ((perfGrace -= dt) > 0) return;
  perfT += dt; perfN++;
  if (perfT < 1) return;
  const avg = perfT / perfN;
  perfT = 0; perfN = 0;
  if (avg > 1 / 45 && avg < 0.2 && scale > 0.5) { scale *= 0.85; resize(); perfGrace = 1.5; }
}

let last = performance.now();
let hudTick = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  const inp = input.poll();
  sound.tick(dt);

  if (mode === 'play') {
    if (inp.pausePressed) pauseScreen();
    else if (inp.restartPressed) restart();
    else {
      const p = game.p;
      const aim = lensAim(inp);
      game.update(dt, inp, aim);
      // where the hero's eye looks: at the lens while it's open, otherwise where you're going
      const L = game.lens;
      const lx = L.active ? L.x - p.x : p.facing * 1 + p.vx * 0.05, ly = L.active ? L.y - (p.y + 1) : p.vy * 0.03;
      const n = Math.hypot(lx, ly) || 1;
      p.lookX += (lx / n - p.lookX) * 0.2; p.lookY += (ly / n - p.lookY) * 0.2;
      handleEvents();
      if (outro >= 0) { outro += dt; if (outro > 1.3) completeScreen(); }
    }
    updateCamera(dt);
    intro = Math.min(1, intro + dt / 1.6);
    if ((hudTick += dt) > 0.1) { hudTick = 0; updateHud(); }
  } else if ((mode === 'title' || mode === 'select') && demo) {
    demo.time += dt;                       // the backdrop: the first world drifting by, no hero
    demo.updateEntities(dt);
    cam.x = 14 + (time * 1.8) % 100; cam.y = 9;
    ui.drive(inp);
  } else {
    ui.drive(inp);
    if (mode === 'pause' && !ui.open) mode = 'play';
  }

  // effects
  shake *= Math.exp(-dt * 7);
  flash *= Math.exp(-dt * 6);
  const g = mode === 'title' || mode === 'select' ? demo : game;
  fade = mode === 'play' && outro < 0 ? Math.max(0, fade - dt * 2.5) : outro >= 0 ? Math.min(1, outro / 1.3) : 0;
  const ease = t => 1 - Math.pow(1 - t, 3);
  let tilt = [0, 0, 0];
  if (mode === 'title' || mode === 'select') tilt = [0.85 + 0.08 * Math.sin(time * 0.3), 0.06 * Math.sin(time * 0.21), 1];
  else if (mode === 'play' && intro < 1) tilt = [0.95 * (1 - ease(intro)), 0.15 * (1 - ease(intro)), 1];
  else if (outro >= 0) tilt = [ease(Math.min(1, outro / 1.3)) * 0.9, -0.1 * outro, 1];

  if (g) {
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    renderer.draw({
      game: g, cam: { x: cam.x + sx, y: cam.y + sy }, viewH: VIEW_H, tilt,
      theme: g.def.theme, time,
      rings: rings.map(r => ({ x: r.x, y: r.y, age: time - r.t, kind: r.kind })),
      flash: Math.min(0.6, flash), fade: mode === 'pause' ? 0.35 : fade,
      music: { beat: sound.beat, bar: sound.bar, loud: 0.5 },
    });
  }
  if (captureCb) { captureCb(canvas.toDataURL('image/jpeg', 0.9)); captureCb = null; }
  adapt(dt);
  requestAnimationFrame(frame);
}
let captureCb = null;

input.onPad = pad => ui.toast(pad ? `<b>Controller connected</b><small>${pad.id.split('(')[0].trim()}</small>` : 'Controller disconnected');
sound.setVolumes(save.settings.music, save.settings.sfx);
titleScreen();
requestAnimationFrame(frame);

window.phosphene = { get game() { return game; }, startLevel, LEVELS, PHYS, cam, input, capture: () => new Promise(r => { captureCb = r; }) };
