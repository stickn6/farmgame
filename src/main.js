import * as THREE from 'three';
import './style.css';
import { ITEMS, CROPS, ANIMALS, OBJECTS } from './game/config.js';
import { Game } from './game/state.js';
import { World, tileToWorld, worldToTile } from './game/world.js';
import { FarmView, ObjectView, AnimalView, DogView, Ghost, TileCursor, objectCenter } from './game/views.js';
import { Effects } from './game/effects.js';
import { Audio } from './game/audio.js';
import { Input } from './game/input.js';
import { HUD, fmtTime } from './ui/hud.js';
import { Bubbles } from './ui/bubbles.js';

const DAY_MS = 10 * 60 * 1000; // one in-game day = 10 real minutes

const CROP_COLORS = {
  wheat: ['#f2cf5b', '#e6bf4a', '#fff1a8'],
  carrot: ['#f08a24', '#5fae3e'],
  corn: ['#f7cf3b', '#5fae3e'],
  sunflower: ['#f7cf3b', '#6b3d1c'],
  tomato: ['#e8402f', '#5fae3e'],
  strawberry: ['#e8304a', '#5fae3e', '#ffffff'],
  pumpkin: ['#f08a24', '#e57a1c'],
};
const ANIMAL_SOUND = { chicken: 'cluck', cow: 'moo', sheep: 'baa' };

