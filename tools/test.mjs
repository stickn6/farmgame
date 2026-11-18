// Rules tests for the game model (runs in Node, no browser):  npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
  assert.equal(g.s.version, 4);
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

test('sim (v4): bots open parcels and claim album pages for no XP or materials; --features off changes nothing before the first post coins', async () => {
  const { run, FEATURES_OFF, v4Window } = await import('./sim.mjs');
  const rnd = Math.random;
  try {
    // the active bot over 4.2 h: parcels #1–#5 at 5 m, 15 m, 30 m, 1 h and 4 h, page 1 claimed, no XP / materials
    const on = run({ profile: 'active', hours: 4.2 });
    assert.deepEqual(on.v4.parcels.map((p) => p.at), [5, 15, 30, 60, 240]);
    assert.ok(on.v4.keepsakes.length >= 3, 'the clover, play finds and #5\'s keepsake');
    assert.deepEqual(on.v4.leaks, { xp: 0, materials: 0 });
    for (const t of Object.values(on.g.granted)) { assert.equal(t.xp, 0); assert.equal(t.materials, 0); }
    // the same farm with the Post, album and charm off: identical levels until the first parcel coins (4 h) — the
    // album draws from the save's own RNG, so orders, visitors and drops are untouched
    const off = run({ profile: 'active', hours: 4.2, features: FEATURES_OFF });
    assert.equal(off.v4.parcels.length, 0);
    assert.equal(off.v4.keepsakes.length, 0);
    assert.equal(off.g.albumOpen(), false);
    for (const [L, m] of Object.entries(on.levelAt)) if (m <= 240) assert.equal(off.levelAt[L], m, `L${L}`);
    assert.ok(on.levelAt[15] < 240, 'compares through L15');
    // the day ledger: 2 parcels a day on an engaged run's days 2–4
    const e = run({ profile: 'engaged', hours: 24 * 5 });
    const w = v4Window(e, 2);
    assert.equal(w.days, 3);
    assert.equal(w.perDay, 2);
    assert.ok(w.coinShare > 0 && w.coinShare < 0.08, `coin share ${w.coinShare}`);
    assert.deepEqual(e.v4.leaks, { xp: 0, materials: 0 });
  } finally { Math.random = rnd; }
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
    assert.equal(g.s.version, 4);
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
  assert.deepEqual(g.s.settings, { sound: false, music: true, hints: 'glow', tapHarvest: true, cam: null, twist: true });
  assert.ok(g.isRevealed('trophy'));
});

