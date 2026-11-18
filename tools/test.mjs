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
  assert.equal(g.s.version, 3);
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

// ---------------------------------------------------------------- tutorial & first 30 minutes
const S = CFG.TUTORIAL.startLo;
const ripe = (g) => (soil) => !!soil.crop && g.cropStage(soil.crop) === 3;
const qIndex = (id) => CFG.QUESTS.findIndex((q) => q.id === id);
const chars = (str) => [...str].length;
const isDebris = (o) => CFG.OBJECTS[o.type].kind === 'debris';
// a tiny seeded RNG for the random-farm checks
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
// put an object down directly (ignores level, cost and limits), for layout checks
const put = (g, type, x, z) => { const o = { id: g.s.nextId++, type, x, z, rot: 0, jobs: [] }; g.s.objects.push(o); g.rebuildOccupancy(); return o; };
// is the 1-tile ring around o free of soil and of house/storage/special/pen/factory tiles?
const ringClear = (g, o) => {
  const [w, d] = g.objSize(o.type, o.rot);
  for (let i = -1; i <= w; i++) for (let j = -1; j <= d; j++) {
    if (i >= 0 && i < w && j >= 0 && j < d) continue;
    if (g.soilAt(o.x + i, o.z + j)) return false;
    const b = g.objectAt(o.x + i, o.z + j);
    if (b && ['house', 'storage', 'special', 'pen', 'factory'].includes(CFG.OBJECTS[b.type].kind)) return false;
  }
  return true;
};

test('starter: 6 ripe wheat in one patch; harvest + plant goals reach L2; guided with 12 debris', () => {
  const g = fresh();
  const tiles = Object.keys(g.s.soil).map((k) => k.split(',').map(Number));
  assert.equal(tiles.length, 6);
  for (const [x, z] of tiles) {
    assert.equal(g.cropStage(g.soilAt(x, z).crop), 3, 'ripe at start');
    assert.equal(g.patchTiles(x, z, ripe(g)).length, 6, 'one patch from any tile');
  }
  assert.equal(g.s.tutorial.mode, 'guided');
  assert.equal(g.debris().length, 12);
  assert.equal(g.s.settings.hints, 'full');
  const [ox, oz] = tiles[0];
  for (const [x, z] of g.patchTiles(ox, oz, ripe(g))) assert.ok(g.harvest(x, z));
  assert.equal(g.currentQuest().id, 'harvest');
  assert.ok(g.questDone(), '12 wheat harvested');
  g.claimQuest();
  assert.equal(g.currentQuest().id, 'plant');
  assert.equal(g.plantPatch(ox, oz, 'wheat', 6).length, 6);
  assert.ok(g.questDone(), '6 wheat planted');
  g.claimQuest();
  assert.equal(g.s.xp, 12);
  assert.equal(g.s.level, 2, 'XP 12 >= xpToNext(1) = 11');
});

test('patches: 4-connected, same crop, capped, deterministic order', () => {
  const g = fresh();
  g.s.soil = {};
  const crop = (type) => ({ crop: type ? { type, plantedAt: t - 1e9 } : null });
  // a 6x6 block of ripe wheat, a carrot inside it, and a diagonal-only neighbour
  for (let x = 10; x < 16; x++) for (let z = 10; z < 16; z++) g.s.soil[x + ',' + z] = crop('wheat');
  g.s.soil['12,12'] = crop('carrot');
  g.s.soil['16,16'] = crop('wheat');
  const wheat = (s) => s.crop?.type === 'wheat' && g.cropStage(s.crop) === 3;
  const all = g.patchTiles(10, 10, wheat, 100);
  assert.equal(all.length, 35, 'whole block minus the carrot; no diagonal hop');
  assert.ok(!all.some(([x, z]) => x === 16 && z === 16));
  assert.ok(!all.some(([x, z]) => x === 12 && z === 12), 'same crop only');
  assert.equal(g.patchTiles(10, 10, wheat).length, CFG.TUTORIAL.patchMax, 'default cap 24');
  assert.deepEqual(g.patchTiles(10, 10, wheat, 6), [[10, 10], [11, 10], [10, 11], [12, 10], [11, 11], [10, 12]], 'distance, then z, then x');
  assert.deepEqual(g.patchTiles(10, 10, wheat, 24), g.patchTiles(10, 10, wheat, 24), 'deterministic');
  // the origin is searched from even after it was harvested (tap: harvest first, then the patch)
  g.harvest(13, 13);
  const rest = g.patchTiles(13, 13, wheat, 100);
  assert.equal(rest.length, 34);
  assert.ok(!rest.some(([x, z]) => x === 13 && z === 13));
  assert.deepEqual(g.patchTiles(5, 5, wheat), [], 'grass is not a patch');
});

