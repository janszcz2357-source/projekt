// Model opony: znormalizowany "combined slip" z ksztaltem Pacejki (Magic Formula).
//
// Wejscie: obciazenie Fz, poslizg wzdluzny kappa, poslizg boczny sy (= tan(kat znoszenia),
// znak taki, ze dodatnie sy daje dodatnia sile boczna), mnoznik przyczepnosci nawierzchni.
//
// 1) Poslizgi normalizujemy do wartosci szczytowych: nx = kappa/kappaPeak, ny = sy/tan(alphaPeak)
// 2) Laczny poslizg s = |(nx, ny)| -> jedna krzywa F(s) = mu(Fz)*Fz*MF(s)
// 3) Sila jest kierowana wzdluz wektora (nx, ny)/s
//
// Dzieki temu hamowanie/przyspieszanie i skrecanie dziela ten sam limit przyczepnosci (elipsa tarcia),
// a po przekroczeniu szczytu sila spada (poslizg, blokowanie kol, nadsterownosc przy gazie).
// Wspolczynnik tarcia maleje ze wzrostem obciazenia (load sensitivity), co generuje realistyczny
// wplyw przenoszenia obciazenia na balans auta.

export function createTyreModel(cfg) {
  const C = cfg.shapeC;
  // B dobrane tak, by szczyt MF przypadal dokladnie na s = 1
  const B = Math.tan(Math.PI / (2 * C));
  const tanPeak = Math.tan((cfg.peakSlipAngleDeg * Math.PI) / 180);
  const kPeak = cfg.peakSlipRatio;
  const mu0 = cfg.mu;
  const fz0 = cfg.nominalLoad;
  const ls = cfg.loadSensitivity;
  const longScale = cfg.longitudinalScale;

  function mf(s) {
    return Math.sin(C * Math.atan(B * s));
  }

  return {
    tanPeak,
    kPeak,
    /** zwraca wynik w out.fx, out.fy; out.slip = znormalizowany laczny poslizg (1 = szczyt) */
    forces(fz, kappa, sy, gripMul, out) {
      if (fz <= 0) {
        out.fx = 0; out.fy = 0; out.slip = 0; out.mu = 0;
        return out;
      }
      const loadRatio = (fz - fz0) / fz0;
      const mu = mu0 * gripMul * Math.max(0.55, 1 - ls * loadRatio);
      const nx = kappa / kPeak;
      const ny = sy / tanPeak;
      const s = Math.sqrt(nx * nx + ny * ny);
      out.slip = s;
      out.mu = mu;
      if (s < 1e-9) { out.fx = 0; out.fy = 0; return out; }
      const f = mu * fz * mf(s);
      out.fx = (f * nx * longScale) / s;
      out.fy = (f * ny) / s;
      return out;
    },
  };
}
