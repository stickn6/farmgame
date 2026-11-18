// Procedural models — see H in ../assets.js for helpers.
// Animals (pig, bee, goat) and the visiting villagers (npc:<id>). Forward is +Z for all of them.
import * as THREE from 'three';
import { H, registerBuilders } from '../assets.js';

const { box, cyl, cone, ball, sph, group, rot, scl, mesh, g, C } = H;

// ------------------------------------------------------------------ small helpers
// group with a transform (a pivot): children are placed in its local space
function pv(x, y, z, rx, ry, rz, ...kids) {
  const gr = group(...kids);
  gr.position.set(x, y, z);
  gr.rotation.set(rx, ry, rz);
  return gr;
}

// cylinder centered at (x,y,z) with its axis along Z (discs, snouts, wheels)
const discZ = (r, h, seg, color, x, y, z) => rot(cyl(r, r, h, seg, color, x, y - h / 2, z), Math.PI / 2, 0, 0);
// cylinder centered at (x,y,z) with its axis along X
const rodX = (r, len, seg, color, x, y, z) => rot(cyl(r, r, len, seg, color, x, y - len / 2, z), 0, 0, Math.PI / 2);

const UP = new THREE.Vector3(0, 1, 0);
// tapered cylinder from point a to point b (radius ra at a, rb at b)
function stick(a, b, ra, rb, color, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const len = d.length();
  const gr = group(cyl(rb, ra, len, seg, color, 0, -len / 2, 0));
  gr.position.copy(A).add(B).multiplyScalar(0.5);
  gr.quaternion.setFromUnitVectors(UP, d.normalize());
  return gr;
}
// flat strap (box) from a to b, w wide and t thick
function strap(a, b, w, t, color) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const len = d.length();
  const gr = group(box(w, len, t, color, 0, -len / 2, 0));
  gr.position.copy(A).add(B).multiplyScalar(0.5);
  gr.quaternion.setFromUnitVectors(UP, d.normalize());
  return gr;
}
// partial torus (curly tails, cane crooks). Lies in the XY plane, arc starts at +X going counter-clockwise.
const torus = (r, tube, arc, color, x = 0, y = 0, z = 0) =>
  mesh(g(`life-torus${r}|${tube}|${arc}`, () => new THREE.TorusGeometry(r, tube, 4, 10, arc)), color, x, y, z);

// ------------------------------------------------------------------ pig (~0.89 long incl. tail, ~0.54 tall)
function pig() {
  const P = '#f7b3c2', PD = '#ea8fa6', NOSE = '#f59bb0', HOLE = '#9c4a5f', HOOF = '#8f5a4e', MUD = '#7d5131';
  const parts = [
    // round body + rump
    scl(sph(0.19, P, 0, 0.27, -0.03, 10, 8), 1, 0.88, 1.38),
    scl(sph(0.15, P, 0, 0.29, -0.14, 10, 8), 1.1, 1, 1),
    // head
    scl(sph(0.14, P, 0, 0.33, 0.21, 10, 8), 1, 0.95, 0.95),
    // snout disc + nostrils
    discZ(0.068, 0.08, 10, NOSE, 0, 0.3, 0.355),
    discZ(0.06, 0.012, 10, PD, 0, 0.3, 0.398),
    box(0.022, 0.034, 0.01, HOLE, 0.024, 0.284, 0.401), box(0.022, 0.034, 0.01, HOLE, -0.024, 0.284, 0.401),
    // eyes with a tiny shine
    box(0.032, 0.04, 0.02, C.black, 0.07, 0.355, 0.32), box(0.032, 0.04, 0.02, C.black, -0.07, 0.355, 0.32),
    box(0.012, 0.012, 0.01, C.white, 0.078, 0.38, 0.331), box(0.012, 0.012, 0.01, C.white, -0.062, 0.38, 0.331),
    // cheeks
    box(0.04, 0.025, 0.01, '#f58ea8', 0.1, 0.31, 0.3), box(0.04, 0.025, 0.01, '#f58ea8', -0.1, 0.31, 0.3),
    // mud spot on the flank and rump
    scl(sph(0.075, MUD, 0.16, 0.25, -0.1, 8, 6), 0.42, 0.75, 1.1),
    scl(sph(0.05, MUD, 0.1, 0.38, -0.22, 8, 6), 0.9, 0.5, 0.9),
    scl(sph(0.045, '#936340', -0.15, 0.22, 0.02, 8, 6), 0.45, 0.7, 1),
  ];
  // floppy ears, folded forward over the eyes
  for (const s of [1, -1]) {
    parts.push(pv(s * 0.075, 0.44, 0.2, 0.75, 0, -s * 0.45,
      box(0.1, 0.022, 0.11, P, 0, 0, 0.045),
      box(0.07, 0.024, 0.07, PD, 0, -0.004, 0.05)));
  }
  // short legs, back ones muddy
  for (const [x, z, muddy] of [[0.1, 0.13, false], [-0.1, 0.13, false], [0.1, -0.18, true], [-0.1, -0.18, true]]) {
    parts.push(box(0.09, 0.14, 0.09, P, x, 0, z));
    if (muddy) parts.push(box(0.095, 0.07, 0.095, MUD, x, 0.02, z));
    parts.push(box(0.096, 0.03, 0.096, HOOF, x, 0, z));
  }
  // curly tail (curl plane faces the side so it reads from the camera)
  const tail = rot(torus(0.035, 0.012, Math.PI * 1.6, PD), 0, Math.PI / 2, 0);
  tail.position.set(0, 0.33, -0.34);
  parts.push(tail, stick([0, 0.32, -0.28], [0, 0.34, -0.33], 0.012, 0.012, PD, 5));
  return group(scl(group(parts), 1.12));
}

