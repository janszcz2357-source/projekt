// Prawdziwe obiekty SPOZA listy, które łatwo pomylić z nazwami z listy.
// Nigdy nie są poprawną odpowiedzią; dzięki nim np. "Morze Jońskie" nie przejdzie jako literówka
// "Morze Japońskie", a uczeń dostaje komunikat, że wpisał nazwę innego obiektu.
module.exports = [
  // bardzo podobne do nazw z listy (bez nich przechodziłyby jako literówki)
  'Morze Jońskie', 'Morze Karaibskie', 'Ural', 'Góry Uralskie', 'Jana', 'Elburs',
  // inne obiekty Azji, które uczniowie często mylą z obiektami z listy
  'Morze Wschodniochińskie', 'Morze Filipińskie', 'Morze Andamańskie', 'Morze Czukockie',
  'Zatoka Adeńska', 'Zatoka Omańska', 'Zatoka Tajlandzka', 'Zatoka Bohaj',
  'Amu-daria', 'Syr-daria', 'Irawadi', 'Kołyma', 'Angara', 'Wołga',
  'Nizina Hindustańska', 'Nizina Mandżurska', 'Nizina Wschodniosyberyjska', 'Nizina Nadkaspijska',
  'Wyżyna Mongolska', 'Wyżyna Armeńska', 'Kunlun', 'Taurus',
  'Celebes', 'Nowa Gwinea', 'Kuryle', 'Tajmyr', 'Czukotka', 'Azja Mniejsza',
  'Thar', 'Pustynia Syryjska', 'Issyk-kul',
];
