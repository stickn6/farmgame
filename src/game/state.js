// Game model: pure data + rules, no rendering. Emits events the view/UI listen to.
// Everything numeric comes from config.js so balancing never touches this file.
import {
  MAP_SIZE, START_LAND, LAND_STEP, LAND, PLOTS, STORAGE, DROPS, GEMS, DAILY, ACHIEVEMENTS, MASTERY, VISITORS, QUEUE_SLOTS,
  CHORES, WAGON, PROJECTS, PROJECT_REWARD, MAX_CROP_SPEEDUP, xpToNext,
  ITEMS, CROPS, ANIMALS, RECIPES, OBJECTS, QUESTS, REPEAT_QUESTS, ORDERS, START,
  xpForLevel, producibleItems, levelUpReward,
} from './config.js';

const SAVE_KEY = 'sunny-acres-save-v1';
const BACKUP_KEY = 'sunny-acres-save-v1-backup';

// What v1 (the first release) had unlocked at each level, and its crop timers —
// used to grandfather unlocks and keep ripe crops ripe when migrating old saves.
const V1 = {
  crops: { wheat: [1, 20], carrot: [1, 45], corn: [3, 90], sunflower: [5, 150], tomato: [6, 200], strawberry: [7, 300], pumpkin: [9, 420] },
  animals: { chicken: 2, cow: 4, sheep: 6 },
  recipes: { bread: 3, cookie: 3, pie: 3, butter: 5, cheese: 5, sweater: 7 },
};
const SAVE_VERSION = 2;
const DAY_MS = 86400000;

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
  constructor(opts = {}) {
    super();
    this.clock = opts.clock || (() => Date.now());
    this.storage = opts.storage !== undefined ? opts.storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    this.s = this.load() || this.newGame();
    this.rebuildOccupancy();
    this.ensureOrders();
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
      quest: { index: 0, progress: 0, notified: false },
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
      settings: { sound: true, music: true },
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
    // starter field: a couple of rows of wheat, some almost ready
    const g = CROPS.wheat.growTime * 1000;
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 2; z++) {
        s.soil[key(lo + 6 + x, lo + 6 + z)] = { crop: { type: 'wheat', plantedAt: now - (z === 0 ? g - 1500 : g * 0.4) } };
      }
    }
    s.inventory = { ...START.inventory };
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
      return this.migrate(s);
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
      s.quest = { index: qi < QMAP.length ? QMAP[qi] : QUESTS.length, progress: 0 };
      // a little welcome-back gift for veterans
      s.gems = (s.gems || 0) + 5 + s.level;
      s.version = 2;
    }
    return s;
  }

  save() {
    if (!this.storage || this.resetting) return;
    this.s.lastSeen = Math.max(this.s.lastSeen || 0, this.clock());
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

  // one-tap relief when storage is full: sell everything above `keep` of each item (never materials)
  sellExtras(id, keep = 10) {
    let earned = 0;
    for (const [item, n] of Object.entries(this.s.inventory)) {
      if (this.storageOf(item) !== id || n <= keep) continue;
      earned += this.sell(item, n - keep);
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
    return { item: type, qty, xp: c.xp, drop };
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
    if (!o) return false;
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
    this.saveSoon();
    return { item: def.fruit, qty: def.yield, xp: def.harvestXp, drop, dead: this.treeState(o) === 'dead' };
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
    // animals that don't need food (bees) start their next cycle right away
    if (!def.food) this.feedAnimal(a);
    return { item: def.product, qty: 1, xp: def.xp, drop };
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
    this.emit('factoryChanged', o);
    return { got, xp, drop };
  }

  // ------------------------------------------------------------ gems / speed-ups
  speedUpCost(msLeft) { return msLeft <= 0 ? 0 : GEMS.speedUp(msLeft / 1000); }

  speedUpFactory(o) {
    const now = this.now();
    const j = o.jobs.find((x) => x.endAt > now);
    if (!j) return false;
    const left = j.endAt - now;
    const cost = this.speedUpCost(left);
    if (!this.spendGems(cost)) return false;
    // the whole queue after this job shifts forward too
    for (const x of o.jobs) if (x.endAt >= j.endAt) x.endAt -= left;
    this.emit('factoryChanged', o);
    this.saveSoon();
    return true;
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
    const npc = npcs[Math.floor(Math.random() * npcs.length)];
    // visitors prefer their favourite category, else anything
    const fav = pool.filter((i) => npc.likes.includes(ITEMS[i].cat));
    const from = fav.length ? fav : pool;
    const item = from[Math.floor(Math.random() * from.length)];
    let qty = rand(1, ORDERS.maxQty(ITEMS[item].price, this.s.level));
    while (ITEMS[item].price * qty < VISITORS.minValue(this.s.level) && qty < 99) qty++;
    const value = ITEMS[item].price * qty;
    const bonus = (this.s.hearts[npc.id] || 0) >= VISITORS.maxHearts ? 1 + VISITORS.heartBonusPay : 1;
    return {
      id: this.s.nextId++,
      npc: npc.id,
      item,
      qty,
      coins: Math.round(value * VISITORS.coinMult * bonus),
      xp: Math.max(1, Math.round(value * VISITORS.xpMult)),
      arrivedAt,
      leavesAt: null, // villagers wait until you serve or dismiss them
    };
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
    return Math.min(p, q.count);
  }

  questDone() { return this.questProgress() >= this.currentQuest().count; }

  checkQuest() {
    const q = this.currentQuest();
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
    this.s.quest.progress = 0;
    this.s.quest.notified = false;
    if (q.reward.coins) this.addCoins(q.reward.coins, false);
    if (q.reward.xp) this.addXp(q.reward.xp);
    if (q.reward.gems) this.addGems(q.reward.gems);
    for (const [i, n] of Object.entries(q.reward.items || {})) if (this.roomFor(i, n, true)) this.addItem(i, n);
    this.checkQuest();
    this.saveSoon();
    return q;
  }
}

export { key };
