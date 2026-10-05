// ============================================================================
//  PARAMETRY POJAZDU - jedno, czytelne miejsce.
//  Jednostki SI: m, kg, s, N, Nm, rad (katy w konfiguracji w stopniach tam, gdzie zaznaczono).
//  Uklad wspolrzednych nadwozia: +X = lewo, +Y = gora, +Z = przod, poczatek w srodku ciezkosci.
//
//  Samochod jest fikcyjny ("Apex GT-R"), ale parametry odpowiadaja typowemu GT3 z silnikiem V8
//  z przodu i napedem na tyl (masa ~1300 kg, ~510 KM, docisk ~GT3, opony typu slick).
// ============================================================================

export const GT_CAR = {
  id: 'apex-gtr',
  name: 'Apex GT-R',
  description: 'GT3 · V8 4.0 wolnossacy · naped na tyl · 1300 kg · 512 KM',

  // ---------------------------------------------------------------- masa / bryla
  mass: 1300, // kg, z kierowca i paliwem
  // momenty bezwladnosci wzgledem osi przez srodek ciezkosci [kg m^2]
  inertia: { pitch: 1750, yaw: 1950, roll: 480 },
  cgHeight: 0.46, // wysokosc srodka ciezkosci nad ziemia przy statycznym ugieciu [m]
  wheelbase: 2.70, // [m]
  cgToFrontAxle: 1.43, // => 47% masy na przodzie
  trackWidth: { front: 1.67, rear: 1.63 }, // rozstaw kol [m]

  // prostopadloscian kolizyjny nadwozia (wzgledem srodka ciezkosci) [m]
  body: { front: 2.43, rear: -2.19, halfWidth: 1.01, bottom: -0.38, top: 0.76 },

  // ---------------------------------------------------------------- zawieszenie
  // sprezyny/tlumiki podane jako wartosci "na kole" (wheel rate)
  suspension: {
    front: {
      springRate: 125000, // N/m
      bumpTravel: 0.050, // skok od pozycji statycznej do odbojnika [m]
      droopTravel: 0.090, // skok w dol od pozycji statycznej [m]
      bumpStopRate: 450000, // N/m (progresywny)
      damperBump: 6500, damperBumpFast: 2600, // Ns/m: wolne / szybkie (powyzej kolana)
      damperRebound: 9500, damperReboundFast: 4200,
      damperKnee: 0.12, // m/s
      antiRollRate: 55000, // N/m roznicy ugiec lewo/prawo
    },
    rear: {
      springRate: 140000,
      bumpTravel: 0.055,
      droopTravel: 0.095,
      bumpStopRate: 450000,
      damperBump: 7000, damperBumpFast: 2800,
      damperRebound: 10500, damperReboundFast: 4600,
      damperKnee: 0.12,
      antiRollRate: 32000,
    },
  },

  // ---------------------------------------------------------------- opony (model "combined slip")
  tyres: {
    // inertia: kolo+opona+tarcza [kg m^2]; grip: mnoznik przyczepnosci osi (szersze opony tylne)
    front: { radius: 0.335, width: 0.30, inertia: 1.15, grip: 1.0 },
    rear: { radius: 0.345, width: 0.325, inertia: 1.45, grip: 1.04 },
    mu: 1.65, // wspolczynnik tarcia przy obciazeniu nominalnym (slick, asfalt)
    nominalLoad: 3200, // N
    loadSensitivity: 0.13, // spadek mu na kazde +100% obciazenia ponad nominalne
    peakSlipAngleDeg: 7.5, // kat znoszenia przy maksimum sily bocznej
    peakSlipRatio: 0.105, // poslizg wzdluzny przy maksimum sily wzdluznej
    shapeC: 1.45, // ksztalt krzywej "magic formula": po przekroczeniu szczytu sila spada do ~76%
    longitudinalScale: 1.02, // elipsa tarcia: wzdluznie minimalnie wiecej niz bocznie
    relaxationLong: 0.12, // dlugosc relaksacji [m] (dynamika poslizgu, stabilnosc przy malej predkosci)
    relaxationLat: 0.30,
    rollingResistance: 0.012,
  },

  // ---------------------------------------------------------------- silnik
  engine: {
    idleRpm: 1100,
    redlineRpm: 7800, // poczatek czerwonego pola / ostatnia dioda zmiany biegu
    limiterRpm: 8000, // odciecie zaplonu
    inertia: 0.20, // kg m^2 (wal korbowy + kolo zamachowe)
    // krzywa momentu przy pelnym gazie [obr/min, Nm]
    torqueCurve: [
      [800, 260], [1000, 300], [2000, 380], [3000, 450], [4000, 520], [5000, 560], [5500, 565],
      [6000, 560], [6500, 545], [7000, 515], [7500, 470], [8000, 420], [8500, 300], [9000, 150],
    ],
    // opory wewnetrzne (hamowanie silnikiem) przy zamknietej przepustnicy: T = a + b * rpm
    frictionTorque: { a: 25, b: 0.0075 },
    cylinders: 8, // do syntezy dzwieku
  },

  // ---------------------------------------------------------------- przeniesienie napedu
  gearbox: {
    ratios: [3.00, 2.20, 1.74, 1.43, 1.21, 1.03], // 1..6
    reverse: 3.20,
    finalDrive: 3.45,
    efficiency: 0.92,
    shiftUpTime: 0.055, // s (sekwencyjna, odciecie zaplonu)
    shiftDownTime: 0.085, // s (z automatycznym miedzygazem)
    autoUpRpm: 7650,
    autoDownRpm: 4300,
    clutchMaxTorque: 1000, // Nm
  },
  differential: {
    // samoblokujacy (LSD tarczowy): moment blokujacy = preload + ramp * |moment wejsciowy|
    preload: 120, // Nm
    powerRamp: 0.45,
    coastRamp: 0.45,
  },

  // ---------------------------------------------------------------- hamulce
  brakes: {
    maxTorqueFront: 3960, // Nm na kolo przy 100% pedalu (rozdzial 66/34)
    maxTorqueRear: 2040,
    handbrakeTorque: 2500, // Nm na kolo tylne
  },

  // ---------------------------------------------------------------- aerodynamika
  aero: {
    airDensity: 1.225, // kg/m^3
    dragArea: 1.00, // Cd*A [m^2]
    liftAreaFront: 1.05, // Cl*A docisku na osi przedniej [m^2]
    liftAreaRear: 1.45, // Cl*A docisku na osi tylnej [m^2]
    dragHeight: 0.10, // wysokosc punktu przylozenia oporu wzgledem srodka ciezkosci [m]
  },

  // ---------------------------------------------------------------- uklad kierowniczy
  steering: {
    maxWheelAngleDeg: 21, // maksymalny kat skretu kola
    steeringWheelLockDeg: 270, // obrot kierownicy do oporu (dla animacji)
    ackermann: 0.5, // 0 = rownolegly, 1 = pelny Ackermann
  },

  // ---------------------------------------------------------------- systemy wspomagajace
  assists: {
    // ABS: prog poslizgu wzdluznego jako krotnosc poslizgu szczytowego opony (poziomy 1..4, 0 = wyl.)
    // 1 = najmniej ingerencji (kola moga wejsc za szczyt), 4 = najbezpieczniej
    absSlip: [1.3, 1.05, 0.92, 0.8],
    // TC: dopuszczalny poslizg wzdluzny kol napedzanych (bezwzgledny), poziomy 1..4
    tcSlip: [0.24, 0.17, 0.13, 0.095],
    // TC: dopuszczalny laczny poslizg opony napedzanej (1.0 = szczyt przyczepnosci)
    tcCombined: [1.30, 1.06, 0.96, 0.86],
  },
};

// Stale symulacji (wspolne dla calej gry)
export const PHYSICS = {
  gravity: 9.81,
  stepHz: 120, // staly krok logiki fizyki
  substeps: 4, // wewnetrzne podkroki dynamiki kol/opon (480 Hz), niezalezne od FPS
  maxFrameTime: 0.1, // maks. czas ramki przetwarzany naraz (ochrona przed "spiral of death")
};
