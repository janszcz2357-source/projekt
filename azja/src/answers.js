// Sprawdzanie wpisanych nazw geograficznych.
// Działa w przeglądarce (globalne AsiaAnswers) i w Node (testy w build/test-answers.js).
(function (root) {
  'use strict';

  // Słowa ogólne i skróty: można je dopisać albo pominąć. Wartość to "rodzaj" obiektu.
  const GENERIC = {
    polwysep: 'polwysep', plw: 'polwysep', polw: 'polwysep', pw: 'polwysep',
    wyspa: 'wyspa', wyspy: 'wyspa', archipelag: 'wyspa', wysp: 'wyspa',
    gory: 'gory', g: 'gory', pasmo: 'gory',
    gora: 'gora',
    nizina: 'nizina', niz: 'nizina', rownina: 'nizina',
    wyzyna: 'wyzyna', wyz: 'wyzyna', plaskowyz: 'wyzyna',
    kotlina: 'kotlina', kot: 'kotlina', kotl: 'kotlina',
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
      .replace(/(^|[^\p{L}])p\s*-\s*[oó]?w(?=[^\p{L}]|$)/gu, '$1płw') // "P-ów Indyjski"
      .split(/[^\p{L}\p{N}]+/u) // każdy znak poza literą i cyfrą (także „ “ ” ‚ ’) rozdziela słowa
      .filter(Boolean)
      .map((t) => (t === 'wlk' ? 'wielki' : t));
  }
  // Odległość Damerau–Levenshteina (wariant OSA): zamiana sąsiednich liter to jedna literówka.
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
  // Ile literówek tolerujemy przy nazwie o danej długości rdzenia
  const limit = (n) => (n <= 3 ? 0 : n <= 7 ? 1 : 2);
  // Te same słowa różniące się tylko końcówką ("indus"/"indusu", "arabski"/"arabskie")
  function sameStem(a, b) {
    if (a === b) return true;
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    return pre >= 4 && Math.max(a.length, b.length) - pre <= 3;
  }

  function genericOf(tok) {
    const f = fold(tok.toLowerCase());
    if (GENERIC[f]) return GENERIC[f];
    if (f.length >= 5) for (const g of FUZZY_GENERIC) if (Math.abs(g.length - f.length) <= 1 && dist(f, g) <= 1) return GENERIC[g];
    return null;
  }
  // Rozbiór tekstu: rodzaje (słowa ogólne) i rdzeń nazwy (bez spacji), z polskimi znakami i bez nich.
  // key/rawKey to słowa rdzenia w kolejności alfabetycznej ("Sopka Kluczewska" = "Kluczewska Sopka").
  function parse(s) {
    const gens = new Set();
    const core = [];
    for (const t of tokens(s)) {
      const g = genericOf(t);
      if (g) gens.add(g); else core.push(t);
    }
    const raw = core.join('');
    const sorted = core.slice().sort();
    return { gens, raw, core: fold(raw), key: sorted.map(fold).sort().join(' '), rawKey: sorted.join(' '), words: core.length };
  }
  function nameForms(name) {
    // "Czogori (K2)" -> ["Czogori (K2)", "Czogori", "K2"]
    const out = [name];
    const m = /^(.*?)\s*\((.+)\)\s*$/.exec(name);
    if (m) out.push(m[1], m[2]);
    return out;
  }

  // items: obiekty z listy ({id, name, kind, alt?, variant?})
  // outside: nazwy obiektów SPOZA listy, które łatwo pomylić z nazwami z listy (np. "Morze Jońskie");
  //          nigdy nie są poprawną odpowiedzią i nie mogą przejść jako literówka nazwy z listy.
  function build(items, outside) {
    const index = {};
    const cores = new Set();
    for (const it of items) {
      const forms = [];
      const add = (text, type) => {
        const p = parse(text);
        if (p.core) { forms.push({ text, type, raw: p.raw, core: p.core, key: p.key, rawKey: p.rawKey, gens: p.gens }); cores.add(p.core); }
      };
      nameForms(it.name).forEach((t) => add(t, 'name'));
      (it.alt || []).forEach((t) => add(t, 'alt'));
      (it.variant || []).forEach((t) => add(t, 'variant'));
      const allowed = new Set(KIND_ALLOWED[it.kind] || []);
      for (const f of forms) if (f.type !== 'variant') f.gens.forEach((g) => allowed.add(g));
      index[it.id] = { it, forms, allowed };
    }
    const out = [];
    for (const name of outside || []) {
      const p = parse(name);
      if (p.core && !cores.has(p.core)) out.push({ name, core: p.core, key: p.key, allowed: p.gens });
    }
    return { items: index, outside: out };
  }

  function statusOf(form, exactRaw) {
    if (form.type === 'variant') return 'variant';
    if (!exactRaw) return 'diacritics';
    return form.type === 'alt' ? 'alt' : 'exact';
  }

  // Wynik: { ok, status, form?, other?, outside?, generic? }
  //  ok=true:  exact | alt | diacritics | variant | typo
  //  ok=false: empty | generic | other | outside | wrong
  function check(A, targetId, input) {
    const index = A.items;
    const T = index[targetId];
    const p = parse(input);
    if (!p.core) return { ok: false, status: p.gens.size ? 'wrong' : 'empty' };
    const badGeneric = [...p.gens].find((g) => !T.allowed.has(g));
    const fitsSet = (allowed) => [...p.gens].every((g) => allowed.has(g));
    const multi = p.words > 1;

    // 1. nazwa (albo nazwa zamienna) zaznaczonego obiektu: dokładnie, w innej kolejności słów,
    //    albo dwie jego nazwy naraz ("Borneo (Kalimantan)", "K2 / Czogori")
    let hit = T.forms.find((f) => f.core === p.core);
    let exactRaw = hit ? hit.raw === p.raw : false;
    if (!hit && multi) {
      hit = T.forms.find((f) => f.key === p.key);
      if (hit) exactRaw = hit.rawKey === p.rawKey;
    }
    if (!hit) {
      const parts = String(input).split(/[()/]/).map(parse).filter((x) => x.core);
      if (parts.length > 1) {
        const fs = parts.map((x) => T.forms.find((f) => f.core === x.core));
        if (fs.every(Boolean)) {
          hit = fs.find((f) => f.type === 'variant') || fs.find((f) => f.type === 'alt') || fs[0];
          exactRaw = parts.every((x, i) => x.raw === fs[i].raw);
        }
      }
    }
    if (hit) {
      if (badGeneric) return { ok: false, status: 'generic', generic: GENERIC_LABEL[badGeneric], form: hit };
      return { ok: true, status: statusOf(hit, exactRaw), form: hit };
    }

    // 2. dokładnie nazwa innego obiektu z listy albo znanego obiektu spoza listy
    for (const id in index) {
      if (id === targetId) continue;
      const E = index[id];
      if (E.forms.some((f) => f.core === p.core || (multi && f.key === p.key)) && (!p.gens.size || fitsSet(E.allowed))) {
        return { ok: false, status: 'other', other: E.it };
      }
    }
    for (const d of A.outside) {
      if ((d.core === p.core || (multi && d.key === p.key)) && (!p.gens.size || fitsSet(d.allowed))) {
        return { ok: false, status: 'outside', outside: d.name };
      }
    }

    // 3. literówka: blisko nazwy celu i wyraźnie dalej od każdej innej nazwy
    let best = null, bd = Infinity;
    for (const f of T.forms) {
      const d = dist(p.core, f.core);
      if (d <= limit(f.core.length) && (d < bd || (d === bd && f.core.length > best.core.length))) { bd = d; best = f; }
    }
    if (best) {
      let otherD = Infinity;
      for (const id in index) {
        if (id === targetId) continue;
        const E = index[id];
        // gdy wpisane słowo ogólne nie pasuje do innego obiektu, jego nazwa o tym samym rdzeniu
        // nie konkuruje ("Nizina Indus" to nie rzeka Indus), ale inne nazwy – tak ("Nizina Irańska")
        const skipStem = p.gens.size && !fitsSet(E.allowed);
        for (const f of E.forms) {
          if (T.forms.some((t) => t.core === f.core)) continue; // ten sam rdzeń co cel ("Indyjski")
          if (skipStem && T.forms.some((t) => sameStem(f.core, t.core))) continue;
          otherD = Math.min(otherD, dist(p.core, f.core));
        }
      }
      for (const d of A.outside) otherD = Math.min(otherD, dist(p.core, d.core));
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
  // Ile liter można odsłonić: zawsze zostaje zakryte więcej liter, niż wynosi tolerancja literówek,
  // więc samo przepisanie podpowiedzi nie wystarczy do zaliczenia.
  function maxHints(name) {
    const n = letters(name);
    return Math.max(0, n - 1 - limit(n));
  }

  // Tekst, który uczeń widzi po `n` podpowiedziach, bez zakrytych liter ("Płw. Indyj").
  function revealed(name, n) {
    let left = n;
    const out = [];
    for (const part of primary(name).split(/\s+/)) {
      const bare = part.replace(/[^\p{L}\p{N}]/gu, '');
      if (bare && genericOf(bare)) { out.push(part); continue; }
      if (left <= 0) break;
      let w = '';
      for (const ch of part) {
        if (!/[\p{L}\p{N}]/u.test(ch)) { w += ch; continue; }
        if (left <= 0) break;
        w += ch; left--;
      }
      out.push(w);
    }
    return out.join(' ');
  }
  // Największa liczba podpowiedzi, przy której samo przepisanie odsłoniętych liter
  // nie zalicza odpowiedzi (sprawdzane tym samym check(), także względem nazw zamiennych).
  function hintCap(A, id) {
    const name = A.items[id].it.name;
    let n = maxHints(name);
    while (n > 0 && check(A, id, revealed(name, n)).ok) n--;
    return n;
  }

  const api = { build, check, hint, letters, maxHints, hintCap, revealed, primary, parse, fold, dist, limit, GENERIC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AsiaAnswers = api;
})(typeof self !== 'undefined' ? self : this);
