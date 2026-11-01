// The picture: one ray-marched scene.
//   · the sea — a sheet of lines with a height field (sea.js has the same math for the physics),
//     rolled into a tube by the curl, folded by bent rays, turned inside out by the flip wave
//   · columns and hands pushing up through it, draped in the fabric (a soft union)
//   · ring gates standing in it, a chrome pearl that mirrors it, light orbs floating over it
// Everything is drawn with lines: light thins the ink (engraving), so the 3D form is lines alone.
import { shaderDefines, SLOT_COUNT } from './params.js';
import { W } from './sea.js';

export const MAX = { orbs: 24, rings: 6, pillars: 10, hands: 3, ripples: 8 };

export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
uniform float uP[${SLOT_COUNT}];
uniform vec3 uCamPos, uCamR, uCamU, uCamF;
uniform float uFov;
uniform vec4 uBall;                  // apparent world position, radius (r < 0: hidden)
uniform vec4 uBallT;                 // track u, v, height above the sea, 0
uniform mat3 uBallRot;
uniform vec4 uOrbs[${MAX.orbs}];     // apparent world position, alpha
uniform int uOrbN;
uniform vec4 uRings[${MAX.rings}];   // track u, n, v, radius
uniform vec4 uRingGlow[${MAX.rings}];
uniform int uRingN;
uniform vec4 uPillars[${MAX.pillars}];   // track u, v, top, radius
uniform int uPillarN;
uniform vec4 uHandA[${MAX.hands}];   // track u, n, v, size
uniform vec4 uHandB[${MAX.hands}];   // pitch, curl, spread, rise
uniform int uHandN;
uniform vec4 uRipples[${MAX.ripples}];   // track u, v, age, amp
uniform int uRipN;
uniform vec4 uFlip;                  // u, v, radius, active
uniform vec2 uSides;                 // from, to
uniform vec4 uMusic;                 // beat, bar phase, energy, lucidity
uniform vec4 uFx;                    // flash, fade, invert (global), static
uniform float uQuality;              // 1 = full, lower = fewer steps
uniform float uColorFlip;            // 0 keeps the colors when the sea flips (reduce flashing)

${shaderDefines()}
#define PI 3.14159265359
#define TAU 6.28318530718
#define W ${W.toFixed(1)}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / max(k, 1e-5); return min(a, b) - h * h * k * 0.25; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float sdRoundBox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float g2(vec2 q, vec2 c, vec2 s) { vec2 d = (q - c) / s; return exp(-dot(d, d)); }
float wrapU(float u) { return u - W * floor(u / W + 0.5); }

// ———————————————————————————————————————— the surface (mirrors sea.js)
float faceH(vec2 q) {
  float m = MOUTH, e = max(EYES, 0.08);
  float h = 0.55 * g2(q, vec2(0.0, 0.02), vec2(0.36, 0.48));
  h += 0.16 * g2(q, vec2(0.0, 0.13), vec2(0.30, 0.05));
  h -= 0.46 * (g2(q, vec2(-0.15, 0.045), vec2(0.085, 0.06 * e)) + g2(q, vec2(0.15, 0.045), vec2(0.085, 0.06 * e)));
  h += 0.32 * g2(q, vec2(0.0, -0.035), vec2(0.035, 0.11));
  h += 0.16 * g2(q, vec2(0.0, -0.13), vec2(0.06, 0.045));
  h += 0.12 * (g2(q, vec2(-0.2, -0.08), vec2(0.09, 0.07)) + g2(q, vec2(0.2, -0.08), vec2(0.09, 0.07)));
  h -= 0.30 * g2(q, vec2(0.0, -0.265), vec2(0.12, 0.016 + 0.055 * m));
  h += 0.09 * g2(q, vec2(0.0, -0.225 + 0.02 * m), vec2(0.13, 0.025));
  h += 0.09 * g2(q, vec2(0.0, -0.31 - 0.03 * m), vec2(0.11, 0.028));
  h += 0.16 * g2(q, vec2(0.0, -0.43), vec2(0.13, 0.075));
  return h;
}

float sideAt(float u, float v) {
  if (uFlip.w < 0.5) return uSides.y;
  float d = length(vec2(wrapU(u - uFlip.x), v - uFlip.y));
  float k = 1.0 - smoothstep(uFlip.z - 2.5, uFlip.z + 2.5, d);
  return mix(uSides.x, uSides.y, k);
}

