// Whole-song analysis, done once when a song is loaded:
// loudness + band envelopes, onsets, tempo + beat grid, and section boundaries.
// Everything is sampled at FPS frames per second so the director can look values up by time.

const SR = 22050;
const WIN = 1024;
const HOP = 512;
export const FPS = SR / HOP; // ≈ 43 frames per second

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

function smooth(arr, radius) {
  const out = new Float32Array(arr.length);
  let sum = 0;
  const r = Math.max(1, Math.round(radius));
  for (let i = 0; i < arr.length + r; i++) {
    if (i < arr.length) sum += arr[i];
    if (i - 2 * r - 1 >= 0) sum -= arr[i - 2 * r - 1];
    const c = i - r;
    if (c >= 0 && c < arr.length) out[c] = sum / (Math.min(arr.length - 1, c + r) - Math.max(0, c - r) + 1);
  }
  return out;
}

function normalize(arr, pct = 0.97) {
  const sorted = Float32Array.from(arr).sort();
  const hi = sorted[Math.floor(sorted.length * pct)] || 1;
  const lo = sorted[Math.floor(sorted.length * 0.05)] || 0;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = Math.min(1.2, Math.max(0, (arr[i] - lo) / Math.max(hi - lo, 1e-9)));
  return out;
}

async function decodeMono(arrayBuffer) {
  const tmp = new OfflineAudioContext(1, 1, 44100);
  const decoded = await tmp.decodeAudioData(arrayBuffer.slice(0));
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return { samples: rendered.getChannelData(0), duration: decoded.duration };
}

// Tempo from the autocorrelation of the onset curve. Returns candidates sorted by strength.
function tempoCandidates(onset) {
  const env = smooth(onset, 1);
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  const x = env.map(v => v - mean);
  const minLag = Math.floor((60 / 220) * FPS), maxLag = Math.ceil((60 / 40) * FPS);
  const ac = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    ac[lag] = s / (x.length - lag);
  }
  const peaks = [];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > 0) {
      // parabolic interpolation for sub-frame accuracy
      const a = ac[lag - 1], b = ac[lag], c = ac[lag + 1];
      const d = (a - c) / (2 * (a - 2 * b + c) || 1);
      const L = lag + d;
      peaks.push({ bpm: (60 * FPS) / L, lag: L, strength: b });
    }
  }
  peaks.sort((p, q) => q.strength - p.strength);
  return peaks.slice(0, 8);
}

// Triple or duple feel? Compare how strongly the onset curve repeats every 3 beats vs every 4.
function meterGuess(onset, lag) {
  const ac = L => {
    let s = 0;
    const l = Math.round(L);
    for (let i = 0; i + l < onset.length; i++) s += onset[i] * onset[i + l];
    return s / (onset.length - l);
  };
  return ac(3 * lag) > ac(4 * lag) * 1.08 ? 3 : 4;
}

// Where do the beats land? Pick the offset whose comb of beats collects the most onset energy.
function beatOffset(onset, period) {
  let best = 0, bestScore = -1;
  const steps = Math.ceil(period);
  for (let o = 0; o < steps; o += 0.25) {
    let s = 0;
    for (let t = o; t < onset.length; t += period) s += onset[Math.round(t)] || 0;
    if (s > bestScore) { bestScore = s; best = o; }
  }
  return best / FPS;
}

// Section boundaries: big changes in the (smoothed) sound between the few seconds before and after.
function findSections(features, duration) {
  const win = Math.round(6 * FPS), n = features[0].length;
  const novelty = new Float32Array(n);
  for (let i = win; i < n - win; i += 4) {
    let d = 0;
    for (const f of features) {
      let a = 0, b = 0;
      for (let k = 1; k <= win; k++) { a += f[i - k]; b += f[i + k]; }
      d += Math.abs(a - b) / win;
    }
    for (let k = 0; k < 4 && i + k < n; k++) novelty[i + k] = d;
  }
  const nv = smooth(novelty, FPS);
  const peaks = [];
  for (let i = 1; i < n - 1; i++) if (nv[i] > nv[i - 1] && nv[i] >= nv[i + 1]) peaks.push({ i, v: nv[i] });
  peaks.sort((a, b) => b.v - a.v);
  const minGap = 12 * FPS, chosen = [];
  for (const p of peaks) {
    if (chosen.length >= Math.max(3, Math.round(duration / 25))) break;
    if (chosen.every(c => Math.abs(c.i - p.i) > minGap) && p.v > nv.reduce((m, v) => Math.max(m, v), 0) * 0.18) chosen.push(p);
  }
  return chosen.map(c => c.i / FPS).sort((a, b) => a - b);
}

