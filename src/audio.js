// All sound is made live with the Web Audio API — no files.
//   · sfx(name, opts) for things that happen on the sea
//   · wind that rises with your speed
//   · a generative 6/8 soundtrack (organ chords, a warbly slide lead, a drum machine) — or your own
//     song, dropped in. Either way `bars` is the clock the sea is timed to.

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];   // pentatonic, for orb chimes
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// chords per dream (MIDI notes), each lasting two bars of 6/8
const SONGS = [
  [[61, 65, 68, 72], [58, 61, 65, 68, 72], [54, 58, 61, 65], [56, 61, 63, 65]],    // Db maj7 · Bbm9 · Gb maj7 · Ab sus
  [[57, 60, 64, 67], [53, 57, 60, 64], [50, 53, 57, 60], [52, 55, 59, 62]],        // Am7 · F maj7 · Dm7 · Em7
  [[60, 64, 67, 71], [57, 60, 64, 67], [62, 65, 69, 72], [55, 59, 62, 65]],        // C maj7 · Am7 · Dm7 · G7
  [[52, 55, 59, 62], [48, 52, 55, 59], [50, 53, 57, 60], [47, 50, 54, 57]],        // Em7 · C maj7 · Dm7 · Bm7b5
  [[61, 65, 68, 72], [63, 66, 70, 73], [58, 61, 65, 68], [56, 60, 63, 66]],        // Db maj7 · Ebm7 · Bbm7 · Ab7
];
export const BAR = (60 / 70) * 2;   // one bar of 6/8 at 70 bpm (dotted quarter), in seconds

