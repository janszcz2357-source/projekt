// Synteza dzwieku (Web Audio API) - bez plikow audio.
//
// Silnik: bufor z jednym "cyklem roboczym" V8 (8 impulsow wydechowych na 720 st. walu, rozne
// amplitudy cylindrow -> charakterystyczne bulgotanie), odtwarzany w petli z playbackRate ~ obroty.
// Dwie warstwy: pod obciazeniem (ostrzej, wiecej harmonicznych, przester) i bez obciazenia
// (lagodniej) - przenikanie wg obciazenia silnika. Filtr dolnoprzepustowy zalezny od obrotow/gazu,
// inny dla kamery w kokpicie (wnetrze) i na zewnatrz.
// Dodatkowo: szum dolotu, wycie przekladni, pisk opon, krawezniki, zwir/trawa, wiatr,
// zmiana biegow, strzaly z wydechu przy odpuszczeniu gazu, uderzenia, sygnaly startowe.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const BASE_RPM = 2000;

function makeEngineBuffer(ctx, onLoad, cylinders = 8) {
  const sr = ctx.sampleRate;
  const cycleSec = (2 * 60) / BASE_RPM; // 720 stopni walu
  const cycles = 8;
  const len = Math.round(cycleSec * cycles * sr);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  // amplitudy cylindrow (rozne dlugosci kolektorow) - powtarzalny wzor
  const amp = [1.0, 0.72, 0.93, 0.66, 0.97, 0.78, 0.88, 0.7];
  let seed = onLoad ? 7 : 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pulses = cylinders * cycles;
  const interval = (cycleSec * sr) / cylinders;
  for (let p = 0; p < pulses; p++) {
    const start = Math.round(p * interval + (rnd() - 0.5) * interval * 0.06);
    const a = amp[p % cylinders] * (0.88 + rnd() * 0.24);
    const tau = (onLoad ? 0.0032 : 0.0050) * sr;
    const f1 = (onLoad ? 520 : 380) / sr;
    const f2 = (onLoad ? 1180 : 760) / sr;
    const lenP = Math.round(tau * 6);
    for (let k = 0; k < lenP; k++) {
      const i = (start + k) % len;
      const env = Math.exp(-k / tau) * (1 - Math.exp(-k / (0.00025 * sr)));
      let s = Math.sin(2 * Math.PI * f1 * k) * 0.8 + Math.sin(2 * Math.PI * f2 * k) * (onLoad ? 0.45 : 0.2);
      s += (rnd() - 0.5) * (onLoad ? 0.55 : 0.25); // szum spalania
      d[i] += s * env * a;
    }
  }
  // skladowa niska (pulsacja cisnienia)
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const ph = (t / cycleSec) * Math.PI * 2;
    d[i] += Math.sin(ph * cylinders / 2) * 0.12 + Math.sin(ph * cylinders) * 0.08;
  }
  // normalizacja
  let mx = 0;
  for (let i = 0; i < len; i++) mx = Math.max(mx, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] /= mx;
  return buf;
}

