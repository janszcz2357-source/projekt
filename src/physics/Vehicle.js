// Dynamika pojazdu: bryla sztywna 6DOF + 4 niezalezne kola.
//
//  * Kazde kolo: promien zawieszenia (raycast) wzdluz osi -Y nadwozia, sprezyna + tlumik
//    (dwustopniowy, osobno dobicie/odbicie) + odbojnik + stabilizator; sila nacisku Fz = sila zawieszenia.
//  * Opona: stany poslizgu (wzdluzny kappa, boczny tan(alpha)) z dlugoscia relaksacji, model
//    combined-slip z tyre.js (wspolny limit przyczepnosci, spadek mu z obciazeniem).
//  * Sily opon dzialaja w punkcie styku z nawierzchnia -> momenty pochylajace/przechylajace,
//    a przenoszenie obciazenia wynika z rownowagi sil w zawieszeniu (nie jest "doklejane").
//  * Naped: drivetrain.js (silnik, sprzeglo, skrzynia, LSD, TC), hamulce z ABS, aerodynamika
//    (opor + docisk na osiach), kolizje nadwozia z ziemia i barierami (impulsy).
//
// Krok: step(dt) wywolywany ze stalym dt = 1/120 s, wewnatrz PHYSICS.substeps podkrokow.

import { Vector3, Quaternion } from 'three';
import { createTyreModel } from './tyre.js';
import { Drivetrain, RAD_TO_RPM } from './drivetrain.js';
import { SURF, SURFACE_PROPS } from './surfaces.js';
import { PHYSICS } from '../config/carConfig.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

class Wheel {
  constructor(index, name, mount, tyreCfg, susCfg, isFront, isLeft) {
    this.index = index;
    this.name = name;
    this.mount = mount; // punkt mocowania w ukladzie nadwozia
    this.radius = tyreCfg.radius;
    this.width = tyreCfg.width;
    this.inertia = tyreCfg.inertia;
    this.grip = tyreCfg.grip ?? 1;
    this.sus = susCfg;
    this.isFront = isFront;
    this.isLeft = isLeft;
    this.driven = !isFront;
    // dynamika
    this.omega = 0;
    this.spin = 0; // kat obrotu do renderingu
    this.kappa = 0;
    this.sy = 0;
    this.steer = 0;
    // zawieszenie
    this.length = 0;
    this.prevLength = 0;
    this.lengthStatic = 0;
    this.restLength = 0;
    this.minLength = 0;
    this.maxLength = 0;
    this.contact = false;
    this.compVel = 0;
    // sily
    this.fz = 0;
    this.fx = 0;
    this.fy = 0;
    this.slip = 0;
    this.vx = 0;
    this.vy = 0;
    this.roadTorque = 0;
    this.brakeTorque = 0;
    this.absFactor = 1;
    this.absLimit = Infinity;
    this.absActive = false;
    this.surface = SURF.ASPHALT;
    this.groundHeight = 0;
    this.contactPoint = new Vector3();
    this.normal = new Vector3(0, 1, 0);
    this.trackLateral = 0;
    this.slipRatioInstant = 0;
    this.slideSpeed = 0; // predkosc poslizgu w punkcie styku [m/s] (dzwiek, slady)
  }
}

// bufory tymczasowe
const _ax = new Vector3();
const _ay = new Vector3();
const _az = new Vector3();
const _p = new Vector3();
const _r = new Vector3();
const _f = new Vector3();
const _s = new Vector3();
const _vc = new Vector3();
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _F = new Vector3();
const _T = new Vector3();
const _wb = new Vector3();
const _q = new Quaternion();
const _n = new Vector3();
const _sample = { height: 0, nx: 0, ny: 1, nz: 0, type: SURF.ASPHALT, index: 0, lateral: 0 };
const _hit = { pen: 0, nx: 0, nz: 0 };
const _tyreOut = { fx: 0, fy: 0, slip: 0, mu: 0 };
const _absOut = { fx: 0, fy: 0, slip: 0, mu: 0 };

