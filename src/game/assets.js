// Procedural low-poly asset library.
// Every model is built from primitives, then "baked" into one vertex-colored
// geometry (per material bucket) and cached, so each placed object costs 1-2 draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------------ materials
export const MATS = {
  vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: true }),
  glow: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: new THREE.Color('#ffc864'), emissiveIntensity: 0.0, flatShading: true }),
  water: new THREE.MeshStandardMaterial({ color: '#4fa6d8', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }),
  smoke: new THREE.MeshStandardMaterial({ color: '#eeeeee', roughness: 1, transparent: true, opacity: 0.7, flatShading: true }),
  // greenhouse panes etc.: pass 'glass' as the bucket argument of box()
  glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.45, depthWrite: false, flatShading: true }),
};
// the water of a fountain or bird bath: the same look as 'vc', in its own bucket so gilding can leave it blue
MATS.vcWater = MATS.vc.clone();
MATS.glow.userData.bucket = 'glow';
MATS.glass.userData.bucket = 'glass';
MATS.vcWater.userData.bucket = 'vcWater';

const colorMats = new Map();
// Lightweight "material" used only during model construction to carry a color.
function cm(color, bucket = 'vc') {
  const k = color + bucket;
  let m = colorMats.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    m.userData.bucket = bucket;
    colorMats.set(k, m);
  }
  return m;
}

// ------------------------------------------------------------------ primitive helpers
const geoCache = new Map();
function g(key, make) {
  let x = geoCache.get(key);
  if (!x) { x = make(); geoCache.set(key, x); }
  return x;
}

function mesh(geometry, color, x = 0, y = 0, z = 0, bucket) {
  const m = new THREE.Mesh(geometry, cm(color, bucket));
  m.position.set(x, y, z);
  return m;
}
// box with bottom at y
const box = (w, h, d, color, x = 0, y = 0, z = 0, bucket) => mesh(g(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), color, x, y + h / 2, z, bucket);
const cyl = (rt, rb, h, seg, color, x = 0, y = 0, z = 0) => mesh(g(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), color, x, y + h / 2, z);
const cone = (r, h, seg, color, x = 0, y = 0, z = 0) => mesh(g(`k${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)), color, x, y + h / 2, z);
const ball = (r, color, x = 0, y = 0, z = 0, detail = 0) => mesh(g(`i${r}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail)), color, x, y, z);
const sph = (r, color, x = 0, y = 0, z = 0, ws = 8, hs = 6) => mesh(g(`s${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs)), color, x, y, z);

// Triangular prism roof, ridge along Z. Bottom at y.
function roof(w, h, d, color, x = 0, y = 0, z = 0, gambrel = false) {
  const geo = g(`roof${w}|${h}|${d}|${gambrel}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    if (gambrel) {
      s.lineTo(w * 0.36, h * 0.62);
      s.lineTo(0, h);
      s.lineTo(-w * 0.36, h * 0.62);
    } else {
      s.lineTo(0, h);
    }
    s.closePath();
    const geom = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    geom.translate(0, 0, -d / 2);
    return geom;
  });
  return mesh(geo, color, x, y, z);
}

function group(...children) {
  const gr = new THREE.Group();
  for (const c of children.flat()) if (c) gr.add(c);
  return gr;
}

function rot(obj, x = 0, y = 0, z = 0) { obj.rotation.set(x, y, z); return obj; }
function scl(obj, x, y = x, z = x) { obj.scale.set(x, y, z); return obj; }

// Deterministic pseudo random for stable variations
export function hashRand(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ baking
// Merge all meshes of a group into one geometry per material bucket, with vertex colors.
// Children flagged userData.keep are left as live objects (for animation).
export function bake(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const kept = [];
  const tmpColor = new THREE.Color();
  const visit = (obj, isRoot) => {
    if (!isRoot && obj.userData.keep) { kept.push(obj); return; }
    if (obj.isMesh) {
      let geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
      const existing = obj.material.vertexColors && obj.geometry.attributes.color;
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && !(existing && name === 'color')) geo.deleteAttribute(name);
      geo.applyMatrix4(obj.matrixWorld);
      if (!existing) {
        tmpColor.copy(obj.material.color);
        const n = geo.attributes.position.count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col[i * 3] = tmpColor.r; col[i * 3 + 1] = tmpColor.g; col[i * 3 + 2] = tmpColor.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      }
      const b = obj.material.userData.bucket || 'vc';
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b).push(geo);
    }
    for (const c of obj.children) visit(c, false);
  };
  visit(root, true);
  const parts = [];
  for (const [b, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    parts.push({ geometry: merged, material: MATS[b] || MATS.vc });
    geos.forEach((x) => x.dispose());
  }
  // kept children: bake each of them too so they are cheap to clone
  const keptBaked = kept.map((k) => {
    const pos = k.position.clone(), rotn = k.rotation.clone(), sc = k.scale.clone();
    k.position.set(0, 0, 0); k.rotation.set(0, 0, 0); k.scale.set(1, 1, 1);
    k.parent && k.parent.remove(k);
    const inner = bake(k);
    return { model: inner, position: pos, rotation: rotn, scale: sc, name: k.name };
  });
  return { parts, kept: keptBaked };
}

// Create a scene object from a baked model
export function instantiate(model, { shadow = true, receive = true } = {}) {
  const gr = new THREE.Group();
  for (const p of model.parts) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.castShadow = shadow;
    m.receiveShadow = receive;
    gr.add(m);
  }
  for (const k of model.kept) {
    const child = instantiate(k.model, { shadow, receive });
    child.position.copy(k.position);
    child.rotation.copy(k.rotation);
    child.scale.copy(k.scale);
    child.name = k.name;
    gr.add(child);
  }
  return gr;
}

const modelCache = new Map();
export function getModel(key) {
  let m = modelCache.get(key);
  if (!m) {
    const [name, ...args] = key.split(':');
    const builder = BUILDERS[name];
    if (!builder) {
      console.warn('No builder for ' + key + ' — using placeholder');
      m = bake(placeholder());
    } else m = bake(builder(...args));
    modelCache.set(key, m);
  }
  return m;
}

