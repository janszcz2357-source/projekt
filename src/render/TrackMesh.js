// Geometria toru generowana z tych samych danych co fizyka (Track).
// Dzielona na fragmenty (chunki) wzdluz toru -> frustum culling. Wysokosci nawierzchni zgodne z
// Track.sample(): asfalt 0, kraweznik +3.5 cm, trawa -3 cm, zwir -6 cm.
import * as THREE from 'three';
import { SURF } from '../physics/surfaces.js';
import {
  asphaltTextures, grassTexture, gravelTexture, curbTexture, concreteTexture, fenceTexture,
  tyreWallTexture, adsTexture, crowdTexture, checkerTexture,
} from './textures.js';

const CHUNK = 128; // probek toru (~320 m) na fragment

/** Pomocnik budujacy geometrie z list wierzcholkow i trojkatow */
class GeoBuilder {
  constructor(withColor = false) {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = withColor ? [] : null;
    this.idx = [];
  }
  vert(x, y, z, nx, ny, nz, u, v, r = 1, g = 1, b = 1) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    if (this.col) this.col.push(r, g, b);
    return this.pos.length / 3 - 1;
  }
  quad(a, b, c, d) {
    // a-b na pierwszym wierszu, c-d na drugim (ta sama kolejnosc)
    this.idx.push(a, c, b, b, c, d);
  }
  get empty() {
    return this.idx.length === 0;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export function createTrackMaterials(quality) {
  const asp = asphaltTextures();
  const aniso = quality === 'low' ? 4 : 16;
  asp.map.anisotropy = aniso;
  asp.roughness.anisotropy = aniso;
  const grass = grassTexture();
  const gravel = gravelTexture();
  const M = {
    asphalt: new THREE.MeshStandardMaterial({ map: asp.map, roughnessMap: asp.roughness, roughness: 0.92, metalness: 0.0, vertexColors: true }),
    runoff: new THREE.MeshStandardMaterial({ map: asp.map, roughness: 0.95, color: 0xb9bcc0, vertexColors: false }),
    line: new THREE.MeshStandardMaterial({ color: 0xf3f3f0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    curb: new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.65 }),
    grass: new THREE.MeshStandardMaterial({ map: grass, roughness: 1.0, vertexColors: true }),
    gravel: new THREE.MeshStandardMaterial({ map: gravel, roughness: 1.0 }),
    armco: new THREE.MeshStandardMaterial({ color: 0xc7ccd2, metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide }),
    post: new THREE.MeshStandardMaterial({ color: 0x7c8187, metalness: 0.6, roughness: 0.5 }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.9 }),
    ads: new THREE.MeshStandardMaterial({ map: adsTexture(), roughness: 0.6 }),
    fence: new THREE.MeshStandardMaterial({ map: fenceTexture(), transparent: false, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 }),
    tyres: new THREE.MeshStandardMaterial({ map: tyreWallTexture(), roughness: 0.9 }),
    checker: new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    crowd: new THREE.MeshStandardMaterial({ map: crowdTexture(), roughness: 0.9 }),
    building: new THREE.MeshStandardMaterial({ color: 0xd9dadc, roughness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.8 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }),
    steel: new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.5, metalness: 0.6 }),
  };
  M.ads.map.anisotropy = aniso;
  return M;
}

export class TrackMesh {
  constructor(track, materials, opts = {}) {
    this.track = track;
    this.M = materials;
    this.opts = opts;
    this.group = new THREE.Group();
    this.group.name = 'track';
    this.chunks = [];
    this._build();
  }

  // pozycja punktu: probka i, offset boczny, offset wysokosci
  _p(i, lat, dy, out) {
    const t = this.track;
    out[0] = t.px[i] + t.nx[i] * lat;
    out[1] = t.py[i] + dy;
    out[2] = t.pz[i] + t.nz[i] * lat;
    return out;
  }

  _normal(i) {
    const t = this.track;
    const g = t.grade[i];
    const l = Math.hypot(g, 1);
    return [(-g * t.tx[i]) / l, 1 / l, (-g * t.tz[i]) / l];
  }

  _build() {
    const t = this.track;
    const n = t.n;
    for (let c0 = 0; c0 < n; c0 += CHUNK) {
      const c1 = Math.min(n, c0 + CHUNK); // probki c0..c1 (wlacznie, z zawinieciem)
      const chunk = new THREE.Group();
      this._buildSurfaces(chunk, c0, c1);
      this._buildBarriers(chunk, c0, c1);
      this.group.add(chunk);
      this.chunks.push(chunk);
    }
    this._buildStartLine();
    this._buildGantry();
  }