test('patches: harvest stops exactly when the silo is full; planting stops before coins run out', () => {
  const g = fresh();
  const y = CFG.CROPS.wheat.yield;
  g.s.inventory = { wheat: g.storageCap('silo') - 2 * y };
  const [x0, z0] = Object.keys(g.s.soil)[0].split(',').map(Number);
  let n = 0;
  for (const [x, z] of g.patchTiles(x0, z0, ripe(g))) {
    if (g.spaceFor('wheat') < y) break; // the tap-harvest rule
    assert.ok(g.harvest(x, z));
    n++;
  }
  assert.equal(n, 2);
  assert.equal(g.storageUsed('silo'), g.storageCap('silo'));
  // planting: 3 coins buy exactly 3 wheat seeds
  for (const soil of Object.values(g.s.soil)) soil.crop = null;
  g.s.coins = 3;
  assert.equal(g.plantPatch(x0, z0, 'wheat').length, 3);
  assert.equal(g.s.coins, 0);
  assert.deepEqual(g.plantPatch(x0, z0, 'wheat'), []);
  assert.equal(g.s.coins, 0, 'never negative');
  // the guided cap plants exactly the remaining count
  const h = fresh();
  for (const soil of Object.values(h.s.soil)) soil.crop = null;
  assert.equal(h.plantPatch(x0, z0, 'wheat', 2).length, 2);
  assert.deepEqual(h.plantPatch(x0, z0, 'corn'), [], 'locked crops plant nothing');
});

test('placement: tutorial lots and plow suggestion fit the fresh map', () => {
  const g = fresh();
  for (const [type, off] of Object.entries(CFG.TUTORIAL.lots)) {
    const [x, z] = CFG.tutorialTile(off);
    assert.ok(g.canPlace(type, x, z), `${type} lot`);
  }
  assert.deepEqual(g.suggestPlowSpots(2), CFG.TUTORIAL.plowSuggest.map(CFG.tutorialTile));
  assert.deepEqual(g.suggestPlowSpots(2), [[17, 14], [17, 15]]);
  // the suggestion respects the field cap
  g.s.coins = 1e6;
  while (g.plotCount() < g.plotCap()) { const [x, z] = g.suggestPlowSpots(1)[0]; assert.ok(g.plow(x, z)); }
  assert.deepEqual(g.suggestPlowSpots(2), []);
});

test('placement: the starter sequence lands on the planned spots and keeps paths clear', () => {
  const g = fresh();
  g.s.coins = 1e6; g.s.level = 9;
  const coop = put(g, 'coop', ...CFG.tutorialTile(CFG.TUTORIAL.lots.coop));
  const bakery = put(g, 'bakery', ...CFG.tutorialTile(CFG.TUTORIAL.lots.bakery));
  for (const [x, z] of g.suggestPlowSpots(2)) assert.ok(g.plow(x, z));
  const placed = [coop, bakery];
  const seq = [['scarecrow', 5, 4], ['cowbarn', 8, 0], ['birdbath', 5, 3], 'expand', ['dairy', 10, 10], ['popcorn', -1, 13], ['picnic', 6, 3], ['appletree', 4, 5], ['appletree', 4, 4]];
  for (const step of seq) {
    if (step === 'expand') { g.s.landSize += CFG.LAND_STEP; continue; }
    const [type, dx, dz] = step;
    const p = g.smartSpot(type);
    assert.deepEqual([p.x - S, p.z - S], [dx, dz], type);
    assert.ok(g.canPlace(type, p.x, p.z, p.rot));
    placed.push(put(g, type, p.x, p.z));
  }
  for (const o of placed) if (['pen', 'factory'].includes(CFG.OBJECTS[o.type].kind)) assert.ok(ringClear(g, o), `${o.type} ring clear`);
});