test('v1 saves past the old goal list land on the first repeat goal', () => {
  const v1 = { version: 1, coins: 10, xp: 0, level: 9, landSize: 16, soil: {}, objects: [{ id: 1, type: 'farmhouse', x: 9, z: 9, rot: 0, jobs: [] }],
    animals: [], inventory: {}, orders: [], quest: { index: 20, progress: 0 }, nextId: 5, stats: { harvested: 0, orders: 0 }, settings: { sound: true, music: true }, createdAt: t };
  const g = loadSave(v1);
  assert.equal(g.s.version, 4);
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

// ---------------------------------------------------------------- v4: turn & tilt camera (§1)
test('camera.js: 90° steps on the iso diagonals, tilt levels, Home, snap, twist engage, closest zoom', async () => {
  const { stepYaw, nextPitch, homeYaw, nearestSnap, minDistFor, twistUpdate, wrapPi, isHome } = await import('../src/game/camera.js');
  const C = CFG.CAMERA, Q = Math.PI / 4, H = Math.PI / 2, near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
  // Q from the default is today's +π/2; E is −π/2; every result is a diagonal π/4 + k·π/2
  assert.ok(near(stepYaw(C.yaw0, +1), C.yaw0 + H));
  assert.ok(near(stepYaw(C.yaw0, -1), C.yaw0 - H));
  for (let y = -7; y <= 7; y += 0.137) {
    for (const dir of [1, -1]) {
      const r = stepYaw(y, dir), k = (r - Q) / H;
      assert.ok(near(k, Math.round(k), 1e-9), `diagonal from ${y}`);
      assert.ok(dir > 0 ? r > y + 1e-9 && r <= y + H + 0.04 : r < y - 1e-9 && r >= y - H - 0.04, `one step from ${y}`);
    }
  }
  assert.ok(near(stepYaw(C.yaw0 + 0.01, +1), C.yaw0 + H), 'just off a diagonal still steps a full 90°');
  assert.ok(near(stepYaw(C.yaw0 + 0.5, +1), C.yaw0 + H), 'between diagonals: the next one that way');
  assert.ok(near(stepYaw(C.yaw0 + 0.5, -1), C.yaw0));
  // tilt levels and clamps
  assert.equal(nextPitch(0.92, +1), 1.07);
  assert.equal(nextPitch(0.92, -1), 0.79);
  assert.equal(nextPitch(1.22, +1), 1.22);
  assert.equal(nextPitch(0.66, -1), 0.66);
  assert.equal(nextPitch(0.95, -1), 0.92, 'from in between: the level below');
  assert.equal(nextPitch(0.95, +1), 1.07);
  assert.equal(nextPitch(0.921, +1), 1.07, 'ε: a level a hair off counts as that level');
  let p = C.pitch.min;
  const seen = [p];
  for (let i = 0; i < 6; i++) seen.push(p = nextPitch(p, +1));
  assert.deepEqual(seen, [0.66, 0.79, 0.92, 1.07, 1.22, 1.22, 1.22]);
  // Home: the nearest default turn, never several spins
  assert.ok(near(homeYaw(C.yaw0), C.yaw0));
  assert.ok(near(homeYaw(C.yaw0 + 2 * Math.PI * 3 + 0.4), C.yaw0 + 2 * Math.PI * 3));
  assert.ok(near(homeYaw(C.yaw0 + Math.PI - 0.1), C.yaw0));
  assert.ok(near(homeYaw(C.yaw0 + Math.PI + 0.1), C.yaw0 + 2 * Math.PI));
  assert.ok(near(homeYaw(C.yaw0 - 5), C.yaw0 - 2 * Math.PI));
  assert.ok(isHome(C.yaw0 + 2 * Math.PI, 0.92) && !isHome(C.yaw0 + H, 0.92) && !isHome(C.yaw0, 1.07));
  // snap within 0.12 onto 45° views
  assert.ok(near(nearestSnap(Q + 0.11), Q));
  assert.ok(near(nearestSnap(H - 0.1), H));
  assert.equal(nearestSnap(Q + 0.2), null);
  assert.ok(near(nearestSnap(-3 * Q + 0.05), -3 * Q));
  assert.equal(minDistFor(0.66), 9);
  assert.equal(minDistFor(0.79), 9);
  assert.equal(minDistFor(0.80), 7);
  assert.equal(minDistFor(0.92), 7);
  assert.ok(near(wrapPi(3 * Math.PI), -Math.PI) && near(wrapPi(-0.5), -0.5) && near(wrapPi(7), 7 - 2 * Math.PI));
  // twist: a pair of fingers 200 px apart turning about their middle (screen y points down)
  const pair = (ang, d = 200) => [{ x: 200 - Math.cos(ang) * d / 2, y: 400 - Math.sin(ang) * d / 2 }, { x: 200 + Math.cos(ang) * d / 2, y: 400 + Math.sin(ang) * d / 2 }];
  const st = () => ({ angle0: 0, dist0: 200, yaw0: 1, engaged: false, offset: 0 });
  let t1 = st();
  for (let a = 0; a < 0.255; a += 0.01) assert.equal(twistUpdate(t1, ...pair(a)).engaged, false, 'below 15° nothing turns');
  let r = twistUpdate(t1, ...pair(0.27));
  assert.ok(r.engaged, 'engages past 15°');
  assert.ok(Math.abs(r.yaw - 1) < 0.02, 'no jump at engagement');
  r = twistUpdate(t1, ...pair(0.27 + 0.5));
  assert.ok(near(r.yaw - 1, 0.27 + 0.5 - 0.26, 1e-6), '1:1 after engaging; fingers clockwise → yaw grows');
  r = twistUpdate(t1, ...pair(0.1, 300));
  assert.ok(r.engaged && near(r.yaw - 1, 0.1 - 0.26, 1e-6), 'stays engaged (and zoom may change) once it turned');
  // counter-clockwise, and a pinch that also rotates never turns
  t1 = st();
  r = twistUpdate(t1, ...pair(-0.4));
  assert.ok(r.engaged && near(r.yaw - 1, -(0.4 - 0.26), 1e-6));
  t1 = st();
  assert.equal(twistUpdate(t1, ...pair(0.5, 200 * Math.exp(0.23))).engaged, false, 'pinching out while turning');
  assert.equal(twistUpdate(t1, ...pair(0.5, 200 * Math.exp(-0.25))).engaged, false, 'pinching in while turning');
  assert.equal(twistUpdate(t1, ...pair(0.5, 200 * Math.exp(0.2))).engaged, true, 'a small scale change is fine');
  // past 180° it keeps going instead of wrapping
  t1 = st();
  let last = null;
  for (let a = 0; a <= 4; a += 0.05) last = twistUpdate(t1, ...pair(a));
  assert.ok(near(last.yaw - 1, 4 - 0.26, 1e-6), 'a full spin and more');
});

test('CameraRig: locked rig ignores every turn/tilt path; low tilt keeps out of the roofs; reduced motion snaps; frame() takes opts.pitch', async () => {
  const THREE = await import('three');
  const { CameraRig, World } = await import('../src/game/world.js');
  const C = CFG.CAMERA;
  const rig = new CameraRig(new THREE.PerspectiveCamera(50, 390 / 844, 0.5, 300));
  let views = 0;
  rig.onView = () => views++;
  assert.equal(rig.yaw, C.yaw0);
  assert.equal(rig.goal.pitch, C.pitch.def);
  rig.locked = true;
  const before = JSON.stringify({ y: rig.yaw, p: rig.pitch, gy: rig.goal.yaw, gp: rig.goal.pitch, d: rig.goal.dist });
  rig.rotateStep(1); rig.rotateStep(-1); rig.tiltStep(1); rig.tiltStep(-1); rig.twistTo(3); rig.orbitBy(50, 40); rig.home(); rig.setPitch(0.7); rig.snapYaw();
  assert.equal(JSON.stringify({ y: rig.yaw, p: rig.pitch, gy: rig.goal.yaw, gp: rig.goal.pitch, d: rig.goal.dist }), before, 'locked: nothing moved');
  assert.equal(views, 0);
  rig.locked = false;
  rig.rotateStep(1);
  assert.ok(Math.abs(rig.goal.yaw - (C.yaw0 + Math.PI / 2)) < 1e-9);
  assert.equal(views, 1);
  // tilt down to the lowest level: the closest zoom becomes 9
  rig.setDist(7);
  rig.tiltStep(-1);
  assert.equal(rig.goal.pitch, 0.79);
  assert.ok(rig.goal.dist >= 9, 'goal.dist raised');
  rig.zoomBy(0.1);
  assert.ok(rig.goal.dist >= 9, 'and zooming in stops at 9');
  rig.setDist(3);
  assert.ok(rig.dist >= 9);
  rig.tiltStep(+1);
  rig.setDist(3);
  assert.equal(rig.dist, 7, 'back at 0.92 the closest zoom is 7 again');
  // the goal lerps; update() eases yaw and pitch together
  rig.tiltStep(+1);
  assert.equal(rig.goal.pitch, 1.07);
  assert.notEqual(rig.pitch, 1.07);
  for (let i = 0; i < 60; i++) rig.update(1 / 30);
  assert.ok(Math.abs(rig.pitch - 1.07) < 1e-3 && Math.abs(rig.yaw - rig.goal.yaw) < 1e-3);
  // orbit: 1:1, clamped tilt; snap after
  rig.orbitBy(-10, 1000);
  assert.equal(rig.goal.pitch, C.pitch.max);
  assert.equal(rig.pitch, C.pitch.max, 'orbit is instant');
  rig.snapYaw();
  assert.ok(Math.abs(rig.goal.yaw - (C.yaw0 + Math.PI / 2)) < 1e-9, '0.1 rad off a diagonal snaps back');
  rig.home();
  assert.equal(rig.goal.pitch, C.pitch.def);
  assert.ok(Math.abs(rig.goal.yaw - C.yaw0) < 1e-9 || Math.abs(rig.goal.yaw - C.yaw0 - 2 * Math.PI) < 1e-9);
  // reduced motion: turn / tilt / Home land at once
  rig.reducedMotion = () => true;
  rig.rotateStep(-1);
  assert.equal(rig.yaw, rig.goal.yaw);
  rig.tiltStep(-1);
  assert.equal(rig.pitch, rig.goal.pitch);
  rig.home();
  assert.equal(rig.yaw, rig.goal.yaw);
  assert.equal(rig.pitch, C.pitch.def);
  rig.reducedMotion = () => false;

  // World.frame through a stub world (no WebGL): the solve uses opts.pitch, which becomes the tilt goal
  const hadWindow = 'window' in globalThis;
  const oldWindow = globalThis.window;
  globalThis.window = { innerWidth: 390, innerHeight: 844 };
  try {
    const cam = new THREE.PerspectiveCamera(50, 390 / 844, 0.5, 300);
    const w = Object.create(World.prototype);
    Object.assign(w, { camera: cam, rig: new CameraRig(cam), scratchCam: new THREE.PerspectiveCamera(), prefersReducedMotion: false });
    const pts = [new THREE.Vector3(3, 0.3, 2), new THREE.Vector3(5, 0.3, 2), new THREE.Vector3(3, 0.3, 4), new THREE.Vector3(5, 0.3, 4)];
    const safe = { left: 12, top: 140, right: 378, bottom: 740 };
    w.rig.tiltStep(+1); w.rig.tiltStep(+1); // the player tilted up to 1.22
    let r = w.frame(pts, { safe, minDist: 8, instant: true });
    assert.equal(w.rig.goal.pitch, 1.22, 'framing keeps the player\'s tilt');
    assert.ok(r.fits && w.inSafe(pts, safe), 'fits at their tilt');
    r = w.frame(pts, { safe, minDist: 8, instant: true, pitch: 0.66 });
    assert.equal(w.rig.goal.pitch, 0.66);
    assert.equal(w.rig.pitch, 0.66, 'instant: the tilt lands too');
    assert.ok(r.dist >= 9, 'the solve starts at the low tilt\'s closest zoom');
    assert.ok(r.fits && w.inSafe(pts, safe), 'fits at the asked tilt');
    w.frame(pts, { safe, pitch: C.pitch.def });
    assert.equal(w.rig.goal.pitch, C.pitch.def, 'a gliding frame sets the goal and lets the rig ease there');
  } finally { if (hadWindow) globalThis.window = oldWindow; else delete globalThis.window; }
});

test('settings: the camera view and two-finger turn are saved; new farms default to Home and on', () => {
  const st = new MemStorage();
  const g = fresh(st);
  assert.equal(g.s.settings.cam, null);
  assert.equal(g.s.settings.twist, true);
  g.s.settings.cam = { yaw: 2.3562, pitch: 1.07 };
  g.s.settings.twist = false;
  g.save();
  const g2 = fresh(st);
  assert.deepEqual(g2.s.settings.cam, { yaw: 2.3562, pitch: 1.07 });
  assert.equal(g2.s.settings.twist, false);
});

// ---------------------------------------------------------------- v4: the Post (§2) and its foundations (§6)
const MIN = 60, HOUR = 3600;
const P = CFG.POST.coins;
const toReady = (g) => { t = Math.max(t, g.s.post.nextAt); };
// a v3 save as the previous release wrote it (no post, album, charm or rng)
const v3Save = ({ level = 4, ageH = 1, tour = true, mode = 'coached' } = {}) => {
  const g = fresh();
  const s = JSON.parse(JSON.stringify(g.s));
  s.version = 3;
  for (const k of ['post', 'album', 'charm', 'rng']) delete s[k];
  s.level = level; s.xp = CFG.xpForLevel(level);
  s.createdAt = t - ageH * 3600000;
  s.tutorial.startedAt = tour ? s.createdAt : 0;
  s.tutorial.mode = mode;
  delete s.settings.cam; delete s.settings.twist;
  return s;
};

test('post schedule: #1 at 5:00; prompt opens at 5 m, 15 m, 30 m, 1 h, 4 h, 12 h, 20 h, 28 h; a late open shifts the chain', () => {
  const g = fresh();
  const t0 = g.s.createdAt;
  assert.equal(g.s.post.nextAt, t0 + 5 * 60000);
  advance(5 * MIN - 1);
  assert.equal(g.postStatus().ready, false, 'not at 4:59');
  assert.equal(g.claimPost(), null);
  advance(1);
  assert.equal(g.postStatus().ready, true, 'ready at 5:00');
  const ages = [];
  for (let i = 0; i < 8; i++) {
    toReady(g);
    assert.equal(g.postStatus().ready, true);
    g.claimPost();
    ages.push((t - t0) / 60000);
  }
  assert.deepEqual(ages, [5, 15, 30, 60, 240, 720, 1200, 1680]);
  assert.equal(g.stat('parcels'), 8);
  // opening late: the next countdown starts at the moment you open
  toReady(g);
  advance(5 * HOUR);
  g.claimPost();
  assert.equal(g.s.post.nextAt, t + 8 * HOUR * 1000);
  assert.equal(g.s.post.lastAt, t);
});

test('post: no stacking — after 3 days exactly one parcel waits; opening it starts the next countdown', () => {
  const g = fresh();
  g.s.post.n = 6;
  g.s.post.nextAt = t + 3600000;
  advance(3 * 24 * HOUR);
  assert.equal(g.postStatus().ready, true);
  const r = g.claimPost();
  assert.ok(r && r.n === 6);
  assert.equal(g.s.post.nextAt, t + 8 * HOUR * 1000);
  assert.equal(g.postStatus().ready, false);
  assert.equal(g.claimPost(), null, 'a second open gets nothing');
  assert.equal(g.stat('parcels'), 1);
});

test('post clock: a rewound clock freezes it; a save from the future is clamped on load; msLeft ≤ the gap', () => {
  const st = new MemStorage();
  const g = fresh(st);
  g.s.post.n = 5;
  toReady(g);
  g.claimPost();
  const next = g.s.post.nextAt;
  g.save();
  advance(-2 * 24 * HOUR);
  assert.equal(g.postStatus().ready, false, 'clock set back 2 days');
  assert.equal(g.s.post.nextAt, next, 'nextAt unchanged');
  assert.ok(g.postStatus().msLeft <= CFG.POST.every * 1000);
  // reloading with the clock still set back never makes it ready (time is pinned to when the save was last seen)
  const g2 = fresh(st);
  assert.equal(g2.postStatus().ready, false);
  assert.equal(g2.s.post.nextAt, next);
  advance(2 * 24 * HOUR);
  // a save whose nextAt is 3 days ahead
  const st2 = new MemStorage();
  const h = fresh(st2);
  h.s.post.n = 2;
  h.s.post.nextAt = t + 3 * 24 * 3600000;
  h.save();
  const h2 = fresh(st2);
  assert.equal(h2.s.post.nextAt, t + (15 * MIN + 5 * MIN) * 1000, 'clamped to now + gapFor(n) + 5 min');
  for (const n of [0, 1, 2, 3, 4, 5, 9]) {
    h2.s.post.n = n;
    h2.s.post.nextAt = t + 10 * 24 * 3600000;
    const s = h2.postStatus();
    assert.ok(s.msLeft <= (CFG.POST.gaps[n] ?? CFG.POST.every) * 1000 && s.progress >= 0 && s.progress <= 1, `msLeft ≤ gap (n ${n})`);
  }
});

test('post contents: the welcome five, the 4-cycle, P(L), the pantry worth exactly P(L), keepsake fallback, golds, office', () => {
  const g = fresh();
  // P(L) (§2.2)
  const table = { 6: 75, 8: 115, 10: 160, 12: 210, 14: 260, 16: 320, 18: 380, 20: 445, 22: 515, 24: 590, 26: 665, 28: 740, 30: 820, 33: 950, 35: 1035, 40: 1265 };
  for (const [L, v] of Object.entries(table)) assert.equal(P(+L), v, `P(${L})`);
  // welcome #1–#5 (§2.3): gems, the clover and the Mailbox only; no coins or items before 4 h
  const want = [
    { kind: 'welcome', sender: 'mabel', gems: 2 }, { kind: 'welcome', sender: 'rosa', gems: 2 },
    { kind: 'welcome', sender: 'kip', gems: 2, keepsake: 'meadow:clover' }, { kind: 'welcome', sender: 'hank', gems: 3, gift: 'mailbox', place: true },
    { kind: 'big', sender: 'mabel', gems: 5, coins: true, keepsake: true },
  ];
  let gems = 0;
  for (let n = 0; n < 5; n++) {
    const c = g.postContents(n, 9);
    const w = want[n];
    assert.equal(c.kind, w.kind, `#${n + 1} kind`);
    assert.equal(c.sender, w.sender, `#${n + 1} sender`);
    assert.equal(c.gems, w.gems, `#${n + 1} gems`);
    assert.equal(c.keepsake, w.keepsake || null, `#${n + 1} keepsake`);
    assert.equal(c.gift, w.gift || null);
    assert.equal(c.place, !!w.place);
    assert.equal(c.coins, w.coins ? P(9) : 0, `#${n + 1} coins`);
    assert.deepEqual(c.items, {});
    assert.ok(c.note && [...c.note].length <= 85, `#${n + 1} note`);
    gems += c.gems;
  }
  assert.ok(gems <= 15, 'welcome gems ≤ 15');
  // #6 onwards (§2.4): keepsake · pantry · postcard · big, senders by level
  const kinds = [5, 6, 7, 8, 9, 10, 11, 12].map((n) => g.postContents(n, 12).kind);
  assert.deepEqual(kinds, ['keepsake', 'pantry', 'postcard', 'big', 'keepsake', 'pantry', 'postcard', 'big']);
  const send = (n, L) => g.postContents(n, L).sender;
  assert.deepEqual([send(5, 6), send(5, 7), send(5, 21), send(9, 21), send(13, 21)], ['mabel', 'kip', 'kip', 'juno', 'kip']);
  assert.deepEqual([send(6, 6), send(6, 7)], ['mabel', 'rosa']);
  assert.deepEqual([send(7, 10), send(7, 11), send(7, 16), send(11, 16), send(11, 15)], ['mabel', 'theo', 'theo', 'hank', 'theo']);
  assert.equal(send(8, 30), 'mabel');
  const ks = g.postContents(5, 12), pc = g.postContents(7, 12), big = g.postContents(8, 12);
  assert.deepEqual([ks.gems, ks.keepsake, ks.keepsakeFallback, ks.coins], [1, true, 2, 0]);
  assert.deepEqual([pc.gems, pc.keepsake, pc.coins, pc.wrap], [2, null, 0, 'postcard']);
  assert.deepEqual([big.gems, big.keepsake, big.coins, big.wrap, big.gift], [4, true, P(12), 'big', null]);
  // recurring notes rotate per round of four (verbatim from config)
  assert.equal(g.postContents(5, 12).note, CFG.POST.notes.kip[0]);
  assert.equal(g.postContents(9, 22).note, CFG.POST.notes.juno[1]);
  assert.equal(g.postContents(17, 12).note, CFG.POST.notes.kip[0], 'round 3 wraps to the first note');
  // the pantry: always worth exactly P(L), as goods when they fit (computed examples from §2.4)
  assert.deepEqual(g.postContents(6, 8).items, { cookie: 2 });
  assert.equal(g.postContents(6, 8).coins, 15);
  assert.deepEqual(g.postContents(6, 14).items, { tomjuice: 2 });
  assert.deepEqual(g.postContents(6, 35).items, { shirt: 2 });
  for (let L = 3; L <= 45; L++) {
    const c = g.postContents(6, L);
    const value = c.coins + Object.entries(c.items).reduce((s, [i, n]) => s + n * CFG.ITEMS[i].price, 0);
    assert.equal(value, P(L), `pantry L${L}`);
    for (const [i, n] of Object.entries(c.items)) {
      assert.ok(n <= CFG.POST.pantryMaxQty && CFG.ITEMS[i].price <= P(L) / 2 && CFG.ITEMS[i].cat !== 'material', `pantry L${L} ${i}`);
      const r = CFG.RECIPES[i];
      assert.ok(Math.max(r.level || 0, CFG.OBJECTS[r.building].level) <= L - 1, `unlocked a level ago (L${L} ${i})`);
    }
  }
  // the Barn-full path pays the same value in coins (with a toast)
  const full = fresh();
  full.s.level = 14; full.s.xp = CFG.xpForLevel(14);
  full.s.post.n = 6;
  full.s.inventory.egg = full.storageCap('barn');
  const coins = full.s.coins;
  const toasts = [];
  full.on('toast', (x) => toasts.push(x.text));
  toReady(full);
  const r = full.claimPost();
  assert.equal(r.kind, 'pantry');
  assert.equal(full.s.coins - coins, P(14), 'Barn full: coins instead');
  assert.equal(full.count('tomjuice'), 0);
  assert.ok(toasts.some((x) => /Barn was full, so Rosa sent coins instead/.test(x)));
  // keepsake fallback: nothing missing on an open page → 💎2 instead
  const k = fresh();
  for (const p of CFG.ALBUM.pages) for (const [it] of p.items) k.s.album.have[`${p.id}:${it}`] = 1;
  k.s.album.open = true;
  k.s.post.n = 5;
  toReady(k);
  const gems0 = k.s.gems;
  const kr = k.claimPost();
  assert.equal(k.s.gems - gems0, 1 + 2);
  assert.ok(!kr.tiles.some((x) => x.kind === 'keepsake'));
  // golds: every 3rd Big parcel (n = 16, 28), then 💎3
  const bigs = [8, 12, 16, 20, 24, 28, 32, 36, 40].map((n) => g.postContents(n, 20));
  assert.deepEqual(bigs.map((c) => c.gift), [null, null, 'goldscarecrow', null, null, 'goldlamp', null, null, null]);
  assert.deepEqual(bigs.map((c) => c.gems), [4, 4, 4, 4, 4, 4, 4, 4, 4 + 3]);
  assert.ok(bigs.every((c) => !c.place), 'golds are never placed right away');
  for (const type of CFG.POST.golds) {
    const d = CFG.OBJECTS[type];
    assert.ok(d && d.kind === 'decor' && d.level === 99 && d.cost === 0 && d.tint === 'gold' && CFG.OBJECTS[d.model], type);
  }
  // the office parcel
  const o = fresh();
  o.s.post = { n: 5, nextAt: t, lastAt: 0, office: true, notified: false };
  o.s.level = 20;
  const oc = o.postContents();
  assert.deepEqual([oc.kind, oc.sender, oc.gems, oc.coins, oc.keepsake, oc.gift, oc.place, oc.wrap], ['office', 'hank', 5, P(20), 'meadow:clover', 'mailbox', true, 'big']);
  assert.equal(oc.note, CFG.POST.office.note);
});

test('post: zero faucets — 400 parcels at random levels give no XP, no materials, no level-up; grant() refuses materials and XP', () => {
  const g = fresh();
  const r = rng(42);
  let levelups = 0;
  g.on('levelup', () => levelups++);
  const mats = () => Object.entries(g.s.inventory).filter(([i]) => CFG.ITEMS[i].cat === 'material').reduce((s, [, n]) => s + n, 0);
  const m0 = mats();
  for (let i = 0; i < 400; i++) {
    const L = 1 + Math.floor(r() * 45);
    g.s.level = L; g.s.xp = CFG.xpForLevel(L);
    toReady(g);
    const res = g.claimPost();
    assert.ok(res, `parcel ${i}`);
    assert.equal(g.s.xp, CFG.xpForLevel(L), 'no XP');
    assert.equal(g.s.level, L);
    if (i % 25 === 0) for (const k of Object.keys(g.s.inventory)) if (CFG.ITEMS[k].cat !== 'material') delete g.s.inventory[k]; // keep Barn room
  }
  assert.equal(levelups, 0);
  assert.equal(mats(), m0, 'no materials');
  assert.equal(g.granted.post.xp, 0);
  assert.equal(g.granted.post.materials, 0);
  for (const i of Object.keys(g.granted.post.items)) assert.notEqual(CFG.ITEMS[i].cat, 'material');
  assert.throws(() => g.grant('test', { items: { plank: 1 } }), /materials/);
  assert.throws(() => g.grant('test', { xp: 5 }), /XP/);
  assert.equal(g.count('plank'), 0);
});

test('post RNG: Math.random is never used; the same seed picks the same keepsakes; a save round-trip continues the sequence', () => {
  // Math.random throws while parcels are opened (building a Game still rolls its first orders)
  const noRandom = (fn) => { const orig = Math.random; Math.random = () => { throw new Error('Math.random used'); }; try { return fn(); } finally { Math.random = orig; } };
  const picks = (g, n) => noRandom(() => { const out = []; for (let i = 0; i < n; i++) { toReady(g); const r = g.claimPost(); out.push(r.tiles.find((x) => x.kind === 'keepsake')?.id || null); } return out; });
  const t0 = t;
  const g1 = fresh();
  g1.s.post.n = 4; // #5 onwards: random keepsakes
  const a = picks(g1, 12);
  t = t0;
  const g2 = fresh();
  g2.s.post.n = 4;
  const b = picks(g2, 12);
  // save after 6, reload, carry on: the same 12
  t = t0;
  const st = new MemStorage();
  const g3 = fresh(st);
  g3.s.post.n = 4;
  const c = picks(g3, 6);
  g3.save();
  c.push(...picks(fresh(st), 6));
  assert.ok(a.filter(Boolean).length >= 5, 'keepsakes picked');
  assert.deepEqual(a, b, 'same seed, same picks');
  assert.deepEqual(c, a, 'a reload continues the sequence');
  assert.equal(new Set(a.filter(Boolean)).size, a.filter(Boolean).length, 'never a duplicate');
  // rand(): [0, 1), saved state
  const g = fresh();
  const s0 = g.s.rng;
  for (let i = 0; i < 1000; i++) { const x = g.rand(); assert.ok(x >= 0 && x < 1); }
  assert.notEqual(g.s.rng, s0);
  assert.equal(fresh().s.rng, ((t ^ 0x9e3779b9) >>> 0) || 1, 'seeded from createdAt');
});

test('migration v3 → v4: young farms get the welcome, veterans the office parcel and What\'s new; twice is harmless', () => {
  // a young tour farm: the whole welcome, #1 at least a minute away
  const young = loadSave(v3Save({ level: 4, ageH: 1 }));
  assert.equal(young.s.version, 4);
  assert.equal(young.s.post.n, 0);
  assert.equal(young.s.post.office, false);
  assert.ok(young.s.post.nextAt >= t + 60000, 'ready ≥ now + 60 s');
  assert.equal(young.postStatus().ready, false);
  assert.ok(!young.hasSeen('whatsNew:pending'));
  assert.deepEqual([young.s.settings.cam, young.s.settings.twist], [null, true]);
  assert.equal(young.s.rng, ((young.s.createdAt ^ 0x9e3779b9) >>> 0) || 1);
  assert.equal(loadSave(v3Save({ level: 4, ageH: 0.1 })).s.post.nextAt, t + 60000, 'a 6-minute-old farm: #1 a minute after the update');
  assert.equal(loadSave(v3Save({ level: 1, ageH: 0.02 })).s.post.nextAt, t - 72000 + 5 * 60000, 'a brand-new farm keeps its 5:00');
  for (const s of [v3Save({ level: 4, ageH: 5 }), v3Save({ level: 7, ageH: 1 }), v3Save({ level: 3, ageH: 1, tour: false })]) {
    assert.equal(loadSave(s).s.post.office, true, 'old, past L6 or never toured → office');
  }
  // an L20 veteran: the office parcel waits now; after it, 8 h and the cycle from the keepsake slot
  const vet = loadSave(v3Save({ level: 20, ageH: 200, mode: 'independent' }));
  const st = vet.postStatus();
  assert.ok(st.ready && st.office && st.kind === 'office' && !st.intro);
  assert.ok(vet.hasSeen('whatsNew:pending'));
  const gems = vet.s.gems, coins = vet.s.coins;
  const r = vet.claimPost();
  assert.ok(r.office);
  assert.equal(vet.s.gems - gems, 5);
  assert.equal(vet.s.coins - coins, P(20));
  assert.ok(vet.albumOpen() && vet.s.album.have['meadow:clover'], 'the clover opens the album');
  assert.deepEqual(vet.s.gifts, ['mailbox']);
  assert.deepEqual(r.gift, { type: 'mailbox', place: true });
  assert.equal(vet.s.post.office, false);
  assert.equal(vet.s.post.n, 5, 'n stays 5');
  assert.equal(vet.s.post.nextAt, t + 8 * HOUR * 1000);
  assert.equal(r.next.kind, 'keepsake');
  assert.equal(vet.postStatus().kind, 'keepsake');
  // an L40 save: tips of levels already reached are seen; migrating twice changes nothing
  const old = loadSave(v3Save({ level: 40, ageH: 900, mode: 'independent' }));
  for (const l of [31, 35, 37, 39]) assert.ok(old.hasSeen('tip:' + l), `tip:${l}`);
  assert.ok(!loadSave(v3Save({ level: 30, ageH: 900 })).hasSeen('tip:31'));
  const snap = JSON.stringify(old.s);
  old.migrate(old.s);
  assert.equal(JSON.stringify(old.s), snap, 'migrating twice is harmless');
  // v1 / v2 fixtures come through v3 to v4 as established farms
  const v2 = loadSave(v2Save({ index: 9, progress: 0 }, 8));
  assert.equal(v2.s.version, 4);
  assert.ok(v2.postStatus().office);
});

test('save round-trip: post, album, charm, rng and settings.cam', () => {
  const st = new MemStorage();
  const g = fresh(st);
  toReady(g); g.claimPost();
  toReady(g); g.claimPost();
  toReady(g); g.claimPost(); // Kip's clover
  g.rand(); g.rand();
  g.s.charm.vouchers = 2;
  g.s.settings.cam = { yaw: 3.9270, pitch: 0.79 };
  g.save();
  const g2 = fresh(st);
  for (const k of ['post', 'album', 'charm', 'rng']) assert.deepEqual(g2.s[k], g.s[k], k);
  assert.deepEqual(g2.s.settings.cam, g.s.settings.cam);
  assert.equal(g2.s.version, 4);
  assert.equal(g2.rand(), g.rand(), 'the RNG carries on');
});

// ---------------------------------------------------------------- Mabel's Keepsake Album (§3)
const pageIds = (id) => CFG.ALBUM.pages.find((p) => p.id === id).items.map(([it]) => `${id}:${it}`);
const fillPage = (g, id) => { for (const k of pageIds(id)) g.s.album.have[k] ||= 1; g.s.album.open = true; };
const albumAt = (L, features) => { const g = features ? new Game({ clock, storage: null, features }) : fresh(); g.s.level = L; g.s.xp = CFG.xpForLevel(L); return g; };
const mats = (g) => Object.entries(g.s.inventory).filter(([i]) => CFG.ITEMS[i].cat === 'material').reduce((n, [, k]) => n + k, 0);

test('album: closed → no rolls; the first keepsake opens it; level 8 primes it so the first action finds one', () => {
  const g = albumAt(5);
  for (let i = 0; i < 500; i++) assert.equal(g.rollKeepsake('crop', 1000), null);
  assert.equal(g.s.album.meter, 0, 'no meter while closed');
  assert.ok(!g.albumOpen());
  // a parcel's clover opens it
  assert.equal(g.giveKeepsake('post', 'meadow:clover'), 'meadow:clover');
  assert.ok(g.albumOpen() && g.s.album.have['meadow:clover']);
  assert.deepEqual(g.s.album.fresh, ['meadow:clover']);
  assert.equal(g.stat('keepsakes'), 1);
  // the same fixed id again: a different missing piece, never a duplicate
  const again = g.giveKeepsake('post', 'meadow:clover');
  assert.ok(again && again !== 'meadow:clover' && again.startsWith('meadow:'));
  // level 8 with the album still closed: primed, and the very first eligible action finds one (any xp)
  const p = albumAt(8);
  const events = [];
  p.on('keepsake', (e) => events.push(e));
  const id = p.rollKeepsake('animal', 1, { obj: 5 });
  assert.ok(id, 'primed find');
  assert.ok(p.albumOpen() && p.s.album.primed);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].at, { obj: 5 });
  assert.equal(events[0].source, 'animal');
  assert.equal(p.s.album.meter, 0, 'the meter resets on a find');
  // not while the office parcel waits (its clover opens the album) — and only once
  const o = albumAt(12);
  o.s.post.office = true;
  assert.equal(o.rollKeepsake('crop', 5), null);
  assert.ok(!o.s.album.primed);
  const q = albumAt(9);
  q.s.album.primed = true;
  assert.equal(q.rollKeepsake('crop', 1), null, 'primed once only');
});