export class Vehicle {
  constructor(cfg, surface) {
    this.cfg = cfg;
    this.surface = surface;
    this.mass = cfg.mass;
    this.inertia = new Vector3(cfg.inertia.pitch, cfg.inertia.yaw, cfg.inertia.roll);
    this.invInertia = new Vector3(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);
    this.tyre = createTyreModel(cfg.tyres);
    this.drivetrain = new Drivetrain(cfg);

    this.pos = new Vector3();
    this.quat = new Quaternion();
    this.vel = new Vector3();
    this.angVel = new Vector3(); // w ukladzie swiata
    this.prevPos = new Vector3();
    this.prevQuat = new Quaternion();

    const a = cfg.cgToFrontAxle;
    const b = cfg.wheelbase - a;
    const tf = cfg.trackWidth.front / 2;
    const tr = cfg.trackWidth.rear / 2;
    const T = cfg.tyres;
    const S = cfg.suspension;
    this.wheels = [
      new Wheel(0, 'FL', new Vector3(tf, 0, a), T.front, S.front, true, true),
      new Wheel(1, 'FR', new Vector3(-tf, 0, a), T.front, S.front, true, false),
      new Wheel(2, 'RL', new Vector3(tr, 0, -b), T.rear, S.rear, false, true),
      new Wheel(3, 'RR', new Vector3(-tr, 0, -b), T.rear, S.rear, false, false),
    ];
    const g = PHYSICS.gravity;
    for (const w of this.wheels) {
      const axleShare = w.isFront ? b / cfg.wheelbase : a / cfg.wheelbase;
      const staticLoad = (cfg.mass * g * axleShare) / 2;
      w.lengthStatic = cfg.cgHeight - w.radius; // mocowanie na wysokosci srodka ciezkosci
      w.restLength = w.lengthStatic + staticLoad / w.sus.springRate;
      w.minLength = w.lengthStatic - w.sus.bumpTravel;
      w.maxLength = w.lengthStatic + w.sus.droopTravel;
      w.staticLoad = staticLoad;
    }

    // punkty kolizyjne nadwozia (uklad nadwozia)
    const B = cfg.body;
    this.bodyPoints = [];
    for (const z of [B.front, B.front - 0.35, a, 0, -b, B.rear + 0.3, B.rear]) {
      for (const x of [B.halfWidth, -B.halfWidth]) {
        const narrow = z === B.front || z === B.rear ? 0.8 : 1;
        this.bodyPoints.push(new Vector3(x * narrow, B.bottom + 0.12, z));
      }
    }
    this.groundPoints = [];
    for (const z of [B.front, B.rear, 0]) {
      for (const x of [B.halfWidth * 0.85, -B.halfWidth * 0.85]) this.groundPoints.push(new Vector3(x, B.bottom, z));
    }
    for (const z of [0.6, -1.0]) {
      for (const x of [0.7, -0.7]) this.groundPoints.push(new Vector3(x, B.top, z));
    }

    // sterowanie (ustawiane przez gre)
    this.input = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
    this.settings = { absLevel: 2, tcLevel: 2, autoGearbox: true, brakeBias: null };
    this.shiftRequests = 0; // +n gora / -n dol (z klawiatury/pada)
    this.holdBrakes = false;

    this.trackIndex = 0;
    this.time = 0;
    this.telemetry = {
      speed: 0, speedKmh: 0, rpm: 0, gear: 1, throttle: 0, brake: 0, steerAngle: 0,
      absActive: false, tcActive: false, latG: 0, longG: 0, shifting: false, limiter: false,
      offTrackWheels: 0, impact: 0, impactCount: 0, curbWheels: 0, upsideDown: false,
    };
    this._prevVel = new Vector3();
    this._accelSmooth = new Vector3();
    this._reverseTimer = 0;
    this._autoShiftCooldown = 0;
    this.steerAngle = 0;
    this.lastImpact = 0;
    this.impactCount = 0;
  }

