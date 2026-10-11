# Azja na mapie

Interaktywna mapa i test z nazw geograficznych Azji (87 obiektów: wyspy i półwyspy, góry, niziny/wyżyny/kotliny, szczyty i wulkany, pustynie, oceany/morza/zatoki, jeziora, rzeki).

Otwórz `index.html` w przeglądarce.

- **Nauka** – mapa z nazwami, filtr grup, lista obiektów z krótkimi opisami.
- **Test** – „Wskaż na mapie”, „Rozpoznaj obiekt”, „Ciekawostki” lub tryb mieszany; wynik z orientacyjną oceną i powtórką błędów.

## Budowanie

```sh
cd build
npm ci
npm run data    # pobiera dane Natural Earth
npm run build   # build.js -> map.json, assemble.js -> ../index.html
```

Lista obiektów, ich położenie i opisy są w `build/items.js`, szablon strony w `src/app.html`.
