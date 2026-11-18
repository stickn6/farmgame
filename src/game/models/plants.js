// Procedural models — see H in ../assets.js for helpers.
// New crops (potato, sugarcane, cotton, chili, lavender) and the fruit trees (tree:<fruit>:<stage>).
import * as THREE from 'three';
import { H, registerBuilders, registerCrops } from '../assets.js';

const { box, cyl, cone, ball, sph, rot, scl, grid, hashRand, C } = H;
// H.group only flattens one level; nested part lists are common here
const group = (...kids) => H.group(kids.flat(Infinity));

// ------------------------------------------------------------------ small helpers
// group with a transform (a pivot / hinge): children are placed in its local space
function pv(x, y, z, rx, ry, rz, ...kids) {
  const gr = group(...kids);
  gr.position.set(x, y, z);
  gr.rotation.set(rx, ry, rz);
  return gr;
}

const UP = new THREE.Vector3(0, 1, 0);
// tapered cylinder from point a to point b (radius ra at a, rb at b)
function stick(a, b, ra, rb, color, seg = 5) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const len = d.length();
  const gr = group(cyl(rb, ra, len, seg, color, 0, -len / 2, 0));
  gr.position.copy(A).add(B).multiplyScalar(0.5);
  gr.quaternion.setFromUnitVectors(UP, d.normalize());
  return gr;
}

// flat leaf blade lying along +x from the origin, tilted up by `lift`
const blade = (len, wid, color, lift = 0.3) => pv(0, 0, 0, 0, 0, lift, scl(sph(0.5, color, len / 2, 0, 0, 6, 4), len, 0.3 * wid, wid));

// ------------------------------------------------------------------ crops
// Signature: (stage 1..3, rng, { base }) => parts. Stage 3 is ripe.

function potato(stage, r, { base }) {
  const s = [0, 0.62, 0.86, 1][stage];
  const parts = [];
  const leafCols = [C.leaf, C.leafDark, '#6cb845'];
  const spudCols = ['#dcb478', '#cfa266', '#e6c48a'];
  for (const [x, z] of grid(2, r, 0.46)) {
    // hilled earth around each plant
    if (stage >= 2) parts.push(scl(sph(0.16, '#93613a', x, base - 0.01, z, 8, 4), 1, 0.32, 1));
    // leafy mound + radiating compound leaves
    parts.push(scl(ball(0.12 * s, C.leaf, x, base + 0.1 * s, z, 1), 1, 0.85, 1));
    const n = stage === 1 ? 4 : 6;
    const a0 = r() * 6;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2;
      parts.push(pv(x, base + 0.05 * s + (k % 2) * 0.04 * s, z, 0, a, 0, blade(0.2 * s, 0.11 * s, leafCols[k % 3], 0.35 + r() * 0.2)));
    }
    parts.push(ball(0.075 * s, C.leafDark, x + 0.03, base + 0.19 * s, z - 0.02));
    if (stage === 2) {
      parts.push(ball(0.022, '#e9f2d8', x + 0.02, base + 0.27, z + 0.03), ball(0.02, '#e9f2d8', x - 0.05, base + 0.25, z - 0.03));
    }
    if (stage === 3) {
      // potatoes peeking out of the soil, on the outer side of each plant
      const out = Math.atan2(z, x);
      for (let k = 0; k < 3; k++) {
        const a = out + (k - 1) * 0.85 + (r() - 0.5) * 0.3;
        const d = 0.15 + r() * 0.04;
        const p = scl(sph(k === 1 ? 0.068 : 0.058, spudCols[(k + Math.round(r() * 2)) % 3], 0, 0, 0, 7, 5), 1.4, 0.82, 1);
        parts.push(pv(x + Math.cos(a) * d, base + 0.02, z + Math.sin(a) * d, (r() - 0.5) * 0.4, r() * 3, 0.15, p));
      }
      // little white / lilac flowers on top
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + r();
        const fx = x + Math.cos(a) * 0.06, fz = z + Math.sin(a) * 0.06, fy = base + 0.25 + r() * 0.04;
        parts.push(ball(0.032, k === 1 ? '#b99be0' : C.white, fx, fy, fz), ball(0.014, C.yellow, fx, fy + 0.025, fz));
      }
    }
  }
  return parts;
}

