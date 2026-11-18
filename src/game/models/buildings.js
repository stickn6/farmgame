// Procedural models — see H in ../assets.js for helpers.
// Storage buildings, new animal pens and new factories.
import * as THREE from 'three';
import { H, registerBuilders } from '../assets.js';
import { OBJECTS } from '../config.js';

const { box, cyl, cone, ball, sph, roof, rot, scl, fenceRect, groundPatch, hashRand, C } = H;
// group() that also flattens nested part arrays
const group = (...c) => H.group(c.flat(Infinity));

// ------------------------------------------------------------------ local helpers
// box / cylinder centered at y (the H versions put the bottom at y)
const cbox = (w, h, d, col, x = 0, y = 0, z = 0, bucket) => box(w, h, d, col, x, y - h / 2, z, bucket);
const ccyl = (rt, rb, h, seg, col, x = 0, y = 0, z = 0) => cyl(rt, rb, h, seg, col, x, y - h / 2, z);
// disc facing +z (a cylinder turned on its side), centered at (x,y,z)
const disc = (r, t, seg, col, x, y, z) => rot(ccyl(r, r, t, seg, col, x, y, z), Math.PI / 2, 0, 0);

// A board lying along the segment (x1,y1)-(x2,y2) in the XY plane, `d` deep along Z (centered at z),
// `t` thick, pushed `out` along its upward-facing normal.
function slab(x1, y1, x2, y2, t, d, col, z = 0, out = 0) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  let nx = dy / len, ny = -dx / len;
  if (ny < 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; }
  const b = cbox(len, t, d, col, (x1 + x2) / 2 + nx * out, (y1 + y2) / 2 + ny * out, z);
  b.rotation.z = Math.atan2(dy, dx);
  return b;
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
// a square stick between two 3D points
function stick(x1, y1, z1, x2, y2, z2, t, col) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1, len = Math.hypot(dx, dy, dz);
  const b = cbox(len, t, t, col, (x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
  b.quaternion.setFromUnitVectors(X_AXIS, new THREE.Vector3(dx / len, dy / len, dz / len));
  return b;
}

// a flat board (w wide, 0.04 thick) from one 3D point to another, kept level across its width
function plank(x1, y1, z1, x2, y2, z2, w, col) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  const hd = Math.hypot(dx, dz) || 1e-6, len = Math.hypot(hd, dy);
  const b = cbox(Math.max(len, 0.04), 0.04, w, col, (x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
  b.rotation.set(0, Math.atan2(-dz, dx), Math.atan2(dy, hd));
  return b;
}

// Gambrel roof shell made of boards, matching the outline of roof(w, h, d, ..., true), with white
// fascia boards on both gable ends and a ridge cap. The gable itself is filled separately.
function gambrelShell(w, h, y0, depth, z, col, trim) {
  const t = 0.11;
  const A = [w / 2, 0], B = [w * 0.36, h * 0.62], P = [0, h];
  const parts = [];
  for (const s of [1, -1]) {
    for (const [p, q, e1, e2] of [[A, B, 0.17, 0.035], [B, P, 0.035, 0.04]]) {
      const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      const x1 = (p[0] - ux * e1) * s, y1 = y0 + p[1] - uy * e1;
      const x2 = (q[0] + ux * e2) * s, y2 = y0 + q[1] + uy * e2;
      parts.push(slab(x1, y1, x2, y2, t, depth, col, z, t / 2));
      for (const e of [1, -1]) parts.push(slab(x1, y1, x2, y2, t + 0.05, 0.07, trim, z + e * (depth / 2 - 0.03), t / 2));
    }
  }
  parts.push(cbox(0.14, 0.09, depth + 0.04, trim, 0, y0 + h + 0.1, z));
  return parts;
}

function barrel(x, z, s = 1, col = '#a0683a', y = 0) {
  return [
    cyl(0.17 * s, 0.19 * s, 0.2 * s, 10, col, x, y, z),
    cyl(0.19 * s, 0.17 * s, 0.2 * s, 10, col, x, y + 0.2 * s, z),
    cyl(0.195 * s, 0.195 * s, 0.035 * s, 10, '#5d4a3a', x, y + 0.05 * s, z),
    cyl(0.195 * s, 0.195 * s, 0.035 * s, 10, '#5d4a3a', x, y + 0.31 * s, z),
    cyl(0.15 * s, 0.15 * s, 0.02 * s, 10, C.woodDark, x, y + 0.4 * s, z),
  ];
}

function sack(x, z, col = '#e6d3a8', s = 1, y = 0, ry = 0) {
  const gr = group(
    box(0.26 * s, 0.18 * s, 0.19 * s, col, 0, 0, 0),
    box(0.22 * s, 0.07 * s, 0.16 * s, col, 0, 0.18 * s, 0),
    ccyl(0.04 * s, 0.07 * s, 0.05 * s, 6, col, 0, 0.27 * s, 0),
    ccyl(0.042 * s, 0.042 * s, 0.025 * s, 6, C.woodDark, 0, 0.305 * s, 0),
    ccyl(0.055 * s, 0.03 * s, 0.04 * s, 6, col, 0, 0.335 * s, 0),
  );
  gr.position.set(x, y, z);
  gr.rotation.y = ry;
  return gr;
}

// a ring made of short boards (for wheels), in the XY plane, at depth z
function ring(R, t, d, n, col, z = 0) {
  const parts = [];
  const seg = (2 * Math.PI * R) / n * 1.08;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const b = cbox(seg, t, d, col, Math.cos(a) * R, Math.sin(a) * R, z);
    b.rotation.z = a + Math.PI / 2;
    parts.push(b);
  }
  return parts;
}

// ------------------------------------------------------------------ storage barn (3x3)
function storagebarn() {
  const red = C.red, dark = C.redDark, W = C.white, roofCol = '#5b606d';
  const wallW = 2.5, wallD = 2.3, zc = -0.12, wallY = 0.15, wallH = 1.4, gh = 1.3;
  const front = zc + wallD / 2; // 1.03
  const top = wallY + wallH; // 1.55
  const parts = [
    box(2.66, 0.15, 2.5, C.stoneDark, 0, 0, zc),
    box(wallW, wallH, wallD, red, 0, wallY, zc),
    roof(wallW, gh, wallD, red, 0, top, zc, true),
    gambrelShell(wallW, gh, top, wallD + 0.32, zc, roofCol, W),
    box(wallW + 0.05, 0.08, wallD + 0.05, W, 0, top - 0.08, zc),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.1, wallH, 0.1, W, sx * wallW / 2, wallY, zc + sz * wallD / 2));
  // board-and-batten strips
  for (const x of [-1.0, -0.82, 0.82, 1.0]) parts.push(box(0.04, wallH - 0.1, 0.03, dark, x, wallY, front + 0.01));
  for (const z of [-1.05, -0.1, 0.78]) parts.push(box(0.03, wallH - 0.1, 0.04, dark, wallW / 2 + 0.01, wallY, z));

  // big double doors with white X bracing
  const dz = front + 0.025, doorH = 1.02;
  for (const sx of [-1, 1]) {
    const cx = sx * 0.3;
    parts.push(box(0.58, doorH, 0.05, dark, cx, wallY, dz));
    parts.push(slab(cx - 0.24, wallY + 0.07, cx + 0.24, wallY + doorH - 0.07, 0.065, 0.03, W, dz + 0.04));
    parts.push(slab(cx + 0.24, wallY + 0.07, cx - 0.24, wallY + doorH - 0.07, 0.065, 0.03, W, dz + 0.04));
    parts.push(box(0.04, 0.12, 0.03, C.black, sx * 0.07, wallY + 0.45, dz + 0.05)); // handles
  }
  parts.push(
    box(0.08, doorH + 0.04, 0.06, W, -0.63, wallY, dz + 0.02),
    box(0.08, doorH + 0.04, 0.06, W, 0.63, wallY, dz + 0.02),
    box(0.05, doorH, 0.06, W, 0, wallY, dz + 0.025),
    box(1.34, 0.09, 0.06, W, 0, wallY + doorH, dz + 0.02),
    box(1.4, 0.07, 0.36, C.stone, 0, 0, front + 0.2), // ramp
  );

  // hay loft: open door with hay peeking out, hoist beam above
  const ly = top + 0.16;
  parts.push(
    box(0.64, 0.6, 0.04, W, 0, ly - 0.05, front + 0.005),
    box(0.5, 0.48, 0.04, '#4a2a1c', 0, ly + 0.01, front + 0.02),
    box(0.46, 0.16, 0.12, C.straw, 0, ly + 0.01, front + 0.04),
    rot(cbox(0.14, 0.05, 0.1, C.strawDark, -0.12, ly + 0.19, front + 0.07), 0, 0.4, 0.3),
    rot(cbox(0.12, 0.05, 0.1, C.straw, 0.14, ly + 0.2, front + 0.07), 0, -0.3, -0.25),
    rot(cbox(0.24, 0.48, 0.04, dark, 0.25 + Math.cos(1.15) * 0.12, ly + 0.25, front + 0.02 + Math.sin(1.15) * 0.12), 0, -1.15, 0),
    box(0.08, 0.08, 0.5, C.woodDark, 0, top + 0.86, front + 0.04),
    box(0.015, 0.32, 0.015, '#7a6a52', 0, top + 0.54, front + 0.26),
    cbox(0.06, 0.06, 0.06, C.black, 0, top + 0.82, front + 0.26),
  );

  // round-ish vent on the back gable
  parts.push(
    box(0.42, 0.42, 0.04, W, 0, top + 0.3, zc - wallD / 2 - 0.02),
    box(0.32, 0.32, 0.04, '#4a2a1c', 0, top + 0.35, zc - wallD / 2 - 0.035),
    box(0.04, 0.32, 0.05, W, 0, top + 0.35, zc - wallD / 2 - 0.04), box(0.32, 0.04, 0.05, W, 0, top + 0.49, zc - wallD / 2 - 0.04),
  );
  // side windows (+x)
  for (const z of [-0.6, 0.35]) {
    parts.push(
      box(0.04, 0.5, 0.5, W, wallW / 2 + 0.01, 0.58, z),
      box(0.04, 0.4, 0.4, C.glass, wallW / 2 + 0.025, 0.63, z, 'glow'),
      box(0.03, 0.4, 0.04, W, wallW / 2 + 0.045, 0.63, z),
      box(0.03, 0.04, 0.4, W, wallW / 2 + 0.045, 0.81, z),
    );
  }
  // lanterns either side of the doors
  for (const sx of [-1, 1]) {
    parts.push(
      box(0.04, 0.04, 0.12, C.black, sx * 0.85, 1.08, front + 0.06),
      box(0.11, 0.15, 0.11, C.glass, sx * 0.85, 0.92, front + 0.12, 'glow'),
      box(0.14, 0.04, 0.14, C.black, sx * 0.85, 1.07, front + 0.12),
    );
  }
  // cupola + weathervane
  const ry = top + gh + 0.08;
  parts.push(
    box(0.4, 0.36, 0.4, W, 0, ry - 0.12, zc),
    box(0.26, 0.2, 0.42, '#7a3b30', 0, ry + 0.03, zc),
    box(0.42, 0.2, 0.26, '#7a3b30', 0, ry + 0.03, zc),
    rot(cone(0.4, 0.3, 4, roofCol, 0, ry + 0.24, zc), 0, Math.PI / 4, 0),
    box(0.025, 0.4, 0.025, C.black, 0, ry + 0.5, zc),
    box(0.3, 0.02, 0.02, C.black, 0, ry + 0.66, zc),
    box(0.02, 0.02, 0.3, C.black, 0, ry + 0.66, zc),
    box(0.34, 0.025, 0.025, C.black, 0, ry + 0.78, zc),
    rot(cone(0.045, 0.1, 4, C.black, 0.2, ry + 0.742, zc), 0, 0, -Math.PI / 2),
    box(0.08, 0.1, 0.02, C.black, -0.17, ry + 0.74, zc),
    // little rooster
    box(0.14, 0.09, 0.025, C.black, 0, ry + 0.8, zc),
    box(0.06, 0.08, 0.025, C.black, 0.07, ry + 0.87, zc),
    rot(cbox(0.08, 0.1, 0.025, C.black, -0.09, ry + 0.92, zc), 0, 0, 0.5),
  );
  // hay bales and tools out front
  parts.push(
    rot(ccyl(0.22, 0.22, 0.4, 10, C.straw, 1.13, 0.22, 1.27), 0, 0, Math.PI / 2),
    rot(ccyl(0.225, 0.225, 0.04, 10, C.strawDark, 1.34, 0.22, 1.27), 0, 0, Math.PI / 2),
    box(0.44, 0.22, 0.26, C.straw, -1.08, 0, 1.3),
    box(0.44, 0.03, 0.27, C.strawDark, -1.08, 0.1, 1.3),
    box(0.4, 0.2, 0.25, C.strawDark, -1.04, 0.22, 1.28),
    box(0.3, 0.26, 0.28, C.woodLight, 1.2, 0, -1.25 + 0.0),
    stick(-0.72, 0.02, 1.2, -0.72, 1.1, 1.06, 0.035, C.wood),
    box(0.16, 0.03, 0.03, C.stoneDark, -0.72, 1.07, 1.06),
    box(0.02, 0.14, 0.02, C.stoneDark, -0.66, 1.1, 1.05), box(0.02, 0.14, 0.02, C.stoneDark, -0.72, 1.1, 1.05), box(0.02, 0.14, 0.02, C.stoneDark, -0.78, 1.1, 1.05),
  );
  return group(parts);
}

