// Geometria toru w czasie dzialania gry - wspolna dla fizyki, renderingu, minimapy i pomiaru czasu.
//
// Dane wejsciowe (rzeczywiste): linia srodkowa co 5 m [wschod, polnoc, wysokosc, szer. lewa, szer. prawa],
// linia wyscigowa (TUM, minimum krzywizny), siatka terenu (DEM).
// Swiat gry: x = wschod, z = -polnoc, y = wysokosc wzgledem linii startu/mety.
//
// Generowane proceduralnie (przyblizenie, nie dane pomiarowe): krawezniki (wg krzywizny), pobocza
// i strefy wyjazdowe (szerokosc wg predkosci dojazdu), bariery (ograniczone tak, by nie wchodzily na
// sasiednie fragmenty toru), granice sektorow i punkty kontrolne.

import { SURF } from '../physics/surfaces.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function gaussianClosed(src, sigma) {
  const n = src.length;
  const r = Math.ceil(sigma * 3);
  const w = [];
  let ws = 0;
  for (let k = -r; k <= r; k++) {
    const v = Math.exp(-(k * k) / (2 * sigma * sigma));
    w.push(v);
    ws += v;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[(i + k + n) % n] * w[k + r];
    out[i] = acc / ws;
  }
  return out;
}

function maxFilterClosed(src, r) {
  const n = src.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let k = -r; k <= r; k++) m = Math.max(m, src[(i + k + n) % n]);
    out[i] = m;
  }
  return out;
}

function minFilterClosed(src, r) {
  const n = src.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let k = -r; k <= r; k++) m = Math.min(m, src[(i + k + n) % n]);
    out[i] = m;
  }
  return out;
}

// tanie, deterministyczne "nierownosci" terenu
function bumpNoise(x, z) {
  return (
    Math.sin(x * 1.37 + z * 0.41) * 0.45 +
    Math.sin(x * 0.53 - z * 1.91) * 0.35 +
    Math.sin(x * 3.1 + z * 2.7) * 0.2
  );
}

export class Track {
  /**
   * @param {object} data  - JSON z tools/build-tracks.mjs
   * @param {object} def   - wpis z trackList.js
   */
  constructor(data, def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.data = data;
    this._build();
  }