// long leaf that rises from a node and arches over (two hinged segments)
function archLeaf(len, color, color2, rise = 0.7, droop = 0.9) {
  const l1 = len * 0.5, l2 = len * 0.6;
  return pv(0, 0, 0, 0, 0, -rise,
    box(0.012, l1, 0.046, color, 0, 0, 0),
    // flattened 4-sided cone = tapering blade tip (broad side faces up once it bends over)
    pv(0, l1, 0, 0, 0, -droop, scl(cone(0.033, l2, 4, color2, 0, 0, 0), 0.3, 1, 1)),
  );
}

function sugarcane(stage, r, { base }) {
  const ripe = stage === 3;
  const H0 = [0, 0.34, 0.66, 0.92][stage];
  const cane = ripe ? '#dccf6a' : stage === 2 ? '#93c456' : '#86c04e';
  const joint = ripe ? '#a08c3e' : '#4f8a32';
  const leafA = ripe ? '#9cc455' : C.leaf, leafB = ripe ? '#c2d66a' : C.leafLight;
  const parts = [];
  for (const [x, z] of grid(2, r, 0.46)) {
    for (let c = 0; c < 2; c++) {
      const h = H0 * (0.86 + r() * 0.2) * (c ? 0.85 : 1);
      const kids = [cyl(0.024, 0.03, h, 6, cane, 0, 0, 0)];
      const seg = 0.15;
      for (let y = seg; y < h - 0.06; y += seg) kids.push(cyl(0.033, 0.033, 0.02, 6, joint, 0, y, 0));
      // side leaves from the upper nodes
      const nLeaves = stage === 1 ? 1 : 3;
      for (let k = 0; k < nLeaves; k++) {
        const y = h * (0.4 + k * 0.17);
        kids.push(pv(0, y, 0, 0, r() * 6.3, 0, archLeaf(0.24 + 0.16 * H0, k % 2 ? leafA : leafB, leafA, 0.45 + r() * 0.3, 1.0)));
      }
      // leafy crown on top
      const nTop = stage === 1 ? 3 : 4;
      const t0 = r() * 6;
      for (let k = 0; k < nTop; k++) kids.push(pv(0, h - 0.02, 0, 0, t0 + (k / nTop) * 6.28, 0, archLeaf(0.24 * (0.6 + H0 * 0.4), leafB, leafA, 0.3 + r() * 0.25, 0.9)));
      if (ripe) kids.push(cone(0.04, 0.12, 4, leafB, 0, h - 0.02, 0));
      const ox = (r() - 0.5) * 0.12, oz = (r() - 0.5) * 0.12;
      parts.push(pv(x + ox, base, z + oz, (r() - 0.5) * 0.18, r() * 6, (r() - 0.5) * 0.18, kids));
    }
  }
  return parts;
}

function cotton(stage, r, { base }) {
  const s = [0, 0.6, 0.86, 1][stage];
  const STEM = '#8a6442';
  const leafCols = stage === 3 ? ['#3f7a35', '#356b2e', '#7a5a3a'] : ['#3f7a35', '#356b2e', '#4a8a3c'];
  const parts = [];
  for (const [x, z] of grid(2, r, 0.46)) {
    const h = 0.42 * s;
    const top = [x + (r() - 0.5) * 0.03, base + h, z + (r() - 0.5) * 0.03];
    parts.push(stick([x, base, z], top, 0.022, 0.012, STEM));
    const tips = [top];
    const a0 = r() * 6;
    for (let b = 0; b < 3; b++) {
      const a = a0 + b * 2.1 + (r() - 0.5) * 0.4;
      const by = base + h * (0.32 + b * 0.16);
      const len = 0.17 * s;
      const tip = [x + Math.cos(a) * len, by + len * 0.75, z + Math.sin(a) * len];
      parts.push(stick([x, by, z], tip, 0.012, 0.008, STEM));
      tips.push(tip);
      // dark leaves along the branch
      const mx = x + Math.cos(a) * len * 0.45, mz = z + Math.sin(a) * len * 0.45;
      parts.push(pv(mx, by + len * 0.3, mz, 0, a + 0.9, 0, blade(0.13 * s, 0.1 * s, leafCols[b % 3], 0.2)));
      parts.push(pv(mx, by + len * 0.35, mz, 0, a - 0.9, 0, blade(0.12 * s, 0.09 * s, leafCols[(b + 1) % 2], 0.25)));
    }
    if (stage === 1) parts.push(ball(0.06, leafCols[0], top[0], top[1], top[2]));
    for (const [tx, ty, tz] of tips) {
      if (stage === 2) {
        parts.push(scl(sph(0.035, '#8fb35a', tx, ty + 0.02, tz, 6, 5), 1, 1.3, 1));
        if (r() > 0.55) parts.push(ball(0.03, '#f7eccb', tx + 0.02, ty + 0.06, tz));
      } else if (stage === 3) {
        // fluffy boll sitting in a brown husk
        parts.push(rot(cone(0.055, 0.05, 5, '#6e4a2c', tx, ty - 0.045, tz), Math.PI, 0, 0));
        parts.push(ball(0.06, C.white, tx, ty + 0.035, tz, 0));
        parts.push(ball(0.045, '#f1eee6', tx + 0.035, ty + 0.025, tz + 0.02, 0));
        parts.push(ball(0.042, '#fdfdfa', tx - 0.03, ty + 0.03, tz - 0.025, 0));
      }
    }
  }
  return parts;
}

