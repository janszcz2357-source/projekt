// Wyscig pojedynczy (opcje w menu) i ekran wynikow (wspolny z kariera).
import { DIFFICULTY, makeField, qualifyingOrder } from '../game/Race.js';
import { formatTime } from '../game/Storage.js';
import { getTrackDef } from '../tracks/trackList.js';

const $ = (id) => document.getElementById(id);

export const GRID_OPTIONS = [
  ['back', 'Na końcu stawki'],
  ['middle', 'W środku stawki'],
  ['pole', 'Pole position'],
  ['quali', 'Wg Twojego najlepszego czasu'],
];

function fillSelect(el, options, value, onChange) {
  el.innerHTML = '';
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = label;
    el.appendChild(o);
  }
  el.value = String(value);
  el.onchange = () => onChange(el.value);
}

/** kontrolki opcji wyscigu w menu (zapisywane w ustawieniach) */
export function setupRaceOptions(game) {
  const s = game.settings;
  const opp = [];
  for (let k = 3; k <= 11; k++) opp.push([k, `${k} (stawka ${k + 1} aut)`]);
  fillSelect($('ro-opp'), opp, s.raceOpponents, (v) => game.setSetting('raceOpponents', Number(v)));
  fillSelect($('ro-laps'), [1, 2, 3, 4, 5, 8, 10].map((k) => [k, String(k)]), s.raceLaps, (v) => game.setSetting('raceLaps', Number(v)));
  fillSelect($('ro-diff'), Object.entries(DIFFICULTY).map(([k, d]) => [k, d.name]), s.raceDifficulty, (v) => game.setSetting('raceDifficulty', v));
  fillSelect($('ro-grid'), GRID_OPTIONS, s.raceGrid, (v) => game.setSetting('raceGrid', v));
}

/** parametry nowego wyscigu pojedynczego z ustawien */
export function singleRaceOpts(settings) {
  const n = Math.max(1, Math.min(11, settings.raceOpponents | 0));
  const field = qualifyingOrder(makeField(n, settings.raceDifficulty));
  const total = n + 1;
  const g = settings.raceGrid;
  const playerGrid = g === 'pole' ? 0 : g === 'middle' ? Math.floor(total / 2) : g === 'quali' ? 'quali' : total - 1;
  return { field, laps: Math.max(1, settings.raceLaps | 0), playerGrid };
}

/** wypelnia tabele wynikow */
export function renderResults({ results, trackId, laps, careerPoints = null }) {
  const def = getTrackDef(trackId);
  $('res-title').textContent = 'Wyniki wyścigu';
  const me = results.find((r) => r.isPlayer);
  $('res-sub').textContent = `${def?.name ?? trackId} · ${laps} okr. · Twoja pozycja: ${me ? me.position : '–'} / ${results.length}`;
  const T = $('res-table');
  T.innerHTML = '';
  const head = document.createElement('tr');
  const cols = ['Poz.', 'Nr', 'Kierowca', 'Okr.', 'Czas / strata', 'Najl. okrążenie'];
  if (careerPoints) cols.push('Pkt');
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = c;
    head.appendChild(th);
  }
  T.appendChild(head);
  let best = null;
  for (const r of results) if (r.best != null && (best == null || r.best < best)) best = r.best;
  let anyEst = false;
  for (const r of results) {
    const tr = document.createElement('tr');
    if (r.isPlayer) tr.className = 'me';
    const time = r.position === 1 ? formatTime(r.time) : r.gapLaps > 0 ? `+${r.gapLaps} okr.` : `+${r.gap.toFixed(3)}`;
    if (r.est) anyEst = true;
    const cells = [r.position, r.number, r.isPlayer ? 'Ty' : r.name, r.laps, (r.est ? '~ ' : '') + time, r.best != null ? formatTime(r.best) : '–'];
    if (careerPoints) cells.push((careerPoints[r.position - 1] ?? 0) + (r.best != null && r.best === best && r.position <= 10 ? 1 : 0));
    cells.forEach((v, k) => {
      const td = document.createElement('td');
      td.textContent = String(v);
      if (k === 5 && r.best != null && r.best === best) td.className = 'fl';
      tr.appendChild(td);
    });
    T.appendChild(tr);
  }
  $('res-note').textContent = anyEst ? '~ czas szacowany: rywal był jeszcze na trasie, gdy ukończyłeś wyścig. Fioletowy – najszybsze okrążenie.' : 'Fioletowy – najszybsze okrążenie wyścigu.';
}
