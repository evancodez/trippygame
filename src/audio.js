// All sound is made live with the Web Audio API — no files.
//   · sfx(name, opts) for game events
//   · a generative 6/8 soundtrack (organ chords, a warbly slide lead, a drum machine) that the
//     visuals pulse to; each world changes the chords and the energy.

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];   // pentatonic, for orb chimes
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// chords per world (MIDI notes), each lasting two bars of 6/8
const SONGS = [
  [[61, 65, 68, 72], [58, 61, 65, 68, 72], [54, 58, 61, 65], [56, 61, 63, 65]],    // Db maj7 · Bbm9 · Gb maj7 · Ab sus
  [[57, 60, 64, 67], [53, 57, 60, 64], [50, 53, 57, 60], [52, 55, 59, 62]],        // Am7 · F maj7 · Dm7 · Em7
  [[60, 64, 67, 71], [57, 60, 64, 67], [62, 65, 69, 72], [55, 59, 62, 65]],        // C maj7 · Am7 · Dm7 · G7
  [[52, 55, 59, 62], [48, 52, 55, 59], [50, 53, 57, 60], [47, 50, 54, 57]],        // Em7 · C maj7 · Dm7 · Bm7b5
  [[61, 65, 68, 72], [63, 66, 70, 73], [58, 61, 65, 68], [56, 60, 63, 66]],        // Db maj7 · Ebm7 · Bbm7 · Ab7
];

