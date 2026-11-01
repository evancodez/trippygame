// The picture: one ray-marched scene, looking down at the sheet.
//   · the sheet — a height texture from the simulation, drawn with the visualizer's line equation
//     (lines bend over the relief and light thins the ink, so form is drawn with lines alone)
//   · your hand's light glowing up through the fabric; eyes cut in it with irises beneath that watch;
//     tears that show the static underneath; the hoop it's stretched on
//   · a chrome pearl that mirrors the sheet, ink blobs with eyes, floating lights
import { N, HALF } from './sheet.js';

export const MAX = { holes: 8, pearls: 3, ink: 8, motes: 12, hands: 2 };
export const LINE_KEYS = ['freq', 'linA', 'wLin', 'wRad', 'radLog', 'radInv', 'wAng', 'spokes', 'check', 'checkA', 'moire', 'moireOff', 'contour', 'twist', 'bulge', 'refract', 'engrave', 'thick', 'phase'];

export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
uniform highp sampler2D uH;
uniform vec3 uCamPos, uCamR, uCamU, uCamF;
uniform float uFov;
uniform float uL[${LINE_KEYS.length}];
uniform vec3 uPaper, uInk, uVoid, uAccent, uRival;
uniform vec4 uHoleA[${MAX.holes}];    // x, y, half-width, half-height
uniform vec4 uHoleB[${MAX.holes}];    // angle, open, kind (0 eye, 1 tear, 2 hidden eye), reveal
uniform vec4 uHoleC[${MAX.holes}];    // look x, look y
uniform int uHoleN;
uniform vec4 uPearl[${MAX.pearls}];   // x, y, z, r
uniform int uPearlN;
uniform mat3 uPearlRot;
uniform vec4 uInk8[${MAX.ink}];
uniform int uInkN;
uniform vec4 uMote[${MAX.motes}];     // x, y, z, alpha
uniform int uMoteN;
uniform vec4 uHandA[${MAX.hands}];    // x, y, angle, push (−press)
uniform vec4 uHandB[${MAX.hands}];    // glow, kind
uniform int uHandN;
uniform vec4 uFx;                     // flash, fade, static, beat
uniform float uSteps;

${LINE_KEYS.map((k, i) => `#define ${k.toUpperCase()} uL[${i}]`).join('\n')}
#define PI 3.14159265359
#define HALF ${HALF.toFixed(1)}
#define NG ${N}
#define DXG ${(2 * HALF / (N - 1)).toFixed(6)}
#define RIMH 0.45
#define RIMR 0.35

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sdBox2(vec2 p, float b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }

