// Sprawdzanie wpisanych nazw geograficznych.
// Działa w przeglądarce (globalne AsiaAnswers) i w Node (testy w build/test-answers.js).
(function (root) {
  'use strict';

  // Słowa ogólne i skróty: można je dopisać albo pominąć. Wartość to "rodzaj" obiektu.
  const GENERIC = {
    polwysep: 'polwysep', plw: 'polwysep', pw: 'polwysep',
    wyspa: 'wyspa', wyspy: 'wyspa', archipelag: 'wyspa', wysp: 'wyspa',
    gory: 'gory', pasmo: 'gory',
    gora: 'gora',
    nizina: 'nizina', niz: 'nizina',
    wyzyna: 'wyzyna', wyz: 'wyzyna',
    kotlina: 'kotlina', kot: 'kotlina',
    pustynia: 'pustynia', pust: 'pustynia',
    ocean: 'ocean', oc: 'ocean',
    morze: 'morze', m: 'morze',
    zatoka: 'zatoka', zat: 'zatoka',
    jezioro: 'jezioro', jez: 'jezioro',
    rzeka: 'rzeka', r: 'rzeka', rz: 'rzeka',
    szczyt: 'szczyt', mount: 'szczyt', mt: 'szczyt',
    wulkan: 'wulkan',
  };
  // dłuższe słowa ogólne rozpoznajemy też z jedną literówką ("Połwysep", "Pustyna")
  const FUZZY_GENERIC = Object.keys(GENERIC).filter((g) => g.length >= 5);

  // Rodzaj obiektu z listy -> słowa ogólne, które do niego pasują
  const KIND_ALLOWED = {
    'półwysep': ['polwysep'],
    'wyspa': ['wyspa'],
    'wyspy': ['wyspa'],
    'archipelag': ['wyspa'],
    'góry': ['gory'],
    'wyżyna': ['wyzyna'],
    'nizina': ['nizina'],
    'kotlina': ['kotlina'],
    'szczyt': ['szczyt', 'gora'],
    'wulkan': ['wulkan', 'szczyt', 'gora'],
    'pustynia': ['pustynia'],
    'ocean': ['ocean'],
    'morze': ['morze'],
    'zatoka': ['zatoka'],
    'jezioro': ['jezioro'],
    'rzeka': ['rzeka'],
  };
  // Jak nazwać rodzaj w komunikacie "To nie jest …"
  const GENERIC_LABEL = {
    polwysep: 'półwysep', wyspa: 'wyspa', gory: 'góry', gora: 'góra', nizina: 'nizina', wyzyna: 'wyżyna',
    kotlina: 'kotlina', pustynia: 'pustynia', ocean: 'ocean', morze: 'morze', zatoka: 'zatoka',
    jezioro: 'jezioro', rzeka: 'rzeka', szczyt: 'szczyt', wulkan: 'wulkan',
  };

  const PL = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z' };
  function fold(s) {
    return s.replace(/[ąćęłńóśźż]/g, (c) => PL[c]).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function tokens(s) {
    return String(s || '').normalize('NFC').toLowerCase()
      .split(/[\s\-‐-―.,;:()[\]'"`’‘„”«»/\\!?]+/)
      .filter(Boolean);
  }
  // Damerau–Levenshtein (wersja OSA) – potrzebuje całej tablicy, więc osobna implementacja
  function dist(a, b) {
    if (a === b) return 0;
    const n = a.length, m = b.length;
    if (!n) return m;
    if (!m) return n;
    const d = [];
    for (let i = 0; i <= n; i++) { d.push(new Array(m + 1).fill(0)); d[i][0] = i; }
    for (let j = 0; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[n][m];
  }

  function genericOf(tok) {
    const f = fold(tok.toLowerCase());
    if (GENERIC[f]) return GENERIC[f];
    if (f.length >= 5) for (const g of FUZZY_GENERIC) if (Math.abs(g.length - f.length) <= 1 && dist(f, g) <= 1) return GENERIC[g];
    return null;
  }
  // Rozbiór tekstu: rodzaje (słowa ogólne) i rdzeń nazwy (bez spacji), z polskimi znakami i bez nich.
  function parse(s) {
    const gens = new Set();
    const core = [];
    for (const t of tokens(s)) {
      const g = genericOf(t);
      if (g) gens.add(g); else core.push(t);
    }
    const raw = core.join('');
    return { gens, raw, core: fold(raw) };
  }
  function nameForms(name) {
    // "Czogori (K2)" -> ["Czogori (K2)", "Czogori", "K2"]
    const out = [name];
    const m = /^(.*?)\s*\((.+)\)\s*$/.exec(name);
    if (m) out.push(m[1], m[2]);
    return out;
  }

  function build(items) {
    const index = {};
    for (const it of items) {
      const forms = [];
      const add = (text, type) => {
        const p = parse(text);
        if (p.core) forms.push({ text, type, raw: p.raw, core: p.core, gens: p.gens });
      };
      nameForms(it.name).forEach((t) => add(t, 'name'));
      (it.alt || []).forEach((t) => add(t, 'alt'));
      (it.variant || []).forEach((t) => add(t, 'variant'));
      const allowed = new Set(KIND_ALLOWED[it.kind] || []);
      for (const f of forms) if (f.type !== 'variant') f.gens.forEach((g) => allowed.add(g));
      index[it.id] = { it, forms, allowed };
    }
    return index;
  }

  // Wynik: { ok, status, form?, other?, generic? }
  //  ok=true:  exact | alt | diacritics | variant | typo
  //  ok=false: empty | generic | other | wrong
  function check(index, targetId, input) {
    const T = index[targetId];
    const p = parse(input);
    if (!p.core) return { ok: false, status: p.gens.size ? 'wrong' : 'empty' };
    const badGeneric = [...p.gens].find((g) => !T.allowed.has(g));
    const fits = (entry) => [...p.gens].every((g) => entry.allowed.has(g));

    // 1. dokładnie nazwa (albo nazwa zamienna) zaznaczonego obiektu
    const hit = T.forms.find((f) => f.core === p.core);
    if (hit) {
      if (badGeneric) return { ok: false, status: 'generic', generic: GENERIC_LABEL[badGeneric], form: hit };
      if (hit.type === 'variant') return { ok: true, status: 'variant', form: hit };
      if (hit.raw !== p.raw) return { ok: true, status: 'diacritics', form: hit };
      return { ok: true, status: hit.type === 'alt' ? 'alt' : 'exact', form: hit };
    }
    // 2. dokładnie nazwa innego obiektu z listy
    for (const id in index) {
      if (id === targetId) continue;
      const E = index[id];
      if (E.forms.some((f) => f.core === p.core) && (!p.gens.size || fits(E))) return { ok: false, status: 'other', other: E.it };
    }
    // 3. literówka: blisko nazwy celu i wyraźnie dalej od każdej innej nazwy
    let best = null, bd = Infinity;
    for (const f of T.forms) {
      const d = dist(p.core, f.core);
      if (d < bd) { bd = d; best = f; }
    }
    const len = best.core.length;
    const maxD = len <= 3 ? 0 : len <= 7 ? 1 : 2;
    if (bd <= maxD) {
      // inne obiekty liczą się tylko, gdy pasują do wpisanego słowa ogólnego ("Nizina Indus" to nie rzeka Indus)
      let otherD = Infinity;
      for (const id in index) {
        if (id === targetId || (p.gens.size && !fits(index[id]))) continue;
        for (const f of index[id].forms) otherD = Math.min(otherD, dist(p.core, f.core));
      }
      if (otherD > bd) {
        if (badGeneric) return { ok: false, status: 'generic', generic: GENERIC_LABEL[badGeneric], form: best };
        return { ok: true, status: 'typo', form: best, distance: bd };
      }
    }
    return { ok: false, status: 'wrong' };
  }

  // Podpowiedź: "Płw. I _ _ _ _ _ _ _" – słowa ogólne odsłonięte, z rdzenia `n` pierwszych liter.
  // Dla nazw z nawiasem podpowiadamy tylko część przed nawiasem.
  const primary = (name) => name.replace(/\s*\(.*\)\s*$/, '');
  function hint(name, n) {
    let left = n;
    return primary(name).split(/(\s+)/).map((part) => {
      if (/^\s+$/.test(part)) return '   ';
      const bare = part.replace(/[^\p{L}\p{N}]/gu, '');
      if (bare && genericOf(bare)) return part;
      return Array.from(part).map((ch) => {
        if (!/[\p{L}\p{N}]/u.test(ch)) return ch;
        if (left > 0) { left--; return ch; }
        return '_';
      }).join(' ');
    }).join('');
  }
  function letters(name) {
    let c = 0;
    for (const part of primary(name).split(/\s+/)) {
      const bare = part.replace(/[^\p{L}\p{N}]/gu, '');
      if (bare && genericOf(bare)) continue;
      c += bare.length;
    }
    return c;
  }

  const api = { build, check, hint, letters, primary, parse, fold, dist, GENERIC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AsiaAnswers = api;
})(typeof self !== 'undefined' ? self : this);