test('album: chance ∝ xp (≤ 0.5), pity at 1.5·D, D(L) = max(60, xpToNext)', () => {
  assert.equal(CFG.ALBUM.divisor(1), 60);
  assert.equal(CFG.ALBUM.divisor(20), CFG.xpToNext(20));
  const rate = (L, xp, n = 4000) => {
    const g = albumAt(L);
    g.s.album.open = true;
    let hits = 0;
    for (let i = 0; i < n; i++) {
      g.s.album.meter = 0;
      if (g.rollKeepsake('crop', xp)) { hits++; g.s.album.have = {}; }
    }
    return hits / n;
  };
  const D10 = CFG.ALBUM.divisor(10);
  assert.ok(Math.abs(rate(10, D10 / 10) - 0.1) < 0.025, 'xp D/10 → ~10%');
  assert.ok(Math.abs(rate(10, D10 / 4) - 0.25) < 0.03, 'xp D/4 → ~25%');
  assert.ok(Math.abs(rate(10, D10 * 1.2) - 0.5) < 0.03, 'capped at 50% (below the pity line)');
  assert.equal(rate(10, D10 * 1.5, 200), 1, 'one action worth 1.5·D always finds one');
  // pity: with an unlucky RNG, the roll that takes the meter to 1.5·D always finds one
  const g = albumAt(10);
  g.s.album.open = true;
  g.rand = () => 0.99999;
  assert.equal(g.rollKeepsake('crop', D10 / 2), null);
  assert.equal(g.rollKeepsake('crop', D10 / 2), null);
  assert.equal(g.s.album.meter, D10);
  assert.ok(g.rollKeepsake('crop', D10 / 2), 'pity at 1.5·D');
  assert.equal(g.s.album.meter, 0);
  // spamming quick crops never beats the xp rate: 2 xp at L10 → about 2/D per harvest
  assert.ok(rate(10, 2, 3000) < 0.02);
});

