// Kolizje miedzy samochodami: prostokaty nadwozia w plaszczyznie poziomej (SAT, 2D),
// odpowiedz impulsowa dwoch bryl sztywnych (restytucja + tarcie) i korekta przenikania.
import { Vector3 } from 'three';

const _n = new Vector3();
const _p = new Vector3();
const _va = new Vector3();
const _vb = new Vector3();
const _t = new Vector3();
const _J = new Vector3();

function frame(v) {
  const q = v.quat;
  // kierunki w poziomie: przod (+Z nadwozia) i lewo (+X nadwozia)
  let fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl; fz /= fl;
  const B = v.cfg.body;
  const off = (B.front + B.rear) / 2; // srodek prostokata wzgledem srodka ciezkosci
  return {
    cx: v.pos.x + fx * off, cz: v.pos.z + fz * off,
    fx, fz, lx: fz, lz: -fx,
    hl: (B.front - B.rear) / 2, hw: B.halfWidth,
  };
}

function project(F, ax, az) {
  return F.hl * Math.abs(F.fx * ax + F.fz * az) + F.hw * Math.abs(F.lx * ax + F.lz * az);
}

function support(F, ax, az) {
  // wierzcholek prostokata najdalej w kierunku (ax, az)
  const sf = Math.sign(F.fx * ax + F.fz * az) || 1;
  const sl = Math.sign(F.lx * ax + F.lz * az) || 1;
  return [F.cx + F.fx * F.hl * sf + F.lx * F.hw * sl, F.cz + F.fz * F.hl * sf + F.lz * F.hw * sl];
}

/**
 * Rozwiazuje kolizje wszystkich par aut. Zwraca liczbe kontaktow w tym kroku.
 * restitution ~0.15 (zderzaki/kompozyt), tarcie 0.3.
 */
export function collideVehicles(cars, { restitution = 0.15, friction = 0.3 } = {}) {
  let contacts = 0;
  const F = cars.map(frame);
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const A = F[i], Bf = F[j];
      const dx = Bf.cx - A.cx, dz = Bf.cz - A.cz;
      if (dx * dx + dz * dz > 30) continue; // > ~5.5 m
      if (Math.abs(cars[i].pos.y - cars[j].pos.y) > 2) continue;
      let best = Infinity, nx = 0, nz = 0;
      for (const [ax, az] of [[A.fx, A.fz], [A.lx, A.lz], [Bf.fx, Bf.fz], [Bf.lx, Bf.lz]]) {
        const d = dx * ax + dz * az;
        const o = project(A, ax, az) + project(Bf, ax, az) - Math.abs(d);
        if (o <= 0) { best = -1; break; }
        if (o < best) { best = o; const sg = d >= 0 ? 1 : -1; nx = ax * sg; nz = az * sg; }
      }
      if (best <= 0) continue;
      contacts++;
      // punkt kontaktu: srodek miedzy najglebszymi wierzcholkami
      const sa = support(A, nx, nz), sb = support(Bf, -nx, -nz);
      const a = cars[i], b = cars[j];
      _p.set((sa[0] + sb[0]) / 2, (a.pos.y + b.pos.y) / 2 - 0.15, (sa[1] + sb[1]) / 2);
      _n.set(nx, 0, nz); // od A do B
      a.velocityAt(_p, _va);
      b.velocityAt(_p, _vb);
      const vrel = _va.sub(_vb); // predkosc A wzgledem B
      const vn = vrel.dot(_n);
      // korekta przenikania (po polowie, tylko w poziomie)
      const corr = Math.min(best, 0.5) * 0.5;
      a.pos.addScaledVector(_n, -corr);
      b.pos.addScaledVector(_n, corr);
      if (vn <= 0) continue; // juz sie oddalaja
      const k = a.effectiveInvMass(_p, _n) + b.effectiveInvMass(_p, _n);
      const jn = ((1 + restitution) * vn) / k;
      _J.copy(_n).multiplyScalar(-jn);
      a.applyImpulse(_p, _J);
      _J.multiplyScalar(-1);
      b.applyImpulse(_p, _J);
      // tarcie styczne
      a.velocityAt(_p, _va);
      b.velocityAt(_p, _vb);
      _t.copy(_va).sub(_vb);
      _t.addScaledVector(_n, -_t.dot(_n));
      _t.y = 0;
      const vt = _t.length();
      if (vt > 1e-3) {
        _t.multiplyScalar(1 / vt);
        const kt = a.effectiveInvMass(_p, _t) + b.effectiveInvMass(_p, _t);
        const jt = Math.min(vt / kt, friction * jn);
        _J.copy(_t).multiplyScalar(-jt);
        a.applyImpulse(_p, _J);
        _J.multiplyScalar(-1);
        b.applyImpulse(_p, _J);
      }
      a.registerContact(vn);
      b.registerContact(vn);
    }
  }
  return contacts;
}