// one chili hanging from (0,0,0): green cap, red body, curved tip
function chiliPod(color, len = 0.15, bend = 0.35) {
  const body = len * 0.55, tip = len * 0.5;
  return group(
    cyl(0.012, 0.014, 0.04, 4, C.leafDark, 0, -0.01, 0),
    cyl(0.034, 0.026, 0.03, 6, C.leafDark, 0, -0.035, 0),
    cyl(0.037, 0.028, body, 6, color, 0, -0.035 - body, 0),
    box(0.009, body * 0.7, 0.016, '#ff8f78', 0.032, -0.035 - body * 0.8, 0),
    pv(0, -0.035 - body, 0, 0, 0, bend, rot(cone(0.028, tip, 6, color, 0, -tip, 0), Math.PI, 0, 0)),
  );
}

function chili(stage, r, { base }) {
  const s = [0, 0.6, 0.86, 1][stage];
  const reds = ['#e2302a', '#cf2420', '#f0452c'];
  const parts = [];
  for (const [x, z] of grid(2, r, 0.46)) {
    parts.push(box(0.024, 0.16 * s, 0.024, C.leafDark, x, base, z));
    parts.push(ball(0.11 * s, C.leaf, x, base + 0.2 * s, z));
    parts.push(ball(0.085 * s, C.leafDark, x + 0.06 * s, base + 0.27 * s, z - 0.03 * s));
    parts.push(ball(0.08 * s, '#6dba48', x - 0.055 * s, base + 0.26 * s, z + 0.045 * s));
    if (stage === 2) {
      for (let k = 0; k < 2; k++) {
        const a = r() * 6.3;
        parts.push(pv(x + Math.cos(a) * 0.1, base + 0.22, z + Math.sin(a) * 0.1, 0, -a, 0, scl(chiliPod('#79b84a', 0.09, 0.2), 0.8)));
      }
      parts.push(ball(0.025, C.white, x + 0.02, base + 0.33, z + 0.05), ball(0.011, C.yellow, x + 0.02, base + 0.35, z + 0.05));
    }
    if (stage === 3) {
      // pods sprout from the top of the bush and lie out flat-ish over its sides,
      // so their whole length shows from the high camera; tips curl down
      const n = 6;
      const a0 = r() * 6.3;
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * Math.PI * 2 + (r() - 0.5) * 0.4;
        const d = 0.08 + r() * 0.02;
        const py = base + 0.3 + r() * 0.05;
        // hinge tilts the pod outward (local +x after the y-rotation)
        parts.push(pv(x + Math.cos(a) * d, py, z - Math.sin(a) * d, 0, a, 0.95 + r() * 0.3, chiliPod(reds[k % 3], 0.17 + r() * 0.03, -0.4)));
      }
    }
  }
  return parts;
}

