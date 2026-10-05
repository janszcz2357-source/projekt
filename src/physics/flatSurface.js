// Plaska nawierzchnia testowa (bez barier) - uzywana w testach fizyki.
// Opcjonalnie: funkcja typeAt(x, z) zwracajaca typ nawierzchni dla danego punktu,
// oraz sciana (wallX) do testu kolizji.
import { SURF } from './surfaces.js';

export class FlatSurface {
  constructor({ typeAt = null, wallX = null, slope = 0 } = {}) {
    this.typeAt = typeAt;
    this.wallX = wallX;
    this.slope = slope; // nachylenie wzdluz osi +Z (dy/dz)
  }

  locate() {
    return 0;
  }

  sample(x, z, hint, out) {
    out.height = this.slope * z;
    const l = Math.hypot(this.slope, 1);
    out.nx = 0;
    out.ny = 1 / l;
    out.nz = -this.slope / l;
    out.type = this.typeAt ? this.typeAt(x, z) : SURF.ASPHALT;
    out.index = 0;
    out.lateral = x;
    return out;
  }

  collide(x, z, hint, out) {
    if (this.wallX == null || x < this.wallX) return false;
    out.pen = x - this.wallX;
    out.nx = -1;
    out.nz = 0;
    return true;
  }
}
