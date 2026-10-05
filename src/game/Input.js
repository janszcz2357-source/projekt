// Wejscie: klawiatura + pad (Gamepad API, mapowanie "standard").
//
// Klawiatura: skret narasta plynnie (szybkosc zalezna od predkosci), maksymalny skret maleje
// z predkoscia (czulosc zalezna od predkosci), powrot do srodka szybszy niz skrecanie.
// Opcjonalne wspomaganie kontry: zakres skretu jest centrowany wokol kata, przy ktorym przednie
// kola ustawiaja sie zgodnie z kierunkiem jazdy (ulatwia lapanie poslizgu z klawiatury).
// Gaz/hamulec z klawiatury narastaja w ~0.1-0.15 s (zamiast skoku 0->1).
// Pad: analogowy skret (martwa strefa + krzywa), analogowy gaz i hamulec (spusty).

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const KEYMAP = {
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  handbrake: ['Space'],
  shiftUp: ['KeyE', 'ShiftLeft'],
  shiftDown: ['KeyQ', 'ControlLeft'],
  camera: ['KeyC'],
  lookBack: ['KeyB'],
  reset: ['KeyR'],
  pause: ['Escape', 'KeyP'],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set(); // zdarzenia jednorazowe (edge)
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.source = 'keyboard';
    this.settings = { steerSensitivity: 1.0, speedSensitivity: 0.85, counterSteerAssist: true, padDeadzone: 0.06, padLinearity: 1.4 };
    this.gamepadIndex = null;
    this.prevButtons = [];
    this._onDown = (e) => {
      if (e.repeat) return;
      if (this._isGameKey(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.source = 'keyboard';
    };
    this._onUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
      this.gamepadName = e.gamepad.id;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
    });
  }

  _isGameKey(code) {
    return Object.values(KEYMAP).some((l) => l.includes(code));
  }

  _down(action) {
    return KEYMAP[action].some((k) => this.keys.has(k));
  }

  /** zwraca true raz po wcisnieciu (klawiatura lub pad) */
  consume(action) {
    let hit = false;
    for (const k of KEYMAP[action]) {
      if (this.pressed.has(k)) { this.pressed.delete(k); hit = true; }
    }
    if (this._padEdges && this._padEdges.has(action)) { this._padEdges.delete(action); hit = true; }
    return hit;
  }

  clearEdges() {
    this.pressed.clear();
    if (this._padEdges) this._padEdges.clear();
  }

  _readGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = this.gamepadIndex != null ? pads[this.gamepadIndex] : null;
    if (!gp) {
      for (const p of pads) if (p && p.connected) { gp = p; this.gamepadIndex = p.index; this.gamepadName = p.id; break; }
    }
    if (!gp) return null;
    const b = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const pressed = (i) => gp.buttons[i] && gp.buttons[i].pressed;
    // zdarzenia jednorazowe
    this._padEdges ||= new Set();
    const edgeMap = { 5: 'shiftUp', 0: 'shiftUp', 4: 'shiftDown', 2: 'shiftDown', 3: 'camera', 8: 'reset', 9: 'pause', 13: 'lookBack' };
    for (const [i, act] of Object.entries(edgeMap)) {
      const now = pressed(+i);
      if (now && !this.prevButtons[i]) { this._padEdges.add(act); this.source = 'gamepad'; }
      this.prevButtons[i] = now;
    }
    let sx = gp.axes[0] || 0;
    const dz = this.settings.padDeadzone;
    sx = Math.abs(sx) < dz ? 0 : Math.sign(sx) * ((Math.abs(sx) - dz) / (1 - dz));
    sx = Math.sign(sx) * Math.pow(Math.abs(sx), this.settings.padLinearity);
    const thr = b(7), brk = b(6);
    if (Math.abs(sx) > 0.05 || thr > 0.05 || brk > 0.05) this.source = 'gamepad';
    return { steer: sx, throttle: thr, brake: brk, handbrake: b(1), lookBack: pressed(13) };
  }

  /**
   * Aktualizacja (co klatke). vehicle - do czulosci zaleznej od predkosci i wspomagania kontry.
   * Zwraca stan wejsc w zakresach: steer -1..1 (+ prawo), throttle/brake/handbrake 0..1.
   */
  update(dt, vehicle) {
    dt = Math.min(dt, 0.05);
    const pad = this._readGamepad();
    const speed = vehicle ? Math.abs(vehicle.forwardSpeed()) : 0;
    const S = this.settings;
    // fizyczny limit skretu dla danej predkosci: kat dajacy ~1.75 g (geometrycznie) + maly zapas
    // na kat znoszenia; czulosc przesuwa limit, "redukcja z predkoscia" miesza limit z pelnym skretem.
    let physIn = 1;
    if (vehicle) {
      const maxA = (vehicle.cfg.steering.maxWheelAngleDeg * Math.PI) / 180;
      const aLat = 9.81 * 1.75 * S.steerSensitivity;
      const phys = Math.atan((vehicle.cfg.wheelbase * aLat) / Math.max(speed * speed, 1)) + 0.035 * S.steerSensitivity;
      physIn = clamp(phys / maxA, 0, 1);
    }
    const sensMix = clamp(S.speedSensitivity, 0, 1);
    if (pad && this.source === 'gamepad') {
      // pad: analogowo; lagodniejsza redukcja z predkoscia niz dla klawiatury
      const lim = Math.pow(Math.min(1, physIn * 1.7), sensMix * 0.8);
      const target = clamp(pad.steer * lim, -1, 1);
      this.steer += (target - this.steer) * Math.min(1, dt / 0.03);
      this.throttle = pad.throttle;
      this.brake = pad.brake;
      this.handbrake = pad.handbrake;
      this.lookBack = pad.lookBack;
    } else {
      const l = this._down('left'), r = this._down('right');
      const dir = (r ? 1 : 0) - (l ? 1 : 0);
      // maksymalny skret zalezny od predkosci
      const maxIn = Math.pow(physIn, sensMix);
      // srodek zakresu: kat zerowego poslizgu przodu (kontra), tylko przy poslizgu
      let center = 0;
      if (S.counterSteerAssist && vehicle && speed > 5) {
        const fl = vehicle.wheels[0], fr = vehicle.wheels[1];
        const rl = vehicle.wheels[2], rr = vehicle.wheels[3];
        const vx = (fl.vx + fr.vx) / 2, vy = (fl.vy + fr.vy) / 2;
        const slipAngle = Math.atan2(vy, Math.abs(vx)); // wzgledem skreconego kola, + = w lewo
        const maxA = (vehicle.cfg.steering.maxWheelAngleDeg * Math.PI) / 180;
        // wejscie, przy ktorym przednie kola ustawiaja sie zgodnie z kierunkiem ruchu (zerowy poslizg)
        const zero = clamp(-(vehicle.steerAngle + slipAngle) / maxA, -1, 1);
        // aktywne tylko przy poslizgu tylu (nadsterownosc)
        const rear = Math.abs(Math.atan2((rl.vy + rr.vy) / 2, Math.abs((rl.vx + rr.vx) / 2)));
        const w = clamp((rear - 0.05) / 0.08, 0, 1);
        center = zero * 0.85 * w;
      }
      const target = dir !== 0 ? clamp(center + dir * maxIn, -1, 1) : center;
      // szybkosc ruchu kierownica: wolniej przy duzej predkosci, szybciej przy powrocie do srodka
      const rate = (dir !== 0 && Math.sign(target - this.steer) === dir ? 2.6 / (1 + speed / 45) : 5.0) * S.steerSensitivity;
      const d = target - this.steer;
      this.steer += clamp(d, -rate * dt, rate * dt);
      // pedaly
      const thrT = this._down('throttle') ? 1 : 0;
      const brkT = this._down('brake') ? 1 : 0;
      this.throttle += clamp(thrT - this.throttle, -dt / 0.06, dt / 0.14);
      this.brake += clamp(brkT - this.brake, -dt / 0.06, dt / 0.1);
      this.handbrake = this._down('handbrake') ? 1 : 0;
      this.lookBack = this._down('lookBack');
      if (pad && (Math.abs(pad.steer) > 0.05 || pad.throttle > 0.05 || pad.brake > 0.05)) this.source = 'gamepad';
    }
    return { steer: this.steer, throttle: this.throttle, brake: this.brake, handbrake: this.handbrake };
  }

  reset() {
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
  }
}
