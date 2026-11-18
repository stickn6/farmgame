// Procedural models — see H in ../assets.js for helpers.
// Market wagon + the donkey that pulls it (both face +X), and the "Master Farmer"
// farmhouse upgrade (masterhouse:1|2|3) that replaces farmhouse() on its 3x3 plot.
import * as THREE from 'three';
import { H, registerBuilders, BUILDERS } from '../assets.js';

const { box, cyl, cone, ball, sph, roof, rot, scl, hashRand, mesh, g, C } = H;
// group() that also flattens nested part arrays
const group = (...c) => H.group(c.flat(Infinity));

// Where the donkey stands in front of the wagon. WagonView (views.js) adds makeObject('donkey')
// at this x next to makeObject('wagon'); the shafts below are built around it, and
// 'wagon:hitched' uses the same offset so the gallery shows what the game shows.
export const DONKEY_X = 2.0;

// ------------------------------------------------------------------ local palette
const K = {
  gold: '#f2c14e', goldD: '#c9962e', goldL: '#ffdc7e',
  wicker: '#c99a55', wickerD: '#9c6c36',
  canvas: '#fbf1d6', canvasR: '#e0524a',
  pole: '#a97d4f', poleD: '#8a6340',
  deck: '#c99560', deckD: '#a9784a',
  shutter: '#5f9e6e', shutterD: '#4a8058',
  iron: '#4a4644',
  // donkey
  dGrey: '#9d9892', dGreyD: '#7f7a75', dLight: '#d9d4cb', dMuzzle: '#f4f1ea', dDark: '#4b4541', dHoof: '#3a322d', dPink: '#e9b3ae',
};
const PRODUCE = {
  apple: ['#d93a33', '#e8443a', '#c92f2f'], greenapple: ['#9bd14a', '#86c23d'], orange: [C.orange, '#f59a2f'],
  tomato: ['#e8443a', '#f0503f'], lemon: ['#f7d84a', '#f3cc35'], cabbage: ['#8fd45f', '#7cc350'],
  plum: ['#8a62c4', '#7650b0'], berry: ['#e0457a', '#c9365f'],
};

