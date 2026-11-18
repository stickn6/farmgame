// Rules tests for the game model (runs in Node, no browser):  npm test
import assert from 'node:assert/strict';
import { Game } from '../src/game/state.js';
import * as CFG from '../src/game/config.js';

let t = Date.UTC(2026, 0, 1, 8);
const clock = () => t;
const advance = (sec) => { t += sec * 1000; };

class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const fresh = (storage = null) => new Game({ clock, storage });

test('new game starts sane', () => {
  const g = fresh();
  assert.equal(g.s.level, 1);
  assert.ok(g.s.coins > 0);
  assert.ok(g.s.objects.some((o) => o.type === 'farmhouse'));
  assert.ok(g.s.orders.length > 0);
});

test('plow, plant, grow, harvest', () => {
  const g = fresh();
  const lo = g.landLo();
  let spot = null;
  for (let x = lo; x <= g.landHi() && !spot; x++) for (let z = lo; z <= g.landHi() && !spot; z++) if (!g.objectAt(x, z) && !g.soilAt(x, z)) spot = [x, z];
  const [x, z] = spot;
  assert.ok(g.plow(x, z), 'plow');
  const before = g.count('wheat');
  assert.ok(g.plant(x, z, 'wheat'), 'plant');
  assert.equal(g.harvest(x, z), null, 'cannot harvest unripe');
  advance(CFG.CROPS.wheat.growTime + 1);
  const r = g.harvest(x, z);
  assert.ok(r, 'harvest ripe');
  assert.ok(g.count('wheat') > before);
});

test('cannot plant locked crop', () => {
  const g = fresh();
  const locked = Object.entries(CFG.CROPS).find(([, c]) => c.level > 1);
  if (!locked) return;
  const k = Object.keys(g.s.soil).find((k) => !g.s.soil[k].crop) || null;
  const lo = g.landLo();
  let x, z;
  if (k) [x, z] = k.split(',').map(Number);
  else { for (x = lo; x <= g.landHi(); x++) { z = g.landHi(); if (g.plow(x, z)) break; } }
  assert.equal(g.plant(x, z, locked[0]), false);
});

test('coins and inventory never go negative', () => {
  const g = fresh();
  g.s.coins = 0;
  assert.equal(g.spend(10), false);
  assert.equal(g.s.coins, 0);
  assert.equal(g.sell('wheat', 999999) >= 0, true);
  for (const v of Object.values(g.s.inventory)) assert.ok(v >= 0);
});

test('save round-trips', () => {
  const st = new MemStorage();
  const g = fresh(st);
  g.addCoins(123);
  g.save();
  const g2 = fresh(st);
  assert.equal(g2.s.coins, g.s.coins);
  assert.deepEqual(g2.s.inventory, g.s.inventory);
});

test('xp curve is strictly increasing', () => {
  for (let l = 2; l < 60; l++) assert.ok(CFG.xpForLevel(l + 1) > CFG.xpForLevel(l));
});

test('every unlockable content references valid data', () => {
  for (const [id, c] of Object.entries(CFG.CROPS)) assert.ok(CFG.ITEMS[id], `item for crop ${id}`);
  for (const [id, a] of Object.entries(CFG.ANIMALS)) {
    if (a.food !== null) assert.ok(CFG.ITEMS[a.food], `food for ${id}`);
    assert.ok(CFG.ITEMS[a.product], `product for ${id}`);
    assert.ok(CFG.OBJECTS[a.home], `home for ${id}`);
  }
  for (const [id, r] of Object.entries(CFG.RECIPES)) {
    assert.ok(CFG.ITEMS[id], `item for recipe ${id}`);
    assert.ok(CFG.OBJECTS[r.building], `building for recipe ${id}`);
    for (const i of Object.keys(r.inputs)) assert.ok(CFG.ITEMS[i], `input ${i} of ${id}`);
  }
});

test('orders only ask for producible items', () => {
  const g = fresh();
  for (let i = 0; i < 50; i++) {
    const o = g.generateOrder();
    const pool = CFG.producibleItems(g.s.level);
    for (const k of Object.keys(o.items)) assert.ok(pool.includes(k), `order item ${k} producible at L${g.s.level}`);
  }
});

// ---------------------------------------------------------------- v2 systems
const freeTile = (g) => {
  for (let x = g.landLo(); x <= g.landHi(); x++) for (let z = g.landLo(); z <= g.landHi(); z++) if (!g.objectAt(x, z) && !g.soilAt(x, z)) return [x, z];
  return null;
};

