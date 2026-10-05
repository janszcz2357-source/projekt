# Wyniki testow fizyki (node tests/physics.test.mjs)

Data: 2026-10-05T20:38:48.694Z  ·  krok fizyki 120 Hz, 4 podkroki  ·  wynik: wszystkie OK


## 1. Spoczynek: rozklad obciazen i stabilnosc

- ✅ nacisk kola przedniego: **2999.3** N (oczekiwane 2939.330333333334–3059.3030000000003) — teoria 2999 N
- ✅ nacisk kola tylnego: **3377.2** N (oczekiwane 3309.6396666666665–3444.7270000000003) — teoria 3377 N
- ✅ dryf po 5 s bez wejsc: **0.000** m (oczekiwane 0–0.01)
- ✅ predkosc po 5 s: **0.000** m/s (oczekiwane 0–0.01)
- ✅ pelzanie na pochylosci 8% z hamulcem (4 s): **0.037** m (oczekiwane 0–0.05)
- ✅ toczenie sie w dol bez hamulca (luz, 4 s) - kontrola: **5.315** m (oczekiwane 3–200)

## 2. Przyspieszanie (plaska prosta, automat)

- ✅ 0-100 km/h (TC 2): **3.600** s (oczekiwane 2.9–4.6)
- ✅ 0-200 km/h (TC 2): **9.775** s (oczekiwane 8–12)
- 402 m (TC 2): **11.2** s
- ✅ maks. poslizg kol tylnych (TC 2): **0.284**  (oczekiwane 0–0.3)
- ✅ predkosc maksymalna po 70 s: **284.4** km/h (oczekiwane 270–300)
- ✅ bieg przy V-max: **6.000**  (oczekiwane 6–6)
- ✅ 0-100 km/h (TC wyl.): **3.392** s (oczekiwane 2.9–4.6)
- ✅ 0-200 km/h (TC wyl.): **9.558** s (oczekiwane 8–12)
- 402 m (TC wyl.): **11.1** s
- ✅ maks. poslizg kol tylnych (TC wyl.): **0.292**  (oczekiwane 0.15–10)

## 3. Hamowanie ze 100 i 200 km/h (ABS: wyl./2/4)

- ✅ droga 100-0 (ABS wyl.): **28.2** m (oczekiwane 25–42) — sr. opoznienie 1.40 g, przod zablokowany 87% czasu
- ✅ blokowanie kol bez ABS (100 km/h): **0.873**  (oczekiwane 0.5–1) — ulamek czasu z zablokowanym przodem
- ✅ droga 100-0 (ABS 2): **24.9** m (oczekiwane 22–34) — sr. opoznienie 1.57 g, przod zablokowany 0% czasu
- ✅ ABS zapobiega blokowaniu (100 km/h, ABS 2): **0.000**  (oczekiwane 0–0.1)
- ✅ droga 100-0 (ABS 4): **25.1** m (oczekiwane 22–34) — sr. opoznienie 1.55 g, przod zablokowany 0% czasu
- ✅ ABS zapobiega blokowaniu (100 km/h, ABS 4): **0.000**  (oczekiwane 0–0.1)
- ✅ droga 200-0 (ABS wyl.): **97.1** m (oczekiwane 85–150) — sr. opoznienie 1.51 g, przod zablokowany 91% czasu
- ✅ blokowanie kol bez ABS (200 km/h): **0.910**  (oczekiwane 0.5–1) — ulamek czasu z zablokowanym przodem
- ✅ droga 200-0 (ABS 2): **84.4** m (oczekiwane 70–125) — sr. opoznienie 1.72 g, przod zablokowany 0% czasu
- ✅ ABS zapobiega blokowaniu (200 km/h, ABS 2): **0.000**  (oczekiwane 0–0.1)
- ✅ droga 200-0 (ABS 4): **85.1** m (oczekiwane 70–125) — sr. opoznienie 1.71 g, przod zablokowany 0% czasu
- ✅ ABS zapobiega blokowaniu (200 km/h, ABS 4): **0.000**  (oczekiwane 0–0.1)

## 3b. Stabilnosc hamowania 220-60 km/h z zaburzeniem (lewe kola na kraweznik - mniejsza przyczepnosc)

