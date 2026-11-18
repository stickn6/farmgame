// Procedural models — see H in ../assets.js for helpers.
// Premium late-game decorations: bird bath, picnic table, flower arch, fountain,
// gazebo, golden rooster statue and a tethered hot air balloon.
import * as THREE from 'three';
import { H, registerBuilders } from '../assets.js';

const { box, cyl, cone, ball, sph, group, rot, scl, hashRand, mesh, g, C } = H;

// extra palette for this file
const K = {
  stoneL: '#d6d1c4', water: '#5db5e4', waterL: '#a8def6', foam: '#eef9ff',
  gold: '#f2c14e', goldD: '#c9962e', goldL: '#ffdc7e',
  wicker: '#c99a55', wickerD: '#9c6c36', leather: '#7a4a2a',
  terracotta: '#c8693c', terracottaD: '#a8532e', rose: '#ec6f93', sand: '#d8c49a',
  crust: '#d9a25a', crustL: '#ecc37a', metal: '#6b6f78',
};

// ------------------------------------------------------------------ local helpers
const TAU = Math.PI * 2;
const v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// thin box spanning point a -> b (ropes, struts, slanted legs)
function beam(a, b, t, color, bucket) {
  v3.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = Math.round(v3.length() * 1000) / 1000;
  const m = box(t, len, t, color, 0, 0, 0, bucket);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(UP, v3.normalize());
  return m;
}
// torus centered at (x,y,z), lying in its local XY plane (rotate x=PI/2 to lay flat)
const torus = (R, r, rs, ts, color, x = 0, y = 0, z = 0, arc = TAU) =>
  mesh(g(`dt${R}|${r}|${rs}|${ts}|${arc}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc)), color, x, y, z);
// cone that glows at night (flames)
const glowCone = (r, h, seg, color, x = 0, y = 0, z = 0) =>
  mesh(g(`k${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)), color, x, y + h / 2, z, 'glow');
// flat ring lying on the ground plane, centered at y
const ring = (R, r, color, y, ts = 16, rs = 4) => rot(torus(R, r, rs, ts, color, 0, y, 0), Math.PI / 2, 0, 0);
function keep(obj, name) { obj.userData.keep = true; obj.name = name; return obj; }
const at = (obj, x, y, z, ry = 0) => { obj.position.set(x, y, z); obj.rotation.y = ry; return obj; };

// little flower clump: leaves + a few blossoms (bottom at y=0)
function flowerTuft(r, cols, s = 1) {
  const parts = [ball(0.07 * s, r() < 0.5 ? C.leaf : C.leafDark, 0, 0.05 * s, 0)];
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU;
    parts.push(ball(0.035 * s, cols[Math.floor(r() * cols.length)], Math.cos(a) * 0.05 * s, 0.1 * s, Math.sin(a) * 0.05 * s));
  }
  return group(parts);
}

// small songbird facing +z, feet at y=0
function bird(body, breast, wing) {
  return group(
    scl(sph(0.06, body, 0, 0.075, 0), 0.85, 0.8, 1.15),
    scl(sph(0.045, breast, 0, 0.065, 0.035), 0.9, 0.85, 0.8),
    sph(0.043, body, 0, 0.13, 0.05),
    rot(cone(0.017, 0.05, 4, C.orange, 0, 0.1, 0.09), Math.PI / 2, 0, 0),
    rot(box(0.05, 0.014, 0.085, wing, 0, 0.07, -0.08), 0.3, 0, 0),
    scl(sph(0.04, wing, 0.048, 0.08, -0.005), 0.35, 0.7, 1.25),
    scl(sph(0.04, wing, -0.048, 0.08, -0.005), 0.35, 0.7, 1.25),
    box(0.014, 0.014, 0.012, C.black, 0.03, 0.135, 0.085), box(0.014, 0.014, 0.012, C.black, -0.03, 0.135, 0.085),
    box(0.012, 0.035, 0.012, C.orange, 0.02, 0, 0), box(0.012, 0.035, 0.012, C.orange, -0.02, 0, 0),
  );
}

// ------------------------------------------------------------------ bird bath (1x1)
function birdbath() {
  const r = hashRand(71);
  const parts = [
    cyl(0.29, 0.32, 0.07, 8, C.stoneDark, 0, 0, 0),
    cyl(0.19, 0.25, 0.1, 8, C.stone, 0, 0.07, 0),
    cyl(0.085, 0.12, 0.3, 8, C.stone, 0, 0.17, 0),
    cyl(0.13, 0.13, 0.04, 8, K.stoneL, 0, 0.27, 0),
    cyl(0.12, 0.09, 0.06, 8, K.stoneL, 0, 0.44, 0),
    cyl(0.37, 0.14, 0.13, 10, C.stone, 0, 0.49, 0),
    cyl(0.33, 0.33, 0.03, 10, K.water, 0, 0.6, 0),
    rot(torus(0.355, 0.04, 4, 10, K.stoneL, 0, 0.625, 0), Math.PI / 2, 0, 0),
    // ripples + splash around the bathing finch
    ring(0.12, 0.008, K.foam, 0.632, 10, 3),
    ball(0.018, K.waterL, -0.14, 0.7, -0.02), ball(0.014, K.foam, -0.02, 0.72, -0.15), ball(0.016, K.waterL, -0.16, 0.74, -0.14),
  ];
  // bluebird perched on the rim, facing out toward the viewer
  const a = 0.75;
  parts.push(at(bird(C.blue, '#f3a35c', C.blueDark), Math.sin(a) * 0.36, 0.655, Math.cos(a) * 0.36, a));
  // yellow finch splashing in the water
  parts.push(at(bird(C.yellow, '#fff1a0', '#d9a72a'), -0.09, 0.6, -0.08, 2.2));
  // flowers around the foot
  const cols = [C.pink, C.white, C.yellow, C.purple];
  for (let i = 0; i < 5; i++) {
    const ang = 0.5 + i * 1.25 + r() * 0.3;
    parts.push(at(flowerTuft(r, cols, 1.1), Math.sin(ang) * 0.38, 0, Math.cos(ang) * 0.38));
  }
  return group(parts);
}

