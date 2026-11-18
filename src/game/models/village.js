// Procedural models — see H in ../assets.js for helpers.
// Village Projects: community buildings off the farm grid that the player restores in 3 stages.
//   project:<id>:<stage>   id = bridge | bandstand | greenhouse
//   stage 0 = ruined site waiting for help, 1 = construction underway, 2 = mostly built, 3 = finished
import * as THREE from 'three';
import { H, registerBuilders } from '../assets.js';

const { box, cyl, cone, ball, sph, rot, scl, hashRand, mesh, g, C } = H;
// group() that also flattens nested part arrays
const group = (...c) => H.group(c.flat(Infinity));

// extra palette for this file
const K = {
  stoneL: '#d6d1c4', stoneN: '#ece3cf', stoneOld: '#a39e93', bed: '#6f6a63',
  moss: '#7fa653', weed: '#6d9b3c', weedL: '#97c457',
  raw: '#e6c896', rawD: '#d3ae7a', old: '#9d8c74', oldD: '#86765f', pole: '#c9a06a',
  board: '#f0dcb2', string: '#5b4a3a', iron: '#3d3f45', gold: '#f2c14e', goldD: '#c9962e',
  brick: '#c4704f', brickOld: '#a7735f', rust: '#a6603c', rustD: '#7e4a31',
  frame: '#f4f9f5', mint: '#86d0b2', pane: '#bfe7e1', paneOld: '#c3cc98',
  terra: '#c8693c', terraD: '#a8532e', rose: '#ec6f93', shingle: '#c99b67', shingleD: '#b4844f',
  plinth: '#eadfc6', panel: '#d8c6a0', gravel: '#d3c39d', navy: '#3d5f93', blueBox: '#5d8fc9',
};
const FLAGS = [C.red, C.yellow, C.blue, '#7cc35a', C.pink, C.orange];
const FLOWERS = [C.pink, C.yellow, K.rose, C.white, C.purple, C.orange];

// ------------------------------------------------------------------ local helpers
const TAU = Math.PI * 2;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
// box / cylinder centered at y (the H versions put the bottom at y)
const cbox = (w, h, d, col, x = 0, y = 0, z = 0, bucket) => box(r3(w), r3(h), r3(d), col, x, y - r3(h) / 2, z, bucket);
const ccyl = (rt, rb, h, seg, col, x = 0, y = 0, z = 0) => cyl(rt, rb, h, seg, col, x, y - h / 2, z);
const at = (obj, x, y, z, ry = 0) => { obj.position.set(x, y, z); obj.rotation.y = ry; return obj; };
const glowBall = (rad, x, y, z) => mesh(g(`i${rad}|1`, () => new THREE.IcosahedronGeometry(rad, 1)), C.glass, x, y, z, 'glow');
const torus = (R, rr, rs, ts, col, x = 0, y = 0, z = 0) =>
  mesh(g(`vt${R}|${rr}|${rs}|${ts}`, () => new THREE.TorusGeometry(R, rr, rs, ts)), col, x, y, z);