test('placement: smartSpot finds a valid spot for every early building, tree and gift on many farms', () => {
  const types = Object.entries(CFG.OBJECTS).filter(([, d]) => ['pen', 'factory', 'tree'].includes(d.kind) && d.level <= 9).map(([id]) => id);
  types.push(...CFG.CHAPTERS.map((c) => c.reward.gift));
  const check = (g, label) => {
    for (const type of types) {
      const p = g.smartSpot(type);
      if (!g.findFreeSpot(type)) { assert.equal(p, null); continue; }
      assert.ok(p && g.canPlace(type, p.x, p.z, p.rot), `${label}: ${type}`);
    }
  };
  const g = fresh();
  check(g, 'starter');
  put(g, 'coop', ...CFG.tutorialTile(CFG.TUTORIAL.lots.coop));
  put(g, 'bakery', ...CFG.tutorialTile(CFG.TUTORIAL.lots.bakery));
  check(g, 'lots');
  g.s.landSize += CFG.LAND_STEP;
  check(g, 'expanded');
  for (let seed = 1; seed <= 20; seed++) {
    const r = rng(seed);
    const h = fresh();
    h.s.coins = 1e6; h.s.level = 9;
    if (r() < 0.5) h.s.landSize += CFG.LAND_STEP * (1 + Math.floor(r() * 2));
    const lo = h.landLo(), span = h.s.landSize;
    for (let i = 0; i < 12; i++) h.plow(lo + Math.floor(r() * span), lo + Math.floor(r() * span));
    const pool = ['coop', 'bakery', 'cowbarn', 'oak', 'fence', 'bench', 'well', 'appletree'];
    for (let i = 0; i < 10; i++) {
      const type = pool[Math.floor(r() * pool.length)];
      const x = lo + Math.floor(r() * span), z = lo + Math.floor(r() * span);
      if (h.canPlace(type, x, z)) put(h, type, x, z);
    }
    check(h, 'random farm ' + seed);
  }
});

test('debris stays off the lots, the field and its rings, and the building rings', () => {
  const g = fresh();
  const bad = new Set();
  const ring = (x, z, w, d, r = 1) => { for (let i = -r; i < w + r; i++) for (let j = -r; j < d + r; j++) bad.add((x + i) + ',' + (z + j)); };
  for (const o of g.s.objects) {
    const kind = CFG.OBJECTS[o.type].kind;
    if (['house', 'storage', 'special'].includes(kind)) ring(o.x, o.z, ...g.objSize(o.type, o.rot));
  }
  for (const [type, off] of Object.entries(CFG.TUTORIAL.lots)) ring(...CFG.tutorialTile(off), ...CFG.OBJECTS[type].size);
  ring(S + 6, S + 6, 4, 2, 2); // the 4x2 field after "Plow 2 new fields", plus two rings
  const debris = g.debris();
  assert.equal(new Set(debris.map((o) => o.x + ',' + o.z)).size, 12);
  for (const o of debris) {
    assert.ok(!bad.has(o.x + ',' + o.z), `${o.type} at ${o.x - S},${o.z - S}`);
    assert.equal(g.objectAt(o.x, o.z), o, 'not overlapping anything');
    assert.ok(g.inLand(o.x, o.z) && !g.soilAt(o.x, o.z));
  }
});

test('quest list: unique ids, chapters, levels, lines and a capped budget', () => {
  const ids = CFG.QUESTS.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.equal(CFG.QUESTS.length, 25);
  const total = { coins: 0, xp: 0, gems: 0 };
  for (const q of CFG.QUESTS) {
    for (const k of Object.keys(total)) total[k] += q.reward[k] || 0;
    assert.ok(CFG.CHAPTERS.some((c) => c.id === q.chapter), `${q.id} chapter`);
    assert.ok(q.say && chars(q.say) <= 90, `${q.id} say <= 90`);
    assert.ok(q.text && q.count > 0 && q.hint, `${q.id} text/count/hint`);
  }
  assert.ok(total.xp <= 230 && total.coins <= 900 && total.gems <= 6, JSON.stringify(total));
  const levels = Object.fromEntries(CFG.QUESTS.map((q) => [q.id, CFG.questLevel(q)]));
  assert.deepEqual(levels, { harvest: 1, plant: 1, order1: 1, coop: 2, chickens: 2, feed: 2, plow: 1, carrots: 2, eggs: 2, bakery: 3, bread: 3,
    corn: 4, orders3: 1, pasture: 5, cows: 5, milk: 5, expand: 6, sunflower: 6, cookie: 4, dairy: 7, visitors: 7, butter: 7, popcorn: 8, silo: 5, apple: 9 });
  for (const c of CFG.CHAPTERS) {
    const list = CFG.QUESTS.filter((q) => q.chapter === c.id);
    assert.equal(list[list.length - 1].id, c.last, `chapter ${c.id} ends with its last goal`);
    const gift = CFG.OBJECTS[c.reward.gift];
    assert.ok(gift && gift.kind === 'decor', `chapter ${c.id} gift`);
    assert.ok(gift.level <= Math.max(...list.map(CFG.questLevel)), `${c.reward.gift} unlocks before its chest`);
    assert.ok(!c.reward.coins && !c.reward.xp && !c.reward.items, 'chests are gems + decor only');
  }
  for (const [k, line] of Object.entries(CFG.TUTORIAL.lines)) assert.ok(chars(line) <= 90, `line ${k} <= 90`);
  for (const k of CFG.TUTORIAL.ch1Lines) assert.ok(CFG.TUTORIAL.lines[k], `ch1 line ${k}`);
  for (let l = 5; l <= 30; l++) assert.ok(CFG.FEATURE_TIPS[l] && chars(CFG.FEATURE_TIPS[l]) <= 80, `tip L${l}`);
  assert.equal(CFG.QUEST_MIGRATION_V3.length, CFG.V2_QUEST_COUNT);
  for (const id of CFG.QUEST_MIGRATION_V3) assert.ok(qIndex(id) >= 0, `migration target ${id}`);
});

