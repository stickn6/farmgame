// Headless guide follower. SimUI keeps a fake UI ({ panel, tab, placing, tool, modal, popover }) and
// applies a planner step to the Game exactly as a player tapping its target would (same rules as
// main.js / hud.js: patch harvest, seed popover, lots + smartSpot, tendPen, modals…). GuideFollower
// loops planStep → SimUI.apply with a cost in seconds per tap, advancing an injected clock while it waits.
//
//   const f = new GuideFollower(game, { advance: (sec) => { t += sec * 1000; } });
//   const report = f.run({ maxSec: 90 * 60, until: (g) => g.s.quest.index >= QUESTS.length });
import { planStep, nextMode, placementSpot, plantCap, shouldAutoShowDaily, graduationPending, reserves, mailboxNear, fieldCentre } from '../src/game/guide.js';
import { OBJECTS, ANIMALS, CROPS, QUESTS, CHAPTERS } from '../src/game/config.js';

// §7.2: 4 s per tap, 3 s per new Mabel line, double for first-time UI, 6 s per level-up modal
export const TAP_COSTS = { tap: 4, line: 3, firstUi: 2, levelUp: 6 };

const MODAL_PRIORITY = { chest: 2, daily: 4 };

export class SimUI {
  constructor(game, opts = {}) {
    this.g = game;
    this.cost = { ...TAP_COSTS, ...(opts.cost || {}) };
    this.ui = { panel: null, placing: null, tool: 'hand', modal: null, popover: null, interrupt: null, postOpened: false };
    this.postGift = null; // a parcel's decor to put up once its modal closes (the Mailbox)
    this.albumGifts = []; // an album page's decorations, put up once its chest is opened
    this.queue = []; // modals waiting for a free screen: { kind, prio }
    this.usedUi = new Set(); // key families tapped before (first-time UI costs double)
    this.taps = 0;
    game.on('levelup', () => { if (this.ui.modal !== 'levelup') this.showModal('levelup'); });
    // Chapter 1's chest is part of graduation (planner steps); later chests queue like the real UI
    game.on('chapter', ({ chapter }) => { if (!(chapter.id === 1 && game.tutorialMode() === 'guided')) this.enqueue('chest'); });
    game.on('drop', ({ item }) => { if (!game.hasSeen('firstDrop') && !this.ui.interrupt) this.ui.interrupt = { key: 'firstDrop', item }; });
    if (shouldAutoShowDaily(game, game.now())) this.enqueue('daily');
  }

  now() { return this.g.now(); }

  // the ui argument for planStep
  view() {
    const u = this.ui, p = u.panel;
    return {
      panel: p ? { id: p.id, tab: p.tab, ref: p.ref, age: (this.now() - p.openedAt) / 1000 } : null,
      placing: u.placing ? { type: u.placing.type, valid: u.placing.valid, gift: u.placing.gift } : null,
      tool: u.tool, modal: u.modal, popover: u.popover, interrupt: u.interrupt,
    };
  }

  // ------------------------------------------------------------ modals
  showModal(kind) {
    if (this.ui.modal && this.ui.modal !== kind) this.queue.unshift({ kind: this.ui.modal, prio: 0 });
    this.ui.modal = kind;
  }

  enqueue(kind) {
    if (this.queue.some((m) => m.kind === kind)) return;
    this.queue.push({ kind, prio: MODAL_PRIORITY[kind] ?? 5 });
    this.queue.sort((a, b) => a.prio - b.prio);
  }

  // queued modals show when nothing else is up (chest and daily close a panel first)
  pump() {
    const u = this.ui;
    if (u.modal || u.placing || !this.queue.length) return;
    const next = this.queue.shift();
    if (next.kind === 'daily' && !this.g.dailyStatus().canClaim) return;
    u.panel = null;
    u.modal = next.kind;
  }

  closeModal() {
    this.ui.modal = null;
    const lu = this.queue.findIndex((m) => m.prio === 0);
    if (lu >= 0) this.ui.modal = this.queue.splice(lu, 1)[0].kind;
  }

  // ------------------------------------------------------------ panels, tools, placement
  openPanel(id, { tab = null, ref = null } = {}) {
    this.ui.panel = { id, tab, ref, openedAt: this.now() };
    this.ui.popover = null;
  }