// ------------------------------------------------------------------ bee (~0.3 long after scaling; origin at its center, it flies)
function bee() {
  const Y = '#ffd23f', K = '#2b2622', WING = '#e6f6ff', WING2 = '#bfe3ff';
  const parts = [
    scl(sph(0.045, Y, 0, 0, -0.005, 10, 8), 1, 0.95, 1.4),
    // stripes
    discZ(0.0455, 0.014, 10, K, 0, 0, 0.0),
    discZ(0.0405, 0.014, 10, K, 0, 0, -0.03),
    rot(cone(0.016, 0.03, 5, K, 0, -0.015, -0.07), -Math.PI / 2, 0, 0),
    // head + eyes + antennae
    sph(0.031, K, 0, 0.006, 0.066, 8, 6),
    box(0.014, 0.016, 0.01, C.white, 0.014, 0.014, 0.093), box(0.014, 0.016, 0.01, C.white, -0.014, 0.014, 0.093),
    stick([0.01, 0.028, 0.075], [0.025, 0.06, 0.1], 0.004, 0.004, K, 4),
    stick([-0.01, 0.028, 0.075], [-0.025, 0.06, 0.1], 0.004, 0.004, K, 4),
    ball(0.008, K, 0.025, 0.06, 0.1), ball(0.008, K, -0.025, 0.06, 0.1),
  ];
  // wings: two pairs, angled up and back
  for (const s of [1, -1]) {
    parts.push(pv(s * 0.02, 0.035, 0.005, 0, s * 0.35, s * 0.55,
      scl(sph(0.05, WING, s * 0.045, 0, -0.005, 8, 6), 1, 0.12, 0.6)));
    parts.push(pv(s * 0.018, 0.033, -0.025, 0, s * 0.8, s * 0.4,
      scl(sph(0.034, WING2, s * 0.032, 0, 0, 8, 6), 1, 0.12, 0.55)));
  }
  // scaled up so it reads at game distance next to the hives (origin stays at its center)
  return group(scl(group(parts), 1.6));
}

// ------------------------------------------------------------------ goat (~0.8 long, ~0.84 tall to the horn tips)
function goat() {
  const W = '#f6f1e4', TAN = '#c99257', HORN = '#9b8b74', HOOF = '#4f4036', NOSE = '#d8a39b';
  const parts = [
    // body + rounded belly
    box(0.32, 0.24, 0.48, W, 0, 0.3, -0.02),
    scl(sph(0.15, W, 0, 0.36, -0.02, 8, 6), 0.95, 0.8, 1.55),
    // tan saddle patch + chest patch
    box(0.332, 0.14, 0.2, TAN, 0, 0.405, -0.1),
    box(0.23, 0.12, 0.03, TAN, 0, 0.36, 0.215),
    // neck
    rot(box(0.13, 0.22, 0.13, W, 0, 0.4, 0.18), 0.45, 0, 0),
    // head + muzzle
    box(0.17, 0.17, 0.18, W, 0, 0.56, 0.29),
    rot(box(0.12, 0.1, 0.12, W, 0, 0.545, 0.41), 0.15, 0, 0),
    box(0.13, 0.02, 0.13, TAN, 0, 0.722, 0.28),
    box(0.07, 0.035, 0.02, NOSE, 0, 0.6, 0.468),
    box(0.012, 0.015, 0.01, '#8a5a52', 0.018, 0.61, 0.479), box(0.012, 0.015, 0.01, '#8a5a52', -0.018, 0.61, 0.479),
    // eyes on the corners of the head, so they read from the front and the side
    box(0.036, 0.045, 0.036, C.black, 0.074, 0.635, 0.367), box(0.036, 0.045, 0.036, C.black, -0.074, 0.635, 0.367),
    box(0.012, 0.012, 0.01, C.white, 0.08, 0.665, 0.386), box(0.012, 0.012, 0.01, C.white, -0.068, 0.665, 0.386),
    // little beard
    rot(cone(0.035, 0.11, 5, '#e2d6bd', 0, 0.44, 0.43), Math.PI, 0, 0),
    // upright tail
    rot(box(0.05, 0.12, 0.04, W, 0, 0.5, -0.26), -0.35, 0, 0),
    rot(box(0.052, 0.04, 0.042, TAN, 0, 0.6, -0.29), -0.35, 0, 0),
  ];
  // ears sticking out sideways
  for (const s of [1, -1]) {
    parts.push(pv(s * 0.08, 0.68, 0.27, 0, 0, -s * 0.25, box(0.13, 0.03, 0.06, W, s * 0.065, 0, 0), box(0.09, 0.032, 0.035, '#f0c9bd', s * 0.075, 0, 0.004)));
  }
  // curved horns: three segments sweeping backwards
  for (const s of [1, -1]) {
    parts.push(pv(s * 0.045, 0.72, 0.26, -0.2, 0, -s * 0.28,
      cyl(0.024, 0.031, 0.07, 6, HORN, 0, 0, 0),
      pv(0, 0.065, 0, -0.55, 0, 0,
        cyl(0.018, 0.024, 0.06, 6, HORN, 0, 0, 0),
        pv(0, 0.055, 0, -0.7, 0, 0, cone(0.018, 0.07, 6, '#857560', 0, 0, 0)))));
  }
  // slim legs + hooves
  for (const [x, z] of [[0.11, 0.17], [-0.11, 0.17], [0.11, -0.19], [-0.11, -0.19]]) {
    parts.push(box(0.075, 0.32, 0.075, W, x, 0, z), box(0.08, 0.05, 0.08, HOOF, x, 0, z));
  }
  return group(scl(group(parts), 1.0));
}