test('quests: owning or having fed already completes build, buyAnimal, feed, expand, storage, trees', () => {
  const g = fresh();
  g.s.coins = 1e7; g.addXp(CFG.xpForLevel(9));
  const at = (id) => { g.s.quest = { index: qIndex(id), progress: 0 }; return g.questDone(); };
  const coop = put(g, 'coop', ...g.findFreeSpot('coop'));
  assert.ok(at('coop'));
  g.buyAnimal('chicken'); g.buyAnimal('chicken');
  assert.ok(at('chickens'));
  assert.equal(at('feed'), false, 'hungry chickens');
  g.s.inventory.wheat = 10;
  for (const a of g.animalsIn(coop.id)) g.feedAnimal(a); // fed before the goal is current
  assert.ok(at('feed'), 'already-fed chickens count');
  // and the feed event counts while the goal is current
  const h = fresh();
  h.s.coins = 1e7; h.addXp(CFG.xpForLevel(2));
  put(h, 'coop', ...h.findFreeSpot('coop'));
  h.buyAnimal('chicken'); h.buyAnimal('chicken');
  h.s.quest = { index: qIndex('feed'), progress: 0 };
  h.s.inventory.wheat = 10;
  for (const a of h.s.animals) h.feedAnimal(a);
  advance(CFG.ANIMALS.chicken.time + 1);
  for (const a of h.s.animals) h.collectAnimal(a); // hungry again, but the progress stays
  assert.ok(h.questDone());
  assert.equal(at('expand'), false);
  g.s.landSize += CFG.LAND_STEP;
  assert.ok(at('expand'));
  assert.equal(at('silo'), false);
  g.s.storage.barn = 1;
  assert.ok(at('silo'), 'any storage upgrade you already have');
  put(g, 'appletree', ...g.findFreeSpot('appletree'));
  assert.equal(at('apple'), false);
  put(g, 'appletree', ...g.findFreeSpot('appletree'));
  assert.ok(at('apple'));
});

test('chapter chests pay gems and a gift only, exactly once, when the last goal is claimed', () => {
  const g = fresh();
  const chapters = [];
  g.on('chapter', (e) => chapters.push(e));
  g.s.quest = { index: qIndex('bakery'), progress: 1 };
  g.claimQuest();
  assert.equal(chapters.length, 0, 'not the last goal');
  g.s.quest.progress = 1;
  const before = { coins: g.s.coins, xp: g.s.xp, gems: g.s.gems };
  const lvl = { coins: 0, gems: 0 };
  g.on('levelup', (d) => { lvl.coins += d.bonus; lvl.gems += d.gems; });
  const q = CFG.QUESTS[qIndex('bread')];
  assert.equal(g.claimQuest().id, 'bread');
  assert.equal(g.s.coins, before.coins + q.reward.coins + lvl.coins, 'no chest coins');
  assert.equal(g.s.xp, before.xp + q.reward.xp, 'no chest XP');
  assert.equal(g.s.gems, before.gems + 3 + lvl.gems);
  assert.deepEqual(g.s.gifts, ['scarecrow']);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].chapter.id, 1);
  assert.equal(chapters[0].next.id, 2);
  assert.equal(g.s.quest.qid, 'corn');
  assert.equal(g.claimQuest(), null);
  assert.equal(g.s.gems, before.gems + 3 + lvl.gems, 'paid once');
  assert.deepEqual(g.questChapter(), { id: 2, name: 'Barnyard Friends', icon: '🐄', done: 0, total: 6, last: 'expand' });
  assert.ok(g.chapterDone(1) && !g.chapterDone(2));
  g.s.quest = { index: qIndex('apple'), progress: 0 };
  put(g, 'appletree', ...g.findFreeSpot('appletree')); put(g, 'appletree', ...g.findFreeSpot('appletree'));
  g.claimQuest();
  assert.equal(chapters[1].next, null, 'last chapter');
  assert.equal(g.questChapter(), null, 'endless goals have no chapter');
});

