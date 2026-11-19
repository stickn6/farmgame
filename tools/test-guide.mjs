// Guide planner tests (Node, no browser): part of `npm test`.
// Covers the planner contract (§6.3), the tutorial beats it drives (§1.3), reserves, blocks, need(),
// interrupts, graduation, modes, the daily auto-popup rule, a headless guide-follower that plays
// the whole scripted list through SimUI (tools/simui.mjs) at 4 s per tap, and a 30-seed wander fuzz.
import assert from 'node:assert/strict';
import { Game } from '../src/game/state.js';
import * as CFG from '../src/game/config.js';
import {
  planStep, recommendIdle, reserves, questBlock, need, earn, PLANNERS, shouldAutoShowDaily, nextMode, isGuideKey,
  pendingInterrupt, graduationPending, plantCap, placementSpot, levelUpGo, pendingTip, seedList, questCardInfo, hardBeat, markTipSeen,
  post1LineDue,
} from '../src/game/guide.js';
import { GuideFollower, SimUI } from './simui.mjs';

const T0 = Date.UTC(2026, 0, 1, 8);
let t = T0;
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
const qIndex = (id) => CFG.QUESTS.findIndex((q) => q.id === id);
const S = CFG.TUTORIAL.startLo;
const put = (g, type, x, z) => { const o = { id: g.s.nextId++, type, x, z, rot: 0, jobs: [] }; g.s.objects.push(o); g.rebuildOccupancy(); return o; };
const setQuest = (g, id) => { const i = qIndex(id); g.s.quest = { index: i, qid: id, progress: 0, notified: false }; };
const setLevel = (g, L) => { g.s.level = L; g.s.xp = CFG.xpForLevel(L); };
// every data-guide key a step (and its Meanwhile) mentions
const keysOf = (s) => (s ? [s.target?.ui, ...(s.chain || []), ...keysOf(s.meanwhile)].filter(Boolean) : []);
const assertKeys = (s, where = '') => { for (const k of keysOf(s)) assert.ok(isGuideKey(k), `bad guide key ${k} ${where}`); };
// deterministic Math.random for one block of code
const seeded = (seed, fn) => {
  const orig = Math.random;
  let s = seed >>> 0;
  Math.random = () => { s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  try { return fn(); } finally { Math.random = orig; }
};
// a coached farm (tour done) at the given goal
const coachedAt = (id, L = 1) => { const g = fresh(); g.skipTutorial(); setQuest(g, id); setLevel(g, L); return g; };

// ---------------------------------------------------------------- contract
test('every scripted and repeat goal event has a planner', () => {
  const events = new Set(CFG.QUESTS.map((q) => q.event));
  for (const make of CFG.REPEAT_QUESTS) events.add(make(0, 10).event);
  for (const e of events) assert.equal(typeof PLANNERS[e], 'function', `planner for ${e}`);
  for (const e of ['harvest', 'plant', 'plow', 'order', 'build', 'buyAnimal', 'feed', 'collect', 'produce', 'expand', 'visitor', 'storage', 'fruit', 'earn', 'level', 'crate', 'gift']) {
    assert.equal(typeof PLANNERS[e], 'function', `§6.3 planner ${e}`);
  }
});

test('planner: every scripted goal gets a real step on a farm fast-forwarded to it (any coins, panels, tools)', () => {
  const uis = [{}, { tool: 'plow' }, { panel: { id: 'shop', tab: 'land', ref: null, age: 9 } }, { panel: { id: 'orders', tab: 'orders', ref: null, age: 1 } }, { popover: { x: S + 6, z: S + 6 } }];
  for (const q of CFG.QUESTS) {
    for (const coins of [0, 60, 5000]) {
      for (const mode of ['guided', 'coached']) {
        const g = fresh();
        g.markSeen('welcome');
        if (mode === 'coached') g.skipTutorial();
        setQuest(g, q.id);
        setLevel(g, Math.max(1, CFG.questLevel(q)));
        g.s.coins = coins;
        for (const ui of uis) {
          const s = planStep(g, ui, { cache: false });
          assert.notEqual(s.kind, 'none', `${q.id} ${mode} coins ${coins} ${JSON.stringify(ui)} → ${s.key}`);
          assert.ok(s.key && s.icon != null && s.label, `step has key/icon/label (${s.key})`);
          assertKeys(s, `(${q.id})`);
          if (s.kind === 'wait') assert.ok(s.meanwhile, 'a wait carries a Meanwhile step');
        }
      }
    }
  }
});

test('planner: the endless goals after the list get real steps too', () => {
  for (let n = 0; n < CFG.REPEAT_QUESTS.length * 2; n++) {
    const g = fresh();
    g.skipTutorial();
    setLevel(g, 12);
    g.s.quest = { index: CFG.QUESTS.length + n, progress: 0, notified: false };
    const s = planStep(g, {}, { cache: false });
    assert.notEqual(s.kind, 'none', `${g.currentQuest().text} → ${s.key}`);
    assertKeys(s);
  }
});

test('planner: a new farm opens with Mabel; B1–B3 are hard beats; plant steps carry the guided cap', () => {
  const g = fresh();
  let s = planStep(g, {});
  assert.equal(s.key, 'welcome');
  assert.equal(s.target.ui, 'guide:next');
  assert.equal(s.modal, 'guide');
  assert.equal(s.stepKey, 'welcome');
  assert.equal(s.say, CFG.TUTORIAL.lines.welcome);
  assert.equal(s.pointer, false, 'no finger on the welcome card');
  assert.equal(hardBeat(g), false, 'no hard gate before the welcome');
  g.markSeen('welcome');
  // B1: the 6 ripe starter tiles, hard gate, Mabel's harvest line
  s = planStep(g, {});
  assert.equal(s.kind, 'world');
  assert.equal(s.target.world, 'tiles');
  assert.equal(s.target.tiles.length, 6);
  assert.equal(s.gate, 'hard');
  assert.equal(s.stepKey, 'harvest');
  assert.deepEqual(s.reveal || [], [], 'nothing revealed before the first harvest');
  const sim = new SimUI(g);
  sim.apply(s);
  assert.ok(g.questDone(), 'one tap harvests the patch (12 wheat)');
  // B2: claim, hard gate, quest card + barn + level box revealed
  s = planStep(g, sim.view());
  assert.equal(s.target.ui, 'quest:claim');
  assert.equal(s.gate, 'hard');
  assert.equal(s.stepKey, 'claim');
  for (const k of ['quest', 'barn', 'level']) assert.ok(s.reveal.includes(k), `reveals ${k}`);
  g.reveal(s.reveal);
  sim.apply(s);
  // B3: plant with cap 6 (the goal's count), hard gate; one crop unlocked → no popover
  s = planStep(g, sim.view());
  assert.equal(s.key, 'plant:wheat');
  assert.equal(s.cap, 6);
  assert.equal(s.gate, 'hard');
  assert.equal(s.chain, undefined, 'no seed popover at L1');
  sim.apply(s);
  assert.ok(g.questDone());
  // B3b: claim → L2, soft now
  s = planStep(g, sim.view());
  assert.equal(s.target.ui, 'quest:claim');
  assert.equal(s.gate, 'soft');
  assert.equal(s.stepKey, 'claimL2');
  sim.apply(s);
  assert.equal(g.s.level, 2);
  assert.equal(sim.ui.modal, 'levelup');
  s = planStep(g, sim.view());
  assert.equal(s.target.ui, 'modal:levelup:ok');
  assert.equal(s.stepKey, 'levelup2');
  assert.equal(s.say, CFG.TUTORIAL.lines.levelup2);
  // the cap only applies to the guided plant goal's own crop
  assert.equal(plantCap(g, 'carrot'), CFG.TUTORIAL.patchMax);
  const c = coachedAt('plant');
  assert.equal(plantCap(c, 'wheat'), CFG.TUTORIAL.patchMax, 'coached plants up to 24');
});

test('planner: B4–B12 point where the tour says, with the tour lines', () => {
  // play the tour and record the first step for each goal/target
  const seen = {};
  const eggsMw = []; // every Meanwhile of the B10 eggs wait
  const g2 = fresh();
  const sim2 = new SimUI(g2);
  const f2 = new GuideFollower(g2, { sim: sim2, advance, onStep: (s) => {
    const k = `${s.quest}|${s.target?.ui || s.target?.world || s.kind}`;
    seen[k] ??= s;
    if (s.quest === 'eggs' && s.kind === 'wait' && s.meanwhile) eggsMw.push(s.meanwhile);
  } });
  f2.run({ maxSec: 15 * 60, until: (gg) => gg.tutorialMode() !== 'guided' });
  const board = g2.s.objects.find((o) => o.type === 'orderboard');
  const step = (quest, target) => seen[`${quest}|${target}`];
  assert.equal(step('order1', `bubble:o${board.id}`)?.stepKey, 'order1');
  assert.equal(step('order1', `bubble:o${board.id}`)?.fallback, 'btn:orders');
  assert.ok(Object.keys(seen).some((k) => k.startsWith('order1|order:deliver:') && seen[k].stepKey === 'order1Panel'));
  assert.deepEqual(step('coop', 'btn:shop')?.chain, ['btn:shop', 'shop:tab:buildings', 'shop:buy:coop', 'place:ok']);
  assert.equal(step('coop', 'shop:buy:coop')?.stepKey, 'coopShop');
  assert.equal(step('coop', 'place:ok')?.stepKey, 'coopPlace');
  assert.equal(step('chickens', 'pen:buy')?.stepKey, 'chickensPanel');
  assert.equal(step('plow', 'tool:plow')?.stepKey, 'plow');
  const ghosts = step('plow', 'ghostPlots');
  assert.equal(ghosts?.stepKey, 'plowTiles');
  assert.deepEqual(ghosts.target.tiles, CFG.TUTORIAL.plowSuggest.map(CFG.tutorialTile), 'ghost plots at TUTORIAL.plowSuggest');
  assert.deepEqual(ghosts.target.tiles, fresh().suggestPlowSpots(2), 'and they match suggestPlowSpots(2)');
  assert.ok(Object.keys(seen).some((k) => k.startsWith('carrots|seed:carrot')), 'carrots via the seed popover');
  // B10: "tap weeds and stones" comes with the finger on the weeds and stones, never on wheat or a seed
  assert.ok(eggsMw.some((m) => m.action === 'clear'), 'the eggs wait reaches the debris');
  for (const m of eggsMw) {
    if (m.action === 'clear') assert.equal(m.stepKey, 'eggsMeanwhile', m.key);
    else if (m.stepKey === 'post1') assert.equal(m.say, CFG.TUTORIAL.lines.post1, 'parcel #1 comes with its own line');
    else if (m.stepKey !== 'busy') assert.equal(m.say, null, `no tidy-up line on ${m.key}`);
  }
  const fin = step('bread', 'factory:finish');
  assert.ok(fin && fin.free && fin.stepKey === 'breadFree', 'B12 free finish');
  assert.equal(step('bakery', 'shop:buy:bakery')?.quest, 'bakery');
  // placement starts on the tutorial lots
  const coop = g2.s.objects.find((o) => o.type === 'coop'), bakery = g2.s.objects.find((o) => o.type === 'bakery');
  assert.deepEqual([coop.x, coop.z], CFG.tutorialTile(CFG.TUTORIAL.lots.coop));
  assert.deepEqual([bakery.x, bakery.z], CFG.tutorialTile(CFG.TUTORIAL.lots.bakery));
  assert.equal(g2.s.tutorial.freeFinishUsed, true, 'the free bake was used');
  // every guided step speaks a real line
  for (const s of Object.values(seen)) if (s.stepKey) assert.ok(CFG.TUTORIAL.lines[s.stepKey], `line ${s.stepKey}`);
});

test('planner: B12 short of wheat speaks about the wheat, then about the Bakery', () => {
  const g = fresh();
  g.markSeen('welcome');
  setQuest(g, 'bread');
  setLevel(g, 3);
  put(g, 'bakery', ...CFG.tutorialTile(CFG.TUTORIAL.lots.bakery));
  g.s.inventory.wheat = 0;
  let s = planStep(g, {}, { cache: false });
  assert.equal(s.target?.world, 'tiles', 'the ripe starter wheat first');
  assert.equal(s.stepKey, 'breadWheat');
  assert.equal(s.say, CFG.TUTORIAL.lines.breadWheat);
  g.s.inventory.wheat = 3;
  s = planStep(g, {}, { cache: false });
  assert.ok(s.target?.ui?.startsWith('bubble:o'), 'then the Bakery');
  assert.equal(s.stepKey, 'bread');
});

test('planner: steps are memoised per game change, game second and ui', () => {
  const g = fresh();
  g.markSeen('welcome');
  const a = planStep(g, {});
  assert.equal(planStep(g, {}), a, 'same state → same object');
  assert.notEqual(planStep(g, { tool: 'plow' }), a, 'ui change → new step');
  g.addCoins(1);
  assert.notEqual(planStep(g, {}), a, 'game change → new step');
});

test('planner: another panel open > 4 s → close it; under 4 s → the opener; tiles need the Hand tool', () => {
  const g = coachedAt('coop', 2);
  g.s.coins = 500;
  assert.equal(planStep(g, {}).target.ui, 'btn:shop');
  assert.equal(planStep(g, { panel: { id: 'orders', tab: 'orders', ref: null, age: 2 } }).target.ui, 'btn:shop');
  assert.equal(planStep(g, { panel: { id: 'orders', tab: 'orders', ref: null, age: 5 } }).target.ui, 'panel:close');
  assert.equal(planStep(g, { panel: { id: 'shop', tab: 'decor', ref: null, age: 5 } }).target.ui, 'shop:tab:buildings');
  assert.equal(planStep(g, { panel: { id: 'shop', tab: 'buildings', ref: null, age: 0 } }).target.ui, 'shop:buy:coop');
  assert.equal(planStep(g, { placing: { type: 'coop', valid: true } }).target.ui, 'place:ok');
  assert.equal(planStep(g, { placing: { type: 'coop', valid: false } }).target.world, 'ghost');
  const h = coachedAt('harvest');
  assert.equal(planStep(h, { tool: 'plow' }).target.ui, 'tool:hand');
  assert.equal(planStep(h, {}).target.world, 'tiles');
});

test('planner: no room for a building → clear the debris, then the fields in its way (never a dead drag on the ghost)', () => {
  const g = coachedAt('pasture', 5);
  g.s.coins = 2000;
  // a farm with every free tile plowed: the 5×5 pasture fits nowhere
  for (let z = g.landLo(); z <= g.landHi(); z++) for (let x = g.landLo(); x <= g.landHi(); x++) if (!g.objectAt(x, z) && !g.soilAt(x, z)) g.s.soil[`${x},${z}`] = { crop: null };
  assert.equal(g.findFreeSpot('cowbarn', 0), null);
  const s = planStep(g, {}, { cache: false });
  assert.equal(s.target.world, 'object', 'debris in the way goes first');
  assert.equal(CFG.OBJECTS[g.objById.get(s.target.id).type].kind, 'debris');
  assert.equal(planStep(g, { placing: { type: 'cowbarn', valid: false } }, { cache: false }).target.ui, 'place:cancel', 'a ghost that fits nowhere backs out');
  const sim = new SimUI(g);
  const keys = [];
  const f = new GuideFollower(g, { sim, advance, onStep: (st) => { keys.push(st.key); assertKeys(st); } });
  const r = f.run({ maxSec: 10 * 60, until: (gg) => gg.objectCount('cowbarn') > 0 });
  assert.equal(g.objectCount('cowbarn'), 1, 'the pasture got built');
  assert.ok(keys.some((k) => k.endsWith(':room:tool')) && keys.some((k) => k.endsWith(':room:clear')), 'via the Clear tool on the fields');
  assert.equal(r.stalls, 0);
  assert.deepEqual(r.deadEnds, []);
});

// ---------------------------------------------------------------- reserves, blocks, need
test('reserves stop the planner delivering the last chicken feed', () => {
  const g = coachedAt('orders3', 4);
  const coop = put(g, 'coop', S + 5, S + 10);
  for (let i = 0; i < 2; i++) g.s.animals.push({ id: g.s.nextId++, type: 'chicken', home: coop.id, readyAt: 0 });
  for (const soil of Object.values(g.s.soil)) soil.crop = { type: 'wheat', plantedAt: t }; // nothing ripe
  g.s.inventory = { wheat: 2 };
  g.s.orders = [{ id: 900, items: { wheat: 2 }, coins: 6, xp: 1 }, { id: 901, waitUntil: t + 60000 }];
  assert.deepEqual(reserves(g, { skip: g.s.orders[0] }), { wheat: 2 }, 'one feed per chicken');
  const delivering = (s) => keysOf(s).some((k) => k === 'order:deliver:900' || k === `bubble:o${g.s.objects.find((o) => o.type === 'orderboard').id}`);
  assert.ok(!delivering(planStep(g, {}, { cache: false })), 'the goal planner keeps the feed');
  assert.ok(!delivering(recommendIdle(g, {})), 'so does Meanwhile');
  assert.ok(!delivering(earn(g, {}, 50)), 'and earn');
  g.s.inventory.wheat = 4;
  assert.equal(planStep(g, {}, { cache: false }).order, 900, 'with spare wheat it delivers');
});

test('guided Meanwhile never suggests plowing (or chores); coached does when there is spare cash', () => {
  const g = fresh();
  g.markSeen('welcome');
  setQuest(g, 'eggs');
  setLevel(g, 3);
  g.s.coins = 5000;
  g.s.objects = g.s.objects.filter((o) => CFG.OBJECTS[o.type].kind !== 'debris');
  g.rebuildOccupancy();
  for (const soil of Object.values(g.s.soil)) soil.crop = { type: 'wheat', plantedAt: t };
  const coop = put(g, 'coop', S + 5, S + 10);
  g.s.animals.push({ id: g.s.nextId++, type: 'chicken', home: coop.id, readyAt: t + 100000 });
  const idle = recommendIdle(g, {});
  assert.notEqual(idle.action, 'plow');
  assert.ok(!keysOf(idle).some((k) => k === 'tool:plow' || k.startsWith('today:')));
  assert.equal(idle.key, 'busy');
  g.skipTutorial();
  assert.equal(recommendIdle(g, {}).action, 'plow', 'coached: spare cash and room → a new field');
});

test('questBlock: coins, level and materials, matching what the planner works on', () => {
  const g = coachedAt('bakery', 3);
  g.s.coins = 112;
  assert.deepEqual(questBlock(g), { kind: 'coins', have: 112, need: 150 });
  assert.equal(planStep(g, {}).block.kind, 'coins');
  g.s.coins = 500;
  assert.equal(questBlock(g), null);
  const p = coachedAt('pasture', 4);
  const b = questBlock(p);
  assert.equal(b.kind, 'level');
  assert.equal(b.level, 5);
  assert.equal(b.need, CFG.xpToNext(4));
  const e = coachedAt('expand', 6);
  e.s.coins = 1000;
  assert.deepEqual(questBlock(e).items, { plank: 1, bolt: 1 });
  const es = planStep(e, {});
  assert.equal(es.kind, 'wait', 'materials: no finger, a Meanwhile instead');
  assert.equal(es.pointer, false);
  assert.ok(es.meanwhile);
  e.s.inventory.plank = 1; e.s.inventory.bolt = 1; // set directly (no event), so skip the memo
  assert.equal(questBlock(e), null);
  assert.equal(planStep(e, {}, { cache: false }).target.ui, 'btn:shop');
  assert.equal(planStep(e, { panel: { id: 'shop', tab: 'buildings', ref: null, age: 0 } }).target.ui, 'shop:tab:land');
  // the HUD card gets chapter + block
  const info = questCardInfo(g, planStep(g, {}));
  assert.equal(info.chapter.id, 1);
  assert.equal(info.showMe, true);
});

test('need(item): crops, animal goods and goods (recipe inputs, depth ≤ 3); materials are a line only', () => {
  const g = coachedAt('corn', 4);
  for (const soil of Object.values(g.s.soil)) soil.crop = null;
  g.s.coins = 100;
  let s = need(g, {}, 'carrot');
  assert.equal(s.action, 'plant');
  assert.equal(s.crop, 'carrot');
  s = need(g, {}, 'milk');
  assert.equal(s.block?.kind, 'level', 'no cows before level 5');
  setLevel(g, 5);
  g.s.coins = 1000;
  s = need(g, {}, 'milk');
  assert.ok(keysOf(s).includes('shop:buy:cowbarn'), 'milk → build a pasture first');
  const bakery = put(g, 'bakery', S + 11, S + 6);
  g.s.inventory = { wheat: 10 };
  s = need(g, {}, 'bread');
  assert.equal(s.target.ui, `bubble:o${bakery.id}`);
  assert.equal(s.recipe, 'bread');
  g.s.inventory = {};
  s = need(g, {}, 'cookie');
  assert.ok(['plant', 'harvest'].includes(s.action) || keysOf(s).includes('shop:buy:coop'), 'cookie → its inputs');
  const m = need(g, {}, 'plank');
  assert.equal(m.kind, 'none');
  assert.equal(m.pointer, false);
  // deep chains stay finite
  setLevel(g, 9);
  assert.ok(need(g, {}, 'butterpop'));
});

test('guided B6: one chicken bought, the next is from the Shop with its own line (never "An empty coop…")', () => {
  const g = fresh();
  g.markSeen('welcome');
  setQuest(g, 'chickens');
  setLevel(g, 2);
  g.s.coins = 100;
  const coop = put(g, 'coop', ...CFG.tutorialTile(CFG.TUTORIAL.lots.coop));
  assert.equal(planStep(g, {}, { cache: false }).stepKey, 'chickens');
  assert.ok(g.buyAnimal('chicken'));
  const s = planStep(g, {}, { cache: false });
  assert.equal(s.target.ui, 'btn:shop');
  assert.equal(s.stepKey, 'chickensMore');
  assert.equal(s.say, CFG.TUTORIAL.lines.chickensMore);
  assert.equal(planStep(g, { panel: { id: 'pen', ref: coop.id, tab: null, age: 0 } }, { cache: false }).stepKey, 'chickensPanel');
});

test('earn: broke, nothing growing or cooking, spare goods held → sell one (📦 → tab → item → Sell 1), never a made-up "⏳ 0:30"', () => {
  const broke = (goods) => {
    const g = fresh();
    g.markSeen('welcome');
    setQuest(g, 'bread');
    setLevel(g, 4);
    put(g, 'bakery', ...CFG.tutorialTile(CFG.TUTORIAL.lots.bakery));
    const coop = put(g, 'coop', ...CFG.tutorialTile(CFG.TUTORIAL.lots.coop));
    for (let i = 0; i < 2; i++) g.s.animals.push({ id: g.s.nextId++, type: 'chicken', home: coop.id, readyAt: 0 }); // hungry
    g.s.objects = g.s.objects.filter((o) => CFG.OBJECTS[o.type].kind !== 'debris');
    g.rebuildOccupancy();
    for (const soil of Object.values(g.s.soil)) soil.crop = null;
    g.s.coins = 0;
    g.s.inventory = goods;
    g.s.orders = g.s.orders.map((o, i) => ({ id: 950 + i, items: { corn: 9 }, coins: 60, xp: 6 })); // nobody wants eggs
    return g;
  };
  const g = broke({ egg: 2 });
  assert.equal(g.isStuck(), false, 'eggs held: no pocket money');
  let s = planStep(g, {}, { cache: false });
  assert.equal(s.block?.kind, 'coins');
  assert.equal(s.target.ui, 'btn:barn');
  assert.deepEqual(s.chain, ['btn:barn', 'storage:tab:barn', 'storage:item:egg', 'storage:sell:egg']);
  assert.equal(s.stepKey, 'sellFew');
  assert.equal(s.say, CFG.TUTORIAL.lines.sellFew);
  assertKeys(s);
  s = planStep(g, { panel: { id: 'barn', tab: 'barn', ref: null, age: 0 } }, { cache: false });
  assert.equal(s.target.ui, 'storage:sell:egg', 'in the Barn tab: the Sell button (the card until it is picked)');
  const sim = new SimUI(g);
  const r = new GuideFollower(g, { sim, advance }).run({ maxSec: 10 * 60, until: (gg) => gg.questDone() });
  assert.ok(g.questDone(), 'one egg sold → wheat planted → bread baked');
  assert.equal(g.count('egg'), 1, 'one at a time: only what was needed');
  assert.equal(r.safetyNet, 0);
  assert.deepEqual(r.deadEnds, []);
  // nothing to sell and Mabel's pocket money on cooldown: a wait that names no time, and the follower calls it a dead end
  const h = broke({});
  h.s.tutorial.net = h.now();
  s = planStep(h, {}, { cache: false });
  assert.equal(s.kind, 'wait');
  assert.equal(s.wait.until, null);
  assert.equal(s.meanwhile.key, 'busy');
  assert.equal(s.meanwhile.say, CFG.TUTORIAL.lines.busyIdle);
  assert.equal(questCardInfo(h, s).meanwhile.text, CFG.TUTORIAL.lines.busyIdle);
  const r2 = new GuideFollower(h, { advance }).run({ maxSec: 2 * 60 });
  assert.equal(r2.deadEnds.length, 1);
});

test('F1: no coins for seeds and empty soil → sell one spare even while timers run (the coins-blocked step, or the coached Meanwhile), then plant', () => {
  // coached, saving for a cow at L5: 🪙0, wheat growing on all but two tiles, the chickens laying, spare wheat held
  const starved = () => {
    const g = coachedAt('cows', 5);
    g.s.objects = g.s.objects.filter((o) => CFG.OBJECTS[o.type].kind !== 'debris');
    const coop = put(g, 'coop', ...CFG.tutorialTile(CFG.TUTORIAL.lots.coop));
    for (let i = 0; i < 2; i++) g.s.animals.push({ id: g.s.nextId++, type: 'chicken', home: coop.id, readyAt: g.now() + 60e3 }); // producing
    g.rebuildOccupancy();
    const tiles = Object.keys(g.s.soil);
    tiles.forEach((k, i) => { g.s.soil[k].crop = i < 2 ? null : { type: 'wheat', plantedAt: g.now() }; });
    g.s.coins = 0;
    g.s.inventory = { wheat: 12 };
    g.s.orders = g.s.orders.map((o, i) => ({ id: 960 + i, items: { corn: 9 }, coins: 60, xp: 6 })); // nobody wants wheat
    g.s.chores = null;
    return g;
  };
  const g = starved();
  assert.ok(g.s.coins < g.cheapestSeedCost());
  let s = planStep(g, {}, { cache: false });
  assert.equal(s.block?.kind, 'coins');
  assert.ok(s.key.includes('sellFew:wheat'), s.key);
  assert.deepEqual(s.chain, ['btn:barn', 'storage:tab:silo', 'storage:item:wheat', 'storage:sell:wheat']);
  assertKeys(s);
  // not when a seed is affordable (it plants), nor with no empty soil (it waits for the timers)
  const rich = starved();
  rich.s.coins = CFG.CROPS.wheat.seedCost;
  assert.ok(!planStep(rich, {}, { cache: false }).key.includes('sellFew'));
  const full = starved();
  for (const soil of Object.values(full.s.soil)) soil.crop ||= { type: 'wheat', plantedAt: full.now() };
  assert.ok(!planStep(full, {}, { cache: false }).key.includes('sellFew'));
  // the same farm waiting on its goal (milk on the way) gets it as the Meanwhile — coached only, never in the tour
  const waiting = starved();
  setQuest(waiting, 'milk');
  const barn = put(waiting, 'cowbarn', ...waiting.findFreeSpot('cowbarn'));
  waiting.s.animals.push({ id: waiting.s.nextId++, type: 'cow', home: barn.id, readyAt: waiting.now() + 120e3 });
  s = planStep(waiting, {}, { cache: false });
  assert.equal(s.kind, 'wait');
  assert.ok(s.meanwhile?.key.startsWith('sellFew:wheat'), s.meanwhile?.key);
  assertKeys(s);
  const tour = starved();
  tour.s.tutorial.mode = 'guided';
  assert.ok(!recommendIdle(tour, {}).key.startsWith('sellFew'), 'the tour keeps its own Meanwhile');
  // the follower sells one wheat and plants it again: a harvest comes long before every timer has run out
  const sim = new SimUI(g);
  const before = g.count('wheat');
  let planted = false;
  new GuideFollower(g, { sim, advance, onStep: () => { planted ||= Object.values(g.s.soil).every((x) => x.crop); } }).run({ maxSec: 40 });
  assert.ok(planted, 'the empty soil was planted');
  assert.ok(g.count('wheat') >= before - 2, 'one spare at a time');
});

test('placement: ✓ only for what the planner builds; a decor row the player started gets no finger (a follower backs out)', () => {
  const g = fresh();
  g.markSeen('welcome');
  setQuest(g, 'chickens');
  setLevel(g, 2);
  // no coop yet: the chickens need one, so its ghost is wanted (once it is affordable)
  g.s.coins = 200;
  assert.equal(planStep(g, { placing: { type: 'coop', valid: true } }, { cache: false }).target.ui, 'place:ok');
  g.s.coins = 60;
  assert.equal(planStep(g, { placing: { type: 'coop', valid: true } }, { cache: false }).pointer, false, 'not while saving up for it');
  put(g, 'coop', ...CFG.tutorialTile(CFG.TUTORIAL.lots.coop));
  for (const valid of [true, false]) {
    const s = planStep(g, { placing: { type: 'fence', valid } }, { cache: false });
    assert.equal(s.pointer, false, `fence valid ${valid}: no finger`);
    assert.equal(s.target.ui, 'place:cancel');
    assert.equal(s.say, null, 'and no "Tap ✓" line');
  }
  assert.equal(planStep(g, { placing: { type: 'scarecrow', valid: true, gift: true } }, { cache: false }).target.ui, 'place:ok', 'gifts still get ✓');
  // SimUI keeps cheap decor placing after ✓, as main.js does; following the guide never buys a row of it
  const sim = new SimUI(g);
  sim.startPlacement('fence');
  const coins = g.s.coins;
  assert.ok(sim.confirmPlacement());
  assert.equal(sim.ui.placing?.valid, false, 'the ghost stays up, on the fence just built');
  const r = new GuideFollower(g, { sim, advance }).run({ maxSec: 30, until: () => !sim.ui.placing });
  assert.equal(sim.ui.placing, null);
  assert.equal(g.s.coins, coins - CFG.OBJECTS.fence.cost, 'one fence, not a row');
  assert.equal(g.objectCount('fence'), 1);
  assert.equal(r.stalls, 0);
});

test('plow goal: a field fenced in on every side still gets a field to plow (never "Everything\'s busy")', () => {
  for (const mode of ['guided', 'coached']) {
    const g = fresh();
    g.markSeen('welcome');
    if (mode === 'coached') g.skipTutorial();
    setQuest(g, 'plow');
    setLevel(g, 3);
    g.s.coins = 200;
    g.s.objects = g.s.objects.filter((o) => CFG.OBJECTS[o.type].kind !== 'debris');
    g.rebuildOccupancy();
    const ring = [...CFG.TUTORIAL.plowSuggest.map(CFG.tutorialTile)];
    for (const k of Object.keys(g.s.soil)) { const [x, z] = k.split(',').map(Number); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ring.push([x + dx, z + dz]); }
    for (const [x, z] of ring) if (g.canPlace('fence', x, z, 0)) put(g, 'fence', x, z);
    assert.deepEqual(g.suggestPlowSpots(2), [], 'nothing beside the field');
    const sim = new SimUI(g);
    sim.ui.tool = 'plow';
    const s = planStep(g, sim.view(), { cache: false });
    assert.equal(s.target?.world, 'ghostPlots', `${mode}: ${s.key}`);
    assert.equal(s.target.tiles.length, 2);
    const r = new GuideFollower(g, { sim, advance }).run({ maxSec: 3 * 60, until: (gg) => gg.questDone() });
    assert.ok(g.questDone(), `${mode}: plowed`);
    assert.deepEqual(r.deadEnds, []);
  }
});

test('"Sell extras" from the guide keeps what the goal\'s order needs; the Silo-full beat waits while it would sell nothing', () => {
  const g = coachedAt('orders3', 5);
  g.s.orders = [{ id: 900, items: { wheat: 20, bread: 2 }, coins: 90, xp: 9 }];
  g.s.inventory = { wheat: 57, carrot: 30 };
  const keep = reserves(g).wheat;
  assert.ok(keep >= 20, `wheat kept for the order: ${keep}`);
  new SimUI(g).tap('storage:sellExtras:silo');
  assert.equal(g.count('wheat'), keep, 'never below the reserve');
  assert.equal(g.count('carrot'), 10);
  // nearly full, but 10 or fewer of each kind: Sell extras would sell nothing, so the one-time beat waits
  const f = coachedAt('corn', 9);
  const cap = f.storageCap('silo');
  f.s.inventory = {};
  for (const i of Object.keys(CFG.ITEMS).filter((x) => f.storageOf(x) === 'silo')) if (f.storageUsed('silo') < 0.9 * cap) f.s.inventory[i] = Math.min(10, Math.ceil(0.9 * cap) - f.storageUsed('silo'));
  assert.ok(f.storageUsed('silo') >= 0.9 * cap, 'nearly full');
  assert.equal(pendingInterrupt(f, {}), null);
  assert.equal(f.hasSeen('siloFull'), false, 'still unseen');
  f.s.inventory.wheat = 40;
  assert.equal(pendingInterrupt(f, {})?.interrupt, 'siloFull', 'with real extras it plays');
});

test('Show me keeps to the goal: planStep with skipInterrupt plans past a waiting one-time beat', () => {
  const g = coachedAt('corn', 4);
  g.s.inventory.wheat = Math.ceil(0.9 * g.storageCap('silo'));
  assert.equal(planStep(g, {}).why, 'interrupt');
  const s = planStep(g, { skipInterrupt: true }, { cache: false });
  assert.notEqual(s.why, 'interrupt');
  assert.equal(s.quest, 'corn');
  assert.notEqual(planStep(g, { skipInterrupt: true }), planStep(g, {}), 'part of the memo signature');
  assert.ok(isGuideKey('storage:item:egg') && isGuideKey('storage:sell:wheat') && !isGuideKey('storage:sell:nope'));
});

// ---------------------------------------------------------------- interrupts, graduation, modes, daily
test('interrupts: silo full, first drop, slot 6 and Mabel\'s visit — once each, never with hints off or in a hard beat', () => {
  const g = coachedAt('corn', 4);
  assert.equal(pendingInterrupt(g, {}), null);
  g.s.inventory.wheat = Math.ceil(0.9 * g.storageCap('silo'));
  let s = planStep(g, {});
  assert.equal(s.why, 'interrupt');
  assert.equal(s.interrupt, 'siloFull');
  assert.equal(s.stepKey, 'siloFull');
  assert.equal(s.say, CFG.TUTORIAL.lines.siloFull);
  assert.deepEqual(s.chain, ['btn:barn', 'storage:tab:silo', 'storage:sellExtras:silo']);
  g.s.settings.hints = 'off';
  assert.equal(pendingInterrupt(g, {}), null, 'hints off');
  g.s.settings.hints = 'glow';
  g.markSeen('siloFull');
  assert.equal(pendingInterrupt(g, {}), null, 'once');
  s = planStep(g, { interrupt: { key: 'firstDrop', item: 'plank' } });
  assert.equal(s.interrupt, 'firstDrop');
  assert.equal(s.kind, 'none');
  assert.equal(s.toast, true);
  assert.ok(s.say.includes('🪵') && s.say.includes('Plank'), s.say);
  setLevel(g, 6);
  put(g, 'bakery', S + 11, S + 6);
  s = pendingInterrupt(g, {});
  assert.equal(s.interrupt, 'slot6');
  g.markSeen('slot6');
  g.s.visitors = [{ id: 77, npc: 'mabel', item: 'wheat', qty: 3, coins: 10, xp: 1, first: true }];
  s = pendingInterrupt(g, {});
  assert.equal(s.interrupt, 'firstVisitor');
  assert.equal(s.target.ui, 'bubble:v77');
  s = pendingInterrupt(g, { panel: { id: 'visitor', ref: 77, tab: null, age: 0 } });
  assert.equal(s.target.ui, 'visitor:sell');
  assert.equal(s.stepKey, 'firstVisitorPanel');
  assert.ok(s.say.includes('wheat'));
  // what she asked for is gone by now: her hello and a glow on her, never a finger on a greyed-out Sell
  const wheat = g.s.inventory.wheat;
  g.s.inventory.wheat = 1;
  s = pendingInterrupt(g, { panel: { id: 'visitor', ref: 77, tab: null, age: 0 } });
  assert.equal(s.interrupt, 'firstVisitor');
  assert.equal(s.toast, true);
  assert.equal(s.target.ui, 'bubble:v77');
  g.s.inventory.wheat = wheat;
  g.setTutorialMode('independent');
  assert.equal(pendingInterrupt(g, {}), null, 'independent: FEATURE_TIPS only');
  // hard beats suppress them
  const h = fresh();
  h.markSeen('welcome');
  h.s.inventory.wheat = 70;
  assert.equal(hardBeat(h), true);
  assert.equal(pendingInterrupt(h, {}), null);
});

test('graduation: chest → gift → daily → goal card, then coached; nextMode only moves forward', () => {
  const g = fresh();
  g.markSeen('welcome');
  setQuest(g, 'bread');
  setLevel(g, 4);
  g.s.quest.progress = 1;
  g.claimQuest();
  assert.ok(graduationPending(g));
  const sim = new SimUI(g);
  const order = [];
  for (let i = 0; i < 6 && g.tutorialMode() === 'guided'; i++) {
    const s = planStep(g, sim.view());
    order.push(s.key);
    sim.apply(s);
    const m = nextMode(g);
    if (m !== g.tutorialMode()) g.setTutorialMode(m);
  }
  assert.deepEqual(order, ['grad:chest', 'grad:gift', 'grad:daily', 'grad:end']);
  assert.equal(g.tutorialMode(), 'coached');
  assert.ok(g.s.objects.some((o) => o.type === 'scarecrow' && o.free), 'scarecrow placed free');
  assert.equal(g.s.gifts.length, 0);
  // coached → independent at level 10 or after the list; never back
  setLevel(g, 10);
  assert.equal(nextMode(g), 'independent');
  const c = coachedAt('corn', 4);
  c.s.quest.index = CFG.QUESTS.length;
  assert.equal(nextMode(c), 'independent');
  const ind = fresh();
  ind.s.tutorial.mode = 'independent';
  assert.equal(nextMode(ind), 'independent');
});

test('shouldAutoShowDaily: new farms wait for graduation or the first claim (≤ 2 h); legacy saves as before', () => {
  const H = 3600000;
  const g = fresh();
  assert.equal(shouldAutoShowDaily(g.s, g.now()), false, 'guided, just started');
  assert.equal(shouldAutoShowDaily(g, g.now()), false);
  assert.equal(shouldAutoShowDaily(g.s, g.now() + 2 * H + 1000), true, 'guided save older than 2 h');
  g.skipTutorial();
  assert.equal(shouldAutoShowDaily(g.s, g.now()), false, 'coached at the first goal');
  g.s.quest.index = 1;
  assert.equal(shouldAutoShowDaily(g.s, g.now()), true, 'coached after the first claim');
  g.claimDaily();
  assert.equal(shouldAutoShowDaily(g.s, g.now()), false, 'already claimed today');
  assert.equal(shouldAutoShowDaily(g, g.now()), false);
  const legacy = fresh();
  legacy.s.tutorial = legacy.blankState().tutorial;
  assert.equal(legacy.s.tutorial.mode, 'independent');
  assert.equal(shouldAutoShowDaily(legacy.s, legacy.now()), true);
  // the pure form agrees with the game's own dailyStatus
  for (const dt of [0, 5 * H, 17 * H, 30 * H]) {
    const s = { ...legacy.s, daily: { lastDay: null, streak: 1, lastAt: legacy.now() - dt } };
    legacy.s.daily = s.daily;
    assert.equal(shouldAutoShowDaily(s, legacy.now()), legacy.dailyStatus().canClaim, `dt ${dt / H}h`);
  }
});

test('small helpers: lots, level-up "Let\'s go", tips, seed popover order', () => {
  const g = fresh();
  assert.deepEqual(placementSpot(g, 'coop'), { x: S + 5, z: S + 10, rot: 0, lot: true });
  const sp = placementSpot(g, 'cowbarn');
  assert.ok(sp && g.canPlace('cowbarn', sp.x, sp.z, 0));
  const c = coachedAt('pasture', 4);
  assert.equal(levelUpGo(c, 5), true);
  assert.equal(levelUpGo(c, 6), false);
  setLevel(c, 6);
  assert.equal(pendingTip(c).level, 5);
  c.markSeen('tip:5');
  assert.equal(pendingTip(c).level, 6);
  c.s.settings.hints = 'off';
  assert.equal(pendingTip(c), null);
  const k = coachedAt('carrots', 2);
  const list = seedList(k, { last: 'wheat' });
  assert.deepEqual(list[0], { type: 'carrot', tag: 'goal' });
  assert.deepEqual(list.map((x) => x.type).sort(), ['carrot', 'wheat']);
});

test('turn & tilt: 🧭 is revealed at the end of the tour; its keys are guide keys; tip:camera (both triggers) never in the tour or with hints off', () => {
  for (const k of ['btn:camera', 'cam:up', 'cam:down', 'cam:left', 'cam:right', 'cam:home']) assert.ok(isGuideKey(k), k);
  assert.ok(!isGuideKey('cam:spin'));
  // graduation's last beat reveals 🧭 (and the post pill's slot) with 🎁 and 🏆
  const g = fresh();
  g.markSeen('welcome');
  setQuest(g, 'bread');
  setLevel(g, 4);
  g.s.quest.progress = 1;
  g.claimQuest();
  for (const k of ['grad:chest', 'grad:gift', 'grad:daily']) g.markSeen(k);
  assert.ok(!g.isRevealed('camera'), 'hidden during the tour');
  const end = planStep(g, {});
  assert.equal(end.key, 'grad:end');
  for (const k of ['today', 'trophy', 'camera', 'post']) assert.ok(end.reveal.includes(k), `grad:end reveals ${k}`);
  // tip:camera: the first pen or workshop placed after graduation, or a farm 30 minutes old
  const c = coachedAt('carrots', 2);
  assert.equal(pendingTip(c), null, 'a new coached farm: not yet');
  assert.equal(pendingTip(c, { cameraTipDue: true }).key, 'tip:camera');
  assert.ok(pendingTip(c, { cameraTipDue: true }).text.length <= 90);
  assert.equal(typeof pendingTip(c, { cameraTipDue: true }).onTap, 'function');
  // its wording follows the pointer (a mouse can't twist) and the two-finger turn setting; touch is the default
  const camText = (ctx) => pendingTip(c, { cameraTipDue: true, ...ctx }).text;
  assert.equal(camText({}), 'Tip: twist two fingers to turn your farm — or tap 🧭 to turn and tilt.');
  assert.equal(camText({ coarse: true }), camText({}));
  assert.ok(!/twist|fingers/.test(camText({ coarse: false })) && /click 🧭/.test(camText({ coarse: false })) && /Q\/E/.test(camText({ coarse: false })), camText({ coarse: false }));
  c.s.settings.twist = false;
  assert.ok(!/twist|fingers/.test(camText({ coarse: true })) && camText({ coarse: true }).includes('🧭'), camText({ coarse: true }));
  for (const coarse of [true, false, undefined]) assert.ok(camText({ coarse }).length <= 90);
  c.s.settings.twist = true;
  advance(30 * 60);
  assert.equal(pendingTip(c)?.key, 'tip:camera', '30 minutes in');
  // level tips come first
  setLevel(c, 5);
  assert.equal(pendingTip(c).key, 'tip:5');
  c.markSeen('tip:5');
  assert.equal(pendingTip(c).key, 'tip:camera');
  c.markSeen('tip:camera');
  assert.equal(pendingTip(c, { cameraTipDue: true }), null, 'once');
  // never in the guided tour, never with hints off
  const gd = fresh();
  assert.equal(gd.tutorialMode(), 'guided');
  advance(31 * 60);
  assert.equal(pendingTip(gd, { cameraTipDue: true }), null, 'guided');
  const off = coachedAt('carrots', 2);
  off.s.settings.hints = 'off';
  assert.equal(pendingTip(off, { cameraTipDue: true }), null, 'hints off');
  // the 🧭 pad taps cost the headless player nothing and change nothing
  const sim = new SimUI(coachedAt('carrots', 2));
  assert.equal(sim.tap('cam:up'), 0);
});

// ---------------------------------------------------------------- 🏆 Treasures and Mabel's album (§3.6, §7.5)
test('treasures keys: every new key is a guide key, Achievements left the Farmhouse, the HUD only renders real keys', async () => {
  const pages = CFG.ALBUM.pages.map((p) => p.id);
  const keys = ['btn:trophy', 'treasures:tab:album', 'treasures:tab:ribbons', 'treasures:tab:awards', 'album:prev', 'album:next', 'ribbons:claim',
    ...pages.flatMap((id) => [`album:page:${id}`, `album:claim:${id}`]), 'farmhouse:tab:progress', 'farmhouse:tab:village', 'farmhouse:tab:farm'];
  for (const k of keys) assert.ok(isGuideKey(k), k);
  for (const k of ['farmhouse:tab:achievements', 'album:claim:nope', 'album:page:', 'treasures:tab:shop', 'album:first']) assert.ok(!isGuideKey(k), `not a key: ${k}`);
  // every literal data-guide in the HUD and the guide layer is a real key (the templated ones are listed above)
  const { readFileSync } = await import('node:fs');
  for (const f of ['../src/ui/hud.js', '../src/ui/guide-ui.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const lits = [...src.matchAll(/'data-guide': '([^']+)'(?=\s*[,})])/g)].map((m) => m[1]);
    assert.ok(lits.length > 10 || f.includes('guide-ui'), f);
    for (const k of lits) assert.ok(isGuideKey(k), `${f}: ${k}`);
    assert.ok(!src.includes('farmhouse:tab:achievements') && !/id: 'achievements'/.test(src), `${f}: no Achievements tab left in the Farmhouse`);
  }
});

