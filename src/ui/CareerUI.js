// Ekran kariery: serie, nastepna runda, klasyfikacja, warsztat (ulepszenia).
import { SERIES, UPGRADES, MAX_LEVEL, PLAYER_ID, POINTS } from '../game/Career.js';
import { getTrackDef } from '../tracks/trackList.js';
import { formatTime } from '../game/Storage.js';

const $ = (id) => document.getElementById(id);
const fmtCr = (v) => v.toLocaleString('pl-PL') + ' cr';

export function setupCareerUI(career, { onStartRound, onBack, bestLapFor }) {
  let armedReset = null;
  let armedSeason = null;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function render() {
    const st = career.state;
    const se = st.season;
    $('cr-credits').textContent = fmtCr(st.credits);
    $('cr-short').checked = st.shortRaces;
    // ---- serie
    const S = $('cr-series');
    S.innerHTML = '';
    SERIES.forEach((ser, k) => {
      const card = el('div', 'cr-card');
      const locked = k >= st.unlocked;
      const active = se && se.series === ser.id;
      if (locked) card.classList.add('locked');
      if (active) card.classList.add('active');
      const head = el('div', 'cr-card-h');
      head.append(el('b', '', ser.name), el('span', 'cr-tag', locked ? 'zablokowana' : active ? (se.done ? 'sezon zakończony' : `runda ${se.round + 1}/${ser.rounds.length}`) : 'dostępna'));
      card.appendChild(head);
      card.appendChild(el('div', 'cr-meta', `${ser.rounds.length} rund · ${ser.laps} okr. · ${ser.opponents} rywali · tempo AI ${Math.round(ser.pace[0] * 100)}–${Math.round(ser.pace[1] * 100)}%`));
      card.appendChild(el('div', 'cr-meta', ser.rounds.map((id) => getTrackDef(id)?.short ?? id).join(' → ')));
      const hist = st.history.filter((h) => h.series === ser.id);
      if (hist.length) {
        const bestPos = Math.min(...hist.map((h) => h.position));
        card.appendChild(el('div', 'cr-meta', `Najlepszy wynik sezonu: ${bestPos}. miejsce`));
      }
      if (locked) card.appendChild(el('div', 'cr-meta', 'Odblokowanie: miejsce w top 3 klasyfikacji poprzedniej serii.'));
      else if (!active || se.done) {
        const b = el('button', 'small', active ? 'Nowy sezon' : 'Rozpocznij sezon');
        b.onclick = () => {
          // przerwanie trwajacego sezonu innej serii wymaga potwierdzenia
          if (se && !se.done && se.series !== ser.id && armedSeason !== ser.id) {
            armedSeason = ser.id;
            b.textContent = 'Kliknij ponownie – obecny sezon przepadnie';
            setTimeout(() => { if (armedSeason === ser.id) { armedSeason = null; render(); } }, 4000);
            return;
          }
          armedSeason = null;
          career.startSeason(ser.id);
          render();
        };
        card.appendChild(b);
      }
      S.appendChild(card);
    });
    // ---- nastepna runda
    const N = $('cr-next');
    N.innerHTML = '';
    const ev = career.nextEvent();
    const btn = $('btn-cr-race');
    if (ev) {
      const def = getTrackDef(ev.trackId);
      N.appendChild(el('div', 'cr-ev-t', `${def?.name ?? ev.trackId}`));
      N.appendChild(el('div', 'cr-meta', `${ev.series.name} · runda ${ev.round + 1} z ${ev.series.rounds.length} · ${ev.laps} okr. · ${ev.field.length + 1} aut`));
      const best = bestLapFor(ev.trackId);
      N.appendChild(el('div', 'cr-meta', best != null
        ? `Pole startowe wg Twojego najlepszego czasu na tym torze: ${formatTime(best)}`
        : 'Brak Twojego czasu na tym torze – start z końca stawki (pojeździj najpierw w treningu).'));
      btn.disabled = false;
    } else {
      N.appendChild(el('div', 'cr-meta', se?.done ? 'Sezon zakończony – rozpocznij nowy sezon lub wyższą serię.' : 'Wybierz serię i rozpocznij sezon.'));
      btn.disabled = true;
    }
    // ---- klasyfikacja
    const T = $('cr-standings');
    T.innerHTML = '';
    if (se) {
      const table = el('table', 'cr-table');
      const hr = el('tr');
      ['', 'Kierowca', 'Wygr.', 'Pkt'].forEach((h) => hr.appendChild(el('th', '', h)));
      table.appendChild(hr);
      career.standings('Ty').forEach((r, k) => {
        const tr = el('tr', r.id === PLAYER_ID ? 'me' : '');
        [k + 1, `#${r.number} ${r.name}`, r.wins, r.points].forEach((v) => tr.appendChild(el('td', '', String(v))));
        table.appendChild(tr);
      });
      T.appendChild(table);
      T.appendChild(el('div', 'cr-meta', `Punktacja: ${POINTS.join('-')} (+1 za najszybsze okrążenie w top 10).`));
    } else T.appendChild(el('div', 'cr-meta', 'Brak trwającego sezonu.'));
    // ---- warsztat
    const W = $('cr-shop');
    W.innerHTML = '';
    for (const [key, u] of Object.entries(UPGRADES)) {
      const lvl = st.upgrades[key];
      const row = el('div', 'cr-up');
      const info = el('div', 'cr-up-i');
      info.append(el('b', '', u.name), el('span', 'cr-meta', u.desc));
      const pips = el('div', 'pips');
      for (let k = 0; k < MAX_LEVEL; k++) pips.appendChild(el('i', k < lvl ? 'on' : ''));
      const b = el('button', 'small', lvl >= MAX_LEVEL ? 'MAX' : fmtCr(u.cost[lvl]));
      b.disabled = !career.canBuy(key);
      b.onclick = () => { if (career.buy(key)) render(); };
      row.append(info, pips, b);
      W.appendChild(row);
    }
  }

  $('btn-cr-race').onclick = () => {
    const ev = career.nextEvent();
    if (ev) onStartRound(ev);
  };
  $('btn-cr-back').onclick = () => onBack();
  $('cr-short').onchange = (e) => { career.setShortRaces(e.target.checked); render(); };
  $('btn-cr-reset').onclick = () => {
    const b = $('btn-cr-reset');
    if (!armedReset) {
      b.textContent = 'Kliknij ponownie – cały postęp zostanie usunięty';
      armedReset = setTimeout(() => { armedReset = null; b.textContent = 'Nowa kariera'; }, 4000);
      return;
    }
    clearTimeout(armedReset);
    armedReset = null;
    b.textContent = 'Nowa kariera';
    career.reset();
    render();
  };

  return { render };
}