// Other modules add builders here (see src/game/models/*.js)
export function registerBuilders(obj) { Object.assign(BUILDERS, obj); }
export function registerCrops(obj) { Object.assign(CROP_BUILDERS, obj); }
const CROP_BUILDERS = {};

function placeholder() {
  return group(box(0.8, 0.8, 0.8, '#ff66cc', 0, 0, 0), box(0.4, 0.4, 0.4, '#ffffff', 0, 0.8, 0));
}

export const makeObject = (key, opts) => instantiate(getModel(key), opts);

// ------------------------------------------------------------------ palette
const C = {
  grass: '#79c453', leaf: '#5fae3e', leafDark: '#3f8a35', leafLight: '#8fd45f', pine: '#2f7a4a', pineLight: '#3d9459',
  trunk: '#7a5232', wood: '#b07a45', woodDark: '#7b5130', woodLight: '#d39c5d', plank: '#c48a50',
  red: '#d24b3e', redDark: '#a8382f', cream: '#f5e8c8', white: '#fbfbf6', stone: '#b9b4a8', stoneDark: '#8f8a80',
  soil: '#8a5a33', soilDark: '#6d4325', straw: '#e9c86a', strawDark: '#cfa848', yellow: '#f7cf3b', orange: '#f08a24',
  blue: '#4d8fd1', blueDark: '#3a6ea6', purple: '#8a62c4', pink: '#f29bb3', black: '#2b2b2b', glass: '#ffe9a8',
};

// ------------------------------------------------------------------ fences
function fencePost(x, z, h = 0.55) { return box(0.1, h, 0.1, C.woodDark, x, 0, z); }
function fenceRail(x1, z1, x2, z2, y) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const r = box(len, 0.07, 0.05, C.wood, (x1 + x2) / 2, y, (z1 + z2) / 2);
  r.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
  return r;
}
// fence around rectangle w x d centered at origin, optional gate gap on +z side
function fenceRect(w, d, gate = true) {
  const parts = [];
  const hw = w / 2 - 0.08, hd = d / 2 - 0.08;
  const side = (ax, az, bx, bz, gap) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      parts.push(fencePost(ax + (bx - ax) * t, az + (bz - az) * t));
    }
    if (gap) {
      const mid = 0.5, gw = 0.7 / len;
      for (const [s, e] of [[0, mid - gw], [mid + gw, 1]]) {
        const sx = ax + (bx - ax) * s, sz = az + (bz - az) * s, ex = ax + (bx - ax) * e, ez = az + (bz - az) * e;
        parts.push(fenceRail(sx, sz, ex, ez, 0.2), fenceRail(sx, sz, ex, ez, 0.4));
      }
    } else {
      parts.push(fenceRail(ax, az, bx, bz, 0.2), fenceRail(ax, az, bx, bz, 0.4));
    }
  };
  side(-hw, -hd, hw, -hd);
  side(-hw, hd, hw, hd, gate);
  side(-hw, -hd, -hw, hd);
  side(hw, -hd, hw, hd);
  return group(parts);
}

function groundPatch(w, d, color, y = 0.015) {
  return box(w, 0.03, d, color, 0, y - 0.015, 0);
}

// ------------------------------------------------------------------ buildings
function farmhouse() {
  const gr = group(
    box(2.7, 0.18, 2.5, C.stoneDark, 0, 0, 0),
    box(2.4, 1.35, 2.1, C.cream, 0, 0.18, -0.05),
    // trim
    box(2.48, 0.1, 2.18, C.white, 0, 1.5, -0.05),
    roof(2.9, 1.15, 2.5, C.red, 0, 1.55, -0.05),
    box(0.3, 0.7, 0.3, C.stoneDark, 0.65, 2.0, -0.4),
    box(0.36, 0.1, 0.36, C.stone, 0.65, 2.7, -0.4),
    // door + steps
    box(0.5, 0.82, 0.06, C.woodDark, 0, 0.18, 1.0),
    box(0.06, 0.06, 0.04, C.yellow, 0.16, 0.6, 1.04),
    box(0.9, 0.09, 0.35, C.stone, 0, 0, 1.18),
    // windows (glow at night)
    box(0.42, 0.42, 0.05, C.glass, -0.75, 0.6, 1.0, 'glow'),
    box(0.42, 0.42, 0.05, C.glass, 0.75, 0.6, 1.0, 'glow'),
    box(0.05, 0.42, 0.42, C.glass, 1.2, 0.6, 0.2, 'glow'),
    box(0.05, 0.42, 0.42, C.glass, 1.2, 0.6, -0.6, 'glow'),
    box(0.3, 0.3, 0.05, C.glass, 0, 1.85, 1.15, 'glow'),
    // window frames
    box(0.5, 0.06, 0.08, C.white, -0.75, 0.56, 1.01),
    box(0.5, 0.06, 0.08, C.white, 0.75, 0.56, 1.01),
    // flower boxes
    box(0.5, 0.1, 0.12, C.woodDark, -0.75, 0.48, 1.08),
    box(0.5, 0.1, 0.12, C.woodDark, 0.75, 0.48, 1.08),
    ball(0.07, C.pink, -0.88, 0.62, 1.1), ball(0.07, C.yellow, -0.7, 0.62, 1.1), ball(0.07, C.red, -0.58, 0.62, 1.1),
    ball(0.07, C.purple, 0.62, 0.62, 1.1), ball(0.07, C.pink, 0.78, 0.62, 1.1), ball(0.07, C.yellow, 0.92, 0.62, 1.1),
    // mailbox
    box(0.06, 0.5, 0.06, C.woodDark, 1.2, 0, 1.3),
    box(0.18, 0.14, 0.26, C.blue, 1.2, 0.5, 1.3),
  );
  return gr;
}