test('free first bake: once per new farm, bread only, 0 gems; later finishes cost gems', () => {
  const g = fresh();
  g.s.coins = 1e6; g.s.gems = 50; g.addXp(CFG.xpForLevel(4));
  const o = g.placeObject('bakery', ...g.findFreeSpot('bakery'));
  g.s.inventory = { wheat: 30, egg: 10 };
  assert.ok(g.startRecipe(o, 'cookie'));
  assert.equal(g.freeFinishAvailable(o), false, 'cookies are not free');
  assert.equal(g.speedUpFactory(o, { free: true }), false);
  advance(CFG.RECIPES.cookie.time + 1); g.collectFactory(o);
  assert.ok(g.startRecipe(o, 'bread'));
  assert.ok(g.freeFinishAvailable(o));
  const gems = g.s.gems;
  assert.ok(g.speedUpFactory(o, { free: true }));
  assert.equal(g.s.gems, gems, '0 gems');
  assert.ok(g.collectFactory(o).got.bread);
  assert.ok(g.startRecipe(o, 'bread'));
  assert.equal(g.freeFinishAvailable(o), false, 'only once');
  assert.equal(g.speedUpFactory(o, { free: true }), false);
  assert.ok(g.speedUpFactory(o));
  assert.ok(g.s.gems < gems, 'the second one costs gems');
  // a first bread that finished on its own uses the offer up too
  const h = fresh();
  h.s.coins = 1e6; h.addXp(CFG.xpForLevel(3));
  const b = h.placeObject('bakery', ...h.findFreeSpot('bakery'));
  h.s.inventory = { wheat: 30 };
  h.startRecipe(b, 'bread'); h.startRecipe(b, 'bread');
  advance(CFG.RECIPES.bread.time + 1);
  h.collectFactory(b);
  assert.equal(h.freeFinishAvailable(b), false);
});

test('safety net: pays once when truly stuck, never within 24h or while anything grows or sells', () => {
  const g = fresh();
  let fired = 0;
  g.on('safetyNet', () => fired++);
  const broke = () => { g.s.coins = 0; g.s.inventory = {}; for (const soil of Object.values(g.s.soil)) soil.crop = null; };
  broke();
  const k = Object.keys(g.s.soil)[0];
  g.s.soil[k].crop = { type: 'wheat', plantedAt: t };
  g.ensureOrders();
  g.s.soil[k].crop = null;
  g.s.inventory = { wheat: 1 };
  g.ensureOrders();
  assert.equal(fired, 0, 'growing or sellable');
  g.s.inventory = { plank: 2 }; // materials don't count
  g.ensureOrders();
  assert.equal(fired, 1);
  assert.equal(g.s.coins, CFG.TUTORIAL.safetyNet.coins);
  broke(); g.ensureOrders();
  advance(23 * 3600); g.ensureOrders();
  assert.equal(fired, 1, '24h cooldown');
  advance(3600 + 1); g.ensureOrders();
  assert.equal(fired, 2);
});

test('safety net: never while the Game is being built (nobody listens yet); the first HUD tick pays it, heard', () => {
  const st = new MemStorage();
  const g = new Game({ clock, storage: st });
  g.s.coins = 0; g.s.inventory = {};
  for (const soil of Object.values(g.s.soil)) soil.crop = null;
  g.s.tutorial.net = null;
  g.save();
  const h = new Game({ clock, storage: st });
  assert.equal(h.s.coins, 0, 'no payout while loading');
  assert.ok(!h.s.tutorial.net);
  let heard = 0;
  h.on('safetyNet', () => heard++);
  h.ensureOrders(); // the HUD's 1 Hz tick, after the guide subscribed
  assert.equal(heard, 1);
  assert.equal(h.s.coins, CFG.TUTORIAL.safetyNet.coins, 'same amount');
});

test('sellExtras keeps 10 of each, or more of what floors ask for (the guide\'s reserves)', () => {
  const g = fresh();
  g.s.inventory = { wheat: 40, carrot: 30, corn: 8 };
  const coins = g.s.coins;
  const earned = g.sellExtras('silo', 10, { wheat: 22, corn: 30 });
  assert.deepEqual([g.count('wheat'), g.count('carrot'), g.count('corn')], [22, 10, 8]);
  assert.equal(earned, 18 * CFG.ITEMS.wheat.price + 20 * CFG.ITEMS.carrot.price);
  assert.equal(g.s.coins, coins + earned);
  g.s.inventory.wheat = 40;
  g.sellExtras('silo');
  assert.equal(g.count('wheat'), 10, 'no floors: 10 of each, as before');
});