- ✅ hamowanie z roznica przyczepnosci L/P (ABS 2): maks. kat znoszenia: **0.807** deg (oczekiwane 0–3) — maks. predkosc odchylenia 0.079 rad/s, zmiana kursu -2.2 deg (bez korekty kierownica)
- hamowanie z roznica przyczepnosci L/P (ABS wyl., wszystkie kola zablokowane): maks. kat znoszenia 45.2 deg, zmiana kursu -41.7 deg - bez ABS auto traci stabilnosc (oczekiwane fizycznie)

## 4. Przenoszenie obciazenia (porownanie z m*a*h/L)

- ✅ hamowanie: przyrost nacisku osi przedniej / teoria: **0.941**  (oczekiwane 0.85–1.15) — a=1.30 g, dFz=2904 N, teoria 2826 N

## 5. Jazda po okregu R = 50 m (regulator toru, rosnaca predkosc)

- ✅ maks. przyspieszenie boczne (R=50 m, ustalone): **1.444** g (oczekiwane 1.25–1.75)
-   ay=0.30 g: kat kola 3.31 deg, kat znoszenia nadwozia -1.06 deg
-   ay=0.50 g: kat kola 3.38 deg, kat znoszenia nadwozia -0.74 deg
-   ay=0.70 g: kat kola 3.47 deg, kat znoszenia nadwozia -0.40 deg
-   ay=0.90 g: kat kola 3.64 deg, kat znoszenia nadwozia -0.03 deg
-   ay=1.10 g: kat kola 3.98 deg, kat znoszenia nadwozia 0.39 deg
-   ay=1.30 g: kat kola 4.73 deg, kat znoszenia nadwozia 0.97 deg
- ✅ gradient podsterownosci (dd/day): **1.415** deg/g (oczekiwane 0.2–4) — dodatni = podsterownosc na granicy, zgodnie z ustawieniem GT3
- utrata toru przy 99.1 km/h, ay=1.43 g, beta=1.4 deg (beta>0: przod wyjezdza = podsterownosc)

## 6. Utrata przyczepnosci osi tylnej: pelny gaz w zakrecie, 2. bieg

- ✅ kat znoszenia nadwozia bez TC (nadsterownosc): **89.8** deg (oczekiwane 12–180) — maks. predkosc odchylenia 3.30 rad/s
- ✅ kat znoszenia nadwozia z TC 2: **4.210** deg (oczekiwane 0–9) — maks. predkosc odchylenia 0.75 rad/s
- ✅ podsterownosc: rzeczywisty promien / geometryczny (pelny skret, 120 km/h): **10.7**  (oczekiwane 3–50) — R=75.6 m vs geometryczny 7.0 m; poslizg przod 2.99 vs tyl 0.34 (1 = szczyt)

## 7. Nawierzchnie: wybieg ze 150 km/h bez hamulca, maks. ay na kolku R=30 m

- ✅ opoznienie na asfalcie (bez hamulca): **0.178** g (oczekiwane 0.1–0.45) — opor aero + silnik
- ✅ opoznienie na trawie > asfalt: **0.056** g (oczekiwane 0.02–1)
- ✅ opoznienie na zwirze > trawa: **0.386** g (oczekiwane 0.15–1.5) — zwir: 0.62 g
- ✅ maks. ay na asfalcie (40 km/h): **1.369** g (oczekiwane 1.2–1.9)
- ✅ maks. ay na trawie: **0.810** g (oczekiwane 0.45–1.05)
- ✅ maks. ay na zwirze: **0.474** g (oczekiwane 0.35–1)

## 8. Niezaleznosc od liczby klatek (ten sam scenariusz, rozne FPS)

