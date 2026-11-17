// Scene, renderer, camera rig, lighting, day/night and the static environment.
import * as THREE from 'three';
import { MAP_SIZE } from './config.js';
import { makeObject, getModel, instantiate, bake, hashRand, MATS } from './assets.js';

const HALF = MAP_SIZE / 2;
export const tileToWorld = (x, z, out = new THREE.Vector3()) => out.set(x - HALF + 0.5, 0, z - HALF + 0.5);
export const worldToTile = (p) => ({ x: Math.floor(p.x + HALF), z: Math.floor(p.z + HALF) });

// ------------------------------------------------------------------ camera rig
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(-2, 0, -2);
    this.yaw = Math.PI / 4;
    this.pitch = 0.92;
    this.dist = 20;
    this.goal = { yaw: this.yaw, dist: this.dist, target: null };
    this.velocity = new THREE.Vector3();
    this.minDist = 7;
    this.maxDist = 42;
    this.apply();
  }

  clampTarget() {
    const lim = HALF + 2;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -lim, lim);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -lim, lim);
  }

  zoomBy(factor) { this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * factor, this.minDist, this.maxDist); }
  setDist(d) { this.goal.dist = this.dist = THREE.MathUtils.clamp(d, this.minDist, this.maxDist); this.apply(); }
  rotateBy(a) { this.goal.yaw += a; }
  focus(p) { this.goal.target = p.clone(); }

  update(dt) {
    const k = 1 - Math.pow(0.0005, dt);
    this.yaw += (this.goal.yaw - this.yaw) * k;
    this.dist += (this.goal.dist - this.dist) * k;
    if (this.goal.target) {
      this.target.lerp(this.goal.target, k * 0.8);
      if (this.target.distanceTo(this.goal.target) < 0.02) this.goal.target = null;
    }
    if (this.velocity.lengthSq() > 1e-5) {
      this.target.addScaledVector(this.velocity, dt);
      this.velocity.multiplyScalar(Math.pow(0.02, dt));
    }
    this.apply();
  }

  apply() {
    this.clampTarget();
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target);
  }
}

