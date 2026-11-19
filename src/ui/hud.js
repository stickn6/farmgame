// DOM overlay UI. Designed touch-first (big hit targets, bottom sheets) so it ports to mobile.
// Every element a guide may point at carries data-guide="<key>" (see the spec's key list);
// groups the tutorial reveals step by step carry data-reveal="<key>".
import * as CONFIG from '../game/config.js';
import {
  ITEMS, CROPS, ANIMALS, OBJECTS, RECIPES, STORAGE, ACHIEVEMENTS, DAILY, VISITORS, MASTERY, PLOTS,
  CHORES, WAGON, PROJECTS, CAMERA, POST, KEEPSAKES, ALBUM, CHARM, xpForLevel, unlocksAtLevel, nextUnlockLevel, oneOfAKind,
} from '../game/config.js';
import { isHome, PAD_TURN, needleDeg } from '../game/camera.js';

// What a guide layer can plug into. All optional: with these defaults the game is fully playable unguided.
const DEFAULT_HOOKS = {
  onQuestTap: null, // () tap on a quest card that can't be claimed; null → text hint toast
  onMeanwhileTap: null, // () tap on the quest card's "Meanwhile" row
  levelUpGo: null, // (level) → true turns the level-up button into "Let's go! ▸"
  onLevelUpGo: null, // (level) after that button closed the modal
  onMissing: null, // (item) after a red "missing" chip closed its panel; null → hint toast, panel stays
  onSkipTour: null, // () settings "Skip tour"; null hides the button
  preferredTab: null, // (panelId) → tab id for a tabbed panel opened without one
  goalRecipe: null, // (factoryType) → recipe id that gets a "Goal" badge
  isGoal: null, // (guideKey) → true pulses that button (pen:buy)
  visitorLine: null, // (visitor) → line shown instead of the villager's usual one
  onSettings: null, // (key, value) a guide setting changed (hints, tapHarvest)
  onUiChange: null, // (reason) panel / tab / modal / popover / placement / tool changed
  sellFloors: null, // () → { item: qty } "Sell extras" keeps at least (what the goal, an order or the animals need)
};

// tiny hyperscript helper
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return m % 60 ? `${hr}h ${m % 60}m` : `${hr}h`;
  return `${Math.floor(hr / 24)}d ${hr % 24}h`;
}