test('every item has a category, price and a storage', () => {
  for (const [id, it] of Object.entries(CFG.ITEMS)) {
    assert.ok(it.cat, `cat for ${id}`);
    assert.ok(Number.isFinite(it.price) && it.price > 0, `price for ${id}`);
    if (it.cat !== 'material') assert.ok(Object.values(CFG.STORAGE).some((st) => st.cats.includes(it.cat)), `storage for ${id}`);
  }
});

test('every object/pen/factory has sane config', () => {
  for (const [id, o] of Object.entries(CFG.OBJECTS)) {
    assert.ok(Array.isArray(o.size) && o.size.length === 2, `size ${id}`);
    if (o.kind === 'pen') assert.ok(CFG.ANIMALS[o.animal] && o.capacity > 0, `pen ${id}`);
    if (o.kind === 'factory') assert.ok(Object.values(CFG.RECIPES).some((r) => r.building === id), `factory ${id} has recipes`);
    if (o.kind === 'tree') assert.ok(CFG.ITEMS[o.fruit] && o.harvests > 0 && o.growTime > 0, `tree ${id}`);
  }
});

test('field cap blocks plowing beyond the limit', () => {
  const g = fresh();
  g.s.coins = 1e6;
  let guard = 0;
  while (g.plotCount() < g.plotCap() && guard++ < 500) { const t = freeTile(g); g.plow(t[0], t[1]); }
  assert.equal(g.plotCount(), g.plotCap());
  const t = freeTile(g);
  assert.equal(g.plow(t[0], t[1]), false);
});

test('plowing costs escalate', () => {
  assert.ok(CFG.PLOTS.cost(30) > CFG.PLOTS.cost(15));
  assert.ok(CFG.PLOTS.cap(20) > CFG.PLOTS.cap(5));
});

test('full silo blocks harvest and upgrade raises capacity', () => {
  const g = fresh();
  const cap = g.storageCap('silo');
  g.s.inventory.wheat = cap; // fill silo
  const k = Object.keys(g.s.soil)[0];
  const [x, z] = k.split(',').map(Number);
  g.s.soil[k].crop = { type: 'wheat', plantedAt: t - 1e9 };
  assert.equal(g.harvest(x, z), null, 'no room');
  let up = g.nextStorageUpgrade('silo');
  assert.ok(up.locked, 'tier 1 needs a level');
  assert.equal(g.upgradeStorage('silo'), false);
  g.addXp(CFG.xpForLevel(up.needLevel));
  up = g.nextStorageUpgrade('silo');
  g.s.coins = up.coins;
  for (const [i, n] of Object.entries(up.items)) g.s.inventory[i] = n;
  assert.ok(g.upgradeStorage('silo'));
  assert.ok(g.storageCap('silo') > cap);
  assert.ok(g.harvest(x, z), 'harvest after upgrade');
});

test('materials are uncapped (toolshed); crops go to the silo', () => {
  const g = fresh();
  assert.equal(g.storageOf('bolt'), null);
  assert.equal(g.spaceFor('bolt'), Infinity);
  assert.equal(g.storageOf('wheat'), 'silo');
  assert.equal(g.storageOf('apple'), 'silo');
});

test('building limits per level', () => {
  const g = fresh();
  g.s.coins = 1e7; g.addXp(CFG.xpForLevel(3));
  assert.equal(g.objectLimit('coop'), 1);
  const a = g.findFreeSpot('coop');
  assert.ok(g.placeObject('coop', a[0], a[1]));
  const b = g.findFreeSpot('coop');
  assert.equal(g.placeObject('coop', b[0], b[1]), null, 'second coop blocked at low level');
});

test('fruit tree lifecycle', () => {
  const g = fresh();
  g.s.coins = 1e7; g.addXp(CFG.xpForLevel(CFG.OBJECTS.appletree.level));
  const sp = g.findFreeSpot('appletree');
  const o = g.placeObject('appletree', sp[0], sp[1]);
  assert.ok(o);
  assert.equal(g.treeState(o), 'growing');
  advance(CFG.OBJECTS.appletree.growTime + 1);
  assert.equal(g.treeState(o), 'ready');
  for (let i = 0; i < CFG.OBJECTS.appletree.harvests; i++) {
    g.s.inventory = {};
    assert.ok(g.harvestTree(o), 'harvest ' + i);
    advance(CFG.OBJECTS.appletree.fruitTime + 1);
  }
  assert.equal(g.treeState(o), 'dead');
  assert.equal(g.harvestTree(o), null);
  assert.ok(g.removeObject(o.id) !== false);
});

