// Efekty: slady opon (dynamiczny bufor pierscieniowy) i dym/pyl spod kol (czastki).
import * as THREE from 'three';
import { SURF } from '../physics/surfaces.js';
import { smokeSprite } from './textures.js';

export class Skidmarks {
  constructor(maxSegments = 4000) {
    this.max = maxSegments;
    const pos = new Float32Array(maxSegments * 4 * 3);
    const col = new Float32Array(maxSegments * 4 * 4);
    const idx = new Uint32Array(maxSegments * 6);
    for (let i = 0; i < maxSegments; i++) {
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.MeshBasicMaterial({
      color: 0x0a0a0a, vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.next = 0;
    this.last = [null, null, null, null];
    this.dirty = false;
  }

  clear() {
    this.posAttr.array.fill(0);
    this.colAttr.array.fill(0);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.last = [null, null, null, null];
  }

  /** wywolywane po kroku fizyki dla kazdego kola */
  addFromVehicle(v) {
    for (let k = 0; k < 4; k++) {
      const w = v.wheels[k];
      const onTarmac = w.surface === SURF.ASPHALT || w.surface === SURF.CURB || w.surface === SURF.RUNOFF;
      const intensity = w.contact && onTarmac ? Math.min(1, Math.max(0, (w.slip - 0.85) * 0.9) + Math.max(0, w.slideSpeed - 3) * 0.04) : 0;
      if (intensity < 0.04) { this.last[k] = null; continue; }
      const p = w.contactPoint.clone();
      p.y = w.groundHeight + 0.012;
      // kierunek poprzeczny kola
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(v.quat);
      side.y = 0;
      side.normalize().multiplyScalar(w.width * 0.45);
      const L = this.last[k];
      if (L && L.p.distanceToSquared(p) < 0.25 * 0.25) continue;
      if (L && L.p.distanceToSquared(p) < 16) {
        this._segment(L.p, L.side, L.a, p, side, intensity);
      }
      this.last[k] = { p, side, a: intensity };
    }
  }

  _segment(p0, s0, a0, p1, s1, a1) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const P = this.posAttr.array, C = this.colAttr.array;
    const o = i * 12;
    P[o] = p0.x + s0.x; P[o + 1] = p0.y; P[o + 2] = p0.z + s0.z;
    P[o + 3] = p0.x - s0.x; P[o + 4] = p0.y; P[o + 5] = p0.z - s0.z;
    P[o + 6] = p1.x + s1.x; P[o + 7] = p1.y; P[o + 8] = p1.z + s1.z;
    P[o + 9] = p1.x - s1.x; P[o + 10] = p1.y; P[o + 11] = p1.z - s1.z;
    const c = i * 16;
    for (let k = 0; k < 4; k++) {
      const a = (k < 2 ? a0 : a1) * 0.55;
      C[c + k * 4] = 1; C[c + k * 4 + 1] = 1; C[c + k * 4 + 2] = 1; C[c + k * 4 + 3] = a;
    }
    this.posAttr.addUpdateRange(i * 12, 12);
    this.colAttr.addUpdateRange(i * 16, 16);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}

export class Particles {
  constructor(max = 400) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('psize', this.sizeAttr);
    geo.setAttribute('alpha', this.alphaAttr);
    geo.setAttribute('pcolor', this.colAttr);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: smokeSprite() }, scale: { value: 600 } },
      vertexShader: `
        attribute float psize; attribute float alpha; attribute vec3 pcolor;
        varying float vA; varying vec3 vC;
        uniform float scale;
        void main() {
          vA = alpha; vC = pcolor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying float vA; varying vec3 vC;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vC, t.a * vA);
          if (gl_FragColor.a < 0.01) discard;
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  emit(pos, vel, color, size, life) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.p[i * 3] = pos.x; this.p[i * 3 + 1] = pos.y; this.p[i * 3 + 2] = pos.z;
    this.v[i * 3] = vel.x; this.v[i * 3 + 1] = vel.y; this.v[i * 3 + 2] = vel.z;
    this.col[i * 3] = color[0]; this.col[i * 3 + 1] = color[1]; this.col[i * 3 + 2] = color[2];
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  /** emisja z kol slizgajacych sie po nawierzchni */
  emitFromVehicle(v, dt, enabled) {
    if (!enabled) return;
    for (const w of v.wheels) {
      if (!w.contact) continue;
      const tarmac = w.surface === SURF.ASPHALT || w.surface === SURF.CURB || w.surface === SURF.RUNOFF;
      const dirt = w.surface === SURF.GRAVEL || w.surface === SURF.GRASS;
      let rate = 0, color, size, life;
      if (tarmac && w.slideSpeed > 5) {
        rate = Math.min(60, (w.slideSpeed - 5) * 6);
        color = [0.85, 0.86, 0.88]; size = 1.2; life = 1.6;
      } else if (dirt && v.telemetry.speed > 4) {
        rate = Math.min(40, v.telemetry.speed * 1.2);
        color = w.surface === SURF.GRAVEL ? [0.62, 0.55, 0.44] : [0.35, 0.42, 0.25];
        size = w.surface === SURF.GRAVEL ? 1.1 : 0.7; life = 0.9;
      }
      const n = rate * dt + Math.random();
      for (let k = 0; k < Math.floor(n); k++) {
        const vel = new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 1.5).addScaledVector(v.vel, 0.15);
        this.emit(w.contactPoint, vel, color, size * (0.7 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.6));
      }
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.v[i * 3] *= 1 - dt * 1.5;
      this.v[i * 3 + 2] *= 1 - dt * 1.5;
      this.v[i * 3 + 1] *= 1 - dt * 0.8;
      this.alpha[i] = f * 0.45;
      this.sizeAttr.array[i] = this.size[i] * (1 + (1 - f) * 3.5);
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}
