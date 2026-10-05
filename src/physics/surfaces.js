// Typy nawierzchni i ich wlasciwosci fizyczne.
//  grip      - mnoznik wspolczynnika tarcia opony
//  rollRes   - dodatkowy opor toczenia (ulamek obciazenia kola), np. zwir "wciaga" auto
//  bumpAmp   - amplituda nierownosci [m] (wibracje zawieszenia, dzwiek)
//  sink      - zapadanie sie kola w podloze [m]
export const SURF = {
  NONE: 0,
  ASPHALT: 1,
  CURB: 2,
  RUNOFF: 3, // asfaltowa strefa wyjazdowa (poza linia toru)
  GRASS: 4,
  GRAVEL: 5,
};

export const SURFACE_PROPS = {
  [SURF.NONE]: { name: '-', grip: 1.0, rollRes: 0, bumpAmp: 0, sink: 0, onTrack: false },
  [SURF.ASPHALT]: { name: 'asfalt', grip: 1.0, rollRes: 0, bumpAmp: 0, sink: 0, onTrack: true },
  [SURF.CURB]: { name: 'krawężnik', grip: 0.9, rollRes: 0.004, bumpAmp: 0.009, sink: 0, onTrack: true },
  [SURF.RUNOFF]: { name: 'pobocze asfaltowe', grip: 0.94, rollRes: 0.002, bumpAmp: 0.002, sink: 0, onTrack: false },
  [SURF.GRASS]: { name: 'trawa', grip: 0.52, rollRes: 0.05, bumpAmp: 0.014, sink: 0.01, onTrack: false },
  [SURF.GRAVEL]: { name: 'żwir', grip: 0.48, rollRes: 0.40, bumpAmp: 0.02, sink: 0.04, onTrack: false },
};