// ------------------------------------------------------------------ villagers
// Chunky toy-like person. Returns parts, the two arm pivots and useful measurements.
function person(o) {
  const skin = o.skin;
  const legH = o.legH ?? 0.27, torsoH = o.torsoH ?? 0.29, tw = o.tw ?? 0.31, td = o.td ?? 0.2, hs = o.hs ?? 1;
  const armLen = o.armLen ?? 0.27;
  const shoeH = 0.07;
  const hipY = shoeH + legH;
  const shY = hipY + torsoH;
  const HW = 0.29 * hs, HH = 0.27 * hs, HD = 0.26 * hs;
  const headY = shY + 0.02;
  const headTop = headY + HH;
  const fz = HD / 2;
  const legX = tw * 0.23;
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push(box(0.12, shoeH, 0.17, o.shoes, sx * legX, 0, 0.025));
    parts.push(box(0.105, legH + 0.01, 0.115, o.legs ?? o.pants, sx * legX, shoeH - 0.005, 0));
  }
  if (o.torso !== false) parts.push(box(tw, torsoH, td, o.shirt, 0, hipY, 0));
  if (o.pants && o.legs && o.legs !== o.pants) parts.push(box(tw * 0.98, 0.07, td * 0.98, o.pants, 0, hipY - 0.06, 0));
  // neck + head
  parts.push(box(0.12, 0.05, 0.11, skin, 0, shY - 0.02, 0));
  parts.push(box(HW, HH, HD, skin, 0, headY, 0));
  // face
  const eyeY = headY + HH * 0.48;
  const eyeCol = o.eyes || '#2a211d';
  if (!o.noEyes) {
    for (const sx of [-1, 1]) {
      parts.push(box(0.04 * hs, 0.055 * hs, 0.02, eyeCol, sx * 0.068 * hs, eyeY, fz));
      parts.push(box(0.014, 0.014, 0.01, C.white, sx * 0.068 * hs + 0.008, eyeY + 0.03 * hs, fz + 0.008));
      if (o.blush !== false) parts.push(box(0.05 * hs, 0.026 * hs, 0.01, o.blush || '#f0898a', sx * 0.1 * hs, headY + HH * 0.3, fz + 0.002));
    }
  }
  parts.push(box(0.045 * hs, 0.045 * hs, 0.03, o.nose || shade(skin, -0.14), 0, headY + HH * 0.33, fz + 0.005));
  if (!o.noMouth) parts.push(box(0.06 * hs, 0.016, 0.01, '#7a3328', 0, headY + HH * 0.16, fz + 0.002));
  // ears
  for (const sx of [-1, 1]) parts.push(box(0.03, 0.07 * hs, 0.05 * hs, skin, sx * (HW / 2 + 0.012), headY + HH * 0.4, 0));
  // arms (pivot at the shoulder; o.armL/armR = [rx, ry, rz] added to a slight outward splay)
  const arms = {};
  const hands = {};
  for (const [sx, k] of [[-1, 'L'], [1, 'R']]) {
    const a = o['arm' + k] || [0, 0, 0];
    const arm = group(
      box(0.085, armLen + 0.05, 0.1, o.sleeve ?? o.shirt, 0, -armLen, 0),
      box(0.075, 0.07, 0.08, skin, 0, -armLen - 0.065, 0),
    );
    if (o.cuff) arm.add(box(0.09, 0.03, 0.105, o.cuff, 0, -armLen + 0.005, 0));
    arm.position.set(sx * (tw / 2 + 0.043), shY - 0.05, 0);
    arm.rotation.set(a[0], a[1], sx * 0.07 + a[2]);
    arm.updateMatrixWorld(true);
    arms[k] = arm;
    hands[k] = arm.localToWorld(new THREE.Vector3(0, -armLen - 0.035, 0)).toArray();
  }
  return { parts, arms: [arms.L, arms.R], hands, m: { hipY, shY, headY, headTop, HW, HH, HD, fz, eyeY, tw, td, legX, armLen } };
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * (1 + amt))));
  return '#' + c.getHexString();
}

