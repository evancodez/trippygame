// One input layer for keyboard + mouse and gamepads (a PS5 DualSense shows up as a "standard" gamepad).
// Everything is read once per frame with poll(); *Pressed fields are true only on the frame a button goes down.

const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyZ', 'KeyK'],
  dash: ['ShiftLeft', 'ShiftRight', 'KeyX', 'KeyJ'],
  flip: ['KeyE', 'KeyC', 'KeyL', 'KeyQ'],
  lens: ['KeyF'],
  pause: ['Escape', 'KeyP'],
  restart: ['KeyR'],
  confirm: ['Enter', 'Space'],
  back: ['Escape', 'Backspace'],
};

// standard gamepad mapping (DualSense: 0 Cross, 1 Circle, 2 Square, 3 Triangle, 4 L1, 5 R1, 6 L2, 7 R2, 8 Create, 9 Options, 12–15 d-pad)
const PAD = {
  jump: [0], dash: [2, 1], flip: [3, 4, 5], lens: [6, 7], pause: [9], restart: [8],
  confirm: [0], back: [1], up: [12], down: [13], left: [14], right: [15],
};
const ACTIONS = ['jump', 'dash', 'flip', 'lens', 'pause', 'restart', 'confirm', 'back', 'up', 'down', 'left', 'right'];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.mouse = { x: 0, y: 0, buttons: 0, movedAt: -1e9, inside: false };
    this.prev = {};
    this.state = {};
    this.lastDevice = 'keyboard';
    this.padIndex = -1;

    addEventListener('keydown', e => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
    });
    addEventListener('keyup', e => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.mouse.buttons = 0; });
    canvas.addEventListener('pointermove', e => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.movedAt = performance.now();
      this.mouse.inside = true;
      this.lastDevice = 'keyboard';
    });
    canvas.addEventListener('pointerdown', e => { this.mouse.buttons = e.buttons; this.mouse.movedAt = performance.now(); canvas.setPointerCapture?.(e.pointerId); });
    canvas.addEventListener('pointerup', e => { this.mouse.buttons = e.buttons; });
    canvas.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('gamepadconnected', e => { this.padIndex = e.gamepad.index; this.lastDevice = 'gamepad'; this.onPad?.(e.gamepad); });
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
    s.lens = s.lens || this.mouse.buttons > 0;
    let aimX = 0, aimY = 0;
    const p = this.pad();
    if (p) {
      const b = i => p.buttons[i]?.pressed || (p.buttons[i]?.value ?? 0) > 0.35;
      for (const [a, list] of Object.entries(PAD)) if (list.some(b)) { s[a] = true; this.lastDevice = 'gamepad'; }
      const dz = v => (Math.abs(v) < 0.22 ? 0 : (v - Math.sign(v) * 0.22) / 0.78);
      const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0);
      if (lx || ly) { mx = lx; my = -ly; this.lastDevice = 'gamepad'; }
      if (b(14)) mx = -1;
      if (b(15)) mx = 1;
      if (b(12)) my = 1;
      if (b(13)) my = -1;
      aimX = dz(p.axes[2] || 0);
      aimY = -dz(p.axes[3] || 0);
      if (aimX || aimY) this.lastDevice = 'gamepad';
    }
    s.x = Math.max(-1, Math.min(1, mx));
    s.y = Math.max(-1, Math.min(1, my));
    s.aim = { x: aimX, y: aimY };
    s.mouse = this.mouse;
    s.mouseAim = this.lastDevice === 'keyboard' && performance.now() - this.mouse.movedAt < 4000 && this.mouse.inside;
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

  // a short rumble on the controller, if it can
  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    const p = this.pad();
    try { p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch {}
  }
}
