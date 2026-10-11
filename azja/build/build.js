const fs = require('fs');
const path = require('path');
const d3 = require('d3-geo');
const topojson = require('topojson-client');
const { cats, items } = require('./items.js');

const DATA = path.join(__dirname, 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const W = 1000;
const TOL = parseFloat(process.env.TOL || '0.35');

// Kadr: wszystkie obiekty z listy + kilka punktów brzegowych Azji, z marginesem.
const { items: ITEMS } = require('./items.js');
const focus = [];
for (const k in ITEMS) for (const it of ITEMS[k]) focus.push([it[2], it[3]]);
focus.push([26.5, 40], [32, 30], [43.5, 12], [59.5, 22.5], [78, -8.5], [106, -8.5], [114, -8.8],
  [190, 66], [180, 69.5], [104, 78], [100, 81.2], [140, 76.5], [156, 50], [125, 6], [127, 1]);
const PAD = 14;
const projection = d3.geoConicEqualArea().parallels([10, 50]).rotate([-100, 0]).precision(0.1);
projection.fitWidth(W - 2 * PAD, { type: 'MultiPoint', coordinates: focus });
const b = d3.geoPath(projection).bounds({ type: 'MultiPoint', coordinates: focus });
const H = Math.round(b[1][1] - b[0][1] + 2 * PAD);
const t0 = projection.translate();
projection.translate([t0[0] - b[0][0] + PAD, t0[1] - b[0][1] + PAD]);
projection.clipExtent([[0, 0], [W, H]]);

// Zbiera ścieżki z geoPath, upraszcza (Douglas-Peucker w pikselach) i serializuje.
function collect(geo, closedHint) {
  const lines = [];
  let cur = null;
  const ctx = {
    moveTo(x, y) { cur = [[x, y]]; lines.push({ pts: cur, closed: false }); },
    lineTo(x, y) { cur.push([x, y]); },
    closePath() { lines[lines.length - 1].closed = true; },
    arc() {},
  };
  d3.geoPath(projection, ctx)(geo);
  return lines;
}
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, z] = stack.pop();
    const [ax, ay] = pts[a], [zx, zy] = pts[z];
    const dx = zx - ax, dy = zy - ay, len = Math.hypot(dx, dy) || 1e-9;
    let md = -1, mi = -1;
    for (let i = a + 1; i < z; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + zx * ay - zy * ax) / len;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, z]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r1 = (v) => Math.round(v * 10) / 10;
function ser(lines, tol = TOL, minLen = 0) {
  let out = '';
  for (const l of lines) {
    let pts = l.pts;
    if (l.closed && pts.length > 3) {
      // pierścień: dzielimy na dwie połowy, żeby DP nie zjadł go do odcinka
      const m = pts.length >> 1;
      pts = dp(pts.slice(0, m + 1), tol).concat(dp(pts.slice(m), tol).slice(1));
    } else pts = dp(pts, tol);
    if (l.closed && pts.length < 4) continue;
    // pomiń maleńkie wysepki
    if (l.closed && minLen) {
      let per = 0; for (let i = 1; i < pts.length; i++) per += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (per < minLen) continue;
    }
    let px = null, py = null, s = '';
    pts.forEach(([x, y], i) => {
      x = r1(x); y = r1(y);
      if (i && x === px && y === py) return;
      s += (i ? 'L' : 'M') + x + ' ' + y;
      px = x; py = y;
    });
    out += s + (l.closed ? 'Z' : '');
  }
  return out.replace(/L/g, ' ').replace(/ -/g, '-');
}
// M x y L x y  -> M x y x y (domyślna kontynuacja L) – mniej bajtów
function compact(s) { return s; }

const landTopo = read('land50.json');
const land = topojson.feature(landTopo, landTopo.objects.land);
const countriesTopo = read('countries50.json');
const borders = topojson.mesh(countriesTopo, countriesTopo.objects.countries, (a, c) => a !== c);
const lakes = read('lakes.geojson');
const rivers = read('rivers.geojson');

const inView = (f) => {
  const bb = d3.geoBounds(f);
  const c = projection(d3.geoCentroid(f));
  return c && c[0] > -50 && c[0] < W + 50 && c[1] > -50 && c[1] < H + 50;
};

const out = { W, H, cats, items: [] };
out.land = ser(collect(land), TOL, 2.5);
out.borders = ser(collect(borders), TOL * 1.2);
out.lakes = ser(collect({ type: 'FeatureCollection', features: lakes.features.filter(inView) }), TOL * 0.7, 1.5);
const grat = d3.geoGraticule().step([10, 10]).extentMajor([[-180, -80], [180, 80.01]])();
out.graticule = ser(collect(grat), 0.2);
const parallel = (lat) => ({ type: 'LineString', coordinates: Array.from({ length: 361 }, (_, i) => i - 180).map((lon) => [lon, lat]) });
out.lines = [
  { name: 'równik', d: ser(collect(parallel(0)), 0.2), lat: 0 },
  { name: 'zwrotnik Raka', d: ser(collect(parallel(23.44)), 0.2), lat: 23.44 },
  { name: 'koło podbiegunowe północne', d: ser(collect(parallel(66.56)), 0.2), lat: 66.56 },
];
// punkty kandydujące na podpis linii (co 5° długości)
for (const ln of out.lines) {
  ln.pts = [];
  for (let lon = 30; lon <= 185; lon += 5) {
    const p = projection([lon, ln.lat]);
    if (p && p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H) ln.pts.push([r1(p[0]), r1(p[1])]);
  }
  delete ln.lat;
}