test('"Feed your chickens": chickens fed before it was current count, and collecting their eggs never undoes it', () => {
  const g = fresh();
  g.s.coins = 1e7; g.addXp(CFG.xpForLevel(2));
  put(g, 'coop', ...g.findFreeSpot('coop'));
  g.s.quest = { index: qIndex('chickens'), progress: 0, notified: false };
  g.buyAnimal('chicken'); g.buyAnimal('chicken');
  g.s.inventory = { wheat: 2 };
  for (const a of g.s.animals) g.feedAnimal(a); // fed during "Buy 2 chickens"
  let done = 0;
  g.on('questComplete', () => done++);
  assert.ok(g.claimQuest());
  assert.equal(g.currentQuest().id, 'feed');
  assert.ok(g.questDone(), 'already fed: done at once');
  assert.equal(done, 1);
  advance(CFG.ANIMALS.chicken.time + 1);
  for (const a of g.s.animals) g.collectAnimal(a); // hungry again, no wheat left to re-feed
  assert.equal(g.animalState(g.s.animals[0]), 'hungry');
  assert.ok(g.questDone(), 'still done after collecting the eggs');
  assert.ok(g.claimQuest(), 'Claim! still works');
});

test('plow spots: a field fenced in on every side gets none, unless anywhere (then a new patch near the farm)', () => {
  const g = fresh();
  g.s.coins = 1e6;
  g.s.objects = g.s.objects.filter((o) => CFG.OBJECTS[o.type].kind !== 'debris');
  g.rebuildOccupancy();
  for (const k of Object.keys(g.s.soil)) {
    const [x, z] = k.split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.canPlace('fence', x + dx, z + dz, 0)) put(g, 'fence', x + dx, z + dz);
  }
  assert.deepEqual(g.suggestPlowSpots(2), []);
  const spots = g.suggestPlowSpots(2, { anywhere: true });
  assert.equal(spots.length, 2);
  for (const [x, z] of spots) assert.ok(g.inLand(x, z) && !g.objectAt(x, z) && !g.soilAt(x, z), `free tile ${x},${z}`);
  assert.equal(Math.abs(spots[0][0] - spots[1][0]) + Math.abs(spots[0][1] - spots[1][1]), 1, 'one connected patch');
  assert.deepEqual(fresh().suggestPlowSpots(2, { anywhere: true }), fresh().suggestPlowSpots(2), 'unchanged when the field has room');
});

test('safety net never fires for the pacing bot', async () => {
  const { run } = await import('./sim.mjs');
  const P = Game.prototype, orig = P.checkSafetyNet, rnd = Math.random;
  let fired = 0;
  P.checkSafetyNet = function () { const r = orig.call(this); if (r) fired++; return r; };
  try {
    run({ profile: 'active', hours: 3 });
    run({ profile: 'casual', hours: 48 });
  } finally { P.checkSafetyNet = orig; Math.random = rnd; }
  assert.equal(fired, 0);
});

test('first visitor is Mabel asking for something you hold; the next one is normal', () => {
  const g = fresh();
  g.addXp(CFG.xpForLevel(CFG.VISITORS.level));
  g.s.inventory = { wheat: 40, egg: 3 };
  advance(CFG.VISITORS.firstDelay + 1);
  g.ensureVisitors();
  const v = g.s.visitors[0];
  const min = CFG.VISITORS.minValue(g.s.level);
  assert.equal(v.npc, CFG.GUIDE.npc);
  assert.ok(v.first);
  assert.equal(v.item, 'wheat', 'the held item worth the most');
  assert.equal(v.qty, Math.ceil(min / CFG.ITEMS.wheat.price));
  assert.ok(g.count(v.item) >= v.qty);
  assert.ok(g.s.tutorial.firstVisitorDone);
  g.s.visitors = []; g.s.nextVisitorAt = g.now();
  g.ensureVisitors();
  assert.ok(g.s.visitors.length && !g.s.visitors[0].first, 'second visitor is normal');
  // nothing worth enough in the barn: still Mabel, with a normal request
  const h = fresh();
  h.addXp(CFG.xpForLevel(CFG.VISITORS.level));
  h.s.inventory = {};
  advance(CFG.VISITORS.firstDelay + 1);
  h.ensureVisitors();
  assert.equal(h.s.visitors[0].npc, CFG.GUIDE.npc);
  assert.ok(h.s.visitors[0].qty * CFG.ITEMS[h.s.visitors[0].item].price >= min);
});

test('chapter gifts are placed free, give no XP, ignore level and limits, and refund nothing', () => {
  const g = fresh();
  const [x, z] = g.findFreeSpot('picnic');
  assert.equal(g.placeGift('picnic', x, z), null, 'only gifts you have');
  g.s.gifts = ['picnic', 'scarecrow'];
  const coins = g.s.coins, xp = g.s.xp;
  const o = g.placeGift('picnic', x, z); // a level-9 decoration at level 1
  assert.ok(o && o.free);
  assert.equal(g.s.coins, coins);
  assert.equal(g.s.xp, xp);
  assert.deepEqual(g.s.gifts, ['scarecrow']);
  assert.equal(g.placeGift('picnic', ...g.findFreeSpot('picnic')), null, 'used up');
  assert.equal(g.removeObject(o.id), 0);
  assert.equal(g.s.coins, coins, 'no refund');
});

