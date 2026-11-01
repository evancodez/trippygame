// WebGL2 plumbing: one full-screen pass with GAME_FRAG. The level lives in a texture
// (red = tile type, green = live tile state) that is refreshed every frame.
import { VERT, GAME_FRAG, MAX_ENTS } from './shader.js';
import { E } from './level.js';

export const PALETTES = [
  { // 0 Silk — bone and ink
    paper: '#f3efe6', ink: '#0d0d10', bgA: '#e2ddd2', bgB: '#cdc7bb', side: '#b4ada0',
    accent: '#e0104f', item: '#b8e62a', hazard: '#2f5cff', ghost: '#1fc8b9', flash: '#ffffff',
  },
  { // 1 Moiré — night
    paper: '#ebe8e1', ink: '#08080a', bgA: '#141418', bgB: '#25252c', side: '#4b4b55',
    accent: '#ff1f5e', item: '#c8ff3a', hazard: '#ff6a2c', ghost: '#41f2df', flash: '#41f2df',
  },
  { // 2 Figure/Ground — warm paper
    paper: '#f6f1e6', ink: '#111013', bgA: '#ddd5c6', bgB: '#c6bdac', side: '#ada290',
    accent: '#ff2a6d', item: '#ffcf2e', hazard: '#2f5cff', ghost: '#18c6b4', flash: '#ff2a6d',
  },
  { // 3 Tunnel — chrome dark
    paper: '#e8e7e3', ink: '#060607', bgA: '#101012', bgB: '#2b2b30', side: '#3d3d44',
    accent: '#ff2a5c', item: '#d7ff3a', hazard: '#ff7a2a', ghost: '#45e8ff', flash: '#ffffff',
  },
  { // 4 Bloom — Depression Cherry
    paper: '#f6e9ea', ink: '#13050a', bgA: '#5e021d', bgB: '#7d0127', side: '#3a0112',
    accent: '#ffffff', item: '#ffd84a', hazard: '#ff2e2e', ghost: '#7df2ff', flash: '#d80146',
  },
];

const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.prog = this.program(GAME_FRAG);
    this.loc = new Map();
    this.tex = gl.createTexture();
    this.ent = new Float32Array(MAX_ENTS * 4);
    this.entB = new Float32Array(MAX_ENTS * 4);
    this.trail = new Float32Array(8 * 4);
    this.rings = new Float32Array(10 * 4);
    this.levelW = 0; this.levelH = 0;
  }

  program(frag) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  u(name) {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.loc.get(name);
  }

  resize(w, h) {
    this.canvas.width = Math.max(2, Math.round(w));
    this.canvas.height = Math.max(2, Math.round(h));
  }

  setLevel(game) {
    const gl = this.gl;
    this.levelW = game.w; this.levelH = game.h;
    this.data = new Uint8Array(game.w * game.h * 4);
    for (let i = 0; i < game.w * game.h; i++) {
      this.data[i * 4] = game.tiles[i];
      this.data[i * 4 + 2] = (Math.random() * 255) | 0;
      this.data[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, game.w, game.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  }

  // v = { game, cam:{x,y}, viewH, tilt:[pitch, roll, amount], theme, rings:[{x,y,age,kind}], flash, fade, music:{beat,bar,loud}, time, chase }
  draw(v) {
    const gl = this.gl, g = v.game, p = g.p;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);

    // live tile state → green channel
    for (let i = 0; i < g.w * g.h; i++) this.data[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, g.dyn[i])) * 255);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, g.w, g.h, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
    gl.uniform1i(this.u('uLevel'), 0);
    gl.uniform2f(this.u('uLevelSize'), g.w, g.h);

    gl.uniform2f(this.u('uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u('uTime'), v.time);
    gl.uniform2f(this.u('uCam'), v.cam.x, v.cam.y);
    gl.uniform1f(this.u('uViewH'), v.viewH);
    gl.uniform3f(this.u('uTilt'), v.tilt[0], v.tilt[1], v.tilt[2]);
    gl.uniform1f(this.u('uFlip'), g.flip);
    gl.uniform4f(this.u('uFlipWave'), g.flipWave.x, g.flipWave.y, g.flipWave.t < 1 ? g.flipWave.r : 1e3, g.flipWave.prev);
    gl.uniform4f(this.u('uLens'), g.lens.x, g.lens.y, g.lens.r, g.def.lens ? g.lens.on : 0);

    const state = p.dash > 0 ? 3 : p.ground ? 0 : p.wall && p.vy < 0 ? 2 : 1;
    gl.uniform4f(this.u('uP0'), p.x, p.y, p.facing, p.phase);
    gl.uniform4f(this.u('uP1'), p.vx, p.vy, p.squash, state);
    gl.uniform4f(this.u('uP2'), p.dead, p.spawnT, p.lookX, p.lookY);
    this.trail.fill(-1);
    p.trail.slice(-8).forEach((t, i) => this.trail.set([t.x, t.y, g.time - t.t, t.f], i * 4));
    gl.uniform4fv(this.u('uTrail'), this.trail);

    // entities near the camera
    let n = 0;
    const halfW = v.viewH * (this.canvas.width / this.canvas.height) * 0.5 + 3;
    for (const e of g.entities) {
      if (n >= MAX_ENTS) break;
      const ey = e.type === E.HAND ? e.top : e.type === E.MOVER ? e.top : e.y;
      if (Math.abs(e.x - v.cam.x) > halfW + 2) continue;
      if (e.type !== E.HAND && Math.abs(ey - v.cam.y) > v.viewH * 0.5 + 3) continue;
      let a = 0;
      if (e.type === E.ORB || e.type === E.PRISM) a = e.got ? 1 : 0;
      else if (e.type === E.CHECKPOINT) a = e.open ?? 0;
      else if (e.type === E.DOME) a = e.anim;
      else if (e.type === E.WATCHER) a = e.alive ? 1 : 0;
      this.ent.set([e.x, ey, e.type, a], n * 4);
      this.entB.set([e.w || 0, 0, 0, 0], n * 4);
      n++;
    }
    gl.uniform4fv(this.u('uEnt'), this.ent);
    gl.uniform4fv(this.u('uEntB'), this.entB);
    gl.uniform1i(this.u('uEntCount'), n);

    this.rings.fill(-1);
    v.rings.slice(-10).forEach((r, i) => this.rings.set([r.x, r.y, r.age, r.kind], i * 4));
    gl.uniform4fv(this.u('uRings'), this.rings);

    const pal = PALETTES[v.theme] || PALETTES[0];
    gl.uniform1i(this.u('uTheme'), v.theme);
    for (const [k, name] of [['paper', 'uPaper'], ['ink', 'uInk'], ['bgA', 'uBgA'], ['bgB', 'uBgB'], ['accent', 'uAccent'], ['item', 'uItem'], ['hazard', 'uHazard'], ['ghost', 'uGhost'], ['side', 'uSide'], ['flash', 'uFlashCol']]) {
      gl.uniform3fv(this.u(name), rgb(pal[k]));
    }
    gl.uniform4f(this.u('uMusic'), v.music.beat, v.music.bar, v.music.loud, 0);
    gl.uniform1f(this.u('uChase'), g.chase?.started ? g.chase.x : -1e9);
    gl.uniform4f(this.u('uPost'), v.flash, v.fade, 0.7, 0.55);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