// ------------------------------------------------------------------ picnic table (2x2)
function picnic() {
  const P = [];
  const TY = 0.56; // table top surface
  for (let i = 0; i < 4; i++) P.push(box(1.4, 0.05, 0.165, i % 2 ? C.wood : C.plank, 0, TY - 0.05, -0.2625 + i * 0.175));
  for (const s of [-1, 1]) {
    P.push(box(1.4, 0.05, 0.13, C.wood, 0, 0.29, s * 0.55), box(1.4, 0.05, 0.13, C.plank, 0, 0.29, s * 0.69));
  }
  for (const x of [-0.55, 0.55]) {
    P.push(box(0.07, 0.06, 1.56, C.woodDark, x, 0.23, 0), box(0.07, 0.06, 0.66, C.woodDark, x, TY - 0.11, 0));
    for (const s of [-1, 1]) P.push(beam([x, 0, s * 0.5], [x, TY - 0.06, s * 0.12], 0.07, C.woodDark));
  }
  // red & white checkered cloth, draped over the long edges
  const S = TY + 0.012;
  for (let i = 0; i < 8; i++) {
    const x = -0.525 + i * 0.15;
    for (let j = 0; j < 5; j++) P.push(box(0.15, 0.012, 0.15, (i + j) % 2 ? C.red : C.white, x, TY, -0.3 + j * 0.15));
    P.push(box(0.15, 0.13, 0.012, (i + 5) % 2 ? C.red : C.white, x, TY - 0.118, 0.381));
    P.push(box(0.15, 0.13, 0.012, (i + 1) % 2 ? C.red : C.white, x, TY - 0.118, -0.381));
  }
  // cherry pie with lattice
  const px = -0.3, pz = 0.04;
  P.push(
    cyl(0.17, 0.15, 0.015, 12, C.white, px, S, pz),
    cyl(0.14, 0.12, 0.06, 12, K.crust, px, S + 0.015, pz),
    cyl(0.122, 0.122, 0.01, 12, '#b8283f', px, S + 0.07, pz),
  );
  for (const [o, l] of [[-0.065, 0.2], [0, 0.25], [0.065, 0.2]]) {
    P.push(box(l, 0.014, 0.024, K.crustL, px, S + 0.075, pz + o), box(0.024, 0.014, l, K.crustL, px + o, S + 0.077, pz));
  }
  // wicker basket with a baguette and an apple peeking out
  const basket = group(
    box(0.34, 0.18, 0.24, K.wicker, 0, 0, 0),
    box(0.352, 0.03, 0.252, K.wickerD, 0, 0.05, 0), box(0.352, 0.03, 0.252, K.wickerD, 0, 0.12, 0),
    rot(box(0.34, 0.02, 0.125, K.wickerD, 0, 0.18, -0.06), -0.25, 0, 0),
    box(0.3, 0.012, 0.11, C.red, 0, 0.175, 0.06),
    rot(scl(sph(0.04, K.crust, 0.07, 0.24, 0.05), 1, 1, 3.2), -0.6, 0.5, 0),
    ball(0.05, C.red, -0.08, 0.21, 0.06), box(0.01, 0.03, 0.01, C.woodDark, -0.08, 0.25, 0.06),
    torus(0.13, 0.016, 4, 8, K.wickerD, 0, 0.18, 0, Math.PI),
  );
  P.push(at(basket, 0.33, S, -0.07, 0.15));
  // lemonade pitcher & cups
  P.push(
    cyl(0.062, 0.072, 0.19, 8, '#fff3a6', -0.02, S, -0.2), cyl(0.064, 0.064, 0.02, 8, C.white, -0.02, S + 0.18, -0.2),
    box(0.02, 0.11, 0.035, '#fff3a6', -0.095, S + 0.04, -0.2),
    rot(cyl(0.04, 0.04, 0.012, 8, C.yellow, 0.0, S + 0.12, -0.14), 0.4, 0, 0),
  );
  const cup = (x, z, col) => [cyl(0.042, 0.032, 0.09, 8, col, x, S, z), cyl(0.035, 0.035, 0.004, 8, '#ffe066', x, S + 0.088, z)];
  P.push(...cup(0.06, 0.22, C.blue), ...cup(-0.6, -0.12, C.white));
  // plate with a watermelon slice
  const wedge = (r, h) => g(`dwm${r}|${h}`, () => new THREE.CylinderGeometry(r, r, h, 8, 1, false, 0, Math.PI));
  P.push(
    cyl(0.12, 0.1, 0.014, 10, C.white, 0.3, S, 0.22),
    rot(mesh(wedge(0.095, 0.035), '#4f9e3c', 0.3, S + 0.032, 0.18), 0, 0.3, 0),
    rot(mesh(wedge(0.08, 0.04), '#f0566a', 0.3, S + 0.034, 0.18), 0, 0.3, 0),
    box(0.012, 0.006, 0.02, C.black, 0.32, S + 0.054, 0.22), box(0.012, 0.006, 0.02, C.black, 0.27, S + 0.054, 0.21),
  );
  // plate with a sandwich
  const sand = group(
    box(0.13, 0.025, 0.13, '#efd29a', 0, 0, 0), box(0.145, 0.012, 0.145, '#7cc35a', 0, 0.025, 0),
    box(0.12, 0.012, 0.12, '#e8564a', 0, 0.037, 0), box(0.13, 0.025, 0.13, '#efd29a', 0, 0.049, 0),
  );
  P.push(cyl(0.12, 0.1, 0.014, 10, C.white, -0.55, S, 0.2), at(sand, -0.55, S + 0.014, 0.2, 0.5));
  // dandelions in the grass
  const r = hashRand(5);
  for (const [x, z] of [[0.85, 0.8], [-0.88, -0.75], [0.82, -0.82]]) P.push(at(flowerTuft(r, [C.yellow, C.white], 1), x, 0, z));
  return group(P);
}

