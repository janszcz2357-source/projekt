// Pomiar czasu okrazen: linia startu/mety, 3 sektory, punkty kontrolne, limity toru.
//  * Przeciecie linii wykrywane na podstawie odleglosci wzdluz toru (s) z interpolacja czasu
//    miedzy krokami fizyki (dokladnosc << 1 ms).
//  * Okrazenie jest wazne tylko, gdy auto minelo wszystkie punkty kontrolne po kolei
//    i nigdy nie mialo wszystkich 4 kol poza torem (krawezniki = tor).
//  * Reset auta w trakcie okrazenia uniewaznia je.

export class LapTimer {
  constructor(track) {
    this.track = track;
    this.L = track.length;
    this.sectorStarts = track.sectorStarts;
    this.checkpoints = track.checkpoints;
    this.listeners = [];
    this.reset();
  }

  on(fn) {
    this.listeners.push(fn);
  }

  _emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  reset() {
    this.time = 0; // czas sesji
    this.prevS = null;
    this.lapActive = false;
    this.lapStart = 0;
    this.lapNumber = 0;
    this.valid = true;
    this.invalidReason = '';
    this.sector = 0;
    this.sectorStart = 0;
    this.sectorTimes = [null, null, null];
    this.lastSectorTimes = [null, null, null];
    this.bestSectors = [null, null, null];
    this.nextCheckpoint = 0;
    this.lastLap = null;
    this.lastLapValid = true;
    this.bestLap = null;
    this.laps = [];
    this.trace = []; // czas co 10 m w biezacym okrazeniu
    this.bestTrace = null;
    this.offTrackTime = 0;
  }

  get currentLapTime() {
    return this.lapActive ? this.time - this.lapStart : 0;
  }

  invalidate(reason) {
    if (!this.lapActive || !this.valid) return;
    this.valid = false;
    this.invalidReason = reason;
    this._emit({ type: 'invalid', reason });
  }

  /** wywolywane po kazdym kroku fizyki */
  update(dt, vehicle) {
    const prevTime = this.time;
    this.time += dt;
    const d = this.track.distanceAlong(vehicle.pos.x, vehicle.pos.z, vehicle.trackIndex);
    const s = d.s;
    const L = this.L;
    if (this.prevS == null) {
      this.prevS = s;
      return;
    }
    const ps = this.prevS;
    let ds = s - ps;
    if (ds < -L / 2) ds += L;
    if (ds > L / 2) ds -= L;
    // przeciecie linii mety do przodu
    if (ps > L - 150 && s < 150 && ds > 0) {
      const frac = (L - ps) / ds;
      this._crossFinish(prevTime + dt * frac);
    } else if (ps < 150 && s > L - 150 && ds < 0) {
      // cofanie sie przez linie
      this.invalidate('jazda pod prąd przez linię mety');
    }
    if (this.lapActive) {
      // sektory
      for (let k = 1; k < 3; k++) {
        const ss = this.sectorStarts[k];
        if (this.sector === k - 1 && ps < ss && s >= ss && ds > 0 && ds < 50) {
          const tc = prevTime + dt * ((ss - ps) / ds);
          this._completeSector(k - 1, tc);
        }
      }
      // punkty kontrolne
      if (this.nextCheckpoint < this.checkpoints.length) {
        const cs = this.checkpoints[this.nextCheckpoint];
        if (ps < cs && s >= cs && ds > 0 && ds < 50) this.nextCheckpoint++;
      }
      // slad czasu co 10 m (do roznicy wzgledem najlepszego okrazenia)
      const bin = Math.floor(s / 10);
      if (ds > 0 && bin > this.trace.length - 1 && bin < L / 10 + 1) {
        while (this.trace.length <= bin) this.trace.push(this.time - this.lapStart);
      }
      // limity toru
      if (vehicle.telemetry.offTrackWheels >= 4) {
        this.offTrackTime += dt;
        if (this.offTrackTime > 0.05) this.invalidate('wszystkie koła poza torem');
      } else {
        this.offTrackTime = 0;
      }
    }
    this.prevS = s;
  }

  _completeSector(k, t) {
    const st = t - this.sectorStart;
    this.sectorTimes[k] = st;
    this.sectorStart = t;
    this.sector = k + 1;
    let best = false;
    if (this.valid && (this.bestSectors[k] == null || st < this.bestSectors[k])) {
      this.bestSectors[k] = st;
      best = true;
    }
    this._emit({ type: 'sector', sector: k, time: st, best, valid: this.valid });
  }

  _crossFinish(t) {
    if (this.lapActive) {
      this._completeSector(2, t);
      const lapTime = t - this.lapStart;
      let valid = this.valid;
      let reason = this.invalidReason;
      if (this.nextCheckpoint < this.checkpoints.length) {
        valid = false;
        reason = 'pominięte punkty kontrolne';
      }
      const lap = { number: this.lapNumber, time: lapTime, valid, reason, sectors: this.sectorTimes.slice() };
      this.laps.push(lap);
      this.lastLap = lapTime;
      this.lastLapValid = valid;
      this.lastSectorTimes = this.sectorTimes.slice();
      let best = false;
      if (valid && (this.bestLap == null || lapTime < this.bestLap)) {
        this.bestLap = lapTime;
        this.bestTrace = this.trace.slice();
        best = true;
      }
      this._emit({ type: 'lap', lap, best });
    }
    this.lapActive = true;
    this.lapNumber++;
    this.lapStart = t;
    this.sectorStart = t;
    this.sector = 0;
    this.sectorTimes = [null, null, null];
    this.valid = true;
    this.invalidReason = '';
    this.nextCheckpoint = 0;
    this.trace = [0];
    this.offTrackTime = 0;
    this._emit({ type: 'lapStart', number: this.lapNumber });
  }

  /** roznica do najlepszego okrazenia w biezacym miejscu toru [s] (null gdy brak) */
  delta(referenceTrace = this.bestTrace) {
    if (!this.lapActive || !referenceTrace || this.trace.length < 2) return null;
    const i = this.trace.length - 1;
    if (i >= referenceTrace.length) return null;
    return this.trace[i] - referenceTrace[i];
  }

  /** wywolywane przy resecie auta przez gracza */
  carReset() {
    this.invalidate('reset samochodu');
    this.prevS = null;
  }
}
