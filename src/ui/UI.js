// Menu, pauza, ustawienia, sterowanie, "o projekcie" - podpiecie przyciskow do gry.
import { TRACKS } from '../tracks/trackList.js';
import { Minimap } from './Minimap.js';
import { buildSettingsUI } from './SettingsUI.js';
import { PAINTS } from '../render/CarModel.js';
import { DEFAULT_SETTINGS, formatTime, formatSector, safeGet, safeSet } from '../game/Storage.js';
import { setupRaceOptions, singleRaceOpts, renderResults } from './RaceUI.js';
import { setupCareerUI, renderCareerSummary } from './CareerUI.js';
import { Career, applyUpgrades, POINTS } from '../game/Career.js';
import { qualifyingOrder, rng } from '../game/Race.js';
import { GT_CAR } from '../config/carConfig.js';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

const MODE_DESC = {
  practice: 'Swobodna jazda bez limitu okrążeń. Start zatrzymany z pola startowego, pomiar od linii mety. Najlepsze okrążenie zapisuje się jako rekord trybu treningowego.',
  timeattack: 'Start lotny sprzed ostatniego zakrętu. Liczy się tylko najlepsze ważne okrążenie – wyjazd wszystkimi kołami poza tor lub ominięcie punktu kontrolnego unieważnia czas. Delta na żywo względem rekordu.',
  race: 'Wyścig z kierowcami AI: start zatrzymany ze świateł, jazda w ruchu (wyprzedzanie, cień aerodynamiczny), kontakt między autami. Wybierz liczbę rywali, okrążeń, poziom i pole startowe.',
  career: 'Trzy serie: GT Cup Amateur → GT Pro Series → GT Masters. Punkty i klasyfikacja sezonu, nagrody za wyniki, ulepszenia auta w warsztacie. Top 3 sezonu odblokowuje wyższą serię. Postęp zapisuje się automatycznie.',
};

