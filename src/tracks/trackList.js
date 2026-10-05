// Lista torow + profile otoczenia. Geometria (linia srodkowa, szerokosci, wysokosci) pochodzi
// z danych rzeczywistych (patrz tools/build-tracks.mjs). Krawezniki, strefy wyjazdowe, bariery
// i obiekty otoczenia sa generowane proceduralnie na podstawie krzywizny toru (przyblizenie).
import { SURF } from '../physics/surfaces.js';

export const TRACKS = [
  {
    id: 'monza',
    name: 'Autodromo Nazionale Monza',
    short: 'Monza',
    country: 'Włochy',
    layout: 'Grand Prix',
    officialLength: 5793,
    load: () => import('./data/monza.json'),
    // profil stref wyjazdowych
    runoff: {
      verge: SURF.GRASS, vergeWidth: 2.0,
      outer: SURF.GRAVEL, outerVerge: SURF.RUNOFF, outerVergeWidth: 3.5,
      inner: SURF.GRASS, straight: SURF.GRASS,
      straightWidth: 9, innerWidth: 7, outerBase: 12, outerPerKmh: 0.11,
    },
    env: {
      trees: 'deciduous', treeDensity: 1.0, treeBand: [18, 420],
      grass: [0.29, 0.40, 0.17], ground: [0.30, 0.36, 0.20],
      sunElevation: 48, sunAzimuth: 210, fog: 0.00045, haze: [0.74, 0.80, 0.86],
    },
    pitSide: -1, // -1 = prawa strona (patrzac w kierunku jazdy)
    grandstands: [[0.985, 1], [0.08, 1], [0.13, -1], [0.86, 1], [0.6, 1]],
    approxNotes: 'Krawężniki, pobocza i bariery rozmieszczone proceduralnie wg krzywizny; brak starej pętli owalu.',
  },
  {
    id: 'spa',
    name: 'Circuit de Spa-Francorchamps',
    short: 'Spa-Francorchamps',
    country: 'Belgia',
    layout: 'Grand Prix',
    officialLength: 7004,
    load: () => import('./data/spa.json'),
    runoff: {
      verge: SURF.RUNOFF, vergeWidth: 2.5,
      outer: SURF.GRAVEL, outerVerge: SURF.RUNOFF, outerVergeWidth: 8,
      inner: SURF.GRASS, straight: SURF.GRASS,
      straightWidth: 8, innerWidth: 6, outerBase: 12, outerPerKmh: 0.10,
    },
    env: {
      trees: 'conifer', treeDensity: 1.25, treeBand: [16, 520],
      grass: [0.24, 0.36, 0.15], ground: [0.25, 0.33, 0.18],
      sunElevation: 38, sunAzimuth: 160, fog: 0.0006, haze: [0.70, 0.76, 0.82],
    },
    pitSide: -1,
    grandstands: [[0.99, 1], [0.03, -1], [0.12, 1], [0.95, -1]],
    approxNotes: 'Krawężniki, pobocza i bariery rozmieszczone proceduralnie wg krzywizny.',
  },
  {
    id: 'silverstone',
    name: 'Silverstone Circuit',
    short: 'Silverstone',
    country: 'Wielka Brytania',
    layout: 'Grand Prix (2011–)',
    officialLength: 5891,
    load: () => import('./data/silverstone.json'),
    runoff: {
      verge: SURF.RUNOFF, vergeWidth: 3.5,
      outer: SURF.GRAVEL, outerVerge: SURF.RUNOFF, outerVergeWidth: 10,
      inner: SURF.GRASS, straight: SURF.GRASS,
      straightWidth: 10, innerWidth: 8, outerBase: 14, outerPerKmh: 0.10,
    },
    env: {
      trees: 'mixed', treeDensity: 0.35, treeBand: [40, 600],
      grass: [0.30, 0.42, 0.18], ground: [0.33, 0.40, 0.22],
      sunElevation: 34, sunAzimuth: 200, fog: 0.0005, haze: [0.72, 0.78, 0.85],
    },
    pitSide: -1,
    grandstands: [[0.985, 1], [0.05, 1], [0.45, 1], [0.55, -1], [0.75, 1]],
    approxNotes: 'Krawężniki, pobocza i bariery rozmieszczone proceduralnie wg krzywizny.',
  },
];

export function getTrackDef(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