// ------------------------------------------------------------------ silo (2x2)
function silo() {
  const body = '#a9b8c6', bodyLight = '#bcc9d4', band = '#8395a7', metal = '#6b7480', R = 0.6, base = 0.16, Hb = 2.3;
  const topY = base + Hb;
  const parts = [
    cyl(0.8, 0.86, base, 12, C.stoneDark, 0, 0, 0),
    cyl(R, R, Hb, 14, body, 0, base, 0),
  ];
  for (let i = 0; i < 6; i++) {
    parts.push(cyl(R + 0.008, R + 0.008, 0.18, 14, bodyLight, 0, base + 0.1 + i * 0.38, 0));
    parts.push(cyl(R + 0.03, R + 0.03, 0.05, 14, band, 0, base + 0.34 + i * 0.38, 0));
  }
  parts.push(
    cyl(R + 0.045, R + 0.045, 0.07, 14, band, 0, topY - 0.05, 0),
    scl(sph(R + 0.02, '#cfd8e0', 0, topY, 0, 14, 8), 1, 0.62, 1),
    cyl(0.14, 0.17, 0.14, 8, band, 0, topY + 0.32, 0),
    cone(0.19, 0.16, 8, C.red, 0, topY + 0.46, 0),
    box(0.03, 0.12, 0.03, metal, 0, topY + 0.6, 0),
    // access hatch + plaque
    box(0.32, 0.44, 0.06, '#71839a', -0.12, base + 0.02, R - 0.03),
    box(0.04, 0.04, 0.03, C.black, 0.0, base + 0.25, R + 0.01),
    cyl(R + 0.02, R + 0.02, 0.14, 14, C.red, 0, topY - 0.36, 0),
  );
  // wheat emblem on a plaque, turned to sit flat on the curved wall
  const em = [cbox(0.36, 0.36, 0.04, C.cream, 0, 0, 0), cbox(0.4, 0.04, 0.05, C.red, 0, -0.18, 0), cbox(0.4, 0.04, 0.05, C.red, 0, 0.18, 0)];
  for (const a of [-0.45, 0, 0.45]) {
    em.push(rot(cbox(0.025, 0.2, 0.02, C.strawDark, Math.sin(a) * 0.04, -0.04, 0.03), 0, 0, -a));
    em.push(rot(scl(sph(0.04, '#e9b93a', Math.sin(a) * 0.11, 0.07 + Math.cos(a) * 0.02, 0.035, 6, 4), 0.8, 1.7, 0.6), 0, 0, -a));
  }
  em.push(cbox(0.1, 0.03, 0.03, C.red, 0, -0.06, 0.035));
  const emblem = group(em);
  emblem.position.set(Math.sin(-0.5) * (R + 0.02), 1.5, Math.cos(-0.5) * (R + 0.02));
  emblem.rotation.y = -0.5;
  parts.push(emblem);
  // ladder on the +x/+z side
  const lad = [];
  const lr = R + 0.08;
  for (const s of [-1, 1]) lad.push(box(0.035, topY + 0.25, 0.035, metal, s * 0.12, base, lr));
  for (let y = base + 0.18; y < topY + 0.2; y += 0.2) lad.push(box(0.24, 0.028, 0.028, metal, 0, y, lr));
  for (const y of [0.6, 1.5, 2.3]) for (const s of [-1, 1]) lad.push(box(0.03, 0.03, 0.09, metal, s * 0.12, y, R + 0.03));
  // safety cage hoops
  for (const y of [1.35, 1.75, 2.15, 2.5]) {
    lad.push(box(0.4, 0.025, 0.025, metal, 0, y, lr + 0.24));
    for (const s of [-1, 1]) lad.push(box(0.025, 0.025, 0.24, metal, s * 0.2, y, lr + 0.12));
  }
  for (const s of [-1, 0, 1]) lad.push(box(0.022, 1.2, 0.022, metal, s * 0.19, 1.33, lr + (s === 0 ? 0.24 : 0.2)));
  parts.push(rot(group(lad), 0, Math.PI / 4, 0));
  // grain sacks & scoop at the foot
  parts.push(
    sack(-0.72, 0.58, '#e6d3a8', 1, 0, 0.3),
    sack(-0.5, 0.78, '#d9c290', 0.85, 0, -0.4),
    cyl(0.1, 0.08, 0.1, 8, C.woodDark, 0.82, 0, -0.6),
    scl(sph(0.08, C.straw, 0.82, 0.1, -0.6), 1, 0.5, 1),
  );
  return group(parts);
}