function orderboard() {
  const gr = group(
    box(0.1, 1.1, 0.1, C.woodDark, -0.7, 0, 0),
    box(0.1, 1.1, 0.1, C.woodDark, 0.7, 0, 0),
    box(1.6, 0.75, 0.08, C.wood, 0, 0.45, 0),
    roof(1.85, 0.25, 0.35, C.red, 0, 1.18, 0),
    // paper notes
    box(0.32, 0.4, 0.02, C.white, -0.45, 0.62, 0.05),
    box(0.32, 0.36, 0.02, '#fff6c9', 0, 0.66, 0.05),
    box(0.32, 0.4, 0.02, C.white, 0.45, 0.6, 0.05),
    box(0.06, 0.06, 0.02, C.red, -0.45, 0.98, 0.07),
    box(0.06, 0.06, 0.02, C.blue, 0, 0.98, 0.07),
    box(0.06, 0.06, 0.02, C.red, 0.45, 0.98, 0.07),
    // crates
    box(0.36, 0.3, 0.36, C.woodLight, -0.6, 0, 0.32),
    box(0.3, 0.26, 0.3, C.plank, 0.62, 0, 0.3),
  );
  return gr;
}

function smallHouse(w, d, wall, roofCol, h = 0.8) {
  return group(
    box(w, h, d, wall, 0, 0, 0),
    roof(w + 0.25, h * 0.7, d + 0.2, roofCol, 0, h, 0),
    box(w * 0.32, h * 0.55, 0.05, C.woodDark, 0, 0, d / 2 + 0.01),
  );
}

function coop() {
  const house = smallHouse(1.3, 1.1, C.plank, C.red, 0.75);
  house.position.set(-0.95, 0.25, -1.0);
  return group(
    groundPatch(3.8, 3.8, '#d9c27a'),
    fenceRect(4, 4),
    // stilts
    box(0.08, 0.25, 0.08, C.woodDark, -1.5, 0, -1.45), box(0.08, 0.25, 0.08, C.woodDark, -0.4, 0, -1.45),
    box(0.08, 0.25, 0.08, C.woodDark, -1.5, 0, -0.55), box(0.08, 0.25, 0.08, C.woodDark, -0.4, 0, -0.55),
    house,
    rot(box(0.3, 0.04, 0.6, C.wood, -0.95, 0.1, -0.25), 0.5, 0, 0),
    // feeder & nests
    box(0.8, 0.14, 0.24, C.woodDark, 1.1, 0, -1.4),
    box(0.7, 0.05, 0.16, C.straw, 1.1, 0.14, -1.4),
    cyl(0.2, 0.22, 0.14, 8, C.strawDark, 1.3, 0, 1.2),
  );
}

function cowbarn() {
  const barn = group(
    box(2.2, 1.2, 1.8, C.red, 0, 0, 0),
    roof(2.4, 1.1, 2.0, C.stoneDark, 0, 1.2, 0, true),
    box(0.9, 0.9, 0.05, C.redDark, 0, 0, 0.91),
    rot(box(1.2, 0.08, 0.06, C.white, 0, 0.41, 0.94), 0, 0, 0.78),
    rot(box(1.2, 0.08, 0.06, C.white, 0, 0.41, 0.94), 0, 0, -0.78),
    box(0.96, 0.08, 0.06, C.white, 0, 0.9, 0.94),
    box(0.4, 0.3, 0.05, C.white, 0, 1.4, 0.92),
    box(0.3, 0.2, 0.06, C.woodDark, 0, 1.45, 0.94),
  );
  barn.position.set(-1.1, 0, -1.25);
  return group(
    groundPatch(4.8, 4.8, '#8ccf5f'),
    fenceRect(5, 5),
    barn,
    // water trough
    box(1.0, 0.25, 0.35, C.woodDark, 1.4, 0, -1.8),
    box(0.9, 0.04, 0.27, C.blue, 1.4, 0.22, -1.8),
    // hay
    rot(cyl(0.25, 0.25, 0.5, 10, C.straw, 1.6, 0.25, 1.5), 0, 0, Math.PI / 2),
    rot(cyl(0.25, 0.25, 0.5, 10, C.strawDark, 1.1, 0.25, 1.75), 0, 0, Math.PI / 2),
  );
}

function sheepfold() {
  const shed = group(
    box(1.8, 0.9, 1.4, '#d8c9a8', 0, 0, 0),
    roof(2.0, 0.8, 1.6, C.blueDark, 0, 0.9, 0),
    box(0.6, 0.6, 0.05, C.woodDark, 0, 0, 0.71),
  );
  shed.position.set(1.2, 0, -1.4);
  return group(
    groundPatch(4.8, 4.8, '#9bd66c'),
    fenceRect(5, 5),
    shed,
    cyl(0.4, 0.45, 0.5, 10, C.straw, -1.5, 0, -1.5),
    cone(0.42, 0.3, 10, C.strawDark, -1.5, 0.5, -1.5),
    box(0.8, 0.2, 0.3, C.woodDark, -1.4, 0, 1.6),
    box(0.7, 0.05, 0.22, C.straw, -1.4, 0.2, 1.6),
  );
}

function chimneySmoke() {
  const s = group(sph(0.12, '#eeeeee', 0, 0, 0), sph(0.09, '#e0e0e0', 0.1, 0.2, 0), sph(0.07, '#f5f5f5', -0.05, 0.38, 0));
  return s;
}

function bakery() {
  const awning = [];
  for (let i = 0; i < 6; i++) awning.push(rot(box(0.38, 0.05, 0.5, i % 2 ? C.white : C.red, -0.95 + i * 0.38, 0.95, 1.12), 0.35, 0, 0));
  return group(
    box(2.6, 0.12, 2.4, C.stoneDark, 0, 0, 0),
    box(2.3, 1.3, 2.0, '#d68b5a', 0, 0.12, -0.1),
    box(2.36, 0.1, 2.06, C.cream, 0, 0.7, -0.1),
    roof(2.6, 0.9, 2.3, '#8b4a2b', 0, 1.42, -0.1),
    box(0.35, 0.9, 0.35, '#b56a42', 0.7, 1.5, -0.5),
    awning,
    box(0.55, 0.8, 0.05, C.woodDark, 0.55, 0.12, 0.91),
    box(0.7, 0.45, 0.05, C.glass, -0.5, 0.35, 0.91, 'glow'),
    // sign
    box(0.9, 0.35, 0.06, C.cream, 0, 1.55, 1.05),
    rot(cyl(0.12, 0.14, 0.12, 8, '#d9a25a', 0, 1.62, 1.12), Math.PI / 2, 0, 0),
    // bread on table
    box(0.6, 0.06, 0.35, C.wood, -0.6, 0.45, 1.25),
    box(0.06, 0.45, 0.06, C.woodDark, -0.85, 0, 1.25), box(0.06, 0.45, 0.06, C.woodDark, -0.35, 0, 1.25),
    scl(sph(0.1, '#d9a25a', -0.7, 0.56, 1.25), 1.5, 0.8, 1), scl(sph(0.1, '#c98d45', -0.45, 0.56, 1.25), 1.5, 0.8, 1),
  );
}

