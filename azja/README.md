# Azja na mapie

Interaktywna mapa i test z nazw geograficznych Azji (87 obiektów: wyspy i półwyspy, góry, niziny/wyżyny/kotliny, szczyty i wulkany, pustynie, oceany/morza/zatoki, jeziora, rzeki).

Otwórz `index.html` w przeglądarce.

- **Nauka** – mapa z nazwami, filtr grup, lista obiektów z krótkimi opisami.
- **Test** – „Wskaż na mapie”, „Rozpoznaj obiekt”, „Wpisz nazwę”, „Ciekawostki” lub tryb mieszany; wynik z orientacyjną oceną, powtórką błędów i listą nazw do poprawy pisowni.

W trybie „Wpisz nazwę” odpowiedź sprawdza `src/answers.js`: wielkość liter, spacje, myślniki i słowa ogólne („Półwysep”, „Jezioro”…) nie mają znaczenia; brak polskich znaków, drobne literówki i obce pisownie są uznawane z uwagą o pisowni; nazwa innego obiektu z listy albo zły rodzaj („Nizina Irańska”) to błąd. Nazwy zamienne są w `build/aliases.js`.

## Budowanie

```sh
cd build
npm ci
npm run data    # pobiera dane Natural Earth
npm run build   # build.js -> map.json, assemble.js -> ../index.html
npm test        # testy sprawdzania wpisanych nazw (answer-cases.js + testy krzyżowe)
```

Lista obiektów, ich położenie i opisy są w `build/items.js`, szablon strony w `src/app.html`.
