// Levels are built in code (y points up, y = 0 is the bottom row) with a tiny builder API,
// which is far easier to reason about than ASCII when every jump has to be possible.

export const T = {
  EMPTY: 0,
  SOLID: 1,     // ink block
  ONEWAY: 2,    // thin ledge you can jump up through
  SPIKE: 3,     // spikes pointing up
  SPIKE_DOWN: 4,
  FLIP_A: 5,    // solid while the world is not flipped
  FLIP_B: 6,    // solid while the world is flipped
  GHOST: 7,     // only solid while the lens is on it
  STATIC: 8,    // TV static — deadly
  CRUMBLE: 9,   // falls a moment after you stand on it, comes back later
  RISER: 10,    // a flat drawing that rises into a block as you approach
};

export const E = {
  ORB: 1, PRISM: 2, CHECKPOINT: 3, GOAL: 4, DOME: 5, HAND: 6, MOVER: 7, WATCHER: 8,
};

export class LevelBuilder {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.entities = [];
    this.startPos = { x: 2.5, y: 3 };
    this.hints = [];
  }
  set(x, y, t) { if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.tiles[y * this.w + x] = t; return this; }
  get(x, y) { return x >= 0 && x < this.w && y >= 0 && y < this.h ? this.tiles[y * this.w + x] : 0; }
  // filled rectangle: x0..x1 (inclusive), y0..y1 (inclusive)
  rect(x0, y0, x1, y1, t = T.SOLID) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, t); return this; }
  // solid ground from y = 0 up to (not including) `top`, between x0 and x1
  ground(x0, x1, top, t = T.SOLID) { return this.rect(x0, 0, x1, top - 1, t); }
  clear(x0, y0, x1, y1) { return this.rect(x0, y0, x1, y1, T.EMPTY); }
  ledge(x0, x1, y) { return this.rect(x0, y, x1, y, T.ONEWAY); }
  spikes(x0, x1, y) { return this.rect(x0, y, x1, y, T.SPIKE); }
  spikesDown(x0, x1, y) { return this.rect(x0, y, x1, y, T.SPIKE_DOWN); }
  entity(type, x, y, params = {}) { this.entities.push({ type, x, y, ...params }); return this; }
  orb(x, y) { return this.entity(E.ORB, x + 0.5, y + 0.5); }
  orbs(x, y, n, dx = 1, dy = 0) { for (let i = 0; i < n; i++) this.orb(x + i * dx, y + i * dy); return this; }
  orbArc(x, y, n, w, hgt) { for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); this.entity(E.ORB, x + t * w + 0.5, y + 4 * hgt * t * (1 - t) + 0.5); } return this; }
  prism(x, y) { return this.entity(E.PRISM, x + 0.5, y + 0.6); }
  checkpoint(x, y) { return this.entity(E.CHECKPOINT, x + 0.5, y); }
  goal(x, y) { return this.entity(E.GOAL, x + 0.5, y + 1.6); }
  dome(x, y, power = 1) { return this.entity(E.DOME, x + 0.5, y, { power }); }
  // a hand that rises from below, carrying you; top of the palm travels from y to y + rise
  hand(x, y, rise = 4, period = 4, phase = 0) { return this.entity(E.HAND, x + 1, y, { rise, period, phase }); }
  mover(x, y, range = 5, period = 4, phase = 0, w = 3) { return this.entity(E.MOVER, x + w / 2, y, { range, period, phase, w }); }
  watcher(x, y, rangeX = 3, rangeY = 0, period = 3, phase = 0) { return this.entity(E.WATCHER, x + 0.5, y + 0.5, { rangeX, rangeY, period, phase }); }
  start(x, y) { this.startPos = { x: x + 0.5, y }; return this; }
  hint(x, text) { this.hints.push({ x, text }); return this; }
}
