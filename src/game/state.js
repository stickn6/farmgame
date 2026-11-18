// Game model: pure data + rules, no rendering. Emits events the view/UI listen to.
// Everything numeric comes from config.js so balancing never touches this file.
import {
  MAP_SIZE, START_LAND, LAND_STEP, LAND, PLOTS, STORAGE, DROPS, GEMS, DAILY, ACHIEVEMENTS, MASTERY, VISITORS, QUEUE_SLOTS,
  CHORES, WAGON, PROJECTS, PROJECT_REWARD, MAX_CROP_SPEEDUP, xpToNext,
  ITEMS, CROPS, ANIMALS, RECIPES, OBJECTS, QUESTS, REPEAT_QUESTS, ORDERS, START,
  xpForLevel, producibleItems, levelUpReward,
  CHAPTERS, QUEST_MIGRATION_V3, V2_QUEST_COUNT, GUIDE, TUTORIAL, FEATURE_TIPS, tutorialTile, POST, ALBUM, KEEPSAKES, CHARM,
} from './config.js';
import * as layout from './layout.js';

const SAVE_KEY = 'sunny-acres-save-v1';
const BACKUP_KEY = 'sunny-acres-save-v1-backup';

// What v1 (the first release) had unlocked at each level, and its crop timers —
// used to grandfather unlocks and keep ripe crops ripe when migrating old saves.
const V1 = {
  crops: { wheat: [1, 20], carrot: [1, 45], corn: [3, 90], sunflower: [5, 150], tomato: [6, 200], strawberry: [7, 300], pumpkin: [9, 420] },
  animals: { chicken: 2, cow: 4, sheep: 6 },
  recipes: { bread: 3, cookie: 3, pie: 3, butter: 5, cheese: 5, sweater: 7 },
};
const SAVE_VERSION = 4;
const MODES = ['guided', 'coached', 'independent']; // the tutorial only ever moves forward
const DAY_MS = 86400000;
const MIN_MS = 60000;
const HOUR_MS = 3600000;
// dev builds, tests and the sim: a reward that would pay building materials (or XP) throws; a production build skips it
const STRICT = typeof window === 'undefined' || !!import.meta.env?.DEV;
// the Post: ms from opening parcel n−1 (or the farm's start) until parcel n is ready
export const postGap = (n) => (POST.gaps[n] ?? POST.every) * 1000;
// Game.now() for a save that isn't loaded yet: a clock set back more than 5 min is pinned to when the save was last seen
const nowFor = (s, t) => (s && s.lastSeen && t < s.lastSeen - 300000 ? s.lastSeen : t);
// the save's own RNG (mulberry32 state, uint32), seeded from when the farm was made
const seedRng = (createdAt) => ((createdAt ^ 0x9e3779b9) >>> 0) || 1;

// A pantry parcel's good (pure): of the recipes unlocked at least a level ago that cost at most half of V, the
// priciest (ties: the earlier recipe); as many as fit in V (≤ pantryMaxQty). → { id, price, qty } | null
export function pantryPick(L, V) {
  let best = null;
  for (const [id, r] of Object.entries(RECIPES)) {
    if (Math.max(r.level || 0, OBJECTS[r.building].level) > L - 1) continue;
    const price = ITEMS[id].price;
    if (price > V / 2 || (best && price <= best.price)) continue;
    best = { id, price };
  }
  return best ? { ...best, qty: Math.min(POST.pantryMaxQty, Math.floor(V / best.price)) } : null;
}

// "Rosa's pantry parcel", "a postcard from Theo", "Big parcel": what the HUD says is coming (kind and sender only)
export function postTeaser(c) {
  const npc = VISITORS.npcs.find((x) => x.id === c.sender);
  const who = POST.short[c.sender] || npc?.name || 'Grandma Mabel';
  const face = npc?.icon || '👵';
  const k = POST.kinds[c.kind] || POST.kinds.welcome;
  const label = c.kind === 'big' ? `${k.icon} ${k.label}`
    : c.kind === 'office' ? `${k.icon} ${k.label}`
      : c.kind === 'postcard' ? `${face} a postcard from ${who}`
        : c.kind === 'welcome' ? `${face} a parcel from ${who}`
          : `${face} ${who}'s ${k.label.toLowerCase()}`;
  return { kind: c.kind, sender: c.sender, icon: c.kind === 'big' || c.kind === 'office' ? k.icon : face, label };
}

export class Emitter {
  constructor() { this.handlers = {}; }
  on(evt, fn) { (this.handlers[evt] ||= []).push(fn); return () => this.off(evt, fn); }
  off(evt, fn) { this.handlers[evt] = (this.handlers[evt] || []).filter((f) => f !== fn); }
  emit(evt, data) { for (const fn of this.handlers[evt] || []) fn(data); }
}

const key = (x, z) => x + ',' + z;
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pickWeighted = (list) => {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const x of list) { r -= x.weight; if (r <= 0) return x; }
  return list[list.length - 1];
};
// local calendar day number (for daily rewards)
const dayNumber = (ms) => { const d = new Date(ms); return Math.floor((ms - d.getTimezoneOffset() * 60000) / DAY_MS); };

export class Game extends Emitter {
  // opts.clock: () => ms timestamp (lets the simulator run at accelerated time)
  // opts.storage: localStorage-like object, or null to disable persistence
  // opts.features: { post, album, charm } (the sim's --features off A/B turns them off). With charm (Prettiest
  // Farm: charm, ribbons, gilding) off, a gilding voucher is paid as 💎15 instead.
  constructor(opts = {}) {
    super();
    this.features = { post: true, album: true, charm: true, ...(opts.features || {}) };
    // the charm memo (see charm()) follows every placed, removed or changed (gilded) object
    this._charmRev = 0;
    for (const e of ['objectAdded', 'objectRemoved', 'objectChanged']) this.on(e, () => this.charmChanged());
    this.granted = {}; // source → what grant() paid out this session (not saved): the sim and tests read it
    this.clock = opts.clock || (() => Date.now());
    this.storage = opts.storage !== undefined ? opts.storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    this.s = this.load() || this.newGame();
    this.rebuildOccupancy();
    // no safety net while loading: nobody listens yet, so Mabel's line would be lost (the first HUD tick pays it)
    this._booting = true;
    this.ensureOrders();
    this._booting = false;
    this._saveTimer = null;
  }

  now() {
    const t = this.clock();
    const seen = this.s && this.s.lastSeen;
    return seen && t < seen - 300000 ? seen : t;
  }

  // ------------------------------------------------------------ persistence
  blankState() {
    const now = this.now();
    return {
      version: SAVE_VERSION,
      coins: START.coins,
      gems: START.gems,
      xp: 0,
      level: 1,
      landSize: START_LAND,
      soil: {}, // "x,z" -> { crop: null | { type, plantedAt } }
      objects: [],
      animals: [],
      inventory: {},
      storage: Object.fromEntries(Object.keys(STORAGE).map((k) => [k, 0])), // upgrade levels
      orders: [],
      visitors: [],
      nextVisitorAt: now + VISITORS.firstDelay * 1000,
      quest: { index: 0, qid: QUESTS[0].id, progress: 0, notified: false }, // qid lets a reordered list heal the index
      daily: { lastDay: null, streak: 0 },
      achievements: {}, // id -> tiers claimed
      mastery: {}, // crop -> harvested count
      legacy: { crops: [], animals: [], recipes: [] }, // unlocks kept from v1 saves
      hearts: {}, // villager id -> friendship hearts
      visitorAway: {}, // villager id -> time they may visit again (after a dismiss)
      chores: null,
      wagon: null,
      projects: {}, // id -> { stage, given: { coins, items } }
      lastSeen: now,
      nextId: 1,
      stats: { harvested: 0, orders: 0 },
      // cam: the remembered turn & tilt ({ yaw, pitch }, null = Home); twist: two-finger turn on
      settings: { sound: true, music: true, hints: 'glow', tapHarvest: true, cam: null, twist: true },
      // LEGACY defaults (old saves get these via migrate's fill-in): no tour, no new-farm assists.
      // mode: 'guided' → 'coached' → 'independent'; reveal: 'all' or the HUD keys shown so far;
      // seen: one-time lines/tips/interrupts; net: when the safety net last paid out
      tutorial: { v: 1, mode: 'independent', startedAt: 0, seen: {}, reveal: 'all', freeFinishUsed: true, firstVisitorDone: true, net: 0, t: {} },
      gifts: [], // chapter-chest decor waiting to be placed (object types)
      // the Post: n parcels opened · nextAt: when the waiting parcel is/was ready · office: the one-off migration parcel
      // waits · notified: its postReady went out
      post: { n: 0, nextAt: now + postGap(0), lastAt: 0, office: false, notified: false },
      // Mabel's Keepsake Album: have: keepsake id → ms found · claimed: page id → ms · meter/primed: the find pity meter ·
      // fresh: found since last viewed · launch / all: the launch-album and all-pages prizes are paid
      album: { open: false, have: {}, claimed: {}, meter: 0, primed: false, fresh: [], launch: false, all: false },
      charm: { ranks: 0, vouchers: 0, titles: [] }, // Prettiest Farm (charm itself is derived from placed decor)
      rng: seedRng(now), // see rand()
      createdAt: now,
    };
  }