class Controller {
  constructor() {
    this.game = new Game();
    this.audio = new Audio();
    const st = this.game.s.settings;
    this.audio.setSfx(st.sound);
    this.audio.setMusic(st.music);

    this.world = new World(document.getElementById('scene'));
    this.world.drawGround(this.game.landLo(), this.game.landHi());
    this.farm = new FarmView(this.world.scene, this.game);
    this.objects = new ObjectView(this.world.scene, this.game);
    this.animals = new AnimalView(this.world.scene, this.game);
    this.dog = new DogView(this.world.scene, this.game);
    this.ghost = new Ghost(this.world.scene, this.game);
    this.cursor = new TileCursor(this.world.scene);

    this.tool = 'hand';
    this.seed = 'wheat';
    this.placing = null;
    this.paint = null;

    this.hud = new HUD(document.getElementById('hud'), this.game, this, this.audio);
    this.effects = new Effects(this.world, this.hud.fx);
    this.bubbles = new Bubbles(document.getElementById('bubbles'), this.world);

    this.input = new Input(this.world.canvas, this.world, {
      decide: (e) => this.decide(e),
      onPaint: (e, first) => this.onPaint(e, first),
      onPaintEnd: (cancelled, e, moved) => this.onPaintEnd(cancelled, e, moved),
      onTap: (e) => this.onTap(e),
      onHover: (e) => this.onHover(e),
      onKey: (e) => this.onKey(e),
      onAnyDown: () => this.audio.unlock(),
    });

    this.game.on('land', () => {
      this.world.drawGround(this.game.landLo(), this.game.landHi());
    });
    this.game.on('orderDone', () => { this.world.sendTruck(); this.audio.play('truck'); });

    // frame the farmhouse & fields at start
    const house = this.game.s.objects.find((o) => o.type === 'farmhouse');
    if (house) {
      const c = objectCenter(this.game, house);
      this.world.rig.target.set(c.x + 4, 0, c.z + 4);
    }

    this.bubbleTimer = 0;
    this.lastT = performance.now();
    document.getElementById('loading').classList.add('gone');
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.game.save(); });
    window.addEventListener('pagehide', () => this.game.save());
    this.loop();
  }

  // ------------------------------------------------------------------ tools
  setTool(t) {
    if (this.placing) this.cancelPlacement();
    this.tool = t;
    this.hud.setTool(t);
    this.cursor.hide();
  }

  tileAt(e) {
    const p = this.world.groundPoint(e.clientX, e.clientY);
    return p ? worldToTile(p) : null;
  }

  decide(e) {
    if (this.placing) return 'paint';
    if (this.tool !== 'hand') return 'paint';
    const t = this.tileAt(e);
    if (t) {
      const soil = this.game.soilAt(t.x, t.z);
      if (soil && soil.crop && this.game.cropStage(soil.crop) === 3) return 'paint';
    }
    return 'pan';
  }

  onPaint(e, first) {
    const t = this.tileAt(e);
    if (!t) return;
    if (this.placing) { this.movePlacement(t); return; }
    if (first) this.paint = { last: null, warned: false, mode: this.tool === 'hand' ? 'harvest' : this.tool, count: 0 };
    if (!this.paint) return;
    const last = this.paint.last;
    // walk every tile between the last sample and this one so fast swipes don't skip tiles
    const tiles = [];
    if (!last) tiles.push(t);
    else {
      const n = Math.max(Math.abs(t.x - last.x), Math.abs(t.z - last.z));
      for (let i = 1; i <= n; i++) tiles.push({ x: Math.round(last.x + ((t.x - last.x) * i) / n), z: Math.round(last.z + ((t.z - last.z) * i) / n) });
    }
    this.paint.last = t;
    for (const tile of tiles) this.applyTool(tile, first && tiles.length === 1);
    this.cursor.set(t.x, t.z, this.toolColor(t));
  }

  onPaintEnd(cancelled, e, moved) {
    if (this.placing && e && e.pointerType === 'mouse' && !moved && !cancelled) this.confirmPlacement();
    this.paint = null;
    if (!e || e.pointerType !== 'mouse') this.cursor.hide();
  }

  toolColor(t) {
    const g = this.game;
    if (!g.inLand(t.x, t.z)) return '#ff6b6b';
    const soil = g.soilAt(t.x, t.z);
    switch (this.tool) {
      case 'plow': return !soil && !g.objectAt(t.x, t.z) ? '#ffffff' : '#ff6b6b';
      case 'seed': return soil && !soil.crop ? '#9cff6b' : '#ff6b6b';
      case 'remove': return soil || (g.objectAt(t.x, t.z) && OBJECTS[g.objectAt(t.x, t.z).type].kind === 'decor') ? '#ffb86b' : '#ff6b6b';
      default: return '#ffffff';
    }
  }

  applyTool({ x, z }, isTap) {
    const g = this.game;
    const pos = tileToWorld(x, z);
    switch (this.paint.mode) {
      case 'plow': {
        if (!g.inLand(x, z)) {
          if (!this.paint.warned) { this.paint.warned = true; this.hud.toast('Expand your land to farm here 🗺️', 'info'); }
          return;
        }
        if (g.plow(x, z)) {
          this.audio.play('plow');
          this.effects.burst(pos, ['#8a5a33', '#6d4325', '#a87447'], 8, 0.7);
        } else if (isTap) {
          const soil = g.soilAt(x, z);
          if (soil) this.hud.toast('Already plowed — pick 🌱 Seeds to plant', 'info');
        }
        break;
      }
      case 'seed': {
        const soil = g.soilAt(x, z);
        if (!soil) { if (isTap) this.hud.toast('Plow the land first with 🚜', 'info'); return; }
        if (soil.crop) {
          // allow harvesting while in seed mode, then replant immediately: very satisfying loop
          if (g.cropStage(soil.crop) === 3) { this.harvestAt(x, z); }
          else return;
        }
        if (g.plant(x, z, this.seed)) {
          this.audio.play('plant');
          this.effects.burst(pos, ['#8fd45f', '#5fae3e'], 5, 0.5);
          this.effects.floatText(pos, `-🪙${CROPS[this.seed].seedCost}`, 'cost');
        }
        break;
      }
      case 'remove': {
        if (g.soilAt(x, z)) {
          g.clearSoil(x, z);
          this.audio.play('plow');
          this.effects.burst(pos, ['#79c453', '#8a5a33'], 6, 0.6);
          return;
        }
        const o = g.objectAt(x, z);
        if (o && isTap) {
          if (OBJECTS[o.type].kind === 'decor') this.removeObject(o);
          else this.hud.toast('Buildings can be moved but not removed', 'info');
        }
        break;
      }
      case 'harvest': this.harvestAt(x, z); break;
    }
  }

  harvestAt(x, z) {
    const r = this.game.harvest(x, z);
    if (!r) return;
    const pos = tileToWorld(x, z);
    this.audio.play('harvest');
    this.effects.burst(pos, CROP_COLORS[r.item] || ['#ffffff'], 10);
    this.effects.floatText(pos.clone().setY(0.6), `+${r.qty} ${ITEMS[r.item].icon}`);
    this.effects.fly(pos, ITEMS[r.item].icon, this.hud.barnBtn);
    this.effects.fly(pos, '⭐', this.hud.levelBox, { delay: 120 });
    if (Math.random() < 0.15) this.dog.goTo(pos);
  }

  onHover(e) {
    const t = this.tileAt(e);
    if (!t) return;
    if (this.placing) { this.movePlacement(t); return; }
    if (this.tool === 'hand') { this.cursor.hide(); return; }
    this.cursor.set(t.x, t.z, this.toolColor(t));
  }

  onKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (this.hud.panel) this.hud.closePanel(); else if (this.placing) this.cancelPlacement(); else this.setTool('hand'); }
    if (k === 'q') this.world.rig.rotateBy(Math.PI / 2);
    if (k === 'e') this.world.rig.rotateBy(-Math.PI / 2);
    if (this.hud.panel) return;
    if (k === 'r' && this.placing) this.rotatePlacement();
    if (k === 'enter' && this.placing) this.confirmPlacement();
    const tools = { 1: 'hand', 2: 'plow', 3: 'seed', 4: 'remove' };
    if (tools[k]) this.setTool(tools[k]);
    if (k === 'b') this.hud.openBarn();
    if (k === 'o') this.hud.openOrders();
    if (k === 'p') this.hud.openShop();
  }

  // ------------------------------------------------------------------ taps (hand tool)
  onTap(e) {
    if (this.tool !== 'hand') return;
    const g = this.game;
    // animals first (they move around, so pick by mesh)
    const hit = this.world.pick(e.clientX, e.clientY, this.animals.meshes())[0];
    if (hit) {
      let o = hit.object;
      while (o && o.userData.animalId == null) o = o.parent;
      const a = o && g.s.animals.find((x) => x.id === o.userData.animalId);
      if (a) { this.tendPen(g.objById.get(a.home)); return; }
    }
    const t = this.tileAt(e);
    if (!t) return;
    const obj = g.objectAt(t.x, t.z);
    if (obj) { this.tapObject(obj); return; }
    const soil = g.soilAt(t.x, t.z);
    const pos = tileToWorld(t.x, t.z);
    if (soil) {
      if (soil.crop) {
        const c = CROPS[soil.crop.type];
        const left = (c.growTime * 1000 - (Date.now() - soil.crop.plantedAt)) / 1000;
        this.effects.floatText(pos.clone().setY(0.5), `${ITEMS[soil.crop.type].icon} ${fmtTime(left)}`, 'info');
      } else {
        this.setTool('seed');
        this.hud.toast('Pick a seed and tap soil to plant 🌱', 'info');
      }
      return;
    }
    this.dog.goTo(pos);
    if (Math.random() < 0.3) this.audio.play('woof');
  }

  tapObject(o) {
    const def = OBJECTS[o.type];
    this.bounce(o);
    if (o.type === 'farmhouse') { this.hud.openFarmhouse(); return; }
    if (o.type === 'orderboard') { this.hud.openOrders(); return; }
    if (def.kind === 'pen') { this.tendPen(o); return; }
    if (def.kind === 'factory') {
      if (!this.collectFactory(o)) this.hud.openFactory(o);
      return;
    }
    if (def.kind === 'decor') this.hud.openDecor(o);
  }

  bounce(o) {
    const e = this.objects.map.get(o.id);
    if (e && e.pop >= 1) e.pop = 0.55;
  }

  tendPen(o, fromPanel = false) {
    const g = this.game;
    const list = g.animalsIn(o.id);
    if (!list.length) { this.hud.openPen(o); return; }
    let collected = 0, fed = 0, starving = 0;
    let i = 0;
    for (const a of list) {
      const r = g.collectAnimal(a);
      if (!r) continue;
      collected++;
      const p = this.animals.map.get(a.id)?.obj.position || objectCenter(g, o);
      this.effects.fly(p.clone().setY(0.6), ITEMS[r.item].icon, this.hud.barnBtn, { delay: i * 90 });
      this.effects.floatText(p.clone().setY(0.9), `+1 ${ITEMS[r.item].icon}`);
      this.effects.burst(p, ['#ffffff', '#ffe08a'], 6, 0.6);
      i++;
    }
    for (const a of list) {
      if (g.animalState(a) !== 'hungry') continue;
      if (g.feedAnimal(a)) {
        fed++;
        const p = this.animals.map.get(a.id)?.obj.position || objectCenter(g, o);
        this.effects.floatText(p.clone().setY(0.8), `${ITEMS[ANIMALS[a.type].food].icon} yum!`, 'info');
        this.effects.burst(p, ['#f2cf5b', '#e6bf4a'], 5, 0.4);
      } else starving++;
    }
    const def = ANIMALS[list[0].type];
    if (collected) { this.audio.play('collect'); setTimeout(() => this.audio.play(ANIMAL_SOUND[list[0].type]), 150); }
    if (fed) this.audio.play('feed');
    if (starving) this.hud.toast(`Need ${def.foodQty} ${ITEMS[def.food].icon} ${ITEMS[def.food].name} per ${def.name.toLowerCase()} — grow some!`, 'bad');
    if (!collected && !fed && !starving && !fromPanel) this.hud.openPen(o);
  }

  collectFactory(o) {
    const r = this.game.collectFactory(o);
    if (!r) return false;
    const p = objectCenter(this.game, o).setY(1.5);
    let i = 0;
    for (const [item, n] of Object.entries(r.got)) {
      for (let k = 0; k < n; k++) this.effects.fly(p, ITEMS[item].icon, this.hud.barnBtn, { delay: (i++) * 120 });
      this.effects.floatText(p, `+${n} ${ITEMS[item].icon}`);
    }
    this.audio.play('collect');
    this.effects.burst(p, ['#ffe08a', '#ffffff'], 10);
    return true;
  }

  startRecipe(o, id) {
    if (this.game.startRecipe(o, id)) {
      this.audio.play('plant');
      this.hud.refreshPanel();
    }
  }

  // ------------------------------------------------------------------ economy actions from UI
  sell(item, qty) {
    const earned = this.game.sell(item, qty);
    if (!earned) return;
    this.audio.play('coin');
    const r = this.hud.barnBtn.getBoundingClientRect();
    this.effects.flyFrom(r.left + r.width / 2, r.top, '🪙', this.hud.coinsPill);
    this.hud.toast(`Sold ${qty} ${ITEMS[item].icon} for 🪙${earned}`, 'good');
    this.hud.refreshPanel();
  }

  deliverOrder(id) {
    const o = this.game.fulfillOrder(id);
    if (!o) return;
    this.audio.play('coin');
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    for (let i = 0; i < 6; i++) this.effects.flyFrom(cx + (Math.random() - 0.5) * 120, cy, '🪙', this.hud.coinsPill, { delay: i * 70 });
    this.effects.flyFrom(cx, cy, '⭐', this.hud.levelBox, { delay: 200 });
    this.effects.floatTextAt(cx, cy - 40, `+🪙${o.coins}  +⭐${o.xp}`, 'big');
  }

  buyAnimal(type) {
    const a = this.game.buyAnimal(type);
    if (!a) return;
    this.audio.play('build');
    setTimeout(() => this.audio.play(ANIMAL_SOUND[type]), 400);
    this.hud.toast(`${ANIMALS[type].icon} A new ${ANIMALS[type].name.toLowerCase()} joined your farm!`, 'good');
    const home = this.game.objById.get(a.home);
    this.world.rig.focus(objectCenter(this.game, home));
    this.hud.refreshPanel();
  }

  removeObject(o) {
    const pos = objectCenter(this.game, o);
    const refund = this.game.removeObject(o.id);
    if (refund === false) return;
    this.audio.play('plow');
    this.effects.burst(pos, ['#79c453', '#7a5232', '#ffffff'], 12);
    if (refund) this.effects.floatText(pos.setY(0.8), `+🪙${refund}`);
  }

  expandLand() {
    if (this.game.expandLand()) {
      this.audio.play('build');
      this.hud.confetti();
      this.hud.toast('Your farm grew! 🌲➡️🌾', 'good');
      this.world.rig.setDist(Math.min(this.world.rig.maxDist, this.world.rig.dist + 6));
    }
  }

  claimQuest() {
    const q = this.game.claimQuest();
    if (!q) return;
    this.audio.play('coin');
    const r = this.hud.questCard.getBoundingClientRect();
    for (let i = 0; i < 4; i++) this.effects.flyFrom(r.left + r.width / 2, r.top + r.height / 2, '🪙', this.hud.coinsPill, { delay: i * 80 });
    this.hud.toast(`Goal complete! +🪙${q.reward.coins || 0}${q.reward.xp ? ` +⭐${q.reward.xp}` : ''}`, 'good');
    this.hud.questCard.classList.remove('done-flash');
  }

  // ------------------------------------------------------------------ placement
  startPlacement(type, moveId = null) {
    if (this.placing) this.cancelPlacement();
    const g = this.game;
    const existing = moveId ? g.objById.get(moveId) : null;
    // start in the middle of the screen
    const c = this.world.groundPoint(window.innerWidth / 2, window.innerHeight / 2) || new THREE.Vector3();
    const t = worldToTile(c);
    const [w, d] = g.objSize(type, existing ? existing.rot : 0);
    this.placing = { type, rot: existing ? existing.rot : 0, x: existing ? existing.x : t.x - Math.floor(w / 2), z: existing ? existing.z : t.z - Math.floor(d / 2), moveId };
    if (existing) this.objects.setHidden(moveId, true);
    this.tool = 'hand';
    this.ghost.show(type);
    this.cursor.hide();
    this.hud.showPlaceBar(type, existing ? 0 : OBJECTS[type].cost);
    this.updateGhost();
  }

  movePlacement(t) {
    const p = this.placing;
    const [w, d] = this.game.objSize(p.type, p.rot);
    p.x = t.x - Math.floor((w - 1) / 2);
    p.z = t.z - Math.floor((d - 1) / 2);
    this.updateGhost();
  }

  updateGhost() {
    const p = this.placing;
    if (!p) return;
    p.valid = this.game.canPlace(p.type, p.x, p.z, p.rot, p.moveId);
    this.ghost.update(p.x, p.z, p.rot, p.valid);
  }

  rotatePlacement() {
    if (!this.placing) return;
    this.placing.rot = (this.placing.rot + 1) % 4;
    this.audio.play('click');
    this.updateGhost();
  }

  confirmPlacement() {
    const p = this.placing;
    if (!p) return;
    if (!p.valid) { this.hud.toast("Can't place here", 'bad'); return; }
    const g = this.game;
    if (p.moveId) {
      g.moveObject(p.moveId, p.x, p.z, p.rot);
      this.objects.setHidden(p.moveId, false);
      this.audio.play('build');
      this.finishPlacement();
      return;
    }
    const o = g.placeObject(p.type, p.x, p.z, p.rot);
    if (!o) return;
    this.audio.play('build');
    const pos = objectCenter(g, o);
    const [w, d] = g.objSize(o.type, o.rot);
    this.effects.burst(pos, ['#d9c27a', '#ffffff', '#a87447'], 10 + w * d, 1.2);
    this.effects.floatText(pos.setY(1.5), `-🪙${OBJECTS[o.type].cost}`, 'cost');
    // cheap decor: keep placing for quick fences/paths, otherwise exit
    if (OBJECTS[p.type].kind === 'decor' && g.s.coins >= OBJECTS[p.type].cost) {
      this.updateGhost();
      return;
    }
    this.finishPlacement();
    const def = OBJECTS[o.type];
    if (def.kind === 'pen') this.hud.toast(`Now buy some ${ANIMALS[def.animal].icon} in the Shop!`, 'info');
  }

  cancelPlacement() {
    const p = this.placing;
    if (!p) return;
    if (p.moveId) this.objects.setHidden(p.moveId, false);
    this.finishPlacement();
  }

  finishPlacement() {
    this.placing = null;
    this.ghost.hide();
    this.hud.hidePlaceBar();
  }

  // ------------------------------------------------------------------ bubbles
  updateBubbles() {
    const g = this.game;
    const now = Date.now();
    const b = this.bubbles;
    b.mark();
    for (const e of this.animals.map.values()) {
      const a = e.a;
      const st = g.animalState(a, now);
      const def = ANIMALS[a.type];
      const h = a.type === 'cow' ? 1.15 : a.type === 'sheep' ? 0.95 : 0.65;
      const getPos = (out) => out.copy(e.obj.position).setY(h);
      const home = g.objById.get(a.home);
      if (st === 'ready') b.set('a' + a.id, getPos, ITEMS[def.product].icon, 'ready', () => this.tendPen(home));
      else if (st === 'hungry') b.set('a' + a.id, getPos, ITEMS[def.food].icon, 'need' + (g.count(def.food) >= def.foodQty ? '' : ' missing'), () => this.tendPen(home));
    }
    for (const o of g.s.objects) {
      const def = OBJECTS[o.type];
      const top = (out) => objectCenter(g, o, out).setY(o.type === 'orderboard' ? 1.7 : 2.6);
      if (def.kind === 'factory') {
        const q = g.factoryQueue(o, now);
        const done = q.filter((j) => j.done);
        if (done.length) b.set('o' + o.id, top, done.map((j) => ITEMS[j.recipe].icon).join('') , 'ready', () => this.collectFactory(o));
        else if (q.length) b.set('o' + o.id, top, `${ITEMS[q[0].recipe].icon}<div class="bar"><i style="width:${(q[0].progress * 100).toFixed(0)}%"></i></div>`, 'working', () => this.hud.openFactory(o));
        else b.set('o' + o.id, top, '💤', 'idle', () => this.hud.openFactory(o));
      } else if (def.kind === 'pen' && !g.animalsIn(o.id).length) {
        b.set('o' + o.id, (out) => objectCenter(g, o, out).setY(1.6), `+${ANIMALS[def.animal].icon}`, 'need', () => this.hud.openPen(o));
      } else if (o.type === 'orderboard') {
        const ready = g.s.orders.some((x) => !x.waitUntil && g.hasItems(x.items));
        if (ready) b.set('o' + o.id, top, '✅', 'ready', () => this.hud.openOrders());
      }
    }
    b.sweep();
  }

  // ------------------------------------------------------------------ main loop
  loop() {
    const nowT = performance.now();
    const dt = Math.min(0.05, (nowT - this.lastT) / 1000);
    this.lastT = nowT;
    this.input.update(dt);
    this.world.rig.update(dt);
    const t = (((Date.now() - this.game.s.createdAt) / DAY_MS) + 0.05) % 1;
    this.world.updateDayCycle(t);
    this.world.updateEnvironment(dt);
    this.farm.update(dt);
    this.objects.update(dt);
    this.animals.update(dt);
    this.dog.update(dt);
    this.effects.update(dt);
    if (this.placing) this.updateGhost();
    this.bubbleTimer -= dt;
    if (this.bubbleTimer <= 0) { this.bubbleTimer = 0.2; this.updateBubbles(); }
    this.bubbles.update();
    this.world.render();
    requestAnimationFrame(() => this.loop());
  }
}

window.farm = new Controller();