// Rzeki: wszystkie w kadrze (tło) + nazwane z listy (osobno, do podświetlania)
const namedMap = {};
for (const it of items.rzeki) for (const n of it[5]) namedMap[n] = it[0];
const ctxRivers = rivers.features.filter((f) => f.geometry && inView(f) && !namedMap[f.properties.name]);
out.rivers = ser(collect({ type: 'FeatureCollection', features: ctxRivers }), TOL * 0.8);

const landContains = (lonlat) => d3.geoContains(land, lonlat);
const problems = [];

for (const c of cats) {
  for (const it of items[c.id]) {
    const [name, kind, lon, lat, fact, riverNames] = it;
    let [x, y] = projection([lon, lat]);
    const rec = { id: '', name, kind, cat: c.id, fact };
    if (riverNames) {
      const feats = rivers.features.filter((f) => f.geometry && riverNames.includes(f.properties.name) && inView(f));
      const found = new Set(feats.map((f) => f.properties.name));
      for (const n of riverNames) if (!found.has(n)) problems.push(`rzeka ${name}: brak ${n}`);
      const lines = collect({ type: 'FeatureCollection', features: feats });
      rec.d = ser(lines, TOL * 0.6);
      // przyciągnij znacznik do najbliższego punktu rzeki
      let best = null, bd = Infinity;
      for (const l of lines) for (const p of l.pts) {
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d < bd) { bd = d; best = p; }
      }
      if (bd > 6) problems.push(`rzeka ${name}: znacznik ${bd.toFixed(1)}px od rzeki`);
      [x, y] = best;
    } else {
      const onLand = landContains([lon, lat]);
      if (c.id === 'morza' && onLand) problems.push(`${name}: wypada na lądzie`);
      if (['wyspy', 'gory', 'niziny', 'pustynie'].includes(c.id) && !onLand) problems.push(`${name}: wypada w wodzie`);
      if (c.id === 'jeziora') {
        const inLake = lakes.features.some((f) => d3.geoContains(f, [lon, lat]));
        if (!inLake && onLand) {
          let best = null, bd = Infinity;
          for (let dx = -1.5; dx <= 1.5; dx += 0.05) for (let dy = -1.5; dy <= 1.5; dy += 0.05) {
            const q = [lon + dx, lat + dy];
            if (lakes.features.some((f) => d3.geoContains(f, q))) {
              const dd = Math.hypot(dx, dy); if (dd < bd) { bd = dd; best = q; }
            }
          }
          if (best) { [x, y] = projection(best); console.log(`${name}: przesunięte do ${best.map((v) => v.toFixed(2))}`); }
          else problems.push(`${name}: nie leży w jeziorze`);
        }
      }
    }
    if (x < 0 || x > W || y < 0 || y > H) problems.push(`${name}: poza kadrem`);
    if (fact.toLowerCase().includes(name.toLowerCase().split(' ')[0].slice(0, 5)) && !['Ocean', 'Morze', 'Zatok', 'Góry', 'Jezio'].includes(name.slice(0, 5)))
      problems.push(`${name}: ciekawostka zdradza nazwę`);
    rec.x = r1(x); rec.y = r1(y);
    out.items.push(rec);
  }
}
out.items.forEach((it, i) => { it.id = 'o' + i; });

// sprawdź za bliskie znaczniki
for (let i = 0; i < out.items.length; i++) for (let j = i + 1; j < out.items.length; j++) {
  const a = out.items[i], c = out.items[j];
  const d = Math.hypot(a.x - c.x, a.y - c.y);
  if (d < 9) problems.push(`blisko (${d.toFixed(1)}px): ${a.name} / ${c.name}`);
}

fs.writeFileSync(path.join(__dirname, 'map.json'), JSON.stringify(out));
console.log('W,H', W, H, 'items', out.items.length);
for (const k of ['land', 'borders', 'lakes', 'rivers', 'graticule']) console.log(k, (out[k].length / 1024).toFixed(1) + 'KB');
console.log('named rivers', (out.items.filter((i) => i.d).reduce((s, i) => s + i.d.length, 0) / 1024).toFixed(1) + 'KB');
console.log('total', (JSON.stringify(out).length / 1024).toFixed(1) + 'KB');
console.log(problems.join('\n') || 'brak problemów');
