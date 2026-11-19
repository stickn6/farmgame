// Pure camera helpers for the turn & tilt controls (no DOM, no three.js: Node tests them).
// Yaw/pitch are radians; see CAMERA in config.js for the numbers.
import { CAMERA } from './config.js';

const TAU = Math.PI * 2;
const BASE_MIN_DIST = 7; // closest zoom at normal tilt

// angle into [-π, π)
export function wrapPi(a) {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}

// Which way things turn on screen (y down): yaw growing turns the farm clockwise, as do a clockwise
// two-finger twist, Q and the 🧭 pad's ↻; ↺ and E turn it anticlockwise. Each pad arrow turns the farm
// the way it points, so the pad and the twist agree (spec §1.7 had ↺ = +1, the camera's turn: changed).
export const PAD_TURN = { left: -1, right: +1 }; // the pad's ↺ / ↻ cells → stepYaw dir

// The 🧭 needle's rotation in degrees (SVG, clockwise positive): it turns with the farm, like a map's compass
export function needleDeg(yaw) {
  return ((yaw - CAMERA.yaw0) * 180) / Math.PI;
}

// One 90° step along the iso diagonals (π/4 + k·π/2). From a diagonal it moves one step; from in between
// (after a free twist) it goes to the next diagonal in that direction. dir +1 = Q / ↻ (the farm turns
// clockwise on screen), −1 = E / ↺.
export function stepYaw(yaw, dir) {
  const g = (yaw - CAMERA.yaw0) / CAMERA.yawStep;
  const r = Math.round(g);
  const k = Math.abs(g - r) < 0.02 ? r + dir : dir > 0 ? Math.ceil(g) : Math.floor(g);
  return CAMERA.yaw0 + k * CAMERA.yawStep;
}

// The next tilt level strictly above (dir > 0) or below p; clamps at the ends.
export function nextPitch(p, dir) {
  const { steps, min, max } = CAMERA.pitch;
  const eps = 0.005;
  if (dir > 0) return steps.find((s) => s > p + eps) ?? max;
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i] < p - eps) return steps[i];
  return min;
}

// The Home yaw nearest to yaw (never spins several turns to get back)
export function homeYaw(yaw) {
  return CAMERA.yaw0 + TAU * Math.round((yaw - CAMERA.yaw0) / TAU);
}

// The 45° view yaw is close to (within CAMERA.snap), or null
export function nearestSnap(yaw) {
  const q = Math.PI / 4;
  const s = Math.round(yaw / q) * q;
  return Math.abs(yaw - s) <= CAMERA.snap ? s : null;
}

// The closest zoom allowed at this tilt (a low camera stays out of the roofs)
export function minDistFor(pitch) {
  return pitch < CAMERA.lowPitch ? CAMERA.lowMinDist : BASE_MIN_DIST;
}

// The yaw at which the view sits at Home (±0.02) with the default tilt
export function isHome(yaw, pitch) {
  return Math.abs(yaw - homeYaw(yaw)) <= 0.02 && Math.abs(pitch - CAMERA.pitch.def) <= 0.01;
}

// Two-finger twist. st: { angle0, dist0, yaw0, engaged, offset } (set on the second finger's down: the angle
// and distance between the fingers, and the yaw then). a, b: the two pointers ({ x, y }, CSS px).
// It engages once the fingers turned ≥ engage while the pinch scale stayed small (|ln(d/d0)| < maxScale), so a
// pinch never turns; from there the farm turns 1:1 with the fingers (minus the engage angle: no jump) and stays
// engaged. Screen y points down, so fingers turning clockwise (Δ > 0) turn the farm clockwise: yaw grows.
// The turn is summed move by move, so twisting past 180° keeps going instead of wrapping. → { engaged, yaw }
export function twistUpdate(st, a, b) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  if (st.prev == null) { st.prev = st.angle0; st.turned = 0; }
  st.turned += wrapPi(ang - st.prev);
  st.prev = ang;
  const delta = st.turned;
  if (!st.engaged) {
    const { engage, maxScale } = CAMERA.twist;
    if (Math.abs(delta) < engage || Math.abs(Math.log(d / Math.max(1, st.dist0))) >= maxScale) return { engaged: false, yaw: st.yaw0 };
    st.engaged = true;
    st.offset = Math.sign(delta) * engage;
  }
  return { engaged: true, yaw: st.yaw0 + (delta - st.offset) };
}