function dairy() {
  return group(
    box(2.6, 0.12, 2.4, C.stone, 0, 0, 0),
    box(2.3, 1.25, 2.0, C.white, 0, 0.12, -0.1),
    box(2.32, 0.25, 2.02, C.blue, 0, 0.12, -0.1),
    roof(2.6, 0.95, 2.3, C.blueDark, 0, 1.37, -0.1),
    box(0.6, 0.85, 0.05, C.blueDark, 0.5, 0.12, 0.91),
    box(0.55, 0.45, 0.05, C.glass, -0.5, 0.5, 0.91, 'glow'),
    // big milk tank on the side
    cyl(0.35, 0.35, 1.2, 12, '#dfe6ee', -1.4, 0, -0.6),
    cone(0.36, 0.25, 12, '#c9d2dc', -1.4, 1.2, -0.6),
    // milk cans
    cyl(0.1, 0.12, 0.3, 8, '#cfd8e0', 1.0, 0.12, 1.15), cyl(0.05, 0.05, 0.06, 8, '#aab4be', 1.0, 0.42, 1.15),
    cyl(0.1, 0.12, 0.3, 8, '#cfd8e0', 1.25, 0.12, 1.0), cyl(0.05, 0.05, 0.06, 8, '#aab4be', 1.25, 0.42, 1.0),
    // cheese wheel sign
    rot(cyl(0.22, 0.22, 0.1, 10, C.yellow, 0, 1.55, 1.08), Math.PI / 2, 0, 0),
  );
}

function loom() {
  return group(
    box(2.6, 0.12, 2.4, C.stoneDark, 0, 0, 0),
    box(2.2, 1.2, 1.9, '#c9b7e3', 0, 0.12, -0.15),
    roof(2.5, 1.0, 2.2, C.purple, 0, 1.32, -0.15),
    box(0.55, 0.8, 0.05, C.woodDark, 0.5, 0.12, 0.81),
    box(0.55, 0.4, 0.05, C.glass, -0.5, 0.5, 0.81, 'glow'),
    // spinning wheel outside
    rot(cyl(0.3, 0.3, 0.05, 12, C.woodLight, -0.6, 0.35, 1.2), Math.PI / 2, 0, 0),
    box(0.06, 0.4, 0.06, C.woodDark, -0.6, 0, 1.2),
    box(0.5, 0.06, 0.15, C.woodDark, -0.6, 0.1, 1.2),
    // yarn balls
    ball(0.13, C.pink, 0.9, 0.13, 1.1, 1), ball(0.11, C.blue, 1.1, 0.11, 0.9, 1), ball(0.12, C.yellow, 0.7, 0.12, 1.3, 1),
  );
}

// ------------------------------------------------------------------ decor & nature
function oak(seed = 1) {
  const r = hashRand(+seed);
  const s = 0.85 + r() * 0.3;
  const shades = [C.leaf, C.leafDark, C.leafLight];
  const gr = group(
    cyl(0.07, 0.11, 0.7, 6, C.trunk, 0, 0, 0),
    ball(0.42, shades[0], 0, 0.95, 0),
    ball(0.3, shades[Math.floor(r() * 3)], 0.25, 0.85, 0.12),
    ball(0.3, shades[Math.floor(r() * 3)], -0.2, 0.88, -0.15),
    ball(0.26, shades[1], 0.05, 1.25, -0.05),
  );
  gr.scale.setScalar(s);
  return group(gr);
}

function pine(seed = 1) {
  const r = hashRand(+seed + 7);
  const s = 0.85 + r() * 0.35;
  const gr = group(
    cyl(0.06, 0.09, 0.4, 6, C.trunk, 0, 0, 0),
    cone(0.48, 0.6, 7, C.pine, 0, 0.3, 0),
    cone(0.38, 0.55, 7, C.pineLight, 0, 0.65, 0),
    cone(0.26, 0.5, 7, C.pine, 0, 0.98, 0),
  );
  gr.scale.setScalar(s);
  return group(gr);
}

function bush() {
  return group(
    ball(0.28, C.leaf, 0, 0.2, 0),
    ball(0.2, C.leafDark, 0.2, 0.15, 0.08),
    ball(0.2, C.leafLight, -0.18, 0.15, -0.05),
    ball(0.05, C.pink, 0.1, 0.42, 0.15), ball(0.05, C.white, -0.15, 0.32, 0.2),
  );
}

function flowers() {
  const r = hashRand(42);
  const cols = [C.pink, C.yellow, C.red, C.purple, C.white, C.orange];
  const parts = [box(0.86, 0.12, 0.86, C.woodDark, 0, 0, 0), box(0.76, 0.04, 0.76, C.soil, 0, 0.12, 0)];
  for (let i = 0; i < 9; i++) {
    const x = ((i % 3) - 1) * 0.24 + (r() - 0.5) * 0.06, z = (Math.floor(i / 3) - 1) * 0.24 + (r() - 0.5) * 0.06;
    parts.push(box(0.025, 0.18, 0.025, C.leafDark, x, 0.14, z));
    parts.push(ball(0.07, cols[i % cols.length], x, 0.34, z));
    parts.push(ball(0.035, C.yellow, x, 0.39, z));
  }
  return group(parts);
}

function fence() {
  return group(fencePost(-0.45, 0), fencePost(0.45, 0), fencePost(0, 0), fenceRail(-0.5, 0, 0.5, 0, 0.2), fenceRail(-0.5, 0, 0.5, 0, 0.4));
}