// ------------------------------------------------------------------ flower arch (2x1)
function flowerarch() {
  const P = [];
  const r = hashRand(23);
  const PH = 1.22, R = 0.8, W = C.white;
  // planters the posts stand in
  for (const x of [-R, R]) {
    P.push(box(0.34, 0.2, 0.52, C.woodDark, x, 0, 0), box(0.36, 0.04, 0.54, C.wood, x, 0.2, 0), box(0.3, 0.02, 0.46, C.soil, x, 0.2, 0));
    for (const zs of [-1, 1]) P.push(box(0.065, PH, 0.065, W, x, 0, zs * 0.16));
    for (const y of [0.45, 0.75, 1.05]) P.push(box(0.05, 0.04, 0.38, W, x, y, 0));
  }
  // curved top: two arcs tied by slats
  for (const zs of [-1, 1]) P.push(torus(R, 0.035, 4, 14, W, 0, PH, zs * 0.16, Math.PI));
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * Math.PI;
    P.push(rot(box(0.05, 0.05, 0.4, W, Math.cos(a) * R, PH + Math.sin(a) * R - 0.025, 0), 0, 0, a));
  }
  // vines & blossoms
  const cols = [K.rose, C.pink, C.white, C.yellow, K.rose, C.white];
  const leafy = [C.leaf, C.leafDark, C.leafLight];
  const clump = (x, y, z, nx, ny, sz) => {
    P.push(ball(sz, leafy[Math.floor(r() * 3)], x, y, z));
    const n = 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const zz = z + (r() < 0.5 ? -1 : 1) * (0.1 + r() * 0.08);
      const t = (r() - 0.5) * 0.18;
      const fx = x + nx * (sz * 0.7) - ny * t, fy = y + ny * (sz * 0.7) + nx * t;
      const col = cols[Math.floor(r() * cols.length)];
      const fr = 0.055 + r() * 0.025;
      P.push(ball(fr, col, fx, fy, zz));
      if (col === C.white || col === K.rose) P.push(ball(fr * 0.45, C.yellow, fx + nx * 0.02, fy + ny * 0.035, zz + Math.sign(zz) * fr * 0.7));
    }
  };
  for (let k = 0; k < 13; k++) {
    const a = 0.06 + (k / 12) * (Math.PI - 0.12) + (r() - 0.5) * 0.07;
    const nx = Math.cos(a), ny = Math.sin(a);
    clump(nx * (R + 0.04), PH + ny * (R + 0.04), (r() - 0.5) * 0.14, nx, ny, 0.12 + r() * 0.05);
  }
  for (const s of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const y = 0.36 + k * 0.2 + r() * 0.06;
      clump(s * (R + 0.03), y, (r() - 0.5) * 0.2, s, 0.25, 0.09 + r() * 0.04);
    }
    // low bushy base in each planter
    P.push(ball(0.12, C.leafDark, s * R, 0.3, 0.14), ball(0.11, C.leaf, s * R, 0.29, -0.14));
  }
  // hanging lantern under the apex
  P.push(
    box(0.015, 0.2, 0.015, C.black, 0, PH + R - 0.22, 0),
    box(0.12, 0.15, 0.12, C.glass, 0, PH + R - 0.37, 0, 'glow'),
    box(0.15, 0.03, 0.15, C.black, 0, PH + R - 0.24, 0), box(0.15, 0.03, 0.15, C.black, 0, PH + R - 0.395, 0),
  );
  // stepping stones through the arch
  P.push(
    scl(cyl(0.17, 0.19, 0.04, 6, C.stone, 0.02, 0, -0.33), 1.2, 1, 0.8),
    scl(cyl(0.16, 0.18, 0.04, 6, '#c8c3b6', -0.04, 0, 0.0), 1.15, 1, 0.85),
    scl(cyl(0.17, 0.19, 0.04, 6, C.stone, 0.03, 0, 0.34), 1.2, 1, 0.8),
  );
  return group(P);
}