float baseH(float u, float v) {
  float U = u * TAU / W;
  float h = 0.0;
  if (SWELL > 0.0) {
    float s = v * SWELLK - PH1 + SWELLU * sin(U + PH3);
    h += SWELL * (sin(s) + 0.3 * sin(2.0 * s + 1.3 + cos(2.0 * U - PH3)));
  }
  if (CHOP > 0.0) h += CHOP * sin(v * CHOPK + 3.0 * U - PH2) * sin(v * CHOPK * 0.7 - 2.0 * U + PH2 * 0.8);
  if (DUNES > 0.0) h += DUNES * sin(U * floor(DUNESN + 0.5)) * sin(v * DUNESK - PH2 * 0.5);
  if (VORTEX > 0.0) {
    float c = (floor(v / VORTEXP) + 0.5) * VORTEXP;
    float dy = v - c, r = length(vec2(u, dy)), a = atan(dy, u + 1e-6);
    h -= VORTEX * exp(-r * r / 70.0) * (2.2 + 0.7 * sin(3.0 * a + r * 0.7 - 2.0 * PH1));
  }
  if (TERRACE > 0.0) {
    float q = h / TERRACES, st = floor(q) + smoothstep(0.3, 0.7, fract(q));
    h += (st * TERRACES - h) * TERRACE;
  }
  return h;
}

float height(float u, float v) {
  u = wrapU(u);
  float h = baseH(u, v) * sideAt(u, v) * AMP;
  if (WALL > 0.0) { float w = smoothstep(W * 0.5 - 6.0, W * 0.5, abs(u)); h += WALL * w * w * 7.0; }
  for (int i = 0; i < ${MAX.ripples}; i++) {
    if (i >= uRipN) break;
    vec4 r = uRipples[i];
    float x = length(vec2(wrapU(u - r.x), v - r.y)) - r.z * 13.0;
    h += r.w * min(1.0, r.z * 4.0) * sin(x * 1.3) * exp(-(x * x) / (2.0 + r.z * 2.0)) * exp(-r.z * 0.8);
  }
  return h;
}

// ———————————————————————————————————————— hands (the visualizer's hand, grown huge)
float handSDF(vec3 p, float curl, float spread) {
  float d = sdRoundBox(p - vec3(0.0, -0.01, 0.0), vec3(0.068, 0.08, 0.017), 0.03);
  d = smin(d, sdCapsule(p, vec3(-0.035, -0.08, 0.0), vec3(0.04, -0.085, 0.0), 0.045), 0.04);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float len = (i == 0 ? 0.95 : i == 1 ? 1.06 : i == 2 ? 0.99 : 0.78) * 0.245;
    float c = curl * (1.0 + 0.12 * (fi - 1.5));
    vec3 a = vec3(-0.066 + fi * 0.044, 0.085, 0.0);
    vec3 dir = normalize(vec3((fi - 1.5) * spread * 0.2, 1.0, 0.0));
    float r = 0.0235 - fi * 0.0013;
    float seg = 0.46;
    for (int j = 0; j < 3; j++) {
      dir.yz = rot(c * (j == 0 ? 0.55 : 0.95)) * dir.yz;
      vec3 b = a + dir * len * seg;
      d = smin(d, sdCapsule(p, a, b, r), 0.016);
      a = b; r *= 0.9; seg = j == 0 ? 0.32 : 0.23;
    }
  }
  vec3 a = vec3(0.07, -0.055, 0.012);
  vec3 dir = normalize(vec3(0.85, 0.6, 0.3));
  float r = 0.028;
  for (int j = 0; j < 2; j++) {
    dir.xy = rot(curl * 0.6) * dir.xy;
    dir.yz = rot(curl * 0.35) * dir.yz;
    vec3 b = a + dir * (j == 0 ? 0.095 : 0.075);
    d = smin(d, sdCapsule(p, a, b, r), 0.018);
    a = b; r *= 0.85;
  }
  return smin(d, sdCapsule(p, vec3(0.0, -0.1, -0.01), vec3(0.0, -0.32, -0.42), 0.058), 0.05);
}