  /** asfalt, linie, krawezniki, pobocza, strefy wyjazdowe, pas trawy do terenu */
  _buildSurfaces(group, c0, c1) {
    const t = this.track;
    const n = t.n;
    const asphalt = new GeoBuilder(true);
    const lines = new GeoBuilder();
    const curbs = new GeoBuilder();
    const grass = new GeoBuilder(true);
    const gravel = new GeoBuilder();
    const runoff = new GeoBuilder();
    const P = [0, 0, 0];
    const COLS = 9;
    let prevA = null;
    const lineW = 0.16;
    // asfalt z "gumowaniem" linii wyscigowej
    for (let k = c0; k <= c1; k++) {
      const i = k % n;
      const nr = this._normal(i);
      const v = t.s[k] / 5;
      const row = [];
      const wl = t.wL[i], wr = t.wR[i];
      // ile hamowania w okolicy -> wiecej gumy
      const sp = t.speedProfile;
      const brake = Math.max(0, (sp[(i + n - 8) % n] - sp[i]) / Math.max(sp[i], 10));
      for (let c = 0; c < COLS; c++) {
        const lat = -wr + ((wl + wr) * c) / (COLS - 1);
        this._p(i, lat, 0, P);
        const d = Math.abs(lat - t.raceLat[i]);
        const rub = Math.exp(-((d / 1.0) ** 2)) * (0.32 + Math.min(0.25, brake * 1.5));
        const edge = Math.min(1, Math.min(wl - lat, lat + wr) / 1.2);
        const shade = (1 - rub) * (0.92 + 0.08 * edge) + (1 - edge) * 0.08;
        row.push(asphalt.vert(P[0], P[1], P[2], nr[0], nr[1], nr[2], (lat + wr) / 5, v, shade, shade, shade * 1.01));
      }
      if (prevA) for (let c = 0; c < COLS - 1; c++) asphalt.quad(prevA[c], prevA[c + 1], row[c], row[c + 1]);
      prevA = row;
    }
    // biale linie krawedzi (lekko nad asfaltem)
    for (const side of [1, -1]) {
      let prev = null;
      for (let k = c0; k <= c1; k++) {
        const i = k % n;
        const nr = this._normal(i);
        const e = side > 0 ? t.wL[i] : t.wR[i];
        const a = this._p(i, side * (e - 0.05), 0.004, [0, 0, 0]);
        const b = this._p(i, side * (e - 0.05 - lineW), 0.004, [0, 0, 0]);
        const row = [lines.vert(...a, ...nr, 0, 0), lines.vert(...b, ...nr, 1, 0)];
        if (prev) {
          if (side > 0) lines.quad(prev[1], prev[0], row[1], row[0]);
          else lines.quad(prev[0], prev[1], row[0], row[1]);
        }
        prev = row;
      }
    }
    // krawezniki (profil: krawedz 0 cm -> 3.5 cm po 0.3 m -> plasko)
    for (const side of [1, -1]) {
      let prev = null;
      for (let k = c0; k <= c1; k++) {
        const i = k % n;
        const w = side > 0 ? t.curbL[i] : t.curbR[i];
        const wn = side > 0 ? t.curbL[(i + 1) % n] : t.curbR[(i + 1) % n];
        const wp = side > 0 ? t.curbL[(i - 1 + n) % n] : t.curbR[(i - 1 + n) % n];
        if (w <= 0 && wp <= 0) { prev = null; continue; }
        const cw = Math.max(w, wp > 0 && w <= 0 ? 0.01 : w);
        const e = side > 0 ? t.wL[i] : t.wR[i];
        const nr = this._normal(i);
        const v = t.s[k] / 2.0;
        const lats = [e, e + Math.min(0.3, cw), e + cw];
        const hs = [0.0, 0.035, 0.035];
        const row = lats.map((lat, q) => {
          const p = this._p(i, side * lat, hs[q], [0, 0, 0]);
          return curbs.vert(p[0], p[1], p[2], nr[0], nr[1], nr[2], v, q / 2);
        });
        if (prev) {
          for (let q = 0; q < 2; q++) {
            if (side > 0) curbs.quad(prev[q], prev[q + 1], row[q], row[q + 1]);
            else curbs.quad(prev[q + 1], prev[q], row[q + 1], row[q]);
          }
        }
        prev = w > 0 ? row : null;
      }
    }
    // pobocze i strefa wyjazdowa: kazdy pas trafia do geometrii wg typu nawierzchni
    const builders = { [SURF.GRASS]: grass, [SURF.GRAVEL]: gravel, [SURF.RUNOFF]: runoff };
    const dyOf = { [SURF.GRASS]: -0.03, [SURF.GRAVEL]: -0.06, [SURF.RUNOFF]: -0.005 };
    for (const side of [1, -1]) {
      for (let k = c0; k < c1; k++) {
        const i = k % n, j = (k + 1) % n;
        const zones = [];
        for (const q of [i, j]) {
          const e = (side > 0 ? t.wL[q] : t.wR[q]) + (side > 0 ? t.curbL[q] : t.curbR[q]);
          const vw = side > 0 ? t.vergeWL[q] : t.vergeWR[q];
          const b = side > 0 ? t.barrierL[q] : t.barrierR[q];
          const ring = Math.min(b + 12, t.curv[q] * side > 1e-3 ? Math.max(b, 0.9 / (t.curv[q] * side)) : b + 12);
          zones.push({ e, v: Math.min(e + vw, b), b, ring });
        }
        const vt = side > 0 ? t.vergeTypeL[i] : t.vergeTypeR[i];
        const rt = side > 0 ? t.runTypeL[i] : t.runTypeR[i];
        const strips = [
          [vt, zones[0].e, zones[0].v, zones[1].e, zones[1].v],
          [rt, zones[0].v, zones[0].b, zones[1].v, zones[1].b],
          [SURF.GRASS, zones[0].b, zones[0].ring, zones[1].b, zones[1].ring, true],
        ];
        for (const [type, a0, b0, a1, b1, isRing] of strips) {
          if (b0 - a0 < 0.05 && b1 - a1 < 0.05) continue;
          const gb = builders[type] || grass;
          const dy = dyOf[type] ?? -0.03;
          const ni = this._normal(i), nj = this._normal(j);
          const pa = this._p(i, side * a0, dy, [0, 0, 0]);
          const pb = this._p(i, side * b0, isRing ? -0.12 : dy, [0, 0, 0]);
          const pc = this._p(j, side * a1, dy, [0, 0, 0]);
          const pd = this._p(j, side * b1, isRing ? -0.12 : dy, [0, 0, 0]);
          const uvs = 1 / 6;
          // pasy koszenia trawy (co 10 m)
          const stripe = Math.floor(t.s[k] / 10) % 2 ? 1.0 : 0.88;
          const sh = isRing ? 0.95 : stripe;
          const args = (p, nr) => [p[0], p[1], p[2], nr[0], nr[1], nr[2], p[0] * uvs, p[2] * uvs, sh, sh, sh];
          const ia = gb.vert(...args(pa, ni)), ib = gb.vert(...args(pb, ni));
          const ic = gb.vert(...args(pc, nj)), id = gb.vert(...args(pd, nj));
          if (side > 0) gb.quad(ia, ib, ic, id); else gb.quad(ib, ia, id, ic);
        }
      }
    }
    const add = (gb, mat, receive = true) => {
      if (gb.empty) return;
      const m = new THREE.Mesh(gb.build(), mat);
      m.receiveShadow = receive;
      m.matrixAutoUpdate = false;
      group.add(m);
    };
    add(asphalt, this.M.asphalt);
    add(lines, this.M.line);
    add(curbs, this.M.curb);
    add(grass, this.M.grass);
    add(gravel, this.M.gravel);
    add(runoff, this.M.runoff);
  }

