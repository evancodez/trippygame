// A simple player that pushes from behind: used by the title screen (and the headless tests).
const clampA = (x, a, b) => Math.min(b, Math.max(a, x));
export function bot(game, mem = {}) {
  const sh = game.sheet, H = game.hand;
  const pearls = game.pearls;
  let subject = pearls[0], goal = null;
  const eyes = sh.holes.filter(o => o.kind === 'eye' && !o.hidden);
  if (game.goal === 'gather') {
    const m = game.motes.filter(m => m.alive).sort((a, b) => Math.hypot(a.x - subject?.x, a.y - subject?.y) - Math.hypot(b.x - subject?.x, b.y - subject?.y))[0];
    if (m) goal = { x: m.x, y: m.y };
  } else if (game.goal === 'ink') {
    const ink = game.inks.sort((a, b) => a.y - b.y)[0];
    if (ink) { subject = ink; goal = eyes[0]; }
  } else {
    goal = eyes[0];
    if (game.goal === 'pearls' && pearls.length > 1) { subject = pearls[mem.k = ((mem.k ?? 0) + (mem.switch ? 1 : 0)) % pearls.length] || pearls[0]; goal = eyes[mem.k % eyes.length] || eyes[0]; }
  }
  if (!subject || !goal) return { target: [H.x, H.y], push: 0, press: 0 };
  let dx = goal.x - subject.x, dy = goal.y - subject.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
  const back = subject.kind === 'ink' ? 3.2 : 2.3;
  const tx = clampA(subject.x - dx * back, -11.4, 11.4), ty = clampA(subject.y - dy * back, -11.4, 11.4);
  const there = Math.hypot(tx - H.x, ty - H.y) < 0.7;
  mem.t = (mem.t ?? 0) + 1 / 60;
  let push = 0;
  if (subject.kind === 'pearl' && there && subject.grounded && Math.hypot(subject.vx, subject.vy) < 3.5 + Math.min(4, d * 0.3)) { mem.pushing = mem.pushing || mem.t; }
  if (mem.pushing) { push = 1; if (mem.t - mem.pushing > 0.45) { mem.pushing = 0; mem.switch = true; } }
  else mem.switch = false;
  // near the eye and moving too fast: press a well just past it to catch
  let press = 0;
  if (subject.kind === 'pearl' && d < 3 && Math.hypot(subject.vx, subject.vy) > 4) press = 0;
  return { target: [tx, ty], push, press };
}