// hair that covers the top, the back and the sides of the box head
function hairCap(m, col, { back = 0.85, sides = 0.55, top = 0.3, fringe = 0.0 } = {}) {
  const { HW, HH, HD, headY, headTop, fz } = m;
  const parts = [box(HW + 0.03, HH * back, 0.05, col, 0, headTop - HH * back, -HD / 2 - 0.005)];
  if (top) parts.push(box(HW + 0.03, HH * top, HD + 0.03, col, 0, headTop - HH * top + 0.012, 0));
  for (const sx of [-1, 1]) parts.push(box(0.04, HH * sides, HD * 0.75, col, sx * (HW / 2 + 0.008), headTop - HH * sides, -HD * 0.12));
  if (fringe) parts.push(box(HW + 0.02, HH * fringe, 0.04, col, 0, headTop - HH * fringe, fz - 0.005));
  return parts;
}

function rosa() {
  const SKIN = '#d9a072', HAIR = '#6b3f22', DRESS = C.red, APRON = C.white;
  const p = person({ skin: SKIN, shirt: DRESS, pants: SKIN, legs: '#f3ede2', shoes: '#7a3b2a', armL: [-1.05, 0, 0.32], armR: [-1.05, 0, -0.32], cuff: APRON });
  const { m, hands } = p;
  const parts = p.parts;
  // flared skirt + apron
  parts.push(
    rot(cyl(m.tw / 2 + 0.01, 0.215, 0.22, 10, DRESS, 0, m.hipY - 0.18, 0), 0, Math.PI / 10, 0),
    box(m.tw + 0.012, 0.04, m.td + 0.012, APRON, 0, m.hipY - 0.01, 0),
    rot(box(0.22, 0.2, 0.03, APRON, 0, m.hipY - 0.2, 0.19), -0.2, 0, 0),
    box(0.17, 0.15, 0.02, APRON, 0, m.shY - 0.2, m.td / 2 + 0.005),
    box(0.035, 0.08, 0.02, APRON, 0.07, m.shY - 0.07, m.td / 2 + 0.005), box(0.035, 0.08, 0.02, APRON, -0.07, m.shY - 0.07, m.td / 2 + 0.005),
    // collar
    box(0.16, 0.03, 0.12, APRON, 0, m.shY - 0.02, 0.01),
  );
  // hair: bob + low bun at the back
  parts.push(...hairCap(m, HAIR, { back: 0.9, sides: 0.7, top: 0.25, fringe: 0.18 }), ball(0.08, HAIR, 0, m.headY + 0.08, -m.HD / 2 - 0.06, 0));
  // tall chef hat: band + tall body + puffy top
  const hy = m.headTop - 0.03;
  parts.push(
    cyl(0.155, 0.155, 0.08, 10, APRON, 0, hy, 0),
    cyl(0.165, 0.14, 0.15, 10, APRON, 0, hy + 0.08, 0),
    scl(sph(0.19, APRON, 0, hy + 0.24, 0, 12, 8), 1, 0.5, 1),
    sph(0.09, '#f1f0ea', 0.08, hy + 0.29, 0.06, 8, 6), sph(0.09, '#f1f0ea', -0.08, hy + 0.29, -0.05, 8, 6), sph(0.085, '#f1f0ea', 0.07, hy + 0.3, -0.07, 8, 6), sph(0.085, '#f1f0ea', -0.06, hy + 0.3, 0.07, 8, 6),
  );
  // rolling pin held in both hands
  const y = (hands.L[1] + hands.R[1]) / 2, z = (hands.L[2] + hands.R[2]) / 2 + 0.01;
  parts.push(
    rodX(0.045, 0.3, 8, C.woodLight, 0, y, z),
    rodX(0.018, 0.5, 6, C.woodDark, 0, y, z),
    rodX(0.024, 0.07, 6, C.woodDark, 0.26, y, z), rodX(0.024, 0.07, 6, C.woodDark, -0.26, y, z),
  );
  return group(parts, p.arms);
}

