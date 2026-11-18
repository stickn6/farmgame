// Headless economy / pacing simulator.
// Drives the real Game rules (src/game/state.js) with a fake clock and a greedy bot,
// and reports how long it takes to reach each level and each unlock.
// The beginner profile instead follows the in-game guide (planStep → SimUI, tools/simui.mjs).
//
//   npm run sim                  -> active + casual + guided beginner reports
//   node tools/sim.mjs --hours 48 --profile active
//   node tools/sim.mjs --profile beginner --seeds 9
//   node tools/sim.mjs --profile engaged --seed 3 --features off   (v4's Post / album / charm turned off, for an A/B)
import { Game } from '../src/game/state.js';
import * as CFG from '../src/game/config.js';
import { GuideFollower } from './simui.mjs';

const { CROPS, ANIMALS, RECIPES, OBJECTS, ITEMS, STORAGE, ACHIEVEMENTS, VISITORS, PROJECTS, QUESTS, ALBUM } = CFG;
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : null).filter(Boolean));

// -------------------------------------------------------------------- bot
export class Bot {
  constructor(game, opts = {}) {
    this.g = game;
    this.opts = opts;
    this.log = [];
    this.leaks = { xp: 0, materials: 0 }; // XP / building materials that v4 claims paid (must stay 0)
  }