// ------------------------------------------------------------------ pig sty (4x4 pen)
function pigsty() {
  const mud = '#8a6038', mudDark = '#664426', dirt = '#c29a6a', pinkRoof = '#e58fa0';
  const parts = [
    groundPatch(3.8, 3.8, dirt),
    fenceRect(4, 4),
    // mud wallow (overlapping blobs) + puddles
    scl(ccyl(0.5, 0.54, 0.03, 14, mud, 0.25, 0.034, 0.6), 1.3, 1, 0.9),
    scl(ccyl(0.4, 0.44, 0.03, 14, mud, 0.8, 0.036, 0.85), 1.2, 1, 0.85),
    scl(ccyl(0.32, 0.36, 0.03, 12, mud, -0.25, 0.038, 0.85), 1.2, 1, 0.8),
    scl(ccyl(0.3, 0.32, 0.03, 12, mudDark, 0.35, 0.05, 0.7), 1.5, 1, 0.75),
    scl(ccyl(0.2, 0.22, 0.03, 12, mudDark, 0.75, 0.052, 0.86), 1.3, 1, 0.8),
    scl(ccyl(0.26, 0.3, 0.03, 12, mud, 0.95, 0.034, -0.8), 1, 1, 1.35),
    scl(ccyl(0.16, 0.18, 0.03, 10, mudDark, 0.95, 0.05, -0.75), 1, 1, 1.3),
    scl(ccyl(0.16, 0.2, 0.03, 10, mud, -1.05, 0.034, 0.25), 1.4, 1, 0.8),
    scl(ball(0.08, mud, -0.6, 0.03, 0.15), 1, 0.4, 1),
    scl(ball(0.06, mud, 1.25, 0.03, 0.25), 1, 0.4, 1),
    scl(ball(0.07, mud, -1.3, 0.03, 1.2), 1, 0.4, 1),
  ];
  // grass tufts and straw bits along the fence (outside the pig yard)
  for (const [x, z] of [[-1.75, 0.4], [-1.72, 1.4], [1.75, 0.0], [1.72, 1.2], [-0.4, 1.75], [0.9, 1.75], [0.2, -1.78]]) {
    parts.push(cone(0.05, 0.15, 3, C.leaf, x, 0, z), cone(0.045, 0.11, 3, C.leafLight, x + 0.06, 0, z + 0.04));
  }
  parts.push(
    rot(box(0.14, 0.015, 0.03, C.straw, 0.35, 0.03, 0.2), 0, 0.6, 0),
    rot(box(0.12, 0.015, 0.03, C.strawDark, -0.9, 0.03, 0.6), 0, -0.4, 0),
    rot(box(0.14, 0.015, 0.03, C.straw, 1.1, 0.03, 1.3), 0, 1.2, 0),
  );
  // hut (back-left)
  const hx = -1.05, hz = -1.2, hw = 1.15, hd = 0.9, hh = 0.62;
  const hf = hz + hd / 2;
  parts.push(
    box(hw, hh, hd, C.plank, hx, 0, hz),
    box(hw + 0.02, 0.035, hd + 0.02, C.woodDark, hx, 0.2, hz),
    box(hw + 0.02, 0.035, hd + 0.02, C.woodDark, hx, 0.41, hz),
    box(0.08, hh, 0.08, C.woodDark, hx - hw / 2, 0, hf), box(0.08, hh, 0.08, C.woodDark, hx + hw / 2, 0, hf),
    roof(hw + 0.3, 0.52, hd + 0.28, pinkRoof, hx, hh, hz),
    box(hw + 0.34, 0.06, 0.06, '#c46d80', hx, hh - 0.02, hf + 0.15),
    // arched doorway
    box(0.38, 0.36, 0.04, '#3a2414', hx, 0, hf + 0.01),
    disc(0.19, 0.04, 10, '#3a2414', hx, 0.36, hf + 0.01),
    // round window on the +x side
    rot(ccyl(0.11, 0.11, 0.04, 10, '#3a2414', hx + hw / 2 + 0.005, 0.38, hz), 0, 0, Math.PI / 2),
    // pig-nose sign on the gable
    box(0.34, 0.22, 0.04, C.woodLight, hx, hh + 0.08, hf + 0.15),
    disc(0.075, 0.03, 10, C.pink, hx, hh + 0.19, hf + 0.18),
    box(0.025, 0.04, 0.02, '#7a3b4a', hx - 0.025, hh + 0.17, hf + 0.2), box(0.025, 0.04, 0.02, '#7a3b4a', hx + 0.025, hh + 0.17, hf + 0.2),
    // straw spilling out of the door
    scl(sph(0.2, C.straw, hx, 0.02, hf + 0.15), 1.25, 0.25, 0.7),
    scl(sph(0.1, C.strawDark, hx + 0.2, 0.02, hf + 0.08), 1.2, 0.3, 0.8),
  );
  // feeding trough along the back fence (carrots = pig food)
  const tx = 0.85, tz = -1.72;
  parts.push(
    box(1.0, 0.06, 0.32, C.woodDark, tx, 0, tz),
    box(1.0, 0.18, 0.05, C.wood, tx, 0.04, tz - 0.14), box(1.0, 0.18, 0.05, C.wood, tx, 0.04, tz + 0.14),
    box(0.05, 0.2, 0.32, C.woodDark, tx - 0.5, 0, tz), box(0.05, 0.2, 0.32, C.woodDark, tx + 0.5, 0, tz),
    box(0.92, 0.04, 0.22, '#c99a55', tx, 0.12, tz),
  );
  for (const [x, a] of [[-0.25, 0.3], [0.05, -0.2], [0.3, 0.6]]) {
    parts.push(rot(cone(0.035, 0.16, 5, C.orange, tx + x, 0.15, tz), 0, a, Math.PI / 2));
    parts.push(rot(cone(0.03, 0.08, 4, C.leaf, tx + x - 0.1 * Math.cos(a), 0.17, tz + 0.1 * Math.sin(a)), 0, a, -Math.PI / 2));
  }
  // water barrel in the front-right corner, bucket between hut and yard
  parts.push(...barrel(1.66, 1.66, 0.9));
  parts.push(cyl(0.12, 0.12, 0.012, 10, C.blue, 1.66, 0.37, 1.66));
  parts.push(cyl(0.11, 0.09, 0.16, 8, '#9aa6b2', -0.05, 0, -1.62), cyl(0.1, 0.1, 0.012, 8, C.blue, -0.05, 0.155, -1.62));
  // muddy corn cob toy
  parts.push(rot(scl(sph(0.05, C.yellow, -1.65, 0.05, 0.45), 1, 2, 1), 0, 0.6, Math.PI / 2));
  return group(parts);
}

// ------------------------------------------------------------------ apiary (3x3 pen)
function hive(x, z, ry, lower, upper, lid) {
  const gr = group(
    box(0.08, 0.08, 0.08, C.woodDark, -0.18, 0, -0.18), box(0.08, 0.08, 0.08, C.woodDark, 0.18, 0, -0.18),
    box(0.08, 0.08, 0.08, C.woodDark, -0.18, 0, 0.18), box(0.08, 0.08, 0.08, C.woodDark, 0.18, 0, 0.18),
    box(0.5, 0.035, 0.52, C.wood, 0, 0.08, 0),
    box(0.44, 0.2, 0.44, lower, 0, 0.115, 0),
    box(0.46, 0.025, 0.46, C.woodLight, 0, 0.315, 0),
    box(0.44, 0.19, 0.44, upper, 0, 0.34, 0),
    box(0.47, 0.035, 0.47, lid, 0, 0.53, 0),
    rot(cbox(0.54, 0.045, 0.56, lid, 0, 0.6, 0), 0.14, 0, 0),
    box(0.26, 0.035, 0.02, '#2b1a10', 0, 0.135, 0.222),
    rot(cbox(0.3, 0.02, 0.1, C.woodLight, 0, 0.125, 0.26), 0.25, 0, 0),
    box(0.12, 0.03, 0.02, C.woodDark, 0, 0.42, 0.222), // handle
  );
  gr.position.set(x, 0, z);
  gr.rotation.y = ry;
  return gr;
}