  // ------------------------------------------------------------------ budowa
  _build() {
    const src = this.data.centerline;
    const m = src.length;
    const SUB = 2; // 5 m -> 2.5 m
    const n = m * SUB;
    this.n = n;
    const px = (this.px = new Float64Array(n));
    const py = (this.py = new Float64Array(n));
    const pz = (this.pz = new Float64Array(n));
    const wL = (this.wL = new Float64Array(n));
    const wR = (this.wR = new Float64Array(n));
    // Catmull-Rom (zamknieta) dla pozycji poziomej, liniowo dla wysokosci i szerokosci
    for (let i = 0; i < m; i++) {
      const p0 = src[(i - 1 + m) % m], p1 = src[i], p2 = src[(i + 1) % m], p3 = src[(i + 2) % m];
      for (let k = 0; k < SUB; k++) {
        const t = k / SUB;
        const t2 = t * t, t3 = t2 * t;
        const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        const j = i * SUB + k;
        px[j] = cr(p0[0], p1[0], p2[0], p3[0]);
        pz[j] = -cr(p0[1], p1[1], p2[1], p3[1]);
        py[j] = cr(p0[2], p1[2], p2[2], p3[2]);
        wL[j] = p1[3] + (p2[3] - p1[3]) * t;
        wR[j] = p1[4] + (p2[4] - p1[4]) * t;
      }
    }
    // minimalna szerokosc polowki (dane TUM bywaja zanizone na waskich odcinkach)
    for (let i = 0; i < n; i++) {
      wL[i] = Math.max(wL[i], 4.6);
      wR[i] = Math.max(wR[i], 4.6);
    }

    // dlugosc luku, styczne, normalne (lewa), nachylenie
    const s = (this.s = new Float64Array(n + 1));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      s[i + 1] = s[i] + Math.hypot(px[j] - px[i], pz[j] - pz[i]);
    }
    this.length = s[n];
    const tx = (this.tx = new Float64Array(n));
    const tz = (this.tz = new Float64Array(n));
    const nx = (this.nx = new Float64Array(n));
    const nz = (this.nz = new Float64Array(n));
    const grade = (this.grade = new Float64Array(n));
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      let dx = px[b] - px[a], dz = pz[b] - pz[a];
      const l = Math.hypot(dx, dz);
      dx /= l; dz /= l;
      tx[i] = dx; tz[i] = dz;
      nx[i] = dz; nz[i] = -dx; // lewa normalna = up x t
      grade[i] = (py[b] - py[a]) / l;
    }
    // krzywizna (dodatnia = zakret w lewo)
    const curvRaw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const b = (i + 1) % n;
      const ds = s[i + 1] - s[i];
      // obrot w lewo (ku +n): t_b . n_i > 0
      const dot = tx[b] * nx[i] + tz[b] * nz[i];
      curvRaw[i] = Math.asin(clamp(dot, -1, 1)) / ds;
    }
    this.curv = gaussianClosed(curvRaw, 3);
    this.curvWide = gaussianClosed(curvRaw, 8);

    this._buildRacingLine();
    this._buildSpeedProfile();
    this._buildCurbsAndRunoff();
    this._buildGrid();
    this._buildTiming();
    this._buildTerrain();
  }

  idx(i) {
    return ((i % this.n) + this.n) % this.n;
  }

  /** punkt swiata dla probki i i przesuniecia bocznego (dodatnie = lewo) */
  point(i, lat, out) {
    i = this.idx(i);
    out.x = this.px[i] + this.nx[i] * lat;
    out.y = this.py[i];
    out.z = this.pz[i] + this.nz[i] * lat;
    return out;
  }

  // ------------------------------------------------------------------ linia wyscigowa
  _buildRacingLine() {
    const n = this.n;
    const rl = this.data.raceline;
    // rzut punktow linii TUM na tor -> (indeks, bok)
    const lat = new Float64Array(n);
    const cnt = new Float64Array(n);
    let hint = 0;
    const tmp = { index: 0, t: 0, lateral: 0 };
    // poczatkowa lokalizacja globalna
    let best = 0, bd = Infinity;
    const x0 = rl[0][0], z0 = -rl[0][1];
    for (let i = 0; i < n; i++) {
      const d = (this.px[i] - x0) ** 2 + (this.pz[i] - z0) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    hint = best;
    for (let k = 0; k < rl.length; k++) {
      const x = rl[k][0], z = -rl[k][1];
      this._project(x, z, hint, 24, tmp);
      hint = tmp.index;
      const i = tmp.index;
      lat[i] += tmp.lateral;
      cnt[i] += 1;
    }
    // interpolacja brakow
    const known = [];
    for (let i = 0; i < n; i++) if (cnt[i] > 0) { lat[i] /= cnt[i]; known.push(i); }
    const out = new Float64Array(n);
    for (let q = 0; q < known.length; q++) {
      const a = known[q], b = known[(q + 1) % known.length];
      const span = (b - a + n) % n || n;
      for (let k = 0; k < span; k++) {
        const t = k / span;
        out[(a + k) % n] = lat[a] * (1 - t) + lat[b] * t;
      }
    }
    const sm = gaussianClosed(out, 2);
    for (let i = 0; i < n; i++) {
      sm[i] = clamp(sm[i], -this.wR[i] + 1.3, this.wL[i] - 1.3);
    }
    this.raceLat = sm;
  }

  _buildSpeedProfile() {
    const n = this.n;
    // krzywizna linii wyscigowej
    const x = new Float64Array(n), z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = this.px[i] + this.nx[i] * this.raceLat[i];
      z[i] = this.pz[i] + this.nz[i] * this.raceLat[i];
    }
    const k = new Float64Array(n);
    const ds = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n, b = (i + 2) % n;
      const ax = x[i] - x[a], az = z[i] - z[a], bx = x[b] - x[i], bz = z[b] - z[i];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      const cr = ax * bz - az * bx;
      const ang = Math.asin(clamp(cr / (la * lb), -1, 1));
      k[i] = Math.abs(ang) / ((la + lb) / 2);
      ds[i] = Math.hypot(x[(i + 1) % n] - x[i], z[(i + 1) % n] - z[i]);
    }
    const kk = gaussianClosed(k, 2);
    this.raceCurv = kk;
    // krzywizna ze znakiem (+ = w lewo) i kierunek linii wyscigowej
    const ks = new Float64Array(n);
    const hx = (this.raceTx = new Float64Array(n));
    const hz = (this.raceTz = new Float64Array(n));
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      let dx = x[b] - x[a], dz = z[b] - z[a];
      const l = Math.hypot(dx, dz);
      hx[i] = dx / l; hz[i] = dz / l;
    }
    for (let i = 0; i < n; i++) {
      const b = (i + 2) % n, a = (i - 2 + n) % n;
      // obrot kierunku w lewo: skladowa nowego kierunku wzdluz lewej normalnej starego (hz, -hx)
      const dot = hx[b] * hz[a] - hz[b] * hx[a];
      ks[i] = Math.asin(clamp(dot, -1, 1)) / Math.max(1, Math.hypot(x[b] - x[a], z[b] - z[a]));
    }
    this.raceCurvSigned = gaussianClosed(ks, 2);
    // prosty model punktowy (GG + docisk), sluzy autopilotowi testowemu i kolorowaniu linii
    const g = 9.81, mu = 1.5, kAero = (0.5 * 1.225 * 2.5) / 1300, vmax = 82;
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const den = kk[i] - mu * kAero;
      v[i] = den > 1e-6 ? Math.min(vmax, Math.sqrt((mu * g) / den)) : vmax;
    }
    // wzdluznie: przyspieszanie ograniczone moca, hamowanie ~1.4 g + docisk
    for (let pass = 0; pass < 2; pass++) {
      for (let q = 0; q < 2 * n; q++) {
        const i = q % n, j = (i + 1) % n;
        const vi = v[i];
        const latA = vi * vi * kk[i];
        const latMax = mu * (g + kAero * vi * vi);
        const fr = Math.sqrt(Math.max(0, 1 - (latA / latMax) ** 2));
        const aPow = Math.min(9.5, 360000 / (1300 * Math.max(vi, 5))) - (0.5 * 1.225 * 1.0 * vi * vi) / 1300 - g * this.grade[i];
        const vn = Math.sqrt(vi * vi + 2 * Math.max(0.3, aPow * fr) * ds[i]);
        if (vn < v[j]) v[j] = vn;
      }
      for (let q = 2 * n; q > 0; q--) {
        const i = q % n, j = (i - 1 + n) % n;
        const vi = v[i];
        const latA = vi * vi * kk[i];
        const latMax = mu * (g + kAero * vi * vi);
        const fr = Math.sqrt(Math.max(0, 1 - (latA / latMax) ** 2));
        const aBr = (1.3 * (g + kAero * vi * vi) + (0.5 * 1.225 * vi * vi) / 1300) * Math.max(0.15, fr) + g * this.grade[j];
        const vp = Math.sqrt(vi * vi + 2 * aBr * ds[j]);
        if (vp < v[j]) v[j] = vp;
      }
    }
    this.speedProfile = v;
  }

  // ------------------------------------------------------------------ krawezniki, pobocza, bariery
  _buildCurbsAndRunoff() {
    const n = this.n;
    const R = this.def.runoff;
    const curv = this.curv;
    const curbL = (this.curbL = new Float64Array(n));
    const curbR = (this.curbR = new Float64Array(n));
    const TH_IN = 1 / 260; // wewnetrzny kraweznik: promien < 260 m
    const TH_OUT = 1 / 170;
    const shift = 10; // ~25 m: kraweznik zewnetrzny na wyjsciu z zakretu
    const exitLen = 12;
    for (let i = 0; i < n; i++) {
      const c = curv[i];
      if (Math.abs(c) > TH_IN) {
        if (c > 0) curbL[i] = 1.1; else curbR[i] = 1.1;
      }
    }
    for (let i = 0; i < n; i++) {
      const c = curv[i];
      if (Math.abs(c) > TH_OUT) {
        for (let k = shift - 4; k < shift + exitLen; k++) {
          const j = (i + k) % n;
          if (c > 0) curbR[j] = Math.max(curbR[j], 1.4); else curbL[j] = Math.max(curbL[j], 1.4);
        }
      }
    }
    // usuwanie bardzo krotkich odcinkow i wypelnianie malych przerw
    const clean = (arr) => {
      // wypelnij przerwy < 6 probek
      for (let i = 0; i < n; i++) {
        if (arr[i] > 0 && arr[(i + 1) % n] === 0) {
          for (let k = 2; k < 6; k++) {
            if (arr[(i + k) % n] > 0) {
              for (let q = 1; q < k; q++) arr[(i + q) % n] = arr[i];
              break;
            }
          }
        }
      }
      // usun odcinki < 4 probek
      let i0 = 0;
      while (i0 < n && arr[i0] > 0) i0++;
      for (let q = 0; q < n; q++) {
        const i = (i0 + q) % n;
        if (arr[i] > 0 && arr[(i - 1 + n) % n] === 0) {
          let len = 0;
          while (len < n && arr[(i + len) % n] > 0) len++;
          if (len < 4) for (let k = 0; k < len; k++) arr[(i + k) % n] = 0;
        }
      }
    };
    clean(curbL);
    clean(curbR);

    // predkosc dojazdu (max z ostatnich ~150 m) -> szerokosc strefy wyjazdowej po zewnetrznej
    const vIn = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let mx = 0;
      for (let k = 0; k < 60; k++) mx = Math.max(mx, this.speedProfile[(i - k + n) % n]);
      vIn[i] = mx;
    }
    const outerL = new Float64Array(n), outerR = new Float64Array(n);
    const widthL = new Float64Array(n), widthR = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.curvWide[i];
      const corner = Math.abs(c) > 1 / 450;
      const outerW = R.outerBase + R.outerPerKmh * vIn[i] * 3.6;
      if (corner) {
        if (c > 0) { widthR[i] = outerW; outerR[i] = 1; widthL[i] = R.innerWidth; }
        else { widthL[i] = outerW; outerL[i] = 1; widthR[i] = R.innerWidth; }
      } else {
        widthL[i] = R.straightWidth;
        widthR[i] = R.straightWidth;
      }
    }
    // rozszerz strefy zewnetrzne do przodu (auto wypada za zakretem)
    const extend = (w, o) => {
      const w2 = Float64Array.from(w), o2 = Float64Array.from(o);
      for (let i = 0; i < n; i++) {
        if (o[i]) {
          for (let k = 1; k < 24; k++) {
            const j = (i + k) % n;
            const val = w[i] * (1 - k / 30);
            if (val > w2[j]) { w2[j] = val; o2[j] = 1; }
          }
        }
      }
      return [w2, o2];
    };
    let ext = extend(widthL, outerL);
    const wLx = gaussianClosed(maxFilterClosed(ext[0], 6), 5);
    const oL = ext[1];
    ext = extend(widthR, outerR);
    const wRx = gaussianClosed(maxFilterClosed(ext[0], 6), 5);
    const oR = ext[1];

    // ograniczenia: wnetrze ciasnych zakretow + inne fragmenty toru (diagram Voronoi)
    const limL = new Float64Array(n), limR = new Float64Array(n);
    const gridCell = 25;
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.floor(this.px[i] / gridCell) + ',' + Math.floor(this.pz[i] / gridCell);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
    const nearestFar = (x, z, i0, maxR) => {
      // najblizsza probka toru oddalona o > 80 m po luku
      const cx = Math.floor(x / gridCell), cz = Math.floor(z / gridCell);
      const rr = Math.ceil(maxR / gridCell) + 1;
      let bd = Infinity;
      for (let gx = cx - rr; gx <= cx + rr; gx++) {
        for (let gz = cz - rr; gz <= cz + rr; gz++) {
          const l = grid.get(gx + ',' + gz);
          if (!l) continue;
          for (const j of l) {
            let ds = Math.abs(this.s[j] - this.s[i0]);
            ds = Math.min(ds, this.length - ds);
            if (ds < 80) continue;
            const d = (this.px[j] - x) ** 2 + (this.pz[j] - z) ** 2;
            if (d < bd) bd = d;
          }
        }
      }
      return Math.sqrt(bd);
    };
    for (let i = 0; i < n; i++) {
      for (const side of [1, -1]) {
        const edge = side > 0 ? this.wL[i] : this.wR[i];
        const want = edge + (side > 0 ? wLx[i] : wRx[i]) + 2;
        let lim = want;
        for (let d = edge + 1; d <= want; d += 1) {
          const x = this.px[i] + this.nx[i] * d * side;
          const z = this.pz[i] + this.nz[i] * d * side;
          const far = nearestFar(x, z, i, d + 2);
          if (far < d + 1) { lim = Math.max(edge + 2.2, d - 2); break; }
        }
        // wnetrze zakretu: offset < 0.85 promienia
        const c = this.curv[i] * side;
        if (c > 1e-4) lim = Math.min(lim, Math.max(edge + 2.0, 0.85 / c));
        if (side > 0) limL[i] = lim; else limR[i] = lim;
      }
    }
    const bL = (this.barrierL = minFilterClosed(limL, 3));
    const bR = (this.barrierR = minFilterClosed(limR, 3));
    // lagodne wygladzenie (bez przekraczania limitow)
    const sL = gaussianClosed(bL, 3), sR = gaussianClosed(bR, 3);
    for (let i = 0; i < n; i++) {
      bL[i] = Math.max(this.wL[i] + 2.0, Math.min(sL[i], limL[i]));
      bR[i] = Math.max(this.wR[i] + 2.0, Math.min(sR[i], limR[i]));
    }

    // typy nawierzchni w strefach
    this.vergeTypeL = new Uint8Array(n); this.vergeTypeR = new Uint8Array(n);
    this.vergeWL = new Float64Array(n); this.vergeWR = new Float64Array(n);
    this.runTypeL = new Uint8Array(n); this.runTypeR = new Uint8Array(n);
    this.barrierTypeL = new Uint8Array(n); this.barrierTypeR = new Uint8Array(n); // 0 armco, 1 sciana, 2 opony
    for (let i = 0; i < n; i++) {
      for (const side of [1, -1]) {
        const outer = side > 0 ? oL[i] : oR[i];
        const edge = (side > 0 ? this.wL[i] : this.wR[i]) + (side > 0 ? curbL[i] : curbR[i]);
        const bar = side > 0 ? bL[i] : bR[i];
        const avail = bar - edge;
        let vergeT = outer ? R.outerVerge : R.verge;
        let vergeW = outer ? R.outerVergeWidth : R.vergeWidth;
        let runT = outer ? R.outer : R.straight;
        if (!outer && Math.abs(this.curvWide[i]) > 1 / 450) runT = R.inner;
        if (avail < 7) { runT = vergeT === SURF.RUNOFF ? SURF.RUNOFF : SURF.GRASS; }
        vergeW = Math.min(vergeW, avail);
        let btype = 0;
        if (avail < 5.5) btype = 1;
        else if (outer && avail > 22) btype = 2;
        if (side > 0) {
          this.vergeTypeL[i] = vergeT; this.vergeWL[i] = vergeW; this.runTypeL[i] = runT; this.barrierTypeL[i] = btype;
        } else {
          this.vergeTypeR[i] = vergeT; this.vergeWR[i] = vergeW; this.runTypeR[i] = runT; this.barrierTypeR[i] = btype;
        }
      }
    }
    // prosta start/meta: sciana betonowa po stronie alei serwisowej
    const pit = this.def.pitSide;
    for (let k = -100; k < 140; k++) {
      const i = this.idx(k);
      if (pit < 0) { this.barrierTypeR[i] = 1; this.runTypeR[i] = SURF.RUNOFF; } else { this.barrierTypeL[i] = 1; this.runTypeL[i] = SURF.RUNOFF; }
    }
    // wygladzone typy (bez migotania pojedynczych probek)
    const smoothType = (arr) => {
      const out = Uint8Array.from(arr);
      for (let i = 0; i < n; i++) {
        const a = arr[(i - 1 + n) % n], b = arr[(i + 1) % n];
        if (a === b && arr[i] !== a) out[i] = a;
      }
      return out;
    };
    this.runTypeL = smoothType(this.runTypeL);
    this.runTypeR = smoothType(this.runTypeR);
    this.barrierTypeL = smoothType(this.barrierTypeL);
    this.barrierTypeR = smoothType(this.barrierTypeR);
  }

  // ------------------------------------------------------------------ zapytania przestrzenne
  _buildGrid() {
    this.gridCell = 40;
    this.grid = new Map();
    for (let i = 0; i < this.n; i++) {
      const key = Math.floor(this.px[i] / this.gridCell) + ',' + Math.floor(this.pz[i] / this.gridCell);
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    }
  }

  /** globalne wyszukiwanie najblizszej probki */
  locateGlobal(x, z) {
    const c = this.gridCell;
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    let best = 0, bd = Infinity;
    for (let r = 0; r < 60; r++) {
      for (let gx = cx - r; gx <= cx + r; gx++) {
        for (let gz = cz - r; gz <= cz + r; gz++) {
          if (Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) !== r) continue;
          const l = this.grid.get(gx + ',' + gz);
          if (!l) continue;
          for (const i of l) {
            const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      if (bd < Infinity && (r - 1) * c > Math.sqrt(bd)) break;
    }
    return best;
  }

  /**
   * Rzut punktu na odcinek toru w otoczeniu probki hint (ciaglosc - brak przeskokow miedzy
   * blisko polozonymi fragmentami toru). Wynik: out.index (poczatek odcinka), out.t, out.lateral.
   */
  _project(x, z, hint, win, out) {
    const n = this.n;
    let bestI = hint, bestD = Infinity, bestT = 0, bestK = 0;
    let lo = -win, hi = win;
    for (let pass = 0; pass < 4; pass++) {
      for (let k = lo; k <= hi; k++) {
        const i = (((hint + k) % n) + n) % n;
        const j = (i + 1) % n;
        const ax = this.px[i], az = this.pz[i];
        const ex = this.px[j] - ax, ez = this.pz[j] - az;
        const l2 = ex * ex + ez * ez;
        let t = ((x - ax) * ex + (z - az) * ez) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - (ax + ex * t), dz = z - (az + ez * t);
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; bestI = i; bestT = t; bestK = k; }
      }
      // jesli minimum na brzegu okna - przesun okno
      if (bestK === hi) { lo = hi; hi = hi + win; continue; }
      if (bestK === lo) { hi = lo; lo = lo - win; continue; }
      break;
    }
    const i = bestI, j = (i + 1) % n, t = bestT;
    const cx = this.px[i] + (this.px[j] - this.px[i]) * t;
    const cz = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    const nnx = this.nx[i] + (this.nx[j] - this.nx[i]) * t;
    const nnz = this.nz[i] + (this.nz[j] - this.nz[i]) * t;
    const nl = Math.hypot(nnx, nnz);
    out.index = i;
    out.t = t;
    out.lateral = ((x - cx) * nnx + (z - cz) * nnz) / nl;
    return out;
  }

  /**
   * Mapa najblizszych probek toru na siatce (transformata odleglosci, 2 przebiegi 8-sasiedztwa).
   * Daje szybka i poprawna "podpowiedz" dla dowolnego punktu terenu (zamiast przeszukiwania
   * pustych komorek siatki dla punktow daleko od toru).
   */
  _buildNearestMap() {
    const T = this.terrain;
    const cell = 20;
    const x0 = T.x0 - 200, z0 = -(T.y0 + (T.ny - 1) * T.cell) - 200;
    const nx = Math.ceil(((T.nx - 1) * T.cell + 400) / cell) + 1;
    const nz = Math.ceil(((T.ny - 1) * T.cell + 400) / cell) + 1;
    const idx = new Int32Array(nx * nz).fill(-1);
    const dist = new Float32Array(nx * nz).fill(Infinity);
    const cx = (i) => x0 + i * cell, cz = (j) => z0 + j * cell;
    for (let k = 0; k < this.n; k++) {
      const i = Math.round((this.px[k] - x0) / cell), j = Math.round((this.pz[k] - z0) / cell);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const q = jj * nx + ii;
        const d = Math.hypot(cx(ii) - this.px[k], cz(jj) - this.pz[k]);
        if (d < dist[q]) { dist[q] = d; idx[q] = k; }
      }
    }
    const relax = (q, ii, jj) => {
      const k = idx[q];
      if (k < 0 || ii < 0 || jj < 0 || ii >= nx || jj >= nz) return;
      const r = jj * nx + ii;
      const d = Math.hypot(cx(ii) - this.px[k], cz(jj) - this.pz[k]);
      if (d < dist[r]) { dist[r] = d; idx[r] = k; }
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const q = j * nx + i;
        relax(q, i + 1, j); relax(q, i, j + 1); relax(q, i + 1, j + 1); relax(q, i - 1, j + 1);
      }
      for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
        const q = j * nx + i;
        relax(q, i - 1, j); relax(q, i, j - 1); relax(q, i - 1, j - 1); relax(q, i + 1, j - 1);
      }
    }
    this._nearest = { x0, z0, cell, nx, nz, idx };
  }

  /** szybka podpowiedz najblizszej probki toru dla punktu (x, z) */
  nearestHint(x, z) {
    if (!this._nearest) this._buildNearestMap();
    const N = this._nearest;
    const i = Math.round((x - N.x0) / N.cell), j = Math.round((z - N.z0) / N.cell);
    if (i < 0 || j < 0 || i >= N.nx || j >= N.nz) return this.locateGlobal(x, z);
    const k = N.idx[j * N.nx + i];
    return k >= 0 ? k : this.locateGlobal(x, z);
  }

  /** rzut punktu na tor: { index, t, lateral } (nowy obiekt) */
  project(x, z, hint = -1) {
    const out = { index: 0, t: 0, lateral: 0 };
    if (hint >= 0 && hint < this.n) return this._project(x, z, hint, 10, out);
    if (!this._nearest) this._buildNearestMap();
    const N = this._nearest;
    const ci = Math.round((x - N.x0) / N.cell), cj = Math.round((z - N.z0) / N.cell);
    if (ci < 1 || cj < 1 || ci >= N.nx - 1 || cj >= N.nz - 1) return this._project(x, z, this.locateGlobal(x, z), 10, out);
    // kandydaci z komorki i sasiadow (rozne fragmenty toru) -> wybierz rzeczywiscie najblizszy
    const cands = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const k = N.idx[(cj + dj) * N.nx + ci + di];
      if (k < 0) continue;
      if (cands.every((c) => { const d = Math.abs(c - k); return Math.min(d, this.n - d) > 16; })) cands.push(k);
    }
    if (!cands.length) return this._project(x, z, this.locateGlobal(x, z), 10, out);
    let best = Infinity;
    const tmp = { index: 0, t: 0, lateral: 0 };
    for (const k of cands) {
      this._project(x, z, k, 10, tmp);
      const i = tmp.index, j = (i + 1) % this.n;
      const px = this.px[i] + (this.px[j] - this.px[i]) * tmp.t, pz = this.pz[i] + (this.pz[j] - this.pz[i]) * tmp.t;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < best) { best = d; out.index = tmp.index; out.t = tmp.t; out.lateral = tmp.lateral; }
    }
    return out;
  }

  /** indeks probki toru dla pozycji (z ciagloscia, hint < 0 => wyszukiwanie globalne) */
  locate(x, z, hint = -1) {
    if (hint < 0 || hint >= this.n) hint = this.locateGlobal(x, z);
    this._project(x, z, hint, 10, _proj);
    return _proj.index;
  }

  /** odleglosc wzdluz toru (s) dla pozycji */
  distanceAlong(x, z, hint) {
    this._project(x, z, hint, 10, _proj);
    const i = _proj.index;
    return { s: this.s[i] + (this.s[i + 1] - this.s[i]) * _proj.t, lateral: _proj.lateral, index: i };
  }

  /** Probka nawierzchni dla fizyki: wysokosc, normalna, typ. */
  sample(x, z, hint, out) {
    this._project(x, z, hint, 10, _proj);
    const i = _proj.index, j = (i + 1) % this.n, t = _proj.t;
    const lat = _proj.lateral;
    const base = this.py[i] + (this.py[j] - this.py[i]) * t;
    const g = this.grade[i] + (this.grade[j] - this.grade[i]) * t;
    const tx = this.tx[i], tz = this.tz[i];
    // normalna z nachylenia wzdluznego
    let nx = -g * tx, ny = 1, nz = -g * tz;
    const side = lat >= 0 ? 1 : -1;
    const d = Math.abs(lat);
    const edge = side > 0 ? this.wL[i] : this.wR[i];
    const curb = side > 0 ? this.curbL[i] : this.curbR[i];
    let type = SURF.ASPHALT;
    let h = base;
    if (d > edge) {
      const e = d - edge;
      if (curb > 0 && e <= curb) {
        type = SURF.CURB;
        // profil: wznoszacy sie do 4 cm + poprzeczne "zebra" (rumble)
        const sAlong = this.s[i] + (this.s[i + 1] - this.s[i]) * t;
        const ramp = Math.min(1, e / 0.3);
        h += 0.035 * ramp + 0.008 * ramp * (Math.sin(sAlong * 7.85) > 0 ? 1 : 0);
        // nachylenie poprzeczne kraweznika (unosi kolo ku zewnatrz)
        if (e < 0.3) {
          nx += -side * this.nx[i] * 0.1;
          nz += -side * this.nz[i] * 0.1;
        }
      } else {
        const e2 = e - curb;
        const vergeW = side > 0 ? this.vergeWL[i] : this.vergeWR[i];
        type = e2 <= vergeW ? (side > 0 ? this.vergeTypeL[i] : this.vergeTypeR[i]) : (side > 0 ? this.runTypeL[i] : this.runTypeR[i]);
        if (type === SURF.GRASS) h += -0.03 + 0.012 * bumpNoise(x, z);
        else if (type === SURF.GRAVEL) h += -0.06 + 0.02 * bumpNoise(x * 1.7, z * 1.7);
        else if (type === SURF.RUNOFF) h += -0.005;
        if (type === SURF.GRASS || type === SURF.GRAVEL) {
          const k = type === SURF.GRAVEL ? 0.035 : 0.02;
          nx += k * Math.cos(x * 2.1 + z * 0.7);
          nz += k * Math.sin(z * 1.9 - x * 0.5);
        }
      }
    }
    const l = Math.hypot(nx, ny, nz);
    out.height = h;
    out.nx = nx / l;
    out.ny = ny / l;
    out.nz = nz / l;
    out.type = type;
    out.index = i;
    out.lateral = lat;
    return out;
  }

  /** Kolizja punktu z barierami: zwraca true i glebokosc + normalna (do srodka toru). */
  collide(x, z, hint, out) {
    this._project(x, z, hint, 10, _proj);
    const i = _proj.index, j = (i + 1) % this.n, t = _proj.t;
    const lat = _proj.lateral;
    const bl = this.barrierL[i] + (this.barrierL[j] - this.barrierL[i]) * t;
    const br = this.barrierR[i] + (this.barrierR[j] - this.barrierR[i]) * t;
    if (lat > bl) {
      out.pen = lat - bl;
      out.nx = -this.nx[i];
      out.nz = -this.nz[i];
      return true;
    }
    if (lat < -br) {
      out.pen = -br - lat;
      out.nx = this.nx[i];
      out.nz = this.nz[i];
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ pomiar czasu
  _buildTiming() {
    const L = this.length;
    // granice sektorow: ok. 1/3 i 2/3 dlugosci, przesuniete na najblizszy prosty fragment
    const findStraight = (sTarget) => {
      let best = 0, bv = Infinity;
      for (let i = 0; i < this.n; i++) {
        let ds = Math.abs(this.s[i] - sTarget);
        ds = Math.min(ds, L - ds);
        if (ds > 300) continue;
        const v = Math.abs(this.curvWide[i]) * 1000 + ds * 0.01;
        if (v < bv) { bv = v; best = i; }
      }
      return this.s[best];
    };
    this.sectorStarts = [0, findStraight(L / 3), findStraight((2 * L) / 3)];
    // punkty kontrolne co ~150 m
    const nc = Math.max(12, Math.round(L / 150));
    this.checkpoints = [];
    for (let k = 1; k < nc; k++) this.checkpoints.push((k / nc) * L);
    // pole startowe (12 m przed linia) i start lotny (60 m za ostatnim zakretem)
    this.gridIndex = this.idx(-Math.round(12 / 2.5));
    let lastCorner = this.n - 1;
    for (let i = this.n - 1; i > this.n * 0.7; i--) {
      if (Math.abs(this.curv[i]) > 1 / 120) { lastCorner = i; break; }
    }
    this.flyingIndex = this.idx(lastCorner + Math.round(60 / 2.5));
    const distToLine = L - this.s[this.flyingIndex];
    if (distToLine < 150 || distToLine > 1500) this.flyingIndex = this.idx(-Math.round(500 / 2.5));
  }

  // ------------------------------------------------------------------ teren (DEM)
  _buildTerrain() {
    const T = this.data.terrain;
    const bin = typeof atob === 'function'
      ? Uint8Array.from(atob(T.data), (c) => c.charCodeAt(0))
      : Uint8Array.from(Buffer.from(T.data, 'base64'));
    const h16 = new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2);
    const h = new Float32Array(h16.length);
    for (let i = 0; i < h.length; i++) h[i] = h16[i] * T.scale;
    this.terrain = { x0: T.x0, y0: T.y0, cell: T.cell, nx: T.nx, ny: T.ny, h };
  }

  /** surowa wysokosc DEM w punkcie swiata (x, z) */
  demHeight(x, z) {
    const T = this.terrain;
    const e = x, nN = -z;
    const fx = clamp((e - T.x0) / T.cell, 0, T.nx - 1.001);
    const fy = clamp((nN - T.y0) / T.cell, 0, T.ny - 1.001);
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const ax = fx - ix, ay = fy - iy;
    const H = T.h, W = T.nx;
    return (H[iy * W + ix] * (1 - ax) + H[iy * W + ix + 1] * ax) * (1 - ay) + (H[(iy + 1) * W + ix] * (1 - ax) + H[(iy + 1) * W + ix + 1] * ax) * ay;
  }

  /** wysokosc toru (na srodku) dla probki */
  heightAt(i) {
    return this.py[this.idx(i)];
  }

  bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.n; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
    }
    return { minX, maxX, minZ, maxZ };
  }

  /** pozycja i kierunek dla startu: { x, z, heading, index } */
  spawn(index, lateral = 0) {
    const i = this.idx(index);
    const x = this.px[i] + this.nx[i] * lateral;
    const z = this.pz[i] + this.nz[i] * lateral;
    return { x, z, heading: Math.atan2(this.tx[i], this.tz[i]), index: i };
  }
}

const _proj = { index: 0, t: 0, lateral: 0 };