  // a v4 claim (parcel, album page, ribbons) with a check that it paid no XP and no building materials
  claim(fn) {
    const g = this.g;
    const mats = () => Object.entries(g.s.inventory).reduce((n, [i, q]) => n + (ITEMS[i]?.cat === 'material' ? q : 0), 0);
    const xp0 = g.s.xp, m0 = mats();
    const r = fn();
    this.leaks.xp += g.s.xp - xp0;
    this.leaks.materials += mats() - m0;
    return r;
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
    // daily gift, the Post, album pages and ribbons (no tap budget, like the daily) + achievements; bots never
    // place gifts, decorate or gild (their Charm is the starter decor)
    if (g.dailyStatus().canClaim) g.claimDaily();
    if (g.postStatus().ready) this.claim(() => g.claimPost());
    for (const id of g.albumPagesReady()) this.claim(() => g.claimAlbumPage(id));
    if (typeof g.claimRibbons === 'function' && g.charmStatus?.()?.ready) this.claim(() => g.claimRibbons());
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

// features: v4's { post, album, charm } flags (--features off turns them all off, for an A/B)
export const FEATURES_OFF = { post: false, album: false, charm: false };

export function run({ profile = 'active', hours = 24, seed = 1, features = undefined } = {}) {
  let t = START;
  const start = t;
  seedRandom(seed);
  const g = new Game({ clock: () => t, storage: null, features });
  const bot = new Bot(g);
  const levelAt = { 1: 0 };
  const unlockAt = {};
  const mins = () => (t - start) / 60000;
  g.on('levelup', ({ level }) => { levelAt[level] = mins(); });
  // v4: when each parcel was opened, each keepsake found and each album page claimed (minutes), plus a ledger at
  // every day boundary (coins earned, the Post's coin value paid, v4 gems) for the per-day budget lines
  const v4 = { parcels: [], keepsakes: [], pages: {}, launchAt: null, allAt: null, days: [] };
  g.on('post', (r) => { v4.parcels.push({ at: mins(), n: r.n, kind: r.kind }); });
  g.on('keepsake', () => { v4.keepsakes.push(mins()); });
  g.on('albumPage', (r) => { v4.pages[r.id] = mins(); if (r.launch) v4.launchAt = mins(); if (r.title === ALBUM.all.title) v4.allAt = mins(); });
  const ledger = () => {
    const p = g.granted.post || {}, a = g.granted.album || {}, c = g.granted.charm || {};
    return { earned: g.stat('coinsEarned'), post: (p.coins || 0) + (p.itemValue || 0), gems: (p.gems || 0) + (a.gems || 0), ribbonGems: c.gems || 0 };
  };
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
  v4.days.push(ledger());
  while (t < end) {
    // ~0.4s per tap-level action => ~12 actions per 5s tick
    if (playing(t)) { bot.step(STEP / 400); activeMs += STEP; }
    t += STEP;
    if ((t - start) % 86400000 === 0) v4.days.push(ledger());
  }
  v4.leaks = bot.leaks;
  for (const [id, c] of Object.entries(CROPS)) unlockAt['crop:' + id] = levelAt[c.level];
  for (const [id, a] of Object.entries(ANIMALS)) unlockAt['animal:' + id] = levelAt[a.level];
  for (const [id, o] of Object.entries(OBJECTS)) if (o.level < 99 && o.kind !== 'decor') unlockAt['obj:' + id] = levelAt[o.level];
  for (const [id, r] of Object.entries(RECIPES)) unlockAt['recipe:' + id] = levelAt[Math.max(r.level || 1, OBJECTS[r.building].level)];
  for (const [id, p] of Object.entries(PROJECTS)) unlockAt['project:' + id] = levelAt[p.level];
  return { g, levelAt, unlockAt, activeMin: activeMs / 60000, v4, profile, hours };
}

// v4 numbers of a bot run over days [from, to) (whole simulated days; d0 = the first 24 h): parcels a day, the
// Post's coin value as a share of the coins earned, and new gems a day (Post + album pages; ribbons apart)
export function v4Window(r, from = 2, to = Infinity) {
  const d = r.v4.days;
  const hi = Math.min(to, d.length - 1);
  if (hi <= from) return null;
  const a = d[from], b = d[hi], days = hi - from;
  const parcels = r.v4.parcels.filter((p) => p.at >= from * 1440 && p.at < hi * 1440).length;
  const earned = b.earned - a.earned;
  return { from, to: hi, days, parcels, perDay: parcels / days, coinShare: earned ? (b.post - a.post) / earned : 0, gemsPerDay: (b.gems - a.gems) / days, ribbonGemsPerDay: (b.ribbonGems - a.ribbonGems) / days };
}

// Guided beginner (§7.2): a new farm that does exactly what the guide points at, through SimUI's fake
// HUD, at 4 s per tap, 3 s per new Mabel line (double for first-time UI) and 6 s per level-up modal.
// It plays the scripted goals, then keeps following the endless goals until L10 for the level timeline.
// Times are in minutes; longestGap (s) is between reward events in the first 30 min.
export function runBeginner({ seed = 1, maxMin = 180, features = undefined } = {}) {
  let t = START;
  seedRandom(seed);
  const g = new Game({ clock: () => t, storage: null, features });
  // parcel #1: when it was opened, by which step (its stepKey, else its key) and during which goal
  let act = null, parcel1 = null;
  const isAct = (s) => !!s && (s.kind === 'ui' || s.kind === 'world');
  g.on('post', (r) => { if (r.n === 0 && !parcel1) parcel1 = { at: (t - START) / 60000, step: act?.stepKey || act?.key || '?', goal: g.currentQuest().id }; });
  const f = new GuideFollower(g, {
    advance: (sec) => { t += sec * 1000; },
    onStep: (s) => { act = s.why === 'interrupt' || isAct(s) ? s : isAct(s.meanwhile) ? s.meanwhile : null; },
  });
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
    seed, g, levelAt, deadEnds, safetyNet, listDone, parcel1,
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
const mmss = (m) => { if (m == null || !Number.isFinite(m)) return '—'; const sec = Math.round(m * 60); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const features = args.features === 'off' ? FEATURES_OFF : undefined;
const v4On = !features;

function reportBeginner(seeds) {
  console.log(`\n=== GUIDED BEGINNER, following the guide at 4 s/tap, seeds 1–${seeds}${features ? ' (v4 features off)' : ''} ===`);
  const runs = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const b = runBeginner({ seed, features });
    runs.push(b);
    const ch = [1, 2, 3].map((c) => `Ch${c} ${fmtMin(b.chapters[c])}`).join(' · ');
    const lv = Array.from({ length: 9 }, (_, i) => `L${i + 2} ${fmtMin(b.levelAt[i + 2])}`).join(' ');
    console.log(`seed ${seed}: ${ch} | ${lv}`);
    console.log(`        reward gap ${b.longestGap}s (at ${fmtMin(b.gapAt)}) · idle ${Math.round(b.idleShare * 100)}% · silo 90% at ${fmtMin(b.firstSiloFull)} · ${b.taps} taps · dead ends ${b.deadEnds.length} · safety net ${b.safetyNet}`);
    if (v4On) console.log(`        parcel #1 at ${mmss(b.parcel1?.at)} (${b.parcel1 ? `${b.parcel1.step}, goal ${b.parcel1.goal}` : 'not opened'}) · ${b.g.stat('parcels')} parcels · ${b.g.stat('keepsakes')} keepsakes`);
    if (args.dump) console.log('        goals:', b.quests.map((q) => `${q.id}@${q.at}`).join(' '));
  }
  const med = (fn) => median(runs.map(fn));
  const ch = [1, 2, 3].map((c) => `Ch${c} ${fmtMin(med((b) => b.chapters[c]))}`).join(' · ');
  const lv = Array.from({ length: 9 }, (_, i) => `L${i + 2} ${fmtMin(med((b) => b.levelAt[i + 2]))}`).join(' ');
  console.log(`median: ${ch} | ${lv}`);
  console.log(`        reward gap ${med((b) => b.longestGap)}s (worst ${Math.max(...runs.map((b) => b.longestGap))}s) · idle ${Math.round(med((b) => b.idleShare) * 100)}% · silo 90% at ${fmtMin(med((b) => b.firstSiloFull))}`);
  if (v4On) console.log(`        parcel #1 at ${mmss(med((b) => b.parcel1?.at))} (${mmss(Math.min(...runs.map((b) => b.parcel1?.at ?? Infinity)))}–${mmss(Math.max(...runs.map((b) => b.parcel1?.at ?? Infinity)))})`);
  return runs;
}

// v4 lines of a bot run: the Post (first five parcels, then per day on days 2+: parcels, coin share, new gems),
// the album (keepsakes, pages, launch / all 12), ribbons once Prettiest Farm exists, and what the claims leaked
function reportV4(r) {
  const { g, v4 } = r;
  if (!v4On) { console.log('v4: features off (no Post, album or charm)'); return; }
  const w = v4Window(r, 2, 30); // the spec's budget window (days 2–30)
  const tail = w
    ? `${w.perDay.toFixed(2)}/day on days 2–${w.to}, coin share ${(w.coinShare * 100).toFixed(1)}%, new gems ${w.gemsPerDay.toFixed(1)}/day`
    : `coin value 🪙${(g.granted.post?.coins || 0) + (g.granted.post?.itemValue || 0)} (${(((g.granted.post?.coins || 0) + (g.granted.post?.itemValue || 0)) / Math.max(1, g.stat('coinsEarned')) * 100).toFixed(2)}% of coins earned), 💎${(g.granted.post?.gems || 0) + (g.granted.album?.gems || 0)} new gems`;
  const n = v4.parcels.length, first = v4.parcels.slice(0, 5).map((p) => fmt(p.at)).join(' ');
  console.log(`post: ${n ? `${n} parcel${n > 1 ? 's' : ''} (${n > 1 ? `#1–#${Math.min(5, n)}` : '#1'} at ${first})` : 'no parcels opened'} · ${tail}`);
  const pages = ALBUM.pages.map((p, i) => (v4.pages[p.id] != null ? `${i + 1}@${fmt(v4.pages[p.id])}` : null)).filter(Boolean).join(' ');
  console.log(`album: ${v4.keepsakes.length} keepsakes (${v4.keepsakes.filter((m) => m <= 480).length} in the first 8 h) · pages claimed ${pages || 'none'}`
    + `${v4.launchAt != null ? ` · launch album @${fmt(v4.launchAt)}` : ''}${v4.allAt != null ? ` · all 12 @${fmt(v4.allAt)}` : ''}`);
  if (g.features.charm && typeof g.charmStatus === 'function') {
    const c = g.charmStatus();
    console.log(`charm: 💗${c.total} · ribbon rank ${g.s.charm.ranks}${w ? ` · ribbon gems ${w.ribbonGemsPerDay.toFixed(1)}/day on days 2–${w.to}` : ''} (bots don't decorate)`);
  }
  console.log(`v4 claims paid ${v4.leaks.xp} XP and ${v4.leaks.materials} building materials`);
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
  const r = run({ profile, hours, seed: +(args.seed || 1), features });
  const { g, levelAt, unlockAt } = r;
  console.log(`\n=== ${profile.toUpperCase()} player, ${hours}h simulated (${fmt(r.activeMin)} actually playing)${args.seed ? `, seed ${args.seed}` : ''}${features ? ', v4 features off' : ''} ===`);
  console.log(`final level ${g.s.level}, coins ${g.s.coins}, gems ${g.s.gems}, fields ${Object.keys(g.s.soil).length}/${g.plotCap()}, animals ${g.s.animals.length}, buildings ${g.s.objects.filter((o) => !['decor', 'tree'].includes(OBJECTS[o.type].kind)).length}, trees ${g.s.objects.filter((o) => OBJECTS[o.type].kind === 'tree').length}, land ${g.s.landSize}, storage ${JSON.stringify(g.s.storage)}, visitors served ${g.stat('visitors')}, orders ${g.s.stats.orders}`);
  const lv = Object.entries(levelAt).map(([l, m]) => `L${l}@${fmt(m)}`);
  console.log('levels:', lv.join('  '));
  const ul = Object.entries(unlockAt).sort((a, b) => (a[1] ?? 1e9) - (b[1] ?? 1e9)).map(([k, m]) => `${k}@${fmt(m)}`);
  console.log('unlocks:', ul.join('  '));
  if (args.dump) dump(g);
  const lastUnlock = Math.max(...Object.values(unlockAt).map((m) => (m == null ? Infinity : m)));
  console.log('everything unlocked at:', Number.isFinite(lastUnlock) ? fmt(lastUnlock) : 'not within simulated time');
  reportV4(r);
  return r;
}

const hours = +(args.hours || 24);
const isMain = process.argv[1] && process.argv[1].endsWith('sim.mjs');
const results = {};
if (isMain && (!args.profile || args.profile === 'active')) results.active = report('active', Math.min(hours, +(args.activeHours || 6)));
if (isMain && (!args.profile || args.profile === 'casual')) results.casual = report('casual', +(args.casualHours || 24 * 14));
// (60 days: long enough to see the album's launch (pages 1–8) and all 12 pages)
if (isMain && (args.profile === 'engaged' || args.check)) results.engaged = report('engaged', +(args.engagedHours || 24 * 60));
if (isMain && args.profile === 'light') results.light = report('light', +(args.lightHours || 24 * 40));
// the beginner's visitors and orders are random, so it runs several seeds and the checks use every seed
// (or the median, for the one goal that waits on random visitors)
if (isMain && (!args.profile || args.profile === 'beginner' || args.check)) results.beginner = reportBeginner(Math.max(1, +(args.seeds || 5)));

// v4 guardrails: no XP or materials from any v4 reward, the Post's schedule, the album (and ribbons) never finished
// absurdly early, the beginner's parcel #1 inside Chapter 1, and static config checks.
function v4Checks({ active: Ar, engaged: Er, beginner: B = [] }) {
  const out = [];
  // N2: XP and building materials paid by v4 claims (measured around every bot claim) and grant()'s own tallies
  const tallies = (g) => Object.values(g.granted).reduce((n, t) => n + (t.xp || 0) + (t.materials || 0) + Object.keys(t.items || {}).filter((i) => ITEMS[i]?.cat === 'material').length, 0);
  const leaks = [Ar, Er].filter(Boolean).reduce((n, r) => n + r.v4.leaks.xp + r.v4.leaks.materials + tallies(r.g), 0) + B.reduce((n, b) => n + tallies(b.g), 0);
  const claims = [Ar, Er].filter(Boolean).reduce((n, r) => n + r.v4.parcels.length + Object.keys(r.v4.pages).length, 0);
  out.push(['v4: parcels, album pages and ribbons pay no XP and no building materials (active, engaged, beginner)', leaks === 0, `${leaks} over ${claims} bot claims`]);
  // N3: the active bot opens #1–#5 at 5 m, 15 m, 30 m, 1 h, 4 h (± 5 s); engaged opens about 2 a day after that
  if (Ar) {
    const want = [5, 15, 30, 60, 240], got = Ar.v4.parcels.slice(0, 5).map((p) => p.at);
    out.push(['v4: the active bot opens parcels #1–#5 at 5 m, 15 m, 30 m, 1 h and 4 h (± 5 s)', got.length === 5 && got.every((m, i) => Math.abs(m - want[i]) <= 5 / 60), got.map(fmt).join(' ')]);
  }
  const w = Er && v4Window(Er, 2, 30);
  if (Er) out.push(['v4: engaged opens 1.8–2.2 parcels a day on days 2–30', !!w && w.perDay >= 1.8 && w.perDay <= 2.2, w ? `${w.perDay.toFixed(2)}/day on days 2–${w.to}` : '—']);
  // N4 / N5 (engaged, days 2–30): the Post's coins and goods stay a small top-up, and new gems stay modest
  if (Er) out.push(['v4: engaged Post coins + goods ≤ 4% of coins earned, new gems ≤ 7 a day (days 2–30)', !!w && w.coinShare <= 0.04 && w.gemsPerDay <= 7, w ? `${(w.coinShare * 100).toFixed(1)}% · 💎${w.gemsPerDay.toFixed(1)}/day` : '—']);
  // N8: parcel #1 is opened at about 5 min, inside Chapter 1, on every beginner seed
  if (B.length) {
    const ok = B.every((b) => b.parcel1 && b.parcel1.at >= 5 && b.parcel1.at <= 6.5 && b.chapters[1] != null && b.parcel1.at < b.chapters[1]);
    out.push(['v4: beginner opens parcel #1 at 5:00–6:30, before Chapter 1 ends (every seed)', ok, B.map((b) => mmss(b.parcel1?.at)).join(' ')]);
  }
  // N7 (single seed): the album is never filled absurdly early
  if (Ar) out.push(['v4: the active bot finds ≤ 16 keepsakes in 8 h of non-stop play', Ar.v4.keepsakes.filter((m) => m <= 480).length <= 16, `${Ar.v4.keepsakes.filter((m) => m <= 480).length}`]);
  if (Er) {
    const L = Er.v4.launchAt, all = Er.v4.allAt, end = Er.hours * 60;
    out.push(['v4: engaged completes album pages 1–8 between day 15 and day 35', L != null && L >= 15 * 1440 && L <= 35 * 1440, fmt(L)]);
    out.push([`v4: engaged completes all 12 album pages no sooner than day 35${end >= 60 * 1440 ? ' and by day 60' : ''}`, all == null ? end < 60 * 1440 : all >= 35 * 1440 && all <= 60 * 1440, all == null ? `not in ${fmt(end)}` : fmt(all)]);
    if (Er.g.features.charm && typeof Er.g.charmStatus === 'function') {
      out.push(['charm: the engaged bot (no decorating) never reaches ribbon rank 10', (Er.g.s.charm?.ranks || 0) < 10, `rank ${Er.g.s.charm?.ranks || 0}`]);
    }
  }
  // N6: no coins or goods in the welcome parcels #1–#4 (the coin-gated anti-rush window stays untouched)
  const probe = new Game({ clock: () => START, storage: null });
  const early = [0, 1, 2, 3].flatMap((n) => [1, 5, 10, 20].map((L) => probe.postContents(n, L))).filter((c) => c.coins > 0 || Object.keys(c.items).length);
  out.push(['v4: welcome parcels #1–#4 hold no coins and no goods', early.length === 0, early.length ? early.map((c) => `#${c.n + 1}`).join(' ') : null]);
  // N10: the levels past 30 that hold album pages (and gilding) unlock something
  out.push(['levels 31, 35, 37 and 39 unlock something (album pages)', [31, 35, 37, 39].every((l) => CFG.unlocksAtLevel(l).length)]);
  return out;
}

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
    // v4 (the Post, the album, ribbons): single seed, kept simple
    ...(v4On ? v4Checks(results) : []),
  ];
  if (!v4On) console.log('\n(v4 features off: the v4 checks are skipped)');
  console.log('\n=== PACING CHECKS ===');
  let bad = 0;
  for (const [name, ok, value] of checks) { console.log(ok ? '  ✓' : '  ✗', name + (value != null ? `  [${value}]` : '')); if (!ok) bad++; }
  process.exit(bad ? 1 : 0);
}
