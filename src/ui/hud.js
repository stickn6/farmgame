// DOM overlay UI. Designed touch-first (big hit targets, bottom sheets) so it ports to mobile.
import { ITEMS, CROPS, ANIMALS, OBJECTS, RECIPES, xpForLevel, unlocksAtLevel } from '../game/config.js';

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
  return `${hr}h ${m % 60}m`;
}

const fmtNum = (n) => n.toLocaleString('en-US');

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
    const g = this.game;
    this.coinsEl = h('span', { class: 'num' }, '0');
    this.coinsPill = h('div', { class: 'pill coins', onclick: () => this.openBarn() }, h('span', { class: 'ico' }, '🪙'), this.coinsEl);
    this.levelNum = h('div', { class: 'level-num' }, '1');
    this.xpFill = h('div', { class: 'xp-fill' });
    this.xpText = h('div', { class: 'xp-text' }, '');
    this.levelBox = h('div', { class: 'level-box', onclick: () => this.openFarmhouse() },
      h('div', { class: 'level-star' }, this.levelNum),
      h('div', { class: 'xp-bar' }, this.xpFill, this.xpText),
    );
    this.settingsBtn = h('button', { class: 'round-btn', title: 'Settings', onclick: () => this.openFarmhouse() }, '⚙️');

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
      h('div', { class: 'top-right' }, this.coinsPill, this.settingsBtn),
    );

    // tool bar
    const tool = (id, icon, label, key) => h('button', { class: 'tool', 'data-tool': id, onclick: () => { this.audio.play('click'); this.ctrl.setTool(id); } },
      h('span', { class: 'ico' }, icon), h('span', { class: 'lbl' }, label), key ? h('span', { class: 'key' }, key) : null);
    const action = (id, icon, label, fn) => h('button', { class: 'tool action', id: 'btn-' + id, onclick: () => { this.audio.play('click'); fn(); } },
      h('span', { class: 'ico' }, icon), h('span', { class: 'lbl' }, label), h('span', { class: 'badge hidden' }, ''));
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

    this.root.append(top, this.toolHint, this.seedBar, this.placeBar, this.toolbar, this.toasts, this.modalLayer, this.fx);
  }

  bind() {
    const g = this.game;
    g.on('coins', () => this.refreshCoins());
    g.on('xp', () => this.refreshXp());
    g.on('inventory', () => { this.refreshBadges(); this.refreshPanel(); });
    g.on('orders', () => { this.refreshBadges(); this.refreshPanel(); });
    g.on('quest', () => this.refreshQuest());
    g.on('questComplete', () => { this.audio.play('quest'); this.refreshQuest(); this.questCard.classList.add('done-flash'); });
    g.on('toast', (t) => this.toast(t.text, t.type));
    g.on('levelup', (d) => this.showLevelUp(d));
  }

  refreshAll() {
    this.refreshCoins();
    this.refreshXp();
    this.refreshQuest();
    this.refreshBadges();
    this.setTool(this.ctrl.tool);
  }

  refreshCoins() {
    const target = this.game.s.coins;
    const from = this._shownCoins ?? target;
    this._shownCoins = target;
    if (from === target) { this.coinsEl.textContent = fmtNum(target); return; }
    const start = performance.now();
    cancelAnimationFrame(this._coinAnim);
    const step = (now) => {
      const t = Math.min(1, (now - start) / 500);
      this.coinsEl.textContent = fmtNum(Math.round(from + (target - from) * t));
      if (t < 1) this._coinAnim = requestAnimationFrame(step);
    };
    this._coinAnim = requestAnimationFrame(step);
  }

  refreshXp() {
    const s = this.game.s;
    const lo = xpForLevel(s.level), hi = xpForLevel(s.level + 1);
    const p = (s.xp - lo) / (hi - lo);
    this.levelNum.textContent = s.level;
    this.xpFill.style.width = Math.max(3, p * 100) + '%';
    this.xpText.textContent = `${s.xp - lo} / ${hi - lo} XP`;
  }

  refreshQuest() {
    const g = this.game;
    const q = g.currentQuest();
    const p = g.questProgress();
    this.questText.textContent = q.text;
    this.questProg.textContent = `${p}/${q.count}`;
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

  refreshBadges() {
    const ready = this.game.s.orders.filter((o) => !o.waitUntil && this.game.hasItems(o.items)).length;
    const badge = this.ordersBtn.querySelector('.badge');
    badge.textContent = ready;
    badge.classList.toggle('hidden', !ready);
  }

  setTool(tool) {
    for (const b of this.toolButtons) b.classList.toggle('active', b.dataset.tool === tool);
    this.seedBar.classList.toggle('hidden', tool !== 'seed');
    if (tool === 'seed') this.renderSeedBar();
    const hints = {
      plow: 'Tap or drag on grass to plow soil',
      seed: 'Tap or drag on plowed soil to plant',
      remove: 'Tap soil or decorations to clear them',
    };
    const touch = matchMedia('(pointer: coarse)').matches;
    const extra = touch ? ' · two fingers to move' : ' · right-drag / WASD to move';
    this.toolHint.textContent = hints[tool] ? hints[tool] + extra : '';
    this.toolHint.classList.toggle('hidden', !hints[tool]);
  }

  renderSeedBar() {
    const g = this.game;
    this.seedBar.innerHTML = '';
    for (const [id, c] of Object.entries(CROPS)) {
      const locked = c.level > g.s.level;
      const card = h('button', {
        class: 'seed-card' + (this.ctrl.seed === id ? ' active' : '') + (locked ? ' locked' : ''),
        onclick: () => {
          if (locked) { this.toast(`Unlocks at level ${c.level}`, 'bad'); this.audio.play('error'); return; }
          this.audio.play('click');
          this.ctrl.seed = id;
          this.renderSeedBar();
        },
      },
      h('div', { class: 'seed-ico' }, ITEMS[id].icon),
      h('div', { class: 'seed-name' }, c.name),
      locked ? h('div', { class: 'seed-meta' }, `🔒 Lv ${c.level}`) : h('div', { class: 'seed-meta' }, `🪙${c.seedCost} · ${fmtTime(c.growTime)}`),
      );
      this.seedBar.append(card);
    }
  }

  showPlaceBar(type, cost) {
    const info = this.placeBar.querySelector('.place-info');
    info.innerHTML = '';
    info.append(h('span', { class: 'place-name' }, `${OBJECTS[type].icon || ''} ${OBJECTS[type].name}`), cost ? h('span', { class: 'place-cost' }, `🪙 ${cost}`) : null);
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
    setTimeout(() => el.classList.add('out'), 2200);
    setTimeout(() => el.remove(), 2600);
  }

  tick() {
    this.game.ensureOrders();
    this.refreshBadges();
    if (this.panel && this.panel.live) this.refreshPanel();
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

  refreshPanel() {
    const p = this.panel;
    if (!p) return;
    if (p.tabBar) {
      p.tabBar.innerHTML = '';
      for (const t of p.tabs) {
        p.tabBar.append(h('button', { class: 'tab' + (t.id === p.tab ? ' active' : ''), onclick: () => { this.audio.play('click'); p.tab = t.id; this.refreshPanel(); } }, t.label));
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

  // ---------------------------------------------------------------- shop
  openShop(tab = 'buildings') {
    this.openPanel({
      title: '🏪 Shop',
      tabs: [{ id: 'buildings', label: '🏠 Buildings' }, { id: 'animals', label: '🐮 Animals' }, { id: 'decor', label: '🌳 Decor' }, { id: 'land', label: '🗺️ Land' }],
      tab,
      render: (t) => this.renderShop(t),
    });
  }

  shopCard({ icon, name, cost, level, desc, sub, onBuy, disabled }) {
    const g = this.game;
    const locked = level > g.s.level;
    const cant = !locked && cost > g.s.coins;
    return h('div', { class: 'card' + (locked ? ' locked' : '') },
      h('div', { class: 'card-ico' }, icon),
      h('div', { class: 'card-name' }, name),
      desc ? h('div', { class: 'card-desc' }, desc) : null,
      sub ? h('div', { class: 'card-sub' }, sub) : null,
      locked
        ? h('div', { class: 'card-lock' }, `🔒 Level ${level}`)
        : h('button', { class: 'btn buy' + (cant || disabled ? ' disabled' : ''), onclick: () => {
          if (disabled) { this.toast(disabled, 'bad'); return; }
          if (cant) { this.toast('Not enough coins!', 'bad'); return; }
          onBuy();
        } }, cost ? `🪙 ${fmtNum(cost)}` : 'Free'),
    );
  }

  renderShop(tab) {
    const g = this.game;
    const grid = h('div', { class: 'grid' });
    if (tab === 'buildings') {
      for (const [id, d] of Object.entries(OBJECTS)) {
        if (d.kind !== 'pen' && d.kind !== 'factory') continue;
        const owned = g.s.objects.filter((o) => o.type === id).length;
        grid.append(this.shopCard({
          icon: d.icon, name: d.name, cost: d.cost, level: d.level, desc: d.desc,
          sub: owned ? `Owned: ${owned}` : null,
          onBuy: () => { this.closePanel(); this.ctrl.startPlacement(id); },
        }));
      }
    } else if (tab === 'animals') {
      for (const [id, a] of Object.entries(ANIMALS)) {
        const homes = g.s.objects.filter((o) => o.type === a.home);
        const count = g.s.animals.filter((x) => x.type === id).length;
        const cap = homes.reduce((n, o) => n + OBJECTS[o.type].capacity, 0);
        const noHome = !homes.length ? `Build a ${OBJECTS[a.home].name} first` : count >= cap ? `${OBJECTS[a.home].name} is full — build another` : null;
        grid.append(this.shopCard({
          icon: a.icon, name: a.name, cost: g.animalCost(id), level: a.level,
          desc: `Eats ${a.foodQty} ${ITEMS[a.food].icon} → ${ITEMS[a.product].icon} every ${fmtTime(a.time)}`,
          sub: homes.length ? `${count}/${cap} in ${OBJECTS[a.home].name}` : `Needs ${OBJECTS[a.home].name}`,
          disabled: noHome,
          onBuy: () => this.ctrl.buyAnimal(id),
        }));
      }
    } else if (tab === 'decor') {
      for (const [id, d] of Object.entries(OBJECTS)) {
        if (d.kind !== 'decor') continue;
        grid.append(this.shopCard({ icon: d.icon, name: d.name, cost: d.cost, level: d.level, onBuy: () => { this.closePanel(); this.ctrl.startPlacement(id); } }));
      }
    } else if (tab === 'land') {
      const e = g.nextExpansion();
      const wrap = h('div', { class: 'land-tab' });
      wrap.append(h('div', { class: 'land-ico' }, '🗺️'), h('div', { class: 'land-size' }, `Your farm: ${g.s.landSize} × ${g.s.landSize}`));
      if (!e) wrap.append(h('p', {}, 'You own all the land! 🎉'));
      else {
        wrap.append(h('p', {}, `Clear the wild meadow and grow to ${e.size} × ${e.size} tiles.`));
        wrap.append(this.shopCard({ icon: '🌲', name: 'Expand Land', cost: e.cost, level: e.level, onBuy: () => { this.closePanel(); this.ctrl.expandLand(); } }));
      }
      return wrap;
    }
    return grid;
  }

  // ---------------------------------------------------------------- barn
  openBarn() {
    this.openPanel({ title: '📦 Barn', render: () => this.renderBarn() });
  }

  renderBarn() {
    const g = this.game;
    const wrap = h('div', {});
    const entries = Object.entries(g.s.inventory).filter(([, n]) => n > 0);
    if (!entries.length) {
      wrap.append(h('div', { class: 'empty' }, 'Your barn is empty. Harvest some crops! 🌾'));
      return wrap;
    }
    const total = entries.reduce((s, [i, n]) => s + n, 0);
    wrap.append(h('div', { class: 'barn-head' }, `${total} items stored`, h('span', { class: 'muted' }, ' · tap an item to sell')));
    const grid = h('div', { class: 'grid items' });
    for (const [id, n] of entries) {
      const it = ITEMS[id];
      const sel = this._sellSel === id;
      const card = h('div', { class: 'item-card' + (sel ? ' active' : ''), onclick: () => { this._sellSel = sel ? null : id; this.audio.play('click'); this.refreshPanel(); } },
        h('div', { class: 'item-ico' }, it.icon),
        h('div', { class: 'item-count' }, '×' + n),
        h('div', { class: 'item-name' }, it.name),
        h('div', { class: 'item-price' }, `🪙 ${it.price}`),
      );
      grid.append(card);
    }
    wrap.append(grid);
    if (this._sellSel && g.count(this._sellSel)) {
      const id = this._sellSel, it = ITEMS[id], n = g.count(id);
      const sellBtn = (q, label) => h('button', { class: 'btn', onclick: () => this.ctrl.sell(id, q) }, label);
      wrap.append(h('div', { class: 'sell-bar' },
        h('div', {}, `${it.icon} ${it.name} ×${n}`),
        h('div', { class: 'sell-btns' }, sellBtn(1, `Sell 1 · 🪙${it.price}`), n > 1 ? sellBtn(n, `Sell all · 🪙${it.price * n}`) : null),
      ));
    }
    wrap.append(h('div', { class: 'tip' }, '💡 Orders pay ~50% more than selling here!'));
    return wrap;
  }

  // ---------------------------------------------------------------- orders
  openOrders() {
    this.openPanel({ title: '🚚 Orders', live: true, render: () => this.renderOrders() });
  }

  renderOrders() {
    const g = this.game;
    const grid = h('div', { class: 'orders' });
    const now = Date.now();
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
        h('div', { class: 'order-reward' }, h('span', {}, `🪙 ${o.coins}`), h('span', {}, `⭐ ${o.xp}`)),
        h('div', { class: 'order-btns' },
          h('button', { class: 'btn small ghost', title: 'Discard', onclick: () => { this.audio.play('click'); g.discardOrder(o.id); } }, '🗑️'),
          h('button', { class: 'btn small' + (can ? '' : ' disabled'), onclick: () => this.ctrl.deliverOrder(o.id) }, 'Deliver'),
        ),
      ));
    }
    return grid;
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
    const now = Date.now();
    for (let i = 0; i < def.queue; i++) {
      const j = q[i];
      if (!j) { slots.append(h('div', { class: 'slot empty' }, '+')); continue; }
      const it = ITEMS[j.recipe];
      slots.append(h('div', { class: 'slot' + (j.done ? ' done' : '') },
        h('div', { class: 'slot-ico' }, it.icon),
        j.done ? h('div', { class: 'slot-t' }, 'Ready!') : h('div', { class: 'slot-t' }, i === 0 || q[i - 1].done ? fmtTime((j.endAt - now) / 1000) : 'Queued'),
        !j.done ? h('div', { class: 'slot-bar' }, h('div', { style: `width:${j.progress * 100}%` })) : null,
      ));
    }
    wrap.append(slots);
    if (q.some((j) => j.done)) wrap.append(h('button', { class: 'btn wide', onclick: () => { this.ctrl.collectFactory(o); } }, 'Collect ✨'));
    const list = h('div', { class: 'recipes' });
    for (const [id, r] of Object.entries(RECIPES)) {
      if (r.building !== o.type) continue;
      const it = ITEMS[id];
      const can = g.hasItems(r.inputs);
      const inputs = h('div', { class: 'r-inputs' });
      for (const [i, n] of Object.entries(r.inputs)) {
        inputs.append(h('span', { class: 'r-in ' + (g.count(i) >= n ? 'ok' : 'miss') }, `${ITEMS[i].icon}${g.count(i)}/${n}`));
      }
      list.append(h('div', { class: 'recipe' },
        h('div', { class: 'r-ico' }, it.icon),
        h('div', { class: 'r-mid' }, h('div', { class: 'r-name' }, it.name, h('span', { class: 'muted' }, ` · ${fmtTime(r.time)} · 🪙${it.price}`)), inputs),
        h('button', { class: 'btn small' + (can && o.jobs.length < def.queue ? '' : ' disabled'), onclick: () => this.ctrl.startRecipe(o, id) }, 'Make'),
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
    const now = Date.now();
    const wrap = h('div', {});
    wrap.append(h('div', { class: 'pen-head' }, `${list.length}/${def.capacity} ${a.name.toLowerCase()}s · eat ${a.foodQty} ${ITEMS[a.food].icon} (you have ${g.count(a.food)})`));
    const grid = h('div', { class: 'animals' });
    for (const an of list) {
      const st = g.animalState(an, now);
      grid.append(h('div', { class: 'animal-card ' + st },
        h('div', { class: 'a-ico' }, a.icon),
        h('div', { class: 'a-st' }, st === 'ready' ? `${ITEMS[a.product].icon} Ready` : st === 'hungry' ? `Hungry` : fmtTime((an.readyAt - now) / 1000)),
      ));
    }
    for (let i = list.length; i < def.capacity; i++) grid.append(h('div', { class: 'animal-card empty' }, h('div', { class: 'a-ico' }, '·')));
    wrap.append(grid);
    const btns = h('div', { class: 'panel-foot' });
    if (list.some((x) => g.animalState(x, now) !== 'producing')) btns.append(h('button', { class: 'btn', onclick: () => { this.closePanel(); this.ctrl.tendPen(o, true); } }, 'Feed & collect'));
    if (list.length < def.capacity) btns.append(h('button', { class: 'btn' + (g.s.level < a.level ? ' disabled' : ''), onclick: () => this.ctrl.buyAnimal(def.animal) }, `Buy ${a.icon} 🪙${g.animalCost(def.animal)}`));
    btns.append(h('button', { class: 'btn small ghost', onclick: () => { this.closePanel(); this.ctrl.startPlacement(o.type, o.id); } }, '✥ Move'));
    wrap.append(btns);
    return wrap;
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

  // ---------------------------------------------------------------- farmhouse / settings
  openFarmhouse() {
    const g = this.game;
    this.openPanel({
      title: '🏡 Your Farm',
      render: () => {
        const s = g.s;
        const toggle = (label, on, fn) => h('button', { class: 'toggle' + (on ? ' on' : ''), onclick: fn }, label, h('span', { class: 'knob' }));
        return h('div', { class: 'farm-panel' },
          h('div', { class: 'stats' },
            h('div', { class: 'stat' }, h('b', {}, s.level), h('span', {}, 'Level')),
            h('div', { class: 'stat' }, h('b', {}, fmtNum(s.stats.harvested)), h('span', {}, 'Harvested')),
            h('div', { class: 'stat' }, h('b', {}, s.stats.orders), h('span', {}, 'Orders')),
            h('div', { class: 'stat' }, h('b', {}, s.animals.length), h('span', {}, 'Animals')),
          ),
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
              h('li', {}, '🚚 Fill orders for big coin & XP rewards.'),
              h('li', {}, 'Move: drag (Hand) · two fingers · WASD / right-drag. Zoom: pinch / wheel. Rotate: Q / E.'),
            ),
          ),
          h('button', { class: 'btn small red ghost', onclick: () => { if (confirm('Start a brand new farm? All progress will be lost.')) g.reset(); } }, 'Reset farm'),
        );
      },
    });
  }

  // ---------------------------------------------------------------- level up
  showLevelUp({ level, bonus }) {
    // several level-ups can happen at once (big order); merge them into one celebration
    if (this._luPending) {
      this._luPending.level = level;
      this._luPending.bonus += bonus;
      return;
    }
    this._luPending = { from: level, level, bonus };
    setTimeout(() => {
      const p = this._luPending;
      this._luPending = null;
      this.renderLevelUp(p);
    }, 60);
  }

  renderLevelUp({ from, level, bonus }) {
    if (this._luBack) this._luBack.remove();
    this.audio.play('levelup');
    const unlocks = [];
    for (let l = from; l <= level; l++) unlocks.push(...unlocksAtLevel(l));
    const modal = h('div', { class: 'levelup' },
      h('div', { class: 'lu-burst' }),
      h('div', { class: 'lu-star' }, h('span', {}, level)),
      h('div', { class: 'lu-title' }, 'Level Up!'),
      h('div', { class: 'lu-bonus' }, `+🪙 ${bonus} bonus`),
      unlocks.length ? h('div', { class: 'lu-unlocks' }, h('div', { class: 'muted' }, 'New unlocks'), h('div', { class: 'lu-list' }, unlocks.map((u) => h('div', { class: 'lu-item' }, h('span', {}, u.icon), h('small', {}, u.name))))) : null,
      h('button', { class: 'btn wide', onclick: () => { this.audio.play('click'); back.classList.remove('open'); this._luBack = null; setTimeout(() => back.remove(), 250); } }, 'Awesome!'),
    );
    const back = h('div', { class: 'backdrop levelup-back' }, modal);
    this._luBack = back;
    this.modalLayer.append(back);
    requestAnimationFrame(() => back.classList.add('open'));
    this.confetti();
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
