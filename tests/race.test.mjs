// Testy wyscigow z AI i kariery (Node, bez przegladarki).
// Uzycie: node tests/race.test.mjs  -> wyniki w konsoli i w tests/RACE_RESULTS.md
import fs from 'node:fs';
import path from 'node:path';
import { Vehicle } from '../src/physics/Vehicle.js';
import { FlatSurface } from '../src/physics/flatSurface.js';
import { GT_CAR, PHYSICS } from '../src/config/carConfig.js';
import { collideVehicles } from '../src/physics/carCollisions.js';
import { Race, makeField, rng, qualifyingOrder, estimateLapTime, gridFromLapTime } from '../src/game/Race.js';
import { Career, SERIES, POINTS, UPGRADES, applyUpgrades, sanitize, CAREER_KEY, PLAYER_ID } from '../src/game/Career.js';
import { loadTrack } from './loadTrack.mjs';

const DT = 1 / PHYSICS.stepHz;
const results = [];
let failures = 0;
function check(name, value, lo, hi, note = '') {
  const ok = Number.isFinite(value) && value >= lo && value <= hi;
  if (!ok) failures++;
  results.push({ name, value, lo, hi, ok, note });
  const v = Number.isInteger(value) ? value : value.toFixed(3);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}: ${v}  [oczekiwane ${lo}..${hi}]${note ? '  ' + note : ''}`);
}
function section(t) {
  console.log(`\n== ${t}`);
  results.push({ section: t });
}

// ===================================================================== 1. kolizje aut
section('1. Kolizje miedzy autami (impulsy dwoch bryl)');
{
  // najechanie na tyl: auto A 30 m/s, B stoi 6 m przed nim
  const s = new FlatSurface();
  const a = new Vehicle(GT_CAR, s), b = new Vehicle(GT_CAR, s);
  for (const v of [a, b]) Object.assign(v.settings, { absLevel: 2, tcLevel: 2, autoGearbox: true });
  a.reset(0, 0, 0, 30);
  b.reset(0, 6, 0, 0);
  let contacts = 0, maxPen = 0, first = -1, p1 = 0, vb1 = 0;
  const p0 = a.vel.z * a.mass + b.vel.z * b.mass;
  for (let k = 0; k < 60; k++) {
    a.step(DT); b.step(DT);
    const c = collideVehicles([a, b]);
    contacts += c;
    if (c && first < 0) first = k;
    if (first >= 0 && k === first + 3) { p1 = a.vel.z * a.mass + b.vel.z * b.mass; vb1 = b.vel.z; }
    if (first >= 0 && k <= first + 20) maxPen = Math.max(maxPen, 4.62 - (b.pos.z - a.pos.z));
  }
  check('najechanie na tyl (30 m/s w stojace auto): kontakt wykryty (kroki)', contacts, 1, 60);
  check('najechanie na tyl: maks. przenikanie nadwozi [m]', maxPen, 0, 0.3);
  check('najechanie na tyl: zachowanie pedu w zderzeniu [wzgl.]', p1 / p0, 0.98, 1.01);
  check('najechanie na tyl: predkosc auta uderzonego [m/s]', vb1, 12, 18, 'zderzenie prawie niesprezyste (restytucja 0.15): ~14 m/s');
  check('brak NaN', [a, b].every((v) => Number.isFinite(v.pos.x + v.vel.x + v.angVel.y)) ? 1 : 0, 1, 1);
  // otarcie bokiem: auta obok siebie, zbiezne
  const c = new Vehicle(GT_CAR, s), d = new Vehicle(GT_CAR, s);
  c.reset(0, 0, 0, 40);
  d.reset(2.3, 0, -0.06, 40);
  let side = 0;
  for (let k = 0; k < 240; k++) { c.step(DT); d.step(DT); side += collideVehicles([c, d]); }
  const sep = Math.abs(d.pos.x - c.pos.x);
  check('otarcie bokiem: kontakt wykryty', side, 1, 240);
  check('otarcie bokiem: auta rozdzielone (odleglosc boczna) [m]', sep, 1.9, 20);
  check('otarcie bokiem: oba nadal jada (min. predkosc) [m/s]', Math.min(c.forwardSpeed(), d.forwardSpeed()), 15, 45);
}

// ===================================================================== 2. wyscigi AI
section('2. Wyscigi samych AI: 12 aut, 2 okrazenia, kazdy tor (ziarno stale - wynik powtarzalny)');
const raceSummary = [];
for (const id of ['monza', 'spa', 'silverstone']) {
  const track = loadTrack(id);
  const seed = 2024;
  const field = qualifyingOrder(makeField(12, 'hard', seed), rng(seed + 7));
  const race = new Race(track, { opponents: field, laps: 2, aiCfg: GT_CAR, random: rng(seed + 1) });
  for (let k = 0; k < 120; k++) { race.stepAI(DT); race.postStep(DT); }
  race.go();
  const T0 = performance.now();
  let lapSane = true;
  while (race.time < 2 * 230 + 120 && !race.cars.every((c) => c.finished)) {
    race.stepAI(DT);
    race.postStep(DT);
  }
  const ms = performance.now() - T0;
  const res = race.results();
  const finished = race.cars.filter((c) => c.finished).length;
  const nan = race.cars.filter((c) => !Number.isFinite(c.vehicle.pos.x + c.vehicle.vel.x)).length;
  const recov = race.cars.reduce((a, c) => a + (c.recoveries || 0), 0);
  for (const c of race.cars) for (const lt of c.lapTimes) if (lt < 90 || lt > 260) lapSane = false;
  const best = Math.min(...race.cars.map((c) => c.bestLap ?? Infinity));
  const est = estimateLapTime(track, Math.max(...field.map((f) => f.pace)));
  check(`${track.name}: auta na mecie`, finished, 12, 12);
  check(`${track.name}: brak NaN`, nan, 0, 0);
  check(`${track.name}: odholowania (auto utkniete/poza torem)`, recov, 0, 2);
  check(`${track.name}: czasy okrazen w rozsadnym zakresie`, lapSane ? 1 : 0, 1, 1);
  check(`${track.name}: kolejnosc wynikow = kolejnosc na mecie`, res.every((r, k) => r.car.finishOrder === k + 1) ? 1 : 0, 1, 1);
  check(`${track.name}: szacunek czasu AI vs najlepsze okrazenie [wzgl.]`, est / best, 0.95, 1.06, `szac. ${est.toFixed(1)} s, zmierz. ${best.toFixed(1)} s`);
  raceSummary.push(`${track.name}: zwyciezca ${res[0].name} ${res[0].time.toFixed(1)} s, ostatni +${res[11].gap?.toFixed(1)} s, kontakty (kroki) ${race.contacts}, odholowania ${recov}, sym. ${(race.time / (ms / 1000)).toFixed(0)}x czasu rzecz.`);
  console.log('  info ' + raceSummary[raceSummary.length - 1]);
}

// ===================================================================== 3. logika wyscigu
section('3. Logika wyscigu: start, okrazenia, meta, pole startowe');
{
  const track = loadTrack('monza');
  const field = makeField(5, 'medium', 7);
  const player = new Vehicle(GT_CAR, track);
  const race = new Race(track, { player, opponents: field, laps: 1, playerGrid: 2, aiCfg: GT_CAR, random: rng(3) });
  check('gracz na polu 3 (indeks 2)', race.player.grid, 2, 2);
  check('auta na polach rozstawione (min. odleglosc) [m]', Math.min(...race.cars.flatMap((a, i) => race.cars.slice(i + 1).map((b) => a.vehicle.pos.distanceTo(b.vehicle.pos)))), 4, 100);
  // przed startem AI stoja
  for (let k = 0; k < 240; k++) { race.stepAI(DT); race.postStep(DT); }
  check('przed zgaszeniem swiatel AI stoja [m/s]', Math.max(...race.cars.filter((c) => !c.isPlayer).map((c) => Math.abs(c.vehicle.forwardSpeed()))), 0, 0.5);
  race.go();
  // gracz stoi na polu (nie jedzie) - zwyciezca konczy, gracz zdublowany konczy po przekroczeniu linii? nie - stoi
  let t = 0;
  while (!race.leaderFinished && t < 300) { player.input.throttle = 0; player.input.brake = 1; player.step(DT); race.stepAI(DT); race.postStep(DT); t += DT; }
  check('zwyciezca na mecie po 1 okr.', race.order[0].finished ? 1 : 0, 1, 1);
  check('gracz ostatni (stal na polu)', race.player.position, 6, 6);
  const res = race.results();
  const me = res.find((r) => r.isPlayer);
  check('wynik gracza: czas szacowany', me.est ? 1 : 0, 1, 1);
  // pole startowe wg czasu
  const f2 = qualifyingOrder(makeField(9, 'medium', 11), rng(1), 0);
  check('kwalifikacje: brak czasu -> koniec stawki', gridFromLapTime(track, f2, null), 9, 9);
  check('kwalifikacje: czas szybszy od AI -> pole position', gridFromLapTime(track, f2, 60), 0, 0);
  check('kwalifikacje: czas wolny -> koniec', gridFromLapTime(track, f2, 400), 9, 9);
}

// ===================================================================== 4. kariera
section('4. Kariera: sezon, punkty, nagrody, odblokowanie, ulepszenia, zapis');
{
  const mem = {};
  const storage = { get: (k) => (k in mem ? JSON.parse(mem[k]) : null), set: (k, v) => { mem[k] = JSON.stringify(v); } };
  const car = new Career(storage);
  check('nowa kariera: 1 odblokowana seria', car.state.unlocked, 1, 1);
  check('nie mozna zaczac zablokowanej serii', car.startSeason('pro') ? 1 : 0, 0, 0);
  check('start sezonu Amateur', car.startSeason('amateur', 99) ? 1 : 0, 1, 1);
  const ser = SERIES[0];
  // symulacja rund: gracz wygrywa kazda runde, najszybsze okrazenie
  let credits0 = car.state.credits;
  let out;
  for (let r = 0; r < ser.rounds.length; r++) {
    const ev = car.nextEvent();
    const rows = [{ isPlayer: true, name: 'Ty', number: 27, best: 100 }, ...ev.field.map((f, k) => ({ isPlayer: false, name: f.name, number: f.number, best: 101 + k }))];
    out = car.recordRace(rows);
  }
  check('3 wygrane + najszybsze okrazenia: punkty gracza', car.state.season.points[PLAYER_ID], 3 * 26, 3 * 26);
  check('sezon zakonczony', car.state.season.done ? 1 : 0, 1, 1);
  check('mistrz serii', out.champion.position, 1, 1);
  check('odblokowana seria Pro', car.state.unlocked, 2, 2);
  check('nagrody + premia za mistrzostwo [cr]', car.state.credits - credits0, 3 * (ser.prize[0] + 500) + 15000, 3 * (ser.prize[0] + 500) + 15000);
  check('brak kolejnej rundy po sezonie', car.nextEvent() == null ? 1 : 0, 1, 1);
  // suma punktow w rundzie = suma tabeli (+1 FL)
  const roundPts = car.state.season.results[0].order.reduce((a, o) => a + o.pts, 0);
  check('suma punktow rundy (8 aut + FL)', roundPts, POINTS.slice(0, 8).reduce((a, b) => a + b, 0) + 1, POINTS.slice(0, 8).reduce((a, b) => a + b, 0) + 1);
  // zakupy
  const c0 = car.state.credits;
  check('zakup silnika poz. 1', car.buy('engine') ? 1 : 0, 1, 1);
  check('koszt potracony', c0 - car.state.credits, UPGRADES.engine.cost[0], UPGRADES.engine.cost[0]);
  car.state.credits = 0;
  check('brak srodkow - zakup odrzucony', car.buy('tyres') ? 1 : 0, 0, 0);
  // zapis / odczyt
  const car2 = new Career(storage);
  check('odczyt zapisu: poziom silnika', car2.state.upgrades.engine, 1, 1);
  check('odczyt zapisu: odblokowane serie', car2.state.unlocked, 2, 2);
  // uszkodzony zapis
  mem[CAREER_KEY] = JSON.stringify({ version: 1, credits: 'x', upgrades: { engine: 99, tyres: -3 }, unlocked: 42, season: { series: 'nope' } });
  const car3 = new Career(storage);
  check('uszkodzony zapis: kredyty domyslne', car3.state.credits, SERIES[0].start, SERIES[0].start);
  check('uszkodzony zapis: poziomy przyciete', car3.state.upgrades.engine + car3.state.upgrades.tyres, 3, 3);
  check('uszkodzony zapis: serie przyciete', car3.state.unlocked, 3, 3);
  check('uszkodzony zapis: brak sezonu', car3.state.season == null ? 1 : 0, 1, 1);
  check('zapis z innej wersji -> nowa kariera', sanitize({ version: 7, credits: 5 }).credits, SERIES[0].start, SERIES[0].start);
  // ulepszenia zmieniaja konfiguracje (kopia - oryginal bez zmian)
  const cfg = applyUpgrades(GT_CAR, { engine: 3, tyres: 2, aero: 1, brakes: 1, weight: 3 });
  check('silnik +10.5% momentu', cfg.engine.torqueCurve[5][1] / GT_CAR.engine.torqueCurve[5][1], 1.104, 1.106);
  check('opony +4%', cfg.tyres.mu / GT_CAR.tyres.mu, 1.039, 1.041);
  check('masa -45 kg', GT_CAR.mass - cfg.mass, 45, 45);
  check('oryginalna konfiguracja bez zmian', GT_CAR.mass, 1300, 1300);
  // auto z ulepszeniami jest szybsze (0-200 km/h)
  const t200 = (c) => {
    const v = new Vehicle(c, new FlatSurface());
    Object.assign(v.settings, { absLevel: 2, tcLevel: 2, autoGearbox: true });
    v.reset(0, 0, 0, 0);
    let t = 0;
    while (v.forwardSpeed() * 3.6 < 200 && t < 30) { v.input.throttle = 1; v.step(DT); t += DT; }
    return t;
  };
  const tb = t200(GT_CAR), tu = t200(applyUpgrades(GT_CAR, { engine: 3, weight: 3 }));
  check('0-200 km/h: ulepszone auto szybsze [s]', tb - tu, 0.2, 5, `seryjne ${tb.toFixed(2)} s, ulepszone ${tu.toFixed(2)} s`);
}

// ===================================================================== raport
const lines = ['# Wyniki testow wyscigow i kariery', '', `Data: ${new Date().toISOString()}`, '', 'Uruchomienie: `node tests/race.test.mjs`', ''];
for (const r of results) {
  if (r.section) { lines.push('', `## ${r.section}`, ''); continue; }
  const v = Number.isInteger(r.value) ? r.value : r.value.toFixed(3);
  lines.push(`- ${r.ok ? '✅' : '❌'} ${r.name}: **${v}** (oczekiwane ${r.lo}–${r.hi})${r.note ? ' — ' + r.note : ''}`);
}
lines.push('', '## Podsumowanie wyscigow AI', '', ...raceSummary.map((s) => '- ' + s), '', failures ? `**NIEUDANE: ${failures}**` : '**Wszystkie testy zaliczone.**', '');
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'RACE_RESULTS.md'), lines.join('\n'));
console.log(failures ? `\nNIEUDANE: ${failures}` : '\nWszystkie testy zaliczone.');
process.exit(failures ? 1 : 0);
