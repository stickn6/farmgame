// Grandma Mabel's guide. GuideLayer is the DOM on top of everything (her card, the finger, the ring,
// the spotlight + blockers of hard beats, the edge arrow, timer chips, coach chip and toast-cards).
// GuideController runs the pure planner (src/game/guide.js) at 4 Hz and after game events, decides what
// to point at in each tutorial mode (guided → coached → independent), and positions it every frame.
// It only changes presentation and input shortcuts: every rule lives in the Game.
import * as THREE from 'three';
import './guide.css';
import { ITEMS, OBJECTS, ANIMALS, CHAPTERS, QUESTS, TUTORIAL, GUIDE, VISITORS, RECIPES, CAMERA, ALBUM } from '../game/config.js';
import {
  planStep, need, nextMode, questCardInfo, shouldAutoShowDaily, levelUpGo, pendingTip, graduationPending, fieldCentre, reserves,
  mailboxNear, markTipSeen,
} from '../game/guide.js';
import { tileToWorld } from '../game/world.js';
import { objectCenter } from '../game/views.js';
import { h, fmtClock } from './hud.js';

const TICK = 0.25; // s between planner passes (plus one right after each burst of game events)
const LOOKUP = 0.1; // s between data-guide re-queries (and tile hit tests)
const TOUCH_CLEAR = 22; // px a pointed-at tile keeps from speech bubbles (a fingertip's touch area plus the bob)
const TOUCH_SLOP = 14; // px around the fingertip that must reach the canvas too
const HOLE_PAD = 12; // spotlight hole around the target (px)
const RING_PAD = 6;
const ARROW_INSET = 24; // edge arrows sit this far inside the safe rect
const CARD_LOW = 0.65; // the card moves to the top when the target's bottom is below this share of the screen
const HARD_LOST = 3; // s a hard beat may lose its target before it turns soft
const HARD_MAX = 20; // s a hard beat may last before it turns soft
const SESSION_IDLE = 8; // s without input ends Show me (and abandons an interrupt chain)
const MEANWHILE_LINE = 3; // s the goal's line shows before the Meanwhile line takes over
const FLASH = 4.5; // s a one-off line stays on the card
const TIP_GAP = 45; // s between FEATURE_TIPS
const GLOW_NEW = 4; // s a new goal's target glows (coached)
const PRIORITY = { chest: 2, gift: 3, postGift: 3, daily: 4 }; // anything else (tips, interrupt toasts) is 5
// a queue kind's family: 'chest:album:barn' is a chest, 'gift:copperwell' a gift (one entry per kind, so prizes don't drop)
const family = (kind) => kind.split(':')[0];
const POST_AWAY_AFTER = 20; // s after start: "A parcel came while you were away" (once per session)
const IDLE_EVENTS = ['soil', 'animalChanged', 'animalAdded', 'factoryChanged', 'objectAdded', 'orderDone', 'visitorServed', 'quest',
  'daily', 'chores', 'land', 'storageUpgraded', 'debrisCleared', 'post'];
const PLAN_EVENTS = [...IDLE_EVENTS, 'coins', 'inventory', 'levelup', 'orders', 'visitors', 'treeChanged', 'objectRemoved', 'objectMoved',
  'questComplete', 'tutorial', 'gifts', 'chapter', 'wagon', 'postReady', 'keepsake', 'album', 'charm', 'ribbons', 'gild'];

const nowS = () => performance.now() / 1000;
const shown = (el) => !!el && el.isConnected && !el.closest('.hud-hidden, .hidden');
const pad = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
const inRect = (x, y, r) => !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const inSafe = (p, s) => p.x >= s.left && p.x <= s.right && p.y >= s.top && p.y <= s.bottom;
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const shortTime = (sec) => (sec < 60 ? `${Math.ceil(sec)}s` : fmtClock(sec));
const actionable = (s) => !!s && (s.kind === 'ui' || s.kind === 'world') && !!s.target && s.pointer !== false;
// the step the finger works on: the step itself, else its Meanwhile
const pick = (s) => (actionable(s) ? s : s && actionable(s.meanwhile) ? s.meanwhile : null);
const centroid = (pts) => pts.reduce((c, p) => c.add(p), new THREE.Vector3()).divideScalar(pts.length || 1);

// ==================================================================================== DOM layer
export class GuideLayer {
  constructor(root, ctrl) {
    this.root = root;
    this.ctrl = ctrl;
    this.hud = ctrl.hud;
    this.world = ctrl.world;
    this.game = ctrl.game;
    this.cache = new Map(); // data-guide key → { el, t }
    this.chipEls = new Map();
    this.chipList = [];
    this.tmp = new THREE.Vector3();
    this.cardTop = false;
    this.cardOn = false;
    this.modalEl = null;
    this.build();
  }

  build() {
    const div = (cls, ...kids) => h('div', { class: cls }, ...kids);
    this.spot = div('g-spot hidden');
    this.blocks = [0, 1, 2, 3].map(() => h('div', { class: 'g-block hidden', onpointerdown: (e) => { e.preventDefault(); this.onBlock?.(e); } }));
    this.chipBox = div('g-chips');
    this.ring = div('g-ring hidden');
    this.arrowIcon = h('i', {}, '➜');
    this.arrow = h('div', { class: 'g-arrow hidden', onclick: () => this.onArrow?.() }, this.arrowIcon);
    this.cardText = div('g-text');
    this.skipBtn = h('button', { class: 'g-skip', 'data-guide': 'guide:skip', onclick: (e) => { e.stopPropagation(); this.onSkip?.(); } }, 'Skip tour ›');
    this.card = h('div', { class: 'g-card hidden', onclick: () => this.onCardTap?.() },
      div('g-face', GUIDE.icon), h('div', { class: 'g-body' }, div('g-name', GUIDE.name), this.cardText), this.skipBtn);
    this.hand = div('g-hand', '👆');
    this.ripple = div('g-ripple');
    this.finger = div('g-finger hidden', this.ripple, this.hand);
    this.root.append(this.spot, ...this.blocks, this.chipBox, this.ring, this.arrow, this.card, this.finger);
  }

  get modalOpen() { return !!this.modalEl; }
  isBlocker(el) { return this.blocks.includes(el); }

  // ------------------------------------------------------------ target resolution (§6.4)
  // → { key, rect:{x,y,w,h}, point:{x,y}, world: Vector3[]|null, dom, visible, path? } | { hidden: revealKey } | null
  resolve(target, step) {
    if (!target) return null;
    if (target.ui) return this.resolveKey(target.ui) || (step?.fallback ? this.resolveKey(step.fallback) : null);
    switch (target.world) {
      case 'tiles': return this.resolveTiles(target.tiles, 0.3);
      case 'ghostPlots': return this.resolveTiles(target.tiles, 0.05);
      case 'object': return this.resolveObject(target.id);
      case 'visitor': return this.resolveKey('bubble:v' + target.id);
      case 'ghost': return this.resolveGhost();
      default: return null;
    }
  }

  // newest live element with this key (a closing panel or popover never counts)
  find(key) {
    let best = null;
    for (const el of document.querySelectorAll(`[data-guide="${CSS.escape(key)}"]`)) {
      if (el.closest('.seed-pop.out')) continue;
      const back = el.closest('.backdrop');
      if (back && (back._closed || (back !== this.hud.panel?.el && !back.classList.contains('levelup-back')))) continue;
      best = el;
    }
    return best;
  }

  el(key) {
    const t = nowS();
    let c = this.cache.get(key);
    if (!c || t - c.t > LOOKUP || (c.el && !c.el.isConnected)) {
      c = { el: this.find(key), t };
      this.cache.set(key, c);
    }
    return c.el;
  }

  // forget elements that left the page (a closed panel, a served visitor's bubble): keys carry ids, so the cache
  // would otherwise grow all session and keep each removed subtree alive. Run when the pointed-at step changes.
  prune() {
    for (const [k, c] of this.cache) if (!c.el?.isConnected) this.cache.delete(k);
  }

