// Narzedzie offline: buduje dane torow z rzeczywistych zrodel.
//
//  1. Linia srodkowa + szerokosci: TUMFTM racetrack-database (OSM + szerokosci ze zdjec satelitarnych), LGPL-3.0
//  2. Georeferencja: dopasowanie (ICP, ruch sztywny) do GeoJSON bacinger/f1-circuits (lon/lat), MIT.
//     Pierwszy punkt GeoJSON traktujemy jako linie startu/mety.
//  3. Wysokosci: AWS Terrain Tiles (format "terrarium", zrodla SRTM/EU-DEM itd.), probkowane wzdluz toru
//     i na siatce terenu wokol toru.
//
// Wynik: src/tracks/data/<id>.json (zwarte dane, cala reszta geometrii liczona w runtime).
// Uruchomienie: npm run build:tracks  (wymaga sieci przy pierwszym uruchomieniu; kafelki sa cache'owane).

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REF = path.join(ROOT, 'tools/ref');
const CACHE = path.join(ROOT, 'tools/cache');
const OUT = path.join(ROOT, 'src/tracks/data');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const EARTH_R = 6378137;
const DEM_ZOOM = 14;

const TRACKS = [
  // elevSigma: wygladzanie profilu wysokosci [m]. Monza lezy w zalesionym parku - DEM (model powierzchni)
  // zawiera tam korony drzew, wiec profil wygladzamy mocniej.
  { id: 'monza', tum: 'Monza', geo: 'it-1922', terrainMargin: 700, elevSigma: 60, elevMedian: 41, crossAgg: 'min' },
  { id: 'spa', tum: 'Spa', geo: 'be-1925', terrainMargin: 900, elevSigma: 25, elevMedian: 31, crossAgg: 'median' },
  // Silverstone: GeoJSON zaczyna sie na dawnej linii mety (National Pit Straight, przed Copse).
  // Od 2011 r. start/meta jest na Hamilton Straight miedzy Club a Abbey -> przesuniecie wzdluz toru
  // (polozenie linii przyblizone: ok. 280 m przed wierzcholkiem Abbey).
  { id: 'silverstone', tum: 'Silverstone', geo: 'gb-1948', terrainMargin: 700, elevSigma: 35, elevMedian: 31, crossAgg: 'median', startShift: 3170 },
];

// ---------------------------------------------------------------- helpers
function readCsv(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(',').map(Number));
}

function makeProjection(lat0, lon0) {
  const k = Math.PI / 180;
  const cos0 = Math.cos(lat0 * k);
  return {
    toLocal: (lon, lat) => [(lon - lon0) * k * EARTH_R * cos0, (lat - lat0) * k * EARTH_R],
    toGeo: (e, n) => [lon0 + e / (k * EARTH_R * cos0), lat0 + n / (k * EARTH_R)],
  };
}

function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const d = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(d / step));
    for (let j = 0; j < n; j++) out.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
  }
  return out;
}

// simple uniform grid for nearest-point queries
function makeGrid(pts, cell) {
  const map = new Map();
  pts.forEach((p, i) => {
    const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i);
  });
  return {
    nearest(x, y) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      let best = -1, bd = Infinity;
      for (let r = 0; r < 50; r++) {
        for (let gx = cx - r; gx <= cx + r; gx++) {
          for (let gy = cy - r; gy <= cy + r; gy++) {
            if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== r) continue;
            const l = map.get(`${gx},${gy}`);
            if (!l) continue;
            for (const i of l) {
              const d = (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2;
              if (d < bd) { bd = d; best = i; }
            }
          }
        }
        if (best >= 0 && r * cell > Math.sqrt(bd) + cell) break;
      }
      return { index: best, dist: Math.sqrt(bd) };
    },
  };
}

function transform(pts, theta, mirror, tx, ty) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return pts.map(([x, y]) => {
    const xx = mirror ? -x : x;
    return [c * xx - s * y + tx, s * xx + c * y + ty];
  });
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

