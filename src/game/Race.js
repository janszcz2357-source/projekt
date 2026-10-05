// Wyscig z kierowcami AI: pole startowe, start zatrzymany, liczenie okrazen, pozycje i straty,
// zachowanie w ruchu (jazda za autem, wyprzedzanie, odstep przy jezdzie obok siebie, niebieskie flagi),
// kolizje miedzy autami i meta (flaga w szachownice po zwyciezcy).
//
// Modul nie zalezy od grafiki - ten sam kod dziala w grze i w testach (Node).
import { Vehicle } from '../physics/Vehicle.js';
import { Autopilot } from './autopilot.js';
import { collideVehicles } from '../physics/carCollisions.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// fikcyjni kierowcy (nazwiska wymyslone)
export const AI_DRIVERS = [
  { name: 'M. Kowalczyk', number: 7, paint: 0x1747a6 },
  { name: 'L. Ferrand', number: 11, paint: 0xf26a10 },
  { name: 'J. Hartley-Moss', number: 4, paint: 0x0d4d32 },
  { name: 'A. Rinaldi', number: 63, paint: 0xe9eaec },
  { name: 'K. Novak', number: 22, paint: 0xf2c200 },
  { name: 'T. Brandt', number: 88, paint: 0x121316 },
  { name: 'S. Okafor', number: 31, paint: 0x6a1b9a },
  { name: 'D. Lindqvist', number: 14, paint: 0x00838f },
  { name: 'R. Esteban', number: 55, paint: 0xc62828 },
  { name: 'H. Tanaka', number: 9, paint: 0x9aa0a8 },
  { name: 'P. Dubois', number: 70, paint: 0x2e7d32 },
  { name: 'E. Marsh', number: 42, paint: 0xad1457 },
  { name: 'V. Petrov', number: 3, paint: 0x283593 },
  { name: 'N. Costa', number: 19, paint: 0xef6c00 },
  { name: 'B. Walsh', number: 26, paint: 0x4e342e },
];

/** zakresy tempa AI (ulamek predkosci z profilu toru) dla poziomow trudnosci */
export const DIFFICULTY = {
  easy: { name: 'Łatwy', min: 0.84, max: 0.89 },
  medium: { name: 'Średni', min: 0.885, max: 0.935 },
  hard: { name: 'Trudny', min: 0.93, max: 0.975 },
};
const PACE_LIMIT = 0.985; // powyzej AI zaczyna wypadac z toru na Spa (zmierzone)

/** deterministyczny generator (powtarzalne stawki w testach) */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** stawka AI: n kierowcow z tempem z zakresu poziomu trudnosci */
export function makeField(n, difficulty = 'medium', seed = Date.now()) {
  const R = rng(seed);
  const D = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  const pool = AI_DRIVERS.slice();
  const out = [];
  for (let k = 0; k < n && pool.length; k++) {
    const d = pool.splice(Math.floor(R() * pool.length), 1)[0];
    out.push({ ...d, pace: D.min + (D.max - D.min) * R(), consistency: 0.006 + R() * 0.012, aggression: R() });
  }
  return out;
}

/** szacowany czas okrazenia AI o danym tempie (z profilu predkosci; zgodnosc z pomiarem ~1.5%) */
export function estimateLapTime(track, pace) {
  if (!track._profileTime) {
    let T = 0;
    for (let i = 0; i < track.n; i++) T += (track.s[i + 1] - track.s[i]) / track.speedProfile[i];
    track._profileTime = T;
  }
  return track._profileTime * (1.06 + 0.55 * (1 / pace - 1));
}

/**
 * pole startowe gracza wg jego najlepszego czasu (lub null) na tle szacowanych czasow AI;
 * field - stawka w kolejnosci startowej (najszybsi z przodu)
 */
export function gridFromLapTime(track, field, best) {
  if (best == null) return field.length; // brak czasu - start z konca stawki
  let k = 0;
  while (k < field.length && estimateLapTime(track, field[k].pace) < best) k++;
  return k;
}

/** kolejnosc na starcie jak po kwalifikacjach: wg tempa z losowym rozrzutem */
export function qualifyingOrder(field, random = Math.random, spread = 0.012) {
  return field
    .map((f) => ({ f, q: f.pace + (random() * 2 - 1) * spread }))
    .sort((a, b) => b.q - a.q)
    .map((x) => x.f);
}