test('treasures (SimUI): 🏆 opens on a page to claim → Claim prize! → chest → the decoration goes up; Awards otherwise', () => {
  const g = coachedAt('carrots', 12);
  const sim = new SimUI(g);
  // nothing to claim, album closed: Awards
  sim.tap('btn:trophy');
  assert.deepEqual([sim.ui.panel.id, sim.ui.panel.tab], ['treasures', 'awards']);
  sim.closePanel();
  // the album opens with a keepsake: 🏆 shows it
  g.giveKeepsake('post', 'meadow:clover');
  sim.tap('btn:trophy');
  assert.equal(sim.ui.panel.tab, 'album');
  assert.equal(sim.tap('album:next'), 0, 'browsing is free');
  assert.equal(sim.tap('album:page:barn'), 0);
  sim.tap('treasures:tab:awards');
  assert.equal(sim.ui.panel.tab, 'awards');
  sim.closePanel();
  // a complete page wins over awards
  for (const [it] of CFG.ALBUM.pages[0].items) g.s.album.have['meadow:' + it] ||= 1;
  g.s.stats.harvested = 1e6; g.bumpStat('harvest', 1e6);
  assert.ok(g.achievementsReady() > 0);
  sim.tap('btn:trophy');
  assert.equal(sim.ui.panel.tab, 'album');
  const gems = g.s.gems;
  sim.tap('album:claim:meadow');
  assert.equal(g.s.gems, gems + 3);
  assert.equal(sim.ui.panel, null, 'the panel closes');
  sim.pump();
  assert.equal(sim.ui.modal, 'chest');
  const step = planStep(g, sim.view(), { cache: false });
  assert.equal(step.target.ui, 'modal:chest:open');
  sim.tap('modal:chest:open');
  assert.ok(sim.ui.placing && sim.ui.placing.type === 'bluebath' && sim.ui.placing.gift, 'the Bluebird Bath goes up next');
  const pl = planStep(g, sim.view(), { cache: false });
  assert.equal(pl.target.ui, 'place:ok');
  assert.equal(pl.stepKey, null, 'no Scarecrow line');
  sim.tap('place:ok');
  const bath = g.s.objects.find((o) => o.type === 'bluebath');
  assert.ok(bath && bath.free);
  assert.deepEqual(g.s.gifts, []);
  assert.equal(g.claimAlbumPage('meadow'), null);
  // the launch album: page 8's chest, then its Silver Rooster, then the Curio Cabinet
  const h = coachedAt('carrots', 30);
  h.s.coins = 0;
  const hs = new SimUI(h);
  h.s.album.open = true;
  for (const p of CFG.ALBUM.pages.slice(0, 8)) { for (const [it] of p.items) h.s.album.have[`${p.id}:${it}`] = 1; if (p.id !== 'attic') h.s.album.claimed[p.id] = 1; }
  hs.tap('btn:trophy');
  hs.tap('album:claim:attic');
  hs.pump();
  hs.tap('modal:chest:open');
  assert.equal(hs.ui.placing?.type, 'silverrooster');
  hs.tap('place:ok');
  assert.equal(hs.ui.placing?.type, 'curio', 'then the Curio Cabinet');
  hs.tap('place:ok');
  assert.ok(h.s.objects.some((o) => o.type === 'curio') && h.s.objects.some((o) => o.type === 'silverrooster'));
  assert.ok(h.s.album.launch);
  assert.ok(h.s.charm.titles.includes('Keeper of Keepsakes'));
});