  closePanel() { this.ui.panel = null; }

  // 🏆 opens on something to claim (album page → ribbons → awards), else the album once it's open, else Awards (hud.js)
  treasuresTab() {
    const g = this.g;
    if (g.albumPagesReady().length) return 'album';
    if (g.features?.charm && g.charmStatus?.()?.ready) return 'ribbons';
    if (g.achievementsReady()) return 'awards';
    return g.albumOpen() ? 'album' : 'awards';
  }

  // 📬 (the pill, the Today row or the Mailbox): the parcel modal, never queued (the player opens it)
  openPost() {
    if (!this.g.postStatus().ready) return;
    if (this.ui.modal && this.ui.modal !== 'post') this.queue.unshift({ kind: this.ui.modal, prio: 0 });
    this.ui.panel = null;
    this.ui.modal = 'post';
    this.ui.postOpened = false;
  }

  setTool(t) {
    this.ui.tool = t;
    this.ui.popover = null;
    this.ui.placing = null;
  }

  startPlacement(type, { gift = false, near = null } = {}) {
    const g = this.g;
    const spot = gift ? g.smartSpot(type, 0, near) : placementSpot(g, type, near);
    this.ui.placing = { type, gift, x: spot?.x, z: spot?.z, rot: spot?.rot || 0, valid: !!spot };
    this.ui.popover = null;
  }

  confirmPlacement() {
    const g = this.g, pl = this.ui.placing;
    if (!pl) return null;
    if (!pl.valid) return null;
    const grad = pl.gift && pl.type === CHAPTERS[0].reward.gift && graduationPending(g);
    const o = pl.gift ? g.placeGift(pl.type, pl.x, pl.z, pl.rot) : g.placeObject(pl.type, pl.x, pl.z, pl.rot);
    // cheap decor keeps placing while coins last, as in main.js (the ghost stays on the one just built)
    if (o && !pl.gift && OBJECTS[pl.type].kind === 'decor' && g.s.coins >= OBJECTS[pl.type].cost) {
      pl.valid = g.canPlace(pl.type, pl.x, pl.z, pl.rot);
      return o;
    }
    // a failed build (coins, limits) cancels instead of looping on the ghost
    this.ui.placing = null;
    if (grad) g.markSeen('grad:gift');
    this.nextAlbumGift();
    return o;
  }

  // the launch album's Curio Cabinet goes up after the page's own decoration
  nextAlbumGift() {
    const g = this.g;
    while (this.albumGifts.length && !this.ui.placing && !this.ui.modal) {
      const gift = this.albumGifts.shift();
      if ((g.s.gifts || []).includes(gift)) { this.startPlacement(gift, { gift: true, near: fieldCentre(g) }); return; }
    }
  }

  // ------------------------------------------------------------ the farm, as main.js does it
  tendPen(o, fromPanel = false) {
    const g = this.g;
    const list = g.animalsIn(o.id);
    if (!list.length) { this.openPanel('pen', { ref: o.id }); return; }
    let did = 0;
    for (const a of list) if (g.collectAnimal(a)) did++;
    let starving = 0;
    for (const a of list) {
      if (g.animalState(a) !== 'hungry') continue;
      if (g.feedAnimal(a)) did++; else if (ANIMALS[a.type].food) starving++;
    }
    if (!did && !starving && !fromPanel) this.openPanel('pen', { ref: o.id });
  }

  tapObject(o) {
    const g = this.g, def = OBJECTS[o.type];
    if (def.kind === 'debris') { g.clearDebris(o.id); return; }
    if (o.type === 'orderboard') { this.openPanel('orders', { tab: 'orders' }); return; }
    if (def.kind === 'pen') { this.tendPen(o); return; }
    if (def.kind === 'factory') { if (!g.collectFactory(o)) this.openPanel('factory', { ref: o.id }); return; }
    if (def.kind === 'tree') { if (!g.harvestTree(o)) this.openPanel('tree', { ref: o.id }); return; }
    if (def.kind === 'storage') { this.openPanel('barn', { tab: def.storage }); return; }
    if (def.kind === 'decor') this.openPanel('decor', { ref: o.id });
    if (o.type === 'farmhouse') this.openPanel('farmhouse', { tab: 'progress' });
  }