function lavender(stage, r, { base }) {
  const s = [0, 0.6, 0.86, 1][stage];
  const greys = ['#8ea889', '#a2b79c', '#7d9879'];
  const purples = ['#8a62c4', '#9b74d8', '#7650b6', '#a885e0'];
  const parts = [];
  for (const [x, z] of grid(2, r, 0.46)) {
    parts.push(scl(ball(0.08 * s, '#6f8a6c', x, base + 0.04 * s, z, 0), 1, 0.8, 1));
    // narrow grey-green leaves
    const nl = stage === 1 ? 7 : 8;
    for (let k = 0; k < nl; k++) {
      const a = (k / nl) * 6.28 + r() * 0.5;
      parts.push(pv(x, base + 0.02, z, 0, a, 0, pv(0, 0, 0, 0, 0, -0.35 - r() * 0.55, cone(0.02, 0.15 * s + 0.05, 3, greys[k % 3], 0, 0, 0))));
    }
    if (stage === 1) continue;
    // flower stems fanning out of the clump
    const n = stage === 2 ? 7 : 11;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.28 + r() * 0.6;
      const tilt = k === 0 ? 0.05 : 0.15 + r() * 0.35;
      const len = 0.27 * s * (0.85 + r() * 0.3);
      const kids = [box(0.012, len, 0.012, greys[0], 0, 0, 0)];
      if (stage === 2) kids.push(cyl(0.012, 0.018, 0.07, 5, '#a8a3bf', 0, len, 0));
      else {
        const pc = purples[Math.floor(r() * 4)];
        kids.push(cyl(0.016, 0.023, 0.11, 5, pc, 0, len, 0), cone(0.016, 0.04, 5, pc, 0, len + 0.11, 0));
      }
      parts.push(pv(x, base + 0.04, z, 0, a, 0, pv(0, 0, 0, 0, 0, -tilt, kids)));
    }
  }
  return parts;
}

registerCrops({ potato, sugarcane, cotton, chili, lavender });

// ------------------------------------------------------------------ fruit trees
// tree:<apple|cherry|peach>:<sapling|young|grown|fruit|dead>. 1 tile; canopy overhangs to ~1.3.
const SPECIES = {
  apple: { seed: 11, trunk: '#7a5232', leaves: ['#5fae3e', '#4f9b36', '#6fbd48'], tag: '#d8342b' },
  cherry: { seed: 23, trunk: '#6c4232', leaves: ['#3f8a35', '#347a2e', '#4b9a3e'], tag: '#a8182a' },
  peach: { seed: 37, trunk: '#82603f', leaves: ['#8cc44c', '#7ab53f', '#a2d160'], tag: '#f59a5a' },
};

// canopy as a list of [x, y, z, radius] blobs
function canopyBlobs(fruit, r) {
  const j = () => (r() - 0.5) * 0.06;
  if (fruit === 'cherry') {
    // a little taller and more oval
    const out = [[0, 1.17, 0, 0.42], [0.02, 1.46, -0.02, 0.27], [-0.12, 1.36, 0.12, 0.2]];
    for (let k = 0; k < 5; k++) {
      const a = k * 1.2566 + 0.3;
      out.push([Math.cos(a) * 0.29 + j(), 1.04 + (k % 2) * 0.16 + j(), Math.sin(a) * 0.29 + j(), 0.27]);
    }
    return out;
  }
  if (fruit === 'peach') {
    // wider, open vase shape
    const out = [[0, 1.12, 0, 0.38], [0.04, 1.38, 0.02, 0.25]];
    for (let k = 0; k < 6; k++) {
      const a = k * 1.0472 + 0.2;
      out.push([Math.cos(a) * 0.37 + j(), 1.08 + (k % 2) * 0.13 + j(), Math.sin(a) * 0.37 + j(), 0.27]);
    }
    return out;
  }
  // apple: big round crown
  const out = [[0, 1.15, 0, 0.46], [0.05, 1.42, -0.04, 0.28]];
  for (let k = 0; k < 5; k++) {
    const a = k * 1.2566 + 0.6;
    out.push([Math.cos(a) * 0.33 + j(), 1.0 + (k % 2) * 0.17 + j(), Math.sin(a) * 0.33 + j(), 0.3]);
  }
  return out;
}

