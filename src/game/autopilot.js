// Kierowca automatyczny (testy, tlo menu): podaza za linia wyscigowa i profilem predkosci.
// Steruje WYLACZNIE przez te same wejscia co gracz (kierownica, gaz, hamulec).
//
// Sterowanie poprzeczne: krzywizna = krzywizna linii (sprzezenie w przod) + korekta bledu bocznego
// i kursowego (zlinearyzowany pure-pursuit), ograniczona do tego, na co pozwala przyczepnosc,
// plus sprzezenie od predkosci odchylenia (tlumienie poslizgu).

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Autopilot {
  constructor(track, vehicle, { pace = 0.9, consistency = 0 } = {}) {
    this.track = track;
    this.vehicle = vehicle;
    this.pace = pace;
    // ruch w wyscigu (ustawiane przez dyrektora wyscigu): przesuniecie od linii wyscigowej i limit predkosci
    this.offset = 0;
    this.offsetTarget = 0;
    this.speedCap = Infinity;
    this.consistency = consistency; // amplituda wolnozmiennego rozrzutu tempa (np. 0.015 = +-1.5%)
    this._noise = 0;
    this._noiseT = 0;
    this._steer = 0;
    this._thr = 0;
    this._brk = 0;
    this._braking = false;
  }

  update(dt) {
    const v = this.vehicle;
    const t = this.track;
    const d = t.distanceAlong(v.pos.x, v.pos.z, v.trackIndex);
    const i = d.index;
    const speed = Math.max(0, v.forwardSpeed());
    const vs = Math.max(speed, 4);

    // osie auta
    const q = v.quat;
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    // kierunek ruchu (przy malej predkosci - kierunek auta)
    let mx = v.vel.x, mz = v.vel.z;
    const ml = Math.hypot(mx, mz);
    if (ml < 3) { mx = fx; mz = fz; } else { mx /= ml; mz /= ml; }

    // przesuniecie od linii (wyprzedzanie/unikanie) - plynna zmiana toru jazdy, w granicach toru
    this.offset += clamp(this.offsetTarget - this.offset, -2.2 * dt, 2.2 * dt);
    const latTarget = clamp(t.raceLat[i] + this.offset, -t.wR[i] + 1.35, t.wL[i] - 1.35);
    // blad boczny wzgledem linii wyscigowej (+ = auto na lewo od linii)
    const eLat = d.lateral - latTarget;
    // blad kursu (+ = auto skierowane w lewo wzgledem linii); lewa normalna linii = (rz, -rx)
    const rx = t.raceTx[i], rz = t.raceTz[i];
    const eH = Math.atan2(mx * rz - mz * rx, mx * rx + mz * rz);

    // krzywizna linii z lekkim wyprzedzeniem
    const preview = Math.round((speed * 0.12) / 2.5);
    const kff = t.raceCurvSigned[t.idx(i + preview)];
    const Lp = 7 + 0.5 * vs;
    let kCmd = kff + (2 * (-eLat - eH * Lp)) / (Lp * Lp);
    const kMax = (1.55 * 9.81) / (vs * vs);
    kCmd = clamp(kCmd, -kMax, kMax);
    const L = v.cfg.wheelbase;
    let delta = Math.atan(L * kCmd); // + = lewo
    if (Math.abs(eLat) > 4 || Math.abs(eH) > 0.6) {
      // daleko od linii (np. po wyjezdzie): klasyczny pure-pursuit do punktu na linii
      const ahead = Math.round((10 + speed * 0.5) / 2.5);
      const j = t.idx(i + ahead);
      const tx = t.px[j] + t.nx[j] * t.raceLat[j] - v.pos.x;
      const tz = t.pz[j] + t.nz[j] * t.raceLat[j] - v.pos.z;
      const lx = 1 - 2 * (q.y * q.y + q.z * q.z), lz = 2 * (q.x * q.z - q.w * q.y);
      const zl = tx * fx + tz * fz, xl = tx * lx + tz * lz;
      const alpha = Math.atan2(xl, zl);
      delta = clamp(Math.atan((2 * L * Math.sin(alpha)) / Math.hypot(xl, zl)), -0.4, 0.4);
    }
    // sprzezenie od predkosci odchylenia
    const yawDes = kCmd * speed;
    delta += 0.06 * (yawDes - v.angVel.y);
    const maxA = (v.cfg.steering.maxWheelAngleDeg * Math.PI) / 180;
    const steerCmd = clamp(-delta / maxA, -1, 1);
    this._steer += (steerCmd - this._steer) * Math.min(1, dt / 0.02);

    // predkosc docelowa: minimum profilu na najblizszym odcinku (antycypacja hamowania)
    let vt = Infinity;
    const ahead = Math.round((5 + speed * 0.14) / 2.5);
    for (let k = 0; k <= ahead; k++) vt = Math.min(vt, t.speedProfile[t.idx(i + k)]);
    // rozrzut tempa (kierowcy nie jezdza idealnie powtarzalnie)
    if (this.consistency > 0) {
      this._noiseT -= dt;
      if (this._noiseT <= 0) { this._noiseT = 2 + Math.random() * 3; this._noiseTarget = (Math.random() * 2 - 1) * this.consistency; }
      this._noise += ((this._noiseTarget || 0) - this._noise) * Math.min(1, dt * 0.5);
    }
    vt *= this.pace * (1 + this._noise);
    // poza linia wyscigowa: ciasniejszy luk -> wolniej w zakretach
    const offLine = Math.abs(latTarget - t.raceLat[i]);
    vt *= 1 - Math.min(0.14, offLine * t.raceCurv[t.idx(i + ahead)] * 4);
    // ruch na torze (auto z przodu)
    vt = Math.min(vt, this.speedCap);
    // poza linia - zwolnij
    vt *= clamp(1 - Math.max(0, Math.abs(eLat) - 1.5) * 0.08, 0.6, 1);
    const err = vt - speed;
    let throttle = 0, brake = 0;
    // gaz ograniczony wykorzystaniem przyczepnosci bocznej (z dociskiem rosnacym z predkoscia),
    // jak u kierowcy: pelny gaz dopiero przy prostowaniu kol (elipsa tarcia)
    const aLatMax = 1.45 * (9.81 + 0.00118 * speed * speed);
    const latUse = clamp((Math.abs(kCmd) * speed * speed) / aLatMax, 0, 1);
    const cap = clamp(0.2 + 1.1 * Math.sqrt(1 - latUse * latUse), 0.25, 1);
    // histereza hamuj/gaz (bez przelaczania co krok)
    if (this._braking && err > -0.3) this._braking = false;
    else if (!this._braking && err < -1.6) this._braking = true;
    if (this._braking) brake = clamp(0.15 - err * 0.22, 0, 1) * clamp(1.15 - latUse * 0.6, 0.35, 1);
    else throttle = Math.min(cap, clamp(0.3 + err * 0.35, 0, 1));
    // plynne pedaly (jak u czlowieka)
    this._thr += clamp(throttle - this._thr, -8 * dt, 5 * dt);
    this._brk += clamp(brake - this._brk, -8 * dt, 8 * dt);
    v.input.steer = this._steer;
    v.input.throttle = this._thr;
    v.input.brake = this._brk;
    v.input.handbrake = 0;
  }
}