function path() {
  return group(
    box(0.98, 0.02, 0.98, '#cdb98e', 0, 0, 0),
    scl(cyl(0.2, 0.22, 0.05, 6, C.stone, -0.2, 0.0, -0.2), 1, 1, 0.8),
    scl(cyl(0.18, 0.2, 0.05, 6, '#c8c3b6', 0.22, 0.0, -0.18), 1, 1, 1),
    scl(cyl(0.2, 0.22, 0.05, 6, C.stone, 0.15, 0.0, 0.24), 1.1, 1, 0.9),
    scl(cyl(0.15, 0.17, 0.05, 6, '#c8c3b6', -0.24, 0.0, 0.22), 1, 1, 1),
  );
}

function hay() {
  return group(
    rot(cyl(0.3, 0.3, 0.7, 12, C.straw, 0, 0.3, 0), 0, 0, Math.PI / 2),
    rot(cyl(0.31, 0.31, 0.05, 12, C.strawDark, -0.2, 0.3, 0), 0, 0, Math.PI / 2),
    rot(cyl(0.31, 0.31, 0.05, 12, C.strawDark, 0.2, 0.3, 0), 0, 0, Math.PI / 2),
  );
}

function scarecrow() {
  return group(
    box(0.07, 1.2, 0.07, C.woodDark, 0, 0, 0),
    box(0.9, 0.06, 0.06, C.woodDark, 0, 0.85, 0),
    box(0.4, 0.45, 0.22, C.blue, 0, 0.55, 0),
    box(0.42, 0.15, 0.24, '#c94e3f', 0, 0.85, 0),
    box(0.2, 0.12, 0.12, '#c94e3f', -0.3, 0.83, 0), box(0.2, 0.12, 0.12, '#c94e3f', 0.3, 0.83, 0),
    box(0.06, 0.12, 0.06, C.straw, -0.45, 0.8, 0), box(0.06, 0.12, 0.06, C.straw, 0.45, 0.8, 0),
    sph(0.17, '#e8d49a', 0, 1.12, 0),
    cyl(0.32, 0.32, 0.03, 10, C.strawDark, 0, 1.22, 0),
    cone(0.16, 0.2, 10, C.strawDark, 0, 1.24, 0),
    box(0.04, 0.04, 0.02, C.black, -0.06, 1.15, 0.16), box(0.04, 0.04, 0.02, C.black, 0.06, 1.15, 0.16),
    rot(cone(0.03, 0.1, 5, C.orange, 0, 1.08, 0.18), Math.PI / 2, 0, 0),
  );
}

function lamp() {
  return group(
    cyl(0.12, 0.15, 0.1, 6, C.stoneDark, 0, 0, 0),
    cyl(0.04, 0.04, 1.3, 6, C.black, 0, 0.1, 0),
    box(0.22, 0.25, 0.22, C.glass, 0, 1.35, 0, 'glow'),
    cone(0.2, 0.15, 4, C.black, 0, 1.6, 0),
    box(0.26, 0.04, 0.26, C.black, 0, 1.33, 0),
  );
}

function bench() {
  return group(
    box(1.5, 0.06, 0.4, C.wood, 0, 0.38, 0),
    box(1.5, 0.3, 0.05, C.wood, 0, 0.5, -0.18),
    box(0.06, 0.38, 0.35, C.black, -0.65, 0, 0), box(0.06, 0.38, 0.35, C.black, 0.65, 0, 0),
  );
}

function well() {
  return group(
    cyl(0.6, 0.65, 0.55, 10, C.stone, 0, 0, 0),
    cyl(0.48, 0.48, 0.02, 10, C.blue, 0, 0.5, 0),
    box(0.08, 1.2, 0.08, C.woodDark, -0.55, 0.3, 0), box(0.08, 1.2, 0.08, C.woodDark, 0.55, 0.3, 0),
    roof(1.4, 0.45, 0.9, C.red, 0, 1.45, 0),
    rot(cyl(0.05, 0.05, 1.1, 6, C.wood, 0, 1.2, 0), 0, 0, Math.PI / 2),
    box(0.02, 0.4, 0.02, C.black, 0, 0.8, 0),
    cyl(0.1, 0.08, 0.15, 8, C.woodDark, 0, 0.66, 0),
    // flowers around
    ball(0.08, C.pink, 0.7, 0.08, 0.5), ball(0.08, C.yellow, -0.7, 0.08, 0.55), ball(0.08, C.purple, 0.75, 0.08, -0.5),
  );
}

function windmill() {
  const blades = group();
  for (let i = 0; i < 4; i++) {
    const arm = group(box(0.08, 1.3, 0.04, C.woodDark, 0, 0, 0), box(0.32, 1.0, 0.02, C.white, 0.2, 0.28, 0));
    arm.rotation.z = (i * Math.PI) / 2;
    blades.add(arm);
  }
  blades.add(cyl(0.12, 0.12, 0.15, 8, C.red, 0, -0.07, 0));
  blades.children[blades.children.length - 1].rotation.x = Math.PI / 2;
  blades.userData.keep = true;
  blades.name = 'blades';
  blades.position.set(0, 2.55, 0.75);
  return group(
    cyl(0.75, 1.1, 2.6, 8, C.cream, 0, 0, 0),
    cyl(1.15, 1.15, 0.15, 8, C.stoneDark, 0, 0, 0),
    cone(0.9, 0.9, 8, C.red, 0, 2.6, 0),
    box(0.45, 0.7, 0.05, C.woodDark, 0, 0.15, 1.03),
    box(0.3, 0.3, 0.05, C.glass, 0, 1.5, 0.85, 'glow'),
    blades,
  );
}

function rock(seed = 1) {
  const r = hashRand(+seed);
  const gr = group(
    scl(ball(0.25, C.stone, 0, 0.12, 0), 1 + r() * 0.4, 0.6 + r() * 0.3, 1),
    scl(ball(0.14, C.stoneDark, 0.22, 0.06, 0.1), 1, 0.7, 1),
  );
  gr.rotation.y = r() * 6;
  return group(gr);
}