// points on the OUTER surface of a blob canopy (not buried inside another blob)
function surfacePoints(blobs, n, r, { minDist = 0.15, yMin = -0.45, yMax = 0.9, lift = 0.02 } = {}) {
  const pts = [];
  for (let tries = 0; tries < 600 && pts.length < n; tries++) {
    const b = blobs[Math.floor(r() * blobs.length)];
    const y = yMin + r() * (yMax - yMin);
    const a = r() * Math.PI * 2;
    const h = Math.sqrt(1 - y * y);
    const dir = [Math.cos(a) * h, y, Math.sin(a) * h];
    const d = b[3] * 0.94 + lift;
    const p = [b[0] + dir[0] * d, b[1] + dir[1] * d, b[2] + dir[2] * d];
    let ok = true;
    for (const o of blobs) if (o !== b && Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]) < o[3] * 0.97) { ok = false; break; }
    if (ok) for (const q of pts) if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < minDist) { ok = false; break; }
    if (ok) pts.push(p.concat([a]));
  }
  return pts;
}

const mulch = (rad) => cyl(rad, rad + 0.03, 0.025, 10, '#8f6a42', 0, 0, 0);

// little stake with a tie + a plant label that shows the fruit color
function stakeAndTag(sp, h, tieY) {
  return [
    rot(box(0.035, h, 0.035, C.woodLight, -0.09, 0, -0.04), 0, 0, 0.04),
    box(0.11, 0.03, 0.05, C.straw, -0.045, tieY, -0.03),
    box(0.015, 0.16, 0.015, C.woodDark, 0.17, 0, 0.17),
    rot(box(0.11, 0.07, 0.015, C.cream, 0.17, 0.13, 0.17), 0, 0.785, 0),
    rot(box(0.04, 0.04, 0.02, sp.tag, 0.17, 0.145, 0.17), 0, 0.785, 0),
  ];
}

function sapling(sp, r) {
  const L = sp.leaves;
  const parts = [
    mulch(0.24),
    scl(sph(0.13, '#7a5232', 0, 0.01, 0, 8, 4), 1, 0.3, 1),
    stick([0, 0, 0], [0.015, 0.44, 0.01], 0.024, 0.014, sp.trunk),
    stick([0.01, 0.27, 0], [0.1, 0.36, 0.03], 0.012, 0.008, sp.trunk),
    stakeAndTag(sp, 0.5, 0.26),
    ball(0.07, L[0], 0.015, 0.47, 0.01),
  ];
  const leafSpots = [[0.015, 0.4, 0.01, 0], [0.015, 0.44, 0.01, 2.1], [0.015, 0.36, 0.01, 4.0], [0.1, 0.36, 0.03, 0.4], [0.1, 0.36, 0.03, 5.5]];
  leafSpots.forEach(([x, y, z, a], k) => parts.push(pv(x, y, z, 0, a + r() * 0.3, 0, blade(0.13, 0.08, L[k % 3], 0.45))));
  return group(parts);
}

function young(sp, fruit, r) {
  const L = sp.leaves;
  const spread = fruit === 'peach' ? 1.15 : 1;
  const parts = [
    mulch(0.3),
    cyl(0.035, 0.055, 0.58, 6, sp.trunk, 0, 0, 0),
    stick([0, 0.4, 0], [0.13 * spread, 0.58, 0.04], 0.025, 0.015, sp.trunk),
    stick([0, 0.45, 0], [-0.11 * spread, 0.62, -0.06], 0.022, 0.014, sp.trunk),
    stakeAndTag(sp, 0.55, 0.3),
    ball(0.25, L[0], 0, 0.74, 0, 1),
    ball(0.18, L[1], 0.15 * spread, 0.66, 0.06, 1),
    ball(0.18, L[2], -0.13 * spread, 0.68, -0.08, 1),
    ball(0.17, L[2], 0.04, 0.86, 0.1, 1),
    ball(0.15, L[1], -0.02, 0.9, -0.08, 1),
  ];
  return group(parts);
}

function trunkAndBranches(sp, r) {
  return [
    mulch(0.3),
    cyl(0.07, 0.11, 0.85, 7, sp.trunk, 0, 0, 0),
    cyl(0.12, 0.15, 0.07, 7, sp.trunk, 0, 0, 0),
    stick([0, 0.55, 0], [0.24, 0.92, 0.1], 0.05, 0.03, sp.trunk),
    stick([0, 0.6, 0], [-0.22, 0.95, -0.08], 0.05, 0.03, sp.trunk),
    stick([0, 0.66, 0], [0.04, 1.0, -0.24], 0.045, 0.03, sp.trunk),
  ];
}

function crown(sp, blobs) {
  const L = sp.leaves;
  return blobs.map(([x, y, z, rad], k) => ball(rad, L[k === 0 ? 0 : k % 3], x, y, z, 1));
}