- [wejscie co krok] 30 FPS: pozycja (19.044, 257.647) m, v=109.04 km/h, t=12.0000 s
- [wejscie co krok] 60 FPS: pozycja (19.044, 257.647) m, v=109.04 km/h, t=12.0000 s
- [wejscie co krok] 144 FPS: pozycja (19.044, 257.647) m, v=109.04 km/h, t=12.0000 s
- [wejscie co krok] 240 FPS: pozycja (19.044, 257.647) m, v=109.04 km/h, t=12.0000 s
- [wejscie co krok] losowe 20-160 FPS: pozycja (19.044, 257.647) m, v=109.04 km/h, t=12.0000 s
- ✅ rozrzut pozycji miedzy FPS (wejscie co krok fizyki): **0.000** m (oczekiwane 0–0.000001) — fizyka deterministyczna, identyczna dla kazdego FPS
- [wejscie co klatke] 30 FPS: pozycja (19.088, 257.642) m, v=109.04 km/h, t=12.0000 s
- [wejscie co klatke] 60 FPS: pozycja (19.058, 257.646) m, v=109.04 km/h, t=12.0000 s
- [wejscie co klatke] 144 FPS: pozycja (19.044, 257.647) m, v=109.04 km/h, t=12.0000 s
- [wejscie co klatke] 240 FPS: pozycja (19.044, 257.647) m, v=109.04 km/h, t=12.0000 s
- [wejscie co klatke] losowe 20-160 FPS: pozycja (19.090, 257.639) m, v=109.04 km/h, t=12.0000 s
- ✅ rozrzut pozycji miedzy FPS (wejscie co klatke): **0.033** m (oczekiwane 0–1.5) — po ~300 m jazdy; roznica predkosci 0.00 km/h (kwantyzacja wejsc do klatek)
- ✅ zbieznosc: 120 Hz vs 240 Hz (pozycja po 12 s): **0.101** m (oczekiwane 0–2) — v: 109.04 vs 108.97 km/h

## 9. Kolizja z bariera: prosto w szykane Rettifilo przy ~220 km/h bez hamowania

- ✅ liczba uderzen w bariere: **9.000**  (oczekiwane 1–1000)
- ✅ maks. przekroczenie linii bariery przez srodek auta: **-2.515** m (oczekiwane -50–0) — ujemne = srodek auta zawsze po stronie toru
- ✅ brak NaN / eksplozji symulacji: **0.000**  (oczekiwane 0–0)
- predkosc uderzenia (skladowa normalna): **193.0** km/h
- predkosc po zdarzeniu (min.): **5.799** km/h

## 10. Pelne okrazenie (autopilot przez te same wejscia co gracz, start z pola, ABS 2 / TC 2)

- ✅ Autodromo Nazionale Monza: ukonczone okrazenia: **2.000**  (oczekiwane 2–2) — okr. 1 (start z miejsca) 2:10.106, okr. 2 (lotne) 2:06.467
- ✅ Autodromo Nazionale Monza: okrazenie lotne wazne: **1.000**  (oczekiwane 1–1)
- ✅ Autodromo Nazionale Monza: uderzenia w bariery: **0.000**  (oczekiwane 0–0)
- ✅ Autodromo Nazionale Monza: brak NaN: **0.000**  (oczekiwane 0–0)
- Autodromo Nazionale Monza: V-max: **248.4** km/h
- Autodromo Nazionale Monza: czas symulacji / czas obliczen: **499.0** x czasu rzeczywistego
- ✅ Circuit de Spa-Francorchamps: ukonczone okrazenia: **2.000**  (oczekiwane 2–2) — okr. 1 (start z miejsca) 2:50.163, okr. 2 (lotne) 2:48.255
- ✅ Circuit de Spa-Francorchamps: okrazenie lotne wazne: **1.000**  (oczekiwane 1–1)
- ✅ Circuit de Spa-Francorchamps: uderzenia w bariery: **0.000**  (oczekiwane 0–0)
- ✅ Circuit de Spa-Francorchamps: brak NaN: **0.000**  (oczekiwane 0–0)
- Circuit de Spa-Francorchamps: V-max: **237.4** km/h
- Circuit de Spa-Francorchamps: czas symulacji / czas obliczen: **537.0** x czasu rzeczywistego
- ✅ Silverstone Circuit: ukonczone okrazenia: **2.000**  (oczekiwane 2–2) — okr. 1 (start z miejsca) 2:35.608, okr. 2 (lotne) 2:33.543
- ✅ Silverstone Circuit: okrazenie lotne wazne: **1.000**  (oczekiwane 1–1)
- ✅ Silverstone Circuit: uderzenia w bariery: **0.000**  (oczekiwane 0–0)
- ✅ Silverstone Circuit: brak NaN: **0.000**  (oczekiwane 0–0)
- Silverstone Circuit: V-max: **228.7** km/h
- Silverstone Circuit: czas symulacji / czas obliczen: **544.7** x czasu rzeczywistego