// ------------------------------------------------------------------ fountain (2x2)
function fountain() {
  const P = [];
  const r = hashRand(9);
  P.push(
    rot(cyl(0.98, 1.0, 0.07, 8, C.stoneDark, 0, 0, 0), 0, Math.PI / 8, 0),
    cyl(0.88, 0.9, 0.28, 12, C.stone, 0, 0.07, 0),
    cyl(0.8, 0.8, 0.03, 12, K.water, 0, 0.33, 0),
  );
  // chunky stone rim blocks
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    P.push(rot(box(0.47, 0.15, 0.17, i % 2 ? C.stone : K.stoneL, Math.sin(a) * 0.84, 0.3, Math.cos(a) * 0.84), 0, a, 0));
  }
  // column + upper bowl
  P.push(
    cyl(0.22, 0.26, 0.1, 8, C.stone, 0, 0.34, 0),
    cyl(0.12, 0.16, 0.56, 8, K.stoneL, 0, 0.42, 0),
    cyl(0.16, 0.16, 0.05, 8, C.stone, 0, 0.7, 0),
    cyl(0.48, 0.15, 0.19, 12, C.stone, 0, 0.96, 0),
    cyl(0.43, 0.43, 0.02, 12, K.water, 0, 1.135, 0),
    rot(torus(0.455, 0.04, 4, 12, K.stoneL, 0, 1.15, 0), Math.PI / 2, 0, 0),
    // top tier: little pedestal, cup and spout
    cyl(0.055, 0.08, 0.22, 6, K.stoneL, 0, 1.15, 0),
    cyl(0.17, 0.06, 0.08, 8, C.stone, 0, 1.36, 0),
    cyl(0.14, 0.14, 0.015, 8, K.water, 0, 1.43, 0),
    cone(0.045, 0.2, 6, K.waterL, 0, 1.43, 0),
  );
  // streams arcing out over the upper bowl's lip and falling into the basin, with foam where they land
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.2;
    const x = Math.sin(a) * 0.47, z = Math.cos(a) * 0.47;
    P.push(
      beam([x * 1.06, 1.16, z * 1.06], [x * 1.22, 0.95, z * 1.22], 0.05, K.waterL),
      beam([x * 1.22, 0.95, z * 1.22], [x * 1.32, 0.37, z * 1.32], 0.05, K.waterL),
    );
    P.push(ring(0.06, 0.014, K.foam, 0.368, 8, 3));
    P[P.length - 1].position.set(x * 1.32, 0.368, z * 1.32);
  }
  // lily pads, a lotus and wishing coins
  for (const [x, z, f] of [[0.55, 0.38, C.pink], [-0.45, 0.55, null], [-0.4, -0.6, C.white]]) {
    P.push(cyl(0.11, 0.11, 0.015, 7, C.leaf, x, 0.355, z));
    if (f) P.push(ball(0.045, f, x + 0.02, 0.4, z), ball(0.02, C.yellow, x + 0.02, 0.44, z));
  }
  for (let i = 0; i < 4; i++) {
    const a = r() * TAU, d = 0.25 + r() * 0.3;
    P.push(rot(cyl(0.03, 0.03, 0.008, 6, K.gold, Math.sin(a) * d, 0.355, Math.cos(a) * d), 0.15, 0, 0.1));
  }
  // corner flower tufts (the square corners are free around the round basin)
  const cols = [C.pink, C.yellow, C.purple, C.white];
  for (const [x, z] of [[0.82, 0.82], [-0.82, 0.82], [0.82, -0.82], [-0.82, -0.82]]) P.push(at(flowerTuft(r, cols, 1.3), x, 0, z));
  // shimmering droplets (rotating)
  const drops = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const d = 0.49 + (i % 3) * 0.03;
    drops.push(ball(0.035 + (i % 2) * 0.01, i % 3 ? K.waterL : K.foam, Math.sin(a) * d, 0.45 + ((i * 5) % 7) * 0.08, Math.cos(a) * d));
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.3;
    const d = 0.1 + (i % 3) * 0.05;
    drops.push(ball(0.03, i % 2 ? K.waterL : K.foam, Math.sin(a) * d, 1.62 - d * 0.6, Math.cos(a) * d));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.15;
    drops.push(rot(box(0.1, 0.006, 0.018, K.foam, Math.sin(a) * 0.68, 0.36, Math.cos(a) * 0.68), 0, a, 0));
  }
  P.push(keep(group(drops), 'spinY'));
  return group(P);
}