function flowerClump(x, z, seed, cols, n = 4, spread = 0.14) {
  const r = hashRand(seed);
  const parts = [scl(sph(0.14, C.leaf, x, 0.03, z, 7, 5), 1.3, 0.55, 1.3)];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = 0.04 + r() * spread;
    const fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d, h = 0.16 + r() * 0.16;
    parts.push(box(0.02, h, 0.02, C.leafDark, fx, 0, fz));
    parts.push(ball(0.055, cols[Math.floor(r() * cols.length)], fx, h + 0.02, fz));
    parts.push(ball(0.025, C.yellow, fx, h + 0.06, fz));
  }
  return parts;
}

function apiary() {
  const parts = [
    groundPatch(2.8, 2.8, '#9ad66d'),
    fenceRect(3, 3),
    // stepping stones from the gate
    scl(cyl(0.15, 0.16, 0.04, 6, C.stone, 0, 0, 1.15), 1.2, 1, 0.9),
    scl(cyl(0.13, 0.14, 0.04, 6, '#c8c3b6', 0.08, 0, 0.82), 1.1, 1, 0.9),
    // central lavender bed (kept low for the bees)
    cyl(0.34, 0.37, 0.1, 10, C.stone, 0, 0, 0),
    cyl(0.3, 0.3, 0.02, 10, C.soil, 0, 0.1, 0),
  ];
  const r = hashRand(77);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.3, d = i === 0 ? 0 : 0.17 + r() * 0.06;
    const x = i === 0 ? 0 : Math.cos(a) * d, z = i === 0 ? 0 : Math.sin(a) * d;
    parts.push(box(0.02, 0.14, 0.02, C.leafDark, x, 0.1, z));
    parts.push(cone(0.04, 0.16, 5, i % 3 ? C.purple : '#a988dc', x, 0.22, z));
  }
  // hives around the center, entrances turned toward the middle/front
  parts.push(
    hive(0, -0.92, 0, C.white, '#f6d860', '#c98a3a'),
    hive(-0.9, 0.42, 1.0, '#f6d860', C.white, '#c98a3a'),
    hive(0.9, 0.42, -1.0, C.white, '#f6d860', '#c98a3a'),
  );
  // flower clumps between the hives
  const warm = [C.pink, C.yellow, C.white, C.orange], cool = [C.purple, C.white, C.pink, '#7fb8f0'];
  parts.push(
    flowerClump(-0.92, -0.95, 1, warm),
    flowerClump(0.92, -0.95, 2, cool),
    flowerClump(-1.1, -0.25, 3, cool, 3),
    flowerClump(1.1, -0.25, 4, warm, 3),
    flowerClump(-0.55, 1.1, 5, warm, 4),
    flowerClump(0.6, 1.1, 6, cool, 4),
    flowerClump(-0.45, -0.45, 7, warm, 2, 0.06),
    flowerClump(0.5, -0.4, 8, cool, 2, 0.06),
  );
  // honey pot on a stump by the gate
  parts.push(
    cyl(0.12, 0.14, 0.22, 8, C.trunk, 1.1, 0, 1.12),
    cyl(0.1, 0.1, 0.02, 8, C.woodLight, 1.1, 0.22, 1.12),
    scl(sph(0.08, '#e8a33d', 1.1, 0.3, 1.12), 1, 0.9, 1),
    cyl(0.05, 0.06, 0.04, 8, '#e8a33d', 1.1, 0.36, 1.12),
    cyl(0.055, 0.055, 0.02, 8, C.red, 1.1, 0.39, 1.12),
  );
  return group(parts);
}

// ------------------------------------------------------------------ goat hill (4x4 pen)
function goatpen() {
  const parts = [
    groundPatch(3.8, 3.8, '#8fd062'),
    fenceRect(4, 4),
  ];
  // 'Goat Hill': a grassy knoll in the back-right quadrant crowned with boulders (goats love climbing).
  // Knoll spans x 0.05..1.15, z -1.64..-0.26, peak ~0.47; the yard rects stay clear.
  const kH = 0.55 * 0.85; // knoll peak height
  const knollY = (x, z) => kH * Math.sqrt(Math.max(0, 1 - ((x - 0.6) / 0.55) ** 2 - ((z + 0.95) / 0.6875) ** 2));
  parts.push(
    scl(sph(0.55, '#7cc24f', 0.6, 0, -0.95, 10, 6), 1.0, 0.85, 1.25),
    scl(sph(0.4, '#86cb57', 0.42, 0, -0.62, 8, 5), 1.0, 0.45, 0.9),
    // boulders crowning the knoll, set toward the back so the green front slope shows
    scl(ball(0.32, C.stone, 0.66, 0.46, -1.16, 0), 1.05, 0.85, 1.15),
    scl(ball(0.22, '#c8c3b6', 0.84, 0.72, -1.27, 0), 1.0, 0.8, 1.1),
    rot(scl(ball(0.2, C.stoneDark, 0.26, 0.36, -1.14, 0), 1.1, 0.8, 1), 0, 0.6, 0),
    scl(sph(0.16, C.leaf, 0.86, 0.88, -1.28, 8, 4), 1.05, 0.28, 1.0),
    // small stones at the foot of the knoll
    scl(ball(0.13, C.stone, 0.95, 0.06, -0.38, 0), 1.2, 0.7, 1),
    scl(ball(0.12, '#c8c3b6', 1.12, 0.05, -0.62, 0), 1, 0.7, 1.2),
    scl(ball(0.13, C.stoneDark, 0.32, 0.05, -1.62, 0), 1.2, 0.7, 1),
    scl(ball(0.12, C.stone, 1.05, 0.05, -1.72, 0), 1.2, 0.7, 1),
    // plank ramp from the yard up the knoll to the rocks, with cleats
    plank(0.05, 0.03, -0.4, 0.5, 0.62, -0.92, 0.2, C.wood),
  );
  for (const t of [0.3, 0.55, 0.8]) {
    const x = 0.05 + 0.45 * t, y = 0.03 + 0.59 * t + 0.04, z = -0.4 - 0.52 * t;
    parts.push(stick(x - 0.075, y, z - 0.065, x + 0.075, y, z + 0.065, 0.035, C.woodDark));
  }
  // a little pennant on the summit: king of the hill
  parts.push(
    cyl(0.015, 0.015, 0.36, 4, C.woodDark, 0.9, 0.84, -1.32),
    rot(cbox(0.2, 0.11, 0.012, C.red, 0.97, 1.13, -1.39), 0, Math.PI / 4, 0),
    rot(cbox(0.2, 0.03, 0.014, C.white, 0.97, 1.13, -1.39), 0, Math.PI / 4, 0),
  );
  // grass tufts and wildflowers on the knoll's slopes
  for (const [x, z, k] of [[0.95, -0.72, 0], [0.15, -0.75, 1], [0.62, -0.5, 2], [1.02, -0.95, 3], [0.8, -0.38, 4]]) {
    const y = knollY(x, z) - 0.03;
    parts.push(cone(0.05, 0.14, 3, k % 2 ? C.leaf : C.leafLight, x, y, z), cone(0.04, 0.11, 3, C.leafLight, x + 0.05, y - 0.01, z + 0.03));
    if (k % 2 === 0) parts.push(ball(0.035, k === 2 ? C.yellow : C.white, x - 0.06, y + 0.05, z + 0.04));
  }
  parts.push(cone(0.05, 0.12, 3, C.leafDark, -0.05, 0.0, -0.3));
  // lean-to shed in the back-right corner, open to the front
  const sx = 1.5, sz = -1.43, sw = 0.72, sd = 0.82, hb = 0.95, hf = 0.72;
  const rc = '#b35a3c';
  parts.push(
    box(sw, hb, 0.07, C.plank, sx, 0, sz - sd / 2 + 0.035),
    box(0.07, hf, sd - 0.07, C.plank, sx + sw / 2 - 0.035, 0, sz + 0.03),
    rot(cbox(0.07, 0.3, sd - 0.07, C.plank, sx + sw / 2 - 0.035, (hb + hf) / 2 - 0.16, sz + 0.03), Math.atan2(hb - hf + 0.08, sd + 0.24), 0, 0),
    box(0.07, 0.04, sd - 0.07, C.woodDark, sx + sw / 2 - 0.03, 0.35, sz + 0.03),
    box(0.07, hf, 0.07, C.woodDark, sx - sw / 2 + 0.035, 0, sz + sd / 2 - 0.035),
    box(0.07, hf, 0.07, C.woodDark, sx + sw / 2 - 0.035, 0, sz + sd / 2 - 0.035),
    box(0.07, hb, 0.07, C.woodDark, sx - sw / 2 + 0.035, 0, sz - sd / 2 + 0.035),
    box(0.04, 0.05, sd - 0.1, C.woodDark, sx - sw / 2 + 0.035, 0.4, sz),
    rot(cbox(sw + 0.16, 0.06, Math.hypot(sd + 0.24, hb - hf + 0.08), rc, sx, (hb + hf) / 2 + 0.03, sz), Math.atan2(hb - hf + 0.08, sd + 0.24), 0, 0),
    rot(cbox(0.04, 0.02, Math.hypot(sd + 0.24, hb - hf + 0.08), '#8f4530', sx - 0.15, (hb + hf) / 2 + 0.065, sz), Math.atan2(hb - hf + 0.08, sd + 0.24), 0, 0),
    rot(cbox(0.04, 0.02, Math.hypot(sd + 0.24, hb - hf + 0.08), '#8f4530', sx + 0.15, (hb + hf) / 2 + 0.065, sz), Math.atan2(hb - hf + 0.08, sd + 0.24), 0, 0),
    scl(sph(0.26, C.straw, sx, 0.02, sz + 0.05), 1.1, 0.3, 1.2),
    box(0.4, 0.22, 0.05, C.woodDark, sx, 0.45, sz - sd / 2 + 0.09),
    box(0.34, 0.12, 0.06, C.straw, sx, 0.52, sz - sd / 2 + 0.11),
  );
  // water trough in front of the shed
  parts.push(
    box(0.34, 0.2, 0.62, C.woodDark, 1.55, 0, -0.55),
    box(0.26, 0.015, 0.54, C.blue, 1.55, 0.195, -0.55),
  );
  // sunflower feed crib in the back-left corner
  parts.push(
    box(0.36, 0.26, 0.36, C.wood, -1.72, 0, -1.72),
    box(0.3, 0.06, 0.3, C.straw, -1.72, 0.24, -1.72),
    rot(disc(0.09, 0.03, 10, C.yellow, -1.7, 0.33, -1.68), -1.0, 0, 0),
    rot(disc(0.05, 0.035, 8, '#6b3d1c', -1.7, 0.335, -1.67), -1.0, 0, 0),
    // stump to hop on in the front-right corner
    cyl(0.16, 0.19, 0.24, 8, C.trunk, 1.72, 0, 1.72),
    cyl(0.14, 0.14, 0.02, 8, C.woodLight, 1.72, 0.24, 1.72),
    // a bell on a gatepost
    box(0.03, 0.03, 0.08, C.black, 0.96, 0.46, 1.84),
    cone(0.05, 0.08, 6, C.yellow, 0.96, 0.36, 1.8),
  );
  // clover patches in the yard (flat, goats walk over them) and tufts by the fence
  for (const [x, z, k] of [[-0.9, 0.8, 1], [0.6, 1.0, 2], [-0.8, -0.9, 3], [-0.2, 0.3, 4]]) {
    parts.push(scl(sph(0.22, k % 2 ? '#6db446' : '#74bb4c', x, 0.0, z, 8, 4), 1.2, 0.18, 0.9));
    parts.push(ball(0.04, C.white, x + 0.08, 0.04, z), ball(0.04, C.pink, x - 0.1, 0.04, z + 0.06), ball(0.035, C.white, x - 0.02, 0.04, z - 0.1));
  }
  for (const [x, z] of [[-1.75, 0.8], [-1.7, -0.6], [1.75, 0.6], [-0.8, -1.75], [1.0, 1.75], [-1.2, 1.75]]) {
    parts.push(cone(0.05, 0.16, 3, C.leafLight, x, 0, z), cone(0.045, 0.12, 3, C.leaf, x + 0.06, 0, z + 0.03));
  }
  return group(parts);
}