test('tip:album: the first keepsake, once, coached or independent — never in the tour or with hints off; tap opens the album', () => {
  const c = coachedAt('carrots', 4);
  assert.notEqual(pendingTip(c)?.key, 'tip:album', 'album closed');
  c.giveKeepsake('post', 'meadow:clover');
  const tip = pendingTip(c);
  assert.equal(tip.key, 'tip:album');
  assert.equal(tip.text, 'Ooh, my old Four-Leaf Clover! It goes in my Keepsake Album 📖 — find all 6 on a page for a prize.');
  assert.ok([...tip.text].length <= 100, 'the spec\'s line, verbatim (96 characters with the clover)');
  let opened = null;
  tip.onTap({ hud: { openTreasures: (t) => { opened = t; } } });
  assert.equal(opened, 'album');
  assert.ok(markTipSeen(c, tip));
  assert.notEqual(pendingTip(c)?.key, 'tip:album', 'once');
  // the first find names itself (a primed level-8 farm finds something else first)
  const p = coachedAt('carrots', 8);
  p.markSeen('tip:5'); p.markSeen('tip:6'); p.markSeen('tip:7'); p.markSeen('tip:8');
  const id = p.rollKeepsake('animal', 3);
  assert.ok(id);
  assert.equal(pendingTip(p).text.includes(CFG.KEEPSAKES[id].name), true);
  // level tips first; never guided; never with hints off
  const lv = coachedAt('carrots', 6);
  lv.giveKeepsake('post', 'meadow:clover');
  assert.equal(pendingTip(lv).key, 'tip:5');
  const gd = fresh();
  gd.giveKeepsake('post', 'meadow:clover');
  assert.equal(pendingTip(gd), null, 'guided');
  const off = coachedAt('carrots', 4);
  off.giveKeepsake('post', 'meadow:clover');
  off.s.settings.hints = 'off';
  assert.equal(pendingTip(off), null, 'hints off');
  // a migrated farm: What's new first, then the album's own intro
  const w = coachedAt('carrots', 12);
  for (let l = 5; l <= 12; l++) w.markSeen('tip:' + l);
  w.markSeen('whatsNew:pending');
  w.giveKeepsake('post', 'meadow:clover');
  const wn = pendingTip(w);
  assert.equal(wn.key, 'tip:whatsNew');
  markTipSeen(w, wn);
  assert.equal(pendingTip(w).key, 'tip:album');
  // the post-L30 page tips are level tips (≤ 80 characters)
  const hi = coachedAt('carrots', 35);
  for (let l = 1; l <= 34; l++) hi.markSeen('tip:' + l);
  assert.equal(pendingTip(hi).key, 'tip:35');
  assert.ok(pendingTip(hi).text.includes('Starry Nights'));
});

