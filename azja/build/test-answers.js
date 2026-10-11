// Testy sprawdzania wpisanych odpowiedzi: node test-answers.js [plik-z-dodatkowymi-przypadkami.json]
const fs = require('fs');
const path = require('path');
const A = require('../src/answers.js');
const map = JSON.parse(fs.readFileSync(path.join(__dirname, 'map.json'), 'utf8'));
let cases = require('./answer-cases.js');
if (process.argv[2]) cases = cases.concat(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));

const index = A.build(map.items);
const byName = Object.fromEntries(map.items.map((i) => [i.name, i]));
const NOTE = new Set(['diacritics', 'typo', 'variant']);
let fail = 0;
for (const [target, input, expect, why] of cases) {
  const it = byName[target];
  if (!it) { console.log(`?? nieznany obiekt: ${target}`); fail++; continue; }
  const r = A.check(index, it.id, input);
  const got = !r.ok ? 'wrong' : NOTE.has(r.status) ? 'note' : 'correct';
  if (got !== expect) {
    fail++;
    console.log(`FAIL  ${target} ← "${input}"  oczekiwano ${expect}, jest ${got} (${r.status}${r.other ? ': ' + r.other.name : ''})${why ? '  // ' + why : ''}`);
  }
}

// Każda nazwa z listy musi być uznana za w pełni poprawną dla swojego obiektu.
for (const it of map.items) {
  const r = A.check(index, it.id, it.name);
  if (r.status !== 'exact') { fail++; console.log(`FAIL  własna nazwa nieuznana: ${it.name} (${r.status})`); }
  for (const a of it.alt || []) {
    const ra = A.check(index, it.id, a);
    if (!ra.ok) { fail++; console.log(`FAIL  alt nieuznany: ${it.name} ← ${a} (${ra.status})`); }
  }
  for (const v of it.variant || []) {
    const rv = A.check(index, it.id, v);
    if (!rv.ok) { fail++; console.log(`FAIL  variant nieuznany: ${it.name} ← ${v} (${rv.status})`); }
  }
}
// Żadna nazwa (ani zamienna) nie może zostać uznana za odpowiedź na inny obiekt.
for (const a of map.items) {
  for (const text of [a.name, ...(a.alt || []), ...(a.variant || [])]) {
    for (const b of map.items) {
      if (a === b) continue;
      const r = A.check(index, b.id, text);
      if (r.ok) { fail++; console.log(`FAIL  kolizja: "${text}" (${a.name}) uznane dla ${b.name} (${r.status})`); }
    }
  }
}
// Rdzeń żadnej nazwy nie może wyglądać jak słowo ogólne (wtedy zniknąłby przy rozbiorze).
for (const it of map.items) {
  const p = A.parse(it.name);
  if (!p.core) { fail++; console.log(`FAIL  pusta nazwa po rozbiorze: ${it.name}`); }
}
console.log(fail ? `\n${fail} błędów na ${cases.length} przypadków + testy krzyżowe` : `OK: ${cases.length} przypadków + testy krzyżowe`);
process.exit(fail ? 1 : 0);