function grownTree(fruit, sp, r, withFruit) {
  const blobs = canopyBlobs(fruit, r);
  const parts = [trunkAndBranches(sp, r), crown(sp, blobs)];
  if (!withFruit) {
    // 'grown' is shown while fruit is on its way: every species blossoms and sets
    // a few small green fruitlets, so a working fruit tree never reads as a plain oak
    if (fruit === 'cherry') {
      // clusters of pink blossom
      for (const [x, y, z] of surfacePoints(blobs, 26, r, { minDist: 0.12, yMin: -0.2, yMax: 0.95, lift: 0.03 })) {
        const c1 = r() > 0.35 ? C.pink : '#fbd6e2', c2 = c1 === C.pink ? '#fbd6e2' : C.pink;
        const ox = r() > 0.5 ? 0.035 : -0.035, oz = r() > 0.5 ? 0.035 : -0.035;
        parts.push(ball(0.045, c1, x, y, z), ball(0.035, c2, x + ox, y + 0.01, z + oz));
      }
    } else if (fruit === 'apple') {
      // white blossom with a pink blush
      for (const [x, y, z] of surfacePoints(blobs, 18, r, { minDist: 0.13, yMin: -0.2, yMax: 0.95, lift: 0.03 })) {
        parts.push(ball(0.05, r() > 0.3 ? '#fdf6f0' : '#f6c6d3', x, y, z));
      }
    } else {
      // deep-pink peach blossom
      for (const [x, y, z] of surfacePoints(blobs, 18, r, { minDist: 0.13, yMin: -0.2, yMax: 0.95, lift: 0.03 })) {
        parts.push(ball(0.05, r() > 0.4 ? '#e86a9a' : '#f7b3c9', x, y, z));
      }
    }
    const setCol = { apple: '#a8cf5a', cherry: '#9cc552', peach: '#cfd77a' }[fruit];
    for (const [x, y, z] of surfacePoints(blobs, 6, r, { minDist: 0.2, yMin: -0.5, yMax: 0.4, lift: 0.02 })) {
      parts.push(sph(fruit === 'cherry' ? 0.032 : 0.04, setCol, x, y, z, 6, 4));
    }
    return group(parts);
  }
  if (fruit === 'apple') {
    const reds = ['#d8342b', '#e2463a', '#c52a24'];
    for (const [x, y, z] of surfacePoints(blobs, 17, r, { minDist: 0.17, lift: 0.025 })) {
      parts.push(sph(0.078, reds[Math.floor(r() * 3)], x, y, z, 8, 6), box(0.015, 0.05, 0.015, C.woodDark, x, y + 0.06, z));
    }
  } else if (fruit === 'cherry') {
    for (const [x, y, z, a] of surfacePoints(blobs, 13, r, { minDist: 0.17, lift: 0.03 })) {
      const c1 = r() > 0.5 ? '#b3182c' : '#a01428';
      parts.push(pv(x, y, z, 0, -a + Math.PI / 2, 0,
        sph(0.048, c1, 0.042, 0, 0, 7, 5), sph(0.048, '#c42234', -0.042, -0.015, 0, 7, 5),
        stick([0.04, 0.035, 0], [0, 0.12, 0], 0.007, 0.006, C.leafDark, 3),
        stick([-0.04, 0.02, 0], [0, 0.12, 0], 0.007, 0.006, C.leafDark, 3),
        box(0.06, 0.012, 0.03, C.leafDark, 0.02, 0.115, 0),
      ));
    }
  } else {
    const peach = ['#f8a65a', '#f59a52', '#fbb46a'];
    for (const [x, y, z, a] of surfacePoints(blobs, 15, r, { minDist: 0.19, lift: 0.03 })) {
      // orange-pink fruit with a rosy blush facing outward
      const bx = Math.cos(a) * 0.035, bz = Math.sin(a) * 0.035;
      parts.push(sph(0.085, peach[Math.floor(r() * 3)], x, y, z, 8, 6), sph(0.06, '#ee6f5e', x + bx, y + 0.01, z + bz, 7, 5));
    }
  }
  // windfalls on the ground
  const fallen = [[0.36, 0.3], [-0.3, 0.38]];
  for (const [fx, fz] of fallen) {
    if (fruit === 'apple') parts.push(sph(0.075, '#d8342b', fx, 0.07, fz, 8, 6), box(0.015, 0.04, 0.015, C.woodDark, fx, 0.13, fz));
    else if (fruit === 'cherry') parts.push(sph(0.048, '#b3182c', fx, 0.045, fz, 7, 5), sph(0.048, '#a01428', fx + 0.08, 0.045, fz - 0.03, 7, 5));
    else parts.push(sph(0.08, '#f8a65a', fx, 0.075, fz, 8, 6), sph(0.056, '#ee6f5e', fx + 0.03, 0.09, fz + 0.03, 7, 5));
  }
  return group(parts);
}