// ---------------------------------------------------------------- Prettiest Farm (§4.5)
test('tip:ribbons: L19 and a rank to collect, once — never in the tour or with hints off; tap opens 🏆 → Ribbons', () => {
  const c = coachedAt('carrots', 18);
  for (let l = 1; l <= 19; l++) c.markSeen('tip:' + l);
  for (const k of ['tip:camera', 'tip:post2']) c.markSeen(k);
  assert.ok(c.charm().total >= CFG.CHARM.rank(1), 'the starter decor already reaches rank 1');
  assert.notEqual(pendingTip(c)?.key, 'tip:ribbons', 'level 18');
  setLevel(c, 19);
  const tip = pendingTip(c);
  assert.equal(tip.key, 'tip:ribbons');
  assert.equal(tip.text, 'Mayor Hank says your farm is charming, dear — collect your ribbons in 🏆! 🎀');
  let opened = null;
  tip.onTap({ hud: { openTreasures: (t) => { opened = t; } } });
  assert.equal(opened, 'ribbons');
  assert.ok(markTipSeen(c, tip));
  assert.notEqual(pendingTip(c)?.key, 'tip:ribbons', 'once');
  // nothing to collect: no tip
  const n = coachedAt('carrots', 19);
  for (let l = 1; l <= 19; l++) n.markSeen('tip:' + l);
  for (const k of ['tip:camera', 'tip:post2']) n.markSeen(k);
  n.claimRibbons();
  assert.notEqual(pendingTip(n)?.key, 'tip:ribbons');
  // the rewritten level-19 tip comes first; hints off: none
  const lv = coachedAt('carrots', 19);
  for (let l = 1; l <= 18; l++) lv.markSeen('tip:' + l);
  assert.equal(pendingTip(lv).key, 'tip:19');
  assert.ok(pendingTip(lv).text.includes('💗'));
  lv.s.settings.hints = 'off';
  assert.equal(pendingTip(lv), null, 'hints off');
});

