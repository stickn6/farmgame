// Tiny WebAudio synth: all sound effects and a gentle generative music loop,
// so the game ships with zero audio files.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this.musicTimer = null;
  }

  // Must be called from a user gesture (autoplay policies)
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.enabled ? 1 : 0;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.22 : 0;
    // simple echo for the music
    const delay = this.ctx.createDelay();
    delay.delayTime.value = 0.38;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.3;
    this.musicBus.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(this.master);
    this.musicBus.connect(this.master);
    this.startMusic();
  }

  setSfx(on) { this.enabled = on; if (this.sfxBus) this.sfxBus.gain.value = on ? 1 : 0; }
  setMusic(on) { this.musicOn = on; if (this.musicBus) this.musicBus.gain.value = on ? 0.22 : 0; }

  tone(freq, dur = 0.15, { type = 'sine', vol = 0.3, slide = 0, delay = 0, bus } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus || this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur = 0.1, { vol = 0.2, filter = 1200, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t);
  }

  play(name) {
    if (!this.ctx || !this.enabled) return;
    const r = 1 + (Math.random() - 0.5) * 0.08;
    switch (name) {
      case 'click': this.tone(660 * r, 0.06, { type: 'triangle', vol: 0.15 }); break;
      case 'plow': this.noise(0.12, { vol: 0.35, filter: 700 }); this.tone(120 * r, 0.1, { type: 'triangle', vol: 0.2 }); break;
      case 'plant': this.tone(520 * r, 0.08, { type: 'sine', vol: 0.25, slide: 300 }); break;
      case 'harvest': this.tone(700 * r, 0.09, { type: 'triangle', vol: 0.22, slide: 500 }); this.noise(0.05, { vol: 0.1, filter: 3000 }); break;
      case 'coin': this.tone(988, 0.08, { type: 'square', vol: 0.08 }); this.tone(1319, 0.25, { type: 'square', vol: 0.08, delay: 0.07 }); break;
      case 'collect': this.tone(880 * r, 0.1, { type: 'sine', vol: 0.25 }); this.tone(1175 * r, 0.15, { type: 'sine', vol: 0.2, delay: 0.06 }); break;
      case 'build': this.noise(0.25, { vol: 0.3, filter: 500 }); [392, 523, 659].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.18, delay: 0.1 + i * 0.07 })); break;
      case 'error': this.tone(180, 0.18, { type: 'sawtooth', vol: 0.08, slide: -60 }); break;
      case 'levelup': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.2, delay: i * 0.1 })); break;
      case 'quest': [659, 880, 1175].forEach((f, i) => this.tone(f, 0.2, { type: 'sine', vol: 0.22, delay: i * 0.08 })); break;
      case 'feed': this.noise(0.08, { vol: 0.2, filter: 2000 }); this.tone(440 * r, 0.08, { type: 'triangle', vol: 0.12, delay: 0.05 }); break;
      case 'cluck': this.tone(900 * r, 0.05, { type: 'square', vol: 0.06, slide: -400 }); this.tone(1000 * r, 0.05, { type: 'square', vol: 0.06, slide: -500, delay: 0.08 }); break;
      case 'moo': this.tone(140 * r, 0.6, { type: 'sawtooth', vol: 0.08, slide: -40 }); break;
      case 'baa': this.tone(330 * r, 0.35, { type: 'sawtooth', vol: 0.05, slide: -30 }); this.tone(338 * r, 0.35, { type: 'square', vol: 0.03, slide: -30 }); break;
      case 'woof': this.tone(260 * r, 0.09, { type: 'sawtooth', vol: 0.1, slide: -120 }); break;
      case 'truck': this.tone(90, 0.5, { type: 'sawtooth', vol: 0.06, slide: 40 }); this.tone(660, 0.12, { type: 'square', vol: 0.05, delay: 0.1 }); this.tone(660, 0.12, { type: 'square', vol: 0.05, delay: 0.3 }); break;
    }
  }

  // Generative, cheerful pentatonic tune.
  startMusic() {
    if (this.musicTimer) return;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    const chords = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14], [0, 4, 7]];
    const root = 261.63;
    const f = (semi) => root * Math.pow(2, semi / 12);
    let beat = 0;
    const bpm = 96;
    const stepDur = 60 / bpm / 2;
    let idx = 3;
    const tick = () => {
      if (!this.ctx) return;
      if (this.musicOn && this.ctx.state === 'running') {
        const bar = Math.floor(beat / 8) % chords.length;
        const chord = chords[bar];
        if (beat % 8 === 0) {
          for (const s of chord) this.tone(f(s - 12), stepDur * 7.5, { type: 'sine', vol: 0.05, bus: this.musicBus });
          this.tone(f(chord[0] - 24), stepDur * 3, { type: 'triangle', vol: 0.12, bus: this.musicBus });
        }
        if (beat % 8 === 4) this.tone(f(chord[2] - 24), stepDur * 3, { type: 'triangle', vol: 0.1, bus: this.musicBus });
        if (Math.random() < 0.55) {
          idx = Math.max(0, Math.min(scale.length - 1, idx + Math.floor(Math.random() * 5) - 2));
          this.tone(f(scale[idx]), stepDur * 1.8, { type: 'triangle', vol: 0.09, bus: this.musicBus });
        }
      }
      beat++;
    };
    this.musicTimer = setInterval(tick, stepDur * 1000);
  }
}
