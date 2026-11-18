// Pure layout helpers for smart taps and placement: no rendering, no DOM.
// Each takes the Game model and only reads it, except plantPatch, which plants through
// game.plant() so every normal rule, quest and event still applies.
import { OBJECTS, CROPS, TUTORIAL } from './config.js';

// kinds that need a clear 1-tile ring (paths) around them
const BUILDINGS = new Set(['house', 'storage', 'special', 'pen', 'factory']);
const CORE_TYPES = new Set(['farmhouse', 'orderboard', 'storagebarn', 'silo']);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (x, z) => x + ',' + z;
const parse = (k) => k.split(',').map(Number);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mean = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
// centre of a w×d footprint whose corner tile is (x, z), in tile coordinates
const centre = (x, z, w, d) => [x + (w - 1) / 2, z + (d - 1) / 2];

// ---------------------------------------------------------------- patches
// The 4-connected patch of soil around (x, z) whose tiles satisfy pred(soil, x, z), at most `max`
// tiles, ordered by BFS distance, then z, then x. The origin is always searched from (so a tile
// harvested a moment ago still finds its neighbours) but only listed when it matches.
export function patchTiles(game, x, z, pred, max = TUTORIAL.patchMax) {
  if (!game.soilAt(x, z) || max <= 0) return [];
  const ok = (tx, tz) => { const soil = game.soilAt(tx, tz); return !!soil && !!pred(soil, tx, tz); };
  const out = ok(x, z) ? [[x, z]] : [];
  const seen = new Set([key(x, z)]);
  let layer = [[x, z]];
  while (layer.length && out.length < max) {
    const next = [];
    for (const [cx, cz] of layer) {
      for (const [dx, dz] of N4) {
        const nx = cx + dx, nz = cz + dz, k = key(nx, nz);
        if (seen.has(k)) continue;
        seen.add(k);
        if (ok(nx, nz)) next.push([nx, nz]);
      }
    }
    next.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const t of next) if (out.length < max) out.push(t);
    layer = next;
  }
  return out;
}

// Plant `crop` on the empty patch at (x, z), at most `cap` tiles. Stops before coins run short,
// so they never go negative. Returns the planted tiles in order.
export function plantPatch(game, x, z, crop, cap = TUTORIAL.patchMax) {
  const c = CROPS[crop];
  if (!c || !game.isUnlocked('crops', crop)) return [];
  const planted = [];
  for (const [tx, tz] of patchTiles(game, x, z, (soil) => !soil.crop, cap)) {
    if (game.s.coins < c.seedCost) {
      if (!planted.length) game.emit('toast', { text: 'Not enough coins for seeds!', type: 'bad' });
      break;
    }
    if (game.plant(tx, tz, crop)) planted.push([tx, tz]);
  }
  return planted;
}

// ---------------------------------------------------------------- placement
// The farm's centre of gravity: farmhouse, order board, barn, silo and the field's centroid.
export function farmCore(game) {
  const pts = [];
  for (const o of game.s.objects) {
    if (!CORE_TYPES.has(o.type)) continue;
    const [w, d] = game.objSize(o.type, o.rot);
    pts.push(centre(o.x, o.z, w, d));
  }
  const soil = Object.keys(game.s.soil).map(parse);
  if (soil.length) pts.push(mean(soil));
  if (!pts.length) { const c = (game.landLo() + game.landHi()) / 2; return [c, c]; }
  return mean(pts);
}

// how many of {a field, a building} the 1-tile ring around a footprint touches (0..2)
function ringBusy(game, x, z, w, d) {
  let soil = 0, bld = 0;
  for (let i = -1; i <= w; i++) {
    for (let j = -1; j <= d; j++) {
      if (i >= 0 && i < w && j >= 0 && j < d) continue;
      const tx = x + i, tz = z + j;
      if (game.soilAt(tx, tz)) soil = 1;
      const o = game.objectAt(tx, tz);
      if (o && BUILDINGS.has(OBJECTS[o.type]?.kind)) bld = 1;
    }
  }
  return soil + bld;
}