export function setupUI(game) {
  let selTrack = game.settings.lastTrack || 'monza';
  let selMode = game.settings.lastMode || 'practice';
  let overlayReturn = null; // dokad wrocic po zamknieciu ustawien/sterowania
  const previews = {};

  // ---- lista torow
  const list = $('track-list');
  const cards = {};
  for (const t of TRACKS) {
    const b = document.createElement('button');
    b.className = 'track-card';
    b.innerHTML = `<canvas width="300" height="150"></canvas><div class="tn"></div><div class="tm"></div><div class="tr"></div>`;
    b.querySelector('.tn').textContent = t.short;
    b.querySelector('.tm').textContent = `${t.country} · ${t.layout} · ${(t.officialLength / 1000).toFixed(3)} km`;
    b.addEventListener('click', () => selectTrack(t.id));
    list.appendChild(b);
    cards[t.id] = b;
    t.load().then((m) => {
      previews[t.id] = m.default;
      Minimap.drawPreview(b.querySelector('canvas'), m.default.centerline);
    });
  }
  const refreshRecords = () => {
    for (const t of TRACKS) {
      const r = game.records.get(t.id, selMode === 'career' ? 'race' : selMode);
      cards[t.id].querySelector('.tr').textContent = r ? `Rekord: ${formatTime(r.time)}` : 'Rekord: brak';
    }
  };
  async function selectTrack(id) {
    selTrack = id;
    Object.entries(cards).forEach(([k, c]) => c.classList.toggle('on', k === id));
    game.settings.lastTrack = id;
    // tlo menu: wczytaj wybrany tor i pokaz jazde autopilota
    if (game.trackId !== id && game.state === 'menu') {
      showLoading(true);
      await game.loadTrack(id, (m) => ($('loading-text').textContent = m));
      game.startDemo();
      showLoading(false);
    }
  }
  // ---- tryb
  const seg = $('mode-seg');
  const setMode = (m) => {
    selMode = m;
    [...seg.children].forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    $('mode-desc').textContent = MODE_DESC[m];
    show('race-opts', m === 'race');
    $('btn-start').textContent = m === 'career' ? 'KARIERA ▸' : 'START';
    list.classList.toggle('dim', m === 'career');
    refreshRecords();
  };
  seg.addEventListener('click', (e) => { if (e.target.dataset.mode) setMode(e.target.dataset.mode); });
  setMode(selMode);
  // ---- lakier
  const pl = $('paint-list');
  const drawPaints = () => {
    pl.innerHTML = '';
    for (const [k, p] of Object.entries(PAINTS)) {
      const b = document.createElement('button');
      b.title = p.name;
      b.style.background = '#' + p.color.toString(16).padStart(6, '0');
      b.className = game.settings.paint === k ? 'on' : '';
      b.addEventListener('click', () => { game.setSetting('paint', k); drawPaints(); settingsUI.refresh(game.settings); });
      pl.appendChild(b);
    }
  };
  // ---- ustawienia
  const settingsUI = buildSettingsUI($('settings-grid'), game.settings, (k, v) => {
    game.setSetting(k, v);
    if (k === 'paint') drawPaints();
  });
  drawPaints();
  const openOverlay = (id, from) => {
    overlayReturn = from;
    if (from) show(from, false);
    show(id, true);
    if (id === 'settings') settingsUI.refresh(game.settings);
    if (id === 'controls') updatePadStatus();
  };
  const closeOverlay = (id) => {
    show(id, false);
    if (overlayReturn) show(overlayReturn, true);
    overlayReturn = null;
  };
  $('btn-settings').onclick = () => openOverlay('settings', 'menu');
  $('btn-controls').onclick = () => openOverlay('controls', 'menu');
  $('btn-about').onclick = () => openOverlay('about', 'menu');
  $('btn-p-settings').onclick = () => openOverlay('settings', 'pause');
  $('btn-p-controls').onclick = () => openOverlay('controls', 'pause');
  $('btn-settings-close').onclick = () => closeOverlay('settings');
  $('btn-controls-close').onclick = () => closeOverlay('controls');
  $('btn-about-close').onclick = () => closeOverlay('about');
  $('btn-settings-default').onclick = () => {
    const keep = { lastTrack: game.settings.lastTrack, lastMode: game.settings.lastMode };
    game.resetSettings({ ...DEFAULT_SETTINGS, ...keep });
    settingsUI.refresh(game.settings);
    drawPaints();
  };
  // potwierdzenie drugim kliknieciem (bez okien dialogowych przegladarki)
  let clearArmed = null;
  $('btn-records-clear').onclick = () => {
    const btn = $('btn-records-clear');
    if (!clearArmed) {
      btn.textContent = 'Kliknij ponownie, aby usunąć rekordy';
      clearArmed = setTimeout(() => { clearArmed = null; btn.textContent = 'Usuń rekordy'; }, 4000);
      return;
    }
    clearTimeout(clearArmed);
    clearArmed = null;
    game.records.clear();
    game.record = null;
    refreshRecords();
    btn.textContent = 'Rekordy usunięte';
    setTimeout(() => { btn.textContent = 'Usuń rekordy'; }, 2000);
  };
  const updatePadStatus = () => {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    $('pad-status').textContent = pads.length ? `Pad: ${pads[0].id}` : 'Pad: nie wykryto (podłącz i naciśnij dowolny przycisk).';
  };
  window.addEventListener('gamepadconnected', updatePadStatus);

  // ---- start / pauza
  const showLoading = (on) => show('loading', on);
  // ---- kariera
  const career = new Career({ get: safeGet, set: safeSet });
  const careerUI = setupCareerUI(career, {
    onStartRound: (ev) => {
      show('career', false);
      const se = career.state.season;
      const opts = {
        field: qualifyingOrder(ev.field, rng(se.seed + 7 * (ev.round + 1))),
        laps: ev.laps,
        playerGrid: 'quali',
        carCfg: applyUpgrades(GT_CAR, career.state.upgrades),
        career: { seriesName: ev.series.name, round: ev.round, rounds: ev.series.rounds.length },
      };
      game.startSession('career', ev.trackId, opts);
    },
    onBack: () => { show('career', false); show('menu', true); },
    bestLapFor: (id) => game.bestLapOn(id),
  });
  const openCareer = () => {
    show('menu', false);
    careerUI.render();
    show('career', true);
  };
  $('btn-start').onclick = async () => {
    if (selMode === 'career') { openCareer(); return; }
    show('menu', false);
    await game.startSession(selMode, selTrack, selMode === 'race' ? singleRaceOpts(game.settings) : null);
  };
  setupRaceOptions(game);
  // ---- wyniki wyscigu
  let afterResults = 'menu';
  game.on('raceResults', ({ results, mode, trackId, laps }) => {
    const isCareer = mode === 'career';
    renderResults({ results, trackId, laps, careerPoints: isCareer ? POINTS : null });
    renderCareerSummary(career, isCareer ? career.recordRace(results) : null);
    show('btn-res-next', isCareer);
    show('btn-res-restart', !isCareer);
    afterResults = isCareer ? 'career' : 'menu';
    show('results', true);
  });
  $('btn-res-next').onclick = () => { show('results', false); afterResults = 'career'; game.quitToMenu(); };
  $('btn-res-menu').onclick = () => { show('results', false); afterResults = 'menu'; game.quitToMenu(); };
  $('btn-res-restart').onclick = () => {
    show('results', false);
    // nowy wyscig z ta sama stawka i ustawieniami
    game.restart();
  };
  $('btn-resume').onclick = () => game.resume();
  $('btn-restart').onclick = () => { game.resume(); game.restart(); };
  $('btn-reset-car').onclick = () => { game.resume(); game.resetCar(); };
  $('btn-quit').onclick = () => { show('pause', false); game.quitToMenu(); };
  game.on('loading', (on) => showLoading(on));
  game.on('progress', (m) => ($('loading-text').textContent = m));
  game.on('pause', (on) => {
    show('pause', on);
    if (!on) { show('settings', false); show('controls', false); }
    if (on) renderLapList();
  });
  game.on('menu', () => {
    if (afterResults === 'career') {
      afterResults = 'menu';
      openCareer();
    } else show('menu', true);
    refreshRecords();
  });
  game.on('session', ({ mode }) => {
    $('btn-restart').textContent = mode === 'race' || mode === 'career' ? 'Restart wyścigu' : 'Restart sesji';
    $('btn-quit').textContent = mode === 'career' ? 'Wyjdź (runda nie zostanie zaliczona)' : 'Wyjdź do menu';
  });
  game.on('lap', () => refreshRecords());
  game.on('padStart', () => {
    const overlays = ['settings', 'controls', 'about', 'loading', 'pause'];
    if (!$('menu').classList.contains('hidden') && overlays.every((id) => $(id).classList.contains('hidden'))) $('btn-start').click();
  });
  const renderLapList = () => {
    const el = $('lap-list');
    el.innerHTML = '';
    const laps = game.timer?.laps || [];
    if (!laps.length) { el.textContent = 'Brak ukończonych okrążeń w tej sesji.'; return; }
    const best = game.timer.bestLap;
    for (const l of laps) {
      const r = document.createElement('div');
      r.className = 'lr' + (!l.valid ? ' inv' : l.time === best ? ' best' : '');
      const a = document.createElement('span');
      a.textContent = `#${l.number}  ${formatTime(l.time)}${l.valid ? '' : '  ✕ ' + l.reason}`;
      const b = document.createElement('span');
      b.textContent = l.sectors.map((s) => formatSector(s)).join(' · ');
      r.append(a, b);
      el.appendChild(r);
    }
  };
  // klawisz Esc w menu pauzy
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !$('settings').classList.contains('hidden')) { e.stopPropagation(); closeOverlay('settings'); }
    else if (e.code === 'Escape' && !$('controls').classList.contains('hidden')) { e.stopPropagation(); closeOverlay('controls'); }
    else if (e.code === 'Escape' && !$('about').classList.contains('hidden')) { e.stopPropagation(); closeOverlay('about'); }
    else if (e.code === 'Escape' && !$('career').classList.contains('hidden')) { e.stopPropagation(); show('career', false); show('menu', true); }
  }, true);

  // ---- o projekcie
  $('about-text').innerHTML = ABOUT_HTML;
  // urzadzenia dotykowe bez klawiatury: gra wymaga klawiatury lub pada
  if (window.matchMedia?.('(pointer: coarse)').matches) {
    const n = document.createElement('p');
    n.className = 'mode-desc';
    n.textContent = 'Sterowanie wymaga klawiatury lub pada (brak sterowania dotykowego).';
    $('btn-start').parentElement.after(n);
  }

  return {
    async boot() {
      showLoading(true);
      await game.loadTrack(selTrack, (m) => ($('loading-text').textContent = m));
      Object.entries(cards).forEach(([k, c]) => c.classList.toggle('on', k === selTrack));
      game.startDemo();
      showLoading(false);
      show('menu', true);
      refreshRecords();
    },
  };
}

