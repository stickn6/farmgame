// DOM overlay UI. Designed touch-first (big hit targets, bottom sheets) so it ports to mobile.
import {
  ITEMS, CROPS, ANIMALS, OBJECTS, RECIPES, STORAGE, ACHIEVEMENTS, DAILY, VISITORS, MASTERY, PLOTS,
  CHORES, WAGON, PROJECTS, xpForLevel, unlocksAtLevel, nextUnlockLevel,
} from '../game/config.js';

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

const fmtNum = (n) => n.toLocaleString('en-US');
const itemList = (req, g) => Object.entries(req).map(([i, n]) => h('span', { class: 'r-in ' + (!g || g.count(i) >= n ? 'ok' : 'miss') }, `${ITEMS[i].icon}${g ? `${g.count(i)}/` : '×'}${n}`));
const stars = (n, max = 3) => '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));

export class HUD {
  constructor(root, game, ctrl, audio) {
    this.root = root;
    this.game = game;
    this.ctrl = ctrl;
    this.audio = audio;
    this.panel = null;
    this.build();
    this.bind();
    this.refreshAll();
    setInterval(() => this.tick(), 1000);
  }

  // ---------------------------------------------------------------- layout
  build() {
    this.coinsEl = h('span', { class: 'num' }, '0');
    this.coinsPill = h('div', { class: 'pill coins', onclick: () => this.openBarn() }, h('span', { class: 'ico' }, '🪙'), this.coinsEl);
    this.gemsEl = h('span', { class: 'num' }, '0');
    this.gemsPill = h('div', { class: 'pill gems', onclick: () => this.toast('💎 Gems: earn them from level-ups, achievements, mastery and daily gifts. Use them to finish timers.', 'info') }, h('span', { class: 'ico' }, '💎'), this.gemsEl);
    this.levelNum = h('div', { class: 'level-num' }, '1');
    this.xpFill = h('div', { class: 'xp-fill' });
    this.xpText = h('div', { class: 'xp-text' }, '');
    this.nextHint = h('div', { class: 'next-hint' }, '');
    this.levelBox = h('div', { class: 'level-box', onclick: () => this.openFarmhouse('progress') },
      h('div', { class: 'level-star' }, this.levelNum),
      h('div', { class: 'xp-col' }, h('div', { class: 'xp-bar' }, this.xpFill, this.xpText), this.nextHint),
    );
    const badge = () => h('span', { class: 'badge hidden' }, '');
    this.dailyBtn = h('button', { class: 'round-btn', title: 'Today: gift & chores', onclick: () => this.openToday() }, '🎁', badge());
    this.trophyBtn = h('button', { class: 'round-btn', title: 'Achievements', onclick: () => this.openFarmhouse('achievements') }, '🏆', badge());
    this.settingsBtn = h('button', { class: 'round-btn', title: 'Farm & settings', onclick: () => this.openFarmhouse('farm') }, '⚙️');

    this.questIcon = h('div', { class: 'q-icon' }, '📜');
    this.questText = h('div', { class: 'q-text' }, '');
    this.questFill = h('div', { class: 'q-fill' });
    this.questProg = h('div', { class: 'q-prog' }, '');
    this.questClaim = h('button', { class: 'btn small claim', onclick: (e) => { e.stopPropagation(); this.ctrl.claimQuest(); } }, 'Claim!');
    this.questCard = h('div', { class: 'quest-card', onclick: () => this.questHint() },
      this.questIcon,
      h('div', { class: 'q-body' }, this.questText, h('div', { class: 'q-bar' }, this.questFill, this.questProg)),
      this.questClaim,
    );

    const top = h('div', { class: 'top-bar' },
      h('div', { class: 'top-left' }, this.levelBox, this.questCard),
      h('div', { class: 'top-right' },
        h('div', { class: 'pills' }, this.coinsPill, this.gemsPill),
        h('div', { class: 'round-btns' }, this.dailyBtn, this.trophyBtn, this.settingsBtn),
      ),
    );

    // tool bar
    const tool = (id, icon, label, key) => h('button', { class: 'tool', 'data-tool': id, onclick: () => { this.audio.play('click'); this.ctrl.setTool(id); } },
      h('span', { class: 'ico' }, icon), h('span', { class: 'lbl' }, label), key ? h('span', { class: 'key' }, key) : null);
    const action = (id, icon, label, fn) => h('button', { class: 'tool action', id: 'btn-' + id, onclick: () => { this.audio.play('click'); fn(); } },
      h('span', { class: 'ico' }, icon), h('span', { class: 'lbl' }, label), badge());
    this.toolButtons = [tool('hand', '✋', 'Hand', '1'), tool('plow', '🚜', 'Plow', '2'), tool('seed', '🌱', 'Seeds', '3'), tool('remove', '🧹', 'Clear', '4')];
    this.shopBtn = action('shop', '🏪', 'Shop', () => this.openShop());
    this.barnBtn = action('barn', '📦', 'Barn', () => this.openBarn());
    this.ordersBtn = action('orders', '🚚', 'Orders', () => this.openOrders());
    this.toolbar = h('div', { class: 'toolbar' },
      h('div', { class: 'tool-group' }, this.toolButtons),
      h('div', { class: 'tool-sep' }),
      h('div', { class: 'tool-group' }, this.shopBtn, this.barnBtn, this.ordersBtn),
    );

    this.seedBar = h('div', { class: 'seed-bar hidden' });
    this.placeBar = h('div', { class: 'place-bar hidden' },
      h('div', { class: 'place-info' }),
      h('button', { class: 'btn round red', onclick: () => this.ctrl.cancelPlacement() }, '✕'),
      h('button', { class: 'btn round', onclick: () => this.ctrl.rotatePlacement() }, '⟳'),
      h('button', { class: 'btn round green', onclick: () => this.ctrl.confirmPlacement() }, '✓'),
    );
    this.toolHint = h('div', { class: 'tool-hint hidden' });
    this.toasts = h('div', { class: 'toasts' });
    this.fx = h('div', { class: 'fx-layer' });
    this.modalLayer = h('div', { class: 'modal-layer' });
    // don't swap out buttons under a finger: live panel refreshes wait until the press ends
    this.modalLayer.addEventListener('pointerdown', () => { this._pressing = true; }, true);
    window.addEventListener('pointerup', () => setTimeout(() => { this._pressing = false; }, 0), true);
    window.addEventListener('pointercancel', () => { this._pressing = false; }, true);

    this.root.append(top, this.toolHint, this.seedBar, this.placeBar, this.toolbar, this.toasts, this.modalLayer, this.fx);
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
    g.on('questComplete', () => { this.audio.play('quest'); this.refreshQuest(); this.questCard.classList.add('done-flash'); });
    g.on('toast', (t) => this.toast(t.text, t.type));
    g.on('levelup', (d) => this.showLevelUp(d));
    g.on('achievementReady', (a) => { this.audio.play('quest'); this.toast(`🏆 Achievement ready: ${a.name}!`, 'good'); this.refreshBadges(); });
    g.on('mastery', ({ type, stars: n, reward }) => {
      this.audio.play('quest');
      this.toast(`${ITEMS[type].icon} ${CROPS[type].name} mastery ${stars(n)}! ${reward.gems ? `+💎${reward.gems}` : ''}`, 'good');
    });
    g.on('storageUpgraded', ({ id, level }) => { this.toast(`${STORAGE[id].icon} ${STORAGE[id].name} upgraded to level ${level + 1}!`, 'good'); this.refreshPanel(); });
  }

