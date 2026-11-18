// Headless economy / pacing simulator.
// Drives the real Game rules (src/game/state.js) with a fake clock and a greedy bot,
// and reports how long it takes to reach each level and each unlock.
// The beginner profile instead follows the in-game guide (planStep → SimUI, tools/simui.mjs).
//
//   npm run sim                  -> active + casual + guided beginner reports
//   node tools/sim.mjs --hours 48 --profile active
//   node tools/sim.mjs --profile beginner --seeds 9
import { Game } from '../src/game/state.js';
import * as CFG from '../src/game/config.js';
import { GuideFollower } from './simui.mjs';

const { CROPS, ANIMALS, RECIPES, OBJECTS, ITEMS, STORAGE, ACHIEVEMENTS, VISITORS, PROJECTS, QUESTS } = CFG;
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : null).filter(Boolean));

// -------------------------------------------------------------------- bot
export class Bot {
  constructor(game, opts = {}) {
    this.g = game;
    this.opts = opts;
    this.log = [];
  }

  unlocked(level) { return this.g.s.level >= level; }

  // Real players need time to tap: each action spends part of the tick's budget.
  act(cost = 1) {
    if (this.budget < cost) return false;
    this.budget -= cost;
    return true;
  }

  // What items are wanted right now (orders + animal food + recipe inputs), with weights
  demand() {
    const g = this.g, want = {};
    const add = (i, n) => { want[i] = (want[i] || 0) + n; };
    for (const o of g.s.orders) if (!o.waitUntil) for (const [i, n] of Object.entries(o.items)) add(i, n);
    for (const v of g.s.visitors || []) add(v.item, v.qty);
    if (g.s.wagon && g.s.wagon.state === 'here') for (const c of g.s.wagon.crates) if (!c.filled) add(c.item, c.qty);
    for (const id of Object.keys(PROJECTS)) { if (g.s.level < PROJECTS[id].level) continue; const n = g.projectNeeds(id); if (n) for (const [i, q] of Object.entries(n.items)) add(i, Math.min(q, 4)); }
    for (const a of g.s.animals) { const f = g.animalFood(a.type); if (f) add(f.item, f.qty * 2); }
    for (const o of g.s.objects) {
      if (OBJECTS[o.type].kind !== 'factory') continue;
      for (const [rid, r] of Object.entries(RECIPES)) if (r.building === o.type && (!r.level || r.level <= g.s.level)) for (const [i, n] of Object.entries(r.inputs)) add(i, n);
    }
    // subtract what we hold
    for (const i of Object.keys(want)) want[i] = Math.max(0, want[i] - g.count(i));
    return want;
  }

  bestCrop(want) {
    const g = this.g;
    let best = null, bestScore = -Infinity;
    for (const [id, c] of Object.entries(CROPS)) {
      if (!this.unlocked(c.level) || g.s.coins < c.seedCost) continue;
      const value = ITEMS[id].price * c.yield - c.seedCost;
      let score = (value * 0.6 + c.xp * 3) / c.growTime;
      if (want[id]) score *= 3; // needed by orders/animals/factories
      if (score > bestScore) { bestScore = score; best = id; }
    }
    return best;
  }

  findSpot(type) {
    const g = this.g;
    const lo = g.landLo(), hi = g.landHi();
    for (let z = lo; z <= hi; z++) for (let x = lo; x <= hi; x++) if (g.canPlace(type, x, z, 0)) return [x, z];
    return null;
  }