  tapBubble(id) {
    const g = this.g, kind = id[0], n = +id.slice(1);
    if (id === 'wagon') { this.openPanel('orders', { tab: 'wagon' }); return; }
    if (kind === 'a') { const a = g.s.animals.find((x) => x.id === n); if (a) this.tendPen(g.objById.get(a.home)); return; }
    if (kind === 'v') { if (g.s.visitors.some((v) => v.id === n)) this.openPanel('visitor', { ref: n }); return; }
    const o = kind === 'o' && g.objById.get(n);
    if (!o) return;
    const def = OBJECTS[o.type];
    if (def.kind === 'pen' && !g.animalsIn(o.id).length) this.openPanel('pen', { ref: o.id });
    else this.tapObject(o);
  }

  // patch harvest from the tapped tile (tap-to-harvest), or the seed popover / direct plant on empty soil
  tapTiles(tiles, step) {
    const g = this.g;
    // the Clear tool, dragged across the tiles
    if (step.action === 'clearSoil' && this.ui.tool === 'remove') { for (const [tx, tz] of tiles) g.clearSoil(tx, tz); return; }
    const [x, z] = tiles[0];
    const soil = g.soilAt(x, z);
    if (!soil) return;
    if (soil.crop) {
      if (g.cropStage(soil.crop) < 3) { this.openPanel('crop', { ref: { x, z } }); return; }
      if (step.gesture === 'swipe') { for (const [tx, tz] of tiles) g.harvest(tx, tz); return; }
      const type = soil.crop.type, y = CROPS[type].yield;
      if (!g.harvest(x, z)) return;
      const more = g.patchTiles(x, z, (s) => !!s.crop && s.crop.type === type && g.cropStage(s.crop) === 3, 24).filter(([a, b]) => a !== x || b !== z);
      for (const [tx, tz] of more) { if (g.spaceFor(type) < y) break; g.harvest(tx, tz); }
      return;
    }
    const unlocked = Object.keys(CROPS).filter((c) => g.isUnlocked('crops', c));
    if (unlocked.length === 1) g.plantPatch(x, z, unlocked[0], plantCap(g, unlocked[0]));
    else this.ui.popover = { x, z };
  }

  tapWorld(target, step) {
    const g = this.g;
    if (target.world === 'tiles') this.tapTiles(target.tiles, step);
    else if (target.world === 'object') { const o = g.objById.get(target.id); if (o) this.tapObject(o); }
    else if (target.world === 'visitor') this.openPanel('visitor', { ref: target.id });
    else if (target.world === 'ghostPlots') {
      // guided: one tap plows both suggested tiles, then the tool goes back to Hand; else a drag across them
      for (const [x, z] of target.tiles) g.plow(x, z);
      if (g.tutorialMode() === 'guided') this.ui.tool = 'hand';
    } else if (target.world === 'ghost' && this.ui.placing) {
      const pl = this.ui.placing;
      const spot = pl.gift ? g.smartSpot(pl.type) : placementSpot(g, pl.type);
      Object.assign(pl, { x: spot?.x, z: spot?.z, valid: !!spot });
    }
  }

