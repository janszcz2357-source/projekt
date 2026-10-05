// Kamery: za samochodem (poscig), z maski, z kokpitu.
//
// Kamera poscigowa sledzi pozycje auta dokladnie (bez sprezyny na pozycji w swiecie - taka sprezyna
// ma opoznienie proporcjonalne do predkosci i przy duzych predkosciach "skakala"). Wygladzane sa tylko:
// kat odchylenia (widac obrot auta w poslizgu), wysokosc (filtr nierownosci i krawezników)
// oraz lekkie odsuniecie przy przyspieszaniu / przyblizenie przy hamowaniu. Wszystkie filtry sa
// wykladnicze (1 - e^(-k*dt)), wiec zachowanie nie zalezy od liczby klatek.
//
// Kamery przymocowane do nadwozia (maska, kokpit): przechyl i pochylenie czesciowo wygladzone,
// glowa kierowcy porusza sie pod wplywem przeciazen, drgania od krawezników sa plynne
// (zalezne od przejechanej drogi), a nie losowe co klatke.
import * as THREE from 'three';

export const CAMERA_MODES = ['chase', 'hood', 'cockpit'];
export const CAMERA_NAMES = { chase: 'Za samochodem', hood: 'Maska', cockpit: 'Kokpit' };

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _local = new THREE.Vector3();
const _look = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const blend = (k, dt) => 1 - Math.exp(-k * dt);

export class CameraRig {
  constructor(camera, carCfg) {
    this.camera = camera;
    this.cfg = carCfg;
    this.mode = 'chase';
    this.baseFov = 62;
    this.cockpitFov = 70;
    this.yaw = 0;
    this.smoothY = 0;
    this.pull = 0;
    this.head = new THREE.Vector3();
    this.headVel = new THREE.Vector3();
    this.lookYaw = 0;
    this.lookBack = false;
    this.initialized = false;
    this.shake = 0; // amplituda drgan [m] (ustawiana przez gre: krawezniki, predkosc)
    this._shakePhase = 0;
    this._roll = 0;
    this._pitch = 0;
    this._fov = 62;
  }

  setMode(m) {
    this.mode = m;
    this.initialized = false;
  }

  next() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  _setFov(target, dt) {
    this._fov += (target - this._fov) * blend(4, dt);
    const cam = this.camera;
    if (Math.abs(cam.fov - this._fov) > 0.01) {
      cam.fov = this._fov;
      cam.updateProjectionMatrix();
    }
  }

  /** carPos/carQuat - pozycja interpolowana miedzy krokami fizyki; tel - telemetria; dt - czas klatki */
  update(carPos, carQuat, tel, dt, steer) {
    dt = clamp(dt, 0, 0.1);
    const cam = this.camera;
    const fwd = _v.set(0, 0, 1).applyQuaternion(carQuat);
    const carYaw = Math.atan2(fwd.x, fwd.z);
    const speed = tel.speed || 0;
    if (!this.initialized) {
      this.yaw = carYaw;
      this.smoothY = carPos.y;
      this.pull = 0;
      this.head.set(0, 0, 0);
      this.headVel.set(0, 0, 0);
      this.lookYaw = 0;
      this._roll = 0;
      this._pitch = 0;
      this._fov = this.mode === 'cockpit' ? this.cockpitFov : this.baseFov;
      this.initialized = true;
    }
    if (this.mode === 'chase') {
      let d = carYaw - this.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.yaw += d * blend(6, dt);
      // wysokosc: filtr dolnoprzepustowy (nierownosci, krawezniki), opoznienie ~v/15
      this.smoothY += (carPos.y - this.smoothY) * blend(15, dt);
      if (Math.abs(carPos.y - this.smoothY) > 3) this.smoothY = carPos.y;
      // odsuniecie przy przyspieszaniu, przyblizenie przy hamowaniu (wrazenie predkosci)
      const pullTarget = clamp(tel.longG || 0, -1.8, 1.2) * 0.35;
      this.pull += (pullTarget - this.pull) * blend(3, dt);
      const back = this.lookBack ? -1 : 1;
      const dist = 5.9 + Math.min(1.1, speed * 0.011) + this.pull;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      cam.position.set(carPos.x - sy * dist * back, this.smoothY + 1.75, carPos.z - cy * dist * back);
      _look.set(carPos.x + sy * 2.5 * back, this.smoothY + 0.75, carPos.z + cy * 2.5 * back);
      cam.up.set(0, 1, 0);
      cam.lookAt(_look);
      this._setFov(this.baseFov + Math.min(8, speed * 0.075), dt);
      return;
    }
    // ---- kamery przymocowane do nadwozia
    if (this.mode === 'hood') _local.set(0, 1.0 - this.cfg.cgHeight, 0.85);
    else _local.set(0.37, 1.065 - this.cfg.cgHeight, -0.3);
    if (this.mode === 'cockpit') {
      // glowa: sprezyna napedzana przeciazeniami (uklad auta), tlumienie 0.7
      const tx = clamp(-(tel.latG || 0), -2.5, 2.5) * 0.016;
      const ty = -Math.min(2.5, Math.abs(tel.longG || 0)) * 0.004;
      const tz = clamp(-(tel.longG || 0), -2.5, 2.5) * 0.02;
      const w = 7;
      const hx = this.head.x, hy = this.head.y, hz = this.head.z;
      this.headVel.x += ((tx - hx) * w * w - 2 * 0.7 * w * this.headVel.x) * dt;
      this.headVel.y += ((ty - hy) * w * w - 2 * 0.7 * w * this.headVel.y) * dt;
      this.headVel.z += ((tz - hz) * w * w - 2 * 0.7 * w * this.headVel.z) * dt;
      this.head.addScaledVector(this.headVel, dt);
      this.head.clampLength(0, 0.06);
      _local.add(this.head);
    }
    // plynne drgania zalezne od przejechanej drogi (nie losowe co klatke)
    this._shakePhase += speed * dt;
    if (this.shake > 0) {
      const ph = this._shakePhase;
      _local.y += this.shake * (Math.sin(ph * 7.85) * 0.6 + Math.sin(ph * 3.1 + 1.3) * 0.4);
      _local.x += this.shake * 0.4 * Math.sin(ph * 5.3 + 0.7);
    }
    const p = _local.applyQuaternion(carQuat).add(carPos);
    cam.position.copy(p);
    // orientacja: odchylenie auta, wygladzone i czesciowe pochylenie/przechyl (mniej "kolysania")
    _q.copy(carQuat);
    _e.setFromQuaternion(_q, 'YXZ');
    const rollF = this.mode === 'cockpit' ? 0.5 : 0.35;
    this._roll += (_e.z * rollF - this._roll) * blend(12, dt);
    this._pitch += (_e.x * 0.7 - this._pitch) * blend(12, dt);
    const look = this.mode === 'cockpit' ? (steer || 0) * -0.2 * Math.min(1, speed / 15) : 0;
    this.lookYaw += (look - this.lookYaw) * blend(4, dt);
    // kamera patrzy wzdluz -Z, auto jedzie wzdluz +Z: obrot o PI zmienia znaki pochylenia i przechylu
    _e.set(-(this._pitch + (this.mode === 'cockpit' ? 0.03 : 0)), _e.y + this.lookYaw + Math.PI + (this.lookBack ? Math.PI : 0), -this._roll, 'YXZ');
    cam.quaternion.setFromEuler(_e);
    this._setFov(this.mode === 'cockpit' ? this.cockpitFov : this.baseFov + 4, dt);
  }
}