float objects(vec3 q) {
  float d = 1e3;
  for (int i = 0; i < ${MAX.pillars}; i++) {
    if (i >= uPillarN) break;
    vec4 c = uPillars[i];
    if (c.z < -1.5 || abs(q.z - c.y) > c.w + d + 1.0) continue;
    float wx = length(vec2(wrapU(q.x - c.x), q.z - c.y)) - c.w + 0.45, wy = q.y - c.z + 0.45;
    d = min(d, min(max(wx, wy), 0.0) + length(max(vec2(wx, wy), 0.0)) - 0.45);
  }
  for (int i = 0; i < ${MAX.hands}; i++) {
    if (i >= uHandN) break;
    vec4 A = uHandA[i], B = uHandB[i];
    if (B.w < 0.001) continue;
    float du = wrapU(q.x - A.x) / A.w, dn = (q.y - A.y) / A.w, dv = (q.z - A.z) / A.w;
    float c = cos(B.x), s = sin(B.x);
    vec3 l = vec3(du, c * dn + s * dv, s * dn - c * dv);
    float bound = length(l - vec3(0.0, 0.03, -0.12)) - 0.42;
    if (bound > 0.12) { d = min(d, bound * A.w); continue; }
    d = min(d, handSDF(l, B.y, B.z) * A.w);
  }
  return d;
}

float ringDist(vec3 q, out int which) {
  float d = 1e3;
  which = -1;
  for (int i = 0; i < ${MAX.rings}; i++) {
    if (i >= uRingN) break;
    vec4 g = uRings[i];
    if (abs(q.z - g.z) > d + 0.5) continue;
    float k = length(vec2(wrapU(q.x - g.x), q.y - g.y)) - g.w;
    float dd = length(vec2(k, q.z - g.z)) - 0.3;
    if (dd < d) { d = dd; which = i; }
  }
  return d;
}

// a second sea hanging upside down
float ceilH(float u, float v) { float U = u * TAU / W; return 1.6 * sin(v * 0.09 + U - PH2 * 0.7) + 0.8 * sin(v * 0.21 - 2.0 * U + PH1 * 0.5); }
#define CEILY 17.0

// the mask: an oval membrane standing up out of the sea at v = FACEV, the face pressed into it toward you
vec2 maskUV(vec3 q) { return vec2(wrapU(q.x), q.y - FACES * (0.62 * FACE - 0.12)) / FACES; }
float maskDist(vec3 q) {
  vec2 m = maskUV(q);
  float oval = (length(m / vec2(0.40, 0.56)) - 1.0) * FACES * 0.36;
  float slab = abs(q.z - FACEV) - FACES * 0.25;
  if (max(oval, slab) > 1.0) return max(max(oval, slab), 0.5);
  float rel = faceH(m) * FACES * 0.42 * sideAt(q.x, FACEV);
  return max(abs(q.z - (FACEV - rel)) * 0.5 - 0.2, oval);
}

// world → track (unrolls the curl). sc: how much a track-space distance may be trusted in the world
vec3 toTrack(vec3 p, out float sc) {
  sc = 1.0;
  float k = CURL * TAU / W;
  if (k < 1e-4) return p;
  float R = 1.0 / k;
  vec2 d = vec2(p.x, R - p.y);
  float r = length(d);
  sc = clamp(r / R, 0.25, 1.0);
  return vec3(atan(d.x, d.y) * R, R - r, p.z);
}

// mat: 0 sea (and everything draped in it), 1 ring, 2 ceiling
float mapT(vec3 q, out float mat, out int ring) {
  float d = (q.y - height(q.x, q.z)) * 0.6;
  d = smin(d, objects(q), SOFT);
  mat = 0.0;
  float dr = ringDist(q, ring);
  if (dr < d) { d = dr; mat = 1.0; }
  if (CEIL > 0.001) {
    float dc = (CEILY + (1.0 - CEIL) * 30.0 - ceilH(q.x, q.z) - q.y) * 0.6;
    if (dc < d) { d = dc; mat = 2.0; }
  }
  if (FACE > 0.001) {
    float dm = maskDist(q);
    if (dm < d) { d = dm; mat = 3.0; }
  }
  return d;
}
float mapW(vec3 p) { float sc, m; int r; vec3 q = toTrack(p, sc); return mapT(q, m, r) * sc; }

vec3 calcNormal(vec3 p, float t) {
  vec2 e = vec2(1.0, -1.0) * 0.0015 * max(1.0, t * 0.6);
  return normalize(e.xyy * mapW(p + e.xyy) + e.yyx * mapW(p + e.yyx) + e.yxy * mapW(p + e.yxy) + e.xxx * mapW(p + e.xxx));
}