  step(budget = Infinity) {
    const g = this.g;
    this.budget = budget;
    // claim quests
    while (g.questDone()) g.claimQuest();
    // harvest
    for (const k of Object.keys(g.s.soil)) {
      const [x, z] = k.split(',').map(Number);
      const s = g.s.soil[k];
      if (s.crop && g.cropStage(s.crop) === 3 && this.act()) g.harvest(x, z);
    }
    // fruit trees
    for (const o of [...g.s.objects]) {
      if (OBJECTS[o.type].kind !== 'tree') continue;
      const st = g.treeState(o);
      if (st === 'ready' && this.act()) g.harvestTree(o);
      else if (st === 'dead' && this.act(2)) g.removeObject(o.id);
    }
    // daily gift + achievements
    if (g.dailyStatus().canClaim) g.claimDaily();
    for (const a of ACHIEVEMENTS) while (g.achievementStatus(a).ready) g.claimAchievement(a.id);
    // animals & factories
    // one tap on a pen collects everything ready and feeds everyone we have food for
    for (const o of g.s.objects) {
      const d = OBJECTS[o.type];
      if (d.kind === 'pen') {
        const list = g.animalsIn(o.id);
        const food = g.animalFood(d.animal);
        const needs = list.some((a) => g.animalState(a) === 'ready') ||
          list.some((a) => g.animalState(a) === 'hungry' && (!food || g.count(food.item) >= food.qty));
        if (needs && this.act(1.5)) {
          for (const a of list) g.collectAnimal(a);
          for (const a of list) if (g.animalState(a) === 'hungry') g.feedAnimal(a);
        }
      } else if (d.kind === 'factory' && o.jobs.some((j) => j.endAt <= g.now()) && this.act(1.5)) g.collectFactory(o);
    }
    // orders
    for (const o of [...g.s.orders]) if (!o.waitUntil && g.hasItems(o.items) && this.act(4)) g.fulfillOrder(o.id);
    // orders that need things we can't make soon get discarded once they've been around a while
    g.ensureOrders();
    for (const v of [...(g.s.visitors || [])]) {
      if (g.count(v.item) >= v.qty && this.act(3)) g.serveVisitor(v.id);
      else if (g.now() - v.arrivedAt > 3 * 3600000 && this.act(1)) g.dismissVisitor(v.id); // stuck request
    }
    // chores, wagon, projects
    if (g.s.chores) g.s.chores.list.forEach((c, i) => { if (!c.claimed && c.progress >= c.count && this.act(1)) g.claimChore(i); });
    if (g.s.wagon && g.s.wagon.state === 'here') g.s.wagon.crates.forEach((c, i) => { if (!c.filled && g.count(c.item) >= c.qty && this.act(2)) g.fillCrate(i); });
    for (const id of Object.keys(PROJECTS)) {
      if (g.s.level < PROJECTS[id].level) continue;
      const n = g.projectNeeds(id);
      if (!n) continue;
      for (const [i, q] of Object.entries(n.items)) if (q > 0 && g.count(i) > 0 && this.act(1)) g.contribute(id, i, q);
      if (n.coins > 0 && g.s.coins > n.coins + 5000 && this.act(1)) g.contribute(id, 'coins', n.coins);
    }
    this.manageStorage();
    // production: keep queues busy with the most valuable affordable recipe
    for (const o of g.s.objects) {
      const def = OBJECTS[o.type];
      if (def.kind !== 'factory') continue;
      const want = this.demand();
      while (o.jobs.length < g.queueSize(o)) {
        const opts = Object.entries(RECIPES).filter(([, r]) => r.building === o.type && (!r.level || r.level <= g.s.level) && g.hasItems(r.inputs))
          .sort((a, b) => ((want[b[0]] ? 1e6 : 0) + ITEMS[b[0]].price) - ((want[a[0]] ? 1e6 : 0) + ITEMS[a[0]].price));
        if (!opts.length || !this.act(3)) break;
        if (!g.startRecipe(o, opts[0][0])) break;
        if (want[opts[0][0]]) want[opts[0][0]]--;
      }
    }
    // buy buildings / animals / land
    this.invest();
    // plant
    const want = this.demand();
    for (const k of Object.keys(g.s.soil)) {
      const [x, z] = k.split(',').map(Number);
      if (g.s.soil[k].crop) continue;
      const c = this.bestCrop(want);
      if (!c || !this.act()) break;
      if (g.plant(x, z, c)) want[c] = Math.max(0, (want[c] || 0) - CROPS[c].yield);
    }
    // sell surplus raw goods nobody needs when cash-poor
    if (g.s.coins < 50) {
      const keep = this.demand();
      for (const [i, n] of Object.entries(g.s.inventory)) {
        const extra = n - (keep[i] || 0) - 6;
        if (extra > 0) g.sell(i, extra);
      }
    }
  }

