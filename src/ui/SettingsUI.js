// Panel ustawien generowany z opisu - kazda kontrolka dziala i jest zapisywana.
import { PAINTS } from '../render/CarModel.js';

export const SETTINGS_SPEC = [
  { group: 'Grafika' },
  { key: 'quality', label: 'Jakość grafiki', type: 'select', options: [['low', 'Niska'], ['medium', 'Średnia'], ['high', 'Wysoka'], ['ultra', 'Ultra']], note: 'Cienie, gęstość lasu, zasięg widzenia. Las/teren przebudowują się po zmianie.' },
  { key: 'renderScale', label: 'Skala rozdzielczości', type: 'range', min: 0.5, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'fov', label: 'Pole widzenia (kamera zewn.)', type: 'range', min: 50, max: 90, step: 1, fmt: (v) => `${v}°` },
  { key: 'cockpitFov', label: 'Pole widzenia (kokpit)', type: 'range', min: 50, max: 100, step: 1, fmt: (v) => `${v}°` },
  { key: 'camera', label: 'Domyślna kamera', type: 'select', options: [['chase', 'Za samochodem'], ['hood', 'Maska'], ['cockpit', 'Kokpit']] },
  { key: 'smoke', label: 'Dym i pył spod kół', type: 'check' },
  { key: 'showRacingLine', label: 'Pokaż linię wyścigową', type: 'check' },
  { key: 'showFps', label: 'Licznik FPS', type: 'check' },
  { group: 'Jazda' },
  { key: 'abs', label: 'ABS', type: 'select', options: [[0, 'Wyłączony'], [1, '1 (minimalny)'], [2, '2'], [3, '3'], [4, '4 (maksymalny)']], num: true },
  { key: 'tc', label: 'Kontrola trakcji', type: 'select', options: [[0, 'Wyłączona'], [1, '1 (minimalna)'], [2, '2'], [3, '3'], [4, '4 (maksymalna)']], num: true },
  { key: 'gearbox', label: 'Skrzynia biegów', type: 'select', options: [['auto', 'Automatyczna'], ['manual', 'Ręczna (sekwencyjna)']] },
  { key: 'units', label: 'Jednostki prędkości', type: 'select', options: [['kmh', 'km/h'], ['mph', 'mph']] },
  { key: 'paint', label: 'Kolor samochodu', type: 'select', options: Object.entries(PAINTS).map(([k, v]) => [k, v.name]) },
  { group: 'Sterowanie' },
  { key: 'steerSensitivity', label: 'Czułość skrętu', type: 'range', min: 0.5, max: 1.6, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'speedSensitivity', label: 'Redukcja skrętu z prędkością', type: 'range', min: 0, max: 1.5, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'counterSteer', label: 'Wspomaganie kontry (klawiatura)', type: 'check' },
  { key: 'padDeadzone', label: 'Martwa strefa gałki pada', type: 'range', min: 0, max: 0.3, step: 0.01, fmt: (v) => v.toFixed(2) },
  { key: 'padLinearity', label: 'Krzywa skrętu pada', type: 'range', min: 1, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'minimapRotate', label: 'Minimapa obracana z autem', type: 'check' },
  { group: 'Dźwięk' },
  { key: 'volMaster', label: 'Głośność ogólna', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'volEngine', label: 'Silnik', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'volEffects', label: 'Opony i otoczenie', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
];

export function buildSettingsUI(container, settings, onChange) {
  container.innerHTML = '';
  const inputs = {};
  for (const item of SETTINGS_SPEC) {
    if (item.group) {
      const g = document.createElement('div');
      g.className = 'set-group';
      g.textContent = item.group;
      container.appendChild(g);
      continue;
    }
    const row = document.createElement('label');
    row.className = 'set-row';
    if (item.note) row.title = item.note;
    const lab = document.createElement('span');
    lab.textContent = item.label;
    const ctl = document.createElement('span');
    ctl.className = 'ctl';
    let input;
    if (item.type === 'select') {
      input = document.createElement('select');
      for (const [v, t] of item.options) {
        const o = document.createElement('option');
        o.value = String(v);
        o.textContent = t;
        input.appendChild(o);
      }
      input.value = String(settings[item.key]);
      input.addEventListener('change', () => onChange(item.key, item.num ? Number(input.value) : input.value));
      ctl.appendChild(input);
    } else if (item.type === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.min = item.min; input.max = item.max; input.step = item.step;
      input.value = settings[item.key];
      const out = document.createElement('output');
      out.textContent = item.fmt(settings[item.key]);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        out.textContent = item.fmt(v);
        onChange(item.key, v);
      });
      ctl.append(input, out);
      input._out = out;
    } else if (item.type === 'check') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!settings[item.key];
      input.addEventListener('change', () => onChange(item.key, input.checked));
      ctl.appendChild(input);
    }
    inputs[item.key] = { input, item };
    row.append(lab, ctl);
    container.appendChild(row);
  }
  return {
    refresh(s) {
      for (const { input, item } of Object.values(inputs)) {
        if (item.type === 'check') input.checked = !!s[item.key];
        else input.value = String(s[item.key]);
        if (input._out) input._out.textContent = item.fmt(s[item.key]);
      }
    },
  };
}