// ———————————————————————————————————————— color
vec3 paperC() { return vec3(PAPER_R, PAPER_G, PAPER_B); }
vec3 inkC() { return vec3(INK_R, INK_G, INK_B); }
vec3 accentC() { return vec3(ACCENT_R, ACCENT_G, ACCENT_B); }
vec3 fogC() { return mix(vec3(FOG_R, FOG_G, FOG_B), vec3(1.0) - vec3(FOG_R, FOG_G, FOG_B) * 0.94, uFx.z); }

// the sky: fog, and a sun cut into stripes
vec3 sky(vec3 d) {
  vec3 col = fogC();
  if (SUN > 0.0) {
    vec3 sd = normalize(vec3(0.0, 0.16, 1.0));
    float a = acos(clamp(dot(d, sd), -1.0, 1.0));
    float R = 0.21;
    float y = (d.y - sd.y) / R;                    // -1 bottom … 1 top of the sun
    float stripe = sin((y * 9.0 - uTime * 0.3) * PI);
    float cut = mix(-1.0, 0.85, smoothstep(0.6, -1.0, y));     // the stripes get fatter toward the bottom
    float w = fwidth(stripe) + 0.02;
    float sun = (1.0 - smoothstep(R - 0.003, R + 0.003, a)) * smoothstep(cut - w, cut + w, stripe);
    vec3 sc = mix(accentC(), mix(inkC(), paperC(), uFx.z), 0.15);
    col = mix(col, sc, sun * SUN);
    float halo = sin((a * 60.0 - uTime * 0.8) * PI);
    float hw = fwidth(halo) + 0.05;
    col = mix(col, mix(inkC(), paperC(), uFx.z), smoothstep(hw, -hw, halo) * 0.12 * SUN * smoothstep(0.9, R, a) * step(R, a));
  }
  return col;
}

// the line equation, painted in track space
float lineValue(vec3 q, float hgt) {
  float u = wrapU(q.x), v = q.z;
  float U = u * TAU / W;
  float NL = floor(FREQ * W * 0.5 + 0.5);
  float rr = length(vec2(wrapU(q.x - uBallT.x), v - uBallT.y));
  float base = LCROSS * FREQ * v + LLANES * NL * U / PI + LCONTOUR * hgt * FREQ * 1.7 + LRINGS * rr * FREQ
             + floor(TWIST + 0.5) * U / PI - PHL;
  float val = sin(base * PI);
  if (CHECK > 0.0) val *= mix(1.0, sin(NL * U), CHECK);
  if (MOIRE > 0.0) val *= mix(1.0, sin(length(vec2(u * 1.04, v - uBallT.y - 28.0)) * FREQ * 1.07 * PI), MOIRE);
  return val;
}

vec3 shadeSurface(vec3 q, vec3 n, vec3 rd, float t, float mat, float hgt) {
  float val = lineValue(q, hgt);
  // whatever stands up out of the sea (hands, columns) is drawn in contour rings, like a carving
  float above = 0.0;
  if (mat < 0.5 && (uPillarN > 0 || uHandN > 0)) {
    above = smoothstep(0.4, 1.6, q.y - height(q.x, q.z));
    if (above > 0.0) val = mix(val, sin((q.y * FREQ * 1.5 - PHL) * PI), above);
  }
  vec3 L = normalize(vec3(-0.4, 0.75, -0.5));
  float diff = max(dot(n, L), 0.0);
  val -= (diff - 0.55) * ENGRAVE;
  val += THICK + uMusic.x * 0.14;
  // the pearl's shadow: thicker ink under it
  if (mat < 0.5 && uBall.w > 0.0) {
    float hb = max(uBallT.z, 0.0);
    vec2 dd = vec2(wrapU(q.x - uBallT.x), q.z - uBallT.y);
    float rs = 0.55 + hb * 0.12;
    val += 1.6 * exp(-dot(dd, dd) / (rs * rs)) * exp(-hb * 0.1);
  }
  if (STAT > 0.0) val = mix(val, (hash12(floor(gl_FragCoord.xy / 2.0) + floor(uTime * 24.0) * vec2(17.3, 41.7)) - 0.5) * 3.0, STAT);
  float w = fwidth(val) * 0.85 + 1e-3;
  float k = smoothstep(-w, w, val);
  // which side of the sea is this? the far side is printed in negative
  float side = mat < 1.5 ? sideAt(q.x, q.z) : uSides.y;
  float inv = (1.0 - smoothstep(-0.3, 0.3, side)) * uColorFlip;
  if (mat > 1.5) inv = 1.0 - inv;
  vec3 paper = mix(paperC(), inkC(), inv), ink = mix(inkC(), paperC(), inv);
  vec3 col = mix(paper, ink, k);
  // the crests catch the accent
  if (HOT > 0.0 && mat < 0.5) col = mix(col, accentC(), HOT * k * max(smoothstep(1.2, 3.2, hgt) * (1.0 - above), above * smoothstep(3.0, 9.0, q.y)) * (1.0 - inv * 0.5));
  return col;
}