// ------------------------------------------------------------------ popcorn stand (2x2)
function popcorn() {
  const red = '#e0473b', W = C.white, gold = '#f2b632';
  const parts = [
    // cart body
    box(1.16, 0.46, 0.74, red, 0, 0.24, 0),
    box(1.2, 0.07, 0.78, W, 0, 0.7, 0),
    box(1.2, 0.05, 0.78, gold, 0, 0.24, 0),
    box(0.62, 0.26, 0.02, C.cream, 0, 0.34, 0.375),
    box(0.66, 0.03, 0.025, gold, 0, 0.6, 0.38), box(0.66, 0.03, 0.025, gold, 0, 0.32, 0.38),
  ];
  // striped popcorn bucket icon on the front panel
  for (let i = 0; i < 3; i++) parts.push(box(0.04, 0.12, 0.02, i % 2 ? W : red, -0.04 + i * 0.04, 0.37, 0.39));
  parts.push(ball(0.035, '#fff4cf', -0.03, 0.51, 0.39), ball(0.035, '#ffe9a0', 0.03, 0.52, 0.39), ball(0.03, '#fff4cf', 0.0, 0.54, 0.395));
  // wheels (front and back) and push handle
  for (const x of [-0.36, 0.36]) {
    for (const z of [-0.41, 0.41]) {
      parts.push(
        disc(0.21, 0.05, 12, gold, x, 0.21, z),
        disc(0.07, 0.07, 8, red, x, 0.21, z),
        rot(cbox(0.38, 0.03, 0.03, W, x, 0.21, z + Math.sign(z) * 0.03), 0, 0, 0.6),
        rot(cbox(0.38, 0.03, 0.03, W, x, 0.21, z + Math.sign(z) * 0.03), 0, 0, -0.6),
      );
    }
  }
  parts.push(
    box(0.4, 0.04, 0.04, C.woodDark, -0.78, 0.6, 0.22), box(0.4, 0.04, 0.04, C.woodDark, -0.78, 0.6, -0.22),
    box(0.05, 0.05, 0.5, C.woodDark, -0.97, 0.6, 0),
  );
  // glass popcorn case on top: frame, back pane, kettle and a heap of popcorn
  const cy = 0.77;
  parts.push(box(0.8, 0.05, 0.56, gold, 0, cy, 0));
  for (const x of [-0.37, 0.37]) for (const z of [-0.25, 0.25]) parts.push(box(0.045, 0.56, 0.045, red, x, cy + 0.05, z));
  parts.push(
    box(0.7, 0.5, 0.02, '#f6e7b8', 0, cy + 0.05, -0.25),
    box(0.02, 0.18, 0.5, '#e3f3ee', -0.37, cy + 0.05, 0),
    box(0.84, 0.07, 0.6, red, 0, cy + 0.6, 0),
    cyl(0.01, 0.01, 0.1, 4, C.stoneDark, 0, cy + 0.5, 0),
    cyl(0.1, 0.12, 0.1, 8, '#dcd3c2', 0, cy + 0.4, 0),
    cyl(0.13, 0.13, 0.02, 8, gold, 0, cy + 0.49, 0),
    // warming lamp under the case roof (glows at night)
    box(0.56, 0.03, 0.07, C.glass, 0, cy + 0.57, 0.18, 'glow'),
  );
  const r = hashRand(5);
  // warm buttery kernels, rounded (detail 1) so they read as popcorn rather than ice
  const pc = ['#ffeca0', '#ffdc5e', '#ffcd3c', '#fff3c2'];
  for (let i = 0; i < 22; i++) {
    const x = (r() - 0.5) * 0.52, z = -0.1 + r() * 0.3; // kept inside the case, clear of the back pane
    const heap = 1 - Math.min(1, Math.hypot(x / 0.38, (z - 0.08) / 0.28));
    parts.push(ball(0.07 + r() * 0.03, pc[i % 4], x, cy + 0.11 + r() * 0.05 + heap * 0.22, z, 1));
  }
  // popcorn spilling from the kettle
  parts.push(ball(0.04, '#fff4cf', 0.08, cy + 0.37, 0.06), ball(0.035, '#ffe9a0', 0.12, cy + 0.31, 0.05));
  // red & white striped canopy on four poles, ridge along x
  const py = 1.55;
  for (const x of [-0.55, 0.55]) for (const z of [-0.35, 0.35]) parts.push(box(0.04, py - 0.72, 0.04, W, x, 0.72, z));
  const can = [];
  const n = 7, len = 1.4;
  for (let i = 0; i < n; i++) {
    can.push(roof(1.0, 0.34, len / n, i % 2 ? W : red, 0, 0, -len / 2 + (i + 0.5) * len / n));
  }
  // pennant valance along both eaves
  for (let i = 0; i < 8; i++) {
    const zz = -len / 2 + (i + 0.5) * len / 8;
    for (const s of [-1, 1]) can.push(rot(cone(0.065, 0.12, 3, i % 2 ? red : W, s * 0.5, -0.12, zz), Math.PI, s * Math.PI / 2, 0));
  }
  const canopy = rot(group(can), 0, Math.PI / 2, 0);
  canopy.position.y = py;
  parts.push(canopy);
  // chimney vent at the ridge (smoke comes out at 0, 2.0, 0)
  parts.push(
    cyl(0.06, 0.07, 0.24, 8, '#aab4be', 0, py + 0.22, 0),
    cyl(0.1, 0.1, 0.03, 8, '#8a949e', 0, py + 0.46, 0),
    box(0.03, 0.06, 0.03, '#8a949e', 0.07, py + 0.43, 0), box(0.03, 0.06, 0.03, '#8a949e', -0.07, py + 0.43, 0),
  );
  // A-frame sign out front with a popcorn bucket
  parts.push(
    rot(cbox(0.36, 0.42, 0.03, C.cream, 0.72, 0.21, 0.72), -0.22, -0.3, 0),
    rot(cbox(0.36, 0.42, 0.03, C.woodDark, 0.69, 0.21, 0.63), 0.22, -0.3, 0),
    rot(cbox(0.36, 0.06, 0.035, red, 0.722, 0.36, 0.735), -0.22, -0.3, 0),
  );
  for (let i = 0; i < 3; i++) parts.push(rot(cbox(0.045, 0.13, 0.035, i % 2 ? W : red, 0.68 + i * 0.045, 0.17, 0.76), -0.22, -0.3, 0));
  parts.push(ball(0.04, '#fff4cf', 0.7, 0.27, 0.745), ball(0.04, '#ffe9a0', 0.75, 0.27, 0.73));
  // popcorn bucket and sacks of corn by the cart
  parts.push(
    cyl(0.12, 0.09, 0.2, 8, red, -0.72, 0, 0.7),
    cyl(0.121, 0.091, 0.07, 8, W, -0.72, 0.07, 0.7),
    ball(0.06, '#fff4cf', -0.75, 0.22, 0.7), ball(0.055, '#ffe9a0', -0.68, 0.23, 0.72), ball(0.05, '#fff8e6', -0.72, 0.27, 0.68),
    sack(0.75, -0.72, '#e6d3a8', 0.9, 0, 0.4),
    scl(sph(0.07, C.yellow, 0.75, 0.32, -0.72), 1, 1.8, 1),
  );
  return group(parts);
}