test('album: routing — the source page, then an "anywhere" page, then the earliest; parcels fill the oldest page', () => {
  const g = albumAt(20); // open: meadow (crop), barn (animal), kitchen (workshop), notes (order/visitor/wagon), orchard (fruit/crop), market (any)
  g.s.album.open = true;
  const pageOf = (id) => id && CFG.KEEPSAKES[id].page;
  const find = (src) => { g.s.album.meter = 1e9; return pageOf(g.rollKeepsake(src, 1)); };
  assert.equal(find('animal'), 'barn');
  assert.equal(find('workshop'), 'kitchen');
  for (const src of ['order', 'visitor', 'wagon']) assert.equal(find(src), 'notes');
  assert.equal(find('fruit'), 'orchard');
  assert.equal(find('crop'), 'meadow');
  fillPage(g, 'meadow');
  assert.equal(find('crop'), 'orchard', 'a full meadow page: the next page that wants crops');
  fillPage(g, 'barn');
  assert.equal(find('animal'), 'market', 'no animal page left: the "anywhere" page');
  fillPage(g, 'market');
  assert.equal(find('animal'), 'kitchen', 'then the earliest open page with a gap');
  // a parcel: the oldest unfinished page
  assert.equal(pageOf(g.giveKeepsake('post')), 'kitchen');
  // clearing a dead tree never rolls; neither does debris
  const t0 = albumAt(12);
  t0.s.album.open = true;
  let rolls = 0;
  const orig = t0.rollKeepsake.bind(t0);
  t0.rollKeepsake = (...a) => { rolls++; return orig(...a); };
  const tree = { id: t0.s.nextId++, type: 'appletree', x: t0.landLo() + 12, z: t0.landLo() + 12, rot: 0, jobs: [], plantedAt: 0, harvests: CFG.OBJECTS.appletree.harvests };
  t0.s.objects.push(tree); t0.rebuildOccupancy();
  assert.equal(t0.treeState(tree), 'dead');
  t0.removeObject(tree.id);
  for (const d of t0.debris()) t0.clearDebris(d.id);
  assert.equal(rolls, 0);
});