function theo() {
  const SKIN = '#f0c39b', BEARD = '#a35b2c', OVER = C.blue, SHIRT = '#efe4cd', HAT = C.yellow, BOOT = '#355e44';
  const p = person({ skin: SKIN, shirt: SHIRT, pants: OVER, shoes: BOOT, armL: [-0.15, 0, 0], armR: [-0.75, 0, -0.1], noMouth: true, blush: '#ec9a86' });
  const { m, hands } = p;
  const parts = p.parts;
  const fzT = m.td / 2;
  // rubber boots
  for (const sx of [-1, 1]) parts.push(box(0.12, 0.13, 0.13, BOOT, sx * m.legX, 0.05, 0), box(0.13, 0.03, 0.14, '#2a4a36', sx * m.legX, 0.17, 0));
  // overalls: waist, bib, straps, buttons, pocket
  parts.push(
    box(m.tw + 0.012, 0.11, m.td + 0.012, OVER, 0, m.hipY - 0.005, 0),
    box(0.2, 0.16, 0.02, OVER, 0, m.hipY + 0.1, fzT + 0.006),
    box(0.1, 0.06, 0.01, C.blueDark, 0, m.hipY + 0.14, fzT + 0.017),
    box(0.04, 0.02, m.td + 0.02, OVER, 0.085, m.shY - 0.012, 0), box(0.04, 0.02, m.td + 0.02, OVER, -0.085, m.shY - 0.012, 0),
    box(0.04, 0.05, 0.02, OVER, 0.085, m.shY - 0.06, fzT + 0.006), box(0.04, 0.05, 0.02, OVER, -0.085, m.shY - 0.06, fzT + 0.006),
    box(0.03, 0.03, 0.01, C.yellow, 0.08, m.hipY + 0.22, fzT + 0.017), box(0.03, 0.03, 0.01, C.yellow, -0.08, m.hipY + 0.22, fzT + 0.017),
  );
  // beard, mustache, sideburns, hair at the back
  parts.push(
    box(m.HW + 0.02, 0.12, 0.08, BEARD, 0, m.headY - 0.035, m.fz - 0.025),
    box(0.2, 0.06, 0.06, BEARD, 0, m.headY - 0.07, m.fz - 0.03),
    box(0.14, 0.035, 0.035, BEARD, 0, m.headY + m.HH * 0.2, m.fz + 0.01),
    ...hairCap(m, BEARD, { back: 0.7, sides: 0.75, top: 0 }),
  );
  // yellow rain hat (sou'wester), tipped back a little
  parts.push(pv(0, m.headTop - 0.035, -0.01, -0.15, 0, 0,
    cyl(0.235, 0.27, 0.04, 12, HAT, 0, 0, 0),
    cyl(0.155, 0.175, 0.11, 10, HAT, 0, 0.03, 0),
    scl(sph(0.155, HAT, 0, 0.14, 0, 10, 6), 1, 0.35, 1),
    cyl(0.178, 0.178, 0.025, 10, '#e2b52a', 0, 0.035, 0),
  ));
  // fishing rod over the right shoulder, with a little fish on the line
  const h = new THREE.Vector3(...hands.R);
  // rests just behind the shoulder and leans back, clear of the hat brim
  const dir = new THREE.Vector3(0.1, 0.62, -0.78).normalize();
  const butt = h.clone().addScaledVector(dir, -0.08);
  const tip = h.clone().addScaledVector(dir, 1.25);
  parts.push(
    stick(butt.toArray(), h.clone().addScaledVector(dir, 0.1).toArray(), 0.026, 0.024, '#b5793e', 6),
    stick(h.clone().addScaledVector(dir, 0.1).toArray(), tip.toArray(), 0.016, 0.008, C.woodDark, 5),
    discZ(0.035, 0.03, 8, '#9aa3ad', h.x + 0.04, h.y + 0.02, h.z + 0.03),
    stick(tip.toArray(), [tip.x, tip.y - 0.3, tip.z], 0.004, 0.004, '#f6f6f6', 3),
  );
  const fy = tip.y - 0.37;
  parts.push(pv(tip.x, fy, tip.z, 0, 0, Math.PI / 2,
    scl(sph(0.055, '#7fb6d6', 0, 0, 0, 8, 6), 1.5, 0.75, 0.45),
    rot(scl(cone(0.04, 0.06, 4, '#5d93b8', -0.1, -0.03, 0), 1, 1, 0.4), 0, 0, Math.PI / 2),
    box(0.012, 0.012, 0.06, C.black, 0.05, 0.012, 0),
  ));
  return group(parts, p.arms);
}