function deadTree(sp, r) {
  const BARK = '#8a7b6c', DARK = '#6b5d50', LIGHT = '#b3a28c';
  // snapped branch: a stick with a pale broken tip
  const limb = (a, b, ra, rb, col = BARK) => [stick(a, b, ra, rb, col), ball(rb * 1.15, LIGHT, b[0], b[1], b[2])];
  const parts = [
    mulch(0.3),
    // roots
    ...[0.3, 1.9, 3.4, 4.8].map((a) => pv(0, 0, 0, 0, a, 0, pv(0.08, 0.04, 0, 0, 0, -0.35, box(0.2, 0.06, 0.07, DARK, 0.06, -0.03, 0)))),
    cyl(0.12, 0.15, 0.08, 7, BARK, 0, 0, 0),
    stick([0, 0, 0], [0.03, 0.88, -0.02], 0.11, 0.07, BARK, 7),
    // jagged snapped top
    rot(cone(0.05, 0.14, 4, LIGHT, 0.05, 0.85, -0.02), 0, 0, -0.2),
    rot(cone(0.035, 0.1, 4, BARK, -0.01, 0.84, 0.01), 0.2, 0, 0.25),
    // knot hole facing the camera
    box(0.07, 0.1, 0.03, '#3e342c', 0.02, 0.36, 0.095),
    // bare, broken branches spreading out
    limb([0.02, 0.5, 0], [0.4, 0.8, 0.12], 0.05, 0.024),
    limb([0.24, 0.68, 0.07], [0.3, 0.94, 0.02], 0.02, 0.012, DARK),
    limb([0.02, 0.6, 0], [-0.38, 0.84, -0.12], 0.048, 0.024),
    limb([-0.22, 0.74, -0.07], [-0.26, 0.98, 0.04], 0.02, 0.012, DARK),
    limb([0.03, 0.7, 0], [0.1, 0.94, -0.34], 0.04, 0.02),
    limb([0.02, 0.38, 0], [-0.22, 0.5, 0.2], 0.035, 0.022, DARK),
    // a fallen branch and a few dry leaves
    stick([-0.12, 0.03, 0.36], [0.3, 0.03, 0.27], 0.032, 0.022, DARK),
    stick([0.1, 0.03, 0.32], [0.18, 0.04, 0.42], 0.014, 0.01, DARK, 4),
    box(0.07, 0.015, 0.05, '#b98a4a', -0.3, 0, 0.12), box(0.06, 0.015, 0.05, '#a8713a', 0.32, 0, -0.18), box(0.07, 0.015, 0.05, '#c79a55', -0.12, 0, -0.34),
    // mushrooms by the stump
    cyl(0.015, 0.018, 0.05, 5, C.cream, -0.15, 0, 0.12), scl(sph(0.04, '#c8573a', -0.15, 0.06, 0.12, 7, 4), 1, 0.6, 1),
    cyl(0.012, 0.014, 0.035, 5, C.cream, -0.08, 0, 0.18), scl(sph(0.03, '#d97a4a', -0.08, 0.045, 0.18, 7, 4), 1, 0.6, 1),
  ];
  return group(parts);
}

function tree(fruit = 'apple', stage = 'grown') {
  const sp = SPECIES[fruit] || SPECIES.apple;
  const r = hashRand(sp.seed * 31 + stage.length);
  let body;
  if (stage === 'sapling') body = sapling(sp, r);
  else if (stage === 'young') body = young(sp, fruit, r);
  else if (stage === 'dead') body = deadTree(sp, r);
  else body = grownTree(fruit, sp, r, stage === 'fruit');
  return group(body);
}

registerBuilders({ tree });
