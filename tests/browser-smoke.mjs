// Test dymny w przegladarce (Playwright + Chromium headless, WebGL przez SwiftShader).
// Uruchamia zbudowana gre (npm run build), przechodzi menu -> sesja na kazdym torze,
// jedzie z gazem, przelacza kamery, pauzuje, robi zrzuty ekranu i zbiera bledy konsoli.
// Uzycie: npm run build && node tests/browser-smoke.mjs [katalog_na_zrzuty]
//
// UWAGA: FPS mierzone tutaj dotycza renderowania PROGRAMOWEGO (SwiftShader, bez GPU) -
// nie odzwierciedlaja wydajnosci na typowym sprzecie z karta graficzna.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright'));
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'docs/screenshots'));
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4179;
const W = Number(process.env.SMOKE_W || 1280), H = Number(process.env.SMOKE_H || 720);

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('vite preview timeout')), 30000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(to); res(); } });
});

const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const log = (...a) => console.log('[smoke]', ...a);
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  log('zrzut', name);
};
const hidden = (id) => page.evaluate((i) => document.getElementById(i).classList.contains('hidden'), id);
const waitVisible = async (id, ms = 120000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!(await hidden(id))) return true;
    await page.waitForTimeout(250);
  }
  throw new Error('timeout czekania na #' + id);
};
const waitHidden = async (id, ms = 180000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await hidden(id)) return true;
    await page.waitForTimeout(250);
  }
  throw new Error('timeout czekania na ukrycie #' + id);
};
const results = { tracks: {} };

const t0 = Date.now();
await page.goto(`http://localhost:${PORT}/`);
await waitVisible('menu');
await waitHidden('loading');
results.bootSeconds = (Date.now() - t0) / 1000;
log('menu gotowe po', results.bootSeconds.toFixed(1), 's');
await page.waitForTimeout(2500);
await shot('01-menu');

const tracks = (process.env.SMOKE_TRACKS || 'monza,spa,silverstone').split(',');
let n = 2;
for (const id of tracks) {
  // wybor toru i trybu
  await page.evaluate((tid) => {
    const cards = [...document.querySelectorAll('.track-card')];
    const names = { monza: 'Monza', spa: 'Spa-Francorchamps', silverstone: 'Silverstone' };
    cards.find((c) => c.querySelector('.tn').textContent === names[tid]).click();
  }, id);
  await page.waitForTimeout(500);
  await waitHidden('loading');
  await page.click('#mode-seg button[data-mode="practice"]');
  await page.click('#btn-start');
  await waitHidden('loading');
  await waitVisible('hud');
  // odliczanie
  await page.waitForTimeout(2000);
  if (id === tracks[0]) await shot(String(n++).padStart(2, '0') + `-${id}-odliczanie`);
  const go = Date.now();
  while (Date.now() - go < 15000) {
    const st = await page.evaluate(() => window.__game.state);
    if (st === 'running') break;
    await page.waitForTimeout(200);
  }
  // jazda: gaz przez kilka sekund (czas rzeczywisty; przy niskim FPS fizyka nadal liczy 120 Hz)
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(5000);
  const tel = await page.evaluate(() => ({ ...window.__game.vehicle.telemetry, fps: window.__game.fps, state: window.__game.state }));
  await shot(String(n++).padStart(2, '0') + `-${id}-poscig`);
  const info = await page.evaluate(() => ({ calls: window.__game.renderer.info.render.calls, triangles: window.__game.renderer.info.render.triangles, trees: window.__game.world.forest.count }));
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(3000);
  await shot(String(n++).padStart(2, '0') + `-${id}-maska`);
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(3000);
  await shot(String(n++).padStart(2, '0') + `-${id}-kokpit`);
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(2000);
  await page.keyboard.up('ArrowUp');
  // FPS (srednia z 3 s)
  const fps = await page.evaluate(() => new Promise((res) => {
    let frames = 0;
    const t0 = performance.now();
    const f = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(frames / ((performance.now() - t0) / 1000)); };
    requestAnimationFrame(f);
  }));
  // pauza
  await page.keyboard.press('Escape');
  await page.waitForTimeout(3000);
  const paused = !(await hidden('pause'));
  if (id === tracks[0]) await shot(String(n++).padStart(2, '0') + `-${id}-pauza`);
  await page.click('#btn-resume');
  await page.waitForTimeout(2000);
  const resumed = await page.evaluate(() => window.__game.state);
  // reset auta
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  results.tracks[id] = { speedKmhAfterThrottle: tel.speedKmh, gear: tel.gear, rpm: tel.rpm, fpsSwiftShader: fps, paused, resumed, ...info };
  log(id, JSON.stringify(results.tracks[id]));
  // powrot do menu
  await page.keyboard.press('Escape');
  await page.waitForTimeout(3000);
  await page.click('#btn-quit');
  await waitVisible('menu');
}