function mabel() {
  const SKIN = '#f4d4c1', HAIR = '#cfd0d6', CARD = '#ef8fb0', SKIRT = '#7c5aa6', FRAME = '#6b4b2e';
  const p = person({ skin: SKIN, shirt: CARD, pants: SKIRT, shoes: '#5b3a2a', legH: 0.25, torsoH: 0.28, tw: 0.32, armL: [-0.55, 0, 0.12], armR: [-0.4, 0, 0], cuff: '#f7c4d4' });
  const { m, hands } = p;
  const parts = p.parts;
  // long skirt down to the ankles
  parts.push(rot(cyl(m.tw / 2 + 0.01, 0.22, m.hipY - 0.05, 10, SKIRT, 0, 0.06, 0), 0, Math.PI / 10, 0));
  parts.push(rot(cyl(0.225, 0.225, 0.03, 10, '#6a4b92', 0, 0.06, 0), 0, Math.PI / 10, 0));
  // cardigan details: open front with blouse, buttons, collar
  parts.push(
    box(0.07, m.shY - m.hipY - 0.02, 0.02, C.white, 0, m.hipY, m.td / 2 + 0.003),
    box(0.03, 0.03, 0.01, '#fff3c4', 0.055, m.hipY + 0.06, m.td / 2 + 0.01), box(0.03, 0.03, 0.01, '#fff3c4', 0.055, m.hipY + 0.15, m.td / 2 + 0.01),
    box(0.03, 0.03, 0.01, '#fff3c4', -0.055, m.hipY + 0.06, m.td / 2 + 0.01), box(0.03, 0.03, 0.01, '#fff3c4', -0.055, m.hipY + 0.15, m.td / 2 + 0.01),
    rot(box(0.07, 0.05, 0.02, C.white, 0.04, m.shY - 0.045, m.td / 2 + 0.01), 0, 0, -0.5),
    rot(box(0.07, 0.05, 0.02, C.white, -0.04, m.shY - 0.045, m.td / 2 + 0.01), 0, 0, 0.5),
    box(m.tw + 0.012, 0.05, m.td + 0.012, '#e47c9f', 0, m.hipY - 0.01, 0),
  );
  // grey hair with a bun on top
  parts.push(
    ...hairCap(m, HAIR, { back: 0.8, sides: 0.6, top: 0.3, fringe: 0.14 }),
    scl(sph(0.105, HAIR, 0, m.headTop + 0.07, -0.03, 8, 6), 1, 0.9, 1),
    cyl(0.07, 0.09, 0.03, 8, '#b9bac2', 0, m.headTop + 0.0, -0.03),
    box(0.06, 0.02, 0.02, C.pink, 0.08, m.headTop + 0.06, -0.04),
  );
  // round-ish glasses
  for (const sx of [-1, 1]) {
    parts.push(box(0.075, 0.07, 0.015, FRAME, sx * 0.068, m.eyeY - 0.035, m.fz + 0.012));
    parts.push(box(0.055, 0.05, 0.01, '#dff2ff', sx * 0.068, m.eyeY - 0.025, m.fz + 0.018));
    parts.push(box(0.025, 0.035, 0.012, '#2a211d', sx * 0.068, m.eyeY - 0.016, m.fz + 0.02));
  }
  parts.push(box(0.05, 0.012, 0.012, FRAME, 0, m.eyeY + 0.012, m.fz + 0.012));
  // cane in the right hand with a hooked handle
  const h = hands.R;
  const foot = [h[0] + 0.05, 0, h[2] + 0.08];
  parts.push(
    stick(foot, [h[0], h[1] + 0.03, h[2]], 0.017, 0.017, C.woodDark, 6),
    cyl(0.02, 0.02, 0.02, 6, C.black, foot[0], 0, foot[2]),
    pv(h[0], h[1] + 0.03, h[2] + 0.04, 0, Math.PI / 2, 0, torus(0.04, 0.017, Math.PI, C.woodDark)),
  );
  // little handbag on the left arm
  const hl = hands.L;
  parts.push(
    box(0.13, 0.1, 0.06, '#8b4a6b', hl[0] - 0.01, hl[1] - 0.14, hl[2] + 0.02),
    box(0.135, 0.03, 0.065, '#a35a80', hl[0] - 0.01, hl[1] - 0.06, hl[2] + 0.02),
    stick([hl[0] - 0.05, hl[1] - 0.04, hl[2] + 0.02], [hl[0], hl[1], hl[2] + 0.02], 0.008, 0.008, '#5b2f45', 4),
    stick([hl[0] + 0.03, hl[1] - 0.04, hl[2] + 0.02], [hl[0], hl[1], hl[2] + 0.02], 0.008, 0.008, '#5b2f45', 4),
  );
  return group(parts, p.arms);
}

function kip() {
  const SKIN = '#8d5a3b', HAIR = '#3a2417', SHIRT = '#4fb35a', SHORTS = '#5a7fb8', CAP = '#e0473c';
  const p = person({
    skin: SKIN, shirt: SHIRT, pants: SHORTS, legs: SKIN, shoes: C.white, hs: 0.9, legH: 0.17, torsoH: 0.2, tw: 0.26, td: 0.17, armLen: 0.19,
    armL: [0, 0, 0], armR: [0, 0, 2.55], blush: '#c9675e',
  });
  const { m } = p;
  const parts = p.parts;
  // shorts over the upper legs, socks and sneaker trims
  for (const sx of [-1, 1]) {
    parts.push(box(0.115, 0.1, 0.125, SHORTS, sx * m.legX, m.hipY - 0.1, 0));
    parts.push(box(0.11, 0.04, 0.12, C.white, sx * m.legX, 0.07, 0));
    parts.push(box(0.125, 0.025, 0.175, C.red, sx * m.legX, 0.0, 0.025));
  }
  // shirt stripe + collar
  parts.push(
    box(m.tw + 0.01, 0.04, m.td + 0.01, '#f7e36a', 0, m.hipY + 0.09, 0),
    box(0.1, 0.03, 0.02, '#3d9248', 0, m.shY - 0.04, m.td / 2 + 0.004),
  );
  // hair at the back/sides and a tuft poking out of the cap's strap opening
  parts.push(box(m.HW + 0.02, m.HH * 0.72, 0.04, HAIR, 0, m.headTop - m.HH * 0.72, -m.HD / 2 - 0.003));
  for (const sx of [-1, 1]) parts.push(box(0.025, 0.05, 0.1, HAIR, sx * (m.HW / 2 + 0.006), m.headTop - 0.085, -0.05));
  // backwards red cap: crown + dome + brim sticking out the back + button
  parts.push(
    box(m.HW + 0.035, 0.075, m.HD + 0.035, CAP, 0, m.headTop - 0.05, 0),
    scl(sph(0.16, CAP, 0, m.headTop + 0.02, 0, 10, 6), 1, 0.5, 0.95),
    box(0.2, 0.026, 0.14, '#c13a31', 0, m.headTop - 0.045, -m.HD / 2 - 0.065),
    sph(0.022, '#c13a31', 0, m.headTop + 0.1, 0, 6, 4),
    box(0.08, 0.035, 0.012, HAIR, 0, m.headTop - 0.035, m.HD / 2 + 0.014),
    rot(box(0.04, 0.045, 0.03, HAIR, 0.06, m.headTop - 0.075, m.fz - 0.006), 0, 0, 0.35),
    rot(box(0.035, 0.04, 0.03, HAIR, -0.035, m.headTop - 0.07, m.fz - 0.006), 0, 0, -0.3),
  );
  // little orange backpack (reads well from above)
  parts.push(
    box(0.2, 0.18, 0.08, C.orange, 0, m.hipY + 0.02, -m.td / 2 - 0.04),
    box(0.16, 0.06, 0.03, '#d8741c', 0, m.hipY + 0.04, -m.td / 2 - 0.09),
    box(0.03, 0.02, m.td + 0.02, '#d8741c', 0.07, m.shY - 0.01, -0.005), box(0.03, 0.02, m.td + 0.02, '#d8741c', -0.07, m.shY - 0.01, -0.005),
  );
  return group(parts, p.arms);
}