// ------------------------------------------------------------------ sugar mill (3x3)
function sugarmill() {
  const bx = -0.42, bz = -0.12, bw = 1.88, bd = 2.0;
  const front = bz + bd / 2; // 0.88
  const roofCol = '#a3553a', plaster = C.cream, beam = '#6e4528';
  const parts = [
    box(bw + 0.16, 0.1, bd + 0.16, C.stoneDark, bx, 0, bz),
    box(bw, 0.78, bd, C.stone, bx, 0.1, bz),
    box(bw + 0.08, 0.07, bd + 0.08, beam, bx, 0.86, bz),
    box(bw + 0.06, 0.64, bd + 0.06, plaster, bx, 0.93, bz),
    box(bw + 0.1, 0.06, bd + 0.1, beam, bx, 1.55, bz),
    roof(bw + 0.3, 0.95, bd + 0.4, roofCol, bx, 1.59, bz),
    box(0.16, 0.08, bd + 0.44, '#8a432c', bx, 2.5, bz),
  ];
  // stone texture on the lower walls
  const r = hashRand(31);
  for (let i = 0; i < 9; i++) {
    const x = bx - bw / 2 + 0.15 + r() * (bw - 0.3), y = 0.18 + r() * 0.52;
    if (Math.abs(x - bx) < 0.4) continue;
    parts.push(box(0.2 + r() * 0.12, 0.1, 0.02, C.stoneDark, x, y, front + 0.005));
  }
  for (let i = 0; i < 6; i++) parts.push(box(0.02, 0.1, 0.2 + r() * 0.1, C.stoneDark, bx + bw / 2 + 0.005, 0.18 + r() * 0.5, bz - 0.8 + r() * 1.6));
  // timber framing on the upper floor (front and +x side)
  const uf = front + 0.035, ux = bx + bw / 2 + 0.035;
  for (const x of [-1.38, -0.78, -0.06, 0.54]) parts.push(box(0.07, 0.64, 0.03, beam, x, 0.93, uf));
  parts.push(
    slab(-0.75, 0.96, -0.09, 1.54, 0.06, 0.03, beam, uf),
    slab(-0.09, 0.96, -0.75, 1.54, 0.06, 0.03, beam, uf),
  );
  for (const z of [-1.12, -0.12, 0.88]) parts.push(box(0.03, 0.64, 0.07, beam, ux, 0.93, z));
  // upper windows (glow at night)
  for (const x of [-1.08, 0.24]) {
    parts.push(
      box(0.36, 0.34, 0.04, C.glass, x, 1.08, uf, 'glow'),
      box(0.03, 0.34, 0.05, beam, x, 1.08, uf), box(0.36, 0.03, 0.05, beam, x, 1.24, uf),
      box(0.44, 0.04, 0.08, beam, x, 1.05, uf + 0.02),
    );
  }
  // arched front door with stone surround + sugar-cube sign
  parts.push(
    box(0.66, 0.66, 0.04, C.stoneDark, bx, 0.1, front + 0.005),
    disc(0.33, 0.04, 10, C.stoneDark, bx, 0.76, front + 0.005),
    box(0.5, 0.6, 0.05, C.woodDark, bx, 0.1, front + 0.02),
    disc(0.25, 0.05, 10, C.woodDark, bx, 0.7, front + 0.02),
    box(0.02, 0.8, 0.055, '#5c3a20', bx, 0.1, front + 0.025),
    box(0.05, 0.05, 0.03, C.yellow, bx + 0.12, 0.42, front + 0.05),
    box(0.5, 0.26, 0.05, C.woodLight, 0.24, 0.48, front + 0.03),
    cbox(0.1, 0.1, 0.1, C.white, 0.16, 0.61, front + 0.08),
    rot(cbox(0.08, 0.08, 0.08, '#f4f1ea', 0.32, 0.6, front + 0.08), 0.3, 0.5, 0.2),
    box(0.26, 0.24, 0.04, C.glass, -1.08, 0.4, front + 0.01, 'glow'),
    box(0.32, 0.04, 0.08, C.stoneDark, -1.08, 0.36, front + 0.03),
  );
  // chimney on the +x roof slope (default factory smoke point is 0, 2.4, -0.1)
  parts.push(
    box(0.26, 0.6, 0.26, C.stoneDark, 0, 1.78, -0.1),
    box(0.32, 0.07, 0.32, C.stone, 0, 2.36, -0.1),
  );

  // water channel along +x, flume from the back, and the water wheel
  const wx = 0.92, wy = 0.86, wz = -0.12, R = 0.78;
  parts.push(
    box(0.62, 0.05, 2.9, '#5fb4e0', wx, 0.0, 0.0),
    box(0.08, 0.16, 2.9, C.stone, wx - 0.33, 0, 0.0), box(0.08, 0.16, 2.9, C.stone, wx + 0.33, 0, 0.0),
    box(0.1, 0.03, 0.4, '#bfe6f7', wx - 0.05, 0.05, 0.85), box(0.08, 0.03, 0.3, '#bfe6f7', wx + 0.1, 0.05, 1.2),
    // flume on stilts
    box(0.34, 0.06, 1.38, C.wood, wx, 1.76, -0.83),
    box(0.04, 0.12, 1.38, C.woodDark, wx - 0.17, 1.76, -0.83), box(0.04, 0.12, 1.38, C.woodDark, wx + 0.17, 1.76, -0.83),
    box(0.26, 0.03, 1.38, '#5fb4e0', wx, 1.82, -0.83),
    box(0.08, 1.76, 0.08, C.woodDark, wx - 0.12, 0, -1.42), box(0.08, 1.76, 0.08, C.woodDark, wx + 0.12, 0, -1.42),
    box(0.3, 0.06, 0.06, C.woodDark, wx, 1.2, -1.42),
    box(0.22, 0.24, 0.03, '#9fd6f2', wx, 1.6, -0.1),
    // bearing post outside the wheel
    box(0.12, wy + 0.06, 0.16, C.woodDark, 1.3, 0, wz),
    box(0.16, 0.08, 0.2, C.woodDark, 1.3, wy - 0.04, wz),
  );
  const wh = [];
  const D = 0.3;
  wh.push(...ring(R - 0.03, 0.07, 0.05, 14, C.woodDark, D / 2 - 0.02));
  wh.push(...ring(R - 0.03, 0.07, 0.05, 14, C.woodDark, -D / 2 + 0.02));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI;
    for (const z of [D / 2 - 0.02, -D / 2 + 0.02]) wh.push(rot(cbox(2 * R - 0.1, 0.05, 0.04, C.wood, 0, 0, z), 0, 0, a));
  }
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    wh.push(rot(cbox(0.24, 0.035, D, C.woodLight, Math.cos(a) * (R - 0.1), Math.sin(a) * (R - 0.1), 0), 0, 0, a));
  }
  wh.push(rot(ccyl(0.11, 0.11, D + 0.06, 8, C.stoneDark, 0, 0, 0), Math.PI / 2, 0, 0));
  wh.push(rot(ccyl(0.05, 0.05, 0.85, 6, C.black, 0, 0, -0.08), Math.PI / 2, 0, 0));
  const wheel = group(wh);
  wheel.position.set(wx, wy, wz);
  wheel.rotation.y = Math.PI / 2; // spin about local z = world x, like a real water wheel
  wheel.userData.keep = true;
  wheel.name = 'spinZ';

  // sugar sacks, a crate of sugar cubes and a sugarcane bundle out front
  parts.push(
    sack(0.12, 1.15, C.white, 1, 0, 0.2),
    sack(0.38, 1.2, '#f4f1ea', 0.95, 0, -0.5),
    sack(0.25, 1.32, C.white, 0.85, 0.0, 0.9),
    sack(0.24, 1.17, '#f4f1ea', 0.8, 0.24, 0.1),
    box(0.34, 0.2, 0.3, C.woodLight, -1.05, 0, 1.2),
    box(0.3, 0.02, 0.26, C.woodDark, -1.05, 0.2, 1.2),
  );
  for (let i = 0; i < 4; i++) parts.push(cbox(0.08, 0.08, 0.08, i % 2 ? C.white : '#f4f1ea', -1.12 + (i % 2) * 0.13, 0.25, 1.13 + Math.floor(i / 2) * 0.13));
  for (let i = 0; i < 6; i++) {
    const x = -1.42 + (i % 3) * 0.06, z = 1.02 + Math.floor(i / 3) * 0.06;
    parts.push(stick(x, 0.0, z + 0.25, x + 0.02, 0.95, z, 0.035, i % 2 ? '#9cc35a' : '#c9d66a'));
  }
  parts.push(rot(cbox(0.2, 0.05, 0.16, '#7a5a3a', -1.38, 0.45, 1.16), -0.26, 0, 0));
  return group(parts, wheel);
}

