# Wyniki testow wyscigow i kariery

Data: 2026-10-05T20:38:35.140Z

Uruchomienie: `node tests/race.test.mjs`


## 1. Kolizje miedzy autami (impulsy dwoch bryl)

- ✅ najechanie na tyl (30 m/s w stojace auto): kontakt wykryty (kroki): **11** (oczekiwane 1–60)
- ✅ najechanie na tyl: maks. przenikanie nadwozi [m]: **0** (oczekiwane 0–0.3)
- ✅ najechanie na tyl: zachowanie pedu w zderzeniu [wzgl.]: **0.998** (oczekiwane 0.98–1.01)
- ✅ najechanie na tyl: predkosc auta uderzonego [m/s]: **14.128** (oczekiwane 12–18) — zderzenie prawie niesprezyste (restytucja 0.15): ~14 m/s
- ✅ brak NaN: **1** (oczekiwane 1–1)
- ✅ otarcie bokiem: kontakt wykryty: **18** (oczekiwane 1–240)
- ✅ otarcie bokiem: auta rozdzielone (odleglosc boczna) [m]: **4.272** (oczekiwane 1.9–20)
- ✅ otarcie bokiem: oba nadal jada (min. predkosc) [m/s]: **37.446** (oczekiwane 15–45)

## 2. Wyscigi samych AI: 12 aut, 2 okrazenia, kazdy tor (ziarno stale - wynik powtarzalny)

- ✅ Autodromo Nazionale Monza: auta na mecie: **12** (oczekiwane 12–12)
- ✅ Autodromo Nazionale Monza: brak NaN: **0** (oczekiwane 0–0)
- ✅ Autodromo Nazionale Monza: odholowania (auto utkniete/poza torem): **0** (oczekiwane 0–2)
- ✅ Autodromo Nazionale Monza: czasy okrazen w rozsadnym zakresie: **1** (oczekiwane 1–1)
- ✅ Autodromo Nazionale Monza: kolejnosc wynikow = kolejnosc na mecie: **1** (oczekiwane 1–1)
- ✅ Autodromo Nazionale Monza: szacunek czasu AI vs najlepsze okrazenie [wzgl.]: **0.999** (oczekiwane 0.95–1.06) — szac. 122.4 s, zmierz. 122.5 s
- ✅ Circuit de Spa-Francorchamps: auta na mecie: **12** (oczekiwane 12–12)
- ✅ Circuit de Spa-Francorchamps: brak NaN: **0** (oczekiwane 0–0)
- ✅ Circuit de Spa-Francorchamps: odholowania (auto utkniete/poza torem): **0** (oczekiwane 0–2)
- ✅ Circuit de Spa-Francorchamps: czasy okrazen w rozsadnym zakresie: **1** (oczekiwane 1–1)
- ✅ Circuit de Spa-Francorchamps: kolejnosc wynikow = kolejnosc na mecie: **1** (oczekiwane 1–1)
- ✅ Circuit de Spa-Francorchamps: szacunek czasu AI vs najlepsze okrazenie [wzgl.]: **0.979** (oczekiwane 0.95–1.06) — szac. 161.9 s, zmierz. 165.3 s
- ✅ Silverstone Circuit: auta na mecie: **12** (oczekiwane 12–12)
- ✅ Silverstone Circuit: brak NaN: **0** (oczekiwane 0–0)
- ✅ Silverstone Circuit: odholowania (auto utkniete/poza torem): **0** (oczekiwane 0–2)
- ✅ Silverstone Circuit: czasy okrazen w rozsadnym zakresie: **1** (oczekiwane 1–1)
- ✅ Silverstone Circuit: kolejnosc wynikow = kolejnosc na mecie: **1** (oczekiwane 1–1)
- ✅ Silverstone Circuit: szacunek czasu AI vs najlepsze okrazenie [wzgl.]: **1.021** (oczekiwane 0.95–1.06) — szac. 151.1 s, zmierz. 148.0 s

## 3. Logika wyscigu: start, okrazenia, meta, pole startowe