function hank() {
  const SKIN = '#c98d62', SUIT = '#7d54b8', PANTS = '#5c3d8f', WHITE = '#f4f2ec', SASH = '#d8433a', GOLD = '#f2c23a';
  const p = person({ skin: SKIN, shirt: SUIT, pants: PANTS, shoes: '#2b2424', tw: 0.34, td: 0.22, armL: [-0.15, 0, 0.12], armR: [-0.4, 0, -0.25], noMouth: true, cuff: WHITE });
  const { m, hands } = p;
  const parts = p.parts;
  const fzT = m.td / 2;
  // little belly
  parts.push(scl(sph(0.16, SUIT, 0, m.hipY + 0.1, 0.05, 10, 8), 1.05, 0.85, 0.85));
  // shirt front, bow tie, lapels, buttons
  parts.push(
    box(0.08, 0.12, 0.02, WHITE, 0, m.shY - 0.12, fzT + 0.003),
    box(0.1, 0.04, 0.02, SASH, 0, m.shY - 0.045, fzT + 0.012), box(0.03, 0.03, 0.02, '#b33229', 0, m.shY - 0.04, fzT + 0.02),
    rot(box(0.05, 0.13, 0.02, PANTS, 0.06, m.shY - 0.14, fzT + 0.006), 0, 0, 0.3),
    rot(box(0.05, 0.13, 0.02, PANTS, -0.06, m.shY - 0.14, fzT + 0.006), 0, 0, -0.3),
    box(0.025, 0.025, 0.01, GOLD, 0, m.hipY + 0.11, fzT + 0.105), box(0.025, 0.025, 0.01, GOLD, 0, m.hipY + 0.04, fzT + 0.1),
  );
  // mayor's sash from right shoulder across the belly, with a medal
  parts.push(
    strap([0.15, m.shY + 0.005, fzT + 0.012], [0.02, m.hipY + 0.16, fzT + 0.055], 0.075, 0.02, SASH),
    strap([0.02, m.hipY + 0.16, fzT + 0.055], [-0.17, m.hipY + 0.01, fzT + 0.035], 0.075, 0.02, SASH),
    strap([0.15, m.shY + 0.005, fzT + 0.012], [0.12, m.shY + 0.005, -fzT - 0.01], 0.075, 0.02, SASH),
    discZ(0.032, 0.02, 8, GOLD, -0.03, m.hipY + 0.12, fzT + 0.075),
    discZ(0.018, 0.01, 6, '#d99a1e', -0.03, m.hipY + 0.12, fzT + 0.088),
  );
  // white mustache + eyebrows + sideburns
  parts.push(
    box(0.15, 0.04, 0.035, WHITE, 0, m.headY + m.HH * 0.2, m.fz + 0.012),
    rot(box(0.05, 0.03, 0.03, WHITE, 0.085, m.headY + m.HH * 0.2, m.fz + 0.012), 0, 0, 0.5),
    rot(box(0.05, 0.03, 0.03, WHITE, -0.085, m.headY + m.HH * 0.2, m.fz + 0.012), 0, 0, -0.5),
    box(0.06, 0.018, 0.012, WHITE, 0.068, m.eyeY + 0.04, m.fz + 0.004), box(0.06, 0.018, 0.012, WHITE, -0.068, m.eyeY + 0.04, m.fz + 0.004),
    ...hairCap(m, '#ecebe6', { back: 0.3, sides: 0.42, top: 0 }),
  );
  // black top hat with a purple band
  parts.push(pv(0, m.headTop - 0.02, 0, -0.05, 0, 0.06,
    cyl(0.215, 0.215, 0.03, 12, '#262222', 0, 0, 0),
    cyl(0.135, 0.13, 0.27, 12, '#2b2727', 0, 0.02, 0),
    cyl(0.137, 0.137, 0.05, 12, SUIT, 0, 0.04, 0),
    cyl(0.12, 0.12, 0.01, 12, '#3a3535', 0, 0.29, 0),
  ));
  // rolled-up proclamation in the right hand
  const h = hands.R;
  parts.push(rot(cyl(0.035, 0.035, 0.22, 8, '#f6ebcb', h[0] - 0.02, h[1] - 0.11, h[2] + 0.04), 0.4, 0, 0.9), discZ(0.02, 0.01, 6, SASH, h[0] - 0.02, h[1], h[2] + 0.08));
  return group(parts, p.arms);
}