test('album: the seven actions roll (crop, fruit, animal, workshop, order, visitor, wagon) with their own xp', () => {
  const g = albumAt(25);
  g.s.coins = 1e7;
  g.s.album.open = true;
  const seen = [];
  const orig = g.rollKeepsake.bind(g);
  g.rollKeepsake = (src, xp, at) => { seen.push([src, xp]); return orig(src, xp, at); };
  // crop
  const [fx, fz] = [g.landLo() + 8, g.landLo() + 12];
  g.s.soil[`${fx},${fz}`] = { crop: { type: 'wheat', plantedAt: 0 } };
  assert.ok(g.harvest(fx, fz));
  // fruit
  const tree = { id: g.s.nextId++, type: 'appletree', x: g.landLo() + 12, z: g.landLo() + 12, rot: 0, jobs: [], plantedAt: 0 };
  g.s.objects.push(tree); g.rebuildOccupancy();
  assert.ok(g.harvestTree(tree));
  // animal
  const sp = g.findFreeSpot('coop');
  const coop = g.placeObject('coop', sp[0], sp[1]);
  const hen = g.buyAnimal('chicken');
  hen.readyAt = 1;
  assert.ok(g.collectAnimal(hen));
  // workshop
  const bp = g.findFreeSpot('bakery');
  const bakery = g.placeObject('bakery', bp[0], bp[1]);
  bakery.jobs.push({ recipe: 'bread', endAt: 1 });
  assert.ok(g.collectFactory(bakery));
  // order
  g.s.orders[0] = { id: 9001, items: { wheat: 1 }, coins: 10, xp: 7 };
  g.s.inventory.wheat = 5;
  assert.ok(g.fulfillOrder(9001));
  // visitor
  g.s.visitors.push({ id: 9002, npc: 'rosa', item: 'wheat', qty: 1, coins: 10, xp: 6 });
  assert.ok(g.serveVisitor(9002));
  // wagon
  g.s.wagon = { state: 'here', crates: [{ item: 'wheat', qty: 1, coins: 10, xp: 9, filled: false }, { item: 'wheat', qty: 99, coins: 10, xp: 9, filled: false }] };
  assert.ok(g.fillCrate(0));
  assert.deepEqual(seen.map(([s]) => s), ['crop', 'fruit', 'animal', 'workshop', 'order', 'visitor', 'wagon']);
  assert.deepEqual(seen.map(([, x]) => x), [CFG.CROPS.wheat.xp, CFG.OBJECTS.appletree.harvestXp, CFG.ANIMALS.chicken.xp, CFG.RECIPES.bread.xp, 7, 6, 9]);
  assert.ok(coop);
});

test('album: no duplicates over 2,000 finds; locked pages stay empty; every page found is a missing piece', () => {
  const g = albumAt(3);
  g.s.album.open = true;
  const got = [];
  g.on('keepsake', (e) => got.push(e.id));
  for (let i = 0; i < 1000; i++) { g.s.album.meter = 1e9; g.rollKeepsake(i % 2 ? 'animal' : 'crop', 5); g.giveKeepsake('post'); }
  assert.equal(new Set(got).size, got.length, 'never a duplicate');
  assert.equal(got.length, 6, 'only the meadow page is open below level 8');
  assert.ok(got.every((id) => id.startsWith('meadow:')), 'locked pages stay empty');
  const st = g.albumStatus();
  assert.ok(st.pages.filter((p) => p.id !== 'meadow').every((p) => p.found === 0));
  assert.ok(st.pages.slice(1).every((p) => p.locked));
  // every page open (L45): all 72, then nothing more (the parcel pays its fallback gems instead)
  const h = albumAt(45);
  h.s.album.open = true;
  const all = [];
  h.on('keepsake', (e) => all.push(e.id));
  for (let i = 0; i < 1000; i++) { h.s.album.meter = 1e9; h.rollKeepsake(['crop', 'fruit', 'order'][i % 3], 50); h.giveKeepsake('post'); }
  assert.equal(all.length, 72);
  assert.equal(new Set(all).size, 72);
  assert.equal(h.albumStatus().found, 72);
  assert.equal(h.giveKeepsake('post'), null);
});

test('album: a page pays once (gems + its decoration to place); the launch album after page 8; the all-12 title; vouchers', () => {
  // (Prettiest Farm off: the vouchers of pages 10–12 are paid as 💎15 each; with it on — the default — they are kept)
  const g = albumAt(45, { charm: false });
  g.s.album.open = true;
  const pages = [];
  g.on('albumPage', (r) => pages.push(r));
  let levelups = 0;
  g.on('levelup', () => levelups++);
  const xp0 = g.s.xp, m0 = mats(g);
  assert.deepEqual(g.albumPagesReady(), []);
  assert.equal(g.claimAlbumPage('meadow'), null, 'an incomplete page pays nothing');
  fillPage(g, 'meadow');
  assert.deepEqual(g.albumPagesReady(), ['meadow']);
  assert.equal(g.albumStatus().ready, 1);
  const gems0 = g.s.gems;
  const r = g.claimAlbumPage('meadow');
  assert.equal(r.gems, 3);
  assert.equal(r.gift, 'bluebath');
  assert.equal(g.s.gems, gems0 + 3);
  assert.deepEqual(g.s.gifts, ['bluebath']);
  assert.ok(r.tiles.some((t) => t.kind === 'gift' && t.type === 'bluebath'));
  assert.equal(r.launch, null);
  assert.equal(g.claimAlbumPage('meadow'), null, 'once');
  assert.equal(g.s.gems, gems0 + 3);
  // pages 2–8: the eighth claim adds the launch album (💎10, the Curio Cabinet, "Keeper of Keepsakes")
  const launchPages = CFG.ALBUM.pages.slice(1, 8).map((p) => p.id);
  for (const id of launchPages) fillPage(g, id);
  let last = null;
  for (const id of launchPages) last = g.claimAlbumPage(id);
  assert.equal(last.id, 'attic');
  assert.ok(last.launch && last.launch.gift === 'curio' && last.launch.gems === 10);
  assert.equal(last.title, 'Keeper of Keepsakes');
  assert.ok(g.s.album.launch && !g.s.album.all);
  assert.ok(g.s.charm.titles.includes('Keeper of Keepsakes'));
  assert.deepEqual(g.s.gifts, ['bluebath', 'copperwell', 'rosepicnic', 'blossomarch', 'harvestmill', 'mossfountain', 'lilacgazebo', 'silverrooster', 'curio']);
  // pages 9–12 (the charm feature is off: each gilding voucher is paid as 💎15)
  for (const id of ['heirloom', 'stars', 'festival', 'champion']) fillPage(g, id);
  let gems = g.s.gems;
  assert.equal(g.claimAlbumPage('stars').voucher, 1);
  assert.equal(g.s.gems, gems + 8 + 15, 'Starry Nights: 💎8 + a voucher as 💎15');
  assert.equal(g.s.charm.vouchers, 0);
  g.claimAlbumPage('festival');
  g.claimAlbumPage('heirloom');
  gems = g.s.gems;
  const fin = g.claimAlbumPage('champion');
  assert.equal(g.s.gems, gems + 10 + 2 * 15);
  assert.equal(fin.title, 'Valley Historian');
  assert.ok(g.s.album.all);
  assert.deepEqual(g.s.charm.titles, ['Keeper of Keepsakes', 'Valley Historian']);
  assert.ok(g.s.gifts.includes('skyballoon'));
  assert.equal(pages.length, 12);
  // the whole album: 90 gems (80 on the pages + 10 for the launch album), no XP, no materials, no level-up
  assert.equal(CFG.ALBUM.pages.reduce((n, p) => n + p.prize.gems, 0) + CFG.ALBUM.launch.gems, 90);
  assert.equal(g.granted.album.gems, 90 + 4 * 15, 'and 4 vouchers as 💎15');
  assert.equal(g.s.xp, xp0);
  assert.equal(mats(g), m0);
  assert.equal(levelups, 0);
  assert.equal(g.granted.album.xp, 0);
  assert.equal(g.granted.album.materials, 0);
  // with Prettiest Farm on (the default), a voucher is kept for gilding instead
  const c = fresh();
  c.s.level = 45;
  fillPage(c, 'stars');
  const cg = c.s.gems;
  const cr = c.claimAlbumPage('stars');
  assert.equal(c.s.gems, cg + 8);
  assert.equal(c.s.charm.vouchers, 1);
  assert.ok(cr.tiles.some((t) => t.kind === 'voucher' && t.n === 1));
  // the album feature off: no rolls, no finds, nothing to claim
  const off = new Game({ clock, storage: null, features: { album: false } });
  off.s.level = 20;
  assert.equal(off.rollKeepsake('crop', 1e6), null);
  assert.equal(off.giveKeepsake('post', 'meadow:clover'), null);
  fillPage(off, 'meadow');
  assert.deepEqual(off.albumPagesReady(), []);
  assert.equal(off.claimAlbumPage('meadow'), null);
});