// ------------------------------------------------------------------ gazebo (3x3)
function gazebo() {
  const P = [];
  const o = Math.PI / 8;
  const ROOF = '#5b9db3', ROOFD = '#457d92', W = C.white;
  const RP = 1.2, AP = RP * Math.cos(o), SL = 2 * RP * Math.sin(o);
  const FY = 0.26, RY = 1.58;
  // base & floor
  P.push(
    rot(cyl(1.42, 1.46, 0.1, 8, C.stoneDark, 0, 0, 0), 0, o, 0),
    rot(cyl(1.36, 1.36, 0.16, 8, W, 0, 0.1, 0), 0, o, 0),
    rot(cyl(1.29, 1.29, 0.02, 8, C.woodLight, 0, FY, 0), 0, o, 0),
    box(0.8, 0.13, 0.26, C.stone, 0, 0, 1.36),
  );
  // posts
  for (let k = 0; k < 8; k++) {
    const t = o + (k * Math.PI) / 4;
    P.push(rot(box(0.09, RY - FY, 0.09, W, Math.sin(t) * RP, FY, Math.cos(t) * RP), 0, t, 0));
  }
  // sides: railing (not on the open front), eave beam, corner brackets
  for (let k = 0; k < 8; k++) {
    const a = ((k + 1) * Math.PI) / 4;
    const cx = Math.sin(a) * AP, cz = Math.cos(a) * AP;
    const tx = Math.cos(a), tz = -Math.sin(a);
    P.push(rot(box(SL + 0.04, 0.1, 0.07, W, cx, RY - 0.1, cz), 0, a, 0));
    for (const s of [-1, 1]) {
      const ex = cx + tx * s * (SL / 2 - 0.05), ez = cz + tz * s * (SL / 2 - 0.05);
      const mx = cx + tx * s * (SL / 2 - 0.25), mz = cz + tz * s * (SL / 2 - 0.25);
      P.push(beam([ex, RY - 0.3, ez], [mx, RY - 0.08, mz], 0.045, W));
    }
    if (k === 7) continue;
    P.push(rot(box(SL, 0.05, 0.05, W, cx, FY + 0.1, cz), 0, a, 0));
    P.push(rot(box(SL, 0.06, 0.08, C.woodLight, cx, FY + 0.56, cz), 0, a, 0));
    for (const s of [-0.27, 0, 0.27]) P.push(box(0.035, 0.42, 0.035, W, cx + tx * s, FY + 0.14, cz + tz * s));
  }
  // roof: two tiers with white trim, hip ridges and a gold finial
  const RR = 1.66;
  P.push(
    rot(cyl(RR + 0.02, RR + 0.02, 0.06, 8, W, 0, RY, 0), 0, o, 0),
    rot(cone(RR, 0.62, 8, ROOF, 0, RY + 0.06, 0), 0, o, 0),
    rot(cyl(0.42, 0.42, 0.2, 8, W, 0, RY + 0.5, 0), 0, o, 0),
    rot(cyl(0.7, 0.7, 0.04, 8, W, 0, RY + 0.68, 0), 0, o, 0),
    rot(cone(0.68, 0.6, 8, ROOF, 0, RY + 0.72, 0), 0, o, 0),
    cyl(0.03, 0.03, 0.25, 6, K.goldD, 0, RY + 1.28, 0),
    ball(0.075, K.gold, 0, RY + 1.48, 0, 1),
    cone(0.035, 0.14, 6, K.gold, 0, RY + 1.53, 0),
  );
  for (let k = 0; k < 8; k++) {
    const t = o + (k * Math.PI) / 4;
    P.push(beam([Math.sin(t) * RR, RY + 0.08, Math.cos(t) * RR], [0, RY + 0.66, 0], 0.06, ROOFD));
    P.push(beam([Math.sin(t) * 0.68, RY + 0.74, Math.cos(t) * 0.68], [0, RY + 1.3, 0], 0.045, ROOFD));
  }
  // string lights sagging along the eaves
  const bulbs = ['#ffe9a8', '#ffb3c7', '#bfe8ff', '#d7f7a0', '#ffd27a'];
  let bi = 0;
  for (let k = 0; k < 8; k++) {
    const t1 = o + (k * Math.PI) / 4, t2 = t1 + Math.PI / 4;
    const LR = RR - 0.06;
    const ax = Math.sin(t1) * LR, az = Math.cos(t1) * LR, bx = Math.sin(t2) * LR, bz = Math.cos(t2) * LR;
    const y0 = RY - 0.01;
    P.push(beam([ax, y0, az], [(ax + bx) / 2, y0 - 0.14, (az + bz) / 2], 0.014, '#4a4a4a'));
    P.push(beam([(ax + bx) / 2, y0 - 0.14, (az + bz) / 2], [bx, y0, bz], 0.014, '#4a4a4a'));
    for (let i = 1; i <= 4; i++) {
      const f = i / 5;
      const y = y0 - 0.14 * (1 - Math.abs(2 * f - 1)) - 0.08;
      P.push(box(0.065, 0.085, 0.065, bulbs[bi++ % bulbs.length], ax + (bx - ax) * f, y, az + (bz - az) * f, 'glow'));
    }
  }
  // lantern + little tea table inside
  P.push(
    box(0.02, 0.32, 0.02, C.black, 0, RY - 0.3, 0),
    box(0.16, 0.2, 0.16, C.glass, 0, RY - 0.5, 0, 'glow'),
    cone(0.13, 0.08, 4, C.black, 0, RY - 0.31, 0),
    cyl(0.05, 0.08, 0.42, 6, W, 0, FY, 0),
    cyl(0.32, 0.32, 0.04, 10, W, 0, FY + 0.42, 0),
    sph(0.07, C.blue, 0.05, FY + 0.52, 0.02),
    cyl(0.03, 0.025, 0.05, 6, C.white, -0.15, FY + 0.46, 0.1),
  );
  // flower pots at the front corners, round shrubs at the back
  const rr = hashRand(3);
  for (const x of [-1.22, 1.22]) {
    P.push(
      cyl(0.17, 0.12, 0.24, 8, K.terracotta, x, 0, 1.2),
      cyl(0.19, 0.19, 0.05, 8, K.terracottaD, x, 0.22, 1.2),
      ball(0.17, C.leaf, x, 0.36, 1.2),
    );
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + rr();
      P.push(ball(0.06, [C.pink, C.yellow, K.rose, C.white, C.purple][i], x + Math.sin(a) * 0.12, 0.42 + rr() * 0.08, 1.2 + Math.cos(a) * 0.12));
    }
    P.push(ball(0.24, C.leafDark, x, 0.2, -1.2), ball(0.17, C.leaf, x * 0.88, 0.32, -1.08));
    P.push(ball(0.05, C.pink, x * 0.93, 0.44, -1.0), ball(0.05, C.white, x, 0.4, -0.98));
  }
  return group(P);
}