test('visitors arrive, can be served, and leave', () => {
  const g = fresh();
  g.addXp(CFG.xpForLevel(CFG.VISITORS.level));
  advance(CFG.VISITORS.firstDelay + 5);
  g.ensureVisitors();
  assert.ok(g.s.visitors.length >= 1, 'arrived');
  const v = g.s.visitors[0];
  g.s.inventory[v.item] = v.qty;
  const coins = g.s.coins;
  assert.ok(g.serveVisitor(v.id));
  assert.ok(g.s.coins > coins);
  const waiting = g.s.visitors.length;
  advance(10 * 3600); // villagers never leave on their own
  g.ensureVisitors();
  assert.ok(g.s.visitors.length >= waiting);
  for (const x of g.s.visitors) assert.equal(x.leavesAt, null);
  // dismissing sends that villager away for a while
  const d = g.s.visitors[0];
  g.dismissVisitor(d.id);
  assert.ok(g.s.visitorAway[d.npc] > g.now());
  assert.ok(!g.availableNpcs().some((n) => n.id === d.npc));
});

test('daily gift: once per day, streak continues next day', () => {
  const g = fresh();
  const a = g.claimDaily();
  assert.ok(a);
  assert.equal(g.claimDaily(), null);
  advance(86400);
  const b = g.claimDaily();
  assert.equal(b.streak, 2);
  advance(86400 * 3);
  assert.equal(g.claimDaily().streak, 3, 'missing days never resets the calendar');
});

test('achievements become claimable and pay gems', () => {
  const g = fresh();
  const a = CFG.ACHIEVEMENTS[0];
  g.bumpStat(a.stat, a.tiers[0].goal);
  assert.ok(g.achievementStatus(a).ready);
  const gems = g.s.gems;
  assert.ok(g.claimAchievement(a.id));
  assert.equal(g.s.gems, gems + a.tiers[0].gems);
  assert.equal(g.achievementStatus(a).ready, false);
});

test('mastery stars speed up crops', () => {
  const g = fresh();
  const base = g.cropTime('wheat');
  g.s.mastery.wheat = CFG.MASTERY.thresholds('wheat')[0];
  assert.ok(g.cropTime('wheat') < base);
});

test('material drops follow xp with a pity guarantee', () => {
  const g = fresh();
  g.addXp(CFG.xpForLevel(8));
  const before = g.stat('materials');
  const d = CFG.DROPS.divisor(g.s.level);
  const rnd = Math.random; Math.random = () => 0.999999; // never "lucky"
  for (let i = 0; i < 3; i++) g.rollDrop('harvest', d);
  Math.random = rnd;
  assert.ok(g.stat('materials') > before, 'pity meter forces a drop');
});

test('queue slots: coins need the level, gems do not', () => {
  const g = fresh();
  g.s.coins = 1e7; g.s.gems = 0; g.addXp(CFG.xpForLevel(5));
  const sp = g.findFreeSpot('bakery');
  const o = g.placeObject('bakery', sp[0], sp[1]);
  const c = g.extraSlotCost(o);
  if (g.s.level < c.level) assert.equal(g.buyExtraSlot(o), false);
  g.s.gems = c.gems;
  assert.ok(g.buyExtraSlot(o, true));
  assert.equal(g.queueSize(o), CFG.OBJECTS.bakery.queue + 1);
});

test('gem speed-up finishes production', () => {
  const g = fresh();
  g.s.coins = 1e7; g.s.gems = 1000; g.addXp(CFG.xpForLevel(5));
  const sp = g.findFreeSpot('bakery');
  const o = g.placeObject('bakery', sp[0], sp[1]);
  g.s.inventory.wheat = 30;
  assert.ok(g.startRecipe(o, 'bread'));
  assert.ok(g.speedUpFactory(o));
  assert.ok(g.collectFactory(o));
});

test('land expansion needs level, coins and deeds', () => {
  const g = fresh();
  const e = g.nextExpansion();
  g.s.coins = 1e7;
  assert.equal(g.expandLand(), false, 'level gate');
  g.addXp(CFG.xpForLevel(e.level));
  assert.equal(g.expandLand(), false, 'material gate');
  for (const [i, n] of Object.entries(e.items)) g.s.inventory[i] = n;
  assert.ok(g.expandLand());
  assert.equal(g.s.landSize, CFG.START_LAND + CFG.LAND_STEP);
});