test('album: albumStatus and albumSeen (NEW finds)', () => {
  const g = albumAt(10);
  const st0 = g.albumStatus();
  assert.deepEqual([st0.open, st0.found, st0.total, st0.ready, st0.pages.length], [false, 0, 72, 0, 12]);
  assert.deepEqual(st0.pages.map((p) => p.locked), [false, false, true, true, true, true, true, true, true, true, true, true]);
  g.giveKeepsake('post', 'meadow:clover');
  g.giveKeepsake('post', 'barn:bell');
  const st = g.albumStatus();
  assert.equal(st.found, 2);
  assert.deepEqual(st.pages[0].fresh, ['meadow:clover']);
  assert.deepEqual(st.pages[1].have, ['barn:bell']);
  let ev = 0;
  g.on('album', () => ev++);
  g.albumSeen('meadow');
  assert.deepEqual(g.s.album.fresh, ['barn:bell']);
  assert.equal(ev, 1);
  g.albumSeen('meadow');
  assert.equal(ev, 1, 'nothing new: no event');
});

// §7.7 #12 (older Androids): the game only uses emoji up to Unicode 13 (Android 11, iOS 14.2), checked in every source
// file. Unicode 14+ shows as an empty box on older phones. The one older exception is v2's Peach Jam 🫙 (Unicode 14).
test('emoji: nothing newer than Unicode 13 in src/ (except v2\'s Peach Jam 🫙)', () => {
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const q = path.join(d, f); if (fs.statSync(q).isDirectory()) walk(q); else if (/\.(js|css|html)$/.test(f)) files.push(q); } };
  walk(new URL('../src', import.meta.url).pathname);
  assert.ok(files.length > 15);
  // single code points added in Unicode 14, 15 and 16 (15.1 only added sequences)
  const NEW = [[0x1f6dc, 0x1f6df], [0x1f7f0, 0x1f7f0], [0x1f979, 0x1f979], [0x1f9cc, 0x1f9cc], [0x1fa75, 0x1fa77], [0x1fa7b, 0x1fa7c], [0x1fa87, 0x1fa89],
    [0x1fa8f, 0x1fa8f], [0x1faa9, 0x1faaf], [0x1fab7, 0x1fabf], [0x1fac3, 0x1fac6], [0x1face, 0x1facf], [0x1fad7, 0x1fadf], [0x1fae0, 0x1fae9], [0x1faf0, 0x1faf8]];
  const found = [];
  for (const f of files) {
    for (const ch of fs.readFileSync(f, 'utf8')) {
      const c = ch.codePointAt(0);
      if (ch !== '🫙' && NEW.some(([a, b]) => c >= a && c <= b)) found.push(`${ch} in ${path.basename(f)}`);
    }
  }
  assert.deepEqual(found, []);
  assert.equal(CFG.ITEMS.peachjam.icon, '🫙');
});

test('album config: 12 × 6 = 72 unique keepsakes and emoji; prizes are level-99 decor; pages unlock at their levels', () => {
  const A = CFG.ALBUM;
  assert.equal(A.pages.length, 12);
  const ids = [], emoji = [];
  for (const p of A.pages) {
    assert.equal(p.items.length, 6, p.id);
    for (const [it, icon, name] of p.items) { ids.push(`${p.id}:${it}`); emoji.push(icon); assert.ok(name && chars(name) <= 16, name); }
    assert.ok(p.hint && p.name && p.icon);
    assert.ok(p.src === null || (Array.isArray(p.src) && p.src.every((x) => ['crop', 'fruit', 'animal', 'workshop', 'order', 'visitor', 'wagon'].includes(x))), p.id);
  }
  assert.equal(new Set(ids).size, 72);
  assert.equal(new Set(emoji).size, 72);
  assert.equal(Object.keys(CFG.KEEPSAKES).length, 72);
  // no keepsake looks like something you farm, build or buy
  const gameIcons = new Set([...Object.values(CFG.ITEMS), ...Object.values(CFG.OBJECTS), ...Object.values(CFG.ANIMALS)].map((x) => x.icon).filter(Boolean));
  for (const e of emoji) assert.ok(!gameIcons.has(e), `keepsake ${e} clashes with a game icon`);
  assert.deepEqual(A.pages.map((p) => p.level), [0, 8, 11, 14, 17, 19, 24, 27, 31, 35, 37, 39]);
  assert.deepEqual(A.pages.map((p) => p.prize.gems), [3, 4, 5, 5, 6, 6, 7, 8, 8, 8, 10, 10]);
  assert.deepEqual(A.pages.map((p) => p.prize.gift || null), ['bluebath', 'copperwell', 'rosepicnic', 'blossomarch', 'harvestmill', 'mossfountain', 'lilacgazebo', 'silverrooster', 'skyballoon', null, null, null]);
  assert.deepEqual(A.pages.map((p) => p.prize.voucher || 0), [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2]);
  // every exclusive (§3.5) is a never-sold, free, level-99 decoration on a real model, with its charm
  const EXCL = { bluebath: ['birdbath', '#8fc9ff', 60], copperwell: ['well', '#f0a868', 55], rosepicnic: ['picnic', '#ffb3b3', 90], blossomarch: ['flowerarch', '#ffc0d9', 185],
    harvestmill: ['windmill', '#ffbe7a', 120], mossfountain: ['fountain', '#b5e8a8', 300], lilacgazebo: ['gazebo', '#d9c6ff', 455], silverrooster: ['statue', '#e3e9f0', 680],
    curio: [undefined, undefined, 300], skyballoon: ['balloon', '#bfe3ff', 960], blossomoak: ['oak', '#ffc7dd', 90], frostpine: ['pine', '#dff2ff', 90],
    goldscarecrow: ['scarecrow', 'gold', 75], goldlamp: ['lamp', 'gold', 75], mailbox: [undefined, undefined, 40] };
  for (const [type, [model, tint, charm]] of Object.entries(EXCL)) {
    const d = CFG.OBJECTS[type];
    assert.ok(d && d.kind === 'decor' && d.level === 99 && d.cost === 0, type);
    assert.equal(d.model, model, `${type} model`);
    assert.equal(d.tint, tint, `${type} tint`);
    assert.equal(d.charm, charm, `${type} charm`);
    if (model) assert.ok(CFG.OBJECTS[model], `${type}: ${model} is a real decoration`);
  }
  for (const p of A.pages) if (p.prize.gift) assert.ok(EXCL[p.prize.gift], p.prize.gift);
  assert.ok(CFG.OBJECTS[A.launch.gift] && A.launch.gems === 10 && A.launch.title === 'Keeper of Keepsakes' && A.all.title === 'Valley Historian');
  assert.equal(A.voucherFallbackGems, 15);
  // the level-up modal and "Next: …" list every page from level 8; 31/35/37/39 are no longer empty
  for (const p of A.pages.slice(1)) assert.ok(CFG.unlocksAtLevel(p.level).some((u) => u.name === `Album page: ${p.name}` && u.icon === '📖'), p.id);
  for (const L of [31, 35, 37, 39]) assert.ok(CFG.unlocksAtLevel(L).length > 0, `L${L}`);
  for (const L of [35, 37, 39]) assert.ok(CFG.FEATURE_TIPS[L] && chars(CFG.FEATURE_TIPS[L]) <= 80, `tip L${L}`);
  // exclusives never show up as an unlock
  for (const u of [...Array(45)].flatMap((_, l) => CFG.unlocksAtLevel(l + 1))) assert.ok(!Object.keys(EXCL).some((k) => CFG.OBJECTS[k].name === u.name), u.name);
});