test('ribbons (SimUI): 🏆 opens on a rank to collect → Claim all → (rank 5) chest → the Blossom Oak goes up', () => {
  const g = coachedAt('carrots', 19);
  const sim = new SimUI(g);
  // gems-only ranks: paid in place, the panel stays
  sim.tap('btn:trophy');
  assert.deepEqual([sim.ui.panel.id, sim.ui.panel.tab], ['treasures', 'ribbons']);
  const gems = g.s.gems;
  sim.tap('ribbons:claim');
  assert.equal(g.s.charm.ranks, 1);
  assert.equal(g.s.gems, gems + 2);
  assert.ok(sim.ui.panel, 'a gems-only rank keeps the panel open');
  sim.closePanel();
  // decorate up to rank 5: Claim all → the chest → the Blossom Oak's placement
  g.s.coins = 1e5;
  for (const type of ['gazebo', 'fountain', 'birdbath', 'birdbath']) { const [x, z] = g.findFreeSpot(type); assert.ok(g.placeObject(type, x, z, 0), type); }
  assert.ok(g.charmStatus().reached >= 5, `${g.charm().total}`);
  sim.tap('btn:trophy');
  assert.equal(sim.ui.panel.tab, 'ribbons');
  sim.tap('ribbons:claim');
  assert.ok(g.s.charm.ranks >= 5 && g.s.charm.titles.includes('Charming Farm'));
  assert.equal(sim.ui.panel, null, 'a rank with a decoration closes the panel for its chest');
  sim.pump();
  assert.equal(sim.ui.modal, 'chest');
  sim.tap('modal:chest:open');
  assert.ok(sim.ui.placing && sim.ui.placing.type === 'blossomoak' && sim.ui.placing.gift);
  sim.tap('place:ok');
  const oak = g.s.objects.find((o) => o.type === 'blossomoak');
  assert.ok(oak && oak.free);
  assert.deepEqual(g.s.gifts, []);
  // before L19 there's no Ribbons tab to open on
  const y = coachedAt('carrots', 18);
  const ys = new SimUI(y);
  ys.tap('btn:trophy');
  assert.notEqual(ys.ui.panel.tab, 'ribbons');
});

