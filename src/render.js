// WebGL2 plumbing: one full-screen triangle, one fragment shader, and the sheet's height as a texture.
import { VERT, FRAG, MAX, LINE_KEYS } from './shader.js';
import { N } from './sheet.js';

export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error(log); throw new Error(log); }
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(prog, i); this.u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(prog, info.name); }
    // the height texture
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, N, N, 0, gl.RED, gl.FLOAT, new Float32Array(N * N));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.u.uH, 0);
    this.bufs = {};
    for (const [k, m] of [['holeA', MAX.holes], ['holeB', MAX.holes], ['holeC', MAX.holes], ['pearl', MAX.pearls], ['ink', MAX.ink], ['mote', MAX.motes], ['handA', MAX.hands], ['handB', MAX.hands]]) this.bufs[k] = new Float32Array(m * 4);
    this.lineBuf = new Float32Array(LINE_KEYS.length);
  }

  resize(w, h) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.gl.viewport(0, 0, w, h);
  }

  draw(f) {
    const gl = this.gl, u = this.u, B = this.bufs;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RED, gl.FLOAT, f.heights);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, f.time);
    gl.uniform3fv(u.uCamPos, f.cam.pos); gl.uniform3fv(u.uCamR, f.cam.right); gl.uniform3fv(u.uCamU, f.cam.up); gl.uniform3fv(u.uCamF, f.cam.fwd);
    gl.uniform1f(u.uFov, f.cam.fov);
    LINE_KEYS.forEach((k, i) => { this.lineBuf[i] = f.lines[k] ?? 0; });
    gl.uniform1fv(u.uL, this.lineBuf);
    for (const k of ['paper', 'ink', 'void', 'accent', 'rival']) gl.uniform3fv(u[`u${k[0].toUpperCase()}${k.slice(1)}`], f.palette[k]);
    const fill = (buf, list, fn, max) => { buf.fill(0); const n = Math.min(list.length, max); for (let i = 0; i < n; i++) buf.set(fn(list[i]), i * 4); return n; };
    const nh = fill(B.holeA, f.holes, o => [o.x, o.y, o.a, o.b], MAX.holes);
    fill(B.holeB, f.holes, o => [o.ang, o.open, o.kind === 'tear' ? 1 : o.hidden ? 2 : 0, o.reveal ?? 1], MAX.holes);
    fill(B.holeC, f.holes, o => [o.look?.[0] || 0, o.look?.[1] || 0, 0, 0], MAX.holes);
    gl.uniform1i(u.uHoleN, nh);
    gl.uniform4fv(u.uHoleA, B.holeA); gl.uniform4fv(u.uHoleB, B.holeB); gl.uniform4fv(u.uHoleC, B.holeC);
    gl.uniform1i(u.uPearlN, fill(B.pearl, f.pearls, b => [b.x, b.y, b.z, b.r], MAX.pearls));
    gl.uniform4fv(u.uPearl, B.pearl);
    gl.uniformMatrix3fv(u.uPearlRot, false, f.pearlRot);
    gl.uniform1i(u.uInkN, fill(B.ink, f.inks, b => [b.x, b.y, b.z, b.r], MAX.ink));
    gl.uniform4fv(u.uInk8, B.ink);
    gl.uniform1i(u.uMoteN, fill(B.mote, f.motes, m => [m.x, m.y, m.zz ?? m.z, m.alpha], MAX.motes));
    gl.uniform4fv(u.uMote, B.mote);
    gl.uniform1i(u.uHandN, fill(B.handA, f.hands, H => [H.x, H.y, H.ang, H.push - H.press], MAX.hands));
    fill(B.handB, f.hands, H => [H.glow, H.kind, 0, 0], MAX.hands);
    gl.uniform4fv(u.uHandA, B.handA); gl.uniform4fv(u.uHandB, B.handB);
    gl.uniform4fv(u.uFx, f.fx);
    gl.uniform1f(u.uSteps, f.steps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
