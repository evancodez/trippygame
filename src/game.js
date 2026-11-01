// One song: a run of scenes, each a musical phrase long. Every scene morphs the sheet into a new
// equation, sets out eyes, tears, lights and ink, and gives you a goal. Nothing here touches the DOM.
import { Sheet, Body, HALF, holeSD, handShape, clamp } from './sheet.js';
import { LINE_LOOKS } from './scenes.js';

const STEP = 1 / 120;
const ease = x => x * x * (3 - 2 * x);

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// line-look values glide like the visualizer's params
class Glide {
  constructor(v) { this.v = { ...v }; this.g = {}; }
  to(set, dur) {
    for (const [k, x] of Object.entries(set)) {
      if (dur <= 0) { this.v[k] = x; delete this.g[k]; continue; }
      this.g[k] = { from: this.v[k] ?? 0, to: x, t: 0, dur };
    }
  }
  tick(dt) {
    for (const [k, g] of Object.entries(this.g)) {
      g.t += dt;
      const e = ease(Math.min(1, g.t / g.dur));
      this.v[k] = g.from + (g.to - g.from) * e;
      if (g.t >= g.dur) delete this.g[k];
    }
  }
}

export class Game {
  constructor(song, { seed = 1, free = false } = {}) {
    this.song = song;
    this.free = free;
    this.rng = mulberry32(seed);
    this.sheet = new Sheet();
    this.hand = { x: 0, y: -7, ang: 0, push: 0, press: 0, power: 2.8, snap: false, glow: 0.4, kind: 0, vx: 0, vy: 0 };
    this.sheet.hands.push(this.hand);
    this.rival = null;
    this.shape = new Glide({});
    this.lines = new Glide(LINE_LOOKS.silk);
    this.scene = -1;
    this.sceneStart = 0;
    this.sceneEnd = 0;
    this.bars = 0;
    this.clock = null;
    this.time = 0;
    this.acc = 0;
    this.phase = 0;
    this.lights = 3;
    this.score = 0;
    this.streak = 0;
    this.best = 0;
    this.stats = { scenes: 0, missed: 0, lost: 0, motes: 0, ink: 0, snaps: 0, air: 0 };
    this.motes = [];
    this.respawns = [];
    this.events = [];
    this.state = 'play';         // play | between | done
    this.done = null;            // 'woke' | 'end'
    this.cleared = false;
    this.pushHeld = false;
    this.beatPhase = 0;
    this.goal = null;
    this.progress = { have: 0, need: 1 };
  }

  emit(type, o = {}) { this.events.push({ type, ...o }); }
  get pearls() { return this.sheet.bodies.filter(b => b.kind === 'pearl' && !b.gone); }
  get inks() { return this.sheet.bodies.filter(b => b.kind === 'ink' && !b.gone); }
  get mult() { return 1 + Math.min(2, this.streak * 0.1); }