export class Sound {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.6;
    this.sfxVol = 0.8;
    this.song = 0;
    this.energy = 0.5;
    this.targetEnergy = 0.5;
    this.beat = 0;          // visual pulse, decays
    this.playing = false;
    this.orbStreak = 0;
    this.lastOrb = 0;
    this.t0 = 0;
    this.track = null;
    this.fallback = 0;      // a clock for when the browser hasn't let audio start yet
    this.paused = false;      // a dropped-in song: { buffer, an, src, t0 }
  }

  // must be called from a user gesture
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxVol; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVol; this.musicBus.connect(this.master);
    // a dreamy echo + a cheap plate reverb
    this.delay = ctx.createDelay(1.5); this.delay.delayTime.value = BAR / 4;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2200;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delay.connect(this.musicBus);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.8);
    const vg = ctx.createGain(); vg.gain.value = 0.45;
    this.verb.connect(vg).connect(this.musicBus);
    this.noiseBuf = this.makeNoise();
    // wind: filtered noise that follows your speed
    const w = ctx.createBufferSource(); w.buffer = this.noiseBuf; w.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 400; this.windF.Q.value = 0.7;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    w.connect(this.windF).connect(this.windG).connect(this.sfxBus);
    w.start();
  }

  suspend() { this.paused = true; this.ctx?.suspend(); }
  resume() { this.paused = false; this.ctx?.resume(); }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  impulse(seconds) {
    const ctx = this.ctx, len = ctx.sampleRate * seconds, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }
  makeNoise() {
    const ctx = this.ctx, buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setVolumes(music, sfx) {
    this.musicVol = music; this.sfxVol = sfx;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(music, this.ctx.currentTime, 0.05);
    this.sfxBus.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
  }

  setWind(speed, air) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime, s = Math.min(1, speed / 50);
    this.windG.gain.setTargetAtTime(0.02 + s * s * 0.16 + (air ? 0.03 : 0), now, 0.15);
    this.windF.frequency.setTargetAtTime(250 + s * 1400 + (air ? 500 : 0), now, 0.2);
  }

  // ------------------------------------------------------------------ building blocks
  tone({ type = 'sine', f0, f1 = f0, t = 0, dur = 0.15, vol = 0.3, attack = 0.005, bus = this.sfxBus, filter = 0, q = 1, sendVerb = 0 }) {
    const ctx = this.ctx, now = ctx.currentTime + t;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, now);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    let node = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; f.Q.value = q; node.connect(f); node = f; }
    node.connect(g).connect(bus);
    if (sendVerb) { const s = ctx.createGain(); s.gain.value = sendVerb; g.connect(s).connect(this.verb); }
    o.start(now); o.stop(now + dur + 0.05);
  }
  noise({ t = 0, dur = 0.2, vol = 0.3, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, bus = this.sfxBus }) {
    const ctx = this.ctx, now = ctx.currentTime + t;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, now);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    s.connect(f).connect(g).connect(bus);
    s.start(now, Math.random()); s.stop(now + dur + 0.05);
  }

  // ------------------------------------------------------------------ sounds of the sea
  sfx(name, o = {}) {
    if (!this.ctx) return;
    const chord = SONGS[Math.max(0, this.song) % SONGS.length][0];
    switch (name) {
      case 'orb': {
        const now = this.ctx.currentTime;
        this.orbStreak = now - this.lastOrb < 1.2 ? Math.min(SCALE.length - 1, this.orbStreak + 1) : 0;
        this.lastOrb = now;
        const m = chord[0] + 12 + SCALE[this.orbStreak];
        this.tone({ f0: mtof(m), dur: 0.35, vol: 0.12, sendVerb: 0.5 });
        this.tone({ f0: mtof(m + 12), dur: 0.2, vol: 0.04 });
        break;
      }
      case 'ring': chord.forEach((m, i) => this.tone({ type: 'triangle', f0: mtof(m + 12), t: i * 0.05, dur: 0.8, vol: 0.09, sendVerb: 0.7 })); this.noise({ dur: 0.4, vol: 0.12, f0: 800, f1: 5000, q: 1.2 }); break;
      case 'smooth': this.tone({ type: 'triangle', f0: mtof(chord[2] + 12), dur: 0.5, vol: 0.1, sendVerb: 0.6 }); this.tone({ type: 'triangle', f0: mtof(chord[3] + 12), t: 0.08, dur: 0.6, vol: 0.08, sendVerb: 0.6 }); break;
      case 'land': this.tone({ f0: 120, f1: 50, dur: 0.14, vol: Math.min(0.3, 0.06 + (o.impact || 0) / 60) }); break;
      case 'rough': this.tone({ f0: 150, f1: 40, dur: 0.25, vol: 0.32 }); this.noise({ dur: 0.18, vol: 0.18, type: 'lowpass', f0: 700 }); break;
      case 'air': this.tone({ type: 'sine', f0: mtof(chord[0] + 24), f1: mtof(chord[0] + 31), dur: 0.5, vol: 0.05, sendVerb: 0.8 }); break;
      case 'flip': this.tone({ type: 'sine', f0: 900, f1: 160, dur: 0.32, vol: 0.16 }); this.tone({ type: 'sine', f0: 160, f1: 900, dur: 0.32, vol: 0.12 }); this.noise({ dur: 0.45, vol: 0.12, f0: 4000, f1: 400 }); break;
      case 'pop': this.tone({ type: 'triangle', f0: 220, f1: 1300, dur: 0.3, vol: 0.18, sendVerb: 0.4 }); this.noise({ dur: 0.15, vol: 0.2, f0: 2500, q: 0.8 }); break;
      case 'bonk': this.tone({ type: 'square', f0: 140, f1: 70, dur: 0.18, vol: 0.12, filter: 900 }); this.noise({ dur: 0.1, vol: 0.2, f0: 1500, q: 2 }); break;
      case 'through': this.noise({ dur: 1.4, vol: 0.25, type: 'bandpass', f0: 300, f1: 6000, q: 0.6 }); chord.forEach((m, i) => this.tone({ type: 'sine', f0: mtof(m), t: i * 0.04, dur: 2.4, vol: 0.07, sendVerb: 1 })); break;
      case 'hand': this.tone({ type: 'sawtooth', f0: 55, f1: 110, dur: 2.5, vol: 0.06, filter: 400, attack: 0.8 }); break;
      case 'fade': this.noise({ dur: 1.0, vol: 0.18, type: 'highpass', f0: 2000, f1: 6000 }); break;
      case 'woke': this.noise({ dur: 2.2, vol: 0.35, type: 'highpass', f0: 600, f1: 4000 }); this.tone({ f0: 300, f1: 40, dur: 1.5, vol: 0.15 }); break;
      case 'clear': [0, 7, 12, 16, 19, 24].forEach((d, i) => this.tone({ type: 'triangle', f0: mtof(chord[0] + d), t: i * 0.11, dur: 2.2, vol: 0.09, sendVerb: 0.9 })); break;
      case 'ui': this.tone({ type: 'triangle', f0: 660, dur: 0.05, vol: 0.06 }); break;
      case 'uiok': this.tone({ type: 'triangle', f0: 880, f1: 1320, dur: 0.1, vol: 0.08 }); break;
      default:
    }
  }

  // ------------------------------------------------------------------ the clock the sea is timed to
  get bars() {
    if (!this.running) return this.fallback / BAR;
    if (this.track) return Math.max(0, (this.ctx.currentTime - this.track.t0 - this.track.an.beatOffset) / this.track.barLen);
    return Math.max(0, (this.ctx.currentTime - this.t0) / BAR);
  }
  get barLen() { return this.track ? this.track.barLen : BAR; }
  get songTime() { return this.track && this.ctx ? this.ctx.currentTime - this.track.t0 : 0; }
  get songOver() { return !!this.track && this.songTime > this.track.an.duration + 0.5; }

  // ------------------------------------------------------------------ the generative soundtrack
  play(song = 0, energy = 0.5) {
    this.song = song;
    this.energy = this.targetEnergy = energy;
    if (!this.ctx) return;
    this.stopTrack();
    if (this.playing) return;
    this.playing = true;
    this.eighth = BAR / 6;
    this.t0 = this.nextT = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), 30);
  }
  stop() { this.playing = false; clearInterval(this.timer); this.stopTrack(); }
  restartClock() { if (this.ctx) { const s = Math.ceil(this.step / 6) * 6; this.t0 = this.nextT + (s - this.step) * this.eighth - s * this.eighth; } }
  setEnergy(e) { this.targetEnergy = e; }

  schedule() {
    const ctx = this.ctx;
    this.energy += (this.targetEnergy - this.energy) * 0.05;
    while (this.nextT < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextT);
      this.nextT += this.eighth;
      this.step++;
    }
  }

  playStep(step, when) {
    const ctx = this.ctx;
    const t = when - ctx.currentTime;
    const chords = SONGS[this.song % SONGS.length];
    const bar = Math.floor(step / 6), pos = step % 6;
    const chord = chords[Math.floor(bar / 2) % chords.length];
    const E = this.energy;
    const bus = this.musicBus;
    // organ pad on each chord change (two bars long)
    if (pos === 0 && bar % 2 === 0) {
      for (const m of chord) for (const det of [-6, 5]) {
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = mtof(m - 12); o.detune.value = det;
        f.type = 'lowpass'; f.frequency.value = 600 + 700 * E; f.Q.value = 0.7;
        const len = this.eighth * 12;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(0.022, when + 0.6);
        g.gain.setValueAtTime(0.022, when + len - 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, when + len + 0.3);
        o.connect(f).connect(g); g.connect(bus); g.connect(this.verb);
        o.start(when); o.stop(when + len + 0.4);
      }
    }
    // bass on the two big beats of the bar
    if (pos === 0 || pos === 3) this.tone({ type: 'triangle', f0: mtof(chord[0] - 24), t, dur: this.eighth * 2.6, vol: 0.12 + 0.06 * E, bus, filter: 400, attack: 0.01 });
    // drum machine: soft kick on 1 (and 4 when it's busy), rim on 4, hats on the eighths
    if (E > 0.2 && (pos === 0 || (pos === 3 && E > 0.6))) this.tone({ f0: 120, f1: 45, t, dur: 0.22, vol: 0.3, bus });
    if (pos === 0 || pos === 3) this.beatAt(when, pos === 0 ? 1 : 0.6);
    if (pos === 3 && E > 0.3) this.noise({ t, dur: 0.07, vol: 0.05 + 0.05 * E, f0: 1800, q: 4, bus });
    if (E > 0.45) this.noise({ t, dur: 0.03, vol: (pos % 3 === 0 ? 0.03 : 0.018) * (0.6 + E), type: 'highpass', f0: 7000, bus });
    // the slide lead: a warbly triangle arpeggio through the echo
    if (pos === 0 || pos === 2 || pos === 4 || (E > 0.65 && pos === 5)) {
      const m = chord[(bar * 3 + pos) % chord.length] + 12 + (pos === 4 ? 12 : 0);
      const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(mtof(m - 0.6), when);
      o.frequency.exponentialRampToValueAtTime(mtof(m), when + 0.12);
      lfo.frequency.value = 5.5; lg.gain.value = mtof(m) * 0.012;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.04 + 0.025 * E, when + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, when + this.eighth * 2.2);
      o.connect(g); g.connect(bus); g.connect(this.delay);
      o.start(when); lfo.start(when); o.stop(when + this.eighth * 2.4); lfo.stop(when + this.eighth * 2.4);
    }
  }

  beatAt(when, amt) {
    setTimeout(() => { this.beat = Math.max(this.beat, amt); }, Math.max(0, (when - this.ctx.currentTime) * 1000));
  }

  // ------------------------------------------------------------------ your own song
  playTrack(buffer, an) {
    this.stop();
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.musicBus);
    const t0 = ctx.currentTime + 0.15;
    src.start(t0);
    this.track = { buffer, an, src, t0, barLen: an.beatPeriod * (an.meter === 3 ? 3 : 4), lastBeat: -1 };
  }
  stopTrack() { try { this.track?.src.stop(); } catch {} this.track = null; }

  // how loud the song is right now (0..1), or null for the generative soundtrack
  get loud() {
    if (!this.track) return null;
    const { an } = this.track, i = Math.floor(this.songTime * an.fps);
    return an.rms[Math.max(0, Math.min(an.rms.length - 1, i))] || 0;
  }

  tick(dt) {
    if (!this.running && !this.paused) this.fallback += dt;
    this.beat *= Math.exp(-dt * 6);
    if (this.track) {
      const { an } = this.track;
      const b = Math.floor((this.songTime - an.beatOffset) / an.beatPeriod);
      if (b !== this.track.lastBeat && b >= 0) { this.track.lastBeat = b; this.beat = Math.max(this.beat, 0.5 + 0.5 * Math.min(1, this.loud || 0)); }
    }
  }
}