// ------------------------------------------------------------------ golden rooster statue (1x1)
function rooster() {
  const G = K.gold, D = K.goldD, L = K.goldL;
  const parts = [
    // body (tilted chest-up) & puffed chest
    rot(scl(sph(0.17, G, 0, 0.36, -0.04, 10, 8), 0.82, 0.85, 1.3), -0.35, 0, 0),
    scl(sph(0.12, L, 0, 0.44, 0.12, 8, 6), 0.95, 1.15, 0.85),
    // folded wings
    rot(scl(sph(0.11, D, 0.125, 0.4, -0.06, 8, 6), 0.3, 0.7, 1.4), -0.3, 0, 0),
    rot(scl(sph(0.11, D, -0.125, 0.4, -0.06, 8, 6), 0.3, 0.7, 1.4), -0.3, 0, 0),
    // neck hackles + head, raised mid-crow
    rot(cyl(0.065, 0.11, 0.26, 7, L, 0, 0.44, 0.13), 0.3, 0, 0),
    sph(0.082, G, 0, 0.73, 0.19, 8, 6),
    // comb, beak, wattle, eyes
    ball(0.056, D, 0, 0.82, 0.24), ball(0.07, D, 0, 0.84, 0.18), ball(0.06, D, 0, 0.81, 0.115),
    rot(cone(0.034, 0.11, 5, D, 0, 0.69, 0.28), 1.1, 0, 0),
    scl(sph(0.03, D, 0, 0.65, 0.25), 0.8, 1.5, 0.8),
    box(0.02, 0.022, 0.02, '#8a6418', 0.065, 0.75, 0.22), box(0.02, 0.022, 0.02, '#8a6418', -0.065, 0.75, 0.22),
    // legs & feet
    cyl(0.022, 0.026, 0.2, 5, D, 0.06, 0.02, 0.02), cyl(0.022, 0.026, 0.2, 5, D, -0.06, 0.02, 0.02),
    box(0.02, 0.035, 0.02, D, 0.06, 0.08, -0.025), box(0.02, 0.035, 0.02, D, -0.06, 0.08, -0.025),
    scl(sph(0.06, G, 0.065, 0.25, 0.0, 6, 5), 0.75, 1.1, 1), scl(sph(0.06, G, -0.065, 0.25, 0.0, 6, 5), 0.75, 1.1, 1),
  ];
  for (const x of [0.06, -0.06]) {
    for (const a of [-0.5, 0, 0.5]) parts.push(rot(box(0.025, 0.02, 0.09, D, x + Math.sin(a) * 0.04, 0, 0.06 + Math.cos(a) * 0.03), 0, a, 0));
  }
  // sickle tail: feathers built from segments that follow an arc up over the back and down
  const sickles = [[0.3, 0.0, G, 30, 160], [0.25, 0.05, D, 35, 160], [0.25, -0.05, L, 35, 158], [0.19, 0.03, G, 40, 160], [0.19, -0.04, D, 45, 158]];
  for (const [rho, x, col, f0, f1] of sickles) {
    const cy = 0.44, cz = -0.26 + (0.3 - rho) * 0.4;
    const n = 4;
    for (let i = 0; i < n; i++) {
      const f = (((f0 + ((f1 - f0) * (i + 0.5)) / n) * Math.PI) / 180);
      const len = (((f1 - f0) * Math.PI) / 180) * rho / n;
      const w = 0.095 * (1 - i * 0.15);
      const seg = scl(sph(0.5, col, x, cy + Math.sin(f) * rho, cz + Math.cos(f) * rho, 6, 4), 0.07, len * 2.2, w);
      seg.rotation.x = -f;
      parts.push(seg);
    }
  }
  return group(parts);
}

function statue() {
  const P = [
    box(0.86, 0.1, 0.86, C.stoneDark, 0, 0, 0),
    box(0.7, 0.08, 0.7, C.stone, 0, 0.1, 0),
    box(0.56, 0.42, 0.56, K.stoneL, 0, 0.18, 0),
    box(0.68, 0.08, 0.68, C.stone, 0, 0.6, 0),
    // gold plaque & corner studs
    box(0.32, 0.14, 0.02, K.goldD, 0, 0.32, 0.285), box(0.27, 0.09, 0.022, K.gold, 0, 0.345, 0.287),
    box(0.02, 0.14, 0.32, K.goldD, 0.285, 0.32, 0), box(0.022, 0.09, 0.27, K.gold, 0.287, 0.345, 0),
    cyl(0.25, 0.27, 0.06, 10, K.goldD, 0, 0.68, 0),
  ];
  for (const [x, z] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) P.push(ball(0.035, K.gold, x, 0.7, z));
  const bird = rooster();
  bird.scale.setScalar(1.05);
  P.push(at(bird, 0.1, 0.74, 0.0, 1.2));
  // flowers at the plinth corners
  const r = hashRand(17);
  for (const [x, z] of [[0.42, 0.42], [-0.42, 0.42], [0.42, -0.42], [-0.42, -0.42]]) P.push(at(flowerTuft(r, [C.red, C.yellow, C.white], 0.9), x, 0, z));
  return group(P);
}

