// Glowny modul gry: swiat 3D, sesje (trening / time attack), petla ze stalym krokiem fizyki.
import * as THREE from 'three';
import { GT_CAR, PHYSICS } from '../config/carConfig.js';
import { Vehicle } from '../physics/Vehicle.js';
import { Track } from '../tracks/Track.js';
import { getTrackDef } from '../tracks/trackList.js';
import { TrackMesh, createTrackMaterials, buildTrackside, GeoBuilder } from '../render/TrackMesh.js';
import { createSky, SunLight, buildTerrain, Forest } from '../render/Environment.js';
import { CarModel } from '../render/CarModel.js';
import { CameraRig, CAMERA_NAMES } from '../render/CameraRig.js';
import { Skidmarks, Particles } from '../render/Effects.js';
import { FixedStepper } from './FixedStepper.js';
import { LapTimer } from './LapTimer.js';
import { Autopilot } from './autopilot.js';
import { Input } from './Input.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { HUD } from '../ui/HUD.js';
import { loadSettings, saveSettings, Records, formatTime } from './Storage.js';

const MODE_NAMES = { practice: 'TRENING', timeattack: 'TIME ATTACK' };
const wait = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.settings = loadSettings();
    this.records = new Records();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 14000);
    this.input = new Input();
    this.audio = new AudioEngine();
    this.hud = new HUD();
    this.stepper = new FixedStepper(PHYSICS.stepHz, PHYSICS.maxFrameTime);
    this.cameraRig = new CameraRig(this.camera, GT_CAR);
    this.state = 'boot'; // boot | menu | countdown | running | paused
    this.mode = 'practice';
    this.trackId = null;
    this.world = null;
    this.carModel = null;
    this.vehicle = null;
    this.timer = null;
    this.autopilot = null;
    this.fps = 60;
    this._last = performance.now();
    this._countdown = null;
    this._offTimer = 0;
    this._wrongWay = 0;
    this._dashTimer = 0;
    this.listeners = {};
    this._applyInputSettings();
    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  on(ev, fn) {
    (this.listeners[ev] ||= []).push(fn);
  }

  _emit(ev, data) {
    (this.listeners[ev] || []).forEach((fn) => fn(data));
  }

  // ------------------------------------------------------------------ ustawienia
  setSetting(key, value) {
    this.settings[key] = value;
    saveSettings(this.settings);
    this._applySetting(key);
  }

  resetSettings(defaults) {
    Object.assign(this.settings, defaults);
    saveSettings(this.settings);
    for (const k of Object.keys(defaults)) this._applySetting(k);
  }

  _applySetting(key) {
    const s = this.settings;
    switch (key) {
      case 'renderScale':
      case 'quality':
        this._resize();
        if (key === 'quality' && this.world) {
          this.world.sun.setQuality(s.quality);
          this._rebuildVegetation();
        }
        break;
      case 'fov':
      case 'cockpitFov':
        this.cameraRig.baseFov = s.fov;
        this.cameraRig.cockpitFov = s.cockpitFov;
        break;
      case 'camera':
        break;
      case 'abs':
      case 'tc':
      case 'gearbox':
        this._applyVehicleSettings();
        break;
      case 'paint':
        this.carModel?.setPaint(s.paint);
        break;
      case 'showRacingLine':
        if (this.world?.racingLine) this.world.racingLine.visible = s.showRacingLine;
        break;
      case 'minimapRotate':
        this.hud.minimap.rotate = s.minimapRotate;
        break;
      case 'volMaster':
      case 'volEngine':
      case 'volEffects':
        this.audio.setVolumes({ master: s.volMaster, engine: s.volEngine, effects: s.volEffects });
        break;
      default:
        this._applyInputSettings();
    }
  }

  _applyInputSettings() {
    const s = this.settings;
    Object.assign(this.input.settings, {
      steerSensitivity: s.steerSensitivity, speedSensitivity: s.speedSensitivity,
      counterSteerAssist: s.counterSteer, padDeadzone: s.padDeadzone, padLinearity: s.padLinearity,
    });
    this.cameraRig.baseFov = s.fov;
    this.cameraRig.cockpitFov = s.cockpitFov;
    this.hud.minimap.rotate = s.minimapRotate;
  }

  _applyVehicleSettings() {
    if (!this.vehicle) return;
    const auto = this.state === 'menu';
    Object.assign(this.vehicle.settings, {
      absLevel: auto ? 2 : this.settings.abs,
      tcLevel: auto ? 2 : this.settings.tc,
      autoGearbox: auto || this.settings.gearbox === 'auto',
    });
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const q = this.settings.quality;
    const qScale = q === 'low' ? 0.8 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, q === 'ultra' ? 2 : q === 'high' ? 1.5 : 1.25);
    this.renderer.setPixelRatio(dpr * this.settings.renderScale * qScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ swiat
  async loadTrack(id, onProgress = () => {}) {
    if (this.trackId === id && this.world) return;
    const def = getTrackDef(id);
    const T0 = performance.now();
    const timings = {};
    const mark = (k) => { timings[k] = Math.round(performance.now() - T0); };
    onProgress('Wczytywanie danych toru…');
    const data = (await def.load()).default;
    await wait();
    this._disposeWorld();
    onProgress('Budowa geometrii toru…');
    await wait();
    const track = new Track(data, def);
    mark('track');
    const q = this.settings.quality;
    const scene = this.scene;
    const world = { track, def, objects: [] };
    const add = (o) => { scene.add(o); world.objects.push(o); };
    const skyInfo = createSky(scene, this.renderer, def.env);
    world.objects.push(skyInfo.sky);
    world.envRT = skyInfo.envRT;
    world.sun = new SunLight(scene, def.env, q);
    world.objects.push(world.sun.light, world.sun.light.target, world.sun.hemi);
    world.materials = createTrackMaterials(q);
    world.trackMesh = new TrackMesh(track, world.materials, { barrierShadows: q !== 'low' });
    add(world.trackMesh.group);
    add(buildTrackside(track, world.materials, def));
    mark('trackMeshes');
    onProgress('Teren (DEM)…');
    await wait();
    world.terrain = buildTerrain(track, def.env, q);
    add(world.terrain);
    mark('terrain');
    onProgress('Roślinność…');
    await wait();
    world.forest = new Forest(track, def.env, world.terrain, def, q);
    add(world.forest.group);
    mark('forest');
    world.racingLine = this._buildRacingLine(track);
    world.racingLine.visible = this.settings.showRacingLine;
    add(world.racingLine);
    world.skid = new Skidmarks(q === 'low' ? 1500 : 4000);
    add(world.skid.mesh);
    world.particles = new Particles(q === 'low' ? 150 : 400);
    add(world.particles.points);
    onProgress('Samochód…');
    await wait();
    if (!this.carModel) {
      this.carModel = new CarModel(GT_CAR, { paint: this.settings.paint });
    }
    scene.add(this.carModel.root);
    this.vehicle = new Vehicle(GT_CAR, track);
    this.timer = new LapTimer(track);
    this.timer.on((e) => this._onTimerEvent(e));
    this.hud.minimap.setTrack(track);
    this.world = world;
    this.track = track;
    this.trackId = id;
    this._applyVehicleSettings();
    // kompilacja shaderow zanim pokazemy obraz
    onProgress('Kompilacja shaderów…');
    await wait();
    const sp = track.spawn(track.gridIndex, 0);
    this.vehicle.reset(sp.x, sp.z, sp.heading, 0, sp.index);
    this._syncCar(1);
    this.cameraRig.setMode('chase');
    this.cameraRig.update(this.vehicle.pos, this.vehicle.quat, this.vehicle.telemetry, 0.016, 0);
    this.renderer.compile(scene, this.camera);
    this.renderer.render(scene, this.camera);
    mark('total');
    this.loadTimings = timings;
    console.info('[apex-gt] czasy ladowania toru (ms, narastajaco):', JSON.stringify(timings));
  }

  _rebuildVegetation() {
    const w = this.world;
    if (!w) return;
    this.scene.remove(w.forest.group);
    w.forest.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
    w.forest = new Forest(w.track, w.def.env, w.terrain, w.def, this.settings.quality);
    this.scene.add(w.forest.group);
    w.objects.push(w.forest.group);
  }

  _disposeWorld() {
    const w = this.world;
    if (!w) return;
    for (const o of w.objects) {
      this.scene.remove(o);
      o.traverse?.((c) => {
        if (c.geometry) c.geometry.dispose();
      });
    }
    w.envRT?.dispose();
    Object.values(w.materials || {}).forEach((m) => m.dispose());
    this.scene.environment = null;
    this.world = null;
    this.trackId = null;
  }

  /** linia wyscigowa (pomoc): zielona - przyspieszanie, zolta - utrzymanie, czerwona - hamowanie */
  _buildRacingLine(t) {
    const gb = new GeoBuilder(true);
    let prev = null;
    for (let k = 0; k <= t.n; k++) {
      const i = k % t.n;
      const lat = t.raceLat[i];
      const tx = t.tx[i], tz = t.tz[i];
      const a = [t.px[i] + t.nx[i] * (lat + 0.35), t.py[i] + 0.012, t.pz[i] + t.nz[i] * (lat + 0.35)];
      const b = [t.px[i] + t.nx[i] * (lat - 0.35), t.py[i] + 0.012, t.pz[i] + t.nz[i] * (lat - 0.35)];
      void tx; void tz;
      const v0 = t.speedProfile[i];
      const v1 = t.speedProfile[(i + 16) % t.n];
      let c = [0.15, 0.85, 0.35];
      if (v1 < v0 - 1.5) c = [0.95, 0.18, 0.12];
      else if (Math.abs(v1 - v0) < 0.6 && v0 < 60) c = [0.98, 0.82, 0.15];
      const row = [gb.vert(...b, 0, 1, 0, 0, 0, ...c), gb.vert(...a, 0, 1, 0, 1, 0, ...c)];
      if (prev) gb.quad(prev[0], prev[1], row[0], row[1]);
      prev = row;
    }
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    const m = new THREE.Mesh(gb.build(), mat);
    m.renderOrder = 1;
    return m;
  }

  // ------------------------------------------------------------------ sesje
  /** tlo menu: auto jedzie samo (autopilot) */
  startDemo() {
    this.state = 'menu';
    this.vehicle.holdBrakes = false;
    this._applyVehicleSettings();
    const t = this.track;
    const i = t.idx(t.flyingIndex - 120);
    const sp = t.spawn(i, t.raceLat[i]);
    this.vehicle.reset(sp.x, sp.z, sp.heading, t.speedProfile[i] * 0.8, sp.index);
    this.autopilot = new Autopilot(t, this.vehicle, { pace: 0.86 });
    this.cameraRig.setMode('chase');
    this.carModel.setCockpitMode(false);
    this.world.skid.clear();
    this.world.particles.clear();
    this.hud.show(false);
    this.audio.mute(true);
    this.stepper.reset();
  }

  async startSession(mode, trackId) {
    this.audio.init();
    this.audio.mute(false);
    this.audio.setVolumes({ master: this.settings.volMaster, engine: this.settings.volEngine, effects: this.settings.volEffects });
    if (trackId && trackId !== this.trackId) {
      this._emit('loading', true);
      await this.loadTrack(trackId, (m) => this._emit('progress', m));
      this._emit('loading', false);
    }
    this.mode = mode;
    this.settings.lastMode = mode;
    this.settings.lastTrack = this.trackId;
    saveSettings(this.settings);
    this.autopilot = null;
    this.state = 'countdown';
    this._applyVehicleSettings();
    const t = this.track;
    this.timer.reset();
    this.world.skid.clear();
    this.world.particles.clear();
    this.input.reset();
    this.input.clearEdges();
    if (mode === 'timeattack') {
      const i = t.flyingIndex;
      const sp = t.spawn(i, t.raceLat[i]);
      this._flyingSpeed = t.speedProfile[i] * 0.8;
      this.vehicle.reset(sp.x, sp.z, sp.heading, this._flyingSpeed, sp.index);
    } else {
      const sp = t.spawn(t.gridIndex, 2.2);
      this.vehicle.reset(sp.x, sp.z, sp.heading, 0, sp.index);
    }
    this.cameraRig.setMode(this.settings.camera);
    this.carModel.setCockpitMode(this.settings.camera === 'cockpit');
    this.record = this.records.get(this.trackId, mode);
    this.hud.setMode(MODE_NAMES[mode]);
    this.hud.show(true);
    this.hud.clearMessage();
    this._countdown = { t: 0, lit: 0, goAt: 0.8 + 5 * 0.7 + 0.4 + Math.random() * 1.2, done: false };
    this.stepper.reset();
    this._offTimer = 0;
    this._wrongWay = 0;
    this._emit('session', { mode });
  }

  restart() {
    this.startSession(this.mode);
  }

  pause() {
    if (this.state !== 'running' && this.state !== 'countdown') return;
    this._pausedFrom = this.state;
    this.state = 'paused';
    this.audio.suspend();
    this._emit('pause', true);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this._pausedFrom || 'running';
    this.audio.resume();
    this.stepper.reset();
    this.input.clearEdges();
    this._last = performance.now();
    this._emit('pause', false);
  }

  quitToMenu() {
    this.audio.resume();
    this.startDemo();
    this._emit('menu');
  }

  /** ustawia auto na torze w biezacym miejscu (po wypadku) */
  resetCar() {
    if (!this.vehicle || this.state === 'menu') return;
    const t = this.track;
    const d = t.distanceAlong(this.vehicle.pos.x, this.vehicle.pos.z, this.vehicle.trackIndex);
    const i = t.idx(d.index - 4);
    const sp = t.spawn(i, t.raceLat[i] * 0.5);
    this.vehicle.reset(sp.x, sp.z, sp.heading, 0, sp.index);
    this.timer.carReset();
    this.stepper.reset();
    this.cameraRig.initialized = false;
    this.hud.message('Samochód ustawiony na torze', this.timer.lapActive ? 'Bieżące okrążenie unieważnione' : '', 1800);
  }

  _onTimerEvent(e) {
    if (this.state === 'menu') return;
    if (e.type === 'lap') {
      const lap = e.lap;
      let rec = false;
      if (lap.valid) {
        rec = this.records.submit(this.trackId, this.mode, lap, this.timer.bestTrace && e.best ? this.timer.bestTrace : null, {
          abs: this.settings.abs, tc: this.settings.tc, gearbox: this.settings.gearbox,
        });
        if (rec) this.record = this.records.get(this.trackId, this.mode);
      }
      if (!lap.valid) this.hud.message(`Okrążenie ${lap.number}: ${formatTime(lap.time)}`, `NIEWAŻNE – ${lap.reason}`, 3000, '#ff8a80');
      else if (rec) this.hud.message(`NOWY REKORD ${formatTime(lap.time)}`, `Okrążenie ${lap.number}`, 3500, '#d9b8ff');
      else if (e.best) this.hud.message(`Najlepsze w sesji ${formatTime(lap.time)}`, `Okrążenie ${lap.number}`, 3000, '#b8ffd0');
      else this.hud.message(`Okrążenie ${lap.number}: ${formatTime(lap.time)}`, '', 2600);
      this.audio.chime(rec || e.best);
      this._emit('lap', lap);
    } else if (e.type === 'invalid') {
      this.hud.message('OKRĄŻENIE NIEWAŻNE', e.reason, 2200, '#ff8a80');
    } else if (e.type === 'lapStart' && e.number === 1) {
      this.hud.message(this.mode === 'timeattack' ? 'Okrążenie pomiarowe' : 'Pomiar czasu rozpoczęty', '', 1500);
    }
  }

  // ------------------------------------------------------------------ petla
  frame(now) {
    const dt = Math.min(0.25, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    if (dt > 0) this.fps += (1 / dt - this.fps) * Math.min(1, dt * 3);
    if (!this.world || !this.vehicle) return;
    const v = this.vehicle;
    const inp = this.input;

    // --- wejscie i zdarzenia
    const ctrl = inp.update(dt, v);
    if (this.state === 'running' || this.state === 'countdown') {
      if (inp.consume('pause')) { this.pause(); return; }
      if (inp.consume('camera')) {
        const m = this.cameraRig.next();
        this.carModel.setCockpitMode(m === 'cockpit');
      }
      if (inp.consume('reset') && this.state === 'running') this.resetCar();
      if (inp.consume('shiftUp')) { v.shiftRequests++; }
      if (inp.consume('shiftDown')) { v.shiftRequests--; }
      this.cameraRig.lookBack = !!inp.lookBack;
    } else if (this.state === 'paused') {
      if (inp.consume('pause')) this.resume();
    } else {
      inp.clearEdges();
    }

    // --- odliczanie
    if (this.state === 'countdown') this._updateCountdown(dt, ctrl);

    // --- fizyka (staly krok 120 Hz)
    const frozen = this.state === 'countdown' && this.mode === 'timeattack';
    if (this.state === 'running' || this.state === 'menu' || (this.state === 'countdown' && !frozen)) {
      this.stepper.advance(dt, (h) => {
        if (this.state === 'menu' && this.autopilot) this.autopilot.update(h);
        else {
          v.input.steer = ctrl.steer;
          v.input.throttle = ctrl.throttle;
          v.input.brake = ctrl.brake;
          v.holdBrakes = this.state === 'countdown';
          v.input.handbrake = ctrl.handbrake;
        }
        v.step(h);
        if (this.state === 'running') this.timer.update(h, v);
        this.world.skid.addFromVehicle(v);
      });
      if (this.state === 'menu' && this.autopilot && (v.telemetry.upsideDown || v.telemetry.offTrackWheels >= 4 && v.telemetry.speed < 2)) this.startDemo();
    } else {
      this.stepper.alpha = 1;
    }

    // --- grafika
    this._syncCar(this.stepper.alpha, dt);
    const cr = this.cameraRig;
    cr.shake = cr.mode !== 'chase' ? Math.min(0.012, v.telemetry.curbWheels * 0.004 + (v.telemetry.speed > 60 ? 0.0012 : 0)) : 0;
    cr.update(this._pos, this._quat, v.telemetry, dt, ctrl.steer);
    if (this.debugCamera) {
      // kamera diagnostyczna (zrzuty ekranu): pozycja wzgledem auta w ukladzie swiata
      const d = this.debugCamera;
      const yaw = Math.atan2(2 * (this._quat.x * this._quat.z + this._quat.w * this._quat.y), 1 - 2 * (this._quat.x ** 2 + this._quat.y ** 2)) + (d.angle || 0);
      this.camera.position.set(this._pos.x + Math.sin(yaw) * d.dist, this._pos.y + d.height, this._pos.z + Math.cos(yaw) * d.dist);
      this.camera.lookAt(this._pos.x, this._pos.y + (d.lookY || 0), this._pos.z);
      this.camera.fov = d.fov || 40;
      this.camera.updateProjectionMatrix();
    }
    this.world.sun.follow(this._pos);
    this.world.trackMesh.updateVisibility(this.camera.position, this.world.forest.viewDist + 600);
    this.world.forest.update(this.camera.position);
    this.world.particles.emitFromVehicle(v, dt, this.settings.smoke && this.state !== 'paused');
    this.world.particles.update(this.state === 'paused' ? 0 : dt);
    this.world.trackMesh.setStartLights(this._countdown && !this._countdown.done ? this._countdown.lit : 0);

    // --- HUD, dzwiek
    if (this.state !== 'menu') {
      this._gameplayChecks(dt);
      const delta = this.timer.delta(this.record?.trace || this.timer.bestTrace);
      this.hud.update({
        tel: v.telemetry, timer: this.timer, settings: this.settings, record: this.record, delta,
        maxRpm: GT_CAR.engine.limiterRpm + 200, redline: GT_CAR.engine.redlineRpm,
        camName: CAMERA_NAMES[cr.mode], fps: this.fps, countdown: this.state === 'countdown',
      });
      const heading = Math.atan2(2 * (this._quat.x * this._quat.z + this._quat.w * this._quat.y), 1 - 2 * (this._quat.x ** 2 + this._quat.y ** 2));
      this.hud.minimap.draw(this._pos, heading);
      if (this.state !== 'paused') this.audio.update(v, cr.mode === 'cockpit', dt);
      this._dashTimer -= dt;
      if (cr.mode === 'cockpit' && this._dashTimer <= 0) {
        this._dashTimer = 1 / 20;
        this.carModel.drawDash(v.telemetry, { delta, abs: this.settings.abs || 'OFF', tc: this.settings.tc || 'OFF' });
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  _syncCar(alpha, dt = 0) {
    const v = this.vehicle;
    this._pos ||= new THREE.Vector3();
    this._quat ||= new THREE.Quaternion();
    this._pos.lerpVectors(v.prevPos, v.pos, alpha);
    this._quat.slerpQuaternions(v.prevQuat, v.quat, alpha);
    this.carModel.update(v, this._pos, this._quat, dt);
  }

  _updateCountdown(dt, ctrl) {
    const c = this._countdown;
    c.t += dt;
    const lit = Math.max(0, Math.min(5, Math.floor((c.t - 0.8) / 0.7) + 1));
    if (lit !== c.lit && lit > 0) {
      c.lit = lit;
      this.audio.beep(false);
    }
    this.hud.lights(c.lit, false, true);
    if (c.t < 0.8) this.hud.message(this.mode === 'timeattack' ? 'TIME ATTACK' : 'TRENING', this.mode === 'timeattack' ? 'Start lotny – pomiar od linii mety' : 'Start zatrzymany – pomiar od linii mety', 0);
    else this.hud.clearMessage();
    if (c.t >= c.goAt) {
      c.done = true;
      this.state = 'running';
      this.vehicle.holdBrakes = false;
      this.audio.beep(true);
      this.hud.lights(0, true, true);
      this.hud.message('START!', '', 900, '#7dffb0');
      setTimeout(() => this.hud.lights(0, false, false), 900);
      if (this.mode === 'timeattack') {
        // auto bylo zamrozone - wypuszczamy z predkoscia startu lotnego
        this.stepper.reset();
      }
      void ctrl;
    }
  }

  _gameplayChecks(dt) {
    if (this.state !== 'running') { this.hud.hint(''); return; }
    const v = this.vehicle;
    const tel = v.telemetry;
    const t = this.track;
    // zly kierunek
    const i = v.trackIndex;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(v.quat);
    const dot = fwd.x * t.tx[i] + fwd.z * t.tz[i];
    const vdot = v.vel.x * t.tx[i] + v.vel.z * t.tz[i];
    this._wrongWay = dot < -0.3 && vdot < -4 ? this._wrongWay + dt : 0;
    // utkniecie / dach
    const stuck = tel.upsideDown || (tel.speed < 1 && tel.offTrackWheels >= 3);
    this._offTimer = stuck ? this._offTimer + dt : 0;
    if (this._wrongWay > 1.0) this.hud.hint('⚠ ZŁY KIERUNEK');
    else if (this._offTimer > 2.5) this.hud.hint('Naciśnij R (lub View na padzie), aby wrócić na tor');
    else this.hud.hint('');
  }
}