  // one tap on a data-guide key; returns its cost in seconds
  tap(key, step = {}) {
    const g = this.g, u = this.ui;
    const fam = key.replace(/\d+/g, '#');
    const first = !this.usedUi.has(fam);
    this.usedUi.add(fam);
    this.taps++;
    let sec = this.cost.tap * (first ? this.cost.firstUi : 1);
    const [a, b, c] = key.split(':');
    const o = u.panel && typeof u.panel.ref === 'number' ? g.objById.get(u.panel.ref) : null;
    const pref = (id, fallback) => (step.panel?.id === id && step.panel.tab) || fallback;
    switch (a) {
      case 'guide':
        if (b === 'next') { g.markSeen('welcome'); u.modal = null; } else g.skipTutorial();
        break;
      case 'quest':
        if (b === 'claim') g.claimQuest();
        else if (b === 'card' && step.key === 'grad:end') g.markSeen('grad:end');
        break;
      case 'tool': this.setTool(b); break;
      case 'btn':
        if (b === 'shop') this.openPanel('shop', { tab: pref('shop', 'buildings') });
        else if (b === 'barn') this.openPanel('barn', { tab: pref('barn', 'silo') });
        else if (b === 'orders') this.openPanel('orders', { tab: pref('orders', 'orders') });
        else if (b === 'today') this.openPanel('today');
        else if (b === 'trophy') this.openPanel('treasures', { tab: pref('treasures', this.treasuresTab()) });
        else if (b === 'settings') this.openPanel('farmhouse', { tab: 'farm' });
        else if (b === 'post') this.openPost();
        break;
      case 'panel': this.closePanel(); break;
      case 'treasures': if (b === 'tab' && u.panel) u.panel.tab = c; break;
      case 'album':
        // Claim prize!: paid now; the panel closes, the chest queues, then the decorations go up
        if (b === 'claim') {
          const r = g.claimAlbumPage(c);
          if (!r) break;
          this.closePanel();
          this.albumGifts.push(...[r.gift, r.launch?.gift].filter(Boolean));
          this.enqueue('chest');
        } else sec = 0; // ‹ › and the page dots only browse
        break;
      case 'ribbons': if (b === 'claim') g.claimRibbons?.(); break;
      case 'shop':
      case 'storage':
      case 'orders':
      case 'farmhouse':
        if (b === 'tab') { if (u.panel) u.panel.tab = c; break; }
        if (a === 'shop' && b === 'buy') { this.closePanel(); this.startPlacement(c); }
        else if (a === 'shop' && b === 'gift') { this.closePanel(); this.startPlacement(c, { gift: true }); }
        else if (a === 'shop' && b === 'animal') g.buyAnimal(c);
        else if (a === 'shop' && b === 'land') { this.closePanel(); g.expandLand(); }
        else if (a === 'storage' && b === 'sellExtras') g.sellExtras(c, 10, reserves(g));
        else if (a === 'storage' && b === 'sell') g.sell(c, 1); // the item's card was picked first (storage:item:<id>)
        else if (a === 'storage' && b === 'upgrade') g.upgradeStorage(c);
        break;
      case 'place':
        if (b === 'ok') this.confirmPlacement();
        else if (b === 'cancel') { if (u.placing?.gift && u.placing.type === CHAPTERS[0].reward.gift && graduationPending(g)) g.markSeen('grad:gift'); u.placing = null; this.nextAlbumGift(); }
        break;
      case 'seed':
        if (b === 'more') this.setTool('seed');
        else if (u.popover) { g.plantPatch(u.popover.x, u.popover.z, b, plantCap(g, b)); u.popover = null; }
        break;
      case 'seedbar': u.seed = b; break;
      case 'order': if (b === 'deliver') g.fulfillOrder(+c); break;
      case 'factory':
        if (!o) break;
        if (b === 'make') g.startRecipe(o, c);
        else if (b === 'finish') { if (g.freeFinishAvailable(o)) g.speedUpFactory(o, { free: true }); } // the follower never spends gems
        else if (b === 'collect') g.collectFactory(o);
        break;
      case 'pen':
        if (!o) break;
        if (b === 'buy') g.buyAnimal(OBJECTS[o.type].animal);
        else if (b === 'tend') { this.closePanel(); this.tendPen(o, true); }
        break;
      case 'today':
        if (b === 'gift') g.claimDaily(); else if (b === 'chore') g.claimChore(+c); else if (b === 'post') this.openPost();
        break;
      case 'visitor':
        if (b === 'sell' && u.panel?.id === 'visitor' && g.serveVisitor(u.panel.ref)) this.closePanel();
        break;
      case 'modal': {
        if (b === 'post') {
          if (!u.postOpened) {
            // Open! ✨: the parcel is claimed as it opens, then its tiles pop in (~2 s)
            const r = g.claimPost();
            u.postOpened = true;
            sec += 2;
            this.postGift = r?.gift?.place ? r.gift.type : null;
          } else {
            // Lovely!: the modal closes; the Mailbox goes up through the gift queue, by the order board
            this.closeModal();
            u.postOpened = false;
            const gift = this.postGift;
            this.postGift = null;
            if (gift && (g.s.gifts || []).includes(gift) && !u.placing) this.startPlacement(gift, { gift: true, near: mailboxNear(g) });
          }
          break;
        }
        const grad = graduationPending(g);
        if (b === 'levelup') sec = this.cost.levelUp;
        if (b === 'daily') { g.claimDaily(); if (grad) g.markSeen('grad:daily'); }
        if (b === 'chest' && grad) g.markSeen('grad:chest');
        this.closeModal();
        // an album page's chest: its decoration goes up next
        if (b === 'chest') this.nextAlbumGift();
        break;
      }
      case 'bubble': this.tapBubble(b); break;
      case 'cam': sec = 0; break; // the 🧭 view pad changes nothing in the rules
      default: break;
    }
    return sec;
  }