/** podsumowanie rundy kariery pod tabela wynikow */
export function renderCareerSummary(career, out) {
  const box = $('res-career');
  box.innerHTML = '';
  box.classList.toggle('hidden', !out);
  if (!out) return;
  const p = document.createElement('div');
  p.className = 'cr-sum';
  const lines = [
    `Punkty: +${out.points}${out.fastestLap ? ' (w tym 1 za najszybsze okrążenie)' : ''}`,
    `Nagroda: +${fmtCr(out.prize)} · stan konta: ${fmtCr(career.state.credits)}`,
  ];
  if (out.champion) {
    const c = out.champion;
    lines.push(`Koniec sezonu – ${c.position}. miejsce w klasyfikacji (${c.points} pkt)${c.bonus ? `, premia ${fmtCr(c.bonus)}` : ''}.`);
    if (c.unlocked) lines.push(`Odblokowano serię: ${c.unlocked}!`);
  } else {
    const st = career.standings('Ty');
    const me = st.findIndex((r) => r.id === PLAYER_ID) + 1;
    lines.push(`Klasyfikacja: ${me}. miejsce (${st[me - 1]?.points ?? 0} pkt)`);
  }
  for (const l of lines) {
    const d = document.createElement('div');
    d.textContent = l;
    p.appendChild(d);
  }
  box.appendChild(p);
}
