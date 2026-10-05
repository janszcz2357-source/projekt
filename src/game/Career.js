// Kariera: trzy serie (GT Cup Amateur -> GT Pro Series -> GT Masters), kalendarz rund na torach z gry,
// punktacja 25-18-15-12-10-8-6-4-2-1 (+1 za najszybsze okrazenie w top 10), klasyfikacja kierowcow,
// nagrody pieniezne i ulepszenia samochodu. Stan zapisywany w localStorage.
//
// Modul nie zalezy od DOM ani od grafiki (testy w Node).
import { AI_DRIVERS, rng } from './Race.js';

export const CAREER_KEY = 'apexgt.career.v1';
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export const SERIES = [
  {
    id: 'amateur', name: 'GT Cup Amateur', laps: 3, opponents: 7, pace: [0.845, 0.9],
    rounds: ['monza', 'silverstone', 'spa'],
    prize: [5000, 3800, 3000, 2400, 2000, 1600, 1300, 1000], start: 2000,
  },
  {
    id: 'pro', name: 'GT Pro Series', laps: 4, opponents: 9, pace: [0.885, 0.94],
    rounds: ['silverstone', 'monza', 'spa', 'silverstone'],
    prize: [9000, 7000, 5600, 4600, 3800, 3200, 2600, 2100, 1700, 1400], start: 0,
  },
  {
    id: 'masters', name: 'GT Masters', laps: 5, opponents: 11, pace: [0.925, 0.975],
    rounds: ['spa', 'monza', 'silverstone', 'spa', 'monza'],
    prize: [15000, 11500, 9500, 8000, 6800, 5800, 5000, 4300, 3700, 3200, 2800, 2400], start: 0,
  },
];

export const UPGRADES = {
  engine: { name: 'Silnik', desc: '+3,5% momentu obrotowego na poziom', cost: [6000, 11000, 18000] },
  tyres: { name: 'Opony', desc: '+2% przyczepności na poziom', cost: [5000, 9000, 15000] },
  aero: { name: 'Aerodynamika', desc: '+6% docisku (+1,5% oporu) na poziom', cost: [5000, 9000, 15000] },
  brakes: { name: 'Hamulce', desc: '+6% momentu hamującego na poziom', cost: [3000, 6000, 10000] },
  weight: { name: 'Odchudzenie', desc: '−15 kg na poziom', cost: [4000, 8000, 13000] },
};
export const MAX_LEVEL = 3;

/** kopia konfiguracji auta z zastosowanymi ulepszeniami */
export function applyUpgrades(base, up = {}) {
  const c = structuredClone(base);
  const L = (k) => clampLevel(up[k]);
  const e = 1 + 0.035 * L('engine');
  c.engine.torqueCurve = c.engine.torqueCurve.map(([r, t]) => [r, t * e]);
  c.tyres.mu *= 1 + 0.02 * L('tyres');
  c.aero.liftAreaFront *= 1 + 0.06 * L('aero');
  c.aero.liftAreaRear *= 1 + 0.06 * L('aero');
  c.aero.dragArea *= 1 + 0.015 * L('aero');
  c.brakes.maxTorqueFront *= 1 + 0.06 * L('brakes');
  c.brakes.maxTorqueRear *= 1 + 0.06 * L('brakes');
  const m0 = c.mass;
  c.mass -= 15 * L('weight');
  const r = c.mass / m0;
  c.inertia = { pitch: c.inertia.pitch * r, yaw: c.inertia.yaw * r, roll: c.inertia.roll * r };
  return c;
}

const clampLevel = (v) => Math.max(0, Math.min(MAX_LEVEL, Math.floor(Number(v) || 0)));

export const PLAYER_ID = 'player';

function newState() {
  return {
    version: 1,
    credits: SERIES[0].start,
    upgrades: { engine: 0, tyres: 0, aero: 0, brakes: 0, weight: 0 },
    unlocked: 1, // liczba odblokowanych serii
    shortRaces: false,
    season: null,
    history: [], // { series, position, points }
  };
}