const SLOT = 8; // odstep miedzy polami startowymi [m]

export class Race {
  /**
   * @param track Track
   * @param opts.player Vehicle gracza (null - wyscig samych AI, np. testy)
   * @param opts.opponents [{ name, number, paint, pace, consistency, cfg? }]
   * @param opts.laps liczba okrazen
   * @param opts.playerGrid pole startowe gracza (0 = pole position); domyslnie ostatnie
   * @param opts.aiCfg konfiguracja auta AI
   */
  constructor(track, { player = null, playerName = 'Ty', playerNumber = 27, playerPaint = null, opponents = [], laps = 3, playerGrid = null, aiCfg, random = Math.random } = {}) {
    this.track = track;
    this.L = track.length;
    this.laps = laps;
    this.random = random;
    this.time = 0; // czas od zielonego swiatla
    this.started = false;
    this.leaderFinished = false;
    this.finishCount = 0;
    this.contacts = 0;
    this.cars = [];
    const n = opponents.length + (player ? 1 : 0);
    const pg = player ? clamp(playerGrid ?? n - 1, 0, n - 1) : -1;
    let ai = 0;
    for (let slot = 0; slot < n; slot++) {
      let c;
      if (slot === pg) {
        c = this._entry({ name: playerName, number: playerNumber, paint: playerPaint, isPlayer: true, vehicle: player });
      } else {
        const o = opponents[ai++];
        const v = new Vehicle(o.cfg || aiCfg, track);
        Object.assign(v.settings, { absLevel: 2, tcLevel: 2, autoGearbox: true });
        c = this._entry({ ...o, isPlayer: false, vehicle: v });
        c.ai = new Autopilot(track, v, { pace: Math.min(o.pace, PACE_LIMIT - 0.01), consistency: o.consistency || 0, random });
        c.basePace = c.ai.pace;
      }
      c.grid = slot;
      this.cars.push(c);
    }
    this.player = this.cars.find((c) => c.isPlayer) || null;
    // ciasny zakret (szykana, nawrot) w ciagu najblizszych ~70 m - tam nie jedzie sie obok siebie
    const nT = track.n, look = Math.round(100 / (track.length / nT));
    // oraz szybki zakret (Eau Rouge, Copse...) w ciagu ~120 m - tam nie zaczyna sie wyprzedzania
    const look2 = Math.round(120 / (track.length / nT));
    this.tightAhead = new Uint8Array(nT);
    this.cornerAhead = new Uint8Array(nT);
    for (let k = 0; k < nT; k++) {
      let m = 0, m2 = 0;
      for (let j = 0; j <= look2; j++) {
        const kk = track.raceCurv[(k + j) % nT];
        if (j <= look) m = Math.max(m, kk);
        m2 = Math.max(m2, kk);
      }
      this.tightAhead[k] = m > 1 / 45 ? 1 : 0;
      this.cornerAhead[k] = m2 > 1 / 110 ? 1 : 0;
    }
    this._binOffset = n * SLOT + 60;
    const bins = Math.ceil((laps * this.L + this._binOffset + 400) / 10);
    for (const c of this.cars) c.trace = new Float32Array(bins).fill(-1);
    this.placeOnGrid();
  }

  _entry(o) {
    return {
      name: o.name, number: o.number, paint: o.paint, isPlayer: o.isPlayer, vehicle: o.vehicle, ai: null,
      grid: 0, prog: 0, prevS: 0, s: 0, lat: 0, idx: 0, speed: 0, acc: 0,
      lapsDone: 0, lapStart: 0, lapTimes: [], lastLap: null, bestLap: null,
      finished: false, finishTime: null, finishOrder: 0, estimated: false, position: 0,
      // stan AI w ruchu
      passSide: 0, passT: 0, blockedT: 0, laneT: 0, blueT: 0, stuckT: 0, react: 0, retired: false,
    };
  }