  /** bariery: armco, betonowa sciana (+ reklamy, siatka), sciana opon */
  _buildBarriers(group, c0, c1) {
    const t = this.track;
    const n = t.n;
    const armco = new GeoBuilder();
    const wall = new GeoBuilder();
    const ads = new GeoBuilder();
    const fence = new GeoBuilder();
    const tyres = new GeoBuilder();
    const posts = [];
    const rows = adsTexture().userData.rows;
    for (const side of [1, -1]) {
      let prevKey = null;
      let prev = null;
      for (let k = c0; k <= c1; k++) {
        const i = k % n;
        const type = side > 0 ? t.barrierTypeL[i] : t.barrierTypeR[i];
        const b = side > 0 ? t.barrierL[i] : t.barrierR[i];
        const base = t.py[i] - 0.05;
        const P = (lat, h) => [t.px[i] + t.nx[i] * side * lat, base + h, t.pz[i] + t.nz[i] * side * lat];
        const inward = [-t.nx[i] * side, 0, -t.nz[i] * side];
        const u = t.s[k];
        const cur = { type, i, k };
        // profil dla danego typu (lista punktow (lat, h) od strony toru) + wierzcholki
        const rowArmco = () => {
          const pts = [[b, 0.45], [b, 0.62], [b + 0.05, 0.66], [b, 0.70], [b, 0.82]];
          return pts.map(([l, h], q) => armco.vert(...P(l, h), ...inward, u / 4, q / 4));
        };
        const rowWall = () => {
          const pts = [[b, 0.0], [b, 1.05], [b + 0.4, 1.05], [b + 0.4, 0]];
          const nrms = [inward, inward, [0, 1, 0], [-inward[0], 0, -inward[2]]];
          return pts.map(([l, h], q) => wall.vert(...P(l, h), ...nrms[q], u / 3, h / 3));
        };
        const rowAds = () => {
          const seg = Math.floor(u / 36);
          const r = ((seg * 7 + (side > 0 ? 3 : 0)) % rows + rows) % rows;
          const v0 = 1 - (r + 0.95) / rows, v1 = 1 - (r + 0.05) / rows;
          let uu = (u % 36) / 36;
          if (side < 0) uu = 1 - uu; // prawa strona: tekst czytany w przeciwnym kierunku
          return [ads.vert(...P(b - 0.01, 0.15), ...inward, uu, v0), ads.vert(...P(b - 0.01, 0.95), ...inward, uu, v1)];
        };
        const rowFence = () => [fence.vert(...P(b + 0.2, 1.05), ...inward, u / 3, 0), fence.vert(...P(b + 0.2, 4.2), ...inward, u / 3, 1.05)];
        const rowTyres = () => {
          const pts = [[b, 0], [b, 0.95], [b + 1.0, 0.95]];
          const nrms = [inward, inward, [0, 1, 0]];
          return pts.map(([l, h], q) => tyres.vert(...P(l, h), ...nrms[q], u / 2.5, h / 2.4 + q * 0.1));
        };
        let row;
        if (type === 1) row = { wall: rowWall(), ads: rowAds(), fence: rowFence() };
        else if (type === 2) row = { tyres: rowTyres(), armco: rowArmco() };
        else row = { armco: rowArmco() };
        if (prev && prevKey === type) {
          const link = (gb, a, c, flip) => {
            for (let q = 0; q < a.length - 1; q++) {
              if (flip) gb.quad(a[q + 1], a[q], c[q + 1], c[q]);
              else gb.quad(a[q], a[q + 1], c[q], c[q + 1]);
            }
          };
          const flip = side < 0;
          if (row.armco) link(armco, prev.armco, row.armco, flip);
          if (row.wall) link(wall, prev.wall, row.wall, flip);
          if (row.ads) {
            // reklamy: nowy segment co 36 m -> nie laczymy przez granice
            if (Math.floor(t.s[k] / 36) === Math.floor(t.s[k - 1 >= 0 ? k - 1 : 0] / 36)) link(ads, prev.ads, row.ads, flip);
            else row.ads = rowAds();
          }
          if (row.fence) link(fence, prev.fence, row.fence, flip);
          if (row.tyres) link(tyres, prev.tyres, row.tyres, flip);
        }
        if (type !== 1 && k % 2 === 0) posts.push(P(b + 0.08, 0.4));
        prev = row;
        prevKey = type;
        void cur;
      }
    }
    const add = (gb, mat, cast = true) => {
      if (gb.empty) return;
      const m = new THREE.Mesh(gb.build(), mat);
      m.castShadow = cast && this.opts.barrierShadows;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      group.add(m);
    };
    add(armco, this.M.armco);
    add(wall, this.M.concrete);
    add(ads, this.M.ads, false);
    add(fence, this.M.fence, false);
    add(tyres, this.M.tyres);
    if (posts.length) {
      const geo = new THREE.BoxGeometry(0.1, 0.8, 0.1);
      const im = new THREE.InstancedMesh(geo, this.M.post, posts.length);
      const m4 = new THREE.Matrix4();
      posts.forEach((p, q) => im.setMatrixAt(q, m4.makeTranslation(p[0], p[1], p[2])));
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  /** linia startu/mety (szachownica) i pola startowe */
  _buildStartLine() {
    const t = this.track;
    const gb = new GeoBuilder();
    const i0 = 0;
    const nr = this._normal(i0);
    const wl = t.wL[i0], wr = t.wR[i0];
    const P = (i, lat, ds) => {
      const p = this._p(i, lat, 0.006, [0, 0, 0]);
      p[0] += t.tx[i] * ds; p[2] += t.tz[i] * ds;
      return p;
    };
    const a = gb.vert(...P(i0, wl, -0.6), ...nr, 0, 0);
    const b = gb.vert(...P(i0, -wr, -0.6), ...nr, (wl + wr) / 1.2, 0);
    const c = gb.vert(...P(i0, wl, 0.6), ...nr, 0, 1);
    const d = gb.vert(...P(i0, -wr, 0.6), ...nr, (wl + wr) / 1.2, 1);
    gb.quad(a, b, c, d);
    const m = new THREE.Mesh(gb.build(), this.M.checker);
    m.receiveShadow = true;
    this.group.add(m);
    // pola startowe (biale "L")
    const lines = new GeoBuilder();
    for (let slot = 0; slot < 10; slot++) {
      const dist = 12 + slot * 8;
      const i = t.idx(-Math.round(dist / 2.5));
      const lat = slot % 2 === 0 ? 2.2 : -2.2;
      const nrr = this._normal(i);
      const q = [P(i, lat + 1.2, 0), P(i, lat - 1.2, 0), P(i, lat + 1.2, 0.25), P(i, lat - 1.2, 0.25)];
      const idx = q.map((p) => lines.vert(...p, ...nrr, 0, 0));
      lines.quad(idx[0], idx[1], idx[2], idx[3]);
    }
    const lm = new THREE.Mesh(lines.build(), this.M.line);
    lm.receiveShadow = true;
    this.group.add(lm);
  }

  /** brama ze swiatlami startowymi nad linia startu */
  _buildGantry() {
    const t = this.track;
    const i = t.idx(-3);
    const g = new THREE.Group();
    const wl = t.wL[i] + t.curbL[i] + 1.2, wr = t.wR[i] + t.curbR[i] + 1.2;
    const base = new THREE.Vector3(t.px[i], t.py[i], t.pz[i]);
    const left = new THREE.Vector3(t.nx[i], 0, t.nz[i]);
    const span = wl + wr;
    const postGeo = new THREE.BoxGeometry(0.5, 7.5, 0.5);
    for (const lat of [wl, -wr]) {
      const p = new THREE.Mesh(postGeo, this.M.steel);
      p.position.copy(base).addScaledVector(left, lat);
      p.position.y += 3.75;
      p.castShadow = true;
      g.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.9, 0.7), this.M.steel);
    beam.position.copy(base).addScaledVector(left, (wl - wr) / 2);
    beam.position.y += 7.2;
    beam.rotation.y = Math.atan2(t.tx[i], t.tz[i]);
    beam.castShadow = true;
    g.add(beam);
    // swiatla (5 kolumn x 2 rzedy)
    this.startLights = [];
    const lampGeo = new THREE.CircleGeometry(0.22, 16);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.2, 0.4), this.M.dark);
    housing.position.copy(beam.position);
    housing.position.y -= 0.9;
    housing.rotation.y = beam.rotation.y;
    g.add(housing);
    const fwd = new THREE.Vector3(t.tx[i], 0, t.tz[i]);
    for (let col = 0; col < 5; col++) {
      const pair = [];
      for (let row = 0; row < 2; row++) {
        const mat = new THREE.MeshBasicMaterial({ color: 0x220000 });
        const lamp = new THREE.Mesh(lampGeo, mat);
        lamp.position.copy(housing.position).addScaledVector(left, (2 - col) * 0.65).addScaledVector(fwd, -0.21);
        lamp.position.y += row === 0 ? 0.25 : -0.25;
        lamp.lookAt(lamp.position.clone().sub(fwd));
        g.add(lamp);
        pair.push(mat);
      }
      this.startLights.push(pair);
    }
    this.group.add(g);
  }

  /** ustawia swiatla startowe: n zapalonych (0..5), 'go' = wszystkie zgaszone */
  setStartLights(count) {
    if (!this.startLights) return;
    this.startLights.forEach((pair, k) => pair.forEach((m) => m.color.setHex(k < count ? 0xff1a1a : 0x220000)));
  }

  /** pokazuje/ukrywa fragmenty dalej niz maxDist od kamery (oprocz frustum cullingu) */
  updateVisibility(camPos, maxDist) {
    const md2 = maxDist * maxDist;
    for (const c of this.chunks) {
      const bs = c.children[0]?.geometry?.boundingSphere;
      if (!bs) continue;
      const d2 = bs.center.distanceToSquared(camPos) - bs.radius * bs.radius;
      c.visible = d2 < md2;
    }
  }
}

