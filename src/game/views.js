// Keeps the 3D scene in sync with the game model.
import * as THREE from 'three';
import { MAP_SIZE, OBJECTS, ANIMALS, PROJECTS, GOLD } from './config.js';
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

// World-space corners of an object's footprint ({ type, x, z, rot }) on the ground,
// plus the same 4 at height h when h > 0 (so framing keeps the roof in view).
export function objectCorners(game, o, h = 0) {
  const [w, d] = game.objSize(o.type, o.rot || 0);
  const x0 = o.x - MAP_SIZE / 2, z0 = o.z - MAP_SIZE / 2;
  const pts = [];
  for (const y of h > 0 ? [0, h] : [0]) {
    for (const [dx, dz] of [[0, 0], [w, 0], [w, d], [0, d]]) pts.push(new THREE.Vector3(x0 + dx, y, z0 + dz));
  }
  return pts;
}

// Height of a baked model (top of its bounding box)
export function modelHeight(key) {
  let h = 0;
  for (const p of getModel(key).parts) h = Math.max(h, p.geometry.boundingBox?.max.y ?? 0);
  return h;
}

const defOf = (o) => OBJECTS[o.type] || {};

// Recoloured decorations (def.tint: a colour, or 'gold' = GOLD with its metal look): each material is cloned once
// per colour; the vertex colours multiply with it. Glowing (lamp glass) and glass parts keep their own look.
// The one tint path of the game: album exclusives, the golden parcel decor and (o.gilded) gilding all use it.
// desat (def.tintDesat, GOLD.desat): how far the model's own colours fade to grey first, so a recolour can
// really change them (a gold rooster turned silver, a rainbow balloon turned sky blue).
const tintCache = new Map();
export function tintOf(type) {
  const d = OBJECTS[type];
  const t = d?.tint;
  return t === 'gold' ? GOLD : t ? { color: t, desat: d.tintDesat || 0, metalness: d.tintMetal, roughness: d.tintRough } : null;
}
// the vertex colours fade toward their own (slightly lifted) brightness by `desat` before the tint multiplies them,
// so dark leaves or a gold statue take a light recolour (frost, blossom, silver) instead of turning muddy
function desaturate(mat, desat, lift = 0.35 * desat) {
  const k = Math.round(desat * 100) / 100;
  lift = (Math.round(lift * 100) / 100).toFixed(2);
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
      float tintL = mix( dot( vColor.rgb, vec3( 0.299, 0.587, 0.114 ) ), 1.0, ${lift} );
      diffuseColor *= vec4( mix( vColor.rgb, vec3( tintL ), ${k.toFixed(2)} ), vColor.a );
    #endif`);
  };
  mat.customProgramCacheKey = () => `desat${k}|${lift}`;
}
// a copy of a (maybe tinted) material that keeps its shader tweak (Material.clone drops onBeforeCompile)
export function cloneMaterial(m) {
  const c = m.clone();
  if (m.userData.desat) desaturate(c, m.userData.desat, m.userData.lift);
  return c;
}
// a placed object's tint: gilded → gold, else its type's recolour (or none)
export function tintFor(o) {
  return o?.gilded ? GOLD : tintOf(o?.type);
}
// compares tints (a re-add is needed when it changes, e.g. on gilding)
const tintKey = (t) => (t ? `${t.color}|${t.metalness ?? ''}|${t.desat || 0}` : '');
export function applyTint(obj, tint) {
  if (!tint) return obj;
  obj.traverse((m) => {
    if (!m.isMesh || !m.material || m.material === MATS.glow || m.material === MATS.glass) return;
    const k = `${m.material.uuid}|${tint.color}|${tint.metalness ?? ''}|${tint.roughness ?? ''}|${tint.desat || 0}|${tint.lift ?? ''}`;
    let mat = tintCache.get(k);
    if (!mat) {
      mat = m.material.clone();
      mat.color = new THREE.Color(tint.color);
      if (tint.metalness != null) mat.metalness = tint.metalness;
      if (tint.roughness != null) mat.roughness = tint.roughness;
      if (tint.desat > 0 && mat.vertexColors) {
        const lift = tint.lift ?? 0.35 * tint.desat;
        mat.userData = { ...mat.userData, desat: tint.desat, lift };
        desaturate(mat, tint.desat, lift);
      }
      tintCache.set(k, mat);
    }
    m.material = mat;
  });
  return obj;
}
// debris (weeds, stones, stumps) gets a per-tile model variant and a natural-looking yaw
const tileHash = (x, z) => (((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000 / 1000;

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
    this.markers = new TileMarkers(scene); // guide's ghost plots: farm.markers.show([[x, z], …]) / .clear()
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
    this.markers.update(dt);
  }
}

// ------------------------------------------------------------------ objects (buildings, decor, trees, debris)
export class ObjectView {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.map = new Map();
    for (const o of game.s.objects) this.add(o, false);
    game.on('objectAdded', (o) => this.add(o, true));
    game.on('objectRemoved', (o) => this.remove(o.id));
    game.on('objectMoved', ({ o }) => this.place(o));
    // a changed look (e.g. gilding): re-add it when its model or tint differs, with a little bounce
    game.on('objectChanged', (o) => {
      const e = this.map.get(o.id);
      if (!e || (e.key === this.modelKey(o) && e.tint === tintKey(tintFor(o)))) return;
      this.add(o, false);
      const n = this.map.get(o.id);
      if (n) n.pop = 0.55;
    });
    this.smoke = [];
    this.dying = []; // removed objects shrinking away
    this.time = 0;
  }

  // Trees show their life stage; debris picks a variant per tile; everything else uses its type (or a model alias)
  modelKey(o) {
    const def = defOf(o);
    if (o.type === 'farmhouse') {
      const st = this.game.s.projects?.master?.stage || 0;
      return st ? `masterhouse:${st}` : 'farmhouse';
    }
    if (def.kind === 'debris') return `${def.model || o.type}:${Math.floor(tileHash(o.x, o.z) * 3)}`;
    // the Mailbox's flag is up while a parcel waits
    if (o.type === 'mailbox') return `mailbox:${this.game.postStatus().ready ? 'up' : 'down'}`;
    if (def.kind !== 'tree') return def.model || o.type;
    return `tree:${def.model}:${this.treeVisual(o)}`;
  }

  treeVisual(o) {
    const g = this.game;
    const st = g.treeState(o);
    if (st === 'dead') return 'dead';
    if (st === 'ready') return 'fruit';
    if (st === 'fruiting') return 'grown';
    const def = defOf(o);
    const p = (g.now() - o.plantedAt) / (def.growTime * 1000);
    return p < 0.4 ? 'sapling' : p < 1 ? 'young' : 'grown';
  }

  add(o, animate) {
    const key = this.modelKey(o);
    const tint = tintFor(o);
    const obj = applyTint(makeObject(key), tint);
    obj.userData.objectId = o.id;
    if (defOf(o).flat) obj.traverse((m) => { if (m.isMesh) m.castShadow = false; });
    this.scene.add(obj);
    const prev = this.map.get(o.id);
    if (prev) { this.scene.remove(prev.obj); obj.visible = prev.obj.visible; }
    const e = { obj, o, key, tint: tintKey(tint), pop: animate ? 0 : 1, smokeTimer: 0 };
    this.map.set(o.id, e);
    this.place(o);
    if (animate) obj.scale.setScalar(0.01);
  }

  place(o) {
    const e = this.map.get(o.id);
    if (!e) return;
    objectCenter(this.game, o, e.obj.position);
    e.obj.rotation.y = defOf(o).kind === 'debris' ? tileHash(o.z, o.x) * Math.PI * 2 : (o.rot || 0) * (Math.PI / 2);
  }

  // Removed objects (decor, trees, cleared debris) shrink away quickly instead of vanishing
  remove(id) {
    const e = this.map.get(id);
    if (!e) return;
    this.map.delete(id);
    if (!e.obj.visible) { this.scene.remove(e.obj); return; }
    this.dying.push({ obj: e.obj, s: e.obj.scale.x, t: 0 });
  }

  // Footprint corners (ground + model top) of a placed object, for camera framing / guide rects
  corners(o) {
    const e = this.map.get(o.id);
    return objectCorners(this.game, o, e ? modelHeight(e.key) : 1);
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
        if ((defOf(e.o).kind === 'tree' || e.o.type === 'farmhouse') && this.modelKey(e.o) !== e.key) this.add(e.o, true);
        // the Mailbox's flag goes up / down with a little bounce
        if (e.o.type === 'mailbox' && this.modelKey(e.o) !== e.key) { this.add(e.o, false); const n = this.map.get(e.o.id); if (n) n.pop = 0.6; }
      }
    }
    for (const e of this.map.values()) {
      if (defOf(e.o).kind === 'tree' && e.key.endsWith(':fruit')) {
        e.obj.rotation.z = Math.sin(this.time * 1.8 + e.o.id) * 0.02;
      }
      if (e.pop < 1) {
        e.pop = Math.min(1, e.pop + dt * 1.4);
        e.obj.scale.setScalar(popCurve(e.pop));
      }
      // weeds rustle in the breeze
      if (e.o.type === 'weed') e.obj.rotation.z = Math.sin(this.time * 1.7 + e.o.x * 0.9 + e.o.z * 0.6) * 0.06;
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
      const def = defOf(e.o);
      const working = def.kind === 'factory' && !!e.o.jobs?.some((j) => j.endAt > now);
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
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t = Math.min(1, d.t + dt * 4.5);
      const k = 1 - d.t * d.t;
      d.obj.scale.set(d.s * (1 + d.t * 0.25) * k, d.s * k, d.s * (1 + d.t * 0.25) * k);
      if (d.t >= 1) { this.scene.remove(d.obj); this.dying.splice(i, 1); }
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

  // modelKey: what to draw (e.g. OBJECTS[type].model || type, or a tree stage key); type: footprint/rules type.
  // Works for every placeable kind, including gift decor (scarecrow, birdbath, picnic). tint: the type's recolour,
  // or a moved object's own (tintFor(o), e.g. gilded).
  show(modelKey, type = modelKey, tint = tintOf(type)) {
    this.hide();
    this.type = type;
    this.height = modelHeight(modelKey);
    this.obj = applyTint(makeObject(modelKey, { shadow: false }), tint);
    this.obj.traverse((m) => {
      if (m.isMesh) {
        m.material = cloneMaterial(m.material);
        m.material.transparent = true;
        m.material.opacity = 0.8;
      }
    });
    this.scene.add(this.obj);
    this.pad.visible = true;
  }

  update(x, z, rot, valid) {
    if (!this.obj) return;
    Object.assign(this, { x, z, rot, valid });
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

  get active() { return !!this.obj; }

  // Footprint corners at the ground and at the model's top (for World.frame / projectRect); [] when hidden
  corners() {
    if (!this.obj || this.x === undefined) return [];
    return objectCorners(this.game, { type: this.type, x: this.x, z: this.z, rot: this.rot }, this.height);
  }
}

// ------------------------------------------------------------------ ghost plots (guide: "plow here")
// Dashed, softly pulsing soil outlines on suggested tiles. Animates itself while rendered,
// so callers only need show() / clear(); update(dt) is optional and idempotent.
const MARKER_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const MARKER_FRAG = `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uFill;
uniform vec3 uFurrow;
uniform vec3 uLine;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  // rounded square, half size 0.46, corner radius 0.1
  vec2 q = abs(p) - vec2(0.36);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.1;
  float aa = fwidth(d) * 1.2;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  if (inside <= 0.0) discard;
  // perimeter coordinate 0..4 so the dashes march round the edge
  float s = abs(p.x) > abs(p.y) ? (p.x > 0.0 ? 0.5 + p.y : 2.5 - p.y) : (p.y > 0.0 ? 1.5 - p.x : 3.5 + p.x);
  float f = fract(s * 4.0 - uTime * 0.8);
  float on = smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.55, 0.6, f));
  float band = smoothstep(-0.085 - aa, -0.085 + aa, d);
  // soil furrows like a real plot
  float fy = abs(fract(p.y * 3.5 + 0.5) - 0.5);
  vec3 fill = mix(uFurrow, uFill, smoothstep(0.12, 0.16, fy));
  vec3 col = mix(fill, uLine, band);
  float a = mix(uAlpha, mix(0.3, 0.95, on), band) * inside;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export class TileMarkers {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'tileMarkers';
    scene.add(this.group);
    this.geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: MARKER_VERT,
      fragmentShader: MARKER_FRAG,
      uniforms: {
        uTime: { value: 0 }, uAlpha: { value: 0.4 },
        uFill: { value: new THREE.Color('#9a6a3e') }, uFurrow: { value: new THREE.Color('#6d4325') }, uLine: { value: new THREE.Color('#ffffff') },
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.meshes = [];
    this.key = '';
  }

  get tiles() { return this.meshes.map((m) => m.userData.tile); }
  get visible() { return this.meshes.length > 0; }

  // tiles: [[x, z], …]. Showing the same set again keeps the current animation.
  show(tiles = []) {
    const key = tiles.map(([x, z]) => x + ',' + z).join(';');
    if (key === this.key) return;
    this.clear();
    this.key = key;
    const born = performance.now() / 1000;
    tiles.forEach(([x, z], i) => {
      const m = new THREE.Mesh(this.geo, this.mat);
      tileToWorld(x, z, m.position);
      m.position.y = 0.035;
      m.scale.setScalar(0.001);
      m.renderOrder = 2;
      m.frustumCulled = false; // keep the self-animation running from scale ~0
      m.userData = { tile: [x, z], born: born + i * 0.12, i };
      m.onBeforeRender = () => this.animate(m, performance.now() / 1000);
      this.group.add(m);
      this.meshes.push(m);
    });
  }

  clear() {
    for (const m of this.meshes) this.group.remove(m);
    this.meshes = [];
    this.key = '';
  }

  animate(m, t) {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uAlpha.value = 0.5 + Math.sin(t * 3.2) * 0.1;
    const k = popCurve(THREE.MathUtils.clamp((t - m.userData.born) / 0.55, 0, 1));
    m.scale.setScalar(Math.max(0.001, k * (1 + Math.sin(t * 3.2 + m.userData.i) * 0.03)));
  }

  update() {
    const t = performance.now() / 1000;
    for (const m of this.meshes) this.animate(m, t);
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
    this.geo.dispose();
    this.mat.dispose();
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
