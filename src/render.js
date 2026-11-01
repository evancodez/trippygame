// WebGL2 plumbing: one full-screen triangle, one big fragment shader (shader.js).
import { VERT, FRAG, MAX } from './shader.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        console.error(log, src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
        throw new Error(log);
      }
      return s;
    };
    const prog = this.prog = gl.createProgram();
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
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      const name = info.name.replace(/\[0\]$/, '');
      this.u[name] = gl.getUniformLocation(prog, info.name);
    }
    this.bufs = {
      orbs: new Float32Array(MAX.orbs * 4), rings: new Float32Array(MAX.rings * 4), ringGlow: new Float32Array(MAX.rings * 4),
      pillars: new Float32Array(MAX.pillars * 4), handA: new Float32Array(MAX.hands * 4), handB: new Float32Array(MAX.hands * 4),
      ripples: new Float32Array(MAX.ripples * 4),
    };
  }

  resize(w, h) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.gl.viewport(0, 0, w, h);
  }

  // f: a frame description built by main.js (see View.frame)
  draw(f) {
    const gl = this.gl, u = this.u, B = this.bufs;
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, f.time);
    gl.uniform1fv(u.uP, f.params);
    gl.uniform3fv(u.uCamPos, f.cam.pos);
    gl.uniform3fv(u.uCamR, f.cam.right);
    gl.uniform3fv(u.uCamU, f.cam.up);
    gl.uniform3fv(u.uCamF, f.cam.fwd);
    gl.uniform1f(u.uFov, f.cam.fov);
    gl.uniform4fv(u.uBall, f.ball.pos);
    gl.uniform4fv(u.uBallT, f.ball.track);
    gl.uniformMatrix3fv(u.uBallRot, false, f.ball.rot);
    const fill = (buf, list, fn, max) => { buf.fill(0); const n = Math.min(list.length, max); for (let i = 0; i < n; i++) buf.set(fn(list[i]), i * 4); return n; };
    gl.uniform1i(u.uOrbN, fill(B.orbs, f.orbs, o => o, MAX.orbs));
    gl.uniform4fv(u.uOrbs, B.orbs);
    const nr = fill(B.rings, f.rings, g => [g.u, g.n, g.v, g.R], MAX.rings);
    fill(B.ringGlow, f.rings, g => [g.glow || 0, 0, 0, 0], MAX.rings);
    gl.uniform1i(u.uRingN, nr);
    gl.uniform4fv(u.uRings, B.rings);
    gl.uniform4fv(u.uRingGlow, B.ringGlow);
    gl.uniform1i(u.uPillarN, fill(B.pillars, f.pillars, c => [c.u, c.v, c.top, c.r], MAX.pillars));
    gl.uniform4fv(u.uPillars, B.pillars);
    const nh = fill(B.handA, f.hands, H => [H.u, H.n, H.v, H.s], MAX.hands);
    fill(B.handB, f.hands, H => [H.pitch, H.curl, H.spread, H.rise], MAX.hands);
    gl.uniform1i(u.uHandN, nh);
    gl.uniform4fv(u.uHandA, B.handA);
    gl.uniform4fv(u.uHandB, B.handB);
    gl.uniform1i(u.uRipN, fill(B.ripples, f.ripples, r => [r.u, r.v, r.age, r.amp], MAX.ripples));
    gl.uniform4fv(u.uRipples, B.ripples);
    gl.uniform4fv(u.uFlip, f.flip);
    gl.uniform2fv(u.uSides, f.sides);
    gl.uniform4fv(u.uMusic, f.music);
    gl.uniform4fv(u.uFx, f.fx);
    gl.uniform1f(u.uQuality, f.quality);
    gl.uniform1f(u.uColorFlip, f.colorFlip ?? 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
