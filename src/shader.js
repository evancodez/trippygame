// The whole game is drawn by this one fragment shader: for every pixel it works out where that pixel
// is in the world, then paints background → block sides (fake 3D) → block faces → hazards & illusions →
// things (orbs, hands, eyes…) → the hero → lens, flip wave, static wall → film grain.
// The level itself is a texture: red = tile type, green = live state (ghost reveal, riser height, crumble).

export const MAX_ENTS = 64;

export const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const GAME_FRAG = `#version 300 es
precision highp float;
precision highp int;
out vec4 outColor;

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uCam;
uniform float uViewH;
uniform vec3 uTilt;                 // pitch, roll, amount (0 = flat 2D)
uniform highp sampler2D uLevel;
uniform vec2 uLevelSize;
uniform float uFlip;
uniform vec4 uFlipWave;             // x, y, radius, previous flip
uniform vec4 uLens;                 // x, y, radius, open (0..1)
uniform vec4 uP0;                   // x, y (feet), facing, run phase
uniform vec4 uP1;                   // vx, vy, squash, state (0 ground, 1 air, 2 wall, 3 dash)
uniform vec4 uP2;                   // dead time (-1 alive), spawn time, look x, look y
uniform vec4 uTrail[8];             // dash afterimages: x, y, age, facing
uniform vec4 uEnt[${MAX_ENTS}];     // x, y, type, a
uniform vec4 uEntB[${MAX_ENTS}];    // b, c, d, e
uniform int uEntCount;
uniform vec4 uRings[10];            // x, y, age, kind
uniform int uTheme;
uniform vec3 uPaper, uInk, uBgA, uBgB, uAccent, uItem, uHazard, uGhost, uSide;
uniform vec4 uMusic;                // beat pulse, bar phase, loudness, 0
uniform float uChase;
uniform vec4 uPost;                 // flash, fade, grain, vignette
uniform vec3 uFlashCol;

#define PI 3.14159265359
#define TAU 6.28318530718

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a, e1 = c - b, e2 = a - c, v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

float AA;   // one pixel, in world units

// paint a shape: ink outline of width ow, then the fill
void layer(inout vec3 col, float d, vec3 fill, float ow) {
  col = mix(col, uInk, smoothstep(AA, -AA, d - ow));
  col = mix(col, fill, smoothstep(AA, -AA, d));
}
float stripes(float x, float w) { return smoothstep(-w, w, sin(x)); }

// ------------------------------------------------------------------ the level
ivec2 LS;
int ttype(ivec2 c) {
  if (c.x < 0 || c.x >= LS.x) return 1;
  if (c.y < 0 || c.y >= LS.y) return 0;
  return int(texelFetch(uLevel, c, 0).r * 255.0 + 0.5);
}
float tdyn(ivec2 c) { if (c.x < 0 || c.x >= LS.x || c.y < 0 || c.y >= LS.y) return 0.0; return texelFetch(uLevel, c, 0).g; }

// how solid a tile *looks* right now (flip uses the local flip state inside the flip wave)
float blockAmt(int t, float d, float fl) {
  if (t == 1) return 1.0;
  if (t == 5) return 1.0 - fl;
  if (t == 6) return fl;
  if (t == 7) return smoothstep(0.35, 0.65, d);
  if (t == 9) return d < 1.0 ? 1.0 : 0.0;
  if (t == 10) return step(0.02, d);
  return 0.0;
}
float localFlip(vec2 p) { return length(p - uFlipWave.xy) < uFlipWave.z ? uFlip : uFlipWave.w; }

// the box a solid tile occupies (risers grow up out of the floor of their cell, crumbles shake)
vec4 tileBox(ivec2 c, int t, float d) {
  vec2 ctr = vec2(c) + 0.5, half_ = vec2(0.5);
  if (t == 10) { float h = smoothstep(0.0, 1.0, d); half_.y = 0.5 * h; ctr.y = float(c.y) + half_.y; }
  if (t == 9 && d > 0.0 && d < 1.0) ctr += vec2(sin(uTime * 60.0 + float(c.x)) * 0.04, -d * d * 0.3);
  return vec4(ctr, half_);
}

// ------------------------------------------------------------------ background op-art (low contrast)
vec3 background(vec2 p, vec2 su) {
  float w = 0.9;
  float v = 0.0;
  float beat = uMusic.x;
  vec2 bp = p * 0.32 + vec2(uTime * 0.05, 0.0);
  if (uTheme == 0) {                      // silk
    v = sin((bp.x * 2.4 + 0.35 * sin(bp.y * 0.8 + uTime * 0.5)) * PI);
  } else if (uTheme == 1) {               // moiré
    vec2 o = 0.22 * vec2(cos(uTime * 0.13), sin(uTime * 0.17));
    v = sin(length(su - o) * 70.0) * sin(length(su + o) * 70.0) * 1.4;
  } else if (uTheme == 2) {               // vasarely checkers
    vec2 q = su * 9.0;
    q *= 1.0 - 0.55 * exp(-dot(su, su) * 5.0) * (1.0 + 0.15 * beat);
    q = rot(uTime * 0.03) * q + p * 0.08;
    v = sin(q.x * PI) * sin(q.y * PI);
  } else if (uTheme == 3) {               // tunnel
    float r = max(length(su), 0.002);
    float a = atan(su.y, su.x);
    v = sin((0.16 / r - uTime * 0.45) * 2.0 * PI) * sin(a * 10.0 + uTime * 0.2);
    w = 1.2;
  } else {                                // red silk with static far away
    v = sin((bp.y * 2.6 + 0.4 * sin(bp.x * 0.6 + uTime * 0.7)) * PI);
  }
  float k = smoothstep(-w, w, v);
  vec3 col = mix(uBgA, uBgB, k);
  return col * (1.0 + 0.06 * beat);
}

// ------------------------------------------------------------------ the hero
vec2 joint(vec2 a, float len, float ang) { return a + len * vec2(sin(ang), -cos(ang)); }

void drawHero(inout vec3 col, vec2 p, vec4 P0, vec4 P1, vec4 P2, float alpha, bool ghost) {
  vec2 q = p - P0.xy;
  float face = P0.z;
  q.x *= face;
  float sq = P1.z;
  q.y /= (1.0 + sq);
  q.x /= (1.0 - sq * 0.5);
  float state = P1.w;
  float speed = clamp(abs(P1.x) / 9.0, 0.0, 1.0);
  float ph = P0.w;
  float t = uTime;
  if (state > 2.5) { q.x /= 1.25; q.y *= 1.15; }       // dashing: stretched
  float run = state < 0.5 ? speed : 0.0;
  float air = state > 0.5 && state < 2.5 ? 1.0 : 0.0;
  float rising = air * step(0.0, P1.y);
  float bob = run * abs(sin(ph * 2.0)) * 0.05 + (1.0 - run) * (1.0 - air) * sin(t * 2.2) * 0.012;
  vec2 hip = vec2(0.0, 0.55 + bob), neck = vec2(0.02 * run, 0.84 + bob);
  vec2 head = vec2(0.03 * run, 1.06 + bob);

  // ribbon (behind everything): flows back from the neck, waving
  float dR = 9.0;
  vec2 prev = neck + vec2(-0.05, 0.0);
  for (int i = 1; i <= 6; i++) {
    float s = float(i) / 6.0;
    vec2 pt = neck + vec2(-0.12 - s * (0.55 + 0.35 * speed + 0.3 * air), -0.06 - s * 0.18 + s * 0.35 * clamp(-P1.y / 20.0, -0.4, 0.6))
              + vec2(0.0, 0.09 * s * sin(s * 5.0 - t * 11.0 + ph));
    dR = min(dR, sdSeg(q, prev, pt) - mix(0.075, 0.03, s));
    prev = pt;
  }
  // legs and arms
  float legA = run * sin(ph) * 0.75, legB = -legA;
  float kneeA = run * max(0.0, -sin(ph)) * 0.9 + air * 0.9 * rising + air * 0.3;
  float kneeB = run * max(0.0, sin(ph)) * 0.9 + air * 0.6 * rising + air * 0.1;
  if (air > 0.5) { legA = 0.45 * rising - 0.15; legB = -0.35 * rising + 0.25; }
  else if (run < 0.15) { legA = 0.16; legB = -0.16; }
  vec2 kA = joint(hip, 0.27, legA), fA = joint(kA, 0.28, legA - kneeA);
  vec2 kB = joint(hip, 0.27, legB), fB = joint(kB, 0.28, legB - kneeB);
  float armA = -legA * 0.8 + air * (rising > 0.5 ? -2.4 : -2.0), armB = -legB * 0.8 + air * (rising > 0.5 ? 2.2 : 2.6);
  if (state > 1.5 && state < 2.5) { armA = 3.0; armB = 2.2; }
  if (state > 2.5) { armA = 1.5; armB = 1.7; }
  vec2 sh = neck + vec2(0.0, -0.04);
  vec2 eA = joint(sh, 0.21, armA), hA = joint(eA, 0.2, armA - 0.6);
  vec2 eB = joint(sh, 0.21, armB), hB = joint(eB, 0.2, armB - 0.6);
  float dLimbs = min(min(sdSeg(q, hip, kA), sdSeg(q, kA, fA)), min(sdSeg(q, hip, kB), sdSeg(q, kB, fB))) - 0.075;
  dLimbs = min(dLimbs, min(min(sdSeg(q, sh, eA), sdSeg(q, eA, hA)), min(sdSeg(q, sh, eB), sdSeg(q, eB, hB))) - 0.06);
  float dBody = sdSeg(q, hip + vec2(0.0, 0.05), neck) - 0.16;
  float dHead = length(q - head) - 0.27;

  vec3 c = col;
  vec3 body = ghost ? uAccent : uPaper;
  layer(c, dR, uAccent, 0.045);
  layer(c, dLimbs, body, 0.045);
  layer(c, dBody, body, 0.045);
  // stripes across the torso (it's an op-art kid)
  if (!ghost && dBody < 0.0) c = mix(c, uInk, 0.85 * stripes((q.y - 0.55) * 52.0, 0.6) * smoothstep(0.0, -0.05, dBody));
  layer(c, dHead, body, 0.05);
  if (!ghost && dHead < 0.0) {
    // the head is an eye: concentric iris that looks where you're going (or at the lens)
    vec2 look = vec2(P2.z * face, P2.w) * 0.08;
    vec2 e = q - head - look;
    float blink = step(0.97, fract(t * 0.23 + 0.5)) * 0.85;
    float ir = length(e * vec2(1.0, 1.0 / (1.0 - blink)));
    float iris = smoothstep(0.17, 0.155, ir);
    c = mix(c, mix(uPaper, uInk, stripes(ir * 95.0 - t * 4.0, 0.8)), iris);
    c = mix(c, uInk, smoothstep(0.055, 0.045, ir));
    c = mix(c, uPaper, smoothstep(0.022, 0.012, length(e - vec2(-0.03, 0.035))));
  }
  col = mix(col, c, alpha);
}

// ------------------------------------------------------------------ main
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 su = (frag - 0.5 * uRes) / uRes.y;
  LS = ivec2(uLevelSize);

  // the world is a sheet that can be tilted in 3D (level intros, big moments)
  vec2 uv = rot(uTilt.y) * su;
  float tiltShade = 1.0;
  if (uTilt.z > 0.0) {
    float f = 1.6;
    float pit = uTilt.x;
    vec3 d = vec3(uv, f);
    vec3 N = vec3(0.0, -sin(pit), cos(pit));
    float tt = f * N.z / dot(d, N);
    if (tt <= 0.0) { outColor = vec4(uBgA * 0.2, 1.0); return; }
    vec3 hit = vec3(0.0, 0.0, -f) + tt * d;
    uv = vec2(hit.x, dot(hit, vec3(0.0, cos(pit), sin(pit))));
    tiltShade = exp(-max(tt - 1.0, 0.0) * 0.35);
  }
  // ripples in the world (landings, collecting, deaths)
  vec2 p = uCam + uv * uViewH;
  AA = uViewH / uRes.y * 1.2;
  for (int i = 0; i < 10; i++) {
    vec4 r = uRings[i];
    if (r.z < 0.0 || r.z > 1.2) continue;
    vec2 d = p - r.xy;
    float dist = length(d), front = r.z * (r.w > 2.5 ? 9.0 : 5.0);
    float env = exp(-pow((dist - front) / 0.6, 2.0)) * (1.0 - r.z / 1.2);
    p += d / (dist + 1e-3) * sin((dist - front) * 9.0) * env * (r.w > 2.5 ? 0.12 : 0.05);
  }

  float fl = localFlip(p);
  vec3 col = background(p, su);

  // inside the lens the hidden layer shows: a second pattern + a slight magnification
  float lensD = length(p - uLens.xy) - uLens.z * uLens.w;
  if (uLens.w > 0.01 && lensD < 0.0) {
    vec2 lq = (p - uLens.xy) * 0.85;
    float m = sin(length(lq) * 22.0 - uTime * 3.0) * sin((lq.x + lq.y) * 14.0);
    col = mix(col, mix(uBgA, uGhost * 0.6 + uBgB * 0.4, smoothstep(-0.8, 0.8, m)), 0.55 * uLens.w);
  }

  ivec2 c = ivec2(floor(p));
  int tc = ttype(c);
  float dc = tdyn(c);

  // ---- fake 3D: block sides, extruded toward the middle of the screen
  float k = 0.075;
  bool front = false;
  vec2 dv = p - uCam;
  float sideDepth = -1.0;
  vec2 sideCell = vec2(0.0);
  for (int i = 1; i <= 7; i++) {
    float s = float(i) / 7.0;
    vec2 q = p + dv * k * s;
    ivec2 qc = ivec2(floor(q));
    int qt = ttype(qc);
    if (qt == 0 || qt == 2 || qt == 3 || qt == 4 || qt == 8) continue;
    float qd = tdyn(qc);
    float a = blockAmt(qt, qd, localFlip(q));
    if (a > 0.5) {
      vec4 b = tileBox(qc, qt, qd);
      if (sdBox(q - b.xy, b.zw) < 0.0) { sideDepth = s; sideCell = q; break; }
    }
  }

  // ---- signed distance to the solid blocks (3×3 neighbourhood)
  // outside: distance to the nearest solid box. inside: distance to the nearest open cell, so a run of
  // tiles reads as one shape with no seams.
  float dSolid = 9.0, dToOpen = 1.0, ownSd = 0.0;
  bool inSolid = false;
  int nearT = 0;
  vec4 nearBox = vec4(0.0);
  float dOut = 9.0;      // distance to the inactive flip / unrevealed ghost / riser outlines
  int outT = 0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 n = c + ivec2(i, j);
    int t = ttype(n);
    float d = tdyn(n);
    float a = t == 0 ? 0.0 : blockAmt(t, d, localFlip(vec2(n) + 0.5));
    if (a > 0.5) {
      vec4 b = tileBox(n, t, d);
      float sd = sdBox(p - b.xy, b.zw);
      if (sd < 0.0 && !inSolid) { inSolid = true; nearT = t; nearBox = b; ownSd = sd; }
      if (!inSolid && sd < dSolid) { dSolid = sd; nearT = t; nearBox = b; }
    } else {
      dToOpen = min(dToOpen, max(sdBox(p - (vec2(n) + 0.5), vec2(0.5)), 0.0));
      if (t == 5 || t == 6 || t == 7 || t == 10) {
        float sd = abs(sdBox(p - (vec2(n) + 0.5), vec2(0.5)));
        if (sd < dOut) { dOut = sd; outT = t; }
      }
    }
  }
  if (inSolid) dSolid = (nearT == 10 || nearT == 9) ? max(ownSd, -dToOpen) : -dToOpen;

  // sides first (they sit behind the faces)
  if (sideDepth > 0.0 && dSolid > 0.0) {
    float shade = 0.55 + 0.45 * (1.0 - sideDepth);
    vec3 sideCol = mix(uSide, uInk, stripes(sideDepth * 7.0 * PI + 1.2, 0.5) * 0.85) * shade;
    col = mix(col, sideCol, 0.97);
  }

  // ---- faces of the solid blocks
  if (dSolid < 0.06) {
    vec2 lp = p - nearBox.xy;
    float inside = -dSolid;
    vec3 face = uPaper;
    // op-art fill: lines that bend gently, different per block type
    float lines = nearT == 7 ? (p.x + p.y) * 14.0 : nearT == 5 || nearT == 6 ? (p.x - p.y) * 12.0 : p.y * 13.0 + 0.6 * sin(p.x * 1.3 + uTime * 0.6);
    float fillInk = stripes(lines * PI * 0.5, 0.8);
    face = mix(uPaper, nearT == 7 ? uGhost : nearT == 5 || nearT == 6 ? mix(uInk, uAccent, 0.15) : uInk, fillInk * smoothstep(0.08, 0.16, inside));
    // a bright accent edge on top of each platform (if the tile above is open)
    ivec2 nc = ivec2(floor(nearBox.xy));
    int above = ttype(nc + ivec2(0, 1));
    float aboveSolid = blockAmt(above, tdyn(nc + ivec2(0, 1)), fl);
    float topEdge = (aboveSolid < 0.5 && nearT != 10) || nearT == 10 ? smoothstep(0.13, 0.08, nearBox.y + nearBox.w - p.y) : 0.0;
    vec3 edgeCol = nearT == 7 ? uGhost : nearT == 9 ? uHazard : uAccent;
    face = mix(face, edgeCol, topEdge * smoothstep(0.035, 0.05, inside));
    if (nearT == 9) face = mix(face, uInk, 0.25 * step(0.5, hash12(floor(p * 6.0))));
    layer(col, dSolid, face, 0.05);
  }

  // ---- outlines of what isn't solid right now: the other half of the flip, unrevealed ghosts, risers to come
  if (dSolid > 0.0 && dOut < 0.06) {
    float dash = step(0.5, fract((p.x + p.y) * 3.0));
    if (outT == 5 || outT == 6) col = mix(col, mix(uInk, uAccent, 0.35), smoothstep(0.045, 0.02, dOut) * dash * 0.75);
    else if (outT == 7) col = mix(col, uGhost, smoothstep(0.04, 0.015, dOut) * (0.35 + 0.35 * sin(uTime * 4.0 + p.x)) * dash);
    else if (outT == 10) col = mix(col, uInk, smoothstep(0.035, 0.015, dOut) * 0.35 * dash);
  }
  if (dSolid > 0.0) {
    if (tc == 7) {                         // unrevealed ghost block: a faint moiré shimmer
      vec2 f = p - vec2(c);
      float m = sin(length(f - 0.5) * 40.0 - uTime * 5.0) * sin((p.x - p.y) * 30.0);
      col = mix(col, uGhost, 0.18 * smoothstep(-0.3, 0.9, m) * (1.0 - dc));
    }
    if (tc == 10 && dc < 0.02) {           // a riser that hasn't risen: a flat drawing of a block
      vec2 f = p - vec2(c);
      col = mix(col, uInk, 0.18 * stripes(p.y * 13.0 * PI * 0.5, 0.8) * step(abs(f.x - 0.5), 0.45) * step(abs(f.y - 0.5), 0.45));
    }
    if (tc == 2) {                         // thin ledge
      vec2 f = p - vec2(c);
      float d = sdBox(f - vec2(0.5, 0.86), vec2(0.52, 0.12));
      layer(col, d, mix(uPaper, uAccent, step(0.06, f.y - 0.74) * 0.0 + stripes(p.x * 20.0, 0.8) * 0.0), 0.045);
      col = mix(col, uAccent, smoothstep(0.03, 0.0, abs(f.y - 0.95)) * step(d, 0.0));
    }
    if (tc == 3 || tc == 4) {              // spikes
      vec2 f = p - vec2(c);
      if (tc == 4) f.y = 1.0 - f.y;
      float d = 9.0;
      for (int i = 0; i < 3; i++) {
        float x0 = float(i) / 3.0;
        d = min(d, sdTri(f, vec2(x0 + 0.02, 0.0), vec2(x0 + 0.31, 0.0), vec2(x0 + 0.165, 0.62)));
      }
      layer(col, d, mix(uHazard, uPaper, stripes(f.y * 40.0, 0.7) * 0.3), 0.04);
    }
    if (tc == 8) {                         // static: deadly TV snow
      vec2 f = p - vec2(c);
      float n = hash12(floor(p * 9.0) + floor(uTime * 24.0) * 3.7);
      float d = sdBox(f - 0.5, vec2(0.46));
      layer(col, d, mix(uInk, uPaper, step(0.5, n)), 0.05);
      col = mix(col, uHazard, smoothstep(0.06, 0.0, abs(d + 0.03)) * 0.9);
    }
  }

  // ---- things
  for (int i = 0; i < ${MAX_ENTS}; i++) {
    if (i >= uEntCount) break;
    vec4 e = uEnt[i];
    vec4 b = uEntB[i];
    vec2 q = p - e.xy;
    int type = int(e.z + 0.5);
    if (type == 6) {                                         // a hand rising from below
      vec2 h = q;
      float palm = sdBox(h - vec2(0.0, -0.32), vec2(0.82, 0.26)) - 0.08;
      float arm = sdBox(h - vec2(-0.1, -6.0), vec2(0.55, 5.6)) - 0.06;
      float fingers = 9.0;
      for (int f = 0; f < 4; f++) {
        float fx = -0.72 + float(f) * 0.13;
        fingers = min(fingers, sdSeg(h, vec2(fx - 0.05, -0.2), vec2(fx - 0.2, 0.32 + 0.06 * sin(uTime * 2.0 + float(f)))) - 0.075);
      }
      float thumb = sdSeg(h, vec2(0.7, -0.35), vec2(0.95, 0.1)) - 0.085;
      float d = min(min(palm, arm), min(fingers, thumb));
      if (d > 0.08) continue;
      vec3 fill = mix(uPaper, uInk, stripes((h.y * 9.0 + 0.4 * sin(h.x * 3.0)) * PI, 0.7) * 0.9);
      layer(col, d, fill, 0.05);
      col = mix(col, uAccent, smoothstep(0.08, 0.04, abs(h.y + 0.08)) * step(abs(h.x), 0.8) * step(d, 0.0));
      continue;
    }
    if (dot(q, q) > 9.0) continue;
    if (type == 1) {                                         // orb
      if (e.w > 0.5) continue;
      q.y -= 0.08 * sin(uTime * 3.0 + e.x);
      float r = length(q);
      col = mix(col, uItem, 0.25 * exp(-r * r * 18.0));
      float d = abs(r - 0.17) - 0.07;
      layer(col, d, uItem, 0.04);
    } else if (type == 2) {                                  // prism
      if (e.w > 0.5) continue;
      q.y -= 0.1 * sin(uTime * 2.0);
      vec2 rq = rot(uTime * 0.8) * q;
      float d = (abs(rq.x) + abs(rq.y)) * 0.75 - 0.34;
      col = mix(col, uAccent, 0.3 * exp(-dot(q, q) * 6.0));
      layer(col, d, mix(uAccent, uPaper, stripes((rq.x - rq.y) * 30.0, 0.8)), 0.05);
    } else if (type == 3) {                                  // checkpoint: a tall eye that opens
      float pole = sdBox(q - vec2(0.0, 0.9), vec2(0.06, 0.9));
      float eyeD = length((q - vec2(0.0, 2.05)) * vec2(1.0, 1.5)) - 0.34;
      layer(col, pole, uPaper, 0.04);
      layer(col, eyeD, uPaper, 0.05);
      if (eyeD < 0.0) {
        vec2 eq = q - vec2(0.0, 2.05);
        float open = e.w;
        float ir = length(eq * vec2(1.0, 1.0 / max(open, 0.05)));
        col = mix(col, mix(uAccent, uInk, stripes(ir * 80.0 - uTime * 3.0, 0.8)), smoothstep(0.2, 0.18, ir) * step(0.05, open));
        col = mix(col, uInk, (1.0 - open) * smoothstep(0.03, 0.0, abs(eq.y)) * step(abs(eq.x), 0.3));
      }
    } else if (type == 4) {                                  // goal: a vortex
      float r = length(q);
      float a = atan(q.y, q.x);
      float s = sin(a * 3.0 + log(max(r, 0.01)) * 9.0 - uTime * 5.0);
      float d = r - 1.35;
      col = mix(col, uAccent, 0.35 * exp(-max(r - 1.2, 0.0) * 3.0));
      layer(col, d, mix(uInk, mix(uAccent, uPaper, smoothstep(0.2, 0.9, r)), stripes(s * 2.0, 0.6)), 0.07);
    } else if (type == 5) {                                  // dome: a Vasarely half-sphere
      float sq = e.w;
      vec2 dq = q * vec2(1.0 + sq * 0.25, 1.0 / (1.0 - sq * 0.35));
      float r = length(dq);
      float d = max(r - 0.95, -dq.y);
      if (d < 0.07) {
        float z = sqrt(max(0.0, 1.0 - r * r / 0.9));
        vec2 g = dq / (0.3 + z);
        vec3 fill = mix(uPaper, uInk, stripes(g.x * 9.0, 0.7) * stripes(g.y * 9.0 + 1.57, 0.7) + (1.0 - stripes(g.x * 9.0, 0.7)) * (1.0 - stripes(g.y * 9.0 + 1.57, 0.7)));
        fill = mix(fill, uAccent, 0.25 * (1.0 - z));
        layer(col, d, fill, 0.06);
      }
    } else if (type == 7) {                                  // moving bar
      float w = b.x;
      float d = sdBox(q - vec2(0.0, -0.22), vec2(w * 0.5 - 0.08, 0.16)) - 0.08;
      layer(col, d, mix(uPaper, uInk, stripes((abs(q.x) - q.y) * 18.0, 0.7) * 0.85), 0.05);
      col = mix(col, uAccent, smoothstep(0.03, 0.0, abs(q.y + 0.02)) * step(d, 0.0));
    } else if (type == 8) {                                  // watcher: a floating eye
      if (e.w < 0.5) continue;
      float r = length(q);
      col = mix(col, uHazard, 0.18 * smoothstep(0.9, 0.5, r) * (0.5 + 0.5 * sin(r * 30.0 - uTime * 6.0)));
      layer(col, r - 0.44, uPaper, 0.06);
      if (r < 0.44) {
        vec2 look = normalize(uP0.xy + vec2(0.0, 0.7) - e.xy + 1e-4) * 0.13;
        float ir = length(q - look);
        col = mix(col, mix(uHazard, uInk, stripes(ir * 90.0 + uTime * 5.0, 0.8)), smoothstep(0.22, 0.2, ir));
        col = mix(col, uInk, smoothstep(0.07, 0.06, ir));
      }
    }
  }

  // ---- the hero, with dash afterimages
  for (int i = 0; i < 8; i++) {
    vec4 tr = uTrail[i];
    if (tr.z < 0.0) continue;
    drawHero(col, p, vec4(tr.xy, tr.w, uP0.w), vec4(0.0, 0.0, 0.0, 3.0), uP2, 0.45 * (1.0 - tr.z / 0.25), true);
  }
  if (uP2.x < 0.0) {
    float appear = smoothstep(0.0, 0.35, uP2.y);
    if (appear < 1.0) {   // respawn: the static resolves into you
      float n = hash12(floor(p * 18.0) + floor(uTime * 30.0));
      appear = step(n, appear * 1.1);
    }
    drawHero(col, p, uP0, uP1, uP2, appear, false);
  } else if (uP2.x < 0.6) {                                   // death: you dissolve into static
    vec2 q = p - (uP0.xy + vec2(0.0, 0.65));
    float r = length(q), front = uP2.x * 6.0;
    float n = hash12(floor(p * 14.0) + floor(uTime * 30.0));
    float ring = smoothstep(0.5, 0.0, abs(r - front)) * (1.0 - uP2.x / 0.6);
    col = mix(col, mix(uInk, uPaper, step(0.5, n)), ring);
  }

  // ---- rings (collect, checkpoint)
  for (int i = 0; i < 10; i++) {
    vec4 r = uRings[i];
    if (r.z < 0.0 || r.z > 1.0) continue;
    float rad = r.z * (r.w > 1.5 ? 3.0 : 1.6);
    float d = abs(length(p - r.xy) - rad) - 0.05 * (1.0 - r.z);
    vec3 rc = r.w < 0.5 ? uItem : r.w < 1.5 ? uAccent : r.w < 2.5 ? uGhost : uPaper;
    col = mix(col, rc, smoothstep(AA, -AA, d) * (1.0 - r.z));
  }

  // ---- the lens ring
  if (uLens.w > 0.01) {
    float d = abs(lensD) - 0.04;
    col = mix(col, uInk, smoothstep(AA, -AA, d - 0.03) * uLens.w);
    col = mix(col, uGhost, smoothstep(AA, -AA, d) * uLens.w);
    float tick = step(0.6, fract(atan(p.y - uLens.y, p.x - uLens.x) / TAU * 24.0 + uTime * 0.3));
    col = mix(col, uGhost, smoothstep(0.08, 0.0, abs(lensD + 0.14)) * tick * 0.7 * uLens.w);
  }

  // ---- the flip wave: a bright ring sweeping out from where you flipped
  if (uFlipWave.z < 39.0) {
    float d = abs(length(p - uFlipWave.xy) - uFlipWave.z);
    col = mix(col, mix(uAccent, uPaper, 0.4), smoothstep(0.35, 0.0, d) * (1.0 - uFlipWave.z / 40.0));
  }

  // ---- the static wall that chases you in the last world
  if (uChase > -1e8) {
    float edge = uChase + 0.6 * sin(p.y * 1.7 + uTime * 3.0) + 0.3 * sin(p.y * 5.3 - uTime * 7.0);
    if (p.x < edge) {
      float n = hash12(floor(p * 7.0) + floor(uTime * 24.0) * 1.3);
      col = mix(uInk, uPaper, step(0.52, n));
      col = mix(col, uHazard, 0.25);
    }
    col = mix(col, uHazard, exp(-max(p.x - edge, 0.0) * 1.5) * 0.6 * step(edge, p.x));
  }

  // ---- film
  col *= tiltShade;
  col = mix(col, uFlashCol, uPost.x);
  vec2 vc = su * vec2(0.8, 1.0);
  col *= 1.0 - uPost.w * smoothstep(0.35, 1.0, length(vc) * 1.1);
  col += (hash12(frag + fract(uTime * 7.31) * 137.0) - 0.5) * uPost.z * 0.12;
  col *= 1.0 - uPost.y;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