  manageStorage() {
    const g = this.g;
    for (const sid of Object.keys(STORAGE)) {
      const up = g.nextStorageUpgrade(sid);
      if (up && g.hasItems(up.items) && g.s.coins >= up.coins + 50) g.upgradeStorage(sid);
      const cap = g.storageCap(sid), used = g.storageUsed(sid);
      if (used < cap * 0.85) continue;
      // sell the least-needed, non-material items down to ~65%
      const want = this.demand();
      const items = Object.entries(g.s.inventory).filter(([i]) => g.storageOf(i) === sid && ITEMS[i].cat !== 'material')
        .sort((a, b) => ((want[a[0]] || 0) - (want[b[0]] || 0)) || (ITEMS[a[0]].price - ITEMS[b[0]].price));
      let over = used - Math.floor(cap * 0.65);
      for (const [i, n] of items) {
        if (over <= 0) break;
        const keep = Math.min(n, want[i] || 0);
        const q = Math.min(n - keep, over);
        if (q > 0) { g.sell(i, q); over -= q; }
      }
    }
  }

  invest() {
    const g = this.g;
    const reserve = 30;
    // one of each building first (pens before factories), then a second pen if useful
    const order = Object.entries(OBJECTS).filter(([, d]) => d.kind === 'pen' || d.kind === 'factory').sort((a, b) => a[1].level - b[1].level);
    for (const [type, d] of order) {
      if (!this.unlocked(d.level)) continue;
      const owned = g.s.objects.filter((o) => o.type === type).length;
      const want = d.kind === 'factory' ? 1 : 2;
      if (owned >= Math.min(want, g.objectLimit(type))) continue;
      if (owned >= 1 && d.kind === 'pen') {
        // only build a 2nd pen once the first is full
        const full = g.s.objects.filter((o) => o.type === type).every((o) => g.animalsIn(o.id).length >= g.homeCapacity(o));
        if (!full) continue;
      }
      const cost = g.objectCost(type);
      if (g.s.coins < cost + reserve || (d.items && !g.hasItems(d.items))) continue;
      const spot = this.findSpot(type);
      if (spot) g.placeObject(type, spot[0], spot[1], 0);
    }
    for (const [type, a] of Object.entries(ANIMALS)) {
      if (!this.unlocked(a.level)) continue;
      while (g.findHomeFor(type) && g.s.coins >= g.animalCost(type) + reserve) { if (!g.buyAnimal(type)) break; }
    }
    // extra production slots (coins, once the level allows)
    for (const o of g.s.objects) {
      if (OBJECTS[o.type].kind !== 'factory') continue;
      const c = g.extraSlotCost(o);
      if (c && g.s.level >= c.level && g.s.coins >= c.coins * 1.5) g.buyExtraSlot(o);
    }
    // a few fruit trees
    for (const [type, d] of Object.entries(OBJECTS)) {
      if (d.kind !== 'tree' || !this.unlocked(d.level)) continue;
      if (g.objectCount(type) >= 3 || g.s.coins < g.objectCost(type) + 150) continue;
      const spot = this.findSpot(type);
      if (spot && this.act(2)) g.placeObject(type, spot[0], spot[1], 0);
    }
    const e = g.nextExpansion();
    if (e && g.s.level >= e.level && g.s.coins >= e.coins + 100 && g.hasItems(e.items || {})) g.expandLand();
    // more fields: keep ~coins buffer, cap by plowCost if the game has one
    const fields = Object.keys(g.s.soil).length;
    const maxFields = Math.min(this.opts.maxFields || 200, g.plotCap());
    if (fields < maxFields) {
      const lo = g.landLo(), hi = g.landHi();
      let added = 0;
      for (let z = lo; z <= hi && added < 4; z++) for (let x = lo; x <= hi && added < 4; x++) {
        if (g.plotCount() >= g.plotCap()) return;
        const cost = g.plowCost();
        if (g.s.coins < cost + reserve + 10) return;
        if (!g.s.soil[x + ',' + z] && !g.objectAt(x, z) && !this.act()) return;
        if (g.plow(x, z)) added++;
      }
    }
  }
}

// -------------------------------------------------------------------- runner
const START = Date.UTC(2026, 0, 1, 8, 0, 0);