export class Sound {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.55;
    this.sfxVol = 0.8;
    this.world = 0;
    this.energy = 0.5;
    this.beat = 0;          // visual pulse, decays
    this.bar = 0;           // 0..1 through the current bar
    this.playing = false;
    this.orbStreak = 0;
    this.lastOrb = 0;
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
    // a dreamy echo + a cheap plate reverb for the music
    this.delay = ctx.createDelay(1.5); this.delay.delayTime.value = 0.429;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2200;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delay.connect(this.musicBus);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.8);
    const vg = ctx.createGain(); vg.gain.value = 0.45;
    this.verb.connect(vg).connect(this.musicBus);
    this.noiseBuf = this.makeNoise();
  }

  impulse(seconds) {
    const ctx = this.ctx, len = ctx.sampleRate * seconds, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }
  makeNoise() {
    const ctx = this.ctx, buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setVolumes(music, sfx) {
    this.musicVol = music; this.sfxVol = sfx;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(music, this.ctx.currentTime, 0.05);
    this.sfxBus.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
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

  // ------------------------------------------------------------------ game sounds
  sfx(name, o = {}) {
    if (!this.ctx) return;
    switch (name) {
      case 'jump': this.tone({ type: 'triangle', f0: 330, f1: 620, dur: 0.11, vol: 0.18 }); break;
      case 'walljump': this.tone({ type: 'triangle', f0: 420, f1: 760, dur: 0.1, vol: 0.18 }); this.noise({ dur: 0.05, vol: 0.12, f0: 3000 }); break;
      case 'land': this.tone({ f0: 140, f1: 55, dur: 0.12, vol: Math.min(0.35, 0.08 + (o.speed || 0) / 80) }); this.noise({ dur: 0.07, vol: 0.06, type: 'lowpass', f0: 900 }); break;
      case 'dash': this.noise({ dur: 0.22, vol: 0.32, f0: 600, f1: 4200, q: 1.5 }); this.tone({ type: 'sawtooth', f0: 220, f1: 110, dur: 0.18, vol: 0.06, filter: 1500 }); break;
      case 'orb': {
        const now = this.ctx.currentTime;
        this.orbStreak = now - this.lastOrb < 1.2 ? Math.min(SCALE.length - 1, this.orbStreak + 1) : 0;
        this.lastOrb = now;
        const m = 79 + SCALE[this.orbStreak];
        this.tone({ f0: mtof(m), dur: 0.35, vol: 0.13, sendVerb: 0.5 });
        this.tone({ f0: mtof(m + 12), dur: 0.2, vol: 0.05 });
        break;
      }
      case 'prism': [0, 4, 7, 12, 16].forEach((d, i) => this.tone({ type: 'triangle', f0: mtof(72 + d), t: i * 0.07, dur: 0.7, vol: 0.12, sendVerb: 0.7 })); break;
      case 'checkpoint': this.tone({ type: 'triangle', f0: mtof(67), dur: 0.3, vol: 0.14, sendVerb: 0.6 }); this.tone({ type: 'triangle', f0: mtof(74), t: 0.12, dur: 0.5, vol: 0.14, sendVerb: 0.6 }); break;
      case 'die': this.noise({ dur: 0.5, vol: 0.4, type: 'highpass', f0: 1200, f1: 300 }); this.tone({ type: 'square', f0: 300, f1: 60, dur: 0.4, vol: 0.08, filter: 1200 }); break;
      case 'spawn': this.noise({ dur: 0.3, vol: 0.12, type: 'bandpass', f0: 300, f1: 3000, q: 2 }); break;
      case 'flip': this.tone({ type: 'sine', f0: 900, f1: 180, dur: 0.25, vol: 0.18 }); this.tone({ type: 'sine', f0: 180, f1: 900, dur: 0.25, vol: 0.12 }); this.noise({ dur: 0.3, vol: 0.1, f0: 4000, f1: 500 }); break;
      case 'deny': this.tone({ type: 'square', f0: 110, dur: 0.15, vol: 0.08, filter: 600 }); break;
      case 'bounce': this.tone({ f0: 180, f1: 760, dur: 0.22, vol: 0.25 }); this.tone({ type: 'triangle', f0: 380, f1: 1200, dur: 0.15, vol: 0.08 }); break;
      case 'pop': this.noise({ dur: 0.12, vol: 0.3, f0: 2500, q: 0.8 }); this.tone({ type: 'triangle', f0: 900, f1: 1800, dur: 0.12, vol: 0.12 }); break;
      case 'rise': this.tone({ type: 'sine', f0: 120, f1: 240, dur: 0.4, vol: 0.06, filter: 800 }); break;
      case 'crack': this.noise({ dur: 0.08, vol: 0.2, f0: 1800, q: 3 }); break;
      case 'bonk': this.tone({ f0: 200, f1: 120, dur: 0.06, vol: 0.08 }); break;
      case 'goal': [0, 7, 12, 16, 19, 24].forEach((d, i) => this.tone({ type: 'triangle', f0: mtof(61 + d), t: i * 0.09, dur: 1.4, vol: 0.1, sendVerb: 0.9 })); break;
      case 'chase': this.noise({ dur: 1.2, vol: 0.25, type: 'lowpass', f0: 200, f1: 2000 }); break;
      case 'ui': this.tone({ type: 'triangle', f0: 660, dur: 0.05, vol: 0.08 }); break;
      case 'uiok': this.tone({ type: 'triangle', f0: 880, f1: 1320, dur: 0.1, vol: 0.1 }); break;
      default:
    }
  }

  // ------------------------------------------------------------------ the soundtrack
  play(world = 0, energy = 0.5) {
    this.world = world;
    this.energy = energy;
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.eighth = 60 / 70 / 3;                  // 6/8 at 70 bpm on the dotted quarter
    this.nextT = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), 30);
  }
  stop() { this.playing = false; clearInterval(this.timer); }

  schedule() {
    const ctx = this.ctx;
    while (this.nextT < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextT);
      this.nextT += this.eighth;
      this.step++;
    }
    // visuals: where are we in the bar right now?
    const since = ctx.currentTime - (this.nextT - this.eighth);
    this.bar = ((this.step - 1) % 6 + since / this.eighth) / 6;
  }

  playStep(step, when) {
    const ctx = this.ctx;
    const t = when - ctx.currentTime;
    const chords = SONGS[this.world % SONGS.length];
    const bar = Math.floor(step / 6), pos = step % 6;
    const chord = chords[Math.floor(bar / 2) % chords.length];
    const E = this.energy;
    const bus = this.musicBus;
    // organ pad on each chord change (two bars long)
    if (pos === 0 && bar % 2 === 0) {
      for (const m of chord) for (const det of [-6, 5]) {
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = mtof(m - 12); o.detune.value = det;
        f.type = 'lowpass'; f.frequency.value = 700 + 500 * E; f.Q.value = 0.7;
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
    if (pos === 0 || pos === 3) this.tone({ type: 'triangle', f0: mtof(chord[0] - 24), t, dur: this.eighth * 2.6, vol: 0.13 + 0.05 * E, bus, filter: 400, attack: 0.01 });
    // drum machine: soft kick on 1 and 4, rim on 4, hats on the eighths
    if (pos === 0 || (pos === 3 && E > 0.6)) { this.tone({ f0: 120, f1: 45, t, dur: 0.22, vol: 0.32, bus }); this.beatAt(when); }
    if (pos === 3) this.noise({ t, dur: 0.07, vol: 0.06 + 0.04 * E, f0: 1800, q: 4, bus });
    if (E > 0.3) this.noise({ t, dur: 0.03, vol: (pos % 3 === 0 ? 0.03 : 0.018) * (0.6 + E), type: 'highpass', f0: 7000, bus });
    // the slide lead: a warbly triangle arpeggio through the echo
    if (pos === 0 || pos === 2 || pos === 4 || (E > 0.6 && pos === 5)) {
      const m = chord[(bar * 3 + pos) % chord.length] + 12 + (pos === 4 ? 12 : 0);
      const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = mtof(m);
      o.frequency.setValueAtTime(mtof(m - 0.6), when);
      o.frequency.exponentialRampToValueAtTime(mtof(m), when + 0.12);
      lfo.frequency.value = 5.5; lg.gain.value = mtof(m) * 0.012;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.045 + 0.02 * E, when + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, when + this.eighth * 2.2);
      o.connect(g); g.connect(bus); g.connect(this.delay);
      o.start(when); lfo.start(when); o.stop(when + this.eighth * 2.4); lfo.stop(when + this.eighth * 2.4);
    }
  }

  beatAt(when) {
    setTimeout(() => { this.beat = 1; }, Math.max(0, (when - this.ctx.currentTime) * 1000));
  }

  tick(dt) { this.beat *= Math.exp(-dt * 6); }
}
