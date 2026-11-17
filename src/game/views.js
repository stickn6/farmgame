// Keeps the 3D scene in sync with the game model.
import * as THREE from 'three';
import { MAP_SIZE, OBJECTS, ANIMALS } from './config.js';
import { getModel, instantiate, makeObject, MATS } from './assets.js';
import { tileToWorld } from './world.js';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// elastic "pop" curve 0→1 with overshoot
export const popCurve = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -9 * t) * Math.cos(t * 10));

export function objectCenter(game, o, out = new THREE.Vector3()) {
  const [w, d] = game.objSize(o.type, o.rot);
  tileToWorld(o.x, o.z, out);
  out.x += (w - 1) / 2;
  out.z += (d - 1) / 2;
  return out;
}

// ------------------------------------------------------------------ soil + crops
export class FarmView {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    const soilModel = getModel('soil');
    this.soilMesh = new THREE.InstancedMesh(soilModel.parts[0].geometry, MATS.vc, MAP_SIZE * MAP_SIZE);
    this.soilMesh.receiveShadow = true;
    this.soilMesh.castShadow = false;
    this.soilMesh.frustumCulled = false;
    scene.add(this.soilMesh);
    this.crops = new Map(); // key -> { obj, type, stage, pop, x, z }
    this.soilPop = new Map(); // key -> t
    this.checkTimer = 0;
    this.time = 0;
    this.rebuildSoil();
    for (const k of Object.keys(game.s.soil)) this.syncCrop(k);

    game.on('soil', ({ x, z, cleared }) => {
      const k = x + ',' + z;
      if (!cleared && !this.crops.has(k)) this.soilPop.set(k, 0);
      if (cleared) this.soilPop.delete(k);
      this.rebuildSoil();
      this.syncCrop(k, true);
    });
  }

  rebuildSoil() {
    let i = 0;
    for (const k of Object.keys(this.game.s.soil)) {
      const [x, z] = k.split(',').map(Number);
      tileToWorld(x, z, tmpP);
      let s = 1;
      if (this.soilPop.has(k)) s = Math.max(0.01, popCurve(this.soilPop.get(k)));
      tmpS.set(s, s, s);
      tmpM.compose(tmpP, tmpQ.identity(), tmpS);
      this.soilMesh.setMatrixAt(i++, tmpM);
    }
    this.soilMesh.count = i;
    this.soilMesh.instanceMatrix.needsUpdate = true;
  }

  syncCrop(k, animate = false) {
    const soil = this.game.s.soil[k];
    const cur = this.crops.get(k);
    const crop = soil && soil.crop;
    if (!crop) {
      if (cur) { this.scene.remove(cur.obj); this.crops.delete(k); }
      return;
    }
    const stage = this.game.cropStage(crop);
    if (cur && cur.type === crop.type && cur.stage === stage) return;
    if (cur) this.scene.remove(cur.obj);
    const [x, z] = k.split(',').map(Number);
    const variant = (x * 7 + z * 13) % 3;
    const obj = instantiate(getModel(`crop:${crop.type}:${stage}:${variant}`));
    tileToWorld(x, z, obj.position);
    obj.rotation.y = ((x * 3 + z * 5) % 4) * (Math.PI / 2);
    this.scene.add(obj);
    const entry = { obj, type: crop.type, stage, pop: animate || cur ? 0 : 1, x, z };
    if (entry.pop < 1) obj.scale.setScalar(0.01);
    this.crops.set(k, entry);
  }

  update(dt) {
    this.time += dt;
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 0.25;
      for (const k of this.crops.keys()) this.syncCrop(k, true);
    }
    for (const [k, e] of this.crops) {
      if (e.pop < 1) {
        e.pop = Math.min(1, e.pop + dt * 1.6);
        e.obj.scale.setScalar(popCurve(e.pop));
      }
      if (e.stage === 3) {
        const w = Math.sin(this.time * 2.2 + e.x * 0.7 + e.z * 0.5) * 0.06;
        e.obj.rotation.z = w;
        e.obj.rotation.x = w * 0.5;
      }
    }
    if (this.soilPop.size) {
      for (const [k, t] of this.soilPop) {
        const nt = t + dt * 1.8;
        if (nt >= 1) this.soilPop.delete(k); else this.soilPop.set(k, nt);
      }
      this.rebuildSoil();
    }
  }
}

