// Guide planner (pure: no DOM, no three). Works out the one next thing a player should do for the
// current goal and where Mabel's finger goes. It only reads the Game: every purchase and action still
// needs the player's own tap (tools/simui.mjs plays these steps headlessly for the tests and the sim).
//
// planStep(game, ui) → Step
//   { key, kind: 'ui'|'world'|'wait'|'none', target, chain?, gesture: 'tap'|'swipe', gate: 'hard'|'soft',
//     why: 'modal'|'claim'|'interrupt'|'quest'|'meanwhile', stepKey?, say?, icon, label,
//     wait?: { until, icon, label }, meanwhile?: Step, block?: { kind, have, need, … }, reveal?: string[], … }
//   target: { ui: '<data-guide key>' } | { world: 'tiles', tiles } | { world: 'object', id }
//         | { world: 'ghostPlots', tiles } | { world: 'visitor', id } | { world: 'ghost' } | null
//   ui: { panel: { id, tab, ref, age } | null, placing: { type, valid, gift } | null, tool,
//         modal: 'levelup'|'daily'|'chest'|'guide'|null, popover: { x, z } | null, interrupt: { key, … } | null,
//         skipInterrupt?: true (plan the goal as if no one-time beat were waiting: a running Show me) }
// Steps are memoised and shared: treat them as read-only.
import {
  ITEMS, CROPS, ANIMALS, RECIPES, OBJECTS, STORAGE, QUESTS, CHAPTERS, TUTORIAL, FEATURE_TIPS, VISITORS, WAGON, PLOTS, GUIDE,
  questLevel, tutorialTile, xpForLevel, xpToNext,
} from './config.js';
import { farmCore } from './layout.js';
import { GUIDE_KEY_PATTERNS, isGuideKey } from './guide-keys.js';

export { GUIDE_KEY_PATTERNS, isGuideKey };

const PANEL_PATIENCE = 4; // s a different panel may stay open before the guide asks to close it
const MEANWHILE_AFTER = 20; // s: shorter waits get no Meanwhile row
const MAX_DEPTH = 3; // need() follows recipe inputs this deep
const AUTO_DAILY_MS = 2 * 3600000; // a new farm's daily gift waits for graduation (or this long)
const PLOW_SPARE = 80; // coins an extra field must leave over
const EXTRAS_KEEP = 10; // sellExtras keeps this many of each item
const FULL_SHARE = 0.9; // the "Sell extras" button and the silo-full beat start here
const DAY_MS = 86400000;
const qIndex = (id) => QUESTS.findIndex((q) => q.id === id);
const tk = (x, z) => x + ',' + z;

// ---------------------------------------------------------------- small helpers
const mode = (g) => g.tutorialMode();
const guided = (g) => mode(g) === 'guided';
const treeFor = (fruit) => Object.keys(OBJECTS).find((t) => OBJECTS[t].kind === 'tree' && OBJECTS[t].fruit === fruit) || null;
const animalFor = (product) => Object.keys(ANIMALS).find((t) => ANIMALS[t].product === product) || null;
const objectsOf = (g, kind) => g.s.objects.filter((o) => OBJECTS[o.type]?.kind === kind);
const fill = (text, vars = {}) => text && text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function mk(key, kind, target, extra = {}) {
  return { key, kind, target, gesture: 'tap', gate: 'soft', why: 'quest', ...extra };
}
const uiStep = (key, ui, extra) => mk(key, 'ui', { ui }, extra);
const worldStep = (key, target, extra) => mk(key, 'world', target, extra);
const waitStep = (key, until, icon, label, extra) => mk(key, 'wait', null, { icon, label, wait: { until, icon, label }, ...extra });

// soil tiles in scan order (z, then x)
function soils(g) {
  return Object.entries(g.s.soil)
    .map(([k, soil]) => { const [x, z] = k.split(',').map(Number); return { x, z, soil }; })
    .sort((a, b) => a.z - b.z || a.x - b.x);
}

// connected soil patches whose tiles match pred (and share group(soil)), largest first, ties in scan order
function patches(g, pred, group = () => '') {
  const seen = new Set(), out = [];
  for (const { x, z, soil } of soils(g)) {
    if (seen.has(tk(x, z)) || !pred(soil)) continue;
    const grp = group(soil);
    const tiles = g.patchTiles(x, z, (s) => pred(s) && group(s) === grp, 999);
    for (const [a, b] of tiles) seen.add(tk(a, b));
    out.push({ group: grp, tiles });
  }
  return out.sort((a, b) => b.tiles.length - a.tiles.length);
}
const isRipe = (g, s) => !!s.crop && g.cropStage(s.crop) === 3;
const ripePatches = (g, crop = null) => patches(g, (s) => isRipe(g, s) && (!crop || s.crop.type === crop), (s) => s.crop.type);
const emptyPatches = (g) => patches(g, (s) => !s.crop);

// the crop that ripens first ({ crop, until }), optionally of one type
function growing(g, crop = null) {
  const now = g.now();
  let best = null;
  for (const { soil } of soils(g)) {
    const c = soil.crop;
    if (!c || (crop && c.type !== crop)) continue;
    const until = g.cropReadyAt(c);
    if (until > now && (!best || until < best.until)) best = { crop: c.type, until };
  }
  return best;
}
const growingYield = (g, crop) => soils(g).filter(({ soil }) => soil.crop?.type === crop && !isRipe(g, soil)).length * CROPS[crop].yield;

// ---------------------------------------------------------------- reserves
// Food for every animal, the current produce goal's inputs and the current order/visitor goal's
// target: the planner never delivers, sells or cooks below these. skip: a target whose own items don't count.
function baseReserves(g) {
  const r = {};
  const add = (i, n) => { if (n > 0) r[i] = (r[i] || 0) + n; };
  for (const a of g.s.animals) { const f = g.animalFood(a.type); if (f) add(f.item, f.qty); }
  const q = g.currentQuest();
  if (q.event === 'produce' && RECIPES[q.filter] && !g.questDone()) for (const [i, n] of Object.entries(RECIPES[q.filter].inputs)) add(i, n);
  return r;
}

const spare = (g, items, res) => Object.entries(items).every(([i, n]) => g.count(i) - n >= (res[i] || 0));
const shortOf = (g, items, res) => Object.entries(items).map(([i, n]) => [i, n + (res[i] || 0) - g.count(i)]).filter(([, n]) => n > 0);
const openOrders = (g) => g.s.orders.filter((o) => !o.waitUntil && o.items);
const visitorWants = (v) => ({ id: v.id, visitor: true, items: { [v.item]: v.qty } });

// the order (or visitor) an order/visitor goal aims at: the first one you can fill, else the cheapest to finish
function goalTarget(g) {
  const q = g.currentQuest();
  if (g.questDone() || (q.event !== 'order' && q.event !== 'visitor')) return null;
  const list = q.event === 'order' ? openOrders(g) : (g.s.visitors || []).map(visitorWants);
  if (!list.length) return null;
  const base = baseReserves(g);
  return list.find((o) => spare(g, o.items, base)) || cheapestToFinish(g, list, base);
}

// the order (or visitor) that's quickest to finish: shortest estimated wait, then the cheapest shortfall
function cheapestToFinish(g, list, res) {
  let best = null, bestCost = Infinity;
  for (const o of list) {
    const miss = shortOf(g, o.items, res);
    const time = Math.max(0, ...miss.map(([i, n]) => eta(g, i, n)));
    const cost = time * 100 + miss.reduce((s, [i, n]) => s + n * (ITEMS[i]?.price || 0), 0);
    if (cost < bestCost) { bestCost = cost; best = o; }
  }
  return best;
}

// rough seconds until `n` more of an item can be in hand (big numbers for things the farm can't make yet)
const NEVER = 1e6;
function eta(g, item, n, depth = 0) {
  if (n <= 0) return 0;
  const now = g.now();
  if (CROPS[item]) {
    if (!g.isUnlocked('crops', item)) return NEVER;
    const y = CROPS[item].yield;
    const ripe = soils(g).filter(({ soil }) => soil.crop?.type === item).map(({ soil }) => g.cropReadyAt(soil.crop)).sort((a, b) => a - b);
    const k = Math.ceil(n / y);
    return ripe.length >= k ? Math.max(0, ripe[k - 1] - now) / 1000 : g.cropTime(item) / 1000 + 15;
  }
  const tree = treeFor(item);
  if (tree) {
    const alive = g.s.objects.filter((o) => o.type === tree && g.treeState(o) !== 'dead');
    if (!alive.length) return NEVER / 10;
    const per = alive.length * OBJECTS[tree].yield;
    return Math.max(0, Math.min(...alive.map((o) => g.treeReadyAt(o))) - now) / 1000 + Math.max(0, Math.ceil(n / per) - 1) * OBJECTS[tree].fruitTime;
  }
  const animal = animalFor(item);
  if (animal) {
    const list = g.s.animals.filter((a) => a.type === animal);
    if (!list.length) return g.isUnlocked('animals', animal) ? NEVER / 10 : NEVER;
    return Math.ceil(n / list.length) * ANIMALS[animal].time;
  }
  const r = RECIPES[item];
  if (r) {
    if (!g.isUnlocked('recipes', item)) return NEVER;
    if (!g.objectCount(r.building)) return NEVER / 10;
    const inputs = depth < MAX_DEPTH ? Math.max(0, ...Object.entries(r.inputs).map(([i, k]) => eta(g, i, k * n - g.count(i), depth + 1))) : 0;
    return inputs + r.time * n;
  }
  return NEVER;
}

// reserves(game, { skip }) → { item: qty } the planner keeps back (§2.4)
export function reserves(game, { skip = null } = {}) {
  const r = baseReserves(game);
  const t = goalTarget(game);
  if (t && !(skip && skip.id === t.id)) for (const [i, n] of Object.entries(t.items)) r[i] = (r[i] || 0) + n;
  return r;
}

// ---------------------------------------------------------------- blocks (quest card + Show me)
function levelBlock(g, level) {
  const L = g.s.level;
  return { kind: 'level', level, have: Math.max(0, g.s.xp - xpForLevel(L)), need: xpToNext(L) };
}
const coinsBlock = (g, cost) => ({ kind: 'coins', have: g.s.coins, need: cost });
function materialsBlock(g, items) {
  const miss = {};
  for (const [i, n] of Object.entries(items || {})) if (g.count(i) < n) miss[i] = n - g.count(i);
  return Object.keys(miss).length ? { kind: 'materials', items: miss, need: { ...items }, have: Object.fromEntries(Object.keys(items).map((i) => [i, g.count(i)])) } : null;
}

// the first level above the current one at which `type`'s building limit grows past what you own
function limitLevel(g, type) {
  const def = OBJECTS[type];
  const owned = g.objectCount(type);
  for (let l = g.s.level + 1; l < 120; l++) if (def.limit(l) > owned) return l;
  return null;
}

