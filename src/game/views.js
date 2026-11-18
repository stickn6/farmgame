// Keeps the 3D scene in sync with the game model.
import * as THREE from 'three';
import { MAP_SIZE, OBJECTS, ANIMALS, PROJECTS } from './config.js';
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

  // Trees show their life stage; everything else uses its type (or a model alias from config)
  modelKey(o) {
    const def = OBJECTS[o.type];
    if (o.type === 'farmhouse') {
      const st = this.game.s.projects?.master?.stage || 0;
      return st ? `masterhouse:${st}` : 'farmhouse';
    }
    if (def.kind !== 'tree') return def.model || o.type;
    return `tree:${def.model}:${this.treeVisual(o)}`;
  }

  treeVisual(o) {
    const g = this.game;
    const st = g.treeState(o);
    if (st === 'dead') return 'dead';
    if (st === 'ready') return 'fruit';
    if (st === 'fruiting') return 'grown';
    const def = OBJECTS[o.type];
    const p = (g.now() - o.plantedAt) / (def.growTime * 1000);
    return p < 0.4 ? 'sapling' : p < 1 ? 'young' : 'grown';
  }

  add(o, animate) {
    const key = this.modelKey(o);
    const obj = makeObject(key);
    obj.userData.objectId = o.id;
    if (OBJECTS[o.type].flat) obj.traverse((m) => { if (m.isMesh) m.castShadow = false; });
    this.scene.add(obj);
    const prev = this.map.get(o.id);
    if (prev) { this.scene.remove(prev.obj); obj.visible = prev.obj.visible; }
    const e = { obj, o, key, pop: animate ? 0 : 1, smokeTimer: 0 };
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
    const now = this.game.now();
    this.checkTimer = (this.checkTimer || 0) - dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 0.5;
      for (const e of [...this.map.values()]) {
        if ((OBJECTS[e.o.type].kind === 'tree' || e.o.type === 'farmhouse') && this.modelKey(e.o) !== e.key) this.add(e.o, true);
      }
    }
    for (const e of this.map.values()) {
      if (OBJECTS[e.o.type].kind === 'tree' && e.key.endsWith(':fruit')) {
        e.obj.rotation.z = Math.sin(this.time * 1.8 + e.o.id) * 0.02;
      }
      if (e.pop < 1) {
        e.pop = Math.min(1, e.pop + dt * 1.4);
        e.obj.scale.setScalar(popCurve(e.pop));
      }
      // generic animated parts: models name children 'blades'/'spinZ', 'spinY' or 'bob'
      if (e.anim === undefined) {
        e.anim = [];
        e.obj.traverse((c) => { if (['blades', 'spinZ', 'spinY', 'bob'].includes(c.name)) e.anim.push({ c, y: c.position.y }); });
      }
      for (const a of e.anim) {
        if (a.c.name === 'spinY') a.c.rotation.y += dt * 1.0;
        else if (a.c.name === 'bob') a.c.position.y = a.y + Math.sin(this.time * 1.2 + e.o.id) * 0.15;
        else a.c.rotation.z += dt * 1.2;
      }
      // chimney smoke while a factory is working (or always from the farmhouse)
      const def = OBJECTS[e.o.type];
      const working = def.kind === 'factory' && e.o.jobs.some((j) => j.endAt > now);
      if ((working || e.o.type === 'farmhouse') && e.obj.visible) {
        e.smokeTimer -= dt;
        if (e.smokeTimer <= 0) {
          e.smokeTimer = working ? 0.45 : 1.2;
          const c = def.chimney || (e.o.type === 'farmhouse' ? [0.65, 2.85, -0.4] : [0, 2.4, -0.1]);
          const chimney = new THREE.Vector3(c[0], c[1], c[2]);
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
const speedOf = (type) => ANIMALS[type]?.speed || SPEED[type] || 0.5;

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
    const rects = OBJECTS[home.type].yard || YARDS[home.type] || [[-1, 1, -1, 1]];
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
    const sc = ANIMALS[a.type]?.scale || (a.type === 'cow' ? 0.82 : 1);
    obj.scale.setScalar(sc);
    obj.userData.baseScale = sc;
    this.scene.add(obj);
    this.map.set(a.id, { obj, a, target: null, wait: Math.random() * 2, phase: Math.random() * 10, drop: animate ? 0 : 1, peck: 0 });
  }

  meshes() { return [...this.map.values()].filter((e) => e.obj.visible).map((e) => e.obj); }

  setHomeHidden(homeId, hidden) {
    for (const e of this.map.values()) if (e.a.home === homeId) e.obj.visible = !hidden;
  }

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
      if (ANIMALS[a.type]?.flying) {
        // bees: buzz around their hive in loops
        e.phase += dt;
        const c = objectCenter(this.game, home);
        const r = 0.6 + Math.sin(e.phase * 0.7 + a.id) * 0.4;
        obj.position.set(c.x + Math.cos(e.phase * 1.7 + a.id) * r, 0.9 + Math.sin(e.phase * 3 + a.id) * 0.25, c.z + Math.sin(e.phase * 1.7 + a.id) * r);
        obj.rotation.y = -e.phase * 1.7 - a.id;
        continue;
      }
      const speed = speedOf(a.type);
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

// ------------------------------------------------------------------ visitors (townsfolk who walk in from the road)
export class VisitorView {
  constructor(scene, game, roadZ) {
    this.scene = scene;
    this.game = game;
    this.roadZ = roadZ;
    this.map = new Map(); // visitor id -> entity
    this.leaving = [];
    this.time = 0;
    game.on('visitors', () => this.sync());
    game.on('land', () => this.sync());
    this.faceYaw = () => Math.PI / 4;
    this.sync(true);
  }

  // waiting spots along the front fence, spread around the middle
  spot(i) {
    const hi = this.game.landHi();
    const z = hi - MAP_SIZE / 2 + 1 + 0.9;
    const x = ((i % 2 ? 1 : -1) * Math.ceil(i / 2)) * 1.6 - 1;
    return new THREE.Vector3(x, 0, z);
  }

  sync(instant = false) {
    const list = this.game.s.visitors;
    const ids = new Set(list.map((v) => v.id));
    for (const [id, e] of this.map) {
      if (!ids.has(id)) {
        // walk away along the road
        e.target = new THREE.Vector3(e.obj.position.x + (e.obj.position.x > 0 ? 30 : -30), 0, this.roadZ - 1.15);
        e.via = new THREE.Vector3(e.obj.position.x, 0, this.roadZ - 1.15);
        e.leaving = true;
        this.leaving.push(e);
        this.map.delete(id);
      }
    }
    list.forEach((v, i) => {
      let e = this.map.get(v.id);
      if (!e) {
        const obj = makeObject('npc:' + v.npc);
        obj.userData.visitorId = v.id;
        const fromLeft = Math.random() < 0.5;
        const target = this.spot(i);
        if (instant) obj.position.copy(target);
        else obj.position.set(target.x + (fromLeft ? -22 : 22), 0, this.roadZ - 1.15);
        this.scene.add(obj);
        e = { obj, v, target, via: instant ? null : new THREE.Vector3(target.x, 0, this.roadZ - 1.15), phase: Math.random() * 6 };
        this.map.set(v.id, e);
      }
      e.target = this.spot(i);
    });
  }

  meshes() { return [...this.map.values()].map((e) => e.obj); }

  walk(e, dt, speed = 2.2) {
    const goal = e.via || e.target;
    tmpP.subVectors(goal, e.obj.position);
    tmpP.y = 0;
    const d = tmpP.length();
    if (d < 0.05) {
      if (e.via) { e.via = null; return false; }
      e.obj.position.y = 0;
      // turn to face the camera while waiting (shortest way round)
      let diff = this.faceYaw() - e.obj.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      e.obj.rotation.y += diff * Math.min(1, dt * 4);
      return true;
    }
    e.obj.position.addScaledVector(tmpP.normalize(), Math.min(d, speed * dt));
    const want = Math.atan2(tmpP.x, tmpP.z);
    let diff = want - e.obj.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    e.obj.rotation.y += diff * Math.min(1, dt * 10);
    e.obj.position.y = Math.abs(Math.sin(this.time * 10 + e.phase)) * 0.06;
    return false;
  }

  update(dt) {
    this.time += dt;
    for (const e of this.map.values()) {
      const arrived = this.walk(e, dt);
      if (arrived) {
        // idle sway while waiting
        e.obj.rotation.z = Math.sin(this.time * 2 + e.phase) * 0.04;
      }
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const e = this.leaving[i];
      if (this.walk(e, dt, 2.6)) { this.scene.remove(e.obj); this.leaving.splice(i, 1); }
    }
  }
}

// ------------------------------------------------------------------ market wagon on the road
export class WagonView {
  constructor(scene, game, roadZ) {
    this.game = game;
    this.group = new THREE.Group();
    this.wagon = makeObject('wagon');
    this.donkey = makeObject('donkey');
    this.donkey.position.set(1.25, 0, 0); // same spot as the "wagon:hitched" model (kept separate so it can trot)
    this.group.add(this.wagon, this.donkey);
    this.parkX = 7;
    this.group.position.set(game.s.wagon?.state === 'here' ? this.parkX : 80, 0, roadZ - 0.55);
    this.group.visible = game.s.level >= 14;
    scene.add(this.group);
    this.time = 0;
  }

  meshes() { return this.group.visible ? [this.group] : []; }

  update(dt) {
    this.time += dt;
    const w = this.game.s.wagon;
    const g = this.group;
    if (!w) { g.visible = false; return; }
    g.visible = true;
    if (w.state === 'away') this.leaving = true;
    // finish driving off before coming back in from the left (never reverse into the spot)
    const here = w.state === 'here' && !this.leaving;
    if (this.leaving && w.state === 'here' && g.position.x >= 79) { g.position.x = -60; this.leaving = false; }
    if (here && g.position.x > 60) g.position.x = -60; // arrive from the left
    const target = here ? this.parkX : 80;
    if (this.leaving && w.state === 'away' && !g.visible) this.leaving = false;
    const d = target - g.position.x;
    const moving = Math.abs(d) > 0.05;
    if (moving) g.position.x += Math.sign(d) * Math.min(Math.abs(d), (Math.abs(d) > 10 ? 9 : 3) * dt);
    if (!here && g.position.x >= 79) g.visible = false;
    // little trot while moving, idle sway while parked
    this.donkey.position.y = moving ? Math.abs(Math.sin(this.time * 12)) * 0.06 : 0;
    this.wagon.rotation.z = moving ? Math.sin(this.time * 10) * 0.01 : 0;
  }
}

// ------------------------------------------------------------------ village project sites around the farm
export const PROJECT_SITES = {
  bridge: { x: -MAP_SIZE / 2 - 3.6, z: 3, rot: Math.PI / 2 },
  bandstand: { x: 10, z: MAP_SIZE / 2 + 7.5, rot: Math.PI },
  greenhouse: { x: 4, z: -MAP_SIZE / 2 - 4.5, rot: 0 },
};

export class ProjectView {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.map = new Map();
    for (const id of Object.keys(PROJECT_SITES)) this.sync(id);
    game.on('project', ({ id }) => this.sync(id));
  }

  stage(id) { return this.game.s.projects?.[id]?.stage || 0; }

  sync(id) {
    const site = PROJECT_SITES[id];
    if (!site) return;
    const key = `project:${id}:${this.stage(id)}`;
    const cur = this.map.get(id);
    if (cur && cur.key === key) return;
    if (cur) this.scene.remove(cur.obj);
    const obj = makeObject(key);
    obj.position.set(site.x, 0, site.z);
    obj.rotation.y = site.rot;
    obj.userData.projectId = id;
    this.scene.add(obj);
    this.map.set(id, { obj, key, pop: cur ? 0 : 1 });
    if (cur) obj.scale.setScalar(0.01);
  }

  meshes() { return [...this.map.values()].map((e) => e.obj); }

  update(dt) {
    for (const e of this.map.values()) if (e.pop < 1) { e.pop = Math.min(1, e.pop + dt * 1.2); e.obj.scale.setScalar(popCurve(e.pop)); }
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

  show(modelKey, type = modelKey) {
    this.hide();
    this.type = type;
    this.obj = makeObject(modelKey, { shadow: false });
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