// ------------------------------------------------------------------ hot air balloon (2x2)
function balloon() {
  const P = [];
  // anchor stakes (static); tether ropes live on the bobbing part and end on the stakes
  const stakes = [[0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8]];
  for (const [x, z] of stakes) {
    P.push(rot(box(0.07, 0.4, 0.07, C.woodDark, x, 0, z), z * 0.12, 0, -x * 0.12));
    P.push(box(0.1, 0.04, 0.1, C.wood, x + x * 0.03, 0.36, z + z * 0.03));
  }
  // sandbags piled by two stakes + a little step stool at the front
  const bag = (x, z, ry, y = 0) => at(group(
    scl(sph(0.11, K.sand, 0, 0.08, 0, 7, 5), 1.2, 0.75, 0.9),
    box(0.04, 0.05, 0.06, '#a89062', 0.12, 0.08, 0),
  ), x, y, z, ry);
  P.push(bag(0.55, 0.78, 0.3), bag(0.78, 0.55, 1.4), bag(0.66, 0.68, 0.8, 0.11), bag(-0.6, -0.78, 0.2));
  P.push(box(0.36, 0.14, 0.22, C.woodLight, 0, 0, 0.55), box(0.36, 0.02, 0.22, C.wood, 0, 0.14, 0.55));
  P.push(box(0.24, 0.2, 0.24, C.plank, -0.72, 0, 0.55), box(0.26, 0.03, 0.26, C.woodDark, -0.72, 0.2, 0.55));

  // ---- floating part
  const F = [];
  const BB = 0.2, BT = 0.62; // basket bottom/top
  F.push(
    box(0.62, BT - BB, 0.62, K.wicker, 0, BB, 0),
    box(0.635, 0.035, 0.635, K.wickerD, 0, BB + 0.1, 0), box(0.635, 0.035, 0.635, K.wickerD, 0, BB + 0.25, 0),
    box(0.56, 0.01, 0.56, '#6b4a2c', 0, BT, 0),
  );
  for (const [x, z] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) F.push(box(0.06, BT - BB + 0.02, 0.06, K.wickerD, x, BB, z));
  // leather rim
  F.push(
    box(0.68, 0.07, 0.07, K.leather, 0, BT, 0.31), box(0.68, 0.07, 0.07, K.leather, 0, BT, -0.31),
    box(0.07, 0.07, 0.68, K.leather, 0.31, BT, 0), box(0.07, 0.07, 0.68, K.leather, -0.31, BT, 0),
  );
  // sandbags hanging on the basket
  for (const [x, z] of [[0.36, 0.12], [0.36, -0.14], [0.1, 0.36], [-0.16, 0.36]]) {
    F.push(scl(sph(0.06, K.sand, x, 0.4, z, 6, 5), 0.9, 1.25, 0.9), box(0.012, 0.12, 0.012, '#8a7350', x * 0.95, 0.47, z * 0.95));
  }
  // burner, flame, ropes up to the envelope
  const EB = 1.42; // envelope bottom
  F.push(box(0.24, 0.1, 0.24, K.metal, 0, 1.02, 0), cyl(0.07, 0.05, 0.08, 8, '#4a4d55', 0, 1.12, 0));
  F.push(glowCone(0.06, 0.18, 6, C.orange, 0, 1.18, 0), glowCone(0.035, 0.12, 6, C.yellow, 0, 1.2, 0));
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    F.push(beam([x * 0.31, BT + 0.05, z * 0.31], [x * 0.18, EB + 0.06, z * 0.18], 0.018, '#5b4630'));
    F.push(beam([x * 0.12, 1.07, z * 0.12], [x * 0.235, 1.07 + 0.0, z * 0.235], 0.02, '#4a4d55'));
  }
  // tether ropes from the basket base down to the stakes
  for (const [x, z] of stakes) F.push(beam([x * 0.38, BB + 0.08, z * 0.38], [x * 1.0, 0.24, z * 1.0], 0.02, '#8a7350'));
  // envelope: lathe gores in rainbow stripes, plus a cream belly band
  const prof = [[0.2, 0], [0.4, 0.22], [0.64, 0.56], [0.85, 0.98], [0.96, 1.42], [0.98, 1.78], [0.91, 2.14], [0.72, 2.45], [0.42, 2.66], [0.0, 2.74]];
  const pts = prof.map(([x, y]) => new THREE.Vector2(x, y));
  const gores = [C.red, C.orange, C.yellow, '#7cc35a', C.blue, C.purple];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const geo = g(`dgore${i}`, () => new THREE.LatheGeometry(pts, 2, (i / N) * TAU, TAU / N));
    F.push(mesh(geo, gores[i % gores.length], 0, EB, 0));
  }
  F.push(
    cyl(0.985, 0.98, 0.11, 24, C.cream, 0, EB + 1.52, 0),
    cyl(0.215, 0.18, 0.14, 12, K.leather, 0, EB - 0.08, 0),
    cyl(0.18, 0.18, 0.04, 12, '#3b2a1c', 0, EB - 0.1, 0),
    cyl(0.16, 0.2, 0.06, 10, C.white, 0, EB + 2.71, 0),
    box(0.02, 0.32, 0.02, C.woodDark, 0, EB + 2.76, 0),
    rot(box(0.2, 0.1, 0.012, C.red, 0.1, EB + 2.94, 0), 0, 0, -0.08),
  );
  P.push(keep(group(F), 'bob'));
  return group(P);
}

// ------------------------------------------------------------------ starter debris (1x1)
// The "gone a bit wild" farm: weeds, stones and stumps the player taps to clear.
// Each takes an optional seed for a little variety (views pick one per tile: 'weed:2').
const D = {
  weed: '#3f7f2f', weedD: '#2f6526', weedL: '#5c9a38', moss: '#7fa653', mossD: '#5f8a3c',
  rock: '#a9a59b', rockD: '#8a867d', rockL: '#c9c5ba', bark: '#6e4a2c', barkD: '#583a22',
  ring: '#e2b47a', ringD: '#c79459', cap: '#d9534a',
};

// spiky leaf: a thin 4-sided cone tipped outward from the tuft's centre
function blade(r, a, len, lean, col, d = 0.05) {
  const b = cone(0.045, len, 4, col, 0, 0, 0);
  b.position.y = len / 2;
  const s = group(b);
  s.position.set(Math.sin(a) * d, 0, Math.cos(a) * d);
  s.rotation.set(Math.cos(a) * lean, r() * 0.8, -Math.sin(a) * lean, 'YXZ');
  return s;
}