test('debris pays its exact reward once and never shows up as an unlock or a building', () => {
  const g = fresh();
  let bonus = 0, events = 0;
  g.on('levelup', (d) => { bonus += d.bonus; });
  g.on('debrisCleared', () => events++);
  const c0 = g.s.coins, x0 = g.s.xp;
  const list = g.debris();
  const one = list[0];
  assert.equal(g.removeObject(one.id), false, 'not via the decor remover');
  assert.equal(g.moveObject(one.id, one.x + 1, one.z, 0), false, 'cannot be moved');
  for (const o of list) {
    const r = g.clearDebris(o.id);
    assert.deepEqual([r.type, r.x, r.z, r.coins, r.xp], [o.type, o.x, o.z, CFG.OBJECTS[o.type].clear.coins, CFG.OBJECTS[o.type].clear.xp]);
    assert.equal(g.clearDebris(o.id), null, 'once');
    assert.equal(g.objectAt(o.x, o.z), null);
  }
  assert.equal(events, 12);
  assert.equal(g.stat('debris'), 12);
  assert.equal(g.s.xp - x0, 14);
  assert.equal(g.s.coins - c0 - bonus, 20);
  const names = new Set(['weed', 'stone', 'stump'].map((t) => CFG.OBJECTS[t].name));
  for (let l = 1; l <= 40; l++) assert.ok(!CFG.unlocksAtLevel(l).some((u) => names.has(u.name)), 'L' + l);
  g.addXp(CFG.xpForLevel(30)); g.s.coins = 1e6;
  assert.equal(g.placeObject('weed', ...g.findFreeSpot('weed')), null, 'not buildable');
});

test('tutorial state: mode only moves forward; the HUD reveal grows and opens up at L5 or after 2h', () => {
  const g = fresh();
  const modes = [];
  g.on('tutorial', (e) => modes.push(e.mode));
  assert.equal(g.isRevealed('shop'), false);
  assert.ok(g.reveal('quest'));
  assert.equal(g.reveal('quest'), false);
  assert.ok(g.isRevealed('quest'));
  assert.deepEqual(g.revealedKeys(), ['quest']);
  assert.ok(!g.hasSeen('welcome') && g.markSeen('welcome') && g.hasSeen('welcome') && !g.markSeen('welcome'));
  assert.ok(g.setTutorialMode('coached'));
  assert.equal(g.setTutorialMode('guided'), false, 'never back');
  assert.equal(g.setTutorialMode('coached'), false);
  assert.ok(g.isRevealed('shop'), 'everything after the tour');
  assert.equal(g.s.tutorial.reveal, 'all');
  assert.ok(g.setTutorialMode('independent'));
  assert.deepEqual(modes, ['coached', 'independent']);
  const h = fresh();
  h.addXp(CFG.xpForLevel(5));
  assert.equal(h.s.tutorial.mode, 'guided');
  assert.equal(h.s.tutorial.reveal, 'all', 'level 5');
  const k = fresh();
  advance(2 * 3600 + 1);
  assert.ok(k.isRevealed('trophy'), 'after 2 hours');
  const m = fresh();
  m.skipTutorial();
  assert.equal(m.s.tutorial.mode, 'coached');
  assert.equal(m.revealedKeys(), 'all');
  assert.ok(m.hasSeen('welcome') && m.hasSeen('line:harvest') && m.hasSeen('line:gradEnd'));
  assert.equal(m.s.tutorial.freeFinishUsed, false, 'skipping keeps the new-farm rules');
});

// a v2 save as the previous release wrote it (no tutorial, no debris, old settings)
const v2Save = (quest, level = 3) => {
  const g = fresh();
  const s = JSON.parse(JSON.stringify(g.s));
  s.version = 2;
  delete s.tutorial; delete s.gifts;
  s.objects = s.objects.filter((o) => !isDebris(o));
  for (const soil of Object.values(s.soil)) soil.crop.plantedAt = t; // just planted
  s.settings = { sound: false, music: true };
  s.level = level; s.xp = CFG.xpForLevel(level);
  s.quest = quest;
  return s;
};
const loadSave = (s) => { const st = new MemStorage(); st.setItem('sunny-acres-save-v1', JSON.stringify(s)); return fresh(st); };

