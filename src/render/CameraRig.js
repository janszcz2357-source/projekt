// Kamery: za samochodem (poscig), z maski, z kokpitu.
// Kamera poscigowa podaza za kierunkiem auta z opoznieniem (widac obrot auta w poslizgu),
// pozycja wygladzana krytycznie tlumiona sprezyna (stabilna, bez drgan). W kokpicie glowa
// kierowcy przesuwa sie lekko pod wplywem przeciazen i "patrzy w zakret".
import * as THREE from 'three';

export const CAMERA_MODES = ['chase', 'hood', 'cockpit'];
export const CAMERA_NAMES = { chase: 'Za samochodem', hood: 'Maska', cockpit: 'Kokpit' };

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class CameraRig {
  constructor(camera, carCfg) {
    this.camera = camera;
    this.cfg = carCfg;
    this.mode = 'chase';
    this.baseFov = 62;
    this.cockpitFov = 70;
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.head = new THREE.Vector3();
    this.headVel = new THREE.Vector3();
    this.lookYaw = 0;
    this.lookBack = false;
    this.initialized = false;
    this.shake = 0;
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

  /** carPos/carQuat - interpolowane; tel - telemetria; dt - czas klatki */
  update(carPos, carQuat, tel, dt, steer) {
    dt = Math.min(dt, 0.05);
    const cam = this.camera;
    const fwd = _v.set(0, 0, 1).applyQuaternion(carQuat);
    const carYaw = Math.atan2(fwd.x, fwd.z);
    const speed = tel.speed || 0;
    if (!this.initialized) {
      this.yaw = carYaw;
      this.initialized = true;
      this.pos.set(carPos.x - Math.sin(carYaw) * 6, carPos.y + 2, carPos.z - Math.cos(carYaw) * 6);
      this.vel.set(0, 0, 0);
      this.head.set(0, 0, 0);
      this.headVel.set(0, 0, 0);
    }
    if (this.mode === 'chase') {
      // opozniony kat (wiecej opoznienia przy duzej predkosci obrotu -> widac poslizg)
      let d = carYaw - this.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.yaw += d * Math.min(1, dt * 5.5);
      const back = this.lookBack ? -1 : 1;
      const dist = 5.9 + Math.min(1.2, speed * 0.012);
      const height = 1.75;
      const target = new THREE.Vector3(
        carPos.x - Math.sin(this.yaw) * dist * back,
        carPos.y + height,
        carPos.z - Math.cos(this.yaw) * dist * back,
      );
      // krytycznie tlumiona sprezyna
      const w = 9;
      const acc = target.clone().sub(this.pos).multiplyScalar(w * w).addScaledVector(this.vel, -2 * w);
      this.vel.addScaledVector(acc, dt);
      this.pos.addScaledVector(this.vel, dt);
      // nie pozwol kamerze odjechac za daleko (np. przy teleportacji)
      if (this.pos.distanceTo(target) > 12) this.pos.copy(target);
      const lookAt = new THREE.Vector3(carPos.x + Math.sin(this.yaw) * 2.5 * back, carPos.y + 0.75, carPos.z + Math.cos(this.yaw) * 2.5 * back);
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(lookAt);
      const fov = this.baseFov + Math.min(8, speed * 0.075);
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      return;
    }
    // kamery przymocowane do nadwozia
    let local;
    if (this.mode === 'hood') local = new THREE.Vector3(0, 1.0 - this.cfg.cgHeight, 0.85);
    else local = new THREE.Vector3(0.38, 1.08 - this.cfg.cgHeight, -0.3);
    if (this.mode === 'cockpit') {
      // ruch glowy: sprezyna napedzana przeciazeniami (w ukladzie auta)
      const target = new THREE.Vector3(-tel.latG * 0.018, -Math.abs(tel.longG) * 0.004, -tel.longG * 0.022);
      const w = 7;
      const acc = target.sub(this.head).multiplyScalar(w * w).addScaledVector(this.headVel, -2 * 0.7 * w);
      this.headVel.addScaledVector(acc, dt);
      this.head.addScaledVector(this.headVel, dt);
      local.add(this.head);
    }
    const p = local.applyQuaternion(carQuat).add(carPos);
    // drgania (krawezniki, predkosc)
    if (this.shake > 0) {
      p.x += (Math.random() - 0.5) * this.shake;
      p.y += (Math.random() - 0.5) * this.shake;
      p.z += (Math.random() - 0.5) * this.shake;
    }
    cam.position.copy(p);
    // orientacja: auto, ale z czesciowo wygladzonym przechylem (mniej "kolysania")
    _q.copy(carQuat);
    _e.setFromQuaternion(_q, 'YXZ');
    _e.z *= this.mode === 'cockpit' ? 0.55 : 0.35;
    _e.x *= 0.7;
    if (this.mode === 'cockpit') _e.x += 0.025; // lekko w dol - widac kierownice
    // patrzenie w zakret (kokpit)
    const look = this.mode === 'cockpit' ? (steer || 0) * -0.22 * Math.min(1, speed / 15) : 0;
    this.lookYaw += (look - this.lookYaw) * Math.min(1, dt * 4);
    _e.y += this.lookYaw + Math.PI + (this.lookBack ? Math.PI : 0);
    _e.x = -_e.x;
    _e.z = -_e.z;
    cam.quaternion.setFromEuler(_e);
    const fov = this.mode === 'cockpit' ? this.cockpitFov : this.baseFov + 4;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
}