function buildBlock(g, type) {
  const def = OBJECTS[type];
  if (def.level > g.s.level) return levelBlock(g, def.level);
  if (g.objectCount(type) >= g.objectLimit(type)) { const l = limitLevel(g, type); return l ? levelBlock(g, l) : null; }
  const m = def.items && materialsBlock(g, def.items);
  if (m) return m;
  const cost = g.objectCost(type);
  return g.s.coins < cost ? coinsBlock(g, cost) : null;
}

function expandBlock(g) {
  const e = g.nextExpansion();
  if (!e) return null;
  if (g.s.level < e.level) return levelBlock(g, e.level);
  return materialsBlock(g, e.items) || (g.s.coins < e.coins ? coinsBlock(g, e.coins) : null);
}

function storageBlock(g, id) {
  const up = g.nextStorageUpgrade(id);
  if (!up) return null;
  if (up.locked) return levelBlock(g, up.needLevel);
  return materialsBlock(g, up.items) || (g.s.coins < up.coins ? coinsBlock(g, up.coins) : null);
}

function animalBlock(g, type) {
  const a = ANIMALS[type];
  if (!g.isUnlocked('animals', type)) return levelBlock(g, a.level);
  if (!g.findHomeFor(type)) return buildBlock(g, a.home);
  const cost = g.animalCost(type);
  return g.s.coins < cost ? coinsBlock(g, cost) : null;
}

// a storage goal without a filter takes either upgrade: the Silo, unless only the Barn is ready to go
const storageId = (g, q) => q.filter || (storageBlock(g, 'silo') && !storageBlock(g, 'barn') ? 'barn' : 'silo');

// What stops the current goal right now: { kind: 'coins'|'level'|'materials', have, need, level?, items? } or null.
export function questBlock(game, q = game.currentQuest()) {
  const g = game;
  if (q === g.currentQuest() && g.questDone()) return null;
  const f = q.filter;
  switch (q.event) {
    case 'build': return OBJECTS[f] ? buildBlock(g, f) : null;
    case 'buyAnimal': return ANIMALS[f] ? animalBlock(g, f) : null;
    case 'expand': return expandBlock(g);
    case 'storage': return storageBlock(g, storageId(g, q));
    case 'plant': return CROPS[f] && !g.isUnlocked('crops', f) ? levelBlock(g, CROPS[f].level) : null;
    case 'produce': return RECIPES[f] && !g.isUnlocked('recipes', f) ? levelBlock(g, questLevel(q)) : null;
    case 'feed': case 'collect': {
      const type = q.event === 'feed' ? f : animalFor(f);
      return type && !g.isUnlocked('animals', type) ? levelBlock(g, ANIMALS[type].level) : null;
    }
    default: {
      const lvl = questLevel(q);
      return lvl > g.s.level ? levelBlock(g, lvl) : null;
    }
  }
}

// the step that works on a block: earn coins, earn XP, or (materials) a no-finger line while you farm
function blocked(g, ui, block, key, extra = {}) {
  if (block.kind === 'materials') {
    return waitStep(`${key}:materials`, null, '🧰', 'Materials drop while you farm', { block, pointer: false, ...extra });
  }
  const s = block.kind === 'coins' ? earn(g, ui, block.need - block.have) : earn(g, ui, 0, { xp: true });
  return { ...s, key: `${key}:${block.kind}:${s.key}`, block, ...extra };
}

// ---------------------------------------------------------------- reaching a target
// World targets and speech bubbles sit under an open panel: after PANEL_PATIENCE seconds the
// guide asks to close it. Tiles and objects also need the Hand tool.
function reach(ui, s) {
  if (s.kind === 'wait' || s.kind === 'none') return s;
  if (ui.panel) {
    if ((ui.panel.age ?? 0) > PANEL_PATIENCE) return { ...s, key: s.key + ':close', kind: 'ui', target: { ui: 'panel:close' } };
    return s;
  }
  if (s.kind === 'world' && s.target.world !== 'ghostPlots' && ui.tool && ui.tool !== 'hand') {
    return { ...s, key: s.key + ':hand', kind: 'ui', target: { ui: 'tool:hand' } };
  }
  return s;
}

// The right panel (and tab) open → its element; another panel open a while → close it; else the opener.
// opener: a data-guide key or a world target. chain lists the keys in tap order.
function viaPanel(g, ui, key, o, extra = {}) {
  const p = ui.panel;
  const tabKey = o.tab ? `${o.tabKey || o.panel}:tab:${o.tab}` : null;
  const openerKey = typeof o.opener === 'string' ? o.opener : null;
  const chain = [openerKey, tabKey, o.target, ...(o.after || [])].filter(Boolean);
  const base = { chain, panel: { id: o.panel, tab: o.tab || null, ref: o.ref ?? null }, ...extra };
  if (p && p.id === o.panel && (o.ref == null || p.ref === o.ref)) {
    if (o.tab && p.tab && p.tab !== o.tab) return uiStep(key + ':tab', tabKey, base);
    return o.target ? uiStep(key, o.target, base) : mk(key, 'none', null, base);
  }
  const open = openerKey ? uiStep(key + ':open', openerKey, base) : worldStep(key + ':open', o.opener, base);
  return reach(ui, open);
}

// ---------------------------------------------------------------- single actions
function sellExtrasValue(g, id) {
  const res = reserves(g);
  let v = 0;
  for (const [item, n] of Object.entries(g.s.inventory)) {
    if (g.storageOf(item) !== id) continue;
    v += Math.max(0, n - Math.max(EXTRAS_KEEP, res[item] || 0)) * (ITEMS[item].price || 0);
  }
  return v;
}

// "Sell extras" (only offered once the store is ≥ 90% full, where the HUD shows the button)
function sellStep(g, ui, id, minValue = 1) {
  if (g.storageUsed(id) < FULL_SHARE * g.storageCap(id)) return null;
  if (sellExtrasValue(g, id) < Math.max(1, minValue)) return null;
  return viaPanel(g, ui, `sell:${id}`, { panel: 'barn', tabKey: 'storage', tab: id, opener: 'btn:barn', target: `storage:sellExtras:${id}` },
    { icon: STORAGE[id].icon, label: 'Sell extras', storage: id });
}

function upgradeStep(g, ui, id) {
  return viaPanel(g, ui, `upgrade:${id}`, { panel: 'barn', tabKey: 'storage', tab: id, opener: 'btn:barn', target: `storage:upgrade:${id}` },
    { icon: '⬆️', label: `Upgrade ${STORAGE[id].name}`, storage: id });
}

// Storage rule: the next harvest / collect of `item` wouldn't fit — make room first.
function makeRoom(g, ui, item) {
  const id = g.storageOf(item);
  return sellStep(g, ui, id)
    || deliverStep(g, ui, { from: id })
    || serveStep(g, ui, { from: id })
    || (!storageBlock(g, id) && g.nextStorageUpgrade(id) ? upgradeStep(g, ui, id) : null);
}

function harvestStep(g, ui, patch, extra = {}) {
  const crop = patch.group;
  if (g.spaceFor(crop) < CROPS[crop].yield) return makeRoom(g, ui, crop);
  const tiles = patch.tiles.slice(0, TUTORIAL.patchMax);
  return reach(ui, worldStep(`harvest:${crop}`, { world: 'tiles', tiles }, {
    action: 'harvest', crop, gesture: g.s.settings?.tapHarvest === false ? 'swipe' : 'tap', icon: ITEMS[crop].icon, label: 'Harvest', ...extra,
  }));
}

function treeStep(g, ui, o) {
  const def = OBJECTS[o.type];
  if (g.spaceFor(def.fruit) < def.yield) return makeRoom(g, ui, def.fruit);
  return reach(ui, uiStep(`fruit:${o.type}`, `bubble:o${o.id}`, { object: o.id, icon: ITEMS[def.fruit].icon, label: 'Pick fruit' }));
}

const crops = (g) => Object.keys(CROPS).filter((c) => g.isUnlocked('crops', c));

// the patch tiles a tap on the first one plants: BFS order, at most cap and what coins allow
function plantStep(g, ui, crop, patch, cap, extra = {}) {
  const c = CROPS[crop];
  const afford = Math.floor(g.s.coins / c.seedCost);
  const tiles = patch.tiles.slice(0, Math.max(1, Math.min(cap, afford)));
  const popup = crops(g).length > 1;
  const base = { action: 'plant', crop, cap, icon: ITEMS[crop].icon, label: `Plant ${c.name.toLowerCase()}`, ...extra };
  const pop = ui.popover;
  if (pop && g.soilAt(pop.x, pop.z) && !g.soilAt(pop.x, pop.z).crop) return uiStep(`plant:${crop}:seed`, `seed:${crop}`, { ...base, chain: [`seed:${crop}`] });
  return reach(ui, worldStep(`plant:${crop}`, { world: 'tiles', tiles }, popup ? { ...base, chain: [`seed:${crop}`] } : base));
}

// The tiles a plow step suggests: Mabel's ghost plots for the guided plow goal, else the neatest spots.
// anywhere (the plow goal): a field fenced in on every side still gets a spot, a new patch near the farm core.
function ghostTiles(g, n, anywhere = false) {
  const q = g.currentQuest();
  if (guided(g) && q.id === 'plow') {
    const free = (x, z) => g.inLand(x, z) && !g.objectAt(x, z) && !g.soilAt(x, z);
    const tiles = TUTORIAL.plowSuggest.map(tutorialTile).filter(([x, z]) => free(x, z)).slice(0, n);
    if (tiles.length >= Math.min(n, g.plotCap() - g.plotCount())) return tiles;
  }
  return g.suggestPlowSpots(n, { anywhere });
}

function plowStep(g, ui, n = 2, extra = {}, anywhere = false) {
  if (g.plotCount() >= g.plotCap()) return blocked(g, ui, levelBlock(g, g.s.level + 1), 'plow', extra);
  const cost = g.plowCost();
  if (g.s.coins < cost) return blocked(g, ui, coinsBlock(g, cost), 'plow', extra);
  const tiles = ghostTiles(g, Math.max(1, n), anywhere);
  if (!tiles.length) return null;
  const base = { action: 'plow', icon: '🚜', label: 'Plow a field', ghostPlots: tiles, ...extra };
  if (ui.tool !== 'plow') return reach(ui, uiStep('plow:tool', 'tool:plow', { ...base, chain: ['tool:plow'] }));
  return reach(ui, worldStep('plow:tiles', { world: 'ghostPlots', tiles }, { ...base, gesture: tiles.length > 1 && !guided(g) ? 'swipe' : 'tap' }));
}

function animalBubble(g, a) { return ANIMALS[a.type].flying ? `bubble:o${a.home}` : `bubble:a${a.id}`; }

function tendStep(g, ui, a, what) {
  const def = ANIMALS[a.type];
  const p = ui.panel;
  const icon = what === 'collect' ? ITEMS[def.product].icon : ITEMS[g.animalFood(a.type)?.item]?.icon || def.icon;
  const extra = { object: a.home, animal: a.id, icon, label: what === 'collect' ? 'Collect' : `Feed the ${def.plural || def.name.toLowerCase() + 's'}` };
  if (p && p.id === 'pen' && p.ref === a.home) return uiStep(`${what}:${a.type}:tend`, 'pen:tend', { ...extra, chain: ['pen:tend'] });
  return reach(ui, uiStep(`${what}:${a.type}`, animalBubble(g, a), extra));
}