test('album exclusives render through the one tint path (recolours, gold, o.gilded) and the Curio Cabinet has a model', async () => {
  const V = await import('../src/game/views.js');
  await import('../src/game/models/index.js');
  const A = await import('../src/game/assets.js');
  const colours = (obj) => { const out = new Set(); obj.traverse((m) => { if (m.isMesh && m.material !== A.MATS.glow && m.material !== A.MATS.glass) out.add('#' + m.material.color.getHexString()); }); return [...out]; };
  for (const [type, d] of Object.entries(CFG.OBJECTS)) {
    if (d.level !== 99 || d.kind !== 'decor') continue;
    const obj = V.applyTint(A.makeObject(d.model || type), V.tintFor({ type }));
    assert.ok(obj.children.length > 0, `${type} has a model`);
    if (d.tint === 'gold') assert.deepEqual(colours(obj), [CFG.GOLD.color], type);
    else if (d.tint) assert.deepEqual(colours(obj), [d.tint], type);
  }
  assert.ok(A.BUILDERS.curio, 'the curio model');
  // gilding (Prettiest Farm) takes the same path: a gilded object is gold whatever its type
  assert.equal(V.tintFor({ type: 'gazebo', gilded: true }), CFG.GOLD);
  assert.equal(V.tintFor({ type: 'gazebo' }), null);
  assert.equal(V.tintFor({ type: 'silverrooster' }).desat, 1);
  // one cloned material per colour (shared by every copy), and the ghost's copy keeps the shader tweak
  const a = V.applyTint(A.makeObject('statue'), V.tintFor({ type: 'silverrooster' }));
  const b = V.applyTint(A.makeObject('statue'), V.tintFor({ type: 'silverrooster' }));
  assert.equal(a.children[0].material, b.children[0].material);
  const c = V.cloneMaterial(a.children[0].material);
  assert.equal(c.customProgramCacheKey(), a.children[0].material.customProgramCacheKey());
});