const ABOUT_HTML = `
<p><b>Apex GT</b> – przeglądarkowa gra simracingowa 3D (Three.js + własny silnik fizyki). Samochód porusza się wyłącznie dzięki siłom i momentom liczonym ze stałym krokiem 120 Hz (4 podkroki dynamiki kół), niezależnie od liczby klatek.</p>
<h3>Fizyka</h3>
<ul>
<li>Bryła sztywna 6DOF: masa 1300 kg, tensor bezwładności, środek ciężkości 0,46 m; przenoszenie obciążeń wynika z sił w zawieszeniu.</li>
<li>4 niezależne koła: sprężyny, dwustopniowe tłumiki (dobicie/odbicie), odboje, stabilizatory.</li>
<li>Opony: model łączonego poślizgu (kształt Pacejki), wspólny limit przyczepności, spadek μ z obciążeniem, relaksacja poślizgu.</li>
<li>Silnik z krzywą momentu, bezwładnością i hamowaniem silnikiem, sprzęgło automatyczne, sekwencyjna skrzynia 6-biegowa z międzygazem, LSD, opór i docisk aerodynamiczny na osiach, ABS i TC (4 poziomy + wył.).</li>
<li>Nawierzchnie: asfalt, krawężniki, asfaltowe pobocza, trawa, żwir (różna przyczepność, opór toczenia, nierówności).</li>
</ul>
<h3>Tory – źródła danych</h3>
<ul>
<li>Linie środkowe i szerokości: TUMFTM racetrack-database (OSM + zdjęcia satelitarne, LGPL-3.0).</li>
<li>Georeferencja i linia startu/mety: bacinger/f1-circuits (MIT). Silverstone: start/meta przeniesiona na Hamilton Straight (układ od 2011) – położenie przybliżone.</li>
<li>Wysokości: AWS Terrain Tiles (SRTM/EU-DEM, ok. 30 m), wygładzone – przewyższenia są przybliżone (Spa ≈ 105 m, Monza ≈ 16 m, Silverstone ≈ 12 m).</li>
<li>Linia wyścigowa: TUM (minimum krzywizny).</li>
<li><b>Przybliżenia:</b> krawężniki, strefy wyjazdowe (trawa/żwir/asfalt), bariery, trybuny i budynki są rozmieszczone proceduralnie według krzywizny toru – nie są wierną kopią rzeczywistych. Brak alei serwisowej jako drogi.</li>
</ul>
<h3>Uproszczenia</h3>
<ul>
<li>Brak modelu temperatury i zużycia opon, brak pochylenia kół (camber) i geometrii zawieszenia (centrum przechyłu na ziemi).</li>
<li>Masa nieresorowana nie jest symulowana osobno; kontakt koła – pojedynczy promień.</li>
<li>Uszkodzenia nie są modelowane; kolizje – impulsy na punktach nadwozia.</li>
<li>Docisk nie zależy od wysokości prześwitu; brak wiatru i deszczu.</li>
</ul>`;