function collectAnimalStep(g, ui, a) {
  const product = ANIMALS[a.type].product;
  if (g.spaceFor(product) < 1) return makeRoom(g, ui, product);
  return tendStep(g, ui, a, 'collect');
}

const factoryOpen = (ui, o) => ui.panel && ui.panel.id === 'factory' && ui.panel.ref === o.id;

function collectFactoryStep(g, ui, o) {
  const done = g.factoryQueue(o).filter((j) => j.done);
  const item = done[0].recipe;
  if (g.spaceFor(item) < 1) return makeRoom(g, ui, item);
  const extra = { object: o.id, icon: ITEMS[item].icon, label: 'Collect', recipe: item };
  if (factoryOpen(ui, o)) return uiStep(`collect:${o.type}:panel`, 'factory:collect', { ...extra, chain: ['factory:collect'] });
  return reach(ui, uiStep(`collect:${o.type}`, `bubble:o${o.id}`, extra));
}

function makeStep(g, ui, o, recipe, extra = {}) {
  return viaPanel(g, ui, `make:${recipe}`, { panel: 'factory', ref: o.id, opener: `bubble:o${o.id}`, target: `factory:make:${recipe}` },
    { object: o.id, recipe, icon: ITEMS[recipe].icon, label: `Make ${ITEMS[recipe].name.toLowerCase()}`, ...extra });
}

function finishStep(g, ui, o, job) {
  return viaPanel(g, ui, `make:${job.recipe}:finish`, { panel: 'factory', ref: o.id, opener: `bubble:o${o.id}`, target: 'factory:finish' },
    { object: o.id, recipe: job.recipe, free: true, icon: ITEMS[job.recipe].icon, label: 'Finish now · Free!', wait: { until: job.endAt, icon: ITEMS[job.recipe].icon, label: ITEMS[job.recipe].name } });
}

function deliverChain(g, ui, order, extra = {}) {
  const board = g.s.objects.find((o) => o.type === 'orderboard');
  const tab = g.s.level >= WAGON.level ? 'orders' : null;
  return viaPanel(g, ui, `order:${order.id}`, { panel: 'orders', tab, opener: board ? `bubble:o${board.id}` : 'btn:orders', target: `order:deliver:${order.id}` },
    { order: order.id, object: board?.id, fallback: 'btn:orders', icon: '🚚', label: 'Deliver an order', ...extra });
}

function serveChain(g, ui, v, extra = {}) {
  return viaPanel(g, ui, `visitor:${v.id}`, { panel: 'visitor', ref: v.id, opener: `bubble:v${v.id}`, target: 'visitor:sell' },
    { visitor: v.id, icon: ITEMS[v.item].icon, label: 'Serve a visitor', ...extra });
}

// ---------------------------------------------------------------- candidate actions (null when n/a)
// The Post (§2.8): a parcel is waiting → 📬 → Open → Lovely. In the tour only parcel #1 (Mabel's line); never during a
// hard beat, graduation or a placement. The player always opens it: it is never queued or popped up by itself.
function postStep(g, ui) {
  const st = g.postStatus();
  if (!st.ready || hardBeat(g) || graduationPending(g) || ui.placing) return null;
  const gd = guided(g);
  if (gd && st.n !== 0) return null;
  return reach(ui, uiStep('post', 'btn:post', { chain: ['btn:post', 'modal:post:open'], icon: '📬', label: 'Open your parcel', stepKey: gd ? 'post1' : null }));
}
// a waiting parcel with coin value (pantry, Big, #5, the office parcel): earn() may send you to open it
const postPays = (g) => { const c = g.postContents(); return c.coins > 0 || Object.keys(c.items).length > 0; };
const postCoinsStep = (g, ui) => (postPays(g) ? postStep(g, ui) : null);

// where the Mailbox goes up: by the road, next to the order board (else the field's middle)
export function mailboxNear(game) {
  const board = game.s.objects.find((o) => o.type === 'orderboard');
  return board ? [board.x, board.z] : fieldCentre(game);
}

function choreStep(g, ui) {
  if (guided(g) || !g.s.chores) return null; // chores are introduced at graduation
  const i = g.s.chores.list.findIndex((c) => !c.claimed && c.progress >= c.count);
  if (i < 0) return null;
  return viaPanel(g, ui, `chore:${i}`, { panel: 'today', opener: 'btn:today', target: `today:chore:${i}` }, { icon: '✅', label: 'Claim a chore' });
}

// a fillable order you can spare the items for (from: only orders that free room in that store)
function deliverStep(g, ui, { from = null } = {}) {
  for (const o of openOrders(g)) {
    if (from && !Object.keys(o.items).some((i) => g.storageOf(i) === from)) continue;
    if (spare(g, o.items, reserves(g, { skip: o }))) return deliverChain(g, ui, o);
  }
  return null;
}

function serveStep(g, ui, { from = null } = {}) {
  if (g.s.level < VISITORS.level) return null;
  for (const v of g.s.visitors || []) {
    if (from && g.storageOf(v.item) !== from) continue;
    if (spare(g, { [v.item]: v.qty }, reserves(g, { skip: visitorWants(v) }))) return serveChain(g, ui, v);
  }
  return null;
}

function collectStep(g, ui) {
  const now = g.now();
  for (const a of g.s.animals) {
    const s = g.animalState(a, now) === 'ready' && collectAnimalStep(g, ui, a);
    if (s) return s;
  }
  for (const o of objectsOf(g, 'factory')) {
    const s = g.factoryQueue(o, now).some((j) => j.done) && collectFactoryStep(g, ui, o);
    if (s) return s;
  }
  return null;
}

function feedStep(g, ui, type = null) {
  for (const a of g.s.animals) {
    if ((type && a.type !== type) || g.animalState(a) !== 'hungry' || !ANIMALS[a.type].food) continue;
    const f = g.animalFood(a.type);
    if (g.count(f.item) >= f.qty) return tendStep(g, ui, a, 'feed');
  }
  return null;
}

function harvestAny(g, ui) {
  const p = ripePatches(g)[0];
  if (p && g.spaceFor(p.group) >= CROPS[p.group].yield) return harvestStep(g, ui, p);
  const t = g.s.objects.find((o) => OBJECTS[o.type].kind === 'tree' && g.treeState(o) === 'ready' && g.spaceFor(OBJECTS[o.type].fruit) >= OBJECTS[o.type].yield);
  if (t) return treeStep(g, ui, t);
  return p ? harvestStep(g, ui, p) : null; // a ripe patch that doesn't fit: make room
}

// crops worth planting now, best first (goal crop, goal-recipe crops, order crops, animal food, XP/min)
function cropChoices(g) {
  const ok = (c) => CROPS[c] && g.isUnlocked('crops', c) && g.s.coins >= CROPS[c].seedCost;
  const out = [];
  const add = (c, tag) => { if (ok(c) && !out.some((x) => x.type === c)) out.push({ type: c, tag }); };
  const q = g.currentQuest();
  // feed for the animals a goal depends on (milk for butter → corn), when it runs short of two rounds
  const feedOf = (product) => {
    const a = animalFor(product);
    const herd = a ? g.s.animals.filter((x) => x.type === a).length : 0;
    const f = herd && g.animalFood(a);
    if (f && CROPS[f.item] && g.count(f.item) + growingYield(g, f.item) < f.qty * herd * 2) add(f.item, 'goal');
  };
  if (!g.questDone()) {
    if ((q.event === 'plant' || q.event === 'harvest') && q.filter) add(q.filter, 'goal');
    if (q.event === 'produce' && RECIPES[q.filter]) {
      for (const i of Object.keys(RECIPES[q.filter].inputs)) if (g.count(i) < RECIPES[q.filter].inputs[i] * 2) { add(i, 'goal'); feedOf(i); }
    }
    if (q.event === 'collect' && q.filter) feedOf(q.filter);
  }
  // feed below one round for the herd comes before order crops
  const feed = {};
  for (const a of g.s.animals) { const f = g.animalFood(a.type); if (f && CROPS[f.item]) feed[f.item] = (feed[f.item] || 0) + f.qty; }
  for (const [c, n] of Object.entries(feed)) if (g.count(c) + growingYield(g, c) < n) add(c, 'food');
  // crops open orders and visitors want and we're short of (counting what's growing)
  const res = reserves(g);
  const want = {};
  for (const o of [...openOrders(g), ...(g.s.visitors || []).map(visitorWants)]) {
    for (const [i, n] of Object.entries(o.items)) if (CROPS[i]) want[i] = (want[i] || 0) + n;
  }
  const short = Object.keys(want).filter((c) => want[c] + (res[c] || 0) > g.count(c) + growingYield(g, c)).sort((a, b) => CROPS[a].growTime - CROPS[b].growTime);
  for (const c of short) add(c, 'order');
  // animal food when there's less than two rounds' worth
  for (const [c, n] of Object.entries(feed)) if (g.count(c) + growingYield(g, c) < n * 2) add(c, 'food');
  // otherwise the best XP per minute (ties: more coins)
  const rest = crops(g).sort((a, b) => CROPS[b].xp / CROPS[b].growTime - CROPS[a].xp / CROPS[a].growTime
    || (ITEMS[b].price * CROPS[b].yield - CROPS[b].seedCost) - (ITEMS[a].price * CROPS[a].yield - CROPS[a].seedCost));
  for (const c of rest) add(c, null);
  return out;
}

function plantIdle(g, ui) {
  const patch = emptyPatches(g)[0];
  const pick = patch && cropChoices(g)[0];
  if (!pick) return null;
  return plantStep(g, ui, pick.type, patch, plantCap(g, pick.type));
}

// an idle slot cooking something the goal or an order/visitor needs (or a head start on the next
// scripted goal's recipe), with inputs left after reserves
function makeIdle(g, ui) {
  const q = g.currentQuest();
  const wanted = new Set();
  if (!g.questDone() && q.event === 'produce' && q.filter) wanted.add(q.filter);
  for (const o of [...openOrders(g), ...(g.s.visitors || []).map(visitorWants)]) {
    for (const [i, n] of Object.entries(o.items)) if (RECIPES[i] && g.count(i) < n) wanted.add(i);
  }
  const next = QUESTS[g.s.quest.index + 1];
  if (next && next.event === 'produce' && RECIPES[next.filter]) wanted.add(next.filter);
  const res = reserves(g);
  for (const o of objectsOf(g, 'factory')) {
    if (o.jobs.length >= g.queueSize(o)) continue;
    for (const r of wanted) {
      if (RECIPES[r].building !== o.type || !g.isUnlocked('recipes', r)) continue;
      // the produce goal's own inputs are reserved for it, so they don't count against it
      const goal = q.event === 'produce' && r === q.filter;
      const inputsRes = goal ? baseReserves(g) : res;
      if (goal) for (const [i, n] of Object.entries(RECIPES[r].inputs)) inputsRes[i] = Math.max(0, (inputsRes[i] || 0) - n);
      if (spare(g, RECIPES[r].inputs, inputsRes)) return makeStep(g, ui, o, r);
    }
  }
  return null;
}