const v3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
// thin square beam spanning point a -> b
function beam(a, b, t, col, bucket) {
  v3.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const m = box(r3(t), r3(v3.length()), r3(t), col, 0, 0, 0, bucket);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(UP, v3.normalize());
  return m;
}
// flat board (w wide, t thick) from point a to point b, kept level across its width
function board(a, b, w, t, col, bucket) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const hd = Math.hypot(dx, dz) || 1e-6;
  const m = cbox(Math.hypot(hd, dy), t, w, col, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, bucket);
  m.rotation.set(0, Math.atan2(-dz, dx), Math.atan2(dy, hd));
  return m;
}
// upright triangle w wide, h tall, t thick in the XY plane, base at y (apexDown: hangs below y)
function tri(w, h, t, col, x, y, z, bucket, apexDown = false) {
  const geo = g(`vtri${w}|${h}|${t}|${apexDown}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(0, apexDown ? -h : h);
    s.closePath();
    const e = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
    e.translate(0, 0, -t / 2);
    return e;
  });
  return mesh(geo, col, x, y, z, bucket);
}
// a single (double-sided) triangle through three points: roof facets
function triMesh(a, b, c, col) {
  const pts = [a, b, c].flat().map(r3);
  const geo = g('vtm' + pts.join(','), () => {
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute([...pts, ...pts.slice(0, 3), ...pts.slice(6, 9), ...pts.slice(3, 6)], 3));
    gg.computeVertexNormals();
    return gg;
  });
  return mesh(geo, col);
}
// closed pie-slice slab (bottom at y), angles measured like three's cylinders (0 = +z, PI/2 = +x)
function pie(R, h, start, len, col, x = 0, y = 0, z = 0, seg = 4, r0 = 0) {
  const geo = g(`vpie${R}|${h}|${r3(start)}|${r3(len)}|${seg}|${r0}`, () => {
    const s = new THREE.Shape();
    const pt = (rad, th) => [rad * Math.sin(th), -rad * Math.cos(th)];
    s.moveTo(...pt(r0, start));
    for (let i = 0; i <= seg; i++) s.lineTo(...pt(R, start + (len * i) / seg));
    if (r0 > 0) for (let i = seg; i >= 1; i--) s.lineTo(...pt(r0, start + (len * i) / seg));
    s.closePath();
    const e = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
    e.rotateX(-Math.PI / 2);
    return e;
  });
  return mesh(geo, col, x, y, z);
}
// half-disc hanging below y, facing along its local z (valance scallops)
function scallop(r, t, col, x, y, z, ry) {
  const geo = g(`vscal${r}|${t}`, () => {
    const c = new THREE.CylinderGeometry(r, r, t, 6, 1, false, -Math.PI / 2, Math.PI);
    c.rotateX(Math.PI / 2);
    return c;
  });
  const m = mesh(geo, col, x, y, z);
  m.rotation.y = ry;
  return m;
}

// little flower clump: leaves + a few blossoms (bottom at y=0)
function flowerTuft(r, cols = FLOWERS, s = 1) {
  const parts = [ball(r2(0.07 * s), r() < 0.5 ? C.leaf : C.leafDark, 0, 0.05 * s, 0)];
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU;
    parts.push(ball(r3(0.035 * s), cols[Math.floor(r() * cols.length)], Math.cos(a) * 0.05 * s, 0.1 * s, Math.sin(a) * 0.05 * s));
  }
  return group(parts);
}
// clump of weeds / long grass, sometimes with a dandelion
function weeds(r, x, z, s = 1, y = 0) {
  const P = [];
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const b = cone(r2(0.035 * s), r2((0.18 + r() * 0.2) * s), 3, r() < 0.5 ? K.weed : K.weedL, (r() - 0.5) * 0.16 * s, 0, (r() - 0.5) * 0.16 * s);
    b.rotation.set((r() - 0.5) * 0.7, r() * 3, (r() - 0.5) * 0.7);
    P.push(b);
  }
  if (r() < 0.45) P.push(ball(0.035, r() < 0.6 ? C.yellow : C.white, (r() - 0.5) * 0.1, 0.2 * s, (r() - 0.5) * 0.1));
  return at(group(P), x, y, z);
}
// string of triangular flags from a to b, sagging in the middle
function bunting(a, b, n, sag, ci = 0) {
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - sag, (a[2] + b[2]) / 2];
  const P = [beam(a, m, 0.014, K.string), beam(m, b, 0.014, K.string)];
  const ry = -Math.atan2(b[2] - a[2], b[0] - a[0]);
  for (let i = 1; i <= n; i++) {
    const f = i / (n + 1);
    const y = a[1] + (b[1] - a[1]) * f - sag * (1 - Math.abs(2 * f - 1));
    P.push(at(tri(0.13, 0.16, 0.012, FLAGS[(ci + i) % FLAGS.length], 0, 0, 0, undefined, true), a[0] + (b[0] - a[0]) * f, y - 0.006, a[2] + (b[2] - a[2]) * f, ry));
  }
  return P;
}
// black iron lantern with a glowing pane (bottom at y)
function lantern(x, y, z, s = 1) {
  return [
    box(r3(0.14 * s), r3(0.03 * s), r3(0.14 * s), K.iron, x, y, z),
    box(r3(0.1 * s), r3(0.15 * s), r3(0.1 * s), C.glass, x, y + 0.03 * s, z, 'glow'),
    rot(cone(r3(0.11 * s), r3(0.09 * s), 4, K.iron, x, y + 0.18 * s, z), 0, Math.PI / 4, 0),
    box(r3(0.03 * s), r3(0.05 * s), r3(0.03 * s), K.iron, x, y + 0.26 * s, z),
  ];
}
// wooden crate, optionally filled with building materials
function crate(x, z, { s = 1, ry = 0, y = 0, fill = null } = {}) {
  const w = r2(0.42 * s), h = r2(0.3 * s);
  const P = [
    box(w, h, w, C.woodLight, 0, 0, 0),
    box(r3(w + 0.014), 0.05, r3(w + 0.014), C.wood, 0, 0.025, 0),
    box(r3(w + 0.014), 0.05, r3(w + 0.014), C.wood, 0, h - 0.075, 0),
  ];
  switch (fill) {
    case 'stone':
      P.push(box(0.2, 0.12, 0.15, K.stoneN, -0.07, h - 0.06, 0.06), box(0.17, 0.1, 0.16, C.stone, 0.08, h - 0.05, -0.06));
      break;
    case 'nails':
      P.push(
        box(r3(w - 0.06), 0.02, r3(w - 0.06), '#7a7d85', 0, h - 0.01, 0),
        rot(box(0.04, 0.03, 0.26, C.woodDark, 0.04, h + 0.01, 0), 0, 0.6, 0),
        rot(box(0.13, 0.05, 0.05, K.iron, -0.05, h + 0.01, 0.09), 0, 0.6, 0),
      );
      break;
    case 'glass':
      for (let k = 0; k < 3; k++) {
        P.push(
          box(r3(w - 0.08), 0.24, 0.02, K.pane, 0, h - 0.1, -0.1 + k * 0.1, 'glass'),
          box(r3(w - 0.06), 0.03, 0.03, K.frame, 0, h + 0.12, -0.1 + k * 0.1),
        );
      }
      break;
    case 'lid':
      P.push(rot(box(r3(w + 0.02), 0.04, r3(w + 0.02), C.wood, 0.03, h, 0.02), 0, 0.18, 0));
      break;
    case 'seedlings':
      P.push(box(r3(w - 0.04), 0.02, r3(w - 0.04), C.soil, 0, h - 0.02, 0));
      for (let k = 0; k < 4; k++) P.push(cone(0.04, 0.12, 4, k % 2 ? C.leafLight : C.leaf, (k % 2 ? 0.09 : -0.09), h, (k < 2 ? 0.09 : -0.09)));
      break;
    case 'bunting':
      P.push(box(r3(w - 0.06), 0.02, r3(w - 0.06), C.cream, 0, h - 0.02, 0));
      for (let k = 0; k < 4; k++) P.push(rot(box(0.13, 0.04, 0.1, FLAGS[k], -0.1 + k * 0.065, h - 0.01 + (k % 2) * 0.02, (k % 2 ? 0.05 : -0.04)), 0, k * 0.5, 0));
      break;
  }
  return at(group(P), x, y, z, ry);
}
// stack of planks on two bearers
function plankPile(x, z, ry, r, { n = 5, len = 1.0, y = 0, cols = [K.raw, K.rawD] } = {}) {
  const P = [box(0.08, 0.06, 0.46, C.woodDark, -len * 0.33, 0, 0), box(0.08, 0.06, 0.46, C.woodDark, len * 0.33, 0, 0)];
  let i = 0;
  for (let layer = 0; i < n; layer++) {
    const cnt = Math.min(n - i, layer % 2 ? 2 : 3);
    for (let k = 0; k < cnt; k++, i++) {
      const p = box(len, 0.05, 0.14, cols[i % 2], (r() - 0.5) * 0.1, 0.06 + layer * 0.05, (k - (cnt - 1) / 2) * 0.15);
      p.rotation.y = (r() - 0.5) * 0.12;
      P.push(p);
    }
  }
  return at(group(P), x, y, z, ry);
}
// ladder from base point to top point
function ladder(base, top, w = 0.3, n = 5, col = K.raw) {
  const dx = top[0] - base[0], dz = top[2] - base[2], hl = Math.hypot(dx, dz) || 1;
  const px = (-dz / hl) * (w / 2), pz = (dx / hl) * (w / 2);
  const P = [
    beam([base[0] + px, base[1], base[2] + pz], [top[0] + px, top[1], top[2] + pz], 0.04, col),
    beam([base[0] - px, base[1], base[2] - pz], [top[0] - px, top[1], top[2] - pz], 0.04, col),
  ];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const cx = base[0] + (top[0] - base[0]) * t, cy = base[1] + (top[1] - base[1]) * t, cz = base[2] + (top[2] - base[2]) * t;
    P.push(beam([cx + px, cy, cz + pz], [cx - px, cy, cz - pz], 0.03, col));
  }
  return P;
}
// timber scaffold, L long (x) and D deep (z), centered on the origin; decks every lh; braces on the +z face
function scaffold(L, D, levels, lh) {
  const P = [];
  const nx = Math.max(1, Math.round(L / 0.9));
  const xs = Array.from({ length: nx + 1 }, (_, i) => -L / 2 + (L * i) / nx);
  const top = levels * lh;
  for (const x of xs) for (const z of [-D / 2, D / 2]) P.push(box(0.05, r2(top + 0.38), 0.05, K.pole, x, 0, z));
  for (let l = 1; l <= levels; l++) {
    const y = l * lh;
    for (const z of [-D / 2, D / 2]) P.push(cbox(L + 0.12, 0.04, 0.04, K.pole, 0, y - 0.03, z));
    const np = Math.max(2, Math.round(D / 0.16));
    for (let k = 0; k < np; k++) P.push(box(r2(L + 0.2), 0.035, r3(D / np - 0.02), k % 2 ? C.woodLight : K.raw, 0, y, -D / 2 + ((k + 0.5) * D) / np));
  }
  P.push(cbox(L + 0.12, 0.04, 0.04, K.pole, 0, top + 0.34, D / 2), cbox(L + 0.12, 0.04, 0.04, K.pole, 0, top + 0.34, -D / 2));
  for (let i = 0; i < nx; i++) P.push(beam([xs[i], 0.05, D / 2 + 0.03], [xs[i + 1], top, D / 2 + 0.03], 0.03, K.pole));
  return group(P);
}
// wooden sign post; blank board while waiting for help, a painted hammer once work is underway
function signPost(x, z, ry = 0, icon = false, tilt = 0) {
  const P = [
    box(0.08, 0.92, 0.08, C.woodDark, 0, 0, 0),
    rot(cone(0.06, 0.06, 4, C.woodDark, 0, 0.92, 0), 0, Math.PI / 4, 0),
    box(0.64, 0.36, 0.045, K.board, 0, 0.46, 0.06),
    box(0.68, 0.04, 0.055, C.wood, 0, 0.82, 0.06),
    box(0.68, 0.04, 0.055, C.wood, 0, 0.44, 0.06),
    box(0.03, 0.03, 0.02, '#5a5a5a', -0.27, 0.77, 0.09), box(0.03, 0.03, 0.02, '#5a5a5a', 0.27, 0.77, 0.09),
  ];
  if (icon) {
    P.push(
      rot(cbox(0.035, 0.24, 0.012, C.woodDark, -0.01, 0.63, 0.088), 0, 0, -0.7),
      rot(cbox(0.14, 0.06, 0.014, '#5d6470', 0.07, 0.72, 0.09), 0, 0, -0.7),
      rot(cbox(0.035, 0.22, 0.012, C.red, 0.0, 0.64, 0.086), 0, 0, 0.7),
    );
  }
  const gr = at(group(P), x, 0, z, ry);
  gr.rotation.z = tilt;
  return gr;
}
function paintCan(x, z, col, y = 0) {
  return [
    cyl(0.075, 0.075, 0.14, 8, '#cfd4da', x, y, z),
    cyl(0.078, 0.078, 0.03, 8, col, x, y + 0.12, z),
    box(0.03, 0.07, 0.012, col, x + 0.02, y + 0.06, z + 0.074),
    beam([x - 0.07, y + 0.14, z], [x + 0.07, y + 0.14, z], 0.012, '#8a9099'),
  ];
}
function sawhorse(x, z, ry, plankCol) {
  const P = [cbox(0.7, 0.06, 0.08, K.raw, 0, 0.42, 0)];
  for (const sx of [-0.28, 0.28]) for (const sz of [-1, 1]) P.push(beam([sx, 0.4, 0], [sx * 1.15, 0, sz * 0.16], 0.04, K.rawD));
  if (plankCol) P.push(rot(cbox(1.0, 0.04, 0.16, plankCol, 0.1, 0.47, 0), 0, 0.12, 0));
  return at(group(P), x, 0, z, ry);
}
// terracotta pot with a plant
function pot(x, y, z, kind, r, s = 1) {
  const q = (v) => r3(v * s);
  const P = [cyl(q(0.085), q(0.06), q(0.12), 7, K.terra, x, y, z), cyl(q(0.095), q(0.095), q(0.03), 7, K.terraD, x, y + q(0.1), z)];
  const c1 = FLOWERS[Math.floor(r() * FLOWERS.length)];
  switch (kind) {
    case 'leafy':
      P.push(
        ball(q(0.13), r() < 0.5 ? C.leaf : C.leafDark, x, y + q(0.22), z),
        ball(q(0.09), C.leafLight, x + q(0.07), y + q(0.3), z + q(0.03)),
        ball(q(0.08), C.leaf, x - q(0.07), y + q(0.32), z - q(0.02)),
      );
      break;
    case 'flower':
      P.push(
        ball(q(0.11), C.leafDark, x, y + q(0.19), z),
        ball(q(0.05), c1, x + q(0.05), y + q(0.29), z + q(0.04)), ball(q(0.05), c1, x - q(0.06), y + q(0.28), z - q(0.01)),
        ball(q(0.045), C.white, x + q(0.01), y + q(0.32), z - q(0.06)), ball(q(0.045), C.yellow, x - q(0.01), y + q(0.3), z + q(0.08)),
      );
      break;
    case 'fern':
      for (let k = 0; k < 5; k++) {
        const a = k * 1.26 + 0.4;
        P.push(rot(cone(q(0.04), q(0.32), 4, k % 2 ? C.leaf : C.leafLight, x + Math.sin(a) * q(0.06), y + q(0.08), z + Math.cos(a) * q(0.06)), Math.cos(a) * 0.7, 0, -Math.sin(a) * 0.7));
      }
      break;
    case 'cactus':
      P.push(cyl(q(0.05), q(0.055), q(0.26), 6, '#5aa05a', x, y + q(0.1), z), cyl(q(0.028), q(0.028), q(0.12), 5, '#5aa05a', x + q(0.07), y + q(0.18), z), ball(q(0.04), C.pink, x, y + q(0.37), z));
      break;
    case 'sprout':
      P.push(cyl(q(0.075), q(0.075), 0.01, 7, C.soil, x, y + q(0.115), z), cone(q(0.03), q(0.1), 4, C.leafLight, x - q(0.02), y + q(0.12), z), cone(q(0.03), q(0.08), 4, C.leaf, x + q(0.03), y + q(0.12), z + q(0.01)));
      break;
    default:
      P.push(cyl(q(0.075), q(0.075), 0.01, 7, C.soil, x, y + q(0.115), z));
  }
  return P;
}
// eighth notes in the XY plane (head bottom at y=0)
function noteMark(col, s = 1) {
  return group(
    rot(scl(sph(r3(0.065 * s), col, 0, 0.055 * s, 0), 1.3, 0.85, 0.7), 0, 0, 0.4),
    box(r3(0.026 * s), r3(0.27 * s), r3(0.026 * s), col, 0.068 * s, 0.06 * s, 0),
    beam([0.068 * s, 0.32 * s, 0], [0.16 * s, 0.2 * s, 0], 0.038 * s, col),
  );
}
function doubleNote(col, s = 1) {
  return group(
    rot(scl(sph(r3(0.055 * s), col, 0, 0.05 * s, 0), 1.3, 0.85, 0.7), 0, 0, 0.4),
    rot(scl(sph(r3(0.055 * s), col, 0.2 * s, 0.09 * s, 0), 1.3, 0.85, 0.7), 0, 0, 0.4),
    box(r3(0.022 * s), r3(0.24 * s), r3(0.022 * s), col, 0.058 * s, 0.05 * s, 0),
    box(r3(0.022 * s), r3(0.24 * s), r3(0.022 * s), col, 0.258 * s, 0.09 * s, 0),
    beam([0.05 * s, 0.29 * s, 0], [0.27 * s, 0.33 * s, 0], 0.05 * s, col),
  );
}

// ================================================================== BRIDGE (5 x 2, spans x = -2.5 .. 2.5)
const BL = 2.5, BH = 0.85, WATER_Y = 0.03;
const deckY = (x) => BH * Math.cos((Math.PI * x) / (2 * BL));
// segmental stone arch: circle through (+-ASPAN, water) rising 0.5 above it
const ASPAN = 1.5, AR = 2.5, ACY = WATER_Y + 0.5 - AR, PHI = Math.asin(ASPAN / AR);
const archY = (x) => (Math.abs(x) >= ASPAN ? 0 : ACY + Math.sqrt(AR * AR - x * x));
// a straight piece following the deck curve from xa to xb, its top `yoff` above the deck line
function arcPiece(xa, xb, yoff, h, d, z, col) {
  const ya = deckY(xa) + yoff, yb = deckY(xb) + yoff;
  const m = cbox(Math.hypot(xb - xa, yb - ya) + 0.01, h, d, col, (xa + xb) / 2, (ya + yb) / 2 - h / 2, z);
  m.rotation.z = Math.atan2(yb - ya, xb - xa);
  return m;
}

function bridge(st) {
  const r = hashRand(101 + st * 13);
  const P = [];
  const ruin = st === 0, done = st === 3;
  const GAP = ruin ? 0.75 : 0;
  const newStone = (x) => st === 1 && Math.abs(x) < 0.9;

  // footings on the banks
  for (const s of [-1, 1]) P.push(box(0.7, 0.12, 1.5, ruin ? K.stoneOld : C.stoneDark, s * 1.85, 0, 0));
  // stone body: vertical slices between the arch and the deck
  const n = 20, x0 = -2.3, dx = 4.6 / n;
  const tops = [];
  for (let i = 0; i < n; i++) {
    const xc = x0 + dx * (i + 0.5);
    if (Math.abs(xc) < GAP) continue;
    const bot = archY(xc);
    let top = Math.min(deckY(xc - dx / 2), deckY(xc + dx / 2)) - 0.08;
    if (ruin && Math.abs(xc) < 1.3) top = Math.max(bot + 0.06, top - 0.08 - r() * 0.2);
    tops.push([xc, top]);
    P.push(box(r3(dx + 0.004), r3(top - bot), 1.3, newStone(xc) ? K.stoneN : ruin ? K.stoneOld : C.stone, xc, bot, 0));
  }
  // arch ring of voussoirs with a keystone
  const NV = 13;
  for (let k = 0; k < NV; k++) {
    const a = -PHI + (2 * PHI * (k + 0.5)) / NV;
    const sx = Math.sin(a), cy = Math.cos(a);
    const px = AR * sx, py = ACY + AR * cy;
    if (ruin && Math.abs(px) < GAP + 0.12) continue;
    const key = k === (NV - 1) / 2;
    const vh = key ? 0.24 : 0.18;
    let col = key ? K.stoneN : k % 2 ? K.stoneL : C.stone;
    if (ruin) col = k % 2 ? K.stoneOld : C.stoneDark;
    else if (newStone(px)) col = K.stoneN;
    const v = cbox((2 * PHI * AR) / NV - 0.03, vh, 1.38, col, px + sx * (vh / 2 - 0.03), py + cy * (vh / 2 - 0.03), 0);
    v.rotation.z = -a;
    P.push(v);
  }
  // coping band under the deck
  const NC = 12;
  for (let i = 0; i < NC; i++) {
    const xa = -2.4 + (4.8 * i) / NC, xb = xa + 4.8 / NC, xm = (xa + xb) / 2;
    if (ruin && (Math.abs(xm) < 1.3 || r() < 0.3)) continue;
    P.push(arcPiece(xa, xb, -0.055, 0.11, 1.46, 0, ruin ? K.stoneOld : newStone(xm) ? K.stoneN : K.stoneL));
  }
  // deck planks laid across the bridge
  const deckCols = ruin ? [K.old, K.oldD] : done ? [C.plank, C.wood] : [K.raw, K.rawD];
  const NP = 18;
  for (let i = 0; i < NP; i++) {
    const xa = -2.46 + (4.92 * i) / NP, xb = xa + 4.92 / NP, xc = (xa + xb) / 2;
    if (ruin && (Math.abs(xc) < 1.4 || r() < 0.3)) continue;
    if (st === 1 && xc > 0.3) continue;
    const ya = deckY(xa), yb = deckY(xb);
    const p = cbox(Math.hypot(xb - xa, yb - ya) - 0.025, 0.06, ruin ? 1.28 : 1.36, deckCols[i % 2], xc, (ya + yb) / 2 - 0.03, 0);
    p.rotation.z = Math.atan2(yb - ya, xb - xa);
    if (ruin) {
      p.rotation.y = (r() - 0.5) * 0.3;
      p.position.z += (r() - 0.5) * 0.16;
    }
    P.push(p);
  }
  // fascia boards along the deck edges
  if (st >= 2) {
    for (const zs of [-1, 1]) for (let i = 0; i < 8; i++) P.push(arcPiece(-2.4 + i * 0.6, -1.8 + i * 0.6, 0.005, 0.1, 0.04, zs * 0.695, done ? C.woodDark : K.rawD));
  }
  // railings
  const postX = [-2.12, -1.42, -0.71, 0, 0.71, 1.42, 2.12];
  if (st >= 2) {
    const pc = done ? C.white : K.raw, rc = done ? C.white : K.rawD;
    for (const zs of [-1, 1]) {
      const z = zs * 0.64;
      postX.forEach((x, i) => {
        P.push(box(0.08, 0.56, 0.08, pc, x, deckY(x) - 0.04, z));
        if (done) P.push(box(0.12, 0.04, 0.12, C.red, x, deckY(x) + 0.52, z));
        if (i === postX.length - 1) return;
        if (st === 2 && zs === 1 && i >= 3) return; // a few rails still to be fitted
        const xn = postX[i + 1];
        P.push(beam([x, deckY(x) + 0.47, z], [xn, deckY(xn) + 0.47, z], 0.065, rc));
        P.push(beam([x, deckY(x) + 0.24, z], [xn, deckY(xn) + 0.24, z], 0.04, rc));
      });
    }
  }
  // stone pillars at the four ends; lamp posts and lanterns once finished
  const pillars = [[-2.28, -0.84], [-2.28, 0.84], [2.28, -0.84], [2.28, 0.84]];
  pillars.forEach(([x, z], i) => {
    if (ruin && i === 3) {
      P.push(rot(box(0.4, 0.28, 0.28, K.stoneOld, x - 0.02, 0, z + 0.14), 0, 0.5, 0));
      P.push(rot(box(0.34, 0.06, 0.34, C.stone, x + 0.32, 0, z - 0.2), 0.12, 0.3, 0.1));
      return;
    }
    P.push(box(0.28, 0.4, 0.28, ruin ? K.stoneOld : C.stone, x, 0, z));
    if (!(ruin && i === 1)) P.push(box(0.34, 0.06, 0.34, ruin ? C.stone : K.stoneL, x, 0.4, z));
    if (st >= 2) P.push(box(0.07, 0.62, 0.07, done ? K.iron : K.raw, x, 0.46, z));
    if (done) P.push(lantern(x, 1.08, z, 1.25));
  });

  if (ruin) {
    // stones fallen into the water
    for (let k = 0; k < 5; k++) {
      const b = box(r2(0.2 + r() * 0.1), 0.15, r2(0.22 + r() * 0.1), k % 2 ? K.stoneOld : C.stoneDark, (r() - 0.5) * 1.2, -0.04, (r() - 0.5) * 1.0);
      b.rotation.set((r() - 0.5) * 0.5, r() * 3, (r() - 0.5) * 0.5);
      P.push(b);
    }
    // broken planks dangling into the gap, leaning old railing posts
    P.push(
      board([-1.42, deckY(1.42) - 0.03, 0.3], [-0.92, 0.1, 0.45], 0.13, 0.05, K.oldD),
      board([1.42, deckY(1.42) - 0.03, -0.2], [0.98, 0.06, -0.42], 0.13, 0.05, K.old),
      rot(box(0.08, 0.5, 0.08, K.oldD, -1.62, deckY(1.62) - 0.06, -0.6), 0.2, 0, 0.35),
      rot(box(0.08, 0.42, 0.08, K.old, 1.92, deckY(1.92) - 0.06, 0.6), -0.25, 0, -0.3),
      board([-2.12, deckY(2.12) + 0.4, -0.64], [-1.75, deckY(1.75) + 0.3, -0.7], 0.05, 0.05, K.old),
    );
    // weeds sprouting from the broken stonework and the banks
    for (const [x, top] of tops) if (Math.abs(x) < 1.0 && r() < 0.8) P.push(weeds(r, x, (r() - 0.5) * 0.8, 1.1, top));
    for (const [x, z] of [[-2.0, 0.95], [-2.4, -0.5], [2.15, 0.45], [2.45, -1.0], [1.7, -0.95], [-1.75, -1.0], [2.4, 1.15]]) P.push(weeds(r, x, z, 1.3));
    // moss on the old stone
    P.push(
      scl(ball(0.14, K.moss, -2.28, 0.44, -0.84), 1.1, 0.3, 1.1),
      scl(ball(0.16, K.moss, -1.85, 0.12, 0.45), 1.6, 0.3, 1.2),
      scl(ball(0.13, K.moss, 1.85, 0.12, -0.4), 1.6, 0.3, 1.2),
    );
    P.push(signPost(-2.2, 1.18, 0.15, false, -0.06));
    P.push(plankPile(1.95, -1.2, 0.25, r, { n: 4, len: 0.9, cols: [K.old, K.oldD] }));
  }
  if (st === 1) {
    P.push(at(scaffold(2.0, 0.28, 1, 0.66), 0, 0, 0.9));
    // loose planks waiting on the unfinished half
    const a = Math.atan(-BH * (Math.PI / (2 * BL)) * Math.sin((Math.PI * 0.6) / (2 * BL)));
    for (let k = 0; k < 3; k++) P.push(rot(cbox(0.22, 0.05, 1.24, k % 2 ? K.raw : K.rawD, 0.62 + k * 0.03, deckY(0.62) - 0.03 + k * 0.05, (k - 1) * 0.03), 0, (k - 1) * 0.08, a));
    P.push(
      crate(2.12, 1.15, { fill: 'stone', ry: 0.3 }),
      crate(2.2, -1.12, { fill: 'nails', ry: -0.2 }),
      crate(2.6, -0.6, { fill: 'lid', s: 0.85, ry: 0.5 }),
      plankPile(-1.95, -1.18, -0.15, r, { n: 5 }),
      signPost(-2.2, 1.18, 0.15, true),
    );
    for (const [x, z] of [[-2.45, -0.5], [2.45, 0.2], [-1.75, 1.05]]) P.push(weeds(r, x, z, 1.0));
  }
  if (st === 2) {
    P.push(
      sawhorse(2.05, -1.12, 0.2, K.raw),
      paintCan(-2.05, -1.08, C.white), paintCan(-1.86, -1.18, C.red),
      board([1.7, 0.03, 1.12], [2.5, 0.03, 1.02], 0.07, 0.06, K.rawD), board([1.68, 0.09, 1.2], [2.45, 0.09, 1.14], 0.07, 0.06, K.raw),
      signPost(-2.2, 1.18, 0.15, true),
      crate(2.55, -0.55, { fill: 'nails', s: 0.85, ry: 0.4 }),
    );
    P.push(weeds(r, 2.45, 0.3, 0.9));
  }
  if (done) {
    // flower boxes hung on the railings near the crown
    for (const zs of [-1, 1]) for (const x of [-0.36, 0.36]) {
      const y = deckY(x) + 0.12, z = zs * 0.75;
      P.push(box(0.52, 0.13, 0.12, K.blueBox, x, y, z), box(0.44, 0.02, 0.09, C.soil, x, y + 0.13, z));
      for (let k = 0; k < 3; k++) P.push(ball(0.065, k % 2 ? C.leaf : C.leafDark, x - 0.15 + k * 0.15, y + 0.17, z));
      for (let k = 0; k < 4; k++) P.push(ball(0.045, FLOWERS[(k + (x > 0 ? 2 : 0) + (zs > 0 ? 1 : 0)) % FLOWERS.length], x - 0.19 + k * 0.125, y + 0.24, z + zs * 0.03));
    }
    // flowers around the pillar bases
    for (const [x, z] of pillars) {
      P.push(at(flowerTuft(r, FLOWERS, 1.3), x + (x > 0 ? 0.08 : -0.08), 0, z + Math.sign(z) * 0.26));
      P.push(at(flowerTuft(r, FLOWERS, 1.1), x - Math.sign(x) * 0.3, 0, z + Math.sign(z) * 0.12));
    }
  }
  return group(P);
}

// ================================================================== BANDSTAND (octagon ~3.2 wide, steps on +z)
function bandstandRuin() {
  const r = hashRand(207);
  const P = [cyl(1.42, 1.5, 0.1, 14, K.bed, 0, 0, 0)];
  const R = 1.47;
  const shades = [C.stone, K.stoneL, '#c3beb2'];
  const slabs = [];
  // irregular slabs; most have cracked into an inner and an outer piece that sag apart
  const widths = [0.8, 1.05, 0.75, 0.95, 0.85, 1.0, 0.88];
  let a0 = 0.35;
  widths.forEach((len, k) => {
    const start = a0, am = start + len / 2;
    a0 += len;
    const R1 = r2(0.68 + r() * 0.3);
    const pieces = k % 3 === 1 ? [[0, R]] : [[0, R1], [R1 + 0.05, R]];
    for (const [ri, ro] of pieces) {
      if (k === 0 && ri > 0) continue; // the outer piece has crumbled away (rubble below)
      const h = r2(0.15 + r() * 0.1), off = 0.03 + r() * 0.04 + (ri > 0 ? 0.05 : 0);
      const m = pie(ro, h, start, len, shades[Math.floor(r() * 3)], Math.sin(am) * off, ri > 0 ? 0.02 : 0, Math.cos(am) * off, 4, ri);
      m.quaternion.setFromAxisAngle(new THREE.Vector3(Math.cos(am), 0, -Math.sin(am)), ri > 0 ? 0.03 + r() * 0.07 : (r() - 0.5) * 0.05);
      P.push(m);
      slabs.push([am, (ri + ro) / 2, h]);
    }
  });
  // cracks, moss and weeds pushing through
  for (const [am, d, h] of [slabs[1], slabs[4], slabs[8]]) {
    const c = cbox(0.42, 0.012, 0.03, K.bed, Math.sin(am) * d, h + 0.004, Math.cos(am) * d);
    c.rotation.y = am + 0.9;
    P.push(c);
  }
  for (const [am, d, h] of [slabs[2], slabs[5], slabs[7]]) P.push(scl(ball(0.2, K.moss, Math.sin(am + 0.15) * d, h, Math.cos(am + 0.15) * d), 1.3, 0.22, 1.0));
  a0 = 0.35;
  for (const len of widths) {
    const d = 0.35 + r() * 0.9;
    P.push(weeds(r, Math.sin(a0) * d, Math.cos(a0) * d, 1.35, 0.06));
    a0 += len;
  }
  for (const a of [0.2, 1.1, 2.3, 3.2, 4.4, 5.5]) P.push(weeds(r, Math.sin(a) * 1.68, Math.cos(a) * 1.68, 1.3));
  // rubble where the missing slab was
  for (let k = 0; k < 6; k++) {
    const a = 0.45 + r() * 0.75, d = 0.5 + r() * 1.4;
    const b = scl(ball(r2(0.1 + r() * 0.08), k % 2 ? C.stone : K.stoneOld, Math.sin(a) * d, 0.06, Math.cos(a) * d), 1.2, 0.7, 1);
    b.rotation.y = r() * 3;
    P.push(b);
  }
  // an old column stump, a fallen column and a toppled rusty music stand
  P.push(
    cyl(0.07, 0.07, 0.36, 6, '#ddd6c6', Math.sin(3.6) * 1.25, 0.18, Math.cos(3.6) * 1.25),
    cone(0.07, 0.08, 6, '#c9c1ae', Math.sin(3.6) * 1.25, 0.54, Math.cos(3.6) * 1.25),
    rot(ccyl(0.065, 0.065, 1.3, 6, '#d8d1c1', 0.95, 0.065, -1.82), 0, 0.35, Math.PI / 2),
    beam([-1.75, 0.03, 0.55], [-1.6, 0.05, 1.05], 0.025, K.rustD),
    rot(cbox(0.26, 0.03, 0.18, K.rust, -1.58, 0.06, 1.12), 0.2, 0.4, 0.1),
    rot(box(0.9, 0.16, 0.3, C.stoneDark, 0.05, 0, 1.72), 0, 0.1, 0.04),
    rot(box(0.32, 0.12, 0.26, K.stoneOld, 0.7, 0, 1.95), 0, 0.5, 0),
  );
  P.push(signPost(-0.95, 1.9, 0.25, false, -0.08));
  return group(P);
}

function bandstand(st) {
  if (st === 0) return bandstandRuin();
  const r = hashRand(202 + st * 13);
  const P = [];
  const done = st === 3, W = C.white;
  const o = Math.PI / 8;
  const FY = 0.62, RP = 1.34, RY = 2.1, RR = 1.74, RH = 0.92, RB = RY + 0.12;
  const vtx = (k) => o + (k * Math.PI) / 4; // post / roof corner angles
  const mid = (k) => ((k + 1) * Math.PI) / 4; // side k mid angle; side 7 is the open front (+z)
  const AP = RP * Math.cos(o), SL = 2 * RP * Math.sin(o);

  // plinth, panels, coping, steps
  P.push(
    rot(cyl(1.64, 1.68, 0.1, 8, C.stoneDark), 0, o, 0),
    rot(cyl(1.55, 1.55, 0.44, 8, K.plinth, 0, 0.1, 0), 0, o, 0),
    rot(cyl(1.6, 1.6, 0.06, 8, done ? W : K.stoneL, 0, 0.54, 0), 0, o, 0),
    box(0.96, 0.2, 0.3, C.stone, 0, 0, 1.8),
    box(0.96, 0.4, 0.32, C.stone, 0, 0, 1.52),
  );
  if (st >= 2) {
    for (let k = 0; k < 7; k++) {
      const a = mid(k);
      P.push(rot(box(0.72, 0.24, 0.03, done ? '#c7d9e6' : K.panel, Math.sin(a) * 1.44, 0.2, Math.cos(a) * 1.44), 0, a, 0));
    }
  }
  // plank floor (half laid at stage 1)
  const fa = 1.5 * Math.cos(o);
  if (st === 1) P.push(rot(cyl(1.5, 1.5, 0.012, 8, '#86684a', 0, 0.6, 0), 0, o, 0));
  const NS = done ? 8 : 12, sw = (2 * fa) / NS;
  for (let i = 0; i < NS; i++) {
    const z = -fa + sw * (i + 0.5);
    if (st === 1 && z > -0.2) continue;
    const hw = Math.min(fa, fa * Math.SQRT2 - Math.abs(z) - sw / 2) - 0.02;
    P.push(box(r2(2 * hw), 0.022, r3(sw - 0.014), i % 2 ? (done ? C.woodLight : K.raw) : (done ? C.plank : K.rawD), 0, 0.6, z));
  }
  // posts
  for (let k = 0; k < 8; k++) {
    const t = vtx(k), x = Math.sin(t) * RP, z = Math.cos(t) * RP;
    P.push(cyl(0.055, 0.055, r2(RY - FY), 6, st === 1 ? K.raw : W, x, FY, z));
    if (st >= 2) P.push(box(0.15, 0.09, 0.15, W, x, FY, z), box(0.16, 0.07, 0.16, done ? K.gold : W, x, RY - 0.07, z));
  }
  // railings on seven sides
  for (let k = 0; k < 7; k++) {
    if (st === 1 || (st === 2 && k >= 4)) continue;
    const a = mid(k), cx = Math.sin(a) * AP, cz = Math.cos(a) * AP, tx = Math.cos(a), tz = -Math.sin(a);
    const rc = done ? W : K.raw;
    P.push(rot(box(r3(SL - 0.08), 0.06, 0.08, rc, cx, FY + 0.5, cz), 0, a, 0));
    P.push(rot(box(r3(SL - 0.08), 0.04, 0.05, rc, cx, FY + 0.06, cz), 0, a, 0));
    for (const s of done ? [-0.27, 0, 0.27] : [-0.22, 0.22]) P.push(box(0.035, 0.44, 0.035, rc, cx + tx * s, FY + 0.06, cz + tz * s));
  }

  if (st === 1) {
    // first eave beams, scaffold at the back, materials out front
    for (const k of [2, 3, 4]) {
      const a = mid(k);
      P.push(rot(box(r3(SL + 0.12), 0.09, 0.09, K.raw, Math.sin(a) * AP, RY - 0.09, Math.cos(a) * AP), 0, a, 0));
    }
    P.push(at(scaffold(1.4, 0.36, 2, 0.95), 0, 0, -1.86));
    const t1 = vtx(1);
    P.push(ladder([Math.sin(t1) * 2.0, 0, Math.cos(t1) * 2.0], [Math.sin(t1) * 1.42, RY - 0.1, Math.cos(t1) * 1.42], 0.3, 6));
    P.push(
      plankPile(0.35, 0.55, 0.15, r, { n: 4, len: 1.1, y: 0.6 }),
      crate(-1.55, 1.25, { fill: 'nails', ry: 0.3 }),
      crate(-1.95, 0.72, { fill: 'lid', ry: -0.3 }),
      crate(-1.62, 1.25, { fill: 'bunting', s: 0.8, y: 0.3, ry: 0.6 }),
      plankPile(1.55, -1.45, -0.75, r, { n: 5 }),
      signPost(-0.85, 1.95, 0.2, true),
    );
    for (const [x, z] of [[1.75, 1.15], [-1.9, -0.6], [0.9, -1.85]]) P.push(weeds(r, x, z, 1.0));
    return group(P);
  }

  // eave ring + roof (two facets still open at stage 2)
  P.push(rot(cyl(RR - 0.04, RR - 0.04, 0.12, 8, W, 0, RY, 0), 0, o, 0));
  const apex = [0, RB + RH, 0];
  for (let k = 0; k < 8; k++) {
    const t1 = vtx(k), t2 = vtx(k + 1);
    const p1 = [Math.sin(t1) * RR, RB, Math.cos(t1) * RR], p2 = [Math.sin(t2) * RR, RB, Math.cos(t2) * RR];
    const pm = [(p1[0] + p2[0]) / 2, RB, (p1[2] + p2[2]) / 2];
    if (st === 2 && k < 2) {
      // bare rafters and a purlin where the roof is still open
      P.push(beam([pm[0] * 0.97, RB + 0.03, pm[2] * 0.97], [0, RB + RH, 0], 0.05, K.rawD));
      P.push(beam([p1[0] * 0.5, RB + RH * 0.5 + 0.03, p1[2] * 0.5], [p2[0] * 0.5, RB + RH * 0.5 + 0.03, p2[2] * 0.5], 0.04, K.rawD));
    } else {
      P.push(triMesh(apex, p1, pm, done ? C.red : K.shingle), triMesh(apex, pm, p2, done ? C.cream : K.shingleD));
    }
    P.push(beam([p1[0], RB + 0.02, p1[2]], [0, RB + RH + 0.02, 0], 0.06, done ? W : K.rawD));
  }
  const ty = RB + RH;
  P.push(cyl(0.1, 0.14, 0.12, 8, W, 0, ty - 0.08, 0));
  if (done) P.push(ball(0.05, K.gold, 0, ty + 0.06, 0, 1), at(noteMark(K.gold, 1.6), -0.07, ty + 0.09, 0));
  else P.push(cone(0.06, 0.16, 6, K.rawD, 0, ty + 0.03, 0));

  if (st === 2) {
    const t1 = vtx(1);
    P.push(ladder([Math.sin(t1) * 2.15, 0, Math.cos(t1) * 2.15], [Math.sin(t1) * 1.6, RB + 0.1, Math.cos(t1) * 1.6], 0.3, 7));
    P.push(
      plankPile(-0.7, -0.25, 0.4, r, { n: 3, len: 0.9, y: 0.62 }),
      ...paintCan(0.78, 1.72, C.red), ...paintCan(0.98, 1.6, C.cream),
      crate(-1.5, 1.28, { fill: 'bunting', ry: 0.3 }),
      signPost(-0.85, 1.95, 0.2, true),
    );
    P.push(weeds(r, -1.85, -0.7, 0.9));
    return group(P);
  }

  // ---- finished: scalloped valance, bunting, instruments, lights, sign and flowers
  const ra = (RR - 0.04) * Math.cos(o) + 0.012, sl = 2 * (RR - 0.04) * Math.sin(o);
  for (let k = 0; k < 8; k++) {
    const a = mid(k), tx = Math.cos(a), tz = -Math.sin(a);
    for (let j = 0; j < 3; j++) {
      const s = (j - 1) * (sl / 3);
      P.push(scallop(0.2, 0.03, (k * 3 + j) % 2 ? C.cream : C.red, Math.sin(a) * ra + tx * s, RY + 0.005, Math.cos(a) * ra + tz * s, a));
    }
  }
  for (let k = 0; k < 7; k++) {
    const t1 = vtx(k), t2 = vtx(k + 1), Rb = RP + 0.07;
    P.push(...bunting([Math.sin(t1) * Rb, FY + 0.56, Math.cos(t1) * Rb], [Math.sin(t2) * Rb, FY + 0.56, Math.cos(t2) * Rb], 3, 0.13, k * 3));
  }
  {
    const t1 = vtx(7), t2 = vtx(8);
    P.push(...bunting([Math.sin(t1) * RP, RY - 0.1, Math.cos(t1) * RP], [Math.sin(t2) * RP, RY - 0.1, Math.cos(t2) * RP], 5, 0.24, 1));
  }
  // bass drum facing the audience
  const dx = -0.42, dz = -0.55, dy = FY + 0.25;
  P.push(
    rot(ccyl(0.22, 0.22, 0.16, 12, C.red, dx, dy, dz), Math.PI / 2, 0, 0),
    rot(ccyl(0.2, 0.2, 0.19, 12, C.cream, dx, dy, dz), Math.PI / 2, 0, 0),
    rot(ccyl(0.23, 0.23, 0.035, 12, K.gold, dx, dy, dz + 0.08), Math.PI / 2, 0, 0),
    rot(ccyl(0.23, 0.23, 0.035, 12, K.gold, dx, dy, dz - 0.08), Math.PI / 2, 0, 0),
    rot(cbox(0.1, 0.1, 0.01, C.blue, dx, dy, dz + 0.1), 0, 0, Math.PI / 4),
    box(0.05, 0.05, 0.22, K.iron, dx - 0.15, FY, dz), box(0.05, 0.05, 0.22, K.iron, dx + 0.15, FY, dz),
  );
  // cymbal on a stand
  P.push(cyl(0.012, 0.012, 0.62, 4, K.iron, -0.85, FY, -0.2), cyl(0.02, 0.14, 0.03, 10, K.gold, -0.85, FY + 0.62, -0.2));
  // chair with a big golden horn
  const hx = 0.48, hz = -0.5;
  P.push(
    box(0.26, 0.035, 0.26, C.woodDark, hx, FY + 0.28, hz),
    box(0.26, 0.3, 0.035, C.woodDark, hx, FY + 0.28, hz - 0.12),
    box(0.03, 0.28, 0.22, C.woodDark, hx - 0.11, FY, hz), box(0.03, 0.28, 0.22, C.woodDark, hx + 0.11, FY, hz),
    torus(0.1, 0.035, 5, 10, K.gold, hx, FY + 0.46, hz),
    cyl(0.13, 0.045, 0.2, 10, K.gold, hx + 0.08, FY + 0.5, hz),
    cyl(0.11, 0.11, 0.01, 10, K.goldD, hx + 0.08, FY + 0.69, hz),
    beam([hx - 0.08, FY + 0.5, hz], [hx - 0.16, FY + 0.62, hz], 0.025, K.gold),
  );
  // music stands
  for (const [x, z] of [[-0.05, -0.12], [0.65, -0.05]]) {
    P.push(
      cyl(0.012, 0.012, 0.5, 4, K.iron, x, FY, z),
      rot(cbox(0.28, 0.2, 0.02, K.iron, x, FY + 0.56, z - 0.01), 0.45, 0, 0),
      rot(cbox(0.22, 0.15, 0.012, C.white, x, FY + 0.565, z - 0.025), 0.45, 0, 0),
    );
  }
  // hanging lantern in the middle, lamp posts at the steps
  P.push(box(0.02, 0.38, 0.02, K.iron, 0, RY - 0.38, 0), ...lantern(0, RY - 0.66, 0, 1.2));
  for (const s of [-1, 1]) {
    P.push(box(0.14, 0.62, 0.14, W, s * 0.58, 0, 1.82), box(0.18, 0.05, 0.18, W, s * 0.58, 0.62, 1.82), glowBall(0.09, s * 0.58, 0.76, 1.82));
  }
  // music-note sign by the steps
  const sign = group(
    box(0.07, 0.66, 0.07, C.woodDark, -0.26, 0, 0), box(0.07, 0.66, 0.07, C.woodDark, 0.26, 0, 0),
    box(0.64, 0.38, 0.05, K.navy, 0, 0.36, 0.03),
    box(0.68, 0.045, 0.06, K.gold, 0, 0.74, 0.03), box(0.68, 0.045, 0.06, K.gold, 0, 0.34, 0.03),
    at(doubleNote(C.cream, 1.0), -0.13, 0.42, 0.065),
  );
  P.push(at(sign, -1.18, 0, 1.85, 0.35));
  // flowers: pots flanking the steps and tufts around the plinth
  P.push(
    cyl(0.17, 0.13, 0.24, 8, K.terra, 0.98, 0, 1.78), cyl(0.19, 0.19, 0.05, 8, K.terraD, 0.98, 0.22, 1.78),
    ball(0.16, C.leaf, 0.98, 0.36, 1.78), ball(0.06, C.pink, 1.06, 0.48, 1.86), ball(0.06, C.yellow, 0.9, 0.46, 1.86), ball(0.06, K.rose, 0.98, 0.52, 1.7),
  );
  for (let k = 0; k < 7; k++) {
    const a = vtx(k);
    P.push(at(flowerTuft(r, FLOWERS, 1.5), Math.sin(a) * 1.78, 0, Math.cos(a) * 1.78));
  }
  return group(P);
}

// ================================================================== GREENHOUSE (3.5 x 2.5, door on +z)
const GX = 1.62, GZ = 1.1, KY = 0.08, WY = 0.52, EY = 1.42, RT = 2.15;
const NBX = 5, NBZ = 4, BX = (2 * GX) / NBX, BZ = (2 * GZ) / NBZ;
const PITCH = Math.atan2(RT - EY, GZ), SLOPE = Math.hypot(RT - EY, GZ);
const roofY = (z) => EY + (RT - EY) * (1 - Math.abs(z) / GZ);
// which panes are in place at each stage (value = how much of the pane is left)
const GH_PANES = {
  0: { B0: 1, B3: 1, L0: 1, L2: 0.45, F0: 0.5, RB0: 1 },
  1: { L0: 1, L1: 1, L2: 1, L3: 1, GL: 1, B0: 1, B1: 1, RB0: 1 },
};
const GH_MISSING2 = ['F3', 'RF3', 'RB1'];

function greenhouse(st) {
  const r = hashRand(303 + st * 13);
  const P = [];
  const ruin = st === 0, done = st === 3;
  const FR = ruin ? K.rust : K.frame, FR2 = ruin ? K.rustD : done ? K.mint : K.frame;
  const PANE = ruin ? K.paneOld : K.pane;
  const has = (k) => (done ? 1 : st === 2 ? (GH_MISSING2.includes(k) ? 0 : 1) : GH_PANES[st][k] || 0);
  const DH = 0.3; // half width of the door opening

  // base, floor and brick knee walls
  P.push(box(3.5, KY, 2.5, ruin ? K.stoneOld : C.stoneDark, 0, 0, 0));
  P.push(box(r2(2 * GX - 0.1), 0.015, r2(2 * GZ - 0.1), ruin ? '#9c8a66' : K.gravel, 0, KY, 0));
  const KH = WY - 0.04 - KY;
  const brick = ruin ? K.brickOld : K.brick;
  const wall = (x0, x1, z0, z1, h = KH, cap = true) => {
    P.push(box(r3(x1 - x0), r3(h), r3(z1 - z0), brick, (x0 + x1) / 2, KY, (z0 + z1) / 2));
    if (cap) P.push(box(r3(x1 - x0 + 0.04), 0.04, r3(z1 - z0 + 0.04), ruin ? K.stoneOld : K.stoneL, (x0 + x1) / 2, KY + h, (z0 + z1) / 2));
  };
  const T = 0.06;
  if (ruin) {
    wall(-GX - T, 0.25, -GZ - T, -GZ + T);
    wall(0.95, GX + T, -GZ - T, -GZ + T, 0.26, false);
    wall(-GX - T, -GX + T, -GZ + T, GZ - T);
    wall(GX - T, GX + T, -GZ + T, 0.2);
    wall(GX - T, GX + T, 0.2, GZ - T, 0.18, false);
    wall(-GX - T, -DH, GZ - T, GZ + T, KH, false);
    wall(DH, GX + T, GZ - T, GZ + T, 0.3, false);
    for (let k = 0; k < 4; k++) {
      const b = box(0.16, 0.07, 0.08, brick, 0.4 + r() * 0.5, KY, -GZ - 0.05 + (r() - 0.5) * 0.4);
      b.rotation.y = r() * 3;
      P.push(b);
    }
  } else {
    wall(-GX - T, GX + T, -GZ - T, -GZ + T);
    wall(-GX - T, -GX + T, -GZ + T, GZ - T);
    wall(GX - T, GX + T, -GZ + T, GZ - T);
    wall(-GX - T, -DH, GZ - T, GZ + T);
    wall(DH, GX + T, GZ - T, GZ + T);
  }
  P.push(box(0.8, 0.05, 0.28, C.stone, 0, 0, GZ + 0.27));

  // ---- frame
  [[-GX, -GZ], [GX, -GZ], [-GX, GZ], [GX, GZ]].forEach(([x, z], i) => {
    const p = box(0.08, r2(EY - KY), 0.08, FR, x, KY, z);
    if (ruin && i === 3) p.rotation.set(0.1, 0, -0.16);
    P.push(p);
  });
  for (const zs of [-1, 1]) {
    for (let i = 1; i < NBX; i++) {
      const x = -GX + BX * i;
      const jamb = zs === 1 && (i === 2 || i === 3);
      if (ruin && !jamb && r() < 0.5) continue;
      const y0 = jamb ? KY : WY;
      P.push(box(0.05, r2(EY - y0), 0.05, FR, x, y0, zs * GZ));
    }
    if (ruin && zs === 1) {
      // front eave plate snapped and sagging
      P.push(cbox(2.0, 0.07, 0.09, FR, -GX + 1.0, EY - 0.035, GZ));
      P.push(board([0.38, EY - 0.04, GZ], [GX - 0.15, EY - 0.5, GZ + 0.06], 0.09, 0.07, FR));
    } else P.push(box(r2(2 * GX + 0.1), 0.07, 0.09, FR, 0, EY - 0.07, zs * GZ));
    if (!ruin) {
      if (zs === -1) P.push(box(r2(2 * GX), 0.035, 0.045, FR, 0, 0.98, -GZ));
      else for (const s of [-1, 1]) P.push(box(r3(GX - BX / 2), 0.035, 0.045, FR, s * (BX / 2 + (GX - BX / 2) / 2), 0.98, GZ));
    }
  }
  for (const xs of [-1, 1]) {
    const x = xs * GX;
    for (let j = 1; j < NBZ; j++) {
      const z = -GZ + BZ * j;
      if (ruin && (xs === 1 ? j !== 2 : j === 1)) continue;
      P.push(box(0.05, r2(roofY(z) - WY), 0.05, FR, x, WY, z));
    }
    P.push(box(0.09, 0.07, r2(2 * GZ), FR, x, EY - 0.07, 0));
    if (!ruin) P.push(box(0.045, 0.035, r2(2 * GZ), FR, x, 0.98, 0));
    for (const zs of [-1, 1]) {
      if (ruin && xs === 1 && zs === 1) continue;
      P.push(beam([x, EY, zs * GZ], [x, RT, 0], 0.08, FR2));
    }
  }
  if (ruin) {
    P.push(cbox(1.9, 0.07, 0.08, FR, -GX + 0.95, RT, 0));
    P.push(board([0.3, RT - 0.03, 0], [1.25, EY + 0.12, -0.3], 0.08, 0.07, FR));
  } else P.push(cbox(2 * GX + 0.14, 0.08, 0.09, FR2, 0, RT, 0));
  for (const zs of [-1, 1]) {
    for (let i = 1; i < NBX; i++) {
      if (ruin && !((zs === -1 && i <= 2) || (zs === 1 && i === 1))) continue;
      const x = -GX + BX * i;
      P.push(beam([x, EY, zs * GZ], [x, RT, 0], 0.045, FR));
    }
  }

  // ---- glass
  for (const zs of [-1, 1]) {
    for (let i = 0; i < NBX; i++) {
      if (zs === 1 && i === 2) continue; // door bay
      const f = has((zs === 1 ? 'F' : 'B') + i);
      if (!f) continue;
      const xc = -GX + BX * (i + 0.5), hh = (EY - 0.07 - WY) * f;
      P.push(box(r3(BX - 0.05), r3(hh), 0.02, PANE, xc, WY, zs * GZ, 'glass'));
      if (f < 1) P.push(tri(0.3, 0.18, 0.02, PANE, xc + 0.1, WY + hh, zs * GZ, 'glass'));
    }
  }
  for (const xs of [-1, 1]) {
    for (let j = 0; j < NBZ; j++) {
      const f = has((xs < 0 ? 'L' : 'R') + j);
      if (!f) continue;
      const zc = -GZ + BZ * (j + 0.5), hh = (EY - 0.07 - WY) * f;
      P.push(box(0.02, r3(hh), r3(BZ - 0.05), PANE, xs * GX, WY, zc, 'glass'));
      if (f < 1) {
        const t = tri(0.26, 0.2, 0.02, PANE, xs * GX, WY + hh, zc - 0.08, 'glass');
        t.rotation.y = Math.PI / 2;
        P.push(t);
      }
    }
    if (has(xs < 0 ? 'GL' : 'GR')) {
      const t = tri(r2(2 * GZ - 0.1), r2(RT - EY - 0.06), 0.02, PANE, xs * GX, EY, 0, 'glass');
      t.rotation.y = Math.PI / 2;
      P.push(t);
    }
  }
  for (const zs of [-1, 1]) {
    for (let i = 0; i < NBX; i++) {
      if (!has((zs > 0 ? 'RF' : 'RB') + i)) continue;
      const p = cbox(BX - 0.05, 0.02, SLOPE - 0.08, PANE, -GX + BX * (i + 0.5), (EY + RT) / 2 + 0.012, (zs * GZ) / 2, 'glass');
      p.rotation.x = zs * PITCH;
      P.push(p);
    }
  }

  // ---- door (+z): hanging off its hinge when ruined, raw wood at stage 2, painted mint when done
  if (!ruin) {
    P.push(box(0.66, 0.06, 0.07, FR, 0, KY + 1.22, GZ));
    P.push(box(r3(BX - 0.05), r3(EY - 0.07 - (KY + 1.28)), 0.02, PANE, 0, KY + 1.28, GZ, 'glass'));
  }
  if (st !== 1) {
    const dc = done ? K.mint : st === 2 ? K.raw : K.rustD;
    const leaf = group(
      box(0.58, 0.42, 0.04, dc, 0.29, 0, 0),
      box(0.07, 0.8, 0.04, dc, 0.035, 0.42, 0), box(0.07, 0.8, 0.04, dc, 0.545, 0.42, 0),
      box(0.58, 0.07, 0.04, dc, 0.29, 1.15, 0),
      ruin ? null : box(0.03, 0.73, 0.03, dc, 0.29, 0.42, 0),
      ruin ? null : box(0.44, 0.73, 0.015, PANE, 0.29, 0.42, 0, 'glass'),
      ball(0.03, ruin ? K.rustD : K.gold, 0.5, 0.55, 0.035),
    );
    leaf.position.set(-0.29, KY + 0.01, GZ + 0.01);
    if (ruin) leaf.rotation.set(0, -0.9, -0.05);
    P.push(leaf);
  }

  // ---- interior
  const tables = ruin ? [] : st === 1 ? [] : [-1, 1];
  for (const sx of tables) {
    const x = sx * 0.98;
    P.push(box(0.84, 0.05, 1.75, C.wood, x, 0.56, -0.08), box(0.78, 0.03, 1.65, C.woodDark, x, 0.22, -0.08));
    for (const [lx, lz] of [[-0.37, -0.9], [0.37, -0.9], [-0.37, 0.74], [0.37, 0.74]]) P.push(box(0.05, 0.48, 0.05, C.woodDark, x + lx, KY, -0.08 + lz));
  }
  if (st === 2) {
    for (let k = 0; k < 4; k++) P.push(...pot(-0.98 + (k % 2 ? 0.2 : -0.2), 0.61, -0.6 + Math.floor(k / 2) * 0.55, 'sprout', r));
    P.push(...pot(1.18, 0.61, -0.55, 'empty', r), ...pot(0.8, 0.61, -0.6, 'sprout', r), ...pot(0.98, 0.61, 0.1, 'empty', r));
    P.push(box(0.34, 0.05, 0.24, C.woodLight, 0.98, 0.61, 0.5), box(0.3, 0.02, 0.2, C.soil, 0.98, 0.66, 0.5));
  }
  if (done) {
    // big pots down the middle of each bench, small flowering pots at the ends
    const big = [['flower', 'fern', 'leafy'], ['leafy', 'flower', 'fern']];
    [-1, 1].forEach((sx, ti) => {
      big[ti].forEach((kind, j) => P.push(...pot(sx * 0.98 + (j === 1 ? sx * 0.08 : -sx * 0.06), 0.61, -0.62 + j * 0.58, kind, r, 1.55)));
      P.push(...pot(sx * 0.98 + sx * 0.25, 0.61, -0.3, 'flower', r, 1.0), ...pot(sx * 0.98 - sx * 0.22, 0.61, 0.28, ti ? 'cactus' : 'flower', r, 1.0));
    });
    // potted palm at the back
    const px = 0, pz = -0.68, pt = KY + 0.3 + 0.72;
    P.push(cyl(0.2, 0.15, 0.3, 8, K.terra, px, KY, pz), cyl(0.22, 0.22, 0.05, 8, K.terraD, px, KY + 0.27, pz), cyl(0.04, 0.06, 0.72, 6, C.trunk, px, KY + 0.3, pz));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + 0.3;
      P.push(board([px, pt, pz], [px + Math.sin(a) * 0.6, pt - 0.2, pz + Math.cos(a) * 0.45], 0.17, 0.02, k % 2 ? C.leafLight : C.leaf));
    }
    // ivy trailing along the back wall
    for (let k = 0; k < 5; k++) P.push(ball(r2(0.11 + r() * 0.05), k % 2 ? C.leafDark : C.leaf, -1.3 + k * 0.65, 0.62 + (k % 3) * 0.08, -GZ + 0.12));
    // warm lanterns hanging from the ridge
    for (const x of [-0.85, 0.85]) P.push(box(0.015, 0.36, 0.015, K.iron, x, RT - 0.36, 0), ...lantern(x, RT - 0.62, 0, 1.1));
  }

  // ---- stage dressing outside
  if (ruin) {
    for (let k = 0; k < 7; k++) P.push(weeds(r, -1.3 + r() * 2.6, -0.8 + r() * 1.5, 1.6, KY));
    for (const [x, z] of [[-1.9, 0.6], [1.85, -0.9], [1.4, 1.45], [-1.4, -1.4], [1.9, 0.5]]) P.push(weeds(r, x, z, 1.3));
    // ivy climbing the front-left corner
    for (let k = 0; k < 7; k++) P.push(ball(r2(0.09 + r() * 0.05), k % 2 ? C.leafDark : C.leaf, -GX + (r() - 0.5) * 0.12, KY + 0.15 + k * 0.2, GZ + 0.03 + (r() - 0.3) * 0.1));
    P.push(ball(0.1, C.leaf, -GX + 0.25, EY, GZ), ball(0.08, C.leafDark, -GX + 0.45, EY + 0.02, GZ));
    // glass shards, a toppled bench, overturned pots
    for (let k = 0; k < 6; k++) {
      const s = box(r2(0.1 + r() * 0.1), 0.012, r2(0.08 + r() * 0.08), PANE, -0.9 + r() * 2.2, k < 3 ? 0 : KY, (k < 3 ? GZ + 0.25 : -0.5) + r() * 0.5, 'glass');
      s.rotation.y = r() * 3;
      P.push(s);
    }
    P.push(
      rot(box(0.84, 0.05, 1.3, K.old, 0.95, 0.24, -0.25), 0, 0.1, 0.4),
      box(0.05, 0.42, 0.05, K.oldD, 1.3, KY, -0.8), box(0.05, 0.42, 0.05, K.oldD, 1.3, KY, 0.25),
      rot(ccyl(0.085, 0.06, 0.12, 7, K.terra, -0.9, KY + 0.08, 0.2), Math.PI / 2, 0.6, 0),
      rot(ccyl(0.085, 0.06, 0.12, 7, K.terraD, -1.15, KY + 0.08, -0.5), Math.PI / 2, -0.4, 0),
      cyl(0.06, 0.05, 0.07, 6, K.terra, -0.65, KY, -0.7),
    );
    P.push(signPost(0.98, 1.62, -0.12, false, 0.06));
  }
  if (st === 1) {
    P.push(at(scaffold(1.0, 0.6, 1, 1.2), 0.25, KY, -0.15));
    P.push(
      crate(-1.25, 1.62, { fill: 'glass', ry: 0.15 }),
      crate(-0.75, 1.68, { fill: 'glass', s: 0.9, ry: -0.2 }),
      ...ladder([1.28, 0, 1.78], [1.28, EY - 0.02, GZ + 0.07], 0.32, 5),
      plankPile(-2.02, 0.15, Math.PI / 2, r, { n: 4, len: 1.0 }),
      signPost(0.65, 1.68, -0.1, true),
    );
    for (const [x, z] of [[1.9, -0.6], [-1.9, -1.2], [1.75, 1.3]]) P.push(weeds(r, x, z, 1.0));
  }
  if (st === 2) {
    P.push(
      rot(box(0.56, 0.78, 0.02, K.pane, 0.65, 0.04, GZ + 0.27, 'glass'), -0.28, 0, 0),
      rot(box(0.6, 0.04, 0.05, K.frame, 0.65, 0.02, GZ + 0.33), -0.28, 0, 0),
      crate(-1.2, 1.62, { fill: 'seedlings', ry: 0.15 }),
      scl(sph(0.17, '#b48a5a', -0.72, 0.13, 1.66), 1, 0.8, 0.8),
      cyl(0.04, 0.05, 0.06, 6, '#9a7448', -0.72, 0.24, 1.66),
      ...paintCan(0.45, 1.6, K.mint),
      signPost(1.25, 1.7, -0.15, true),
    );
    P.push(weeds(r, 1.9, -0.9, 0.9));
  }
  if (done) {
    // ridge cresting, finials, gutters, weathervane
    for (let i = 0; i < 9; i++) {
      const x = -GX + 0.22 + i * ((2 * GX - 0.44) / 8);
      if (Math.abs(x) < 0.1) continue;
      P.push(i % 2 ? ball(0.035, K.mint, x, RT + 0.09, 0) : cone(0.03, 0.12, 4, K.mint, x, RT + 0.04, 0));
    }
    for (const xs of [-1, 1]) P.push(cone(0.035, 0.22, 6, K.mint, xs * (GX + 0.02), RT + 0.03, 0), ball(0.055, K.mint, xs * (GX + 0.02), RT + 0.12, 0));
    for (const zs of [-1, 1]) P.push(box(r2(2 * GX + 0.16), 0.05, 0.07, K.mint, 0, EY - 0.12, zs * (GZ + 0.075)));
    const wy = RT + 0.04;
    P.push(
      box(0.025, 0.62, 0.025, K.iron, 0, wy, 0),
      ball(0.045, K.gold, 0, wy + 0.16, 0),
      box(0.36, 0.015, 0.015, K.iron, 0, wy + 0.28, 0), box(0.015, 0.015, 0.36, K.iron, 0, wy + 0.28, 0),
      cbox(0.5, 0.025, 0.025, K.iron, 0, wy + 0.46, 0),
      rot(cone(0.05, 0.1, 4, K.gold, 0.29, wy + 0.41, 0), 0, 0, -Math.PI / 2),
      rot(cbox(0.13, 0.13, 0.012, K.gold, -0.22, wy + 0.46, 0), 0, 0, Math.PI / 4),
      ball(0.03, K.gold, 0, wy + 0.63, 0),
    );
    // planters along the front, topiary pots by the door, lantern over the door
    for (const sx of [-1, 1]) {
      P.push(box(0.9, 0.2, 0.24, C.woodDark, sx * 1.16, 0, GZ + 0.2), box(0.84, 0.02, 0.18, C.soil, sx * 1.16, 0.2, GZ + 0.2));
      for (let k = 0; k < 3; k++) P.push(at(flowerTuft(r, FLOWERS, 1.55), sx * 1.16 - 0.27 + k * 0.27, 0.2, GZ + 0.2 + (k % 2 ? 0.03 : -0.03)));
      P.push(
        cyl(0.11, 0.08, 0.18, 8, K.terra, sx * 0.53, 0, GZ + 0.3), cyl(0.12, 0.12, 0.04, 8, K.terraD, sx * 0.53, 0.16, GZ + 0.3),
        ball(0.13, C.leafDark, sx * 0.53, 0.33, GZ + 0.3, 1),
      );
    }
    P.push(box(0.04, 0.04, 0.14, K.iron, 0, EY - 0.06, GZ + 0.08), box(0.015, 0.08, 0.015, K.iron, 0, EY - 0.14, GZ + 0.14), ...lantern(0, EY - 0.36, GZ + 0.14, 0.95));
  }
  return group(P);
}

// ------------------------------------------------------------------ registry
function project(id = 'bridge', stage = '0') {
  const st = Math.max(0, Math.min(3, Math.round(+stage) || 0));
  if (id === 'bandstand') return bandstand(st);
  if (id === 'greenhouse') return greenhouse(st);
  return bridge(st);
}

registerBuilders({ project });