  // ———————————————————————————————————————— scenes
  enter(i) {
    const S = this.song.scenes[i];
    this.scene = i;
    this.state = 'play';
    this.cleared = false;
    const morph = (S.morph ?? 1.5) * this.barLen;
    // the sheet glides into the new equation
    const w = {};
    for (const k of Object.keys(this.shape.v)) w[k] = 0;
    Object.assign(w, S.shape || {});
    if (S.drum) w.drum = 1;
    this.shape.to(w, morph);
    this.lines.to({ ...LINE_LOOKS[S.lines || 'silk'] }, morph);
    this.sheet.s.tiltSpeed = S.tiltSpeed ?? 1;
    // clear the stage: old pearls and ink sink back into the fabric
    for (const b of this.sheet.bodies) if (!b.gone) { b.gone = true; this.sheet.pulse(b.x, b.y, -6, 1.2); }
    this.sheet.bodies = [];
    this.motes = [];
    this.respawns = [];
    // holes: eyes open slowly, tears tear
    this.sheet.holes = [
      ...(S.eyes || []).map(e => ({ kind: 'eye', x: e[0], y: e[1], a: e[2] ?? 1.7, b: e[3] ?? 1.05, ang: e[4] ?? 0, open: 0, want: 1, blink: e.blink || S.blink || null, drift: S.drift || null, x0: e[0], y0: e[1], hidden: !!S.hidden, reveal: S.hidden ? 0 : 1, look: [0, 0] })),
      ...(S.tears || []).map(t => ({ kind: 'tear', x: t[0], y: t[1], a: t[2] ?? 1.3, b: t[3] ?? 1.1, ang: t[4] ?? 0, open: 1, want: 1, reveal: 1, grow: 0 })),
    ];
    const pearls = S.pearls || [S.pearl || [0, -6]];
    pearls.forEach((p, k) => this.respawns.push({ x: p[0], y: p[1], at: this.time + 0.3 + k * 0.4, kind: 'pearl' }));
    (S.ink || []).forEach((p, k) => this.respawns.push({ x: p[0], y: p[1], at: this.time + 0.8 + k * 0.25, kind: 'ink' }));
    this.motes = (S.motes || []).map(m => ({ x: m[0], y: m[1], z: m[2] ?? 0.9, alive: 1, t: 0 }));
    this.rival = null;
    this.sheet.hands = [this.hand];
    if (S.rival) {
      this.rival = { x: S.rival[0] ?? 0, y: S.rival[1] ?? 6, ang: Math.PI, push: 0, press: 0, power: 2.5, glow: 0.5, kind: 1, cool: 2, hold: 0, vx: 0, vy: 0 };
      this.sheet.hands.push(this.rival);
    }
    this.goal = S.goal || 'eye';
    this.progress = { have: 0, need: this.goal === 'gather' ? this.motes.length : this.goal === 'ink' ? (S.ink || []).length : this.goal === 'pearls' ? pearls.length : 1 };
    this.sceneStart = this.bars;
    this.sceneEnd = this.bars + S.bars;
    this.emit('scene', { index: i, scene: S });
  }

  sceneClear() {
    if (this.cleared) return;
    this.cleared = true;
    const left = Math.max(0, this.sceneEnd - this.bars);
    const pts = Math.round((1000 + 120 * left) * this.mult);
    this.score += pts;
    this.stats.scenes++;
    this.emit('clear', { points: pts, left });
    // the next scene starts on the next bar line
    this.state = 'between';
    this.nextAt = Math.ceil(this.bars + 0.75);
  }

  sceneMiss() {
    this.stats.missed++;
    this.streak = 0;
    if (!this.free) this.lights--;
    this.emit('miss', { lights: this.lights });
    if (this.lights <= 0) { this.finish('woke'); return; }
    this.state = 'between';
    this.nextAt = Math.ceil(this.bars + 0.25);
  }

  finish(how) {
    if (this.done) return;
    this.done = how;
    this.state = 'done';
    if (how === 'end') this.score += this.lights * 1500;
    this.emit(how);
  }

  // ———————————————————————————————————————— per frame
  // control: { x, y (hand position target or velocity), push 0..1, press 0..1 }
  // music: { bars (a clock that only goes up), barLen }
  update(dt, control, music) {
    if (this.clock == null) this.clock = music.bars;
    const dBars = clamp(music.bars - this.clock, 0, 0.5);
    this.clock = music.bars;
    this.barLen = music.barLen || this.barLen || 1.714;
    if (this.state !== 'done') this.bars += dBars;
    this.beatPhase = (this.bars * 2) % 1;
    this.phase += dBars * Math.PI * 2 * 0.5;
    const S = this.song.scenes[this.scene];

    // the script
    if (this.scene < 0) this.enter(0);
    else if (this.state === 'between' && this.bars >= this.nextAt) {
      if (this.scene + 1 < this.song.scenes.length) this.enter(this.scene + 1);
      else if (this.free) this.enter(0);
      else this.finish('end');
    } else if (this.state === 'play' && !this.free && this.bars >= this.sceneEnd) this.sceneMiss();
    else if (this.state === 'play' && this.free && this.bars >= this.sceneEnd) { this.state = 'between'; this.nextAt = this.bars; }

    this.steerHand(dt, control);
    if (this.rival) this.steerRival(dt);
    this.animate(dt, music);

    this.acc = Math.min(this.acc + dt, STEP * 10);
    while (this.acc >= STEP) { this.acc -= STEP; this.sheet.step(STEP); }
    this.time += dt;
    this.readSheetEvents();
    this.checkGoals();
  }

