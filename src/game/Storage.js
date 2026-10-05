// Ustawienia i rekordy zapisywane w localStorage (z obsluga bledow - np. tryb prywatny).

const SETTINGS_KEY = 'apexgt.settings.v1';
const RECORDS_KEY = 'apexgt.records.v1';

export const DEFAULT_SETTINGS = {
  quality: 'medium', // low | medium | high | ultra
  renderScale: 1.0,
  fov: 62,
  cockpitFov: 72,
  camera: 'chase',
  abs: 2, // 0 = wyl., 1..4
  tc: 2, // 0 = wyl., 1..4
  gearbox: 'auto', // auto | manual
  steerSensitivity: 1.0,
  speedSensitivity: 0.7,
  counterSteer: true,
  padDeadzone: 0.06,
  padLinearity: 1.4,
  units: 'kmh',
  volMaster: 0.8,
  volEngine: 0.8,
  volEffects: 0.8,
  showFps: false,
  showRacingLine: false,
  minimapRotate: false,
  smoke: true,
  paint: 'rosso',
  lastTrack: 'monza',
  lastMode: 'practice',
};

function safeGet(key) {
  try {
    const s = window.localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings() {
  const s = safeGet(SETTINGS_KEY);
  const out = { ...DEFAULT_SETTINGS };
  if (s && typeof s === 'object') {
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (k in s && typeof s[k] === typeof DEFAULT_SETTINGS[k]) out[k] = s[k];
    }
  }
  return out;
}

export function saveSettings(s) {
  return safeSet(SETTINGS_KEY, s);
}

export class Records {
  constructor() {
    this.data = safeGet(RECORDS_KEY) || {};
  }

  get(trackId, mode) {
    const r = this.data?.[trackId]?.[mode];
    if (!r || typeof r.time !== 'number') return null;
    return r;
  }

  /** zapisuje okrazenie, jesli jest najlepsze; zwraca true dla nowego rekordu */
  submit(trackId, mode, lap, trace, extra = {}) {
    if (!lap.valid) return false;
    const cur = this.get(trackId, mode);
    if (cur && cur.time <= lap.time) return false;
    this.data[trackId] ||= {};
    this.data[trackId][mode] = {
      time: lap.time,
      sectors: lap.sectors,
      trace: trace ? trace.map((v) => Math.round(v * 1000) / 1000) : null,
      date: new Date().toISOString(),
      ...extra,
    };
    safeSet(RECORDS_KEY, this.data);
    return true;
  }

  clear(trackId) {
    if (trackId) delete this.data[trackId];
    else this.data = {};
    safeSet(RECORDS_KEY, this.data);
  }
}

export function formatTime(t, plus = false) {
  if (t == null || !Number.isFinite(t)) return '–:––.–––';
  const sign = t < 0 ? '-' : plus ? '+' : '';
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${sign}${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function formatSector(t) {
  if (t == null || !Number.isFinite(t)) return '––.–––';
  return t >= 60 ? formatTime(t) : t.toFixed(3);
}