function debrisStep(g, ui) {
  const list = g.debris();
  if (!list.length) return null;
  const [cx, cz] = farmCore(g);
  const o = list.slice().sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz) || a.z - b.z || a.x - b.x)[0];
  const def = OBJECTS[o.type];
  return reach(ui, worldStep(`debris:${o.id}`, { world: 'object', id: o.id }, { action: 'clear', object: o.id, icon: def.icon, label: 'Tidy up' }));
}

// the coins the current goal is about to spend (0 when it isn't a purchase)
function purchaseCost(g) {
  const q = g.currentQuest();
  if (g.questDone()) return 0;
  if (q.event === 'build' && OBJECTS[q.filter]) return g.objectCost(q.filter);
  if (q.event === 'buyAnimal' && ANIMALS[q.filter]) return g.findHomeFor(q.filter) ? g.animalCost(q.filter) : g.objectCost(ANIMALS[q.filter].home);
  if (q.event === 'expand') return g.nextExpansion()?.coins || 0;
  if (q.event === 'storage') return g.nextStorageUpgrade(storageId(g, q))?.coins || 0;
  return 0;
}
const saving = (g) => g.s.coins < purchaseCost(g);

// an extra field or two, only while nothing is being saved for and PLOW_SPARE coins stay over afterwards
function plowIdle(g, ui, saveFor = 0) {
  if (guided(g) || g.plotCount() >= g.plotCap()) return null;
  const budget = g.s.coins - PLOW_SPARE - Math.max(purchaseCost(g), saveFor);
  let n = 0, cost = 0;
  while (n < 2 && g.plotCount() + n < g.plotCap() && cost + PLOTS.cost(g.plotCount() + n) <= budget) cost += PLOTS.cost(g.plotCount() + n++);
  return n ? plowStep(g, ui, n) : null;
}

// all running timers: { until, icon }
function timers(g) {
  const now = g.now(), out = [];
  for (const { soil } of soils(g)) if (soil.crop && g.cropReadyAt(soil.crop) > now) out.push({ until: g.cropReadyAt(soil.crop), icon: ITEMS[soil.crop.type].icon });
  for (const a of g.s.animals) if (g.animalState(a, now) === 'producing') out.push({ until: a.readyAt, icon: ITEMS[ANIMALS[a.type].product].icon });
  for (const o of g.s.objects) {
    const kind = OBJECTS[o.type]?.kind;
    if (kind === 'factory') { const j = o.jobs.find((x) => x.endAt > now); if (j) out.push({ until: j.endAt, icon: ITEMS[j.recipe].icon }); }
    if (kind === 'tree') { const st = g.treeState(o, now); if (st === 'growing' || st === 'fruiting') out.push({ until: g.treeReadyAt(o), icon: ITEMS[OBJECTS[o.type].fruit].icon }); }
  }
  for (const o of g.s.orders) if (o.waitUntil > now) out.push({ until: o.waitUntil, icon: '🚚' });
  if (g.s.level >= VISITORS.level && (g.s.visitors || []).length < VISITORS.max(g.s.level) && g.s.nextVisitorAt > now) out.push({ until: g.s.nextVisitorAt, icon: '👋' });
  return out.sort((a, b) => a.until - b.until);
}

// "Everything's busy! Next: 🥚 0:42" — the step is never blank. With no timer running at all it says so and
// promises no time (a wait without until: GuideFollower counts it as a dead end).
function busyStep(g) {
  const now = g.now();
  const t = timers(g)[0];
  if (!t) return waitStep('busy', null, '⏳', 'Nothing growing', { stepKey: 'busy', say: TUTORIAL.lines.busyIdle });
  return waitStep('busy', t.until, t.icon, 'Everything\'s busy!', { stepKey: 'busy', say: fill(TUTORIAL.lines.busy, { icon: t.icon, time: clock(t.until - now) }) });
}

// The last way to coins when nothing grows, works or comes by itself: sell one spare item at a time
// (📦 → its tab → the item → Sell 1). Spare: above the reserves; the one you hold most of (ties: the cheaper).
function sellFewStep(g, ui) {
  if (timers(g).length) return null;
  const res = reserves(g);
  let best = null;
  for (const [item, n] of Object.entries(g.s.inventory)) {
    const id = g.storageOf(item), price = ITEMS[item]?.price || 0, extra = n - (res[item] || 0);
    if (!id || !price || extra < 1) continue;
    if (!best || extra > best.extra || (extra === best.extra && price < best.price)) best = { item, id, extra, price };
  }
  if (!best) return null;
  const { item, id } = best;
  // the Sell button shows once the item is picked: until then the finger falls back to the item's card
  return viaPanel(g, ui, `sellFew:${item}`, { panel: 'barn', tabKey: 'storage', tab: id, opener: 'btn:barn', target: `storage:sell:${item}` },
    { chain: ['btn:barn', `storage:tab:${id}`, `storage:item:${item}`, `storage:sell:${item}`], stepKey: 'sellFew', storage: id, item, icon: ITEMS[item].icon, label: 'Sell a spare' });
}

// ---------------------------------------------------------------- earn (§2.3) and Meanwhile (§2.4)
// The best way to make n more coins (or XP with { xp: true }, where planting ranks higher).
export function earn(game, ui = {}, n = 0, { xp = false } = {}) {
  const g = game;
  ui = normUi(ui);
  const tries = xp
    ? [choreStep, collectStep, harvestAny, plantIdle, deliverStep, serveStep, feedStep, makeIdle, debrisStep, plowIdle]
    : [choreStep, postCoinsStep, deliverStep, serveStep, collectStep, harvestAny, (gg, u) => sellStep(gg, u, 'silo', Math.min(n, 20)) || sellStep(gg, u, 'barn', Math.min(n, 20)),
      plantIdle, feedStep, makeIdle, debrisStep, sellFewStep];
  for (const f of tries) {
    const s = f(g, ui);
    if (s) return { ...s, why: 'quest' };
  }
  return busyStep(g);
}

// What to do while the goal waits. Never blank: the last resort is the "Everything's busy!" wait.
// opts.saveFor: coins the goal is saving up for (a coin-blocked step), so nothing spends into them.
export function recommendIdle(game, ui = {}, { saveFor = 0 } = {}) {
  const g = game;
  ui = normUi(ui);
  const gd = guided(g);
  // the tour's parcel #1 comes first (it is what Mabel talks about); coached: chores, then a waiting parcel
  const tries = [
    gd ? postStep : choreStep,
    gd ? null : postStep,
    collectStep,
    (gg, u) => feedStep(gg, u),
    harvestAny,
    !gd || saving(g) || saveFor > g.s.coins ? deliverStep : null,
    makeIdle,
    plantIdle,
    debrisStep,
    gd ? null : (gg, u) => plowIdle(gg, u, saveFor),
  ];
  for (const f of tries) {
    const s = f && f(g, ui);
    if (s) return { ...s, why: 'meanwhile' };
  }
  return { ...busyStep(g), why: 'meanwhile' };
}

// ---------------------------------------------------------------- need(item) (§2.7)
// Where an item comes from, as a step. qty: how many are still missing (so growing crops can count).
export function need(game, ui = {}, item, depth = 0, qty = 0) {
  const g = game;
  ui = normUi(ui);
  const it = ITEMS[item];
  if (!it) return null;
  if (it.cat === 'material') {
    return mk(`need:${item}`, 'none', null, { icon: it.icon, label: `${it.name}s drop while you farm`, pointer: false, item });
  }
  if (CROPS[item]) return needCrop(g, ui, item, qty);
  const tree = treeFor(item);
  if (tree) return needFruit(g, ui, item, tree);
  const animal = animalFor(item);
  if (animal) return needAnimal(g, ui, animal, depth);
  if (RECIPES[item]) return needGoods(g, ui, item, depth, false, qty);
  return null;
}

function needCrop(g, ui, crop, qty = 0) {
  if (!g.isUnlocked('crops', crop)) return blocked(g, ui, levelBlock(g, CROPS[crop].level), `need:${crop}`);
  const ripe = ripePatches(g, crop)[0];
  const h = ripe && harvestStep(g, ui, ripe);
  if (h) return h;
  const grow = growing(g, crop);
  if (grow && qty && growingYield(g, crop) >= qty) return waitStep(`need:${crop}:wait`, grow.until, ITEMS[crop].icon, CROPS[crop].name);
  return plantCrop(g, ui, crop, plantCap(g, crop), grow);
}

// plant `crop` on the biggest empty patch; no empty soil → free some (ripe crops) or plow; else wait
function plantCrop(g, ui, crop, cap, grow = null) {
  const c = CROPS[crop];
  const patch = emptyPatches(g)[0];
  if (patch) {
    if (g.s.coins < c.seedCost) return blocked(g, ui, coinsBlock(g, c.seedCost), `plant:${crop}`);
    return plantStep(g, ui, crop, patch, cap);
  }
  const ripe = harvestAny(g, ui);
  if (ripe) return ripe;
  const plow = g.plotCount() < g.plotCap() && g.s.coins >= g.plowCost() + c.seedCost && plowStep(g, ui, Math.min(2, Math.max(1, cap)));
  if (plow) return plow;
  const next = grow || growing(g);
  if (next) return waitStep(`plant:${crop}:wait`, next.until, ITEMS[next.crop].icon, 'Soil frees up');
  return busyStep(g);
}

function needFruit(g, ui, fruit, tree) {
  const def = OBJECTS[tree];
  const trees = g.s.objects.filter((o) => o.type === tree);
  const ready = trees.find((o) => g.treeState(o) === 'ready');
  const pick = ready && treeStep(g, ui, ready);
  if (pick) return pick;
  const alive = trees.filter((o) => g.treeState(o) !== 'dead').sort((a, b) => g.treeReadyAt(a) - g.treeReadyAt(b));
  if (alive.length) return waitStep(`need:${fruit}:wait`, g.treeReadyAt(alive[0]), ITEMS[fruit].icon, def.name);
  return buildStep(g, ui, tree);
}

function needAnimal(g, ui, type, depth) {
  const def = ANIMALS[type];
  if (!g.isUnlocked('animals', type)) return blocked(g, ui, levelBlock(g, def.level), `need:${def.product}`);
  const now = g.now();
  const list = g.s.animals.filter((a) => a.type === type);
  if (!list.length) return buyAnimalStep(g, ui, type);
  const ready = list.find((a) => g.animalState(a, now) === 'ready');
  const got = ready && collectAnimalStep(g, ui, ready);
  if (got) return got;
  const fed = feedStep(g, ui, type);
  if (fed) return fed;
  const hungry = list.find((a) => g.animalState(a, now) === 'hungry');
  if (hungry && depth < MAX_DEPTH) {
    const f = g.animalFood(type);
    const s = need(g, ui, f.item, depth + 1, f.qty);
    if (s && s.kind !== 'wait' && s.kind !== 'none') return s;
  }
  const producing = list.filter((a) => g.animalState(a, now) === 'producing').sort((a, b) => a.readyAt - b.readyAt)[0];
  if (producing) return waitStep(`need:${def.product}:wait`, producing.readyAt, ITEMS[def.product].icon, `${def.name} ${ITEMS[def.product].name.toLowerCase()}`, { object: producing.home });
  if (hungry) { const f = g.animalFood(type); return need(g, ui, f.item, depth + 1, f.qty) || busyStep(g); }
  return busyStep(g);
}