  /** ustawia auta na polach startowych (dwie kolumny, przesuniete o pol pola) */
  placeOnGrid() {
    const t = this.track;
    const startIdx = t.gridIndex; // ~12 m przed linia
    const ds = t.ds || t.length / t.n;
    this.time = 0;
    this.started = false;
    this.leaderFinished = false;
    this.finishCount = 0;
    for (const c of this.cars) {
      const back = c.grid * SLOT;
      const i = t.idx(startIdx - Math.round(back / ds));
      const w = Math.min(t.wL[i], t.wR[i]);
      const lat = (c.grid % 2 === 0 ? 1 : -1) * clamp(w * 0.32, 1.7, 2.6);
      const sp = t.spawn(i, lat);
      c.vehicle.reset(sp.x, sp.z, sp.heading, 0, sp.index);
      c.vehicle.holdBrakes = true;
      const d = t.distanceAlong(sp.x, sp.z, sp.index);
      c.s = c.prevS = d.s;
      c.prog = d.s > this.L / 2 ? d.s - this.L : d.s;
      c.startProg = c.prog;
      c.lat = d.lateral;
      c.idx = d.index;
      c.lapsDone = 0;
      c.lapTimes = [];
      c.lastLap = c.bestLap = null;
      c.finished = false;
      c.finishTime = null;
      c.estimated = false;
      c.trace?.fill(-1);
      if (c.ai) {
        c.ai.offset = c.ai.offsetTarget = lat - t.raceLat[i];
        c.ai.speedCap = Infinity;
        c.laneT = 4 + this.random() * 3; // pierwsze sekundy: kazdy trzyma swoj pas
        c.react = 0.15 + this.random() * 0.35; // czas reakcji na zgaszenie swiatel
      }
      c.passSide = 0; c.passT = 0; c.blockedT = 0; c.blueT = 0; c.stuckT = 0; c.retired = false;
    }
    this._updateOrder();
  }

  /** zielone swiatlo */
  go() {
    this.started = true;
    this.time = 0;
    for (const c of this.cars) if (c.isPlayer) c.vehicle.holdBrakes = false;
  }

  /** krok AI (przed krokiem fizyki aut AI). Gracz sterowany jest osobno. */
  stepAI(h) {
    for (const c of this.cars) {
      if (!c.ai) continue;
      const v = c.vehicle;
      if (!this.started) {
        v.holdBrakes = true;
        c.ai.speedCap = 0;
        c.ai.update(h);
        v.input.throttle = 0.35; // obroty na starcie
      } else {
        if (c.react > 0) { c.react -= h; v.holdBrakes = true; v.input.throttle = 0.35; }
        else v.holdBrakes = false;
        if (c.finished) {
          // okrazenie zjazdowe - spokojnie, linia wyscigowa
          c.ai.pace = Math.min(c.ai.pace, 0.7);
          c.ai.offsetTarget = 0;
          c.ai.speedCap = Infinity;
          this._follow(c, h, true);
        } else {
          this._racecraft(c, h);
        }
        c.ai.update(h);
        if (c.react > 0) { v.input.throttle = 0.35; v.input.brake = 0; }
      }
      v.step(h);
    }
  }

  /** po krokach fizyki wszystkich aut: kolizje, postep, okrazenia, meta */
  postStep(h) {
    const vs = this.cars.map((c) => c.vehicle);
    this.contacts += collideVehicles(vs);
    this._slipstream();
    if (this.started) this.time += h;
    const t = this.track;
    for (const c of this.cars) {
      const v = c.vehicle;
      const d = t.distanceAlong(v.pos.x, v.pos.z, v.trackIndex);
      let ds = d.s - c.prevS;
      if (ds < -this.L / 2) ds += this.L;
      if (ds > this.L / 2) ds -= this.L;
      c.s = d.s;
      c.prevS = d.s;
      c.lat = d.lateral;
      c.idx = d.index;
      const sp = v.forwardSpeed();
      // przyspieszenie wzdluzne (wygladzone) - auta z tylu widza, jak mocno hamuje poprzedzajace
      c.acc += ((sp - c.speed) / h - c.acc) * Math.min(1, h * 12);
      c.speed = sp;
      if (!this.started) continue;
      const before = c.prog;
      c.prog += ds;
      // slad czasu co 10 m postepu (do strat czasowych)
      const b = Math.floor((c.prog + this._binOffset) / 10);
      if (b >= 0 && b < c.trace.length && c.trace[b] < 0) {
        let k = b;
        while (k >= 0 && c.trace[k] < 0) c.trace[k--] = this.time;
      }
      // przeciecie linii (do przodu)
      if (c.finished) continue;
      const lapBefore = Math.floor(before / this.L);
      const lapNow = Math.floor(c.prog / this.L);
      if (lapNow > lapBefore && lapNow >= 0) {
        const frac = ds > 0 ? (lapNow * this.L - before) / ds : 1;
        const tc = this.time - h + h * frac;
        if (lapNow === 0) {
          c.lapStart = tc; // poczatek 1. okrazenia
          c.lapsDone = 0;
        } else if (lapNow > c.lapsDone) {
          const lt = tc - c.lapStart;
          c.lapTimes.push(lt);
          c.lastLap = lt;
          if (c.bestLap == null || lt < c.bestLap) c.bestLap = lt;
          c.lapStart = tc;
          c.lapsDone = lapNow;
          if (c.lapsDone >= this.laps || this.leaderFinished) this._finish(c, tc);
        }
      }
    }
    this._updateOrder();
  }