  newGame() {
    const now = this.now();
    const s = this.blankState();
    this.s = s;
    const lo = this.landLo();
    const addObj = (type, x, z) => s.objects.push({ id: s.nextId++, type, x, z, rot: 0, jobs: [], free: true });
    addObj('farmhouse', lo + 1, lo + 1);
    addObj('orderboard', lo + 5, lo + 1);
    addObj('storagebarn', lo + 1, lo + 5);
    addObj('silo', lo + 1, lo + 9);
    // a few starter decorations
    addObj('oak', lo + 1, lo + 12);
    addObj('oak', lo + 14, lo + 2);
    addObj('pine', lo + 13, lo + 13);
    addObj('flowers', lo + 4, lo + 3);
    addObj('flowers', lo + 4, lo + 1);
    addObj('bush', lo + 1, lo + 14);
    // starter field: two rows of wheat, all ripe so the very first tap harvests
    const ripe = Math.max(CROPS.wheat.growTime * 1000, 60000);
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 2; z++) {
        s.soil[key(lo + 6 + x, lo + 6 + z)] = { crop: { type: 'wheat', plantedAt: now - ripe } };
      }
    }
    // the farm has "gone a bit wild": weeds, stones and stumps to tidy up for a tiny reward
    for (const [type, dx, dz] of TUTORIAL.debris) {
      const [x, z] = tutorialTile([dx, dz]);
      s.objects.push({ id: s.nextId++, type, x, z, rot: 0, jobs: [] });
    }
    s.inventory = { ...START.inventory };
    // a new farm gets the guided tour and its once-per-save assists
    s.tutorial = { ...s.tutorial, mode: 'guided', startedAt: now, reveal: [], freeFinishUsed: false, firstVisitorDone: false };
    s.settings.hints = 'full';
    s.post.nextAt = s.createdAt + postGap(0); // parcel #1, 5 minutes in
    return s;
  }

  load() {
    try {
      if (!this.storage) return null;
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s.version !== 'number') return null;
      if (s.version < SAVE_VERSION) {
        try { this.storage.setItem(BACKUP_KEY, raw); } catch (e) { /* best effort */ }
      }
      return this.clampPost(this.migrate(s));
    } catch (e) {
      console.warn('Failed to load save', e);
      return null;
    }
  }

  // Bring older saves up to date without wiping progress.
  migrate(s) {
    if (s.version > SAVE_VERSION) return s;
    const blank = this.blankState();
    for (const [k, v] of Object.entries(blank)) if (s[k] === undefined) s[k] = v;
    for (const k of Object.keys(STORAGE)) if (s.storage[k] === undefined) s.storage[k] = 0;
    s.stats = { ...blank.stats, ...s.stats };
    s.settings = { ...blank.settings, ...s.settings };
    s.tutorial = { ...blank.tutorial, ...s.tutorial };
    for (const k of ['post', 'album', 'charm']) s[k] = { ...blank[k], ...s[k] };
    if (s.version < 2) {
      // v1 had no storage building: give one, next to the farmhouse if possible
      this.s = s;
      this.rebuildOccupancy();
      for (const st of Object.values(STORAGE)) {
        if (s.objects.some((o) => o.type === st.building)) continue;
        const spot = this.findFreeSpot(st.building);
        if (spot) { s.objects.push({ id: s.nextId++, type: st.building, x: spot[0], z: spot[1], rot: 0, jobs: [] }); this.rebuildOccupancy(); }
      }
      // v1 players had unlimited storage: make sure they start with room for what they own
      for (const id of Object.keys(STORAGE)) {
        while (s.storage[id] < STORAGE[id].maxLevel && this.storageUsed(id) > this.storageCap(id)) s.storage[id]++;
      }
      // never take levels away: keep the level and the same fraction of the XP bar
      const v1For = (L) => { let t = 0; for (let l = 1; l < L; l++) t += Math.round(12 * Math.pow(l, 1.55)); return t; };
      const frac = Math.max(0, Math.min(0.99, (s.xp - v1For(s.level)) / Math.max(1, v1For(s.level + 1) - v1For(s.level))));
      s.xp = xpForLevel(s.level) + Math.floor(frac * xpToNext(s.level));
      // grandfather anything v1 had unlocked at this level that now unlocks later
      s.legacy = { crops: [], animals: [], recipes: [] };
      for (const [id, [lvl]] of Object.entries(V1.crops)) if (s.level >= lvl && CROPS[id].level > s.level) s.legacy.crops.push(id);
      for (const [id, lvl] of Object.entries(V1.animals)) if (s.level >= lvl && ANIMALS[id].level > s.level) s.legacy.animals.push(id);
      for (const [id, lvl] of Object.entries(V1.recipes)) {
        const r = RECIPES[id];
        if (r && s.level >= lvl && Math.max(r.level || 0, OBJECTS[r.building].level) > s.level) s.legacy.recipes.push(id);
      }
      // crops: ripe under the old timers stay ripe; otherwise keep their progress fraction
      const now = this.now();
      for (const soil of Object.values(s.soil)) {
        const c = soil.crop;
        if (!c || !V1.crops[c.type]) continue;
        const oldT = V1.crops[c.type][1] * 1000, newT = CROPS[c.type].growTime * 1000;
        const frac = Math.min(1, (now - c.plantedAt) / oldT);
        c.plantedAt = now - frac * newT;
      }
      // v1 factories had 3 queue slots; the new base is 2, so keep their third slot
      for (const o of s.objects) if (OBJECTS[o.type]?.kind === 'factory') o.extraSlots = Math.max(o.extraSlots || 0, 1);
      // the scripted goal list changed: map the v1 position to the closest v2 goal
      const QMAP = [0, 0, 0, 0, 4, 4, 6, 7, 8, 13, 11, 12, 9, 14, 15, 17];
      const qi = s.quest?.index || 0;
      s.quest = { index: qi < QMAP.length ? QMAP[qi] : V2_QUEST_COUNT, progress: 0 };
      // a little welcome-back gift for veterans
      s.gems = (s.gems || 0) + 5 + s.level;
      s.version = 2;
    }
    if (s.version < 3) {
      // the scripted goal list was rewritten: map the v2 position to the same goal by id;
      // endless repeat goals keep their place in the rotation and their progress
      const q = s.quest || { index: 0, progress: 0 };
      const old = q.index || 0;
      if (old >= V2_QUEST_COUNT) {
        const index = QUESTS.length + (old - V2_QUEST_COUNT);
        if (q.snap && q.snap.index === old) q.snap.index = index;
        else delete q.snap;
        s.quest = { ...q, index, qid: this.qidFor(index) };
      } else {
        const id = QUEST_MIGRATION_V3[old];
        const index = Math.max(0, QUESTS.findIndex((x) => x.id === id));
        s.quest = { index, qid: QUESTS[index].id, progress: 0, notified: false };
      }
      // established farms skip the tour: coached (or on their own), everything visible
      const t = s.tutorial;
      t.mode = s.level >= 10 || s.quest.index >= QUESTS.length ? 'independent' : 'coached';
      t.reveal = 'all';
      t.seen = { ...t.seen, welcome: true };
      for (const k of TUTORIAL.ch1Lines) t.seen['line:' + k] = true;
      if (s.level >= 5) t.seen.siloFull = t.seen.barnFull = t.seen.firstDrop = true;
      if (s.level >= 6) t.seen.slot6 = true;
      if (s.level >= 7) t.seen.firstVisitor = true;
      for (const lvl of Object.keys(FEATURE_TIPS)) if (+lvl <= s.level) t.seen['tip:' + lvl] = true;
      s.version = 3;
    }
    if (s.version < 4) {
      // the Post: a young farm (a tour farm under 4 h old, L ≤ 6) gets the whole welcome; every other farm one
      // "Post office opening" parcel, waiting now (it doesn't advance n), then the 8-hour cycle
      const now = nowFor(s, this.clock());
      const created = s.createdAt || now;
      const t = s.tutorial;
      const young = s.level <= 6 && (t.startedAt || 0) > 0 && now - created < 4 * HOUR_MS;
      s.post = young
        ? { n: 0, nextAt: Math.max(now + MIN_MS, created + postGap(0)), lastAt: 0, office: false, notified: false }
        : { n: POST.welcome.length, nextAt: now, lastAt: 0, office: true, notified: false };
      s.rng = seedRng(created);
      // one "What's new" card (tip:whatsNew) for the farms that skip the welcome parcels
      if (!young) t.seen = { ...t.seen, 'whatsNew:pending': true };
      // the album pages / gilding tips of levels already reached never show
      for (const lvl of [31, 35, 37, 39]) if (s.level >= lvl) t.seen['tip:' + lvl] = true;
      s.version = 4;
    }
    this.healQuest(s);
    return s;
  }

  // Every load: a save written with the clock far ahead never locks the post out for days.
  clampPost(s) {
    const p = s?.post;
    if (!p || s.version > SAVE_VERSION) return s;
    const now = nowFor(s, this.clock());
    p.n = Math.max(0, Math.floor(p.n) || 0);
    if (!Number.isFinite(p.nextAt)) p.nextAt = now + postGap(p.n);
    p.nextAt = Math.min(p.nextAt, now + postGap(p.n) + 5 * MIN_MS);
    return s;
  }

  // quest.qid of a quest index: the scripted goal's id, or 'repeat:n' for the endless ones
  qidFor(index) {
    return index < QUESTS.length ? QUESTS[index].id : 'repeat:' + (index - QUESTS.length);
  }

  // Re-derive quest.index from quest.qid, so saves survive goals being added or reordered.
  healQuest(s) {
    const q = s.quest;
    if (!q) return;
    if (typeof q.qid !== 'string') { q.qid = this.qidFor(q.index || 0); return; }
    let index = -1;
    if (q.qid.startsWith('repeat:')) index = QUESTS.length + (parseInt(q.qid.slice(7), 10) || 0);
    else index = QUESTS.findIndex((x) => x.id === q.qid);
    if (index < 0 || index === q.index) return;
    if (q.snap && q.snap.index === q.index) q.snap.index = index;
    q.index = index;
  }

  save() {
    if (!this.storage || this.resetting) return;
    this.s.lastSeen = Math.max(this.s.lastSeen || 0, this.clock());
    if (this.s.quest) this.s.quest.qid = this.qidFor(this.s.quest.index);
    try { this.storage.setItem(SAVE_KEY, JSON.stringify(this.s)); } catch (e) { /* storage may be unavailable */ }
  }

  saveSoon() {
    if (!this.storage) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 800);
  }

  reset() {
    // pagehide/visibilitychange autosaves fire during reload — make sure they can't write the old farm back
    this.resetting = true;
    clearTimeout(this._saveTimer);
    if (this.storage) this.storage.removeItem(SAVE_KEY);
    if (typeof location !== 'undefined') location.reload();
  }

  // ------------------------------------------------------------ land / grid
  landLo() { return (MAP_SIZE - this.s.landSize) / 2; }
  landHi() { return this.landLo() + this.s.landSize - 1; }
  inLand(x, z) {
    const lo = this.landLo(), hi = this.landHi();
    return x >= lo && x <= hi && z >= lo && z <= hi;
  }

  objSize(type, rot = 0) {
    const [w, d] = OBJECTS[type].size;
    return rot % 2 ? [d, w] : [w, d];
  }

  rebuildOccupancy() {
    this.occ = new Map(); // "x,z" -> object id
    this.objById = new Map();
    for (const o of this.s.objects) {
      this.objById.set(o.id, o);
      const [w, d] = this.objSize(o.type, o.rot);
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) this.occ.set(key(o.x + i, o.z + j), o.id);
    }
  }

  objectAt(x, z) {
    const id = this.occ.get(key(x, z));
    return id ? this.objById.get(id) : null;
  }

  soilAt(x, z) { return this.s.soil[key(x, z)] || null; }

  canPlace(type, x, z, rot = 0, ignoreId = null) {
    const [w, d] = this.objSize(type, rot);
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < d; j++) {
        const tx = x + i, tz = z + j;
        if (!this.inLand(tx, tz)) return false;
        const occ = this.occ.get(key(tx, tz));
        if (occ && occ !== ignoreId) return false;
        if (this.s.soil[key(tx, tz)]) return false;
      }
    }
    return true;
  }

  findFreeSpot(type, rot = 0) {
    const lo = this.landLo(), hi = this.landHi();
    for (let z = lo; z <= hi; z++) for (let x = lo; x <= hi; x++) if (this.canPlace(type, x, z, rot)) return [x, z];
    return null;
  }

  // ------------------------------------------------------------ stats (achievements read these)
  bumpStat(name, n = 1) {
    this.s.stats[name] = (this.s.stats[name] || 0) + n;
    for (const a of ACHIEVEMENTS) if (a.stat === name) {
      const claimed = this.s.achievements[a.id] || 0;
      if (claimed < a.tiers.length && this.s.stats[name] >= a.tiers[claimed].goal && (this.s.stats[name] - n) < a.tiers[claimed].goal) {
        this.emit('achievementReady', a);
      }
    }
  }
  stat(name) { return this.s.stats[name] || 0; }

  // ------------------------------------------------------------ economy
  // earned=false for refunds & rewards, so they don't count toward "earn coins" goals
  addCoins(n, earned = true) {
    this.s.coins += n;
    if (n > 0 && earned) { this.progressQuest('earn', null, n); this.bumpStat('coinsEarned', n); }
    this.emit('coins', this.s.coins);
    this.saveSoon();
  }

  spend(n) {
    if (this.s.coins < n) { this.emit('toast', { text: 'Not enough coins!', type: 'bad' }); return false; }
    this.s.coins -= n;
    this.emit('coins', this.s.coins);
    return true;
  }

  addGems(n) {
    this.s.gems += n;
    this.emit('gems', this.s.gems);
    this.saveSoon();
  }

  spendGems(n) {
    if (this.s.gems < n) { this.emit('toast', { text: 'Not enough gems 💎', type: 'bad' }); return false; }
    this.s.gems -= n;
    this.emit('gems', this.s.gems);
    this.saveSoon();
    return true;
  }

  addXp(n) {
    if (n <= 0) return;
    this.s.xp += n;
    while (this.s.xp >= xpForLevel(this.s.level + 1)) {
      this.s.level++;
      const r = levelUpReward(this.s.level);
      this.s.coins += r.coins;
      this.s.gems += r.gems || 0;
      this.emit('levelup', { level: this.s.level, bonus: r.coins, gems: r.gems || 0 });
      this.emit('coins', this.s.coins);
      this.emit('gems', this.s.gems);
      this.checkQuest();
      this.ensureOrders();
    }
    this.emit('xp', this.s.xp);
    this.saveSoon();
  }

  // ------------------------------------------------------------ inventory + storage capacity
  // null = uncapped (building materials live in the toolshed and never clog storage)
  storageOf(item) {
    const cat = ITEMS[item].cat;
    for (const [id, st] of Object.entries(STORAGE)) if (st.cats.includes(cat)) return id;
    return null;
  }

  storageUsed(id) {
    let n = 0;
    for (const [item, c] of Object.entries(this.s.inventory)) if (this.storageOf(item) === id) n += c;
    return n;
  }

  storageCap(id) { return STORAGE[id].capacity(this.s.storage[id] || 0); }

  spaceFor(item) {
    const id = this.storageOf(item);
    return id ? this.storageCap(id) - this.storageUsed(id) : Infinity;
  }

  // true if n of item fits; emits a toast + storageFull event otherwise
  roomFor(item, n, quiet = false) {
    if (this.spaceFor(item) >= n) return true;
    if (!quiet) {
      const st = STORAGE[this.storageOf(item)];
      this.emit('toast', { text: `${st.icon} ${st.name} is full! Sell or use items, or upgrade it.`, type: 'bad' });
      this.emit('storageFull', this.storageOf(item));
    }
    return false;
  }

  addItem(item, n) {
    this.s.inventory[item] = (this.s.inventory[item] || 0) + n;
    if (this.s.inventory[item] <= 0) delete this.s.inventory[item];
    this.emit('inventory', this.s.inventory);
    this.saveSoon();
  }

  count(item) { return this.s.inventory[item] || 0; }

  hasItems(req) { return Object.entries(req).every(([i, n]) => this.count(i) >= n); }

  takeItems(req) {
    if (!this.hasItems(req)) return false;
    for (const [i, n] of Object.entries(req)) this.addItem(i, -n);
    return true;
  }

  sell(item, qty) {
    qty = Math.min(qty, this.count(item));
    if (qty <= 0) return 0;
    const earned = ITEMS[item].price * qty;
    this.addItem(item, -qty);
    this.addCoins(earned);
    this.emit('sold', { item, qty, earned });
    return earned;
  }

  // one-tap relief when storage is full: sell everything above `keep` of each item (never materials).
  // floors: { item: qty } to keep more of (what the current goal, an order or the animals need)
  sellExtras(id, keep = 10, floors = {}) {
    let earned = 0;
    for (const [item, n] of Object.entries(this.s.inventory)) {
      const k = Math.max(keep, floors[item] || 0);
      if (this.storageOf(item) !== id || n <= k) continue;
      earned += this.sell(item, n - k);
    }
    return earned;
  }

  // next tier for a storage: { tier, capacity, coins, items, xp, needLevel, locked }
  nextStorageUpgrade(id) {
    const lvl = this.s.storage[id] || 0;
    const st = STORAGE[id];
    if (lvl >= st.maxLevel) return null;
    const u = st.upgrade(lvl);
    return { ...u, needLevel: u.level, locked: this.s.level < u.level, capacity: st.capacity(lvl + 1), tier: lvl + 1 };
  }

  upgradeStorage(id) {
    const up = this.nextStorageUpgrade(id);
    if (!up) return false;
    if (up.locked) { this.emit('toast', { text: `Reach level ${up.needLevel} for the next upgrade`, type: 'bad' }); return false; }
    if (this.s.coins < up.coins) { this.emit('toast', { text: 'Not enough coins!', type: 'bad' }); return false; }
    if (!this.hasItems(up.items)) { this.emit('toast', { text: 'Missing building materials', type: 'bad' }); return false; }
    this.spend(up.coins);
    this.takeItems(up.items);
    this.s.storage[id] = up.tier;
    this.addXp(up.xp || 5);
    this.emit('storageUpgraded', { id, level: up.tier });
    this.progressQuest('storage', id, 1);
    this.saveSoon();
    return true;
  }

  // Rare building-material drops. Chance is proportional to the XP an action earned
  // (so spamming quick crops can't farm materials faster than you progress), with a
  // pity meter that guarantees a drop eventually. Orders/visitors have a flat chance.
  rollDrop(source, xp = 0) {
    if (this.s.level < DROPS.minLevel) return null;
    let chance;
    if (DROPS.flat[source] != null) chance = DROPS.flat[source];
    else {
      const d = DROPS.divisor(this.s.level);
      this.s.dropMeter = (this.s.dropMeter || 0) + xp;
      chance = Math.min(DROPS.maxChance, xp / d);
      if (this.s.dropMeter >= DROPS.pity * d) chance = 1;
    }
    if (Math.random() >= chance) return null;
    if (DROPS.flat[source] == null) this.s.dropMeter = 0;
    const item = this.pickMaterial();
    this.addItem(item, 1);
    this.bumpStat('materials');
    this.emit('drop', { item, source });
    return item;
  }

  // Half of drops are whatever you're shortest of for your next upgrade/expansion.
  pickMaterial() {
    if (Math.random() < DROPS.neededShare) {
      const need = {};
      for (const id of Object.keys(STORAGE)) {
        const up = this.nextStorageUpgrade(id);
        if (up && this.s.level >= up.needLevel - 2) for (const [i, n] of Object.entries(up.items)) need[i] = Math.max(need[i] || 0, n - this.count(i));
      }
      const e = this.nextExpansion();
      if (e && this.s.level >= e.level - 2) for (const [i, n] of Object.entries(e.items)) need[i] = Math.max(need[i] || 0, n - this.count(i));
      const best = Object.entries(need).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0];
      if (best) return best[0];
    }
    const table = DROPS.table.filter((x) => x.level <= this.s.level);
    return pickWeighted(table).item;
  }

  // ------------------------------------------------------------ plots
  plotCount() { return Object.keys(this.s.soil).length; }
  plotCap() { return PLOTS.cap(this.s.level); }
  plowCost() { return PLOTS.cost(this.plotCount()); }

  // ------------------------------------------------------------ crops
  cropTime(type) {
    const bonus = Math.min(MAX_CROP_SPEEDUP, MASTERY.speedBonus * this.masteryStars(type) + this.perk('cropSpeed', 0));
    return CROPS[type].growTime * 1000 * (1 - bonus);
  }

  cropProgress(crop, now = this.now()) {
    return Math.min(1, (now - crop.plantedAt) / this.cropTime(crop.type));
  }

  cropReadyAt(crop) { return crop.plantedAt + this.cropTime(crop.type); }

  cropStage(crop, now = this.now()) {
    const p = this.cropProgress(crop, now);
    if (p >= 1) return 3;
    if (p >= 0.6) return 2;
    if (p >= 0.25) return 1;
    return 0;
  }

  plow(x, z) {
    if (!this.inLand(x, z) || this.occ.has(key(x, z)) || this.s.soil[key(x, z)]) return false;
    if (this.plotCount() >= this.plotCap()) {
      this.emit('toast', { text: `Field limit reached (${this.plotCap()}). Level up for more plots!`, type: 'bad' });
      return false;
    }
    const cost = this.plowCost();
    if (cost > 0 && !this.spend(cost)) return false;
    this.s.soil[key(x, z)] = { crop: null };
    this.emit('soil', { x, z, cost });
    this.progressQuest('plow', null, 1);
    this.saveSoon();
    return true;
  }

  // unlocked by level, or grandfathered from an old save
  isUnlocked(kind, id) {
    const lvl = this.s.level;
    const legacy = this.s.legacy?.[kind] || [];
    if (legacy.includes(id)) return true;
    if (kind === 'crops') return CROPS[id].level <= lvl;
    if (kind === 'animals') return ANIMALS[id].level <= lvl;
    if (kind === 'recipes') { const r = RECIPES[id]; return Math.max(r.level || 0, OBJECTS[r.building].level) <= lvl; }
    return false;
  }

  plant(x, z, type) {
    const soil = this.soilAt(x, z);
    const c = CROPS[type];
    if (!soil || soil.crop || !c || !this.isUnlocked('crops', type)) return false;
    if (this.s.coins < c.seedCost) { this.emit('toast', { text: 'Not enough coins for seeds!', type: 'bad' }); return false; }
    this.spend(c.seedCost);
    soil.crop = { type, plantedAt: this.now() };
    this.emit('soil', { x, z, planted: type });
    this.progressQuest('plant', type, 1);
    this.saveSoon();
    return true;
  }

  harvest(x, z) {
    const soil = this.soilAt(x, z);
    if (!soil || !soil.crop || this.cropStage(soil.crop) < 3) return null;
    const type = soil.crop.type;
    const c = CROPS[type];
    let qty = c.yield;
    if (!this.roomFor(type, qty)) return null;
    if (Math.random() < MASTERY.bonusYieldChance * this.masteryStars(type) && this.spaceFor(type) > qty) qty++;
    soil.crop = null;
    this.addItem(type, qty);
    this.addXp(c.xp);
    this.s.stats.harvested += qty;
    this.bumpStat('harvest', qty);
    this.addMastery(type, qty);
    this.emit('soil', { x, z, harvested: type });
    this.progressQuest('harvest', type, qty);
    const drop = this.rollDrop('harvest', c.xp);
    const keepsake = this.rollKeepsake('crop', c.xp, { x, z });
    return { item: type, qty, xp: c.xp, drop, keepsake };
  }

  clearSoil(x, z) {
    if (!this.s.soil[key(x, z)]) return false;
    delete this.s.soil[key(x, z)];
    const refund = PLOTS.cost(this.plotCount());
    if (refund) this.addCoins(refund, false);
    this.emit('soil', { x, z, cleared: true, refund });
    this.saveSoon();
    return true;
  }

  // ------------------------------------------------------------ layout helpers (see layout.js)
  // pred(soil, x, z) → bool; returns [[x, z], …] in BFS order (distance, then z, then x)
  patchTiles(x, z, pred, max = TUTORIAL.patchMax) { return layout.patchTiles(this, x, z, pred, max); }
  // plants `crop` on the empty patch at (x, z), one plant() per tile; returns the planted [x, z]s
  plantPatch(x, z, crop, cap = TUTORIAL.patchMax) { return layout.plantPatch(this, x, z, crop, cap); }
  // the tidiest free spot for a new building near the farm core: { x, z, rot } or null
  smartSpot(type, rot = 0, near = null) { return layout.smartSpot(this, type, rot, near); }
  // up to n grass tiles that grow the field neatly: [[x, z], …]
  suggestPlowSpots(n = 2, opts = {}) { return layout.suggestPlowSpots(this, n, opts); }

  // ------------------------------------------------------------ mastery
  masteryStars(type) {
    const n = this.s.mastery[type] || 0;
    const th = MASTERY.thresholds(type);
    let s = 0;
    while (s < th.length && n >= th[s]) s++;
    return s;
  }

  addMastery(type, n) {
    const before = this.masteryStars(type);
    this.s.mastery[type] = (this.s.mastery[type] || 0) + n;
    const after = this.masteryStars(type);
    if (after > before) {
      const reward = MASTERY.rewards[after - 1];
      if (reward.gems) this.addGems(reward.gems);
      if (reward.coins) this.addCoins(reward.coins, false);
      this.emit('mastery', { type, stars: after, reward });
    }
  }

  // ------------------------------------------------------------ objects
  objectCount(type) { return this.s.objects.filter((o) => o.type === type).length; }

  objectLimit(type) {
    const def = OBJECTS[type];
    return def.limit ? def.limit(this.s.level) : Infinity;
  }

  objectCost(type) {
    const def = OBJECTS[type];
    return def.costFn ? def.costFn(this.objectCount(type)) : def.cost;
  }

  placeObject(type, x, z, rot = 0) {
    const def = OBJECTS[type];
    if (def.level > this.s.level) return null;
    if (this.objectCount(type) >= this.objectLimit(type)) {
      this.emit('toast', { text: `You can't build more ${def.name}s yet`, type: 'bad' });
      return null;
    }
    if (!this.canPlace(type, x, z, rot)) return null;
    const cost = this.objectCost(type);
    if (def.items && !this.hasItems(def.items)) { this.emit('toast', { text: 'Missing building materials', type: 'bad' }); return null; }
    if (!this.spend(cost)) return null;
    this.lastPlaceCost = cost;
    if (def.items) this.takeItems(def.items);
    const o = { id: this.s.nextId++, type, x, z, rot, jobs: [] };
    if (def.kind === 'tree') o.plantedAt = this.now();
    this.s.objects.push(o);
    this.rebuildOccupancy();
    this.addXp(def.xp ?? (def.kind === 'decor' ? 0 : 1));
    this.emit('objectAdded', o);
    this.progressQuest('build', type, 1);
    this.saveSoon();
    return o;
  }

  moveObject(id, x, z, rot) {
    const o = this.objById.get(id);
    if (!o || OBJECTS[o.type].kind === 'debris') return false;
    if (!this.canPlace(o.type, x, z, rot, id)) return false;
    const dx = x - o.x, dz = z - o.z;
    o.x = x; o.z = z; o.rot = rot;
    this.rebuildOccupancy();
    this.emit('objectMoved', { o, dx, dz });
    this.saveSoon();
    return true;
  }

  removeObject(id) {
    const o = this.objById.get(id);
    if (!o) return false;
    const def = OBJECTS[o.type];
    if (def.kind !== 'decor' && def.kind !== 'tree') return false;
    const refund = def.kind === 'decor' && !o.free ? Math.floor(def.cost / 2) : 0;
    this.s.objects = this.s.objects.filter((x) => x.id !== id);
    this.rebuildOccupancy();
    this.emit('objectRemoved', o);
    if (refund) this.addCoins(refund, false);
    if (def.kind === 'tree' && this.treeState(o) === 'dead') this.rollDrop('clearTree', def.harvests * def.harvestXp);
    this.saveSoon();
    return refund;
  }

  // Tidy up a weed, stone or stump: a tiny one-off reward (no materials, no drops).
  clearDebris(id) {
    const o = this.objById.get(id);
    const def = o && OBJECTS[o.type];
    if (!def || def.kind !== 'debris') return null;
    this.s.objects = this.s.objects.filter((x) => x.id !== id);
    this.rebuildOccupancy();
    this.emit('objectRemoved', o);
    const { coins = 0, xp = 0 } = def.clear || {};
    if (coins) this.addCoins(coins, false);
    if (xp) this.addXp(xp);
    this.bumpStat('debris');
    const res = { id, type: o.type, x: o.x, z: o.z, coins, xp };
    this.emit('debrisCleared', res);
    this.saveSoon();
    return res;
  }

  debris() { return this.s.objects.filter((o) => OBJECTS[o.type].kind === 'debris'); }

  // Put up a chapter-chest gift: free, no XP, ignores level and building limits. It is marked
  // free, so removing it later refunds nothing. Uses up one matching entry of s.gifts.
  placeGift(type, x, z, rot = 0) {
    const gifts = this.s.gifts || [];
    const i = gifts.findIndex((gf) => (typeof gf === 'string' ? gf : gf?.type) === type);
    if (i < 0 || !OBJECTS[type] || !this.canPlace(type, x, z, rot)) return null;
    gifts.splice(i, 1);
    const o = { id: this.s.nextId++, type, x, z, rot, jobs: [], free: true };
    if (OBJECTS[type].kind === 'tree') o.plantedAt = this.now();
    this.s.objects.push(o);
    this.rebuildOccupancy();
    this.lastPlaceCost = 0;
    this.emit('objectAdded', o);
    this.emit('gifts', this.s.gifts);
    this.progressQuest('build', type, 1);
    this.saveSoon();
    return o;
  }

  // ------------------------------------------------------------ fruit trees
  // o.plantedAt: when the sapling was planted; o.harvests: harvests done; o.fruitAt: next fruit ready time
  treeState(o, now = this.now()) {
    const def = OBJECTS[o.type];
    if ((o.harvests || 0) >= def.harvests) return 'dead';
    const ready = o.fruitAt || (o.plantedAt + def.growTime * 1000);
    return now >= ready ? 'ready' : (o.harvests ? 'fruiting' : 'growing');
  }

  treeReadyAt(o) {
    const def = OBJECTS[o.type];
    return o.fruitAt || (o.plantedAt + def.growTime * 1000);
  }

  harvestTree(o) {
    if (this.treeState(o) !== 'ready') return null;
    const def = OBJECTS[o.type];
    if (!this.roomFor(def.fruit, def.yield)) return null;
    o.harvests = (o.harvests || 0) + 1;
    o.fruitAt = this.now() + def.fruitTime * 1000;
    this.addItem(def.fruit, def.yield);
    this.addXp(def.harvestXp);
    this.s.stats.harvested += def.yield;
    this.bumpStat('harvest', def.yield);
    this.progressQuest('harvest', def.fruit, def.yield);
    this.progressQuest('fruit', def.fruit, def.yield);
    this.emit('treeChanged', o);
    const drop = this.rollDrop('harvest', def.harvestXp);
    const keepsake = this.rollKeepsake('fruit', def.harvestXp, { obj: o.id });
    this.saveSoon();
    return { item: def.fruit, qty: def.yield, xp: def.harvestXp, drop, keepsake, dead: this.treeState(o) === 'dead' };
  }

  // ------------------------------------------------------------ animals
  animalsIn(homeId) { return this.s.animals.filter((a) => a.home === homeId); }

  animalState(a, now = this.now()) {
    if (!a.readyAt) return 'hungry';
    return now >= a.readyAt ? 'ready' : 'producing';
  }

  homeCapacity(o) {
    const def = OBJECTS[o.type];
    return def.capacity;
  }

  findHomeFor(type) {
    const def = ANIMALS[type];
    for (const o of this.s.objects) {
      if (o.type === def.home && this.animalsIn(o.id).length < this.homeCapacity(o)) return o;
    }
    return null;
  }

  animalCost(type) {
    // each extra animal of the same type costs a bit more
    const owned = this.s.animals.filter((a) => a.type === type).length;
    return Math.round(ANIMALS[type].cost * (1 + owned * ANIMALS[type].costGrowth));
  }

  buyAnimal(type) {
    const def = ANIMALS[type];
    if (!this.isUnlocked('animals', type)) return null;
    const home = this.findHomeFor(type);
    if (!home) {
      this.emit('toast', { text: `Build a ${OBJECTS[def.home].name} with free space first!`, type: 'bad' });
      return null;
    }
    if (!this.spend(this.animalCost(type))) return null;
    const a = { id: this.s.nextId++, type, home: home.id, readyAt: 0 };
    this.s.animals.push(a);
    if (!def.food) a.readyAt = this.now() + def.time * 1000;
    this.addXp(def.buyXp || 2);
    this.emit('animalAdded', a);
    this.progressQuest('buyAnimal', type, 1);
    this.saveSoon();
    return a;
  }

  // what this animal eats right now: its normal food, or a fallback if that crop is still locked
  animalFood(type) {
    const def = ANIMALS[type];
    if (!def.food) return null;
    if (def.altFood && CROPS[def.food] && !this.isUnlocked('crops', def.food)) return def.altFood;
    return { item: def.food, qty: def.foodQty };
  }

  feedAnimal(a) {
    const def = ANIMALS[a.type];
    if (this.animalState(a) !== 'hungry') return false;
    const f = this.animalFood(a.type);
    if (f && this.count(f.item) < f.qty) return false;
    if (f) this.addItem(f.item, -f.qty);
    a.readyAt = this.now() + def.time * 1000;
    this.emit('animalChanged', a);
    this.progressQuest('feed', a.type, 1);
    this.saveSoon();
    return true;
  }

  collectAnimal(a) {
    if (this.animalState(a) !== 'ready') return null;
    const def = ANIMALS[a.type];
    if (!this.roomFor(def.product, 1)) return null;
    a.readyAt = 0;
    this.addItem(def.product, 1);
    this.addXp(def.xp);
    this.bumpStat('collect');
    this.emit('animalChanged', a);
    this.progressQuest('collect', def.product, 1);
    const drop = this.rollDrop('collect', def.xp);
    const keepsake = this.rollKeepsake('animal', def.xp, { animal: a.id, obj: a.home });
    // animals that don't need food (bees) start their next cycle right away
    if (!def.food) this.feedAnimal(a);
    return { item: def.product, qty: 1, xp: def.xp, drop, keepsake };
  }

  // ------------------------------------------------------------ production
  factoryQueue(o, now = this.now()) {
    return o.jobs.map((j) => {
      const dur = RECIPES[j.recipe].time * 1000;
      return { ...j, done: now >= j.endAt, progress: Math.min(1, Math.max(0, (now - (j.endAt - dur)) / dur)) };
    });
  }

  queueSize(o) {
    const def = OBJECTS[o.type];
    return def.queue + (o.extraSlots || 0);
  }

  startRecipe(o, recipeId) {
    const r = RECIPES[recipeId];
    if (r.building !== o.type) return false;
    if (!this.isUnlocked('recipes', recipeId)) return false;
    if (o.jobs.length >= this.queueSize(o)) { this.emit('toast', { text: 'Queue is full!', type: 'bad' }); return false; }
    if (!this.hasItems(r.inputs)) { this.emit('toast', { text: 'Missing ingredients!', type: 'bad' }); return false; }
    this.takeItems(r.inputs);
    const now = this.now();
    const last = o.jobs.length ? o.jobs[o.jobs.length - 1].endAt : now;
    o.jobs.push({ recipe: recipeId, endAt: Math.max(now, last) + r.time * 1000 });
    this.emit('factoryChanged', o);
    this.saveSoon();
    return true;
  }

  collectFactory(o) {
    const now = this.now();
    const done = o.jobs.filter((j) => now >= j.endAt);
    if (!done.length) return null;
    const got = {};
    let xp = 0, collected = 0;
    for (const j of done) {
      if (!this.roomFor(j.recipe, 1, collected > 0)) break;
      got[j.recipe] = (got[j.recipe] || 0) + 1;
      this.addItem(j.recipe, 1);
      if (j.recipe === TUTORIAL.freeFinish.recipe && this.s.tutorial) this.s.tutorial.freeFinishUsed = true;
      xp += RECIPES[j.recipe].xp;
      this.progressQuest('produce', j.recipe, 1);
      this.bumpStat('produce');
      collected++;
    }
    if (!collected) return null;
    // remove the collected jobs (they're the first `collected` done jobs in queue order)
    let removed = 0;
    o.jobs = o.jobs.filter((j) => { if (removed < collected && now >= j.endAt) { removed++; return false; } return true; });
    this.addXp(xp);
    const drop = this.rollDrop('produce', xp);
    const keepsake = this.rollKeepsake('workshop', xp, { obj: o.id });
    this.emit('factoryChanged', o);
    return { got, xp, drop, keepsake };
  }

  // ------------------------------------------------------------ gems / speed-ups
  speedUpCost(msLeft) { return msLeft <= 0 ? 0 : GEMS.speedUp(msLeft / 1000); }

  // opts.free: use the new farm's one free finish (see freeFinishAvailable) instead of gems
  speedUpFactory(o, opts = {}) {
    const now = this.now();
    const j = o.jobs.find((x) => x.endAt > now);
    if (!j) return false;
    const left = j.endAt - now;
    if (opts.free) {
      if (!this.freeFinishAvailable(o)) return false;
      this.s.tutorial.freeFinishUsed = true;
    } else if (!this.spendGems(this.speedUpCost(left))) return false;
    // the whole queue after this job shifts forward too
    for (const x of o.jobs) if (x.endAt >= j.endAt) x.endAt -= left;
    this.emit('factoryChanged', o);
    this.saveSoon();
    return true;
  }

  // A new farm's first bread job can be finished for free, once (it saves at most one bake).
  freeFinishAvailable(o) {
    if (!o || this.s.tutorial?.freeFinishUsed !== false) return false;
    const now = this.now();
    const j = o.jobs?.find((x) => x.endAt > now);
    return !!j && j.recipe === TUTORIAL.freeFinish.recipe;
  }

  speedUpAnimal(a) {
    if (this.animalState(a) !== 'producing') return false;
    const left = a.readyAt - this.now();
    if (!this.spendGems(this.speedUpCost(left))) return false;
    a.readyAt = this.now();
    this.emit('animalChanged', a);
    this.saveSoon();
    return true;
  }

  // gem price to buy items you're missing (for materials or an order's last item)
  gemPriceFor(req) {
    let g = 0;
    for (const [i, n] of Object.entries(req)) {
      const missing = Math.max(0, n - this.count(i));
      g += missing * GEMS.itemPrice(i, this.s.level);
    }
    return g;
  }

  buyMissing(req) {
    const cost = this.gemPriceFor(req);
    if (!cost) return true;
    for (const [i, n] of Object.entries(req)) {
      const missing = Math.max(0, n - this.count(i));
      if (missing && !this.roomFor(i, missing)) return false;
    }
    if (!this.spendGems(cost)) return false;
    for (const [i, n] of Object.entries(req)) {
      const missing = Math.max(0, n - this.count(i));
      if (missing) this.addItem(i, missing);
    }
    return true;
  }

  // next production slot: { coins, gems, level } (pay with either; coins need the level)
  extraSlotCost(o) {
    const def = OBJECTS[o.type];
    const n = o.extraSlots || 0;
    if (n >= (def.maxExtraSlots || 0)) return null;
    return QUEUE_SLOTS[n] || null;
  }

  buyExtraSlot(o, withGems = false) {
    const c = this.extraSlotCost(o);
    if (!c) return false;
    if (withGems) {
      if (this.s.level < c.level - GEMS.slotLevelLead) { this.emit('toast', { text: `Available from level ${c.level - GEMS.slotLevelLead}`, type: 'bad' }); return false; }
      if (!this.spendGems(c.gems)) return false;
    }
    else {
      if (this.s.level < c.level) { this.emit('toast', { text: `Reach level ${c.level} to buy this slot with coins`, type: 'bad' }); return false; }
      if (!this.spend(c.coins)) return false;
    }
    o.extraSlots = (o.extraSlots || 0) + 1;
    this.emit('factoryChanged', o);
    this.saveSoon();
    return true;
  }

  // ------------------------------------------------------------ orders
  orderPool() {
    // weight items: things that are a bit "behind" the player's level appear more often
    return producibleItems(this.s.level);
  }

  generateOrder() {
    const pool = this.orderPool();
    const lvl = this.s.level;
    const n = Math.min(pool.length, rand(1, ORDERS.maxKinds(lvl)));
    // avoid asking for things other open orders already want, so one missing item can't clog the board
    const busy = new Set();
    for (const o of this.s.orders || []) if (o.items) for (const i of Object.keys(o.items)) busy.add(i);
    const fresh = pool.filter((i) => !busy.has(i));
    const from = fresh.length >= n ? fresh : pool;
    const chosen = new Set();
    let guard = 0;
    while (chosen.size < n && guard++ < 100) chosen.add(from[Math.floor(Math.random() * from.length)]);
    const items = {};
    let value = 0;
    for (const id of chosen) {
      const price = ITEMS[id].price;
      const qty = rand(1, ORDERS.maxQty(price, lvl));
      items[id] = qty;
      value += qty * price;
    }
    // raise the cheapest line until the order is worth the minimum (no flat bonuses)
    const ids = [...chosen].sort((a, b) => ITEMS[a].price - ITEMS[b].price);
    let guard2 = 0;
    while (value < ORDERS.minValue(lvl) && guard2++ < 200) { items[ids[0]]++; value += ITEMS[ids[0]].price; }
    return {
      id: this.s.nextId++,
      items,
      coins: Math.round(value * ORDERS.coinMult),
      xp: Math.max(1, Math.round(value * ORDERS.xpMult)),
    };
  }

  ensureOrders() {
    const now = this.now();
    const slots = ORDERS.slots(this.s.level) + this.perk('orderSlot', 0);
    while (this.s.orders.length < slots) this.s.orders.push(this.generateOrder());
    let changed = false;
    this.s.orders = this.s.orders.map((o) => {
      if (o.waitUntil && now >= o.waitUntil) { changed = true; return this.generateOrder(); }
      return o;
    });
    if (changed) this.emit('orders', this.s.orders);
    this.ensureVisitors();
    this.ensureChores();
    this.ensureWagon();
    this.checkSafetyNet();
    this.syncReveal();
  }

  // ------------------------------------------------------------ safety net ("Mabel's pocket money")
  // A tiny gift for a farm that is truly stuck: can't afford any seed, nothing growing or
  // producing, nothing to sell or deliver. At most once per cooldown; never fires in normal play.
  cheapestSeedCost() {
    let min = Infinity;
    for (const [id, c] of Object.entries(CROPS)) if (this.isUnlocked('crops', id)) min = Math.min(min, c.seedCost);
    return min;
  }

  isStuck() {
    const now = this.now();
    if (this.s.coins >= this.cheapestSeedCost()) return false;
    if (Object.values(this.s.soil).some((soil) => soil.crop)) return false;
    if (Object.entries(this.s.inventory).some(([i, n]) => n > 0 && ITEMS[i]?.cat !== 'material')) return false;
    if (this.s.animals.some((a) => this.animalState(a, now) !== 'hungry')) return false;
    for (const o of this.s.objects) {
      const kind = OBJECTS[o.type]?.kind;
      if (kind === 'factory' && o.jobs?.length) return false;
      if (kind === 'tree' && this.treeState(o, now) !== 'dead') return false;
    }
    if (this.s.orders.some((o) => !o.waitUntil && this.hasItems(o.items))) return false;
    if (this.questDone()) return false;
    return true;
  }

  checkSafetyNet() {
    const t = this.s.tutorial;
    if (!t || this._booting) return null;
    const { coins, cooldownH } = TUTORIAL.safetyNet;
    const now = this.now();
    if (t.net && now - t.net < cooldownH * 3600000) return null;
    if (!this.isStuck()) return null;
    t.net = now;
    this.addCoins(coins, false);
    this.emit('safetyNet', { coins });
    this.saveSoon();
    return coins;
  }

  fulfillOrder(id) {
    const o = this.s.orders.find((x) => x.id === id);
    if (!o || o.waitUntil) return false;
    if (!this.takeItems(o.items)) { this.emit('toast', { text: 'You don\'t have everything yet', type: 'bad' }); return false; }
    this.addCoins(o.coins);
    this.addXp(o.xp);
    this.s.stats.orders++;
    this.bumpStat('ordersDone');
    const idx = this.s.orders.indexOf(o);
    this.s.orders[idx] = { id: this.s.nextId++, waitUntil: this.now() + ORDERS.refill * 1000 };
    const drop = this.rollDrop('order', o.xp);
    this.rollKeepsake('order', o.xp, { obj: this.s.objects.find((x) => x.type === 'orderboard')?.id });
    this.emit('orderDone', { ...o, drop });
    this.emit('orders', this.s.orders);
    this.progressQuest('order', null, 1);
    this.saveSoon();
    return o;
  }

  discardOrder(id) {
    const idx = this.s.orders.findIndex((x) => x.id === id);
    if (idx < 0) return;
    this.s.orders[idx] = { id: this.s.nextId++, waitUntil: this.now() + ORDERS.discardWait * 1000 };
    this.emit('orders', this.s.orders);
    this.saveSoon();
  }

  // ------------------------------------------------------------ visitors (villagers)
  visitorInterval() { return VISITORS.interval * 1000 * this.perk('visitorRate', 1); }

  ensureVisitors() {
    const now = this.now();
    if (this.s.level < VISITORS.level) {
      // keep the first arrival a short wait after visitors unlock, not "long overdue"
      this.s.nextVisitorAt = now + VISITORS.firstDelay * 1000;
      return;
    }
    // older saves had visitors who left after a while: they now stay until served or dismissed
    for (const v of this.s.visitors) if (v.leavesAt) v.leavesAt = null;
    const max = VISITORS.max(this.s.level);
    let changed = false;
    // arrivals keep coming while the game is closed, up to the number of waiting spots
    while (this.s.visitors.length < max && now >= this.s.nextVisitorAt) {
      const v = this.generateVisitor(this.s.nextVisitorAt);
      if (!v) { this.s.nextVisitorAt = now + 60000; break; }
      this.s.visitors.push(v);
      this.s.nextVisitorAt = Math.max(this.s.nextVisitorAt, now - this.visitorInterval()) + this.visitorInterval() * (0.75 + Math.random() * 0.5);
      changed = true;
    }
    if (this.s.visitors.length >= max && now >= this.s.nextVisitorAt) this.s.nextVisitorAt = now + this.visitorInterval() * 0.5;
    if (changed) { this.emit('visitors', this.s.visitors); this.saveSoon(); }
  }

  availableNpcs() {
    const now = this.now();
    const here = new Set(this.s.visitors.map((v) => v.npc));
    return VISITORS.npcs.filter((n) => n.level <= this.s.level && !here.has(n.id) && !(this.s.visitorAway[n.id] > now));
  }

  generateVisitor(arrivedAt) {
    const pool = this.orderPool();
    const npcs = this.availableNpcs();
    if (!pool.length || !npcs.length) return null;
    const minValue = VISITORS.minValue(this.s.level);
    // a new farm's first visitor is Grandma Mabel, asking for something you already hold
    const first = this.s.tutorial && !this.s.tutorial.firstVisitorDone && npcs.find((n) => n.id === GUIDE.npc);
    const npc = first || npcs[Math.floor(Math.random() * npcs.length)];
    let item = null, qty = 0;
    if (first) {
      this.s.tutorial.firstVisitorDone = true;
      let best = 0;
      for (const i of pool) {
        const v = this.count(i) * ITEMS[i].price;
        if (v >= minValue && v > best) { best = v; item = i; }
      }
      if (item) qty = Math.ceil(minValue / ITEMS[item].price);
    }
    if (!item) {
      // visitors prefer their favourite category, else anything
      const fav = pool.filter((i) => npc.likes.includes(ITEMS[i].cat));
      const from = fav.length ? fav : pool;
      item = from[Math.floor(Math.random() * from.length)];
      qty = rand(1, ORDERS.maxQty(ITEMS[item].price, this.s.level));
      while (ITEMS[item].price * qty < minValue && qty < 99) qty++;
    }
    const value = ITEMS[item].price * qty;
    const bonus = (this.s.hearts[npc.id] || 0) >= VISITORS.maxHearts ? 1 + VISITORS.heartBonusPay : 1;
    const v = {
      id: this.s.nextId++,
      npc: npc.id,
      item,
      qty,
      coins: Math.round(value * VISITORS.coinMult * bonus),
      xp: Math.max(1, Math.round(value * VISITORS.xpMult)),
      arrivedAt,
      leavesAt: null, // villagers wait until you serve or dismiss them
    };
    if (first) v.first = true; // the UI shows VISITORS.firstLine for her
    return v;
  }

  serveVisitor(id) {
    const v = this.s.visitors.find((x) => x.id === id);
    if (!v) return null;
    if (this.count(v.item) < v.qty) { this.emit('toast', { text: `You need ${v.qty} ${ITEMS[v.item].name}`, type: 'bad' }); return null; }
    this.addItem(v.item, -v.qty);
    this.addCoins(v.coins);
    this.addXp(v.xp);
    this.bumpStat('visitors');
    this.s.visitors = this.s.visitors.filter((x) => x !== v);
    const npc = VISITORS.npcs.find((n) => n.id === v.npc);
    const gain = 1 + (npc && npc.likes.includes(ITEMS[v.item].cat) ? 1 : 0);
    const hearts = this.addHearts(v.npc, gain);
    const drop = this.rollDrop('visitor', v.xp);
    this.rollKeepsake('visitor', v.xp, { visitor: v.id });
    this.emit('visitorServed', { ...v, drop, hearts, gain });
    this.emit('visitors', this.s.visitors);
    this.progressQuest('visitor', null, 1);
    this.saveSoon();
    return v;
  }

  addHearts(npcId, n) {
    const before = this.s.hearts[npcId] || 0;
    const after = Math.min(VISITORS.maxHearts, before + n);
    this.s.hearts[npcId] = after;
    for (const [lvl, r] of Object.entries(VISITORS.heartRewards)) {
      if (before < +lvl && after >= +lvl) {
        if (r.gems) this.addGems(r.gems);
        if (r.coins) this.addCoins(r.coins, false);
        for (let i = 0; i < (r.materials || 0); i++) this.addItem(this.pickMaterial(), 1);
        const npc = VISITORS.npcs.find((x) => x.id === npcId);
        this.emit('hearts', { npc, hearts: +lvl, reward: r });
      }
    }
    return after;
  }

  dismissVisitor(id) {
    const v = this.s.visitors.find((x) => x.id === id);
    if (!v) return;
    const now = this.now();
    this.s.visitors = this.s.visitors.filter((x) => x !== v);
    this.s.visitorAway[v.npc] = now + VISITORS.dismissCooldown * 1000;
    this.s.nextVisitorAt = Math.max(this.s.nextVisitorAt, now + VISITORS.dismissGap * 1000);
    this.emit('visitors', this.s.visitors);
    this.saveSoon();
  }

  // ------------------------------------------------------------ daily chores
  ensureChores() {
    if (this.s.level < CHORES.level) return;
    const today = dayNumber(this.now());
    if (this.s.chores && this.s.chores.day === today) return;
    this.s.chores = { day: today, list: [], rerolls: CHORES.rerolls, bonus: false };
    const used = new Set();
    for (let i = 0; i < CHORES.perDay; i++) this.s.chores.list.push(this.makeChore(used));
    this.emit('chores', this.s.chores);
    this.saveSoon();
  }

  makeChore(used) {
    const lvl = this.s.level;
    const pick = (kind) => {
      const crops = Object.keys(CROPS).filter((c) => this.isUnlocked('crops', c));
      return crops[Math.floor(Math.random() * crops.length)];
    };
    const options = CHORES.templates.filter((t) => (t.level || 1) <= lvl && !used.has(t.id));
    const t = options[Math.floor(Math.random() * options.length)] || CHORES.templates[0];
    used.add(t.id);
    return { tpl: t.id, ...t.make(lvl, pick), progress: 0, claimed: false, xp: CHORES.xp(lvl), coins: CHORES.coins(lvl) };
  }

  rerollChore(i) {
    const c = this.s.chores;
    if (!c || c.rerolls <= 0 || !c.list[i] || c.list[i].claimed) return false;
    const used = new Set(c.list.map((x) => x.tpl));
    c.list[i] = this.makeChore(used);
    c.rerolls--;
    this.emit('chores', c);
    this.saveSoon();
    return true;
  }

  claimChore(i) {
    const c = this.s.chores;
    const ch = c && c.list[i];
    if (!ch || ch.claimed || ch.progress < ch.count) return null;
    ch.claimed = true;
    this.addCoins(ch.coins, false);
    this.addXp(ch.xp);
    let bonus = null;
    if (!c.bonus && c.list.every((x) => x.claimed)) {
      c.bonus = true;
      bonus = { ...CHORES.allDone, item: this.pickMaterial() };
      this.addGems(bonus.gems);
      this.addItem(bonus.item, bonus.materials);
    }
    this.emit('chores', c);
    this.saveSoon();
    return { chore: ch, bonus };
  }

  choresReady() { return this.s.chores ? this.s.chores.list.filter((c) => !c.claimed && c.progress >= c.count).length : 0; }

  // ------------------------------------------------------------ market wagon
  ensureWagon() {
    if (this.s.level < WAGON.level) return;
    const now = this.now();
    // catch up after a long absence in one go (no flicker through missed visits)
    if (!this.s.wagon) this.newWagon(now);
    for (let guard = 0; guard < 50; guard++) {
      const w = this.s.wagon;
      if (w.state === 'away' && now >= w.returnsAt) {
        const missed = Math.floor((now - w.returnsAt) / ((WAGON.stay + WAGON.away) * 1000));
        this.newWagon(w.returnsAt + missed * (WAGON.stay + WAGON.away) * 1000);
      } else if (w.state === 'here' && now >= w.leavesAt) this.sendWagon(w.leavesAt);
      else break;
    }
  }

  newWagon(at) {
    const lvl = this.s.level;
    const V = WAGON.crateValue(lvl);
    // items unlocked at least one level ago, valuable enough for a crate
    const pool = producibleItems(lvl - 1).filter((i) => ITEMS[i].price >= V / 10 && ITEMS[i].cat !== 'material');
    const crates = [];
    const uses = {};
    for (let n = 0; n < WAGON.crates(lvl) && pool.length; n++) {
      const options = pool.filter((i) => (uses[i] || 0) < 2);
      if (!options.length) break; // small pool at very high levels: fewer crates rather than a crash
      const item = options[Math.floor(Math.random() * options.length)];
      uses[item] = (uses[item] || 0) + 1;
      const qty = Math.max(1, Math.min(WAGON.maxQty, Math.round(V / ITEMS[item].price)));
      crates.push({ item, qty, filled: false, coins: Math.round(ITEMS[item].price * qty * WAGON.coinMult * this.perk('wagonPay', 1)), xp: WAGON.xp(lvl) });
    }
    this.s.wagon = { state: 'here', arrivedAt: at, leavesAt: at + WAGON.stay * 1000, crates, bonus: false };
    this.emit('wagon', this.s.wagon);
    this.saveSoon();
  }

  sendWagon(at = this.now()) {
    const w = this.s.wagon;
    if (!w) return;
    w.state = 'away';
    w.returnsAt = at + WAGON.away * 1000;
    this.emit('wagon', w);
    this.saveSoon();
  }

  fillCrate(i) {
    const w = this.s.wagon;
    const c = w && w.state === 'here' && w.crates[i];
    if (!c || c.filled) return null;
    if (this.count(c.item) < c.qty) { this.emit('toast', { text: `You need ${c.qty} ${ITEMS[c.item].name}`, type: 'bad' }); return null; }
    this.addItem(c.item, -c.qty);
    c.filled = true;
    this.addCoins(c.coins);
    this.addXp(c.xp);
    this.rollKeepsake('wagon', c.xp, { wagon: true }); // (fillCrate has no material drop)
    this.progressQuest('crate', null, 1);
    let bonus = null;
    if (w.crates.every((x) => x.filled)) {
      const coins = Math.round(w.crates.reduce((s, x) => s + x.coins, 0) * WAGON.fullBonus.coinShare);
      bonus = { coins, gems: WAGON.fullBonus.gems, items: {} };
      this.addCoins(coins);
      this.addGems(bonus.gems);
      for (let k = 0; k < WAGON.fullBonus.materials; k++) { const m = this.pickMaterial(); bonus.items[m] = (bonus.items[m] || 0) + 1; this.addItem(m, 1); }
      this.bumpStat('wagons');
      this.sendWagon();
    }
    this.emit('wagon', w);
    this.saveSoon();
    return { crate: c, bonus };
  }

  speedUpWagon() {
    const w = this.s.wagon;
    if (!w || w.state !== 'away') return false;
    if (!this.spendGems(this.speedUpCost(w.returnsAt - this.now()))) return false;
    this.newWagon(this.now());
    return true;
  }

  // ------------------------------------------------------------ village projects
  project(id) {
    return (this.s.projects[id] ||= { stage: 0, given: { coins: 0, items: {} } });
  }

  projectNeeds(id) {
    const p = this.project(id);
    const st = PROJECTS[id].stages[p.stage];
    if (!st) return null;
    const items = {};
    for (const [i, n] of Object.entries(st.items)) items[i] = Math.max(0, n - (p.given.items[i] || 0));
    return { coins: Math.max(0, st.coins - p.given.coins), items };
  }

  // donate coins ('coins') or an item toward the current stage; partial donations are fine
  contribute(id, what, amount) {
    const def = PROJECTS[id];
    if (this.s.level < def.level) return false;
    const need = this.projectNeeds(id);
    if (!need) return false;
    const p = this.project(id);
    if (what === 'coins') {
      const n = Math.min(amount, need.coins, this.s.coins);
      if (n <= 0) return false;
      this.spend(n);
      p.given.coins += n;
    } else {
      const n = Math.min(amount, need.items[what] || 0, this.count(what));
      if (n <= 0) return false;
      this.addItem(what, -n);
      p.given.items[what] = (p.given.items[what] || 0) + n;
    }
    const left = this.projectNeeds(id);
    let done = null;
    if (left.coins === 0 && Object.values(left.items).every((n) => n === 0)) {
      const stage = p.stage;
      p.stage++;
      p.given = { coins: 0, items: {} };
      const xp = PROJECT_REWARD.xp(this.s.level);
      const gems = PROJECT_REWARD.gems[stage] || 0;
      this.addXp(xp);
      this.addGems(gems);
      this.bumpStat('projects');
      done = { stage: p.stage, xp, gems, finished: p.stage >= def.stages.length };
      this.emit('projectStage', { id, ...done });
    }
    this.emit('project', { id });
    this.saveSoon();
    return done || true;
  }

  // value of a finished project's perk (or fallback)
  perk(key, fallback) {
    for (const [id, def] of Object.entries(PROJECTS)) {
      if (def.perkKey === key && (this.s.projects?.[id]?.stage || 0) >= def.stages.length) return def.perkValue;
    }
    return fallback;
  }

  // ------------------------------------------------------------ land expansion
  nextExpansion() {
    if (this.s.landSize >= MAP_SIZE) return null;
    return { ...LAND.expand(this.s.landSize), size: this.s.landSize + LAND_STEP };
  }

  expandLand() {
    const e = this.nextExpansion();
    if (!e) return false;
    if (this.s.level < e.level) { this.emit('toast', { text: `Reach level ${e.level} to expand`, type: 'bad' }); return false; }
    if (!this.hasItems(e.items)) { this.emit('toast', { text: 'Missing land deeds / materials', type: 'bad' }); return false; }
    if (!this.spend(e.coins)) return false;
    this.takeItems(e.items);
    this.s.landSize = e.size;
    this.addXp(e.xp || 10);
    this.emit('land', this.s.landSize);
    this.progressQuest('expand', null, 1);
    this.saveSoon();
    return true;
  }

  // ------------------------------------------------------------ daily reward
  dailyStatus() {
    const today = dayNumber(this.now());
    const d = this.s.daily;
    const canClaim = d.lastDay !== today && (!d.lastAt || this.now() - d.lastAt >= 16 * 3600000);
    // missing a day never resets the calendar — it just waits for you (no streak anxiety)
    const streak = canClaim ? d.streak + 1 : d.streak;
    const idx = (streak - 1) % DAILY.length;
    return { canClaim, streak, reward: DAILY[idx], day: idx + 1 };
  }

  claimDaily() {
    const st = this.dailyStatus();
    if (!st.canClaim) return null;
    const r = st.reward;
    for (const [i, n] of Object.entries(r.items || {})) if (this.roomFor(i, n, true)) this.addItem(i, n);
    if (r.coins) this.addCoins(r.coins, false);
    if (r.gems) this.addGems(r.gems);
    this.s.daily = { lastDay: dayNumber(this.now()), streak: st.streak, lastAt: this.now() };
    this.emit('daily', st);
    this.saveSoon();
    return st;
  }

  // ------------------------------------------------------------ v4 rewards: the save's own RNG and grant()
  // mulberry32 on s.rng (saved, so a reload continues the sequence). The only RNG of the v4 features: Math.random
  // (orders, visitors, material drops) is never touched by them, so the pacing sim sees the same farm.
  rand() {
    const s = this.s;
    const a = ((s.rng >>> 0) + 0x6d2b79f5) >>> 0;
    s.rng = a;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // The single choke point of every v4 reward (the Post, the album, ribbons).
  // r: { coins, gems, items: { id: n }, keepsake: true | id, keepsakeFallback: gems, gift: type, place, voucher: n }
  // Coins are paid as non-earned (no "Earn coins" goals, no Tycoon); items that don't fit become coins at shop price;
  // decor goes to s.gifts; keepsakes to the album (none to give → keepsakeFallback gems). There is no XP path, and
  // building materials are never paid (they throw in dev / tests). Tallied in this.granted[source].
  // Returns the reward tiles for the UI: [{ kind: 'coins'|'gems'|'item'|'keepsake'|'gift'|'voucher', n, item, id, type, place }]
  grant(source, r = {}) {
    const t = (this.granted[source] ||= { coins: 0, gems: 0, items: {}, itemValue: 0, keepsakes: 0, gifts: 0, vouchers: 0, xp: 0, materials: 0 });
    if (r.xp || r.materials) {
      if (STRICT) throw new Error(`grant(${source}): XP and building materials are never a reward`);
      console.warn(`grant(${source}): XP / materials skipped`);
    }
    const tiles = [];
    let coins = Math.max(0, Math.round(r.coins || 0)), gems = Math.max(0, Math.round(r.gems || 0)), fromItems = 0;
    const items = [];
    for (const [i, n] of Object.entries(r.items || {})) {
      if (!(n > 0) || !ITEMS[i]) continue;
      if (ITEMS[i].cat === 'material') {
        if (STRICT) throw new Error(`grant(${source}): building materials are never a reward (${i})`);
        console.warn(`grant(${source}): ${i} skipped (materials are never a reward)`);
        continue;
      }
      if (this.roomFor(i, n, true)) {
        this.addItem(i, n);
        t.items[i] = (t.items[i] || 0) + n;
        t.itemValue += n * ITEMS[i].price;
        items.push({ kind: 'item', item: i, n });
      } else fromItems += n * ITEMS[i].price; // no room: the same value in coins
    }
    coins += fromItems;
    let keepsake = null;
    if (r.keepsake) {
      keepsake = this.giveKeepsake(source, r.keepsake === true ? null : r.keepsake);
      if (keepsake) t.keepsakes++;
      else gems += Math.max(0, r.keepsakeFallback || 0);
    }
    if (coins) { this.addCoins(coins, false); t.coins += coins; tiles.push({ kind: 'coins', n: coins, fromItems }); }
    if (gems) { this.addGems(gems); t.gems += gems; tiles.push({ kind: 'gems', n: gems }); }
    tiles.push(...items);
    if (keepsake) tiles.push({ kind: 'keepsake', id: keepsake });
    if (r.gift && OBJECTS[r.gift]) {
      (this.s.gifts ||= []).push(r.gift);
      t.gifts++;
      this.emit('gifts', this.s.gifts);
      tiles.push({ kind: 'gift', type: r.gift, place: !!r.place });
    }
    if (r.voucher > 0) {
      if (this.features.charm) { this.s.charm.vouchers += r.voucher; t.vouchers += r.voucher; tiles.push({ kind: 'voucher', n: r.voucher }); }
      else { const v = r.voucher * ALBUM.voucherFallbackGems; this.addGems(v); t.gems += v; tiles.push({ kind: 'gems', n: v }); }
    }
    this.saveSoon();
    return tiles;
  }

  // ------------------------------------------------------------ the Post (timed gifts)
  // What parcel n holds when opened at level L (pure: depends only on n, L and the save's office flag; the keepsake
  // itself is picked at claim time with rand()). → { n, kind, sender, note, wrap, coins, gems, items, keepsake,
  // keepsakeFallback, gift, place }. kind: welcome | keepsake | pantry | postcard | big | office.
  postContents(n = this.s.post.n, L = this.s.level, s = this.s) {
    let base, kind;
    if (s.post?.office) { base = POST.office; kind = 'office'; }
    else if (n < POST.welcome.length) { base = POST.welcome[n]; kind = base.big ? 'big' : 'welcome'; }
    else { kind = POST.cycle[(n - POST.welcome.length) % POST.cycle.length]; base = POST.slots[kind]; }
    const sender = typeof base.from === 'function' ? base.from(L, n) : base.from;
    const round = Math.max(0, Math.floor((n - POST.welcome.length) / POST.cycle.length));
    const P = POST.coins(L);
    const c = {
      n, kind, sender, note: base.note || POST.notes[sender][round % 3], wrap: kind === 'postcard' ? 'postcard' : base.big ? 'big' : 'plain',
      coins: base.coins ? P : 0, gems: base.gems || 0, items: {}, keepsake: base.keepsake || null,
      keepsakeFallback: base.keepsake ? POST.keepsakeFallbackGems : 0, gift: base.gift || null, place: !!base.place,
    };
    // Pantry: goods worth exactly P(L) — the best good unlocked a level ago at ≤ half of it, the rest in coins
    if (base.pantry) {
      const best = pantryPick(L, P);
      if (best) { c.items = { [best.id]: best.qty }; c.coins = P - best.qty * best.price; } else c.coins = P;
    }
    // every 3rd recurring Big parcel (n = 16, 28) brings a golden decoration; after both, 💎3 instead
    if (kind === 'big' && !s.post?.office && n >= POST.welcome.length) {
      const b = (n - POST.welcome.length - POST.cycle.indexOf('big')) / POST.cycle.length + 1; // 1st, 2nd … Big
      if (b % POST.goldEvery === 0) {
        const gold = POST.golds[b / POST.goldEvery - 1];
        if (gold && OBJECTS[gold]) { c.gift = gold; c.place = false; } else c.gems += POST.goldFallbackGems;
      }
    }
    return c;
  }

  // { ready, n, nextAt, msLeft (≤ gap), gap, progress, intro, office, kind, sender, teaser: { kind, sender, icon, label } }
  postStatus() {
    const p = this.s.post;
    const now = this.now();
    const gap = postGap(p.n);
    const ready = this.features.post !== false && (!!p.office || now >= p.nextAt);
    const msLeft = ready ? 0 : Math.max(0, Math.min(gap, p.nextAt - now));
    const c = this.postContents(p.n, this.s.level);
    return {
      ready, n: p.n, nextAt: p.nextAt, msLeft, gap, progress: 1 - msLeft / gap, intro: p.n < POST.welcome.length && !p.office,
      office: !!p.office, kind: c.kind, sender: c.sender, teaser: postTeaser(c),
    };
  }

  // the HUD's 1 Hz tick: 'postReady' once per parcel
  postTick() {
    const st = this.postStatus();
    if (st.ready && !this.s.post.notified) {
      this.s.post.notified = true;
      this.emit('postReady', st);
      this.saveSoon();
    }
    return st;
  }

  // Open the waiting parcel: contents → grant('post') → n + 1 (the office parcel doesn't count) → the next countdown.
  // → null | { n, office, kind, sender, note, wrap, tiles, gift: { type, place } | null, next: { at, kind, sender, label } }
  claimPost() {
    if (!this.postStatus().ready) return null;
    const p = this.s.post;
    const office = !!p.office;
    const c = this.postContents(p.n, this.s.level);
    const tiles = this.grant('post', c);
    if (office) p.office = false; else p.n++;
    const now = this.now();
    p.lastAt = now;
    p.nextAt = now + postGap(p.n);
    p.notified = false;
    this.bumpStat('parcels');
    const next = this.postContents(p.n, this.s.level);
    const r = {
      n: c.n, office, kind: c.kind, sender: c.sender, note: c.note, wrap: c.wrap, tiles,
      gift: c.gift ? { type: c.gift, place: c.place } : null,
      next: { at: p.nextAt, kind: next.kind, sender: next.sender, label: postTeaser(next).label },
    };
    if (c.kind === 'pantry' && tiles.some((x) => x.fromItems)) {
      this.emit('toast', { text: `Your Barn was full, so ${POST.short[c.sender] || 'Mabel'} sent coins instead.`, type: 'info' });
    }
    this.emit('post', r);
    this.saveSoon();
    return r;
  }

  // ------------------------------------------------------------ Mabel's Keepsake Album (§3)
  // 72 keepsakes on 12 pages of 6. The album opens with the first keepsake (Kip's clover in parcel #3, the office
  // parcel, or — for a farm that never opens parcels — the first eligible action from level 8). Page 1 opens with
  // it, the others at their level. Finds never repeat: every pick is a missing piece, drawn with rand().
  albumOpen() { return !!this.s.album?.open; }

  albumPage(id) { return ALBUM.pages.find((p) => p.id === id) || null; }

  // a page is open once you reach its level (page 1, level 0, with the album)
  albumPageOpen(p) { return this.s.level >= (p.level || 0); }

  albumMissing(p) {
    const have = this.s.album.have;
    return p.items.map(([it]) => `${p.id}:${it}`).filter((k) => !have[k]);
  }

  // Where a keepsake goes. A natural find from src: the earliest open page that wants src (or wants anything) and
  // still misses a piece, else the earliest open incomplete page. A parcel's (src null): the earliest open
  // incomplete page, so the oldest straggler fills first. → the page, or null when every open page is full.
  albumRoute(src = null) {
    const open = ALBUM.pages.filter((p) => this.albumPageOpen(p) && this.albumMissing(p).length);
    return (src && open.find((p) => !p.src || p.src.includes(src))) || open[0] || null;
  }

  // a keepsake is found: record it (fresh until its page is viewed), open the album, tell the UI
  // at: where it turned up, for the sparkle ({ x, z } a tile · obj · animal · visitor · wagon; none for parcels)
  recordKeepsake(id, src, at = null) {
    const a = this.s.album;
    a.have[id] = this.now();
    a.open = true;
    if (!a.fresh.includes(id)) a.fresh.push(id);
    this.bumpStat('keepsakes');
    const k = KEEPSAKES[id];
    const page = this.albumPage(k.page);
    const pageFound = page.items.filter(([it]) => a.have[`${page.id}:${it}`]).length;
    this.emit('keepsake', { id, page: page.id, source: src, pageFound, pageDone: pageFound >= page.items.length, at });
    this.emit('album', a);
    this.saveSoon();
    return id;
  }

  // A keepsake from a parcel (or a fixed one, e.g. Kip's clover). Never a duplicate: a fixed id you already have, or
  // none given, picks a missing one on the earliest open page that still has gaps (rand()). Opens the album.
  // → the keepsake id, or null when there is nothing to find (the caller pays fallback gems)
  giveKeepsake(src, id = null) {
    if (!this.features.album) return null;
    const a = this.s.album;
    let pick = id && KEEPSAKES[id] && !a.have[id] ? id : null;
    if (!pick) {
      const page = this.albumRoute(null);
      if (!page) return null;
      const missing = this.albumMissing(page);
      pick = missing[Math.floor(this.rand() * missing.length)];
    }
    return this.recordKeepsake(pick, src, null);
  }

  // A find while farming (§3.3), right after the material roll of the 7 actions (crop, fruit, animal, workshop,
  // order, visitor, wagon): chance xp / D(L) (≤ 0.5), with a pity meter that guarantees one at 1.5·D(L), so
  // spamming quick crops can't farm keepsakes. No roll (and no meter) while the album is closed or every open
  // page is full. A farm reaching level 8 with the album still closed is primed: its next action finds one.
  // → the keepsake id, or null
  rollKeepsake(src, xp = 0, at = null) {
    if (!this.features.album || !(xp > 0)) return null;
    const a = this.s.album;
    const D = ALBUM.divisor(this.s.level);
    // (not while the office parcel waits: a farm from before the Post opens it with that parcel's clover)
    if (!a.open && !a.primed && this.s.level >= ALBUM.openLevel && !this.s.post?.office) {
      a.primed = true;
      a.open = true;
      a.meter = ALBUM.pity * D;
    }
    if (!a.open) return null;
    const page = this.albumRoute(src);
    if (!page) return null;
    a.meter = (a.meter || 0) + xp;
    const chance = a.meter >= ALBUM.pity * D ? 1 : Math.min(ALBUM.maxChance, xp / D);
    if (this.rand() >= chance) return null;
    a.meter = 0;
    const missing = this.albumMissing(page);
    return this.recordKeepsake(missing[Math.floor(this.rand() * missing.length)], src, at);
  }

  // { open, found, total, ready (pages to claim), launch, all, pages: [{ id, name, icon, level, locked, have: [ids],
  //   found, complete, ready, claimed, fresh: [ids] }] }
  albumStatus() {
    const a = this.s.album;
    let found = 0, ready = 0;
    const pages = ALBUM.pages.map((p) => {
      const ids = p.items.map(([it]) => `${p.id}:${it}`);
      const have = ids.filter((k) => a.have[k]);
      const complete = have.length === ids.length;
      const claimed = !!a.claimed[p.id];
      const pageReady = this.features.album && complete && !claimed;
      found += have.length;
      if (pageReady) ready++;
      return { id: p.id, name: p.name, icon: p.icon, level: p.level || 0, locked: !this.albumPageOpen(p), have, found: have.length,
        complete, ready: pageReady, claimed, fresh: a.fresh.filter((k) => ids.includes(k)) };
    });
    return { open: !!a.open, found, total: Object.keys(KEEPSAKES).length, ready, launch: !!a.launch, all: !!a.all, pages };
  }

  // [pageId] of complete pages whose prize waits
  albumPagesReady() {
    if (!this.features.album) return [];
    const a = this.s.album;
    return ALBUM.pages.filter((p) => !a.claimed[p.id] && !this.albumMissing(p).length).map((p) => p.id);
  }

  // Claim a complete page's prize through grant('album'): gems and a one-of-a-kind decoration (to s.gifts), or gilding
  // vouchers (💎15 each while Prettiest Farm is off). Claiming page 8's makes the launch album (pages 1–8): 💎10, the
  // Curio Cabinet and "Keeper of Keepsakes"; the last of all 12 pages adds "Valley Historian".
  // → null | { id, gems, gift, voucher, tiles, launch: { gems, gift, title, tiles } | null, title: string | null }
  claimAlbumPage(id) {
    if (!this.features.album) return null;
    const p = this.albumPage(id);
    const a = this.s.album;
    if (!p || a.claimed[id] || this.albumMissing(p).length) return null;
    a.claimed[id] = this.now();
    const prize = p.prize || {};
    const tiles = this.grant('album', { gems: prize.gems, gift: prize.gift, voucher: prize.voucher });
    const r = { id, gems: prize.gems || 0, gift: prize.gift && OBJECTS[prize.gift] ? prize.gift : null, voucher: prize.voucher || 0, tiles, launch: null, title: null };
    const done = (list) => list.every((q) => a.claimed[q.id]);
    if (!a.launch && done(ALBUM.pages.slice(0, ALBUM.launchPages))) {
      a.launch = true;
      const L = ALBUM.launch;
      const gift = OBJECTS[L.gift] ? L.gift : null;
      // (without the cabinet: 💎10 more instead)
      const lt = this.grant('album', { gems: L.gems + (gift ? 0 : 10), gift });
      this.addTitle(L.title);
      r.launch = { gems: L.gems + (gift ? 0 : 10), gift, title: L.title, tiles: lt };
      r.title = L.title;
    }
    if (!a.all && done(ALBUM.pages)) {
      a.all = true;
      this.addTitle(ALBUM.all.title);
      r.title = ALBUM.all.title;
    }
    this.emit('albumPage', r);
    this.emit('album', a);
    this.saveSoon();
    return r;
  }

  // the HUD showed this page: its finds are no longer NEW
  albumSeen(pageId) {
    const a = this.s.album;
    const before = a.fresh.length;
    a.fresh = a.fresh.filter((k) => KEEPSAKES[k]?.page !== pageId);
    if (a.fresh.length !== before) { this.emit('album', a); this.saveSoon(); }
  }

  // titles earned (the album's and the ribbons'), shown with the farm
  addTitle(title) {
    const list = (this.s.charm.titles ||= []);
    if (title && !list.includes(title)) list.push(title);
  }

  // ------------------------------------------------------------ Prettiest Farm: 💗 charm, ribbons, gilding (§4)
  // Charm is derived from the placed decorations (never s.gifts): up to 3 of each kind count — the gilded copies
  // first — and a gilded copy counts triple. Memoised; placing, removing or gilding anything invalidates it.
  // → { total, kinds: { type: { placed, counted, gilded } }, of(o): the 💗 o adds now (0 = a 4th copy) }
  charm() {
    const s = this.s, m = this._charm;
    if (m && m.s === s && m.objects === s.objects && m.n === s.objects.length && m.rev === this._charmRev) return m;
    const byType = new Map();
    for (const o of s.objects) {
      if (OBJECTS[o.type]?.kind !== 'decor') continue;
      if (!byType.has(o.type)) byType.set(o.type, []);
      byType.get(o.type).push(o);
    }
    let total = 0;
    const counted = new Map(); // object id → its 💗
    const kinds = {};
    for (const [type, list] of byType) {
      const each = CHARM.of(type);
      const top = [...list].sort((a, b) => (b.gilded ? 1 : 0) - (a.gilded ? 1 : 0) || a.id - b.id).slice(0, CHARM.perKind);
      for (const o of top) { const v = each * (o.gilded ? CHARM.gildMult : 1); counted.set(o.id, v); total += v; }
      kinds[type] = { placed: list.length, counted: top.length, gilded: list.filter((o) => o.gilded).length };
    }
    this._charm = { s, objects: s.objects, n: s.objects.length, rev: this._charmRev, total, kinds, of: (o) => counted.get(o?.id) || 0 };
    return this._charm;
  }

  // an object was placed, removed or gilded: the memo is stale; 'charm' { total } goes out when the total moved
  charmChanged() {
    const before = this._charm?.s === this.s ? this._charm.total : null;
    this._charmRev++;
    if (!this.features.charm || !this.s) return;
    const total = this.charm().total;
    if (total !== before) this.emit('charm', { total });
  }

  // { unlocked (L19), total, ranks (claimed), reached (by today's charm), ready (ranks to claim), next: { rank, need,
  //   reward } | null (the next one to reach), gildUnlocked (L31), vouchers, rosette (rank 10 claimed) }
  charmStatus() {
    const on = !!this.features.charm;
    const c = this.s.charm || {};
    const total = on ? this.charm().total : 0;
    const ranks = c.ranks || 0;
    let reached = 0;
    while (reached < CHARM.ranks && total >= CHARM.rank(reached + 1)) reached++;
    const unlocked = on && this.s.level >= CHARM.level;
    const nr = Math.max(ranks, reached) + 1;
    return {
      unlocked, total, ranks, reached, ready: unlocked ? Math.max(0, reached - ranks) : 0,
      next: nr <= CHARM.ranks ? { rank: nr, need: CHARM.rank(nr), reward: CHARM.rewards[nr - 1] } : null,
      gildUnlocked: on && this.s.level >= CHARM.gildLevel, vouchers: on ? c.vouchers || 0 : 0, rosette: on && ranks >= CHARM.rosetteRank,
    };
  }

  // Claim every rank the farm's charm has reached, in order, through grant('charm'): gems, the Blossom Oak (rank 5)
  // and Frosted Pine (15) to s.gifts, titles. Ranks never go back: removing decor later keeps what was claimed.
  // → [{ rank, gems, gift, title, rosette, tiles }] (empty when nothing is ready)
  claimRibbons() {
    const st = this.charmStatus();
    if (!st.ready) return [];
    const c = this.s.charm;
    const out = [];
    while (c.ranks < st.reached) {
      const rank = c.ranks + 1;
      const rw = CHARM.rewards[rank - 1] || {};
      c.ranks = rank;
      const gift = rw.gift && OBJECTS[rw.gift] ? rw.gift : null;
      const tiles = this.grant('charm', { gems: rw.gems, gift, place: !!gift });
      if (rw.title) this.addTitle(rw.title);
      out.push({ rank, gems: rw.gems || 0, gift, title: rw.title || null, rosette: !!rw.rosette, tiles });
    }
    this.emit('ribbons', { ranks: out });
    this.saveSoon();
    return out;
  }

  // What gilding o costs: null when it can't be gilded (charm off, before L31, already gilded, or not a premium
  // decoration: its base price — the piece it recolours — under 🪙1,500); else { coins, gems, base, voucher }
  // (voucher: a gilding voucher could pay instead).
  gildCost(o) {
    o = this.objById.get(typeof o === 'object' ? o?.id : o);
    if (!o || !this.features.charm || o.gilded || this.s.level < CHARM.gildLevel || OBJECTS[o.type]?.kind !== 'decor') return null;
    const base = CHARM.gildBase(o.type);
    if (base < CHARM.gildMin) return null;
    return { ...CHARM.gildCost(base), base, voucher: (this.s.charm.vouchers || 0) > 0 };
  }

  // Gild a premium decoration: pay coins + gems, or one voucher. It shines gold and counts triple. Selling it later
  // refunds only the usual half price (never the gilding). → { o, voucher, coins, gems } | null
  gild(o, { voucher = false } = {}) {
    o = this.objById.get(typeof o === 'object' ? o?.id : o);
    const cost = o && this.gildCost(o);
    if (!cost) return null;
    const c = this.s.charm;
    if (voucher) {
      if (!(c.vouchers > 0)) return null;
      c.vouchers--;
    } else {
      if (this.s.coins < cost.coins) { this.emit('toast', { text: 'Not enough coins!', type: 'bad' }); return null; }
      if (this.s.gems < cost.gems) { this.emit('toast', { text: 'Not enough gems 💎', type: 'bad' }); return null; }
      this.spend(cost.coins);
      this.spendGems(cost.gems);
    }
    o.gilded = true;
    this.bumpStat('gilded');
    const r = { o, voucher: !!voucher, coins: voucher ? 0 : cost.coins, gems: voucher ? 0 : cost.gems };
    this.emit('objectChanged', o); // the charm memo; the view re-adds it in gold
    this.emit('gild', r);
    this.saveSoon();
    return r;
  }

  // ------------------------------------------------------------ achievements
  achievementStatus(a) {
    const claimed = this.s.achievements[a.id] || 0;
    const tier = a.tiers[Math.min(claimed, a.tiers.length - 1)];
    return { claimed, done: claimed >= a.tiers.length, tier, progress: this.stat(a.stat), ready: claimed < a.tiers.length && this.stat(a.stat) >= tier.goal };
  }

  claimAchievement(id) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    const st = this.achievementStatus(a);
    if (!st.ready) return null;
    this.s.achievements[id] = st.claimed + 1;
    if (st.tier.gems) this.addGems(st.tier.gems);
    if (st.tier.coins) this.addCoins(st.tier.coins, false);
    this.emit('achievement', { a, tier: st.tier });
    this.saveSoon();
    return st.tier;
  }

  achievementsReady() { return ACHIEVEMENTS.filter((a) => this.achievementStatus(a).ready).length; }

  // ------------------------------------------------------------ tutorial state (presentation only)
  // The guide UI reads and writes these; no game rule depends on them.
  tutorialMode() { return this.s.tutorial?.mode || 'independent'; }

  // guided → coached → independent; never moves backwards
  setTutorialMode(mode) {
    const t = this.s.tutorial;
    if (!t || MODES.indexOf(mode) <= MODES.indexOf(t.mode)) return false;
    t.mode = mode;
    this.emit('tutorial', { mode });
    this.syncReveal();
    this.saveSoon();
    return true;
  }

  // one-time flags: 'welcome', 'line:<key>', 'tip:<level>', interrupts ('siloFull', 'firstDrop', …)
  hasSeen(key) { return !!this.s.tutorial?.seen?.[key]; }

  markSeen(key) {
    const t = this.s.tutorial;
    if (!t || t.seen[key]) return false;
    t.seen[key] = true;
    this.saveSoon();
    return true;
  }

  // Skip / "I've farmed before": coached from now on, whole HUD shown, tour lines done.
  skipTutorial() {
    const t = this.s.tutorial;
    if (!t) return;
    t.seen.welcome = true;
    for (const k of TUTORIAL.ch1Lines) t.seen['line:' + k] = true;
    this.setTutorialMode('coached');
    this.reveal('all');
    this.saveSoon();
  }

  // Progressive HUD reveal. Keys: quest, barn, level, gems, orders, shop, tools, today, trophy, camera, post.
  // Everything shows once the tour is over, from level 5, or 2 hours into a new farm.
  revealAll() {
    const t = this.s.tutorial;
    if (!t || t.reveal === 'all' || t.mode !== 'guided') return true;
    return this.s.level >= TUTORIAL.revealAfter.level || this.now() - (t.startedAt || 0) > TUTORIAL.revealAfter.hours * 3600000;
  }

  isRevealed(key) {
    const r = this.s.tutorial?.reveal;
    return this.revealAll() || (Array.isArray(r) && r.includes(key));
  }

  // 'all', or the list of keys revealed so far
  revealedKeys() {
    const r = this.s.tutorial?.reveal;
    return this.revealAll() ? 'all' : [...(r || [])];
  }

  reveal(keys) {
    const t = this.s.tutorial;
    if (!t || t.reveal === 'all') return false;
    if (keys === 'all') {
      t.reveal = 'all';
      this.emit('reveal', 'all');
      this.saveSoon();
      return true;
    }
    const add = [].concat(keys).filter((k) => k && !t.reveal.includes(k));
    if (!add.length) return false;
    t.reveal.push(...add);
    this.emit('reveal', add);
    this.saveSoon();
    return true;
  }

  // turns the reveal list into 'all' once its time has come (runs with ensureOrders)
  syncReveal() {
    const t = this.s.tutorial;
    if (t && t.reveal !== 'all' && this.revealAll()) this.reveal('all');
  }

  // ------------------------------------------------------------ quests
  currentQuest() {
    const i = this.s.quest.index;
    if (i < QUESTS.length) return QUESTS[i];
    // repeat quests are generated once and frozen, so their targets don't move as you level
    const snap = this.s.quest.snap;
    if (snap && snap.index === i) return snap;
    const r = i - QUESTS.length;
    const n = Math.floor(r / REPEAT_QUESTS.length);
    const q = REPEAT_QUESTS[r % REPEAT_QUESTS.length](n, this.s.level);
    q.reward = q.reward || { coins: 40 + n * 25 + this.s.level * 10, xp: 10 + n * 4 + this.s.level * 2 };
    this.s.quest.snap = { ...q, index: i };
    return this.s.quest.snap;
  }

  // Some goals are about what you HAVE, not what you do next — so building the coop early
  // (or owning one from an old save) still completes "Build a Chicken Coop".
  questProgress() {
    const q = this.currentQuest();
    let p = this.s.quest.progress;
    if (q.event === 'level') p = this.s.level;
    else if (q.event === 'build') p = Math.max(p, this.objectCount(q.filter));
    else if (q.event === 'buyAnimal') p = Math.max(p, this.s.animals.filter((a) => a.type === q.filter).length);
    else if (q.event === 'expand') p = Math.max(p, (this.s.landSize - START_LAND) / LAND_STEP);
    else if (q.event === 'feed') p = Math.max(p, this.s.animals.filter((a) => (!q.filter || a.type === q.filter) && this.animalState(a) !== 'hungry').length);
    else if (q.event === 'storage') p = Math.max(p, q.filter ? this.s.storage[q.filter] || 0 : Math.max(...Object.keys(STORAGE).map((id) => this.s.storage[id] || 0)));
    return Math.min(p, q.count);
  }

  questDone() { return this.questProgress() >= this.currentQuest().count; }

  checkQuest() {
    const q = this.currentQuest();
    // chickens already fed count toward "Feed your chickens", and stay counted once their eggs are collected
    if (q.event === 'feed') this.s.quest.progress = Math.max(this.s.quest.progress, this.questProgress());
    this.emit('quest', q);
    if (this.questDone() && !this.s.quest.notified) {
      this.s.quest.notified = true;
      this.emit('questComplete', q);
    }
  }

  progressQuest(event, filter, amount) {
    // daily chores listen to the same events
    const ch = this.s.chores;
    if (ch) for (const c of ch.list) {
      if (c.claimed || c.event !== event || (c.filter && c.filter !== filter)) continue;
      const was = c.progress >= c.count;
      c.progress = Math.min(c.count, c.progress + amount);
      if (!was && c.progress >= c.count) this.emit('choreReady', c);
    }
    const q = this.currentQuest();
    if (q.event !== event) return;
    if (q.filter && q.filter !== filter) return;
    this.s.quest.progress += amount;
    this.checkQuest();
  }

  claimQuest() {
    if (!this.questDone()) return null;
    const q = this.currentQuest();
    // advance first so rewards can't count toward the next goal, then pay out as non-"earned" coins
    this.s.quest.index++;
    this.s.quest.qid = this.qidFor(this.s.quest.index);
    this.s.quest.progress = 0;
    this.s.quest.notified = false;
    if (q.reward.coins) this.addCoins(q.reward.coins, false);
    if (q.reward.xp) this.addXp(q.reward.xp);
    if (q.reward.gems) this.addGems(q.reward.gems);
    for (const [i, n] of Object.entries(q.reward.items || {})) if (this.roomFor(i, n, true)) this.addItem(i, n);
    // the last goal of a chapter opens its chest: gems and a decoration to place for free
    const ch = q.id && CHAPTERS.find((c) => c.last === q.id);
    if (ch) {
      if (ch.reward.gems) this.addGems(ch.reward.gems);
      if (ch.reward.gift) (this.s.gifts ||= []).push(ch.reward.gift);
      this.emit('chapter', { chapter: ch, next: CHAPTERS.find((c) => c.id === ch.id + 1) || null });
    }
    this.checkQuest();
    this.saveSoon();
    return q;
  }

  // the current goal's chapter: { id, name, icon, done, total, last } (null for endless goals)
  questChapter(index = this.s.quest.index) {
    const q = QUESTS[index];
    const ch = q && CHAPTERS.find((c) => c.id === q.chapter);
    if (!ch) return null;
    const list = QUESTS.filter((x) => x.chapter === ch.id);
    const first = QUESTS.indexOf(list[0]);
    return { id: ch.id, name: ch.name, icon: ch.icon, done: index - first, total: list.length, last: ch.last };
  }

  // true once every goal of chapter `id` has been claimed
  chapterDone(id) {
    const ch = CHAPTERS.find((c) => c.id === id);
    const i = ch ? QUESTS.findIndex((x) => x.id === ch.last) : -1;
    return i >= 0 && this.s.quest.index > i;
  }
}

export { key };