// ------------------------------------------------------------------ local helpers
const UP = new THREE.Vector3(0, 1, 0);
const v3 = new THREE.Vector3();
// box / cylinder centered at y (the H versions put the bottom at y)
const cbox = (w, h, d, col, x = 0, y = 0, z = 0, bucket) => box(w, h, d, col, x, y - h / 2, z, bucket);
const ccyl = (rt, rb, h, seg, col, x = 0, y = 0, z = 0) => cyl(rt, rb, h, seg, col, x, y - h / 2, z);
// cylinder lying with its axis along Z (wheels, hubs, axles), centered at (x,y,z)
const zcyl = (r, len, seg, col, x = 0, y = 0, z = 0) => rot(ccyl(r, r, len, seg, col, x, y, z), Math.PI / 2, 0, 0);
// cylinder lying with its axis along X, centered at (x,y,z)
const xcyl = (r, len, seg, col, x = 0, y = 0, z = 0) => rot(ccyl(r, r, len, seg, col, x, y, z), 0, 0, Math.PI / 2);
// torus lying in its local XY plane (axis along Z); arc < 2PI gives an arch (handles)
const torus = (R, r, rs, ts, col, x = 0, y = 0, z = 0, arc = Math.PI * 2) =>
  mesh(g(`wgT${R}|${r}|${rs}|${ts}|${arc}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc)), col, x, y, z);
// square stick from point a to point b
function beam(a, b, t, col) {
  v3.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = Math.round(v3.length() * 1000) / 1000;
  const m = box(t, len, t, col, 0, -len / 2, 0);
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(UP, v3.normalize());
  return m;
}
// flat board from a to b (centerline), `w` wide, `t` thick, kept level across its width
function board(a, b, w, t, col) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const hd = Math.hypot(dx, dz) || 1e-6, len = Math.hypot(hd, dy);
  const m = cbox(Math.round(len * 1000) / 1000, t, w, col, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.rotation.set(0, Math.atan2(-dz, dx), Math.atan2(dy, hd));
  return m;
}
function place(obj, x, y, z, ry = 0) { obj.position.set(x, y, z); obj.rotation.y = ry; return obj; }

// heap of round produce on top of a container (balls, centered at y)
function heap(w, d, y, kind, n, seed, r0 = 0.055) {
  const r = hashRand(seed);
  const cols = PRODUCE[kind] || [kind];
  const parts = [];
  for (let i = 0; i < n; i++) {
    const rr = r0 * (0.85 + r() * 0.3);
    const x = (r() - 0.5) * Math.max(0, w - rr * 2), z = (r() - 0.5) * Math.max(0, d - rr * 2);
    const hump = 1 - Math.min(1, Math.hypot(x / (w / 2 + 1e-6), z / (d / 2 + 1e-6)));
    parts.push(ball(rr, cols[i % cols.length], x, y + rr * 0.4 + hump * rr * 1.2 + (i > n * 0.6 ? rr * 0.6 : 0), z));
  }
  return parts;
}

// slatted wooden crate (bottom at 0) filled with produce
function crate(w, h, d, kind, n, seed, col = C.woodLight) {
  return group(
    box(w, h, d, col, 0, 0, 0),
    box(w + 0.012, 0.03, d + 0.012, C.wood, 0, h * 0.42, 0),
    box(w + 0.014, 0.035, d + 0.014, C.wood, 0, h - 0.035, 0),
    heap(w, d, h - 0.02, kind, n, seed),
  );
}

// wicker basket (bottom at 0), optional handle, filled with produce
function basket(r, h, kind, n, seed, handle = true) {
  const parts = [
    cyl(r, r * 0.78, h, 8, K.wicker, 0, 0, 0),
    cyl(r + 0.012, r + 0.012, 0.03, 8, K.wickerD, 0, h - 0.03, 0),
    cyl(r * 0.92, r * 0.92, 0.04, 8, K.wickerD, 0, h * 0.35, 0),
  ];
  if (kind === 'carrot') {
    const rr = hashRand(seed);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, d = r * 0.45;
      const x = Math.cos(a) * d * (i % 2 ? 1 : 0.4), z = Math.sin(a) * d * (i % 2 ? 1 : 0.4);
      parts.push(rot(cone(0.03, 0.16, 5, C.orange, x, h - 0.12, z), Math.PI, 0, (rr() - 0.5) * 0.4));
      parts.push(cone(0.03, 0.1, 4, C.leaf, x, h + 0.02, z));
    }
  } else parts.push(heap(r * 1.6, r * 1.6, h - 0.02, kind, n, seed, r * 0.38));
  if (handle) parts.push(torus(r * 0.85, 0.012, 3, 8, K.wickerD, 0, h, 0, Math.PI));
  return group(parts);
}

function pumpkin(s = 1) {
  return group(
    scl(sph(0.1 * s, C.orange, 0, 0.075 * s, 0, 8, 5), 1, 0.75, 1),
    scl(sph(0.06 * s, '#f59a2f', 0.05 * s, 0.075 * s, 0, 6, 4), 1, 1.15, 1.6),
    box(0.02 * s, 0.05 * s, 0.02 * s, C.leafDark, 0, 0.13 * s, 0),
  );
}

// spoked cart wheel: axle along Z, centered at origin
function wheel(R, spokes, spokeCol) {
  const parts = [
    torus(R - 0.035, 0.04, 5, 14, C.woodDark),
    torus(R - 0.008, 0.016, 4, 14, K.iron),
    zcyl(0.075, 0.12, 8, C.yellow),
    zcyl(0.04, 0.17, 6, C.woodDark),
  ];
  const n = spokes / 2;
  for (let i = 0; i < n; i++) parts.push(rot(cbox(0.04, 2 * R - 0.09, 0.03, spokeCol), 0, 0, (i * Math.PI) / n + 0.2));
  return group(parts);
}

// ================================================================== MARKET WAGON (forward = +X)
function wagon(variant = '0') {
  const blue = C.blue, blueD = C.blueDark, trim = C.yellow;
  const bx0 = -1.0, bx1 = 0.72, bcx = (bx0 + bx1) / 2, blen = bx1 - bx0; // bed
  const bw = 0.92, floorY = 0.5, floorT = 0.07, top = floorY + floorT; // 0.57
  const sideH = 0.26, rail = top + sideH; // 0.83
  const parts = [];

  // --- running gear: wheels, axles, chassis
  const RR = 0.37, RF = 0.29, xr = -0.58, xf = 0.4, wz = 0.56;
  for (const s of [-1, 1]) {
    parts.push(place(wheel(RR, 10, C.red), xr, RR, s * wz));
    parts.push(place(wheel(RF, 8, C.red), xf, RF, s * wz));
  }
  parts.push(
    zcyl(0.03, 1.08, 6, K.iron, xr, RR, 0),
    zcyl(0.03, 1.08, 6, K.iron, xf, RF, 0),
    box(0.12, floorY - RR + 0.04, 0.96, C.woodDark, xr, RR - 0.04, 0),
    box(0.12, floorY - RF + 0.02, 0.86, C.woodDark, xf, RF - 0.02, 0),
    box(blen - 0.1, 0.06, 0.08, C.woodDark, bcx, floorY - 0.06, 0.26),
    box(blen - 0.1, 0.06, 0.08, C.woodDark, bcx, floorY - 0.06, -0.26),
  );

  // --- bed: floor, painted sides, yellow rails, stakes
  parts.push(
    box(blen, floorT, bw, C.wood, bcx, floorY, 0),
    box(blen + 0.04, 0.03, bw + 0.04, blueD, bcx, floorY - 0.01, 0),
  );
  for (const s of [-1, 1]) {
    const z = s * (bw / 2 - 0.025);
    parts.push(
      box(blen, sideH, 0.05, blue, bcx, top, z),
      box(blen + 0.06, 0.05, 0.08, trim, bcx, rail - 0.01, z),
      box(blen, 0.025, 0.055, blueD, bcx, top + 0.11, z),
    );
    for (const x of [bx0 + 0.04, -0.42, 0.17, bx1 - 0.04]) parts.push(box(0.06, sideH + 0.06, 0.07, C.white, x, top - 0.05, z + s * 0.01));
    // painted flowers on the side panels
    for (const [x, col] of [[-0.71, C.pink], [0.45, C.white]]) {
      parts.push(zcyl(0.045, 0.02, 6, col, x, top + 0.17, z + s * 0.03), zcyl(0.02, 0.025, 6, trim, x, top + 0.17, z + s * 0.035));
    }
  }
  // front dashboard and rear tailgate
  parts.push(
    box(0.05, sideH + 0.12, bw, blue, bx1, top, 0),
    box(0.08, 0.05, bw + 0.06, trim, bx1, rail + 0.1, 0),
    box(0.05, sideH, bw, blue, bx0, top, 0),
    box(0.08, 0.05, bw + 0.06, trim, bx0, rail - 0.01, 0),
    box(0.04, 0.12, 0.3, C.woodLight, bx0 - 0.03, top + 0.07, 0), // little name plate
  );

  // --- driver's bench at the front with a cushion and a basket of apples
  const sx = 0.5, seatY = 0.82;
  parts.push(
    box(0.2, seatY - top, 0.8, C.woodDark, sx, top, 0),
    box(0.3, 0.05, 0.86, C.woodLight, sx, seatY, 0),
    box(0.26, 0.05, 0.6, C.red, sx + 0.01, seatY + 0.05, 0.08),
    box(0.04, 0.22, 0.86, C.woodLight, sx - 0.14, seatY + 0.05, 0),
    box(0.06, 0.04, 0.9, trim, sx - 0.14, seatY + 0.27, 0),
    place(basket(0.1, 0.11, 'apple', 7, 3), sx + 0.02, seatY + 0.05, -0.28),
  );
  // footboard
  parts.push(board([bx1 + 0.02, top + 0.05, 0], [bx1 + 0.16, top + 0.24, 0], 0.74, 0.04, C.woodDark));

  // --- long shafts for the donkey (+X) with a crossbar. They run along the donkey's flanks
  // (z = ±0.25; its body + blanket stop at ±0.19) from behind its rump to its collar.
  const shK = DONKEY_X - 0.2, shTip = DONKEY_X + 0.36;
  for (const s of [-1, 1]) {
    const z = s * 0.25;
    parts.push(
      beam([xf - 0.05, floorY - 0.04, z], [shK, 0.5, z], 0.045, C.woodDark),
      beam([shK, 0.5, z], [shTip, 0.6, z], 0.04, C.woodDark),
      xcyl(0.028, 0.05, 6, K.iron, shTip - 0.02, 0.597, z), // iron tip
      // leather tug loop where the shaft passes the donkey's saddle
      rot(torus(0.045, 0.014, 4, 8, '#7a4a2a', DONKEY_X - 0.02, 0.53, z), 0, Math.PI / 2, 0),
    );
  }
  parts.push(
    zcyl(0.025, 0.56, 6, C.wood, 0.86, 0.43, 0), box(0.06, 0.06, 0.06, K.iron, 0.86, 0.4, 0),
    zcyl(0.02, 0.5, 6, C.wood, 1.32, 0.485, 0), // spreader bar between the shafts
  );

  // --- cargo under the canopy: crates, baskets, pumpkins, sacks
  parts.push(
    place(crate(0.38, 0.2, 0.34, 'apple', 8, 11), -0.76, top, 0.2),
    place(crate(0.38, 0.2, 0.34, 'orange', 7, 12), -0.76, top, -0.2),
    place(crate(0.34, 0.16, 0.3, 'cabbage', 5, 13, C.plank), -0.74, top + 0.2, 0.0, 0.1),
    place(crate(0.3, 0.18, 0.3, 'tomato', 6, 14), -0.24, top, 0.22, -0.1),
    place(basket(0.13, 0.14, 'carrot', 5, 15), -0.22, top, -0.2),
    place(pumpkin(1.2), 0.1, top, 0.24),
    place(pumpkin(0.95), 0.18, top, 0.06),
    place(basket(0.11, 0.12, 'lemon', 6, 16, false), 0.08, top, -0.22),
    place(crate(0.24, 0.14, 0.22, 'plum', 4, 17), -0.24, top + 0.18, 0.2, 0.3),
  );
  // a sack of flour leaning in the corner
  parts.push(
    place(group(box(0.2, 0.2, 0.16, '#efe2c2', 0, 0, 0), cbox(0.16, 0.06, 0.13, '#efe2c2', 0, 0.23, 0), ccyl(0.025, 0.04, 0.05, 6, C.woodDark, 0, 0.28, 0), cbox(0.08, 0.06, 0.012, C.red, 0, 0.1, 0.085)), -0.44, top, -0.24, 0.3),
  );

  // --- striped canopy on four posts (ridge along X)
  const cx0 = -1.07, cx1 = 0.33, eaveY = 1.36, A = 0.55, Bh = 0.44, bands = 7, segs = 5;
  const blenC = (cx1 - cx0) / bands;
  for (const x of [-0.97, 0.26]) for (const s of [-1, 1]) parts.push(box(0.05, eaveY - rail + 0.04, 0.05, C.woodDark, x, rail - 0.04, s * 0.44));
  for (const s of [-1, 1]) parts.push(box(cx1 - cx0 + 0.02, 0.04, 0.05, C.woodDark, (cx0 + cx1) / 2, eaveY - 0.06, s * 0.47));
  const arc = (k) => { const t = (k / segs) * Math.PI; return [A * Math.cos(t), eaveY + Bh * Math.sin(t)]; };
  for (let b = 0; b < bands; b++) {
    const x = cx0 + (b + 0.5) * blenC, col = b % 2 ? K.canvas : K.canvasR;
    for (let k = 0; k < segs; k++) {
      const [z1, y1] = arc(k), [z2, y2] = arc(k + 1);
      const len = Math.hypot(z2 - z1, y2 - y1) + 0.03;
      const p = cbox(blenC + 0.004, 0.035, len, col, x, (y1 + y2) / 2, (z1 + z2) / 2);
      p.rotation.x = Math.atan2(-(y2 - y1), z2 - z1);
      parts.push(p);
    }
    // scalloped valance along both eaves
    for (const s of [-1, 1]) parts.push(rot(cone(0.075, 0.1, 4, col, x, eaveY - 0.1, s * (A + 0.004)), Math.PI, Math.PI / 4, 0));
  }
  // wooden hoop along the open front
  for (const x of [cx1 + 0.01]) {
    for (let k = 0; k < segs; k++) {
      const [z1, y1] = arc(k), [z2, y2] = arc(k + 1);
      const p = cbox(0.04, 0.05, Math.hypot(z2 - z1, y2 - y1) + 0.02, C.woodDark, x, (y1 + y2) / 2 + 0.005, (z1 + z2) / 2);
      p.rotation.x = Math.atan2(-(y2 - y1), z2 - z1);
      parts.push(p);
    }
  }
  // ridge knob
  parts.push(ball(0.05, trim, cx1 + 0.02, eaveY + Bh + 0.03, 0));

  // --- hanging lantern at the front-left hoop, hanging sign at the front-right
  const lz = -0.42, ly = eaveY - 0.05;
  parts.push(
    box(0.2, 0.025, 0.025, K.iron, cx1 + 0.1, ly, lz),
    box(0.012, 0.08, 0.012, K.iron, cx1 + 0.19, ly - 0.08, lz),
    box(0.1, 0.13, 0.1, C.glass, cx1 + 0.19, ly - 0.22, lz, 'glow'),
    box(0.12, 0.025, 0.12, K.iron, cx1 + 0.19, ly - 0.235, lz),
    rot(cone(0.09, 0.07, 4, K.iron, cx1 + 0.19, ly - 0.095, lz), 0, Math.PI / 4, 0),
  );
  const gz = 0.42, gy = eaveY - 0.08, gx = cx1 + 0.12;
  parts.push(
    box(0.24, 0.025, 0.025, K.iron, cx1 + 0.08, gy, gz),
    box(0.012, 0.06, 0.012, K.iron, gx, gy - 0.06, gz - 0.1), box(0.012, 0.06, 0.012, K.iron, gx, gy - 0.06, gz + 0.1),
    box(0.035, 0.2, 0.3, C.cream, gx, gy - 0.26, gz),
    box(0.04, 0.03, 0.32, C.red, gx, gy - 0.07, gz), box(0.04, 0.03, 0.32, C.red, gx, gy - 0.28, gz),
    scl(ball(0.055, C.red, gx + 0.02, gy - 0.16, gz - 0.045), 0.5, 1, 1),
    box(0.02, 0.04, 0.012, C.woodDark, gx + 0.03, gy - 0.1, gz - 0.045),
    rot(cbox(0.02, 0.05, 0.03, C.leaf, gx + 0.03, gy - 0.1, gz - 0.02), 0.6, 0, 0),
    rot(cone(0.025, 0.12, 5, C.orange, gx + 0.022, gy - 0.22, gz + 0.06), Math.PI, 0, 0),
    cone(0.022, 0.05, 4, C.leaf, gx + 0.022, gy - 0.1, gz + 0.06),
  );

  // --- water bucket hanging under the back
  parts.push(
    box(0.02, 0.1, 0.02, K.iron, bx0 + 0.06, floorY - 0.1, 0.12),
    cyl(0.07, 0.055, 0.1, 8, C.woodLight, bx0 + 0.06, floorY - 0.22, 0.12),
    cyl(0.072, 0.072, 0.02, 8, K.iron, bx0 + 0.06, floorY - 0.15, 0.12),
  );

  if (variant === 'hitched' || variant === '1') parts.push(place(donkey(), DONKEY_X, 0, 0));
  return group(parts);
}

// ================================================================== DONKEY (forward = +X)
function donkey() {
  const G = K.dGrey, GD = K.dGreyD, L = K.dLight, D = K.dDark;
  const parts = [];
  // legs with pale socks and dark hooves
  for (const [x, z] of [[0.19, 0.085], [0.19, -0.085], [-0.19, 0.085], [-0.19, -0.085]]) {
    parts.push(
      box(0.08, 0.22, 0.08, G, x, 0.08, z),
      box(0.075, 0.07, 0.075, L, x, 0.04, z),
      box(0.085, 0.045, 0.085, K.dHoof, x, 0, z),
    );
  }
  // body (stepped ends to round it off), pale belly, dorsal stripe
  parts.push(
    cbox(0.5, 0.26, 0.28, G, 0, 0.42, 0),
    cbox(0.6, 0.18, 0.24, G, 0, 0.42, 0),
    cbox(0.42, 0.05, 0.24, L, 0, 0.29, 0),
    cbox(0.5, 0.02, 0.05, D, -0.02, 0.555, 0),
  );
  // neck leaning forward, mane
  const neck = rot(cbox(0.16, 0.3, 0.16, G, 0.29, 0.58, 0), 0, 0, -0.55);
  const mane = rot(cbox(0.05, 0.3, 0.05, D, 0.24, 0.66, 0), 0, 0, -0.55);
  const throat = rot(cbox(0.03, 0.24, 0.13, L, 0.36, 0.54, 0), 0, 0, -0.55);
  parts.push(neck, mane, throat, rot(cbox(0.04, 0.09, 0.04, D, 0.35, 0.79, 0), 0, 0, -0.9));
  // head (tilted nose-down), white muzzle, nostrils, eyes
  const head = group(
    cbox(0.26, 0.16, 0.17, G, 0, 0, 0),
    cbox(0.12, 0.14, 0.16, K.dMuzzle, 0.12, -0.015, 0),
    cbox(0.02, 0.025, 0.025, D, 0.185, 0.005, 0.04), cbox(0.02, 0.025, 0.025, D, 0.185, 0.005, -0.04),
    cbox(0.04, 0.012, 0.08, GD, 0.17, -0.06, 0),
    cbox(0.04, 0.045, 0.02, C.black, -0.02, 0.035, 0.086), cbox(0.04, 0.045, 0.02, C.black, -0.02, 0.035, -0.086),
    cbox(0.015, 0.015, 0.022, C.white, -0.01, 0.045, 0.088), cbox(0.015, 0.015, 0.022, C.white, -0.01, 0.045, -0.088),
    cbox(0.06, 0.02, 0.025, K.dMuzzle, -0.02, 0.07, 0.085), cbox(0.06, 0.02, 0.025, K.dMuzzle, -0.02, 0.07, -0.085),
  );
  place(head, 0.45, 0.72, 0).rotation.z = -0.3;
  parts.push(head);
  // big ears with pink insides and dark tips
  for (const s of [-1, 1]) {
    const ear = group(
      cbox(0.05, 0.24, 0.08, G, 0, 0.12, 0),
      cbox(0.012, 0.17, 0.05, K.dPink, 0.026, 0.11, 0),
      cbox(0.052, 0.05, 0.06, D, 0, 0.245, 0),
    );
    ear.position.set(0.37, 0.77, s * 0.055);
    ear.rotation.set(s * 0.38, 0, 0.32);
    parts.push(ear);
  }
  // tail with a dark tuft
  parts.push(
    rot(cbox(0.03, 0.22, 0.03, G, -0.31, 0.43, 0), 0, 0, -0.3),
    rot(cbox(0.06, 0.09, 0.06, D, -0.345, 0.32, 0), 0, 0, -0.3),
  );
  // red saddle blanket with yellow trim, padded collar around the neck and a little bell
  const collar = group(
    rot(torus(0.105, 0.035, 5, 10, '#7a4a2a'), Math.PI / 2, 0, 0),
    rot(torus(0.1, 0.014, 3, 10, C.yellow, 0, 0.035, 0), Math.PI / 2, 0, 0),
  );
  collar.position.set(0.31, 0.6, 0);
  collar.rotation.z = -0.55;
  parts.push(collar);
  parts.push(
    cbox(0.26, 0.025, 0.3, C.red, -0.02, 0.565, 0),
    cbox(0.26, 0.13, 0.02, C.red, -0.02, 0.5, 0.15), cbox(0.26, 0.13, 0.02, C.red, -0.02, 0.5, -0.15),
    cbox(0.27, 0.025, 0.022, C.yellow, -0.02, 0.44, 0.152), cbox(0.27, 0.025, 0.022, C.yellow, -0.02, 0.44, -0.152),
    ball(0.025, C.yellow, -0.02, 0.5, 0.165), ball(0.025, C.yellow, -0.02, 0.5, -0.165),
    cbox(0.04, 0.03, 0.29, '#7a4a2a', 0.08, 0.31, 0),
    ball(0.03, K.gold, 0.37, 0.49, 0, 0),
  );
  return group(parts);
}

// ================================================================== MASTER FARMHOUSE (3x3, front = +Z)
// Grand house footprint (stages 2-3): walls x [-1.3, 0.82] z [-1.32, 0.7]; wraparound porch on +Z and +X.
const MH = { x0: -1.3, x1: 0.82, z0: -1.32, z1: 0.7, y0: 0.2, y1: 1.12, y2: 1.98, rh: 0.9 };
MH.cx = (MH.x0 + MH.x1) / 2; MH.cz = (MH.z0 + MH.z1) / 2; MH.w = MH.x1 - MH.x0; MH.d = MH.z1 - MH.z0;

// A window built facing +Z then turned onto a wall face. face: 0 = +Z, 1 = +X, 2 = -Z, 3 = -X.
// u = position along the wall, y = sill height, p = wall plane coordinate.
// simple: frame + glass + sill only (walls the camera rarely sees)
function win(face, u, y, p, { w = 0.34, h = 0.4, shutters = true, flowers = null, glow = true, simple = false } = {}) {
  const parts = [
    box(w + 0.08, h + 0.08, 0.04, C.white, 0, y - 0.04, 0.01),
    box(w, h, 0.04, C.glass, 0, y, 0.025, glow ? 'glow' : undefined),
    box(w + 0.14, 0.04, 0.08, C.white, 0, y - 0.06, 0.04),
  ];
  if (!simple) parts.push(box(0.03, h, 0.03, C.white, 0, y, 0.05), box(w, 0.03, 0.03, C.white, 0, y + h * 0.55, 0.05));
  if (shutters && !simple) for (const s of [-1, 1]) parts.push(box(0.11, h + 0.04, 0.03, K.shutter, s * (w / 2 + 0.1), y - 0.02, 0.03));
  if (flowers) {
    parts.push(box(w + 0.1, 0.09, 0.11, C.woodDark, 0, y - 0.15, 0.08));
    const r = hashRand(flowers.length + Math.round(u * 10));
    for (let i = 0; i < 4; i++) parts.push(ball(0.055, flowers[i % flowers.length], -w / 2 + 0.02 + i * (w - 0.04) / 3, y - 0.03 + r() * 0.03, 0.09));
    parts.push(scl(sph(0.08, C.leaf, 0, y - 0.07, 0.09, 6, 4), (w + 0.04) / 0.16, 0.5, 0.6));
  }
  const gr = group(parts);
  const a = [0, Math.PI / 2, Math.PI, -Math.PI / 2][face];
  gr.rotation.y = a;
  if (face === 0) gr.position.set(u, 0, p);
  else if (face === 1) gr.position.set(p, 0, -u);
  else if (face === 2) gr.position.set(-u, 0, p);
  else gr.position.set(p, 0, u);
  return gr;
}

// chimney exactly where farmhouse() has it (smoke is emitted at 0.65, 2.85, -0.4)
function mhChimney(from = 1.9) {
  return [
    box(0.32, 2.7 - from, 0.32, C.stoneDark, 0.65, from, -0.4),
    box(0.34, 0.06, 0.34, C.stone, 0.65, 2.42, -0.4),
    box(0.38, 0.1, 0.38, C.stone, 0.65, 2.7, -0.4),
  ];
}

function mhGround(stage) {
  const { x0, x1, z0, z1, y0, y1, cx, cz, w, d } = MH;
  const fl = [C.pink, C.yellow, C.red, C.purple];
  const parts = [
    box(w + 0.16, y0, d + 0.16, C.stoneDark, cx, 0, cz),
    box(w, y1 - y0, d, C.cream, cx, y0, cz),
    box(w + 0.06, 0.07, d + 0.06, C.white, cx, y1 - 0.04, cz), // floor band
  ];
  // corner boards
  for (const x of [x0, x1]) for (const z of [z0, z1]) parts.push(box(0.07, y1 - y0, 0.07, C.white, x, y0, z));
  // front door with glowing transom, gold knob, lanterns either side
  parts.push(
    box(0.56, 0.98, 0.04, C.white, cx, y0, z1 + 0.005),
    box(0.46, 0.8, 0.05, '#7b4a2e', cx, y0, z1 + 0.015),
    box(0.18, 0.3, 0.02, '#8e5a38', cx - 0.1, y0 + 0.42, z1 + 0.04), box(0.18, 0.3, 0.02, '#8e5a38', cx + 0.1, y0 + 0.42, z1 + 0.04),
    box(0.18, 0.28, 0.02, '#8e5a38', cx - 0.1, y0 + 0.08, z1 + 0.04), box(0.18, 0.28, 0.02, '#8e5a38', cx + 0.1, y0 + 0.08, z1 + 0.04),
    box(0.4, 0.1, 0.04, C.glass, cx, y0 + 0.83, z1 + 0.02, 'glow'),
    ball(0.03, K.gold, cx + 0.16, y0 + 0.4, z1 + 0.06),
  );
  const flw = stage >= 3 ? null : fl;
  parts.push(
    win(0, cx - 0.62, 0.45, z1, { flowers: flw }), win(0, cx + 0.62, 0.45, z1, { flowers: flw }),
    win(1, 0.85, 0.45, x1, { shutters: stage < 3 }), win(1, -0.15, 0.45, x1, { shutters: stage < 3 }),
    win(2, cx - 0.5, 0.45, z0, { simple: true }), win(2, cx + 0.5, 0.45, z0, { simple: true }),
    win(3, -0.3, 0.45, x0, { simple: true }),
  );
  return parts;
}

function mhUpperWalls() {
  const { x0, x1, z0, z1, y1, y2, cx, cz, w, d } = MH;
  const fl = [C.pink, C.yellow, C.red, C.purple], fl2 = [C.yellow, C.white, C.pink, C.orange];
  const parts = [
    box(w, y2 - y1, d, C.cream, cx, y1, cz),
    box(w + 0.08, 0.07, d + 0.08, C.white, cx, y2 - 0.07, cz),
  ];
  for (const x of [x0, x1]) for (const z of [z0, z1]) parts.push(box(0.07, y2 - y1, 0.07, C.white, x, y1, z));
  parts.push(
    win(0, cx - 0.62, 1.34, z1, { flowers: fl }), win(0, cx + 0.62, 1.34, z1, { flowers: fl2 }),
    win(0, cx, 1.42, z1, { w: 0.22, h: 0.3, shutters: false }),
    win(1, 0.95, 1.34, x1, { flowers: fl2 }), win(1, -0.15, 1.34, x1, {}),
    win(2, cx - 0.5, 1.34, z0, { shutters: false }), win(2, cx + 0.5, 1.34, z0, { shutters: false }),
    win(3, -0.3, 1.34, x0, { simple: true }),
  );
  return parts;
}

function mhRoof(stage) {
  const { y2, cx, cz, w, d, rh } = MH;
  const rw = w + 0.38, rd = d + 0.32, front = cz + rd / 2, back = cz - rd / 2;
  const slope = Math.atan2(rh, rw / 2), sl = Math.hypot(rh, rw / 2);
  const parts = [];
  if (stage >= 3) {
    parts.push(roof(rw, rh, rd, C.red, cx, y2, cz));
    // shingle courses, ridge cap, white gable fascia
    for (const s of [-1, 1]) {
      for (const f of [0.3, 0.62]) {
        const st = cbox(0.05, 0.03, rd + 0.01, C.redDark, cx + s * (rw / 2) * (1 - f), y2 + rh * f + 0.012, cz);
        st.rotation.z = -s * slope;
        parts.push(st);
      }
      for (const z of [front + 0.02, back - 0.02]) {
        const fa = cbox(sl + 0.08, 0.09, 0.05, C.white, cx + s * rw / 4, y2 + rh / 2 + 0.03, z);
        fa.rotation.z = -s * slope;
        parts.push(fa);
      }
    }
    parts.push(cbox(0.14, 0.08, rd + 0.06, C.redDark, cx, y2 + rh - 0.01, cz));
    // round attic window (glows at night) in the front gable
    const pane = rot(ccyl(0.15, 0.15, 0.03, 12, C.glass, cx, y2 + 0.36, front + 0.02), Math.PI / 2, 0, 0);
    pane.material = H.cm(C.glass, 'glow');
    parts.push(
      rot(ccyl(0.2, 0.2, 0.03, 12, C.white, cx, y2 + 0.36, front + 0.005), Math.PI / 2, 0, 0),
      pane,
      box(0.3, 0.025, 0.03, C.white, cx, y2 + 0.35, front + 0.035), box(0.025, 0.3, 0.03, C.white, cx, y2 + 0.21, front + 0.035),
    );
  }
  return parts;
}

// golden weathervane with a rooster, standing on the ridge at (x, y, z)
function weathervane(x, y, z) {
  const G = K.gold, GD = K.goldD;
  return [
    box(0.12, 0.06, 0.12, GD, x, y - 0.03, z),
    box(0.03, 0.62, 0.03, G, x, y, z),
    ball(0.05, K.goldL, x, y + 0.2, z, 1),
    box(0.4, 0.02, 0.02, G, x, y + 0.3, z), box(0.02, 0.02, 0.4, G, x, y + 0.3, z),
    ball(0.025, GD, x + 0.2, y + 0.3, z), ball(0.025, GD, x - 0.2, y + 0.3, z), ball(0.025, GD, x, y + 0.3, z + 0.2), ball(0.025, GD, x, y + 0.3, z - 0.2),
    box(0.5, 0.025, 0.025, G, x, y + 0.42, z),
    rot(cone(0.05, 0.11, 4, G, x + 0.28, y + 0.375, z), 0, 0, -Math.PI / 2),
    box(0.08, 0.1, 0.015, G, x - 0.23, y + 0.38, z),
    // rooster
    box(0.16, 0.1, 0.03, G, x, y + 0.6, z),
    box(0.06, 0.09, 0.03, G, x + 0.08, y + 0.68, z),
    box(0.05, 0.04, 0.03, '#e8573f', x + 0.085, y + 0.77, z),
    rot(cone(0.02, 0.05, 4, GD, x + 0.12, y + 0.69, z), 0, 0, -Math.PI / 2),
    rot(cbox(0.09, 0.13, 0.03, G, x - 0.1, y + 0.7, z), 0, 0, 0.55),
    rot(cbox(0.06, 0.1, 0.03, GD, x - 0.13, y + 0.69, z), 0, 0, 0.9),
    box(0.02, 0.05, 0.02, GD, x, y + 0.55, z),
  ];
}

// porch railing between two points on the deck (balusters + rails)
function railing(ax, az, bx, bz, y0 = 0.22) {
  const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 0.17));
  const parts = [
    board([ax, y0 + 0.44, az], [bx, y0 + 0.44, bz], 0.07, 0.04, C.white),
    board([ax, y0 + 0.08, az], [bx, y0 + 0.08, bz], 0.05, 0.035, C.white),
  ];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    parts.push(box(0.03, 0.34, 0.03, C.white, ax + (bx - ax) * t, y0 + 0.1, az + (bz - az) * t));
  }
  return parts;
}

function mhPorch(stage) {
  const { x1, z1, z0, cx, cz, d } = MH;
  const P = 0.6, fz = z1 + P, sx = x1 + P; // outer edges (1.3, 1.42)
  const ex = -1.43, deckY = 0.22, postH = 0.84;
  const parts = [
    // footings + deck boards
    box(sx - ex, 0.16, P, C.stoneDark, (ex + sx) / 2, 0, z1 + P / 2),
    box(P, 0.16, d, C.stoneDark, x1 + P / 2, 0, cz),
    box(sx - ex + 0.04, 0.06, P + 0.04, K.deck, (ex + sx) / 2, 0.16, z1 + P / 2),
    box(P + 0.04, 0.06, d + 0.04, K.deck, x1 + P / 2, 0.16, cz - 0.02),
    box(sx - ex + 0.05, 0.02, 0.012, K.deckD, (ex + sx) / 2, 0.2, z1 + 0.3),
    box(0.012, 0.02, d, K.deckD, x1 + 0.3, 0.2, cz),
    // steps down to the yard
    box(0.68, 0.15, 0.12, C.stone, cx, 0, fz + 0.06),
    box(0.68, 0.08, 0.12, C.stone, cx, 0, fz + 0.18),
  ];
  // posts along the front and the +X side
  const postsF = [ex + 0.05, cx - 0.38, cx + 0.38, sx - 0.05];
  const postsS = [0.1, -0.62, z0 + 0.05];
  const pf = fz - 0.05, ps = sx - 0.05;
  for (const x of postsF) parts.push(box(0.08, postH, 0.08, C.white, x, deckY, pf));
  for (const z of postsS) parts.push(box(0.08, postH, 0.08, C.white, ps, deckY, z));
  // headers + sloped porch roofs (they meet in a hip at the corner)
  const hy = deckY + postH, wallY = MH.y1 + 0.1, drop = wallY - hy - 0.02;
  const ang = Math.atan2(drop, P + 0.1);
  parts.push(
    box(sx - ex + 0.04, 0.08, 0.1, C.white, (ex + sx) / 2, hy - 0.04, pf),
    box(0.1, 0.08, pf - z0 + 0.13, C.white, ps, hy - 0.04, (z0 - 0.08 + pf + 0.05) / 2),
  );
  const rW = P + 0.1, T = 0.03, off = rW / 2 - 0.02; // slab width, half thickness, wall line -> slab centre
  const yc = (wallY + hy) / 2 + 0.04, lowY = yc - (rW / 2) * Math.sin(ang);
  // front slab stops at the +X wall line, side slab at the front wall line
  const rf = cbox(x1 - ex + 0.09, 2 * T, rW, C.red, (ex - 0.06 + x1 + 0.03) / 2, yc, z1 + off);
  rf.rotation.x = ang;
  const rs = cbox(rW, 2 * T, d + 0.09, C.red, x1 + off, yc, (z0 - 0.06 + z1 + 0.03) / 2);
  rs.rotation.z = -ang;
  parts.push(rf, rs);
  // hip cap over the corner square: a 4-sided pyramid whose +X and +Z faces lie in the two
  // slabs' top planes (the other three quarters are hidden under the slabs / in the walls)
  const apex = yc + T / Math.cos(ang) + off * Math.tan(ang);
  const e = off + T * Math.sin(ang) + (rW / 2) * Math.cos(ang), base = apex - e * Math.tan(ang);
  parts.push(
    rot(cone(e * Math.SQRT2, apex - base, 4, C.red, x1, base, z1), 0, Math.PI / 4, 0),
    box(e, 0.055, e, C.red, x1 + e / 2, base - 0.057, z1 + e / 2), // corner thickness
    beam([x1 + 0.03, apex + 0.005, z1 + 0.03], [x1 + e, base + 0.012, z1 + e], 0.045, C.redDark), // hip ridge
  );
  // white fascia along the low edges, meeting at the outer corner
  parts.push(
    cbox(sx - ex + 0.17, 0.07, 0.04, C.white, (ex - 0.07 + sx + 0.1) / 2, lowY - 0.03, z1 + rW - 0.02),
    cbox(0.04, 0.07, fz - z0 + 0.17, C.white, x1 + rW - 0.02, lowY - 0.03, (z0 - 0.07 + fz + 0.1) / 2),
  );
  // railings (gap for the steps)
  parts.push(
    railing(ex + 0.05, pf, cx - 0.38, pf),
    railing(cx + 0.38, pf, sx - 0.05, pf),
    railing(ps, pf, ps, z0 + 0.05),
    railing(ex + 0.05, pf, ex + 0.05, z1 + 0.04),
    railing(x1 + 0.04, z0 + 0.05, ps, z0 + 0.05),
  );
  // flower boxes on the front railing
  const r = hashRand(99), fl = [C.pink, C.yellow, C.red, C.purple, C.white];
  for (const x of [ex + 0.48, sx - 0.5]) {
    parts.push(box(0.46, 0.08, 0.1, C.woodDark, x, deckY + 0.46, pf));
    for (let i = 0; i < 5; i++) parts.push(ball(0.05, fl[(i + (x < 0 ? 2 : 0)) % 5], x - 0.18 + i * 0.09, deckY + 0.57 + r() * 0.03, pf + (i % 2 ? 0.02 : -0.02)));
  }
  // porch lanterns by the door, bench with cushion, potted plants at the steps
  for (const s of [-1, 1]) {
    parts.push(
      box(0.1, 0.13, 0.08, C.glass, cx + s * 0.38, 0.86, z1 + 0.05, 'glow'),
      box(0.13, 0.03, 0.11, C.black, cx + s * 0.38, 0.99, z1 + 0.05),
      cyl(0.085, 0.065, 0.14, 8, '#c8693c', cx + s * 0.5, 0, fz + 0.12),
      ball(0.1, C.leaf, cx + s * 0.5, 0.2, fz + 0.12),
      ball(0.04, s > 0 ? C.pink : C.yellow, cx + s * 0.5 + 0.03, 0.29, fz + 0.15),
    );
  }
  parts.push(
    box(0.12, 0.2, 0.62, C.woodDark, x1 + 0.28, deckY, -0.3),
    box(0.22, 0.05, 0.66, C.woodLight, x1 + 0.3, deckY + 0.2, -0.3),
    box(0.04, 0.24, 0.66, C.woodLight, x1 + 0.2, deckY + 0.25, -0.3),
    box(0.16, 0.05, 0.22, C.red, x1 + 0.32, deckY + 0.25, -0.14),
    box(0.16, 0.05, 0.22, C.blue, x1 + 0.32, deckY + 0.25, -0.46),
  );
  return parts;
}

function mailbox(x, z, ry = 0, fancy = false) {
  return place(group(
    box(0.06, 0.5, 0.06, C.woodDark, 0, 0, 0),
    box(0.18, 0.14, 0.26, C.blue, 0, 0.5, 0),
    rot(ccyl(0.09, 0.09, 0.26, 8, C.blue, 0, 0.64, 0), Math.PI / 2, 0, 0),
    box(0.02, 0.14, 0.04, fancy ? K.gold : C.red, 0.1, 0.58, -0.06),
  ), x, 0, z, ry);
}

// ------------------------------------------------------------------ construction props
// putlog scaffolding along a wall: poles on the line a->b, decks reaching `reach` toward the wall (dir n)
function scaffold(ax, az, bx, bz, nx, nz, reach, levels, topY) {
  const parts = [];
  const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 0.75));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    parts.push(cyl(0.03, 0.035, topY, 5, K.pole, x, 0, z));
    for (const y of levels) parts.push(beam([x, y - 0.03, z], [x + nx * reach, y - 0.03, z + nz * reach], 0.035, K.poleD));
  }
  for (const y of levels) {
    parts.push(board([ax, y - 0.05, az], [bx, y - 0.05, bz], 0.04, 0.04, K.poleD));
    for (const f of [0.3, 0.72]) {
      const ox = nx * reach * f, oz = nz * reach * f;
      parts.push(board([ax + ox, y, az + oz], [bx + ox, y, bz + oz], reach * 0.4, 0.03, C.woodLight));
    }
    parts.push(board([ax, y + 0.38, az], [bx, y + 0.38, bz], 0.035, 0.035, K.pole));
  }
  parts.push(beam([ax, 0.08, az], [bx, levels[levels.length - 1] - 0.05, bz], 0.03, K.poleD));
  return parts;
}

function ladder(len, rungs = 6) {
  const parts = [box(0.035, len, 0.035, C.wood, -0.13, 0, 0), box(0.035, len, 0.035, C.wood, 0.13, 0, 0)];
  for (let i = 1; i <= rungs; i++) parts.push(box(0.26, 0.025, 0.03, C.woodLight, 0, (i * len) / (rungs + 1), 0));
  return group(parts);
}

// pyramid stack of lumber (bottom at 0) lying along X, rows of 3-2-1 boards
function lumber(rows = 3, l = 0.7) {
  const parts = [];
  const r = hashRand(rows * 7 + Math.round(l * 10));
  const cols = [C.woodLight, C.plank, '#e0b073'];
  for (let row = 0; row < rows; row++) {
    const n = 3 - row;
    for (let k = 0; k < n; k++) {
      parts.push(box(l + (r() - 0.5) * 0.12, 0.06, 0.1, cols[(row + k) % 3], (r() - 0.5) * 0.08, row * 0.062, (k - (n - 1) / 2) * 0.115));
    }
  }
  return group(parts);
}

function sawhorse() {
  return group(
    box(0.5, 0.05, 0.07, C.wood, 0, 0.3, 0),
    rot(cbox(0.04, 0.34, 0.04, C.woodDark, -0.18, 0.16, 0.06), 0.3, 0, 0), rot(cbox(0.04, 0.34, 0.04, C.woodDark, -0.18, 0.16, -0.06), -0.3, 0, 0),
    rot(cbox(0.04, 0.34, 0.04, C.woodDark, 0.18, 0.16, 0.06), 0.3, 0, 0), rot(cbox(0.04, 0.34, 0.04, C.woodDark, 0.18, 0.16, -0.06), -0.3, 0, 0),
    rot(cbox(0.7, 0.035, 0.12, C.woodLight, 0.05, 0.37, 0), 0, 0.15, 0),
  );
}

function paintBucket(col) {
  return group(
    cyl(0.07, 0.06, 0.12, 8, '#b9c0c8', 0, 0, 0),
    cyl(0.062, 0.062, 0.01, 8, col, 0, 0.115, 0),
    torus(0.065, 0.006, 3, 8, K.iron, 0, 0.12, 0, Math.PI),
    rot(cbox(0.025, 0.2, 0.025, C.wood, 0.02, 0.18, 0), 0, 0, -0.3),
  );
}

// ------------------------------------------------------------------ stages
function masterStage1() {
  // the original farmhouse, wrapped in scaffolding with planks and a ladder
  const parts = [BUILDERS.farmhouse()];
  // +X side (outside the roof eave), front-left, and the back
  parts.push(scaffold(1.47, 0.95, 1.47, -1.05, -1, 0, 0.27, [0.78, 1.42], 2.05));
  parts.push(scaffold(-1.42, 1.38, -0.55, 1.38, 0, -1, 0.36, [0.78, 1.42], 2.15));
  parts.push(scaffold(-1.1, -1.4, 0.3, -1.4, 0, 1, 0.3, [0.78], 1.3));
  // ladder leaning on the front scaffold
  const lad = ladder(1.6, 6);
  lad.position.set(-0.98, 0, 1.56);
  lad.rotation.x = -0.1;
  parts.push(lad);
  // stacks of lumber, a sawhorse, buckets and a pile of red shingles
  parts.push(
    place(lumber(3, 0.52), 0.74, 0, 1.28, 0),
    place(sawhorse(), 0.92, 0, -1.3),
    place(paintBucket(C.cream), 0.5, 0, -1.4),
    place(paintBucket(C.white), -1.15, 0.8, 1.25),
    box(0.26, 0.04, 0.2, C.redDark, -0.8, 1.42, 1.2), box(0.26, 0.04, 0.2, C.red, -0.79, 1.46, 1.21),
    box(0.06, 0.06, 0.4, C.woodLight, 1.33, 1.43, -0.3),
  );
  // surveyor stakes with string marking out the future porch
  const st = [[-1.45, 1.52], [1.46, 1.52]];
  for (const [x, z] of st) parts.push(box(0.04, 0.22, 0.04, C.woodLight, x, 0, z), box(0.045, 0.03, 0.045, C.red, x, 0.18, z));
  parts.push(board([-1.45, 0.16, 1.52], [1.46, 0.16, 1.52], 0.008, 0.008, C.white));
  return group(parts);
}

function masterStage2() {
  const { x0, x1, z0, z1, y1, y2, cx, cz, w, d, rh } = MH;
  const parts = [mhGround(2), mhChimney(1.12)];
  // second floor: deck, finished back & left walls, framed front & right walls
  parts.push(
    // inset from the white floor band (w+0.06) and sitting on top of it, so no faces share a plane
    box(w + 0.02, 0.05, d + 0.02, C.woodLight, cx, y1 + 0.028, cz),
    box(w, y2 - y1, 0.06, C.cream, cx, y1, z0 + 0.03),
    box(0.06, y2 - y1, d, C.cream, x0 + 0.03, y1, cz),
    box(0.6, y2 - y1, 0.06, C.cream, x0 + 0.3, y1, z1 - 0.03), // first boards on the front
  );
  const studH = y2 - y1 - 0.05;
  for (let x = x0 + 0.62; x <= x1 + 0.001; x += 0.3) parts.push(box(0.05, studH, 0.06, C.wood, Math.min(x, x1 - 0.03), y1 + 0.05, z1 - 0.03));
  for (let z = z1 - 0.32; z >= z0 + 0.1; z -= 0.3) parts.push(box(0.06, studH, 0.05, C.wood, x1 - 0.03, y1 + 0.05, z));
  parts.push(box(0.06, studH, 0.05, C.wood, x1 - 0.03, y1 + 0.05, z0 + 0.03));
  // top plates and window headers
  parts.push(
    box(w, 0.06, 0.07, C.woodDark, cx, y2 - 0.06, z1 - 0.03),
    box(0.07, 0.06, d, C.woodDark, x1 - 0.03, y2 - 0.06, cz),
    box(0.36, 0.05, 0.07, C.woodDark, cx + 0.62, 1.78, z1 - 0.03), box(0.36, 0.05, 0.07, C.woodDark, cx + 0.62, 1.3, z1 - 0.03),
    box(0.07, 0.05, 0.36, C.woodDark, x1 - 0.03, 1.78, -0.95), box(0.07, 0.05, 0.36, C.woodDark, x1 - 0.03, 1.3, -0.95),
  );
  // roof: back half shingled, front half bare rafters + ridge beam
  const rw = w + 0.38, rd = d + 0.32, back = cz - rd / 2, front = cz + rd / 2, split = -0.3;
  const dBack = split - back;
  parts.push(roof(rw, rh, dBack, C.red, cx, y2, back + dBack / 2));
  parts.push(beam([cx, y2 + rh - 0.05, split], [cx, y2 + rh - 0.05, front - 0.04], 0.07, C.woodDark));
  for (let z = split + 0.22; z <= front; z += 0.3) {
    for (const s of [-1, 1]) {
      const zz = Math.min(z, front - 0.06);
      parts.push(beam([cx + s * (rw / 2 - 0.02), y2 + 0.02, zz], [cx, y2 + rh - 0.02, zz], 0.05, C.wood));
    }
  }
  // gable stud + collar tie at the front
  parts.push(
    beam([cx, y2, front - 0.06], [cx, y2 + rh - 0.04, front - 0.06], 0.05, C.wood),
    box(rw * 0.5, 0.05, 0.05, C.wood, cx, y2 + rh * 0.48, front - 0.06),
  );
  // a few shingle bundles waiting on the rafters
  parts.push(
    rot(cbox(0.3, 0.06, 0.22, C.redDark, cx - 0.55, y2 + rh * 0.5 + 0.05, 0.1), 0, 0, Math.atan2(rh, rw / 2)),
  );
  // scaffolding along +X and the back
  parts.push(scaffold(1.12, 0.65, 1.12, -1.3, -1, 0, 0.28, [1.06, 1.86], 2.35));
  // the porch is being started: stone piers, rim joist and a few joists
  const pf = z1 + 0.55;
  for (const x of [-1.38, cx - 0.38, cx + 0.38, 1.37]) parts.push(box(0.12, 0.12, 0.12, C.stone, x, 0, pf));
  parts.push(box(1.95, 0.08, 0.06, C.wood, -0.4, 0.12, pf));
  for (const x of [-1.3, -0.85, -0.4, 0.05, 0.5]) parts.push(box(0.05, 0.08, pf - z1, C.woodLight, x, 0.12, (pf + z1) / 2));
  parts.push(box(0.6, 0.03, 0.12, K.deck, -1.06, 0.2, z1 + 0.12), box(0.6, 0.03, 0.12, K.deck, -1.06, 0.2, z1 + 0.25));
  // ladder against the scaffold, lumber, sawhorse, buckets
  const lad = ladder(2.0, 8);
  lad.position.set(1.12, 0, 0.98);
  lad.rotation.x = -0.13;
  parts.push(lad);
  parts.push(
    place(lumber(3, 0.62), 0.85, 0, 1.3, 0),
    place(sawhorse(), -0.75, 0, -1.42),
    place(paintBucket(C.white), 1.2, 1.06, 0.3),
    place(paintBucket(C.cream), 0.45, 0, 1.35),
    mailbox(1.32, 1.42, Math.PI / 2),
  );
  return group(parts);
}

function masterStage3() {
  const { y2, cx, cz, rh } = MH;
  const parts = [mhGround(3), mhUpperWalls(), mhRoof(3), mhChimney(1.9), mhPorch(3)];
  parts.push(weathervane(cx, y2 + rh + 0.02, cz + 0.45));
  // little hedge + flowers along the left of the porch and the mailbox by the steps
  parts.push(
    scl(ball(0.16, C.leafDark, -1.4, 0.1, -0.8, 1), 0.7, 0.8, 1.6),
    ball(0.045, C.pink, -1.45, 0.2, -0.7), ball(0.045, C.yellow, -1.44, 0.18, -0.95),
    mailbox(1.36, 1.42, Math.PI / 2, true),
    scl(ball(0.12, C.leaf, 0.38, 0.06, 1.42, 1), 1.6, 0.6, 0.7),
    ball(0.04, C.red, 0.3, 0.14, 1.44), ball(0.04, C.purple, 0.44, 0.14, 1.42),
    scl(ball(0.12, C.leaf, -0.86, 0.06, 1.42, 1), 1.6, 0.6, 0.7),
    ball(0.04, C.yellow, -0.92, 0.14, 1.44), ball(0.04, C.pink, -0.78, 0.14, 1.42),
  );
  return group(parts);
}

function masterhouse(stage = '3') {
  const s = Math.max(1, Math.min(3, Math.round(+stage) || 3));
  return s === 1 ? masterStage1() : s === 2 ? masterStage2() : masterStage3();
}

registerBuilders({ wagon, donkey, masterhouse });