function tallgrass(seed = 1) {
  const r = hashRand(+seed);
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const b = cone(0.04, 0.25 + r() * 0.2, 3, i % 2 ? C.leaf : C.leafLight, (r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3);
    b.rotation.z = (r() - 0.5) * 0.5;
    parts.push(b);
  }
  return group(parts);
}

function reeds() {
  const parts = [];
  const r = hashRand(3);
  for (let i = 0; i < 6; i++) {
    const x = (r() - 0.5) * 0.5, z = (r() - 0.5) * 0.5;
    parts.push(cyl(0.015, 0.02, 0.6 + r() * 0.3, 4, C.leafDark, x, 0, z));
    if (i % 2) parts.push(cyl(0.04, 0.04, 0.15, 5, C.trunk, x, 0.6, z));
  }
  return group(parts);
}

function cloud(seed = 1) {
  const r = hashRand(+seed);
  const parts = [];
  const n = 4 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) parts.push(ball(0.8 + r() * 0.8, C.white, (i - n / 2) * 0.9, r() * 0.4, (r() - 0.5) * 0.8, 1));
  return group(parts);
}

function truck() {
  const wheel = (x, z) => rot(cyl(0.2, 0.2, 0.14, 10, C.black, x, 0.2, z), Math.PI / 2, 0, 0);
  const w = [wheel(-0.7, 0.45), wheel(-0.7, -0.45), wheel(0.6, 0.45), wheel(0.6, -0.45)];
  w.forEach((m) => { m.position.y = 0.2; });
  return group(
    box(2.0, 0.25, 0.95, C.black, 0, 0.18, 0),
    box(0.75, 0.75, 0.95, C.blue, 0.6, 0.35, 0),
    box(0.05, 0.35, 0.8, '#bfe3ff', 0.98, 0.65, 0),
    box(1.2, 0.5, 1.0, C.woodLight, -0.45, 0.43, 0),
    box(0.4, 0.3, 0.4, C.strawDark, -0.7, 0.93, 0.15), box(0.35, 0.3, 0.35, C.woodDark, -0.25, 0.93, -0.15),
    box(0.06, 0.12, 0.2, C.yellow, 1.0, 0.4, 0.3), box(0.06, 0.12, 0.2, C.yellow, 1.0, 0.4, -0.3),
    w,
  );
}

function soil() {
  return group(
    box(0.96, 0.08, 0.96, C.soil, 0, 0, 0),
    box(0.9, 0.06, 0.16, C.soilDark, 0, 0.06, -0.28),
    box(0.9, 0.06, 0.16, C.soilDark, 0, 0.06, 0),
    box(0.9, 0.06, 0.16, C.soilDark, 0, 0.06, 0.28),
  );
}

function butterfly() {
  return group(
    box(0.03, 0.03, 0.12, C.black, 0, 0, 0),
  );
}

// ------------------------------------------------------------------ animals (forward = +z)
function chicken(variant = '0') {
  const body = variant === '1' ? '#c98b4a' : C.white;
  return group(
    scl(sph(0.17, body, 0, 0.24, 0), 1, 0.9, 1.2),
    rot(cone(0.1, 0.18, 5, body, 0, 0.32, -0.2), -0.9, 0, 0),
    sph(0.1, body, 0, 0.42, 0.14),
    box(0.04, 0.08, 0.1, C.red, 0, 0.5, 0.14),
    rot(cone(0.035, 0.08, 4, C.orange, 0, 0.38, 0.27), Math.PI / 2, 0, 0),
    box(0.03, 0.05, 0.03, C.red, 0, 0.33, 0.22),
    box(0.02, 0.03, 0.02, C.black, 0.07, 0.44, 0.2), box(0.02, 0.03, 0.02, C.black, -0.07, 0.44, 0.2),
    box(0.025, 0.1, 0.025, C.orange, 0.06, 0.02, 0), box(0.025, 0.1, 0.025, C.orange, -0.06, 0.02, 0),
    scl(sph(0.08, body, 0.15, 0.24, 0), 0.4, 0.8, 1.3), scl(sph(0.08, body, -0.15, 0.24, 0), 0.4, 0.8, 1.3),
  );
}

function cow() {
  const parts = [
    box(0.5, 0.42, 0.9, C.white, 0, 0.35, 0),
    box(0.51, 0.2, 0.25, C.black, 0, 0.55, 0.1), box(0.3, 0.22, 0.2, C.black, 0.11, 0.38, -0.25),
    box(0.15, 0.15, 0.3, C.black, -0.18, 0.5, -0.2),
    box(0.32, 0.32, 0.32, C.white, 0, 0.62, 0.55),
    box(0.33, 0.14, 0.12, '#f2a9a9', 0, 0.55, 0.72),
    box(0.03, 0.03, 0.02, C.black, 0.09, 0.56, 0.78), box(0.03, 0.03, 0.02, C.black, -0.09, 0.56, 0.78),
    box(0.05, 0.05, 0.02, C.black, 0.1, 0.76, 0.71), box(0.05, 0.05, 0.02, C.black, -0.1, 0.76, 0.71),
    box(0.14, 0.06, 0.08, C.black, 0.22, 0.85, 0.52), box(0.14, 0.06, 0.08, C.black, -0.22, 0.85, 0.52),
    box(0.05, 0.12, 0.05, C.cream, 0.12, 0.94, 0.52), box(0.05, 0.12, 0.05, C.cream, -0.12, 0.94, 0.52),
    box(0.04, 0.3, 0.04, C.white, 0, 0.42, -0.47),
    box(0.06, 0.08, 0.06, C.black, 0, 0.38, -0.49),
    box(0.16, 0.08, 0.14, '#f2a9a9', 0, 0.3, 0.05),
  ];
  for (const [x, z] of [[0.17, 0.33], [-0.17, 0.33], [0.17, -0.33], [-0.17, -0.33]]) {
    parts.push(box(0.11, 0.35, 0.11, C.white, x, 0, z), box(0.12, 0.06, 0.12, C.black, x, 0, z));
  }
  return group(parts);
}