  resolveKey(key) {
    const el = this.el(key);
    const bubble = key.startsWith('bubble:');
    if (el) {
      if (el.closest('.hud-hidden')) return { key, hidden: this.hud.revealKeyFor(el) };
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') {
        const point = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        // what a tap there would really hit (e.g. the goal card under a landscape sheet); Mabel's own layer doesn't count
        const top = bubble ? null : document.elementFromPoint(point.x, point.y);
        const under = top && top !== el && !el.contains(top) && !this.root.contains(top) ? top : null;
        return { key, el, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, point, world: bubble ? this.bubbleAnchor(key) : null, dom: !bubble, visible: true, under };
      }
    }
    if (bubble) {
      const pts = this.bubbleAnchor(key);
      if (pts) return { ...this.fromPoints(pts), key };
    }
    return null;
  }

  // where a speech bubble lives in the world (for arrows / framing when it is off screen)
  bubbleAnchor(key) {
    const c = this.ctrl, g = this.game;
    const kind = key[7], id = +key.slice(8);
    if (kind === 'o') {
      const o = g.objById.get(id);
      if (!o) return null;
      const k = OBJECTS[o.type]?.kind;
      return [objectCenter(g, o).setY(o.type === 'orderboard' ? 1.7 : k === 'factory' ? 2.6 : k === 'tree' ? 2.1 : k === 'pen' ? 1.6 : 1.4)];
    }
    const e = kind === 'a' ? c.animals.map.get(id) : kind === 'v' ? c.visitors.map.get(id) : null;
    if (e) return [e.obj.position.clone().setY(kind === 'v' ? 1.75 : 0.8)];
    if (key === 'bubble:wagon' && c.wagon.group.visible) return [c.wagon.group.position.clone().setY(2.4)];
    return null;
  }

  fromPoints(pts, point = centroid(pts)) {
    const r = this.world.projectRect(pts);
    const p = this.world.projectArrow(point);
    return { rect: { x: r.x, y: r.y, w: r.w, h: r.h }, point: { x: p.x, y: p.y }, world: pts, dom: false, visible: r.visible && !p.behind };
  }

  resolveTiles(tiles, y) {
    if (!tiles?.length) return null;
    const pts = this.world.tilesCorners(tiles, y);
    const out = this.fromPoints(pts);
    // the finger goes on a tile's ground centre, where a tap lands (see pickTile)
    const screen = [];
    for (const [x, z] of tiles) {
      const p = this.world.projectArrow(tileToWorld(x, z, this.tmp).setY(0.02));
      if (!p.behind) screen.push({ x: p.x, y: p.y, tile: x + ',' + z });
    }
    if (!screen.length) return out;
    const { p: best, clear } = this.pickTile(tiles, screen);
    out.point = { x: best.x, y: best.y };
    out.clear = clear;
    if (screen.length > 1) {
      // a swipe starts on that tile and runs to the far end of the patch
      const far = screen.reduce((f, p) => ((p.x - best.x) ** 2 + (p.y - best.y) ** 2 > (f.x - best.x) ** 2 + (f.y - best.y) ** 2 ? p : f), best);
      out.path = { from: out.point, to: { x: far.x, y: far.y } };
    }
    return out;
  }

  // The tile nearest the screen centre that a fingertip can hit cleanly: no speech bubble within TOUCH_CLEAR px
  // (a phone's touch adjustment pulls a tap that close onto the bubble, e.g. the Bakery's next to the field) and
  // the canvas under the whole fingertip. Else the nearest one whose centre is clear (clear: true), else the
  // nearest (clear: false). Hit tests are costly: the choice is re-checked every LOOKUP s and re-projected between.
  pickTile(tiles, screen) {
    const t = nowS();
    const sig = tiles.map((p) => p[0] + ',' + p[1]).join(' ');
    const c = this.tileChoice;
    const kept = c && c.sig === sig && t - c.t <= LOOKUP && screen.find((p) => p.tile === c.tile);
    if (kept) return { p: kept, clear: c.clear };
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const near = screen.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2));
    const bubbles = [];
    for (const el of document.querySelectorAll('.bubble-anchor')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) bubbles.push(pad({ x: r.left, y: r.top, w: r.width, h: r.height }, TOUCH_CLEAR));
    }
    const centre = new Map();
    const hits = (p) => { if (!centre.has(p)) centre.set(p, this.tappable(p) && !this.occluded(p)); return centre.get(p); };
    const roomy = (p) => !bubbles.some((r) => inRect(p.x, p.y, r)) && hits(p)
      && [[TOUCH_SLOP, 0], [-TOUCH_SLOP, 0], [0, TOUCH_SLOP], [0, -TOUCH_SLOP]].every(([dx, dy]) => this.tappable({ x: p.x + dx, y: p.y + dy }));
    let p = near.find(roomy), clear = true;
    if (!p) p = near.find(hits);
    if (!p) { p = near[0]; clear = false; }
    this.tileChoice = { sig, t, tile: p.tile, clear };
    return { p, clear };
  }

  resolveObject(id) {
    const o = this.game.objById.get(id);
    if (!o) return null;
    return { ...this.fromPoints(this.ctrl.objects.corners(o), objectCenter(this.game, o).setY(0.3)), objectId: id };
  }

  resolveGhost() {
    const pts = this.ctrl.ghost.corners();
    if (!pts.length) return null;
    const out = this.fromPoints(pts);
    out.path = { from: { x: out.point.x - 40, y: out.point.y }, to: { x: out.point.x + 40, y: out.point.y } };
    return out;
  }

  // keep an element inside a scrolling panel / popover row in view (once per step)
  scrollTo(el) {
    const box = el?.closest('.panel-body, .seed-pop-list, .gift-cards');
    if (!box) return;
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top + 8;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8;
    if (r.left < b.left) box.scrollLeft -= b.left - r.left + 8;
    else if (r.right > b.right) box.scrollLeft += r.right - b.right + 8;
  }

  // ------------------------------------------------------------ per frame
  // v: { res, finger, ring: 'strong'|'glow'|null, hard, arrow, gesture }, safe: hud.safeRect()
  render(v, safe) {
    const res = v.res && v.res.rect ? v.res : null;
    // a world target counts when a tap would reach it (a hard beat's hole is kept clear, so there the safe rect will do)
    const reach = () => (res.clear !== undefined ? res.clear : this.tappable(res.point, res.el) && !(res.objectId != null && this.occluded(res.point, res.objectId)));
    const onScreen = res && (res.dom || (res.visible && ((v.hard && inSafe(res.point, safe)) || reach())));
    // a HUD modal (level-up, chest, daily) keeps Mabel's card, but her side chips wait behind it; so do her toasts
    // and coach chips while a panel or the seed popover is up (they'd sit on its title, ✕ or seed cards)
    this.root.classList.toggle('g-hud-modal', !!this.hud.topModal());
    this.root.classList.toggle('g-hud-panel', !!(this.hud.panel || this.hud.seedPopoverOpen()));
    // spotlight + 4 blockers around the hole
    const hole = v.hard && res ? this.clampRect(pad(res.rect, HOLE_PAD)) : null;
    this.spot.classList.toggle('hidden', !hole);
    for (const b of this.blocks) b.classList.toggle('hidden', !hole);
    if (hole) {
      const W = innerWidth, H = innerHeight;
      this.box(this.spot, hole);
      const r = hole.x + hole.w, bt = hole.y + hole.h;
      this.box(this.blocks[0], { x: 0, y: 0, w: W, h: hole.y });
      this.box(this.blocks[1], { x: 0, y: bt, w: W, h: H - bt });
      this.box(this.blocks[2], { x: 0, y: hole.y, w: hole.x, h: hole.h });
      this.box(this.blocks[3], { x: r, y: hole.y, w: W - r, h: hole.h });
    }
    // ring
    const ring = v.ring && onScreen;
    this.ring.classList.toggle('hidden', !ring);
    if (ring) {
      this.ring.classList.toggle('glow', v.ring === 'glow');
      const r = pad(res.rect, RING_PAD);
      const w = Math.max(36, r.w), ht = Math.max(36, r.h);
      this.box(this.ring, { x: r.x + (r.w - w) / 2, y: r.y + (r.h - ht) / 2, w, h: ht });
    }
    // finger
    const finger = v.finger && onScreen;
    this.finger.classList.toggle('hidden', !finger);
    if (finger) this.placeFinger(res, v.gesture);
    // edge arrow for soft targets off the safe rect
    const arrow = v.arrow && !v.hard && res && !onScreen;
    this.arrow.classList.toggle('hidden', !arrow);
    if (arrow) this.placeArrow(res.point, safe);
    this.placeCard(v.cardTop, res ? pad(res.rect, 6) : null);
    this.renderChips(safe);
  }

  // a world point a tap would really reach: on screen and not under the HUD, Mabel's card or another speech bubble
  // (target: the bubble that is itself the target; the animals of one pen share a bubble's job, so their bubbles
  // may overlap). The edge arrow doesn't count, or an arrow sitting on its target would keep itself up.
  tappable(p, target = null) {
    if (p.x < 8 || p.y < 8 || p.x > innerWidth - 8 || p.y > innerHeight - 8) return false;
    const el = document.elementsFromPoint(p.x, p.y).find((e) => !this.arrow.contains(e));
    if (!el) return false;
    if (el === this.world.canvas || (target && target.contains(el))) return true;
    const animal = (e) => (e.closest('[data-guide]')?.dataset.guide || '').startsWith('bubble:a');
    return !!target && animal(target) && animal(el);
  }

  // a building, animal or visitor in front of that point would take the tap (objectId: the object that should)
  occluded(p, objectId = null) {
    const c = this.ctrl;
    const meshes = [...c.visitors.meshes(), ...c.animals.meshes(), ...c.objects.allMeshes().filter((m) => m.visible), ...c.projects.meshes(), ...c.wagon.meshes()];
    const hit = this.world.pick(p.x, p.y, meshes)[0];
    if (!hit) return false;
    let o = hit.object;
    while (o && o.userData.objectId == null && o.parent) o = o.parent;
    return objectId == null || o?.userData.objectId !== objectId;
  }

  clampRect(r) {
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    return { x, y, w: Math.max(0, Math.min(innerWidth, r.x + r.w) - x), h: Math.max(0, Math.min(innerHeight, r.y + r.h) - y) };
  }

  box(el, r) {
    el.style.left = r.x + 'px';
    el.style.top = r.y + 'px';
    el.style.width = Math.max(0, r.w) + 'px';
    el.style.height = Math.max(0, r.h) + 'px';
  }

  placeFinger(res, gesture) {
    const swipe = gesture === 'swipe' && res.path;
    const from = swipe ? res.path.from : res.point;
    // no room under the target: point down at it from above
    const down = !swipe && from.y > innerHeight - 80;
    this.finger.classList.toggle('down', down);
    this.finger.classList.toggle('swipe', !!swipe);
    const glyph = down ? '👇' : '👆';
    if (this.hand.textContent !== glyph) this.hand.textContent = glyph;
    const tipX = 23, tipY = down ? 49 : 7; // fingertip inside the 56px box
    this.finger.style.transform = `translate(${(from.x - tipX).toFixed(1)}px, ${(from.y - tipY).toFixed(1)}px)`;
    this.ripple.style.left = tipX + 'px';
    this.ripple.style.top = tipY + 'px';
    if (swipe) {
      this.finger.style.setProperty('--sx', (res.path.to.x - from.x).toFixed(1) + 'px');
      this.finger.style.setProperty('--sy', (res.path.to.y - from.y).toFixed(1) + 'px');
    }
  }

  placeArrow(p, safe) {
    const s = { left: safe.left + ARROW_INSET, right: safe.right - ARROW_INSET, top: safe.top + ARROW_INSET, bottom: safe.bottom - ARROW_INSET };
    const cx = (s.left + s.right) / 2, cy = (s.top + s.bottom) / 2;
    const dx = p.x - cx, dy = p.y - cy;
    const kx = dx > 0 ? (s.right - cx) / dx : dx < 0 ? (s.left - cx) / dx : Infinity;
    const ky = dy > 0 ? (s.bottom - cy) / dy : dy < 0 ? (s.top - cy) / dy : Infinity;
    const k = Math.min(kx, ky, 1);
    this.arrow.style.left = (cx + dx * k).toFixed(1) + 'px';
    this.arrow.style.top = (cy + dy * k).toFixed(1) + 'px';
    this.arrowIcon.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
  }

  pulseFinger() {
    this.finger.classList.remove('pulse');
    void this.finger.offsetWidth;
    this.finger.classList.add('pulse');
    setTimeout(() => this.finger.classList.remove('pulse'), 1000);
  }

  // ------------------------------------------------------------ Mabel's card
  say(text, { fresh = false } = {}) {
    if (this.cardText.textContent !== text) this.cardText.textContent = text;
    if (fresh) this.restart(this.card, 'talk');
  }

  nudgeCard() { this.restart(this.card, 'nudge'); }

  restart(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  showCard(on, { skip = false } = {}) {
    this.cardOn = on;
    this.card.classList.toggle('hidden', !on);
    this.skipBtn.classList.toggle('hidden', !skip);
    if (!on) {
      this.card.removeAttribute('data-safe-top');
      this.card.removeAttribute('data-safe-bottom');
      document.getElementById('app')?.classList.remove('g-card-low');
    }
  }

  // the HUD's top edge (bottom of what is visible up there) and bottom edge (top of the bottom bars)
  topEdge(over) {
    if (over) return 8;
    let b = 0;
    for (const el of [this.hud.levelBoxEl, this.hud.questCard, this.hud.pills, this.hud.roundBtns, this.hud.postPill, this.hud.camBtn, this.hud.toolHint]) if (shown(el)) b = Math.max(b, el.getBoundingClientRect().bottom);
    return b + 8;
  }

  bottomEdge() {
    let t = innerHeight;
    for (const el of [this.hud.toolbar, this.hud.seedBar, this.hud.placeBar]) if (el.isConnected && !el.classList.contains('hidden')) t = Math.min(t, el.getBoundingClientRect().top);
    return t - 10;
  }

  // where the card would sit at a docking position (see placeCard). On a phone it spans the screen; the narrower
  // landscape card slides aside to keep clear of `avoid` (the target): it stays put while that is clear.
  cardRectAt(top, avoid = null) {
    const w = this.card.offsetWidth, ht = this.card.offsetHeight;
    const y = Math.max(4, top ? this.topEdge(top === 'over') : this.bottomEdge() - ht);
    const at = (x) => ({ x, y, w, h: ht });
    const mid = at((innerWidth - w) / 2);
    if (!avoid || innerWidth - w < 80) return mid;
    const spots = [this.cardX, mid.x, 10, innerWidth - w - 10].filter((x) => x != null && x >= 0 && x + w <= innerWidth).map(at);
    let best = mid, least = Infinity;
    for (const r of spots) {
      const o = overlap(r, avoid);
      if (o < least) { least = o; best = r; }
      if (!o) break;
    }
    return best;
  }

  // top: dock under the top bar (over: a panel or modal is up, so over the dimmed top bar); false: above the toolbar
  placeCard(top, avoid = null) {
    if (!this.cardOn) return;
    const high = !!top;
    const r = this.cardRectAt(top, avoid);
    this.cardX = r.x;
    this.card.style.top = r.y.toFixed(0) + 'px';
    this.card.style.left = (r.x + r.w / 2).toFixed(0) + 'px';
    if (high !== this.cardTop) {
      this.cardTop = high;
      this.restart(this.card, 'talk');
    }
    this.card.toggleAttribute('data-safe-top', high);
    this.card.toggleAttribute('data-safe-bottom', !high);
    const app = document.getElementById('app');
    app?.classList.toggle('g-card-low', !high);
    if (!high) app?.style.setProperty('--g-toast-bottom', Math.round(innerHeight - r.y + 8) + 'px');
  }

  // ------------------------------------------------------------ welcome / skip modal (data-modal="guide")
  // buttons: [{ label, key?, cls, onClick }]; Enter presses the first one, Esc the one at index esc (default: the last)
  modal({ text, buttons, esc = buttons.length - 1 }) {
    this.closeModal();
    const btns = buttons.map((b) => h('button', { class: b.cls || 'btn wide', 'data-guide': b.key || null, onclick: () => b.onClick() }, b.label));
    const back = h('div', { class: 'g-back', 'data-modal': 'guide' },
      h('div', { class: 'g-modal' }, h('div', { class: 'g-face big' }, GUIDE.icon), h('div', { class: 'g-name' }, GUIDE.name), h('div', { class: 'g-text' }, text), btns));
    back._buttons = btns;
    back._esc = esc;
    this.root.append(back);
    this.modalEl = back;
    this.hud.uiChanged?.('modal');
  }

  closeModal() {
    if (!this.modalEl) return;
    this.modalEl.remove();
    this.modalEl = null;
    this.hud.uiChanged?.('modal');
  }

  modalKey(first) {
    const b = this.modalEl?._buttons;
    if (!b?.length) return false;
    (first ? b[0] : b[this.modalEl._esc] || b[b.length - 1]).click();
    return true;
  }

  // ------------------------------------------------------------ chips, coach chip, toast-card, tags
  // list: [{ id, pos: Vector3, dy, text }] (positions are projected every frame)
  setChips(list) {
    this.chipList = list;
    const keep = new Set(list.map((c) => c.id));
    for (const [id, el] of this.chipEls) if (!keep.has(id)) { el.remove(); this.chipEls.delete(id); }
    for (const c of list) {
      let el = this.chipEls.get(c.id);
      if (!el) { el = h('div', { class: 'g-chip' }); this.chipBox.append(el); this.chipEls.set(c.id, el); }
      if (el.textContent !== c.text) el.textContent = c.text;
    }
  }

  // chips stay inside the safe rect, so they never sit on the goal card, the top bar or the toolbar
  renderChips(safe) {
    const busy = !!(this.hud.panel || this.hud.topModal() || this.modalEl);
    for (const c of this.chipList) {
      const el = this.chipEls.get(c.id);
      const p = this.world.project(c.pos);
      const y = p.y + (c.dy || 0), half = (el.offsetWidth || 60) / 2;
      const vis = !busy && p.visible && p.x - half > safe.left && p.x + half < safe.right && y - 26 > safe.top && y < safe.bottom;
      el.style.display = vis ? '' : 'none';
      if (vis) el.style.transform = `translate(${p.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  // a short-lived element that fades out (tap dismisses it too)
  transient(el, ms) {
    this.root.append(el);
    const kill = () => { if (!el.isConnected || el._dying) return; el._dying = true; el.classList.add('g-out'); setTimeout(() => el.remove(), 300); };
    el.addEventListener('click', kill);
    setTimeout(kill, ms);
    return el;
  }

  // portrait + line under the quest card (coached: the new goal's line).
  // keep: it answers what the player just did, so it stays up over an open panel or popover (see render)
  coach(text, ms = 5000, { keep = false } = {}) {
    this.coachEl?.remove();
    const q = this.hud.questCard;
    const qr = shown(q) ? q.getBoundingClientRect() : null;
    const el = h('div', { class: 'g-coach' + (keep ? ' g-keep' : '') }, h('div', { class: 'g-face small' }, GUIDE.icon), h('div', {}, text));
    const card = this.cardOn && this.cardTop ? this.card.getBoundingClientRect().bottom : null;
    let under = card ?? (qr ? qr.bottom : this.topEdge(false) - 8);
    if (this.toastEl?.isConnected && !this.toastEl._dying) under = Math.max(under, this.toastEl.getBoundingClientRect().bottom);
    // over an open panel or popover: up on the dimmed top bar (under Mabel's card when it is up there)
    if (keep && (this.hud.panel || this.hud.seedPopoverOpen())) under = card ?? 0;
    el.style.top = Math.round(under + 8) + 'px';
    this.coachEl = this.transient(el, ms);
    // under the goal card's left edge, but never off screen (the card may be mid-wiggle)
    const left = Math.min(qr ? qr.left : 8, innerWidth - el.offsetWidth - 8);
    el.style.left = Math.round(Math.max(8, left)) + 'px';
    return el;
  }

  // portrait + one line under the top bar (interrupts, tips, Mabel's pocket money). A tall goal card pushes it
  // down onto where a bottom sheet starts, so it hides while a panel or the seed popover is up (its timer runs on);
  // keep: a line about that very panel (an interrupt chain's), which docks over the dimmed top bar instead
  toastCard(text, { ms = 6000, onTap = null, keep = false } = {}) {
    this.toastEl?.remove();
    const el = h('div', { class: 'g-toast' + (keep ? ' g-keep' : '') }, h('div', { class: 'g-face' }, GUIDE.icon), h('div', { class: 'g-body' }, h('div', { class: 'g-name' }, GUIDE.name), h('div', {}, text)));
    if (onTap) el.addEventListener('click', onTap);
    const coach = this.coachEl?.isConnected && !this.coachEl._dying ? this.coachEl.getBoundingClientRect().bottom + 4 : 0;
    el.style.top = Math.round(Math.max(this.topEdge(false), coach)) + 'px';
    this.toastEl = this.transient(el, ms);
    return el;
  }

  // a tappable one-liner above the toolbar ("Silo full · Sell extras ›")
  actionChip(text, onTap, ms = 4500) {
    this.actionEl?.remove();
    const el = h('button', { class: 'g-action', onclick: () => onTap() }, text);
    el.style.top = Math.round(this.bottomEdge() - 44) + 'px';
    this.actionEl = this.transient(el, ms);
    return el;
  }

  // a little label under a HUD element ("⭐ fills your level bar")
  tag(target, text, ms = 2000) {
    if (!shown(target)) return null;
    const r = target.getBoundingClientRect();
    const el = h('div', { class: 'g-tag' }, text);
    el.style.left = Math.round(r.left + 4) + 'px';
    el.style.top = Math.round(r.bottom + 8) + 'px';
    return this.transient(el, ms);
  }
}

// ==================================================================================== controller
export class GuideController {
  constructor(ctrl) {
    this.ctrl = ctrl;
    this.game = ctrl.game;
    this.hud = ctrl.hud;
    this.world = ctrl.world;
    let root = document.getElementById('guide');
    if (!root) { root = h('div', { id: 'guide' }); document.getElementById('app').append(root); }
    this.layer = new GuideLayer(root, ctrl);
    this.layer.onBlock = (e) => this.blockerTap(e);
    this.layer.onArrow = () => this.arrowTap();
    this.layer.onSkip = () => this.askSkip();
    this.layer.onCardTap = () => this.cardTap();

    this.started = false;
    this.step = null; // planStep result (shared, read-only)
    this.view = { act: null }; // what is being pointed at and how
    this.res = null; // the resolved target of this frame
    this.session = null; // Show me / need / interrupt chain
    this.hard = null; // the hard beat in progress
    this.released = new Set(); // hard beats turned soft
    this.queue = []; // modals and toast-cards waiting for a free screen
    this.line = { key: null, text: '' };
    this.lineAt = {};
    this.flashLine = null;
    this.qi = this.game.s.quest.index;
    this.t = 0;
    this.lastActivity = nowS();
    this.camAt = 0;
    this.camSig = '';
    this.glowUntil = 0;
    this.lastTipAt = -1e9;
    this.tipCtx = {}; // this session's triggers for EXTRA_TIPS (cameraTipDue, …)
    this.dailyQueued = false;
    this.dropInterrupt = null;
    this.fieldChip = null; // the field just planted in the tour: { tiles, crop }
    this.toastFor = null;
    this.stepKeyAt = null;
    this.burst = 0;

    const g = this.game, hud = this.hud;
    // progressive reveal: the HUD follows the save (a new farm starts with only 🪙 and ⚙️)
    hud.setReveal(g.revealedKeys());
    g.on('reveal', (k) => (k === 'all' ? hud.setReveal('all') : hud.reveal(k)));
    hud.setHooks({
      onQuestTap: () => this.questTap(),
      onMeanwhileTap: () => this.showMe({ meanwhile: true }),
      levelUpGo: (level) => g.tutorialMode() !== 'guided' && levelUpGo(g, level),
      onLevelUpGo: () => setTimeout(() => this.showMe(), 300),
      onMissing: (item) => this.showMe({ need: item }),
      onSkipTour: () => this.askSkip(),
      preferredTab: (id) => this.preferredTab(id),
      goalRecipe: (type) => this.goalRecipe(type),
      isGoal: (key) => this.steps().some((s) => s?.target?.ui === key),
      visitorLine: (v) => (v.first ? VISITORS.firstLine : null),
      onSettings: () => this.requestTick(),
      onUiChange: () => this.requestTick(),
      // "Sell extras" never sells below what the planner keeps back for the goal, an order or the animals
      sellFloors: () => reserves(g),
    });

    for (const e of IDLE_EVENTS) g.on(e, () => { this.lastActivity = nowS(); this.wiggled = false; });
    for (const e of PLAN_EVENTS) g.on(e, () => this.requestTick());
    // reveal right away so the first harvest's 🌾 already flies into a visible 📦
    g.on('quest', (q) => { this.revealNow(); this.questEvent(q); });
    g.on('chapter', (d) => this.chapter(d));
    g.on('drop', ({ item }) => {
      if (!g.hasSeen('firstDrop') && g.tutorialMode() !== 'independent' && !this.dropInterrupt) this.dropInterrupt = { key: 'firstDrop', item };
    });
    g.on('safetyNet', () => this.speak('safetyNet', TUTORIAL.lines.safetyNet, { once: false }));
    // a parcel that turns up while the game is in the background counts as "came while you were away"
    g.on('postReady', () => { if (document.hidden) this.postAwayDue = true; });
    // (and that line goes away once the parcel is opened)
    g.on('post', () => {
      const el = this.postAwayEl;
      if (el?.isConnected && !el._dying) { el._dying = true; el.classList.add('g-out'); setTimeout(() => el.remove(), 300); }
    });
    g.on('tutorial', () => this.modeChanged());
    document.addEventListener('pointerdown', (e) => this.onPointer(e), true);
    document.addEventListener('pointerup', (e) => this.pointerUp(e), true);
    document.addEventListener('pointercancel', (e) => this.pointerUp(e), true);
  }

  // ------------------------------------------------------------ start (§6.7)
  start() {
    const g = this.game;
    this.started = true;
    this.startedAt = nowS();
    const guided = g.tutorialMode() === 'guided';
    // the session that shows "What's new" (a farm from before the Post) skips "A parcel came while you were away"
    this.whatsNewSession = g.hasSeen('whatsNew:pending') && !g.hasSeen('tip:whatsNew');
    this.postAwayDue = g.postStatus().ready;
    if (guided && !g.hasSeen('welcome')) {
      this.showWelcome();
      setTimeout(() => this.openingShot(), 350);
    }
    this.tick();
    if (guided && g.hasSeen('welcome')) {
      // resuming a tour: frame what Mabel points at
      const res = this.view.act ? this.layer.resolve(this.view.act.target, this.view.act) : null;
      if (res?.world) this.frameTo(res.world, { minDist: 13, instant: true });
    }
    // an old farm's first load: one line about the new goal card
    const t = g.s.tutorial;
    if (!guided && t && !t.startedAt && !g.hasSeen('line:migratedTip') && g.s.settings?.hints !== 'off') {
      this.enqueue('tip', () => {
        if (!g.markSeen('line:migratedTip')) return;
        this.layer.toastCard(TUTORIAL.lines.migratedTip, { ms: 7000, onTap: () => this.showMe() });
        this.wiggleQuest();
      });
    }
  }

  // 1.6 s glide from high over the farm down to the starter field (§6.9)
  openingShot() {
    const tiles = Object.keys(this.game.s.soil).map((k) => k.split(',').map(Number));
    if (tiles.length) this.world.frame(this.world.tilesCorners(tiles, 0.3), { safe: this.hud.safeRect(), duration: 1.6, minDist: 13 });
  }

  showWelcome() {
    const g = this.game;
    g.markSeen('line:welcome');
    this.layer.modal({
      text: TUTORIAL.lines.welcome,
      buttons: [
        { label: 'Let\'s go!', key: 'guide:next', cls: 'btn wide', onClick: () => { this.ctrl.audio.play('click'); this.layer.closeModal(); g.markSeen('welcome'); this.tick(); } },
        { label: 'I\'ve farmed before', key: 'guide:alt', cls: 'btn wide ghost', onClick: () => { this.ctrl.audio.play('click'); this.layer.closeModal(); g.skipTutorial(); this.tick(); } },
      ],
      esc: 0, // Esc never skips the tour by accident
    });
  }

  // Skip tour (§6.8): asked in-game, never with a browser dialog
  askSkip() {
    if (this.game.tutorialMode() !== 'guided') return;
    this.layer.modal({
      text: TUTORIAL.lines.skipConfirm,
      buttons: [
        { label: 'Skip', cls: 'btn wide red', onClick: () => this.skip() },
        { label: 'Keep going', cls: 'btn wide ghost', onClick: () => { this.layer.closeModal(); this.requestTick(); } },
      ],
    });
  }

  skip() {
    const g = this.game;
    this.layer.closeModal();
    g.skipTutorial();
    this.session = null;
    this.endHard();
    if (!this.dailyQueued && g.dailyStatus().canClaim) {
      this.dailyQueued = true;
      this.enqueue('daily', () => this.hud.showDaily(true));
    }
    this.tick();
  }

  onKey(e) {
    if (!this.layer.modalOpen) return false;
    const k = e.key.toLowerCase();
    if (k === 'enter') this.layer.modalKey(true);
    else if (k === 'escape') this.layer.modalKey(false);
    return true;
  }

  // ------------------------------------------------------------ the 4 Hz pass
  requestTick() {
    // at most a few event-driven passes per frame; the 4 Hz pass catches up on the rest
    if (this.tickQueued || !this.started || ++this.burst > 6) return;
    this.tickQueued = true;
    queueMicrotask(() => { this.tickQueued = false; if (!this.ticking) this.tick(); });
  }

  uiState() {
    const hud = this.hud, c = this.ctrl;
    const p = hud.panelInfo();
    return {
      panel: p ? { id: p.id, tab: p.tab, ref: p.ref, age: (performance.now() - p.openedAt) / 1000 } : null,
      placing: c.placing ? { type: c.placing.type, valid: c.placing.valid, gift: !!c.placing.gift } : null,
      tool: c.tool,
      modal: hud.topModalKind(),
      popover: hud.seedPopoverOpen(),
      interrupt: this.dropInterrupt,
    };
  }

  tick() {
    if (!this.started || this.ticking) return;
    this.ticking = true;
    try {
      const g = this.game;
      const m = nextMode(g);
      if (m !== g.tutorialMode()) g.setTutorialMode(m);
      const ui = this.uiState();
      const step = planStep(g, ui);
      this.step = step;
      if (step.reveal?.length) g.reveal(step.reveal);
      this.hud.setQuestGuide(questCardInfo(g, step));
      this.questChanged();
      this.interrupts(step);
      this.graduation(step);
      this.autoDaily();
      this.tips();
      this.postAway();
      this.pump();
      const was = this.view?.act?.key;
      this.view = this.decide(step, ui);
      if (this.view.act?.key !== was) this.layer.prune();
      this.cardLine(step);
      this.chips(step);
      this.markers();
    } finally {
      this.ticking = false;
    }
  }

  // reveal what the current step needs, synchronously (fly-to targets are read when an effect starts)
  revealNow() {
    if (!this.started || this.ticking) return;
    const step = planStep(this.game, this.uiState());
    if (step.reveal?.length) this.game.reveal(step.reveal);
  }

  // ------------------------------------------------------------ what to point at
  decide(step, ui) {
    const g = this.game, now = nowS();
    const v = { act: null, finger: false, ring: null, hard: false, arrow: false };
    if (this.layer.modalOpen) return v;
    if (this.session?.kind === 'interrupt' && (ui.modal || ui.placing)) { this.session.lastInput = now; return v; } // paused
    if (this.session) {
      const st = this.sessionStep(ui);
      const act = pick(st);
      if (this.sessionAlive(st, act, now)) {
        if (act.key !== this.session.stepKey) { this.session.stepKey = act.key; this.session.lastInput = now; this.session.scrolled = false; }
        return { act, finger: true, ring: 'strong', hard: false, arrow: true, session: true };
      }
      this.endSession();
    }
    const mode = g.tutorialMode();
    if (mode === 'guided') {
      const act = pick(step);
      if (!act) return v;
      const hard = step.gate === 'hard' && act === step && !this.released.has(step.key) && !ui.panel && !ui.modal && !ui.placing;
      return { act, finger: true, ring: 'strong', hard, arrow: true };
    }
    // coached / independent: a glow for a new goal, idle nudges (§2.1)
    const hints = g.s.settings?.hints || 'full';
    const act = pick(step);
    if (!act || hints === 'off') return v;
    if (now < this.glowUntil) Object.assign(v, { act, ring: 'glow' });
    if (this.quiet(ui, now)) return v;
    const idle = now - this.lastActivity;
    const [glowAt, fingerAt] = mode === 'coached' ? TUTORIAL.idle.coached : [TUTORIAL.idle.independent, Infinity];
    if (idle >= glowAt) {
      Object.assign(v, { act, ring: 'glow' });
      if (!this.wiggled) { this.wiggled = true; this.wiggleQuest(); }
    }
    if (idle >= fingerAt && hints === 'full') Object.assign(v, { finger: true, arrow: true, ring: 'strong' });
    return v;
  }

  // nudges wait while the player is busy with something else
  quiet(ui, now) {
    return !!(ui.panel || ui.modal || ui.placing || ui.popover || this.ctrl.input.gesture || now - this.camAt < 3 || document.hidden);
  }

  steps() { return [this.view?.act, this.step, this.step?.meanwhile]; }

  preferredTab(panelId) {
    for (const s of this.steps()) if (s?.panel?.id === panelId && s.panel.tab) return s.panel.tab;
    if (panelId === 'shop' && this.game.s.gifts?.length && this.steps().some((s) => s?.gift && s.why !== 'modal')) return 'decor';
    return null;
  }

  goalRecipe(type) {
    for (const s of this.steps()) if (s?.recipe && RECIPES[s.recipe]?.building === type) return s.recipe;
    const q = this.game.currentQuest();
    return q.event === 'produce' && RECIPES[q.filter]?.building === type && !this.game.questDone() ? q.filter : null;
  }

  // ------------------------------------------------------------ Show me (§2.2), need (§2.7), interrupt chains
  questTap() {
    const g = this.game;
    if (g.tutorialMode() === 'guided') {
      if (this.step?.key === 'grad:end') { this.graduate(); return; }
      this.layer.pulseFinger();
      this.layer.nudgeCard();
      return;
    }
    this.showMe();
  }

  // opts: { need: item } | { meanwhile: true } | {} (the current goal)
  showMe(opts = {}) {
    const g = this.game;
    if (!this.started || this.layer.modalOpen) return;
    this.hud.closeCamPad?.();
    if (this.session) this.endSession();
    this.tick();
    const kind = opts.need ? 'need' : opts.meanwhile ? 'meanwhile' : 'show';
    this.session = { kind, item: opts.need || null, had: opts.need ? g.count(opts.need) : 0, qi: g.s.quest.index, lastInput: nowS(), misses: 0, framed: false, stepKey: null };
    const st = this.sessionStep(this.uiState());
    if (!pick(st)) { this.session = null; this.explain(st); return; }
    this.tick();
  }

  sessionStep(ui) {
    const s = this.session, g = this.game;
    if (s.kind === 'need') return need(g, ui, s.item, 0, 1);
    if (s.kind === 'interrupt') return this.step?.why === 'interrupt' && this.step.interrupt === s.key ? this.step : null;
    // Show me keeps to the goal: a one-time beat that comes up meanwhile waits for the session (its line comes with it)
    const st = this.step?.why === 'interrupt' ? planStep(g, { ...ui, skipInterrupt: true }, { cache: false }) : this.step;
    if (s.kind === 'meanwhile') return st?.meanwhile || st;
    return st;
  }

  sessionAlive(st, act, now) {
    const s = this.session, g = this.game;
    if (!act || now - s.lastInput > SESSION_IDLE || s.misses >= 2) return false;
    if (s.kind === 'show' && g.s.quest.index !== s.qi) return false;
    if (s.kind === 'need' && g.count(s.item) > s.had) return false;
    if (s.kind === 'interrupt' && (!st || g.hasSeen(s.key))) return false;
    return true;
  }

  endSession() {
    const s = this.session;
    this.session = null;
    if (s?.kind === 'interrupt') this.game.markSeen(s.key); // its chain ended or was abandoned
  }

  // Show me with nothing to tap: say why in one line
  explain(st) {
    const now = this.game.now();
    let text = 'Everything\'s busy! Check back soon.';
    if (st?.block?.kind === 'materials') text = `🧰 ${st.label || 'Materials drop while you farm'}`;
    else if (st?.kind === 'wait' && st.wait?.until) text = `⏳ ${st.wait.icon || ''} ${shortTime((st.wait.until - now) / 1000)} · ${st.wait.label || st.label || ''}`;
    else if (st?.say) text = st.say;
    else if (st?.label && st.kind === 'none') text = `${st.icon || ''} ${st.label}`;
    this.layer.coach(text.replace(/\s+/g, ' ').trim(), 4000, { keep: true });
  }

  onPointer(e) {
    const s = this.session;
    if (!s) { this.takeHint(e); return; }
    const t = e.target;
    if (this.layer.root.contains(t) && !this.layer.isBlocker(t)) return; // Mabel's own card / arrow
    s.lastInput = nowS();
    const r = this.res?.rect;
    // a greyed-out button can't do anything: tapping it counts as a miss (two end the session)
    if (r && this.res.el?.matches?.('.disabled, :disabled') && inRect(e.clientX, e.clientY, pad(r, 16))) { s.misses++; return; }
    if (r && inRect(e.clientX, e.clientY, pad(r, 16))) {
      // the end of a one-time chain was tapped: it counts as seen once the tap went through
      const end = s.kind === 'interrupt' && s.chainEnd === this.res.key;
      if (end) setTimeout(() => { if (this.session === s) this.endSession(); this.requestTick(); }, 250);
      return;
    }
    // scrolling the open panel, picking in the seed popover or turning the view (🧭, its pad) is not a miss
    if (t.closest?.('.sheet, .seed-pop, .levelup, .cam-pad, .cam-btn')) return;
    if (t === this.world.canvas) {
      // on the farm only a tap counts (§2.2 "2 taps outside the target"): a pinch's second finger or a camera drag
      // doesn't. Input decides on pointerup, so the miss waits for it (see pointerUp)
      if (this.ctrl.input.pointers.size === 0) s.pendingMiss = e.pointerId;
      return;
    }
    s.misses++;
  }

  // capture phase, before Input's own pointerup (a window listener): its gesture still says whether that was a tap
  pointerUp(e) {
    const s = this.session;
    if (!s || s.pendingMiss == null || s.pendingMiss !== e.pointerId) return;
    s.pendingMiss = null;
    const gest = this.ctrl.input.gesture;
    if (e.type === 'pointerup' && gest && gest.id === e.pointerId && !gest.moved && (gest.mode === 'pan' || gest.mode === 'paint')) s.misses++;
  }

  // Tapping a glowing hint (a new goal's glow, an idle nudge) takes it: like Show me, the finger then walks the rest
  // of the way (e.g. the glowing order board opens Orders, then Deliver), so a nudge never leaves you in a panel alone.
  takeHint(e) {
    const v = this.view, r = this.res?.rect;
    if (!v?.act || !v.ring || this.game.tutorialMode() === 'guided' || !r || !inRect(e.clientX, e.clientY, pad(r, 16))) return;
    this.session = { kind: 'show', item: null, had: 0, qi: this.game.s.quest.index, lastInput: nowS(), misses: 0, framed: true, scrolled: true, stepKey: v.act.key };
    this.glowUntil = 0;
    this.requestTick();
  }

  // ------------------------------------------------------------ hard beats (§6.6)
  hardFrame(v, res) {
    const now = nowS();
    const key = this.step?.key;
    if (!v.hard || this.released.has(key)) { if (this.hard) this.endHard(); return false; }
    if (!this.hard || this.hard.key !== key) {
      this.hard = { key, since: now, misses: 0, lostSince: null };
      this.ctrl.input.cameraLocked = true;
      // the beat frames its target at the default tilt (a view tilted beforehand comes back to it); the turn stays
      const tilted = Math.abs(this.world.rig.goal.pitch - CAMERA.pitch.def) > 0.01;
      if (res?.world) this.frameTo(res.world, { minDist: 13, pitch: tilted ? CAMERA.pitch.def : undefined });
    }
    const hb = this.hard;
    const ok = res && res.rect && (res.dom || res.visible) && res.rect.x + res.rect.w > 0 && res.rect.x < innerWidth && res.rect.y + res.rect.h > 0 && res.rect.y < innerHeight;
    if (ok) hb.lostSince = null;
    else hb.lostSince ??= now;
    if ((hb.lostSince != null && now - hb.lostSince > HARD_LOST) || now - hb.since > HARD_MAX) { this.release(); return false; }
    return true;
  }

  release() {
    if (this.hard) this.released.add(this.hard.key);
    this.endHard();
    this.requestTick();
  }

  endHard() {
    this.hard = null;
    this.ctrl.input.cameraLocked = false;
  }

  blockerTap(e) {
    // ⚙️ stays usable over the dim
    const sb = this.hud.settingsBtn.getBoundingClientRect();
    if (inRect(e.clientX, e.clientY, { x: sb.left, y: sb.top, w: sb.width, h: sb.height })) { this.hud.settingsBtn.click(); return; }
    const hb = this.hard;
    if (!hb) return;
    hb.misses++;
    if (hb.misses >= 2) { this.release(); return; }
    this.layer.pulseFinger();
    this.layer.nudgeCard();
  }

  arrowTap() {
    const res = this.res;
    if (res?.world) {
      // in view but hidden behind a building or a bubble: turn the camera a quarter to see it from another side
      if (res.visible && inSafe(res.point, this.hud.safeRect())) { this.world.rig.rotateBy(Math.PI / 2); this.world.rig.onView?.(); }
      this.frameTo(res.world);
    }
    if (this.session) this.session.lastInput = nowS();
  }

  // frame world points in the safe rect, keeping the player's zoom when it fits (and their turn and tilt:
  // opts pass through to World.frame, where only a hard beat asks for the default tilt)
  frameTo(points, opts = {}) {
    const d = this.world.rig.goal.dist;
    return this.world.frame(points, { safe: this.hud.safeRect(), minDist: Math.min(30, Math.max(10, d)), maxDist: Math.max(30, d), ...opts });
  }

  cardTap() {
    if (this.game.tutorialMode() !== 'guided') return;
    this.layer.pulseFinger();
  }

  // ------------------------------------------------------------ per frame (from the main loop)
  frame(dt) {
    if (!this.started) return;
    this.burst = 0;
    this.t += dt;
    if (this.t >= TICK) { this.t = 0; this.tick(); }
    this.trackCamera();
    const v = this.view || {};
    let res = v.act ? this.layer.resolve(v.act.target, v.act) : null;
    // a speech bubble a tap can't reach (off screen, under the HUD) whose step has a HUD way in: point there instead
    // (B4 / B11: the order board's bubble → the 🚚 Orders button); the edge arrow stays for targets without one
    if (res?.rect && !res.dom && v.act.fallback && v.act.target?.ui?.startsWith('bubble:') && !(res.visible && this.layer.tappable(res.point, res.el))) {
      const fb = this.layer.resolveKey(v.act.fallback);
      if (fb?.rect && fb.dom) res = fb;
    }
    if (res && res.hidden !== undefined) {
      // a hidden HUD group is revealed before it is pointed at
      if (res.hidden) this.game.reveal(res.hidden);
      res = null;
    }
    if (!res && v.act?.chain?.length) res = this.chainFallback(v.act);
    // nothing in the world is pointed at through an open panel or modal
    if (res && !res.dom && (this.hud.panel || this.hud.topModal())) res = null;
    // a HUD target under the open panel (the goal card behind a landscape sheet): close the panel first.
    // (A target inside the panel that is scrolled out of view is scrolled to instead, below.)
    const sheet = this.hud.panel?.el;
    if (res?.under && sheet && !sheet.contains(res.el) && res.under.closest('.backdrop') === sheet) res = this.layer.resolveKey('panel:close') || res;
    // the seed popover of an earlier tap hides the tile Mabel now points at: put it away (never one opened while
    // she pointed at the same thing: that's the player's own tap, made just now)
    const pop = this.hud.seedPop?.el || null;
    if (pop !== this.popEl) { this.popEl = pop; this.popActKey = v.act?.key ?? null; }
    if (res && !res.dom && res.visible && pop && this.popActKey !== v.act.key && !v.act.target?.ui?.startsWith('seed:')) {
      const el = document.elementFromPoint(res.point.x, res.point.y);
      if (el?.closest('.seed-pop')) this.hud.closeSeedPopover();
    }
    this.res = res;
    const hard = this.hardFrame(v, res);
    const s = this.session;
    if (s && res) {
      if (!s.framed) { s.framed = true; if (res.world && !this.world.inSafe(res.world, this.hud.safeRect(), 0.85)) this.frameTo(res.world); }
      if (!s.scrolled && res.el) { s.scrolled = true; this.layer.scrollTo(res.el); }
    }
    // bring the target into view in a scrolling panel: once per step, and again while it is scrolled out of sight
    const clipped = res?.under && sheet?.contains(res.el) && nowS() - (this.scrolledAt || 0) > 0.6;
    if (res?.el && v.act && (this.stepKeyAt !== v.act.key || clipped)) { this.stepKeyAt = v.act.key; this.scrolledAt = nowS(); this.layer.scrollTo(res.el); }
    const safe = this.hud.safeRect();
    const cardTop = this.layer.modalOpen ? false : this.cardSpot(res, !!(this.hud.panel || this.hud.topModal()));
    this.layer.render({ ...v, res, hard, gesture: v.act?.gesture, cardTop }, safe);
  }

  // the deepest chain element that is on screen right now (when the step's own target isn't)
  chainFallback(act) {
    for (const key of [...act.chain].reverse()) {
      const r = this.layer.resolveKey(key);
      if (r && r.rect && r.dom) return r;
    }
    return null;
  }

  // Where Mabel's card docks: over the dimmed top bar while a panel or modal is up, under the top bar while placing
  // or when the target sits low (with a little hysteresis), else above the toolbar. If that spot would cover the
  // target (short landscape screens), the other one is used when it covers less.
  cardSpot(res, covered) {
    const L = this.layer;
    let pos;
    if (covered) pos = 'over';
    else if (this.ctrl.placing) pos = true;
    else if (!res?.rect) return L.cardTop;
    else {
      const bottom = (res.rect.y + res.rect.h) / innerHeight;
      pos = L.cardTop ? bottom > CARD_LOW - 0.05 : bottom > CARD_LOW;
    }
    if (!res?.rect || !L.cardOn) return pos;
    const t = pad(res.rect, 6);
    const cover = (p) => overlap(L.cardRectAt(p, t), t);
    const a = cover(pos);
    if (!a) return pos;
    const alt = pos ? false : true;
    return cover(alt) < a ? alt : pos;
  }

  trackCamera() {
    const r = this.world.rig;
    const sig = `${r.target.x.toFixed(2)},${r.target.z.toFixed(2)},${r.dist.toFixed(2)},${r.yaw.toFixed(3)},${r.pitch.toFixed(3)}`;
    if (sig !== this.camSig) { this.camSig = sig; this.camAt = nowS(); }
  }

  // ------------------------------------------------------------ Mabel's lines (guided)
  cardLine(step) {
    const g = this.game, L = this.layer;
    const guided = g.tutorialMode() === 'guided';
    if (!guided || step.key === 'welcome' || L.modalOpen) { if (L.cardOn) L.showCard(false); return; }
    const now = nowS();
    let key = null, text = null;
    const f = this.flashLine;
    if (f && now < f.until) ({ key, text } = f);
    else {
      this.flashLine = null;
      const act = this.view?.act;
      let s = step.say ? step : null;
      // the goal's own line first, then (a few seconds later) the Meanwhile line
      if (act && act !== step && act.say && (!s || now - (this.lineAt[s.stepKey] ?? now) >= MEANWHILE_LINE)) s = act;
      if (s) { key = s.stepKey; text = s.say; } else if (step.why === 'claim') { key = 'claim'; text = TUTORIAL.lines.claim; }
    }
    if (!key) {
      if (this.line.key) { L.showCard(true, { skip: !graduationPending(g) }); return; }
      const q = g.currentQuest();
      key = 'quest:' + q.id;
      text = q.say || q.text;
    }
    const fresh = key !== this.line.key;
    if (fresh) {
      this.lineAt[key] ??= now;
      if (TUTORIAL.lines[key]) g.markSeen('line:' + key);
    }
    if (fresh || text !== this.line.text) L.say(text, { fresh });
    this.line = { key, text };
    L.showCard(true, { skip: !graduationPending(g) });
  }

  // a one-off line: a side bubble while the tour's card keeps the step's line, else a toast-card.
  // once: only if never shown before.
  speak(key, text, { once = true, delay = 0 } = {}) {
    const g = this.game;
    if (once && g.hasSeen('line:' + key)) return;
    let tries = 0;
    const go = () => {
      // never on top of a modal (e.g. the plow tip vs the level-up it just earned): wait for it to close
      if ((this.hud.topModal() || this.layer.modalOpen) && ++tries < 30) { setTimeout(go, 500); return; }
      if (once && !g.markSeen('line:' + key)) return;
      if (g.tutorialMode() === 'guided') this.layer.coach(text, FLASH * 1000); else this.layer.toastCard(text);
    };
    if (delay) setTimeout(go, delay); else go();
  }

  // ------------------------------------------------------------ goals, chapters, interrupts
  questChanged() {
    const g = this.game, qi = g.s.quest.index;
    if (qi === this.qi) return;
    const prev = QUESTS[this.qi];
    this.qi = qi;
    this.lastActivity = nowS();
    const mode = g.tutorialMode();
    // B2: the first claim shows what ⭐ is for
    if (mode === 'guided' && prev?.id === 'harvest') setTimeout(() => this.layer.tag(this.hud.levelBoxEl.querySelector('.xp-bar') || this.hud.levelBoxEl, '⭐ fills your level bar', 2000), 500);
    // §2.5: a new goal in coached mode gets Mabel's line for 5 s and a short glow on its target
    if (mode === 'coached' && qi < QUESTS.length && !graduationPending(g) && g.s.settings?.hints !== 'off') {
      const q = g.currentQuest();
      // it waits (≤ 60 s) for a modal (the chapter chest), the gift's ghost and another of her lines: it never
      // replaces "Tap ✓ to put it up", and comes once the gift is up
      let tries = 0;
      const say = () => {
        if (this.game.s.quest.index !== qi) return;
        const L = this.layer, talking = L.coachEl?.isConnected && !L.coachEl._dying;
        const wait = this.hud.topModal() || this.ctrl.placing?.gift || talking;
        if (wait && ++tries < 60) { setTimeout(say, 1000); return; }
        if (!this.hud.topModal() && !this.ctrl.placing?.gift) L.coach(q.say || q.text, 5000);
      };
      setTimeout(say, 900);
      this.glowUntil = nowS() + 1 + GLOW_NEW;
    }
  }

  questEvent(q) {
    const g = this.game;
    if (g.tutorialMode() === 'guided' && q?.id === 'eggs' && g.questProgress() > 0) this.speak('eggsCollected', TUTORIAL.lines.eggsCollected);
  }

  // chests for chapters 2+ (chapter 1's is part of graduation)
  chapter({ chapter }) {
    const g = this.game;
    if (chapter.id === 1 && g.tutorialMode() === 'guided') return;
    this.enqueue('chest', () => this.hud.showChest({
      chapter,
      onOpen: () => {
        const gift = chapter.reward?.gift;
        if (gift && (g.s.gifts || []).includes(gift)) {
          this.enqueue('gift', () => {
            this.ctrl.startPlacement(gift, { gift: true, near: fieldCentre(g) });
            if (g.s.settings?.hints !== 'off') this.layer.coach(`${OBJECTS[gift].icon} A ${OBJECTS[gift].name} for your farm! Tap ✓ to put it up.`, 5000);
          }, () => (g.s.gifts || []).includes(gift));
        }
      },
    }));
  }

  interrupts(step) {
    const g = this.game;
    if (step.why !== 'interrupt' || !step.interrupt || g.hasSeen(step.interrupt)) return;
    const key = step.interrupt;
    const guided = g.tutorialMode() === 'guided';
    if (step.toast || step.kind === 'none') {
      // a one-liner: show it once the screen is free, then it's done
      this.enqueue('interrupt:' + key, () => {
        if (!g.markSeen(key)) return;
        if (this.dropInterrupt?.key === key) this.dropInterrupt = null;
        if (guided) this.flashLine = { key: 'flash:' + key, text: step.say, until: nowS() + FLASH + 1 };
        else this.layer.toastCard(step.say);
        if (actionable(step)) this.glowUntil = nowS() + 6;
        this.requestTick();
      });
      return;
    }
    // a chain (silo full → sell extras; Mabel's visit → serve her): once the screen is free, follow it like Show me
    if (this.session?.key !== key) {
      this.enqueue('interrupt:' + key, () => {
        const chain = step.chain?.length ? step.chain : [step.target?.ui].filter(Boolean);
        this.session = { kind: 'interrupt', key, chainEnd: chain[chain.length - 1], qi: g.s.quest.index, lastInput: nowS(), misses: 0, framed: false, stepKey: null };
        this.toastFor = null;
        this.requestTick();
      }, () => !g.hasSeen(key));
      return;
    }
    if (!guided && step.say && this.toastFor !== step.stepKey) {
      this.toastFor = step.stepKey;
      this.layer.toastCard(step.say, { ms: 6000, keep: true });
    }
  }

  // B13: chest → gift → daily gift → the goal card; each piece runs when the screen is free (§6.10)
  graduation(step) {
    const g = this.game, hud = this.hud;
    if (!graduationPending(g)) return;
    if (step.modal === 'chest' && hud.topModalKind() !== 'chest') {
      this.enqueue('chest', () => hud.showChest({ chapter: CHAPTERS[0], onOpen: () => { g.markSeen('grad:chest'); this.requestTick(); } }), () => !g.hasSeen('grad:chest'));
    }
    if (step.startPlacement && !this.ctrl.placing) {
      const sp = step.startPlacement;
      this.enqueue('gift', () => this.ctrl.startPlacement(sp.type, { gift: true, near: sp.near }), () => !g.hasSeen('grad:gift') && (g.s.gifts || []).includes(sp.type));
    }
    if (step.modal === 'daily' && hud.topModalKind() !== 'daily') {
      this.enqueue('daily', () => hud.showDaily(false, { onClose: () => { g.markSeen('grad:daily'); this.requestTick(); } }), () => !g.hasSeen('grad:daily'));
    }
  }

  graduate() {
    const g = this.game;
    g.markSeen('grad:end');
    const m = nextMode(g);
    g.setTutorialMode(m === 'guided' ? 'coached' : m);
    this.layer.showCard(false);
    this.showMe();
  }

  modeChanged() {
    if (this.game.tutorialMode() !== 'guided') {
      this.endHard();
      this.flashLine = null;
      this.layer.showCard(false);
    }
    this.requestTick();
  }

  // the daily gift pops up by itself only when shouldAutoShowDaily says so (§6.7)
  autoDaily() {
    const g = this.game;
    if (this.dailyQueued || graduationPending(g)) return;
    if (!shouldAutoShowDaily(g, g.now())) return;
    this.dailyQueued = true;
    // a returning player is greeted by the gift a moment after the farm appears
    this.enqueue('daily', () => this.hud.showDaily(true), () => g.dailyStatus().canClaim, this.startedAt + 1.2);
  }

  // FEATURE_TIPS (§2.8), then EXTRA_TIPS (§7.6): once each, after the level-up closed, 45 s apart, never in the tour
  tips() {
    const g = this.game;
    if (g.tutorialMode() === 'guided' || g.s.settings?.hints === 'off') return;
    if (nowS() - this.lastTipAt < TIP_GAP || this.queue.some((q) => q.kind === 'tip')) return;
    const tip = pendingTip(g, this.tipCtx);
    if (!tip) return;
    this.enqueue('tip', () => {
      if (!markTipSeen(g, tip)) return;
      this.lastTipAt = nowS();
      const onTap = tip.onTap ? () => { try { tip.onTap(this); } catch (e) { console.error('tip tap:', e); } } : null;
      this.layer.toastCard(tip.text, { ms: 7000, onTap });
    });
  }

  // "📬 A parcel came while you were away, dear!": once per session, for a parcel that was waiting at load (or turned
  // up in the background) and is still unopened 20 s in. Never in the tour, with hints off or in a What's-new session.
  postAway() {
    if (!this.postAwayDue || this.postAwayDone) return;
    const g = this.game;
    if (g.tutorialMode() === 'guided' || g.s.settings?.hints === 'off' || this.whatsNewSession) { this.postAwayDue = false; return; }
    if (nowS() - this.startedAt < POST_AWAY_AFTER) return;
    if (!g.postStatus().ready) { this.postAwayDue = false; return; }
    this.postAwayDone = true;
    this.enqueue('postAway', () => { this.postAwayEl = this.layer.toastCard(TUTORIAL.lines.postAway, { ms: 7000, onTap: () => this.hud.showPost() }); },
      () => g.postStatus().ready && g.s.settings?.hints !== 'off');
  }

  // A claimed album page (§3.7): its chest ("Page complete!", the gems, the decoration, the launch album's extras),
  // then each decoration's placement through the gift queue (the page's, then the Curio Cabinet).
  albumPrize(r) {
    const g = this.game;
    const page = ALBUM.pages.find((p) => p.id === r?.id);
    if (!page) return;
    const gifts = [r.gift, r.launch?.gift].filter(Boolean);
    const titles = [r.launch?.title, r.title].filter((x, i, a) => x && a.indexOf(x) === i);
    const note = r.launch ? '📖 The launch album is complete — Mabel is so proud!' : null;
    this.enqueue('chest:album:' + page.id, () => this.hud.showChest({
      custom: { kicker: 'Page complete!', icon: page.icon, title: page.name, tiles: [...(r.tiles || []), ...(r.launch?.tiles || [])], titles, note },
      onOpen: () => {
        for (const type of gifts) {
          const waits = () => (g.s.gifts || []).includes(type);
          if (!waits()) continue;
          this.enqueue('gift:' + type, () => {
            this.ctrl.startPlacement(type, { gift: true, near: fieldCentre(g) });
            if (g.s.settings?.hints !== 'off') this.layer.coach(`${OBJECTS[type].icon} A ${OBJECTS[type].name} for your farm! Tap ✓ to put it up.`, 5000);
          }, waits);
        }
        this.requestTick();
      },
    }));
    this.requestTick();
  }

  // Ribbon ranks claimed with a decoration or a title (§4.3): one chest for the lot ("Ribbon rank 5!"), then the
  // Blossom Oak / Frosted Pine go up through the gift queue. Gems-only ranks need no chest (main.js flies them).
  ribbonPrize(list) {
    const g = this.game;
    if (!list?.length) return;
    const top = list[list.length - 1];
    const gifts = list.map((r) => r.gift).filter(Boolean);
    const titles = list.map((r) => r.title).filter(Boolean);
    const note = list.some((r) => r.rosette) ? '🎀 A prize rosette for your level star!' : 'Mayor Hank pins a new ribbon on your gate!';
    this.enqueue('chest:ribbons:' + top.rank, () => this.hud.showChest({
      custom: { kicker: list.length > 1 ? `Ribbon ranks ${list[0].rank}–${top.rank}!` : `Ribbon rank ${top.rank}!`, icon: '🎀', title: 'Prettiest Farm',
        tiles: list.flatMap((r) => r.tiles || []), titles, note },
      onOpen: () => {
        for (const type of gifts) {
          const waits = () => (g.s.gifts || []).includes(type);
          if (!waits()) continue;
          this.enqueue('gift:' + type, () => {
            this.ctrl.startPlacement(type, { gift: true, near: fieldCentre(g) });
            if (g.s.settings?.hints !== 'off') this.layer.coach(`${OBJECTS[type].icon} A ${OBJECTS[type].name} from Mayor Hank! Tap ✓ to put it up.`, 5000);
          }, waits);
        }
        this.requestTick();
      },
    }));
    this.requestTick();
  }

  // a parcel's Mailbox goes up by the order board once its modal has closed (the gift queue waits for the modal)
  postGift(type) {
    const g = this.game;
    const waits = () => (g.s.gifts || []).includes(type);
    this.enqueue('postGift', () => {
      this.ctrl.startPlacement(type, { gift: true, near: mailboxNear(g) });
      if (g.s.settings?.hints !== 'off') this.layer.coach(TUTORIAL.lines.postMailbox, 5000);
    }, waits);
  }

  // ------------------------------------------------------------ modal queue (§6.10)
  // Runs show() once nothing else is up: no modal, no placement, no gesture, no panel (chest and daily close it).
  // at: earliest time (performance clock, s); a waiting item also holds back everything behind it
  enqueue(kind, show, valid = () => true, at = 0) {
    if (this.queue.some((q) => q.kind === kind)) return;
    this.queue.push({ kind, prio: PRIORITY[kind] ?? PRIORITY[family(kind)] ?? 5, show, valid, at });
    this.queue.sort((a, b) => a.prio - b.prio);
  }

  pump() {
    const hud = this.hud, c = this.ctrl;
    while (this.queue.length) {
      // (the 🧭 view pad is up only for a few seconds: everything waits for it)
      if (hud.topModal() || hud.levelUpPending() || c.placing || c.input.gesture || this.layer.modalOpen || hud.camPadOpen?.()) return;
      const next = this.queue[0];
      if (nowS() < next.at) return;
      const modal = family(next.kind) === 'chest' || next.kind === 'daily';
      // toast-cards and chains wait for a free screen and for Mabel to finish what she is showing
      if (!modal && (hud.panel || hud.seedPopoverOpen() || this.session || this.layer.toastEl?.isConnected)) return;
      this.queue.shift();
      if (!next.valid()) continue;
      if (hud.panel) hud.closePanel();
      next.show();
      return;
    }
  }

  // ------------------------------------------------------------ timer chips, ghost plots
  chips(step) {
    const g = this.game, now = g.now(), list = [];
    const add = (id, pos, dy, icon, until) => {
      const sec = (until - now) / 1000;
      if (sec > 1) list.push({ id, pos, dy, text: `⏳ ${icon} ${shortTime(sec)}` });
    };
    const objChip = (o, until, icon) => {
      const k = OBJECTS[o.type].kind;
      add('o' + o.id, objectCenter(g, o).setY(k === 'factory' ? 2.6 : 1.7), k === 'factory' ? -46 : 0, icon, until);
    };
    if (g.tutorialMode() === 'guided') {
      // the tour shows every running timer it has taught so far
      for (const o of g.s.objects) {
        const k = OBJECTS[o.type]?.kind;
        if (k === 'pen') {
          const busy = g.animalsIn(o.id).filter((a) => g.animalState(a) === 'producing').sort((a, b) => a.readyAt - b.readyAt)[0];
          if (busy) objChip(o, busy.readyAt, ITEMS[ANIMALS[busy.type].product].icon);
        } else if (k === 'factory') {
          const job = o.jobs.find((j) => j.endAt > now);
          if (job) objChip(o, job.endAt, ITEMS[job.recipe].icon);
        }
      }
      const p = this.fieldChip;
      if (p) {
        const growing = p.tiles.map(([x, z]) => g.soilAt(x, z)?.crop).filter((c) => c && c.type === p.crop && g.cropReadyAt(c) > now);
        if (growing.length) {
          const until = Math.max(...growing.map((c) => g.cropReadyAt(c)));
          const [cx, cz] = p.tiles.reduce((s, t) => [s[0] + t[0] / p.tiles.length, s[1] + t[1] / p.tiles.length], [0, 0]);
          add('field', tileToWorld(cx, cz).setY(0.5), -6, ITEMS[p.crop].icon, until);
        } else this.fieldChip = null;
      }
    } else if (step.kind === 'wait' && step.object && step.wait?.until - now > 20000) {
      const o = g.objById.get(step.object);
      if (o) objChip(o, step.wait.until, step.wait.icon || step.icon);
    }
    this.layer.setChips(list);
  }

  markers() {
    const v = this.view, plots = v?.act?.ghostPlots;
    const m = this.ctrl.farm.markers;
    if (plots && (v.finger || v.ring)) m.show(plots); else if (m.visible) m.clear();
  }

  // ------------------------------------------------------------ calls from main.js
  // Guided "Plow 2 new fields": one tap on a marked plot plows every marked plot (§1.2 #3).
  plowAssist(x, z) {
    const g = this.game, q = g.currentQuest();
    if (g.tutorialMode() !== 'guided' || q.event !== 'plow' || g.questDone()) return null;
    const tiles = this.ctrl.farm.markers.tiles;
    const i = tiles.findIndex(([a, b]) => a === x && b === z);
    if (i < 0) return null;
    this.speak('plowTip', TUTORIAL.lines.plowTip, { delay: 900 });
    return [tiles[i], ...tiles.filter((_, k) => k !== i)];
  }

  planted(tiles, crop) {
    if (tiles?.length) this.fieldChip = { tiles, crop };
    this.requestTick();
  }

  // the card docks for placement right away, so the ghost is framed clear of it
  placementStarted() {
    if (this.layer.cardOn) this.layer.placeCard(true);
  }

  placed(o, p) {
    const g = this.game;
    if (p?.gift && p.type === CHAPTERS[0].reward.gift && graduationPending(g)) g.markSeen('grad:gift');
    // the first pen or workshop placed after the tour brings the turn & tilt tip (a good moment to look around it)
    const kind = OBJECTS[o.type]?.kind;
    if (!p?.gift && g.tutorialMode() !== 'guided' && (kind === 'pen' || kind === 'factory')) this.tipCtx.cameraTipDue = true;
    if (o.type === 'coop' && g.tutorialMode() === 'guided') this.speak('cameraTip', TUTORIAL.lines.cameraTip, { delay: 400 });
    this.requestTick();
  }

  placementCancelled(p) {
    const g = this.game;
    if (p?.gift && p.type === CHAPTERS[0].reward.gift && graduationPending(g)) g.markSeen('grad:gift'); // the gift waits in Shop → Decor
    // and Mabel says so, once the screen is free (in the tour that's after the daily gift)
    const waits = () => (g.s.gifts || []).includes(p.type);
    if (p?.gift && waits() && g.s.settings?.hints !== 'off') {
      const text = TUTORIAL.lines.giftWaits.replace('{gift}', OBJECTS[p.type]?.name || 'gift');
      this.enqueue('giftWaits', () => this.speak('giftWaits', text, { once: false }), waits);
    }
    this.requestTick();
  }

  // a tap-harvest stopped at a full store
  storageFull(id) {
    this.layer.actionChip(`${id === 'barn' ? 'Barn' : 'Silo'} full · Sell extras ›`, () => this.hud.openBarn(id));
  }

  wiggleQuest() {
    const q = this.hud.questCard;
    if (!shown(q)) return;
    q.classList.remove('done-flash');
    void q.offsetWidth;
    q.classList.add('done-flash');
    setTimeout(() => { if (!this.game.questDone()) q.classList.remove('done-flash'); }, 1300);
  }

  // state for tests and the console
  debug() {
    const v = this.view || {};
    return {
      mode: this.game.tutorialMode(), step: this.step?.key, act: v.act?.key, target: v.act?.target, finger: !!v.finger, ring: v.ring || null,
      hard: !!this.hard, released: [...this.released], session: this.session?.kind || null, line: this.line.key, card: this.layer.cardOn ? this.line.text : null,
      queue: this.queue.map((q) => q.kind), res: this.res?.rect ? { ...this.res.rect, point: this.res.point, key: this.res.key || null } : null,
    };
  }
}