// ------------------------------------------------------------------ world
export class World {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#9fd8ff');
    this.scene.fog = new THREE.Fog('#9fd8ff', 50, 120);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 300);
    this.rig = new CameraRig(this.camera);

    this.setupLights();
    this.setupGround();
    this.setupEnvironment();

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.time = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the farm framed nicely in portrait (phones)
    this.camera.fov = w < h ? 50 : 38;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- lights & sky
  setupLights() {
    this.hemi = new THREE.HemisphereLight('#dff1ff', '#5f8a45', 1.1);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#fff3dd', 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    this.daylight = 1;
  }

  // t in [0,1): 0 = sunrise. Most of the cycle is daytime.
  updateDayCycle(t) {
    // day: 0 → 0.68, dusk 0.68 → 0.76, night 0.76 → 0.94, dawn 0.94 → 1
    let daylight;
    if (t < 0.68) daylight = 1;
    else if (t < 0.76) daylight = 1 - (t - 0.68) / 0.08;
    else if (t < 0.94) daylight = 0;
    else daylight = (t - 0.94) / 0.06;
    daylight = THREE.MathUtils.smoothstep(daylight, 0, 1);
    this.daylight = daylight;
    this.dayT = t;

    const sunT = Math.min(1, t / 0.76); // sun arc during day
    const ang = THREE.MathUtils.lerp(0.25, Math.PI - 0.25, sunT);
    const tgt = this.rig.target;
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.sin(ang) * 0.9 + 0.35, 0.55).normalize();
    this.sun.position.copy(tgt).addScaledVector(sunDir, 40);
    this.sun.target.position.copy(tgt);

    const dusk = Math.max(0, 1 - Math.abs(t - 0.72) / 0.06) + Math.max(0, 1 - Math.abs(t - 0.97) / 0.04) * 0.6;
    const day = new THREE.Color('#9fd8ff');
    const duskC = new THREE.Color('#f7a46b');
    const night = new THREE.Color('#2b3d6e');
    const sky = night.clone().lerp(day, daylight).lerp(duskC, Math.min(0.7, dusk * 0.7));
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);

    this.sun.intensity = 0.7 + 1.5 * daylight;
    this.sun.color.set('#9fb4ff').lerp(new THREE.Color('#fff3dd'), daylight).lerp(new THREE.Color('#ffb07a'), Math.min(0.6, dusk));
    this.hemi.intensity = 0.85 + 0.25 * daylight;
    this.hemi.color.set('#7f95d6').lerp(new THREE.Color('#dff1ff'), daylight);
    MATS.glow.emissiveIntensity = (1 - daylight) * 1.4 + 0.05;
  }

  // ---------------------------------------------------------------- ground
  setupGround() {
    const big = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#69a947', roughness: 1 }));
    big.rotation.x = -Math.PI / 2;
    big.position.y = -0.02;
    big.receiveShadow = true;
    this.scene.add(big);

    this.groundCanvas = document.createElement('canvas');
    this.groundCanvas.width = this.groundCanvas.height = MAP_SIZE * 32;
    this.groundTex = new THREE.CanvasTexture(this.groundCanvas);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.anisotropy = 4;
    const farm = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
      new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 1 }),
    );
    farm.rotation.x = -Math.PI / 2;
    farm.receiveShadow = true;
    this.scene.add(farm);
    this.farmGround = farm;
  }

  drawGround(landLo, landHi) {
    const ctx = this.groundCanvas.getContext('2d');
    const T = 32;
    const r = hashRand(99);
    for (let x = 0; x < MAP_SIZE; x++) {
      for (let z = 0; z < MAP_SIZE; z++) {
        const inLand = x >= landLo && x <= landHi && z >= landLo && z <= landHi;
        const even = (x + z) % 2 === 0;
        ctx.fillStyle = inLand ? (even ? '#7fca59' : '#78c353') : (even ? '#6aaa48' : '#67a646');
        ctx.fillRect(x * T, z * T, T, T);
        // speckles for texture
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = inLand ? (r() > 0.5 ? '#8ad463' : '#6fb94c') : (r() > 0.5 ? '#5f9a40' : '#75b452');
          ctx.fillRect(x * T + r() * (T - 3), z * T + r() * (T - 3), 3, 2);
        }
      }
    }
    this.groundTex.needsUpdate = true;
    this.buildLandBorder(landLo, landHi);
    this.buildWilds(landLo, landHi);
  }

  buildLandBorder(lo, hi) {
    if (this.border) { this.scene.remove(this.border); this.border.traverse((o) => o.geometry && o.geometry.dispose()); }
    const gr = new THREE.Group();
    const fence = getModel('fence');
    const p = new THREE.Vector3();
    for (let i = lo; i <= hi; i++) {
      for (const [x, z, ry] of [[i + 0.5, lo, 0], [i + 0.5, hi + 1, 0], [lo, i + 0.5, Math.PI / 2], [hi + 1, i + 0.5, Math.PI / 2]]) {
        const f = instantiate(fence);
        f.position.set(x - HALF, 0, z - HALF);
        f.rotation.y = ry;
        gr.add(f);
      }
    }
    // corner posts
    p.set(0, 0, 0);
    this.border = instantiate(bake(gr));
    this.scene.add(this.border);
  }

  // Trees, rocks and grass on the locked part of the map (cleared as land expands)
  buildWilds(lo, hi) {
    if (this.wilds) { this.scene.remove(this.wilds); this.wilds.traverse((o) => o.geometry && o.geometry.dispose()); }
    const gr = new THREE.Group();
    for (let x = 0; x < MAP_SIZE; x++) {
      for (let z = 0; z < MAP_SIZE; z++) {
        if (x >= lo - 1 && x <= hi + 1 && z >= lo - 1 && z <= hi + 1) continue;
        const r = hashRand(x * 131 + z * 7919);
        const v = r();
        let key = null;
        if (v < 0.13) key = 'oak:' + Math.floor(r() * 5);
        else if (v < 0.22) key = 'pine:' + Math.floor(r() * 5);
        else if (v < 0.27) key = 'rock:' + Math.floor(r() * 4);
        else if (v < 0.45) key = 'tallgrass:' + Math.floor(r() * 4);
        else if (v < 0.5) key = 'bush';
        if (!key) continue;
        const o = makeObject(key);
        o.position.set(x - HALF + 0.5 + (r() - 0.5) * 0.4, 0, z - HALF + 0.5 + (r() - 0.5) * 0.4);
        o.rotation.y = r() * Math.PI * 2;
        gr.add(o);
      }
    }
    this.wilds = instantiate(bake(gr));
    this.scene.add(this.wilds);
  }

  // ---------------------------------------------------------------- environment beyond the map
  setupEnvironment() {
    const gr = new THREE.Group();
    const pond = { x: -HALF - 7, z: 3, r: 4.2 };
    const road = { z: HALF + 3.5 };
    const r = hashRand(2024);
    for (let i = 0; i < 520; i++) {
      const x = (r() - 0.5) * 120, z = (r() - 0.5) * 120;
      if (Math.abs(x) < HALF + 1 && Math.abs(z) < HALF + 1) continue;
      if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 1.5) continue;
      if (Math.abs(z - road.z) < 2.2) continue;
      const v = r();
      const key = v < 0.45 ? 'pine:' + Math.floor(r() * 5) : v < 0.85 ? 'oak:' + Math.floor(r() * 5) : 'rock:' + Math.floor(r() * 4);
      const o = makeObject(key);
      const s = 1 + r() * 0.9;
      o.scale.setScalar(s);
      o.position.set(x, 0, z);
      o.rotation.y = r() * 6.28;
      gr.add(o);
    }
    // reeds around pond
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r();
      const o = makeObject('reeds');
      o.position.set(pond.x + Math.cos(a) * (pond.r - 0.2), 0, pond.z + Math.sin(a) * (pond.r * 0.8 - 0.2));
      gr.add(o);
    }
    const forest = instantiate(bake(gr));
    forest.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this.scene.add(forest);

    // pond
    const shore = new THREE.Mesh(new THREE.CircleGeometry(pond.r + 0.5, 24), new THREE.MeshStandardMaterial({ color: '#d8c48f', roughness: 1 }));
    shore.rotation.x = -Math.PI / 2;
    shore.scale.set(1, 0.8, 1);
    shore.position.set(pond.x, 0.005, pond.z);
    shore.receiveShadow = true;
    const water = new THREE.Mesh(new THREE.CircleGeometry(pond.r, 24), MATS.water);
    water.rotation.x = -Math.PI / 2;
    water.scale.set(1, 0.8, 1);
    water.position.set(pond.x, 0.03, pond.z);
    this.water = water;
    this.scene.add(shore, water);
    // lily pads
    for (let i = 0; i < 5; i++) {
      const pad = new THREE.Mesh(new THREE.CircleGeometry(0.3, 8), new THREE.MeshStandardMaterial({ color: '#4f9a3a', roughness: 0.9 }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(pond.x + (r() - 0.5) * 4, 0.04, pond.z + (r() - 0.5) * 3);
      this.scene.add(pad);
    }

    // road + truck
    const roadMesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 2.6), new THREE.MeshStandardMaterial({ color: '#c9b083', roughness: 1 }));
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.set(0, 0.01, road.z);
    roadMesh.receiveShadow = true;
    this.scene.add(roadMesh);
    const dashes = new THREE.Group();
    for (let x = -100; x < 100; x += 2.5) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.12), new THREE.MeshStandardMaterial({ color: '#efe3c0' }));
      d.rotation.x = -Math.PI / 2;
      d.position.set(x, 0.015, road.z);
      dashes.add(d);
    }
    this.scene.add(instantiate(bake(dashes), { shadow: false }));
    this.truck = makeObject('truck');
    this.truck.position.set(-6, 0, road.z + 0.6);
    this.scene.add(this.truck);
    this.truckState = { x: -6, goal: -6, speed: 0, home: -6 };
    this.roadZ = road.z;

    // clouds
    this.clouds = [];
    for (let i = 0; i < 9; i++) {
      const c = makeObject('cloud:' + i, { shadow: false, receive: false });
      c.position.set((r() - 0.5) * 120, 16 + r() * 6, (r() - 0.5) * 90 - 10);
      c.scale.setScalar(1 + r());
      c.userData.speed = 0.6 + r() * 0.8;
      this.scene.add(c);
      this.clouds.push(c);
    }
  }

  sendTruck() {
    // drive off to the right, then come back from the left
    this.truckState.mode = 'leave';
  }

  updateEnvironment(dt) {
    this.time += dt;
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 70) c.position.x = -70;
    }
    if (this.water) this.water.material.color.setHSL(0.56, 0.6, 0.55 + Math.sin(this.time * 0.8) * 0.02);
    const ts = this.truckState;
    if (ts.mode === 'leave') {
      ts.speed = Math.min(ts.speed + dt * 6, 12);
      ts.x += ts.speed * dt;
      if (ts.x > 60) { ts.x = -60; ts.mode = 'return'; }
    } else if (ts.mode === 'return') {
      const d = ts.home - ts.x;
      ts.speed = Math.max(1.5, Math.min(12, d * 1.2));
      ts.x += ts.speed * dt;
      if (ts.x >= ts.home) { ts.x = ts.home; ts.mode = null; ts.speed = 0; }
    }
    this.truck.position.x = ts.x;
    this.truck.position.y = ts.mode ? Math.abs(Math.sin(this.time * 18)) * 0.03 : 0;
  }

  // ---------------------------------------------------------------- picking
  groundPoint(clientX, clientY, out = new THREE.Vector3()) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, out);
  }

  pick(clientX, clientY, objects) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(objects, true);
  }

  project(v, out = new THREE.Vector3()) {
    out.copy(v).project(this.camera);
    return { x: (out.x * 0.5 + 0.5) * window.innerWidth, y: (-out.y * 0.5 + 0.5) * window.innerHeight, visible: out.z < 1 };
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