/**
 * Trybuny, budynek boksow, posterunki porzadkowe - ekstrudowane wzdluz toru.
 */
export function buildTrackside(track, M, def) {
  const group = new THREE.Group();
  const t = track;
  const n = t.n;
  const extrude = (k0, k1, side, profile, mat, uvScale = 1) => {
    // profile: [[latOffsetFromBarrier, h], ...] (od strony toru)
    const gb = new GeoBuilder();
    let prev = null;
    for (let k = k0; k <= k1; k++) {
      const i = t.idx(k);
      const b = side > 0 ? t.barrierL[i] : t.barrierR[i];
      const row = profile.map(([l, h], q) => {
        const lat = side * (b + l);
        const p = [t.px[i] + t.nx[i] * lat, t.py[i] + h, t.pz[i] + t.nz[i] * lat];
        return gb.vert(p[0], p[1], p[2], 0, 1, 0, (t.s[t.idx(k)] / 8) * uvScale, q / (profile.length - 1));
      });
      if (prev) {
        for (let q = 0; q < row.length - 1; q++) {
          if (side > 0) gb.quad(prev[q], prev[q + 1], row[q], row[q + 1]);
          else gb.quad(prev[q + 1], prev[q], row[q + 1], row[q]);
        }
      }
      prev = row;
    }
    const geo = gb.build();
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
  };
  // trybuny
  for (const [frac, sideSign] of def.grandstands || []) {
    const kc = Math.round(frac * n);
    const len = 36; // probek (~90 m)
    const side = sideSign;
    const off = 7;
    const tiers = [];
    for (let q = 0; q <= 10; q++) tiers.push([off + q * 1.3, 1.2 + q * 0.75]);
    extrude(kc - len / 2, kc + len / 2, side, [[off, 0], ...tiers], M.crowd, 1);
    extrude(kc - len / 2, kc + len / 2, side, [[off + 13, 9.5], [off + 13, 0]], M.building);
    extrude(kc - len / 2, kc + len / 2, side, [[off - 1, 12], [off + 14, 13.2]], M.roof);
  }
  // budynek boksow wzdluz prostej startowej + aleja serwisowa
  const ps = def.pitSide || -1;
  extrude(-70, 90, ps, [[0.4, 0.0], [15, 0.0]], M.runoff);
  extrude(-70, 90, ps, [[15, 0], [15, 4.2]], M.dark, 2);
  extrude(-70, 90, ps, [[15, 4.2], [15, 4.6], [14, 4.6], [14, 8.4]], M.building);
  extrude(-70, 90, ps, [[14, 8.4], [14.2, 11.5]], M.glass);
  extrude(-70, 90, ps, [[13, 11.5], [32, 11.8]], M.roof);
  // posterunki porzadkowe co ~400 m
  const postGeo = new THREE.BoxGeometry(2.2, 2.4, 2.2);
  const flagGeo = new THREE.BoxGeometry(0.05, 0.9, 1.4);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.6 });
  const step = Math.round(400 / 2.5);
  const count = Math.floor(n / step);
  const huts = new THREE.InstancedMesh(postGeo, M.building, count);
  const flags = new THREE.InstancedMesh(flagGeo, flagMat, count);
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  for (let c = 0; c < count; c++) {
    const i = (c * step + 40) % n;
    const side = c % 2 ? 1 : -1;
    const b = side > 0 ? t.barrierL[i] : t.barrierR[i];
    const lat = side * (b + 2.5);
    const pos = new THREE.Vector3(t.px[i] + t.nx[i] * lat, t.py[i] + 1.2, t.pz[i] + t.nz[i] * lat);
    q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(t.tx[i], t.tz[i]));
    huts.setMatrixAt(c, m4.compose(pos, q4, new THREE.Vector3(1, 1, 1)));
    pos.y += 1.6;
    flags.setMatrixAt(c, m4.compose(pos, q4, new THREE.Vector3(1, 1, 1)));
  }
  huts.computeBoundingSphere();
  flags.computeBoundingSphere();
  group.add(huts, flags);
  return group;
}

export { GeoBuilder };