// goods: collect → make → recurse into missing inputs (depth ≤ 3); goal: the produce goal's own recipe
function needGoods(g, ui, item, depth, goal = false, qty = 0) {
  const r = RECIPES[item];
  if (!g.isUnlocked('recipes', item)) return blocked(g, ui, levelBlock(g, Math.max(r.level || 0, OBJECTS[r.building].level)), `make:${item}`);
  const o = g.s.objects.find((x) => x.type === r.building);
  if (!o) return buildStep(g, ui, r.building);
  const q = g.factoryQueue(o);
  const got = q.some((j) => j.done && j.recipe === item) && collectFactoryStep(g, ui, o);
  if (got) return got;
  const now = g.now();
  const active = o.jobs.find((j) => j.endAt > now);
  const run = q.find((j) => !j.done && j.recipe === item);
  const runWait = run && waitStep(`make:${item}:wait`, run.endAt, ITEMS[item].icon, ITEMS[item].name, { object: o.id });
  if (run && active && active.recipe === item && goal && g.freeFinishAvailable(o)) return finishStep(g, ui, o, active);
  // qty: how many are still wanted; queued jobs of this recipe count toward it
  if (run && (!qty || q.filter((j) => !j.done && j.recipe === item).length >= qty)) return runWait;
  const free = q.some((j) => j.done) && collectFactoryStep(g, ui, o); // collecting frees a slot
  if (free) return free;
  if (o.jobs.length < g.queueSize(o)) {
    // the goal's own inputs are reserved for it; animal food and order targets still count
    const res = goal ? baseReserves(g) : reserves(g);
    if (goal) for (const [i, n] of Object.entries(r.inputs)) res[i] = Math.max(0, (res[i] || 0) - n);
    if (spare(g, r.inputs, res)) return makeStep(g, ui, o, item);
    if (depth < MAX_DEPTH) {
      const [miss, n] = shortOf(g, r.inputs, res).sort((a, b) => (ITEMS[a[0]].price || 0) * a[1] - (ITEMS[b[0]].price || 0) * b[1])[0];
      const s = need(g, ui, miss, depth + 1, n);
      if (s && (!runWait || s.kind === 'ui' || s.kind === 'world')) return s;
    }
  }
  if (runWait) return runWait;
  const first = q.find((j) => !j.done);
  if (first) return waitStep(`make:${item}:queue`, first.endAt, ITEMS[first.recipe].icon, ITEMS[first.recipe].name, { object: o.id });
  return busyStep(g);
}

// ---------------------------------------------------------------- composite steps
function buildStep(g, ui, type, key = `build:${type}`) {
  const def = OBJECTS[type];
  const b = buildBlock(g, type);
  if (b) return blocked(g, ui, b, key);
  if (!g.findFreeSpot(type, 0)) return roomStep(g, ui, type, key);
  const tab = def.kind === 'tree' ? 'trees' : def.kind === 'decor' ? 'decor' : 'buildings';
  return viaPanel(g, ui, key, { panel: 'shop', tab, opener: 'btn:shop', target: `shop:buy:${type}`, after: ['place:ok'] },
    { build: type, icon: def.icon, label: `Build ${def.name}` });
}

function buyAnimalStep(g, ui, type, key = `buy:${type}`) {
  const a = ANIMALS[type];
  if (!g.isUnlocked('animals', type)) return blocked(g, ui, levelBlock(g, a.level), key);
  const homes = g.s.objects.filter((o) => o.type === a.home);
  if (!g.findHomeFor(type)) return buildStep(g, ui, a.home, `${key}:home`);
  const cost = g.animalCost(type);
  if (g.s.coins < cost) return blocked(g, ui, coinsBlock(g, cost), key);
  const extra = { animalType: type, icon: a.icon, label: `Buy a ${a.name.toLowerCase()}` };
  const p = ui.panel;
  const roomy = (id) => g.animalsIn(id).length < g.homeCapacity(g.objById.get(id));
  if (p && p.id === 'pen' && homes.some((o) => o.id === p.ref) && roomy(p.ref)) return uiStep(`${key}:pen`, 'pen:buy', { ...extra, chain: ['pen:buy'] });
  const empty = homes.find((o) => !g.animalsIn(o.id).length);
  if (empty) return viaPanel(g, ui, key, { panel: 'pen', ref: empty.id, opener: `bubble:o${empty.id}`, target: 'pen:buy' }, { ...extra, object: empty.id });
  return viaPanel(g, ui, key, { panel: 'shop', tab: 'animals', opener: 'btn:shop', target: `shop:animal:${type}` }, extra);
}

// ---------------------------------------------------------------- room to build
// Fields, buildings and the starter debris can leave no spot a big footprint (a 5×5 pasture) fits.
// The cheapest footprint to free up: debris first, then empty fields, then planted ones; nearest
// the farm core on ties. → { debris: [id…], soil: [[x, z]…] }, or null when only more land helps.
function roomToFree(g, type) {
  const [w, d] = g.objSize(type, 0);
  const lo = g.landLo(), hi = g.landHi();
  const [cx, cz] = farmCore(g);
  let best = null;
  for (let z = lo; z + d - 1 <= hi; z++) {
    for (let x = lo; x + w - 1 <= hi; x++) {
      const debris = new Set(), soil = [];
      let cost = 0, ok = true;
      for (let i = 0; i < w && ok; i++) {
        for (let j = 0; j < d && ok; j++) {
          const o = g.objectAt(x + i, z + j), field = g.soilAt(x + i, z + j);
          if (o && OBJECTS[o.type].kind !== 'debris') ok = false;
          else if (o) { if (!debris.has(o.id)) cost += 1; debris.add(o.id); } else if (field) { soil.push([x + i, z + j]); cost += field.crop ? 6 : 3; }
        }
      }
      if (!ok) continue;
      const score = cost * 1000 + Math.hypot(x + (w - 1) / 2 - cx, z + (d - 1) / 2 - cz);
      if (!best || score < best.score) best = { score, debris: [...debris], soil };
    }
  }
  return best;
}

// No room for `type`: clear the debris in the way, else the fields (Clear tool), else more land.
function roomStep(g, ui, type, key) {
  const def = OBJECTS[type];
  const free = roomToFree(g, type);
  const extra = { build: type, icon: def.icon, label: `Make room for the ${def.name}` };
  if (free && free.debris.length) {
    const id = free.debris[0];
    return reach(ui, worldStep(`${key}:room:${id}`, { world: 'object', id }, { ...extra, action: 'clear', object: id }));
  }
  if (free && free.soil.length) {
    const clear = worldStep(`${key}:room:clear`, { world: 'tiles', tiles: free.soil }, { ...extra, action: 'clearSoil', gesture: free.soil.length > 1 ? 'swipe' : 'tap' });
    if (ui.panel) return reach(ui, clear);
    return ui.tool === 'remove' ? clear : uiStep(`${key}:room:tool`, 'tool:remove', { ...extra, chain: ['tool:remove'] });
  }
  const s = expandPlanner(g, ui);
  return { ...s, key: `${key}:room:${s.key}` };
}

// ---------------------------------------------------------------- planners (one per quest event)
function harvestPlanner(g, ui, q) {
  const f = q.filter;
  const tree = f && treeFor(f);
  if (tree) return needFruit(g, ui, f, tree);
  const ripe = ripePatches(g, f)[0];
  const h = ripe && harvestStep(g, ui, ripe);
  if (h) return h;
  if (!f) { const t = g.s.objects.find((o) => OBJECTS[o.type].kind === 'tree' && g.treeState(o) === 'ready'); const s = t && treeStep(g, ui, t); if (s) return s; }
  const grow = growing(g, f);
  // keep planting while there's empty soil and the goal needs more than what's already growing
  const left = q.count - g.questProgress();
  const empty = emptyPatches(g).length > 0;
  if (grow && (!empty || (f && growingYield(g, f) >= left))) {
    return waitStep(`harvest:${f || 'any'}:wait`, grow.until, ITEMS[grow.crop].icon, `${CROPS[grow.crop].name} growing`);
  }
  const crop = f || cropChoices(g)[0]?.type || 'wheat';
  if (!g.isUnlocked('crops', crop)) return blocked(g, ui, levelBlock(g, CROPS[crop].level), `harvest:${crop}`);
  return plantCrop(g, ui, crop, TUTORIAL.patchMax, grow);
}

function plantPlanner(g, ui, q) {
  const crop = q.filter && CROPS[q.filter] ? q.filter : cropChoices(g)[0]?.type || 'wheat';
  if (!g.isUnlocked('crops', crop)) return blocked(g, ui, levelBlock(g, CROPS[crop].level), `plant:${crop}`);
  return plantCrop(g, ui, crop, plantCap(g, crop));
}

function plowPlanner(g, ui, q) {
  const n = Math.max(1, q.count - g.questProgress());
  return plowStep(g, ui, Math.min(n, 4), {}, true) || busyStep(g);
}

function orderPlanner(g, ui) {
  const d = deliverStep(g, ui);
  if (d) return d;
  const open = openOrders(g);
  if (!open.length) {
    const next = g.s.orders.filter((o) => o.waitUntil).sort((a, b) => a.waitUntil - b.waitUntil)[0];
    return next ? waitStep('order:wait', next.waitUntil, '🚚', 'New order') : busyStep(g);
  }
  // nothing to deliver yet: work on the order that's cheapest to finish
  const best = cheapestToFinish(g, open, {});
  const res = reserves(g, { skip: best });
  const miss = shortOf(g, best.items, res).sort((a, b) => (ITEMS[a[0]].price || 0) * a[1] - (ITEMS[b[0]].price || 0) * b[1]);
  for (const [item, n] of miss) {
    const s = need(g, ui, item, 0, n);
    if (s && s.kind !== 'none') return { ...s, key: `order:${s.key}`, order: best.id };
  }
  return busyStep(g);
}

function buildPlanner(g, ui, q) {
  return OBJECTS[q.filter] ? buildStep(g, ui, q.filter) : busyStep(g);
}

function buyAnimalPlanner(g, ui, q) {
  return ANIMALS[q.filter] ? buyAnimalStep(g, ui, q.filter) : busyStep(g);
}

