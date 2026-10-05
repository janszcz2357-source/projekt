// Otoczenie: niebo (model Preethama) + mapa odbic, swiatlo sloneczne z cieniem podazajacym za autem,
// teren z DEM zszyty z torem, las z instancjonowanych drzew (2 poziomy szczegolowosci, fragmenty).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { grassTexture } from './textures.js';
import { rng } from './textures.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// szum wartosci 2D (nie kafelkowany) do masek lasu i zmiennosci terenu
function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, scale, seed) {
  const fx = x / scale, fz = z / scale;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const ax = fx - ix, az = fz - iz;
  const sx = ax * ax * (3 - 2 * ax), sz = az * az * (3 - 2 * az);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

export function sunDirection(env) {
  const el = env.sunElevation * DEG;
  const az = env.sunAzimuth * DEG; // od polnocy zgodnie z zegarem
  // swiat: x = wschod, z = poludnie
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

// niebo: gradient zenit -> horyzont (spojny z mgla) + tarcza i poswiata slonca
function skyMaterial(env, sun) {
  const srgb = (c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  return new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: srgb(env.zenith || [0.25, 0.47, 0.82]) },
      horizon: { value: srgb(env.haze) },
      ground: { value: srgb(env.ground).multiplyScalar(0.7) },
      sunDir: { value: sun.clone() },
      sunColor: { value: new THREE.Color(1.0, 0.92, 0.78) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));
        col = mix(col, ground, smoothstep(0.0, -0.06, h));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * (pow(s, 1200.0) * 30.0 + pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

export function createSky(scene, renderer, env) {
  const sun = sunDirection(env);
  const geo = new THREE.SphereGeometry(1, 32, 16);
  const sky = new THREE.Mesh(geo, skyMaterial(env, sun));
  sky.scale.setScalar(10000);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  // mapa srodowiska z nieba (odbicia na lakierze, oswietlenie rozproszone)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  const sky2 = new THREE.Mesh(geo, skyMaterial(env, sun));
  sky2.scale.setScalar(100);
  skyScene.add(sky2);
  const rt = pmrem.fromScene(skyScene, 0.02, 0.1, 1000);
  scene.environment = rt.texture;
  scene.environmentIntensity = 0.6;
  pmrem.dispose();
  const haze = new THREE.Color().setRGB(env.haze[0], env.haze[1], env.haze[2], THREE.SRGBColorSpace);
  scene.fog = new THREE.FogExp2(haze, env.fog);
  scene.background = haze;
  return { sky, sun, envRT: rt };
}

export class SunLight {
  constructor(scene, env, quality) {
    this.dir = sunDirection(env);
    this.light = new THREE.DirectionalLight(0xfff1dc, 3.0);
    this.light.position.copy(this.dir).multiplyScalar(200);
    this.light.target.position.set(0, 0, 0);
    scene.add(this.light, this.light.target);
    this.hemi = new THREE.HemisphereLight(0xbcd3ec, new THREE.Color().setRGB(env.ground[0], env.ground[1], env.ground[2], THREE.SRGBColorSpace), 0.65);
    scene.add(this.hemi);
    this.setQuality(quality);
  }

  setQuality(q) {
    const L = this.light;
    const size = { low: 0, medium: 1024, high: 2048, ultra: 4096 }[q] || 0;
    L.castShadow = size > 0;
    if (size > 0) {
      L.shadow.mapSize.set(size, size);
      const ext = q === 'ultra' ? 55 : 42;
      const cam = L.shadow.camera;
      cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
      cam.near = 10; cam.far = 500;
      cam.updateProjectionMatrix();
      L.shadow.bias = -0.0004;
      L.shadow.normalBias = 0.03;
      if (L.shadow.map) { L.shadow.map.dispose(); L.shadow.map = null; }
    }
    this.extent = q === 'ultra' ? 55 : 42;
    this.texel = size > 0 ? (2 * this.extent) / size : 1;
  }

  /** cien podaza za punktem (auto), z przyciaganiem do siatki tekseli (brak migotania) */
  follow(p) {
    const L = this.light;
    // przyciaganie w ukladzie swiatla
    const tx = Math.round(p.x / this.texel) * this.texel;
    const tz = Math.round(p.z / this.texel) * this.texel;
    L.target.position.set(tx, p.y, tz);
    L.position.set(tx, p.y, tz).addScaledVector(this.dir, 250);
    L.target.updateMatrixWorld();
  }
}

/** Teren z siatki DEM: w poblizu toru opuszczony pod nawierzchnie, dalej plynnie do DEM. */
export function buildTerrain(track, env, quality) {
  const T = track.terrain;
  // rozdzielczosc siatki terenu wg jakosci (teren daleko od toru i tak jest zamglony)
  const cell = { low: 20, medium: 14, high: 10, ultra: 8 }[quality] || 14;
  const x0 = T.x0, x1 = T.x0 + (T.nx - 1) * T.cell;
  const zN0 = T.y0, zN1 = T.y0 + (T.ny - 1) * T.cell; // polnoc
  const nx = Math.floor((x1 - x0) / cell) + 1;
  const nz = Math.floor((zN1 - zN0) / cell) + 1;
  const heights = new Float32Array(nx * nz);
  const colors = new Float32Array(nx * nz * 3);
  const tint = env.tint || [1, 1, 1];
  const base = new THREE.Color(tint[0] * 0.92, tint[1] * 0.92, tint[2] * 0.92);
  const hint = { i: -1 };
  for (let j = 0; j < nz; j++) {
    hint.i = -1;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell;
      const z = -(zN0 + j * cell);
      const dem = track.demHeight(x, z);
      // wyszukiwanie globalne (podpowiedz z sasiedniego punktu moglaby "przeskoczyc" na inny fragment toru)
      const pr = track.project(x, z, -1);
      hint.i = pr.index;
      const k = pr.index;
      const side = pr.lateral >= 0 ? 1 : -1;
      const b = side > 0 ? track.barrierL[k] : track.barrierR[k];
      const inner = b + 12;
      const d = Math.abs(pr.lateral);
      // sprawdz czy rzut jest wiarygodny (punkt nie lezy "za" koncem odcinka daleko od toru)
      const dx = x - (track.px[k] + track.nx[k] * pr.lateral), dz = z - (track.pz[k] + track.nz[k] * pr.lateral);
      const dist = Math.hypot(dx, dz) + d;
      const th = track.py[k];
      let h;
      if (dist < inner) h = th - 0.9;
      else {
        const w = smooth(inner, inner + 70, dist);
        h = (th - 0.25) * (1 - w) + dem * w;
      }
      heights[j * nx + i] = h;
      // kolor: zmiennosc + ciemniej w lesie
      const nv = vnoise(x, z, 180, 7) * 0.6 + vnoise(x, z, 45, 8) * 0.4;
      const f = 0.82 + nv * 0.3;
      colors[(j * nx + i) * 3] = base.r * f;
      colors[(j * nx + i) * 3 + 1] = base.g * f;
      colors[(j * nx + i) * 3 + 2] = base.b * f;
    }
  }
  // fragmenty terenu (frustum culling) + "spodnica" do horyzontu na krawedziach
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: grassTexture(), vertexColors: true, roughness: 1, metalness: 0 });
  const CH = 40;
  for (let cj = 0; cj < nz - 1; cj += CH) {
    for (let ci = 0; ci < nx - 1; ci += CH) {
      const ej = Math.min(nz - 1, cj + CH), ei = Math.min(nx - 1, ci + CH);
      const w = ei - ci + 1, hgt = ej - cj + 1;
      const pos = new Float32Array(w * hgt * 3);
      const col = new Float32Array(w * hgt * 3);
      const uv = new Float32Array(w * hgt * 2);
      for (let j = 0; j < hgt; j++) {
        for (let i = 0; i < w; i++) {
          const gi = ci + i, gj = cj + j;
          const q = j * w + i;
          const x = x0 + gi * cell, z = -(zN0 + gj * cell);
          pos[q * 3] = x; pos[q * 3 + 1] = heights[gj * nx + gi]; pos[q * 3 + 2] = z;
          col[q * 3] = colors[(gj * nx + gi) * 3];
          col[q * 3 + 1] = colors[(gj * nx + gi) * 3 + 1];
          col[q * 3 + 2] = colors[(gj * nx + gi) * 3 + 2];
          uv[q * 2] = x / 7; uv[q * 2 + 1] = z / 7;
        }
      }
      const idx = [];
      for (let j = 0; j < hgt - 1; j++) {
        for (let i = 0; i < w - 1; i++) {
          const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
          // z = -polnoc: wiersz j+1 jest bardziej na polnoc (mniejsze z)
          idx.push(a, b, c, b, d, c);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      group.add(m);
    }
  }
  // spodnica: pierscien od krawedzi terenu do 6 km
  {
    const ring = [];
    const push = (i, j) => ring.push([x0 + i * cell, heights[j * nx + i], -(zN0 + j * cell)]);
    for (let i = 0; i < nx; i++) push(i, 0);
    for (let j = 1; j < nz; j++) push(nx - 1, j);
    for (let i = nx - 2; i >= 0; i--) push(i, nz - 1);
    for (let j = nz - 2; j > 0; j--) push(0, j);
    const cx = (x0 + x1) / 2, cz = -(zN0 + zN1) / 2;
    const pos = [];
    const col = [];
    const uv = [];
    ring.forEach(([x, y, z]) => {
      const dx = x - cx, dz = z - cz;
      const l = Math.hypot(dx, dz);
      pos.push(x, y, z, x + (dx / l) * 6000, y - 30, z + (dz / l) * 6000);
      col.push(base.r * 0.9, base.g * 0.9, base.b * 0.9, base.r * 0.8, base.g * 0.8, base.b * 0.8);
      uv.push(x / 7, z / 7, (x + (dx / l) * 6000) / 7, (z + (dz / l) * 6000) / 7);
    });
    const idx = [];
    const N = ring.length;
    for (let k = 0; k < N; k++) {
      const a = k * 2, b = a + 1, c = ((k + 1) % N) * 2, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // ujednolicenie orientacji (normalne w gore)
    const nAttr = g.getAttribute('normal');
    let flip = 0;
    for (let k = 0; k < nAttr.count; k++) flip += nAttr.getY(k);
    if (flip < 0) {
      g.setIndex(idx.map((_, q) => idx[q - (q % 3) + (2 - (q % 3))]));
      g.computeVertexNormals();
    }
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  group.userData.sampleHeight = (x, z) => {
    const fi = clamp((x - x0) / cell, 0, nx - 1.001), fj = clamp((-z - zN0) / cell, 0, nz - 1.001);
    const i = Math.floor(fi), j = Math.floor(fj);
    const ax = fi - i, az = fj - j;
    return (heights[j * nx + i] * (1 - ax) + heights[j * nx + i + 1] * ax) * (1 - az) + (heights[(j + 1) * nx + i] * (1 - ax) + heights[(j + 1) * nx + i + 1] * ax) * az;
  };
  // krawedz terenu w zwyklym ukladzie - do rozmieszczania drzew
  group.userData.bounds = { x0, x1, z0: -zN1, z1: -zN0 };
  return group;
}

// ------------------------------------------------------------------ drzewa
function colorize(geo, color) {
  const n = geo.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

function treeGeometries(kind) {
  const trunkC = new THREE.Color(0x4a3527);
  if (kind === 'conifer') {
    const hi = [
      colorize(new THREE.CylinderGeometry(0.22, 0.32, 4, 6).translate(0, 2, 0), trunkC),
      colorize(new THREE.ConeGeometry(2.6, 7, 9).translate(0, 6.5, 0), new THREE.Color(0x1f3d24)),
      colorize(new THREE.ConeGeometry(2.0, 6, 9).translate(0, 10, 0), new THREE.Color(0x24462a)),
      colorize(new THREE.ConeGeometry(1.3, 5, 8).translate(0, 13.5, 0), new THREE.Color(0x2a5030)),
    ];
    const lo = [
      colorize(new THREE.ConeGeometry(2.6, 15, 5).translate(0, 8.5, 0), new THREE.Color(0x22432a)),
    ];
    return { hi: mergeGeometries(hi.map((g) => g.toNonIndexed())), lo: mergeGeometries(lo.map((g) => g.toNonIndexed())) };
  }
  const leaf = new THREE.Color(0x3f6a2c);
  const blobs = [];
  const r = rng(4);
  for (let k = 0; k < 3; k++) {
    const g = new THREE.IcosahedronGeometry(2.9 + r() * 1.0, 1);
    g.translate((r() - 0.5) * 2.4, 7 + r() * 3, (r() - 0.5) * 2.4);
    blobs.push(colorize(g, leaf.clone().multiplyScalar(0.85 + r() * 0.3)));
  }
  const hi = [colorize(new THREE.CylinderGeometry(0.28, 0.42, 7, 6).translate(0, 3.5, 0), trunkC), ...blobs];
  const lo = [
    colorize(new THREE.CylinderGeometry(0.3, 0.4, 5, 4).translate(0, 2.5, 0), trunkC),
    colorize(new THREE.IcosahedronGeometry(3.6, 0).translate(0, 8, 0), leaf),
  ];
  return { hi: mergeGeometries(hi.map((g) => g.toNonIndexed())), lo: mergeGeometries(lo.map((g) => g.toNonIndexed())) };
}

export class Forest {
  constructor(track, env, terrain, def, quality) {
    this.group = new THREE.Group();
    this.chunks = [];
    this.quality = quality;
    const maxTrees = { low: 2500, medium: 6500, high: 12000, ultra: 18000 }[quality] || 6000;
    this.viewDist = { low: 900, medium: 1400, high: 2000, ultra: 2600 }[quality] || 1400;
    this.lodDist = { low: 160, medium: 230, high: 340, ultra: 480 }[quality] || 230;
    const kinds = env.trees === 'mixed' ? ['deciduous', 'conifer'] : [env.trees];
    const geos = Object.fromEntries(kinds.map((k) => [k, treeGeometries(k)]));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const B = terrain.userData.bounds;
    const sampleH = terrain.userData.sampleHeight;
    const spacing = env.trees === 'mixed' ? 13 : env.trees === 'conifer' ? 8.5 : 10;
    const r = rng(1234);
    const cands = [];
    let hint = -1;
    const [bandMin, bandMax] = env.treeBand;
    // zakresy budowli (trybuny, boksy) - bez drzew
    const L = track.length;
    const busy = [];
    for (const [frac, side] of def.grandstands || []) busy.push([frac * L - 70, frac * L + 70, side]);
    busy.push([L - 220, L + 260, def.pitSide || -1], [-220, 260, def.pitSide || -1]);
    for (let z = B.z0; z < B.z1; z += spacing) {
      hint = -1;
      for (let x = B.x0; x < B.x1; x += spacing) {
        const px = x + (r() - 0.5) * spacing * 0.9;
        const pz = z + (r() - 0.5) * spacing * 0.9;
        // maska lasu: skupiska + przeswity
        const m = vnoise(px, pz, 260, 3) * 0.65 + vnoise(px, pz, 70, 5) * 0.35;
        const thr = 1 - 0.55 * env.treeDensity;
        if (m < thr) continue;
        const pr = track.project(px, pz, -1);
        hint = pr.index;
        const k = pr.index;
        const side = pr.lateral >= 0 ? 1 : -1;
        const b = side > 0 ? track.barrierL[k] : track.barrierR[k];
        const d = Math.abs(pr.lateral);
        const off = Math.hypot(px - (track.px[k] + track.nx[k] * pr.lateral), pz - (track.pz[k] + track.nz[k] * pr.lateral));
        const dist = d + off;
        if (dist < b + bandMin || dist > b + bandMax) continue;
        const s = track.s[k];
        if (busy.some(([a, c, sd]) => sd === side && ((s > a && s < c) || (s + L > a && s + L < c)) && dist < b + 60)) continue;
        cands.push([px, pz]);
      }
    }
    // ograniczenie liczby (rownomierne przerzedzenie)
    const keep = Math.min(1, maxTrees / Math.max(1, cands.length));
    const CH = 300;
    const buckets = new Map();
    for (const [px, pz] of cands) {
      if (r() > keep) continue;
      const key = Math.floor(px / CH) + ',' + Math.floor(pz / CH);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push([px, pz]);
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    this.count = 0;
    for (const list of buckets.values()) {
      const chunk = { hi: [], lo: [], center: new THREE.Vector3() };
      const perKind = {};
      for (const [px, pz] of list) {
        const kind = kinds.length > 1 ? (r() < 0.65 ? kinds[0] : kinds[1]) : kinds[0];
        (perKind[kind] ||= []).push([px, pz]);
        chunk.center.x += px; chunk.center.z += pz;
      }
      chunk.center.multiplyScalar(1 / list.length);
      chunk.center.y = sampleH(chunk.center.x, chunk.center.z);
      for (const [kind, pts] of Object.entries(perKind)) {
        const hi = new THREE.InstancedMesh(geos[kind].hi, mat, pts.length);
        const lo = new THREE.InstancedMesh(geos[kind].lo, mat, pts.length);
        pts.forEach(([px, pz], idx) => {
          const sc = 0.75 + r() * 0.6;
          q.setFromAxisAngle(up, r() * Math.PI * 2);
          m4.compose(new THREE.Vector3(px, sampleH(px, pz) - 0.3, pz), q, new THREE.Vector3(sc, sc * (0.85 + r() * 0.3), sc));
          hi.setMatrixAt(idx, m4);
          lo.setMatrixAt(idx, m4);
          col.setHSL(0.27 + (r() - 0.5) * 0.06, 0.35 + r() * 0.2, 0.75 + r() * 0.35);
          hi.setColorAt(idx, col);
          lo.setColorAt(idx, col);
        });
        hi.computeBoundingSphere();
        lo.computeBoundingSphere();
        hi.castShadow = quality === 'high' || quality === 'ultra';
        hi.receiveShadow = false;
        lo.visible = false;
        this.group.add(hi, lo);
        chunk.hi.push(hi);
        chunk.lo.push(lo);
        this.count += pts.length;
      }
      this.chunks.push(chunk);
    }
  }

  /** przelaczanie poziomu szczegolowosci i ukrywanie dalekich fragmentow */
  update(camPos) {
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - camPos.x, c.center.z - camPos.z);
      const near = d < this.lodDist;
      const vis = d < this.viewDist;
      for (const m of c.hi) m.visible = vis && near;
      for (const m of c.lo) m.visible = vis && !near;
    }
  }
}