// ---------------------------------------------------------------- the Post (§2.8)
// a tour farm in Chapter 1's egg wait (two fed chickens, eggs due 3 minutes after parcel #1)
function eggWait() {
  const g = fresh();
  g.markSeen('welcome');
  setQuest(g, 'eggs');
  setLevel(g, 2);
  const coop = put(g, 'coop', ...CFG.tutorialTile(CFG.TUTORIAL.lots.coop));
  for (let i = 0; i < 2; i++) g.s.animals.push({ id: g.s.nextId++, type: 'chicken', home: coop.id, readyAt: g.s.post.nextAt + 3 * 60000 });
  return g;
}

test('post (tour): parcel #1 at 5:00 is the egg wait\'s Meanwhile with Mabel\'s line; the modal says post1Open; never in a hard beat, graduation, placement or after #1', () => {
  for (const k of ['btn:post', 'modal:post:open', 'today:post']) assert.ok(isGuideKey(k), k);
  const g = eggWait();
  t = g.s.post.nextAt - 1000;
  let s = planStep(g, {}, { cache: false });
  assert.equal(s.kind, 'wait', 'waiting for eggs');
  assert.notEqual(s.meanwhile?.target?.ui, 'btn:post', 'not before 5:00');
  assert.ok(!(s.reveal || []).includes('post'), 'the pill stays hidden');
  t = g.s.post.nextAt;
  s = planStep(g, {}, { cache: false });
  assert.equal(s.kind, 'wait');
  assert.equal(s.meanwhile.target.ui, 'btn:post');
  assert.deepEqual(s.meanwhile.chain, ['btn:post', 'modal:post:open']);
  assert.equal(s.meanwhile.stepKey, 'post1');
  assert.equal(s.meanwhile.say, CFG.TUTORIAL.lines.post1);
  assert.ok(s.reveal.includes('post'), 'the pill pops in where the finger points');
  assert.equal(questCardInfo(g, s).meanwhile.icon, '📬');
  // the modal: Open! ✨ → Lovely! on one key
  const m = planStep(g, { modal: 'post' }, { cache: false });
  assert.equal(m.target.ui, 'modal:post:open');
  assert.equal(m.stepKey, 'post1Open');
  assert.equal(m.say, CFG.TUTORIAL.lines.post1Open);
  const sim = new SimUI(g);
  sim.apply(s.meanwhile);
  assert.equal(sim.ui.modal, 'post');
  sim.tap('modal:post:open');
  assert.equal(g.s.post.n, 1, 'claimed on Open');
  assert.equal(sim.ui.modal, 'post', 'Lovely! still to tap');
  assert.equal(planStep(g, sim.view(), { cache: false }).target.ui, 'modal:post:open');
  assert.equal(planStep(g, sim.view(), { cache: false }).stepKey, null, 'after #1 no more lines');
  sim.tap('modal:post:open');
  assert.equal(sim.ui.modal, null);
  assert.ok(planStep(g, {}, { cache: false }).reveal.includes('post'), 'opened once: the pill stays');
  // and back to tidying
  assert.notEqual(planStep(g, {}, { cache: false }).meanwhile?.target?.ui, 'btn:post');
  // guided: only parcel #1
  const two = eggWait();
  two.s.post.n = 1;
  t = two.s.post.nextAt = two.now();
  assert.ok(two.postStatus().ready);
  assert.notEqual(planStep(two, {}, { cache: false }).meanwhile?.target?.ui, 'btn:post', 'guided, n ≥ 1');
  // never during a hard beat, graduation or a placement
  const hb = fresh();
  hb.markSeen('welcome');
  t = hb.s.post.nextAt;
  assert.ok(hardBeat(hb) && hb.postStatus().ready);
  assert.notEqual(recommendIdle(hb, {}).target?.ui, 'btn:post', 'hard beat');
  const place = eggWait();
  t = place.s.post.nextAt;
  assert.notEqual(recommendIdle(place, { placing: { type: 'coop', valid: true } }).target?.ui, 'btn:post', 'placing');
  assert.equal(recommendIdle(place, {}).target?.ui, 'btn:post');
  const grad = fresh();
  grad.markSeen('welcome');
  setQuest(grad, 'bread');
  setLevel(grad, 4);
  grad.s.quest.progress = 1;
  grad.claimQuest();
  t = grad.s.post.nextAt;
  assert.ok(graduationPending(grad) && grad.postStatus().ready);
  for (let i = 0; i < 4; i++) {
    const st = planStep(grad, {}, { cache: false });
    assert.ok(![st.target?.ui, st.meanwhile?.target?.ui].includes('btn:post'), 'graduation is untouched');
    grad.markSeen(['grad:chest', 'grad:gift', 'grad:daily', 'grad:end'][i]);
  }
});