// Where a new `type` should start: the valid spot closest to the farm core (and to `near`,
// e.g. the camera target, given as [x, z] or {x, z}). A ring touching a field or a building
// costs 10 each for pens and workshops (they keep their paths clear) and 3 each for decor and
// trees (they may sit closer, but leave room for the field to grow).
// Lowest score wins; ties go to lower z, then lower x. Returns { x, z, rot } or null.
export function smartSpot(game, type, rot = 0, near = null) {
  const def = OBJECTS[type];
  if (!def) return null;
  const [w, d] = game.objSize(type, rot);
  const core = farmCore(game);
  const nearP = near ? (Array.isArray(near) ? near : [near.x, near.z]) : null;
  const penalty = def.kind === 'decor' || def.kind === 'tree' ? 3 : 10;
  const lo = game.landLo(), hi = game.landHi();
  let best = null, bestScore = Infinity;
  for (let z = lo; z <= hi; z++) {
    for (let x = lo; x <= hi; x++) {
      if (!game.canPlace(type, x, z, rot)) continue;
      const c = centre(x, z, w, d);
      const score = dist(c, core) + (nearP ? 0.4 * dist(c, nearP) : 0) + penalty * ringBusy(game, x, z, w, d);
      if (score < bestScore - 1e-9) { bestScore = score; best = { x, z, rot }; }
    }
  }
  return best;
}

// ---------------------------------------------------------------- plowing
// Up to n grass tiles (never more than the field cap allows) that grow the field neatly:
// 4-adjacent to soil, keeping a 1-tile path around buildings. Filling the field's bounding
// box comes first, then growing along its longer side. Ties: larger x, then smaller z.
// Each pick counts as soil for the next one, so the picks stay one connected patch.
export function suggestPlowSpots(game, n = 2) {
  const room = Math.max(0, Math.min(n, game.plotCap() - game.plotCount()));
  const blocked = new Set();
  for (const o of game.s.objects) {
    if (!BUILDINGS.has(OBJECTS[o.type]?.kind)) continue;
    const [w, d] = game.objSize(o.type, o.rot);
    for (let i = -1; i <= w; i++) for (let j = -1; j <= d; j++) blocked.add(key(o.x + i, o.z + j));
  }
  const field = new Set(Object.keys(game.s.soil));
  const free = (x, z) => game.inLand(x, z) && !game.objectAt(x, z) && !field.has(key(x, z)) && !blocked.has(key(x, z));
  const better = (s, x, z, b) => !b || s < b.s - 1e-9 || (Math.abs(s - b.s) < 1e-9 && (x > b.x || (x === b.x && z < b.z)));
  const picks = [];
  while (picks.length < room) {
    let b = null;
    if (field.size) {
      const tiles = [...field].map(parse);
      const xs = tiles.map((t) => t[0]), zs = tiles.map((t) => t[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const longX = maxX - minX >= maxZ - minZ;
      for (const [fx, fz] of tiles) {
        for (const [dx, dz] of N4) {
          const x = fx + dx, z = fz + dz;
          if (!free(x, z)) continue;
          const inX = x >= minX && x <= maxX, inZ = z >= minZ && z <= maxZ;
          const s = inX && inZ ? 0 : 1 + ((longX ? inZ : inX) ? 0 : 0.5);
          if (better(s, x, z, b)) b = { s, x, z };
        }
      }
    } else {
      // no field at all: start one near the farm core
      const core = farmCore(game);
      for (let z = game.landLo(); z <= game.landHi(); z++) {
        for (let x = game.landLo(); x <= game.landHi(); x++) {
          if (free(x, z) && better(dist([x, z], core), x, z, b)) b = { s: dist([x, z], core), x, z };
        }
      }
    }
    if (!b) break;
    picks.push([b.x, b.z]);
    field.add(key(b.x, b.z));
  }
  return picks;
}