  // Do what a player following this step does; returns the seconds it took.
  apply(step) {
    const g = this.g;
    let sec = 0;
    // Mabel's line, read once
    if (step.stepKey && step.stepKey !== 'busy' && step.say && g.markSeen('line:' + step.stepKey)) sec += this.cost.line;
    if (step.why === 'interrupt') return sec + this.applyInterrupt(step);
    if (step.modal && step.modal !== 'guide' && this.ui.modal !== step.modal) this.ui.modal = step.modal; // the UI opened it
    if (step.startPlacement && !this.ui.placing) this.startPlacement(step.startPlacement.type, step.startPlacement);
    if (step.kind === 'ui') sec += this.tap(step.target.ui, step);
    else if (step.kind === 'world') { this.taps++; sec += this.cost.tap; this.tapWorld(step.target, step); }
    return sec;
  }

  // a one-time beat: follow its chain from the current target, then it counts as seen
  applyInterrupt(step) {
    let sec = 0;
    if (step.kind === 'ui') {
      const chain = step.chain?.length ? step.chain : [step.target.ui];
      const from = Math.max(0, chain.indexOf(step.target.ui));
      for (const k of chain.slice(from)) {
        const [, kind, tab] = k.split(':');
        if (kind === 'tab' && this.ui.panel?.tab === tab) continue;
        sec += this.tap(k, step);
      }
    } else if (step.kind === 'world') { this.taps++; sec += this.cost.tap; this.tapWorld(step.target, step); }
    this.g.markSeen(step.interrupt);
    if (this.ui.interrupt?.key === step.interrupt) this.ui.interrupt = null;
    return sec;
  }
}

const actionable = (s) => !!s && (s.kind === 'ui' || s.kind === 'world' || (s.why === 'interrupt' && s.kind === 'none'));

// cheap fingerprint of everything a tap can change
const fingerprint = (g, ui) => JSON.stringify([g.s.coins, g.s.xp, g.s.inventory, g.s.soil, g.s.animals, g.s.objects.map((o) => [o.id, o.jobs, o.harvests]),
  g.s.orders, g.s.visitors, g.s.quest, g.s.tutorial?.seen, ui]);

export class GuideFollower {
  // opts.advance(sec): moves the game clock forward; opts.cost: TAP_COSTS overrides; opts.maxWait: longest idle jump (s)
  constructor(game, opts = {}) {
    if (typeof opts.advance !== 'function') throw new Error('GuideFollower needs opts.advance(sec)');
    this.g = game;
    this.advance = opts.advance;
    this.maxWait = opts.maxWait ?? 10;
    this.sim = opts.sim || new SimUI(game, opts);
    this.onStep = opts.onStep || null;
    this.onQuest = opts.onQuest || null;
  }

  syncMode() {
    const m = nextMode(this.g);
    if (m !== this.g.tutorialMode()) this.g.setTutorialMode(m);
  }