// ———————————————————————————————————— the sheet's height (bilinear, exactly like the physics)
float hAt(vec2 p) {
  vec2 g = clamp((p + HALF) / DXG, 0.0, float(NG) - 1.001);
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  float a = texelFetch(uH, i, 0).r, b = texelFetch(uH, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uH, i + ivec2(0, 1), 0).r, d = texelFetch(uH, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// ———————————————————————————————————— holes (mirrors holeSD in sheet.js)
vec2 holeLocal(int i, vec2 p) { vec4 A = uHoleA[i]; float c = cos(uHoleB[i].x), s = sin(uHoleB[i].x); vec2 d = p - A.xy; return vec2(d.x * c + d.y * s, -d.x * s + d.y * c); }
float holeSD(int i, vec2 p) {
  vec4 A = uHoleA[i], B = uHoleB[i];
  vec2 l = holeLocal(i, p);
  if (B.z < 0.5 || B.z > 1.5) { float b = max(0.02, A.w * B.y); return (length(l / vec2(A.z, b)) - 1.0) * min(A.z, b); }
  float an = atan(l.y, l.x);
  float wob = 1.0 + 0.18 * sin(an * 5.0 + A.x) + 0.08 * sin(an * 11.0 + A.y);
  return (length(l / A.zw) - wob) * min(A.z, A.w);
}
float holesAt(vec2 p) {
  float d = 1e3;
  for (int i = 0; i < ${MAX.holes}; i++) {
    if (i >= uHoleN) break;
    vec4 B = uHoleB[i];
    if (B.z > 1.5 || (B.z < 0.5 && B.y < 0.3)) continue;    // hidden or shut: no hole
    d = min(d, holeSD(i, p));
  }
  return d;
}

// ———————————————————————————————————— a hand seen from above (mirrors handShape)
float segDist(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float handShape(vec2 l) {
  float v = exp(-pow(segDist(l, vec2(0.0, -0.45), vec2(0.0, 0.35)) / 1.0, 2.0) * 1.6);
  v = max(v, exp(-pow(segDist(l, vec2(-0.62, 0.72), vec2(-0.78, 1.85)) / 0.3, 2.0) * 1.4));
  v = max(v, exp(-pow(segDist(l, vec2(-0.2, 0.86), vec2(-0.24, 2.2)) / 0.31, 2.0) * 1.4));
  v = max(v, exp(-pow(segDist(l, vec2(0.22, 0.86), vec2(0.26, 2.12)) / 0.31, 2.0) * 1.4));
  v = max(v, exp(-pow(segDist(l, vec2(0.6, 0.74), vec2(0.76, 1.72)) / 0.28, 2.0) * 1.4));
  v = max(v, exp(-pow(segDist(l, vec2(0.85, -0.15), vec2(1.6, 0.55)) / 0.32, 2.0) * 1.4));
  return v;
}
vec2 handLocal(int i, vec2 p) { vec4 A = uHandA[i]; vec2 d = p - A.xy; float c = cos(-A.z), s = sin(-A.z); return vec2(d.x * c - d.y * s, d.x * s + d.y * c); }

// ———————————————————————————————————— the scene
vec2 edgePoint(vec2 p) { vec2 c = clamp(p, -HALF, HALF); vec2 a = abs(c); return a.x > a.y ? vec2(sign(c.x) * HALF, c.y) : vec2(c.x, sign(c.y) * HALF); }
float rimD(vec3 p) { float e = abs(sdBox2(p.xy, HALF)); if (e > 2.0) return e - 1.0; float hb = hAt(edgePoint(p.xy)); return length(vec2(e, p.z - hb - RIMH)) - RIMR; }
float sheetD(vec3 p) {
  float box = sdBox2(p.xy, HALF);
  float h = hAt(clamp(p.xy, -HALF, HALF));
  float d = max(abs(p.z - h) * 0.42 - 0.03, box);
  return max(d, -holesAt(p.xy));
}
float mapD(vec3 p, out float mat) {
  float a = sheetD(p), b = rimD(p);
  mat = a < b ? 0.0 : 1.0;
  return min(a, b);
}

// the visualizer's line equation
float lines(vec2 q, float z) {
  float r = length(q);
  if (TWIST != 0.0) q = rot(TWIST * exp(-r * r * 1.6)) * q;
  if (BULGE != 0.0) q *= 1.0 - clamp(BULGE, -1.0, 1.0) * 0.85 * exp(-r * r * 3.5);
  r = length(q);
  float ang = atan(q.y, q.x);
  float Ld = dot(q, vec2(cos(LINA), sin(LINA)));
  float R = mix(r, -log(max(r, 1e-4)) * 0.3, RADLOG);
  R = mix(R, 0.09 / max(r, 2e-3), RADINV);
  float base = (WLIN * Ld + WRAD * R + CONTOUR * z * 0.33) * FREQ - PHASE;
  float v = sin(base * PI);
  if (WANG > 0.0) v = mix(v, sin(base * PI + ang * floor(SPOKES + 0.5)), WANG);
  if (CHECK > 0.0) v *= mix(1.0, sin((dot(q, vec2(cos(LINA + CHECKA), sin(LINA + CHECKA))) * FREQ - PHASE * 0.5) * PI), CHECK);
  if (MOIRE > 0.0) { vec2 o = MOIREOFF * 0.5 * vec2(cos(PHASE * 0.15), sin(PHASE * 0.15)); v *= mix(1.0, sin(length(q - o) * FREQ * PI), MOIRE); }
  return v;
}

vec3 sheetNormal(vec2 p) {
  float e = 0.09;
  return normalize(vec3(hAt(p - vec2(e, 0.0)) - hAt(p + vec2(e, 0.0)), hAt(p - vec2(0.0, e)) - hAt(p + vec2(0.0, e)), 2.0 * e));
}

vec3 shadeSheet(vec3 p, vec3 n, bool under) {
  vec2 q = p.xy / HALF;
  float v = lines(q + n.xy * REFRACT * 0.1, p.z);
  vec3 L = normalize(vec3(-0.35, -0.55, 0.75));
  v -= (max(dot(n, L), 0.0) - 0.62) * ENGRAVE * 1.5;
  v += THICK + uFx.w * 0.14;
  // what rests on it makes the ink pool underneath (a shadow drawn with line weight)
  for (int i = 0; i < ${MAX.pearls}; i++) {
    if (i >= uPearlN) break;
    vec4 b = uPearl[i];
    float hb = max(0.0, b.z - b.w - p.z), r = b.w * (1.1 + hb * 0.22);
    v += 1.4 * exp(-dot(p.xy - b.xy, p.xy - b.xy) / (r * r)) * exp(-hb * 0.18);
  }
  for (int i = 0; i < ${MAX.ink}; i++) {
    if (i >= uInkN) break;
    vec4 b = uInk8[i];
    v += 1.2 * exp(-dot(p.xy - b.xy, p.xy - b.xy) / (b.w * b.w * 1.4));
  }
  float w = fwidth(v) * 0.8 + 1e-3;
  float k = smoothstep(-w, w, v);
  vec3 col = mix(uPaper, uInk, k);
  if (under) col = mix(uInk, uPaper, k) * 0.45;
  // hands beneath: their light comes up through the fabric, mostly through the paper
  for (int i = 0; i < ${MAX.hands}; i++) {
    if (i >= uHandN) break;
    vec4 B = uHandB[i];
    float l = handShape(handLocal(i, p.xy)) * B.x;
    vec3 hc = B.y > 0.5 ? uRival : uAccent;
    col = mix(col, mix(col, hc, 0.85), l * mix(0.75, 0.22, k));
    col += hc * l * 0.08;
  }
  // eyes: a lid line, lashes, the ghost of a hidden one where your light falls
  for (int i = 0; i < ${MAX.holes}; i++) {
    if (i >= uHoleN) break;
    vec4 A = uHoleA[i], B = uHoleB[i];
    float sd = holeSD(i, p.xy);
    if (B.z > 0.5 && B.z < 1.5) {
      float fray = hash12(floor(p.xy * 9.0) + floor(uTime * 12.0));
      col = mix(col, vec3(fray), (1.0 - smoothstep(0.0, 0.35, sd)) * 0.9);
      continue;
    }
    float lid = 1.0 - smoothstep(0.06, 0.2, abs(sd - 0.08));
    vec2 l = holeLocal(i, p.xy);
    float lash = step(0.0, l.y) * (1.0 - smoothstep(0.0, 0.5, sd)) * step(0.1, sd) * step(0.6, abs(sin(atan(l.y, l.x) * 9.0)));
    float ring = (1.0 - smoothstep(0.0, 0.08, abs(sd - 0.55))) * 0.5;
    float vis = B.z > 1.5 ? 0.0 : 1.0;
    if (B.z > 1.5) {
      float light = 0.0;
      for (int j = 0; j < ${MAX.hands}; j++) { if (j >= uHandN) break; light = max(light, handShape(handLocal(j, p.xy) * 0.6) * uHandB[j].x); }
      vis = max(B.w, light) * 0.8;
    }
    col = mix(col, uInk, (lid + lash) * vis);
    col = mix(col, uAccent, ring * vis * (0.4 + 0.6 * B.y));
  }
  return col;
}

// the dark under the sheet: slow rings sinking away, and an iris beneath every eye
vec3 shadeVoid(vec3 ro, vec3 rd, float tMax) {
  vec3 col = uVoid;
  float t = (-16.0 - ro.z) / rd.z;
  if (rd.z < 0.0 && t > 0.0) {
    vec2 p = ro.xy + rd.xy * t;
    float v = sin(length(p) * 0.9 - uTime * 0.8);
    float w = fwidth(v) + 0.05;
    col = mix(uVoid, mix(uVoid, uInk, 0.12), smoothstep(-w, w, v) * exp(-length(p) * 0.04));
  }
  for (int i = 0; i < ${MAX.holes}; i++) {
    if (i >= uHoleN) break;
    vec4 A = uHoleA[i], B = uHoleB[i];
    float zi = hAt(A.xy) - 0.8;
    float ti = (zi - ro.z) / rd.z;
    if (ti <= 0.0 || ti > tMax) continue;
    vec2 p = ro.xy + rd.xy * ti - A.xy;
    if (B.z > 0.5 && B.z < 1.5) {   // tear: static
      if (length(p / A.zw) < 1.6) col = vec3(hash12(floor((ro.xy + rd.xy * ti) * 14.0) + floor(uTime * 24.0) * 3.1)) * 0.7;
      continue;
    }
    vec2 look = uHoleC[i].xy * A.z * 0.45;
    float r = length(p - look), R = A.z * 0.62;
    if (length(p / vec2(A.z * 1.6, A.z * 1.6)) > 1.0) continue;
    float iris = 1.0 - smoothstep(R - 0.05, R + 0.05, r);
    float rings = sin(r * 14.0 - uTime * 2.0) * 0.5 + 0.5;
    vec3 ic = mix(uAccent * 0.55, uAccent, rings);
    col = mix(mix(uPaper * 0.85, uPaper, 0.5), ic, iris);
    col = mix(col, vec3(0.0), 1.0 - smoothstep(R * 0.36, R * 0.42, r));
    col += vec3(1.0) * (1.0 - smoothstep(0.0, 0.12, length(p - look - vec2(-0.25, 0.25) * R))) * 0.8;
  }
  return col;
}

struct Hit { bool hit; float t; vec3 p; float mat; };
Hit march(vec3 ro, vec3 rd, int maxSteps, float far) {
  Hit h; h.hit = false; h.mat = 0.0;
  // start where the ray enters the slab the sheet can be in
  float t = 0.0;
  if (rd.z < 0.0) t = max(0.0, (12.0 - ro.z) / rd.z);
  float mat;
  for (int i = 0; i < 200; i++) {
    if (i >= maxSteps) break;
    vec3 p = ro + rd * t;
    float d = mapD(p, mat);
    if (d < 0.002 + t * 0.0008) { h.hit = true; break; }
    t += max(d, 0.01);
    if (t > far || p.z < -14.0) break;
  }
  h.t = t; h.p = ro + rd * t; h.mat = mat;
  return h;
}

vec3 shade(Hit h, vec3 rd) {
  if (h.mat > 0.5) {
    // the hoop: lacquered stripes
    vec2 e = edgePoint(h.p.xy);
    float s = sin((e.x + e.y) * 3.0 + uTime * 0.6);
    return mix(uInk, uAccent, step(0.0, s) * 0.8) * (0.55 + 0.45 * smoothstep(-0.3, 0.3, h.p.z - hAt(e) - RIMH));
  }
  vec3 n = sheetNormal(h.p.xy);
  bool under = dot(rd, n) > 0.0;
  return shadeSheet(h.p, under ? -n : n, under);
}

float sphereT(vec3 ro, vec3 rd, vec4 s) {
  vec3 oc = ro - s.xyz;
  float b = dot(oc, rd), c = dot(oc, oc) - s.w * s.w, disc = b * b - c;
  if (disc < 0.0) return -1.0;
  return -b - sqrt(disc);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 rd = normalize(uCamF + (uv.x * uCamR + uv.y * uCamU) * uFov * 2.0);
  vec3 ro = uCamPos;
  Hit h = march(ro, rd, int(uSteps), 120.0);
  float tHit = h.hit ? h.t : 1e9;
  vec3 col = h.hit ? shade(h, rd) : shadeVoid(ro, rd, 1e9);
  if (h.hit && h.p.z < hAt(clamp(h.p.xy, -HALF, HALF)) - 0.2) col = shadeVoid(ro, rd, h.t);

  // ink: glossy black, with eyes that follow the pearl
  for (int i = 0; i < ${MAX.ink}; i++) {
    if (i >= uInkN) break;
    vec4 b = uInk8[i];
    float t = sphereT(ro, rd, b);
    if (t < 0.0 || t > tHit) continue;
    vec3 p = ro + rd * t, n = normalize(p - b.xyz);
    vec2 to = uPearlN > 0 ? normalize(uPearl[0].xy - b.xy + 1e-4) : vec2(0.0, -1.0);
    vec3 fwd = normalize(vec3(to, 0.7));
    vec3 side = normalize(cross(fwd, vec3(0.0, 0.0, 1.0)));
    float eyeL = dot(n, normalize(fwd + side * 0.42)), eyeR = dot(n, normalize(fwd - side * 0.42));
    float spec = pow(max(dot(reflect(rd, n), normalize(vec3(-0.3, -0.5, 0.8))), 0.0), 24.0);
    float rimL = pow(1.0 - max(dot(n, -rd), 0.0), 2.5);
    vec3 c = vec3(0.015) + spec * 0.9 + uRival * smoothstep(0.35, 0.8, rimL) * 0.9;
    float white = max(smoothstep(0.955, 0.965, eyeL), smoothstep(0.955, 0.965, eyeR));
    float pupil = max(smoothstep(0.988, 0.992, eyeL), smoothstep(0.988, 0.992, eyeR));
    c = mix(c, vec3(1.0), white);
    c = mix(c, vec3(0.0), pupil);
    col = c; tHit = t;
  }

  // the pearl(s): chrome
  for (int i = 0; i < ${MAX.pearls}; i++) {
    if (i >= uPearlN) break;
    vec4 b = uPearl[i];
    float t = sphereT(ro, rd, b);
    if (t < 0.0 || t > tHit) continue;
    vec3 p = ro + rd * t, n = normalize(p - b.xyz);
    vec3 rr = reflect(rd, n);
    Hit r = march(p + n * 0.02, rr, int(uSteps * 0.4), 60.0);
    vec3 refl = r.hit ? shade(r, rr) : shadeVoid(p, rr, 1e9);
    float fr = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    vec3 c = refl * 0.9 + fr * 0.2;
    vec3 loc = uPearlRot * n;
    float band = 1.0 - smoothstep(0.16, 0.2, abs(loc.y));
    c = mix(c, i == 0 ? uAccent : uRival, band * 0.85);
    c = mix(c, uInk * 0.3, (1.0 - smoothstep(0.0, 0.3, dot(n, -rd))) * 0.85);
    col = c; tHit = t;
  }

  // lights
  for (int i = 0; i < ${MAX.motes}; i++) {
    if (i >= uMoteN) break;
    vec4 m = uMote[i];
    if (m.w <= 0.0) continue;
    vec3 oc = m.xyz - ro;
    float along = dot(oc, rd);
    if (along < 0.0 || along > tHit + 0.4) continue;
    float b2 = dot(oc, oc) - along * along;
    float core = 1.0 - smoothstep(0.09, 0.14, b2);
    float glow = exp(-b2 / 0.5) * 0.6 * (0.8 + 0.2 * sin(uTime * 5.0 + float(i)));
    col = mix(col, mix(uAccent, vec3(1.0), 0.6), core * m.w);
    col += uAccent * glow * m.w * (1.0 - core);
  }

  vec2 sp = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - dot(sp, sp) * (0.45 + 0.2 * uFx.w);
  col = mix(col, mix(uAccent, vec3(1.0), 0.4), uFx.x);
  if (uFx.z > 0.0) {
    float sn = hash12(floor(gl_FragCoord.xy / 2.5) + floor(uTime * 30.0) * vec2(13.1, 71.7));
    float edge = smoothstep(0.62 - uFx.z * 0.6, 0.75 - uFx.z * 0.3, length(sp * vec2(uRes.x / uRes.y, 1.0)));
    col = mix(col, vec3(sn), clamp(edge + uFx.z * uFx.z * 0.7, 0.0, 1.0));
  }
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.03;
  col = mix(col, vec3(0.0), uFx.y);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