  /** cien aerodynamiczny: mniejszy opor (i troche mniej docisku) za autem z przodu */
  _slipstream() {
    const L = this.L;
    for (const c of this.cars) {
      let f = 0;
      if (c.speed > 20) {
        for (const o of this.cars) {
          if (o === c) continue;
          let ds = o.s - c.s;
          if (ds > L / 2) ds -= L;
          if (ds < -L / 2) ds += L;
          if (ds < 3 || ds > 50) continue;
          const dl = o.lat - c.lat;
          f = Math.max(f, (1 - ds / 50) * Math.exp(-(dl * dl) / 2.6));
        }
      }
      c.vehicle.draft = 0.32 * f;
      c.vehicle.dirtyAir = 0.15 * f;
      c.draft = f;
    }
  }

  _finish(c, tc) {
    c.finished = true;
    c.finishTime = tc;
    c.finishOrder = ++this.finishCount;
    if (!this.leaderFinished) this.leaderFinished = true;
  }

  _updateOrder() {
    const order = this.cars.slice().sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishOrder - b.finishOrder;
      if (!this.started) return a.grid - b.grid;
      return b.prog - a.prog;
    });
    order.forEach((c, k) => { c.position = k + 1; });
    this.order = order;
  }

  /** biezace okrazenie (1..laps) */
  currentLap(c) {
    return clamp(c.lapsDone + 1, 1, this.laps);
  }

  /** czas, w ktorym auto `ref` mialo postep `prog` (lub null) */
  _timeAt(ref, prog) {
    const b = Math.floor((prog + this._binOffset) / 10);
    if (b < 0 || b >= ref.trace.length) return null;
    const t = ref.trace[b];
    return t >= 0 ? t : null;
  }

  /** strata do auta `ref` (dodatnia = za nim) w sekundach; { laps } gdy zdublowany */
  gap(c, ref) {
    if (c === ref) return { time: 0, laps: 0 };
    if (c.finished && ref.finished) {
      const dl = ref.lapsDone - c.lapsDone;
      return dl > 0 ? { time: null, laps: dl } : { time: c.finishTime - ref.finishTime, laps: 0 };
    }
    const dl = Math.floor((ref.prog - c.prog) / this.L);
    if (dl >= 1 && !c.finished) return { time: null, laps: dl };
    // tuz po starcie: auto jeszcze nie dojechalo do miejsca, z ktorego ruszal lider - brak odniesienia
    if (!c.finished && c.prog < ref.startProg + 10) return { time: null, laps: 0 };
    const tr = this._timeAt(ref, c.finished ? ref.prog : c.prog);
    if (tr == null) return { time: null, laps: 0 };
    const tc = c.finished ? c.finishTime : this.time;
    return { time: tc - tr, laps: 0 };
  }

  /** kolejnosc koncowa; auta, ktore nie dojechaly, dostaja czas szacowany */
  results() {
    const out = [];
    const winner = this.order.find((c) => c.finished);
    for (const c of this.cars) {
      let laps = c.lapsDone, time = c.finishTime, est = false;
      if (!c.finished) {
        // szacunek: do najblizszej linii (gdy zwyciezca juz na mecie) lub do konca dystansu
        const target = this.leaderFinished ? Math.max(1, Math.ceil(c.prog / this.L + 1e-6)) * this.L : this.laps * this.L;
        const covered = c.prog - c.startProg;
        const avg = covered > 50 && this.time > 1 ? covered / this.time : 30;
        time = this.time + Math.max(0, target - c.prog) / avg;
        laps = Math.round(target / this.L);
        est = true;
      }
      out.push({ car: c, name: c.name, number: c.number, isPlayer: c.isPlayer, laps, time, est, best: c.bestLap });
    }
    out.sort((a, b) => b.laps - a.laps || a.time - b.time);
    // czasy wzgledem zwyciezcy
    const w = out[0];
    out.forEach((r, k) => {
      r.position = k + 1;
      r.gapLaps = w.laps - r.laps;
      r.gap = r.gapLaps > 0 ? null : r.time - w.time;
    });
    void winner;
    return out;
  }

  // ------------------------------------------------------------------ zachowanie AI w ruchu
  _racecraft(c, h) {
    const t = this.track;
    const ai = c.ai;
    const v = c.vehicle;
    ai.pace = c.basePace;
    c.laneT = Math.max(0, c.laneT - h);
    c.passT = Math.max(0, c.passT - h);
    c.blueT = Math.max(0, c.blueT - h);
    // ---- auto utkniete / poza torem: odholowanie na tor (gdy nikt nie nadjezdza)
    const tel = v.telemetry;
    const edge = c.lat > 0 ? t.wL[c.idx] : t.wR[c.idx];
    const lost = tel.upsideDown || (c.speed < 2.5 && c.blockedT < 0.5) || Math.abs(c.lat) > edge + 8 || c.speed < -1;
    c.stuckT = lost ? c.stuckT + h : Math.max(0, c.stuckT - h * 2);
    if (c.stuckT > 4) this._recover(c);

    this._follow(c, h, false);
  }

  /** jazda za autem z przodu, wyprzedzanie, odstep boczny, niebieskie flagi */
  _follow(c, h, cooldown) {
    const t = this.track;
    const ai = c.ai;
    const L = this.L;
    const ds_ = t.ds || L / t.n;
    let lead = null, leadDs = Infinity;
    let leftBusy = 0, rightBusy = 0; // auta obok (|ds| < 6.5 m)
    let blue = null;
    let yieldTo = Infinity;
    const mirror = this._mirror || (this._mirror = []);
    mirror.length = 0;
    for (const o of this.cars) {
      if (o === c || o.retired) continue;
      let ds = o.s - c.s;
      if (ds > L / 2) ds -= L;
      if (ds < -L / 2) ds += L;
      if (ds < -60 || ds > 90) continue;
      const dl = o.lat - c.lat; // + = o na lewo
      // auta obok (nadwozia zachodza na siebie wzdluznie) i atakujace z tylu z boku
      // (okno rosnie z predkoscia zblizania)
      const along = Math.abs(ds) < 4.8;
      const attack = ds <= -4.8 && ds > -(6 + Math.max(0, o.speed - c.speed) * 2.5) && Math.abs(dl) > 1.2;
      if (along || attack) mirror.push(o);
      // obok przed ciasnym zakretem: odpuszcza auto z tylu, a przy rownym ustawieniu - to po zewnetrznej
      if (along && Math.abs(dl) < 3.8 && this.tightAhead[c.idx]) {
        let give = ds > 0.8;
        if (Math.abs(ds) <= 0.8) {
          const k = this.track.raceCurvSigned[this.track.idx(c.idx + 12)];
          give = k > 0 ? dl > 0 : dl < 0; // zakret w lewo: wewnetrzna = lewa strona (wiekszy lat)
        }
        if (give) yieldTo = Math.min(yieldTo, o.speed);
      }
      if (Math.abs(ds) < 6.5 && Math.abs(dl) < 4.2) {
        if (dl > 0) leftBusy = Math.max(leftBusy, 4.2 - dl); else rightBusy = Math.max(rightBusy, 4.2 + dl);
      }
      if (ds > 0.5) {
        // gdzie bede ja, gdy dojade do tego miejsca
        const j = t.idx(c.idx + Math.round(ds / ds_));
        const myLat = clamp(t.raceLat[j] + ai.offset, -t.wR[j] + 1.35, t.wL[j] - 1.35);
        // przed ciasnym zakretem jedzie sie gesiego - szerszy "korytarz"
        const thr = this.tightAhead[c.idx] && ds < 14 ? 3.6 : 2.35;
        if (Math.abs(o.lat - myLat) < thr && ds < leadDs) { lead = o; leadDs = ds; }
      } else if (ds < -2 && ds > -45 && !cooldown && !c.finished) {
        // niebieska flaga: nadjezdza auto, ktore ma okrazenie wiecej
        if (o.prog > c.prog + L * 0.5 && o.speed > c.speed - 2) blue = o;
      }
    }
    // ---- predkosc: jazda za autem z przodu (kinematyka hamowania 7 m/s2)
    let cap = Infinity;
    if (lead) {
      const gap = 5.0 + 0.13 * Math.max(0, c.speed);
      const vl = Math.max(0, lead.speed);
      // drogi hamowania: moja (8 m/s2) i poprzedzajacego (zmierzone opoznienie, gdy hamuje mocniej)
      const aMe = 8, aLead = Math.max(aMe, -lead.acc);
      if (leadDs > gap) cap = Math.sqrt(vl * vl * (aMe / aLead) + 2 * aMe * (leadDs - gap));
      else cap = Math.max(0, vl - (gap - leadDs) * 0.9);
    }
    if (yieldTo < Infinity) cap = Math.min(cap, Math.max(0, yieldTo - 2));
    ai.speedCap = cap;
    const free = t.speedProfile[c.idx] * ai.pace;
    const blocked = cap < free - 1.5 && lead && leadDs < 40;
    c.blockedT = blocked ? c.blockedT + h : Math.max(0, c.blockedT - h * 0.5);
    const i = c.idx;
    if (cooldown) {
      ai.offsetTarget = 0;
    } else if (lead && (c.blockedT > 0.8 || (lead.speed < 4 && leadDs < 50))) {
      // ---- wyprzedzanie: gdy szybszy i zablokowany > 0.8 s (stojace auto - od razu)
      const li = lead.idx;
      const roomL = t.wL[li] - 1.2 - (lead.lat + 1.05);
      const roomR = lead.lat - 1.05 - (-t.wR[li] + 1.2);
      // nowy manewr zaczynamy na prostej / przed strefa hamowania - nie w srodku zakretu
      const calm = Math.abs(t.raceCurv[i]) < 1 / 150 && t.speedProfile[t.idx(i + Math.round(50 / ds_))] > t.speedProfile[i] * 0.8;
      const tight = this.tightAhead[i];
      const firstLap = c.lapsDone === 0 && c.prog < this.L * 0.3;
      const canStart = lead.speed < 4 || (calm && c.laneT <= 0 && ((!tight && !this.cornerAhead[i]) || leadDs < 6));
      // pierwsze okrazenie: atak, ktory nie jest jeszcze obok, odwolany przed ciasnym zakretem
      if (firstLap && tight && c.passSide !== 0 && leadDs > 4.8 && lead.speed >= 4) { c.passSide = 0; c.passT = 0; }
      if ((c.passT <= 0 && (c.passSide !== 0 || canStart)) || (c.passSide !== 0 && (c.passSide > 0 ? roomL : roomR) < 2.0)) {
        // wewnetrzna nastepnego zakretu ma pierwszenstwo, jesli jest miejsce
        const kAhead = t.raceCurvSigned[t.idx(i + Math.round(80 / ds_))];
        const inside = kAhead > 0.002 ? 1 : kAhead < -0.002 ? -1 : 0;
        let side = roomL > roomR ? 1 : -1;
        if (inside && (inside > 0 ? roomL : roomR) > 2.2) side = inside;
        c.passSide = (side > 0 ? roomL : roomR) > 2.0 ? side : 0;
        c.passT = 3;
      }
      if (c.passSide !== 0) {
        // moja pozycja boczna w miejscu, gdzie jest wyprzedzany: linia + offset = jego + 2.75 m
        ai.offsetTarget = clamp(lead.lat - t.raceLat[lead.idx] + c.passSide * 2.75, -6.5, 6.5);
      }
    } else if (c.passT <= 0) {
      c.passSide = 0;
    }
    // ---- niebieska flaga: zjedz z linii i odpusc
    if (blue && c.blueT <= 0 && !cooldown) c.blueT = 3;
    if (c.blueT > 0 && !lead) {
      const side = t.wL[i] - t.raceLat[i] > t.raceLat[i] + t.wR[i] ? 1 : -1;
      ai.offsetTarget = side * 2.6;
      ai.speedCap = Math.min(ai.speedCap, free * 0.93);
    }
    // ---- powrot na linie, gdy wolne (z poczatku wyscigu kazdy trzyma swoj pas)
    if (c.passSide === 0 && c.blueT <= 0 && c.laneT <= 0 && !cooldown) {
      const dir = -Math.sign(ai.offset); // kierunek powrotu (+ = w lewo)
      const busy = dir > 0 ? leftBusy : rightBusy;
      if (busy <= 0) ai.offsetTarget = 0;
      else ai.offsetTarget = ai.offset; // ktos obok - trzymaj tor jazdy
    }
    // ---- odstep boczny i lusterka (jedna regula): od kazdego auta obok i atakujacego z tylu
    // trzymaj >= SEP (srodek-srodek, ~0.9 m miedzy nadwoziami); scisk z obu stron - srodek
    if (mirror.length) {
      const SEP = 2.9;
      const ri = t.raceLat[i];
      let hi = Infinity, lo = -Infinity;
      for (const o of mirror) {
        if (o.lat > c.lat) hi = Math.min(hi, o.lat - SEP);
        else lo = Math.max(lo, o.lat + SEP);
      }
      const tgt = lo > hi ? (lo + hi) / 2 : clamp(ri + ai.offsetTarget, lo, hi);
      ai.offsetTarget = tgt - ri;
    }
    ai.offsetTarget = clamp(ai.offsetTarget, -6.5, 6.5);
  }

  _recover(c) {
    const t = this.track;
    const i = t.idx(c.idx - 3);
    // nie wstawiaj auta przed nadjezdzajacymi
    for (const o of this.cars) {
      if (o === c) continue;
      let ds = o.s - t.s[i];
      if (ds > this.L / 2) ds -= this.L;
      if (ds < -this.L / 2) ds += this.L;
      if (ds > -90 && ds < 12) return;
    }
    const sp = t.spawn(i, t.raceLat[i]);
    const v0 = Math.min(t.speedProfile[i] * 0.5, 20);
    c.vehicle.reset(sp.x, sp.z, sp.heading, v0, sp.index);
    c.ai.offset = c.ai.offsetTarget = 0;
    c.stuckT = 0;
    c.recoveries = (c.recoveries || 0) + 1;
    // postep: reset do tylu o kilka metrow
    const d = t.distanceAlong(sp.x, sp.z, sp.index);
    let ds = d.s - c.s;
    if (ds < -this.L / 2) ds += this.L;
    if (ds > this.L / 2) ds -= this.L;
    c.prog += ds;
    c.s = c.prevS = d.s;
  }

  /** gracz zresetowal auto: korekta postepu, wybor miejsca bez kolizji */
  playerReset(c, spawnIndex) {
    const t = this.track;
    let i = spawnIndex;
    for (let tries = 0; tries < 20; tries++) {
      const busy = this.cars.some((o) => {
        if (o === c) return false;
        const dx = o.vehicle.pos.x - t.px[i], dz = o.vehicle.pos.z - t.pz[i];
        return dx * dx + dz * dz < 64;
      });
      if (!busy) break;
      i = t.idx(i - 4);
    }
    return i;
  }

  /** wywolywane po teleportacji auta gracza (reset) */
  syncAfterReset(c) {
    const t = this.track;
    const v = c.vehicle;
    const d = t.distanceAlong(v.pos.x, v.pos.z, v.trackIndex);
    let ds = d.s - c.s;
    if (ds < -this.L / 2) ds += this.L;
    if (ds > this.L / 2) ds -= this.L;
    c.prog += ds;
    c.s = c.prevS = d.s;
  }
}