test('v1 saves migrate without losing progress', () => {
  const st = new MemStorage();
  const v1 = {
    version: 1, coins: 777, xp: 300, level: 6, landSize: 20,
    soil: { '10,10': { crop: { type: 'wheat', plantedAt: t } } },
    objects: [{ id: 1, type: 'farmhouse', x: 7, z: 7, rot: 0, jobs: [] }, { id: 2, type: 'orderboard', x: 11, z: 7, rot: 0, jobs: [] }, { id: 3, type: 'coop', x: 14, z: 14, rot: 0, jobs: [] }],
    animals: [{ id: 4, type: 'chicken', home: 3, readyAt: 0 }],
    inventory: { wheat: 400, egg: 300 }, orders: [], quest: { index: 3, progress: 1 }, nextId: 10,
    stats: { harvested: 50, orders: 3 }, settings: { sound: true, music: false }, createdAt: t,
  };
  st.setItem('sunny-acres-save-v1', JSON.stringify(v1));
  const g = fresh(st);
  assert.equal(g.s.version, 2);
  assert.equal(g.s.coins, 777);
  assert.equal(g.s.level, 6, 'level kept');
  assert.ok(g.s.xp >= CFG.xpForLevel(6));
  assert.equal(g.s.animals.length, 1);
  assert.ok(g.s.objects.some((o) => o.type === 'storagebarn'), 'barn added');
  assert.ok(g.s.objects.some((o) => o.type === 'silo'), 'silo added');
  assert.ok(g.storageCap('silo') >= 400 && g.storageCap('barn') >= 300, 'storage grown to fit old inventory');
  assert.equal(g.s.settings.music, false);
  assert.ok(typeof g.s.gems === 'number');
  // crop that was ripe under v1 timers is still ripe
  const crop = g.s.soil['10,10'].crop;
  assert.equal(g.cropStage(crop), 0, 'planted just now stays unripe');
  // grandfathered unlocks: v1 L6 had tomato & sheep; new levels are higher
  assert.ok(g.isUnlocked('crops', 'tomato'), 'tomato grandfathered');
  assert.ok(g.isUnlocked('animals', 'sheep'), 'sheep grandfathered');
  assert.equal(g.animalFood('sheep').item, 'carrot', 'sheep eat carrots until potatoes unlock');
  assert.ok(st.getItem('sunny-acres-save-v1-backup'), 'raw v1 backup kept');
});

test('v1 ripe crops stay ripe after migration', () => {
  const st = new MemStorage();
  const v1 = { version: 1, coins: 10, xp: 0, level: 9, landSize: 16, soil: { '10,10': { crop: { type: 'pumpkin', plantedAt: t - 500 * 1000 } } },
    objects: [{ id: 1, type: 'farmhouse', x: 9, z: 9, rot: 0, jobs: [] }], animals: [], inventory: {}, orders: [], quest: { index: 0, progress: 0 }, nextId: 5, stats: { harvested: 0, orders: 0 }, settings: { sound: true, music: true }, createdAt: t };
  st.setItem('sunny-acres-save-v1', JSON.stringify(v1));
  const g = fresh(st);
  assert.equal(g.cropStage(g.s.soil['10,10'].crop), 3, 'pumpkin ripe under v1 (420s) is ripe now');
});

// ---------------------------------------------------------------- regressions from review
test('build quests count buildings you already own (no soft-lock)', () => {
  const g = fresh();
  g.s.coins = 1e6; g.addXp(CFG.xpForLevel(3));
  const sp = g.findFreeSpot('coop');
  g.placeObject('coop', sp[0], sp[1]); // built BEFORE the quest is current
  g.s.quest = { index: CFG.QUESTS.findIndex((q) => q.event === 'build' && q.filter === 'coop'), progress: 0 };
  assert.ok(g.questDone(), 'already-owned coop completes the quest');
});

test('repeat quests are frozen when they start', () => {
  const g = fresh();
  g.s.quest = { index: CFG.QUESTS.length, progress: 0 };
  const a = g.currentQuest().count;
  g.addXp(CFG.xpForLevel(12));
  assert.equal(g.currentQuest().count, a, 'target does not move with level');
});

