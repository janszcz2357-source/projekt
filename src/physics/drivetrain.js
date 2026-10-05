// Uklad napedowy: silnik (krzywa momentu, bezwladnosc, hamowanie silnikiem, ogranicznik obrotow),
// sprzeglo (automatyczne, moment ograniczony pojemnoscia), sekwencyjna skrzynia biegow (czas zmiany,
// miedzygaz), mechanizm roznicowy LSD oraz kontrola trakcji.
//
// Rownania (os tylna, wa = srednia predkosc kol, wd = polowa roznicy):
//   (2 Iw) dwa/dt = G*eta*Tc + tauL + tauR           tau = moment od nawierzchni = -Fx*R
//   Iw     dwd/dt = (tauL - tauR)/2 - Tlsd
//   Ie     dwe/dt = Te - Tc
// Moment sprzegla Tc wyznaczamy pol-niejawnie: jest to moment, ktory zrownalby predkosci
// silnika i wejscia skrzyni na koncu kroku, przyciety do pojemnosci sprzegla. Jesli miesci sie
// w pojemnosci, sprzeglo jest "zablokowane" (brak drgan numerycznych). Analogicznie LSD.

const RPM_TO_RAD = (2 * Math.PI) / 60;
const RAD_TO_RPM = 60 / (2 * Math.PI);

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export class Drivetrain {
  constructor(cfg) {
    this.cfg = cfg;
    this.engine = cfg.engine;
    this.box = cfg.gearbox;
    this.diff = cfg.differential;
    this.assists = cfg.assists;
    this.curve = cfg.engine.torqueCurve;
    this.reset();
  }

  reset(gear = 1) {
    this.engineOmega = this.engine.idleRpm * RPM_TO_RAD;
    this.gear = gear; // -1 = R, 0 = N, 1..n
    this.shiftTimer = 0;
    this.shiftTarget = gear;
    this.shiftDuration = 0;
    this.shiftIsDown = false;
    this.engage = 0;
    this.limiterOn = false;
    this.tcCut = 0;
    this.tcActive = false;
    this.clutchLocked = false;
    this.clutchTorque = 0;
    this.engineTorque = 0;
    this.throttleEff = 0;
    this.load = 0; // obciazenie silnika 0..1 (do dzwieku)
    this.lastShiftTime = 0;
    this.shiftEvent = 0; // licznik zdarzen zmiany biegu (dzwiek)
    this.shiftDenied = 0;
  }

  get rpm() {
    return this.engineOmega * RAD_TO_RPM;
  }

  get numGears() {
    return this.box.ratios.length;
  }

  ratio(gear = this.gear) {
    if (gear === 0) return 0;
    if (gear < 0) return -this.box.reverse * this.box.finalDrive;
    return this.box.ratios[gear - 1] * this.box.finalDrive;
  }

  get isShifting() {
    return this.shiftTimer > 0;
  }

  maxTorque(rpm) {
    const c = this.curve;
    if (rpm <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (rpm <= c[i][0]) {
        const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
        return c[i - 1][1] + t * (c[i][1] - c[i - 1][1]);
      }
    }
    return c[c.length - 1][1];
  }

  frictionTorque(rpm) {
    return this.engine.frictionTorque.a + this.engine.frictionTorque.b * rpm;
  }

  /** Zadanie zmiany biegu. wheelOmegaAvg - srednia predkosc katowa kol napedzanych. */
  requestShift(target, wheelOmegaAvg, time) {
    const n = this.numGears;
    target = clamp(target, -1, n);
    const from = this.isShifting ? this.shiftTarget : this.gear;
    if (target === from) return false;
    // ochrona przed przekreceniem silnika przy redukcji
    if (target > 0 && (from <= 0 || target < from)) {
      const rpmAfter = Math.abs(wheelOmegaAvg * this.ratio(target)) * RAD_TO_RPM;
      if (rpmAfter > this.engine.limiterRpm + 250) {
        this.shiftDenied++;
        return false;
      }
    }
    // wsteczny tylko prawie w miejscu
    if (target < 0 && Math.abs(wheelOmegaAvg) * 0.34 > 2.0) {
      this.shiftDenied++;
      return false;
    }
    this.shiftTarget = target;
    this.shiftIsDown = target < from && target > 0;
    this.shiftDuration = this.shiftIsDown ? this.box.shiftDownTime : this.box.shiftUpTime;
    if (target <= 0 || from <= 0) this.shiftDuration = 0.12;
    this.shiftTimer = this.shiftDuration;
    this.lastShiftTime = time;
    this.shiftEvent++;
    return true;
  }

  /**
   * Jeden podkrok. rl/rr - stany kol tylnych (omega, inertia, radius, roadTorque, vx).
   * Zwraca rzeczywiste przelozenie i stan blokady sprzegla (do hamulcow).
   */
  update(h, throttle, rl, rr, tcLevel) {
    const e = this.engine;
    let rpm = this.rpm;

    // --- zmiana biegu
    let blipThrottle = 0;
    if (this.shiftTimer > 0) {
      this.shiftTimer -= h;
      if (this.shiftIsDown) {
        // automatyczny miedzygaz: dopasuj obroty do nowego biegu
        const wa = (rl.omega + rr.omega) * 0.5;
        const targetRpm = Math.abs(wa * this.ratio(this.shiftTarget)) * RAD_TO_RPM;
        blipThrottle = clamp((targetRpm - rpm) / 600, 0, 1);
      }
      if (this.shiftTimer <= 0) {
        this.shiftTimer = 0;
        this.gear = this.shiftTarget;
        this.engage = Math.min(this.engage, 0.45);
      }
    }
    const shifting = this.shiftTimer > 0;
    const G = shifting ? 0 : this.ratio(this.gear);

    // --- kontrola trakcji
    //  a) poslizg wzdluzny kol napedzanych (min. predkosc odniesienia 3 m/s - ruszanie)
    //  b) laczny poslizg opony (wzdluzny + boczny, znormalizowany do szczytu): gaz jest ograniczany,
    //     gdy opona napedzana przekracza swoj limit przyczepnosci w zakrecie (zapobiega obrotowi).
    if (tcLevel > 0 && !shifting && this.gear !== 0) {
      // przy ruszaniu (v < 4 m/s) prog luzniejszy - silnik musi wejsc na obroty, by sprzeglo zlapalo
      const target = this.assists.tcSlip[tcLevel - 1] + Math.max(0, 4 - Math.abs(rl.vx)) * 0.12;
      const sL = (rl.omega * rl.radius - rl.vx) / Math.max(Math.abs(rl.vx), 3);
      const sR = (rr.omega * rr.radius - rr.vx) / Math.max(Math.abs(rr.vx), 3);
      const slip = this.gear > 0 ? Math.max(sL, sR) : -Math.min(sL, sR);
      let desired = clamp(((slip - target) / target) * 1.6, 0, 1);
      const cTarget = this.assists.tcCombined[tcLevel - 1];
      const drivingL = rl.kappa * Math.sign(this.gear) > 0.02;
      const drivingR = rr.kappa * Math.sign(this.gear) > 0.02;
      const comb = Math.max(drivingL ? rl.slip : 0, drivingR ? rr.slip : 0);
      if (Math.abs(rl.vx) > 4) desired = Math.max(desired, clamp(((comb - cTarget) / cTarget) * 3, 0, 1));
      const tau = desired > this.tcCut ? 0.012 : 0.09;
      this.tcCut += (desired - this.tcCut) * Math.min(1, h / tau);
    } else {
      this.tcCut += (0 - this.tcCut) * Math.min(1, h / 0.05);
    }
    this.tcActive = this.tcCut > 0.04;

    // --- przepustnica efektywna: gaz kierowcy, TC, ogranicznik, odciecie przy zmianie, wolne obroty
    let thr = throttle * (1 - this.tcCut);
    if (shifting) thr = this.shiftIsDown ? blipThrottle : 0;
    if (rpm > e.limiterRpm) this.limiterOn = true;
    else if (rpm < e.limiterRpm - 150) this.limiterOn = false;
    if (this.limiterOn) thr = 0;
    const idleThr = clamp(0.125 + (e.idleRpm - rpm) / 400, 0, 0.6);
    thr = Math.max(thr, idleThr);
    this.throttleEff = thr;

    const tMax = this.maxTorque(rpm);
    const tFric = this.frictionTorque(rpm);
    const Te = thr * tMax - (1 - thr) * tFric;
    this.engineTorque = Te;
    this.load = clamp(Te / (tMax + 1), -1, 1);

    // --- automatyczne sprzeglo
    let targetEngage = 0;
    if (G !== 0) {
      const wa = (rl.omega + rr.omega) * 0.5;
      const inputRpm = Math.abs(wa * G) * RAD_TO_RPM;
      if (inputRpm > e.idleRpm + 400) targetEngage = 1;
      else targetEngage = Math.max(smoothstep(e.idleRpm + 100, e.idleRpm + 2200, rpm), 0.25 * throttle);
    }
    const rate = targetEngage > this.engage ? 12 : 30;
    this.engage += clamp(targetEngage - this.engage, -rate * h, rate * h);
    const cap = this.box.clutchMaxTorque * this.engage;

    const Iw = rl.inertia;
    const Ie = e.inertia;
    const eta = this.box.efficiency;
    const tauL = rl.roadTorque;
    const tauR = rr.roadTorque;
    let wa = (rl.omega + rr.omega) * 0.5;
    let wd = (rl.omega - rr.omega) * 0.5;

    let Tc = 0;
    this.clutchLocked = false;
    if (G !== 0 && cap > 1) {
      const num = this.engineOmega - G * wa + h * (Te / Ie - (G * (tauL + tauR)) / (2 * Iw));
      const den = h * (1 / Ie + (eta * G * G) / (2 * Iw));
      const tLock = num / den;
      Tc = clamp(tLock, -cap, cap);
      this.clutchLocked = Math.abs(tLock) <= cap;
    }
    this.clutchTorque = Tc;
    const Tin = Tc * G * eta;

    // --- mechanizm roznicowy LSD
    const lockCap = this.diff.preload + (Tin * Math.sign(G || 1) >= 0 ? this.diff.powerRamp : this.diff.coastRamp) * Math.abs(Tin);
    const tEq = (Iw * wd) / h + (tauL - tauR) * 0.5;
    const Tlsd = clamp(tEq, -lockCap, lockCap);

    wa += (h * (Tin + tauL + tauR)) / (2 * Iw);
    wd += (h * ((tauL - tauR) * 0.5 - Tlsd)) / Iw;
    rl.omega = wa + wd;
    rr.omega = wa - wd;

    if (this.clutchLocked) {
      this.engineOmega = G * wa;
    } else {
      this.engineOmega += (h * (Te - Tc)) / Ie;
    }
    // silnik nie gasnie (uproszczenie) i nie kreci sie wstecz
    const minOmega = e.idleRpm * 0.55 * RPM_TO_RAD;
    if (this.engineOmega < minOmega) this.engineOmega = minOmega;

    return G;
  }

  /** efektywna bezwladnosc kola tylnego widziana przez hamulec */
  rearEffectiveInertia(Iw) {
    if (!this.clutchLocked) return Iw;
    const G = this.ratio(this.gear);
    return Iw + 0.5 * this.engine.inertia * G * G * this.box.efficiency;
  }

  syncEngineToWheels(wa) {
    if (this.clutchLocked) {
      const G = this.ratio(this.gear);
      const minOmega = this.engine.idleRpm * 0.55 * RPM_TO_RAD;
      this.engineOmega = Math.max(minOmega, G * wa);
    }
  }
}

export { RPM_TO_RAD, RAD_TO_RPM };