## 11. Przejazd tylko klawiatura (wejscia 0/1 przez ten sam filtr skretu/pedalow co u gracza)

- ✅ Autodromo Nazionale Monza: okrazenia z klawiatury (wazne / ukonczone): **2.000**  (oczekiwane 2–2) — 2:21.496, 2:17.983; uderzenia w bariery: 0
- ✅ Circuit de Spa-Francorchamps: okrazenia z klawiatury (wazne / ukonczone): **2.000**  (oczekiwane 2–2) — 3:06.796, 3:05.232; uderzenia w bariery: 0
- ✅ Silverstone Circuit: okrazenia z klawiatury (wazne / ukonczone): **2.000**  (oczekiwane 2–2) — 2:49.615, 2:47.837; uderzenia w bariery: 0

## 12. Plynnosc kamer: autopilot na Spa (V-max ~240 km/h), petla gry przy 30 / 60 (nierowne) / 144 FPS

- ✅ kamera chase @ 30 FPS: maks. przyspieszenie kamery: **27.3** m/s2 (oczekiwane 0–150) — przed poprawka kamery poscigowej: ~65 000 m/s2 (skoki powyzej ~195 km/h)
- ✅ kamera chase @ 60 FPS (nierowne klatki): maks. przyspieszenie kamery: **38.7** m/s2 (oczekiwane 0–150) — przed poprawka kamery poscigowej: ~65 000 m/s2 (skoki powyzej ~195 km/h)
- ✅ kamera chase @ 144 FPS: maks. przyspieszenie kamery: **74.3** m/s2 (oczekiwane 0–150) — przed poprawka kamery poscigowej: ~65 000 m/s2 (skoki powyzej ~195 km/h)
- ✅ kamera hood @ 30 FPS: maks. przyspieszenie kamery: **22.6** m/s2 (oczekiwane 0–150) — przed poprawka kamery poscigowej: ~65 000 m/s2 (skoki powyzej ~195 km/h)
- ✅ kamera hood @ 60 FPS (nierowne klatki): maks. przyspieszenie kamery: **28.6** m/s2 (oczekiwane 0–150) — przed poprawka kamery poscigowej: ~65 000 m/s2 (skoki powyzej ~195 km/h)
- ✅ kamera hood @ 144 FPS: maks. przyspieszenie kamery: **27.1** m/s2 (oczekiwane 0–150) — przed poprawka kamery poscigowej: ~65 000 m/s2 (skoki powyzej ~195 km/h)
- ✅ kamera cockpit @ 30 FPS: maks. przyspieszenie kamery: **22.6** m/s2 (oczekiwane 0–150) — przed poprawka kamery poscigowej: ~65 000 m/s2 (skoki powyzej ~195 km/h)
- ✅ kamera cockpit @ 60 FPS (nierowne klatki): maks. przyspieszenie kamery: **28.3** m/s2 (oczekiwane 0–150) — przed poprawka kamery poscigowej: ~65 000 m/s2 (skoki powyzej ~195 km/h)
- ✅ kamera cockpit @ 144 FPS: maks. przyspieszenie kamery: **26.5** m/s2 (oczekiwane 0–150) — przed poprawka kamery poscigowej: ~65 000 m/s2 (skoki powyzej ~195 km/h)

## Okrazenia autopilota

| Tor | Okr. 1 (z miejsca) | Okr. 2 (lotne) | Sektory okr. 2 [s] | V-max [km/h] |
|---|---|---|---|---|
| Autodromo Nazionale Monza | 2:10.106 | 2:06.467 | 42.50 / 47.31 / 36.66 | 248 |
| Circuit de Spa-Francorchamps | 2:50.163 | 2:48.255 | 49.32 / 63.34 / 55.59 | 237 |
| Silverstone Circuit | 2:35.608 | 2:33.543 | 52.72 / 53.89 / 46.93 | 229 |