function juno() {
  const SKIN = '#6e4630', HAIR = '#1f1716', SMOCK = '#f7cf3b', PANTS = '#2f6f78', BERET = '#d8383a';
  const p = person({ skin: SKIN, shirt: SMOCK, pants: PANTS, shoes: '#c94e3f', armL: [-0.95, 0, 0.25], armR: [-1.25, 0, -0.1], blush: '#b85c55', sleeve: SMOCK });
  const { m, hands } = p;
  const parts = p.parts;
  // smock flares down over the hips
  parts.push(rot(cyl(m.tw / 2 + 0.012, 0.215, 0.17, 10, SMOCK, 0, m.hipY - 0.13, 0), 0, Math.PI / 10, 0));
  parts.push(box(0.12, 0.08, 0.02, '#e9b92a', 0.08, m.hipY - 0.05, 0.18));
  // paint splotches on the smock
  const splat = [['#3d7fd6', 0.07, m.hipY + 0.17, 1], ['#e2473b', -0.08, m.hipY + 0.06, 1], ['#4fb35a', -0.03, m.hipY - 0.08, 1.4], ['#8a62c4', 0.1, m.hipY + 0.04, 1], ['#e2473b', 0.04, m.hipY - 0.11, 1.5]];
  for (const [c, x, y, k] of splat) {
    const zz = y < m.hipY ? m.td / 2 + 0.04 + (m.hipY - y) * 0.25 : m.td / 2 + 0.004;
    parts.push(rot(box(0.05 * k, 0.04 * k, 0.012, c, x, y, zz), y < m.hipY ? -0.25 : 0, 0, x * 3));
  }
  parts.push(box(0.012, 0.05, 0.05, '#3d7fd6', m.tw / 2 + 0.003, m.hipY + 0.1, 0.03), box(0.012, 0.04, 0.04, '#e2473b', -m.tw / 2 - 0.003, m.hipY + 0.16, -0.02));
  // short curly black hair
  parts.push(...hairCap(m, HAIR, { back: 0.75, sides: 0.65, top: 0.22, fringe: 0.12 }));
  for (const [x, y, z] of [[0.13, -0.16, -0.06], [-0.13, -0.16, -0.06], [0.08, -0.2, -0.13], [-0.08, -0.2, -0.13], [0, -0.17, -0.15]]) parts.push(ball(0.065, HAIR, x, m.headTop + y, z, 0));
  // red beret, tilted, with a little stem
  parts.push(pv(0.02, m.headTop + 0.01, -0.01, 0.05, 0, -0.2,
    scl(sph(0.185, BERET, 0, 0, 0, 12, 6), 1, 0.3, 1),
    cyl(0.012, 0.012, 0.05, 5, '#a82a2c', 0, 0.04, 0),
  ));
  // paintbrush raised in the right hand
  const hr = hands.R;
  parts.push(
    stick([hr[0], hr[1] - 0.06, hr[2] - 0.03], [hr[0] + 0.02, hr[1] + 0.2, hr[2] + 0.06], 0.012, 0.012, C.woodLight, 5),
    stick([hr[0] + 0.02, hr[1] + 0.18, hr[2] + 0.055], [hr[0] + 0.022, hr[1] + 0.22, hr[2] + 0.07], 0.016, 0.016, '#c0c4c8', 5),
    stick([hr[0] + 0.022, hr[1] + 0.22, hr[2] + 0.07], [hr[0] + 0.024, hr[1] + 0.28, hr[2] + 0.09], 0.02, 0.006, '#3d7fd6', 5),
  );
  // palette in the left hand with dabs of paint
  const hl = hands.L;
  const px = hl[0] - 0.06, py = hl[1] + 0.02, pz = hl[2] + 0.06;
  parts.push(
    rot(scl(cyl(0.14, 0.14, 0.022, 12, '#d9a466', px, py, pz), 1, 1, 0.75), 0.25, 0, 0.15),
  );
  for (const [c, dx, dz] of [['#e2473b', -0.07, 0.02], ['#3d7fd6', -0.02, 0.07], ['#f7cf3b', 0.05, 0.06], ['#4fb35a', 0.08, 0.0], [C.white, -0.05, -0.05]]) {
    parts.push(rot(ball(0.026, c, px + dx, py + 0.03 + dx * 0.1, pz + dz * 0.75 - dz * 0.2, 0), 0, 0, 0));
  }
  return group(parts, p.arms);
}

const NPCS = { rosa, theo, mabel, kip, hank, juno };
function npc(id = 'rosa') {
  return (NPCS[id] || rosa)();
}

registerBuilders({ pig, bee, goat, npc });