/** sprawdzenie i naprawa wczytanego stanu (uszkodzony / stary zapis nie moze wywrocic gry) */
export function sanitize(s) {
  const d = newState();
  if (!s || typeof s !== 'object' || s.version !== 1) return d;
  const out = { ...d };
  out.credits = Number.isFinite(s.credits) ? Math.max(0, Math.round(s.credits)) : d.credits;
  for (const k of Object.keys(d.upgrades)) out.upgrades[k] = clampLevel(s.upgrades?.[k]);
  out.unlocked = Math.max(1, Math.min(SERIES.length, Math.floor(s.unlocked) || 1));
  out.shortRaces = !!s.shortRaces;
  out.history = Array.isArray(s.history) ? s.history.filter((h) => h && typeof h.series === 'string').slice(-30) : [];
  const se = s.season;
  const ser = se && SERIES.find((x) => x.id === se.series);
  if (ser && Array.isArray(se.roster) && se.roster.length === ser.opponents && Number.isInteger(se.round)
    && se.round >= 0 && se.round <= ser.rounds.length && se.points && typeof se.points === 'object') {
    out.season = {
      series: ser.id,
      round: se.round,
      seed: Number(se.seed) || 1,
      roster: se.roster.map((r) => ({ id: String(r.id), name: String(r.name), number: Number(r.number) || 0, paint: Number(r.paint) || 0, pace: Number(r.pace) || 0.9, consistency: Number(r.consistency) || 0.01 })),
      points: Object.fromEntries(Object.entries(se.points).map(([k, v]) => [k, Number(v) || 0])),
      results: Array.isArray(se.results) ? se.results : [],
      done: !!se.done,
    };
  }
  return out;
}

export class Career {
  /** storage: { get(key), set(key, value) } - w grze localStorage, w testach obiekt w pamieci */
  constructor(storage) {
    this.storage = storage;
    this.state = sanitize(storage.get(CAREER_KEY));
  }

  save() {
    this.storage.set(CAREER_KEY, this.state);
  }

  reset() {
    this.state = newState();
    this.save();
  }

  get series() {
    return this.state.season ? SERIES.find((s) => s.id === this.state.season.series) : null;
  }

  /** rozpoczyna sezon w serii (musi byc odblokowana) */
  startSeason(seriesId, seed = Date.now()) {
    const idx = SERIES.findIndex((s) => s.id === seriesId);
    if (idx < 0 || idx >= this.state.unlocked) return false;
    const ser = SERIES[idx];
    const R = rng(seed);
    const pool = AI_DRIVERS.slice();
    const roster = [];
    for (let k = 0; k < ser.opponents; k++) {
      const d = pool.splice(Math.floor(R() * pool.length), 1)[0];
      roster.push({
        id: 'ai' + d.number, name: d.name, number: d.number, paint: d.paint,
        pace: ser.pace[0] + (ser.pace[1] - ser.pace[0]) * (k / Math.max(1, ser.opponents - 1)) * (0.85 + 0.3 * R()),
        consistency: 0.006 + R() * 0.012,
      });
    }
    roster.forEach((r) => { r.pace = Math.min(ser.pace[1], r.pace); });
    const points = { [PLAYER_ID]: 0 };
    roster.forEach((r) => { points[r.id] = 0; });
    this.state.season = { series: ser.id, round: 0, seed, roster, points, results: [], done: false };
    this.save();
    return true;
  }

  /** nastepna runda: { series, round, trackId, laps, field } lub null */
  nextEvent() {
    const se = this.state.season;
    const ser = this.series;
    if (!se || !ser || se.done || se.round >= ser.rounds.length) return null;
    // forma dnia: male wahania tempa z rundy na runde (powtarzalne dla danego sezonu)
    const R = rng(se.seed + 101 * (se.round + 1));
    const field = se.roster.map((r) => ({ ...r, pace: Math.min(0.975, r.pace + (R() * 2 - 1) * 0.006) }));
    const laps = this.state.shortRaces ? Math.max(2, Math.ceil(ser.laps / 2)) : ser.laps;
    return { series: ser, round: se.round, trackId: ser.rounds[se.round], laps, field };
  }