  // ———————————————————————————————————————— your hand
  steerHand(dt, c) {
    const H = this.hand;
    if (this.state === 'done') { H.push = Math.max(0, H.push - dt * 3); H.press = Math.max(0, H.press - dt * 3); return; }
    // position: the mouse gives a target; sticks and keys give a velocity
    const px = H.x, py = H.y;
    if (c.target) {
      const dx = c.target[0] - H.x, dy = c.target[1] - H.y, d = Math.hypot(dx, dy), max = 34 * dt;
      if (d > max) { H.x += (dx / d) * max; H.y += (dy / d) * max; } else { H.x = c.target[0]; H.y = c.target[1]; }
    } else {
      const sp = 15;
      H.vx += (c.mx * sp - H.vx) * Math.min(1, dt * 14);
      H.vy += (c.my * sp - H.vy) * Math.min(1, dt * 14);
      H.x += H.vx * dt; H.y += H.vy * dt;
    }
    H.x = clamp(H.x, -HALF + 0.6, HALF - 0.6); H.y = clamp(H.y, -HALF + 0.6, HALF - 0.6);
    // the fingers reach toward the pearl (or the way you're moving)
    const p = this.pearls[0];
    let ax = 0, ay = 1;
    if (p && Math.hypot(p.x - H.x, p.y - H.y) < 9) { ax = p.x - H.x; ay = p.y - H.y; }
    else if (Math.hypot(H.x - px, H.y - py) > 0.02) { ax = H.x - px; ay = H.y - py; }
    const want = Math.atan2(-ax, ay);
    let da = want - H.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
    H.ang += da * Math.min(1, dt * 7);
    // push: held pushes rise slowly; a push that starts on the beat snaps up hard
    const pushIn = c.push || 0, pressIn = c.press || 0;
    if (pushIn > 0.5 && !this.pushHeld) {
      this.pushHeld = true;
      const off = Math.min(this.beatPhase, 1 - this.beatPhase);
      H.snap = off < 0.12;
      if (H.snap) { this.streak++; this.best = Math.max(this.best, this.streak); this.stats.snaps++; this.score += 20 * this.streak; this.emit('snap', { streak: this.streak }); }
      else this.emit('push');
    }
    if (pushIn < 0.3) this.pushHeld = false;
    const rate = H.snap ? 11 : 3.2;
    H.push = pushIn > H.push ? Math.min(pushIn, H.push + dt * rate) : Math.max(pushIn, H.push - dt * 5);
    H.press = pressIn > H.press ? Math.min(pressIn, H.press + dt * 4) : Math.max(pressIn, H.press - dt * 5);
    H.power = H.snap ? 3.4 : 2.8;
    H.glow += ((0.35 + 0.65 * Math.max(H.push, H.press)) - H.glow) * Math.min(1, dt * 8);
  }

  // the other hand: it gets between the pearl and the eye, and shoves
  steerRival(dt) {
    const R = this.rival, p = this.pearls[0];
    if (!p) { R.push = Math.max(0, R.push - dt * 4); return; }
    const eye = this.sheet.holes.find(o => o.kind === 'eye') || { x: 0, y: HALF };
    let dx = eye.x - p.x, dy = eye.y - p.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const tx = p.x + dx * 2.3, ty = p.y + dy * 2.3;
    const ex = tx - R.x, ey = ty - R.y, ed = Math.hypot(ex, ey), sp = (this.song.rivalSpeed || 5.5) * dt;
    if (ed > sp) { R.x += (ex / ed) * sp; R.y += (ey / ed) * sp; } else { R.x = tx; R.y = ty; }
    R.ang = Math.atan2(-(p.x - R.x), p.y - R.y);
    R.cool -= dt;
    if (R.hold > 0) { R.hold -= dt; R.push = Math.min(1, R.push + dt * 4); }
    else { R.push = Math.max(0, R.push - dt * 3); if (R.cool <= 0 && ed < 1.2) { R.hold = 0.55; R.cool = 1.9; this.emit('rival'); } }
    R.glow = 0.35 + 0.65 * R.push;
  }