// rigid 2D ICP (rotation + translation, no scale)
function alignICP(src, dstGrid, dstPts) {
  const cs = centroid(src);
  const cd = centroid(dstPts);
  const centered = src.map(([x, y]) => [x - cs[0], y - cs[1]]);
  const sample = centered.filter((_, i) => i % 4 === 0);
  let best = null;
  for (const mirror of [false, true]) {
    for (let deg = 0; deg < 360; deg += 2) {
      const th = (deg * Math.PI) / 180;
      const t = transform(sample, th, mirror, cd[0], cd[1]);
      let err = 0;
      for (const p of t) err += dstGrid.nearest(p[0], p[1]).dist;
      err /= t.length;
      if (!best || err < best.err) best = { err, theta: th, mirror, tx: cd[0], ty: cd[1] };
    }
  }
  // refine with Procrustes iterations
  let { theta, mirror, tx, ty } = best;
  for (let it = 0; it < 60; it++) {
    const cur = transform(centered, theta, mirror, tx, ty);
    const pairsA = [], pairsB = [];
    for (let i = 0; i < cur.length; i++) {
      const n = dstGrid.nearest(cur[i][0], cur[i][1]);
      if (n.dist < 40) { pairsA.push(cur[i]); pairsB.push(dstPts[n.index]); }
    }
    const ca = centroid(pairsA), cb = centroid(pairsB);
    let sxx = 0, sxy = 0;
    for (let i = 0; i < pairsA.length; i++) {
      const ax = pairsA[i][0] - ca[0], ay = pairsA[i][1] - ca[1];
      const bx = pairsB[i][0] - cb[0], by = pairsB[i][1] - cb[1];
      sxx += ax * bx + ay * by;
      sxy += ax * by - ay * bx;
    }
    const dth = Math.atan2(sxy, sxx);
    // apply incremental rotation about ca then translate to cb
    theta += dth;
    const c = Math.cos(dth), s = Math.sin(dth);
    const ntx = c * (tx - ca[0]) - s * (ty - ca[1]) + cb[0];
    const nty = s * (tx - ca[0]) + c * (ty - ca[1]) + cb[1];
    tx = ntx; ty = nty;
    if (Math.abs(dth) < 1e-7) break;
  }
  const final = transform(centered, theta, mirror, tx, ty);
  const dists = final.map((p) => dstGrid.nearest(p[0], p[1]).dist);
  const rms = Math.sqrt(dists.reduce((a, d) => a + d * d, 0) / dists.length);
  const max = Math.max(...dists);
  return {
    apply: (pts) => transform(pts.map(([x, y]) => [x - cs[0], y - cs[1]]), theta, mirror, tx, ty),
    rms, max, thetaDeg: (theta * 180) / Math.PI, mirror,
  };
}

// ---------------------------------------------------------------- DEM (terrarium tiles)
const tileCache = new Map();
async function getTile(z, x, y) {
  const key = `${z}_${x}_${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const file = path.join(CACHE, `terrarium_${key}.png`);
  if (!fs.existsSync(file)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`DEM tile ${url}: HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const png = PNG.sync.read(fs.readFileSync(file));
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2];
    h[i] = r * 256 + g + b / 256 - 32768;
  }
  tileCache.set(key, h);
  return h;
}

function lonLatToPixel(lon, lat, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n * 256;
  const latR = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n * 256;
  return [x, y];
}

async function demSampler(lonMin, latMin, lonMax, latMax) {
  const [px0, py1] = lonLatToPixel(lonMin, latMin, DEM_ZOOM);
  const [px1, py0] = lonLatToPixel(lonMax, latMax, DEM_ZOOM);
  const tx0 = Math.floor(px0 / 256) - 1, tx1 = Math.floor(px1 / 256) + 1;
  const ty0 = Math.floor(py0 / 256) - 1, ty1 = Math.floor(py1 / 256) + 1;
  for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) await getTile(DEM_ZOOM, x, y);
  const pix = (gx, gy) => {
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    const t = tileCache.get(`${DEM_ZOOM}_${tx}_${ty}`);
    return t[(gy - ty * 256) * 256 + (gx - tx * 256)];
  };
  return (lon, lat) => {
    const [x, y] = lonLatToPixel(lon, lat, DEM_ZOOM);
    const fx = x - 0.5, fy = y - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const ax = fx - ix, ay = fy - iy;
    return (pix(ix, iy) * (1 - ax) + pix(ix + 1, iy) * ax) * (1 - ay)
      + (pix(ix, iy + 1) * (1 - ax) + pix(ix + 1, iy + 1) * ax) * ay;
  };
}

function medianClosed(values, win) {
  const n = values.length;
  const r = Math.floor(win / 2);
  return values.map((_, i) => {
    const w = [];
    for (let k = -r; k <= r; k++) w.push(values[(i + k + n) % n]);
    w.sort((a, b) => a - b);
    return w[r];
  });
}