function feedPlanner(g, ui, q) {
  const type = q.filter || g.s.animals[0]?.type;
  if (!type) return buyAnimalStep(g, ui, 'chicken');
  const fed = feedStep(g, ui, type);
  if (fed) return fed;
  const list = g.s.animals.filter((a) => a.type === type);
  const hungry = list.find((a) => g.animalState(a) === 'hungry');
  if (hungry) {
    const f = g.animalFood(type);
    return need(g, ui, f.item, 0, f.qty * list.filter((a) => g.animalState(a) === 'hungry').length) || busyStep(g);
  }
  return buyAnimalStep(g, ui, type);
}

function collectPlanner(g, ui, q) {
  const now = g.now();
  const types = q.filter ? [animalFor(q.filter)].filter(Boolean) : [...new Set(g.s.animals.map((a) => a.type))];
  if (!types.length) {
    const t = Object.keys(ANIMALS).find((x) => g.isUnlocked('animals', x)) || 'chicken';
    return buyAnimalStep(g, ui, t);
  }
  const list = g.s.animals.filter((a) => types.includes(a.type));
  for (const a of list) {
    const s = g.animalState(a, now) === 'ready' && collectAnimalStep(g, ui, a);
    if (s) return s;
  }
  for (const t of types) { const s = feedStep(g, ui, t); if (s) return s; }
  if (!list.length) return buyAnimalStep(g, ui, types[0]);
  const hungry = list.find((a) => g.animalState(a, now) === 'hungry');
  if (hungry) {
    const f = g.animalFood(hungry.type);
    const s = f && need(g, ui, f.item, 1, f.qty);
    if (s && s.kind !== 'wait' && s.kind !== 'none') return s;
  }
  const producing = list.filter((a) => g.animalState(a, now) === 'producing').sort((a, b) => a.readyAt - b.readyAt)[0];
  if (producing) {
    const p = ANIMALS[producing.type].product;
    return waitStep(`collect:${p}:wait`, producing.readyAt, ITEMS[p].icon, ITEMS[p].name, { object: producing.home });
  }
  return busyStep(g);
}

function producePlanner(g, ui, q) {
  if (q.filter && RECIPES[q.filter]) return needGoods(g, ui, q.filter, 0, true, Math.max(1, q.count - g.questProgress()));
  // any goods: collect, then the quickest recipe you can start, else wait / work on inputs
  const fac = objectsOf(g, 'factory');
  if (!fac.length) return buildStep(g, ui, 'bakery');
  for (const o of fac) {
    const s = g.factoryQueue(o).some((j) => j.done) && collectFactoryStep(g, ui, o);
    if (s) return s;
  }
  const res = reserves(g);
  const options = [];
  for (const o of fac) {
    if (o.jobs.length >= g.queueSize(o)) continue;
    for (const [id, r] of Object.entries(RECIPES)) if (r.building === o.type && g.isUnlocked('recipes', id)) options.push({ o, id, ok: spare(g, r.inputs, res) });
  }
  const can = options.filter((x) => x.ok).sort((a, b) => RECIPES[a.id].time - RECIPES[b.id].time || ITEMS[b.id].price - ITEMS[a.id].price)[0];
  if (can) return makeStep(g, ui, can.o, can.id);
  const running = fac.flatMap((o) => o.jobs.filter((j) => j.endAt > g.now()).map((j) => ({ o, j }))).sort((a, b) => a.j.endAt - b.j.endAt)[0];
  if (options.length) {
    const cheapest = options.sort((a, b) => RECIPES[a.id].time - RECIPES[b.id].time)[0];
    const s = needGoods(g, ui, cheapest.id, 0);
    if (s && s.kind !== 'wait') return s;
  }
  if (running) return waitStep(`make:any:wait`, running.j.endAt, ITEMS[running.j.recipe].icon, ITEMS[running.j.recipe].name, { object: running.o.id });
  return busyStep(g);
}

function expandPlanner(g, ui) {
  const b = expandBlock(g);
  if (b) return blocked(g, ui, b, 'expand');
  if (!g.nextExpansion()) return busyStep(g);
  return viaPanel(g, ui, 'expand', { panel: 'shop', tab: 'land', opener: 'btn:shop', target: 'shop:land:expand' }, { icon: '🗺️', label: 'Expand your land' });
}

function visitorPlanner(g, ui) {
  if (g.s.level < VISITORS.level) return blocked(g, ui, levelBlock(g, VISITORS.level), 'visitor');
  const vs = g.s.visitors || [];
  const ok = vs.find((v) => g.count(v.item) >= v.qty && spare(g, { [v.item]: v.qty }, reserves(g, { skip: visitorWants(v) })));
  if (ok) return serveChain(g, ui, ok);
  if (vs.length) {
    const best = cheapestToFinish(g, vs.map(visitorWants), baseReserves(g));
    const v = vs.find((x) => x.id === best.id);
    // nobody asks for anything the farm can make yet: the next villager is a better bet than a new building
    const room = vs.length < VISITORS.max(g.s.level) && g.s.nextVisitorAt > g.now();
    if (room && eta(g, v.item, v.qty - g.count(v.item)) >= NEVER / 10) return waitStep('visitor:wait', g.s.nextVisitorAt, '👋', 'Next visitor');
    const s = need(g, ui, v.item, 0, v.qty - g.count(v.item));
    if (s && s.kind !== 'none') return { ...s, key: `visitor:${s.key}`, visitor: v.id };
  }
  return waitStep('visitor:wait', g.s.nextVisitorAt, '👋', 'Next visitor');
}

function storagePlanner(g, ui, q) {
  const id = storageId(g, q);
  const b = storageBlock(g, id);
  if (b) return blocked(g, ui, b, `upgrade:${id}`);
  return g.nextStorageUpgrade(id) ? upgradeStep(g, ui, id) : busyStep(g);
}

function fruitPlanner(g, ui, q) {
  const tree = q.filter ? treeFor(q.filter) : 'appletree';
  const ready = g.s.objects.find((o) => OBJECTS[o.type].kind === 'tree' && (!q.filter || OBJECTS[o.type].fruit === q.filter) && g.treeState(o) === 'ready');
  const s = ready && treeStep(g, ui, ready);
  if (s) return s;
  return needFruit(g, ui, OBJECTS[tree].fruit, tree);
}

function cratePlanner(g, ui) {
  if (g.s.level < WAGON.level) return blocked(g, ui, levelBlock(g, WAGON.level), 'crate');
  const w = g.s.wagon;
  if (!w || w.state !== 'here') return waitStep('crate:wait', w?.returnsAt || g.now() + 60000, '🛒', 'Market Wagon');
  const open = w.crates.filter((c) => !c.filled);
  const fillable = open.find((c) => g.count(c.item) >= c.qty);
  if (fillable) return viaPanel(g, ui, 'crate', { panel: 'orders', tab: 'wagon', opener: 'btn:orders', target: null }, { icon: '🛒', label: 'Fill a crate', pointer: false });
  const c = open.sort((a, b) => (a.qty - g.count(a.item)) * ITEMS[a.item].price - (b.qty - g.count(b.item)) * ITEMS[b.item].price)[0];
  return (c && need(g, ui, c.item, 0, c.qty - g.count(c.item))) || busyStep(g);
}

// a chapter gift waiting in s.gifts: Shop → Decor → 🎁 → ✓
function giftPlanner(g, ui, type = (g.s.gifts || [])[0]) {
  if (!type || !OBJECTS[type]) return null;
  return viaPanel(g, ui, `gift:${type}`, { panel: 'shop', tab: 'decor', opener: 'btn:shop', target: `shop:gift:${type}`, after: ['place:ok'] },
    { gift: type, icon: '🎁', label: `Put up the ${OBJECTS[type].name}` });
}

export const PLANNERS = {
  harvest: harvestPlanner,
  plant: plantPlanner,
  plow: plowPlanner,
  order: orderPlanner,
  build: buildPlanner,
  buyAnimal: buyAnimalPlanner,
  feed: feedPlanner,
  collect: collectPlanner,
  produce: producePlanner,
  expand: expandPlanner,
  visitor: visitorPlanner,
  storage: storagePlanner,
  fruit: fruitPlanner,
  crate: cratePlanner,
  earn: (g, ui, q) => earn(g, ui, Math.max(0, q.count - g.questProgress())),
  level: (g, ui) => earn(g, ui, 0, { xp: true }),
  gift: (g, ui, q) => giftPlanner(g, ui, q?.filter) || busyStep(g),
};

// ---------------------------------------------------------------- tutorial pieces
// Seeds a guided plant goal may plant in one tap: the goal's remaining count (§1.2 #2), else 24.
export function plantCap(game, crop) {
  const q = game.currentQuest();
  if (guided(game) && q.event === 'plant' && q.filter === crop && !game.questDone()) return Math.max(1, q.count - game.questProgress());
  return TUTORIAL.patchMax;
}

// B1–B3 swallow input outside the spotlight (guided, after the welcome)
export function hardBeat(game) {
  if (!guided(game) || !game.hasSeen('welcome')) return false;
  const q = game.currentQuest();
  return q.id === 'harvest' || (q.id === 'plant' && !game.questDone());
}

export const fieldCentre = (game) => {
  const t = Object.keys(game.s.soil).map((k) => k.split(',').map(Number));
  return t.length ? [t.reduce((s, p) => s + p[0], 0) / t.length, t.reduce((s, p) => s + p[1], 0) / t.length] : farmCore(game);
};

// Where a new building's ghost starts (§3.3): its tutorial lot while you own none, else smartSpot.
export function placementSpot(game, type, near = null) {
  const lot = TUTORIAL.lots[type];
  if (lot && game.objectCount(type) === 0) {
    const [x, z] = tutorialTile(lot);
    if (game.canPlace(type, x, z, 0)) return { x, z, rot: 0, lot: true };
  }
  return game.smartSpot(type, 0, near);
}

// Graduation (B13) runs once Chapter 1 is claimed in guided mode. Progress lives in seen flags:
// grad:chest (chest opened), grad:gift (gift placed or the ghost cancelled), grad:daily (daily closed),
// grad:end (quest card tapped) — then the mode moves on to 'coached' (see nextMode).
export function graduationPending(game) {
  return guided(game) && game.chapterDone(1) && !game.hasSeen('grad:end');
}

export function graduationStep(game) {
  const g = game;
  const ch = CHAPTERS[0];
  const base = { why: 'modal', chapter: ch.id };
  if (!g.hasSeen('grad:chest')) return uiStep('grad:chest', 'modal:chest:open', { ...base, modal: 'chest', stepKey: 'grad', icon: '🎁', label: 'Open the chest' });
  const gift = ch.reward.gift;
  if (!g.hasSeen('grad:gift') && (g.s.gifts || []).includes(gift)) {
    return uiStep('grad:gift', 'place:ok', { ...base, startPlacement: { type: gift, gift: true, near: fieldCentre(g) }, stepKey: 'gradGift', icon: OBJECTS[gift].icon, label: `Put up the ${OBJECTS[gift].name}` });
  }
  if (!g.hasSeen('grad:daily') && g.dailyStatus().canClaim) return uiStep('grad:daily', 'modal:daily:claim', { ...base, modal: 'daily', stepKey: 'gradDaily', icon: '🎁', label: 'Daily gift' });
  // the goal card hands over to coached play: 🎁 🏆, 🧭 turn & tilt and the post pill appear with it
  return uiStep('grad:end', 'quest:card', { ...base, stepKey: 'gradEnd', reveal: ['today', 'trophy', 'camera', 'post'], icon: '📜', label: 'Your next goal' });
}