- ✅ gracz na polu 3 (indeks 2): **2** (oczekiwane 2–2)
- ✅ auta na polach rozstawione (min. odleglosc) [m]: **8.284** (oczekiwane 4–100)
- ✅ przed zgaszeniem swiatel AI stoja [m/s]: **0.000** (oczekiwane 0–0.5)
- ✅ zwyciezca na mecie po 1 okr.: **1** (oczekiwane 1–1)
- ✅ gracz ostatni (stal na polu): **6** (oczekiwane 6–6)
- ✅ wynik gracza: czas szacowany: **1** (oczekiwane 1–1)
- ✅ kwalifikacje: brak czasu -> koniec stawki: **9** (oczekiwane 9–9)
- ✅ kwalifikacje: czas szybszy od AI -> pole position: **0** (oczekiwane 0–0)
- ✅ kwalifikacje: czas wolny -> koniec: **9** (oczekiwane 9–9)

## 4. Kariera: sezon, punkty, nagrody, odblokowanie, ulepszenia, zapis

- ✅ nowa kariera: 1 odblokowana seria: **1** (oczekiwane 1–1)
- ✅ nie mozna zaczac zablokowanej serii: **0** (oczekiwane 0–0)
- ✅ start sezonu Amateur: **1** (oczekiwane 1–1)
- ✅ 3 wygrane + najszybsze okrazenia: punkty gracza: **78** (oczekiwane 78–78)
- ✅ sezon zakonczony: **1** (oczekiwane 1–1)
- ✅ mistrz serii: **1** (oczekiwane 1–1)
- ✅ odblokowana seria Pro: **2** (oczekiwane 2–2)
- ✅ nagrody + premia za mistrzostwo [cr]: **31500** (oczekiwane 31500–31500)
- ✅ brak kolejnej rundy po sezonie: **1** (oczekiwane 1–1)
- ✅ suma punktow rundy (8 aut + FL): **99** (oczekiwane 99–99)
- ✅ zakup silnika poz. 1: **1** (oczekiwane 1–1)
- ✅ koszt potracony: **6000** (oczekiwane 6000–6000)
- ✅ brak srodkow - zakup odrzucony: **0** (oczekiwane 0–0)
- ✅ odczyt zapisu: poziom silnika: **1** (oczekiwane 1–1)
- ✅ odczyt zapisu: odblokowane serie: **2** (oczekiwane 2–2)
- ✅ uszkodzony zapis: kredyty domyslne: **2000** (oczekiwane 2000–2000)
- ✅ uszkodzony zapis: poziomy przyciete: **3** (oczekiwane 3–3)
- ✅ uszkodzony zapis: serie przyciete: **3** (oczekiwane 3–3)
- ✅ uszkodzony zapis: brak sezonu: **1** (oczekiwane 1–1)
- ✅ zapis z innej wersji -> nowa kariera: **2000** (oczekiwane 2000–2000)
- ✅ silnik +10.5% momentu: **1.105** (oczekiwane 1.104–1.106)
- ✅ opony +4%: **1.040** (oczekiwane 1.039–1.041)
- ✅ masa -45 kg: **45** (oczekiwane 45–45)
- ✅ oryginalna konfiguracja bez zmian: **1300** (oczekiwane 1300–1300)
- ✅ 0-200 km/h: ulepszone auto szybsze [s]: **1.242** (oczekiwane 0.2–5) — seryjne 9.77 s, ulepszone 8.53 s

## Podsumowanie wyscigow AI

- Autodromo Nazionale Monza: zwyciezca N. Costa 251.5 s, ostatni +24.3 s, kontakty (kroki) 170, odholowania 0, sym. 40x czasu rzecz.
- Circuit de Spa-Francorchamps: zwyciezca N. Costa 334.9 s, ostatni +24.0 s, kontakty (kroki) 292, odholowania 0, sym. 43x czasu rzecz.
- Silverstone Circuit: zwyciezca N. Costa 300.6 s, ostatni +26.4 s, kontakty (kroki) 5, odholowania 0, sym. 43x czasu rzecz.

**Wszystkie testy zaliczone.**