test('quest rewards do not count toward the next earn goal', () => {
  const g = fresh();
  const earnIdx = CFG.QUESTS.length + CFG.REPEAT_QUESTS.findIndex((f) => f(0, 1).event === 'earn');
  g.s.quest = { index: earnIdx - 1, progress: 0 };
  const q = g.currentQuest();
  g.s.quest.progress = q.count; g.s.level = Math.max(g.s.level, q.count || 1);
  if (g.questDone()) { g.claimQuest(); assert.equal(g.questProgress(), 0); }
});

test('decor gives no xp (no place/remove xp loop)', () => {
  const g = fresh();
  const xp = g.s.xp;
  const sp = g.findFreeSpot('path');
  const o = g.placeObject('path', sp[0], sp[1]);
  g.removeObject(o.id);
  assert.equal(g.s.xp, xp);
});

test('reset cannot be undone by an autosave during reload', () => {
  const st = new MemStorage();
  const g = fresh(st);
  g.addCoins(999); g.save();
  globalThis.location = { reload() {} };
  g.reset();
  g.save(); // what pagehide would do
  assert.equal(st.getItem('sunny-acres-save-v1'), null);
  delete globalThis.location;
});

test('bees start producing as soon as they are bought', () => {
  const g = fresh();
  g.s.coins = 1e7; g.addXp(CFG.xpForLevel(CFG.ANIMALS.bee.level));
  const sp = g.findFreeSpot('apiary');
  g.placeObject('apiary', sp[0], sp[1]);
  const a = g.buyAnimal('bee');
  assert.equal(g.animalState(a), 'producing');
});

test('first visitor after unlocking stays a long time', () => {
  const g = fresh();
  advance(3 * 3600);
  g.ensureVisitors(); // below level: keeps the timer fresh
  g.addXp(CFG.xpForLevel(CFG.VISITORS.level));
  advance(CFG.VISITORS.firstDelay + 1);
  g.ensureVisitors();
  const v = g.s.visitors[0];
  assert.ok(v && v.leavesAt === null, 'arrived and waits');
});

test('mastery bonus never blocks a harvest that fits', () => {
  const g = fresh();
  g.s.mastery.wheat = 1e6; // 3 stars
  g.s.inventory.wheat = g.storageCap('silo') - CFG.CROPS.wheat.yield;
  const k = Object.keys(g.s.soil)[0];
  const [x, z] = k.split(',').map(Number);
  g.s.soil[k].crop = { type: 'wheat', plantedAt: t - 1e9 };
  assert.ok(g.harvest(x, z));
});

// ---------------------------------------------------------------- merged-design features
test('daily chores: generated per day, progress from play, claim pays, all-done bonus', () => {
  const g = fresh();
  g.addXp(CFG.xpForLevel(CFG.CHORES.level));
  g.ensureChores();
  assert.equal(g.s.chores.list.length, CFG.CHORES.perDay);
  for (const c of g.s.chores.list) c.progress = c.count; // pretend we played
  const gems = g.s.gems;
  for (let i = 0; i < CFG.CHORES.perDay; i++) assert.ok(g.claimChore(i));
  assert.ok(g.s.gems > gems, 'all-done bonus');
  assert.equal(g.claimChore(0), null, 'no double claim');
  advance(86400 + 60);
  g.ensureChores();
  assert.ok(g.s.chores.list.every((c) => !c.claimed), 'new day, new chores');
});

test('chore progress follows real actions', () => {
  const g = fresh();
  g.addXp(CFG.xpForLevel(CFG.CHORES.level));
  g.ensureChores();
  g.s.chores.list[0] = { tpl: 'harvest', text: 'x', event: 'harvest', count: 2, progress: 0, claimed: false, xp: 1, coins: 1 };
  const k = Object.keys(g.s.soil)[0];
  const [x, z] = k.split(',').map(Number);
  g.s.soil[k].crop = { type: 'wheat', plantedAt: t - 1e9 };
  g.harvest(x, z);
  assert.equal(g.s.chores.list[0].progress, 2);
});

test('market wagon: arrives at its level, crates pay, full wagon leaves with a bonus and returns', () => {
  const g = fresh();
  g.addXp(CFG.xpForLevel(CFG.WAGON.level));
  g.ensureWagon();
  const w = g.s.wagon;
  assert.equal(w.state, 'here');
  assert.equal(w.crates.length, CFG.WAGON.crates(g.s.level));
  for (const c of w.crates) g.s.inventory[c.item] = (g.s.inventory[c.item] || 0) + c.qty;
  const coins = g.s.coins;
  let last;
  for (let i = 0; i < w.crates.length; i++) last = g.fillCrate(i);
  assert.ok(g.s.coins > coins);
  assert.ok(last.bonus, 'full wagon bonus');
  assert.equal(g.s.wagon.state, 'away');
  advance(CFG.WAGON.away + 1);
  g.ensureWagon();
  assert.equal(g.s.wagon.state, 'here', 'came back');
});