  // Follow the guide until until(game) or maxSec sim-seconds. Returns a report (times in minutes).
  run({ until = () => false, maxSec = 90 * 60 } = {}) {
    const g = this.g, sim = this.sim;
    const t0 = g.now();
    const min = () => (g.now() - t0) / 60000;
    const r = {
      levels: {}, chapters: {}, quests: [], taps: 0, steps: 0, idleSec: 0, longestGap: 0, gapAt: null,
      firstSiloFull: null, deadEnds: [], stalls: 0, safetyNet: 0, keys: new Set(), minutes: 0, nones: [],
    };
    const offs = [g.on('levelup', ({ level }) => { r.levels[level] ??= +min().toFixed(2); }),
      g.on('safetyNet', () => { r.safetyNet++; })];
    // (parcels and keepsakes count as rewards too)
    const rewardCount = () => { const st = g.s.stats; return (st.harvest || 0) + (st.collect || 0) + (st.produce || 0) + (st.ordersDone || 0) + (st.visitors || 0) + (st.parcels || 0) + (st.keepsakes || 0) + g.s.quest.index + g.s.level; };
    let lastReward = g.now(), rewards = rewardCount();
    let qi = g.s.quest.index;
    let stalledSince = null, lastKey = null, noop = 0;
    const lastOf = Object.fromEntries(CHAPTERS.map((c) => [c.id, QUESTS.findIndex((q) => q.id === c.last)]));
    const note = (s) => {
      if (!s) return;
      for (const k of [s.target?.ui, ...(s.chain || [])]) if (k) r.keys.add(k);
      if (s.meanwhile) note(s.meanwhile);
    };
    const growingOrProducing = () => {
      const now = g.now();
      return Object.values(g.s.soil).some((s) => s.crop && g.cropReadyAt(s.crop) > now)
        || g.s.animals.some((a) => g.animalState(a, now) === 'producing')
        || g.s.objects.some((o) => o.jobs?.some((j) => j.endAt > now));
    };
    while ((g.now() - t0) / 1000 < maxSec && !until(g)) {
      g.ensureOrders(); // the HUD tick
      sim.pump();
      this.syncMode();
      const step = planStep(g, sim.view());
      r.steps++;
      note(step);
      if (this.onStep) this.onStep(step, this);
      // dead ends: a 'none' (or a wait on nothing) while the goal is open and nothing grows or works
      const stuck = !g.questDone() && !growingOrProducing() && ((step.kind === 'none' && step.why !== 'interrupt') || (step.kind === 'wait' && !actionable(step.meanwhile) && !(step.wait?.until > g.now())));
      if (stuck) { stalledSince ??= g.now(); if (step.kind === 'none') r.nones.push({ at: +min().toFixed(2), key: step.key }); } else if (stalledSince != null) {
        const sec = (g.now() - stalledSince) / 1000;
        if (sec > 30) r.deadEnds.push({ at: +min().toFixed(2), sec, key: lastKey });
        stalledSince = null;
      }
      const act = actionable(step) ? step : actionable(step.meanwhile) ? step.meanwhile : null;
      if (act) {
        const before = fingerprint(g, sim.ui);
        const sec = sim.apply(act);
        this.advance(Math.max(1, sec));
        const same = fingerprint(g, sim.ui) === before;
        noop = same && act.key === lastKey ? noop + 1 : 0;
        if (noop >= 3) { r.stalls++; this.advance(5); noop = 0; }
        lastKey = act.key;
      } else {
        const now = g.now();
        const untils = [step.wait?.until, step.meanwhile?.wait?.until].filter((u) => u > now);
        const dt = untils.length ? Math.min(...untils.map((u) => (u - now) / 1000)) : 5;
        const jump = Math.max(1, Math.min(this.maxWait, Math.ceil(dt)));
        r.idleSec += jump;
        this.advance(jump);
        lastKey = step.key;
      }
      // bookkeeping
      const rc = rewardCount();
      if (rc !== rewards) {
        const gap = (g.now() - lastReward) / 1000;
        if (min() <= 30 && gap > r.longestGap) { r.longestGap = Math.round(gap); r.gapAt = +min().toFixed(2); }
        rewards = rc; lastReward = g.now();
      }
      if (r.firstSiloFull == null && g.storageUsed('silo') >= 0.9 * g.storageCap('silo')) r.firstSiloFull = +min().toFixed(2);
      if (g.s.quest.index !== qi) {
        for (let i = qi; i < g.s.quest.index; i++) {
          r.quests.push({ id: QUESTS[i]?.id || 'repeat:' + (i - QUESTS.length), at: +min().toFixed(2) });
          for (const [ch, last] of Object.entries(lastOf)) if (last === i) r.chapters[ch] = +min().toFixed(2);
        }
        qi = g.s.quest.index;
        if (this.onQuest) this.onQuest(qi, this);
      }
    }
    // still stuck when the run ends (e.g. a wait on no timer at all): that's a dead end too
    if (stalledSince != null && (g.now() - stalledSince) / 1000 > 30) r.deadEnds.push({ at: +min().toFixed(2), sec: (g.now() - stalledSince) / 1000, key: lastKey, open: true });
    for (const off of offs) off();
    r.taps = sim.taps;
    r.minutes = +min().toFixed(2);
    return r;
  }
}