function weed(seed = 0) {
  const r = hashRand(311 + +seed * 17);
  const P = [];
  // flat leaf rosette hugging the ground
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + r() * 0.5;
    P.push(rot(scl(sph(0.11, i % 2 ? D.weedD : D.weed, Math.sin(a) * 0.15, 0.03, Math.cos(a) * 0.15, 5, 3), 0.55, 0.22, 1.25), 0, a, 0));
  }
  // spiky tuft
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r() * 0.4;
    const len = 0.3 + r() * 0.28;
    P.push(blade(r, a, len, 0.45 + r() * 0.4, [D.weed, D.weedD, D.weedL][i % 3], 0.07));
  }
  P.push(cone(0.06, 0.48 + r() * 0.08, 4, D.weedL, 0, 0, 0));
  // a dandelion (or a white clover head) poking up
  const fx = (r() - 0.5) * 0.14, fz = 0.1 + r() * 0.06;
  const head = +seed % 3 === 2 ? C.white : C.yellow;
  P.push(rot(cyl(0.016, 0.02, 0.52, 4, '#8fd45f', fx, 0, fz), 0.12, 0, -0.1));
  P.push(scl(ball(0.075, head, fx + 0.026, 0.54, fz + 0.032), 1, 0.7, 1));
  P.push(ball(0.032, head === C.white ? C.yellow : C.orange, fx + 0.026, 0.58, fz + 0.032));
  // stray grass blades around the base
  for (let i = 0; i < 4; i++) {
    const a = r() * TAU, d = 0.28 + r() * 0.08;
    P.push(rot(cone(0.025, 0.12 + r() * 0.08, 3, D.weedL, Math.sin(a) * d, 0, Math.cos(a) * d), (r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5));
  }
  const gr = group(P);
  gr.rotation.y = r() * TAU;
  return group(gr);
}

function stone(seed = 0) {
  const r = hashRand(733 + +seed * 29);
  // rounded rock sitting on the ground (scaled icosphere; sy squashes it)
  const rock = (rad, col, x, z, sx, sy, sz, ry) => {
    const m = scl(ball(rad, col, 0, 0, 0, 1), sx, sy, sz);
    return at(group(m), x, rad * sy * 0.7, z, ry);
  };
  const P = [
    // big rock, a medium one leaning on it and a pebble
    rock(0.28, D.rock, -0.06, -0.03, 1.2, 0.85, 1.05, r() * 3),
    rock(0.18, D.rockD, 0.22, 0.16, 1.1, 0.9, 1, r() * 3),
    rock(0.1, D.rockL, -0.28, 0.22, 1.15, 0.8, 1, r() * 3),
    // pale cap on the big rock, moss flecks on its shady side and on the middle one
    scl(ball(0.15, D.rockL, -0.09, 0.38, 0.03, 1), 1.15, 0.35, 1),
    scl(ball(0.09, D.moss, -0.14, 0.37, -0.12), 1.4, 0.35, 1.1),
    scl(ball(0.06, D.mossD, 0.02, 0.33, -0.2), 1.3, 0.35, 1),
    scl(ball(0.05, D.moss, 0.24, 0.3, 0.12), 1.2, 0.35, 1.2),
  ];
  // grass growing round the base
  for (let i = 0; i < 5; i++) {
    const a = 0.6 + i * 1.3 + r() * 0.4, d = 0.32 + r() * 0.06;
    P.push(rot(cone(0.03, 0.14 + r() * 0.1, 3, i % 2 ? D.weedL : D.weed, Math.sin(a) * d, 0, Math.cos(a) * d), (r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5));
  }
  if (+seed % 2) P.push(at(flowerTuft(r, [C.white, C.yellow], 1), 0.3, 0, -0.2));
  const gr = group(P);
  gr.rotation.y = r() * TAU;
  return group(gr);
}

function stump(seed = 0) {
  const r = hashRand(977 + +seed * 41);
  const H0 = 0.3 + r() * 0.06, R = 0.25;
  const P = [
    cyl(R, R + 0.03, H0, 8, D.bark, 0, 0, 0),
    // cut top: pale wood with growth rings
    cyl(R - 0.025, R - 0.025, 0.02, 8, D.ring, 0, H0, 0),
    cyl(0.15, 0.15, 0.024, 8, D.ringD, 0, H0, 0),
    cyl(0.12, 0.12, 0.028, 8, D.ring, 0, H0, 0),
    cyl(0.05, 0.05, 0.032, 6, D.ringD, 0, H0, 0),
  ];
  // bark ridges
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    P.push(rot(box(0.05, H0 * (0.7 + r() * 0.25), 0.03, D.barkD, Math.sin(a) * (R + 0.01), 0, Math.cos(a) * (R + 0.01)), 0, a, 0));
  }
  // roots splaying into the grass
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.5 + r() * 0.4;
    const root = rot(box(0.1, 0.09, 0.26, D.bark, 0, 0, 0.12), -0.35, 0, 0);
    P.push(at(group(root), Math.sin(a) * (R - 0.04), 0, Math.cos(a) * (R - 0.04), a));
  }
  // a hopeful little sprout on the cut top
  const sx = 0.08, sz = 0.07;
  P.push(
    cyl(0.012, 0.014, 0.16, 4, D.weedL, sx, H0, sz),
    rot(scl(sph(0.05, '#7cc35a', sx + 0.05, H0 + 0.15, sz, 5, 3), 1.2, 0.35, 0.7), 0, 0, 0.5),
    rot(scl(sph(0.045, D.weedL, sx - 0.045, H0 + 0.13, sz, 5, 3), 1.2, 0.35, 0.7), 0, 0, -0.5),
  );
  // toadstool by the roots
  P.push(
    cyl(0.025, 0.03, 0.09, 5, C.cream, 0.27, 0, 0.2),
    scl(sph(0.065, D.cap, 0.27, 0.09, 0.2, 6, 4), 1, 0.6, 1),
    ball(0.012, C.white, 0.29, 0.125, 0.24), ball(0.012, C.white, 0.24, 0.12, 0.18),
  );
  for (let i = 0; i < 3; i++) {
    const a = 3.4 + i * 0.7 + r() * 0.3, d = 0.34;
    P.push(rot(cone(0.03, 0.12 + r() * 0.08, 3, D.weed, Math.sin(a) * d, 0, Math.cos(a) * d), (r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5));
  }
  const gr = group(P);
  gr.rotation.y = r() * TAU;
  return group(gr);
}

registerBuilders({ birdbath, picnic, flowerarch, fountain, gazebo, statue, balloon, weed, stone, stump });