  /**
   * zapis wyniku wyscigu; results - lista z Race.results() (kolejnosc koncowa)
   * zwraca { position, points, prize, fastestLap, seasonDone, champion }
   */
  recordRace(results) {
    const se = this.state.season;
    const ser = this.series;
    if (!se || se.done) return null;
    const idOf = (r) => (r.isPlayer ? PLAYER_ID : 'ai' + r.number);
    // najszybsze okrazenie
    let fl = null;
    for (const r of results) if (r.best != null && (fl == null || r.best < fl.best)) fl = r;
    const round = [];
    let mine = null;
    results.forEach((r, k) => {
      const id = idOf(r);
      let pts = POINTS[k] || 0;
      if (fl === r && k < 10) pts += 1;
      se.points[id] = (se.points[id] || 0) + pts;
      round.push({ id, name: r.name, pos: k + 1, pts });
      if (r.isPlayer) mine = { position: k + 1, points: pts, fastestLap: fl === r };
    });
    se.results.push({ track: ser.rounds[se.round], order: round });
    se.round++;
    const prize = mine ? (ser.prize[mine.position - 1] || 800) + (mine.fastestLap ? 500 : 0) : 0;
    this.state.credits += prize;
    let champion = null;
    if (se.round >= ser.rounds.length) {
      se.done = true;
      const st = this.standings();
      const me = st.findIndex((x) => x.id === PLAYER_ID) + 1;
      champion = { position: me, points: se.points[PLAYER_ID] };
      this.state.history.push({ series: ser.id, position: me, points: se.points[PLAYER_ID] });
      // top 3 w klasyfikacji odblokowuje nastepna serie + premia
      const idx = SERIES.findIndex((s) => s.id === ser.id);
      if (me <= 3 && idx + 1 < SERIES.length) this.state.unlocked = Math.max(this.state.unlocked, idx + 2);
      const bonus = [15000, 9000, 6000][me - 1] || 0;
      this.state.credits += bonus;
      champion.bonus = bonus;
      champion.unlocked = me <= 3 && idx + 1 < SERIES.length ? SERIES[idx + 1].name : null;
    }
    this.save();
    return { ...mine, prize, seasonDone: se.done, champion };
  }

  /** klasyfikacja: [{ id, name, number, points, isPlayer, wins }] */
  standings(playerName = 'Ty') {
    const se = this.state.season;
    if (!se) return [];
    const rows = [{ id: PLAYER_ID, name: playerName, number: 27, isPlayer: true }, ...se.roster.map((r) => ({ id: r.id, name: r.name, number: r.number, isPlayer: false }))];
    for (const r of rows) {
      r.points = se.points[r.id] || 0;
      r.wins = se.results.filter((x) => x.order[0]?.id === r.id).length;
      r.best = Math.min(99, ...se.results.map((x) => x.order.find((o) => o.id === r.id)?.pos ?? 99));
    }
    // remis: wiecej zwyciestw, potem lepszy najlepszy wynik
    rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.best - b.best);
    return rows;
  }

  canBuy(key) {
    const u = UPGRADES[key];
    const lvl = this.state.upgrades[key];
    if (!u || lvl >= MAX_LEVEL) return false;
    return this.state.credits >= u.cost[lvl];
  }

  buy(key) {
    if (!this.canBuy(key)) return false;
    const lvl = this.state.upgrades[key];
    this.state.credits -= UPGRADES[key].cost[lvl];
    this.state.upgrades[key] = lvl + 1;
    this.save();
    return true;
  }

  setShortRaces(on) {
    this.state.shortRaces = !!on;
    this.save();
  }
}
