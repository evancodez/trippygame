// One input layer for keyboard + mouse and gamepads (a PS5 DualSense shows up as a "standard" gamepad).
// Read once per frame with poll(); *Pressed fields are true only on the frame a button goes down.

const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  push: ['Space', 'KeyJ', 'KeyZ'],
  press: ['ShiftLeft', 'ShiftRight', 'KeyK', 'KeyX'],
  pause: ['Escape', 'KeyP'],
  restart: ['KeyR'],
  confirm: ['Enter', 'Space'],
  back: ['Escape', 'Backspace'],
  hide: ['KeyH'],
};

// standard mapping (DualSense: 0 ✕, 1 ○, 2 □, 3 △, 4 L1, 5 R1, 6 L2, 7 R2, 8 Create, 9 Options, 12–15 d-pad)
const PAD = { push: [0, 5], press: [2, 4], pause: [9], restart: [8], confirm: [0], back: [1], up: [12], down: [13], left: [14], right: [15] };
const ACTIONS = ['push', 'press', 'pause', 'restart', 'confirm', 'back', 'up', 'down', 'left', 'right', 'hide'];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.mouse = { x: 0, y: 0, buttons: 0, movedAt: -1e9, inside: false };
    this.prev = {};
    this.state = { device: 'keys' };
    this.lastDevice = 'keys';
    this.padIndex = -1;
    this.mouseAt = -1e9;     // when the mouse last moved or clicked
    this.keysAt = -1e9;      // when movement keys were last used
    addEventListener('keydown', e => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.lastDevice = 'keys';
      if ([...KEYS.left, ...KEYS.right, ...KEYS.up, ...KEYS.down].includes(e.code)) this.keysAt = performance.now();
    });
    addEventListener('keyup', e => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.mouse.buttons = 0; });
    canvas.addEventListener('pointermove', e => {
      const moved = Math.abs(e.clientX - this.mouse.x) + Math.abs(e.clientY - this.mouse.y) > 1;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
      if (moved) { this.mouseAt = performance.now(); this.lastDevice = 'keys'; }
    });
    canvas.addEventListener('pointerdown', e => { this.mouse.buttons = e.buttons; this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouseAt = performance.now(); this.lastDevice = 'keys'; });
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
    let push = s.push || (this.mouse.buttons & 1) ? 1 : 0;
    let press = s.press || (this.mouse.buttons & 2) ? 1 : 0;
    const p = this.pad();
    if (p) {
      const val = i => p.buttons[i]?.value ?? (p.buttons[i]?.pressed ? 1 : 0);
      const b = i => p.buttons[i]?.pressed || val(i) > 0.35;
      for (const [a, list] of Object.entries(PAD)) if (list.some(b)) { s[a] = true; this.lastDevice = 'pad'; }
      const dz = v => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0);
      if (lx || ly) { mx = lx; my = -ly; this.lastDevice = 'pad'; }
      if (b(14)) mx = -1;
      if (b(15)) mx = 1;
      if (b(12)) my = 1;
      if (b(13)) my = -1;
      // the triggers are pressure: how hard you squeeze is how hard the hand pushes
      const r2 = val(7), l2 = val(6);
      if (r2 > 0.05 || l2 > 0.05) this.lastDevice = 'pad';
      push = Math.max(push, r2, (b(0) || b(5)) ? 1 : 0);
      press = Math.max(press, l2, (b(2) || b(4)) ? 1 : 0);
    }
    s.mx = Math.max(-1, Math.min(1, mx));
    s.my = Math.max(-1, Math.min(1, my));
    s.pushAmt = push;
    s.pressAmt = press;
    s.mouse = this.mouse;
    // the mouse leads while it's the thing you last touched
    s.useMouse = this.lastDevice === 'keys' && this.mouse.inside && this.mouseAt > this.keysAt;
    s.x = s.mx; s.y = s.my;
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