function gaussianSmoothClosed(values, sigmaSamples) {
  const n = values.length;
  const r = Math.ceil(sigmaSamples * 3);
  const w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples)));
  const ws = w.reduce((a, b) => a + b, 0);
  return values.map((_, i) => {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += values[(i + k + n) % n] * w[k + r];
    return acc / ws;
  });
}

// ---------------------------------------------------------------- main
const geo = JSON.parse(fs.readFileSync(path.join(REF, 'f1-circuits.geojson'), 'utf8'));

for (const def of TRACKS) {
  const feat = geo.features.find((f) => f.properties.id === def.geo);
  const coords = feat.geometry.coordinates;
  const lat0 = coords.reduce((a, c) => a + c[1], 0) / coords.length;
  const lon0 = coords.reduce((a, c) => a + c[0], 0) / coords.length;
  const proj = makeProjection(lat0, lon0);
  const geoLocal = coords.map(([lon, lat]) => proj.toLocal(lon, lat));
  const geoDense = densify(geoLocal, 2);
  const geoGrid = makeGrid(geoDense, 20);

  const tum = readCsv(path.join(REF, `tum_track_${def.tum}.csv`));
  const tumRL = readCsv(path.join(REF, `tum_raceline_${def.tum}.csv`));
  const fit = alignICP(tum.map((r) => [r[0], r[1]]), geoGrid, geoDense);
  const center = fit.apply(tum.map((r) => [r[0], r[1]]));
  const raceline = fit.apply(tumRL.map((r) => [r[0], r[1]]));

  // start/finish = point closest to the first GeoJSON coordinate
  const sf = geoLocal[0];
  let sfIdx = 0, sfD = Infinity;
  center.forEach((p, i) => {
    const d = Math.hypot(p[0] - sf[0], p[1] - sf[1]);
    if (d < sfD) { sfD = d; sfIdx = i; }
  });
  const n = center.length;
  if (def.startShift) sfIdx = (sfIdx + Math.round(def.startShift / 5)) % n; // probki co 5 m
  const order = [...Array(n).keys()].map((k) => (k + sfIdx) % n);
  const pts = order.map((i) => center[i]);
  const widths = order.map((i) => [tum[i][3], tum[i][2]]); // [left, right]

  // check direction matches GeoJSON direction (both are clockwise, verify locally at the GeoJSON start)
  const g1 = geoLocal[3];
  const k0 = (n - (def.startShift ? Math.round(def.startShift / 5) : 0)) % n;
  const pa = pts[k0], pb = pts[(k0 + 8) % n];
  const dirDot = (pb[0] - pa[0]) * (g1[0] - sf[0]) + (pb[1] - pa[1]) * (g1[1] - sf[1]);
  if (dirDot < 0) throw new Error(`${def.id}: direction mismatch`);

  // geo bounds
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const [e, nn] of pts) { minE = Math.min(minE, e); maxE = Math.max(maxE, e); minN = Math.min(minN, nn); maxN = Math.max(maxN, nn); }
  const m = def.terrainMargin;
  const [lonMin, latMin] = proj.toGeo(minE - m - 100, minN - m - 100);
  const [lonMax, latMax] = proj.toGeo(maxE + m + 100, maxN + m + 100);
  const dem = await demSampler(lonMin, latMin, lonMax, latMax);

  // elevation along centerline: minimum of 5 samples across the track (suppresses tree canopy at the
  // edges of the clearing), then a closed-loop gaussian along the lap
  const rawElev = pts.map((p, i) => {
    const a = pts[(i + 1) % n], b = pts[(i - 1 + n) % n];
    let tx = a[0] - b[0], ty = a[1] - b[1];
    const l = Math.hypot(tx, ty); tx /= l; ty /= l;
    const nx = -ty, ny = tx; // left normal
    const vals = [-10, -5, 0, 5, 10].map((off) => {
      const [lon, lat] = proj.toGeo(p[0] + nx * off, p[1] + ny * off);
      return dem(lon, lat);
    }).sort((x, y) => x - y);
    // 'min' tlumi korony drzew (plaski park), 'median' jest odporniejsza na zbocza (tor wzdluz stoku)
    return def.crossAgg === 'min' ? vals[0] : vals[2];
  });
  // mediana (~150-200 m) usuwa krotkie artefakty DEM (drzewa, budynki, trybuny), gauss wygladza
  const elev = gaussianSmoothClosed(medianClosed(rawElev, def.elevMedian), def.elevSigma / 5); // probki co 5 m

  // terrain grid (relative to S/F elevation)
  const elevRef = elev[0];
  const cell = 20;
  const x0 = Math.floor((minE - m) / cell) * cell, x1 = Math.ceil((maxE + m) / cell) * cell;
  const y0 = Math.floor((minN - m) / cell) * cell, y1 = Math.ceil((maxN + m) / cell) * cell;
  const nx = Math.round((x1 - x0) / cell) + 1, ny = Math.round((y1 - y0) / cell) + 1;
  const terr = new Int16Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const [lon, lat] = proj.toGeo(x0 + i * cell, y0 + j * cell);
      terr[j * nx + i] = Math.round((dem(lon, lat) - elevRef) * 10);
    }
  }

  // stats
  const L = pts.reduce((a, p, i) => a + Math.hypot(pts[(i + 1) % n][0] - p[0], pts[(i + 1) % n][1] - p[1]), 0);
  const eMin = Math.min(...elev), eMax = Math.max(...elev);
  let maxGrade = 0, minGrade = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 4) % n;
    const d = 20;
    const g = (elev[j] - elev[i]) / d;
    maxGrade = Math.max(maxGrade, g); minGrade = Math.min(minGrade, g);
  }
  const [sfLon, sfLat] = proj.toGeo(pts[0][0], pts[0][1]);
  console.log(`${def.id}: n=${n} L=${L.toFixed(0)} m  ICP rms=${fit.rms.toFixed(1)} m max=${fit.max.toFixed(1)} m rot=${fit.thetaDeg.toFixed(1)} deg mirror=${fit.mirror}`);
  console.log(`   S/F @ ${sfLat.toFixed(5)}, ${sfLon.toFixed(5)} (offset to GeoJSON start ${sfD.toFixed(1)} m)`);
  console.log(`   elevation: S/F ${elevRef.toFixed(1)} m a.s.l., min ${eMin.toFixed(1)}, max ${eMax.toFixed(1)}, range ${(eMax - eMin).toFixed(1)} m, grade +${(maxGrade * 100).toFixed(1)}% / ${(minGrade * 100).toFixed(1)}%`);
  console.log(`   terrain grid ${nx}x${ny} @ ${cell} m`);

  const r2 = (v) => Math.round(v * 100) / 100;
  // world mapping used by the game: x = east, z = -north, y = up (relative to S/F elevation)
  const out = {
    id: def.id,
    sources: {
      centerline: `TUMFTM racetrack-database (${def.tum}.csv, LGPL-3.0) – OSM GPS + szerokosci ze zdjec satelitarnych`,
      raceline: `TUMFTM racetrack-database racelines/${def.tum}.csv (minimum curvature)`,
      georef: `bacinger/f1-circuits ${def.geo} (MIT), dopasowanie ICP rms ${fit.rms.toFixed(1)} m`,
      startFinish: def.startShift ? 'przesunieta na Hamilton Straight (uklad od 2011), polozenie przyblizone' : 'pierwszy punkt GeoJSON',
      elevation: `AWS Terrain Tiles (terrarium, z14), ${def.crossAgg === 'min' ? 'minimum' : 'mediana'} z 5 probek w poprzek toru, mediana ${def.elevMedian * 5} m + gauss sigma=${def.elevSigma} m`,
    },
    ref: { lat: lat0, lon: lon0, elevation: r2(elevRef) },
    lengthMeasured: Math.round(L),
    // centerline: [east, north, elevRel, widthLeft, widthRight]
    centerline: pts.map((p, i) => [r2(p[0]), r2(p[1]), r2(elev[i] - elevRef), r2(widths[i][0]), r2(widths[i][1])]),
    raceline: raceline.map((p) => [r2(p[0]), r2(p[1])]),
    terrain: { x0, y0, cell, nx, ny, scale: 0.1, data: Buffer.from(terr.buffer).toString('base64') },
  };
  fs.writeFileSync(path.join(OUT, `${def.id}.json`), JSON.stringify(out));
  console.log(`   -> src/tracks/data/${def.id}.json (${(fs.statSync(path.join(OUT, `${def.id}.json`)).size / 1024).toFixed(0)} kB)`);
}