test('post: parcel #1 that turned up after the eggs (a quick player) gets Mabel\'s post1 line once after the tour', () => {
  // at ~1.5 s per tap the eggs come back before 5:00: the parcel is ready during the Bakery steps, the tour never waits again
  const g = seeded(3, () => {
    const gg = fresh();
    gg.markSeen('welcome');
    new GuideFollower(gg, { sim: new SimUI(gg, { cost: { tap: 1.5 } }), advance }).run({ maxSec: 15 * 60, until: (x) => x.tutorialMode() !== 'guided' });
    return gg;
  });
  assert.notEqual(g.tutorialMode(), 'guided', 'Chapter 1 done');
  assert.equal(g.s.post.n, 0, 'parcel #1 still unopened');
  if (!g.postStatus().ready) t = g.s.post.nextAt;
  assert.ok(g.hasSeen('grad:end'));
  assert.equal(post1LineDue(g), true, 'the line is owed');
  g.markSeen('line:post1'); // shown (or the tour showed it during the egg wait)
  assert.equal(post1LineDue(g), false, 'once');
  // never in the tour, with hints off, after a skipped tour, once opened, or before the parcel is there
  const tour = fresh();
  tour.markSeen('welcome');
  tour.s.post.nextAt = tour.now();
  assert.equal(post1LineDue(tour), false, 'guided: the tour shows it as the Meanwhile');
  const skip = coachedAt('orders3', 3);
  skip.s.post.nextAt = skip.now();
  assert.equal(skip.s.post.n, 0);
  assert.equal(post1LineDue(skip), false, 'skipped tour: tour lines seen');
  const off = coachedAt('orders3', 3); // as a quick graduate: the tour's post1 line never shown
  delete off.s.tutorial.seen['line:post1'];
  off.s.post.nextAt = off.now();
  assert.equal(post1LineDue(off), true);
  off.s.settings.hints = 'off';
  assert.equal(post1LineDue(off), false, 'hints off');
  off.s.settings.hints = 'glow';
  off.s.post.nextAt = off.now() + 60e3;
  assert.equal(post1LineDue(off), false, 'not ready yet');
  off.s.post.nextAt = off.now();
  off.claimPost();
  assert.equal(post1LineDue(off), false, 'opened');
});

test('"Earn N coins" goal: Show me never sends you to a parcel or a chore (reward coins don\'t count); a coin block still may', () => {
  const g = coachedAt('pasture', 12);
  const idx = CFG.QUESTS.length + 5; // the 6th repeat goal
  g.s.quest = { index: idx, qid: g.qidFor(idx), progress: 0, notified: false };
  assert.equal(g.currentQuest().event, 'earn');
  // a coin-value parcel waiting (pays, as earn() for a coin block sees it)
  g.s.post.n = 6;
  g.s.post.nextAt = g.now();
  assert.equal(earn(g, {}, 500).target?.ui, 'btn:post', 'a coin block: any coins help');
  let s = planStep(g, {}, { cache: false });
  assert.notEqual(s.target?.ui, 'btn:post', s.key);
  assertKeys(s);
  // opening it pays reward coins, which the goal never counts
  const p0 = g.questProgress(), c0 = g.s.coins;
  g.claimPost();
  assert.ok(g.s.coins > c0);
  assert.equal(g.questProgress(), p0);
  // the same for a finished chore
  g.ensureChores();
  g.s.chores.list[0].progress = g.s.chores.list[0].count;
  assert.equal(earn(g, {}, 500).target?.ui, 'btn:today');
  s = planStep(g, {}, { cache: false });
  assert.notEqual(s.target?.ui, 'btn:today', s.key);
  const c1 = g.s.coins;
  g.claimChore(0);
  assert.ok(g.s.coins > c1);
  assert.equal(g.questProgress(), p0);
});

test('post (coached): after chores in the Meanwhile; earn() only for coin-value parcels; the Mailbox ghost has no Scarecrow line; tips', () => {
  const g = coachedAt('pasture', 5); // saving up for the pasture: a coins wait with a Meanwhile
  g.s.coins = 0;
  g.s.post.n = 1;
  t = g.s.post.nextAt;
  g.ensureChores();
  g.s.chores.list[0].progress = g.s.chores.list[0].count;
  assert.equal(recommendIdle(g, {}).target.ui, 'btn:today', 'a ready chore first');
  g.claimChore(0);
  assert.equal(recommendIdle(g, {}).target.ui, 'btn:post', 'then the parcel');
  assert.equal(recommendIdle(g, {}).stepKey, null, 'no tour line when coached');
  // as the Meanwhile of a wait (eggs on their way), with no line
  const e = coachedAt('eggs', 3);
  const coop = put(e, 'coop', ...CFG.tutorialTile(CFG.TUTORIAL.lots.coop));
  e.s.animals.push({ id: e.s.nextId++, type: 'chicken', home: coop.id, readyAt: t + 3 * 60000 });
  e.s.post.n = 1;
  e.s.post.nextAt = t;
  const ew = planStep(e, {}, { cache: false });
  assert.equal(ew.kind, 'wait');
  assert.equal(ew.meanwhile.target.ui, 'btn:post');
  assert.equal(ew.meanwhile.say, null);
  assert.equal(questCardInfo(e, ew).meanwhile.label, 'Open your parcel');
  // earn(): a parcel with coin value only
  for (const [n, pays] of [[1, false], [5, false], [6, true], [7, false], [8, true]]) {
    g.s.post.n = n;
    assert.equal(g.postStatus().ready, true);
    assert.equal(earn(g, {}, 500).target?.ui === 'btn:post', pays, `n ${n} (${g.postStatus().kind})`);
  }
  g.s.post = { ...g.s.post, n: 5, office: true };
  assert.equal(earn(g, {}, 500).target?.ui, 'btn:post', 'the office parcel pays');
  // the Mailbox ghost: ✓ with no Scarecrow line (its own coach line comes from the UI)
  const pl = planStep(g, { placing: { type: 'mailbox', valid: true, gift: true } }, { cache: false });
  assert.equal(pl.target.ui, 'place:ok');
  assert.equal(pl.stepKey, null);
  const gd = fresh();
  gd.markSeen('welcome');
  assert.equal(planStep(gd, { placing: { type: 'scarecrow', valid: true, gift: true } }, { cache: false }).stepKey, 'gradGift');
  // SimUI: 📬 → Open → Lovely → the Mailbox goes up by the order board
  const h = coachedAt('pasture', 5);
  h.s.post.n = 3;
  t = h.s.post.nextAt;
  const sim = new SimUI(h);
  sim.tap('btn:post');
  assert.equal(sim.ui.modal, 'post');
  assert.ok(sim.tap('modal:post:open') >= 2, 'the reveal takes a moment');
  assert.deepEqual(h.s.gifts, ['mailbox']);
  sim.tap('modal:post:open');
  assert.equal(sim.ui.modal, null);
  assert.equal(sim.ui.placing?.type, 'mailbox');
  assert.ok(sim.ui.placing.gift && sim.ui.placing.valid);
  sim.tap('place:ok');
  const box = h.s.objects.find((o) => o.type === 'mailbox');
  const board = h.s.objects.find((o) => o.type === 'orderboard');
  assert.ok(box && box.free, 'placed free');
  assert.ok(Math.hypot(box.x - board.x, box.z - board.z) <= 6, 'by the road, near the order board');
  assert.deepEqual(h.s.gifts, []);
  assert.equal(sim.tap('today:post'), 8, 'nothing waiting: the Today row does nothing');
  assert.equal(sim.ui.modal, null);
  // tips: tip:post2 once #2 is opened; What's new (a migrated farm) stands in for tip:post2 and tip:camera
  const c = coachedAt('carrots', 2);
  assert.equal(pendingTip(c), null);
  c.s.post.n = 2;
  const p2 = pendingTip(c);
  assert.equal(p2.key, 'tip:post2');
  assert.ok([...p2.text].length <= 90 && typeof p2.onTap === 'function');
  c.s.settings.hints = 'off';
  assert.equal(pendingTip(c), null, 'hints off');
  const gt = fresh();
  gt.s.post.n = 2;
  advance(31 * 60);
  assert.equal(pendingTip(gt), null, 'never in the tour');
  const w = coachedAt('carrots', 2);
  w.markSeen('whatsNew:pending');
  w.s.post = { ...w.s.post, n: 5, office: true };
  const wn = pendingTip(w, { cameraTipDue: true });
  assert.equal(wn.key, 'tip:whatsNew');
  assert.ok([...wn.text].length <= 90);
  assert.ok(markTipSeen(w, wn));
  assert.ok(w.hasSeen('tip:camera') && w.hasSeen('tip:post2'));
  assert.equal(pendingTip(w, { cameraTipDue: true }), null, 'no camera or cadence tip after What\'s new');
  assert.equal(markTipSeen(w, wn), false, 'once');
});

// ---------------------------------------------------------------- the guide-follower
const SEEDS = [1, 2, 3, 4, 5];
const runs = [];