  // ------------------------------------------------------------------ reset / ustawienie
  /** Ustawia auto w punkcie (x, z) na ziemi, kierunek heading (rad, 0 = +Z), predkosc [m/s]. */
  reset(x, z, heading, speed = 0, hint = -1) {
    this.trackIndex = this.surface.locate(x, z, hint);
    this.surface.sample(x, z, this.trackIndex, _sample);
    // orientacja: odchylenie heading, nachylenie zgodne z normalna nawierzchni
    const n = _tmp.set(_sample.nx, _sample.ny, _sample.nz).normalize();
    const fwd = _tmp2.set(Math.sin(heading), 0, Math.cos(heading));
    fwd.addScaledVector(n, -fwd.dot(n)).normalize();
    const left = _s.crossVectors(n, fwd).normalize();
    // macierz rotacji z kolumn (left, up, fwd)
    const m11 = left.x, m12 = n.x, m13 = fwd.x;
    const m21 = left.y, m22 = n.y, m23 = fwd.y;
    const m31 = left.z, m32 = n.z, m33 = fwd.z;
    const tr = m11 + m22 + m33;
    if (tr > 0) {
      const s = 0.5 / Math.sqrt(tr + 1.0);
      this.quat.set((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s);
    } else if (m11 > m22 && m11 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
      this.quat.set(0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s);
    } else if (m22 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
      this.quat.set((m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s);
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
      this.quat.set((m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s);
    }
    this.quat.normalize();
    this.pos.set(x, _sample.height, z).addScaledVector(n, this.cfg.cgHeight);
    this.vel.copy(fwd).multiplyScalar(speed);
    this.angVel.set(0, 0, 0);
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    let gear = 1;
    for (const w of this.wheels) {
      w.omega = speed / w.radius;
      w.kappa = 0;
      w.sy = 0;
      w.length = w.lengthStatic;
      w.prevLength = w.lengthStatic;
      w.contact = true;
      w.absFactor = 1;
      w.fz = w.staticLoad;
    }
    if (speed > 1) {
      const wr = speed / this.cfg.tyres.rear.radius;
      for (let g = this.drivetrain.numGears; g >= 1; g--) {
        if (wr * this.drivetrain.ratio(g) * RAD_TO_RPM > 3800 || g === 1) { gear = g; break; }
      }
    }
    this.drivetrain.reset(gear);
    if (speed > 1) {
      this.drivetrain.engineOmega = Math.max(this.drivetrain.engineOmega, (speed / this.cfg.tyres.rear.radius) * this.drivetrain.ratio(gear));
      this.drivetrain.engage = 1;
    }
    this._prevVel.copy(this.vel);
    this._accelSmooth.set(0, 0, 0);
    this._throttleCmd = 0;
    this._brakeCmd = 0;
    Object.assign(this.telemetry, {
      speed, forwardSpeed: speed, speedKmh: speed * 3.6, rpm: this.drivetrain.rpm, gear: this.drivetrain.gear,
      throttle: 0, brake: 0, absActive: false, tcActive: false, latG: 0, longG: 0, offTrackWheels: 0, curbWheels: 0,
    });
    this.shiftRequests = 0;
    this._reverseTimer = 0;
    this.lastImpact = 0;
  }

  // ------------------------------------------------------------------ logika sterowania 120 Hz
  _controlLogic(dt) {
    const dtn = this.drivetrain;
    const inp = this.input;
    const fwdSpeed = this.forwardSpeed();
    const wheelAvg = (this.wheels[2].omega + this.wheels[3].omega) * 0.5;
    this._autoShiftCooldown -= dt;

    // reczna zmiana biegow (dziala tez w trybie auto)
    while (this.shiftRequests !== 0) {
      const dir = Math.sign(this.shiftRequests);
      this.shiftRequests -= dir;
      const from = dtn.isShifting ? dtn.shiftTarget : dtn.gear;
      dtn.requestShift(from + dir, wheelAvg, this.time);
      this._autoShiftCooldown = 0.8;
    }

    let throttle = inp.throttle;
    let brake = inp.brake;

    if (this.holdBrakes) {
      // procedura startowa: auto trzymane na hamulcach, mozna podniesc obroty
      this._reverseTimer = 0;
      this._throttleCmd = clamp(throttle, 0, 1);
      this._brakeCmd = 1;
      const maxSteer0 = this.cfg.steering.maxWheelAngleDeg * DEG;
      this.steerAngle = -clamp(inp.steer, -1, 1) * maxSteer0;
      this._applySteer(this.steerAngle);
      return;
    }

    if (this.settings.autoGearbox) {
      // wsteczny: przytrzymanie hamulca w miejscu
      if (dtn.gear >= 0 && Math.abs(fwdSpeed) < 0.6 && inp.brake > 0.5 && inp.throttle < 0.05) {
        this._reverseTimer += dt;
        if (this._reverseTimer > 0.8 && !dtn.isShifting) {
          dtn.requestShift(-1, wheelAvg, this.time);
          this._reverseTimer = 0;
        }
      } else if (dtn.gear < 0 && fwdSpeed > -0.6 && inp.throttle > 0.3 && inp.brake < 0.05 && !dtn.isShifting) {
        dtn.requestShift(1, wheelAvg, this.time);
      } else {
        this._reverseTimer = 0;
      }
      if (dtn.gear === 0 && !dtn.isShifting) dtn.requestShift(1, wheelAvg, this.time);

      if (dtn.gear < 0) {
        // na wstecznym pedaly zamieniaja sie rolami
        throttle = inp.brake;
        brake = inp.throttle;
      } else if (dtn.gear >= 1 && !dtn.isShifting && this._autoShiftCooldown <= 0) {
        const rpm = dtn.rpm;
        const rearSlip = Math.max(this.wheels[2].slipRatioInstant, this.wheels[3].slipRatioInstant);
        const gb = this.cfg.gearbox;
        if (dtn.gear < dtn.numGears && rpm > gb.autoUpRpm && rearSlip < 0.35) {
          dtn.requestShift(dtn.gear + 1, wheelAvg, this.time);
          this._autoShiftCooldown = 0.35;
        } else if (dtn.gear > 1) {
          const lowerRpm = (rpm * dtn.ratio(dtn.gear - 1)) / dtn.ratio(dtn.gear);
          const braking = inp.brake > 0.15;
          const threshold = braking ? 7000 : inp.throttle > 0.9 ? 6800 : 7200;
          const downAt = braking ? 99999 : gb.autoDownRpm;
          if (lowerRpm < threshold && (braking || rpm < downAt)) {
            if (dtn.requestShift(dtn.gear - 1, wheelAvg, this.time)) this._autoShiftCooldown = braking ? 0.18 : 0.4;
          }
          if (Math.abs(fwdSpeed) < 2 && dtn.gear > 1) dtn.requestShift(1, wheelAvg, this.time);
        }
      }
    } else if (dtn.gear < 0) {
      // reczna skrzynia: na wstecznym gaz dziala normalnie
    }

    this._throttleCmd = clamp(throttle, 0, 1);
    this._brakeCmd = clamp(brake, 0, 1);

    // kierownica: + = prawo (wejscie), kat kola + = lewo (uklad nadwozia)
    const maxSteer = this.cfg.steering.maxWheelAngleDeg * DEG;
    this.steerAngle = -clamp(inp.steer, -1, 1) * maxSteer;
    this._applySteer(this.steerAngle);
  }

  /**
   * ABS: moment hamowania kola ograniczany do wartosci, przy ktorej opona pracuje na zadanym
   * poslizgu (sprzezenie w przod z modelu opony przy biezacym obciazeniu i nawierzchni)
   * + korekta od zmierzonego poslizgu (absFactor). Os tylna "select-low" (stabilnosc),
   * przod: ograniczona roznica lewo/prawo (moment odchylajacy przy roznej przyczepnosci stron).
   */
  _updateABS(h, brakeCmd) {
    const lvl = this.settings.absLevel;
    const peak = this.cfg.tyres.peakSlipRatio;
    const W = this.wheels;
    for (const w of W) {
      w.absLimit = Infinity;
      if (lvl > 0 && brakeCmd > 0.01 && Math.abs(w.vx) > 3 && w.contact) {
        const target = peak * this.cfg.assists.absSlip[lvl - 1];
        const sp = SURFACE_PROPS[w.surface] || SURFACE_PROPS[SURF.ASPHALT];
        this.tyre.forces(w.fz, -target, w.sy, sp.grip * w.grip, _absOut);
        w.absLimit = Math.abs(_absOut.fx) * w.radius;
        const sl = w.vx > 0 ? w.slipRatioInstant : -w.slipRatioInstant;
        // korekta: przy przekroczeniu progu dodatkowo zmniejsz moment, potem odbuduj
        if (sl < -target * 1.25) w.absFactor = Math.max(0.3, w.absFactor - 25 * h);
        else w.absFactor = Math.min(1, w.absFactor + 6 * h);
      } else {
        w.absFactor = Math.min(1, w.absFactor + 10 * h);
      }
    }
    if (lvl > 0) {
      const [fl, fr, rl, rr] = W;
      const r = Math.min(rl.absLimit * rl.absFactor, rr.absLimit * rr.absFactor);
      rl.absLimit = rr.absLimit = r;
      rl.absFactor = rr.absFactor = 1;
      const a = fl.absLimit * fl.absFactor, b = fr.absLimit * fr.absFactor;
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const m = Math.max(a, b) - Math.min(a, b);
        const lim = 0.25 * Math.max(a, b);
        if (m > lim) {
          if (a > b) fl.absLimit = (b + lim) / fl.absFactor; else fr.absLimit = (a + lim) / fr.absFactor;
        }
      }
    }
  }

  _applySteer(delta) {
    const L = this.cfg.wheelbase;
    const t = this.cfg.trackWidth.front;
    const ack = this.cfg.steering.ackermann;
    const fl = this.wheels[0];
    const fr = this.wheels[1];
    const ad = Math.abs(delta);
    if (ad < 1e-5) {
      fl.steer = 0; fr.steer = 0;
      return;
    }
    const R = L / Math.tan(ad);
    const inner = Math.atan(L / (R - t / 2));
    const outer = Math.atan(L / (R + t / 2));
    const di = ad + ack * (inner - ad);
    const dout = ad + ack * (outer - ad);
    if (delta > 0) { fl.steer = di; fr.steer = dout; } else { fl.steer = -dout; fr.steer = -di; }
  }

  forwardSpeed() {
    _az.set(0, 0, 1).applyQuaternion(this.quat);
    return this.vel.dot(_az);
  }

  // ------------------------------------------------------------------ glowny krok
  step(dt) {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this._controlLogic(dt);
    const n = PHYSICS.substeps;
    const h = dt / n;
    this.trackIndex = this.surface.locate(this.pos.x, this.pos.z, this.trackIndex);
    for (let i = 0; i < n; i++) this._substep(h);
    this._bodyGroundContacts();
    this._barrierCollisions();
    this.trackIndex = this.surface.locate(this.pos.x, this.pos.z, this.trackIndex);
    this.time += dt;
    this._updateTelemetry(dt);
  }

  _axes() {
    const q = this.quat;
    _ax.set(1, 0, 0).applyQuaternion(q);
    _ay.set(0, 1, 0).applyQuaternion(q);
    _az.set(0, 0, 1).applyQuaternion(q);
  }

  _addForceAt(F, point) {
    _F.add(F);
    _r.subVectors(point, this.pos);
    _T.add(_tmp.crossVectors(_r, F));
  }

  _substep(h) {
    const cfg = this.cfg;
    const g = PHYSICS.gravity;
    const m = this.mass;
    this._axes();
    _F.set(0, -m * g, 0);
    _T.set(0, 0, 0);

    // ---------------- aerodynamika
    const A = cfg.aero;
    const speed = this.vel.length();
    const vF = this.vel.dot(_az);
    if (speed > 0.1) {
      const q = 0.5 * A.airDensity;
      const drag = _f.copy(this.vel).multiplyScalar(-q * A.dragArea * speed);
      _p.copy(this.pos).addScaledVector(_ay, A.dragHeight);
      this._addForceAt(drag, _p);
      const vf2 = vF * vF;
      const a = cfg.cgToFrontAxle;
      const b = cfg.wheelbase - a;
      _f.copy(_ay).multiplyScalar(-q * A.liftAreaFront * vf2);
      _p.copy(this.pos).addScaledVector(_az, a);
      this._addForceAt(_f, _p);
      _f.copy(_ay).multiplyScalar(-q * A.liftAreaRear * vf2);
      _p.copy(this.pos).addScaledVector(_az, -b);
      this._addForceAt(_f, _p);
    }

    // ---------------- zawieszenie: pozycje i ugiecia
    const wheels = this.wheels;
    for (const w of wheels) {
      _p.copy(w.mount).applyQuaternion(this.quat).add(this.pos);
      w._mx = _p.x; w._my = _p.y; w._mz = _p.z;
      this.surface.sample(_p.x, _p.z, this.trackIndex, _sample);
      const nx = _sample.nx, ny = _sample.ny, nz = _sample.nz;
      // promien w kierunku -ay
      const denom = -(nx * _ay.x + ny * _ay.y + nz * _ay.z);
      w.surface = _sample.type;
      w.trackLateral = _sample.lateral;
      w.groundHeight = _sample.height;
      w.normal.set(nx, ny, nz);
      let t = -1;
      if (denom < -0.3) t = (ny * (_sample.height - _p.y)) / denom;
      const len = t - w.radius;
      w.wasContact = w.contact;
      if (t < 0 || len > w.maxLength) {
        w.contact = false;
        w.length = w.maxLength;
        w.prevLength = w.maxLength;
        w.compVel = 0;
      } else {
        w.contact = true;
        w.length = Math.max(len, w.minLength - 0.04);
        if (!w.wasContact) w.prevLength = w.length;
        w.compVel = (w.prevLength - w.length) / h;
        w.prevLength = w.length;
        w.contactPoint.set(_p.x - _ay.x * t, _p.y - _ay.y * t, _p.z - _ay.z * t);
      }
    }

    // ---------------- sily zawieszenia (sprezyna, odbojnik, tlumik, stabilizator)
    for (let axle = 0; axle < 2; axle++) {
      const L = wheels[axle * 2];
      const R = wheels[axle * 2 + 1];
      const dL = L.lengthStatic - L.length;
      const dR = R.lengthStatic - R.length;
      const arb = L.sus.antiRollRate * (dL - dR);
      for (const w of [L, R]) {
        if (!w.contact) { w.fz = 0; continue; }
        const s = w.sus;
        let f = s.springRate * Math.max(0, w.restLength - w.length);
        if (w.length < w.minLength) {
          const d = w.minLength - w.length;
          f += s.bumpStopRate * d * (1 + d / 0.01);
        }
        const v = w.compVel;
        const av = Math.abs(v);
        const slow = v > 0 ? s.damperBump : s.damperRebound;
        const fast = v > 0 ? s.damperBumpFast : s.damperReboundFast;
        let fd = av < s.damperKnee ? slow * av : slow * s.damperKnee + fast * (av - s.damperKnee);
        fd = Math.min(fd, 20000) * Math.sign(v);
        f += fd + (w === L ? arb : -arb);
        w.fz = Math.max(0, f);
      }
    }

    // ---------------- opony
    const inp = this.input;
    const bc = cfg.brakes;
    const brakeCmd = this._brakeCmd || 0;
    this._updateABS(h, brakeCmd);
    const tc = cfg.tyres;
    for (const w of wheels) {
      // kierunek kola
      const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
      _f.set(_az.x * cs + _ax.x * sn, _az.y * cs + _ax.y * sn, _az.z * cs + _ax.z * sn);
      const nrm = w.normal;
      _f.addScaledVector(nrm, -_f.dot(nrm)).normalize();
      _s.crossVectors(nrm, _f);
      // predkosc punktu styku
      const cp = w.contact ? w.contactPoint : _p.set(w._mx, w._my - w.length - w.radius, w._mz);
      _r.subVectors(cp, this.pos);
      _vc.crossVectors(this.angVel, _r).add(this.vel);
      const vx = _vc.dot(_f);
      const vy = _vc.dot(_s);
      w.vx = vx;
      w.vy = vy;
      w.slipRatioInstant = (w.omega * w.radius - vx) / Math.max(Math.abs(vx), 3);

      // hamulec + ABS
      let maxT = w.isFront ? bc.maxTorqueFront : bc.maxTorqueRear;
      if (this.settings.brakeBias != null) {
        const total = bc.maxTorqueFront + bc.maxTorqueRear;
        maxT = (w.isFront ? this.settings.brakeBias : 1 - this.settings.brakeBias) * total;
      }
      const pedalT = brakeCmd * maxT;
      const absT = w.absLimit * w.absFactor;
      w.brakeTorque = Math.min(pedalT, absT) + (!w.isFront ? inp.handbrake * bc.handbrakeTorque : 0);
      w.absActive = absT < pedalT;

      if (!w.contact) {
        w.fx = 0; w.fy = 0; w.slip = 0; w.roadTorque = 0; w.slideSpeed = 0;
        w.kappa *= Math.exp(-h / 0.02);
        w.sy *= Math.exp(-h / 0.02);
        continue;
      }
      // stany poslizgu z relaksacja (calkowanie wykladnicze: stabilne przy kazdej predkosci)
      const avx = Math.abs(vx);
      const ax = avx / tc.relaxationLong;
      const bx = (w.omega * w.radius - vx) / tc.relaxationLong;
      const ex = Math.exp(-ax * h);
      w.kappa = w.kappa * ex + (ax > 1e-6 ? (bx * (1 - ex)) / ax : bx * h);
      w.kappa = clamp(w.kappa, -1.2, 4);
      const ay = avx / tc.relaxationLat;
      const by = -vy / tc.relaxationLat;
      const ey = Math.exp(-ay * h);
      w.sy = w.sy * ey + (ay > 1e-6 ? (by * (1 - ey)) / ay : by * h);
      w.sy = clamp(w.sy, -4, 4);

      const sp = SURFACE_PROPS[w.surface] || SURFACE_PROPS[SURF.ASPHALT];
      this.tyre.forces(w.fz, w.kappa, w.sy, sp.grip * w.grip, _tyreOut);
      let fx = _tyreOut.fx;
      let fy = _tyreOut.fy;
      w.slip = _tyreOut.slip;
      // tlumienie przy bardzo malych predkosciach (model relaksacji nie ma wtedy wlasnego tlumienia):
      // bocznie - stabilnosc postoju, wzdluznie - brak oscylacji kola przy ruszaniu
      const lowBlend = Math.max(0, 1 - avx / 2.5);
      if (lowBlend > 0) {
        fy -= vy * w.fz * 0.25 * lowBlend;
        const vs = w.omega * w.radius - vx;
        const fxd = vs * w.fz * 0.12 * lowBlend;
        const fxLim = _tyreOut.mu * w.fz;
        fx = clamp(fx + fxd, -fxLim, fxLim);
      }
      w.fx = fx;
      w.fy = fy;
      w.roadTorque = -fx * w.radius;
      w.slideSpeed = Math.hypot(w.omega * w.radius - vx, vy);

      // opor toczenia (+ "wciaganie" przez zwir/trawe; rosnie z predkoscia - orka w zwirze,
      // przy malej predkosci da sie wolno wyjechac)
      const plough = sp.rollRes * Math.min(1, 0.3 + avx / 15);
      const rr = (tc.rollingResistance + plough) * w.fz * clamp(vx * 2, -1, 1);

      // sily na nadwozie: zawieszenie wzdluz osi +Y nadwozia, opona w plaszczyznie nawierzchni
      _tmp2.copy(_ay).multiplyScalar(w.fz);
      _tmp2.addScaledVector(_f, fx - rr);
      _tmp2.addScaledVector(_s, fy);
      this._addForceAt(_tmp2, w.contactPoint);
    }

    // ---------------- obroty kol: tyl przez uklad napedowy, przod swobodnie
    const dtn = this.drivetrain;
    const rl = wheels[2];
    const rr = wheels[3];
    dtn.update(h, this._throttleCmd || 0, rl, rr, this.settings.tcLevel);
    for (const w of wheels) {
      if (w.isFront) w.omega += (h * w.roadTorque) / w.inertia;
      // hamulec jako tarcie Coulomba (bez przechodzenia przez zero)
      const Ieff = w.isFront ? w.inertia : dtn.rearEffectiveInertia(w.inertia);
      const dw = (w.brakeTorque * h) / Ieff;
      if (Math.abs(w.omega) <= dw) w.omega = 0;
      else w.omega -= Math.sign(w.omega) * dw;
      w.spin += w.omega * h;
    }
    dtn.syncEngineToWheels((rl.omega + rr.omega) * 0.5);

    // ---------------- calkowanie bryly sztywnej (pol-niejawny Euler)
    this.vel.addScaledVector(_F, h / m);
    // przejscie do ukladu nadwozia dla rownania Eulera
    _q.copy(this.quat).invert();
    _wb.copy(this.angVel).applyQuaternion(_q);
    _tmp.copy(_T).applyQuaternion(_q);
    const I = this.inertia;
    const Lx = I.x * _wb.x, Ly = I.y * _wb.y, Lz = I.z * _wb.z;
    // tau - w x (I w)
    const gx = _wb.y * Lz - _wb.z * Ly;
    const gy = _wb.z * Lx - _wb.x * Lz;
    const gz = _wb.x * Ly - _wb.y * Lx;
    _wb.x += ((_tmp.x - gx) * h) / I.x;
    _wb.y += ((_tmp.y - gy) * h) / I.y;
    _wb.z += ((_tmp.z - gz) * h) / I.z;
    this.angVel.copy(_wb).applyQuaternion(this.quat);
    this.pos.addScaledVector(this.vel, h);
    this._integrateRotation(h);
  }

  _integrateRotation(h) {
    const w = this.angVel;
    const q = this.quat;
    const hx = 0.5 * h * w.x, hy = 0.5 * h * w.y, hz = 0.5 * h * w.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    q.set(
      qx + hx * qw + hy * qz - hz * qy,
      qy + hy * qw + hz * qx - hx * qz,
      qz + hz * qw + hx * qy - hy * qx,
      qw - hx * qx - hy * qy - hz * qz,
    );
    q.normalize();
  }

  // ------------------------------------------------------------------ kontakty / kolizje
  _worldInvInertiaMul(v, out) {
    // out = R * diag(invI) * R^T * v
    _q.copy(this.quat).invert();
    out.copy(v).applyQuaternion(_q);
    out.x *= this.invInertia.x;
    out.y *= this.invInertia.y;
    out.z *= this.invInertia.z;
    return out.applyQuaternion(this.quat);
  }

  /** impuls w punkcie r (wzgledem srodka ciezkosci) wzdluz normalnej n z tarciem */
  _impulse(r, n, restitution, friction) {
    _vc.crossVectors(this.angVel, r).add(this.vel);
    const vn = _vc.dot(n);
    if (vn >= 0) return 0;
    const rn = _tmp.crossVectors(r, n);
    const k = 1 / this.mass + this._worldInvInertiaMul(rn, _tmp2).cross(r).dot(n);
    const jn = (-(1 + restitution) * vn) / k;
    _f.copy(n).multiplyScalar(jn);
    // tarcie
    const vt = _s.copy(_vc).addScaledVector(n, -vn);
    const vtl = vt.length();
    if (vtl > 1e-4) {
      vt.multiplyScalar(1 / vtl);
      const rt = _tmp.crossVectors(r, vt);
      const kt = 1 / this.mass + this._worldInvInertiaMul(rt, _tmp2).cross(r).dot(vt);
      const jt = Math.min(vtl / kt, friction * jn);
      _f.addScaledVector(vt, -jt);
    }
    this.vel.addScaledVector(_f, 1 / this.mass);
    _tmp.crossVectors(r, _f);
    this.angVel.add(this._worldInvInertiaMul(_tmp, _tmp2));
    return -vn;
  }

  _bodyGroundContacts() {
    let impact = 0;
    for (const bp of this.groundPoints) {
      _r.copy(bp).applyQuaternion(this.quat);
      _p.copy(_r).add(this.pos);
      this.surface.sample(_p.x, _p.z, this.trackIndex, _sample);
      const pen = _sample.height - _p.y;
      if (pen > 0) {
        _n.set(_sample.nx, _sample.ny, _sample.nz);
        const v = this._impulse(_r, _n, 0.05, 0.55);
        impact = Math.max(impact, v);
        this.pos.addScaledVector(_n, pen * 0.8);
      }
    }
    if (impact > 2.5) this._registerImpact(impact);
  }

  _barrierCollisions() {
    let impact = 0;
    for (const bp of this.bodyPoints) {
      _r.copy(bp).applyQuaternion(this.quat);
      _p.copy(_r).add(this.pos);
      if (!this.surface.collide(_p.x, _p.z, this.trackIndex, _hit)) continue;
      _n.set(_hit.nx, 0, _hit.nz);
      const v = this._impulse(_r, _n, 0.22, 0.35);
      impact = Math.max(impact, v);
      this.pos.addScaledVector(_n, _hit.pen);
    }
    if (impact > 0.5) this._registerImpact(impact);
  }

  _registerImpact(v) {
    this.lastImpact = v;
    this.impactCount++;
  }

  // ------------------------------------------------------------------ telemetria
  _updateTelemetry(dt) {
    const t = this.telemetry;
    const dtn = this.drivetrain;
    this._axes();
    const acc = _tmp.subVectors(this.vel, this._prevVel).multiplyScalar(1 / dt);
    this._prevVel.copy(this.vel);
    this._accelSmooth.lerp(acc, Math.min(1, dt / 0.08));
    t.speed = this.vel.length();
    t.forwardSpeed = this.vel.dot(_az);
    t.speedKmh = Math.abs(t.forwardSpeed) * 3.6;
    t.rpm = dtn.rpm;
    t.gear = dtn.isShifting ? dtn.shiftTarget : dtn.gear;
    t.throttle = this._throttleCmd || 0;
    t.brake = this._brakeCmd || 0;
    t.steerAngle = this.steerAngle;
    t.absActive = this.wheels.some((w) => w.absActive);
    t.tcActive = dtn.tcActive;
    t.longG = this._accelSmooth.dot(_az) / PHYSICS.gravity;
    t.latG = this._accelSmooth.dot(_ax) / PHYSICS.gravity;
    t.shifting = dtn.isShifting;
    t.limiter = dtn.limiterOn;
    let off = 0, curb = 0;
    for (const w of this.wheels) {
      if (!(SURFACE_PROPS[w.surface] || {}).onTrack) off++;
      if (w.surface === SURF.CURB) curb++;
    }
    t.offTrackWheels = off;
    t.curbWheels = curb;
    t.upsideDown = _ay.y < 0.2;
    t.impact = this.lastImpact;
    t.impactCount = this.impactCount;
  }
}
