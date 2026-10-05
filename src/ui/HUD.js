// HUD (DOM): czasy okrazen, sektory, delta, predkosc, bieg, obroty, pedaly, asysty, minimapa.
import { Minimap } from './Minimap.js';
import { formatTime, formatSector } from '../game/Storage.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      lapno: $('hud-lapno'), mode: $('hud-mode'), cur: $('hud-cur'), delta: $('hud-delta'),
      s: [$('hud-s1'), $('hud-s2'), $('hud-s3')], last: $('hud-last'), best: $('hud-best'), record: $('hud-record'),
      invalid: $('hud-invalid'), brk: $('hud-brk'), thr: $('hud-thr'), abs: $('hud-abs'), tc: $('hud-tc'),
      leds: $('hud-leds'), rpm: $('hud-rpm'), speed: $('hud-speed'), unit: $('hud-unit'), gear: $('hud-gear'),
      rpmnum: $('hud-rpmnum'), gbx: $('hud-gbx'), cam: $('hud-cam'), g: $('hud-g'), msg: $('hud-msg'),
      lights: $('hud-lights'), fps: $('hud-fps'), hint: $('hud-hint'),
      race: $('hud-race'), pos: $('hud-pos'), posN: $('hud-posn'), rlap: $('hud-rlap'), tower: $('hud-tower'),
    };
    this._towerRows = [];
    this.leds = [];
    for (let i = 0; i < 12; i++) {
      const d = document.createElement('i');
      this.el.leds.appendChild(d);
      this.leds.push(d);
    }
    this.minimap = new Minimap($('minimap'));
    this._cache = {};
    this._msgTimer = null;
    this._hintTimer = null;
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  _set(key, el, text) {
    if (this._cache[key] === text) return;
    this._cache[key] = text;
    el.textContent = text;
  }

  _cls(key, el, cls) {
    if (this._cache['c' + key] === cls) return;
    this._cache['c' + key] = cls;
    el.className = cls;
  }

  setMode(text) {
    this.el.mode.textContent = text;
  }

  /** panel wyscigu (pozycja, okrazenie, wieza czasow) - race = null ukrywa */
  setRace(race) {
    const E = this.el;
    E.race.classList.toggle('hidden', !race);
    E.tower.classList.toggle('hidden', !race);
    this.root.classList.toggle('racing', !!race);
    this._cache.lapLabel = null;
    if (!race) return;
    E.tower.innerHTML = '';
    this._towerRows = race.cars.map(() => {
      const row = document.createElement('div');
      row.className = 'tw';
      row.innerHTML = '<span class="p"></span><span class="n"></span><span class="d"></span><span class="g"></span>';
      E.tower.appendChild(row);
      return row;
    });
    this.updateRace(race);
  }

  updateRace(race) {
    const E = this.el;
    const me = race.player;
    this._set('pos', E.pos, String(me.position));
    this._set('posN', E.posN, '/' + race.cars.length);
    this._set('rlap', E.rlap, `${race.currentLap(me)}/${race.laps}`);
    const leader = race.order[0];
    race.order.forEach((c, k) => {
      const row = this._towerRows[k];
      if (!row) return;
      const [p, n, d, g] = row.children;
      const key = 'tw' + k;
      const name = c.isPlayer ? 'TY' : c.name;
      let gap = '';
      if (k === 0) gap = c.finished ? 'META' : race.started ? `OKR. ${race.currentLap(c)}` : '';
      else {
        const gp = race.gap(c, leader);
        gap = gp.laps > 0 ? `+${gp.laps} okr.` : gp.time != null ? `+${gp.time.toFixed(1)}` : '';
      }
      const txt = `${k + 1}|${c.number}|${name}|${gap}|${c.isPlayer}|${c.finished}`;
      if (this._cache[key] === txt) return;
      this._cache[key] = txt;
      p.textContent = k + 1;
      n.textContent = c.number;
      n.style.background = '#' + (c.isPlayer ? 0x33d1ff : c.paint ?? 0x888888).toString(16).padStart(6, '0');
      d.textContent = name;
      g.textContent = gap;
      row.className = 'tw' + (c.isPlayer ? ' me' : '') + (c.finished ? ' fin' : '');
    });
  }

  message(text, sub = '', ms = 2200, color = '') {
    const m = this.el.msg;
    m.innerHTML = '';
    const t = document.createElement('div');
    t.textContent = text;
    if (color) t.style.color = color;
    m.appendChild(t);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      m.appendChild(s);
    }
    m.classList.add('show');
    clearTimeout(this._msgTimer);
    if (ms > 0) this._msgTimer = setTimeout(() => m.classList.remove('show'), ms);
  }

  clearMessage() {
    this.el.msg.classList.remove('show');
  }

  hint(text) {
    const h = this.el.hint;
    if (!text) { h.classList.remove('show'); return; }
    if (h.textContent !== text) h.textContent = text;
    h.classList.add('show');
  }

  /** count: 0..5 zapalonych, go: zielone */
  lights(count, go = false, visible = true) {
    const L = this.el.lights;
    L.classList.toggle('hidden', !visible);
    L.classList.toggle('go', go);
    [...L.children].forEach((c, i) => c.classList.toggle('on', !go && i < count));
  }

  update(s) {
    const { tel, timer, settings, record, delta, maxRpm, redline, camName, fps } = s;
    const E = this.el;
    // ---- pomiar czasu
    this._set('lapno', E.lapno, timer.lapActive ? String(timer.lapNumber) : '–');
    this._set('cur', E.cur, timer.lapActive ? formatTime(timer.currentLapTime) : s.countdown ? 'START' : '–:––.–––');
    if (delta != null && timer.lapActive) {
      this._set('delta', E.delta, (delta > 0 ? '+' : '') + delta.toFixed(2));
      this._cls('delta', E.delta, 'delta ' + (delta <= 0 ? 'neg' : 'pos'));
    } else {
      this._set('delta', E.delta, ' ');
    }
    for (let k = 0; k < 3; k++) {
      let t = null, cls = 'sec';
      if (timer.lapActive && k < timer.sector) {
        t = timer.sectorTimes[k];
        if (!timer.valid) cls += '';
        else if (timer.bestSectors[k] != null && t <= timer.bestSectors[k] + 1e-6) cls += ' purple';
        else cls += ' yellow';
      } else if (timer.lapActive && k === timer.sector) {
        cls += ' cur';
        t = timer.lastSectorTimes[k];
      } else t = timer.lastSectorTimes[k];
      this._set('s' + k, E.s[k].lastChild, formatSector(t));
      this._cls('s' + k, E.s[k], cls);
    }
    this._set('last', E.last, timer.lastLap != null ? formatTime(timer.lastLap) + (timer.lastLapValid ? '' : ' ✕') : '–:––.–––');
    this._set('best', E.best, formatTime(timer.bestLap));
    this._set('record', E.record, record ? formatTime(record.time) : '–:––.–––');
    E.invalid.classList.toggle('hidden', !(timer.lapActive && !timer.valid));
    // ---- deska
    const mph = settings.units === 'mph';
    const spd = mph ? tel.speedKmh / 1.609344 : tel.speedKmh;
    this._set('speed', E.speed, String(Math.round(spd)));
    this._set('unit', E.unit, mph ? 'mph' : 'km/h');
    const g = tel.gear === 0 ? 'N' : tel.gear < 0 ? 'R' : String(tel.gear);
    this._set('gear', E.gear, g);
    this._cls('gear', E.gear, 'gear' + (tel.limiter ? ' limit' : ''));
    this._set('rpmnum', E.rpmnum, String(Math.round(tel.rpm / 10) * 10));
    E.rpm.style.width = Math.min(100, (tel.rpm / maxRpm) * 100).toFixed(1) + '%';
    const frac = Math.max(0, Math.min(1, (tel.rpm - 4500) / (redline - 4500)));
    const lit = Math.round(frac * 12);
    const flash = tel.rpm >= redline;
    this._cls('leds', E.leds, 'shift-lights' + (flash && Math.floor(performance.now() / 90) % 2 ? ' flash' : ''));
    for (let i = 0; i < 12; i++) {
      const c = i < lit ? (i < 5 ? 'g' : i < 9 ? 'r' : 'b') : '';
      if (this.leds[i].className !== c) this.leds[i].className = c;
    }
    E.thr.style.height = (tel.throttle * 100).toFixed(0) + '%';
    E.brk.style.height = (tel.brake * 100).toFixed(0) + '%';
    this._cls('abs', E.abs, 'assist' + (settings.abs === 0 ? ' off' : tel.absActive ? ' on' : ''));
    this._cls('tc', E.tc, 'assist' + (settings.tc === 0 ? ' off' : tel.tcActive ? ' on' : ''));
    this._set('absTxt', E.abs, settings.abs === 0 ? 'ABS' : `ABS ${settings.abs}`);
    this._set('tcTxt', E.tc, settings.tc === 0 ? 'TC' : `TC ${settings.tc}`);
    this._set('gbx', E.gbx, settings.gearbox === 'auto' ? 'AUTO' : 'MANUAL');
    this._set('cam', E.cam, camName);
    const cockpit = s.camMode === 'cockpit';
    if (this._cache.cockpit !== cockpit) {
      this._cache.cockpit = cockpit;
      this.root.classList.toggle('cockpit', cockpit);
    }
    const gg = Math.hypot(tel.latG, tel.longG);
    this._set('g', E.g, gg.toFixed(1) + ' g');
    E.fps.classList.toggle('hidden', !settings.showFps);
    if (settings.showFps) this._set('fps', E.fps, `${fps.toFixed(0)} FPS`);
  }
}