vec3 shadeMask(vec3 q, vec3 n) {
  vec2 m = maskUV(q);
  float rel = faceH(m);
  // horizontal lines, bent by the relief — the way the face shows up in the visualizer's membrane
  float val = sin(((q.y + rel * FACES * 0.22) * FREQ * 1.25 - PHL) * PI);
  vec3 L = normalize(vec3(-0.4, 0.75, -0.5));
  val -= (max(dot(n, L), 0.0) - 0.5) * ENGRAVE * 1.3;
  val += THICK + uMusic.x * 0.18;
  float edge = smoothstep(0.82, 1.0, length(m / vec2(0.40, 0.56)));
  val = mix(val, (hash12(floor(gl_FragCoord.xy / 2.0) + floor(uTime * 20.0) * vec2(7.1, 3.3)) - 0.5) * 3.0, edge);
  float w = fwidth(val) * 0.85 + 1e-3;
  float k = smoothstep(-w, w, val);
  float inv = (1.0 - smoothstep(-0.3, 0.3, uSides.y)) * uColorFlip;
  vec3 paper = mix(paperC(), inkC(), inv), ink = mix(inkC(), paperC(), inv);
  return mix(mix(paper, ink, k), accentC(), k * HOT * 0.6 * smoothstep(0.1, 0.35, rel));
}

vec3 shadeRing(vec3 q, vec3 n, int which) {
  vec4 g = uRings[which];
  vec2 d = vec2(wrapU(q.x - g.x), q.y - g.y);
  float a = atan(d.y, d.x);
  float s = sin(a * 14.0 + uTime * 3.0);
  float w = fwidth(s) + 0.02;
  vec3 col = mix(accentC(), paperC(), smoothstep(-w, w, s) * 0.85);
  float glow = uRingGlow[which].x;
  col = mix(col, vec3(1.0), glow * 0.7);
  float rim = pow(1.0 - abs(n.z), 2.0);
  return mix(col, inkC(), rim * 0.35);
}

// ———————————————————————————————————————— marching
struct Hit { bool hit; float t; vec3 p; vec3 q; vec3 d; float mat; int ring; };

Hit march(vec3 ro, vec3 rd, int maxSteps, float far, bool bend) {
  Hit h;
  h.hit = false; h.mat = 0.0; h.ring = -1;
  float t = 0.0;
  vec3 p = ro, dir = rd;
  float sc, mat; int ring;
  vec3 q;
  for (int i = 0; i < 160; i++) {
    if (i >= maxSteps) break;
    q = toTrack(p, sc);
    float d = mapT(q, mat, ring) * sc;
    if (d < 0.0012 * t + 0.0015) { h.hit = true; break; }
    d *= 1.0 + t * 0.004;
    p += dir * d; t += d;
    if (bend) dir = normalize(dir + vec3(BENDH, -BENDV, 0.0) * d);
    if (t > far) break;
  }
  if (!h.hit && t < far) h.hit = true;   // ran out of steps grazing the sea: close enough
  h.t = t; h.p = p; h.q = q; h.d = dir; h.mat = mat; h.ring = ring;
  return h;
}

vec3 shadeHit(Hit h, vec3 rd) {
  vec3 n = calcNormal(h.p, h.t);
  if (h.mat > 0.5 && h.mat < 1.5 && h.ring >= 0) return shadeRing(h.q, n, h.ring);
  if (h.mat > 2.5) return shadeMask(h.q, n);
  float hgt = h.mat > 1.5 ? ceilH(h.q.x, h.q.z) : h.q.y;
  return shadeSurface(h.q, n, rd, h.t, h.mat, hgt);
}