// guided → coached (graduation done) → independent (scripted list done or level 10). Never backwards.
export function nextMode(game) {
  const m = game.tutorialMode();
  if (m === 'independent') return m;
  if (game.s.quest.index >= QUESTS.length || game.s.level >= 10) return 'independent';
  if (m === 'guided' && game.hasSeen('grad:end')) return 'coached';
  return m;
}

// Chapter badge for the quest card: { chapter (the CHAPTERS entry), id, name, icon, done, total, last },
// or null for the endless goals. Also the shape hud.setQuestGuide takes for `chapter`.
export function chapterProgress(game) {
  const c = game.questChapter();
  return c ? { chapter: CHAPTERS.find((x) => x.id === c.id), ...c } : null;
}

// "Let's go! ▸" on the level-up button when the current goal opens at exactly this level (§2.6)
export function levelUpGo(game, level) {
  return !game.questDone() && questLevel(game.currentQuest()) === level;
}

// One-time tips about a feature rather than a level (§7.6), walked after FEATURE_TIPS. Each runs once, only
// outside the guided tour and with hints on, and the UI spaces them like the level tips (TIP_GAP).
//   key: its seen flag · text: string | (game, ctx) → string · when(game, ctx) → bool
//   onTap(guide): what tapping the toast-card does (guide = the GuideController: guide.hud, guide.ctrl, …)
// ctx is the UI's session state (GuideController.tipCtx), e.g. cameraTipDue: a pen or workshop was placed
// after graduation. Later features add their entries here.
const FARM_AGE_TIP = 30 * 60000;
//   marks: other tips this one stands in for (seen with it)
export const EXTRA_TIPS = [
  {
    // a farm from before v4: one card about everything new (it also stands in for tip:camera and tip:post2)
    key: 'tip:whatsNew',
    text: 'New: 📬 a parcel every 8 hours, 📖 a Keepsake Album, and 🧭 to turn and tilt your view!',
    when: (g) => g.hasSeen('whatsNew:pending'),
    marks: ['tip:camera', 'tip:post2'],
    onTap: (guide) => guide.hud.showPost?.(),
  },
  {
    // the first time parcel #2 is opened: the cadence, once
    key: 'tip:post2',
    text: 'Parcels come at 30 min, 1 h and 4 h — then one every 8 hours. They always wait! 📬',
    when: (g) => g.s.post.n >= 2 && g.s.post.n <= 5 && !g.s.post.office && !g.hasSeen('whatsNew:pending'),
    onTap: (guide) => guide.hud.openPostPop?.(),
  },
  {
    key: 'tip:camera',
    text: 'Tip: twist two fingers to turn your farm — or tap 🧭 to turn and tilt.',
    when: (g, ctx) => !!ctx.cameraTipDue || g.now() - (g.s.createdAt || 0) >= FARM_AGE_TIP,
    onTap: (guide) => { guide.hud.openCamPad?.(); guide.hud.pulseCamBtn?.(); },
  },
];

// The next one-time tip to show: a FEATURE_TIPS line ({ level, key, text }) first, then an EXTRA_TIPS entry
// ({ key, text, onTap, extra: true }); null when none is due (or hints are off).
export function pendingTip(game, ctx = {}) {
  if (game.s.settings?.hints === 'off') return null;
  for (let l = 1; l <= game.s.level; l++) if (FEATURE_TIPS[l] && !game.hasSeen('tip:' + l)) return { level: l, key: 'tip:' + l, text: FEATURE_TIPS[l] };
  if (guided(game)) return null;
  for (const t of EXTRA_TIPS) {
    if (game.hasSeen(t.key) || !t.when(game, ctx)) continue;
    return { key: t.key, text: typeof t.text === 'function' ? t.text(game, ctx) : t.text, onTap: t.onTap || null, marks: t.marks || [], extra: true };
  }
  return null;
}

// a pendingTip() result is being shown: it and the tips it stands in for are seen (false if it already was)
export function markTipSeen(game, tip) {
  if (!game.markSeen(tip.key)) return false;
  for (const k of tip.marks || []) game.markSeen(k);
  return true;
}

// Seed popover order (§3.2): goal crop ★ Goal, then Meanwhile/order crop ★ Order, then the last used,
// then newest unlock first. Returns [{ type, tag: 'goal'|'order'|null }] of every unlocked crop.
export function seedList(game, { last = null } = {}) {
  const out = [];
  const add = (type, tag = null) => { if (game.isUnlocked('crops', type) && !out.some((c) => c.type === type)) out.push({ type, tag }); };
  const choices = cropChoices(game);
  const goal = choices.find((c) => c.tag === 'goal');
  if (goal) add(goal.type, 'goal');
  const order = choices.find((c) => c.tag === 'order' || c.tag === 'food');
  if (order) add(order.type, 'order');
  if (last) add(last);
  for (const c of Object.keys(CROPS).sort((a, b) => CROPS[b].level - CROPS[a].level)) add(c);
  return out;
}

// ---------------------------------------------------------------- daily gift auto-popup (§6.7)
const dayNumber = (ms) => { const d = new Date(ms); return Math.floor((ms - d.getTimezoneOffset() * 60000) / DAY_MS); };

// Should the daily gift pop up by itself? Pass the save (or the Game). A new farm's gift waits for
// graduation (guided) or the first claim (coached at goal 0), at most 2 hours; then it's the usual rule.
export function shouldAutoShowDaily(s, now) {
  const game = s && typeof s.dailyStatus === 'function' ? s : null;
  const st = game ? game.s : s;
  const t = st?.tutorial || {};
  const age = now - (t.startedAt || 0);
  if (t.mode === 'guided' && age < AUTO_DAILY_MS) return false;
  if (t.mode === 'coached' && (st.quest?.index || 0) === 0 && age < AUTO_DAILY_MS) return false;
  if (game) return game.dailyStatus().canClaim;
  const d = st?.daily || {};
  return d.lastDay !== dayNumber(now) && (!d.lastAt || now - d.lastAt >= 16 * 3600000);
}

// ---------------------------------------------------------------- interrupts (§1.3)
export const INTERRUPTS = ['siloFull', 'barnFull', 'firstDrop', 'slot6', 'firstVisitor'];

// A one-time beat waiting to be shown (guided / coached; never with hints off or in a hard beat).
// State-derived: siloFull / barnFull (≥ 90%), slot6 (L6 with a workshop), firstVisitor (Mabel's visit).
// Event-driven ones come in as ui.interrupt = { key: 'firstDrop', item }.
// Mark it seen (game.markSeen(step.interrupt)) once shown (toast) or once its chain ends.
export function pendingInterrupt(game, ui = {}) {
  const g = game;
  ui = normUi(ui);
  const m = mode(g);
  if (m === 'independent' || g.s.settings?.hints === 'off' || hardBeat(g)) return null;
  const it = ui.interrupt;
  if (it && it.key === 'firstDrop' && !g.hasSeen('firstDrop')) {
    const item = ITEMS[it.item] || ITEMS.plank;
    return mk('interrupt:firstDrop', 'none', null, {
      why: 'interrupt', interrupt: 'firstDrop', toast: true, stepKey: 'firstDrop', icon: item.icon, label: item.name,
      say: fill(TUTORIAL.lines.firstDrop, { icon: item.icon, item: item.name }),
    });
  }
  for (const id of Object.keys(STORAGE)) {
    const key = id + 'Full';
    // (the beat waits, unseen, while "Sell extras" would sell nothing: everything is at its keep or reserved)
    if (g.hasSeen(key) || g.storageUsed(id) < FULL_SHARE * g.storageCap(id) || !sellExtrasValue(g, id)) continue;
    return viaPanel(g, ui, `interrupt:${key}`, { panel: 'barn', tabKey: 'storage', tab: id, opener: 'btn:barn', target: `storage:sellExtras:${id}` },
      { why: 'interrupt', interrupt: key, stepKey: key, storage: id, icon: STORAGE[id].icon, label: 'Sell extras' });
  }
  if (g.s.level >= 6 && !g.hasSeen('slot6')) {
    const f = objectsOf(g, 'factory').find((o) => g.extraSlotCost(o));
    if (f) {
      return viaPanel(g, ui, 'interrupt:slot6', { panel: 'factory', ref: f.id, opener: `bubble:o${f.id}`, target: null },
        { why: 'interrupt', interrupt: 'slot6', stepKey: 'slot6', object: f.id, icon: '🔒', label: 'One more job slot', toast: true });
    }
  }
  const v = (g.s.visitors || []).find((x) => x.first);
  if (v && !g.hasSeen('firstVisitor')) {
    // she asked for something you held, but it may be gone by now: then just her hello and a glow on her
    if (!g.hasItems({ [v.item]: v.qty })) {
      return uiStep('interrupt:firstVisitor', `bubble:v${v.id}`, { why: 'interrupt', interrupt: 'firstVisitor', stepKey: 'firstVisitor', toast: true, visitor: v.id, icon: ITEMS[v.item].icon, label: 'Mabel is visiting' });
    }
    const s = serveChain(g, ui, v, { why: 'interrupt', interrupt: 'firstVisitor', stepKey: 'firstVisitor' });
    if (s.target?.ui !== 'visitor:sell') return s;
    return { ...s, stepKey: 'firstVisitorPanel', say: fill(TUTORIAL.lines.firstVisitorPanel, { item: ITEMS[v.item].name.toLowerCase() }) };
  }
  return null;
}

// ---------------------------------------------------------------- planStep
function normUi(ui = {}) {
  return {
    panel: ui.panel || null, placing: ui.placing || null, tool: ui.tool || 'hand', modal: ui.modal || null,
    popover: ui.popover || null, interrupt: ui.interrupt || null, skipInterrupt: !!ui.skipInterrupt,
  };
}

function modalStep(g, kind) {
  const base = { why: 'modal', modal: kind };
  if (kind === 'levelup') {
    const L = g.s.level;
    return uiStep(`modal:levelup:${L}`, 'modal:levelup:ok', { ...base, stepKey: TUTORIAL.lines['levelup' + L] ? 'levelup' + L : null, icon: '⭐', label: `Level ${L}` });
  }
  if (kind === 'daily') return uiStep('modal:daily', 'modal:daily:claim', { ...base, stepKey: graduationPending(g) ? 'gradDaily' : null, icon: '🎁', label: 'Daily gift' });
  if (kind === 'chest') return uiStep('modal:chest', 'modal:chest:open', { ...base, stepKey: graduationPending(g) ? 'grad' : null, icon: '🎁', label: 'Open the chest' });
  // the parcel modal: Open! ✨ then Lovely! (one key for both)
  if (kind === 'post') return uiStep('modal:post', 'modal:post:open', { ...base, icon: '📬', label: 'Open your parcel', stepKey: guided(g) && g.s.post.n === 0 ? 'post1Open' : null });
  return uiStep('modal:guide', 'guide:next', { ...base, icon: GUIDE.icon, label: GUIDE.name });
}