// deterministic Math.random for reproducibility (the same generator the guide tests use)
function seedRandom(seed) {
  let s = seed >>> 0;
  Math.random = () => { s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

export function run({ profile = 'active', hours = 24, seed = 1 } = {}) {
  let t = START;
  const start = t;
  seedRandom(seed);
  const g = new Game({ clock: () => t, storage: null });
  const bot = new Bot(g);
  const levelAt = { 1: 0 };
  const unlockAt = {};
  g.on('levelup', ({ level }) => { levelAt[level] = (t - start) / 60000; });
  const STEP = 5000;
  // casual: 4 sessions/day of 8 minutes (08:00, 12:30, 18:00, 21:30), offline otherwise
  // engaged: 25-min first session, then 4 × 10 min/day; light: 15-min first session, then 2 × 8 min/day
  const PROFILES = {
    casual: { first: 8, sessions: [[8 * 60, 8], [12 * 60 + 30, 8], [18 * 60, 8], [21 * 60 + 30, 8]] },
    engaged: { first: 25, sessions: [[8 * 60, 10], [12 * 60 + 30, 10], [18 * 60, 10], [21 * 60 + 30, 10]] },
    light: { first: 15, sessions: [[8 * 60, 8], [19 * 60, 8]] },
  };
  const P = PROFILES[profile];
  const playing = (ms) => {
    if (profile === 'active') return true;
    const sinceStart = (ms - start) / 60000;
    if (sinceStart < P.first) return true;
    const mm = (Math.floor(sinceStart % 1440) + 8 * 60) % 1440;
    return sinceStart > 60 && P.sessions.some(([a, d]) => mm >= a && mm < a + d);
  };
  const end = start + hours * 3600000;
  let activeMs = 0;
  while (t < end) {
    // ~0.4s per tap-level action => ~12 actions per 5s tick
    if (playing(t)) { bot.step(STEP / 400); activeMs += STEP; }
    t += STEP;
  }
  for (const [id, c] of Object.entries(CROPS)) unlockAt['crop:' + id] = levelAt[c.level];
  for (const [id, a] of Object.entries(ANIMALS)) unlockAt['animal:' + id] = levelAt[a.level];
  for (const [id, o] of Object.entries(OBJECTS)) if (o.level < 99 && o.kind !== 'decor') unlockAt['obj:' + id] = levelAt[o.level];
  for (const [id, r] of Object.entries(RECIPES)) unlockAt['recipe:' + id] = levelAt[Math.max(r.level || 1, OBJECTS[r.building].level)];
  for (const [id, p] of Object.entries(PROJECTS)) unlockAt['project:' + id] = levelAt[p.level];
  return { g, levelAt, unlockAt, activeMin: activeMs / 60000 };
}

// Guided beginner (§7.2): a new farm that does exactly what the guide points at, through SimUI's fake
// HUD, at 4 s per tap, 3 s per new Mabel line (double for first-time UI) and 6 s per level-up modal.
// It plays the scripted goals, then keeps following the endless goals until L10 for the level timeline.
// Times are in minutes; longestGap (s) is between reward events in the first 30 min.
export function runBeginner({ seed = 1, maxMin = 180 } = {}) {
  let t = START;
  seedRandom(seed);
  const g = new Game({ clock: () => t, storage: null });
  const f = new GuideFollower(g, { advance: (sec) => { t += sec * 1000; } });
  const r = f.run({ maxSec: maxMin * 60, until: (gg) => gg.s.quest.index >= QUESTS.length });
  const listDone = g.s.quest.index >= QUESTS.length;
  const levelAt = { 1: 0, ...r.levels };
  const deadEnds = [...r.deadEnds];
  let safetyNet = r.safetyNet;
  if (listDone && g.s.level < 10) {
    const off = r.minutes;
    const more = f.run({ maxSec: (maxMin - off) * 60, until: (gg) => gg.s.level >= 10 });
    for (const [l, m] of Object.entries(more.levels)) levelAt[l] ??= +(off + m).toFixed(2);
    for (const d of more.deadEnds) deadEnds.push({ ...d, at: +(off + d.at).toFixed(2) });
    safetyNet += more.safetyNet;
  }
  return {
    seed, g, levelAt, deadEnds, safetyNet, listDone,
    chapters: r.chapters, quests: r.quests, longestGap: r.longestGap, gapAt: r.gapAt,
    idleShare: r.minutes ? r.idleSec / 60 / r.minutes : 0, firstSiloFull: r.firstSiloFull, taps: r.taps, listMin: r.minutes,
  };
}

const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const fmtMin = (m) => (m == null || !Number.isFinite(m) ? '—' : `${m.toFixed(1)}m`);

function reportBeginner(seeds) {
  console.log(`\n=== GUIDED BEGINNER, following the guide at 4 s/tap, seeds 1–${seeds} ===`);
  const runs = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const b = runBeginner({ seed });
    runs.push(b);
    const ch = [1, 2, 3].map((c) => `Ch${c} ${fmtMin(b.chapters[c])}`).join(' · ');
    const lv = Array.from({ length: 9 }, (_, i) => `L${i + 2} ${fmtMin(b.levelAt[i + 2])}`).join(' ');
    console.log(`seed ${seed}: ${ch} | ${lv}`);
    console.log(`        reward gap ${b.longestGap}s (at ${fmtMin(b.gapAt)}) · idle ${Math.round(b.idleShare * 100)}% · silo 90% at ${fmtMin(b.firstSiloFull)} · ${b.taps} taps · dead ends ${b.deadEnds.length} · safety net ${b.safetyNet}`);
    if (args.dump) console.log('        goals:', b.quests.map((q) => `${q.id}@${q.at}`).join(' '));
  }
  const med = (fn) => median(runs.map(fn));
  const ch = [1, 2, 3].map((c) => `Ch${c} ${fmtMin(med((b) => b.chapters[c]))}`).join(' · ');
  const lv = Array.from({ length: 9 }, (_, i) => `L${i + 2} ${fmtMin(med((b) => b.levelAt[i + 2]))}`).join(' ');
  console.log(`median: ${ch} | ${lv}`);
  console.log(`        reward gap ${med((b) => b.longestGap)}s (worst ${Math.max(...runs.map((b) => b.longestGap))}s) · idle ${Math.round(med((b) => b.idleShare) * 100)}% · silo 90% at ${fmtMin(med((b) => b.firstSiloFull))}`);
  return runs;
}

export function dump(g) {
  const st = Object.keys(STORAGE).map((id) => `${id} ${g.storageUsed(id)}/${g.storageCap(id)}`).join(', ');
  console.log('  storage:', st);
  console.log('  inventory:', JSON.stringify(g.s.inventory));
  console.log('  orders:', JSON.stringify(g.s.orders.map((o) => o.waitUntil ? 'wait' : o.items)));
  console.log('  visitors:', JSON.stringify((g.s.visitors || []).map((v) => [v.item, v.qty])));
  const crops = {};
  for (const s of Object.values(g.s.soil)) crops[s.crop ? s.crop.type : 'empty'] = (crops[s.crop ? s.crop.type : 'empty'] || 0) + 1;
  console.log('  fields:', JSON.stringify(crops), 'coins', g.s.coins);
}

const fmt = (m) => (m == null ? '—' : m < 90 ? `${m.toFixed(1)}m` : m < 60 * 48 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`);

function report(profile, hours) {
  const r = run({ profile, hours });
  const { g, levelAt, unlockAt } = r;
  console.log(`\n=== ${profile.toUpperCase()} player, ${hours}h simulated (${fmt(r.activeMin)} actually playing) ===`);
  console.log(`final level ${g.s.level}, coins ${g.s.coins}, gems ${g.s.gems}, fields ${Object.keys(g.s.soil).length}/${g.plotCap()}, animals ${g.s.animals.length}, buildings ${g.s.objects.filter((o) => !['decor', 'tree'].includes(OBJECTS[o.type].kind)).length}, trees ${g.s.objects.filter((o) => OBJECTS[o.type].kind === 'tree').length}, land ${g.s.landSize}, storage ${JSON.stringify(g.s.storage)}, visitors served ${g.stat('visitors')}, orders ${g.s.stats.orders}`);
  const lv = Object.entries(levelAt).map(([l, m]) => `L${l}@${fmt(m)}`);
  console.log('levels:', lv.join('  '));
  const ul = Object.entries(unlockAt).sort((a, b) => (a[1] ?? 1e9) - (b[1] ?? 1e9)).map(([k, m]) => `${k}@${fmt(m)}`);
  console.log('unlocks:', ul.join('  '));
  if (args.dump) dump(g);
  const lastUnlock = Math.max(...Object.values(unlockAt).map((m) => (m == null ? Infinity : m)));
  console.log('everything unlocked at:', Number.isFinite(lastUnlock) ? fmt(lastUnlock) : 'not within simulated time');
  return r;
}

const hours = +(args.hours || 24);
const isMain = process.argv[1] && process.argv[1].endsWith('sim.mjs');
const results = {};
if (isMain && (!args.profile || args.profile === 'active')) results.active = report('active', Math.min(hours, +(args.activeHours || 6)));
if (isMain && (!args.profile || args.profile === 'casual')) results.casual = report('casual', +(args.casualHours || 24 * 14));
if (isMain && (args.profile === 'engaged' || args.check)) results.engaged = report('engaged', +(args.engagedHours || 24 * 24));
if (isMain && args.profile === 'light') results.light = report('light', +(args.lightHours || 24 * 40));
// the beginner's visitors and orders are random, so it runs several seeds and the checks use every seed
// (or the median, for the one goal that waits on random visitors)
if (isMain && (!args.profile || args.profile === 'beginner' || args.check)) results.beginner = reportBeginner(Math.max(1, +(args.seeds || 5)));

// --check: pacing guardrails from the design panel (fail CI if a balance change breaks pacing)
if (isMain && args.check) {
  const A = results.active?.levelAt || {}, E = results.engaged?.levelAt || {};
  const B = results.beginner || [];
  const at = (x) => (x == null ? Infinity : x);
  const worst = (fn) => Math.max(...B.map((b) => at(fn(b))));
  const best = (fn) => Math.min(...B.map((b) => at(fn(b))));
  const span = (fn) => `${fmtMin(best(fn))}–${fmtMin(worst(fn))}`;
  const listMedian = median(B.map((b) => (b.listDone ? b.chapters[3] : Infinity)));
  const deadEnds = B.reduce((n, b) => n + b.deadEnds.length, 0);
  const checks = [
    ['active: L6 within 15 min', A[6] != null && A[6] <= 15, fmt(A[6])],
    ['active: L10 between 45 and 100 min', A[10] != null && A[10] >= 45 && A[10] <= 100, fmt(A[10])],
    ['active: L15 between 2.5h and 5h', A[15] != null && A[15] >= 150 && A[15] <= 300, fmt(A[15])],
    ['active: nobody unlocks everything in 8h of non-stop play', !(A[30] != null && A[30] < 8 * 60), fmt(A[30])],
    ['active: L5 no sooner than 6.5 min (anti-rush)', A[5] != null && A[5] >= 6.5, fmt(A[5])],
    ['active: L7 no sooner than 18 min (anti-rush)', A[7] != null && A[7] >= 18, fmt(A[7])],
    ['active: L10 no sooner than 52 min (anti-rush)', A[10] != null && A[10] >= 52, fmt(A[10])],
    ['engaged: L30 between day 13 and day 24', E[30] != null && E[30] >= 13 * 1440 && E[30] <= 24 * 1440, fmt(E[30])],
    ['every level 2..30 unlocks something', Array.from({ length: 29 }, (_, i) => i + 2).every((l) => CFG.unlocksAtLevel(l).length)],
    ['beginner: Chapter 1 complete within 10 min (every seed)', B.length && worst((b) => b.chapters[1]) <= 10, span((b) => b.chapters[1])],
    ['beginner: L4 within 8 min (every seed)', B.length && worst((b) => b.levelAt[4]) <= 8, span((b) => b.levelAt[4])],
    ['beginner: L6 between 13 and 25 min (every seed)', B.length && best((b) => b.levelAt[6]) >= 13 && worst((b) => b.levelAt[6]) <= 25, span((b) => b.levelAt[6])],
    ['beginner: L7 within 35 min (every seed)', B.length && worst((b) => b.levelAt[7]) <= 35, span((b) => b.levelAt[7])],
    ['beginner: longest reward gap in the first 30 min ≤ 180 s (every seed)', B.length && worst((b) => b.longestGap) <= 180, `${worst((b) => b.longestGap)}s`],
    ['beginner: no planner dead-ends over 30 s (every seed)', B.length && deadEnds === 0, `${deadEnds}`],
    ['beginner: all scripted goals within 90 min (median seed)', B.length && listMedian <= 90, `${fmtMin(listMedian)}, seeds ${span((b) => (b.listDone ? b.chapters[3] : null))}`],
  ];
  console.log('\n=== PACING CHECKS ===');
  let bad = 0;
  for (const [name, ok, value] of checks) { console.log(ok ? '  ✓' : '  ✗', name + (value != null ? `  [${value}]` : '')); if (!ok) bad++; }
  process.exit(bad ? 1 : 0);
}
