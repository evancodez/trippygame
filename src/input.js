// One input layer for keyboard + mouse and gamepads (a PS5 DualSense shows up as a "standard" gamepad).
// Read once per frame with poll(); *Pressed fields are true only on the frame a button goes down.

const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  dive: ['Space', 'ArrowDown', 'KeyS', 'KeyJ', 'KeyZ'],
  flip: ['KeyE', 'KeyQ', 'ShiftLeft', 'ShiftRight', 'KeyK', 'KeyX'],
  pause: ['Escape', 'KeyP'],
  restart: ['KeyR'],
  confirm: ['Enter', 'Space'],
  back: ['Escape', 'Backspace'],
  hide: ['KeyH'],
};

// standard mapping (DualSense: 0 ✕, 1 ○, 2 □, 3 △, 4 L1, 5 R1, 6 L2, 7 R2, 8 Create, 9 Options, 12–15 d-pad)
const PAD = {
  dive: [0, 6, 7], flip: [2, 1, 3, 4, 5], pause: [9], restart: [8],
  confirm: [0], back: [1], up: [12], down: [13], left: [14], right: [15],
};
const ACTIONS = ['dive', 'flip', 'pause', 'restart', 'confirm', 'back', 'up', 'down', 'left', 'right', 'hide'];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.mouse = { x: 0, y: 0, buttons: 0, movedAt: -1e9, inside: false };
    this.prev = {};
    this.state = { device: 'keys' };
    this.lastDevice = 'keys';
    this.padIndex = -1;
    this.keySteerAt = -1e9;
    this.mouseSteer = true;
    this.playing = false;   // mouse steering only while riding (not in menus)

    addEventListener('keydown', e => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.lastDevice = 'keys';
      if ([...KEYS.left, ...KEYS.right].includes(e.code)) this.keySteerAt = performance.now();
    });
    addEventListener('keyup', e => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.mouse.buttons = 0; });
    canvas.addEventListener('pointermove', e => {
      const dx = e.clientX - this.mouse.x, dy = e.clientY - this.mouse.y;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) { this.mouse.movedAt = performance.now(); this.lastDevice = 'keys'; }
      this.mouse.inside = true;
    });
    canvas.addEventListener('pointerdown', e => { this.mouse.buttons = e.buttons; this.mouse.movedAt = performance.now(); this.lastDevice = 'keys'; });
    canvas.addEventListener('pointerup', e => { this.mouse.buttons = e.buttons; });
    canvas.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('gamepadconnected', e => { this.padIndex = e.gamepad.index; this.lastDevice = 'pad'; this.onPad?.(e.gamepad); });
    addEventListener('gamepaddisconnected', e => { if (e.gamepad.index === this.padIndex) this.padIndex = -1; this.onPad?.(null); });
  }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.padIndex >= 0 && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p && p.connected) { this.padIndex = p.index; return p; }
    return null;
  }

  poll() {
    const k = name => KEYS[name].some(c => this.down.has(c));
    const s = {};
    for (const a of ACTIONS) s[a] = KEYS[a] ? k(a) : false;
    let mx = (k('right') ? 1 : 0) - (k('left') ? 1 : 0);
    let my = (k('up') ? 1 : 0) - (k('down') ? 1 : 0);
    s.dive = s.dive || (this.mouse.buttons & 1) > 0;
    s.flip = s.flip || (this.mouse.buttons & 2) > 0;
    let lookX = 0, lookY = 0;
    const p = this.pad();
    if (p) {
      const b = i => p.buttons[i]?.pressed || (p.buttons[i]?.value ?? 0) > 0.35;
      for (const [a, list] of Object.entries(PAD)) if (list.some(b)) { s[a] = true; this.lastDevice = 'pad'; }
      const dz = v => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0);
      if (lx || ly) { mx = lx; my = -ly; this.lastDevice = 'pad'; }
      if (b(14)) mx = -1;
      if (b(15)) mx = 1;
      if (b(12)) my = 1;
      if (b(13)) my = -1;
      lookX = dz(p.axes[2] || 0);
      lookY = -dz(p.axes[3] || 0);
      if (lookX || lookY) this.lastDevice = 'pad';
    }
    // mouse steering: the pearl leans toward whichever side of the screen the pointer is on
    s.mouseSteer = false;
    const now = performance.now();
    if (this.mouseSteer && this.playing && mx === 0 && this.lastDevice === 'keys' && this.mouse.inside && now - this.mouse.movedAt < 2500 && now - this.keySteerAt > 1500) {
      const r = this.canvas.getBoundingClientRect();
      const off = (this.mouse.x - (r.left + r.width / 2)) / (r.width * 0.28);
      mx = Math.abs(off) < 0.06 ? 0 : Math.max(-1, Math.min(1, off));
      s.mouseSteer = true;
    }
    s.x = Math.max(-1, Math.min(1, mx));
    s.y = Math.max(-1, Math.min(1, my));
    s.look = { x: lookX, y: lookY };
    s.mouse = this.mouse;
    for (const a of ACTIONS) s[`${a}Pressed`] = s[a] && !this.prev[a];
    s.leftPressed = s.leftPressed || (s.x < -0.6 && !(this.prev.x < -0.6));
    s.rightPressed = s.rightPressed || (s.x > 0.6 && !(this.prev.x > 0.6));
    s.upPressed = s.upPressed || (s.y > 0.6 && !(this.prev.y > 0.6));
    s.downPressed = s.downPressed || (s.y < -0.6 && !(this.prev.y < -0.6));
    s.device = this.lastDevice;
    this.prev = { ...s };
    this.state = s;
    return s;
  }

  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    const p = this.pad();
    try { p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch {}
  }
}
