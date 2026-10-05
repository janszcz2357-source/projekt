// Minimapa generowana z tej samej geometrii toru co fizyka (krawedzie z Track.wL/wR).
export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = null;
    this.rotate = false;
  }

  /** podglad z surowych danych (menu) - bez budowy pelnego toru */
  static drawPreview(canvas, centerline, color = '#e8ecf2') {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of centerline) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
    const sc = Math.min((W - 20) / (maxX - minX), (H - 20) / (maxY - minY));
    const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    centerline.forEach((p, i) => {
      const x = ox + (p[0] - minX) * sc, y = oy + (maxY - p[1]) * sc;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    // start/meta
    const p0 = centerline[0];
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath();
    ctx.arc(ox + (p0[0] - minX) * sc, oy + (maxY - p0[1]) * sc, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  setTrack(track) {
    this.track = track;
    const t = track;
    const b = t.bounds();
    this.cx = (b.minX + b.maxX) / 2;
    this.cz = (b.minZ + b.maxZ) / 2;
    this.span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    // sciezki krawedzi (wspolrzedne swiata)
    const step = 2;
    this.left = [];
    this.right = [];
    this.center = [];
    for (let i = 0; i < t.n; i += step) {
      this.left.push([t.px[i] + t.nx[i] * t.wL[i], t.pz[i] + t.nz[i] * t.wL[i]]);
      this.right.push([t.px[i] - t.nx[i] * t.wR[i], t.pz[i] - t.nz[i] * t.wR[i]]);
      this.center.push([t.px[i], t.pz[i]]);
    }
    this.sectors = t.sectorStarts.map((s) => {
      let i = 0;
      while (i < t.n - 1 && t.s[i] < s) i++;
      return i;
    });
  }

  /** others - modele rywali (OpponentCar: car.vehicle.pos, car.paint) */
  draw(carPos, carHeading, ghost = null, others = null) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!this.track) return;
    const t = this.track;
    const scale = (Math.min(W, H) * 0.86) / this.span;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    if (this.rotate) {
      ctx.rotate(Math.PI + carHeading);
      ctx.scale(scale * 1.6, scale * 1.6);
      ctx.translate(-carPos.x, -carPos.z);
    } else {
      // polnoc w gore: swiat z = -polnoc -> y ekranu = z
      ctx.scale(scale, scale);
      ctx.translate(-this.cx, -this.cz);
    }
    const lw = 1 / scale;
    // wypelnienie toru
    ctx.beginPath();
    this.left.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.closePath();
    this.right.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 9 * lw;
    ctx.beginPath();
    this.center.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(235,238,244,0.92)';
    ctx.lineWidth = 4.2 * lw;
    ctx.stroke();
    // granice sektorow
    ctx.lineWidth = 2.5 * lw;
    this.sectors.forEach((i, k) => {
      const len = 9 * lw;
      ctx.strokeStyle = k === 0 ? '#ff3b3b' : '#ffd23b';
      ctx.beginPath();
      ctx.moveTo(t.px[i] + t.nx[i] * len, t.pz[i] + t.nz[i] * len);
      ctx.lineTo(t.px[i] - t.nx[i] * len, t.pz[i] - t.nz[i] * len);
      ctx.stroke();
    });
    // auto
    const drawCar = (p, h, col, r) => {
      ctx.save();
      ctx.translate(p.x, p.z);
      ctx.rotate(-h);
      ctx.fillStyle = col;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.2 * lw;
      ctx.beginPath();
      ctx.moveTo(0, r * 1.5);
      ctx.lineTo(r, -r);
      ctx.lineTo(-r, -r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    if (ghost) drawCar(ghost, 0, 'rgba(160,120,255,0.8)', 4 * lw);
    if (others) {
      const r = (this.rotate ? 3.2 : 4.6) * lw;
      ctx.lineWidth = 1.2 * lw;
      ctx.strokeStyle = '#000';
      for (const o of others) {
        const p = o.car.vehicle.pos;
        ctx.fillStyle = o._mmColor ||= '#' + (o.car.paint ?? 0xffffff).toString(16).padStart(6, '0');
        ctx.beginPath();
        ctx.arc(p.x, p.z, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    drawCar(carPos, carHeading, '#33d1ff', (this.rotate ? 4 : 6) * lw);
    ctx.restore();
  }
}