// pomiar czasu w UI (time attack): teleport przed linie mety -> start okrazenia,
// ponowny teleport -> okrazenie zakonczone jako niewazne (pominiete punkty kontrolne)
{
  await page.click('#mode-seg button[data-mode="timeattack"]');
  await page.click('#btn-start');
  await waitHidden('loading');
  await page.waitForTimeout(2500);
  await shot(String(n++).padStart(2, '0') + '-timeattack-swiatla');
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if ((await page.evaluate(() => window.__game.state)) === 'running') break;
    await page.waitForTimeout(250);
  }
  const tp = () => page.evaluate(() => {
    const g = window.__game, t = g.track;
    const i = t.idx(-16);
    const sp = t.spawn(i, t.raceLat[i]);
    g.vehicle.reset(sp.x, sp.z, sp.heading, 45, sp.index);
    g.timer.prevS = null;
  });
  const until = async (fn, ms = 90000) => {
    const t1 = Date.now();
    while (Date.now() - t1 < ms) {
      if (await page.evaluate(fn)) return true;
      await page.waitForTimeout(300);
    }
    return false;
  };
  await tp();
  const lapStarted = await until(() => window.__game.timer.lapActive);
  await tp();
  await until(() => window.__game.timer.laps.length > 0);
  await page.waitForTimeout(1500);
  const timing = await page.evaluate(() => ({
    laps: window.__game.timer.laps.map((l) => ({ time: l.time, valid: l.valid, reason: l.reason })),
    lastText: document.getElementById('hud-last').textContent,
    msg: document.getElementById('hud-msg').textContent,
  }));
  results.timingUI = { lapStarted, ...timing };
  log('pomiar czasu UI:', JSON.stringify(results.timingUI));
  await shot(String(n++).padStart(2, '0') + '-timeattack-okrazenie');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(3000);
  await shot(String(n++).padStart(2, '0') + '-pauza-lista-okrazen');
  await page.click('#btn-quit');
  await waitVisible('menu');
}

// ustawienia: otwarcie, zmiana kilku opcji, zamkniecie
await page.click('#btn-settings');
await page.waitForTimeout(300);
await shot(String(n++).padStart(2, '0') + '-ustawienia');
await page.selectOption('#settings-grid select >> nth=0', 'low');
await page.waitForTimeout(1500);
await page.click('#btn-settings-close');
await page.click('#btn-controls');
await page.waitForTimeout(300);
await shot(String(n++).padStart(2, '0') + '-sterowanie');
await page.click('#btn-controls-close');

results.errors = errors;
fs.writeFileSync(path.join(OUT, 'smoke-results.json'), JSON.stringify(results, null, 2));
log('bledy konsoli:', errors.length ? errors : 'brak');
await browser.close();
server.kill('SIGTERM');
spawn('pkill', ['-f', '[v]ite preview']);
process.exit(errors.length ? 1 : 0);