function sheep() {
  const wool = '#f6f2e8';
  const r = hashRand(11);
  const parts = [];
  for (let i = 0; i < 9; i++) parts.push(ball(0.16 + r() * 0.05, wool, (r() - 0.5) * 0.3, 0.42 + (r() - 0.5) * 0.12, (r() - 0.5) * 0.5, 1));
  parts.push(
    box(0.2, 0.22, 0.26, '#3a3a3a', 0, 0.5, 0.36),
    ball(0.1, wool, 0, 0.64, 0.33, 1),
    box(0.12, 0.05, 0.06, '#3a3a3a', 0.15, 0.55, 0.33), box(0.12, 0.05, 0.06, '#3a3a3a', -0.15, 0.55, 0.33),
    box(0.03, 0.03, 0.02, C.white, 0.06, 0.55, 0.49), box(0.03, 0.03, 0.02, C.white, -0.06, 0.55, 0.49),
  );
  for (const [x, z] of [[0.12, 0.18], [-0.12, 0.18], [0.12, -0.18], [-0.12, -0.18]]) parts.push(box(0.07, 0.3, 0.07, '#3a3a3a', x, 0, z));
  return group(parts);
}

function dog() {
  const fur = '#c58b4d';
  return group(
    box(0.24, 0.22, 0.5, fur, 0, 0.22, 0),
    box(0.24, 0.24, 0.24, fur, 0, 0.42, 0.28),
    box(0.14, 0.1, 0.12, C.cream, 0, 0.42, 0.44),
    box(0.05, 0.05, 0.03, C.black, 0, 0.47, 0.5),
    box(0.06, 0.14, 0.08, '#8a5a2e', 0.12, 0.52, 0.24), box(0.06, 0.14, 0.08, '#8a5a2e', -0.12, 0.52, 0.24),
    box(0.03, 0.03, 0.02, C.black, 0.06, 0.5, 0.4), box(0.03, 0.03, 0.02, C.black, -0.06, 0.5, 0.4),
    rot(box(0.05, 0.22, 0.05, fur, 0, 0.35, -0.28), -0.7, 0, 0),
    box(0.07, 0.22, 0.07, fur, 0.08, 0, 0.18), box(0.07, 0.22, 0.07, fur, -0.08, 0, 0.18),
    box(0.07, 0.22, 0.07, fur, 0.08, 0, -0.18), box(0.07, 0.22, 0.07, fur, -0.08, 0, -0.18),
    box(0.25, 0.04, 0.05, C.red, 0, 0.36, 0.17),
  );
}

// ------------------------------------------------------------------ crops
// Each crop: stage 0 seedling, 1 small, 2 big, 3 ripe. `v` = variant seed.
function sprouts(r) {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const x = (r() - 0.5) * 0.55, z = (r() - 0.5) * 0.55;
    parts.push(rot(cone(0.035, 0.12, 4, C.leafLight, x, 0.08, z), 0.3, r() * 3, 0.2));
    parts.push(rot(cone(0.035, 0.1, 4, C.leaf, x + 0.03, 0.08, z), -0.3, r() * 3, -0.2));
  }
  return parts;
}

function grid(n, r, spread = 0.62) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pts.push([((i + 0.5) / n - 0.5) * spread + (r() - 0.5) * 0.08, ((j + 0.5) / n - 0.5) * spread + (r() - 0.5) * 0.08]);
    }
  }
  return pts;
}