export async function analyzeAudio(arrayBuffer, onProgress = () => {}) {
  onProgress('Decoding');
  const { samples, duration } = await decodeMono(arrayBuffer);
  const frames = Math.floor((samples.length - WIN) / HOP) + 1;
  const rms = new Float32Array(frames), bass = new Float32Array(frames), mid = new Float32Array(frames);
  const high = new Float32Array(frames), flux = new Float32Array(frames), centroid = new Float32Array(frames);
  const hann = Float32Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
  const re = new Float32Array(WIN), im = new Float32Array(WIN);
  let prevMag = new Float32Array(WIN / 2), mag = new Float32Array(WIN / 2);
  const binHz = SR / WIN;
  const bin = hz => Math.round(hz / binHz);
  const [b0, b1, b2, b3, b4] = [bin(30), bin(160), bin(500), bin(2500), bin(9000)];

  onProgress('Listening');
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    let e = 0;
    for (let i = 0; i < WIN; i++) {
      const s = samples[o + i];
      e += s * s;
      re[i] = s * hann[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(e / WIN);
    fft(re, im);
    let fl = 0, cNum = 0, cDen = 0, eb = 0, em = 0, eh = 0;
    for (let k = 1; k < WIN / 2; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      mag[k] = m;
      const lm = Math.log1p(m * 10), lp = Math.log1p(prevMag[k] * 10);
      if (lm > lp) fl += lm - lp;
      cNum += k * m; cDen += m;
      if (k >= b0 && k < b1) eb += m;
      else if (k >= b1 && k < b3) em += m;
      else if (k >= b3 && k < b4) eh += m;
    }
    flux[f] = fl;
    bass[f] = eb; mid[f] = em; high[f] = eh;
    centroid[f] = cDen > 0 ? (cNum / cDen) * binHz : 0;
    [prevMag, mag] = [mag, prevMag];
    if (f % 2000 === 0) await new Promise(r => setTimeout(r, 0));
  }
  void b2;

  onProgress('Finding the beat');
  // onset strength: flux minus its local average, clipped at 0
  const fluxAvg = smooth(flux, FPS * 0.5);
  const onset = new Float32Array(frames);
  for (let i = 0; i < frames; i++) onset[i] = Math.max(0, flux[i] - fluxAvg[i]);
  const onsetN = normalize(onset, 0.99);
  const candidates = tempoCandidates(onsetN);
  const tempo = candidates[0] || { bpm: 100, lag: (60 * FPS) / 100 };

  const loud = normalize(smooth(rms, FPS * 0.15));
  const feats = [smooth(normalize(rms), FPS), smooth(normalize(bass), FPS), smooth(normalize(mid), FPS), smooth(normalize(high), FPS)];
  onProgress('Finding sections');
  const boundaries = findSections(feats, duration);

  return {
    duration, fps: FPS,
    rms: loud,                                   // loudness, 0–1ish
    slow: normalize(smooth(rms, FPS * 4)),       // long-term loudness (the song's "arc")
    bass: normalize(smooth(bass, 2)), mid: normalize(smooth(mid, 2)), high: normalize(smooth(high, 2)),
    onset: onsetN,
    centroid: normalize(smooth(centroid, FPS * 0.5)),
    bpm: tempo.bpm, beatPeriod: 60 / tempo.bpm, beatOffset: beatOffset(onsetN, tempo.lag), meter: meterGuess(onsetN, tempo.lag),
    candidates: candidates.map(c => ({ bpm: +c.bpm.toFixed(2), strength: +c.strength.toFixed(4) })),
    boundaries,
  };
}

// Look up a feature at time t (seconds), linearly interpolated.
export function sample(arr, t) {
  const x = t * FPS;
  const i = Math.floor(x);
  if (i < 0) return arr[0] || 0;
  if (i >= arr.length - 1) return arr[arr.length - 1] || 0;
  return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
}