// ------------------------------------------------------------------ juice press (2x2)
function juicepress() {
  const wall = '#f3d9a4', roofCol = '#4fa35a', stripeA = C.orange;
  // booth at the back with its gable to the front; the ridge runs under the default smoke point (0, 2.4, -0.1)
  const kx = 0, kz = -0.53, kw = 1.18, kd = 0.84, kh = 1.0;
  const kf = kz + kd / 2; // -0.11
  const ry = 0.08 + kh, rh = 0.68, gz = kz + (kd + 0.3) / 2;
  const parts = [
    box(1.92, 0.08, 1.92, '#c8955a', 0, 0, 0),
    box(1.92, 0.01, 0.04, '#a8763f', 0, 0.075, -0.48), box(1.92, 0.01, 0.04, '#a8763f', 0, 0.075, 0.0), box(1.92, 0.01, 0.04, '#a8763f', 0, 0.075, 0.48),
    box(kw, kh, kd, wall, kx, 0.08, kz),
    box(kw + 0.04, 0.06, kd + 0.04, C.woodDark, kx, ry - 0.06, kz),
    roof(kw + 0.3, rh, kd + 0.3, roofCol, kx, ry, kz),
    box(0.07, kh, 0.07, C.woodDark, kx - kw / 2, 0.08, kf), box(0.07, kh, 0.07, C.woodDark, kx + kw / 2, 0.08, kf),
    // serving hatch + counter with juice glasses
    box(0.72, 0.4, 0.03, '#6b4428', kx, 0.5, kf + 0.005),
    box(0.88, 0.06, 0.24, C.woodDark, kx, 0.48, kf + 0.1),
    box(0.88, 0.4, 0.04, '#e9c98a', kx, 0.08, kf + 0.02),
    cyl(0.04, 0.035, 0.1, 6, C.orange, kx - 0.28, 0.54, kf + 0.12),
    cyl(0.04, 0.035, 0.1, 6, '#e8402f', kx - 0.13, 0.54, kf + 0.12),
    cyl(0.04, 0.035, 0.1, 6, '#9fd36a', kx + 0.12, 0.54, kf + 0.12),
    cyl(0.045, 0.045, 0.02, 6, C.white, kx + 0.28, 0.54, kf + 0.14),
    // side window (+x)
    box(0.03, 0.26, 0.3, C.glass, kx + kw / 2 + 0.01, 0.62, kz - 0.12, 'glow'),
    box(0.06, 0.04, 0.36, C.woodDark, kx + kw / 2 + 0.02, 0.6, kz - 0.12),
  ];
  // striped awning over the hatch
  const n = 5, sw = kw * 0.94 / n;
  for (let i = 0; i < n; i++) {
    const x = kx - kw * 0.47 + (i + 0.5) * sw;
    parts.push(rot(cbox(sw, 0.035, 0.42, i % 2 ? C.white : stripeA, x, 0.98, kf + 0.18), 0.5, 0, 0));
    parts.push(rot(cone(0.06, 0.08, 3, i % 2 ? C.white : stripeA, x, 0.81, kf + 0.37), Math.PI, 0, 0));
  }
  // orange sign on the gable
  parts.push(
    disc(0.16, 0.05, 10, C.woodLight, kx, ry + 0.24, gz + 0.02),
    disc(0.11, 0.03, 10, C.orange, kx, ry + 0.24, gz + 0.055),
    box(0.07, 0.035, 0.02, C.leaf, kx + 0.04, ry + 0.34, gz + 0.06),
  );
  // slim metal stovepipe rising out of the ridge, under the smoke point (config chimney, else the
  // default factory smoke point). Kept a little behind the gable so it clears the sign.
  const sp = (OBJECTS.juicepress && OBJECTS.juicepress.chimney) || [0, 2.4, -0.1];
  const spx = sp[0], spz = Math.min(sp[2] - 0.08, gz - 0.2), top = sp[1] - 0.12, base = ry + rh - 0.16;
  parts.push(
    cyl(0.055, 0.065, top - base, 8, '#8a949e', spx, base, spz),
    cyl(0.1, 0.12, 0.05, 8, '#6f7a84', spx, ry + rh - 0.03, spz),
    cyl(0.07, 0.07, 0.03, 8, '#6f7a84', spx, base + (top - base) * 0.6, spz),
    cyl(0.075, 0.075, 0.03, 8, '#6f7a84', spx, top - 0.03, spz),
    box(0.025, 0.07, 0.025, '#6f7a84', spx + 0.06, top - 0.01, spz), box(0.025, 0.07, 0.025, '#6f7a84', spx - 0.06, top - 0.01, spz),
    cone(0.12, 0.06, 8, '#6f7a84', spx, top + 0.055, spz),
  );
  // big wooden screw press (front-right)
  const px = -0.48, pz = 0.46, py = 0.08;
  parts.push(
    box(0.86, 0.08, 0.5, C.woodDark, px, py, pz),
    box(0.11, 1.2, 0.11, C.woodDark, px - 0.36, py, pz), box(0.11, 1.2, 0.11, C.woodDark, px + 0.36, py, pz),
    box(0.9, 0.16, 0.16, C.wood, px, py + 1.12, pz),
    box(0.06, 0.06, 0.24, C.woodDark, px - 0.36, py + 1.06, pz), box(0.06, 0.06, 0.24, C.woodDark, px + 0.36, py + 1.06, pz),
    // tub of fruit
    cyl(0.27, 0.25, 0.3, 10, C.plank, px, py + 0.08, pz),
    cyl(0.28, 0.28, 0.04, 10, '#5d4a3a', px, py + 0.12, pz), cyl(0.28, 0.28, 0.04, 10, '#5d4a3a', px, py + 0.32, pz),
    cyl(0.24, 0.24, 0.02, 10, '#b5323f', px, py + 0.37, pz),
    cyl(0.22, 0.22, 0.07, 10, C.woodLight, px, py + 0.42, pz),
    // screw with thread rings + capstan bar
    cyl(0.045, 0.045, 0.85, 8, C.woodDark, px, py + 0.49, pz),
  );
  for (let i = 0; i < 5; i++) parts.push(cyl(0.07, 0.07, 0.03, 8, '#8a6a4a', px, py + 0.55 + i * 0.1, pz));
  parts.push(
    rot(cbox(0.72, 0.05, 0.05, C.woodLight, px, py + 1.38, pz), 0, 0.5, 0),
    sph(0.05, C.woodDark, px + 0.36 * Math.cos(0.5), py + 1.38, pz - 0.36 * Math.sin(0.5)),
    sph(0.05, C.woodDark, px - 0.36 * Math.cos(0.5), py + 1.38, pz + 0.36 * Math.sin(0.5)),
    // spout, juice stream and jug
    box(0.06, 0.04, 0.14, C.woodDark, px, py + 0.12, pz + 0.3),
    box(0.03, 0.08, 0.03, C.orange, px, py + 0.05, pz + 0.36),
    cyl(0.07, 0.08, 0.14, 8, '#d7eef7', px, py, pz + 0.38),
    cyl(0.06, 0.06, 0.01, 8, C.orange, px, py + 0.135, pz + 0.38),
  );
  // barrels at the back right
  parts.push(...barrel(0.8, -0.4, 1.0, '#a0683a', 0.08), ...barrel(0.8, -0.8, 0.8, '#8f5c33', 0.08));
  parts.push(box(0.04, 0.04, 0.08, C.black, 0.8, 0.22, -0.2));
  // crates of fruit at the front left
  const r = hashRand(9);
  const crates = [[0.62, 0.52, ['#e8402f', '#d23a2a', '#f05a3a']], [0.2, 0.7, [C.orange, '#ffa33a', '#f08a24']], [0.64, 0.52, ['#8fd14f', '#a6dd5a', '#7cc244']]];
  crates.forEach(([x, z, cols], ci) => {
    const y = ci === 2 ? 0.32 : 0.08;
    const zz = ci === 2 ? z - 0.02 : z;
    parts.push(box(0.4, 0.22, 0.32, ci === 1 ? C.woodLight : C.plank, x, y, zz), box(0.42, 0.04, 0.34, C.woodDark, x, y + 0.08, zz));
    for (let i = 0; i < 6; i++) parts.push(ball(0.07, cols[i % 3], x - 0.12 + (i % 3) * 0.12 + (r() - 0.5) * 0.02, y + 0.25, zz - 0.07 + Math.floor(i / 3) * 0.14, 1));
  });
  return group(parts);
}