// countdown clock: 2:31, 1:02:31
export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const hr = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = String(sec % 60).padStart(2, '0');
  return hr ? `${hr}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export const fmtNum = (n) => n.toLocaleString('en-US');
// the Post's countdown: 4:12 under an hour, 3h 12m above
export const postClock = (ms) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  if (sec < 3600) return fmtClock(sec);
  const m = Math.floor(sec / 60);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};
// the welcome parcels' farm ages (the timeline strip): 5m ✓ · 15m ✓ · 30m ● · 1h · 4h · then every 8h
const POST_AGES = (() => {
  let at = 0;
  return POST.gaps.map((g) => { at += g; return at < 3600 ? `${at / 60}m` : `${at / 3600}h`; });
})();

// inline-SVG icons of the 🧭 button and its view pad (not emoji: 🏠 is the Shop's Buildings tab, ⟳ the ghost's rotate)
const svg = (body, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const TURN = '<path d="M13.2 18.9 A7 7 0 1 0 6.6 7.5"/><path d="M10.4 7.5 L6 8.3 L6 3.8"/>';
const CAM_ICONS = {
  up: svg('<path d="M12 5 L20 17 H4 Z" fill="currentColor" stroke-width="1.5"/>'),
  down: svg('<path d="M12 19 L20 7 H4 Z" fill="currentColor" stroke-width="1.5"/>'),
  left: svg(TURN),
  right: svg(`<g transform="translate(24 0) scale(-1 1)">${TURN}</g>`),
  home: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="M12 1.5 V4.5 M12 19.5 V22.5 M1.5 12 H4.5 M19.5 12 H22.5"/>'),
};
// the compass needle (it turns with the farm, like a map's compass: ↺ turns both anticlockwise)
const NEEDLE = `<svg viewBox="-12 -12 24 24" width="24" height="24" aria-hidden="true"><circle r="10.6" fill="#fffdf6" stroke="#d6c39b" stroke-width="1.4"/>
  <g class="cam-needle"><path d="M0 -9.2 L3.3 0 L-3.3 0 Z" fill="#e5554a"/><path d="M0 9.2 L3.3 0 L-3.3 0 Z" fill="#8a6a4a"/></g><circle r="1.5" fill="#fff" stroke="#8a6a4a" stroke-width=".8"/></svg>`;
const stars = (n, max = 3) => '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));
const giftType = (gf) => (typeof gf === 'string' ? gf : gf?.type);
// visible on screen: attached, not display:none and not inside a not-yet-revealed group
const isShown = (el) => !!el && el.isConnected && !el.closest('.hud-hidden, .hidden');

export class HUD {
  constructor(root, game, ctrl, audio) {
    this.root = root;
    this.game = game;
    this.ctrl = ctrl;
    this.audio = audio;
    this.panel = null;
    this.hooks = { ...DEFAULT_HOOKS };
    this.questGuide = null;
    this.seedPop = null;
    this.revealSet = 'all';
    this.build();
    this.bind();
    this.refreshAll();
    setInterval(() => this.tick(), 1000);
  }

  // ---------------------------------------------------------------- guide hooks
  setHooks(hooks) { Object.assign(this.hooks, hooks); }
  hasHook(name) { return typeof this.hooks?.[name] === 'function'; }

  // a buggy guide must never break the HUD
  hook(name, ...args) {
    if (!this.hasHook(name)) return undefined;
    try { return this.hooks[name](...args); } catch (e) { console.error(`hud hook ${name}:`, e); return undefined; }
  }

  uiChanged(reason) {
    // a panel, modal or placement takes over the screen: the view pad and the post popover give way
    if (reason === 'panel' || reason === 'modal' || reason === 'placement') { this.closeCamPad(); this.closePostPop(); }
    this.hook('onUiChange', reason);
  }

  // Fly-to targets: hidden HUD groups hand their "fly here" role to the quest card or the coin pill.
  get barnBtn() { return this.flyTarget(this.barnBtnEl); }
  get levelBox() { return this.flyTarget(this.levelBoxEl); }
  get gemsPill() { return this.flyTarget(this.gemsPillEl); }

  flyTarget(el) {
    if (!el || isShown(el)) return el;
    if (el !== this.gemsPillEl && isShown(this.questCard)) return this.questCard;
    return this.coinsPill;
  }

  // ---------------------------------------------------------------- layout
  build() {
    this.coinsEl = h('span', { class: 'num' }, '0');
    this.coinsPill = h('div', { class: 'pill coins', 'data-guide': 'pill:coins', onclick: () => this.openBarn() }, h('span', { class: 'ico' }, '🪙'), this.coinsEl);
    this.gemsEl = h('span', { class: 'num' }, '0');
    this.gemsPillEl = h('div', { class: 'pill gems', 'data-guide': 'pill:gems', 'data-reveal': 'gems', onclick: () => this.toast('💎 Gems: earn them from level-ups, achievements, mastery, daily gifts, parcels and album pages. Use them to finish timers.', 'info') }, h('span', { class: 'ico' }, '💎'), this.gemsEl);
    this.levelNum = h('div', { class: 'level-num' }, '1');
    this.xpFill = h('div', { class: 'xp-fill' });
    this.xpText = h('div', { class: 'xp-text' }, '');
    this.nextHint = h('div', { class: 'next-hint' }, '');
    // 🎀 Prettiest Farm rank 10: a prize rosette pinned to the level star
    this.rosetteEl = h('span', { class: 'lvl-rosette hidden', title: 'Prize Farm rosette', 'aria-hidden': 'true' }, '🎀');
    this.levelBoxEl = h('div', { class: 'level-box', 'data-guide': 'level:box', 'data-reveal': 'level', onclick: () => this.openFarmhouse('progress') },
      h('div', { class: 'level-star' }, this.levelNum), this.rosetteEl, // (outside the star's clip-path)
      h('div', { class: 'xp-col' }, h('div', { class: 'xp-bar' }, this.xpFill, this.xpText), this.nextHint),
    );
    const badge = () => h('span', { class: 'badge hidden' }, '');
    this.dailyBtn = h('button', { class: 'round-btn', title: 'Today: gift & chores', 'data-guide': 'btn:today', 'data-reveal': 'today', onclick: () => this.openToday() }, '🎁', badge());
    this.trophyBtn = h('button', { class: 'round-btn', title: 'Treasures: album, ribbons & awards', 'data-guide': 'btn:trophy', 'data-reveal': 'trophy', onclick: () => this.openTreasures() }, '🏆', badge());
    this.settingsBtn = h('button', { class: 'round-btn', title: 'Farm & settings', 'data-guide': 'btn:settings', onclick: () => this.openFarmhouse('farm') }, '⚙️');

    this.questIcon = h('div', { class: 'q-icon' }, '📜');
    this.questText = h('div', { class: 'q-text' }, '');
    this.questFill = h('div', { class: 'q-fill' });
    this.questProg = h('div', { class: 'q-prog' }, '');
    this.questChapter = h('div', { class: 'q-chapter hidden' });
    this.questBlock = h('div', { class: 'q-block hidden' });
    this.questWait = h('span', { class: 'q-wait' });
    this.questMwLabel = h('span', { class: 'q-mw-label' });
    this.questMwPoint = h('span', { class: 'q-point' }, '👆');
    this.questMeanwhile = h('div', { class: 'q-meanwhile hidden', 'data-guide': 'quest:meanwhile', onclick: (e) => {
      e.stopPropagation();
      if (!this.questGuide?.meanwhile) return;
      this.audio.play('click');
      this.hook('onMeanwhileTap');
    } }, this.questWait, h('span', { class: 'q-mw-main' }, this.questMwLabel, this.questMwPoint));
    this.questShowMe = h('div', { class: 'q-showme hidden' }, '👆');
    this.questClaim = h('button', { class: 'btn small claim', 'data-guide': 'quest:claim', onclick: (e) => { e.stopPropagation(); this.ctrl.claimQuest(); } }, 'Claim!');
    this.questCard = h('div', { class: 'quest-card', 'data-guide': 'quest:card', 'data-reveal': 'quest' },
      this.questIcon,
      h('div', { class: 'q-body' }, this.questChapter, this.questText, h('div', { class: 'q-bar' }, this.questFill, this.questProg), this.questBlock),
      this.questClaim,
      this.questShowMe,
      this.questMeanwhile,
    );
    this.bindQuestCard();

    this.pills = h('div', { class: 'pills' }, this.coinsPill, this.gemsPillEl);
    this.roundBtns = h('div', { class: 'round-btns' }, this.dailyBtn, this.trophyBtn, this.settingsBtn);
    // row 3: 🧭 turn & tilt (tap: the view pad · hold: Home · drag: orbit); the post pill goes on its left
    this.camDot = h('span', { class: 'cam-dot hidden' });
    this.camBtn = h('button', { class: 'round-btn cam-btn', title: 'Turn & tilt the view (Q/E · Z/X · C)', 'aria-label': 'Turn and tilt the view', 'aria-expanded': 'false',
      'data-guide': 'btn:camera', 'data-reveal': 'camera', html: NEEDLE }, this.camDot);
    this.camNeedle = this.camBtn.querySelector('.cam-needle');
    // the post pill: 📪 4:12 and a thin bar while a parcel is on its way, 📬 Open! once it waits
    this.postIco = h('span', { class: 'pp-ico' }, '📪');
    this.postText = h('span', { class: 'pp-text' }, '');
    this.postBar = h('i', { class: 'pp-bar' });
    this.postPill = h('button', { class: 'post-pill', title: 'The Post', 'aria-label': 'The Post', 'data-guide': 'btn:post', 'data-reveal': 'post', onclick: () => this.postTap() },
      this.postIco, this.postText, h('span', { class: 'pp-track' }, this.postBar));
    this.row3 = h('div', { class: 'row3' }, this.postPill, this.camBtn);
    this.topBar = h('div', { class: 'top-bar' },
      h('div', { class: 'top-left' }, this.levelBoxEl, this.questCard),
      h('div', { class: 'top-right' }, this.pills, this.roundBtns, this.row3),
    );
    this.camPad = this.buildCamPad();
    this.bindCamBtn();

    // tool bar
    const tool = (id, icon, label, key) => h('button', { class: 'tool', 'data-tool': id, 'data-guide': 'tool:' + id, onclick: () => { this.audio.play('click'); this.ctrl.setTool(id); } },
      h('span', { class: 'ico' }, icon), h('span', { class: 'lbl' }, label), key ? h('span', { class: 'key' }, key) : null);
    const action = (id, icon, label, fn) => h('button', { class: 'tool action', id: 'btn-' + id, 'data-guide': 'btn:' + id, 'data-reveal': id, onclick: () => { this.audio.play('click'); fn(); } },
      h('span', { class: 'ico' }, icon), h('span', { class: 'lbl' }, label), badge());
    this.toolButtons = [tool('hand', '✋', 'Hand', '1'), tool('plow', '🚜', 'Plow', '2'), tool('seed', '🌱', 'Seeds', '3'), tool('remove', '🧹', 'Clear', '4')];
    this.shopBtn = action('shop', '🏪', 'Shop', () => this.openShop());
    this.barnBtnEl = action('barn', '📦', 'Barn', () => this.openBarn());
    this.ordersBtn = action('orders', '🚚', 'Orders', () => this.openOrders());
    this.toolbar = h('div', { class: 'toolbar' },
      h('div', { class: 'tool-group', 'data-reveal': 'tools' }, this.toolButtons),
      h('div', { class: 'tool-sep', 'data-reveal': 'tools' }),
      h('div', { class: 'tool-group' }, this.shopBtn, this.barnBtnEl, this.ordersBtn),
    );

    this.seedBar = h('div', { class: 'seed-bar hidden' });
    this.placeOk = h('button', { class: 'btn round green', 'data-guide': 'place:ok', onclick: () => this.ctrl.confirmPlacement() }, '✓');
    this.placeBar = h('div', { class: 'place-bar hidden' },
      h('div', { class: 'place-info' }),
      h('button', { class: 'btn round red', 'data-guide': 'place:cancel', onclick: () => this.ctrl.cancelPlacement() }, '✕'),
      h('button', { class: 'btn round', 'data-guide': 'place:rotate', onclick: () => this.ctrl.rotatePlacement() }, '⟳'),
      this.placeOk,
    );
    this.toolHint = h('div', { class: 'tool-hint hidden' });
    this.toasts = h('div', { class: 'toasts' });
    this.fx = h('div', { class: 'fx-layer' });
    this.modalLayer = h('div', { class: 'modal-layer' });
    // don't swap out buttons under a finger: live panel refreshes wait until the press ends
    this.modalLayer.addEventListener('pointerdown', () => { this._pressing = true; }, true);
    window.addEventListener('pointerup', () => setTimeout(() => { this._pressing = false; }, 0), true);
    window.addEventListener('pointercancel', () => { this._pressing = false; }, true);
    window.addEventListener('resize', () => { this.closeSeedPopover(); this.closeCamPad(); this.layoutTop(); });
    // any touch on the farm closes the view pad (capture, no preventDefault: the farm still gets it)
    document.getElementById('scene')?.addEventListener('pointerdown', () => this.closeCamPad(), true);

    this.root.append(this.topBar, this.toolHint, this.seedBar, this.placeBar, this.toolbar, this.camPad, this.toasts, this.modalLayer, this.fx);
    this.revealEls = [...this.root.querySelectorAll('[data-reveal]')];
    this._postWasReady = this.game.postStatus().ready;
    this.refreshPostPill();
  }

  // Quest card: tap = claim when done, else the guide's Show me (or a text hint); long-press = text hint.
  bindQuestCard() {
    const card = this.questCard;
    let timer = null, long = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    card.addEventListener('pointerdown', (e) => {
      long = false;
      cancel();
      if (e.target.closest('.claim, .q-meanwhile')) return;
      timer = setTimeout(() => { timer = null; long = true; this.audio.play('click'); this.questHint(true); }, 500);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) card.addEventListener(ev, cancel);
    card.addEventListener('contextmenu', (e) => e.preventDefault());
    card.addEventListener('click', () => {
      if (long) { long = false; return; }
      if (this.game.questDone()) { this.ctrl.claimQuest(); return; }
      this.audio.play('click');
      if (this.hasHook('onQuestTap')) this.hook('onQuestTap');
      else this.questHint(true);
    });
  }

  bind() {
    const g = this.game;
    g.on('coins', () => this.refreshCoins());
    g.on('gems', () => this.refreshGems());
    g.on('xp', () => this.refreshXp());
    g.on('inventory', () => { this.refreshBadges(); this.refreshPanel(); });
    g.on('orders', () => { this.refreshBadges(); this.refreshPanel(); });
    g.on('visitors', () => this.refreshPanel());
    g.on('chores', () => { this.refreshBadges(); this.refreshPanel(); });
    g.on('choreReady', (c) => { this.audio.play('quest'); this.toast(`✅ Chore done: ${c.text} — claim it in 🎁`, 'good'); this.refreshBadges(); });
    g.on('wagon', () => this.refreshPanel());
    g.on('project', () => this.refreshPanel());
    g.on('hearts', ({ npc, hearts, reward }) => { this.audio.play('quest'); this.toast(`${npc.icon} ${npc.name} ${'❤️'.repeat(Math.min(3, Math.ceil(hearts / 5)))} ${hearts} hearts — ${reward.text}!`, 'good'); });
    g.on('quest', () => this.refreshQuest());
    g.on('coins', () => { if (this.questGuide?.block?.kind === 'coins') this.renderQuestGuide(); });
    g.on('questComplete', () => { this.audio.play('quest'); this.refreshQuest(); this.questCard.classList.add('done-flash'); });
    g.on('toast', (t) => this.toast(t.text, t.type));
    g.on('levelup', (d) => this.showLevelUp(d));
    g.on('achievementReady', (a) => { this.audio.play('quest'); this.toast(`🏆 Achievement ready: ${a.name}!`, 'good'); this.refreshBadges(); });
    g.on('mastery', ({ type, stars: n, reward }) => {
      this.audio.play('quest');
      this.toast(`${ITEMS[type].icon} ${CROPS[type].name} mastery ${stars(n)}! ${reward.gems ? `+💎${reward.gems}` : ''}`, 'good');
    });
    g.on('storageUpgraded', ({ id, level }) => { this.toast(`${STORAGE[id].icon} ${STORAGE[id].name} upgraded to level ${level + 1}!`, 'good'); this.refreshPanel(); });
    g.on('post', () => { this.refreshPostPill(); this.refreshPanel(); });
    // Mabel's album: the 🏆 badge and an open Treasures panel follow every find and claim
    g.on('album', () => { this.refreshBadges(); if (this.panel?.id === 'treasures') this.refreshPanel(); });
    // Prettiest Farm: charm moved (decor placed, sold or gilded), ribbons claimed, a level reached (L19 opens it)
    g.on('charm', () => this.charmMoved());
    g.on('ribbons', () => { this.refreshBadges(); this.refreshLevelStar(); if (this.panel?.id === 'treasures') this.refreshPanel(); });
    g.on('levelup', () => this.refreshBadges());
    g.on('gifts', () => this.refreshBadges());
  }

  // the 🏆 badge follows charm; a newly reached ribbon rank bumps 🏆 once
  charmMoved() {
    const ready = this.game.charmStatus().ready;
    if (ready > (this._ribbonsReady || 0)) { const b = this.trophyBtn; b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
    this._ribbonsReady = ready;
    this.refreshBadges();
    if (this.panel?.id === 'treasures') this.refreshPanel();
  }

  refreshLevelStar() {
    this.rosetteEl.classList.toggle('hidden', !this.game.charmStatus().rosette);
  }

  refreshAll() {
    this.refreshLevelStar();
    this._ribbonsReady = this.game.charmStatus().ready;
    this.refreshCoins();
    this.refreshGems();
    this.refreshXp();
    this.refreshQuest();
    this.refreshBadges();
    this.setTool(this.ctrl.tool);
  }

  animateNumber(el, key, target) {
    const from = this[key] ?? target;
    this[key] = target;
    if (from === target) { el.textContent = fmtNum(target); return; }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 500);
      el.textContent = fmtNum(Math.round(from + (target - from) * t));
      if (t < 1 && this[key] === target) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  refreshCoins() { this.animateNumber(this.coinsEl, '_shownCoins', this.game.s.coins); }
  refreshGems() { this.animateNumber(this.gemsEl, '_shownGems', this.game.s.gems); }

  refreshXp() {
    const s = this.game.s;
    const lo = xpForLevel(s.level), hi = xpForLevel(s.level + 1);
    const p = (s.xp - lo) / (hi - lo);
    this.levelNum.textContent = s.level;
    this.xpFill.style.width = Math.max(3, Math.min(100, p * 100)) + '%';
    this.xpText.textContent = `${fmtNum(s.xp - lo)} / ${fmtNum(hi - lo)} XP`;
    let next = '';
    for (let l = s.level + 1; l <= s.level + 10 && !next; l++) {
      const u = unlocksAtLevel(l);
      if (u.length) next = `Next: ${u[0].icon} ${u[0].name} at Lv ${l}`;
    }
    this.nextHint.textContent = next;
  }

  refreshQuest() {
    const g = this.game;
    const q = g.currentQuest();
    const p = g.questProgress();
    this.questText.textContent = q.text;
    this.questProg.textContent = `${fmtNum(p)}/${fmtNum(q.count)}`;
    this.questFill.style.width = (p / q.count) * 100 + '%';
    const done = g.questDone();
    this.questCard.classList.toggle('done', done);
    this.questClaim.classList.toggle('hidden', !done);
    this.questIcon.textContent = done ? '🎁' : '📜';
    this.renderQuestGuide();
  }

  // hintOnly: show the text hint even when the goal could be claimed (long-press)
  questHint(hintOnly = false) {
    const q = this.game.currentQuest();
    if (!hintOnly && this.game.questDone()) { this.ctrl.claimQuest(); return; }
    this.toast(q.hint || `Goal: ${q.text}`, 'info');
  }

  // The guide describes the current goal; null clears it. Shape:
  // { chapter: {id,name,icon,done,total}|null, block: {kind:'coins'|'level'|'materials', text?, have?, need?, level?, items?}|null,
  //   wait: {icon, until, label?}|null, meanwhile: {icon, label, text?}|null, showMe: bool }
  // meanwhile.text replaces the whole "Meanwhile: <icon> <label>" wording (e.g. "Everything's busy!").
  setQuestGuide(info) {
    // the guide may call this several times a second; only rebuild when something changed
    const sig = info ? JSON.stringify(info) : '';
    if (sig === this._questGuideSig) return;
    this._questGuideSig = sig;
    this.questGuide = info || null;
    this.renderQuestGuide();
  }

  renderQuestGuide() {
    if (!this.questChapter) return;
    const info = this.questGuide || {};
    const done = this.game.questDone();
    const ch = info.chapter;
    this.questChapter.classList.toggle('hidden', !ch);
    if (ch) {
      this.questChapter.textContent = `Ch.${ch.id} · ${ch.done ?? 0}/${ch.total ?? '?'} 🎁`;
      this.questChapter.title = ch.name ? `Chapter ${ch.id}: ${ch.name}` : '';
    }
    this.renderQuestBlock(done ? null : info.block);
    const mw = !done && info.meanwhile;
    const wait = !done && info.wait;
    this.questMeanwhile.classList.toggle('hidden', !mw && !wait);
    this.questMeanwhile.classList.toggle('tappable', !!mw);
    const line = mw ? mw.text || `Meanwhile: ${mw.icon || ''} ${mw.label || ''}` : wait?.label || '';
    this.questMwLabel.textContent = line.replace(/\s+/g, ' ').trim();
    this.questMwPoint.classList.toggle('hidden', !mw);
    this.questShowMe.classList.toggle('hidden', done || !info.showMe);
    this.updateQuestTimer();
    this.layoutTop();
  }

  renderQuestBlock(b) {
    const el = this.questBlock;
    el.className = 'q-block' + (b ? ' ' + b.kind : ' hidden');
    el.innerHTML = '';
    if (!b) return;
    if (b.kind === 'coins') {
      const need = b.need || 1;
      const have = Math.min(need, b.have ?? this.game.s.coins);
      el.append(h('div', { class: 'q-coinbar' }, h('div', { style: `width:${Math.min(100, (have / need) * 100)}%` }), h('span', {}, b.text || `🪙${fmtNum(Math.floor(have))}/${fmtNum(need)}`)));
    } else if (b.kind === 'level') {
      el.textContent = b.text || `🔒 Reach Lv ${b.level ?? '?'}${b.need ? ` · ⭐ ${fmtNum(b.have ?? 0)}/${fmtNum(b.need)}` : ''}`;
    } else {
      const items = b.items ? Object.entries(b.items).map(([i, n]) => `${ITEMS[i]?.icon || i}${n}`).join(' ') : '';
      el.textContent = b.text || `🧰 needs ${items} · drops while you farm`;
    }
  }

  // the "⏳ 🥚 2:31" countdown in the Meanwhile row (ticks every second)
  updateQuestTimer() {
    const w = !this.game.questDone() && this.questGuide?.wait;
    this.questWait.classList.toggle('hidden', !w);
    if (w) this.questWait.textContent = `⏳ ${w.icon ? w.icon + ' ' : ''}${fmtClock(((w.until ?? 0) - this.game.now()) / 1000)}${this.questGuide.meanwhile || w.label ? ' ·' : ''}`;
  }

  // the tool hint sits just under the (variable-height) top bar on phones
  layoutTop() {
    if (!this.topBar?.isConnected) return;
    this.root.style.setProperty('--hud-top', Math.round(this.topBar.getBoundingClientRect().bottom) + 'px');
  }

  setBadge(btn, n, text) {
    const b = btn.querySelector('.badge');
    b.textContent = text ?? n;
    b.classList.toggle('hidden', !n);
  }

  refreshBadges() {
    const g = this.game;
    const ready = g.s.orders.filter((o) => !o.waitUntil && g.hasItems(o.items)).length;
    this.setBadge(this.ordersBtn, ready);
    // 🏆 = awards to claim + album pages to claim (+ ribbon ranks, with Prettiest Farm)
    const ribbons = g.features?.charm ? (g.charmStatus?.()?.ready || 0) : 0;
    this.setBadge(this.trophyBtn, g.achievementsReady() + g.albumPagesReady().length + ribbons);
    // a gift that waits in Shop → Decor (a reload before it went up, or a cancelled ghost)
    this.setBadge(this.shopBtn, (g.s.gifts || []).length, '🎁');
    const today = (g.dailyStatus().canClaim ? 1 : 0) + g.choresReady();
    this.setBadge(this.dailyBtn, today, today > 1 ? today : '!');
    let full = false;
    for (const id of Object.keys(STORAGE)) if (g.storageUsed(id) >= g.storageCap(id)) full = true;
    this.setBadge(this.barnBtnEl, full ? 1 : 0, '!');
  }

  setTool(tool) {
    for (const b of this.toolButtons) b.classList.toggle('active', b.dataset.tool === tool);
    this.seedBar.classList.toggle('hidden', tool !== 'seed');
    if (tool === 'seed') this.renderSeedBar();
    if (tool !== 'hand') this.closeSeedPopover();
    this.refreshToolHint(tool);
    this.uiChanged('tool');
  }

  // ---------------------------------------------------------------- progressive reveal
  // keys: quest, barn, level, gems, orders, shop, tools, today, trophy, camera (🧭), post ('all' = everything).
  // Hidden groups keep their layout slot (top bar) or collapse (toolbar), and pop in when revealed.
  setReveal(keys) {
    const all = keys == null || keys === 'all';
    this.revealSet = all ? 'all' : new Set(keys);
    this.applyReveal();
  }

  reveal(...keys) {
    if (this.revealSet === 'all') return;
    for (const k of keys.flat()) this.revealSet.add(k);
    this.applyReveal();
  }

  revealed(key) { return this.revealSet === 'all' || this.revealSet.has(key); }

  // the reveal key that would make this element visible, or null when nothing hides it
  revealKeyFor(el) {
    const hidden = el?.closest?.('.hud-hidden[data-reveal]');
    return hidden ? hidden.dataset.reveal : null;
  }

  applyReveal() {
    let changed = false;
    for (const el of this.revealEls) {
      const show = this.revealed(el.dataset.reveal);
      const was = !el.classList.contains('hud-hidden');
      if (show === was) continue;
      changed = true;
      el.classList.toggle('hud-hidden', !show);
      if (show) this.popIn(el);
      if (show && el === this.camBtn) setTimeout(() => this.pulseCamBtn(), 550); // after its pop-in
    }
    // a toolbar with nothing revealed hides its frame too (it keeps its height for safeRect)
    const anyTool = this.revealEls.some((el) => this.toolbar.contains(el) && !el.classList.contains('hud-hidden'));
    if (this.toolbar.classList.contains('hud-hidden') === anyTool) {
      this.toolbar.classList.toggle('hud-hidden', !anyTool);
      if (anyTool) this.popIn(this.toolbar);
    }
    if (changed) {
      this.layoutTop();
      if (!this.ctrl.placing) this.refreshToolHint(); // "two fingers to move or turn" once 🧭 is out
      this.uiChanged('reveal');
    }
  }

  popIn(el) {
    el.classList.remove('hud-pop');
    void el.offsetWidth;
    el.classList.add('hud-pop');
    const done = (e) => {
      if (e.target !== el) return; // badges inside animate too
      el.classList.remove('hud-pop');
      el.removeEventListener('animationend', done);
    };
    el.addEventListener('animationend', done);
  }

  refreshToolHint(tool = this.ctrl.tool) {
    const g = this.game;
    let plow = 'Tap or drag on grass to plow soil';
    const cap = g.plotCap(), n = g.plotCount();
    plow += ` · fields ${n}/${cap}`;
    if (n < cap && g.plowCost()) plow += ` · 🪙${g.plowCost()} each`;
    const hints = {
      plow,
      seed: 'Tap or drag on plowed soil to plant',
      remove: 'Tap soil, decorations or old trees to clear them',
    };
    const touch = matchMedia('(pointer: coarse)').matches;
    const twist = this.game.s.settings.twist !== false && this.revealed('camera');
    const extra = touch ? (twist ? ' · two fingers to move or turn' : ' · two fingers to move') : ' · right-drag / WASD to move';
    this.toolHint.textContent = hints[tool] ? hints[tool] + extra : '';
    this.toolHint.classList.toggle('hidden', !hints[tool]);
  }

  renderSeedBar() {
    const g = this.game;
    this.seedBar.innerHTML = '';
    const entries = Object.entries(CROPS);
    // show unlocked crops + only the next locked one, so the bar teases without spoiling everything
    const nextLocked = entries.filter(([id]) => !g.isUnlocked('crops', id)).sort((a, b) => a[1].level - b[1].level)[0];
    for (const [id, c] of entries) {
      const locked = !g.isUnlocked('crops', id);
      if (locked && (!nextLocked || id !== nextLocked[0])) continue;
      const st = g.masteryStars(id);
      const card = h('button', {
        class: 'seed-card' + (this.ctrl.seed === id ? ' active' : '') + (locked ? ' locked' : ''),
        'data-guide': 'seedbar:' + id,
        onclick: () => {
          if (locked) { this.toast(`${c.name} unlocks at level ${c.level}`, 'bad'); return; }
          this.audio.play('click');
          this.ctrl.seed = id;
          this.renderSeedBar();
        },
      },
      h('div', { class: 'seed-ico' }, ITEMS[id].icon),
      h('div', { class: 'seed-name' }, c.name),
      locked ? h('div', { class: 'seed-meta' }, `🔒 Lv ${c.level}`) : h('div', { class: 'seed-meta' }, `🪙${c.seedCost} · ${fmtTime(g.cropTime(id) / 1000)}`),
      !locked ? h('div', { class: 'seed-stars' + (st ? ' on' : '') }, stars(st)) : null,
      );
      this.seedBar.append(card);
    }
  }

  // opts.gift: placing a free chapter gift (shows "🎁 Gift" instead of a price)
  showPlaceBar(type, cost, opts = {}) {
    const info = this.placeBar.querySelector('.place-info');
    info.innerHTML = '';
    // (a move has no price line: Element.append would print a null)
    info.append(...[h('span', { class: 'place-name' }, `${OBJECTS[type].icon || ''} ${OBJECTS[type].name}`),
      opts.gift ? h('span', { class: 'place-cost gift' }, '🎁 Gift · free') : cost ? h('span', { class: 'place-cost' }, `🪙 ${fmtNum(cost)}`) : null].filter(Boolean));
    this.closeSeedPopover();
    this.placeBar.classList.remove('hidden');
    this.toolbar.classList.add('hidden');
    this.seedBar.classList.add('hidden');
    this.toolHint.textContent = matchMedia('(pointer: coarse)').matches ? 'Drag to position · ✓ to place' : 'Click to place · R to rotate · Esc to cancel';
    this.toolHint.classList.remove('hidden');
    this.uiChanged('placement');
  }

  hidePlaceBar() {
    this.placeBar.classList.add('hidden');
    this.placeOk.classList.remove('pulse');
    this.toolbar.classList.remove('hidden');
    this.setTool(this.ctrl.tool);
    this.uiChanged('placement');
  }

  // ---------------------------------------------------------------- seed popover (tap empty soil)
  // opts: { x, z, screen:{x,y}, crops:[{type, tag:'goal'|'order'|null}] | ['wheat',…], onPick(type), onMore() }
  openSeedPopover(opts, z, screen) {
    if (typeof opts === 'number') opts = { x: opts, z, screen };
    this.closeSeedPopover();
    const g = this.game;
    const sp = opts.screen || { x: innerWidth / 2, y: innerHeight / 2 };
    const crops = (opts.crops || this.defaultSeedList()).map((c) => (typeof c === 'string' ? { type: c, tag: null } : c)).filter((c) => CROPS[c?.type]);
    const tags = { goal: '★ Goal', order: '★ Order' };
    const list = h('div', { class: 'seed-pop-list' });
    for (const c of crops) {
      const def = CROPS[c.type];
      const poor = g.s.coins < def.seedCost;
      list.append(h('button', {
        class: 'seed-card pop' + (c.tag ? ' ' + c.tag : '') + (poor ? ' poor' : '') + (this.ctrl.seed === c.type ? ' active' : ''),
        'data-guide': 'seed:' + c.type,
        onclick: () => {
          if (poor) { this.toast(`${def.name} seeds cost 🪙${def.seedCost} — not enough coins!`, 'bad'); return; }
          this.audio.play('click');
          this.closeSeedPopover();
          if (opts.onPick) opts.onPick(c.type);
          else { this.ctrl.seed = c.type; this.ctrl.setTool('seed'); }
        },
      },
      c.tag && tags[c.tag] ? h('div', { class: 'seed-tag' }, tags[c.tag]) : null,
      h('div', { class: 'seed-ico' }, ITEMS[c.type].icon),
      h('div', { class: 'seed-name' }, def.name),
      h('div', { class: 'seed-meta' }, `🪙${def.seedCost} · ${fmtTime(g.cropTime(c.type) / 1000)}`),
      ));
    }
    // the Seeds tool only once the tool group (with its way back to the Hand) is shown
    if (this.revealed('tools')) {
      list.append(h('button', { class: 'seed-card pop more', 'data-guide': 'seed:more', onclick: () => {
        this.audio.play('click');
        this.closeSeedPopover();
        if (opts.onMore) opts.onMore();
        else this.ctrl.setTool('seed');
      } }, h('div', { class: 'seed-ico' }, '🌱'), h('div', { class: 'seed-name' }, 'Seeds tool ▸'), h('div', { class: 'seed-meta' }, 'drag to plant')));
    }
    const arrow = h('div', { class: 'seed-pop-arrow' });
    const el = h('div', { class: 'seed-pop' }, list, arrow);
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.append(el);
    // anchor above the tile; flip below when the top bar is in the way
    const safe = this.safeRect({ band: true });
    const w = el.offsetWidth, ht = el.offsetHeight; // layout size (the pop-in scale would skew a bounding rect)
    const left = Math.max(8, Math.min(innerWidth - 8 - w, sp.x - w / 2));
    let top = sp.y - 16 - ht;
    const below = top < safe.top;
    if (below) top = Math.min(sp.y + 16, innerHeight - 8 - ht);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.classList.toggle('below', below);
    arrow.style.left = Math.max(18, Math.min(w - 18, sp.x - left)) + 'px';
    // a tap anywhere else closes it (and still does what it would have done)
    const outside = (e) => { if (!el.contains(e.target)) this.closeSeedPopover(); };
    setTimeout(() => { if (this.seedPop?.el === el) document.addEventListener('pointerdown', outside, true); }, 0);
    this.seedPop = { el, x: opts.x, z: opts.z, outside };
    this.uiChanged('popover');
    return el;
  }

  // unlocked crops: last used first, then newest unlock first
  defaultSeedList() {
    const g = this.game;
    const ids = Object.keys(CROPS).filter((id) => g.isUnlocked('crops', id)).sort((a, b) => CROPS[b].level - CROPS[a].level);
    const last = ids.indexOf(this.ctrl.seed);
    if (last > 0) ids.unshift(...ids.splice(last, 1));
    return ids;
  }

  closeSeedPopover() {
    const p = this.seedPop;
    if (!p) return;
    this.seedPop = null;
    document.removeEventListener('pointerdown', p.outside, true);
    p.el.classList.add('out');
    setTimeout(() => p.el.remove(), 150);
    this.uiChanged('popover');
  }

  // { x, z } of the tile the open popover belongs to, or null
  seedPopoverOpen() { return this.seedPop ? { x: this.seedPop.x, z: this.seedPop.z } : null; }

  // ---------------------------------------------------------------- the Post (§2.5–2.6)
  // the pill (1 Hz, and after each opening): rewritten only when its text or state changes
  refreshPostPill() {
    const g = this.game, st = g.postStatus();
    const text = st.ready ? 'Open!' : postClock(st.msLeft);
    if (this._postText !== text) { this._postText = text; this.postText.textContent = text; }
    if (this._postReady !== st.ready) {
      this._postReady = st.ready;
      this.postPill.classList.toggle('ready', st.ready);
      this.postIco.textContent = st.ready ? '📬' : '📪';
      this.postPill.setAttribute('aria-label', st.ready ? 'The Post: a parcel is waiting — open it' : 'The Post: next parcel on its way');
    }
    const w = st.ready ? '100%' : (Math.max(0, Math.min(1, st.progress)) * 100).toFixed(1) + '%';
    if (this.postBar.style.width !== w) this.postBar.style.width = w;
    // one chime when a parcel turns up while you can see the pill (never for one already waiting at load)
    if (st.ready && !this._postWasReady && isShown(this.postPill)) { this.audio.play('quest'); this.popIn(this.postPill); }
    this._postWasReady = st.ready;
    if (this.postPop) this.renderPostPop();
  }

  postTap() {
    this.audio.play('click');
    if (this.game.postStatus().ready) this.showPost();
    else if (this.postPop) this.closePostPop();
    else this.openPostPop();
  }

  // the timeline strip of the welcome parcels: [{ label, state: 'done'|'next'|'' }] (n = parcels opened)
  postStrip(n) {
    const out = POST_AGES.map((label, i) => ({ label, state: i < n ? 'done' : i === n ? 'next' : '' }));
    out.push({ label: `then every ${POST.every / 3600}h`, state: n >= POST_AGES.length ? 'next' : '' });
    // each label keeps its mark (nowrap); the separators sit between the spans, so a narrow popover wraps the line
    // after a ' ·' (the dot stays with the label before it)
    return h('div', { class: 'post-strip' }, out.flatMap((x, i) => [h('span', { class: x.state },
      x.label, x.state === 'done' ? ' ✓' : x.state === 'next' ? ' ●' : ''), i < out.length - 1 ? h('i', {}, '\u00a0· ') : null]));
  }

  // tap on the waiting pill: what's coming and when (closes after 5 s or on a tap elsewhere)
  openPostPop() {
    this.closePostPop();
    this.closeCamPad();
    const el = h('div', { class: 'mini-pop post-pop', role: 'dialog', 'aria-label': 'The Post' });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.append(el);
    const outside = (e) => { if (!el.contains(e.target) && !this.postPill.contains(e.target)) this.closePostPop(); };
    this.postPop = { el, outside };
    this.renderPostPop();
    const r = this.row3.getBoundingClientRect();
    el.style.top = Math.round(r.bottom + 6) + 'px';
    el.style.right = Math.round(innerWidth - r.right) + 'px';
    setTimeout(() => { if (this.postPop?.el === el) document.addEventListener('pointerdown', outside, true); }, 0);
    clearTimeout(this._postPopTimer);
    this._postPopTimer = setTimeout(() => this.closePostPop(), 5000);
    this.uiChanged('popover');
  }

  renderPostPop() {
    const p = this.postPop;
    if (!p) return;
    const st = this.game.postStatus();
    const sig = `${st.ready}|${Math.ceil(st.msLeft / 1000)}|${st.n}|${st.teaser.label}`;
    if (p.sig === sig) return;
    p.sig = sig;
    p.el.innerHTML = '';
    p.el.append(...[
      st.ready
        ? h('div', { class: 'pp-head' }, h('b', {}, '📬 The Post'), ' · a parcel is waiting!')
        : h('div', { class: 'pp-head' }, h('b', {}, '📪 The Post'), ' · next in ', h('b', {}, fmtClock(st.msLeft / 1000))),
      h('div', {}, `Next: ${st.teaser.label}`),
      st.intro ? this.postStrip(st.n) : null,
      h('div', { class: 'muted small' }, 'It waits for you and never piles up.'),
      st.ready ? h('button', { class: 'btn small', onclick: () => { this.closePostPop(); this.showPost(); } }, 'Open') : null,
    ].filter(Boolean));
  }

  closePostPop() {
    const p = this.postPop;
    if (!p) return;
    this.postPop = null;
    clearTimeout(this._postPopTimer);
    document.removeEventListener('pointerdown', p.outside, true);
    p.el.remove();
    this.uiChanged('popover');
  }

  // The parcel modal (data-modal="post"): the wrapped parcel with its sender and note → Open! ✨ (the parcel is
  // opened right then: ctrl.claimPost) → the tiles pop in → Lovely! sends them flying home. One data-guide key for
  // both buttons. Never shown by itself: the pill, the Today row, the Mailbox or a tip open it. Esc before Open
  // closes it unopened; Enter presses the button.
  showPost() {
    const g = this.game;
    this.closePostPop();
    if (this.topModalKind() === 'post') return null;
    if (!g.postStatus().ready) { this.openPostPop(); return null; }
    const c = g.postContents();
    const npc = VISITORS.npcs.find((x) => x.id === c.sender);
    const reduced = !!this.ctrl.world?.prefersReducedMotion;
    const what = c.wrap === 'postcard' ? 'A postcard' : c.wrap === 'big' && c.kind !== 'office' ? 'A big parcel' : 'A parcel';
    const wrap = h('div', { class: `post-wrap ${c.wrap}` }, h('span', { class: 'pw-ico' }, c.wrap === 'postcard' ? '📨' : '📦'), c.wrap === 'big' ? h('span', { class: 'pw-bow' }, '🎀') : null);
    const tiles = h('div', { class: 'lu-list post-tiles' });
    const foot = h('div', { class: 'post-foot' });
    const btn = h('button', { class: 'btn wide', 'data-guide': 'modal:post:open' }, 'Open! ✨');
    const daily = this.revealed('today') && g.dailyStatus().canClaim ? h('div', { class: 'muted small' }, 'Your daily gift is in 🎁 Today') : null;
    const modal = h('div', { class: 'levelup daily post-modal' + (reduced ? ' still' : '') },
      wrap,
      h('div', { class: 'post-title' }, `${what} from ${npc ? npc.name : 'Grandma Mabel'}!`),
      h('div', { class: 'post-note' }, `“${c.note}”`),
      tiles, foot, btn, daily);
    let state = 'closed', res = null;
    const open = () => {
      if (state !== 'closed') return;
      res = this.ctrl.claimPost?.() || null;
      if (!res) { back._close(); return; }
      state = 'opening';
      wrap.classList.add('shake');
      const reveal = () => {
        wrap.classList.remove('shake');
        wrap.classList.add('popped');
        res.tiles.forEach((t, i) => {
          const el = this.postTile(t);
          el.style.animationDelay = (reduced ? 0 : i * 120) + 'ms';
          tiles.append(el);
        });
        if (res.wrap === 'big' && !reduced) this.confetti(30);
        const at = res.next.at - g.now();
        foot.append(h('div', { class: 'muted small' }, `Next: ${res.next.label} — in ${postClock(at)}`));
        if (!res.office && g.s.post.n <= POST.welcome.length) foot.append(this.postStrip(g.s.post.n));
        btn.textContent = 'Lovely!';
        state = 'open';
      };
      if (reduced) reveal(); else setTimeout(reveal, 600);
    };
    btn.addEventListener('click', () => { if (state === 'closed') open(); else if (state === 'open') back._close(); });
    const back = this.showModal('post', modal, () => {
      clearTimeout(this._postPopTimer);
      if (!res) return;
      // the tiles fly home: 🪙 → coins, 💎 → gems, goods → 📦, keepsakes → 🏆, a gold decor → 🏪
      const els = [...tiles.children];
      res.tiles.forEach((t, i) => {
        const r = els[i]?.getBoundingClientRect();
        const target = t.kind === 'coins' ? this.coinsPill : t.kind === 'gems' ? this.gemsPill : t.kind === 'item' ? this.barnBtn
          : t.kind === 'keepsake' ? this.flyTarget(this.trophyBtn) : t.kind === 'gift' && !t.place ? this.flyTarget(this.shopBtn) : null;
        if (!r || !r.width || !target || !this.ctrl.effects) return;
        this.ctrl.effects.flyFrom(r.left + r.width / 2, r.top + r.height / 2, this.postTileIcon(t), target, { delay: i * 90 });
      });
      this.refreshPostPill();
      this.ctrl.postClosed?.(res);
    });
    back._enter = () => btn.click();
    // (the parcel is already paid for while it shakes: neither Esc nor the dim skips its reveal)
    back._esc = () => { if (state !== 'opening') back._close(); };
    back.addEventListener('click', (e) => { if (back._outside(e) && state !== 'opening') back._close(); });
    return back;
  }

  postTileIcon(t) {
    if (t.kind === 'coins') return '🪙';
    if (t.kind === 'gems') return '💎';
    if (t.kind === 'item') return ITEMS[t.item]?.icon || '📦';
    if (t.kind === 'keepsake') return KEEPSAKES[t.id]?.icon || '🔖';
    if (t.kind === 'gift') return OBJECTS[t.type]?.icon || '🎁';
    return '✨';
  }

  // one reward tile of the parcel modal (a keepsake flips from a ? to the find)
  postTile(t) {
    const icon = this.postTileIcon(t);
    if (t.kind === 'keepsake') {
      const k = KEEPSAKES[t.id];
      return h('div', { class: 'lu-item post-tile keepsake' },
        h('span', { class: 'pt-flip' }, h('b', { class: 'pt-q' }, '?'), h('b', { class: 'pt-k' }, icon)),
        h('small', {}, k ? k.name : 'Keepsake'), h('small', { class: 'muted' }, 'for Mabel\'s album'));
    }
    const label = t.kind === 'coins' ? `+${fmtNum(t.n)}` : t.kind === 'gems' ? `+${t.n}` : t.kind === 'item' ? `${t.n}× ${ITEMS[t.item]?.name || t.item}`
      : t.kind === 'gift' ? (t.place ? `${OBJECTS[t.type].name} · put it up!` : `${OBJECTS[t.type].name} · in Shop → Decor 🎁`)
        : t.kind === 'voucher' ? `Gilding voucher${t.n > 1 ? ` ×${t.n}` : ''}` : '';
    return h('div', { class: 'lu-item post-tile' + (t.kind === 'gift' ? ' gift' : '') }, h('span', {}, icon), h('small', {}, label));
  }

  // ---------------------------------------------------------------- 🧭 turn & tilt (§1.7)
  get rig() { return this.ctrl.world?.rig || null; }

  buildCamPad() {
    const cell = (dir, label, aria, key, act) => h('button', {
      class: 'cam-cell', 'data-guide': 'cam:' + dir, 'data-dir': dir, 'aria-label': aria, title: `${aria} (${key})`,
      onclick: () => this.camPadPress(dir, act),
    }, h('span', { class: 'cam-ico', html: CAM_ICONS[dir] }), h('span', { class: 'cam-lbl' }, label));
    this.camCells = {
      up: cell('up', 'Top', 'Higher view', 'X', () => this.rig.tiltStep(+1)),
      // each arrow turns the farm the way it points, as a two-finger twist does (Q is ↻, E is ↺)
      left: cell('left', 'Left', 'Turn the farm left', 'E', () => this.rig.rotateStep(PAD_TURN.left)),
      home: cell('home', 'Home', 'Home view', 'C', () => this.ctrl.camHome()),
      right: cell('right', 'Right', 'Turn the farm right', 'Q', () => this.rig.rotateStep(PAD_TURN.right)),
      down: cell('down', 'Side', 'Lower view', 'Z', () => this.rig.tiltStep(-1)),
    };
    const c = this.camCells, gap = () => h('span', { class: 'cam-gap' });
    const pad = h('div', { class: 'cam-pad hidden', role: 'group', 'aria-label': 'View' }, gap(), c.up, gap(), c.left, c.home, c.right, gap(), c.down, gap());
    // a press inside the pad is never a press on the farm behind it
    pad.addEventListener('pointerdown', (e) => e.stopPropagation());
    return pad;
  }

  // 🧭: tap opens / closes the pad, a 0.6 s hold goes Home, a drag past 6 px orbits (turn + tilt)
  bindCamBtn() {
    const b = this.camBtn;
    let st = null;
    b.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      b.setPointerCapture?.(e.pointerId);
      const cur = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, drag: false, long: false };
      cur.timer = setTimeout(() => { if (st === cur && !cur.drag) { cur.long = true; this.camLongPress(); } }, CAMERA.longPress * 1000);
      st = cur;
    });
    b.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id || st.long) return;
      if (!st.drag && Math.hypot(e.clientX - st.x, e.clientY - st.y) > CAMERA.dragStart) {
        st.drag = true;
        clearTimeout(st.timer);
        this.closeCamPad();
      }
      if (st.drag) {
        this.rig?.orbitBy(e.clientX - st.lx, e.clientY - st.ly);
        st.lx = e.clientX; st.ly = e.clientY;
      }
    });
    const end = (e, cancelled) => {
      if (!st || e.pointerId !== st.id) return;
      const s0 = st;
      st = null;
      clearTimeout(s0.timer);
      this._camUpAt = performance.now();
      if (s0.drag) { this.rig?.snapYaw(); this.rig?.onView?.(); } else if (!s0.long && !cancelled) this.camTap();
    };
    b.addEventListener('pointerup', (e) => end(e, false));
    b.addEventListener('pointercancel', (e) => end(e, true));
    // the click after a press was handled on pointerup; a keyboard click (Enter / Space) toggles the pad
    b.addEventListener('click', () => { if (performance.now() - (this._camUpAt || 0) > 600) this.camTap(); });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  camTap() {
    if (this.rig?.locked) return;
    this.audio.play('click');
    if (this.camPadOpen()) this.closeCamPad(); else this.openCamPad();
  }

  camLongPress() {
    if (!this.ctrl.camHome?.()) return;
    this.audio.play('click');
    this.closeCamPad();
    this.toast('View reset', 'info');
  }

  openCamPad() {
    if (this.rig?.locked || this.camPadOpen()) return;
    const r = this.row3.getBoundingClientRect(); // (not 🧭 itself: its pop / pulse scales its box)
    this.camPad.style.top = Math.round(r.bottom + 6) + 'px';
    this.camPad.style.right = Math.round(innerWidth - r.right) + 'px';
    this.camPad.classList.remove('hidden');
    this.camBtn.setAttribute('aria-expanded', 'true');
    this.camBtn.classList.add('open');
    this.refreshCamPad(true);
    this.camIdle();
    this.uiChanged('campad');
  }

  closeCamPad() {
    if (!this.camPadOpen()) return;
    clearTimeout(this._camIdle);
    this.camPad.classList.add('hidden');
    this.camBtn.setAttribute('aria-expanded', 'false');
    this.camBtn.classList.remove('open');
    this.uiChanged('campad');
  }

  camPadOpen() { return !!this.camPad && !this.camPad.classList.contains('hidden'); }

  // the boxes of the always-there HUD (top bar clusters and the toolbar): world bubbles fade under them
  hudRects() {
    return [this.levelBoxEl, this.questCard, this.pills, this.roundBtns, this.postPill, this.camBtn, this.toolbar, this.placeBar, this.seedBar]
      .filter(isShown).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
  }

  // the pad closes after CAMERA.padIdle s without a press
  camIdle() {
    clearTimeout(this._camIdle);
    this._camIdle = setTimeout(() => this.closeCamPad(), CAMERA.padIdle * 1000);
  }

  camPadPress(dir, act) {
    if (!this.camPadOpen()) return;
    this.camIdle();
    if (this.camCells[dir].classList.contains('disabled')) return;
    this.audio.play('click');
    act();
    this.refreshCamPad(true);
  }

  // greyed buttons: Top at the highest tilt, Side at the lowest, everything while a hard beat holds the camera
  refreshCamPad(force = false) {
    const rig = this.rig;
    if (!rig || (!force && !this.camPadOpen())) return;
    const { min, max } = CAMERA.pitch, locked = !!rig.locked;
    const off = { up: locked || rig.goal.pitch >= max - 0.005, down: locked || rig.goal.pitch <= min + 0.005, left: locked, right: locked, home: locked };
    const sig = JSON.stringify(off);
    if (!force && sig === this._camPadSig) return;
    this._camPadSig = sig;
    for (const [dir, el] of Object.entries(this.camCells)) {
      el.classList.toggle('disabled', off[dir]);
      el.setAttribute('aria-disabled', off[dir] ? 'true' : 'false');
    }
  }

  // every frame (cheap): the needle follows the turn, the dot says the view is not Home
  updateCompass(force = false) {
    const rig = this.rig;
    if (!rig) return;
    if (force || this._needleYaw == null || Math.abs(rig.yaw - this._needleYaw) > 0.005) {
      this._needleYaw = rig.yaw;
      // the needle turns with the farm: ↻ / Q / a clockwise twist turn both clockwise, ↺ / E anticlockwise
      this.camNeedle?.setAttribute('transform', `rotate(${needleDeg(rig.yaw).toFixed(2)})`);
    }
    const away = !isHome(rig.goal.yaw, rig.goal.pitch);
    if (away !== this._camAway) { this._camAway = away; this.camDot.classList.toggle('hidden', !away); }
    if (this.camPadOpen()) this.refreshCamPad();
  }

  // a hard beat holds the camera: 🧭 dims and its pad closes
  camLocked(locked) {
    this.camBtn.classList.toggle('locked', !!locked);
    if (locked) this.closeCamPad();
    else this.refreshCamPad();
  }

  // 🧭 has just appeared (or a tip points at it): two gentle pulses
  pulseCamBtn() {
    const b = this.camBtn;
    b.classList.remove('cam-pulse');
    void b.offsetWidth;
    b.classList.add('cam-pulse');
    setTimeout(() => b.classList.remove('cam-pulse'), 2600);
  }

  renderCameraSettings(set) {
    const twist = this.game.s.settings.twist !== false;
    return h('div', { class: 'cam-settings' },
      h('button', { class: 'toggle' + (twist ? ' on' : ''), onclick: () => { set('twist', !twist); this.refreshToolHint(); } },
        h('span', {}, '🧭 Two-finger turn: ', h('b', {}, twist ? 'On' : 'Off')), h('span', { class: 'knob' })),
      h('div', { class: 'cam-row' },
        h('button', { class: 'btn small ghost', onclick: () => { this.closePanel(); this.ctrl.camHome(); } }, '🎥 Reset view'),
        h('div', { class: 'muted small' }, matchMedia('(pointer: coarse)').matches
          ? 'Turn: twist two fingers · 🧭 · Q/E. Tilt: 🧭 · Z/X. Home: hold 🧭 · C.'
          : 'Turn: 🧭 · Q/E · middle-drag. Tilt: 🧭 · Z/X · Shift+wheel. Home: hold 🧭 · C.')),
    );
  }

  // ---------------------------------------------------------------- guide queries
  // The free screen area between the top bar and the bottom bars (for camera framing): { left, top, right, bottom }.
  // Guide elements can join in with data-safe-top / data-safe-bottom (e.g. a docked guide card).
  // band: always the full-width band (otherwise a wide screen may get the roomier area beside the goal card).
  safeRect({ band = false } = {}) {
    // HUD pieces at the top / bottom of the screen, as rects (Mabel's docked card marks itself data-safe-*)
    const rects = (els) => [...els].filter(isShown).map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
    // (the 🧭 view pad is transient and never counts)
    const tops = rects([this.levelBoxEl, this.questCard, this.pills, this.roundBtns, this.postPill, this.camBtn, this.toolHint, ...document.querySelectorAll('[data-safe-top]')]);
    // the toolbar counts even before it is revealed, so framing doesn't jump when it appears
    const bots = [this.toolbar, this.seedBar, this.placeBar].filter((el) => el.isConnected && !el.classList.contains('hidden'))
      .map((el) => el.getBoundingClientRect()).concat(rects(document.querySelectorAll('[data-safe-bottom]')));
    // the clear area over the columns l..r: below what is up top there, above what is down below
    const span = (l, r) => {
      const on = (b) => b.right > l && b.left < r;
      const top = Math.max(0, ...tops.filter(on).map((b) => b.bottom));
      const bottom = Math.min(innerHeight, ...bots.filter(on).map((b) => b.top));
      return { left: l, top: top + 8, right: r, bottom: Math.max(top + 16, bottom - 8) };
    };
    const full = span(12, innerWidth - 12);
    if (band) return full;
    // wide, short screens: the area beside the left column (level box + goal card) is often far roomier
    const col = Math.max(0, ...tops.filter((b) => b.left < innerWidth * 0.25 && b.right < innerWidth / 2).map((b) => b.right));
    if (!col || innerWidth - 12 - (col + 8) < innerWidth / 2) return full;
    const side = span(col + 8, innerWidth - 12);
    const area = (r) => (r.right - r.left) * (r.bottom - r.top);
    return area(side) > area(full) * 1.15 ? side : full;
  }

  // { id, tab, ref, openedAt } of the open panel, or null
  panelInfo() {
    const p = this.panel;
    return p ? { id: p.id ?? null, tab: p.tab ?? null, ref: p.ref ?? null, openedAt: p.openedAt } : null;
  }

  // true while level-ups are being merged into one modal (it shows a moment after the first 'levelup')
  levelUpPending() { return !!this._luPending; }

  // 'levelup' | 'daily' | 'chest' | 'post' | 'guide' | null — the modal on top. A guide marks its own modal with data-modal="guide".
  topModalKind() {
    const m = this.topModal();
    if (m) return m.dataset.modal || 'levelup';
    return document.querySelector('[data-modal="guide"]:not(.hidden)') ? 'guide' : null;
  }

  toast(text, type = 'info') {
    // de-duplicate rapid identical toasts
    const now = performance.now();
    if (this._lastToast === text && now - this._lastToastT < 1500) return;
    this._lastToast = text; this._lastToastT = now;
    if (type === 'bad') this.audio.play('error');
    const el = h('div', { class: 'toast ' + type }, text);
    this.toasts.append(el);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3000);
  }

  tick() {
    this.game.ensureOrders();
    this.game.postTick();
    this.refreshPostPill();
    this.refreshBadges();
    this.updateQuestTimer();
    if (this.panel && this.panel.live && !this._pressing) this.refreshPanel(true);
  }

  // ---------------------------------------------------------------- panels
  // id: what the panel is ('shop', 'barn', 'orders', 'visitor', 'factory', 'pen', 'crop', 'tree', 'decor',
  // 'farmhouse', 'project', 'today'); ref: which one (object id, visitor id, project id, {x,z});
  // tabKey: data-guide prefix of its tabs (defaults to id).
  openPanel({ id = null, ref = null, tabKey, title, tabs, tab, render, live = false, cls = '' }) {
    this.closePanel(true);
    this.closeSeedPopover();
    const body = h('div', { class: 'panel-body' });
    const tabBar = tabs ? h('div', { class: 'tabs' }) : null;
    const panel = { id, ref, tabKey: tabKey || id, title, tabs, tab: tab || (tabs && tabs[0].id), render, live, body, tabBar, openedAt: performance.now() };
    const sheet = h('div', { class: 'sheet ' + cls },
      h('div', { class: 'sheet-head' }, h('div', { class: 'sheet-title' }, title), h('button', { class: 'close', 'data-guide': 'panel:close', onclick: () => this.closePanel() }, '✕')),
      tabBar, body,
    );
    // a tap outside the sheet closes it, but not the click a phone sends right after the very tap that opened it
    // (a building tapped on the farm, the Clear tool on a gift): that one lands on the new backdrop
    const backdrop = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === backdrop && performance.now() - panel.openedAt > 400) this.closePanel(); } }, sheet);
    panel.el = backdrop;
    this.panel = panel;
    this.modalLayer.append(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));
    this.refreshPanel();
    this.uiChanged('panel');
  }

  refreshPanel(fromTick = false) {
    const p = this.panel;
    if (!p) return;
    if (!fromTick && this._pressing) { clearTimeout(this._deferRefresh); this._deferRefresh = setTimeout(() => this.refreshPanel(), 50); return; }
    if (p.tabBar && p.renderedTab !== p.tab) {
      p.renderedTab = p.tab;
      p.tabBar.innerHTML = '';
      for (const t of p.tabs) {
        p.tabBar.append(h('button', {
          class: 'tab' + (t.id === p.tab ? ' active' : ''),
          'data-guide': p.tabKey ? `${p.tabKey}:tab:${t.id}` : null,
          onclick: () => { this.audio.play('click'); p.tab = t.id; p.body.scrollTop = 0; this.refreshPanel(); this.uiChanged('tab'); },
        }, t.label));
      }
    }
    const scroll = p.body.scrollTop;
    p.body.innerHTML = '';
    p.body.append(p.render(p.tab));
    p.body.scrollTop = scroll;
    p.lastTab = p.tab;
    if (p.id === 'treasures' && p.tabBar) {
      // a dot on a tab with something new or to claim (the tab bar itself is rebuilt only when the tab changes)
      const dots = this.treasureDots();
      for (const b of p.tabBar.children) b.classList.toggle('has-new', !!dots[b.dataset.guide?.split(':').pop()]);
    }
  }

  // { album, ribbons, awards }: which 🏆 tabs hold something new (an unseen keepsake) or to claim
  treasureDots() {
    const g = this.game;
    return {
      album: g.albumOpen() && (g.s.album.fresh?.length > 0 || g.albumPagesReady().length > 0),
      ribbons: g.charmStatus().ready > 0,
      awards: g.achievementsReady() > 0,
    };
  }

  closePanel(instant = false) {
    const p = this.panel;
    if (!p) return;
    this.panel = null;
    if (instant) { p.el.remove(); return; }
    p.el.classList.remove('open');
    setTimeout(() => p.el.remove(), 250);
    this.uiChanged('panel');
  }

  // tab to open when the caller didn't ask for one: the guide's pick if it's a real tab, else the first
  pickTab(panelId, tabs, fallback) {
    const want = this.hook('preferredTab', panelId);
    return tabs.some((t) => t.id === want) ? want : fallback;
  }

  gemButton(cost, label, fn, cls = 'small gem') {
    return h('button', { class: 'btn ' + cls + (this.game.s.gems < cost ? ' disabled' : ''), onclick: () => {
      if (this.game.s.gems < cost) { this.toast('Not enough gems 💎', 'bad'); return; }
      fn();
    } }, `${label} 💎${cost}`);
  }

  // ---------------------------------------------------------------- missing inputs ("where do I get this?")
  // Requirement chips: red ones are tappable and lead the guide to the missing item.
  itemList(req) {
    const g = this.game;
    return Object.entries(req).map(([i, n]) => {
      const have = g.count(i);
      return have >= n
        ? h('span', { class: 'r-in ok' }, `${ITEMS[i].icon}${have}/${n}`)
        : h('span', { class: 'r-in miss', 'data-guide': 'missing:' + i, onclick: (e) => { e.stopPropagation(); this.missingTap(i); } }, `${ITEMS[i].icon}${have}/${n}`);
    });
  }

  missingTap(item) {
    this.audio.play('click');
    if (!this.hasHook('onMissing')) { this.toast(this.missingHint(item), 'info'); return; }
    this.closePanel();
    this.hook('onMissing', item);
  }

  // where an item comes from, in one line (fallback when no guide is listening)
  missingHint(item) {
    const it = ITEMS[item];
    const what = `${it.icon} ${it.name}`;
    if (CROPS[item]) {
      return this.game.isUnlocked('crops', item) ? `${what}: plant it on plowed soil 🌱` : `${what} seeds unlock at level ${CROPS[item].level}`;
    }
    const animal = Object.values(ANIMALS).find((a) => a.product === item);
    if (animal) return `${what} comes from ${animal.icon} ${animal.plural || animal.name.toLowerCase() + 's'} — tap their home to collect`;
    const r = RECIPES[item];
    if (r) return `${what} is made in the ${OBJECTS[r.building].icon} ${OBJECTS[r.building].name}`;
    const tree = Object.values(OBJECTS).find((d) => d.kind === 'tree' && d.fruit === item);
    if (tree) return `${what} grows on ${tree.icon} ${tree.name}s`;
    if (it.cat === 'material') return `${what}s drop while you farm, fill orders and serve visitors`;
    return `Get more ${what}`;
  }

  // ---------------------------------------------------------------- shop
  openShop(tab) {
    const tabs = [{ id: 'buildings', label: '🏠 Buildings' }, { id: 'animals', label: '🐮 Animals' }, { id: 'trees', label: '🍎 Trees' }, { id: 'decor', label: '🌳 Decor' }, { id: 'land', label: '🗺️ Land' }];
    this.openPanel({
      id: 'shop',
      title: '🏪 Shop',
      tabs,
      tab: tab || this.pickTab('shop', tabs, 'buildings'),
      render: (t) => this.renderShop(t),
    });
  }

  shopCard({ icon, name, cost, level, desc, sub, onBuy, disabled, items, guide }) {
    const g = this.game;
    const locked = level > g.s.level;
    const cant = !locked && cost > g.s.coins;
    const missing = items && !g.hasItems(items);
    return h('div', { class: 'card' + (locked ? ' locked' : ''), 'data-guide': locked ? guide : null },
      h('div', { class: 'card-ico' }, locked ? '❔' : icon),
      h('div', { class: 'card-name' }, name),
      desc && !locked ? h('div', { class: 'card-desc' }, desc) : null,
      sub && !locked ? h('div', { class: 'card-sub' }, sub) : null,
      items && !locked ? h('div', { class: 'r-inputs center' }, this.itemList(items)) : null,
      locked
        ? h('div', { class: 'card-lock' }, `🔒 Level ${level}`)
        : h('button', { class: 'btn buy' + (cant || disabled || missing ? ' disabled' : ''), 'data-guide': guide, onclick: () => {
          if (disabled) { this.toast(disabled, 'bad'); return; }
          if (cant) { this.toast('Not enough coins!', 'bad'); return; }
          if (missing) { this.toast('Missing materials — they drop from harvests, animals, orders and visitors', 'bad'); return; }
          onBuy();
        } }, cost ? `🪙 ${fmtNum(cost)}` : 'Free'),
    );
  }

  // Locked items further than the next couple of levels are hidden to keep surprises for later.
  visibleAtLevel(level) { return level <= this.game.s.level + 3; }

  renderShop(tab) {
    const g = this.game;
    const grid = h('div', { class: 'grid' });
    const hidden = { n: 0 };
    const addCards = (filter, make) => {
      const list = Object.entries(OBJECTS).filter(([, d]) => filter(d)).sort((a, b) => a[1].level - b[1].level);
      for (const [id, d] of list) {
        if (!this.visibleAtLevel(d.level)) { hidden.n++; continue; }
        grid.append(make(id, d));
      }
    };
    if (tab === 'buildings') {
      addCards((d) => d.kind === 'pen' || d.kind === 'factory' || (d.kind === 'special' && d.buyable), (id, d) => {
        const owned = g.objectCount(id);
        const limit = g.objectLimit(id);
        const atLimit = owned >= limit;
        const nextLvl = atLimit && d.limit ? nextUnlockLevel((l) => d.limit(l), g.s.level, owned) : null;
        return this.shopCard({
          icon: d.icon, name: d.name, cost: g.objectCost(id), level: d.level, desc: d.desc, items: d.items, guide: 'shop:buy:' + id,
          sub: `Owned ${owned}${Number.isFinite(limit) ? `/${limit}` : ''}`,
          disabled: atLimit ? (nextLvl ? `Reach level ${nextLvl} to build another` : 'You have the maximum') : null,
          onBuy: () => { this.closePanel(); this.ctrl.startPlacement(id); },
        });
      });
    } else if (tab === 'animals') {
      for (const [id, a] of Object.entries(ANIMALS).sort((x, y) => x[1].level - y[1].level)) {
        if (!this.visibleAtLevel(a.level)) { hidden.n++; continue; }
        const homes = g.s.objects.filter((o) => o.type === a.home);
        const count = g.s.animals.filter((x) => x.type === id).length;
        const cap = homes.reduce((n, o) => n + g.homeCapacity(o), 0);
        const noHome = !homes.length ? `Build a ${OBJECTS[a.home].name} first` : count >= cap ? `${OBJECTS[a.home].name} is full` : null;
        grid.append(this.shopCard({
          icon: a.icon, name: a.name, cost: g.animalCost(id), level: g.isUnlocked('animals', id) ? 1 : a.level,
          desc: a.food ? `Eats ${a.foodQty} ${ITEMS[a.food].icon} → ${ITEMS[a.product].icon} every ${fmtTime(a.time)}` : `Makes ${ITEMS[a.product].icon} every ${fmtTime(a.time)} — no feed needed`,
          sub: homes.length ? `${count}/${cap} in ${OBJECTS[a.home].name}` : `Needs ${OBJECTS[a.home].name}`,
          disabled: noHome,
          guide: 'shop:animal:' + id,
          onBuy: () => this.ctrl.buyAnimal(id),
        }));
      }
    } else if (tab === 'trees') {
      addCards((d) => d.kind === 'tree', (id, d) => this.shopCard({
        icon: d.icon, name: d.name, cost: g.objectCost(id), level: d.level, guide: 'shop:buy:' + id,
        desc: `${ITEMS[d.fruit].icon}×${d.yield} every ${fmtTime(d.fruitTime)} · ${d.harvests} harvests`,
        sub: `Grows in ${fmtTime(d.growTime)}`,
        onBuy: () => { this.closePanel(); this.ctrl.startPlacement(id); },
      }));
    } else if (tab === 'decor') {
      // (one-of-a-kind decorations, level 99, only ever come as gifts)
      // (from L19) what one more adds to 💗 charm: up to 3 of each kind count
      const charm = g.charmStatus().unlocked ? g.charm() : null;
      const charmLine = (id) => {
        if (!charm) return null;
        const n = charm.kinds[id]?.counted || 0;
        return n < CHARM.perKind ? `💗 +${fmtNum(CHARM.of(id))} · ${n}/${CHARM.perKind} counted` : '💗 maxed — still pretty!';
      };
      addCards((d) => d.kind === 'decor' && d.level < 99, (id, d) => this.shopCard({ icon: d.icon, name: d.name, cost: d.cost, level: d.level, guide: 'shop:buy:' + id, sub: charmLine(id), onBuy: () => { this.closePanel(); this.ctrl.startPlacement(id); } }));
      const gifts = this.renderGifts();
      if (gifts) return h('div', {}, gifts, grid, hidden.n ? h('div', { class: 'tip' }, `✨ ${hidden.n} more to discover as you level up`) : null);
    } else if (tab === 'land') {
      const e = g.nextExpansion();
      const wrap = h('div', { class: 'land-tab' });
      wrap.append(h('div', { class: 'land-ico' }, '🗺️'), h('div', { class: 'land-size' }, `Your farm: ${g.s.landSize} × ${g.s.landSize}`));
      if (!e) wrap.append(h('p', {}, 'You own all the land! 🎉'));
      else {
        wrap.append(h('p', {}, `Clear the wild meadow and grow to ${e.size} × ${e.size} tiles.`));
        wrap.append(this.shopCard({ icon: '🌲', name: 'Expand Land', cost: e.coins, level: e.level, items: e.items, guide: 'shop:land:expand', onBuy: () => { this.closePanel(); this.ctrl.expandLand(); } }));
      }
      return wrap;
    }
    const wrap = h('div', {}, grid);
    if (hidden.n) wrap.append(h('div', { class: 'tip' }, `✨ ${hidden.n} more to discover as you level up`));
    return wrap;
  }

  // "🎁 Your gifts": chapter-chest decor waiting to be put up (free, from s.gifts), and prizes that were put away
  // ({ type, gilded }: one goes back up gold)
  renderGifts() {
    const counts = new Map(), gilt = new Set();
    for (const gf of this.game.s.gifts || []) {
      const type = giftType(gf);
      if (OBJECTS[type]) counts.set(type, (counts.get(type) || 0) + 1);
      if (gf?.gilded) gilt.add(type);
    }
    if (!counts.size) return null;
    const row = h('div', { class: 'gift-cards' });
    for (const [type, n] of counts) {
      const d = OBJECTS[type];
      row.append(h('button', { class: 'gift-card', 'data-guide': 'shop:gift:' + type, onclick: () => {
        this.audio.play('click');
        this.closePanel();
        this.ctrl.startPlacement(type, { gift: true });
      } },
      n > 1 ? h('span', { class: 'gift-n' }, '×' + n) : null,
      h('div', { class: 'card-ico' }, d.icon),
      h('div', { class: 'card-name' }, (gilt.has(type) ? '✨ ' : '') + d.name),
      h('div', { class: 'btn small' }, 'Place · Free')));
    }
    return h('div', { class: 'gifts' }, h('div', { class: 'gifts-head' }, '🎁 Your gifts', h('span', { class: 'muted small' }, ' · free to place')), row);
  }

  // ---------------------------------------------------------------- barn / storage
  openBarn(tab) {
    const ids = Object.keys(STORAGE);
    const tabs = [...ids.map((id) => ({ id, label: `${STORAGE[id].icon} ${STORAGE[id].name}` })), { id: 'toolshed', label: '🧰 Toolshed' }];
    this.openPanel({
      id: 'barn',
      tabKey: 'storage',
      title: '📦 Storage',
      tabs,
      tab: tab || this.pickTab('barn', tabs, ids[0]),
      render: (t) => (t === 'toolshed' ? this.renderToolshed() : this.renderBarn(t || ids[0])),
    });
  }

  renderToolshed() {
    const g = this.game;
    const wrap = h('div', {});
    wrap.append(h('div', { class: 'muted small' }, 'Building materials never take storage space. They drop while you farm (more from bigger jobs), and from orders & visitors.'));
    const entries = Object.entries(g.s.inventory).filter(([i, n]) => n > 0 && g.storageOf(i) === null);
    if (!entries.length) { wrap.append(h('div', { class: 'empty' }, 'No materials yet — keep farming! 🔩🪵🎨')); return wrap; }
    const grid = h('div', { class: 'grid items' });
    for (const [id, n] of entries) {
      grid.append(h('div', { class: 'item-card material' }, h('div', { class: 'item-ico' }, ITEMS[id].icon), h('div', { class: 'item-count' }, '×' + n), h('div', { class: 'item-name' }, ITEMS[id].name)));
    }
    wrap.append(grid);
    return wrap;
  }

  renderBarn(sid) {
    const g = this.game;
    const st = STORAGE[sid];
    const wrap = h('div', {});
    const used = g.storageUsed(sid), cap = g.storageCap(sid);
    wrap.append(h('div', { class: 'cap-row' },
      h('div', { class: 'cap-label' }, `${st.icon} ${st.name} · Lv ${(g.s.storage[sid] || 0) + 1}`),
      h('div', { class: 'cap-bar' + (used >= cap ? ' full' : '') }, h('div', { style: `width:${Math.min(100, (used / cap) * 100)}%` }), h('span', {}, `${used} / ${cap}`)),
    ));
    const entries = Object.entries(g.s.inventory).filter(([i, n]) => n > 0 && g.storageOf(i) === sid);
    if (!entries.length) wrap.append(h('div', { class: 'empty' }, `Empty. ${st.emptyHint || ''}`));
    else {
      const grid = h('div', { class: 'grid items' });
      for (const [id, n] of entries) {
        const it = ITEMS[id];
        const sel = this._sellSel === id;
        grid.append(h('div', { class: 'item-card' + (sel ? ' active' : '') + (it.cat === 'material' ? ' material' : ''), 'data-guide': 'storage:item:' + id, onclick: () => { this._sellSel = sel ? null : id; this.audio.play('click'); this.refreshPanel(); } },
          h('div', { class: 'item-ico' }, it.icon),
          h('div', { class: 'item-count' }, '×' + n),
          h('div', { class: 'item-name' }, it.name),
          h('div', { class: 'item-price' }, `🪙 ${it.price}`),
        ));
      }
      wrap.append(grid);
    }
    if (this._sellSel && g.count(this._sellSel) && g.storageOf(this._sellSel) === sid) {
      const id = this._sellSel, it = ITEMS[id], n = g.count(id);
      const sellBtn = (q, label, key = null) => h('button', { class: 'btn', 'data-guide': key, onclick: () => this.ctrl.sell(id, q) }, label);
      wrap.append(h('div', { class: 'sell-bar' },
        h('div', {}, `${it.icon} ${it.name} ×${n}`, it.cat === 'material' ? h('div', { class: 'muted small' }, 'Used for upgrades & land') : null),
        h('div', { class: 'sell-btns' }, sellBtn(1, `Sell 1 · 🪙${it.price}`, 'storage:sell:' + id), n > 1 ? sellBtn(n, `Sell all · 🪙${it.price * n}`) : null),
      ));
    }
    if (used >= cap * 0.9) {
      wrap.append(h('div', { class: 'panel-foot center' }, h('button', { class: 'btn small', 'data-guide': 'storage:sellExtras:' + sid, onclick: () => {
        const earned = g.sellExtras(sid, 10, this.hook('sellFloors') || {});
        if (earned) { this.audio.play('coin'); this.toast(`Sold extras for 🪙${fmtNum(earned)}`, 'good'); }
        this.refreshPanel();
      } }, '🧹 Sell extras (keep 10 of each)')));
    }
    const up = g.nextStorageUpgrade(sid);
    if (up && up.locked) {
      wrap.append(h('div', { class: 'upgrade-card' }, h('div', { class: 'up-title' }, `⬆️ Next upgrade (${up.capacity} capacity) at level ${up.needLevel}`), h('div', { class: 'r-inputs' }, h('span', { class: 'r-in' }, `🪙${fmtNum(up.coins)}`), this.itemList(up.items))));
    } else if (up) {
      const can = g.s.coins >= up.coins && g.hasItems(up.items);
      wrap.append(h('div', { class: 'upgrade-card' },
        h('div', { class: 'up-title' }, `⬆️ Upgrade to ${up.capacity} capacity`),
        h('div', { class: 'r-inputs' }, h('span', { class: 'r-in ' + (g.s.coins >= up.coins ? 'ok' : 'miss') }, `🪙${fmtNum(up.coins)}`), this.itemList(up.items)),
        h('div', { class: 'up-btns' },
          h('button', { class: 'btn small' + (can ? '' : ' disabled'), 'data-guide': 'storage:upgrade:' + sid, onclick: () => this.ctrl.upgradeStorage(sid) }, 'Upgrade'),
          !g.hasItems(up.items) ? this.gemButton(g.gemPriceFor(up.items), 'Buy missing', () => { if (g.buyMissing(up.items)) { this.audio.play('coin'); this.refreshPanel(); } }) : null,
        ),
        h('div', { class: 'muted small' }, 'Materials drop randomly from harvests, animals, production, orders and visitors.'),
      ));
    } else wrap.append(h('div', { class: 'tip' }, 'Fully upgraded! 🎉'));
    wrap.append(h('div', { class: 'tip' }, '💡 Orders and visitors pay much more than selling here.'));
    return wrap;
  }

  // ---------------------------------------------------------------- orders
  openOrders(tab) {
    const wagon = this.game.s.level >= WAGON.level;
    const tabs = wagon ? [{ id: 'orders', label: '🚚 Orders' }, { id: 'wagon', label: '🛒 Market Wagon' }] : null;
    this.openPanel({
      id: 'orders',
      title: '🚚 Orders',
      tabs,
      tab: wagon ? tab || this.pickTab('orders', tabs, 'orders') : 'orders',
      live: true,
      render: (t) => (t === 'wagon' ? this.renderWagon() : this.renderOrders()),
    });
  }

  renderWagon() {
    const g = this.game;
    const w = g.s.wagon;
    const wrap = h('div', {});
    if (!w) return h('div', { class: 'empty' }, 'The wagon is on its way…');
    const now = g.now();
    if (w.state === 'away') {
      wrap.append(h('div', { class: 'empty' }, '🛒 The wagon is off to market.', h('div', { class: 'muted' }, `Back in ${fmtTime((w.returnsAt - now) / 1000)}`)));
      wrap.append(h('div', { class: 'panel-foot center' }, this.gemButton(g.speedUpCost(w.returnsAt - now), 'Call it back', () => { if (g.speedUpWagon()) { this.audio.play('truck'); this.refreshPanel(); } })));
      return wrap;
    }
    const filled = w.crates.filter((c) => c.filled).length;
    wrap.append(h('div', { class: 'pen-head' }, `${filled}/${w.crates.length} crates filled · leaves in ${fmtTime((w.leavesAt - now) / 1000)} · fill them all for a bonus (+25% coins, materials & gems)`));
    const grid = h('div', { class: 'crates' });
    w.crates.forEach((c, i) => {
      const have = g.count(c.item);
      grid.append(h('div', { class: 'crate' + (c.filled ? ' filled' : have >= c.qty ? ' ready' : '') },
        h('div', { class: 'oi-ico' }, c.filled ? '✅' : ITEMS[c.item].icon),
        h('div', { class: 'oi-n' }, c.filled ? 'Shipped' : `${Math.min(have, c.qty)}/${c.qty}`),
        !c.filled ? h('div', { class: 'muted small' }, `🪙${fmtNum(c.coins)} ⭐${c.xp}`) : null,
        !c.filled ? h('button', { class: 'btn tiny' + (have >= c.qty ? '' : ' disabled'), onclick: () => this.ctrl.fillCrate(i) }, 'Fill') : null,
      ));
    });
    wrap.append(grid);
    return wrap;
  }

  renderOrders() {
    const g = this.game;
    const grid = h('div', { class: 'orders' });
    const now = g.now();
    // orders you can fill right now come first, then open ones, then the ones still on their way
    const rank = (o) => (o.waitUntil ? 2 : g.hasItems(o.items) ? 0 : 1);
    const list = g.s.orders.map((o, i) => [o, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([o]) => o);
    for (const o of list) {
      if (o.waitUntil) {
        grid.append(h('div', { class: 'order waiting' }, h('div', { class: 'order-wait' }, '⏳'), h('div', { class: 'muted' }, `New order in ${fmtTime((o.waitUntil - now) / 1000)}`)));
        continue;
      }
      const can = g.hasItems(o.items);
      const items = h('div', { class: 'order-items' });
      for (const [id, n] of Object.entries(o.items)) {
        const have = g.count(id);
        items.append(this.wantChip(id, n));
      }
      grid.append(h('div', { class: 'order' + (can ? ' ready' : '') },
        items,
        h('div', { class: 'order-reward' }, h('span', {}, `🪙 ${fmtNum(o.coins)}`), h('span', {}, `⭐ ${o.xp}`)),
        h('div', { class: 'order-btns' },
          h('button', { class: 'btn small ghost', title: 'Discard', onclick: () => { this.audio.play('click'); g.discardOrder(o.id); } }, '🗑️'),
          h('button', { class: 'btn small' + (can ? '' : ' disabled'), 'data-guide': 'order:deliver:' + o.id, onclick: () => this.ctrl.deliverOrder(o.id) }, 'Deliver'),
        ),
      ));
    }
    return grid;
  }

  // one wanted item of an order / visitor: "🌾 4/8", red and tappable while you're short
  wantChip(id, n) {
    const have = this.game.count(id);
    const ok = have >= n;
    return h('div', {
      class: 'order-item ' + (ok ? 'ok' : 'miss'),
      'data-guide': ok ? null : 'missing:' + id,
      onclick: ok ? null : (e) => { e.stopPropagation(); this.missingTap(id); },
    }, h('span', { class: 'oi-ico' }, ITEMS[id].icon), h('span', { class: 'oi-n' }, `${Math.min(have, n)}/${n}`));
  }

  // ---------------------------------------------------------------- visitors
  openVisitor(v) {
    this.openPanel({ id: 'visitor', ref: v.id, title: '👋 Visitor', cls: 'small', live: true, render: () => this.renderVisitor(v.id) });
  }

  renderVisitor(id) {
    const g = this.game;
    const v = g.s.visitors.find((x) => x.id === id);
    if (!v) { setTimeout(() => this.closePanel(), 0); return h('div', {}); }
    const npc = VISITORS.npcs.find((n) => n.id === v.npc);
    const it = ITEMS[v.item];
    const have = g.count(v.item);
    const line = this.hook('visitorLine', v) || (v.first && VISITORS.firstLine) || npc.line;
    return h('div', { class: 'visitor-panel' },
      h('div', { class: 'v-head' }, h('div', { class: 'v-face', style: `background:${npc.color}` }, npc.icon), h('div', {},
        h('div', { class: 'v-name' }, npc.name, h('span', { class: 'v-hearts' }, ` ❤️ ${g.s.hearts[npc.id] || 0}/${VISITORS.maxHearts}`)),
        h('div', { class: 'v-line' }, `“${line.replace('{item}', it.name.toLowerCase())}”`),
        h('div', { class: 'muted small' }, `Likes ${npc.likes.map((c) => ({ crop: 'crops', animal: 'animal goods', goods: 'homemade goods', fruit: 'fruit' }[c] || c)).join(' & ')} (extra ❤️)`),
      )),
      h('div', { class: 'v-want' },
        this.wantChip(v.item, v.qty),
        h('div', { class: 'order-reward' }, h('span', {}, `🪙 ${fmtNum(v.coins)}`), h('span', {}, `⭐ ${v.xp}`)),
      ),
      h('div', { class: 'muted small center' }, 'Happy to wait as long as you need 🙂'),
      h('div', { class: 'panel-foot center' },
        h('button', { class: 'btn ghost', onclick: () => { this.ctrl.dismissVisitor(v.id); this.closePanel(); } }, 'No thanks'),
        h('button', { class: 'btn' + (have >= v.qty ? '' : ' disabled'), 'data-guide': 'visitor:sell', onclick: () => { if (this.ctrl.serveVisitor(v.id)) this.closePanel(); } }, `Sell ${it.icon}×${v.qty}`),
      ),
    );
  }

  // ---------------------------------------------------------------- factory
  openFactory(o) {
    this.openPanel({ id: 'factory', ref: o.id, title: `${OBJECTS[o.type].icon} ${OBJECTS[o.type].name}`, live: true, render: () => this.renderFactory(o) });
  }

  renderFactory(o) {
    const g = this.game;
    const def = OBJECTS[o.type];
    const wrap = h('div', {});
    const q = g.factoryQueue(o);
    const slots = h('div', { class: 'slots' });
    const now = g.now();
    const size = g.queueSize(o);
    for (let i = 0; i < size; i++) {
      const j = q[i];
      if (!j) { slots.append(h('div', { class: 'slot empty' }, '+')); continue; }
      const it = ITEMS[j.recipe];
      const active = !j.done && (i === 0 || q[i - 1].done);
      slots.append(h('div', { class: 'slot' + (j.done ? ' done' : '') },
        h('div', { class: 'slot-ico' }, it.icon),
        j.done ? h('div', { class: 'slot-t' }, 'Ready!') : h('div', { class: 'slot-t' }, active ? fmtTime((j.endAt - now) / 1000) : 'Queued'),
        !j.done ? h('div', { class: 'slot-bar' }, h('div', { style: `width:${j.progress * 100}%` })) : null,
      ));
    }
    const slotCost = g.extraSlotCost(o);
    if (slotCost) {
      const canCoins = g.s.level >= slotCost.level;
      slots.append(h('div', { class: 'slot empty buy-slot' },
        h('div', {}, '🔒'),
        h('button', { class: 'btn tiny' + (canCoins && g.s.coins >= slotCost.coins ? '' : ' disabled'), onclick: () => {
          if (g.buyExtraSlot(o)) { this.audio.play('build'); this.refreshPanel(); }
        } }, canCoins ? `🪙${fmtNum(slotCost.coins)}` : `Lv ${slotCost.level}`),
        h('button', { class: 'btn tiny gem' + (g.s.gems >= slotCost.gems ? '' : ' disabled'), onclick: () => {
          if (g.buyExtraSlot(o, true)) { this.audio.play('build'); this.refreshPanel(); }
        } }, `💎${slotCost.gems}`),
      ));
    }
    wrap.append(slots);
    const btns = h('div', { class: 'panel-foot center' });
    if (q.some((j) => j.done)) btns.append(h('button', { class: 'btn', 'data-guide': 'factory:collect', onclick: () => { this.ctrl.collectFactory(o); } }, 'Collect ✨'));
    const active = q.find((j) => !j.done);
    if (active) {
      // the first bread of a new farm is on the house (a once-per-save rule in the model)
      const free = !!g.freeFinishAvailable?.(o);
      const finish = free
        ? h('button', { class: 'btn small free pulse', onclick: () => { if (g.speedUpFactory(o, { free: true })) { this.audio.play('coin'); this.refreshPanel(); } } }, 'Finish now · Free!')
        : this.gemButton(g.speedUpCost(active.endAt - now), 'Finish now', () => { if (g.speedUpFactory(o)) { this.audio.play('coin'); this.refreshPanel(); } });
      finish.dataset.guide = 'factory:finish';
      btns.append(finish);
    }
    if (btns.children.length) wrap.append(btns);
    const goal = this.hook('goalRecipe', o.type);
    const list = h('div', { class: 'recipes' });
    for (const [id, r] of Object.entries(RECIPES)) {
      if (r.building !== o.type) continue;
      const it = ITEMS[id];
      if (!g.isUnlocked('recipes', id)) {
        list.append(h('div', { class: 'recipe locked' }, h('div', { class: 'r-ico' }, '❔'), h('div', { class: 'r-mid' }, h('div', { class: 'r-name' }, `New recipe at level ${r.level}`))));
        continue;
      }
      const can = g.hasItems(r.inputs);
      list.append(h('div', { class: 'recipe' + (goal === id ? ' goal' : '') },
        goal === id ? h('div', { class: 'r-goal' }, '★ Goal') : null,
        h('div', { class: 'r-ico' }, it.icon),
        h('div', { class: 'r-mid' }, h('div', { class: 'r-name' }, it.name, h('span', { class: 'muted' }, ` · ${fmtTime(r.time)} · 🪙${it.price}`)), h('div', { class: 'r-inputs' }, this.itemList(r.inputs))),
        h('button', { class: 'btn small' + (can && o.jobs.length < size ? '' : ' disabled'), 'data-guide': 'factory:make:' + id, onclick: () => this.ctrl.startRecipe(o, id) }, 'Make'),
      ));
    }
    wrap.append(list);
    wrap.append(h('div', { class: 'panel-foot' }, h('button', { class: 'btn small ghost', onclick: () => { this.closePanel(); this.ctrl.startPlacement(o.type, o.id); } }, '✥ Move')));
    return wrap;
  }

  // ---------------------------------------------------------------- pen
  openPen(o) {
    this.openPanel({ id: 'pen', ref: o.id, title: `${OBJECTS[o.type].icon} ${OBJECTS[o.type].name}`, live: true, render: () => this.renderPen(o) });
  }

  renderPen(o) {
    const g = this.game;
    const def = OBJECTS[o.type];
    const a = ANIMALS[def.animal];
    const list = g.animalsIn(o.id);
    const now = g.now();
    const cap = g.homeCapacity(o);
    const wrap = h('div', {});
    wrap.append(h('div', { class: 'pen-head' }, a.food
      ? `${list.length}/${cap} ${a.plural || a.name.toLowerCase() + 's'} · each eats ${g.animalFood(def.animal).qty} ${ITEMS[g.animalFood(def.animal).item].icon} (you have ${g.count(g.animalFood(def.animal).item)})`
      : `${list.length}/${cap} ${a.plural || a.name.toLowerCase() + 's'} · no feed needed`));
    const grid = h('div', { class: 'animals' });
    for (const an of list) {
      const st = g.animalState(an, now);
      const cost = st === 'producing' ? g.speedUpCost(an.readyAt - now) : 0;
      const arming = this._armAnimal === an.id;
      grid.append(h('div', { class: 'animal-card ' + st + (arming ? ' arming' : ''), onclick: () => {
        if (st !== 'producing') return;
        if (g.s.gems < cost) { this.toast(`Finishing early costs 💎${cost}`, 'bad'); return; }
        if (!arming) { this._armAnimal = an.id; this.refreshPanel(); return; } // first tap arms, second tap buys
        this._armAnimal = null;
        if (g.speedUpAnimal(an)) this.audio.play('coin');
        this.refreshPanel();
      } },
      h('div', { class: 'a-ico' }, a.icon),
      h('div', { class: 'a-st' }, st === 'ready' ? `${ITEMS[a.product].icon} Ready` : st === 'hungry' ? (a.food ? 'Hungry' : 'Idle') : arming ? `Tap: 💎${cost}` : fmtTime((an.readyAt - now) / 1000)),
      st === 'producing' && !arming ? h('div', { class: 'a-gem' }, `💎${cost}`) : null,
      ));
    }
    for (let i = list.length; i < cap; i++) grid.append(h('div', { class: 'animal-card empty' }, h('div', { class: 'a-ico' }, '·')));
    wrap.append(grid);
    const btns = h('div', { class: 'panel-foot' });
    if (list.some((x) => g.animalState(x, now) !== 'producing')) btns.append(h('button', { class: 'btn', 'data-guide': 'pen:tend', onclick: () => { this.closePanel(); this.ctrl.tendPen(o, true); } }, a.food ? 'Feed & collect' : 'Collect'));
    if (list.length < cap) {
      const poor = !g.isUnlocked('animals', def.animal) || g.s.coins < g.animalCost(def.animal);
      btns.append(h('button', {
        class: 'btn' + (poor ? ' disabled' : this.hook('isGoal', 'pen:buy') ? ' pulse' : ''),
        'data-guide': 'pen:buy',
        onclick: () => this.ctrl.buyAnimal(def.animal),
      }, `Buy ${a.icon} 🪙${fmtNum(g.animalCost(def.animal))}`));
    }
    btns.append(h('button', { class: 'btn small ghost', onclick: () => { this.closePanel(); this.ctrl.startPlacement(o.type, o.id); } }, '✥ Move'));
    wrap.append(btns);
    return wrap;
  }

  // ---------------------------------------------------------------- crops & trees info
  openCropInfo(x, z) {
    this.openPanel({ id: 'crop', ref: { x, z }, title: '🌱 Field', cls: 'small', live: true, render: () => {
      const g = this.game;
      const soil = g.soilAt(x, z);
      if (!soil || !soil.crop) { setTimeout(() => this.closePanel(), 0); return h('div', {}); }
      const type = soil.crop.type;
      const left = g.cropReadyAt(soil.crop) - g.now();
      if (left <= 0) { setTimeout(() => this.closePanel(), 0); return h('div', {}); }
      const st = g.masteryStars(type);
      const th = MASTERY.thresholds(type);
      return h('div', { class: 'info-panel' },
        h('div', { class: 'info-big' }, ITEMS[type].icon),
        h('div', { class: 'info-title' }, `${CROPS[type].name} · ready in ${fmtTime(left / 1000)}`),
        h('div', { class: 'muted' }, `Mastery ${stars(st)}${st < th.length ? ` · ${g.s.mastery[type] || 0}/${th[st]} harvested` : ' · mastered!'}`),
        h('div', { class: 'muted small' }, MASTERY.describe),
      );
    } });
  }

  openTree(o) {
    this.openPanel({ id: 'tree', ref: o.id, title: `${OBJECTS[o.type].icon} ${OBJECTS[o.type].name}`, cls: 'small', live: true, render: () => {
      const g = this.game;
      const d = OBJECTS[o.type];
      if (!g.objById.get(o.id)) { setTimeout(() => this.closePanel(), 0); return h('div', {}); }
      const st = g.treeState(o);
      const left = (g.treeReadyAt(o) - g.now()) / 1000;
      const remaining = d.harvests - (o.harvests || 0);
      return h('div', { class: 'info-panel' },
        h('div', { class: 'info-big' }, st === 'dead' ? '🪵' : ITEMS[d.fruit].icon),
        h('div', { class: 'info-title' }, st === 'dead' ? 'This old tree is done fruiting.' : st === 'growing' ? `Growing · first fruit in ${fmtTime(left)}` : st === 'ready' ? 'Ripe — tap the tree to pick!' : `Next fruit in ${fmtTime(left)}`),
        st !== 'dead' ? h('div', { class: 'muted' }, `${remaining} harvest${remaining === 1 ? '' : 's'} left`) : h('div', { class: 'muted' }, 'Clear it to make room (may drop materials).'),
        h('div', { class: 'panel-foot center' },
          st === 'dead' ? h('button', { class: 'btn', onclick: () => { this.closePanel(); this.ctrl.removeObject(o); } }, 'Clear tree') : null,
          st !== 'dead' && this.ctrl.tool === 'remove' ? h('button', { class: 'btn red', onclick: () => { this.closePanel(); this.ctrl.removeObject(o); } }, 'Remove anyway') : null,
          h('button', { class: 'btn small ghost', onclick: () => { this.closePanel(); this.ctrl.startPlacement(o.type, o.id); } }, '✥ Move'),
        ),
      );
    } });
  }

  // ---------------------------------------------------------------- decor
  // Move / Sell (a one-of-a-kind prize: Put away, back to 🎁 Your gifts); from L19 the charm it adds (💗 60 · counts (2/3)); from L31 on premium pieces ✨ Gild (coins + gems,
  // or a voucher). Gilding, and selling a gilded piece (its gilding is never refunded), take a second tap.
  openDecor(o) {
    const d = OBJECTS[o.type];
    const arm = { gild: null, sell: false, t: 0 };
    // an armed button (gild, sell gilded) goes back to normal after 4 s
    const disarm = () => {
      clearTimeout(arm.t);
      arm.t = setTimeout(() => { arm.gild = null; arm.sell = false; if (this.panel?.id === 'decor' && this.panel.ref === o.id) this.refreshPanel(); }, 4000);
    };
    const mailbox = o.type === 'mailbox';
    this.openPanel({
      id: 'decor', ref: o.id,
      title: `${o.gilded ? '✨ ' : ''}${d.icon} ${d.name}`, cls: 'small',
      live: mailbox, // (its countdown ticks, and a parcel that turns up offers Open)
      render: () => {
        const g = this.game;
        const st = g.charmStatus();
        const wrap = h('div', { class: 'decor-panel' });
        if (mailbox) {
          const ps = g.postStatus();
          wrap.append(ps.ready
            ? h('div', { class: 'center' }, '📬 A parcel is waiting! ',
              h('button', { class: 'btn small', onclick: () => { this.audio.play('click'); this.closePanel(true); this.showPost(); } }, 'Open'))
            : h('div', { class: 'muted small center' }, `📪 Next parcel in ${postClock(ps.msLeft)}`));
        }
        if (st.unlocked) {
          const k = g.charm().kinds[o.type] || { counted: 0 };
          const v = g.charm().of(o);
          wrap.append(h('div', { class: 'decor-charm' + (v ? '' : ' muted') }, v
            ? `💗 ${fmtNum(v)}${o.gilded ? ' · gilded ×3' : ''} · counts (${k.counted}/${CHARM.perKind})`
            : `💗 0 · only ${CHARM.perKind} of each kind count — this one is just for looks`));
        }
        const cost = g.gildCost(o);
        if (cost) {
          const press = (key, fn) => () => {
            if (arm.gild !== key) { arm.gild = key; this.audio.play('click'); disarm(); this.refreshPanel(); return; }
            this.closePanel();
            fn();
          };
          // what it really adds to the farm's charm (nothing once three gilded ones of its kind count): then no
          // scarce voucher is offered, and the paid button says it's for looks
          const gain = g.gildGain(o);
          const gilds = h('div', { class: 'gild-btns' });
          if (cost.voucher && gain > 0) {
            gilds.append(h('button', { class: 'btn gild' + (arm.gild === 'voucher' ? ' armed' : ''), onclick: press('voucher', () => this.ctrl.gild?.(o, { voucher: true })) },
              arm.gild === 'voucher' ? '✨ Tap again to gild' : `✨ Gild with a voucher (${st.vouchers} left)`));
          }
          const afford = g.s.coins >= cost.coins && g.s.gems >= cost.gems;
          gilds.append(h('button', { class: 'btn gild' + (cost.voucher ? ' ghost' : '') + (afford ? '' : ' disabled') + (arm.gild === 'coins' ? ' armed' : ''),
            onclick: afford ? press('coins', () => this.ctrl.gild?.(o)) : () => this.toast(g.s.coins < cost.coins ? 'Not enough coins!' : 'Not enough gems 💎', 'bad') },
          arm.gild === 'coins' ? '✨ Tap again to gild' : `✨ Gild${gain > 0 ? '' : ' for looks'} — 🪙${fmtNum(cost.coins)} 💎${cost.gems}`));
          wrap.append(gilds, h('div', { class: 'muted small center' }, gain > 0
            ? `Gold, and +💗${fmtNum(gain)} charm.`
            : `Gold for looks: ${CHARM.perKind} gilded ones of this kind already count, so no more 💗.`));
        } else if (o.gilded) {
          wrap.append(h('div', { class: 'muted small center' }, '✨ Gilded: it shines gold and counts triple.'));
        } else if (st.unlocked && !st.gildUnlocked && CHARM.gildBase(o.type) >= CHARM.gildMin) {
          wrap.append(h('div', { class: 'muted small center' }, `✨ Gilding opens at level ${CHARM.gildLevel}: gold, and triple 💗.`));
        }
        // a free one (starter decor, a gift) refunds nothing; a gilded one's gilding is never refunded. A one-of-a-kind
        // piece (a prize, never sold) is put away instead, gilding and all: back to Shop → Decor → 🎁, nothing lost
        const keep = oneOfAKind(o.type);
        const sellText = keep ? '📦 Put away' : o.free ? 'Remove' : `Sell 🪙${fmtNum(Math.floor(d.cost / 2))}`;
        wrap.append(h('div', { class: 'panel-foot center' },
          h('button', { class: 'btn', onclick: () => { this.closePanel(); this.ctrl.startPlacement(o.type, o.id); } }, '✥ Move'),
          h('button', { class: 'btn' + (keep ? ' ghost' : ' red') + (arm.sell ? ' armed' : ''), onclick: () => {
            if (o.gilded && !keep && !arm.sell) { arm.sell = true; this.audio.play('click'); disarm(); this.refreshPanel(); return; }
            this.closePanel();
            this.ctrl.removeObject(o);
          } }, arm.sell ? `${sellText} · the gilding is lost` : sellText),
        ));
        return wrap;
      },
    });
  }

  // ---------------------------------------------------------------- farmhouse: progress / village / settings
  // (achievements moved to 🏆 Treasures → Awards)
  openFarmhouse(tab) {
    const tabs = [{ id: 'progress', label: '⭐ Progress' }, { id: 'village', label: '🏘️ Village' }, { id: 'farm', label: '⚙️ Settings' }];
    this.openPanel({
      id: 'farmhouse',
      title: '🏡 Your Farm',
      tabs,
      tab: tabs.some((t) => t.id === tab) ? tab : this.pickTab('farmhouse', tabs, 'progress'),
      live: true,
      render: (t) => (t === 'farm' ? this.renderSettings() : t === 'village' ? this.renderVillage() : this.renderProgress()),
    });
  }

  renderProgress() {
    const g = this.game;
    const s = g.s;
    const wrap = h('div', { class: 'farm-panel' });
    // titles earned (Mabel's album, the Prettiest Farm ribbons)
    const titles = s.charm?.titles || [];
    if (titles.length) wrap.append(h('div', { class: 'farm-titles' }, titles.map((x) => h('span', { class: 'farm-title' }, `🏅 ${x}`))));
    wrap.append(h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', {}, s.level), h('span', {}, 'Level')),
      h('div', { class: 'stat' }, h('b', {}, fmtNum(s.stats.harvested)), h('span', {}, 'Harvested')),
      h('div', { class: 'stat' }, h('b', {}, s.stats.orders), h('span', {}, 'Orders')),
      h('div', { class: 'stat' }, h('b', {}, g.stat('visitors')), h('span', {}, 'Visitors')),
    ));
    // upcoming unlocks: next few levels only
    const up = h('div', { class: 'upcoming' }, h('b', {}, 'Coming up'));
    let shown = 0;
    for (let l = s.level + 1; l <= s.level + 12 && shown < 4; l++) {
      const u = unlocksAtLevel(l);
      if (!u.length) continue;
      shown++;
      up.append(h('div', { class: 'up-row' }, h('span', { class: 'up-lvl' }, `Lv ${l}`), h('span', {}, u.map((x) => x.icon).join(' ')), h('span', { class: 'muted small' }, u.map((x) => x.name).join(', '))));
    }
    if (!shown) up.append(h('div', { class: 'muted' }, 'More content is on the way!'));
    wrap.append(up);
    // mastery overview
    const m = h('div', { class: 'upcoming' }, h('b', {}, 'Crop mastery'));
    for (const [id, c] of Object.entries(CROPS)) {
      if (!g.isUnlocked('crops', id)) continue;
      const st = g.masteryStars(id);
      const th = MASTERY.thresholds(id);
      m.append(h('div', { class: 'up-row' }, h('span', {}, ITEMS[id].icon), h('span', { class: 'seed-stars on' }, stars(st)), h('span', { class: 'muted small' }, st < th.length ? `${s.mastery[id] || 0}/${th[st]}` : 'Mastered')));
    }
    wrap.append(m);
    wrap.append(h('div', { class: 'muted small center' }, `Fields: ${g.plotCount()}/${g.plotCap()} · Land: ${s.landSize}×${s.landSize}`));
    return wrap;
  }

  renderVillage() {
    const g = this.game;
    const wrap = h('div', { class: 'farm-panel' });
    const friends = h('div', { class: 'upcoming' }, h('b', {}, 'Friends'));
    for (const n of VISITORS.npcs) {
      const unlocked = g.s.level >= n.level;
      friends.append(h('div', { class: 'up-row' }, h('span', { class: 'v-face tiny', style: `background:${n.color}` }, unlocked ? n.icon : '❔'),
        h('span', {}, unlocked ? n.name : `Visits from level ${n.level}`),
        unlocked ? h('span', { class: 'v-hearts' }, `❤️ ${g.s.hearts[n.id] || 0}/${VISITORS.maxHearts}`) : null));
    }
    wrap.append(friends);
    const projects = h('div', { class: 'upcoming' }, h('b', {}, 'Village projects'));
    for (const [id, p] of Object.entries(PROJECTS)) {
      const st = g.s.projects[id]?.stage || 0;
      const done = st >= p.stages.length;
      projects.append(h('div', { class: 'up-row clickable', onclick: () => { if (g.s.level >= p.level) this.openProject(id); else this.toast(`${p.name} can be restored from level ${p.level}`, 'info'); } },
        h('span', {}, p.icon), h('span', {}, p.name),
        h('span', { class: 'muted small' }, g.s.level < p.level ? `🔒 Lv ${p.level}` : done ? `✓ ${p.perk}` : `Stage ${st + 1}/${p.stages.length}`)));
    }
    wrap.append(projects);
    return wrap;
  }

  // ---------------------------------------------------------------- village project
  openProject(id) {
    this.openPanel({ id: 'project', ref: id, title: `${PROJECTS[id].icon} ${PROJECTS[id].name}`, live: true, render: () => this.renderProject(id) });
  }

  renderProject(id) {
    const g = this.game;
    const def = PROJECTS[id];
    const p = g.project(id);
    const wrap = h('div', { class: 'project' });
    const stages = h('div', { class: 'p-stages' });
    def.stages.forEach((_, i) => stages.append(h('div', { class: 'p-stage' + (i < p.stage ? ' done' : i === p.stage ? ' current' : '') }, i < p.stage ? '✓' : i + 1)));
    wrap.append(h('div', { class: 'muted' }, def.desc), stages);
    const need = g.projectNeeds(id);
    if (!need) {
      wrap.append(h('div', { class: 'empty' }, '🎉 Finished! ', h('b', {}, def.perk)));
      return wrap;
    }
    const st = def.stages[p.stage];
    const rows = h('div', { class: 'recipes' });
    const row = (icon, label, have, needN, total, give) => rows.append(h('div', { class: 'recipe' },
      h('div', { class: 'r-ico' }, icon),
      h('div', { class: 'r-mid' }, h('div', { class: 'r-name' }, label), h('div', { class: 'slot-bar wide' }, h('div', { style: `width:${((total - needN) / total) * 100}%` })), h('div', { class: 'muted small' }, needN ? `${fmtNum(total - needN)}/${fmtNum(total)} · you have ${fmtNum(have)}` : 'Done ✓')),
      needN ? h('button', { class: 'btn small' + (have > 0 ? '' : ' disabled'), onclick: give }, 'Give') : null));
    // coins go in chunks of at most half your wallet, so one tap never empties it
    const chunk = Math.min(need.coins, Math.max(1, Math.ceil(g.s.coins / 2)));
    row('🪙', `Coins (gives 🪙${fmtNum(chunk)})`, g.s.coins, need.coins, st.coins, () => this.ctrl.contribute(id, 'coins', chunk));
    for (const [i, total] of Object.entries(st.items)) row(ITEMS[i].icon, ITEMS[i].name, g.count(i), need.items[i], total, () => this.ctrl.contribute(id, i, need.items[i]));
    wrap.append(rows);
    wrap.append(h('div', { class: 'tip' }, `Each stage: ⭐ XP & 💎 gems. When finished: ${def.perk}. Give items whenever you have them; coins go in at most half your wallet at a time.`));
    return wrap;
  }

  // ---------------------------------------------------------------- 🏆 Treasures: 📖 Album · 💗 Ribbons · 🏆 Awards (§3.6)
  // (the Ribbons tab comes with Prettiest Farm, from level 19)
  treasureTabs() {
    const g = this.game;
    const tabs = [{ id: 'album', label: '📖 Album' }];
    if (g.charmStatus().unlocked) tabs.push({ id: 'ribbons', label: '💗 Ribbons' });
    tabs.push({ id: 'awards', label: '🏆 Awards' });
    return tabs;
  }

  // 🏆 opens on something to claim (an album page, a ribbon rank, an award), else the album once it's open, else Awards
  // (a keepsake that just flew into 🏆 — still NEW — opens the Album first: that's what the tap is about)
  treasuresTab() {
    const g = this.game;
    if (g.albumPagesReady().length) return 'album';
    if (g.albumOpen() && g.s.album.fresh?.length) return 'album';
    if (g.charmStatus().ready) return 'ribbons';
    if (g.achievementsReady()) return 'awards';
    return g.albumOpen() ? 'album' : 'awards';
  }

  openTreasures(tab) {
    const tabs = this.treasureTabs();
    this.albumPageId = null; // the default page again (§3.6)
    this.albumNew = new Set(); // finds shown as NEW while this panel is open
    this.openPanel({
      id: 'treasures',
      title: '🏆 Treasures',
      tabs,
      tab: tabs.some((t) => t.id === tab) ? tab : this.pickTab('treasures', tabs, this.treasuresTab()),
      live: false, // (it follows the game's events: 'album', 'inventory', … — no 1 Hz rebuild under the finger)
      render: (t) => (t === 'album' ? this.renderAlbum() : t === 'ribbons' ? this.renderRibbons() : this.renderAchievements()),
    });
  }

  // the page the album opens on: one with a prize to claim, else the latest find's, else the oldest open gap
  albumDefaultPage(st) {
    const ready = st.pages.find((p) => p.ready);
    if (ready) return ready.id;
    let latest = null, at = -1;
    for (const [id, ms] of Object.entries(this.game.s.album.have || {})) if (ms > at && KEEPSAKES[id]) { at = ms; latest = KEEPSAKES[id].page; }
    if (latest) return latest;
    return (st.pages.find((p) => !p.locked && !p.complete) || st.pages[0]).id;
  }

  // what a page's prize is, in words: 💎4 + 🪣 Copper Well (a voucher is 💎15 until gilding exists)
  albumPrizeText(def) {
    const pr = def.prize || {};
    const g = this.game;
    const vGems = !g.features?.charm && pr.voucher ? pr.voucher * ALBUM.voucherFallbackGems : 0; // (Prettiest Farm off)
    const parts = [];
    if (pr.gems || vGems) parts.push(`💎${(pr.gems || 0) + vGems}`);
    if (pr.gift && OBJECTS[pr.gift]) parts.push(`${OBJECTS[pr.gift].icon} ${OBJECTS[pr.gift].name}`);
    if (pr.voucher && !vGems) parts.push(`✨ Gilding voucher${pr.voucher > 1 ? ` ×${pr.voucher}` : ''}`);
    // the last page crowns the whole album
    if (def === ALBUM.pages[ALBUM.pages.length - 1]) parts.push(`🏅 ${ALBUM.all.title}`);
    return parts.join(' + ');
  }

  renderAlbum() {
    const g = this.game;
    const st = g.albumStatus();
    const wrap = h('div', { class: 'album' });
    if (!st.open) {
      wrap.append(h('div', { class: 'album-closed' }, h('div', { class: 'album-closed-ico' }, '📖'),
        h('div', {}, g.features?.post !== false ? 'Your first keepsake opens Mabel\'s album — a parcel will bring one soon.' : 'Your first keepsake opens Mabel\'s album — keep farming!'),
        h('div', { class: 'muted small' }, 'Keepsakes turn up while you farm and in parcels — find all 6 on a page for gems and a one-of-a-kind decoration.')));
      return wrap;
    }
    const n = st.pages.length;
    if (!st.pages.some((p) => p.id === this.albumPageId)) this.albumPageId = this.albumDefaultPage(st);
    const i = st.pages.findIndex((p) => p.id === this.albumPageId);
    const p = st.pages[i], def = ALBUM.pages[i];
    // finds on this page are NEW while it's on screen; the save forgets them right away
    this.albumNew ||= new Set();
    if (p.fresh.length) { for (const k of p.fresh) this.albumNew.add(k); queueMicrotask(() => g.albumSeen(p.id)); }
    const show = (id) => { if (id === this.albumPageId) return; this.albumPageId = id; this.audio.play('click'); this.refreshPanel(); this.uiChanged('tab'); };
    wrap.append(h('div', { class: 'album-head' }, h('b', {}, '📖 Mabel\'s Keepsake Album'), h('span', { class: 'album-count' }, `${st.found} / ${st.total}`)));
    wrap.append(h('div', { class: 'album-nav' },
      h('button', { class: 'album-arrow' + (i > 0 ? '' : ' off'), 'data-guide': 'album:prev', 'aria-label': 'Previous page', onclick: () => { if (i > 0) show(st.pages[i - 1].id); } }, '‹'),
      h('div', { class: 'album-page-title' }, h('b', {}, `${def.icon} ${def.name}`), h('small', {}, `page ${i + 1} of ${n}`)),
      h('button', { class: 'album-arrow' + (i < n - 1 ? '' : ' off'), 'data-guide': 'album:next', 'aria-label': 'Next page', onclick: () => { if (i < n - 1) show(st.pages[i + 1].id); } }, '›')));
    // dots: claimed ● · prize waiting (gold) · this page ◉ · open ○ · locked 🔒
    // (and a NEW find waiting on another page: a small red mark)
    wrap.append(h('div', { class: 'album-dots' }, st.pages.map((q, j) => h('button', {
      class: 'album-dot ' + (q.locked ? 'locked' : q.claimed ? 'claimed' : q.ready ? 'ready' : 'open') + (j === i ? ' current' : '') + (j !== i && q.fresh.length ? ' fresh' : ''),
      'data-guide': `album:page:${q.id}`, title: q.locked ? `${ALBUM.pages[j].name} · level ${q.level}` : ALBUM.pages[j].name, 'aria-label': ALBUM.pages[j].name,
      onclick: () => show(q.id),
    }, q.locked ? '🔒' : h('i')))));
    // the 3×2 page
    const grid = h('div', { class: 'album-grid' + (p.locked ? ' locked' : '') });
    for (const [it, icon, name] of def.items) {
      const id = `${def.id}:${it}`;
      const have = !p.locked && p.have.includes(id);
      grid.append(have
        ? h('div', { class: 'album-card' + (this.albumNew.has(id) ? ' new' : '') }, h('span', { class: 'ac-ico' }, icon), h('small', { class: 'ac-name' }, name),
          this.albumNew.has(id) ? h('em', { class: 'ac-new' }, 'NEW') : null)
        : h('div', { class: 'album-card missing' }, h('span', { class: 'ac-ico' }, '?'), h('small', { class: 'ac-name' }, p.locked ? '' : 'not found')));
    }
    if (p.locked) grid.append(h('div', { class: 'album-lock' }, `🔒 Opens at level ${p.level}`));
    wrap.append(grid);
    wrap.append(h('div', { class: 'album-hint muted small' }, `${def.hint} · parcels help your oldest page`));
    const left = def.items.length - p.found;
    wrap.append(h('div', { class: 'album-prize' + (p.ready ? ' ready' : '') },
      h('div', { class: 'ap-text' }, h('small', {}, 'Page prize'), h('b', {}, this.albumPrizeText(def))),
      p.ready ? h('button', { class: 'btn small claim-prize', 'data-guide': `album:claim:${def.id}`, onclick: () => this.ctrl.claimAlbumPage?.(def.id) }, 'Claim prize!')
        : h('span', { class: 'ap-state muted small' }, p.claimed ? '✓ Claimed' : p.locked ? `🔒 Lv ${p.level}` : `${left} more to find`)));
    // the long goals: the launch album (pages 1–8: the Curio Cabinet), then all 12
    const claimed = st.pages.filter((q) => q.claimed).length;
    const launchDone = st.pages.slice(0, ALBUM.launchPages).filter((q) => q.claimed).length;
    wrap.append(h('div', { class: 'album-foot muted small' }, !st.launch
      ? `${OBJECTS[ALBUM.launch.gift]?.icon || '🎁'} ${OBJECTS[ALBUM.launch.gift]?.name || 'Launch album'}: ${launchDone} / ${ALBUM.launchPages} pages`
      : st.all ? `🏅 ${ALBUM.all.title} — every page is complete!` : `🏅 ${ALBUM.all.title}: ${claimed} / ${n} pages`));
    return wrap;
  }

  // 💗 Ribbons (§4.5): the charm card (total, rank, a bar to the next one), Claim all, the 30 ranks (scrolled to the
  // next one when the tab shows), and the ✨ Gilding card from L31 (a teaser before)
  ribbonRewardText(rw = {}) {
    const parts = [];
    if (rw.gems) parts.push(`💎${rw.gems}`);
    if (rw.gift && OBJECTS[rw.gift]) parts.push(`${OBJECTS[rw.gift].icon} ${OBJECTS[rw.gift].name}`);
    if (rw.title) parts.push(`🏅 ${rw.title}`);
    if (rw.rosette) parts.push('🎀 Rosette');
    return parts;
  }

  renderRibbons() {
    const g = this.game;
    const st = g.charmStatus();
    const p = this.panel;
    const wrap = h('div', { class: 'ribbons' });
    const lo = st.reached ? CHARM.rank(st.reached) : 0;
    const pct = st.next ? Math.max(0, Math.min(100, ((st.total - lo) / (st.next.need - lo)) * 100)) : 100;
    wrap.append(h('div', { class: 'rb-head' },
      h('div', { class: 'rb-top' }, h('b', {}, `💗 Charm ${fmtNum(st.total)}`), h('span', { class: 'rb-rank' }, `🎀 Rank ${st.ranks}`)),
      h('div', { class: 'slot-bar wide rb-bar' }, h('div', { style: `width:${pct}%` })),
      h('div', { class: 'muted small' }, st.next
        ? `Next: rank ${st.next.rank} at 💗${fmtNum(st.next.need)} (${this.ribbonRewardText(st.next.reward).join(' + ')})`
        : 'Every ribbon is yours — the valley\'s Grand Champion Farm!'),
      // (in the sticky card, so it stays in reach however far the list scrolls; so do the rule and, with nothing to
      // claim, the way to more charm: the tab opens scrolled to the next rank, past anything above the list)
      h('div', { class: 'rb-how' },
        h('span', { class: 'rb-rule muted small' }, `Decorations add 💗: ${CHARM.perKind} of each kind count${st.gildUnlocked ? ', gilded ones ×3' : ''}.`),
        st.ready ? null : h('button', { class: 'btn small ghost', onclick: () => { this.audio.play('click'); this.openShop('decor'); } }, '🌳 Decor ›')),
      st.ready ? h('button', { class: 'btn wide claim-all', 'data-guide': 'ribbons:claim', onclick: () => this.ctrl.claimRibbons?.() }, `🎀 Claim all (${st.ready})`) : null,
    ));
    const head = wrap.firstChild;
    const list = h('div', { class: 'rb-list' });
    let next = null;
    for (let r = 1; r <= CHARM.ranks; r++) {
      const state = r <= st.ranks ? 'done' : r <= st.reached ? 'ready' : 'locked';
      const rw = CHARM.rewards[r - 1];
      const row = h('div', { class: `rb-row ${state}` + (rw.title || rw.gift ? ' big' : '') },
        h('span', { class: 'rb-badge' }, r),
        h('div', { class: 'rb-mid' },
          h('div', { class: 'rb-need' }, `💗 ${fmtNum(CHARM.rank(r))}`),
          h('div', { class: 'rb-chips' }, this.ribbonRewardText(rw).map((x) => h('span', { class: 'rb-chip' }, x)))),
        state === 'done' ? h('span', { class: 'rb-state' }, '✓')
          : state === 'ready' ? h('button', { class: 'btn small', onclick: () => this.ctrl.claimRibbons?.() }, 'Claim')
            : h('span', { class: 'rb-state muted' }, '🔒'));
      if (!next && state !== 'done') next = row;
      list.append(row);
    }
    wrap.append(list);
    // gilding: what it is and the vouchers waiting (from L31; before, what's coming)
    wrap.append(st.gildUnlocked
      ? h('div', { class: 'rb-gild' }, h('b', {}, '✨ Gilding'),
        h('div', { class: 'small' }, 'Make a premium decoration golden — a fountain, gazebo, flower arch, rooster or balloon (and their album recolours): it counts triple 💗. Tap it on your farm → ✨ Gild.'),
        h('div', { class: 'small' }, `Gilding vouchers: ${st.vouchers}${st.vouchers ? ' — each gilds one piece for free' : ' · Mabel\'s last album pages hold some'}`))
      : h('div', { class: 'rb-gild locked muted small' }, `✨ Gilding opens at level ${CHARM.gildLevel}: make your finest pieces golden for triple 💗.`));
    // first showing of the tab: the next rank in view, just under the (sticky) charm card with one claimed rank above
    if (next && p && p.lastTab !== 'ribbons') {
      requestAnimationFrame(() => {
        if (!next.isConnected) return;
        const b = p.body.getBoundingClientRect(), r = next.getBoundingClientRect();
        p.body.scrollTop += Math.max(0, r.top - b.top - head.getBoundingClientRect().height - r.height - 24);
      });
    }
    return wrap;
  }

  renderAchievements() {
    const g = this.game;
    const list = h('div', { class: 'achievements' });
    for (const a of ACHIEVEMENTS) {
      const st = g.achievementStatus(a);
      const goal = st.tier.goal;
      list.append(h('div', { class: 'ach' + (st.ready ? ' ready' : '') + (st.done ? ' done' : '') },
        h('div', { class: 'ach-ico' }, a.icon),
        h('div', { class: 'r-mid' },
          h('div', { class: 'r-name' }, `${a.name} `, h('span', { class: 'seed-stars on' }, stars(st.claimed, a.tiers.length))),
          h('div', { class: 'muted small' }, a.desc.replace('{n}', fmtNum(goal))),
          !st.done ? h('div', { class: 'slot-bar wide' }, h('div', { style: `width:${Math.min(100, (st.progress / goal) * 100)}%` })) : null,
        ),
        st.ready
          ? h('button', { class: 'btn small', onclick: () => this.ctrl.claimAchievement(a.id) }, `Claim ${st.tier.gems ? `💎${st.tier.gems}` : ''}`)
          : h('div', { class: 'muted small' }, st.done ? '✓' : `${fmtNum(Math.min(st.progress, goal))}/${fmtNum(goal)}`),
      ));
    }
    return list;
  }

  renderSettings() {
    const g = this.game;
    const s = g.s;
    const toggle = (label, on, fn) => h('button', { class: 'toggle' + (on ? ' on' : ''), onclick: fn }, label, h('span', { class: 'knob' }));
    const set = (key, value) => { s.settings[key] = value; g.saveSoon(); this.audio.play('click'); this.hook('onSettings', key, value); this.refreshPanel(); };
    const hints = s.settings.hints ?? 'full';
    const tapHarvest = s.settings.tapHarvest !== false;
    const guided = s.tutorial?.mode === 'guided' && this.hasHook('onSkipTour');
    const titles = s.charm?.titles || [];
    return h('div', { class: 'farm-panel' },
      // the farm's titles (Mabel's album, Mayor Hank's ribbons)
      titles.length ? h('div', { class: 'farm-titles' }, titles.map((x) => h('span', { class: 'farm-title' }, `🏅 ${x}`))) : null,
      h('div', { class: 'settings' },
        toggle('🔊 Sound effects', s.settings.sound, () => { s.settings.sound = !s.settings.sound; this.audio.setSfx(s.settings.sound); g.saveSoon(); this.refreshPanel(); }),
        toggle('🎵 Music', s.settings.music, () => { s.settings.music = !s.settings.music; this.audio.setMusic(s.settings.music); g.saveSoon(); this.refreshPanel(); }),
        h('div', { class: 'toggle seg-row' },
          h('div', {}, '👆 Hints', h('div', { class: 'muted small' }, 'Tap your goal card any time for help')),
          h('div', { class: 'seg' }, [['full', 'Full'], ['glow', 'Glow only'], ['off', 'Off']].map(([v, label]) =>
            h('button', { class: 'seg-btn' + (hints === v ? ' on' : ''), onclick: () => set('hints', v) }, label))),
        ),
        toggle('🌾 Tap harvests whole field', tapHarvest, () => set('tapHarvest', !tapHarvest)),
        this.revealed('camera') ? this.renderCameraSettings(set) : null,
        guided ? h('button', { class: 'btn small ghost skip-tour', onclick: () => { this.closePanel(); this.hook('onSkipTour'); } }, 'Skip tour ›') : null,
      ),
      h('div', { class: 'help' },
        h('b', {}, 'How to play'),
        h('ul', {},
          h('li', {}, '🚜 Plow grass, 🌱 plant seeds, ✋ swipe ripe crops to harvest.'),
          h('li', {}, '🐔 Build pens, buy animals, tap them to feed & collect.'),
          h('li', {}, '🍞 Turn goods into products in the Bakery & friends.'),
          h('li', {}, '🚚 Fill orders and 👋 serve visitors for coins & XP.'),
          h('li', {}, '📦 Storage fills up — upgrade it with materials that drop while you play.'),
          h('li', {}, 'Move: drag (Hand) · two fingers · WASD / right-drag. Zoom: pinch / wheel. Turn & tilt: 🧭 · Q/E · Z/X.'),
        ),
      ),
      h('button', { class: 'btn small red ghost', onclick: () => { if (confirm('Start a brand new farm? All progress will be lost.')) g.reset(); } }, 'Reset farm'),
    );
  }

  // the open modal on top (level-up, daily gift or chapter chest), or null. A modal counts from the moment
  // it is added (its .open class only lands on the next frame) until it starts closing.
  topModal() {
    const open = [...this.modalLayer.querySelectorAll('.levelup-back')].filter((b) => !b._closed && (b._close || b.classList.contains('open')));
    return open.length ? open[open.length - 1] : null;
  }

  // Esc / Enter: a modal closes the way its main button would (a modal with its own Enter, e.g. the parcel's
  // Open! ✨ then Lovely!, presses that button; its Esc before opening closes it unopened)
  closeTopModal(key = 'escape') {
    const m = this.topModal();
    if (!m) return;
    if (key === 'enter' && m._enter) { m._enter(); return; }
    if (key === 'escape' && m._esc) { m._esc(); return; }
    if (m._close) { m._close(); return; }
    m.classList.remove('open');
    if (m === this._luBack) this._luBack = null;
    setTimeout(() => m.remove(), 250);
  }

  // shared shell of the centred modals; kind: 'levelup' | 'daily' | 'chest' | 'post'
  showModal(kind, modal, close) {
    this.closeSeedPopover();
    // the HUD button that opened it (the 📬 pill after a click) gives up focus, so Enter / Space for the modal
    // never also press it again behind the dim
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
    const back = h('div', { class: 'backdrop levelup-back', 'data-modal': kind }, modal);
    // a tap on the dim closes some modals; not the click of the very tap that opened it (a farm tap on the
    // Mailbox opens the parcel on pointerup, and its click then lands on the new backdrop)
    const openedAt = performance.now();
    back._outside = (e) => e.target === back && performance.now() - openedAt > 400;
    back._close = () => {
      if (back._closed) return;
      back._closed = true;
      back.classList.remove('open');
      setTimeout(() => back.remove(), 250);
      close?.();
      this.uiChanged('modal');
    };
    this.modalLayer.append(back);
    requestAnimationFrame(() => back.classList.add('open'));
    this.uiChanged('modal');
    return back;
  }

  // ---------------------------------------------------------------- today: daily gift + chores
  openToday() {
    this.openPanel({ id: 'today', title: '🎁 Today', live: true, render: () => this.renderToday() });
  }

  renderToday() {
    const g = this.game;
    const wrap = h('div', { class: 'farm-panel' });
    // the Post first: its countdown and teaser, or "A parcel is waiting! [Open]" (the two never share a modal)
    if (this.revealed('post')) {
      const ps = g.postStatus();
      wrap.append(ps.ready
        ? h('div', { class: 'upcoming post-row ready' }, h('div', { class: 'r-mid' }, '📬 A parcel is waiting!'),
          h('button', { class: 'btn small', 'data-guide': 'today:post', onclick: () => { this.audio.play('click'); this.closePanel(true); this.showPost(); } }, 'Open'))
        : h('div', { class: 'upcoming post-row', 'data-guide': 'today:post' }, h('div', { class: 'r-mid' }, `📪 Next parcel in ${postClock(ps.msLeft)} · Next: ${ps.teaser.label}`)));
    }
    const st = g.dailyStatus();
    const days = h('div', { class: 'daily-days' });
    DAILY.forEach((r, i) => {
      const day = i + 1;
      const cls = st.canClaim ? (day < st.day ? 'past' : day === st.day ? 'today' : '') : (day <= st.day ? 'past' : '');
      days.append(h('div', { class: 'daily-day ' + cls }, h('small', {}, `Day ${day}`), h('div', { class: 'dd-ico' }, r.gems ? '💎' : r.items ? ITEMS[Object.keys(r.items)[0]].icon : '🪙'), h('small', {}, r.gems ? `×${r.gems}` : r.items ? `×${Object.values(r.items)[0]}` : `${r.coins}`)));
    });
    wrap.append(h('div', { class: 'upcoming' }, h('b', {}, 'Daily gift'), days,
      st.canClaim ? h('button', { class: 'btn', 'data-guide': 'today:gift', onclick: () => this.ctrl.claimDaily() }, `Claim day ${st.day}!`)
        : h('div', { class: 'muted small' }, g.s.daily.lastAt && g.now() - g.s.daily.lastAt < 16 * 3600000 && new Date(g.s.daily.lastAt).toDateString() !== new Date(g.now()).toDateString()
          ? `Next gift in ${fmtTime((g.s.daily.lastAt + 16 * 3600000 - g.now()) / 1000)}. Missed days never reset it.`
          : 'Claimed today — a new gift tomorrow. Missed days never reset it.')));
    const ch = g.s.chores;
    const box = h('div', { class: 'upcoming' }, h('b', {}, 'Daily chores'));
    if (g.s.level < CHORES.level) box.append(h('div', { class: 'muted' }, `Chores start at level ${CHORES.level}.`));
    else if (ch) {
      ch.list.forEach((c, i) => {
        const done = c.progress >= c.count;
        const ready = done && !c.claimed;
        // the key sits on the Claim button while there is one, else on the row
        box.append(h('div', { class: 'chore' + (c.claimed ? ' claimed' : done ? ' ready' : ''), 'data-guide': ready ? null : `today:chore:${i}` },
          h('div', { class: 'r-mid' }, h('div', { class: 'r-name' }, c.text), h('div', { class: 'slot-bar wide' }, h('div', { style: `width:${(c.progress / c.count) * 100}%` })), h('div', { class: 'muted small' }, `${c.progress}/${c.count} · 🪙${c.coins} ⭐${c.xp}`)),
          c.claimed ? h('span', { class: 'muted' }, '✓') : done ? h('button', { class: 'btn small', 'data-guide': `today:chore:${i}`, onclick: () => this.ctrl.claimChore(i) }, 'Claim')
            : ch.rerolls > 0 ? h('button', { class: 'btn small ghost', title: 'Swap for another chore (1 per day)', onclick: () => { if (g.rerollChore(i)) this.audio.play('click'); } }, '🔄') : null));
      });
      box.append(h('div', { class: 'muted small' }, ch.bonus ? 'All done today! 🎉' : `Finish all ${ch.list.length} for 💎${CHORES.allDone.gems} and a building material.`));
    }
    wrap.append(box);
    return wrap;
  }

  // ---------------------------------------------------------------- daily gift (auto popup)
  // opts.onClose(): after the modal closed (claimed or dismissed)
  showDaily(auto = false, opts = {}) {
    const g = this.game;
    const st = g.dailyStatus();
    if (auto && !st.canClaim) return;
    const days = h('div', { class: 'daily-days' });
    DAILY.forEach((r, i) => {
      const day = i + 1;
      const cls = st.canClaim ? (day < st.day ? 'past' : day === st.day ? 'today' : '') : (day <= st.day ? 'past' : '');
      days.append(h('div', { class: 'daily-day ' + cls },
        h('small', {}, `Day ${day}`),
        h('div', { class: 'dd-ico' }, r.gems ? '💎' : r.items ? ITEMS[Object.keys(r.items)[0]].icon : '🪙'),
        h('small', {}, r.gems ? `×${r.gems}` : r.items ? `×${Object.values(r.items)[0]}` : `${r.coins}`),
      ));
    });
    const modal = h('div', { class: 'levelup daily' },
      h('div', { class: 'lu-title' }, '🎁 Daily Gift'),
      h('div', { class: 'muted' }, st.canClaim ? `Day ${st.day} gift — a new one every day you visit. Missed days never reset your progress!` : `Come back tomorrow for day ${(st.day % DAILY.length) + 1}!`),
      days,
      h('button', { class: 'btn wide' + (st.canClaim ? '' : ' disabled'), 'data-guide': 'modal:daily:claim', onclick: () => {
        if (st.canClaim) this.ctrl.claimDaily();
        back._close();
      } }, st.canClaim ? 'Claim!' : 'OK'),
    );
    const back = this.showModal('daily', modal, opts.onClose);
    back.addEventListener('click', (e) => { if (back._outside(e)) back._close(); });
    return back;
  }

  // ---------------------------------------------------------------- level up
  showLevelUp({ level, bonus, gems }) {
    // several level-ups can happen at once (big order); merge them into one celebration
    if (this._luPending) {
      this._luPending.level = level;
      this._luPending.bonus += bonus;
      this._luPending.gems += gems || 0;
      return;
    }
    this._luPending = { from: level, level, bonus, gems: gems || 0 };
    setTimeout(() => {
      const p = this._luPending;
      this._luPending = null;
      this.renderLevelUp(p);
    }, 60);
  }

  renderLevelUp({ from, level, bonus, gems }) {
    if (this._luBack) this._luBack.remove();
    this.audio.play('levelup');
    const unlocks = [];
    for (let l = from; l <= level; l++) unlocks.push(...unlocksAtLevel(l));
    const g = this.game;
    const extra = [];
    if (g.plotCap() > PLOTS.cap(from - 1)) extra.push(`🚜 Field limit is now ${g.plotCap()}`);
    // "Let's go! ▸" when the guide has a goal waiting at this level; closing then hands over to it
    const go = !!this.hook('levelUpGo', level);
    const modal = h('div', { class: 'levelup' },
      h('div', { class: 'lu-burst' }),
      h('div', { class: 'lu-star' }, h('span', {}, level)),
      h('div', { class: 'lu-title' }, 'Level Up!'),
      h('div', { class: 'lu-bonus' }, `+🪙 ${fmtNum(bonus)}${gems ? `  +💎 ${gems}` : ''}`),
      unlocks.length ? h('div', { class: 'lu-unlocks' }, h('div', { class: 'muted' }, 'New unlocks'), h('div', { class: 'lu-list' }, unlocks.map((u) => h('div', { class: 'lu-item' }, h('span', {}, u.icon), h('small', {}, u.name))))) : null,
      extra.length ? h('div', { class: 'muted small' }, extra.join(' · ')) : null,
      this.nextUnlockLine(level),
      h('button', { class: 'btn wide' + (go ? ' go' : ''), 'data-guide': 'modal:levelup:ok', onclick: () => back._close() }, go ? "Let's go! ▸" : 'Awesome!'),
    );
    const back = this.showModal('levelup', modal, () => {
      this.audio.play('click');
      if (this._luBack === back) this._luBack = null;
      if (go) this.hook('onLevelUpGo', level);
    });
    this._luBack = back;
    this.confetti();
  }

  // ---------------------------------------------------------------- chapter chest
  // chapter: a CHAPTERS entry {id, name, icon, reward:{gems, gift}} (or its id); next: the following
  // chapter (looked up when omitted, null for none). Rewards were already paid by the model — this is
  // the celebration. onOpen() runs once the chest is opened (button, Esc or Enter).
  // custom: any other prize chest (an album page): { kicker, icon, title, tiles: grant() tiles, note }
  showChest({ chapter, next, onOpen, custom } = {}) {
    if (custom) return this.showPrizeChest(custom, onOpen);
    const chapters = CONFIG.CHAPTERS || [];
    const ch = typeof chapter === 'object' && chapter ? chapter : chapters.find((c) => c.id === chapter);
    if (!ch) { onOpen?.(); return null; }
    const nx = next === undefined ? chapters.find((c) => c.id === ch.id + 1) : next;
    const reward = ch.reward || {};
    const gift = reward.gift && OBJECTS[reward.gift];
    this.audio.play('levelup');
    const gemsItem = reward.gems ? h('div', { class: 'lu-item' }, h('span', {}, '💎'), h('small', {}, `${reward.gems} gems`)) : null;
    const modal = h('div', { class: 'levelup chest' },
      h('div', { class: 'lu-burst' }),
      h('div', { class: 'chest-ico' }, '🎁'),
      h('div', { class: 'chest-kicker' }, `Chapter ${ch.id} complete!`),
      h('div', { class: 'lu-title chest-title' }, `${ch.icon ? ch.icon + ' ' : ''}${ch.name}`),
      gemsItem || gift ? h('div', { class: 'lu-list chest-rewards' }, gemsItem, gift ? h('div', { class: 'lu-item gift' }, h('span', {}, gift.icon), h('small', {}, `${gift.name} · gift`)) : null) : null,
      nx ? h('div', { class: 'muted small next-unlock' }, `Next: Chapter ${nx.id} · ${nx.name} ${nx.icon || ''}`) : null,
      h('button', { class: 'btn wide', 'data-guide': 'modal:chest:open', onclick: () => back._close() }, 'Open! ✨'),
    );
    const back = this.showModal('chest', modal, () => {
      this.audio.play('coin');
      this.confetti();
      if (gemsItem && this.ctrl.effects) {
        const r = gemsItem.getBoundingClientRect();
        for (let i = 0; i < Math.min(3, reward.gems); i++) this.ctrl.effects.flyFrom(r.left + r.width / 2, r.top + r.height / 2, '💎', this.gemsPill, { delay: i * 90 });
      }
      onOpen?.();
    });
    return back;
  }

  // A prize chest (an album page, the launch album): the model already paid it — tiles are grant()'s reward tiles.
  // Gems fly to the 💎 pill when it opens; the decorations are placed afterwards by the caller (onOpen).
  showPrizeChest(c, onOpen) {
    const gems = (c.tiles || []).filter((t) => t.kind === 'gems').reduce((n, t) => n + t.n, 0);
    const tiles = [];
    if (gems) tiles.push(h('div', { class: 'lu-item' }, h('span', {}, '💎'), h('small', {}, `${gems} gems`)));
    for (const t of c.tiles || []) {
      if (t.kind === 'gift' && OBJECTS[t.type]) tiles.push(h('div', { class: 'lu-item gift' }, h('span', {}, OBJECTS[t.type].icon), h('small', {}, `${OBJECTS[t.type].name} · gift`)));
      else if (t.kind === 'voucher') tiles.push(h('div', { class: 'lu-item gift' }, h('span', {}, '✨'), h('small', {}, `Gilding voucher${t.n > 1 ? ` ×${t.n}` : ''}`)));
      else if (t.kind === 'coins') tiles.push(h('div', { class: 'lu-item' }, h('span', {}, '🪙'), h('small', {}, fmtNum(t.n))));
    }
    for (const x of c.titles || []) tiles.push(h('div', { class: 'lu-item title' }, h('span', {}, '🏅'), h('small', {}, x)));
    this.audio.play('levelup');
    const gemsEl = tiles[0] && gems ? tiles[0] : null;
    const modal = h('div', { class: 'levelup chest prize-chest' },
      h('div', { class: 'lu-burst' }),
      h('div', { class: 'chest-ico' }, '🎁'),
      h('div', { class: 'chest-kicker' }, c.kicker || 'Prize!'),
      h('div', { class: 'lu-title chest-title' }, `${c.icon ? c.icon + ' ' : ''}${c.title || ''}`),
      tiles.length ? h('div', { class: 'lu-list chest-rewards' }, tiles) : null,
      c.note ? h('div', { class: 'muted small next-unlock' }, c.note) : null,
      h('button', { class: 'btn wide', 'data-guide': 'modal:chest:open', onclick: () => back._close() }, 'Open! ✨'),
    );
    const back = this.showModal('chest', modal, () => {
      this.audio.play('coin');
      this.confetti();
      if (gemsEl && this.ctrl.effects) {
        const r = gemsEl.getBoundingClientRect();
        for (let i = 0; i < Math.min(3, gems); i++) this.ctrl.effects.flyFrom(r.left + r.width / 2, r.top + r.height / 2, '💎', this.gemsPill, { delay: i * 90 });
      }
      onOpen?.();
    });
    return back;
  }

  nextUnlockLine(level) {
    for (let l = level + 1; l <= level + 15; l++) {
      const u = unlocksAtLevel(l);
      if (u.length) return h('div', { class: 'muted small next-unlock' }, `Next: ${u[0].icon} ${u[0].name}${u.length > 1 ? ` +${u.length - 1} more` : ''} at level ${l}`);
    }
    return null;
  }

  confetti(count = 80) {
    const colors = ['#ffcf3b', '#ff6b6b', '#4dabf7', '#69db7c', '#da77f2', '#ffa94d'];
    for (let i = 0; i < count; i++) {
      const c = h('div', { class: 'confetti' });
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = Math.random() * 0.6 + 's';
      c.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
      c.style.setProperty('--dx', (Math.random() - 0.5) * 200 + 'px');
      c.style.setProperty('--rot', Math.random() * 720 + 'deg');
      this.fx.append(c);
      setTimeout(() => c.remove(), 3500);
    }
  }
}
