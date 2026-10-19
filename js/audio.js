/**
 * Процедурный звук на Web Audio: без аудиофайлов, вся «квадратность» 16-bit
 * получается осцилляторами и шумовыми буферами.
 *
 * AudioContext создаётся лениво и только из жеста пользователя
 * (autoplay-политика браузеров).
 */
export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.engine = null;
    this.muted = false;
  }

  /** Создать/разбудить контекст. Возвращает false, если звука нет совсем. */
  ensure() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(1.5);
    }
    // resume() без жеста браузер отклоняет (например, автостарт встряхиванием
    // платы) — глотаем отказ, звук поднимется с первым кликом.
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  createNoiseBuffer(seconds) {
    const sampleRate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, Math.floor(sampleRate * seconds), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Гул мотора на всю партию: расстроенные пилы + саб + шум винта. */
  startEngine() {
    if (!this.ensure() || this.engine) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.4, now + 0.8);
    out.connect(this.master);

    const oscillators = [];

    const addOsc = (type, freq, gain) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const oscGain = ctx.createGain();
      oscGain.gain.value = gain;
      osc.connect(oscGain).connect(out);
      osc.start();
      oscillators.push(osc);
    };

    addOsc('sawtooth', 54, 0.1);
    addOsc('sawtooth', 57.5, 0.1); // биения дают «бубнение» мотора
    addOsc('square', 27, 0.07);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const noiseBand = ctx.createBiquadFilter();
    noiseBand.type = 'bandpass';
    noiseBand.frequency.value = 340;
    noiseBand.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.16;
    noise.connect(noiseBand).connect(noiseGain).connect(out);
    noise.start();
    oscillators.push(noise);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.09;
    lfo.connect(lfoDepth).connect(out.gain);
    lfo.start();
    oscillators.push(lfo);

    this.engine = { out, oscillators };
  }

  stopEngine() {
    if (!this.engine || !this.ctx) return;
    const { out, oscillators } = this.engine;
    const now = this.ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    for (const node of oscillators) node.stop(now + 0.5);
    this.engine = null;
  }

  /**
   * Шумовой хлопок: буфер шума → статичный фильтр → экспоненциальное
   * затухание. Общая форма для выстрела и треска обломков.
   */
  noiseBurst(at, { type, frequency, gain, duration }) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const burstGain = ctx.createGain();
    burstGain.gain.setValueAtTime(gain, at);
    burstGain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source.connect(filter).connect(burstGain).connect(this.master);
    source.start(at);
    source.stop(at + duration + 0.02);
  }

  shot() {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    this.noiseBurst(now, { type: 'highpass', frequency: 900, gain: 0.5, duration: 0.13 });

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.12);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.3, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(oscGain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  explosion() {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(2600, now);
    lowpass.frequency.exponentialRampToValueAtTime(90, now + 0.85);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.9, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    noise.connect(lowpass).connect(noiseGain).connect(this.master);
    noise.start(now);
    noise.stop(now + 1);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(105, now);
    thump.frequency.exponentialRampToValueAtTime(36, now + 0.5);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.7, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    thump.connect(thumpGain).connect(this.master);
    thump.start(now);
    thump.stop(now + 0.55);

    // Треск догорающих обломков.
    for (let i = 0; i < 3; i++) {
      this.noiseBurst(now + 0.12 + Math.random() * 0.25, {
        type: 'highpass',
        frequency: 1500,
        gain: 0.22,
        duration: 0.05,
      });
    }
  }

  /** Короткая мелодия из квадратных нот: [[герцы, секунды], ...]. */
  jingle(notes, gain = 0.16) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    let at = ctx.currentTime;
    for (const [freq, duration] of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(gain, at);
      oscGain.gain.setValueAtTime(gain, at + duration - 0.015);
      oscGain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      osc.connect(oscGain).connect(this.master);
      osc.start(at);
      osc.stop(at + duration + 0.02);
      at += duration;
    }
  }

  hitJingle() {
    this.jingle([
      [659, 0.06],
      [784, 0.06],
      [1047, 0.1],
    ]);
  }

  startJingle() {
    this.jingle(
      [
        [392, 0.08],
        [523, 0.08],
        [659, 0.08],
        [784, 0.16],
      ],
      0.2,
    );
  }

  gameOverJingle() {
    this.jingle(
      [
        [523, 0.12],
        [392, 0.12],
        [330, 0.12],
        [262, 0.32],
      ],
      0.2,
    );
  }

  click() {
    this.jingle([[880, 0.045]], 0.12);
  }
}