// ------------------------------------------------------------------ objects (buildings + decor)
export class ObjectView {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.map = new Map();
    for (const o of game.s.objects) this.add(o, false);
    game.on('objectAdded', (o) => this.add(o, true));
    game.on('objectRemoved', (o) => this.remove(o.id));
    game.on('objectMoved', ({ o }) => this.place(o));
    this.smoke = [];
    this.time = 0;
  }

  add(o, animate) {
    const obj = makeObject(o.type);
    obj.userData.objectId = o.id;
    if (OBJECTS[o.type].flat) obj.traverse((m) => { if (m.isMesh) m.castShadow = false; });
    this.scene.add(obj);
    const e = { obj, o, pop: animate ? 0 : 1, smokeTimer: 0 };
    this.map.set(o.id, e);
    this.place(o);
    if (animate) obj.scale.setScalar(0.01);
  }

  place(o) {
    const e = this.map.get(o.id);
    if (!e) return;
    objectCenter(this.game, o, e.obj.position);
    e.obj.rotation.y = o.rot * (Math.PI / 2);
  }

  remove(id) {
    const e = this.map.get(id);
    if (!e) return;
    this.scene.remove(e.obj);
    this.map.delete(id);
  }

  setHidden(id, hidden) {
    const e = this.map.get(id);
    if (e) e.obj.visible = !hidden;
  }

  allMeshes() { return [...this.map.values()].map((e) => e.obj); }

  update(dt) {
    this.time += dt;
    const now = Date.now();
    for (const e of this.map.values()) {
      if (e.pop < 1) {
        e.pop = Math.min(1, e.pop + dt * 1.4);
        e.obj.scale.setScalar(popCurve(e.pop));
      }
      if (e.o.type === 'windmill') {
        const b = e.obj.getObjectByName('blades');
        if (b) b.rotation.z += dt * 1.2;
      }
      // chimney smoke while a factory is working (or always from the farmhouse)
      const def = OBJECTS[e.o.type];
      const working = def.kind === 'factory' && e.o.jobs.some((j) => j.endAt > now);
      if (working || e.o.type === 'farmhouse') {
        e.smokeTimer -= dt;
        if (e.smokeTimer <= 0) {
          e.smokeTimer = working ? 0.45 : 1.2;
          const chimney = e.o.type === 'farmhouse' ? new THREE.Vector3(0.65, 2.85, -0.4) : e.o.type === 'bakery' ? new THREE.Vector3(0.7, 2.5, -0.5) : new THREE.Vector3(0, 2.4, -0.1);
          chimney.applyAxisAngle(UP, e.obj.rotation.y).add(e.obj.position);
          this.puff(chimney);
        }
      }
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.life += dt;
      const t = s.life / 2.6;
      s.mesh.position.y += dt * 0.6;
      s.mesh.position.x += dt * 0.25;
      s.mesh.scale.setScalar(0.15 + t * 0.45);
      s.mesh.material.opacity = 0.6 * (1 - t);
      if (t >= 1) { this.scene.remove(s.mesh); s.mesh.material.dispose(); this.smoke.splice(i, 1); }
    }
  }

  puff(pos) {
    if (!this.smokeGeo) this.smokeGeo = new THREE.IcosahedronGeometry(1, 0);
    const m = new THREE.Mesh(this.smokeGeo, MATS.smoke.clone());
    m.position.copy(pos);
    m.scale.setScalar(0.15);
    this.scene.add(m);
    this.smoke.push({ mesh: m, life: 0 });
  }
}