// One full run per seed (4 s per tap); seed 1 also saves and reloads at every new goal.
function follow(seed, { reloadCheck = false } = {}) {
  t = T0; // same start time whatever ran before (day boundaries change chores and the daily gift)
  return seeded(seed, () => {
    const g = fresh();
    const sim = new SimUI(g);
    const mismatches = [];
    const guidedMeanwhile = [];
    const onQuest = reloadCheck ? () => {
      const view = sim.view();
      const before = planStep(g, view, { cache: false }).key;
      const st = new MemStorage();
      g.storage = st;
      g.save();
      g.storage = null;
      const g2 = fresh(st);
      const after = planStep(g2, view, { cache: false }).key;
      if (before !== after) mismatches.push(`${g.currentQuest().id || g.currentQuest().text}: ${before} ≠ ${after}`);
    } : null;
    const onStep = (s) => { if (g.tutorialMode() === 'guided' && s.meanwhile) guidedMeanwhile.push(s.meanwhile); assertKeys(s, `(seed ${seed})`); };
    const parcels = []; // minutes at which each parcel was opened
    g.on('post', () => parcels.push((t - T0) / 60000));
    const f = new GuideFollower(g, { sim, advance, onQuest, onStep });
    const r = f.run({ maxSec: 150 * 60, until: (gg) => gg.s.quest.index >= CFG.QUESTS.length });
    return { seed, r, mismatches, guidedMeanwhile, parcels, done: g.s.quest.index >= CFG.QUESTS.length };
  });
}

test('guide-follower: Chapter 1 within 10 sim-minutes; the whole list (median of 5 seeds) within 90; no dead ends', () => {
  for (const seed of SEEDS) runs.push(follow(seed, { reloadCheck: seed === 1 }));
  for (const { seed, r, done } of runs) {
    assert.ok(done, `seed ${seed}: finished the scripted list`);
    assert.ok(r.chapters[1] <= 10, `seed ${seed}: Chapter 1 at ${r.chapters[1]} min`);
    assert.ok(r.chapters[3] <= 130, `seed ${seed}: whole list at ${r.chapters[3]} min`);
    assert.deepEqual(r.deadEnds, [], `seed ${seed}: dead ends`);
    assert.equal(r.nones.length, 0, `seed ${seed}: no 'none' step while stuck`);
    assert.equal(r.stalls, 0, `seed ${seed}: no taps that change nothing`);
    assert.equal(r.safetyNet, 0, `seed ${seed}: the safety net never fires for a guided player`);
  }
  // N8: parcel #1 is opened inside Chapter 1 (its egg wait) on every seed
  for (const { seed, r, parcels } of runs) assert.ok(parcels[0] >= 5 && parcels[0] < r.chapters[1], `seed ${seed}: parcel #1 at ${parcels[0]} min, Ch1 ${r.chapters[1]}`);
  const median = runs.map((x) => x.r.chapters[3]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  assert.ok(median <= 90, `median whole-list time ${median} min`);
});

test('guide-follower: save and reload at every goal leaves planStep(...).key unchanged', () => {
  const one = runs.find((x) => x.seed === 1) || follow(1, { reloadCheck: true });
  assert.ok(one.r.quests.length >= CFG.QUESTS.length);
  assert.deepEqual(one.mismatches, []);
});

test('guide-follower: guided Meanwhile never plows; every key it was shown is a real data-guide key', () => {
  for (const { seed, r, guidedMeanwhile } of runs) {
    assert.ok(guidedMeanwhile.length > 0, `seed ${seed}: some guided waits`);
    for (const m of guidedMeanwhile) assert.ok(m.action !== 'plow' && !keysOf(m).includes('tool:plow'), `seed ${seed}: ${m.key}`);
    for (const k of r.keys) assert.ok(isGuideKey(k), `seed ${seed}: ${k}`);
  }
});

// ---------------------------------------------------------------- wander fuzz (§7.1 #7)
// Things a curious player does off-script, between guided taps and reloads every 1–4 sim-minutes:
// the guide must keep finding a way through Chapter 1. A few seeds squander everything on purpose.
const PANELS = ['shop', 'barn', 'orders', 'today', 'farmhouse', 'treasures'];
const DECOR = ['bush', 'fence', 'path', 'flowers', 'oak'];
const WANDER_SEEDS = Array.from({ length: 30 }, (_, i) => 101 + i);
const BROKE_SEEDS = new Set([110, 120, 130]);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
function disrupt(g, sim) {
  const spot = (type) => g.smartSpot(type);
  const soil = Object.keys(g.s.soil);
  const acts = [
    () => g.sell('wheat', g.count('wheat')),
    // the Clear tool on a field tile
    () => { if (soil.length) { const [x, z] = pick(soil).split(',').map(Number); g.clearSoil(x, z); } },
    () => { const sp = g.s.level >= 3 && !g.objectCount('bakery') && g.s.coins >= g.objectCost('bakery') && spot('bakery'); if (sp) g.placeObject('bakery', sp.x, sp.z, 0); },
    () => { const type = pick(DECOR); const sp = g.s.coins >= g.objectCost(type) && spot(type); if (sp) g.placeObject(type, sp.x, sp.z, 0); },
    () => { const o = g.s.orders.filter((x) => !x.waitUntil); if (o.length) g.discardOrder(pick(o).id); },
    () => sim.openPanel(pick(PANELS)),
    () => sim.closePanel(),
    // start a decor placement and leave it to the guide, or cancel the one that's up
    () => { if (sim.ui.placing) sim.tap('place:cancel'); else sim.startPlacement(pick(DECOR)); },
    () => sim.setTool(pick(['hand', 'plow', 'seed', 'remove'])),
  ];
  pick(acts)();
}

// as if everything was sold and the coins spent on decor: no coins, goods or crops left
function squander(g) {
  g.s.coins = 0;
  for (const i of Object.keys(g.s.inventory)) if (CFG.ITEMS[i].cat !== 'material') delete g.s.inventory[i];
  for (const soil of Object.values(g.s.soil)) soil.crop = null;
}

function wander(seed, { broke = false, limit = 15 } = {}) {
  t = T0;
  return seeded(seed, () => {
    const t0 = t;
    let g = fresh();
    if (broke) squander(g);
    const out = { deadEnds: [], nones: 0, net: 0, reloads: 0 };
    while (!g.chapterDone(1) && t - t0 < limit * 60000) {
      const sim = new SimUI(g);
      const f = new GuideFollower(g, { sim, advance, onStep: (s) => { assertKeys(s, `(wander ${seed})`); if (Math.random() < 0.1) disrupt(g, sim); } });
      const r = f.run({ maxSec: Math.min(60 + Math.random() * 180, limit * 60 - (t - t0) / 1000), until: (gg) => gg.chapterDone(1) });
      out.deadEnds.push(...r.deadEnds);
      out.nones += r.nones.length;
      out.net += r.safetyNet;
      // reload from a save, as after closing the app
      const st = new MemStorage();
      g.storage = st;
      g.save();
      g = fresh(st);
      g.storage = null;
      out.reloads++;
    }
    out.minutes = (t - t0) / 60000;
    out.done = g.chapterDone(1);
    return out;
  });
}

const wanders = [];
// A squandered farm starts with no coins, goods or crops and lives on Mabel's 🪙20 while the fuzz keeps selling,
// discarding orders and buying decor: 20 minutes. (60 more squandered seeds, 231–290, took 8.7–12.0 min, median 9.5;
// seed 120 here needs ~16.5 min after an unlucky run of discarded orders while saving for the Bakery.)
test('wander fuzz (30 seeds): detours and reloads still finish Chapter 1 within 15 sim-minutes (20 squandered); no dead ends; the safety net only for squandered farms', () => {
  for (const seed of WANDER_SEEDS) {
    const broke = BROKE_SEEDS.has(seed);
    const w = wander(seed, { broke, limit: broke ? 20 : 15 });
    wanders.push({ seed, broke, ...w });
    assert.ok(w.done, `seed ${seed}: Chapter 1 not done after ${w.minutes.toFixed(1)} min`);
    assert.deepEqual(w.deadEnds, [], `seed ${seed}: dead ends`);
    assert.equal(w.nones, 0, `seed ${seed}: 'none' steps while stuck`);
    assert.equal(w.net, broke ? 1 : 0, `seed ${seed}: safety net`);
    assert.ok(w.reloads >= 1);
  }
});

test('a farm that is truly broke gets Mabel\'s pocket money, and the guide carries on from there', () => {
  seeded(7, () => {
    const g = coachedAt('plant', 1);
    g.s.coins = 0;
    g.s.inventory = {};
    for (const soil of Object.values(g.s.soil)) soil.crop = null;
    g.s.objects = g.s.objects.filter((o) => CFG.OBJECTS[o.type].kind !== 'debris');
    g.rebuildOccupancy();
    const f = new GuideFollower(g, { advance });
    const r = f.run({ maxSec: 10 * 60, until: (gg) => gg.s.quest.index > qIndex('plant') });
    assert.equal(r.safetyNet, 1, 'paid once');
    assert.ok(g.s.quest.index > qIndex('plant'), 'then the plant goal was done');
  });
});

// ---------------------------------------------------------------- run
let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try { await fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message.split('\n')[0], (e.stack || '').split('\n').find((l) => l.includes('test-guide.mjs:')) || ''); }
}
if (wanders.length) {
  const mins = wanders.map((w) => w.minutes).sort((a, b) => a - b);
  console.log(`\n  wander fuzz: Chapter 1 in ${mins[0].toFixed(1)}–${mins[mins.length - 1].toFixed(1)} min (median ${mins[mins.length >> 1].toFixed(1)}), ${wanders.reduce((n, w) => n + w.reloads, 0)} reloads, squandered seeds ${wanders.filter((w) => w.broke).map((w) => `${w.seed} ${w.minutes.toFixed(1)}m`).join(', ')}`);
}
if (runs.length) {
  console.log('\n  guide-follower (4 s per tap), minutes:');
  for (const { seed, r } of runs) {
    const L = Object.entries(r.levels).map(([l, m]) => `L${l} ${m}`).join(' · ');
    const p = runs.find((x) => x.seed === seed).parcels.slice(0, 4).map((m) => m.toFixed(1)).join(' ');
    console.log(`    seed ${seed}: Ch1 ${r.chapters[1]} · Ch2 ${r.chapters[2]} · Ch3 ${r.chapters[3]} | ${L} | gap ${r.longestGap}s · idle ${Math.round((r.idleSec / 60 / r.minutes) * 100)}% · silo 90% at ${r.firstSiloFull ?? '–'} · parcels ${p}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