test('album RNG: Math.random is never used by rolls, parcels or claims; the same seed finds the same keepsakes', () => {
  const noRandom = (fn) => { const orig = Math.random; Math.random = () => { throw new Error('Math.random used'); }; try { return fn(); } finally { Math.random = orig; } };
  const run = () => {
    const g = albumAt(30);
    g.s.album.open = true;
    return noRandom(() => {
      const out = [];
      for (let i = 0; i < 300; i++) out.push(g.rollKeepsake(['crop', 'fruit', 'animal', 'workshop', 'order', 'visitor', 'wagon'][i % 7], 40));
      for (let i = 0; i < 10; i++) out.push(g.giveKeepsake('post'));
      fillPage(g, 'meadow');
      out.push(g.claimAlbumPage('meadow').gift);
      return out;
    });
  };
  const t0 = t;
  const a = run();
  t = t0;
  const b = run();
  assert.ok(a.filter(Boolean).length > 10);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------- Prettiest Farm: 💗 charm, ribbons, gilding (§4)
// a farm at level L with no decorations at all (the starter oaks, pine, flowers and bush removed)
const bareAt = (L, features) => {
  const g = albumAt(L, features);
  g.s.objects = g.s.objects.filter((o) => CFG.OBJECTS[o.type].kind !== 'decor');
  g.rebuildOccupancy();
  return g;
};
// place a shop decoration (paid), or an exclusive through the gift flow
const putDecor = (g, type) => {
  const d = CFG.OBJECTS[type];
  const spot = g.findFreeSpot(type);
  assert.ok(spot, `room for ${type}`);
  if (d.level >= 99) { g.s.gifts.push(type); return g.placeGift(type, spot[0], spot[1], 0); }
  g.s.coins += d.cost;
  const lvl = g.s.level;
  g.s.level = Math.max(lvl, d.level);
  const o = g.placeObject(type, spot[0], spot[1], 0);
  g.s.level = lvl;
  assert.ok(o, `placed ${type}`);
  return o;
};

test('charm: charmOf values; up to 3 of each kind count (gilded first, ×3); gifts never count; memo follows add / remove / change', () => {
  const want = { path: 6, fence: 8, bush: 11, hay: 13, flowers: 14, oak: 15, pine: 18, bench: 22, lamp: 24, scarecrow: 25, well: 44, birdbath: 49,
    picnic: 75, windmill: 98, flowerarch: 155, fountain: 253, gazebo: 379, statue: 566, balloon: 800 };
  for (const [type, v] of Object.entries(want)) assert.equal(CFG.CHARM.of(type), v, type);
  for (const [type, d] of Object.entries(CFG.OBJECTS)) if (d.kind === 'decor' && d.charm != null) assert.equal(CFG.CHARM.of(type), d.charm, type);
  for (const type of ['coop', 'farmhouse', 'appletree', 'weed', 'nope']) assert.equal(CFG.CHARM.of(type), 0, type);
  // a new farm's starter decor: 2 oaks, a pine, 2 flower beds and a bush
  assert.equal(fresh().charm().total, 15 * 2 + 18 + 14 * 2 + 11);
  const g = bareAt(25);
  assert.equal(g.charm().total, 0);
  let events = [];
  g.on('charm', (e) => events.push(e.total));
  const f = [1, 2, 3, 4].map(() => putDecor(g, 'fence'));
  assert.equal(g.charm().total, 3 * 8, 'only 3 fences count');
  assert.deepEqual(events, [8, 16, 24], "'charm' goes out when the total moves (not for the 4th fence)");
  assert.deepEqual(g.charm().kinds.fence, { placed: 4, counted: 3, gilded: 0 });
  assert.equal(g.charm().of(f[0]), 8);
  assert.equal(g.charm().of(f[3]), 0, 'the 4th one is just for looks');
  // memoised: the same object until something is placed, removed or changed
  const m = g.charm();
  assert.equal(g.charm(), m);
  g.removeObject(f[0].id);
  assert.notEqual(g.charm(), m);
  assert.equal(g.charm().total, 24, 'the 4th takes the sold one\'s place');
  // gifts waiting in Shop → Decor never count; placed exclusives count their own value
  g.s.gifts.push('blossomoak', 'mossfountain');
  assert.equal(g.charm().total, 24);
  g.s.gifts = [];
  putDecor(g, 'mossfountain');
  assert.equal(g.charm().total, 24 + 300);
  // gilded copies count first, and triple: 4 fountains, the newest gilded
  const h = bareAt(31);
  const fs = [1, 2, 3, 4].map(() => putDecor(h, 'fountain'));
  assert.equal(h.charm().total, 3 * 253);
  h.s.coins = 1e6; h.s.gems = 1000;
  assert.ok(h.gild(fs[3]));
  assert.equal(h.charm().total, 253 * 3 + 2 * 253, 'the gilded one (×3) and the two oldest');
  assert.equal(h.charm().of(fs[3]), 759);
  assert.equal(h.charm().of(fs[2]), 0);
  assert.deepEqual(h.charm().kinds.fountain, { placed: 4, counted: 3, gilded: 1 });
  // the T(r) table and the rewards (124 gems, 2 decorations, 6 titles, the rosette at 10)
  assert.deepEqual(Array.from({ length: 30 }, (_, i) => CFG.CHARM.rank(i + 1)), [80, 180, 320, 500, 700, 940, 1200, 1500, 1840, 2200, 2600, 3020, 3480, 3980, 4500,
    5060, 5640, 6260, 6920, 7600, 8320, 9060, 9840, 10660, 11500, 12380, 13280, 14220, 15200, 16200]);
  const R = CFG.CHARM.rewards;
  assert.equal(R.length, 30);
  assert.equal(R.reduce((n, r) => n + (r.gems || 0), 0), 124);
  assert.deepEqual(R.map((r, i) => (r.gift ? `${i + 1}:${r.gift}` : null)).filter(Boolean), ['5:blossomoak', '15:frostpine']);
  assert.deepEqual(R.map((r) => r.title).filter(Boolean), ['Charming Farm', 'Prize Farm', 'Blue Ribbon Farm', 'Valley Showpiece', 'Pride of the Valley', 'Grand Champion Farm']);
  assert.deepEqual(R.map((r, i) => (r.rosette ? i + 1 : 0)).filter(Boolean), [10]);
  for (const r of R) for (const k of Object.keys(r)) assert.ok(['gems', 'gift', 'title', 'rosette'].includes(k), `no ${k} reward`);
  for (const r of R) if (r.gift) assert.ok(CFG.OBJECTS[r.gift].level === 99 && CFG.OBJECTS[r.gift].cost === 0, r.gift);
});

test('ribbons: from L19; claim all pays every reached rank once through grant(); ranks stay after removal; no XP, coins or materials', () => {
  const g = bareAt(18);
  const gz = putDecor(g, 'gazebo'), ft = putDecor(g, 'fountain'); // 379 + 253 = 632 → rank 4 reached
  putDecor(g, 'birdbath'); putDecor(g, 'oak'); // + 49 + 15 = 696
  assert.equal(g.charm().total, 696);
  let st = g.charmStatus();
  assert.deepEqual([st.unlocked, st.reached, st.ready], [false, 4, 0], 'level 18: not yet');
  assert.deepEqual(g.claimRibbons(), []);
  g.s.level = 19;
  st = g.charmStatus();
  assert.deepEqual([st.unlocked, st.total, st.ranks, st.reached, st.ready, st.next.rank, st.next.need], [true, 696, 0, 4, 4, 5, 700]);
  assert.deepEqual(st.next.reward, { gift: 'blossomoak', title: 'Charming Farm' });
  const xp0 = g.s.xp, gems0 = g.s.gems, m0 = mats(g);
  let lv = 0, rib = [];
  g.on('levelup', () => lv++);
  g.on('ribbons', (e) => rib.push(e.ranks.map((r) => r.rank)));
  const got = g.claimRibbons();
  assert.deepEqual(got.map((r) => r.rank), [1, 2, 3, 4]);
  assert.deepEqual(got.map((r) => r.gems), [2, 2, 2, 3]);
  assert.equal(g.s.gems, gems0 + 9);
  assert.equal(g.s.charm.ranks, 4);
  assert.deepEqual(rib, [[1, 2, 3, 4]]);
  assert.deepEqual(g.claimRibbons(), [], 'once');
  // one more flower bed: rank 5 — the Blossom Oak (to Shop → Decor 🎁) and "Charming Farm"
  putDecor(g, 'flowers');
  assert.equal(g.charmStatus().ready, 1);
  const r5 = g.claimRibbons();
  assert.deepEqual(r5.map((r) => [r.rank, r.gems, r.gift, r.title, r.rosette]), [[5, 0, 'blossomoak', 'Charming Farm', false]]);
  assert.ok(r5[0].tiles.some((t) => t.kind === 'gift' && t.type === 'blossomoak' && t.place));
  assert.deepEqual(g.s.gifts, ['blossomoak']);
  assert.ok(g.s.charm.titles.includes('Charming Farm'));
  assert.equal(g.granted.charm.gems, 9);
  assert.equal(g.granted.charm.gifts, 1);
  // ranks never go back: sell the gazebo and the fountain, charm drops, rank 5 stays claimed
  g.removeObject(gz.id); g.removeObject(ft.id);
  st = g.charmStatus();
  assert.ok(st.total < 700 && st.ranks === 5 && st.ready === 0);
  assert.equal(st.next.rank, 6, 'the next rank to reach is past the claimed ones');
  putDecor(g, 'gazebo'); putDecor(g, 'fountain');
  assert.equal(g.charmStatus().ready, 0, 'reaching a claimed rank again pays nothing');
  // no XP, no coins, no materials, no level-up from any rank
  assert.equal(g.s.xp, xp0);
  assert.equal(mats(g), m0);
  assert.equal(lv, 0);
  assert.equal(g.granted.charm.coins + g.granted.charm.xp + g.granted.charm.materials, 0);
  // every rank: 124 gems, both decorations, 6 titles, the rosette from 10 — all 30 on a fully decorated, gilded farm
  const all = bareAt(45);
  for (const type of ['flowerarch', 'fountain', 'gazebo', 'statue', 'balloon']) for (let i = 0; i < 3; i++) all.s.objects.push({ id: all.s.nextId++, type, x: -50, z: -50 - i, rot: 0, jobs: [], gilded: true });
  for (const type of ['mossfountain', 'lilacgazebo', 'silverrooster', 'skyballoon', 'blossomarch']) all.s.objects.push({ id: all.s.nextId++, type, x: -60, z: -60, rot: 0, jobs: [], free: true, gilded: true });
  all.rebuildOccupancy();
  assert.ok(all.charm().total >= CFG.CHARM.rank(30), `${all.charm().total}`);
  const gemsA = all.s.gems, xpA = all.s.xp;
  const list = all.claimRibbons();
  assert.equal(list.length, 30);
  assert.equal(all.s.gems - gemsA, 124);
  assert.deepEqual(all.s.gifts, ['blossomoak', 'frostpine']);
  assert.equal(all.s.charm.titles.length, 6);
  assert.ok(all.charmStatus().rosette && all.charmStatus().next === null);
  assert.equal(all.s.xp, xpA);
  assert.deepEqual(all.claimRibbons(), []);
  // the rosette needs rank 10 claimed
  assert.equal(g.charmStatus().rosette, false);
  // Prettiest Farm off: nothing to claim, nothing to gild
  const off = bareAt(45, { charm: false });
  putDecor(off, 'gazebo');
  off.s.charm.vouchers = 3;
  assert.deepEqual([off.charmStatus().unlocked, off.charmStatus().ready], [false, 0]);
  assert.deepEqual(off.claimRibbons(), []);
  const ofs = putDecor(off, 'fountain');
  assert.equal(off.gildCost(ofs), null);
  assert.equal(off.gild(ofs, { voucher: true }), null);
  assert.equal(off.s.charm.vouchers, 3);
});

test('gilding: L31, a base price ≥ 🪙1,500; coins + gems or a voucher; gold ×3 via objectChanged; selling refunds half the price only', () => {
  const g = bareAt(30);
  const ft = putDecor(g, 'fountain'), well = putDecor(g, 'well'), arch = putDecor(g, 'flowerarch');
  const moss = putDecor(g, 'mossfountain'), gs = putDecor(g, 'goldscarecrow'), cur = putDecor(g, 'curio'), oak = putDecor(g, 'blossomoak');
  g.s.coins = 100000; g.s.gems = 200;
  assert.equal(g.gildCost(ft), null, 'not before level 31');
  assert.equal(g.gild(ft), null);
  g.s.level = 31;
  assert.equal(g.charmStatus().gildUnlocked, true);
  assert.deepEqual(g.gildCost(ft), { coins: 8000, gems: 13, base: 4000, voucher: false });
  assert.deepEqual(g.gildCost(arch), { coins: 3000, gems: 9, base: 1500, voucher: false });
  assert.deepEqual(g.gildCost(moss), { coins: 8000, gems: 13, base: 4000, voucher: false }, 'a recolour costs what its model does');
  for (const o of [well, gs, cur, oak]) assert.equal(g.gildCost(o), null, o.type);
  // the spec's table: base → coins, gems
  const table = { flowerarch: [3000, 9], fountain: [8000, 13], gazebo: [18000, 16], statue: [40000, 20], balloon: [80000, 25],
    blossomarch: [3000, 9], mossfountain: [8000, 13], lilacgazebo: [18000, 16], silverrooster: [40000, 20], skyballoon: [80000, 25] };
  for (const [type, [c, gm]] of Object.entries(table)) assert.deepEqual(CFG.CHARM.gildCost(CFG.CHARM.gildBase(type)), { coins: c, gems: gm }, type);
  // coins + gems
  const changed = [], gilds = [];
  g.on('objectChanged', (o) => changed.push(o.id));
  g.on('gild', (r) => gilds.push(r));
  const before = g.charm().total, c0 = g.s.coins, gm0 = g.s.gems, xp0 = g.s.xp;
  const r = g.gild(ft.id);
  assert.ok(r && r.o === ft && !r.voucher && r.coins === 8000 && r.gems === 13);
  assert.equal(ft.gilded, true);
  assert.equal(g.s.coins, c0 - 8000);
  assert.equal(g.s.gems, gm0 - 13);
  assert.equal(g.s.xp, xp0, 'no XP');
  assert.deepEqual(changed, [ft.id]);
  assert.equal(gilds.length, 1);
  assert.equal(g.charm().total, before + 2 * 253, 'triple');
  assert.equal(g.gildCost(ft), null, 'once');
  assert.equal(g.gild(ft), null);
  // not enough coins or gems: nothing happens
  g.s.coins = 100;
  assert.equal(g.gild(arch), null);
  assert.ok(!arch.gilded && g.s.coins === 100);
  g.s.coins = 100000; g.s.gems = 0;
  assert.equal(g.gild(arch), null);
  assert.ok(!arch.gilded && g.s.coins === 100000);
  // a voucher (from Mabel's last album pages) pays instead
  g.s.charm.vouchers = 1;
  assert.equal(g.gildCost(arch).voucher, true);
  const vr = g.gild(arch, { voucher: true });
  assert.ok(vr && vr.voucher && arch.gilded);
  assert.deepEqual([g.s.coins, g.s.gems, g.s.charm.vouchers], [100000, 0, 0]);
  assert.equal(g.gild(moss, { voucher: true }), null, 'no voucher left');
  assert.ok(!moss.gilded);
  // selling: half the normal price, never the gilding; a free (gift) one refunds nothing
  g.s.gems = 50;
  assert.ok(g.gild(moss));
  assert.equal(g.removeObject(ft.id), 2000);
  assert.equal(g.removeObject(moss.id), 0);
  // a gilded piece survives a save round-trip (and so does its charm)
  const st = new MemStorage();
  const sv = new Game({ clock, storage: st });
  sv.s.level = 31; sv.s.coins = 1e5; sv.s.gems = 100;
  const sf = putDecor(sv, 'fountain');
  sv.gild(sf);
  sv.save();
  const back = new Game({ clock, storage: st });
  assert.equal(back.s.objects.find((o) => o.id === sf.id).gilded, true);
  assert.equal(back.charm().total, sv.charm().total);
});

test('charm RNG and faucets: claimRibbons and gild never touch Math.random; FEATURE_TIPS 19 and 31; unlocks at 19 and 31', () => {
  const g = bareAt(31);
  for (const type of ['gazebo', 'fountain', 'statue']) putDecor(g, type);
  g.s.coins = 1e5; g.s.gems = 100;
  const orig = Math.random;
  Math.random = () => { throw new Error('Math.random used'); };
  try {
    assert.ok(g.claimRibbons().length > 0);
    assert.ok(g.gild(g.s.objects.find((o) => o.type === 'fountain')));
  } finally { Math.random = orig; }
  assert.ok(CFG.unlocksAtLevel(19).some((u) => u.icon === '💗' && u.name === 'Prettiest Farm ribbons'));
  assert.ok(CFG.unlocksAtLevel(31).some((u) => u.icon === '✨' && u.name === 'Gilding'));
  for (const L of [19, 31]) assert.ok(CFG.FEATURE_TIPS[L] && chars(CFG.FEATURE_TIPS[L]) <= 80, `tip ${L}`);
  assert.ok(CFG.FEATURE_TIPS[19].includes('💗') && CFG.FEATURE_TIPS[31].startsWith('Gilding!'));
  // gilding shares the golden exclusives' tint
  assert.equal(CFG.CHARM.gold, CFG.GOLD);
});

let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try { await fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log("  ✗", name, "\n     ", e.message.split("\n")[0], (e.stack || "").split("\n").find((l) => l.includes("test.mjs:")) || ""); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