function crop(type, stageStr, v = '0') {
  const stage = +stageStr;
  const r = hashRand(type.length * 100 + stage * 10 + +v);
  const base = 0.08; // soil top
  if (stage === 0) return group(sprouts(r));
  const parts = [];
  if (CROP_BUILDERS[type]) {
    const gr = group(CROP_BUILDERS[type](stage, r, { base, parts: [] }));
    gr.rotation.y = r() * 0.4 - 0.2;
    return group(gr);
  }
  switch (type) {
    case 'wheat': {
      const h = [0, 0.25, 0.45, 0.55][stage];
      const col = stage === 3 ? '#e6bf4a' : stage === 2 ? '#a9c94a' : C.leafLight;
      for (const [x, z] of grid(3, r)) {
        for (let k = 0; k < 2; k++) {
          const hh = h * (0.85 + r() * 0.3);
          const s = box(0.03, hh, 0.03, col, x + (k - 0.5) * 0.06, base, z);
          s.rotation.z = (r() - 0.5) * 0.25; s.rotation.x = (r() - 0.5) * 0.25;
          parts.push(s);
          if (stage >= 2) parts.push(box(0.06, 0.14, 0.06, stage === 3 ? '#f2cf5b' : '#bcd65a', x + (k - 0.5) * 0.06, base + hh - 0.02, z));
        }
      }
      break;
    }
    case 'carrot': {
      const s = [0, 0.6, 0.9, 1.05][stage];
      for (const [x, z] of grid(2, r, 0.5)) {
        for (let k = 0; k < 4; k++) {
          const leaf = cone(0.05 * s, 0.3 * s, 4, k % 2 ? C.leaf : C.leafLight, x, base + 0.02, z);
          leaf.rotation.set((r() - 0.5) * 0.9, r() * 3, (r() - 0.5) * 0.9);
          parts.push(leaf);
        }
        if (stage === 3) parts.push(rot(cone(0.08, 0.16, 6, C.orange, x, base - 0.04, z), Math.PI, 0, 0));
      }
      break;
    }
    case 'corn': {
      const h = [0, 0.4, 0.75, 0.95][stage];
      for (const [x, z] of grid(2, r, 0.45)) {
        const hh = h * (0.9 + r() * 0.2);
        parts.push(cyl(0.03, 0.04, hh, 5, C.leafDark, x, base, z));
        for (let k = 0; k < 3; k++) {
          const leaf = box(0.04, 0.3 * (h + 0.3), 0.02, C.leaf, x, base + hh * (0.25 + k * 0.2), z);
          leaf.rotation.set(0, r() * 6, 0.8 + r() * 0.3);
          parts.push(leaf);
        }
        if (stage >= 2) parts.push(box(0.03, 0.12, 0.03, stage === 3 ? '#d9b26a' : C.leafLight, x, base + hh, z));
        if (stage === 3) {
          const cob = group(scl(sph(0.06, C.yellow, 0, 0, 0), 1, 2.2, 1), cone(0.065, 0.12, 5, C.leafLight, 0, -0.08, 0));
          cob.position.set(x + 0.06, base + hh * 0.6, z + 0.03);
          cob.rotation.z = -0.35;
          parts.push(cob);
        }
      }
      break;
    }
    case 'sunflower': {
      const h = [0, 0.35, 0.7, 0.95][stage];
      for (const [x, z] of grid(2, r, 0.42)) {
        const hh = h * (0.9 + r() * 0.2);
        parts.push(cyl(0.025, 0.035, hh, 5, C.leafDark, x, base, z));
        parts.push(rot(scl(sph(0.08, C.leaf, x + 0.07, base + hh * 0.5, z), 1, 0.3, 0.6), 0, 0, 0.4));
        parts.push(rot(scl(sph(0.08, C.leaf, x - 0.07, base + hh * 0.35, z), 1, 0.3, 0.6), 0, 0, -0.4));
        if (stage === 2) parts.push(ball(0.07, C.leafLight, x, base + hh, z));
        if (stage === 3) {
          const petals = [];
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2;
            const p = box(0.08, 0.1, 0.02, k % 2 ? C.yellow : '#ffb829', Math.cos(a) * 0.17, Math.sin(a) * 0.17 - 0.05, 0);
            p.rotation.z = a - Math.PI / 2;
            petals.push(p);
          }
          const disc = rot(cyl(0.16, 0.16, 0.03, 12, C.yellow), Math.PI / 2, 0, 0);
          disc.position.set(0, 0, 0);
          const center = rot(cyl(0.095, 0.095, 0.03, 10, '#6b3d1c'), Math.PI / 2, 0, 0);
          center.position.set(0, 0, 0.025);
          const head = group(petals, disc, center);
          head.position.set(x, base + hh, z + 0.03);
          head.rotation.set(-1.2, (r() - 0.5) * 0.6, 0);
          parts.push(head);
        }
      }
      break;
    }
    case 'tomato': {
      const s = [0, 0.55, 0.85, 1][stage];
      for (const [x, z] of grid(2, r, 0.45)) {
        parts.push(box(0.025, 0.5 * s, 0.025, C.woodDark, x + 0.08, base, z));
        parts.push(ball(0.16 * s, C.leaf, x, base + 0.2 * s, z));
        parts.push(ball(0.12 * s, C.leafDark, x + 0.06, base + 0.34 * s, z - 0.03));
        if (stage === 3) {
          for (let k = 0; k < 3; k++) parts.push(sph(0.055, '#e8402f', x + (r() - 0.5) * 0.22, base + 0.15 + r() * 0.25, z + 0.1 + r() * 0.05));
        } else if (stage === 2) parts.push(sph(0.04, '#9fd36a', x + 0.08, base + 0.25, z + 0.12));
      }
      break;
    }
    case 'strawberry': {
      const s = [0, 0.6, 0.85, 1][stage];
      for (const [x, z] of grid(2, r, 0.5)) {
        for (let k = 0; k < 4; k++) {
          const leaf = scl(sph(0.08 * s, k % 2 ? C.leaf : C.leafDark, x + Math.cos(k * 1.6) * 0.07, base + 0.07, z + Math.sin(k * 1.6) * 0.07), 1, 0.35, 1);
          parts.push(leaf);
        }
        if (stage >= 2) parts.push(ball(0.025, C.white, x, base + 0.13, z));
        if (stage === 3) {
          parts.push(rot(cone(0.05, 0.1, 6, '#e8304a', x + 0.09, base + 0.06, z + 0.06), Math.PI, 0, 0));
          parts.push(rot(cone(0.045, 0.09, 6, '#e8304a', x - 0.07, base + 0.06, z + 0.08), Math.PI, 0, 0));
        }
      }
      break;
    }
    case 'pumpkin': {
      const s = [0, 0.6, 0.9, 1][stage];
      for (let k = 0; k < 5; k++) {
        parts.push(scl(sph(0.11 * s, k % 2 ? C.leaf : C.leafDark, Math.cos(k * 1.3) * 0.25, base + 0.05, Math.sin(k * 1.3) * 0.25), 1, 0.35, 1));
      }
      parts.push(rot(box(0.6, 0.03, 0.03, C.leafDark, 0, base + 0.02, 0), 0, 0.7, 0));
      if (stage === 2) parts.push(scl(sph(0.12, '#a6c94a', 0.05, base + 0.08, 0.05), 1, 0.8, 1));
      if (stage === 3) {
        for (let k = 0; k < 6; k++) {
          const seg = scl(sph(0.13, k % 2 ? C.orange : '#e57a1c', Math.cos(k) * 0.08, base + 0.17, Math.sin(k) * 0.08), 0.8, 1.05, 0.8);
          parts.push(seg);
        }
        parts.push(cyl(0.025, 0.03, 0.1, 5, C.woodDark, 0, base + 0.3, 0));
      }
      break;
    }
  }
  const gr = group(parts);
  gr.rotation.y = r() * 0.4 - 0.2;
  return group(gr);
}

// ------------------------------------------------------------------ registry
export const BUILDERS = {
  farmhouse, orderboard, coop, cowbarn, sheepfold, bakery, dairy, loom,
  oak, pine, bush, flowers, fence, path, hay, scarecrow, lamp, bench, well, windmill,
  rock, tallgrass, reeds, cloud, truck, soil, butterfly, chimneySmoke,
  chicken, cow, sheep, dog,
  crop,
};

export { C as PALETTE };

// Building blocks for model modules. All sizes in tiles (1 unit = 1 tile); y=0 is the ground;
// a model's footprint is centered on the origin and its front faces +z.
export const H = { box, cyl, cone, ball, sph, roof, group, rot, scl, fenceRect, fencePost, fenceRail, groundPatch, smallHouse, sprouts, grid, hashRand, cm, mesh, g, C };