// ------------------------------------------------------------------ animals
// Walkable rectangles inside each pen (local coords, unrotated): [minX, maxX, minZ, maxZ]
const YARDS = {
  coop: [[-1.5, 1.5, 0.05, 1.5], [0.0, 1.5, -1.0, 0.05]],
  cowbarn: [[-1.9, 0.3, 0.7, 1.9], [0.7, 1.9, -1.1, 0.9]],
  sheepfold: [[-2.0, 2.0, -0.3, 1.2], [-0.9, 0.1, -2.0, -0.3]],
};
const SPEED = { chicken: 0.8, cow: 0.45, sheep: 0.5, dog: 1.6 };

export class AnimalView {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.map = new Map();
    for (const a of game.s.animals) this.add(a, false);
    game.on('animalAdded', (a) => this.add(a, true));
    game.on('objectMoved', ({ o }) => {
      for (const a of game.animalsIn(o.id)) {
        const e = this.map.get(a.id);
        if (e) { e.obj.position.copy(this.randomPoint(o)); e.target = null; }
      }
    });
    this.time = 0;
  }

  randomPoint(home, out = new THREE.Vector3()) {
    const rects = YARDS[home.type];
    const r = rects[Math.floor(Math.random() * rects.length)];
    out.set(r[0] + Math.random() * (r[1] - r[0]), 0, r[2] + Math.random() * (r[3] - r[2]));
    out.applyAxisAngle(UP, home.rot * (Math.PI / 2));
    return out.add(objectCenter(this.game, home));
  }

  add(a, animate) {
    const home = this.game.objById.get(a.home);
    if (!home) return;
    const variant = a.type === 'chicken' ? ':' + (a.id % 3 === 0 ? 1 : 0) : '';
    const obj = makeObject(a.type + variant);
    obj.userData.animalId = a.id;
    obj.position.copy(this.randomPoint(home));
    if (animate) obj.position.y = 3;
    obj.rotation.y = Math.random() * Math.PI * 2;
    if (a.type === 'cow') obj.scale.setScalar(0.82);
    this.scene.add(obj);
    this.map.set(a.id, { obj, a, target: null, wait: Math.random() * 2, phase: Math.random() * 10, drop: animate ? 0 : 1, peck: 0 });
  }

  meshes() { return [...this.map.values()].map((e) => e.obj); }

  update(dt) {
    this.time += dt;
    for (const e of this.map.values()) {
      const { obj, a } = e;
      const home = this.game.objById.get(a.home);
      if (!home) continue;
      if (e.drop < 1) {
        e.drop = Math.min(1, e.drop + dt * 1.5);
        obj.position.y = 3 * (1 - popCurve(e.drop));
        continue;
      }
      const speed = SPEED[a.type] || 0.5;
      if (!e.target) {
        e.wait -= dt;
        // idle animation
        if (a.type === 'chicken') {
          e.peck += dt;
          obj.rotation.x = Math.max(0, Math.sin(e.peck * 6)) * 0.5 * (Math.sin(e.peck * 0.7) > 0 ? 1 : 0);
        } else {
          obj.rotation.x = 0;
          obj.position.y = Math.max(0, Math.sin(this.time * 2 + e.phase)) * 0.01;
        }
        if (e.wait <= 0) {
          e.target = this.randomPoint(home);
          obj.rotation.x = 0;
        }
      } else {
        tmpP.subVectors(e.target, obj.position);
        tmpP.y = 0;
        const d = tmpP.length();
        if (d < 0.05) {
          e.target = null;
          e.wait = 1.5 + Math.random() * 4;
        } else {
          const step = Math.min(d, speed * dt);
          obj.position.addScaledVector(tmpP.normalize(), step);
          const want = Math.atan2(tmpP.x, tmpP.z);
          let diff = want - obj.rotation.y;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          obj.rotation.y += diff * Math.min(1, dt * 8);
          const hop = a.type === 'chicken' ? 0.06 : 0.025;
          obj.position.y = Math.abs(Math.sin(this.time * (a.type === 'chicken' ? 14 : 8) + e.phase)) * hop;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ farm dog that follows the player's taps
export class DogView {
  constructor(scene, game) {
    this.game = game;
    this.obj = makeObject('dog');
    const house = game.s.objects.find((o) => o.type === 'farmhouse');
    const p = house ? objectCenter(game, house) : new THREE.Vector3();
    this.obj.position.set(p.x + 2, 0, p.z + 1.6);
    scene.add(this.obj);
    this.target = null;
    this.wait = 2;
    this.time = 0;
  }

  goTo(p) {
    this.target = p.clone();
    this.target.x += (Math.random() - 0.5) * 1.2;
    this.target.z += 0.9;
    this.wait = 3;
  }

  update(dt) {
    this.time += dt;
    const o = this.obj;
    if (!this.target) {
      this.wait -= dt;
      o.position.y = 0;
      if (this.wait <= 0) {
        const lo = this.game.landLo(), hi = this.game.landHi();
        const p = tileToWorld(lo + Math.random() * (hi - lo), lo + Math.random() * (hi - lo));
        this.target = p;
        this.wait = 3 + Math.random() * 6;
      }
      return;
    }
    tmpP.subVectors(this.target, o.position);
    tmpP.y = 0;
    const d = tmpP.length();
    if (d < 0.1) { this.target = null; return; }
    const speed = d > 3 ? 3.2 : 1.6;
    o.position.addScaledVector(tmpP.normalize(), Math.min(d, speed * dt));
    const want = Math.atan2(tmpP.x, tmpP.z);
    let diff = want - o.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    o.rotation.y += diff * Math.min(1, dt * 8);
    o.position.y = Math.abs(Math.sin(this.time * 16)) * 0.05;
  }
}

// ------------------------------------------------------------------ placement ghost
export class Ghost {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.obj = null;
    this.pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#4cff6a', transparent: true, opacity: 0.4, depthWrite: false }));
    this.pad.rotation.x = -Math.PI / 2;
    this.pad.position.y = 0.04;
    this.pad.visible = false;
    scene.add(this.pad);
  }

  show(type) {
    this.hide();
    this.type = type;
    this.obj = makeObject(type, { shadow: false });
    this.obj.traverse((m) => {
      if (m.isMesh) {
        m.material = m.material.clone();
        m.material.transparent = true;
        m.material.opacity = 0.8;
      }
    });
    this.scene.add(this.obj);
    this.pad.visible = true;
  }

  update(x, z, rot, valid) {
    if (!this.obj) return;
    const fake = { type: this.type, x, z, rot };
    objectCenter(this.game, fake, this.obj.position);
    this.obj.position.y = 0.05 + Math.sin(performance.now() / 200) * 0.04;
    this.obj.rotation.y = rot * (Math.PI / 2);
    const [w, d] = this.game.objSize(this.type, rot);
    this.pad.scale.set(w, d, 1);
    this.pad.position.set(this.obj.position.x, 0.04, this.obj.position.z);
    this.pad.material.color.set(valid ? '#4cff6a' : '#ff4c4c');
  }

  hide() {
    if (this.obj) {
      this.scene.remove(this.obj);
      this.obj.traverse((m) => m.isMesh && m.material.dispose());
    }
    this.obj = null;
    this.pad.visible = false;
  }
}

// ------------------------------------------------------------------ tile cursor
export class TileCursor {
  constructor(scene) {
    const geo = new THREE.RingGeometry(0.5, 0.56, 4, 1);
    geo.rotateZ(Math.PI / 4);
    geo.scale(1.25, 1.25, 1);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.16;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  set(x, z, color = '#ffffff') {
    tileToWorld(x, z, this.mesh.position);
    this.mesh.position.y = 0.16;
    this.mesh.material.color.set(color);
    this.mesh.visible = true;
  }
  hide() { this.mesh.visible = false; }
}

export { ANIMALS };