// A ghost on screen. ✓ (or a drag to a free spot) only for what the planner would build anyway — a gift, the
// goal's building, a pen for the animals it buys, a workshop a recipe needs. Anything else the player started
// themselves (a row of fences: cheap decor keeps placing after ✓) gets no finger and no line, so following
// Mabel never buys more of it; the step names ✕ for headless followers only (pointer: false).
function placeStep(g, ui, pl) {
  const def = OBJECTS[pl.type] || {};
  // (only the tour's Scarecrow gets Mabel's Scarecrow line; the Mailbox has its own coach line)
  const stepKey = pl.gift ? (pl.type === CHAPTERS[0].reward.gift ? 'gradGift' : null) : pl.type === 'coop' ? 'coopPlace' : 'place';
  const base = { build: pl.type, gift: !!pl.gift, stepKey, icon: def.icon || '✓', label: `Build ${def.name || ''}`.trim() };
  // nowhere it fits: back out, and the build step makes room first
  if (pl.valid === false && OBJECTS[pl.type] && !g.findFreeSpot(pl.type, 0)) return uiStep(`place:${pl.type}:cancel`, 'place:cancel', { ...base, stepKey: null, label: 'No room yet' });
  if (!pl.gift && resolve(g, { ...ui, placing: null }).build !== pl.type) {
    return uiStep(`place:${pl.type}:own`, 'place:cancel', { ...base, gift: false, stepKey: null, pointer: false, label: `Placing ${def.name || ''}`.trim() });
  }
  if (pl.valid === false) return mk(`place:${pl.type}:drag`, 'world', { world: 'ghost' }, { ...base, gesture: 'swipe' });
  return uiStep(`place:${pl.type}`, 'place:ok', base);
}

function claimStep(g) {
  const q = g.currentQuest();
  const stepKey = q.id === 'harvest' ? 'claim' : q.id === 'plant' ? 'claimL2' : null;
  return uiStep(`claim:${g.qidFor(g.s.quest.index)}`, 'quest:claim', { why: 'claim', stepKey, icon: '🎁', label: 'Claim!' });
}

function welcomeStep() {
  return uiStep('welcome', 'guide:next', { why: 'modal', modal: 'guide', stepKey: 'welcome', pointer: false, icon: GUIDE.icon, label: 'Welcome' });
}

function resolve(g, ui) {
  if (guided(g) && !g.hasSeen('welcome')) return welcomeStep();
  if (ui.modal) return modalStep(g, ui.modal);
  if (ui.placing) return placeStep(g, ui, ui.placing);
  if (graduationPending(g)) return graduationStep(g);
  if (g.questDone()) return claimStep(g);
  const it = ui.skipInterrupt ? null : pendingInterrupt(g, ui);
  if (it) return it;
  const q = g.currentQuest();
  const plan = PLANNERS[q.event] || PLANNERS.level;
  let s = plan(g, ui, q, 0) || busyStep(g);
  if (s.kind === 'wait' || s.kind === 'none') s = { ...s, meanwhile: recommendIdle(g, ui, { saveFor: s.block?.kind === 'coins' ? s.block.need : 0 }) };
  return s;
}

// the Chapter 1 line for a guided step (TUTORIAL.lines key), from the goal and what the step targets
function guidedLine(g, s) {
  if (s.stepKey !== undefined || s.why !== 'quest') return s.stepKey || null;
  const q = g.currentQuest();
  const ui = s.target?.ui || '';
  switch (q.id) {
    case 'order1': return ui.startsWith('order:deliver') ? 'order1Panel' : 'order1';
    case 'coop': return ui === 'shop:buy:coop' ? 'coopShop' : 'coop';
    case 'chickens': return ui === 'pen:buy' ? 'chickensPanel' : g.s.animals.some((a) => a.type === 'chicken') ? 'chickensMore' : 'chickens';
    case 'plow': return s.target?.world === 'ghostPlots' ? 'plowTiles' : 'plow';
    case 'bakery': return s.block?.kind === 'coins' ? 'bakeryCoins' : 'bakery';
    case 'bread': {
      if (ui === 'factory:finish') return 'breadFree';
      if (s.key.startsWith('collect:')) return 'breadCollect';
      // the Bakery itself (or building it) gets the goal's line; harvesting / planting / waiting for wheat its own
      return s.recipe === 'bread' || ui.startsWith('factory:') || s.key.startsWith('make:') || s.key.startsWith('build:') ? 'bread' : 'breadWheat';
    }
    default: return q.chapter === 1 && TUTORIAL.lines[q.id] ? q.id : null;
  }
}

// HUD groups a guided step needs revealed (§4 progressive reveal), minus what's already shown
const REVEAL_OF = [[/^btn:shop|^shop:/, 'shop'], [/^btn:barn|^storage:/, 'barn'], [/^btn:orders|^order:/, 'orders'], [/^tool:/, 'tools'],
  [/^quest:/, 'quest'], [/^level:/, 'level'], [/^pill:gems/, 'gems'], [/^btn:today|^today:/, 'today'], [/^btn:trophy/, 'trophy'],
  [/^btn:camera|^cam:/, 'camera'], [/^btn:post|^modal:post|^today:post/, 'post']];

function revealFor(g, steps) {
  if (g.revealAll()) return [];
  const keys = new Set();
  const qi = g.s.quest.index;
  const done = g.questDone();
  if (qi > 0 || g.questProgress() > 0) { keys.add('quest'); keys.add('barn'); }
  if (qi > 0 || done) keys.add('level');
  if (g.s.level >= 2) keys.add('gems');
  if (qi >= qIndex('order1')) keys.add('orders');
  if (qi >= qIndex('coop')) keys.add('shop');
  if (qi >= qIndex('plow')) keys.add('tools');
  if (g.s.post?.n > 0) keys.add('post'); // the post pill stays once a parcel was opened
  for (const s of steps) {
    if (!s) continue;
    for (const k of s.reveal || []) keys.add(k);
    for (const k of [s.target?.ui, ...(s.chain || [])]) for (const [re, r] of REVEAL_OF) if (k && re.test(k)) keys.add(r);
  }
  return [...keys].filter((k) => !g.isRevealed(k));
}

function finish(g, ui, s) {
  const gd = guided(g);
  const out = { ...s, quest: g.qidFor(g.s.quest.index) };
  if (gd && hardBeat(g) && (s.why === 'quest' || s.why === 'claim') && (s.kind === 'world' || s.target?.ui === 'quest:claim')) out.gate = 'hard';
  // Mabel speaks every step while guided; afterwards only interrupts and the busy line
  const key = gd ? guidedLine(g, s) : s.why === 'interrupt' || s.stepKey === 'busy' ? s.stepKey : null;
  out.stepKey = key || null;
  out.say = key ? s.say || TUTORIAL.lines[key] || null : null;
  if (s.meanwhile) {
    const mw = { ...s.meanwhile, why: 'meanwhile' };
    const q = g.currentQuest();
    // B10: the "tidy up" line comes when the finger reaches the weeds and stones (harvesting first keeps the goal's line)
    // (and parcel #1's "The post's here!" while the eggs are on their way)
    if (mw.stepKey !== 'busy') {
      const tidy = gd && q.id === 'eggs' && mw.action === 'clear';
      mw.stepKey = tidy ? 'eggsMeanwhile' : gd && mw.stepKey === 'post1' ? 'post1' : null;
      mw.say = TUTORIAL.lines[mw.stepKey] ?? null;
    }
    out.meanwhile = mw;
  }
  const reveal = gd ? revealFor(g, [s, s.meanwhile]) : [];
  if (reveal.length) out.reveal = reveal; else delete out.reveal;
  return out;
}

// ---------------------------------------------------------------- memo
// Results are cached per (game change counter, game second, ui signature).
const EVENTS = ['coins', 'gems', 'xp', 'levelup', 'inventory', 'soil', 'objectAdded', 'objectRemoved', 'objectMoved', 'animalAdded', 'animalChanged',
  'factoryChanged', 'treeChanged', 'orders', 'orderDone', 'visitors', 'visitorServed', 'quest', 'questComplete', 'chores', 'daily', 'land',
  'storageUpgraded', 'tutorial', 'reveal', 'gifts', 'chapter', 'debrisCleared', 'wagon', 'drop', 'safetyNet', 'project',
  'post', 'postReady', 'keepsake', 'album', 'charm'];
const memo = new WeakMap();

function memoFor(game) {
  let m = memo.get(game);
  if (!m) {
    m = { rev: 0, sig: null, step: null };
    if (typeof game.on === 'function') for (const e of EVENTS) game.on(e, () => { m.rev++; });
    memo.set(game, m);
  }
  return m;
}

function signature(game, ui, m) {
  const p = ui.panel, pl = ui.placing, t = game.s.tutorial || {};
  return [m.rev, Math.floor(game.now() / 1000), game.s.quest.index, game.s.quest.progress, game.s.coins, game.s.level, t.mode,
    Object.keys(t.seen || {}).length, game.s.settings?.hints, game.s.settings?.tapHarvest,
    p && p.id, p && p.tab, p && p.ref && typeof p.ref === 'object' ? tk(p.ref.x, p.ref.z) : p && p.ref, p && (p.age ?? 0) > PANEL_PATIENCE,
    pl && pl.type, pl && pl.valid, pl && pl.gift, ui.tool, ui.modal, ui.popover && tk(ui.popover.x, ui.popover.z),
    ui.interrupt && ui.interrupt.key, ui.interrupt && ui.interrupt.item, ui.skipInterrupt].join('|');
}

// The single next step for the current goal (see the header for the shape). opts.cache = false skips the memo.
export function planStep(game, ui = {}, opts = {}) {
  ui = normUi(ui);
  if (opts.cache === false) return finish(game, ui, resolve(game, ui));
  const m = memoFor(game);
  const sig = signature(game, ui, m);
  if (m.sig === sig && m.step) return m.step;
  const step = finish(game, ui, resolve(game, ui));
  m.sig = sig;
  m.step = step;
  return step;
}

// What the HUD's quest card shows for a step (hud.setQuestGuide shape).
export function questCardInfo(game, step) {
  const done = game.questDone();
  const now = game.now();
  const mw = step?.meanwhile;
  const w = step?.kind === 'wait' && step.wait?.until && step.wait.until - now > MEANWHILE_AFTER * 1000 ? step.wait : null;
  const showRow = !done && mw && (w || step.kind === 'none' || (step.kind === 'wait' && !step.wait?.until));
  return {
    chapter: game.questChapter(),
    block: done ? null : step?.block || null,
    wait: done || !w ? null : { icon: w.icon, until: w.until, label: w.label },
    meanwhile: showRow ? (mw.stepKey === 'busy' ? { icon: mw.icon, label: mw.label, text: mw.say } : { icon: mw.icon, label: mw.label }) : null,
    showMe: !done && mode(game) !== 'guided',
  };
}
