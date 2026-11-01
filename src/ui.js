// Menus and HUD (plain DOM over the canvas). Menus are lists of items you can drive with the mouse,
// the keyboard or a controller: up/down to move, left/right to change a slider, confirm to pick, back to leave.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(3)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

export const fmtTime = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;

export class UI {
  constructor(root, sound) {
    this.root = root;
    this.sound = sound;
    this.items = [];
    this.focus = 0;
    this.onBack = null;
    this.menuEl = h('div', { class: 'menu-layer' });
    this.hud = h('div', { class: 'hud' });
    this.hintEl = h('div', { class: 'hint' });
    this.toastEl = h('div', { class: 'toast' });
    root.append(this.hud, this.hintEl, this.menuEl, this.toastEl);
  }

  // ------------------------------------------------------------------ menus
  // items: { label, action } | { label, value, min, max, step, onChange } | { label, toggle, onChange } | { el } (custom card)
  show(screen) {
    this.items = [];
    this.focus = 0;
    this.onBack = screen.back || null;
    const list = h('div', { class: `menu ${screen.class || ''}` });
    if (screen.title) list.append(h('div', { class: 'menu-title', html: screen.title }));
    if (screen.subtitle) list.append(h('div', { class: 'menu-sub', html: screen.subtitle }));
    if (screen.body) list.append(screen.body);
    const wrap = h('div', { class: screen.grid ? 'menu-grid' : 'menu-items' });
    screen.items.forEach((it, i) => {
      let el;
      if (it.card) {
        el = it.card;
        el.classList.add('menu-item');
        el.addEventListener('click', () => { this.focus = i; this.activate(); });
      } else if (it.min != null) {
        const out = h('span', { class: 'val' });
        const bar = h('i');
        const paint = () => { out.textContent = it.format ? it.format(it.value) : Math.round(it.value * 100) + '%'; bar.style.width = `${((it.value - it.min) / (it.max - it.min)) * 100}%`; };
        el = h('button', { class: 'menu-item slider-item' }, h('span', {}, it.label), h('span', { class: 'track' }, bar), out);
        el.addEventListener('click', e => {
          const r = el.querySelector('.track').getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right) { it.value = it.min + (it.max - it.min) * (e.clientX - r.left) / r.width; it.onChange(it.value); paint(); }
        });
        it.adjust = d => { it.value = Math.min(it.max, Math.max(it.min, it.value + d * (it.step || 0.1))); it.onChange(it.value); paint(); };
        paint();
      } else if (it.toggle != null) {
        el = h('button', { class: 'menu-item toggle-item' }, h('span', {}, it.label), h('span', { class: 'val' }));
        const paint = () => { el.querySelector('.val').textContent = it.toggle ? 'On' : 'Off'; };
        it.flip = () => { it.toggle = !it.toggle; it.onChange(it.toggle); paint(); };
        el.addEventListener('click', () => it.flip());
        paint();
      } else {
        el = h('button', { class: `menu-item ${it.class || ''}`, disabled: it.disabled }, it.label);
        el.addEventListener('click', () => { if (!it.disabled) { this.focus = i; this.activate(); } });
      }
      el.addEventListener('pointerenter', () => { if (!it.disabled) { this.focus = i; this.paintFocus(); } });
      it.el = el;
      this.items.push(it);
      wrap.append(el);
    });
    list.append(wrap);
    if (screen.footer) list.append(h('div', { class: 'menu-foot', html: screen.footer }));
    this.menuEl.replaceChildren(list);
    this.menuEl.classList.add('open');
    this.focus = Math.max(0, screen.focus ?? this.items.findIndex(it => !it.disabled));
    this.grid = screen.grid ? screen.grid : 0;
    this.paintFocus();
  }

  hide() { this.menuEl.classList.remove('open'); this.menuEl.replaceChildren(); this.items = []; }
  get open() { return this.items.length > 0; }

  paintFocus() { this.items.forEach((it, i) => it.el.classList.toggle('focus', i === this.focus)); this.items[this.focus]?.el.scrollIntoView?.({ block: 'nearest' }); }

  move(d) {
    if (!this.items.length) return;
    let i = this.focus;
    for (let n = 0; n < this.items.length; n++) {
      i = (i + d + this.items.length) % this.items.length;
      if (!this.items[i].disabled) break;
    }
    this.focus = i;
    this.sound.sfx('ui');
    this.paintFocus();
  }

  activate() {
    const it = this.items[this.focus];
    if (!it || it.disabled) return;
    if (it.flip) return it.flip();
    if (it.adjust) return;
    this.sound.sfx('uiok');
    it.action?.();
  }

  // drive the open menu from the unified input
  drive(inp) {
    if (!this.items.length) return;
    const g = this.grid;
    if (inp.upPressed) this.move(g ? -g : -1);
    if (inp.downPressed) this.move(g ? g : 1);
    const it = this.items[this.focus];
    if (inp.leftPressed) { if (it?.adjust) it.adjust(-1); else if (g) this.move(-1); }
    if (inp.rightPressed) { if (it?.adjust) it.adjust(1); else if (g) this.move(1); }
    if (inp.confirmPressed || inp.jumpPressed) this.activate();
    else if ((inp.backPressed || (inp.pausePressed && this.onBack)) && this.onBack) { this.sound.sfx('ui'); this.onBack(); }
  }

  // ------------------------------------------------------------------ HUD + hints + toasts
  setHud(html) { this.hud.innerHTML = html; this.hud.classList.toggle('show', !!html); }

  hint(text) {
    clearTimeout(this.hintTimer);
    if (!text) { this.hintEl.classList.remove('show'); return; }
    this.hintEl.innerHTML = text;
    this.hintEl.classList.add('show');
    this.hintTimer = setTimeout(() => this.hintEl.classList.remove('show'), 6500);
  }

  toast(text) {
    clearTimeout(this.toastTimer);
    this.toastEl.innerHTML = text;
    this.toastEl.classList.add('show');
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 2400);
  }
}
