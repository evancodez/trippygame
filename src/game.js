// The simulation: player controller, collisions, the illusion mechanics and everything that moves.
// It runs at a fixed 120 steps per second and knows nothing about drawing; it reports what happened
// through `events` (jump, land, collect…) so sound, rumble and effects can react.
import { T, E } from './level.js';

export const PHYS = {
  w: 0.62, h: 1.3,
  run: 9.2, accGround: 110, decGround: 130, accAir: 75, decAir: 38,
  jumpV: 19.2, gUp: 48, gUpCut: 115, gDown: 82, maxFall: 23,
  coyote: 0.11, buffer: 0.14,
  wallSlide: 5.5, wallJumpX: 11.5, wallJumpY: 17.8, wallLock: 0.15,
  dashSpeed: 25, dashTime: 0.145, dashCool: 0.18,
  bounce: 25,
};
const STEP = 1 / 120;
const EPS = 1e-4;
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));

export class Game {
  constructor(def) {
    const L = def.build();
    this.def = def;
    this.w = L.w; this.h = L.h;
    this.tiles = L.tiles;
    this.dyn = new Float32Array(L.w * L.h);       // per-tile state: ghost reveal, riser height, crumble timer
    this.hints = L.hints;
    this.ghosts = []; this.risers = []; this.crumbles = [];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const t = L.tiles[y * L.w + x];
      if (t === T.GHOST) this.ghosts.push(y * L.w + x);
      else if (t === T.RISER) this.risers.push(y * L.w + x);
      else if (t === T.CRUMBLE) this.crumbles.push({ i: y * L.w + x, t: 0, back: 0 });
    }
    this.entities = L.entities.map((e, id) => ({ ...e, id, x0: e.x, y0: e.y, alive: true, got: false, anim: 0, dx: 0, dy: 0 }));
    this.total = { orbs: this.entities.filter(e => e.type === E.ORB).length, prisms: this.entities.filter(e => e.type === E.PRISM).length };
    this.got = { orbs: 0, prisms: 0 };
    this.spawn = { ...L.startPos };
    this.time = 0;
    this.clock = 0;
    this.deaths = 0;
    this.flip = 0;
    this.flipWave = { x: 0, y: 0, r: 1e3, prev: 0, t: 1 };
    this.lens = { x: 0, y: 0, r: 3.1, on: 0, active: false };
    this.chase = def.chase ? { ...def.chase, x: -1e9, started: false } : null;
    this.events = [];
    this.done = false;
    this.acc = 0;
    this.hitstop = 0;
    this.p = this.newPlayer();
  }

  newPlayer() {
    return {
      x: this.spawn.x, y: this.spawn.y, vx: 0, vy: 0, facing: 1,
      ground: false, wall: 0, coyote: 0, buffer: 0, lock: 0,
      dash: 0, dashCool: 0, canDash: true, dashDir: [1, 0],
      squash: 0, phase: 0, dead: -1, spawnT: 0, ride: null, airTime: 0, boost: 0,
      trail: [], lookX: 1, lookY: 0,
    };
  }

  // ------------------------------------------------------------------ tiles
  tile(x, y) {
    if (x < 0 || x >= this.w) return T.SOLID;          // the sides of a level are walls
    if (y < 0 || y >= this.h) return T.EMPTY;
    return this.tiles[y * this.w + x];
  }
  solidTile(t, i) {
    switch (t) {
      case T.SOLID: return true;
      case T.FLIP_A: return this.flip === 0;
      case T.FLIP_B: return this.flip === 1;
      case T.GHOST: return this.dyn[i] >= 0.5;
      case T.CRUMBLE: return this.dyn[i] < 1;
      case T.RISER: return this.dyn[i] >= 0.6;
      default: return false;
    }
  }
  solid(x, y) {
    const t = this.tile(x, y);
    if (x < 0 || x >= this.w) return true;
    if (y < 0 || y >= this.h) return false;
    return this.solidTile(t, y * this.w + x);
  }
  overlapsBox(x0, y0, x1, y1, test) {
    for (let y = Math.floor(y0); y <= Math.floor(y1 - EPS); y++)
      for (let x = Math.floor(x0); x <= Math.floor(x1 - EPS); x++) if (test(x, y)) return true;
    return false;
  }
  playerBox(p = this.p) { return [p.x - PHYS.w / 2, p.y, p.x + PHYS.w / 2, p.y + PHYS.h]; }
  touchesTile(i) {
    const x = i % this.w, y = Math.floor(i / this.w);
    const [a, b, c, d] = this.playerBox();
    return a < x + 1 && c > x && b < y + 1 && d > y;
  }
  // a block is about to appear where you are: if only your feet are in it, stand on top of it instead
  makeRoomFor(i) {
    if (!this.touchesTile(i)) return true;
    const y = Math.floor(i / this.w), p = this.p;
    if (p.y >= y + 1 - 0.4 && !this.overlapsBox(p.x - PHYS.w / 2, y + 1, p.x + PHYS.w / 2, y + 1 + PHYS.h, (cx, cy) => this.solid(cx, cy))) {
      p.y = y + 1;
      p.vy = Math.max(p.vy, 0);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ the main step
  update(dt, input, lensAim) {
    if (this.done) return;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      if (this.hitstop > 0) { this.hitstop -= STEP; continue; }
      this.step(STEP, input, lensAim);
      input = { ...input, jumpPressed: false, dashPressed: false, flipPressed: false };
    }
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  step(dt, inp, lensAim) {
    this.time += dt;
    const p = this.p;
    if (!this.done && p.dead < 0) this.clock += dt;
    this.updateEntities(dt);
    this.updateTiles(dt, inp, lensAim);

    if (p.dead >= 0) {
      p.dead += dt;
      if (p.dead > 0.6) this.respawn();
      return;
    }
    p.spawnT += dt;

    // ---- flip the world (figure ↔ ground)
    if (inp.flipPressed && this.def.flip) {
      const next = 1 - this.flip;
      const blocked = this.overlapsBox(...this.playerBox(), (x, y) => {
        const t = this.tile(x, y);
        return (t === T.FLIP_A && next === 0) || (t === T.FLIP_B && next === 1);
      });
      if (blocked) this.emit('deny');
      else {
        this.flipWave = { x: p.x, y: p.y + PHYS.h / 2, r: 0, prev: this.flip, t: 0 };
        this.flip = next;
        this.emit('flip');
      }
    }

    // ---- timers
    p.coyote -= dt; p.buffer -= dt; p.lock -= dt; p.dashCool -= dt;
    if (inp.jumpPressed) p.buffer = PHYS.buffer;
    const ix = Math.abs(inp.x) > 0.2 ? Math.sign(inp.x) * Math.min(1, Math.abs(inp.x) * 1.15) : 0;
    if (ix) p.facing = Math.sign(ix);

    // ---- dash (8 directions)
    if (inp.dashPressed && p.canDash && p.dashCool <= 0) {
      let dx = Math.abs(inp.x) > 0.3 ? Math.sign(inp.x) : 0;
      let dy = Math.abs(inp.y) > 0.3 ? Math.sign(inp.y) : 0;
      if (!dx && !dy) dx = p.facing;
      const n = Math.hypot(dx, dy);
      p.dashDir = [dx / n, dy / n];
      p.dash = PHYS.dashTime;
      p.canDash = false;
      p.dashCool = PHYS.dashTime + PHYS.dashCool;
      p.ride = null;
      this.hitstop = 0.035;
      this.emit('dash', { x: p.x, y: p.y + 0.6, dx: p.dashDir[0], dy: p.dashDir[1] });
    }

    if (p.dash > 0) {
      p.dash -= dt;
      p.vx = p.dashDir[0] * PHYS.dashSpeed;
      p.vy = p.dashDir[1] * PHYS.dashSpeed;
      if (p.trail.length === 0 || this.time - p.trail[p.trail.length - 1].t > 0.022) p.trail.push({ x: p.x, y: p.y, t: this.time, f: p.facing });
      if (p.dash <= 0) { p.vx *= 0.55; p.vy *= p.vy > 0 ? 0.4 : 0.6; }
    } else {
      const target = ix * PHYS.run;
      let a = p.ground ? (ix ? PHYS.accGround : PHYS.decGround) : (ix ? PHYS.accAir : PHYS.decAir);
      if (ix && Math.sign(p.vx) !== ix && p.ground) a *= 1.6;   // snappy turnarounds
      if (p.lock > 0) a *= 0.2;
      p.vx = approach(p.vx, target, a * dt);
      p.boost -= dt;
      const g = p.vy > 0 ? (inp.jump || p.boost > 0 ? PHYS.gUp : PHYS.gUpCut) : PHYS.gDown;
      p.vy -= g * dt;
      if (!p.ground && p.wall && ix === p.wall && p.vy < -PHYS.wallSlide) { p.vy = -PHYS.wallSlide; this.emit('slide'); }
      p.vy = Math.max(p.vy, -PHYS.maxFall);
    }
    while (p.trail.length && this.time - p.trail[0].t > 0.25) p.trail.shift();

    // ---- jumping (with coyote time, buffering and wall jumps)
    if (p.buffer > 0 && p.dash <= 0) {
      if (p.ground || p.coyote > 0) {
        p.vy = PHYS.jumpV + (p.ride ? Math.max(0, p.ride.dy / dt) * 0.5 : 0);
        p.ground = false; p.coyote = 0; p.buffer = 0; p.ride = null;
        p.squash = -0.3;
        this.emit('jump', { x: p.x, y: p.y });
      } else if (p.wall) {
        p.vx = -p.wall * PHYS.wallJumpX;
        p.vy = PHYS.wallJumpY;
        p.facing = -p.wall;
        p.lock = PHYS.wallLock;
        p.buffer = 0;
        p.squash = -0.25;
        this.emit('walljump', { x: p.x + p.wall * 0.3, y: p.y + 0.6 });
      }
    }

    // ---- ride a moving platform
    if (p.ride && p.ride.alive) {
      p.x += p.ride.dx;
      p.y = p.ride.top;
    }

    // ---- move and collide
    const wasGround = p.ground;
    const prevY = p.y;
    const fallSpeed = -p.vy;
    this.moveX(p.vx * dt);
    this.moveY(p.vy * dt, prevY);
    this.platforms(prevY);
    p.wall = p.ground ? 0 : this.wallSide();
    if (p.ground) {
      p.coyote = PHYS.coyote;
      if (p.dash <= 0) p.canDash = true;
      if (!wasGround) {
        p.squash = Math.min(0.35, fallSpeed / 60);
        this.emit('land', { x: p.x, y: p.y, speed: fallSpeed });
      }
      p.airTime = 0;
    } else p.airTime += dt;
    if (p.wall && p.dash <= 0 && ix === p.wall) p.canDash = p.canDash; // (dash isn't refreshed by walls)
    p.squash *= Math.exp(-dt * 12);
    p.phase += dt * Math.abs(p.vx) * (p.ground ? 1.9 : 0.6);

    // ---- what am I touching?
    this.touch();
    if (p.y < -3) this.die('fall');
    if (this.chase?.started && p.x - 0.3 < this.chase.x) this.die('static');
  }

  moveX(dx) {
    const p = this.p;
    p.x += dx;
    if (!dx) return;
    const col = dx > 0 ? Math.floor(p.x + PHYS.w / 2 - EPS) : Math.floor(p.x - PHYS.w / 2 + EPS);
    const feet = Math.floor(p.y + EPS), head = Math.floor(p.y + PHYS.h - EPS);
    for (let y = feet; y <= head; y++) {
      if (!this.solid(col, y)) continue;
      // forgiving corners: if only your feet clip a ledge's top edge, step up onto it
      if (y === feet && y + 1 - p.y < 0.3 && !p.ground &&
          !this.overlapsBox(p.x - PHYS.w / 2, y + 1, p.x + PHYS.w / 2, y + 1 + PHYS.h, (cx, cy) => this.solid(cx, cy))) {
        p.y = y + 1;
        p.vy = Math.max(p.vy, 0);
        return;
      }
      p.x = dx > 0 ? col - PHYS.w / 2 : col + 1 + PHYS.w / 2;
      if (p.dash <= 0) p.vx = 0;
      return;
    }
  }

  moveY(dy, prevY) {
    const p = this.p;
    p.y += dy;
    p.ground = false;
    const x0 = Math.floor(p.x - PHYS.w / 2 + EPS), x1 = Math.floor(p.x + PHYS.w / 2 - EPS);
    if (dy <= 0) {
      const row = Math.floor(p.y);
      for (let x = x0; x <= x1; x++) {
        const t = this.tile(x, row);
        const oneWay = t === T.ONEWAY && prevY >= row + 1 - 0.02;
        if (this.solid(x, row) || oneWay) {
          p.y = row + 1; p.vy = Math.max(p.vy, 0); p.ground = true;
          if (p.dash > 0 && p.dashDir[1] < 0) p.dash = 0;
          break;
        }
      }
    } else {
      const row = Math.floor(p.y + PHYS.h);
      for (let x = x0; x <= x1; x++) {
        if (this.solid(x, row)) {
          // forgiving corners: nudge sideways around a ledge you barely clipped
          if (x === x0 && x0 !== x1 && x + 1 - (p.x - PHYS.w / 2) < 0.22 && !this.solid(x + 1, row)) { p.x = x + 1 + PHYS.w / 2 + EPS; continue; }
          if (x === x1 && x0 !== x1 && (p.x + PHYS.w / 2) - x < 0.22 && !this.solid(x - 1, row)) { p.x = x - PHYS.w / 2 - EPS; continue; }
          p.y = row - PHYS.h; p.vy = Math.min(p.vy, 0);
          if (p.dash > 0) p.dash = 0;
          this.emit('bonk');
          break;
        }
      }
    }
  }

  wallSide() {
    const p = this.p;
    const y0 = Math.floor(p.y + 0.15), y1 = Math.floor(p.y + PHYS.h - 0.15);
    const r = Math.floor(p.x + PHYS.w / 2 + 0.06), l = Math.floor(p.x - PHYS.w / 2 - 0.06);
    for (let y = y0; y <= y1; y++) { if (this.solid(r, y) && r < this.w) return 1; }
    for (let y = y0; y <= y1; y++) { if (this.solid(l, y) && l >= 0) return -1; }
    return 0;
  }

  // hands and movers are one-way platforms: land on their top while falling
  platforms(prevY) {
    const p = this.p;
    if (p.vy > 0) { p.ride = null; return; }
    for (const e of this.entities) {
      if (e.type !== E.HAND && e.type !== E.MOVER) continue;
      const half = e.type === E.HAND ? 0.95 : e.w / 2;
      if (Math.abs(p.x - e.x) > half + PHYS.w / 2 - 0.1) continue;
      const top = e.top;
      if (prevY >= top - 0.06 - Math.max(0, e.dy) && p.y <= top + 0.02) {
        if (!p.ground) this.emit('land', { x: p.x, y: top, speed: -p.vy });
        p.y = top; p.vy = 0; p.ground = true; p.ride = e;
        if (p.dash <= 0) p.canDash = true;
        return;
      }
    }
    if (p.ride && (Math.abs(p.x - p.ride.x) > (p.ride.type === E.HAND ? 0.95 : p.ride.w / 2) + PHYS.w / 2 || Math.abs(p.y - p.ride.top) > 0.05)) p.ride = null;
  }

  touch() {
    const p = this.p;
    const [x0, y0, x1, y1] = this.playerBox();
    // hazards (spikes have a smaller hitbox than their tile)
    for (let y = Math.floor(y0); y <= Math.floor(y1 - EPS); y++) {
      for (let x = Math.floor(x0); x <= Math.floor(x1 - EPS); x++) {
        const t = this.tile(x, y);
        if (t === T.STATIC && x0 < x + 0.9 && x1 > x + 0.1 && y0 < y + 0.9 && y1 > y + 0.1) return this.die('static');
        if (t === T.SPIKE && y0 < y + 0.45 && x0 < x + 0.85 && x1 > x + 0.15) return this.die('spike');
        if (t === T.SPIKE_DOWN && y1 > y + 0.55 && x0 < x + 0.85 && x1 > x + 0.15) return this.die('spike');
      }
    }
    const cx = p.x, cy = p.y + PHYS.h / 2;
    for (const e of this.entities) {
      if (!e.alive) continue;
      const dx = e.x - cx, dy = e.y - cy;
      switch (e.type) {
        case E.ORB:
          if (!e.got && Math.abs(dx) < 0.55 && Math.abs(dy) < 0.85) { e.got = true; this.got.orbs++; this.emit('orb', { x: e.x, y: e.y, n: this.got.orbs }); }
          break;
        case E.PRISM:
          if (!e.got && Math.abs(dx) < 0.7 && Math.abs(dy) < 0.95) { e.got = true; this.got.prisms++; this.hitstop = 0.06; this.emit('prism', { x: e.x, y: e.y }); }
          break;
        case E.CHECKPOINT:
          if (Math.abs(dx) < 0.8 && p.y > e.y - 0.5 && p.y < e.y + 2.5 && !e.got) {
            for (const o of this.entities) if (o.type === E.CHECKPOINT) o.got = false;
            e.got = true;
            this.spawn = { x: e.x, y: e.y };
            this.emit('checkpoint', { x: e.x, y: e.y + 1.6 });
          }
          break;
        case E.GOAL:
          if (Math.hypot(dx, dy) < 1.3) { this.done = true; this.emit('goal', { x: e.x, y: e.y }); }
          break;
        case E.DOME: {
          const r = 0.95;
          if (p.vy <= 0 && Math.abs(p.x - e.x) < r + PHYS.w / 2 - 0.1 && p.y <= e.y + 0.85 && p.y >= e.y - 0.2) {
            p.vy = PHYS.bounce * (e.power || 1);
            p.y = Math.max(p.y, e.y + 0.6);
            p.canDash = true; p.dash = 0; p.ground = false; p.ride = null; p.boost = 0.6;
            p.squash = -0.4;
            e.anim = 1;
            this.emit('bounce', { x: e.x, y: e.y + 0.6 });
          }
          break;
        }
        case E.WATCHER:
          if (Math.hypot(dx, dy * 0.85) < 0.85) {
            if (p.dash > 0 || p.dashCool > PHYS.dashCool * 0.5) {
              e.alive = false;
              p.canDash = true;
              this.hitstop = 0.08;
              this.emit('pop', { x: e.x, y: e.y });
            } else return this.die('watcher');
          }
          break;
        default:
      }
    }
  }

  die(cause) {
    const p = this.p;
    if (p.dead >= 0) return;
    p.dead = 0;
    this.deaths++;
    this.emit('die', { x: p.x, y: p.y + PHYS.h / 2, cause });
  }

  respawn() {
    const p = this.newPlayer();
    this.p = p;
    for (const c of this.crumbles) { c.t = 0; c.back = 0; this.dyn[c.i] = 0; }
    for (const e of this.entities) if (e.type === E.WATCHER) e.alive = true;
    if (this.chase?.started) this.chase.x = this.spawn.x - this.chase.gap;
    if (this.flip && this.def.resetFlip !== false) {
      // come back in the same world you died in, unless that would trap you
      const trapped = this.overlapsBox(...this.playerBox(), (x, y) => this.solid(x, y));
      if (trapped) this.flip = 1 - this.flip;
    }
    this.emit('spawn', { x: p.x, y: p.y + 0.6 });
  }

  // ------------------------------------------------------------------ the illusions
  updateTiles(dt, inp, lensAim) {
    const p = this.p;
    // the lens: reveals ghost blocks while it's held over them
    const L = this.lens;
    L.active = !!(this.def.lens && inp.lens && p.dead < 0);
    L.on += ((L.active ? 1 : 0) - L.on) * Math.min(1, dt * 14);
    if (lensAim) {
      const max = 7.5;
      let ax = lensAim.x - p.x, ay = lensAim.y - (p.y + 0.7);
      const d = Math.hypot(ax, ay);
      if (d > max) { ax *= max / d; ay *= max / d; }
      L.x += (p.x + ax - L.x) * Math.min(1, dt * 22);
      L.y += (p.y + 0.7 + ay - L.y) * Math.min(1, dt * 22);
    }
    for (const i of this.ghosts) {
      const x = i % this.w + 0.5, y = Math.floor(i / this.w) + 0.5;
      const want = L.on > 0.5 && Math.hypot(x - L.x, y - L.y) < L.r ? 1 : 0;
      const cur = this.dyn[i];
      let next = want ? Math.min(1, cur + dt * 7) : Math.max(0, cur - dt * 2.2);
      if (cur < 0.5 && next >= 0.5 && !this.makeRoomFor(i)) next = 0.49;   // never materialise inside you
      this.dyn[i] = next;
    }
    // risers: flat drawings that grow into blocks once you come near
    for (const i of this.risers) {
      const x = i % this.w + 0.5, y = Math.floor(i / this.w) + 0.5;
      if (this.dyn[i] > 0 || (Math.abs(x - p.x) < 7.5 && Math.abs(y - p.y) < 9)) {
        let next = Math.min(1, this.dyn[i] + dt * 2.2);
        if (this.dyn[i] < 0.6 && next >= 0.6 && !this.makeRoomFor(i)) next = 0.59;
        if (this.dyn[i] === 0 && next > 0) this.emit('rise', { x, y });
        this.dyn[i] = next;
      }
    }
    // crumbling blocks
    const standing = p.ground && p.dead < 0 ? [Math.floor(p.x - PHYS.w / 2 + EPS), Math.floor(p.x + PHYS.w / 2 - EPS), Math.floor(p.y - 0.5)] : null;
    for (const c of this.crumbles) {
      const x = c.i % this.w, y = Math.floor(c.i / this.w);
      if (this.dyn[c.i] === 0 && standing && y === standing[2] && x >= standing[0] && x <= standing[1]) { this.dyn[c.i] = 0.001; this.emit('crack', { x: x + 0.5, y: y + 1 }); }
      if (this.dyn[c.i] > 0 && this.dyn[c.i] < 1) { this.dyn[c.i] = Math.min(1, this.dyn[c.i] + dt / 0.45); if (this.dyn[c.i] >= 1) c.back = 2.6; }
      else if (this.dyn[c.i] >= 1) { c.back -= dt; if (c.back <= 0 && !this.touchesTile(c.i)) this.dyn[c.i] = 0; }
    }
    // flip wave grows outward
    if (this.flipWave.t < 1) { this.flipWave.t = Math.min(1, this.flipWave.t + dt / 0.5); this.flipWave.r = this.flipWave.t * 40; }
    // the static chases
    const ch = this.chase;
    if (ch) {
      if (!ch.started && p.x > ch.trigger) { ch.started = true; ch.x = p.x - ch.gap; this.emit('chase'); }
      if (ch.started && p.dead < 0) ch.x += ch.speed * dt;
    }
  }

  updateEntities(dt) {
    const t = this.time;
    for (const e of this.entities) {
      if (e.type === E.HAND) {
        const prevX = e.x, prevTop = e.top ?? e.y0;
        const s = 0.5 - 0.5 * Math.cos(((t / e.period) + e.phase) * Math.PI * 2);
        e.top = e.y0 + e.rise * s;
        e.dx = 0; e.dy = e.top - prevTop;
        void prevX;
      } else if (e.type === E.MOVER) {
        const prevX = e.x;
        e.x = e.x0 + e.range * (0.5 - 0.5 * Math.cos(((t / e.period) + e.phase) * Math.PI * 2));
        e.top = e.y0;
        e.dx = e.x - prevX; e.dy = 0;
      } else if (e.type === E.WATCHER) {
        const a = ((t / e.period) + e.phase) * Math.PI * 2;
        e.x = e.x0 + e.rangeX * Math.sin(a);
        e.y = e.y0 + e.rangeY * Math.sin(a) + 0.12 * Math.sin(t * 3.1 + e.id);
      } else if (e.type === E.DOME) {
        e.anim *= Math.exp(-dt * 5);
      }
    }
  }
}