  // ———————————————————————————————————————— the stage
  animate(dt, music) {
    const sh = this.sheet, S = this.song.scenes[this.scene] || {};
    this.shape.tick(dt);
    this.lines.tick(dt);
    sh.w = this.shape.v;
    sh.s.phase = this.phase;
    sh.s.beat = Math.pow(1 - this.beatPhase, 6) * (this.state === 'done' ? 0 : 1);
    sh.s.sway = Math.sin(this.bars * Math.PI * (sh.s.tiltSpeed || 1));
    sh.rebuildBase(dt);
    // holes
    for (const o of sh.holes) {
      if (o.kind === 'eye') {
        let want = o.want;
        if (o.blink === 'bar') want *= (this.bars % 1) < 0.5 ? 1 : 0;
        if (o.blink === 'beat') want *= this.beatPhase < 0.5 ? 1 : 0;
        if (o.hidden) {
          const d = Math.hypot(this.hand.x - o.x, this.hand.y - o.y);
          if (d < 3.2) o.reveal = Math.min(1, o.reveal + dt * 1.6);
          if (o.reveal >= 1 && o.hidden) { o.hidden = false; this.emit('found', { x: o.x, y: o.y }); }
          want *= o.hidden ? 0 : 1;
        }
        o.open += (want - o.open) * Math.min(1, dt * (want > o.open ? 5 : 9));
        if (o.drift) {
          const t = this.bars * o.drift[2];
          o.x = clamp(o.x0 + Math.sin(t * Math.PI * 2) * o.drift[0], -HALF + 2, HALF - 2);
          o.y = clamp(o.y0 + Math.sin(t * Math.PI * 2 * 0.5 + 1) * o.drift[1], -HALF + 2, HALF - 2);
        }
        const p = this.pearls[0];
        const lx = p ? clamp((p.x - o.x) / 8, -1, 1) : 0, ly = p ? clamp((p.y - o.y) / 8, -1, 1) : 0;
        o.look[0] += (lx - o.look[0]) * Math.min(1, dt * 4); o.look[1] += (ly - o.look[1]) * Math.min(1, dt * 4);
      }
    }
    // things arriving: pearls drop from above, ink climbs up out of the fabric
    for (let k = this.respawns.length - 1; k >= 0; k--) {
      const r = this.respawns[k];
      if (this.time < r.at || this.state === 'done') continue;
      this.respawns.splice(k, 1);
      if (r.kind === 'pearl') { const b = new Body('pearl', r.x, r.y, sh.height(r.x, r.y) + 7, 0.6); b.vz = -2; sh.bodies.push(b); this.emit('arrive', { x: r.x, y: r.y }); }
      else { const b = new Body('ink', r.x, r.y, sh.height(r.x, r.y) + 0.2, 0.68); b.vz = 4; sh.bodies.push(b); this.emit('inkup', { x: r.x, y: r.y }); }
    }
    // ink: afraid of your light, hungry for the pearl
    const p = this.pearls[0];
    for (const b of this.inks) {
      if (!b.grounded) continue;
      let ax = 0, ay = 0;
      const hx = b.x - this.hand.x, hy = b.y - this.hand.y, hd = Math.hypot(hx, hy);
      if (hd < 5) { const f = (1 - hd / 5) * (14 + 16 * this.hand.glow); ax += (hx / (hd || 1)) * f; ay += (hy / (hd || 1)) * f; }
      if (p) { const px = p.x - b.x, py = p.y - b.y, pd = Math.hypot(px, py) || 1; ax += (px / pd) * 4.5; ay += (py / pd) * 4.5; }
      b.vx += ax * dt; b.vy += ay * dt;
      const s = Math.hypot(b.vx, b.vy), cap = 5.5;
      if (s > cap) { b.vx *= cap / s; b.vy *= cap / s; }
    }
    // lights bob
    for (const m of this.motes) {
      m.t += dt;
      const base = sh.height(m.x, m.y);
      m.zz = Math.max(base + 0.8, m.z + Math.sin(m.t * 2 + m.x) * 0.15);
    }
  }