function makeNoise(ctx, seconds = 2, brown = false) {
  const len = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

function distortionCurve(k) {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volumes = { master: 0.8, engine: 0.8, effects: 0.8 };
    this._popTimer = 0;
    this._lastShiftEvent = 0;
    this._lastImpactCount = 0;
  }

  /** wywolac po interakcji uzytkownika (polityka autoplay przegladarek) */
  init() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.fxBus = ctx.createGain();
    this.engineBus.connect(this.master);
    this.fxBus.connect(this.master);

    // ---- silnik
    const loadBuf = makeEngineBuffer(ctx, true);
    const offBuf = makeEngineBuffer(ctx, false);
    this.engLoad = ctx.createBufferSource();
    this.engLoad.buffer = loadBuf;
    this.engLoad.loop = true;
    this.engOff = ctx.createBufferSource();
    this.engOff.buffer = offBuf;
    this.engOff.loop = true;
    this.gLoad = ctx.createGain();
    this.gOff = ctx.createGain();
    this.dist = ctx.createWaveShaper();
    this.dist.curve = distortionCurve(3);
    this.dist.oversample = '2x';
    this.engLP = ctx.createBiquadFilter();
    this.engLP.type = 'lowpass';
    this.engLP.Q.value = 0.9;
    this.engBody = ctx.createBiquadFilter();
    this.engBody.type = 'peaking';
    this.engBody.frequency.value = 160;
    this.engBody.gain.value = 5;
    this.engBody.Q.value = 1.2;
    this.engGain = ctx.createGain();
    this.engLoad.connect(this.gLoad).connect(this.dist);
    this.engOff.connect(this.gOff).connect(this.engLP);
    this.dist.connect(this.engLP);
    this.engLP.connect(this.engBody).connect(this.engGain).connect(this.engineBus);
    this.engLoad.start();
    this.engOff.start();

    // ---- dolot (szum pasmowy)
    const noise = makeNoise(ctx, 2);
    const brown = makeNoise(ctx, 2, true);
    const loopNoise = (b) => {
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      s.start(0, Math.random() * 1.5);
      return s;
    };
    this.intake = ctx.createBiquadFilter();
    this.intake.type = 'bandpass';
    this.intake.Q.value = 1.6;
    this.intakeGain = ctx.createGain();
    loopNoise(noise).connect(this.intake).connect(this.intakeGain).connect(this.engineBus);

    // ---- wycie przekladni
    this.whine = ctx.createOscillator();
    this.whine.type = 'triangle';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.engineBus);
    this.whine.start();

    // ---- pisk opon
    this.squealOsc = ctx.createOscillator();
    this.squealOsc.type = 'sawtooth';
    this.squealBP = ctx.createBiquadFilter();
    this.squealBP.type = 'bandpass';
    this.squealBP.Q.value = 7;
    this.squealNoiseBP = ctx.createBiquadFilter();
    this.squealNoiseBP.type = 'bandpass';
    this.squealNoiseBP.Q.value = 4;
    this.squealNoiseBP.frequency.value = 1100;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squealOsc.connect(this.squealBP).connect(this.squealGain);
    loopNoise(noise).connect(this.squealNoiseBP).connect(this.squealGain);
    this.squealGain.connect(this.fxBus);
    this.squealOsc.start();
    this.squealLFO = ctx.createOscillator();
    this.squealLFO.frequency.value = 7;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 25;
    this.squealLFO.connect(lfoG).connect(this.squealOsc.frequency);
    this.squealLFO.start();

    // ---- toczenie / droga
    this.road = ctx.createBiquadFilter();
    this.road.type = 'lowpass';
    this.road.frequency.value = 420;
    this.roadGain = ctx.createGain();
    loopNoise(brown).connect(this.road).connect(this.roadGain).connect(this.fxBus);

    // ---- kraweznik (ton prostokatny o czestotliwosci zebrowania)
    this.curbOsc = ctx.createOscillator();
    this.curbOsc.type = 'square';
    this.curbLP = ctx.createBiquadFilter();
    this.curbLP.type = 'lowpass';
    this.curbLP.frequency.value = 260;
    this.curbGain = ctx.createGain();
    this.curbGain.gain.value = 0;
    this.curbOsc.connect(this.curbLP).connect(this.curbGain).connect(this.fxBus);
    this.curbOsc.start();

    // ---- zwir (trzaski) / trawa
    this.gravelHP = ctx.createBiquadFilter();
    this.gravelHP.type = 'highpass';
    this.gravelHP.frequency.value = 1800;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    loopNoise(noise).connect(this.gravelHP).connect(this.gravelGain).connect(this.fxBus);
    this.grassLP = ctx.createBiquadFilter();
    this.grassLP.type = 'lowpass';
    this.grassLP.frequency.value = 700;
    this.grassGain = ctx.createGain();
    this.grassGain.gain.value = 0;
    loopNoise(brown).connect(this.grassLP).connect(this.grassGain).connect(this.fxBus);

    // ---- wiatr
    this.wind = ctx.createBiquadFilter();
    this.wind.type = 'bandpass';
    this.wind.frequency.value = 700;
    this.wind.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    loopNoise(noise).connect(this.wind).connect(this.windGain).connect(this.fxBus);

    this.noiseBuf = noise;
    this.ready = true;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.engineBus.gain.setTargetAtTime(this.volumes.engine, t, 0.05);
    this.fxBus.gain.setTargetAtTime(this.volumes.effects, t, 0.05);
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  suspend() {
    if (this.ready && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ready && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** wyciszenie dzwiekow jazdy (menu) */
  mute(on) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(on ? 0 : this.engGain.gain.value, t, 0.05);
    if (on) {
      for (const g of [this.engGain, this.intakeGain, this.whineGain, this.squealGain, this.roadGain, this.curbGain, this.gravelGain, this.grassGain, this.windGain]) g.gain.setTargetAtTime(0, t, 0.05);
    }
    this._muted = on;
  }

  /** aktualizacja co klatke */
  update(v, interior, dt) {
    if (!this.ready || this._muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const tel = v.telemetry;
    const dtn = v.drivetrain;
    const rpm = dtn.rpm;
    const thr = dtn.throttleEff;
    const load = clamp(dtn.load, -1, 1);
    const tc = 0.025;
    // --- silnik
    const rate = clamp(rpm / BASE_RPM, 0.3, 5);
    this.engLoad.playbackRate.setTargetAtTime(rate, t, 0.012);
    this.engOff.playbackRate.setTargetAtTime(rate, t, 0.012);
    const onLoad = clamp(load * 1.2 + 0.1, 0, 1);
    const limiterCut = dtn.limiterOn ? 0.55 : 1;
    const base = 0.32 + (rpm / 8000) * 0.4;
    this.gLoad.gain.setTargetAtTime(onLoad * base * limiterCut * 0.9, t, tc);
    this.gOff.gain.setTargetAtTime((1 - onLoad) * base * 0.75, t, tc);
    const cutoff = (interior ? 500 : 900) + rpm * (interior ? 0.32 : 0.55) + onLoad * (interior ? 900 : 2200);
    this.engLP.frequency.setTargetAtTime(cutoff, t, tc);
    this.engGain.gain.setTargetAtTime(interior ? 0.9 : 0.75, t, 0.1);
    // --- dolot
    this.intake.frequency.setTargetAtTime(500 + rpm * 0.18, t, tc);
    this.intakeGain.gain.setTargetAtTime(thr * (interior ? 0.07 : 0.03) * (rpm / 8000), t, tc);
    // --- przekladnia (zeby prostego zazebienia)
    const rearOmega = Math.abs((v.wheels[2].omega + v.wheels[3].omega) / 2);
    const shaftHz = (rearOmega * v.cfg.gearbox.finalDrive) / (2 * Math.PI);
    this.whine.frequency.setTargetAtTime(clamp(shaftHz * 23, 20, 6000), t, tc);
    this.whineGain.gain.setTargetAtTime(dtn.gear !== 0 ? clamp(tel.speed / 80, 0, 1) * (interior ? 0.035 : 0.01) * (0.4 + Math.abs(load)) : 0, t, 0.05);
    // --- opony
    let slip = 0, onTarmac = 0, onGravel = 0, onGrass = 0, curb = 0;
    for (const w of v.wheels) {
      if (!w.contact) continue;
      const s = w.surface;
      if (s === 1 || s === 2 || s === 3) {
        slip = Math.max(slip, clamp((w.slip - 0.75) * 1.4, 0, 1.5) * clamp(w.slideSpeed / 3, 0, 1));
        onTarmac++;
      }
      if (s === 2) curb++;
      if (s === 5) onGravel++;
      if (s === 4) onGrass++;
    }
    const sp = tel.speed;
    this.squealOsc.frequency.setTargetAtTime(560 + slip * 260, t, 0.05);
    this.squealBP.frequency.setTargetAtTime(700 + slip * 300, t, 0.05);
    this.squealGain.gain.setTargetAtTime(clamp(slip, 0, 1.2) * 0.16 * clamp(sp / 6, 0, 1), t, 0.04);
    this.roadGain.gain.setTargetAtTime(clamp(sp / 70, 0, 1) * 0.22, t, 0.1);
    this.curbOsc.frequency.setTargetAtTime(clamp(sp / 0.8, 10, 140), t, 0.02);
    this.curbGain.gain.setTargetAtTime(curb > 0 ? clamp(sp / 25, 0, 1) * 0.18 * Math.min(2, curb) : 0, t, 0.02);
    this.gravelGain.gain.setTargetAtTime(onGravel > 0 ? clamp(sp / 20, 0, 1) * 0.12 * onGravel * (0.6 + Math.random() * 0.8) : 0, t, 0.02);
    this.grassGain.gain.setTargetAtTime(onGrass > 0 ? clamp(sp / 20, 0, 1) * 0.2 * onGrass / 2 : 0, t, 0.05);
    this.windGain.gain.setTargetAtTime(clamp(sp / 80, 0, 1.2) ** 2 * (interior ? 0.07 : 0.16), t, 0.1);
    this.wind.frequency.setTargetAtTime(400 + sp * 9, t, 0.1);

    // --- zdarzenia: zmiana biegu
    if (dtn.shiftEvent !== this._lastShiftEvent) {
      const up = dtn.shiftTarget > dtn.gear || (!dtn.isShifting && dtn.gear > 0);
      this._lastShiftEvent = dtn.shiftEvent;
      this._burst(0.035, 180, 0.25, 'lowpass');
      if (up && rpm > 6000) this._burst(0.07, 320, 0.35, 'bandpass');
    }
    // --- strzaly z wydechu przy odpuszczeniu gazu na wysokich obrotach
    this._popTimer -= dt;
    if (thr < 0.05 && rpm > 4500 && load < 0 && this._popTimer <= 0) {
      if (Math.random() < 0.35) this._burst(0.03 + Math.random() * 0.03, 250 + Math.random() * 400, 0.18 + Math.random() * 0.2, 'bandpass');
      this._popTimer = 0.05 + Math.random() * 0.18;
    }
    // --- uderzenia
    if (tel.impactCount !== this._lastImpactCount) {
      this._lastImpactCount = tel.impactCount;
      const s = clamp(tel.impact / 15, 0.15, 1);
      this._burst(0.12 + s * 0.2, 140, 0.8 * s, 'lowpass');
      this._tone(95 + Math.random() * 40, 0.25, 0.4 * s);
    }
  }

  _burst(dur, freq, gain, type) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = type === 'bandpass' ? 2 : 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.fxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  _tone(freq, dur, gain, type = 'sine') {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  beep(high = false) {
    if (!this.ready) return;
    this._tone(high ? 1320 : 880, high ? 0.45 : 0.18, 0.25, 'square');
  }

  chime(best) {
    if (!this.ready) return;
    this._tone(best ? 988 : 784, 0.25, 0.18);
    setTimeout(() => this._tone(best ? 1319 : 988, 0.4, 0.18), 140);
  }

  deny() {
    if (!this.ready) return;
    this._tone(220, 0.12, 0.15, 'square');
  }
}
