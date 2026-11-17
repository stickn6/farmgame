// Game model: pure data + rules, no rendering. Emits events the view/UI listen to.
import {
  MAP_SIZE, START_LAND, LAND_STEP, landExpandCost, landExpandLevel,
  ITEMS, CROPS, ANIMALS, RECIPES, OBJECTS, QUESTS, REPEAT_QUESTS,
  xpForLevel, producibleItems,
} from './config.js';

const SAVE_KEY = 'sunny-acres-save-v1';
const SAVE_VERSION = 1;

export class Emitter {
  constructor() { this.handlers = {}; }
  on(evt, fn) { (this.handlers[evt] ||= []).push(fn); return () => this.off(evt, fn); }
  off(evt, fn) { this.handlers[evt] = (this.handlers[evt] || []).filter((f) => f !== fn); }
  emit(evt, data) { for (const fn of this.handlers[evt] || []) fn(data); }
}

const key = (x, z) => x + ',' + z;
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export class Game extends Emitter {
  constructor() {
    super();
    this.s = this.load() || this.newGame();
    this.rebuildOccupancy();
    this.ensureOrders();
    this._saveTimer = null;
  }

  // ------------------------------------------------------------ persistence
  newGame() {
    const now = Date.now();
    const s = {
      version: SAVE_VERSION,
      coins: 60,
      xp: 0,
      level: 1,
      landSize: START_LAND,
      soil: {}, // "x,z" -> { crop: null | { type, plantedAt } }
      objects: [],
      animals: [],
      inventory: {},
      orders: [],
      quest: { index: 0, progress: 0 },
      nextId: 1,
      stats: { harvested: 0, orders: 0 },
      settings: { sound: true, music: true },
      createdAt: now,
    };
    this.s = s;
    const lo = this.landLo();
    const addObj = (type, x, z) => s.objects.push({ id: s.nextId++, type, x, z, rot: 0, jobs: [] });
    addObj('farmhouse', lo + 1, lo + 1);
    addObj('orderboard', lo + 5, lo + 1);
    // a few starter decorations
    addObj('oak', lo + 1, lo + 6);
    addObj('oak', lo + 14, lo + 2);
    addObj('pine', lo + 13, lo + 13);
    addObj('flowers', lo + 4, lo + 3);
    addObj('flowers', lo + 4, lo + 1);
    addObj('bush', lo + 1, lo + 14);
    // starter field: a couple of rows of wheat, some almost ready
    for (let x = 0; x < 4; x++) {
      for (let z = 0; z < 2; z++) {
        const k = key(lo + 6 + x, lo + 6 + z);
        s.soil[k] = { crop: { type: 'wheat', plantedAt: now - (z === 0 ? 19000 : 8000) } };
      }
    }
    s.inventory = { wheat: 4 };
    return s;
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.version !== SAVE_VERSION) return null;
      return s;
    } catch (e) {
      console.warn('Failed to load save', e);
      return null;
    }
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.s)); } catch (e) { /* storage may be unavailable */ }
  }

  saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 800);
  }

  reset() {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
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

  // ------------------------------------------------------------ economy
  addCoins(n) {
    this.s.coins += n;
    if (n > 0) this.progressQuest('earn', null, n);
    this.emit('coins', this.s.coins);
    this.saveSoon();
  }

  spend(n) {
    if (this.s.coins < n) { this.emit('toast', { text: 'Not enough coins!', type: 'bad' }); return false; }
    this.s.coins -= n;
    this.emit('coins', this.s.coins);
    return true;
  }

  addXp(n) {
    if (n <= 0) return;
    this.s.xp += n;
    while (this.s.xp >= xpForLevel(this.s.level + 1)) {
      this.s.level++;
      const bonus = 15 * this.s.level;
      this.s.coins += bonus;
      this.emit('levelup', { level: this.s.level, bonus });
      this.emit('coins', this.s.coins);
      this.progressQuest('level', null, 0);
      this.ensureOrders();
    }
    this.emit('xp', this.s.xp);
    this.saveSoon();
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

  // ------------------------------------------------------------ crops
  cropProgress(crop, now = Date.now()) {
    const t = CROPS[crop.type].growTime * 1000;
    return Math.min(1, (now - crop.plantedAt) / t);
  }

  cropStage(crop, now = Date.now()) {
    const p = this.cropProgress(crop, now);
    if (p >= 1) return 3;
    if (p >= 0.6) return 2;
    if (p >= 0.25) return 1;
    return 0;
  }

  plow(x, z) {
    if (!this.inLand(x, z) || this.occ.has(key(x, z)) || this.s.soil[key(x, z)]) return false;
    this.s.soil[key(x, z)] = { crop: null };
    this.emit('soil', { x, z });
    this.progressQuest('plow', null, 1);
    this.saveSoon();
    return true;
  }

  plant(x, z, type) {
    const soil = this.soilAt(x, z);
    const c = CROPS[type];
    if (!soil || soil.crop || !c || c.level > this.s.level) return false;
    if (this.s.coins < c.seedCost) { this.emit('toast', { text: 'Not enough coins for seeds!', type: 'bad' }); return false; }
    this.spend(c.seedCost);
    soil.crop = { type, plantedAt: Date.now() };
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
    soil.crop = null;
    this.addItem(type, c.yield);
    this.addXp(c.xp);
    this.s.stats.harvested += c.yield;
    this.emit('soil', { x, z, harvested: type });
    this.progressQuest('harvest', type, c.yield);
    return { item: type, qty: c.yield, xp: c.xp };
  }

  clearSoil(x, z) {
    if (!this.s.soil[key(x, z)]) return false;
    delete this.s.soil[key(x, z)];
    this.emit('soil', { x, z, cleared: true });
    this.saveSoon();
    return true;
  }

  // ------------------------------------------------------------ objects
  placeObject(type, x, z, rot = 0) {
    const def = OBJECTS[type];
    if (def.level > this.s.level) return null;
    if (!this.canPlace(type, x, z, rot)) return null;
    if (!this.spend(def.cost)) return null;
    const o = { id: this.s.nextId++, type, x, z, rot, jobs: [] };
    this.s.objects.push(o);
    this.rebuildOccupancy();
    this.addXp(def.xp || 1);
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
    if (def.kind !== 'decor') return false;
    const refund = Math.floor(def.cost / 2);
    this.s.objects = this.s.objects.filter((x) => x.id !== id);
    this.rebuildOccupancy();
    this.emit('objectRemoved', o);
    if (refund) this.addCoins(refund);
    this.saveSoon();
    return refund;
  }

  // ------------------------------------------------------------ animals
  animalsIn(homeId) { return this.s.animals.filter((a) => a.home === homeId); }

  animalState(a, now = Date.now()) {
    if (!a.readyAt) return 'hungry';
    return now >= a.readyAt ? 'ready' : 'producing';
  }

  findHomeFor(type) {
    const def = ANIMALS[type];
    for (const o of this.s.objects) {
      if (o.type === def.home && this.animalsIn(o.id).length < OBJECTS[o.type].capacity) return o;
    }
    return null;
  }

  animalCost(type) {
    // each extra animal of the same type costs a bit more
    const owned = this.s.animals.filter((a) => a.type === type).length;
    return Math.round(ANIMALS[type].cost * (1 + owned * 0.15));
  }

  buyAnimal(type) {
    const def = ANIMALS[type];
    if (def.level > this.s.level) return null;
    const home = this.findHomeFor(type);
    if (!home) {
      this.emit('toast', { text: `Build a ${OBJECTS[def.home].name} with free space first!`, type: 'bad' });
      return null;
    }
    if (!this.spend(this.animalCost(type))) return null;
    const a = { id: this.s.nextId++, type, home: home.id, readyAt: 0 };
    this.s.animals.push(a);
    this.addXp(2);
    this.emit('animalAdded', a);
    this.progressQuest('buyAnimal', type, 1);
    this.saveSoon();
    return a;
  }

  feedAnimal(a) {
    const def = ANIMALS[a.type];
    if (this.animalState(a) !== 'hungry') return false;
    if (this.count(def.food) < def.foodQty) return false;
    this.addItem(def.food, -def.foodQty);
    a.readyAt = Date.now() + def.time * 1000;
    this.emit('animalChanged', a);
    this.saveSoon();
    return true;
  }

  collectAnimal(a) {
    if (this.animalState(a) !== 'ready') return null;
    const def = ANIMALS[a.type];
    a.readyAt = 0;
    this.addItem(def.product, 1);
    this.addXp(def.xp);
    this.emit('animalChanged', a);
    this.progressQuest('collect', def.product, 1);
    return { item: def.product, qty: 1, xp: def.xp };
  }

  // ------------------------------------------------------------ production
  factoryQueue(o, now = Date.now()) {
    return o.jobs.map((j) => ({ ...j, done: now >= j.endAt, progress: Math.min(1, Math.max(0, (now - (j.endAt - RECIPES[j.recipe].time * 1000)) / (RECIPES[j.recipe].time * 1000))) }));
  }

  startRecipe(o, recipeId) {
    const r = RECIPES[recipeId];
    const def = OBJECTS[o.type];
    if (r.building !== o.type) return false;
    if (o.jobs.length >= def.queue) { this.emit('toast', { text: 'Queue is full!', type: 'bad' }); return false; }
    if (!this.hasItems(r.inputs)) { this.emit('toast', { text: 'Missing ingredients!', type: 'bad' }); return false; }
    this.takeItems(r.inputs);
    const now = Date.now();
    const last = o.jobs.length ? o.jobs[o.jobs.length - 1].endAt : now;
    o.jobs.push({ recipe: recipeId, endAt: Math.max(now, last) + r.time * 1000 });
    this.emit('factoryChanged', o);
    this.saveSoon();
    return true;
  }

  collectFactory(o) {
    const now = Date.now();
    const done = o.jobs.filter((j) => now >= j.endAt);
    if (!done.length) return null;
    o.jobs = o.jobs.filter((j) => now < j.endAt);
    const got = {};
    let xp = 0;
    for (const j of done) {
      got[j.recipe] = (got[j.recipe] || 0) + 1;
      this.addItem(j.recipe, 1);
      xp += RECIPES[j.recipe].xp;
      this.progressQuest('produce', j.recipe, 1);
    }
    this.addXp(xp);
    this.emit('factoryChanged', o);
    return { got, xp };
  }

  // ------------------------------------------------------------ orders
  generateOrder() {
    const pool = producibleItems(this.s.level);
    // favour recent unlocks a bit less, keep it fun: 1-3 different items
    const n = Math.min(pool.length, rand(1, this.s.level < 3 ? 2 : 3));
    const chosen = new Set();
    while (chosen.size < n) chosen.add(pool[Math.floor(Math.random() * pool.length)]);
    const items = {};
    let value = 0;
    for (const id of chosen) {
      const price = ITEMS[id].price;
      const max = price < 6 ? 8 : price < 20 ? 4 : price < 60 ? 3 : 2;
      const qty = rand(1, max);
      items[id] = qty;
      value += qty * price;
    }
    return {
      id: this.s.nextId++,
      items,
      coins: Math.round(value * 1.5 + 5),
      xp: Math.max(2, Math.round(value / 5)),
    };
  }

  ensureOrders() {
    const now = Date.now();
    while (this.s.orders.length < 4) this.s.orders.push(this.generateOrder());
    let changed = false;
    this.s.orders = this.s.orders.map((o) => {
      if (o.waitUntil && now >= o.waitUntil) { changed = true; return this.generateOrder(); }
      return o;
    });
    if (changed) this.emit('orders', this.s.orders);
  }

  fulfillOrder(id) {
    const o = this.s.orders.find((x) => x.id === id);
    if (!o || o.waitUntil) return false;
    if (!this.takeItems(o.items)) { this.emit('toast', { text: 'You don\'t have everything yet', type: 'bad' }); return false; }
    this.addCoins(o.coins);
    this.addXp(o.xp);
    this.s.stats.orders++;
    const idx = this.s.orders.indexOf(o);
    this.s.orders[idx] = { id: this.s.nextId++, waitUntil: Date.now() + 10000 };
    this.emit('orderDone', o);
    this.emit('orders', this.s.orders);
    this.progressQuest('order', null, 1);
    this.saveSoon();
    return o;
  }

  discardOrder(id) {
    const idx = this.s.orders.findIndex((x) => x.id === id);
    if (idx < 0) return;
    this.s.orders[idx] = { id: this.s.nextId++, waitUntil: Date.now() + 20000 };
    this.emit('orders', this.s.orders);
    this.saveSoon();
  }

  // ------------------------------------------------------------ land expansion
  nextExpansion() {
    if (this.s.landSize >= MAP_SIZE) return null;
    return { cost: landExpandCost(this.s.landSize), level: landExpandLevel(this.s.landSize), size: this.s.landSize + LAND_STEP };
  }

  expandLand() {
    const e = this.nextExpansion();
    if (!e) return false;
    if (this.s.level < e.level) { this.emit('toast', { text: `Reach level ${e.level} to expand`, type: 'bad' }); return false; }
    if (!this.spend(e.cost)) return false;
    this.s.landSize = e.size;
    this.addXp(10);
    this.emit('land', this.s.landSize);
    this.progressQuest('expand', null, 1);
    this.saveSoon();
    return true;
  }

  // ------------------------------------------------------------ quests
  currentQuest() {
    const i = this.s.quest.index;
    if (i < QUESTS.length) return QUESTS[i];
    const r = i - QUESTS.length;
    const n = Math.floor(r / REPEAT_QUESTS.length);
    const q = REPEAT_QUESTS[r % REPEAT_QUESTS.length](n);
    q.reward = { coins: 60 + n * 40, xp: 12 + n * 6 };
    return q;
  }

  questProgress() {
    const q = this.currentQuest();
    if (q.absolute && q.event === 'level') return Math.min(this.s.level, q.count);
    return Math.min(this.s.quest.progress, q.count);
  }

  questDone() { return this.questProgress() >= this.currentQuest().count; }

  progressQuest(event, filter, amount) {
    const q = this.currentQuest();
    if (q.event !== event) return;
    if (q.filter && q.filter !== filter) return;
    const wasDone = event === 'level' ? this.s.level - 1 >= q.count : this.questDone();
    this.s.quest.progress += amount;
    this.emit('quest', q);
    if (!wasDone && this.questDone()) this.emit('questComplete', q);
  }

  claimQuest() {
    if (!this.questDone()) return null;
    const q = this.currentQuest();
    this.s.quest.index++;
    this.s.quest.progress = 0;
    if (q.reward.coins) this.addCoins(q.reward.coins);
    if (q.reward.xp) this.addXp(q.reward.xp);
    this.emit('quest', this.currentQuest());
    this.saveSoon();
    return q;
  }
}

export { key };
