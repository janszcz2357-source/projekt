// Proceduralne tekstury (canvas) - brak zewnetrznych plikow graficznych.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// deterministyczny generator pseudolosowy
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function toTexture(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// szum wartosci (value noise) na kafelkowalnej siatce
function tileNoise(size, cells, seed) {
  const r = rng(seed);
  const g = new Float32Array(cells * cells).map(() => r());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const ax = fx - ix, ay = fy - iy;
      const sx = ax * ax * (3 - 2 * ax), sy = ay * ay * (3 - 2 * ay);
      const a = g[(iy % cells) * cells + (ix % cells)];
      const b = g[(iy % cells) * cells + ((ix + 1) % cells)];
      const c = g[((iy + 1) % cells) * cells + (ix % cells)];
      const d = g[((iy + 1) % cells) * cells + ((ix + 1) % cells)];
      out[y * size + x] = (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
    }
  }
  return out;
}

function fbm(size, seed, octaves = [[4, 0.5], [8, 0.25], [16, 0.15], [32, 0.1]]) {
  const out = new Float32Array(size * size);
  octaves.forEach(([cells, amp], k) => {
    const n = tileNoise(size, cells, seed + k * 97);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
  });
  return out;
}

const cache = {};

/** asfalt: drobne kruszywo + plamy; mapa koloru i chropowatosci */
export function asphaltTextures() {
  if (cache.asphalt) return cache.asphalt;
  const S = 512;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const n = fbm(S, 11);
  const r = rng(5);
  const rough = canvas(S, S);
  const rctx = rough.getContext('2d');
  const rimg = rctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const grain = r();
    let v = 0.25 + n[i] * 0.07 + (grain - 0.5) * 0.11;
    if (grain > 0.985) v += 0.16; // jasne ziarna
    if (grain < 0.012) v -= 0.08;
    const c8 = Math.max(0, Math.min(255, v * 255));
    img.data[i * 4] = c8 * 0.98;
    img.data[i * 4 + 1] = c8;
    img.data[i * 4 + 2] = c8 * 1.03;
    img.data[i * 4 + 3] = 255;
    const rv = 200 + (grain - 0.5) * 60 - n[i] * 30;
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = Math.max(0, Math.min(255, rv));
    rimg.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  // drobne pekniecia / laty
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#151515';
  for (let k = 0; k < 14; k++) {
    ctx.lineWidth = 0.6 + r() * 1.2;
    ctx.beginPath();
    let x = r() * S, y = r() * S;
    ctx.moveTo(x, y);
    for (let j = 0; j < 6; j++) {
      x += (r() - 0.5) * 40; y += (r() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  cache.asphalt = { map: toTexture(c, { aniso: 16 }), roughness: toTexture(rough, { srgb: false, aniso: 16 }) };
  return cache.asphalt;
}

export function grassTexture() {
  if (cache.grass) return cache.grass;
  const S = 512;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const n = fbm(S, 23);
  const r = rng(9);
  for (let i = 0; i < S * S; i++) {
    const g = r();
    const v = 0.75 + n[i] * 0.35 + (g - 0.5) * 0.35;
    img.data[i * 4] = Math.min(255, 255 * v * 0.40);
    img.data[i * 4 + 1] = Math.min(255, 255 * v * 0.55);
    img.data[i * 4 + 2] = Math.min(255, 255 * v * 0.27);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // zdzbla
  for (let k = 0; k < 3500; k++) {
    const x = r() * S, y = r() * S;
    ctx.strokeStyle = r() > 0.5 ? 'rgba(150,180,90,0.35)' : 'rgba(40,70,25,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
    ctx.stroke();
  }
  cache.grass = toTexture(c, { aniso: 8 });
  return cache.grass;
}

export function gravelTexture() {
  if (cache.gravel) return cache.gravel;
  const S = 512;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const n = fbm(S, 31);
  const r = rng(13);
  for (let i = 0; i < S * S; i++) {
    const v = 0.72 + n[i] * 0.2 + (r() - 0.5) * 0.3;
    img.data[i * 4] = Math.min(255, 255 * v * 0.78);
    img.data[i * 4 + 1] = Math.min(255, 255 * v * 0.70);
    img.data[i * 4 + 2] = Math.min(255, 255 * v * 0.58);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (let k = 0; k < 2600; k++) {
    const x = r() * S, y = r() * S, rad = 1 + r() * 2.5;
    const l = 120 + r() * 110;
    ctx.fillStyle = `rgba(${l},${l * 0.92},${l * 0.8},0.85)`;
    ctx.beginPath();
    ctx.ellipse(x, y, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(40,35,30,0.35)';
    ctx.beginPath();
    ctx.ellipse(x + 0.8, y + 0.8, rad, rad * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  cache.gravel = toTexture(c, { aniso: 8 });
  return cache.gravel;
}

/** kraweznik: naprzemienne pasy czerwone/biale (1 powtorzenie = 2 pasy) */
export function curbTexture(colA = '#c8141c', colB = '#f2f2f2') {
  const key = 'curb' + colA + colB;
  if (cache[key]) return cache[key];
  const c = canvas(128, 32);
  const ctx = c.getContext('2d');
  ctx.fillStyle = colA;
  ctx.fillRect(0, 0, 64, 32);
  ctx.fillStyle = colB;
  ctx.fillRect(64, 0, 64, 32);
  const r = rng(3);
  for (let k = 0; k < 600; k++) {
    ctx.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
    ctx.fillRect(r() * 128, r() * 32, 1.5, 1.5);
  }
  // przyciemnienie od opon
  const g = ctx.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.25)');
  g.addColorStop(0.4, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 32);
  cache[key] = toTexture(c, { aniso: 8 });
  return cache[key];
}

export function concreteTexture() {
  if (cache.concrete) return cache.concrete;
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const n = fbm(S, 41, [[4, 0.5], [16, 0.3], [64, 0.2]]);
  const r = rng(17);
  for (let i = 0; i < S * S; i++) {
    const v = 0.62 + n[i] * 0.18 + (r() - 0.5) * 0.08;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.min(255, v * 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // fugi
  ctx.fillStyle = 'rgba(40,40,40,0.5)';
  ctx.fillRect(0, 0, 2, S);
  cache.concrete = toTexture(c);
  return cache.concrete;
}

/** siatka ogrodzenia (alpha) */
export function fenceTexture() {
  if (cache.fence) return cache.fence;
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(200,205,210,0.9)';
  ctx.lineWidth = 2;
  for (let k = -S; k < S * 2; k += 16) {
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + S, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k, S); ctx.lineTo(k + S, 0); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(120,125,130,1)';
  ctx.fillRect(0, 0, S, 5);
  const t = toTexture(c, { aniso: 4 });
  cache.fence = t;
  return t;
}

/** sciana opon */
export function tyreWallTexture() {
  if (cache.tyres) return cache.tyres;
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#121212';
  ctx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = col * 32 + 16 + (row % 2) * 16, y = row * 32 + 16;
      ctx.fillStyle = '#262626';
      ctx.beginPath(); ctx.arc(x % 128, y, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#080808';
      ctx.beginPath(); ctx.arc(x % 128, y, 7, 0, Math.PI * 2); ctx.fill();
    }
  }
  // pas ochronny
  ctx.fillStyle = '#1d3f8f';
  ctx.fillRect(0, 50, 128, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(0, 50, 128, 3);
  cache.tyres = toTexture(c);
  return cache.tyres;
}

const BRANDS = ['APEX', 'VELOCITÀ', 'NORDLINE', 'KESTREL OIL', 'MERIDIAN', 'TORQUE+', 'AURORA', 'GRIDLINE', 'SPEEDHAUS', 'CARBONICA'];
const BRAND_COLORS = [['#d21f26', '#ffffff'], ['#0b2e6b', '#ffd200'], ['#111111', '#7cfc00'], ['#ffffff', '#003da5'], ['#f47b20', '#111'], ['#00553a', '#fff'], ['#e9e9e9', '#c00'], ['#222', '#ff3b8d']];

/** atlas tablic reklamowych (fikcyjne marki): kolumna u = indeks reklamy */
export function adsTexture() {
  if (cache.ads) return cache.ads;
  const W = 1024, H = 64 * BRANDS.length;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  BRANDS.forEach((b, i) => {
    const [bg, fg] = BRAND_COLORS[i % BRAND_COLORS.length];
    ctx.fillStyle = bg;
    ctx.fillRect(0, i * 64, W, 64);
    ctx.fillStyle = fg;
    ctx.font = 'bold 44px Arial, Helvetica, sans-serif';
    ctx.textBaseline = 'middle';
    for (let k = 0; k < 3; k++) ctx.fillText(b, 20 + k * 345, i * 64 + 34);
  });
  const t = toTexture(c, { aniso: 8 });
  t.userData = { rows: BRANDS.length };
  cache.ads = t;
  return t;
}

/** trybuna z widzami */
export function crowdTexture() {
  if (cache.crowd) return cache.crowd;
  const c = canvas(256, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a4f57';
  ctx.fillRect(0, 0, 256, 128);
  const r = rng(77);
  const cols = ['#d33', '#eee', '#3366cc', '#ffcc00', '#222', '#2a8f3a', '#ff7a1a', '#9933cc', '#e8c0a0'];
  for (let row = 0; row < 16; row++) {
    for (let k = 0; k < 64; k++) {
      if (r() < 0.12) continue;
      ctx.fillStyle = cols[Math.floor(r() * cols.length)];
      ctx.fillRect(k * 4 + r(), row * 8 + 2, 3, 4);
      ctx.fillStyle = '#e0b090';
      ctx.fillRect(k * 4 + 0.5, row * 8, 2, 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, row * 8 + 7, 256, 1);
  }
  cache.crowd = toTexture(c);
  return cache.crowd;
}

/** kratka startowa */
export function checkerTexture() {
  if (cache.checker) return cache.checker;
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
    ctx.fillRect(x * 16, y * 16, 16, 16);
  }
  const t = toTexture(c);
  t.magFilter = THREE.NearestFilter;
  cache.checker = t;
  return t;
}

/** miekka czastka (dym, pyl) */
export function smokeSprite() {
  if (cache.smoke) return cache.smoke;
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  cache.smoke = toTexture(c, { repeat: false });
  return cache.smoke;
}

/** opona - bieznik i bok */
export function tyreTexture() {
  if (cache.tyre) return cache.tyre;
  const c = canvas(256, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#161616';
  ctx.fillRect(0, 0, 256, 64);
  const r = rng(91);
  for (let k = 0; k < 1500; k++) {
    ctx.fillStyle = `rgba(${40 + r() * 30},${40 + r() * 30},${40 + r() * 30},0.4)`;
    ctx.fillRect(r() * 256, r() * 64, 1, 1);
  }
  // napis na boku
  ctx.fillStyle = 'rgba(230,230,230,0.85)';
  ctx.font = 'bold 13px Arial';
  ctx.fillText('APEX SLICK', 10, 14);
  ctx.fillText('APEX SLICK', 138, 14);
  cache.tyre = toTexture(c);
  return cache.tyre;
}

export { rng };
