// Testy fizyki uruchamiane bez przegladarki: node tests/physics.test.mjs
// Kazdy test mierzy wartosci i porownuje je z rozsadnymi zakresami dla auta klasy GT3.
// Wyniki trafiaja tez do tests/RESULTS.md.

import fs from 'node:fs';
import path from 'node:path';
import { Vehicle } from '../src/physics/Vehicle.js';
import { FlatSurface } from '../src/physics/flatSurface.js';
import { SURF } from '../src/physics/surfaces.js';
import { GT_CAR, PHYSICS } from '../src/config/carConfig.js';
import { FixedStepper } from '../src/game/FixedStepper.js';
import { LapTimer } from '../src/game/LapTimer.js';
import { Autopilot } from '../src/game/autopilot.js';
import { loadTrack } from './loadTrack.mjs';

const DT = 1 / PHYSICS.stepHz;
const G = PHYSICS.gravity;
const results = [];
let failures = 0;

function check(name, value, lo, hi, unit = '', note = '') {
  const ok = value >= lo && value <= hi && Number.isFinite(value);
  if (!ok) failures++;
  const line = { name, value, lo, hi, unit, ok, note };
  results.push(line);
  const v = typeof value === 'number' ? value.toFixed(Math.abs(value) < 10 ? 3 : 1) : value;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}: ${v} ${unit}  [oczekiwane ${lo}..${hi}]${note ? '  ' + note : ''}`);
  return ok;
}
function info(name, value, unit = '') {
  results.push({ name, value, unit, info: true });
  const v = typeof value === 'number' ? value.toFixed(Math.abs(value) < 10 ? 3 : 1) : value;
  console.log(`  info ${name}: ${v} ${unit}`);
}
function section(title) {
  console.log(`\n== ${title}`);
  results.push({ section: title });
}

function car(surface = new FlatSurface(), settings = {}) {
  const v = new Vehicle(GT_CAR, surface);
  Object.assign(v.settings, { absLevel: 2, tcLevel: 2, autoGearbox: true }, settings);
  v.reset(0, 0, 0, 0);
  return v;
}
function run(v, seconds, fn) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (fn && fn(v, i * DT) === false) return i * DT;
    v.step(DT);
  }
  return seconds;
}
const kmh = (v) => v.forwardSpeed() * 3.6;
// predkosc odchylenia, kat znoszenia nadwozia
function sideslipDeg(v) {
  const q = v.quat;
  const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const lx = 1 - 2 * (q.y * q.y + q.z * q.z), lz = 2 * (q.x * q.z - q.w * q.y);
  const vf = v.vel.x * fx + v.vel.z * fz;
  const vl = v.vel.x * lx + v.vel.z * lz;
  return (Math.atan2(vl, Math.abs(vf)) * 180) / Math.PI;
}
/** rozpedz do predkosci [km/h] na prostej (TC wlaczone), potem utrzymuj */
function accelerateTo(v, target) {
  run(v, 60, (c) => {
    c.input.throttle = 1; c.input.brake = 0; c.input.steer = 0;
    return kmh(c) < target;
  });
}

// ===================================================================== 1. spoczynek
section('1. Spoczynek: rozklad obciazen i stabilnosc');
{
  const v = car();
  run(v, 5);
  const a = GT_CAR.cgToFrontAxle, L = GT_CAR.wheelbase, m = GT_CAR.mass;
  const expF = (m * G * (L - a)) / L / 2;
  const expR = (m * G * a) / L / 2;
  check('nacisk kola przedniego', v.wheels[0].fz, expF * 0.98, expF * 1.02, 'N', `teoria ${expF.toFixed(0)} N`);
  check('nacisk kola tylnego', v.wheels[2].fz, expR * 0.98, expR * 1.02, 'N', `teoria ${expR.toFixed(0)} N`);
  check('dryf po 5 s bez wejsc', Math.hypot(v.pos.x, v.pos.z), 0, 0.01, 'm');
  check('predkosc po 5 s', v.vel.length(), 0, 0.01, 'm/s');
  // postoj na pochylosci 8% z hamulcem
  const s = new FlatSurface({ slope: 0.08 });
  const v2 = new Vehicle(GT_CAR, s);
  v2.settings.autoGearbox = false; // reczna skrzynia: przytrzymanie hamulca nie wlacza wstecznego
  v2.reset(0, 0, 0, 0);
  run(v2, 4, (c) => { c.input.brake = 0.6; c.input.throttle = 0; });
  check('pelzanie na pochylosci 8% z hamulcem (4 s)', Math.abs(v2.pos.z), 0, 0.05, 'm');
  const v3 = new Vehicle(GT_CAR, s);
  v3.settings.autoGearbox = false;
  v3.reset(0, 0, 0, 0);
  run(v3, 4, (c) => { c.input.brake = 0; c.input.throttle = 0; c.drivetrain.gear = 0; });
  check('toczenie sie w dol bez hamulca (luz, 4 s) - kontrola', Math.abs(v3.pos.z), 3, 200, 'm');
}

// ===================================================================== 2. przyspieszanie
section('2. Przyspieszanie (plaska prosta, automat)');
{
  for (const tc of [2, 0]) {
    const v = car(new FlatSurface(), { tcLevel: tc });
    let t = 0, t100 = null, t200 = null, t402 = null, maxSlip = 0, maxRearLoad = 0;
    run(v, 70, (c) => {
      c.input.throttle = 1;
      t += DT;
      const sp = kmh(c);
      if (!t100 && sp >= 100) t100 = t;
      if (!t200 && sp >= 200) t200 = t;
      if (!t402 && c.pos.z >= 402.3) t402 = t;
      maxSlip = Math.max(maxSlip, c.wheels[2].slipRatioInstant);
      if (t < 2) maxRearLoad = Math.max(maxRearLoad, c.wheels[2].fz + c.wheels[3].fz);
    });
    const label = tc ? 'TC 2' : 'TC wyl.';
    check(`0-100 km/h (${label})`, t100, 2.9, 4.6, 's');
    check(`0-200 km/h (${label})`, t200, 8.0, 12.0, 's');
    info(`402 m (${label})`, t402, 's');
    check(`maks. poslizg kol tylnych (${label})`, maxSlip, tc ? 0 : 0.15, tc ? 0.3 : 10, '');
    if (tc) {
      check('predkosc maksymalna po 70 s', kmh(v), 270, 300, 'km/h');
      check('bieg przy V-max', v.drivetrain.gear, 6, 6, '');
    }
  }
}

// ===================================================================== 3. hamowanie
section('3. Hamowanie ze 100 i 200 km/h (ABS: wyl./2/4)');
{
  for (const from of [100, 200]) {
    for (const abs of [0, 2, 4]) {
      const v = car(new FlatSurface(), { absLevel: abs, tcLevel: 2 });
      accelerateTo(v, from + 1);
      const z0 = v.pos.z;
      let t = 0, peak = 0, lockT = 0, decSum = 0, decN = 0, prevV = v.vel.length();
      run(v, 20, (c) => {
        c.input.throttle = 0; c.input.brake = 1;
        if (kmh(c) <= 0.5) return false;
        t += DT;
        const sp = c.vel.length();
        const dec = (prevV - sp) / DT / G;
        prevV = sp;
        if (t > 0.3) { peak = Math.max(peak, dec); decSum += dec; decN++; }
        if (c.vel.length() > 3 && (c.wheels[0].omega === 0 || c.wheels[1].omega === 0)) lockT += DT;
      });
      const dist = v.pos.z - z0;
      const lab = abs ? `ABS ${abs}` : 'ABS wyl.';
      if (from === 100) check(`droga ${from}-0 (${lab})`, dist, abs ? 22 : 25, abs ? 34 : 42, 'm', `sr. opoznienie ${(decSum / decN).toFixed(2)} g, przod zablokowany ${(lockT / t * 100).toFixed(0)}% czasu`);
      else check(`droga ${from}-0 (${lab})`, dist, abs ? 70 : 85, abs ? 125 : 150, 'm', `sr. opoznienie ${(decSum / decN).toFixed(2)} g, przod zablokowany ${(lockT / t * 100).toFixed(0)}% czasu`);
      if (abs === 0) check(`blokowanie kol bez ABS (${from} km/h)`, lockT / t, 0.5, 1, '', 'ulamek czasu z zablokowanym przodem');
      else check(`ABS zapobiega blokowaniu (${from} km/h, ${lab})`, lockT / t, 0, 0.1, '');
    }
  }
}

// ===================================================================== 3b. stabilnosc hamowania
section('3b. Stabilnosc hamowania 220-60 km/h z zaburzeniem (lewe kola na kraweznik - mniejsza przyczepnosc)');
{
  for (const abs of [2, 0]) {
    // "mu-split": lewa strona auta (x > 0) jedzie po kraweznikach (grip 0.9) -> rozne sily hamowania
    const s = new FlatSurface({ typeAt: (x) => (x > 0.3 ? SURF.CURB : SURF.ASPHALT) });
    const v = car(s, { absLevel: abs, tcLevel: 2 });
    v.reset(0, 0, 0, 220 / 3.6);
    let maxYaw = 0, maxBeta = 0;
    const h0 = 0;
    run(v, 8, (c) => {
      c.input.throttle = 0; c.input.brake = 1; c.input.steer = 0;
      maxYaw = Math.max(maxYaw, Math.abs(c.angVel.y));
      maxBeta = Math.max(maxBeta, Math.abs(sideslipDeg(c)));
      return kmh(c) > 60;
    });
    const heading = (Math.atan2(2 * (v.quat.w * v.quat.y + v.quat.x * v.quat.z), 1 - 2 * (v.quat.y ** 2 + v.quat.x ** 2)) * 180) / Math.PI - h0;
    if (abs) check(`hamowanie z roznica przyczepnosci L/P (ABS ${abs}): maks. kat znoszenia`, maxBeta, 0, 3, 'deg', `maks. predkosc odchylenia ${maxYaw.toFixed(3)} rad/s, zmiana kursu ${heading.toFixed(1)} deg (bez korekty kierownica)`);
    else info(`hamowanie z roznica przyczepnosci L/P (ABS wyl., wszystkie kola zablokowane): maks. kat znoszenia ${maxBeta.toFixed(1)} deg, zmiana kursu ${heading.toFixed(1)} deg - bez ABS auto traci stabilnosc (oczekiwane fizycznie)`, '');
  }
}

// ===================================================================== 4. przenoszenie obciazenia
section('4. Przenoszenie obciazenia (porownanie z m*a*h/L)');
{
  const v = car(new FlatSurface(), { absLevel: 2 });
  accelerateTo(v, 80);
  let samples = 0, dF = 0, acc = 0;
  let prev = v.vel.length();
  run(v, 1.2, (c, t) => {
    c.input.throttle = 0; c.input.brake = 0.5;
    const sp = c.vel.length();
    const a = (prev - sp) / DT;
    prev = sp;
    if (t > 0.6) {
      const front = c.wheels[0].fz + c.wheels[1].fz;
      const staticF = (GT_CAR.mass * G * (GT_CAR.wheelbase - GT_CAR.cgToFrontAxle)) / GT_CAR.wheelbase;
      dF += front - staticF; acc += a; samples++;
    }
  });
  const aAvg = acc / samples;
  dF /= samples;
  const theory = (GT_CAR.mass * aAvg * GT_CAR.cgHeight) / GT_CAR.wheelbase;
  // docisk aerodynamiczny przy ~70 km/h dodaje ~ 260 N na przod - odejmujemy
  const vNow = 70 / 3.6;
  const aeroF = 0.5 * 1.225 * GT_CAR.aero.liftAreaFront * vNow * vNow;
  check('hamowanie: przyrost nacisku osi przedniej / teoria', (dF - aeroF) / theory, 0.85, 1.15, '', `a=${(aAvg / G).toFixed(2)} g, dFz=${dF.toFixed(0)} N, teoria ${theory.toFixed(0)} N`);
}

// ===================================================================== 5. jazda po okregu (skidpad)
section('5. Jazda po okregu R = 50 m (regulator toru, rosnaca predkosc)');
let skid = null;
{
  const R = 50;
  const v = car(new FlatSurface(), { absLevel: 2, tcLevel: 2 });
  // auto startuje na okregu: srodek w (-R, 0) (skret w prawo z kierunku +Z)
  const cx = -R, cz = 0;
  let vTarget = 8, maxLat = 0, lostAt = null;
  const table = [];
  let nextLog = 0.3;
  let iSteer = 0;
  run(v, 150, (c, t) => {
    const dx = c.pos.x - cx, dz = c.pos.z - cz;
    const r = Math.hypot(dx, dz);
    const err = r - R; // >0 = na zewnatrz
    // kierunek styczny ruchu po okregu w prawo (zgodnie z ruchem wskazowek patrzac z gory)
    const L = GT_CAR.wheelbase;
    const ff = Math.atan(L / R);
    const sp = c.forwardSpeed();
    iSteer += err * DT * 0.002;
    const heading = Math.atan2(c.vel.x, c.vel.z);
    const tangent = Math.atan2(-dz, dx); // kierunek styczny przy ruchu w prawo (zgodnie z zegarem)
    let herr = heading - tangent;
    while (herr > Math.PI) herr -= 2 * Math.PI;
    while (herr < -Math.PI) herr += 2 * Math.PI;
    const delta = ff + err * 0.02 + iSteer + herr * 0.9; // + = w prawo
    c.input.steer = Math.max(-1, Math.min(1, delta / ((GT_CAR.steering.maxWheelAngleDeg * Math.PI) / 180)));
    vTarget = Math.min(60, 8 + t * 0.2);
    const e = vTarget - sp;
    c.input.throttle = Math.max(0, Math.min(1, 0.25 + e * 0.6));
    c.input.brake = e < -2 ? 0.2 : 0;
    const lat = (sp * sp) / r / G;
    if (t > 5 && Math.abs(err) < 1.5) maxLat = Math.max(maxLat, lat);
    if (t > 5 && !lostAt && Math.abs(err) > 4) lostAt = { t, sp, lat, beta: sideslipDeg(c), err };
    if (lat >= nextLog && Math.abs(err) < 1.5 && t > 5) {
      table.push({ lat, steerDeg: (-c.steerAngle * 180) / Math.PI, beta: sideslipDeg(c) });
      nextLog += 0.2;
    }
    if (lostAt && t > lostAt.t + 3) return false;
  });
  skid = { maxLat, lostAt, table };
  check('maks. przyspieszenie boczne (R=50 m, ustalone)', maxLat, 1.25, 1.75, 'g');
  for (const row of table) info(`  ay=${row.lat.toFixed(2)} g: kat kola ${row.steerDeg.toFixed(2)} deg, kat znoszenia nadwozia ${row.beta.toFixed(2)} deg`, '');
  if (table.length >= 3) {
    const a = table[0], b = table[table.length - 1];
    const K = (b.steerDeg - a.steerDeg) / (b.lat - a.lat);
    check('gradient podsterownosci (dd/day)', K, 0.2, 4, 'deg/g', 'dodatni = podsterownosc na granicy, zgodnie z ustawieniem GT3');
  }
  if (lostAt) info(`utrata toru przy ${(lostAt.sp * 3.6).toFixed(1)} km/h, ay=${lostAt.lat.toFixed(2)} g, beta=${lostAt.beta.toFixed(1)} deg (beta>0: przod wyjezdza = podsterownosc)`, '');
}

// ===================================================================== 6. nadsterownosc z gazem
section('6. Utrata przyczepnosci osi tylnej: pelny gaz w zakrecie, 2. bieg');
{
  for (const tc of [0, 2]) {
    const v = car(new FlatSurface(), { tcLevel: tc, absLevel: 2, autoGearbox: false });
    // ustal ~70 km/h na 2. biegu jadac po luku
    v.drivetrain.gear = 2;
    let maxBeta = 0, maxYaw = 0;
    run(v, 14, (c, t) => {
      const sp = kmh(c);
      if (t < 8) {
        c.input.steer = 0;
        c.input.throttle = sp < 70 ? 0.6 : 0.15;
      } else if (t < 10) {
        c.input.steer = 0.35; // staly skret w prawo
        c.input.throttle = sp < 70 ? 0.35 : 0.2;
      } else {
        c.input.steer = 0.35;
        c.input.throttle = 1; // pelny gaz
        maxBeta = Math.max(maxBeta, Math.abs(sideslipDeg(c)));
        maxYaw = Math.max(maxYaw, Math.abs(c.angVel.y));
      }
    });
    if (tc === 0) check('kat znoszenia nadwozia bez TC (nadsterownosc)', maxBeta, 12, 180, 'deg', `maks. predkosc odchylenia ${maxYaw.toFixed(2)} rad/s`);
    else check('kat znoszenia nadwozia z TC 2', maxBeta, 0, 9, 'deg', `maks. predkosc odchylenia ${maxYaw.toFixed(2)} rad/s`);
  }
  // podsterownosc: zbyt szybkie wejscie w ciasny zakret (pelny skret przy 120 km/h, bez hamowania)
  const v = car(new FlatSurface(), { tcLevel: 2 });
  accelerateTo(v, 120);
  let minR = Infinity, frontSlip = 0, rearSlip = 0, n = 0;
  run(v, 1.5, (c, t) => {
    c.input.throttle = 0.3; c.input.brake = 0; c.input.steer = 1;
    if (t > 0.5) {
      const sp = c.vel.length();
      const r = sp / Math.max(1e-3, Math.abs(c.angVel.y));
      minR = Math.min(minR, r);
      frontSlip += (c.wheels[0].slip + c.wheels[1].slip) / 2; rearSlip += (c.wheels[2].slip + c.wheels[3].slip) / 2; n++;
    }
  });
  const geomR = GT_CAR.wheelbase / Math.tan((GT_CAR.steering.maxWheelAngleDeg * Math.PI) / 180);
  check('podsterownosc: rzeczywisty promien / geometryczny (pelny skret, 120 km/h)', minR / geomR, 3, 50, '', `R=${minR.toFixed(1)} m vs geometryczny ${geomR.toFixed(1)} m; poslizg przod ${(frontSlip / n).toFixed(2)} vs tyl ${(rearSlip / n).toFixed(2)} (1 = szczyt)`);
}

// ===================================================================== 7. nawierzchnie
section('7. Nawierzchnie: wybieg ze 150 km/h bez hamulca, maks. ay na kolku R=30 m');
{
  const surf = { asfalt: SURF.ASPHALT, trawa: SURF.GRASS, zwir: SURF.GRAVEL, kraweznik: SURF.CURB };
  const decs = {};
  for (const [name, type] of Object.entries(surf)) {
    const s = new FlatSurface({ typeAt: (x, z) => (z > 300 ? type : SURF.ASPHALT) });
    const v = car(s, { tcLevel: 2 });
    accelerateTo(v, 152);
    // dojedz do strefy
    run(v, 30, (c) => { c.input.throttle = 0.5; c.input.steer = 0; return c.pos.z < 300; });
    const v0 = v.vel.length();
    run(v, 1.0, (c) => { c.input.throttle = 0; c.input.brake = 0; });
    const dec = (v0 - v.vel.length()) / 1.0 / G;
    decs[name] = dec;
  }
  check('opoznienie na asfalcie (bez hamulca)', decs.asfalt, 0.1, 0.45, 'g', 'opor aero + silnik');
  check('opoznienie na trawie > asfalt', decs.trawa - decs.asfalt, 0.02, 1, 'g');
  check('opoznienie na zwirze > trawa', decs.zwir - decs.trawa, 0.15, 1.5, 'g', `zwir: ${decs.zwir.toFixed(2)} g`);
  // przyczepnosc boczna: ramp steer przy stalej predkosci 50 km/h, odczyt maks. ay
  const latMax = {};
  for (const [name, type] of Object.entries({ asfalt: SURF.ASPHALT, trawa: SURF.GRASS, zwir: SURF.GRAVEL })) {
    const s = new FlatSurface({ typeAt: () => type });
    const v = car(s, { tcLevel: 2 });
    v.reset(0, 0, 0, 45 / 3.6);
    let mx = 0;
    run(v, 12, (c, t) => {
      const sp = kmh(c);
      c.input.throttle = sp < 40 ? 0.8 : 0.35;
      c.input.steer = t > 1 ? Math.min(1, (t - 1) * 0.1) : 0;
      if (t > 1) {
        const ay = Math.abs(c.telemetry.latG);
        mx = Math.max(mx, ay);
      }
    });
    latMax[name] = mx;
  }
  check('maks. ay na asfalcie (40 km/h)', latMax.asfalt, 1.2, 1.9, 'g');
  check('maks. ay na trawie', latMax.trawa, 0.45, 1.05, 'g');
  check('maks. ay na zwirze', latMax.zwir, 0.35, 1.0, 'g');
}

// ===================================================================== 8. niezaleznosc od FPS
section('8. Niezaleznosc od liczby klatek (ten sam scenariusz, rozne FPS)');
{
  // scenariusz wejsc: funkcja czasu
  const script = (t) => ({
    throttle: t < 6 ? 1 : t < 8 ? 0 : 0.7,
    brake: t >= 6 && t < 8 ? 0.8 : 0,
    steer: t > 3 && t < 5 ? 0.06 * Math.sin((t - 3) * Math.PI) : t > 9 ? -0.08 : 0,
  });
  const runWithFps = (frameTimes, sampleEveryStep) => {
    const v = car(new FlatSurface(), { tcLevel: 2, absLevel: 2 });
    const st = new FixedStepper(PHYSICS.stepHz);
    let simT = 0;
    let fi = 0;
    let steps = 0;
    const total = Math.round(12 * PHYSICS.stepHz);
    while (steps < total) {
      const ft = frameTimes(fi++);
      if (!sampleEveryStep) Object.assign(v.input, script(simT)); // wejscie probkowane raz na klatke
      st.advance(ft, (dt) => {
        if (steps >= total) return; // porownujemy stan po identycznym czasie symulacji
        if (sampleEveryStep) Object.assign(v.input, script(simT));
        v.step(dt);
        simT += dt;
        steps++;
      });
    }
    return { x: v.pos.x, z: v.pos.z, speed: v.vel.length(), yaw: Math.atan2(2 * (v.quat.w * v.quat.y + v.quat.x * v.quat.z), 1 - 2 * (v.quat.y ** 2 + v.quat.x ** 2)), t: simT };
  };
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cfgs = {
    '30 FPS': () => 1 / 30,
    '60 FPS': () => 1 / 60,
    '144 FPS': () => 1 / 144,
    '240 FPS': () => 1 / 240,
    'losowe 20-160 FPS': () => 1 / (20 + rnd() * 140),
  };
  for (const perStep of [true, false]) {
    const ref = runWithFps(cfgs['60 FPS'], perStep);
    let maxDev = 0, maxDv = 0;
    for (const [name, f] of Object.entries(cfgs)) {
      seed = 12345;
      const r = runWithFps(f, perStep);
      // roznica przy tym samym czasie symulacji (scenariusz konczy sie po >= 12 s; ten sam krok)
      const dev = Math.hypot(r.x - ref.x, r.z - ref.z);
      maxDev = Math.max(maxDev, dev);
      maxDv = Math.max(maxDv, Math.abs(r.speed - ref.speed));
      info(`${perStep ? '[wejscie co krok]' : '[wejscie co klatke]'} ${name}: pozycja (${r.x.toFixed(3)}, ${r.z.toFixed(3)}) m, v=${(r.speed * 3.6).toFixed(2)} km/h, t=${r.t.toFixed(4)} s`, '');
    }
    if (perStep) check('rozrzut pozycji miedzy FPS (wejscie co krok fizyki)', maxDev, 0, 1e-6, 'm', 'fizyka deterministyczna, identyczna dla kazdego FPS');
    else check('rozrzut pozycji miedzy FPS (wejscie co klatke)', maxDev, 0, 1.5, 'm', `po ~300 m jazdy; roznica predkosci ${(maxDv * 3.6).toFixed(2)} km/h (kwantyzacja wejsc do klatek)`);
  }
  // zbieznosc kroku: 120 Hz vs 240 Hz
  const runHz = (hz, sub) => {
    const save = [PHYSICS.stepHz, PHYSICS.substeps];
    PHYSICS.stepHz = hz; PHYSICS.substeps = sub;
    const v = car(new FlatSurface(), { tcLevel: 2, absLevel: 2 });
    const dt = 1 / hz;
    let t = 0;
    while (t < 12 - 1e-9) { Object.assign(v.input, script(t)); v.step(dt); t += dt; }
    [PHYSICS.stepHz, PHYSICS.substeps] = save;
    return v;
  };
  const a = runHz(120, 4), b = runHz(240, 8);
  check('zbieznosc: 120 Hz vs 240 Hz (pozycja po 12 s)', Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z), 0, 2.0, 'm', `v: ${(a.vel.length() * 3.6).toFixed(2)} vs ${(b.vel.length() * 3.6).toFixed(2)} km/h`);
}

// ===================================================================== 9. kolizja z bariera (Monza)
section('9. Kolizja z bariera: prosto w szykane Rettifilo przy ~220 km/h bez hamowania');
{
  const track = loadTrack('monza');
  const v = new Vehicle(GT_CAR, track);
  Object.assign(v.settings, { absLevel: 2, tcLevel: 2, autoGearbox: true });
  const sp = track.spawn(track.idx(Math.round(420 / 2.5)), 0);
  v.reset(sp.x, sp.z, sp.heading, 220 / 3.6, sp.index);
  let maxOver = -Infinity, nan = false, minSpeed = Infinity, impacts0 = v.impactCount, peakImpact = 0;
  run(v, 8, (c) => {
    c.input.throttle = 0.4; c.input.brake = 0; c.input.steer = 0;
    const d = track.distanceAlong(c.pos.x, c.pos.z, c.trackIndex);
    const i = d.index;
    const over = d.lateral > 0 ? d.lateral - track.barrierL[i] : -d.lateral - track.barrierR[i];
    maxOver = Math.max(maxOver, over);
    if (!Number.isFinite(c.pos.x) || !Number.isFinite(c.vel.x)) nan = true;
    minSpeed = Math.min(minSpeed, c.vel.length());
    peakImpact = Math.max(peakImpact, c.lastImpact);
  });
  check('liczba uderzen w bariere', v.impactCount - impacts0, 1, 1000, '');
  check('maks. przekroczenie linii bariery przez srodek auta', maxOver, -50, 0.0, 'm', 'ujemne = srodek auta zawsze po stronie toru');
  check('brak NaN / eksplozji symulacji', nan ? 1 : 0, 0, 0, '');
  info('predkosc uderzenia (skladowa normalna)', peakImpact * 3.6, 'km/h');
  info('predkosc po zdarzeniu (min.)', minSpeed * 3.6, 'km/h');
}

// ===================================================================== 10. pelne okrazenia
section('10. Pelne okrazenie (autopilot przez te same wejscia co gracz, start z pola, ABS 2 / TC 2)');
const lapTable = [];
for (const id of ['monza', 'spa', 'silverstone']) {
  const track = loadTrack(id);
  const v = new Vehicle(GT_CAR, track);
  Object.assign(v.settings, { absLevel: 2, tcLevel: 2, autoGearbox: true });
  const sp = track.spawn(track.gridIndex, 0);
  v.reset(sp.x, sp.z, sp.heading, 0, sp.index);
  const timer = new LapTimer(track);
  const ap = new Autopilot(track, v, { pace: 0.93 });
  const laps = [];
  timer.on((e) => { if (e.type === 'lap') laps.push(e.lap); });
  let vmax = 0, impacts = v.impactCount, offT = 0, nan = false;
  const wallStart = performance.now();
  let simT = 0;
  while (laps.length < 2 && simT < 600) {
    ap.update(DT);
    v.step(DT);
    timer.update(DT, v);
    simT += DT;
    vmax = Math.max(vmax, kmh(v));
    if (v.telemetry.offTrackWheels >= 4) offT += DT;
    if (!Number.isFinite(v.pos.x)) { nan = true; break; }
  }
  const wall = performance.now() - wallStart;
  const fly = laps[1];
  const fmt = (t) => (t == null ? '-' : `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`);
  check(`${track.name}: ukonczone okrazenia`, laps.length, 2, 2, '', `okr. 1 (start z miejsca) ${fmt(laps[0]?.time)}, okr. 2 (lotne) ${fmt(fly?.time)}`);
  check(`${track.name}: okrazenie lotne wazne`, fly && fly.valid ? 1 : 0, 1, 1, '', fly && !fly.valid ? fly.reason : '');
  check(`${track.name}: uderzenia w bariery`, v.impactCount - impacts, 0, 0, '');
  check(`${track.name}: brak NaN`, nan ? 1 : 0, 0, 0, '');
  info(`${track.name}: V-max`, vmax, 'km/h');
  info(`${track.name}: czas symulacji / czas obliczen`, simT / (wall / 1000), 'x czasu rzeczywistego');
  lapTable.push({ track: track.name, lap1: fmt(laps[0]?.time), lap2: fmt(fly?.time), sectors: fly?.sectors.map((s) => s?.toFixed(2)).join(' / '), vmax: vmax.toFixed(0), valid: fly?.valid });
}

// ===================================================================== 11. tylko klawiatura
section('11. Przejazd tylko klawiatura (wejscia 0/1 przez ten sam filtr skretu/pedalow co u gracza)');
{
  // atrapa srodowiska przegladarki dla modulu wejscia
  globalThis.window ||= { addEventListener() {} };
  if (!globalThis.navigator?.getGamepads) Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
  const { Input } = await import('../src/game/Input.js');
  for (const id of ['monza', 'spa', 'silverstone']) {
    const track = loadTrack(id);
    const v = new Vehicle(GT_CAR, track);
    Object.assign(v.settings, { absLevel: 2, tcLevel: 2, autoGearbox: true });
    const sp = track.spawn(track.gridIndex, 0);
    v.reset(sp.x, sp.z, sp.heading, 0, sp.index);
    // "mozg" (autopilot) liczy zadane wejscia, ktore zamieniamy na wcisniecia klawiszy co klatke 60 Hz
    const shadow = { input: {}, pos: v.pos, quat: v.quat, vel: v.vel, angVel: v.angVel, trackIndex: 0, cfg: GT_CAR, forwardSpeed: () => v.forwardSpeed() };
    const brain = new Autopilot(track, shadow, { pace: 0.88 });
    const inp = new Input();
    const timer = new LapTimer(track);
    const laps = [];
    timer.on((e) => { if (e.type === 'lap') laps.push(e.lap); });
    const FRAME = 1 / 60;
    let t = 0;
    const imp = v.impactCount;
    while (laps.length < 2 && t < 500) {
      shadow.trackIndex = v.trackIndex;
      brain.update(FRAME);
      const want = shadow.input;
      inp.keys.clear();
      if (want.steer > inp.steer + 0.02) inp.keys.add('ArrowRight');
      else if (want.steer < inp.steer - 0.02) inp.keys.add('ArrowLeft');
      if (want.throttle > 0.5) inp.keys.add('ArrowUp');
      if (want.brake > 0.25) inp.keys.add('ArrowDown');
      const c = inp.update(FRAME, v);
      for (let k = 0; k < 2; k++) {
        v.input.steer = c.steer; v.input.throttle = c.throttle; v.input.brake = c.brake; v.input.handbrake = 0;
        v.step(DT);
        timer.update(DT, v);
        t += DT;
      }
    }
    const fmt = (x) => (x == null ? '-' : `${Math.floor(x / 60)}:${(x % 60).toFixed(3).padStart(6, '0')}`);
    const valid = laps.filter((l) => l.valid).length;
    check(`${track.name}: okrazenia z klawiatury (wazne / ukonczone)`, valid, 2, 2, '', `${laps.map((l) => fmt(l.time)).join(', ')}; uderzenia w bariery: ${v.impactCount - imp}`);
  }
}

// ===================================================================== raport
console.log(`\n${failures === 0 ? 'WSZYSTKIE TESTY OK' : `NIEUDANE: ${failures}`}`);
const md = [];
md.push('# Wyniki testow fizyki (node tests/physics.test.mjs)', '');
md.push(`Data: ${new Date().toISOString()}  ·  krok fizyki ${PHYSICS.stepHz} Hz, ${PHYSICS.substeps} podkroki  ·  wynik: ${failures === 0 ? 'wszystkie OK' : failures + ' nieudanych'}`, '');
for (const r of results) {
  if (r.section) { md.push('', `## ${r.section}`, ''); continue; }
  const v = typeof r.value === 'number' ? r.value.toFixed(Math.abs(r.value) < 10 ? 3 : 1) : (r.value ?? '');
  if (r.info) md.push(`- ${r.name}${v !== '' ? ': **' + v + '** ' + r.unit : ''}`);
  else md.push(`- ${r.ok ? '✅' : '❌'} ${r.name}: **${v}** ${r.unit} (oczekiwane ${r.lo}–${r.hi})${r.note ? ' — ' + r.note : ''}`);
}
md.push('', '## Okrazenia autopilota', '', '| Tor | Okr. 1 (z miejsca) | Okr. 2 (lotne) | Sektory okr. 2 [s] | V-max [km/h] |', '|---|---|---|---|---|');
for (const l of lapTable) md.push(`| ${l.track} | ${l.lap1} | ${l.lap2} | ${l.sectors} | ${l.vmax} |`);
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'RESULTS.md'), md.join('\n') + '\n');
process.exit(failures === 0 ? 0 : 1);