  refreshAll() {
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
  }

  questHint() {
    const q = this.game.currentQuest();
    if (this.game.questDone()) { this.ctrl.claimQuest(); return; }
    this.toast(q.hint || `Goal: ${q.text}`, 'info');
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
    this.setBadge(this.trophyBtn, g.achievementsReady());
    const today = (g.dailyStatus().canClaim ? 1 : 0) + g.choresReady();
    this.setBadge(this.dailyBtn, today, today > 1 ? today : '!');
    let full = false;
    for (const id of Object.keys(STORAGE)) if (g.storageUsed(id) >= g.storageCap(id)) full = true;
    this.setBadge(this.barnBtn, full ? 1 : 0, '!');
  }

  setTool(tool) {
    for (const b of this.toolButtons) b.classList.toggle('active', b.dataset.tool === tool);
    this.seedBar.classList.toggle('hidden', tool !== 'seed');
    if (tool === 'seed') this.renderSeedBar();
    this.refreshToolHint(tool);
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
    const extra = touch ? ' · two fingers to move' : ' · right-drag / WASD to move';
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

  showPlaceBar(type, cost) {
    const info = this.placeBar.querySelector('.place-info');
    info.innerHTML = '';
    info.append(h('span', { class: 'place-name' }, `${OBJECTS[type].icon || ''} ${OBJECTS[type].name}`), cost ? h('span', { class: 'place-cost' }, `🪙 ${fmtNum(cost)}`) : null);
    this.placeBar.classList.remove('hidden');
    this.toolbar.classList.add('hidden');
    this.seedBar.classList.add('hidden');
    this.toolHint.textContent = matchMedia('(pointer: coarse)').matches ? 'Drag to position · ✓ to place' : 'Click to place · R to rotate · Esc to cancel';
    this.toolHint.classList.remove('hidden');
  }

  hidePlaceBar() {
    this.placeBar.classList.add('hidden');
    this.toolbar.classList.remove('hidden');
    this.setTool(this.ctrl.tool);
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
    this.refreshBadges();
    if (this.panel && this.panel.live && !this._pressing) this.refreshPanel(true);
  }

  // ---------------------------------------------------------------- panels
  openPanel({ title, tabs, tab, render, live = false, cls = '' }) {
    this.closePanel(true);
    const body = h('div', { class: 'panel-body' });
    const tabBar = tabs ? h('div', { class: 'tabs' }) : null;
    const panel = { title, tabs, tab: tab || (tabs && tabs[0].id), render, live, body, tabBar };
    const sheet = h('div', { class: 'sheet ' + cls },
      h('div', { class: 'sheet-head' }, h('div', { class: 'sheet-title' }, title), h('button', { class: 'close', onclick: () => this.closePanel() }, '✕')),
      tabBar, body,
    );
    const backdrop = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === backdrop) this.closePanel(); } }, sheet);
    panel.el = backdrop;
    this.panel = panel;
    this.modalLayer.append(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));
    this.refreshPanel();
  }

  refreshPanel(fromTick = false) {
    const p = this.panel;
    if (!p) return;
    if (!fromTick && this._pressing) { clearTimeout(this._deferRefresh); this._deferRefresh = setTimeout(() => this.refreshPanel(), 50); return; }
    if (p.tabBar && p.renderedTab !== p.tab) {
      p.renderedTab = p.tab;
      p.tabBar.innerHTML = '';
      for (const t of p.tabs) {
        p.tabBar.append(h('button', { class: 'tab' + (t.id === p.tab ? ' active' : ''), onclick: () => { this.audio.play('click'); p.tab = t.id; p.body.scrollTop = 0; this.refreshPanel(); } }, t.label));
      }
    }
    const scroll = p.body.scrollTop;
    p.body.innerHTML = '';
    p.body.append(p.render(p.tab));
    p.body.scrollTop = scroll;
  }

  closePanel(instant = false) {
    const p = this.panel;
    if (!p) return;
    this.panel = null;
    if (instant) { p.el.remove(); return; }
    p.el.classList.remove('open');
    setTimeout(() => p.el.remove(), 250);
  }

  gemButton(cost, label, fn, cls = 'small gem') {
    return h('button', { class: 'btn ' + cls + (this.game.s.gems < cost ? ' disabled' : ''), onclick: () => {
      if (this.game.s.gems < cost) { this.toast('Not enough gems 💎', 'bad'); return; }
      fn();
    } }, `${label} 💎${cost}`);
  }

  // ---------------------------------------------------------------- shop
  openShop(tab = 'buildings') {
    this.openPanel({
      title: '🏪 Shop',
      tabs: [{ id: 'buildings', label: '🏠 Buildings' }, { id: 'animals', label: '🐮 Animals' }, { id: 'trees', label: '🍎 Trees' }, { id: 'decor', label: '🌳 Decor' }, { id: 'land', label: '🗺️ Land' }],
      tab,
      render: (t) => this.renderShop(t),
    });
  }

  shopCard({ icon, name, cost, level, desc, sub, onBuy, disabled, items }) {
    const g = this.game;
    const locked = level > g.s.level;
    const cant = !locked && cost > g.s.coins;
    const missing = items && !g.hasItems(items);
    return h('div', { class: 'card' + (locked ? ' locked' : '') },
      h('div', { class: 'card-ico' }, locked ? '❔' : icon),
      h('div', { class: 'card-name' }, name),
      desc && !locked ? h('div', { class: 'card-desc' }, desc) : null,
      sub && !locked ? h('div', { class: 'card-sub' }, sub) : null,
      items && !locked ? h('div', { class: 'r-inputs center' }, itemList(items, g)) : null,
      locked
        ? h('div', { class: 'card-lock' }, `🔒 Level ${level}`)
        : h('button', { class: 'btn buy' + (cant || disabled || missing ? ' disabled' : ''), onclick: () => {
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
          icon: d.icon, name: d.name, cost: g.objectCost(id), level: d.level, desc: d.desc, items: d.items,
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
          onBuy: () => this.ctrl.buyAnimal(id),
        }));
      }
    } else if (tab === 'trees') {
      addCards((d) => d.kind === 'tree', (id, d) => this.shopCard({
        icon: d.icon, name: d.name, cost: g.objectCost(id), level: d.level,
        desc: `${ITEMS[d.fruit].icon}×${d.yield} every ${fmtTime(d.fruitTime)} · ${d.harvests} harvests`,
        sub: `Grows in ${fmtTime(d.growTime)}`,
        onBuy: () => { this.closePanel(); this.ctrl.startPlacement(id); },
      }));
    } else if (tab === 'decor') {
      addCards((d) => d.kind === 'decor', (id, d) => this.shopCard({ icon: d.icon, name: d.name, cost: d.cost, level: d.level, onBuy: () => { this.closePanel(); this.ctrl.startPlacement(id); } }));
    } else if (tab === 'land') {
      const e = g.nextExpansion();
      const wrap = h('div', { class: 'land-tab' });
      wrap.append(h('div', { class: 'land-ico' }, '🗺️'), h('div', { class: 'land-size' }, `Your farm: ${g.s.landSize} × ${g.s.landSize}`));
      if (!e) wrap.append(h('p', {}, 'You own all the land! 🎉'));
      else {
        wrap.append(h('p', {}, `Clear the wild meadow and grow to ${e.size} × ${e.size} tiles.`));
        wrap.append(this.shopCard({ icon: '🌲', name: 'Expand Land', cost: e.coins, level: e.level, items: e.items, onBuy: () => { this.closePanel(); this.ctrl.expandLand(); } }));
      }
      return wrap;
    }
    const wrap = h('div', {}, grid);
    if (hidden.n) wrap.append(h('div', { class: 'tip' }, `✨ ${hidden.n} more to discover as you level up`));
    return wrap;
  }

  // ---------------------------------------------------------------- barn / storage
  openBarn(tab) {
    const ids = Object.keys(STORAGE);
    this.openPanel({
      title: '📦 Storage',
      tabs: [...ids.map((id) => ({ id, label: `${STORAGE[id].icon} ${STORAGE[id].name}` })), { id: 'toolshed', label: '🧰 Toolshed' }],
      tab: tab || ids[0],
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
        grid.append(h('div', { class: 'item-card' + (sel ? ' active' : '') + (it.cat === 'material' ? ' material' : ''), onclick: () => { this._sellSel = sel ? null : id; this.audio.play('click'); this.refreshPanel(); } },
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
      const sellBtn = (q, label) => h('button', { class: 'btn', onclick: () => this.ctrl.sell(id, q) }, label);
      wrap.append(h('div', { class: 'sell-bar' },
        h('div', {}, `${it.icon} ${it.name} ×${n}`, it.cat === 'material' ? h('div', { class: 'muted small' }, 'Used for upgrades & land') : null),
        h('div', { class: 'sell-btns' }, sellBtn(1, `Sell 1 · 🪙${it.price}`), n > 1 ? sellBtn(n, `Sell all · 🪙${it.price * n}`) : null),
      ));
    }
    if (used >= cap * 0.9) {
      wrap.append(h('div', { class: 'panel-foot center' }, h('button', { class: 'btn small', onclick: () => {
        const earned = g.sellExtras(sid, 10);
        if (earned) { this.audio.play('coin'); this.toast(`Sold extras for 🪙${fmtNum(earned)}`, 'good'); }
        this.refreshPanel();
      } }, '🧹 Sell extras (keep 10 of each)')));
    }
    const up = g.nextStorageUpgrade(sid);
    if (up && up.locked) {
      wrap.append(h('div', { class: 'upgrade-card' }, h('div', { class: 'up-title' }, `⬆️ Next upgrade (${up.capacity} capacity) at level ${up.needLevel}`), h('div', { class: 'r-inputs' }, h('span', { class: 'r-in' }, `🪙${fmtNum(up.coins)}`), itemList(up.items, g))));
    } else if (up) {
      const can = g.s.coins >= up.coins && g.hasItems(up.items);
      wrap.append(h('div', { class: 'upgrade-card' },
        h('div', { class: 'up-title' }, `⬆️ Upgrade to ${up.capacity} capacity`),
        h('div', { class: 'r-inputs' }, h('span', { class: 'r-in ' + (g.s.coins >= up.coins ? 'ok' : 'miss') }, `🪙${fmtNum(up.coins)}`), itemList(up.items, g)),
        h('div', { class: 'up-btns' },
          h('button', { class: 'btn small' + (can ? '' : ' disabled'), onclick: () => this.ctrl.upgradeStorage(sid) }, 'Upgrade'),
          !g.hasItems(up.items) ? this.gemButton(g.gemPriceFor(up.items), 'Buy missing', () => { if (g.buyMissing(up.items)) { this.audio.play('coin'); this.refreshPanel(); } }) : null,
        ),
        h('div', { class: 'muted small' }, 'Materials drop randomly from harvests, animals, production, orders and visitors.'),
      ));
    } else wrap.append(h('div', { class: 'tip' }, 'Fully upgraded! 🎉'));
    wrap.append(h('div', { class: 'tip' }, '💡 Orders and visitors pay much more than selling here.'));
    return wrap;
  }

  // ---------------------------------------------------------------- orders
  openOrders(tab = 'orders') {
    const wagon = this.game.s.level >= WAGON.level;
    this.openPanel({
      title: '🚚 Orders',
      tabs: wagon ? [{ id: 'orders', label: '🚚 Orders' }, { id: 'wagon', label: '🛒 Market Wagon' }] : null,
      tab: wagon ? tab : 'orders',
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
    for (const o of g.s.orders) {
      if (o.waitUntil) {
        grid.append(h('div', { class: 'order waiting' }, h('div', { class: 'order-wait' }, '⏳'), h('div', { class: 'muted' }, `New order in ${fmtTime((o.waitUntil - now) / 1000)}`)));
        continue;
      }
      const can = g.hasItems(o.items);
      const items = h('div', { class: 'order-items' });
      for (const [id, n] of Object.entries(o.items)) {
        const have = g.count(id);
        items.append(h('div', { class: 'order-item ' + (have >= n ? 'ok' : 'miss') }, h('span', { class: 'oi-ico' }, ITEMS[id].icon), h('span', { class: 'oi-n' }, `${Math.min(have, n)}/${n}`)));
      }
      grid.append(h('div', { class: 'order' + (can ? ' ready' : '') },
        items,
        h('div', { class: 'order-reward' }, h('span', {}, `🪙 ${fmtNum(o.coins)}`), h('span', {}, `⭐ ${o.xp}`)),
        h('div', { class: 'order-btns' },
          h('button', { class: 'btn small ghost', title: 'Discard', onclick: () => { this.audio.play('click'); g.discardOrder(o.id); } }, '🗑️'),
          h('button', { class: 'btn small' + (can ? '' : ' disabled'), onclick: () => this.ctrl.deliverOrder(o.id) }, 'Deliver'),
        ),
      ));
    }
    return grid;
  }

  // ---------------------------------------------------------------- visitors
  openVisitor(v) {
    this.openPanel({ title: '👋 Visitor', cls: 'small', live: true, render: () => this.renderVisitor(v.id) });
  }

  renderVisitor(id) {
    const g = this.game;
    const v = g.s.visitors.find((x) => x.id === id);
    if (!v) { setTimeout(() => this.closePanel(), 0); return h('div', {}); }
    const npc = VISITORS.npcs.find((n) => n.id === v.npc);
    const it = ITEMS[v.item];
    const have = g.count(v.item);
    return h('div', { class: 'visitor-panel' },
      h('div', { class: 'v-head' }, h('div', { class: 'v-face', style: `background:${npc.color}` }, npc.icon), h('div', {},
        h('div', { class: 'v-name' }, npc.name, h('span', { class: 'v-hearts' }, ` ❤️ ${g.s.hearts[npc.id] || 0}/${VISITORS.maxHearts}`)),
        h('div', { class: 'v-line' }, `“${npc.line.replace('{item}', it.name.toLowerCase())}”`),
        h('div', { class: 'muted small' }, `Likes ${npc.likes.map((c) => ({ crop: 'crops', animal: 'animal goods', goods: 'homemade goods', fruit: 'fruit' }[c] || c)).join(' & ')} (extra ❤️)`),
      )),
      h('div', { class: 'v-want' },
        h('div', { class: 'order-item ' + (have >= v.qty ? 'ok' : 'miss') }, h('span', { class: 'oi-ico' }, it.icon), h('span', { class: 'oi-n' }, `${Math.min(have, v.qty)}/${v.qty}`)),
        h('div', { class: 'order-reward' }, h('span', {}, `🪙 ${fmtNum(v.coins)}`), h('span', {}, `⭐ ${v.xp}`)),
      ),
      h('div', { class: 'muted small center' }, 'Happy to wait as long as you need 🙂'),
      h('div', { class: 'panel-foot center' },
        h('button', { class: 'btn ghost', onclick: () => { this.ctrl.dismissVisitor(v.id); this.closePanel(); } }, 'No thanks'),
        h('button', { class: 'btn' + (have >= v.qty ? '' : ' disabled'), onclick: () => { if (this.ctrl.serveVisitor(v.id)) this.closePanel(); } }, `Sell ${it.icon}×${v.qty}`),
      ),
    );
  }

  // ---------------------------------------------------------------- factory
  openFactory(o) {
    this.openPanel({ title: `${OBJECTS[o.type].icon} ${OBJECTS[o.type].name}`, live: true, render: () => this.renderFactory(o) });
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
    if (q.some((j) => j.done)) btns.append(h('button', { class: 'btn', onclick: () => { this.ctrl.collectFactory(o); } }, 'Collect ✨'));
    const active = q.find((j) => !j.done);
    if (active) btns.append(this.gemButton(g.speedUpCost(active.endAt - now), 'Finish now', () => { if (g.speedUpFactory(o)) { this.audio.play('coin'); this.refreshPanel(); } }));
    if (btns.children.length) wrap.append(btns);
    const list = h('div', { class: 'recipes' });
    for (const [id, r] of Object.entries(RECIPES)) {
      if (r.building !== o.type) continue;
      const it = ITEMS[id];
      if (!g.isUnlocked('recipes', id)) {
        list.append(h('div', { class: 'recipe locked' }, h('div', { class: 'r-ico' }, '❔'), h('div', { class: 'r-mid' }, h('div', { class: 'r-name' }, `New recipe at level ${r.level}`))));
        continue;
      }
      const can = g.hasItems(r.inputs);
      list.append(h('div', { class: 'recipe' },
        h('div', { class: 'r-ico' }, it.icon),
        h('div', { class: 'r-mid' }, h('div', { class: 'r-name' }, it.name, h('span', { class: 'muted' }, ` · ${fmtTime(r.time)} · 🪙${it.price}`)), h('div', { class: 'r-inputs' }, itemList(r.inputs, g))),
        h('button', { class: 'btn small' + (can && o.jobs.length < size ? '' : ' disabled'), onclick: () => this.ctrl.startRecipe(o, id) }, 'Make'),
      ));
    }
    wrap.append(list);
    wrap.append(h('div', { class: 'panel-foot' }, h('button', { class: 'btn small ghost', onclick: () => { this.closePanel(); this.ctrl.startPlacement(o.type, o.id); } }, '✥ Move')));
    return wrap;
  }

  // ---------------------------------------------------------------- pen
  openPen(o) {
    this.openPanel({ title: `${OBJECTS[o.type].icon} ${OBJECTS[o.type].name}`, live: true, render: () => this.renderPen(o) });
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
    if (list.some((x) => g.animalState(x, now) !== 'producing')) btns.append(h('button', { class: 'btn', onclick: () => { this.closePanel(); this.ctrl.tendPen(o, true); } }, a.food ? 'Feed & collect' : 'Collect'));
    if (list.length < cap) btns.append(h('button', { class: 'btn' + (!g.isUnlocked('animals', def.animal) || g.s.coins < g.animalCost(def.animal) ? ' disabled' : ''), onclick: () => this.ctrl.buyAnimal(def.animal) }, `Buy ${a.icon} 🪙${fmtNum(g.animalCost(def.animal))}`));
    btns.append(h('button', { class: 'btn small ghost', onclick: () => { this.closePanel(); this.ctrl.startPlacement(o.type, o.id); } }, '✥ Move'));
    wrap.append(btns);
    return wrap;
  }

  // ---------------------------------------------------------------- crops & trees info
  openCropInfo(x, z) {
    this.openPanel({ title: '🌱 Field', cls: 'small', live: true, render: () => {
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
    this.openPanel({ title: `${OBJECTS[o.type].icon} ${OBJECTS[o.type].name}`, cls: 'small', live: true, render: () => {
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
  openDecor(o) {
    const d = OBJECTS[o.type];
    this.openPanel({
      title: `${d.icon} ${d.name}`, cls: 'small',
      render: () => h('div', { class: 'panel-foot center' },
        h('button', { class: 'btn', onclick: () => { this.closePanel(); this.ctrl.startPlacement(o.type, o.id); } }, '✥ Move'),
        h('button', { class: 'btn red', onclick: () => { this.closePanel(); this.ctrl.removeObject(o); } }, `Sell 🪙${Math.floor(d.cost / 2)}`),
      ),
    });
  }

  // ---------------------------------------------------------------- farmhouse: progress / achievements / settings
  openFarmhouse(tab = 'progress') {
    this.openPanel({
      title: '🏡 Your Farm',
      tabs: [{ id: 'progress', label: '⭐ Progress' }, { id: 'village', label: '🏘️ Village' }, { id: 'achievements', label: '🏆 Achievements' }, { id: 'farm', label: '⚙️ Settings' }],
      tab,
      live: true,
      render: (t) => (t === 'achievements' ? this.renderAchievements() : t === 'farm' ? this.renderSettings() : t === 'village' ? this.renderVillage() : this.renderProgress()),
    });
  }

  renderProgress() {
    const g = this.game;
    const s = g.s;
    const wrap = h('div', { class: 'farm-panel' });
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
    this.openPanel({ title: `${PROJECTS[id].icon} ${PROJECTS[id].name}`, live: true, render: () => this.renderProject(id) });
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
    return h('div', { class: 'farm-panel' },
      h('div', { class: 'settings' },
        toggle('🔊 Sound effects', s.settings.sound, () => { s.settings.sound = !s.settings.sound; this.audio.setSfx(s.settings.sound); g.saveSoon(); this.refreshPanel(); }),
        toggle('🎵 Music', s.settings.music, () => { s.settings.music = !s.settings.music; this.audio.setMusic(s.settings.music); g.saveSoon(); this.refreshPanel(); }),
      ),
      h('div', { class: 'help' },
        h('b', {}, 'How to play'),
        h('ul', {},
          h('li', {}, '🚜 Plow grass, 🌱 plant seeds, ✋ swipe ripe crops to harvest.'),
          h('li', {}, '🐔 Build pens, buy animals, tap them to feed & collect.'),
          h('li', {}, '🍞 Turn goods into products in the Bakery & friends.'),
          h('li', {}, '🚚 Fill orders and 👋 serve visitors for coins & XP.'),
          h('li', {}, '📦 Storage fills up — upgrade it with materials that drop while you play.'),
          h('li', {}, 'Move: drag (Hand) · two fingers · WASD / right-drag. Zoom: pinch / wheel. Rotate: Q / E.'),
        ),
      ),
      h('button', { class: 'btn small red ghost', onclick: () => { if (confirm('Start a brand new farm? All progress will be lost.')) g.reset(); } }, 'Reset farm'),
    );
  }

  topModal() { return this.modalLayer.querySelector('.levelup-back.open'); }

  closeTopModal() {
    const m = this.topModal();
    if (!m) return;
    m.classList.remove('open');
    if (m === this._luBack) this._luBack = null;
    setTimeout(() => m.remove(), 250);
  }

  // ---------------------------------------------------------------- today: daily gift + chores
  openToday() {
    this.openPanel({ title: '🎁 Today', live: true, render: () => this.renderToday() });
  }

  renderToday() {
    const g = this.game;
    const wrap = h('div', { class: 'farm-panel' });
    const st = g.dailyStatus();
    const days = h('div', { class: 'daily-days' });
    DAILY.forEach((r, i) => {
      const day = i + 1;
      const cls = st.canClaim ? (day < st.day ? 'past' : day === st.day ? 'today' : '') : (day <= st.day ? 'past' : '');
      days.append(h('div', { class: 'daily-day ' + cls }, h('small', {}, `Day ${day}`), h('div', { class: 'dd-ico' }, r.gems ? '💎' : r.items ? ITEMS[Object.keys(r.items)[0]].icon : '🪙'), h('small', {}, r.gems ? `×${r.gems}` : r.items ? `×${Object.values(r.items)[0]}` : `${r.coins}`)));
    });
    wrap.append(h('div', { class: 'upcoming' }, h('b', {}, 'Daily gift'), days,
      st.canClaim ? h('button', { class: 'btn', onclick: () => this.ctrl.claimDaily() }, `Claim day ${st.day}!`)
        : h('div', { class: 'muted small' }, g.s.daily.lastAt && g.now() - g.s.daily.lastAt < 16 * 3600000 && new Date(g.s.daily.lastAt).toDateString() !== new Date(g.now()).toDateString()
          ? `Next gift in ${fmtTime((g.s.daily.lastAt + 16 * 3600000 - g.now()) / 1000)}. Missed days never reset it.`
          : 'Claimed today — a new gift tomorrow. Missed days never reset it.')));
    const ch = g.s.chores;
    const box = h('div', { class: 'upcoming' }, h('b', {}, 'Daily chores'));
    if (g.s.level < CHORES.level) box.append(h('div', { class: 'muted' }, `Chores start at level ${CHORES.level}.`));
    else if (ch) {
      ch.list.forEach((c, i) => {
        const done = c.progress >= c.count;
        box.append(h('div', { class: 'chore' + (c.claimed ? ' claimed' : done ? ' ready' : '') },
          h('div', { class: 'r-mid' }, h('div', { class: 'r-name' }, c.text), h('div', { class: 'slot-bar wide' }, h('div', { style: `width:${(c.progress / c.count) * 100}%` })), h('div', { class: 'muted small' }, `${c.progress}/${c.count} · 🪙${c.coins} ⭐${c.xp}`)),
          c.claimed ? h('span', { class: 'muted' }, '✓') : done ? h('button', { class: 'btn small', onclick: () => this.ctrl.claimChore(i) }, 'Claim')
            : ch.rerolls > 0 ? h('button', { class: 'btn small ghost', title: 'Swap for another chore (1 per day)', onclick: () => { if (g.rerollChore(i)) this.audio.play('click'); } }, '🔄') : null));
      });
      box.append(h('div', { class: 'muted small' }, ch.bonus ? 'All done today! 🎉' : `Finish all ${ch.list.length} for 💎${CHORES.allDone.gems} and a building material.`));
    }
    wrap.append(box);
    return wrap;
  }

  // ---------------------------------------------------------------- daily gift (auto popup)
  showDaily(auto = false) {
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
      h('button', { class: 'btn wide' + (st.canClaim ? '' : ' disabled'), onclick: () => {
        if (st.canClaim) this.ctrl.claimDaily();
        back.classList.remove('open'); setTimeout(() => back.remove(), 250);
      } }, st.canClaim ? 'Claim!' : 'OK'),
    );
    const back = h('div', { class: 'backdrop levelup-back', onclick: (e) => { if (e.target === back) { back.classList.remove('open'); setTimeout(() => back.remove(), 250); } } }, modal);
    this.modalLayer.append(back);
    requestAnimationFrame(() => back.classList.add('open'));
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
    const modal = h('div', { class: 'levelup' },
      h('div', { class: 'lu-burst' }),
      h('div', { class: 'lu-star' }, h('span', {}, level)),
      h('div', { class: 'lu-title' }, 'Level Up!'),
      h('div', { class: 'lu-bonus' }, `+🪙 ${fmtNum(bonus)}${gems ? `  +💎 ${gems}` : ''}`),
      unlocks.length ? h('div', { class: 'lu-unlocks' }, h('div', { class: 'muted' }, 'New unlocks'), h('div', { class: 'lu-list' }, unlocks.map((u) => h('div', { class: 'lu-item' }, h('span', {}, u.icon), h('small', {}, u.name))))) : null,
      extra.length ? h('div', { class: 'muted small' }, extra.join(' · ')) : null,
      this.nextUnlockLine(level),
      h('button', { class: 'btn wide', onclick: () => { this.audio.play('click'); back.classList.remove('open'); this._luBack = null; setTimeout(() => back.remove(), 250); } }, 'Awesome!'),
    );
    const back = h('div', { class: 'backdrop levelup-back' }, modal);
    this._luBack = back;
    this.modalLayer.append(back);
    requestAnimationFrame(() => back.classList.add('open'));
    this.confetti();
  }

  nextUnlockLine(level) {
    for (let l = level + 1; l <= level + 15; l++) {
      const u = unlocksAtLevel(l);
      if (u.length) return h('div', { class: 'muted small next-unlock' }, `Next: ${u[0].icon} ${u[0].name}${u.length > 1 ? ` +${u.length - 1} more` : ''} at level ${l}`);
    }
    return null;
  }

  confetti() {
    const colors = ['#ffcf3b', '#ff6b6b', '#4dabf7', '#69db7c', '#da77f2', '#ffa94d'];
    for (let i = 0; i < 80; i++) {
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