  readSheetEvents() {
    const sh = this.sheet;
    for (const e of sh.events) {
      const b = e.body;
      if (e.type === 'drop') { this.emit('drop', { kind: b.kind, hole: e.hole?.kind }); continue; }
      if (e.type === 'land') {
        if (b.kind === 'pearl') {
          if (e.air > 0.8) { const pts = Math.round(e.air * 100); this.score += pts; this.stats.air = Math.max(this.stats.air, e.air); this.emit('air', { air: e.air, points: pts }); }
          this.emit('land', { speed: e.speed });
        }
        continue;
      }
      if (e.type === 'clack') { this.emit('clack', { speed: e.speed }); continue; }
      if (e.type !== 'fell') continue;
      const into = e.hole?.kind === 'eye' ? 'eye' : 'void';
      if (b.kind === 'pearl') {
        if (into === 'eye' && (this.goal === 'eye' || this.goal === 'pearls') && this.state === 'play') {
          this.progress.have++;
          this.emit('eye', { x: e.hole.x, y: e.hole.y, have: this.progress.have, need: this.progress.need });
          sh.pulse(e.hole.x, e.hole.y, 14, 3);
          if (this.progress.have >= this.progress.need) this.sceneClear();
        } else {
          this.stats.lost++;
          this.streak = 0;
          this.score = Math.max(0, this.score - 200);
          this.emit('lost', { into });
          const S = this.song.scenes[this.scene];
          const sp = (S.pearls || [S.pearl || [0, -6]])[0];
          if (this.state === 'play') this.respawns.push({ x: sp[0], y: sp[1], at: this.time + this.barLen * 0.5, kind: 'pearl' });
        }
      } else if (b.kind === 'ink') {
        if (into === 'eye') {
          this.stats.ink++;
          this.score += Math.round(300 * this.mult);
          if (this.goal === 'ink' && this.state === 'play') { this.progress.have++; if (this.progress.have >= this.progress.need) this.sceneClear(); }
          sh.pulse(e.hole.x, e.hole.y, 10, 2.5);
          this.emit('fed', { x: e.hole.x, y: e.hole.y });
        } else if (this.state === 'play') {
          // ink can't be got rid of except by an eye: it climbs back out somewhere else
          this.respawns.push({ x: (this.rng() - 0.5) * 14, y: (this.rng() - 0.5) * 14, at: this.time + 1.2, kind: 'ink' });
        }
      }
    }
    sh.events.length = 0;
  }

  checkGoals() {
    if (this.state !== 'play') return;
    // lights: the pearl only has to touch them
    for (const m of this.motes) {
      if (!m.alive) continue;
      for (const p of this.pearls) {
        if (Math.hypot(p.x - m.x, p.y - m.y, p.z - m.zz) < 1.1) {
          m.alive = 0;
          this.stats.motes++;
          this.score += Math.round(50 * this.mult);
          if (this.goal === 'gather') this.progress.have++;
          this.emit('mote', { x: m.x, y: m.y, have: this.progress.have, need: this.progress.need });
          break;
        }
      }
    }
    if (this.goal === 'gather' && this.progress.have >= this.progress.need) this.sceneClear();
  }

  // the HUD's description of what to do now
  goalText() {
    const { have, need } = this.progress;
    switch (this.goal) {
      case 'eye': return 'into the eye';
      case 'pearls': return `both pearls into the eyes · ${have}/${need}`;
      case 'gather': return `gather the lights · ${have}/${need}`;
      case 'ink': return `feed the ink to the eye · ${have}/${need}`;
      default: return '';
    }
  }

  // for the camera and shader: how far into the scene's phrase (0..1)
  get phraseLeft() { return this.state === 'play' ? clamp((this.sceneEnd - this.bars) / Math.max(1, this.sceneEnd - this.sceneStart), 0, 1) : 0; }
}

export { handShape, holeSD };