test('v2 saves: every goal maps by id, repeat goals keep their place and progress', () => {
  for (let old = 0; old <= 20; old++) {
    const snap = { text: 'Frozen goal', event: 'harvest', count: 999, reward: { coins: 1, xp: 1 }, index: old };
    const g = loadSave(v2Save({ index: old, progress: 3, notified: false, ...(old >= 17 ? { snap } : {}) }));
    assert.equal(g.s.version, 3);
    if (old < CFG.V2_QUEST_COUNT) {
      assert.equal(g.currentQuest().id, CFG.QUEST_MIGRATION_V3[old], 'old ' + old);
      assert.equal(g.s.quest.qid, CFG.QUEST_MIGRATION_V3[old]);
      assert.equal(g.s.quest.progress, 0, 'scripted progress resets');
      assert.equal(g.s.tutorial.mode, 'coached');
    } else {
      const index = CFG.QUESTS.length + old - 17;
      assert.equal(g.s.quest.index, index, 'old ' + old);
      assert.equal(g.s.quest.qid, 'repeat:' + (old - 17));
      assert.equal(g.s.quest.snap.index, index, 'snap.index rewritten');
      assert.equal(g.currentQuest().count, 999, 'same frozen goal');
      assert.equal(g.s.quest.progress, 3, 'repeat progress kept');
      assert.equal(g.s.tutorial.mode, 'independent');
    }
    assert.equal(g.s.tutorial.reveal, 'all');
  }
  assert.equal(loadSave(v2Save({ index: 5, progress: 0 }, 12)).s.tutorial.mode, 'independent', 'level 10+');
});

test('v2 saves: no tour, no debris, no new-farm assists; settings merged', () => {
  const s = v2Save({ index: 9, progress: 0 }, 8);
  const objects = s.objects.length;
  const g = loadSave(s);
  assert.equal(g.debris().length, 0);
  assert.equal(g.s.objects.length, objects);
  for (const soil of Object.values(g.s.soil)) assert.equal(soil.crop.plantedAt, t, 'field untouched');
  const tut = g.s.tutorial;
  assert.ok(tut.freeFinishUsed && tut.firstVisitorDone);
  assert.ok(tut.seen.welcome && tut.seen['line:harvest'] && tut.seen.siloFull && tut.seen.firstDrop && tut.seen.firstVisitor);
  assert.ok(tut.seen['tip:8'] && !tut.seen['tip:9'], 'tips up to the current level');
  assert.deepEqual(g.s.gifts, []);
  assert.deepEqual(g.s.settings, { sound: false, music: true, hints: 'glow', tapHarvest: true });
  assert.ok(g.isRevealed('trophy'));
});

test('v1 saves past the old goal list land on the first repeat goal', () => {
  const v1 = { version: 1, coins: 10, xp: 0, level: 9, landSize: 16, soil: {}, objects: [{ id: 1, type: 'farmhouse', x: 9, z: 9, rot: 0, jobs: [] }],
    animals: [], inventory: {}, orders: [], quest: { index: 20, progress: 0 }, nextId: 5, stats: { harvested: 0, orders: 0 }, settings: { sound: true, music: true }, createdAt: t };
  const g = loadSave(v1);
  assert.equal(g.s.version, 3);
  assert.equal(g.s.quest.index, CFG.QUESTS.length);
  assert.equal(g.s.quest.qid, 'repeat:0');
});

test('quest.qid heals the index when the goal list changes', () => {
  const st = new MemStorage();
  const g = fresh(st);
  g.s.quest = { index: qIndex('coop'), progress: 1 };
  g.save();
  const st2 = new MemStorage();
  const r = fresh(st2);
  r.s.quest = { index: CFG.QUESTS.length + 2, progress: 4 };
  const count = r.currentQuest().count;
  r.save();
  const saved = CFG.QUESTS.slice();
  try {
    // reorder: a new goal at the front and the coop goal moved up
    const [coop] = CFG.QUESTS.splice(qIndex('coop'), 1);
    CFG.QUESTS.unshift({ id: 'newgoal', chapter: 1, text: 'New', event: 'plow', count: 1, reward: { coins: 1, xp: 1 }, say: 'New!' }, coop);
    const g2 = fresh(st);
    assert.equal(g2.currentQuest().id, 'coop');
    assert.equal(g2.s.quest.index, 1);
    assert.equal(g2.s.quest.progress, 1);
    const r2 = fresh(st2);
    assert.equal(r2.s.quest.index, CFG.QUESTS.length + 2);
    assert.equal(r2.s.quest.snap.index, r2.s.quest.index);
    assert.equal(r2.currentQuest().count, count, 'same frozen repeat goal');
    assert.equal(r2.s.quest.progress, 4);
  } finally { CFG.QUESTS.splice(0, CFG.QUESTS.length, ...saved); }
});

let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try { await fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log("  ✗", name, "\n     ", e.message.split("\n")[0], (e.stack || "").split("\n").find((l) => l.includes("test.mjs:")) || ""); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