test('wagon leaves on its own after its stay', () => {
  const g = fresh();
  g.addXp(CFG.xpForLevel(CFG.WAGON.level));
  g.ensureWagon();
  advance(CFG.WAGON.stay + 1);
  g.ensureWagon();
  assert.equal(g.s.wagon.state, 'away');
});

test('village project: partial donations, stage completes, perk applies when finished', () => {
  const g = fresh();
  const def = CFG.PROJECTS.bridge;
  g.addXp(CFG.xpForLevel(def.level));
  g.s.coins = 1e7;
  const base = g.visitorInterval();
  for (let st = 0; st < def.stages.length; st++) {
    const need = g.projectNeeds('bridge');
    assert.ok(g.contribute('bridge', 'coins', Math.floor(need.coins / 2)));
    assert.ok(g.contribute('bridge', 'coins', need.coins));
    for (const [i, n] of Object.entries(need.items)) { g.s.inventory[i] = n; g.contribute('bridge', i, n); }
    assert.equal(g.project('bridge').stage, st + 1);
  }
  assert.ok(g.visitorInterval() < base, 'perk: visitors come more often');
  assert.equal(g.projectNeeds('bridge'), null, 'finished');
});

test('friendship hearts grow and reward milestones', () => {
  const g = fresh();
  const gems = g.s.gems;
  g.addHearts('rosa', 3);
  assert.equal(g.s.hearts.rosa, 3);
  assert.ok(g.s.gems > gems);
  g.addHearts('rosa', 100);
  assert.equal(g.s.hearts.rosa, CFG.VISITORS.maxHearts);
});

test('clearing a field refunds what it cost to plow', () => {
  const g = fresh();
  g.s.coins = 1000;
  const t2 = freeTile(g);
  const cost = g.plowCost();
  g.plow(t2[0], t2[1]);
  const after = g.s.coins;
  g.clearSoil(t2[0], t2[1]);
  assert.equal(g.s.coins, after + cost);
});

test('orders meet a minimum value and have no flat bonus', () => {
  const g = fresh();
  for (let i = 0; i < 40; i++) {
    const o = g.generateOrder();
    const v = Object.entries(o.items).reduce((s, [k, n]) => s + CFG.ITEMS[k].price * n, 0);
    assert.ok(v >= CFG.ORDERS.minValue(g.s.level));
    assert.equal(o.coins, Math.round(v * CFG.ORDERS.coinMult));
  }
});

test('clock rewinds cannot undo time', () => {
  const st = new MemStorage();
  const g = fresh(st);
  g.save();
  const real = g.now();
  t -= 3600 * 1000; // player sets the clock back an hour
  assert.ok(g.now() >= real - 5 * 60000);
  t += 3600 * 1000;
});

test('daily gift needs a new day AND 16 hours', () => {
  const g = fresh();
  // claim late in the evening, then try again just after midnight
  const evening = new Date(t); evening.setHours(23, 0, 0, 0);
  t = Math.max(t, evening.getTime());
  g.claimDaily();
  advance(2 * 3600);
  assert.equal(g.dailyStatus().canClaim, false);
  advance(15 * 3600);
  assert.equal(g.dailyStatus().canClaim, true);
});

test('every level 2..30 unlocks something', () => {
  for (let l = 2; l <= 30; l++) assert.ok(CFG.unlocksAtLevel(l).length > 0, 'L' + l);
});

test('wagon never crashes at very high levels and catches up after long absences', () => {
  const g = fresh();
  g.addXp(CFG.xpForLevel(50));
  g.ensureWagon();
  for (let i = 0; i < 5; i++) { advance(3 * 86400); g.ensureWagon(); }
  const w = g.s.wagon;
  assert.ok(w && (w.state === 'here' ? w.leavesAt > g.now() : w.returnsAt > g.now()), 'current after catch-up');
  for (const c of w.crates || []) assert.ok(CFG.ITEMS[c.item]);
});

let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log("  ✗", name, "\n     ", e.message.split("\n")[0], (e.stack || "").split("\n").find((l) => l.includes("test.mjs:")) || ""); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