// ------------------------------------------------------------------ candle shop (2x2)
function candleshop() {
  const wall = C.cream, roofCol = '#3a9e98', trim = '#7a4f9a', brick = '#b5654a';
  const zc = -0.15, w = 1.44, d = 1.3, h = 0.95, y0 = 0.1;
  const front = zc + d / 2; // 0.5
  const side = w / 2; // 0.72
  const parts = [
    box(w + 0.24, 0.1, d + 0.24, C.stoneDark, 0, 0, zc),
    box(w, h, d, wall, 0, y0, zc),
    box(w + 0.04, 0.12, d + 0.04, '#e6d6b0', 0, y0, zc),
    roof(w + 0.36, 0.86, d + 0.3, roofCol, 0, y0 + h, zc),
    // chimney: smoke point is (0.3, 2.2, -0.2)
    box(0.24, 0.66, 0.24, brick, 0.3, 1.46, -0.2),
    box(0.3, 0.07, 0.3, C.stoneDark, 0.3, 2.1, -0.2),
    box(0.25, 0.03, 0.25, '#9a523c', 0.3, 1.75, -0.2),
    // corner timbers
    box(0.07, h, 0.07, C.woodDark, -side, y0, front), box(0.07, h, 0.07, C.woodDark, side, y0, front),
    box(0.07, h, 0.07, C.woodDark, side, y0, zc - d / 2),
  ];
  // arched door
  const dx = -0.3;
  parts.push(
    box(0.42, 0.6, 0.04, C.woodDark, dx, y0, front + 0.005),
    disc(0.21, 0.04, 10, C.woodDark, dx, y0 + 0.6, front + 0.005),
    box(0.34, 0.56, 0.05, trim, dx, y0, front + 0.015),
    disc(0.17, 0.05, 10, trim, dx, y0 + 0.56, front + 0.015),
    box(0.04, 0.04, 0.03, C.yellow, dx + 0.1, y0 + 0.32, front + 0.05),
    box(0.5, 0.05, 0.24, C.stone, dx, 0, front + 0.14),
    // lantern beside the door
    box(0.03, 0.03, 0.08, C.black, dx - 0.3, 0.85, front + 0.04),
    box(0.09, 0.13, 0.09, C.glass, dx - 0.3, 0.71, front + 0.1, 'glow'),
    cone(0.08, 0.06, 4, C.black, dx - 0.3, 0.84, front + 0.1),
  );
  // front window with candles on the sill
  const wx = 0.3;
  parts.push(
    box(0.44, 0.42, 0.04, C.woodDark, wx, 0.36, front + 0.005),
    box(0.36, 0.34, 0.04, C.glass, wx, 0.4, front + 0.015, 'glow'),
    box(0.025, 0.34, 0.05, C.woodDark, wx, 0.4, front + 0.02),
    box(0.36, 0.025, 0.05, C.woodDark, wx, 0.56, front + 0.02),
    box(0.52, 0.05, 0.14, C.woodDark, wx, 0.33, front + 0.06),
  );
  for (const [x, hh, col] of [[-0.16, 0.12, C.white], [-0.04, 0.17, '#f6c8d8'], [0.08, 0.1, C.white], [0.18, 0.14, '#d9c3f0']]) {
    parts.push(cyl(0.025, 0.025, hh, 6, col, wx + x, 0.38, front + 0.08));
    parts.push(box(0.025, 0.04, 0.025, '#ffd257', wx + x, 0.38 + hh + 0.005, front + 0.08, 'glow'));
  }
  // gable window (diamond)
  parts.push(
    rot(cbox(0.24, 0.24, 0.03, C.woodDark, 0, y0 + h + 0.33, front + 0.155), 0, 0, Math.PI / 4),
    rot(cbox(0.17, 0.17, 0.04, C.glass, 0, y0 + h + 0.33, front + 0.16, 'glow'), 0, 0, Math.PI / 4),
  );
  // +x side windows with shutters & flower box
  for (const z of [-0.5, 0.12]) {
    parts.push(
      box(0.04, 0.34, 0.3, C.glass, side + 0.005, 0.42, z, 'glow'),
      box(0.05, 0.025, 0.3, C.woodDark, side + 0.01, 0.58, z),
      box(0.03, 0.36, 0.11, roofCol, side + 0.01, 0.41, z - 0.22), box(0.03, 0.36, 0.11, roofCol, side + 0.01, 0.41, z + 0.22),
      box(0.1, 0.08, 0.34, C.woodDark, side + 0.05, 0.34, z),
      ball(0.05, C.pink, side + 0.07, 0.45, z - 0.1), ball(0.05, C.purple, side + 0.07, 0.45, z), ball(0.05, C.yellow, side + 0.07, 0.45, z + 0.1),
    );
  }
  // hanging sign with a candle, on an iron bracket from the front-right corner
  const sx = side + 0.04, sz = front + 0.28;
  parts.push(
    box(0.03, 0.03, 0.42, C.black, sx, 0.98, front + 0.2),
    stick(sx, 0.86, front + 0.02, sx, 0.98, front + 0.18, 0.025, C.black),
    box(0.015, 0.1, 0.015, C.black, sx, 0.88, sz - 0.11), box(0.015, 0.1, 0.015, C.black, sx, 0.88, sz + 0.11),
    box(0.05, 0.34, 0.34, trim, sx, 0.54, sz),
    box(0.06, 0.28, 0.28, C.cream, sx, 0.57, sz),
    box(0.08, 0.13, 0.09, C.white, sx, 0.6, sz),
    box(0.085, 0.02, 0.1, '#e6d6b0', sx, 0.71, sz),
    box(0.084, 0.05, 0.03, '#e6d6b0', sx, 0.66, sz + 0.03),
    box(0.088, 0.075, 0.05, C.orange, sx, 0.745, sz),
    box(0.092, 0.045, 0.025, C.yellow, sx, 0.755, sz),
  );
  // display crate of pillar candles and beeswax blocks out front
  parts.push(
    box(0.4, 0.2, 0.3, C.woodLight, -0.72, 0, 0.78),
    box(0.42, 0.03, 0.32, C.woodDark, -0.72, 0.2, 0.78),
    cyl(0.055, 0.055, 0.22, 8, C.white, -0.82, 0.23, 0.75), box(0.03, 0.05, 0.03, '#ffd257', -0.82, 0.45, 0.75, 'glow'),
    cyl(0.05, 0.05, 0.15, 8, '#f6c8d8', -0.7, 0.23, 0.84), box(0.03, 0.05, 0.03, '#ffd257', -0.7, 0.38, 0.84, 'glow'),
    cyl(0.05, 0.05, 0.11, 8, '#d9c3f0', -0.6, 0.23, 0.72), box(0.03, 0.05, 0.03, '#ffd257', -0.6, 0.34, 0.72, 'glow'),
    box(0.16, 0.08, 0.1, '#f2c14e', 0.05, 0, 0.82), box(0.14, 0.08, 0.1, '#e8b23a', 0.1, 0.08, 0.82),
    box(0.15, 0.08, 0.1, '#f2c14e', 0.2, 0, 0.84),
    cyl(0.1, 0.08, 0.16, 8, '#c86b4a', 0.75, 0, -0.75),
    ball(0.1, C.leaf, 0.75, 0.22, -0.75), ball(0.045, C.pink, 0.8, 0.3, -0.7), ball(0.045, C.purple, 0.7, 0.3, -0.72),
  );
  return group(parts);
}

registerBuilders({ storagebarn, silo, pigsty, apiary, goatpen, popcorn, sugarmill, juicepress, candleshop });
