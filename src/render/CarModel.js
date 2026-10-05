// Proceduralny model samochodu GT (karoseria lofowana z przekrojow, kola, swiatla, kokpit).
// Uklad lokalny jak w fizyce: +X lewo, +Y gora, +Z przod, poczatek w srodku ciezkosci.
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// monotoniczna interpolacja kawalkami (krzywe profilu nadwozia)
function curve(points) {
  const P = points.slice().sort((a, b) => a[0] - b[0]);
  return (x) => {
    if (x <= P[0][0]) return P[0][1];
    if (x >= P[P.length - 1][0]) return P[P.length - 1][1];
    let i = 1;
    while (P[i][0] < x) i++;
    const [x0, y0] = P[i - 1], [x1, y1] = P[i];
    const t = (x - x0) / (x1 - x0);
    const s = t * t * (3 - 2 * t);
    return y0 + (y1 - y0) * (0.35 * t + 0.65 * s);
  };
}

/** loft: lista stacji z, funkcja przekroju z -> [[x, y], ...] (od lewego dolu przez gore do prawego dolu) */
function loft(zs, section, { capFront = false, capRear = false, uvV = null } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  const zMin = zs[0], zMax = zs[zs.length - 1];
  let cols = 0;
  zs.forEach((z, si) => {
    const pts = section(z);
    cols = pts.length;
    pts.forEach(([x, y], k) => {
      pos.push(x, y, z);
      uv.push((z - zMin) / (zMax - zMin), uvV ? uvV(k, pts.length) : k / (pts.length - 1));
    });
    if (si > 0) {
      const a0 = (si - 1) * cols, b0 = si * cols;
      for (let k = 0; k < cols - 1; k++) idx.push(a0 + k, a0 + k + 1, b0 + k, a0 + k + 1, b0 + k + 1, b0 + k);
    }
  });
  const capAt = (si, flip) => {
    const base = si * cols;
    let cx = 0, cy = 0;
    for (let k = 0; k < cols; k++) { cx += pos[(base + k) * 3]; cy += pos[(base + k) * 3 + 1]; }
    const c = pos.length / 3;
    pos.push(cx / cols, cy / cols, zs[si]);
    uv.push(si === 0 ? 0 : 1, 0.5);
    for (let k = 0; k < cols - 1; k++) {
      if (flip) idx.push(c, base + k, base + k + 1); else idx.push(c, base + k + 1, base + k);
    }
  };
  if (capRear) capAt(0, false);
  if (capFront) capAt(zs.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function range(a, b, n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  return out;
}

export const PAINTS = {
  rosso: { name: 'Rosso Corsa', color: 0xb3121c },
  blu: { name: 'Blu Racing', color: 0x1747a6 },
  arancio: { name: 'Arancio', color: 0xf26a10 },
  bianco: { name: 'Bianco', color: 0xe9eaec },
  nero: { name: 'Nero', color: 0x121316 },
  verde: { name: 'British Green', color: 0x0d4d32 },
  giallo: { name: 'Giallo', color: 0xf2c200 },
  argento: { name: 'Argento', color: 0x9aa0a8 },
};

function liveryTexture(baseHex) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext('2d');
  const base = new THREE.Color(baseHex);
  ctx.fillStyle = '#' + base.getHexString();
  ctx.fillRect(0, 0, 1024, 512);
  // pasy wzdluz srodka (v ~ 0.5) - w obrazie y ~ 256
  const lum = base.r * 0.3 + base.g * 0.59 + base.b * 0.11;
  const stripe = lum > 0.5 ? '#16181c' : '#f4f4f4';
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 256 - 34, 1024, 18);
  ctx.fillRect(0, 256 + 16, 1024, 18);
  // linia przy progu (dol boczny)
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, 1024, 26);
  ctx.fillRect(0, 486, 1024, 26);
  // szczeliny paneli (drzwi) - u ~ pozycja wzdluzna
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  for (const u of [0.43, 0.6]) {
    ctx.beginPath(); ctx.moveTo(u * 1024, 20); ctx.lineTo(u * 1024, 150); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(u * 1024, 362); ctx.lineTo(u * 1024, 492); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function decalTexture(number) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(128, 128, 118, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#111';
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.font = 'bold 150px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CarModel {
  constructor(cfg, { paint = 'rosso', number = 27, envMap = null } = {}) {
    this.cfg = cfg;
    this.root = new THREE.Group(); // pozycja/orientacja z fizyki
    this.root.name = 'car';
    this.body = new THREE.Group(); // nadwozie (offset do ziemi)
    this.root.add(this.body);
    this.groundY = -cfg.cgHeight; // ziemia w ukladzie lokalnym
    this.exterior = new THREE.Group();
    this.interior = new THREE.Group();
    this.driver = new THREE.Group();
    this.body.add(this.exterior, this.interior, this.driver);
    this.body.position.y = this.groundY;

    this.mats = {
      paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: liveryTexture(PAINTS[paint]?.color ?? PAINTS.rosso.color), metalness: 0.25, roughness: 0.4, clearcoat: 0.75, clearcoatRoughness: 0.14, envMapIntensity: 0.75 }),
      paintPlain: new THREE.MeshPhysicalMaterial({ color: PAINTS[paint]?.color ?? PAINTS.rosso.color, metalness: 0.25, roughness: 0.4, clearcoat: 0.75, clearcoatRoughness: 0.14, envMapIntensity: 0.75 }),
      carbon: new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.45, metalness: 0.3 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.8 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0f14, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1.0, roughness: 0.18 }),
      head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdde8ff, emissiveIntensity: 1.0, roughness: 0.15 }),
      tail: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0.6, roughness: 0.3 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.88 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.85, roughness: 0.32 }),
      disc: new THREE.MeshStandardMaterial({ color: 0x6a6d72, metalness: 0.9, roughness: 0.45, emissive: 0xff4400, emissiveIntensity: 0 }),
      caliper: new THREE.MeshStandardMaterial({ color: 0xd4a000, roughness: 0.4, metalness: 0.3 }),
      interior: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.85 }),
      cage: new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.7, roughness: 0.4 }),
      suit: new THREE.MeshStandardMaterial({ color: 0x1a3d8f, roughness: 0.8 }),
      helmet: new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, roughness: 0.25, clearcoat: 1 }),
      blur: new THREE.MeshStandardMaterial({ color: 0x33363b, metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.85 }),
    };
    if (envMap) Object.values(this.mats).forEach((m) => { if ('envMap' in m) m.envMap = envMap; });
    this.number = number;
    this._buildBody();
    this._buildAero();
    this._buildLights();
    this._buildWheels();
    this._buildInterior();
    this._buildDriver();
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = !o.material.transparent;
        o.receiveShadow = true;
      }
    });
    this.cockpitMode = false;
  }

  setPaint(key) {
    this.mats.paintPlain.color.setHex(PAINTS[key]?.color ?? PAINTS.rosso.color);
    const old = this.mats.paint.map;
    this.mats.paint.map = liveryTexture(PAINTS[key]?.color ?? PAINTS.rosso.color);
    this.mats.paint.needsUpdate = true;
    old?.dispose();
  }

  // ------------------------------------------------------------------ nadwozie
  _profiles() {
    const fa = this.cfg.cgToFrontAxle, ra = -(this.cfg.wheelbase - fa);
    const B = this.cfg.body;
    const zf = B.front, zr = B.rear;
    this.zf = zf; this.zr = zr; this.fa = fa; this.ra = ra;
    const top = curve([[zf, 0.40], [zf - 0.13, 0.56], [zf - 0.45, 0.67], [fa, 0.77], [0.95, 0.84], [0.85, 0.87], [0.40, 1.06], [0.02, 1.18], [-0.35, 1.20], [-0.85, 1.16], [-1.3, 1.05], [-1.72, 0.95], [zr + 0.2, 0.93], [zr, 0.90]]);
    const shoulder = curve([[zf, 0.40], [zf - 0.13, 0.55], [zf - 0.45, 0.70], [fa, 0.81], [0.95, 0.80], [0.55, 0.85], [-0.3, 0.88], [ra, 0.95], [-1.85, 0.95], [zr, 0.90]]);
    const half = curve([[zf, 0.72], [zf - 0.13, 0.86], [zf - 0.45, 0.95], [fa, 0.995], [0.85, 0.95], [0.2, 0.925], [-0.45, 0.94], [ra, 1.01], [-1.9, 0.985], [zr, 0.90]]);
    const arch = (z) => {
      let yb = 0.11;
      if (z > zf - 0.3) yb = 0.11 + (z - (zf - 0.3)) * 0.25;
      if (z < zr + 0.35) yb = 0.17;
      for (const [az, r] of [[fa, 0.43], [ra, 0.44]]) {
        const d = Math.abs(z - az);
        if (d < r) yb = Math.max(yb, 0.335 + Math.sqrt(r * r - d * d));
      }
      return yb;
    };
    return { top, shoulder, half, arch };
  }

  _buildBody() {
    const { top, shoulder, half, arch } = this._profiles();
    const zf = this.zf, zr = this.zr;
    // stacje gesciej przy nadkolach
    const zs = [...range(zr, zf, 90)];
    const SIDE = [0, 0.1, 0.3, 0.55, 0.8, 0.95, 1.0];
    const TOP = [0.92, 0.75, 0.55, 0.32, 0.12, 0];
    const cabinFrom = -1.72, cabinTo = 0.93;
    const section = (z) => {
      const hw = half(z);
      const yb = Math.min(arch(z), shoulder(z) - 0.03);
      const ys = shoulder(z);
      const inCabin = z > cabinFrom && z < cabinTo;
      const yt = inCabin ? ys + 0.01 : top(z);
      const left = [];
      for (const f of SIDE) {
        const bul = Math.sin(f * Math.PI) * 0.035;
        left.push([hw * (0.955 + bul) - (f === 0 ? 0.02 : 0), yb + (ys - yb) * f]);
      }
      // zaokraglony bark i gorna powierzchnia (blotniki wyzej niz srodek maski)
      for (const xf of TOP) {
        const x = hw * 0.94 * xf;
        const e = Math.pow(xf, 2.4);
        let y = yt + (ys + 0.012 - yt) * e;
        if (xf > 0.7) y += 0.008;
        left.push([x, y]);
      }
      const right = left.slice(0, -1).reverse().map(([x, y]) => [-x, y]);
      return [...left, ...right];
    };
    const geo = loft(zs, section, { uvV: (k, n) => k / (n - 1) });
    const bodyMesh = new THREE.Mesh(geo, this.mats.paint);
    this.exterior.add(bodyMesh);
    // zaslepki przod/tyl (plaskie, z wlasnymi normalnymi): tyl - panel w kolorze nadwozia + czarny dol
    const capMesh = (z, dir) => {
      const pts = section(z);
      const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ShapeGeometry(shape);
      if (dir < 0) g.rotateY(Math.PI); // przekroj symetryczny: obrot odwraca tylko strone przednia (-Z)
      g.translate(0, 0, z);
      const m = new THREE.Mesh(g, dir < 0 ? this.mats.carbon : this.mats.paint);
      this.exterior.add(m);
    };
    capMesh(zr, -1);
    capMesh(zf, 1);
    const rearPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.34), this.mats.paint);
    rearPanel.position.set(0, 0.74, zr - 0.004);
    rearPanel.rotation.y = Math.PI;
    this.exterior.add(rearPanel);

    // szklarnia (szyby) + dach w kolorze nadwozia
    const zsG = range(cabinFrom + 0.02, cabinTo - 0.02, 48);
    const glassSection = (z) => {
      const ys = shoulder(z);
      const yr = Math.max(ys + 0.005, top(z));
      const H = yr - ys;
      const hw = half(z);
      const hb = hw * 0.875;
      const end = Math.min(1, Math.min(z - cabinFrom, cabinTo - z) / 0.6);
      const hr = 0.50 + (1 - end) * 0.2;
      const pts = [[hb, ys], [hb - 0.03, ys + 0.25 * H], [hb + (hr - hb) * 0.6, ys + 0.62 * H], [hr + 0.05, ys + 0.88 * H], [hr, ys + 0.97 * H], [hr * 0.5, ys + H], [0, ys + H]];
      const right = pts.slice(0, -1).reverse().map(([x, y]) => [-x, y]);
      return [...pts, ...right];
    };
    this.glassMesh = new THREE.Mesh(loft(zsG, glassSection), this.mats.glass);
    this.glassMesh.renderOrder = 2;
    this.exterior.add(this.glassMesh);
    const roofSection = (z) => {
      const ys = shoulder(z);
      const yr = top(z) + 0.006;
      const hr = 0.47;
      const pts = [];
      for (const f of [1, 0.75, 0.5, 0.25, 0]) pts.push([hr * f, yr - 0.03 * Math.pow(f, 3) + 0.0 * ys]);
      const right = pts.slice(0, -1).reverse().map(([x, y]) => [-x, y]);
      return [...pts, ...right];
    };
    const roof = new THREE.Mesh(loft(range(-0.92, 0.12, 20), roofSection), this.mats.paint);
    this.exterior.add(roof);
    // slupki A (wzdluz krawedzi szyby czolowej)
    const aGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.95, 6);
    for (const sx of [1, -1]) {
      const a = new THREE.Mesh(aGeo, this.mats.black);
      const p0 = new THREE.Vector3(sx * 0.80, shoulder(0.88) + 0.005, 0.86);
      const p1 = new THREE.Vector3(sx * 0.535, top(0.05) - 0.03, 0.05);
      a.position.copy(p0).add(p1).multiplyScalar(0.5);
      a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
      a.scale.y = p1.distanceTo(p0) / 0.95;
      this.exterior.add(a);
    }
    // nadkola od srodka (ciemne wneki) i podloga
    const linerGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.42, 20, 1, true, 0, Math.PI);
    linerGeo.rotateZ(Math.PI / 2);
    const tf = this.cfg.trackWidth.front / 2, tr = this.cfg.trackWidth.rear / 2;
    for (const [z, x] of [[this.fa, tf], [this.fa, -tf], [this.ra, tr], [this.ra, -tr]]) {
      const l = new THREE.Mesh(linerGeo, this.mats.black);
      l.material = this.mats.black;
      l.position.set(x * 0.98, 0.34, z);
      l.material.side = THREE.DoubleSide;
      this.exterior.add(l);
    }
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, zf - zr - 0.3), this.mats.carbon);
    floor.position.set(0, 0.13, (zf + zr) / 2);
    this.exterior.add(floor);
    // kratki/wloty na masce i z przodu
    const vent = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.16), this.mats.black);
    for (const sx of [1, -1]) {
      const v = vent.clone();
      v.position.set(sx * 0.4, top(1.85) + 0.007, 1.85);
      v.rotation.x = -Math.PI / 2 + 0.2;
      this.exterior.add(v);
    }
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.2), this.mats.black);
    grille.position.set(0, 0.3, zf - 0.02);
    grille.rotation.x = 0.35;
    this.exterior.add(grille);
    // numery startowe na drzwiach i masce
    const dmat = new THREE.MeshStandardMaterial({ map: decalTexture(this.number), roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -4, transparent: true, alphaTest: 0.1 });
    const dgeo = new THREE.CircleGeometry(0.24, 32);
    for (const sx of [1, -1]) {
      const d = new THREE.Mesh(dgeo, dmat);
      const z = 0.15;
      d.position.set(sx * (half(z) * 0.99 + 0.013), 0.5, z);
      d.rotation.y = sx * Math.PI / 2;
      this.exterior.add(d);
    }
    const dh = new THREE.Mesh(dgeo, dmat);
    dh.position.set(0, top(1.45) + 0.008, 1.45);
    dh.rotation.x = -Math.PI / 2 + 0.17;
    dh.rotation.z = Math.PI;
    dh.scale.setScalar(0.8);
    this.exterior.add(dh);
    // lusterka
    const mirGeo = new THREE.SphereGeometry(0.11, 12, 8);
    mirGeo.scale(0.7, 0.6, 1.0);
    for (const sx of [1, -1]) {
      const m = new THREE.Mesh(mirGeo, this.mats.paintPlain);
      m.position.set(sx * 1.0, 0.98, 0.72);
      this.exterior.add(m);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.05), this.mats.carbon);
      st.position.set(sx * 0.9, 0.95, 0.72);
      this.exterior.add(st);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.09), this.mats.chrome);
      gl.position.set(sx * 1.0, 0.98, 0.66);
      gl.rotation.y = Math.PI;
      this.exterior.add(gl);
    }
    this._top = top;
    this._shoulder = shoulder;
    this._half = half;
  }

  _buildAero() {
    const zf = this.zf, zr = this.zr;
    // splitter
    const spl = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.022, 0.2), this.mats.carbon);
    spl.position.set(0, 0.085, zf - 0.1);
    this.exterior.add(spl);
    // dyfuzor z zebrami
    const dif = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.025, 0.42), this.mats.carbon);
    dif.position.set(0, 0.19, zr + 0.28);
    dif.rotation.x = -0.2;
    this.exterior.add(dif);
    for (let k = -2; k <= 2; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.13, 0.38), this.mats.carbon);
      fin.position.set(k * 0.3, 0.15, zr + 0.28);
      this.exterior.add(fin);
    }
    // tylne skrzydlo (profil lotniczy)
    const s = new THREE.Shape();
    const chord = 0.36;
    s.moveTo(0, 0);
    s.bezierCurveTo(chord * 0.15, 0.05, chord * 0.6, 0.045, chord, 0.012);
    s.lineTo(chord, 0.0);
    s.bezierCurveTo(chord * 0.6, 0.012, chord * 0.2, -0.01, 0, 0);
    const wingGeo = new THREE.ExtrudeGeometry(s, { depth: 1.78, bevelEnabled: false, steps: 1 });
    wingGeo.translate(0, 0, -0.89);
    wingGeo.rotateY(Math.PI / 2);
    const wing = new THREE.Mesh(wingGeo, this.mats.carbon);
    wing.position.set(0, 1.18, zr + 0.42);
    wing.rotation.x = 0.16;
    this.exterior.add(wing);
    for (const sx of [1, -1]) {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.26, 0.48), this.mats.carbon);
      ep.position.set(sx * 0.895, 1.14, zr + 0.24);
      this.exterior.add(ep);
      // mocowania "labedzia szyja"
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.12), this.mats.carbon);
      neck.position.set(sx * 0.35, 1.04, zr + 0.3);
      neck.rotation.x = -0.35;
      this.exterior.add(neck);
    }
    // wydech
    const exGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.16, 14, 1, true);
    exGeo.rotateX(Math.PI / 2);
    for (const sx of [0.22, -0.22]) {
      const ex = new THREE.Mesh(exGeo, this.mats.chrome);
      ex.material.side = THREE.DoubleSide;
      ex.position.set(sx, 0.26, zr + 0.02);
      this.exterior.add(ex);
    }
  }

  _buildLights() {
    const zf = this.zf, zr = this.zr;
    // reflektory
    // reflektory: waskie, skosne klosze wtopione w przednia krawedz
    const hlGeo = new THREE.SphereGeometry(0.1, 16, 10);
    hlGeo.scale(1.5, 0.32, 0.75);
    const hlHouse = new THREE.SphereGeometry(0.115, 16, 10);
    hlHouse.scale(1.55, 0.4, 0.8);
    for (const sx of [1, -1]) {
      const z = zf - 0.22;
      const y = this._top(z) - 0.035;
      const hh = new THREE.Mesh(hlHouse, this.mats.black);
      hh.position.set(sx * 0.62, y, z);
      hh.rotation.y = sx * 0.45;
      hh.rotation.x = -0.35;
      this.exterior.add(hh);
      const h = new THREE.Mesh(hlGeo, this.mats.head);
      h.position.set(sx * 0.62, y + 0.012, z + 0.02);
      h.rotation.copy(hh.rotation);
      this.exterior.add(h);
    }
    // tylna listwa LED + lampy
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.035, 0.03), this.mats.tail);
    bar.position.set(0, 0.84, zr + 0.01);
    this.exterior.add(bar);
    const tlGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.03, 16);
    tlGeo.rotateX(Math.PI / 2);
    for (const sx of [0.72, -0.72, 0.55, -0.55]) {
      const tl = new THREE.Mesh(tlGeo, this.mats.tail);
      tl.position.set(sx, 0.72, zr + 0.015);
      this.exterior.add(tl);
    }
    // swiatlo deszczowe / trzecie stop na skrzydle
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.02), this.mats.tail);
    rl.position.set(0, 0.5, zr - 0.01);
    this.exterior.add(rl);
  }

  // ------------------------------------------------------------------ kola
  _wheel(radius, width, front) {
    const g = new THREE.Group(); // pozycja zawieszenia
    const steer = new THREE.Group();
    const spin = new THREE.Group();
    g.add(steer);
    steer.add(spin);
    // opona (profil obrotowy)
    const rIn = radius * 0.72;
    const hw = width / 2;
    const prof = [
      [rIn, -hw * 0.92], [radius * 0.86, -hw], [radius * 0.97, -hw * 0.94], [radius, -hw * 0.78],
      [radius, hw * 0.78], [radius * 0.97, hw * 0.94], [radius * 0.86, hw], [rIn, hw * 0.92],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const tyreGeo = new THREE.LatheGeometry(prof, 40);
    tyreGeo.rotateZ(Math.PI / 2);
    const tyre = new THREE.Mesh(tyreGeo, this.mats.tyre);
    spin.add(tyre);
    // felga: beczka + szprychy + nakretka
    const barrel = new THREE.CylinderGeometry(rIn * 0.99, rIn * 0.99, width * 0.9, 32, 1, true);
    barrel.rotateZ(Math.PI / 2);
    const bm = new THREE.Mesh(barrel, this.mats.rim);
    bm.material.side = THREE.DoubleSide;
    spin.add(bm);
    const spokes = new THREE.Group();
    const spokeGeo = new THREE.BoxGeometry(0.035, rIn * 0.95, 0.05);
    spokeGeo.translate(0, rIn * 0.48, 0);
    for (let k = 0; k < 10; k++) {
      const sp = new THREE.Mesh(spokeGeo, this.mats.rim);
      sp.rotation.x = (k / 10) * Math.PI * 2;
      spokes.add(sp);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 6).rotateZ(Math.PI / 2), this.mats.chrome);
    spokes.add(hub);
    spin.add(spokes);
    const blurDisc = new THREE.Mesh(new THREE.CylinderGeometry(rIn * 0.95, rIn * 0.95, 0.02, 28).rotateZ(Math.PI / 2), this.mats.blur);
    blurDisc.visible = false;
    spin.add(blurDisc);
    // tarcza i zacisk (nie obracaja sie z kolem - tylko skret)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(rIn * 0.85, rIn * 0.85, 0.032, 28).rotateZ(Math.PI / 2), this.mats.disc);
    steer.add(disc);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.12), this.mats.caliper);
    cal.position.set(0, rIn * 0.62, front ? -rIn * 0.45 : rIn * 0.45);
    steer.add(cal);
    return { group: g, steer, spin, spokes, blurDisc, sideOffset: 0, disc };
  }

  _buildWheels() {
    const c = this.cfg;
    const tf = c.trackWidth.front / 2, tr = c.trackWidth.rear / 2;
    const F = c.tyres.front, R = c.tyres.rear;
    this.wheels = [];
    const defs = [[tf, this.fa, F, true, 1], [-tf, this.fa, F, true, -1], [tr, this.ra, R, false, 1], [-tr, this.ra, R, false, -1]];
    for (const [x, z, T, front, sx] of defs) {
      const w = this._wheel(T.radius, T.width, front);
      w.group.position.set(x, 0, z);
      // szprychy i zacisk na zewnatrz
      w.spokes.position.x = sx * T.width * 0.36;
      w.blurDisc.position.x = sx * T.width * 0.38;
      w.disc.position.x = -sx * 0.04;
      w.steer.children.forEach((ch) => { if (ch.geometry?.type === 'BoxGeometry') ch.position.x = -sx * 0.03; });
      w.radius = T.radius;
      this.root.add(w.group); // kola poza "body" - pozycja liczona w ukladzie lokalnym auta
      this.wheels.push(w);
    }
  }

  // ------------------------------------------------------------------ kokpit
  _buildInterior() {
    const I = this.interior;
    const m = this.mats;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.16, 0.46), m.interior);
    dash.position.set(0, 0.85, 0.66);
    // oslona zegarow przed kierowca
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.24), m.interior);
    hood.position.set(0.38, 0.95, 0.56);
    hood.rotation.x = -0.15;
    I.add(hood);
    dash.rotation.x = -0.1;
    I.add(dash);
    // wyswietlacz cyfrowy
    this.dashCanvas = document.createElement('canvas');
    this.dashCanvas.width = 512;
    this.dashCanvas.height = 192;
    this.dashTex = new THREE.CanvasTexture(this.dashCanvas);
    this.dashTex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.112), new THREE.MeshBasicMaterial({ map: this.dashTex, toneMapped: false }));
    // kierownica (ksztalt GT3: obrecz + plaska plyta z wyswietlaczem)
    this.steeringWheel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.024, 10, 28, Math.PI * 1.55), m.black);
    rim.rotation.z = -Math.PI * 0.275; // przerwa obreczy na dole
    this.steeringWheel.add(rim);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.03), m.carbon);
    plate.position.y = 0.0;
    this.steeringWheel.add(plate);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), m.black);
    bottom.position.y = -0.13;
    this.steeringWheel.add(bottom);
    scr.position.set(0, 0.0, 0.017);
    this.steeringWheel.add(scr);
    const btnCols = [0xff3030, 0x30ff60, 0xffd000, 0x3080ff];
    btnCols.forEach((c, k) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3 }));
      b.position.set((k % 2 ? 1 : -1) * 0.12, k < 2 ? 0.035 : -0.035, 0.02);
      this.steeringWheel.add(b);
    });
    // lopatki zmiany biegow
    for (const sx of [1, -1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.008), m.carbon);
      p.position.set(sx * 0.12, 0.02, -0.04);
      this.steeringWheel.add(p);
    }
    const wheelHolder = new THREE.Group();
    wheelHolder.position.set(0.38, 0.86, 0.3);
    wheelHolder.rotation.x = -0.32;
    wheelHolder.add(this.steeringWheel);
    this.steeringWheel.rotation.y = Math.PI; // przodem do kierowcy
    I.add(wheelHolder);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.3, 8), m.black);
    column.position.set(0.38, 0.86, 0.45);
    column.rotation.x = Math.PI / 2 - 0.32;
    I.add(column);
    // fotel kubelkowy
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.75, 0.12), m.interior);
    seat.position.set(0.38, 0.62, -0.62);
    seat.rotation.x = -0.25;
    I.add(seat);
    const seatB = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.5), m.interior);
    seatB.position.set(0.38, 0.3, -0.35);
    I.add(seatB);
    // boczki drzwi i podloga
    for (const sx of [1, -1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 1.7), m.interior);
      door.position.set(sx * 0.84, 0.52, -0.1);
      I.add(door);
    }
    const tunnel = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 1.3), m.carbon);
    tunnel.position.set(0, 0.35, 0.0);
    I.add(tunnel);
    const fl = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.03, 2.2), m.interior);
    fl.position.set(0, 0.2, -0.1);
    I.add(fl);
    // klatka bezpieczenstwa
    const tube = (a, b, r = 0.022) => {
      const pa = new THREE.Vector3(...a), pb = new THREE.Vector3(...b);
      const len = pa.distanceTo(pb);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), m.cage);
      t.position.copy(pa).add(pb).multiplyScalar(0.5);
      t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pb.clone().sub(pa).normalize());
      I.add(t);
    };
    for (const sx of [1, -1]) {
      tube([sx * 0.74, 0.88, 0.8], [sx * 0.52, 1.175, 0.0]);
      tube([sx * 0.52, 1.175, 0.0], [sx * 0.5, 1.15, -0.85]);
      tube([sx * 0.7, 0.3, -0.85], [sx * 0.5, 1.15, -0.85]);
    }
    tube([0.5, 1.15, -0.85], [-0.5, 1.15, -0.85]);
    tube([0.5, 1.175, 0.0], [-0.5, 1.175, 0.0], 0.019);
    tube([0.6, 0.35, -0.85], [-0.5, 1.15, -0.85], 0.02);
    // lusterko wsteczne
    const rm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.045, 0.015), m.black);
    rm.position.set(0, 1.135, 0.12);
    I.add(rm);
    const rmg = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.038), m.chrome);
    rmg.position.set(0, 1.135, 0.111);
    rmg.rotation.y = Math.PI;
    I.add(rmg);
  }

  _buildDriver() {
    const D = this.driver;
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12), this.mats.helmet);
    helm.position.set(0.38, 1.04, -0.36);
    D.add(helm);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.137, 16, 8, -0.9, 1.8, 1.1, 0.7), this.mats.black);
    visor.position.copy(helm.position);
    visor.rotation.y = 0;
    D.add(visor);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.26), this.mats.suit);
    torso.position.set(0.38, 0.68, -0.45);
    torso.rotation.x = -0.25;
    D.add(torso);
    for (const sx of [0.2, -0.2]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8), this.mats.suit);
      arm.position.set(0.38 + sx * 0.9, 0.78, -0.12);
      arm.rotation.x = Math.PI / 2 - 0.5;
      D.add(arm);
    }
  }

  // ------------------------------------------------------------------ aktualizacja co klatke
  /** v - Vehicle, pos/quat - interpolowana pozycja */
  update(v, pos, quat, dt) {
    this.root.position.copy(pos);
    this.root.quaternion.copy(quat);
    const tel = v.telemetry;
    for (let k = 0; k < 4; k++) {
      const pw = v.wheels[k];
      const w = this.wheels[k];
      w.group.position.y = -pw.length;
      w.steer.rotation.y = pw.steer;
      w.spin.rotation.x = pw.spin;
      const fast = Math.abs(pw.omega) > 45;
      w.spokes.visible = !fast;
      w.blurDisc.visible = fast;
    }
    // swiatla stop
    const braking = tel.brake > 0.05 || v.input.handbrake > 0.1;
    this.mats.tail.emissiveIntensity = braking ? 3.5 : 0.6;
    // tarcze rozgrzane od hamowania (efekt wizualny)
    const heat = (this._heat = clamp((this._heat || 0) + (tel.brake * tel.speed * 0.004 - 0.12) * dt, 0, 1));
    this.mats.disc.emissiveIntensity = heat * heat * 1.5;
    // kierownica
    if (this.steeringWheel) {
      const lock = (this.cfg.steering.steeringWheelLockDeg * Math.PI) / 180;
      const maxA = (this.cfg.steering.maxWheelAngleDeg * Math.PI) / 180;
      this.steeringWheel.rotation.z = -(v.steerAngle / maxA) * lock;
    }
  }

  /** tryb kokpitu: szyby jasniejsze, bez kierowcy */
  setCockpitMode(on) {
    if (this.cockpitMode === on) return;
    this.cockpitMode = on;
    this.driver.visible = !on;
    this.mats.glass.opacity = on ? 0.12 : 0.78;
    this.mats.glass.color.setHex(on ? 0x6a7a88 : 0x0a0f14);
  }

  /** odswiezenie wyswietlacza na kierownicy */
  drawDash(tel, extra) {
    const c = this.dashCanvas;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, 512, 192);
    const rpmFrac = clamp((tel.rpm - 3000) / (this.cfg.engine.redlineRpm - 3000), 0, 1);
    const leds = 12;
    for (let k = 0; k < leds; k++) {
      const on = rpmFrac * leds > k;
      ctx.fillStyle = on ? (k < 5 ? '#19e05a' : k < 9 ? '#ff2b2b' : '#3a6bff') : '#1a1d22';
      if (tel.rpm > this.cfg.engine.redlineRpm && Math.floor(performance.now() / 80) % 2) ctx.fillStyle = '#3a6bff';
      ctx.fillRect(16 + k * 40, 10, 32, 16);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 110px Arial';
    ctx.textAlign = 'center';
    const g = tel.gear === 0 ? 'N' : tel.gear < 0 ? 'R' : String(tel.gear);
    ctx.fillText(g, 256, 150);
    ctx.font = 'bold 44px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(Math.round(tel.speedKmh), 24, 110);
    ctx.font = '22px Arial';
    ctx.fillStyle = '#8a95a5';
    ctx.fillText('km/h', 26, 140);
    ctx.textAlign = 'right';
    ctx.font = 'bold 34px Arial';
    const d = extra?.delta;
    if (d != null) {
      ctx.fillStyle = d <= 0 ? '#19e05a' : '#ff3b3b';
      ctx.fillText((d > 0 ? '+' : '') + d.toFixed(2), 490, 110);
    }
    ctx.fillStyle = '#8a95a5';
    ctx.font = '20px Arial';
    ctx.fillText(`ABS ${extra?.abs ?? '-'}  TC ${extra?.tc ?? '-'}`, 490, 150);
    this.dashTex.needsUpdate = true;
  }
}