float sphereHit(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd), cc = dot(oc, oc) - r * r, disc = b * b - cc;
  if (disc < 0.0) return -1.0;
  return -b - sqrt(disc);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 rd = normalize(uCamF + (uv.x * uCamR + uv.y * uCamU) * uFov * 2.0);
  vec3 ro = uCamPos;
  float far = 190.0;
  int steps = int(mix(70.0, 140.0, uQuality));

  Hit h = march(ro, rd, steps, far, true);
  vec3 col;
  float tHit = h.hit ? h.t : 1e9;
  if (h.hit) {
    col = shadeHit(h, rd);
    col = mix(fogC(), col, exp(-max(h.t - 6.0, 0.0) * FOGD));
  } else {
    col = sky(normalize(rd + vec3(BENDH, -BENDV, 0.0) * 60.0));   // smooth, whatever path the ray took
  }

  // the pearl: chrome, mirroring the sea
  if (uBall.w > 0.0) {
    float tb = sphereHit(ro, rd, uBall.xyz, uBall.w);
    if (tb > 0.0 && tb < tHit) {
      vec3 bp = ro + rd * tb, bn = normalize(bp - uBall.xyz);
      vec3 rr = reflect(rd, bn);
      Hit r = march(bp + bn * 0.03, rr, int(mix(28.0, 56.0, uQuality)), 90.0, false);
      vec3 refl = r.hit ? mix(fogC(), shadeHit(r, rr), exp(-r.t * FOGD * 1.5)) : sky(rr);
      float fr = pow(1.0 - max(dot(bn, -rd), 0.0), 3.0);
      vec3 c = refl * 0.92 + fr * 0.25;
      vec3 loc = uBallRot * bn;
      float band = 1.0 - smoothstep(0.15, 0.19, abs(loc.y));
      float bandEdge = smoothstep(0.13, 0.15, abs(loc.y)) * (1.0 - smoothstep(0.19, 0.21, abs(loc.y)));
      c = mix(c, accentC(), band * 0.85);
      c = mix(c, inkC() * 0.5, bandEdge * 0.6);
      float edge = 1.0 - smoothstep(0.0, 0.32, dot(bn, -rd));
      c = mix(c, inkC() * 0.4, edge * 0.85);
      col = c;
      tHit = tb;
    }
  }

  // light orbs
  for (int i = 0; i < ${MAX.orbs}; i++) {
    if (i >= uOrbN) break;
    vec4 o = uOrbs[i];
    if (o.w <= 0.0) continue;
    vec3 oc = o.xyz - ro;
    float along = dot(oc, rd);
    if (along < 0.0 || along > tHit + 0.5) continue;
    float b2 = dot(oc, oc) - along * along;
    float r = 0.36;
    float core = 1.0 - smoothstep(r * r * 0.7, r * r, b2);
    float glow = exp(-b2 / (0.35 + along * 0.004)) * 0.55 * smoothstep(1.5, 6.0, along);
    float pulse = 0.85 + 0.15 * sin(uTime * 6.0 + float(i));
    vec3 oc2 = mix(accentC(), vec3(1.0), smoothstep(r * r * 0.5, 0.0, b2) * 0.8);
    col = mix(col, oc2, core * o.w);
    col += accentC() * glow * o.w * pulse * (1.0 - core);
  }

  // finishing: beat breath, flash, static at the edges as the dream thins out, vignette, fade
  vec2 sp = gl_FragCoord.xy / uRes - 0.5;
  float vig = dot(sp, sp);
  col *= 1.0 - vig * (0.35 + 0.15 * uMusic.x);
  col = mix(col, mix(accentC(), vec3(1.0), 0.5), uFx.x);
  if (uFx.w > 0.0) {
    float edge = smoothstep(0.45 - uFx.w * 0.45, 0.62 - uFx.w * 0.3, length(sp * vec2(uRes.x / uRes.y, 1.0)) * (0.9 + 0.1 * sin(uTime * 3.0)));
    float sn = hash12(floor(gl_FragCoord.xy / 2.5) + floor(uTime * 30.0) * vec2(13.1, 71.7));
    col = mix(col, vec3(sn), clamp(edge * 0.95 + uFx.w * uFx.w * 0.6, 0.0, 1.0));
  }
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.035;
  col = mix(col, vec3(0.0), uFx.y);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
