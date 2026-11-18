import * as THREE from 'three';
import './style.css';
import { ITEMS, CROPS, ANIMALS, OBJECTS, STORAGE, PROJECTS, TUTORIAL, CAMERA } from './game/config.js';
import { isHome } from './game/camera.js';
import { Game } from './game/state.js';
import { seedList, plantCap, placementSpot } from './game/guide.js';
import { farmCore } from './game/layout.js';
import { World, tileToWorld, worldToTile } from './game/world.js';
import { FarmView, ObjectView, AnimalView, DogView, VisitorView, WagonView, ProjectView, PROJECT_SITES, Ghost, TileCursor, objectCenter } from './game/views.js';
import { Effects } from './game/effects.js';
import { Audio } from './game/audio.js';
import { Input } from './game/input.js';
import { HUD, fmtTime, postClock } from './ui/hud.js';
import { Bubbles } from './ui/bubbles.js';
import { GuideController } from './ui/guide-ui.js';
import './game/models/index.js';

const DAY_MS = 10 * 60 * 1000; // one in-game day = 10 real minutes

const burstColors = (item) => ITEMS[item]?.colors || ['#ffffff', '#ffe08a'];
const animalSound = (type) => ANIMALS[type]?.sound || 'collect';

class Controller {
  constructor() {
    this.game = new Game();
    this.audio = new Audio();
    const st = this.game.s.settings;
    this.audio.setSfx(st.sound);
    this.audio.setMusic(st.music);

    this.world = new World(document.getElementById('scene'));
    this.restoreView();
    this.world.drawGround(this.game.landLo(), this.game.landHi());
    this.farm = new FarmView(this.world.scene, this.game);
    this.objects = new ObjectView(this.world.scene, this.game);
    this.animals = new AnimalView(this.world.scene, this.game);
    this.dog = new DogView(this.world.scene, this.game);
    this.visitors = new VisitorView(this.world.scene, this.game, this.world.roadZ);
    this.visitors.faceYaw = () => this.world.rig.yaw;
    this.wagon = new WagonView(this.world.scene, this.game, this.world.roadZ);
    this.projects = new ProjectView(this.world.scene, this.game);
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
    // a hard beat dims 🧭 and closes its pad; any turn / tilt is remembered (pan and zoom are not)
    this.input.onLockChange = (locked) => this.hud.camLocked(locked);
    this.world.rig.onView = () => this.viewChanged();
    // Grandma Mabel: tutorial, Show me, hints (presentation only; it also sets the HUD reveal)
    this.guide = new GuideController(this);

    this.game.on('land', () => {
      this.world.drawGround(this.game.landLo(), this.game.landHi());
    });
    this.game.on('orderDone', () => { this.world.sendTruck(); this.audio.play('truck'); });
    this.game.on('drop', ({ item }) => {
      this.hud.toast(`Found ${ITEMS[item].icon} ${ITEMS[item].name}!`, 'good');
      this.audio.play('quest');
      this.effects.flyFrom(window.innerWidth / 2, window.innerHeight / 2, ITEMS[item].icon, this.hud.barnBtn, { delay: 250 });
    });
    this.game.on('storageFull', (id) => this.hud.barnBtn.classList.add('bump'));
    this.game.on('levelup', () => { if (!this.placing) this.hud.setTool(this.tool); });
    this.game.on('projectStage', ({ id, stage, xp, gems, finished }) => {
      this.audio.play('levelup');
      this.hud.confetti();
      const def = PROJECTS[id];
      this.hud.toast(finished ? `${def.icon} ${def.name} is finished! ${def.perk} 🎉` : `${def.icon} ${def.name}: stage ${stage} complete! +⭐${xp} +💎${gems}`, 'good');
    });
    this.game.on('mastery', () => { if (this.tool === 'seed') this.hud.renderSeedBar(); });

    // a brand-new farm opens high over the farm and the guide glides down to the field;
    // otherwise frame the farmhouse & fields
    const g = this.game;
    const house = g.s.objects.find((o) => o.type === 'farmhouse');
    if (g.tutorialMode() === 'guided' && !g.hasSeen('welcome')) {
      const [cx, cz] = farmCore(g);
      this.world.rig.target.copy(tileToWorld(cx, cz));
      this.world.rig.setDist(24);
    } else if (house) {
      const c = objectCenter(g, house);
      this.world.rig.target.set(c.x + 4, 0, c.z + 4);
    }

    this.bubbleTimer = 0;
    this.lastT = performance.now();
    document.getElementById('loading').classList.add('gone');
    // the guide decides about the welcome, the tour and the daily gift popup
    this.guide.start();
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.game.save(); });
    window.addEventListener('pagehide', () => this.game.save());
    this.loop();
  }

  // ------------------------------------------------------------------ camera: turn & tilt (§1)
  // The remembered view (settings.cam: yaw + tilt) comes back on load, except in the guided tour, whose
  // opening shot and hard beats assume the default view.
  restoreView() {
    const g = this.game, cam = g.s.settings.cam, rig = this.world.rig;
    if (!cam || g.tutorialMode() === 'guided') return;
    const { min, max } = CAMERA.pitch;
    if (Number.isFinite(cam.yaw)) rig.yaw = rig.goal.yaw = cam.yaw;
    if (Number.isFinite(cam.pitch)) rig.pitch = rig.goal.pitch = Math.min(max, Math.max(min, cam.pitch));
    rig.goal.dist = rig.dist = Math.max(rig.dist, rig.minDistFor());
    rig.apply();
  }

  // after a turn / tilt button, a twist or orbit, or Home: remember the view (null at Home) and update 🧭
  viewChanged() {
    const g = this.game, rig = this.world.rig;
    const TAU = Math.PI * 2;
    const yaw = ((rig.goal.yaw % TAU) + TAU) % TAU;
    g.s.settings.cam = isHome(rig.goal.yaw, rig.goal.pitch) ? null : { yaw: +yaw.toFixed(4), pitch: Math.round(rig.goal.pitch * 100) / 100 };
    g.saveSoon();
    this.hud.updateCompass(true);
    this.hud.closeSeedPopover(); // it points at a tile that just moved
  }

  // 🧭 Home / C / long-press 🧭 / Settings → Reset view: the default turn and tilt over the farm's core
  camHome() {
    const rig = this.world.rig;
    if (rig.locked) return false;
    rig.home();
    const [cx, cz] = farmCore(this.game);
    const to = tileToWorld(cx, cz);
    if (this.world.prefersReducedMotion) { rig.stopGlide(); rig.velocity.set(0, 0, 0); rig.target.copy(to); rig.setDist(20); }
    else rig.glide(to, 20, 0.6);
    this.viewChanged();
    return true;
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
    if (t && this.harvestableAt(t.x, t.z)) return 'paint';
    return 'pan';
  }

  onPaint(e, first) {
    const t = this.tileAt(e);
    if (!t) return;
    if (this.placing) { this.movePlacement(t); return; }
    if (first) {
      this.paint = { last: null, warned: false, mode: this.tool === 'hand' ? 'harvest' : this.tool, count: 0, origin: null };
      // tap-to-harvest: remember the tapped ripe crop, so a tap (not a swipe) can take its whole patch
      const soil = this.paint.mode === 'harvest' && this.game.soilAt(t.x, t.z);
      if (soil && soil.crop && this.game.cropStage(soil.crop) === 3) this.paint.origin = { x: t.x, z: t.z, crop: soil.crop.type };
    }
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
    const p = this.paint;
    this.paint = null;
    if (p && p.origin && p.mode === 'harvest' && !cancelled && !moved && this.game.s.settings.tapHarvest !== false) this.harvestPatch(p.origin);
    if (!e || e.pointerType !== 'mouse') this.cursor.hide();
  }

  // A tap on a ripe crop harvests its 4-connected patch of the same crop (the tapped tile went on press).
  // Same rules as a swipe, tile by tile; only the effects are staggered. Stops when the store is full.
  harvestPatch({ x, z, crop }) {
    const g = this.game;
    const ripe = (s) => !!s.crop && s.crop.type === crop && g.cropStage(s.crop) === 3;
    const tiles = g.patchTiles(x, z, ripe, TUTORIAL.patchMax).filter(([a, b]) => a !== x || b !== z);
    let i = 0;
    for (const [tx, tz] of tiles) {
      if (g.spaceFor(crop) < CROPS[crop].yield) { this.guide.storageFull(g.storageOf(crop)); break; }
      this.harvestAt(tx, tz, { fxDelay: ++i * 60 });
    }
  }

  toolColor(t) {
    const g = this.game;
    if (!g.inLand(t.x, t.z)) return '#ff6b6b';
    const soil = g.soilAt(t.x, t.z);
    switch (this.tool) {
      case 'plow': return !soil && !g.objectAt(t.x, t.z) ? '#ffffff' : '#ff6b6b';
      case 'seed': return soil && !soil.crop ? '#9cff6b' : '#ff6b6b';
      case 'remove': {
        const kind = g.objectAt(t.x, t.z) && OBJECTS[g.objectAt(t.x, t.z).type].kind;
        return soil || kind === 'decor' || kind === 'debris' ? '#ffb86b' : '#ff6b6b';
      }
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
        // guided "Plow 2 new fields": one tap on a marked plot plows every marked plot (each at its normal price)
        const assist = isTap && this.guide.plowAssist(x, z);
        let plowed = 0;
        for (const [px, pz] of assist || [[x, z]]) {
          const cost = g.plowCost();
          if (!g.plow(px, pz)) continue;
          plowed++;
          const at = tileToWorld(px, pz);
          this.effects.burst(at, ['#8a5a33', '#6d4325', '#a87447'], 8, 0.7);
          if (cost) this.effects.floatText(at, `-🪙${cost}`, 'cost');
        }
        if (plowed) {
          this.audio.play('plow');
          this.hud.refreshToolHint();
          if (assist) setTimeout(() => { if (this.tool === 'plow') this.setTool('hand'); }, 600);
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
        if (o && OBJECTS[o.type].kind === 'debris') { this.clearDebris(o); return; } // tap or drag
        if (o && isTap) {
          const kind = OBJECTS[o.type].kind;
          // free decor (a chapter gift, the starter flowers) refunds nothing: ask in its panel instead of one tap
          if (kind === 'decor') { if (o.free) { this.paint = null; this.hud.openDecor(o); } else this.removeObject(o); }
          else if (kind === 'tree') {
            if (g.treeState(o) === 'dead') this.removeObject(o);
            else { this.paint = null; this.hud.openTree(o); } // ask in-game, never with a blocking dialog mid-gesture
          }
          else this.hud.toast('Buildings can be moved but not removed', 'info');
        }
        break;
      }
      case 'harvest': this.harvestAt(x, z); break;
    }
  }

  harvestableAt(x, z) {
    const g = this.game;
    const soil = g.soilAt(x, z);
    if (soil && soil.crop && g.cropStage(soil.crop) === 3) return true;
    const o = g.objectAt(x, z);
    return !!(o && OBJECTS[o.type].kind === 'tree' && g.treeState(o) === 'ready');
  }

  // fxDelay: the rules apply now, the effects a little later (patch harvests ripple across the field)
  harvestAt(x, z, { fxDelay = 0 } = {}) {
    const o = this.game.objectAt(x, z);
    if (o && OBJECTS[o.type].kind === 'tree') { this.harvestTree(o); return null; }
    const r = this.game.harvest(x, z);
    if (!r) return null;
    const pos = tileToWorld(x, z);
    const fx = () => {
      this.audio.play('harvest');
      this.effects.burst(pos, burstColors(r.item), 10);
      this.effects.floatText(pos.clone().setY(0.6), `+${r.qty} ${ITEMS[r.item].icon}`);
      this.effects.fly(pos, ITEMS[r.item].icon, this.hud.barnBtn);
      this.effects.fly(pos, '⭐', this.hud.levelBox, { delay: 120 });
    };
    if (fxDelay) setTimeout(fx, fxDelay); else fx();
    if (Math.random() < 0.15) this.dog.goTo(pos);
    return r;
  }

  harvestTree(o) {
    const r = this.game.harvestTree(o);
    if (!r) return;
    const pos = objectCenter(this.game, o).setY(1.2);
    this.audio.play('harvest');
    this.effects.burst(pos, burstColors(r.item), 12);
    this.effects.floatText(pos.clone().setY(1.6), `+${r.qty} ${ITEMS[r.item].icon}`);
    for (let i = 0; i < Math.min(3, r.qty); i++) this.effects.fly(pos, ITEMS[r.item].icon, this.hud.barnBtn, { delay: i * 90 });
    this.effects.fly(pos, '⭐', this.hud.levelBox, { delay: 200 });
    if (r.dead) this.hud.toast('That tree is all fruited out — clear it to plant a new one 🪓', 'info');
  }

  onHover(e) {
    const t = this.tileAt(e);
    if (!t) return;
    if (this.placing) { this.movePlacement(t); return; }
    if (this.tool === 'hand') { this.cursor.hide(); return; }
    this.cursor.set(t.x, t.z, this.toolColor(t));
  }

  onKey(e) {
    if (this.guide.onKey(e)) return; // Mabel's own welcome / skip question
    const k = e.key.toLowerCase();
    const modal = this.hud.topModal();
    if (modal) { if (k === 'escape' || k === 'enter') this.hud.closeTopModal(k); return; }
    if (k === 'escape' && this.hud.camPadOpen()) { this.hud.closeCamPad(); return; }
    if (k === 'escape') { if (this.hud.panel) this.hud.closePanel(); else if (this.placing) this.cancelPlacement(); else this.setTool('hand'); }
    // turn (90°), tilt and Home: no-ops while a hard beat holds the camera
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const rig = this.world.rig;
      if (k === 'q') rig.rotateStep(+1);
      if (k === 'e') rig.rotateStep(-1);
      if (k === 'x' || k === 'pageup') rig.tiltStep(+1);
      if (k === 'z' || k === 'pagedown') rig.tiltStep(-1);
      if (k === 'c' || k === 'home') this.camHome();
      if (k === 'pageup' || k === 'pagedown' || k === 'home') e.preventDefault();
    }
    if (this.hud.panel) return;
    if (k === 'r' && this.placing) this.rotatePlacement();
    if (k === 'enter' && this.placing) this.confirmPlacement();
    const tools = { 1: 'hand', 2: 'plow', 3: 'seed', 4: 'remove' };
    if (tools[k] && this.hud.revealed('tools')) this.setTool(tools[k]);
    // shortcuts only for buttons the tour has shown already
    if (k === 'b' && this.hud.revealed('barn')) this.hud.openBarn();
    if (k === 'o' && this.hud.revealed('orders')) this.hud.openOrders();
    if (k === 'p' && this.hud.revealed('shop')) this.hud.openShop();
  }

  // ------------------------------------------------------------------ taps (hand tool)
  onTap(e) {
    if (this.tool !== 'hand') return;
    const g = this.game;
    // one raycast against visitors, animals and buildings: the nearest thing wins
    const hit = this.world.pick(e.clientX, e.clientY, [...this.visitors.meshes(), ...this.animals.meshes(), ...this.objects.allMeshes().filter((m) => m.visible), ...this.projects.meshes(), ...this.wagon.meshes()])[0];
    let vo = hit && hit.object;
    while (vo && vo.userData.visitorId == null && vo.userData.animalId == null && vo.userData.objectId == null && vo.userData.projectId == null && vo !== this.wagon.group) vo = vo.parent;
    if (vo && vo === this.wagon.group) { this.audio.play('click'); this.hud.openOrders('wagon'); return; }
    if (vo && vo.userData.projectId != null) { this.tapProject(vo.userData.projectId); return; }
    if (vo && vo.userData.objectId != null) {
      const ob = g.objById.get(vo.userData.objectId);
      if (ob) { this.tapObject(ob); return; }
    }
    if (vo && vo.userData.visitorId != null) {
      const v = g.s.visitors.find((x) => x.id === vo.userData.visitorId);
      if (v) { this.audio.play('click'); this.hud.openVisitor(v); return; }
    }
    if (vo && vo.userData.animalId != null) {
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
        const left = (g.cropReadyAt(soil.crop) - g.now()) / 1000;
        this.effects.floatText(pos.clone().setY(0.5), `${ITEMS[soil.crop.type].icon} ${fmtTime(left)}`, 'info');
        this.hud.openCropInfo(t.x, t.z);
      } else this.tapEmptySoil(t.x, t.z);
      return;
    }
    this.dog.goTo(pos);
    if (Math.random() < 0.3) this.audio.play('woof');
  }

  // Tap empty soil: with one crop unlocked it plants right away, else the seed popover asks which.
  tapEmptySoil(x, z) {
    const g = this.game;
    const crops = Object.keys(CROPS).filter((c) => g.isUnlocked('crops', c));
    if (crops.length === 1) { this.plantPatchAt(x, z, crops[0]); return; }
    const p = this.world.project(tileToWorld(x, z).setY(0.3));
    this.audio.play('click');
    this.hud.openSeedPopover({ x, z, screen: { x: p.x, y: p.y }, crops: seedList(g, { last: this.seed }), onPick: (type) => this.plantPatchAt(x, z, type) });
  }

  // Plant the empty patch around (x, z): at most `cap` tiles (the tour's cap, else 24) and what coins allow.
  plantPatchAt(x, z, crop, cap = plantCap(this.game, crop)) {
    const tiles = this.game.plantPatch(x, z, crop, cap);
    if (!tiles.length) return tiles;
    this.seed = crop;
    this.audio.play('plant');
    const cost = CROPS[crop].seedCost;
    tiles.forEach(([tx, tz], i) => setTimeout(() => {
      const pos = tileToWorld(tx, tz);
      this.effects.burst(pos, ['#8fd45f', '#5fae3e'], 5, 0.5);
      this.effects.floatText(pos, `-🪙${cost}`, 'cost');
    }, i * 40));
    this.guide.planted(tiles, crop);
    return tiles;
  }

  // weeds, stones and stumps: a puff and a tiny reward
  clearDebris(o) {
    const pos = objectCenter(this.game, o);
    const r = this.game.clearDebris(o.id);
    if (!r) return;
    this.audio.play('plow');
    this.effects.puff(pos, r.type);
    const bits = [r.coins ? `+🪙${r.coins}` : '', r.xp ? `+⭐${r.xp}` : ''].filter(Boolean).join(' ');
    if (bits) this.effects.floatText(pos.clone().setY(0.9), bits);
    if (r.coins) this.effects.fly(pos.clone().setY(0.5), '🪙', this.hud.coinsPill, { delay: 150 });
    if (r.xp) this.effects.fly(pos.clone().setY(0.5), '⭐', this.hud.levelBox, { delay: 260 });
  }

  tapProject(id) {
    const def = PROJECTS[id];
    this.audio.play('click');
    if (this.game.s.level < def.level) { this.hud.toast(`${def.icon} ${def.name} — ${def.desc} Help restore it from level ${def.level}.`, 'info'); return; }
    this.hud.openProject(id);
  }

  tapObject(o) {
    const def = OBJECTS[o.type];
    if (def.kind === 'debris') { this.clearDebris(o); return; }
    this.bounce(o);
    if (o.type === 'farmhouse') {
      if (this.game.s.level >= PROJECTS.master.level && (this.game.s.projects?.master?.stage || 0) < PROJECTS.master.stages.length) { this.hud.openProject('master'); return; }
      this.hud.openFarmhouse(); return;
    }
    if (o.type === 'orderboard') { this.hud.openOrders(); return; }
    if (def.kind === 'pen') { this.tendPen(o); return; }
    if (def.kind === 'factory') {
      if (!this.collectFactory(o)) this.hud.openFactory(o);
      return;
    }
    if (def.kind === 'tree') {
      if (this.game.treeState(o) === 'ready') this.harvestTree(o);
      else this.hud.openTree(o);
      return;
    }
    if (def.kind === 'storage') { this.hud.openBarn(def.storage); return; }
    // the Mailbox: its parcel, or when the next one comes
    if (o.type === 'mailbox') { this.tapMailbox(); return; }
    if (def.kind === 'decor') this.hud.openDecor(o);
  }

  tapMailbox() {
    const st = this.game.postStatus();
    this.audio.play('click');
    if (st.ready) this.hud.showPost();
    else this.hud.toast(`📪 Next parcel in ${postClock(st.msLeft)}`, 'info');
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
      if (!ANIMALS[a.type].food) { g.feedAnimal(a); continue; }
      if (g.feedAnimal(a)) {
        fed++;
        const p = this.animals.map.get(a.id)?.obj.position || objectCenter(g, o);
        this.effects.floatText(p.clone().setY(0.8), `${ITEMS[g.animalFood(a.type).item].icon} yum!`, 'info');
        this.effects.burst(p, ['#f2cf5b', '#e6bf4a'], 5, 0.4);
      } else starving++;
    }
    const def = ANIMALS[list[0].type];
    if (collected) { this.audio.play('collect'); setTimeout(() => this.audio.play(animalSound(list[0].type)), 150); }
    if (fed) this.audio.play('feed');
    const food = g.animalFood(list[0].type);
    if (starving && food) this.hud.toast(`Need ${food.qty} ${ITEMS[food.item].icon} ${ITEMS[food.item].name} per ${def.name.toLowerCase()} — grow some!`, 'bad');
    if (!collected && !fed && !starving && !fromPanel) this.hud.openPen(o);
  }

  collectFactory(o) {
    const r = this.game.collectFactory(o);
    if (!r) return false; // nothing collected (none ready, or storage full) → caller opens the panel
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
    setTimeout(() => this.audio.play(animalSound(type)), 400);
    this.hud.toast(`${ANIMALS[type].icon} A new ${ANIMALS[type].name.toLowerCase()} joined your farm!`, 'good');
    const home = this.game.objById.get(a.home);
    this.world.rig.focus(objectCenter(this.game, home));
    this.hud.refreshPanel();
  }

  upgradeStorage(id) {
    if (this.game.upgradeStorage(id)) {
      this.audio.play('build');
      this.hud.confetti();
      const b = this.game.s.objects.find((o) => o.type === STORAGE[id].building);
      if (b) { this.bounce(b); this.effects.burst(objectCenter(this.game, b).setY(1), ['#ffe08a', '#ffffff', '#b07a45'], 20, 1.2); }
    }
  }

  serveVisitor(id) {
    const v = this.game.serveVisitor(id);
    if (!v) return false;
    this.audio.play('coin');
    const e = [...this.visitors.leaving].find((x) => x.v.id === id);
    const p = e ? e.obj.position.clone().setY(1.2) : null;
    const sp = p ? this.world.project(p) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    for (let i = 0; i < 4; i++) this.effects.flyFrom(sp.x, sp.y, '🪙', this.hud.coinsPill, { delay: i * 80 });
    this.effects.flyFrom(sp.x, sp.y, '⭐', this.hud.levelBox, { delay: 200 });
    this.effects.floatTextAt(sp.x, sp.y - 30, `+🪙${v.coins}  +⭐${v.xp}`, 'big');
    return true;
  }

  dismissVisitor(id) { this.game.dismissVisitor(id); this.audio.play('click'); }

  claimChore(i) {
    const r = this.game.claimChore(i);
    if (!r) return;
    this.audio.play('coin');
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    for (let k = 0; k < 3; k++) this.effects.flyFrom(cx, cy, '🪙', this.hud.coinsPill, { delay: k * 80 });
    this.effects.flyFrom(cx, cy, '⭐', this.hud.levelBox, { delay: 150 });
    if (r.bonus) { this.hud.toast(`All chores done! +💎${r.bonus.gems} +${ITEMS[r.bonus.item].icon}`, 'good'); this.hud.confetti(); }
  }

  fillCrate(i) {
    const r = this.game.fillCrate(i);
    if (!r) return;
    this.audio.play('coin');
    const p = this.world.project(this.wagon.group.position.clone().setY(1.2));
    for (let k = 0; k < 4; k++) this.effects.flyFrom(p.x, p.y, '🪙', this.hud.coinsPill, { delay: k * 80 });
    this.effects.flyFrom(p.x, p.y, '⭐', this.hud.levelBox, { delay: 200 });
    if (r.bonus) {
      this.audio.play('truck');
      this.hud.confetti();
      this.hud.toast(`🛒 Wagon full! +🪙${r.bonus.coins} +💎${r.bonus.gems} ${Object.keys(r.bonus.items).map((i) => ITEMS[i].icon).join('')}`, 'good');
    }
  }

  contribute(id, what, amount) {
    const r = this.game.contribute(id, what, amount);
    if (!r) return;
    this.audio.play(what === 'coins' ? 'coin' : 'collect');
    const site = PROJECT_SITES[id];
    if (site) this.effects.burst(new THREE.Vector3(site.x, 1, site.z), ['#d9c27a', '#ffffff', '#a87447'], 12);
  }

  claimDaily() {
    const r = this.game.claimDaily();
    if (!r) return;
    this.audio.play('levelup');
    this.hud.confetti();
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    if (r.reward.coins) for (let i = 0; i < 5; i++) this.effects.flyFrom(cx, cy, '🪙', this.hud.coinsPill, { delay: i * 70 });
    if (r.reward.gems) for (let i = 0; i < 3; i++) this.effects.flyFrom(cx, cy, '💎', this.hud.gemsPill, { delay: i * 90 });
    for (const i of Object.keys(r.reward.items || {})) this.effects.flyFrom(cx, cy, ITEMS[i].icon, this.hud.barnBtn, { delay: 150 });
  }

  claimAchievement(id) {
    const tier = this.game.claimAchievement(id);
    if (!tier) return;
    this.audio.play('quest');
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    if (tier.gems) for (let i = 0; i < 3; i++) this.effects.flyFrom(cx, cy, '💎', this.hud.gemsPill, { delay: i * 90 });
    if (tier.coins) for (let i = 0; i < 3; i++) this.effects.flyFrom(cx, cy, '🪙', this.hud.coinsPill, { delay: i * 90 });
    this.hud.refreshBadges();
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

  // the parcel modal's Open! ✨ (hud.showPost): the parcel opens now; the Mailbox goes up once the modal has closed
  claimPost() {
    const r = this.game.claimPost();
    if (!r) return null;
    this.audio.play(r.wrap === 'big' || r.gift?.place ? 'levelup' : 'quest');
    try { navigator.vibrate?.(15); } catch (e) { /* not on every device */ }
    if (r.gift?.place) this.guide.postGift(r.gift.type);
    return r;
  }

  claimQuest() {
    const q = this.game.claimQuest();
    if (!q) return;
    this.audio.play('coin');
    const r = this.hud.questCard.getBoundingClientRect();
    for (let i = 0; i < 4; i++) this.effects.flyFrom(r.left + r.width / 2, r.top + r.height / 2, '🪙', this.hud.coinsPill, { delay: i * 80 });
    if (q.reward.xp) this.effects.flyFrom(r.left + r.width / 2, r.top + r.height / 2, '⭐', this.hud.levelBox, { delay: 220 });
    this.hud.toast(`Goal complete! +🪙${q.reward.coins || 0}${q.reward.xp ? ` +⭐${q.reward.xp}` : ''}`, 'good');
    this.hud.questCard.classList.remove('done-flash');
  }

  // ------------------------------------------------------------------ placement
  // opts: a move id (number), or { moveId, gift, near: [x, z] }. A new building's ghost starts on its tutorial
  // lot (first coop / bakery) or the tidiest free spot near the camera (smartSpot); gifts are free chapter decor.
  startPlacement(type, opts = {}) {
    if (typeof opts !== 'object' || opts === null) opts = { moveId: opts };
    const { moveId = null, gift = false } = opts;
    if (this.placing) this.cancelPlacement();
    const g = this.game;
    const existing = moveId ? g.objById.get(moveId) : null;
    const rot = existing ? existing.rot : 0;
    let spot = existing ? { x: existing.x, z: existing.z } : null;
    if (!existing) {
      const ct = worldToTile(this.world.rig.target);
      const near = opts.near || [ct.x, ct.z];
      spot = gift ? g.smartSpot(type, 0, near) : placementSpot(g, type, near);
    }
    if (!spot) {
      // nothing tidy free: start in the middle of the screen
      const c = this.world.groundPoint(window.innerWidth / 2, window.innerHeight / 2) || new THREE.Vector3();
      const t = worldToTile(c);
      const [w, d] = g.objSize(type, rot);
      spot = { x: t.x - Math.floor(w / 2), z: t.z - Math.floor(d / 2) };
    }
    this.placing = { type, rot, x: spot.x, z: spot.z, moveId, gift };
    if (existing) { this.objects.setHidden(moveId, true); this.animals.setHomeHidden(moveId, true); }
    this.tool = 'hand';
    this.ghost.show(OBJECTS[type].kind === 'tree' ? `tree:${OBJECTS[type].model}:${existing ? this.objects.treeVisual(existing) : 'sapling'}` : (OBJECTS[type].model || type), type);
    this.cursor.hide();
    this.hud.showPlaceBar(type, existing || gift ? 0 : g.objectCost(type), { gift });
    this.updateGhost();
    if (!existing) {
      this.hud.placeOk.classList.add('pulse');
      this.guide.placementStarted();
      this.frameGhost();
    }
  }

  // bring the ghost into view (above the place bar, clear of the top bar) when it sits near an edge
  frameGhost() {
    const pts = this.ghost.corners();
    const safe = this.hud.safeRect();
    if (!pts.length || this.world.inSafe(pts, safe, 0.85)) return;
    const d = this.world.rig.goal.dist;
    this.world.frame(pts, { safe, minDist: Math.min(30, Math.max(12, d)), maxDist: Math.max(30, d) });
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
      this.animals.setHomeHidden(p.moveId, false);
      this.audio.play('build');
      this.finishPlacement();
      return;
    }
    const o = p.gift ? g.placeGift(p.type, p.x, p.z, p.rot) : g.placeObject(p.type, p.x, p.z, p.rot);
    if (!o) return;
    this.audio.play('build');
    const pos = objectCenter(g, o);
    const [w, d] = g.objSize(o.type, o.rot);
    this.effects.burst(pos, ['#d9c27a', '#ffffff', '#a87447'], 10 + w * d, 1.2);
    if (p.gift) this.effects.floatText(pos.setY(1.5), '🎁');
    else this.effects.floatText(pos.setY(1.5), `-🪙${g.lastPlaceCost ?? OBJECTS[o.type].cost}`, 'cost');
    // cheap decor: keep placing for quick fences/paths, otherwise exit
    if (!p.gift && OBJECTS[p.type].kind === 'decor' && g.s.coins >= OBJECTS[p.type].cost) {
      this.updateGhost();
      return;
    }
    this.finishPlacement();
    this.guide.placed(o, p);
    const def = OBJECTS[o.type];
    if (def.kind === 'pen') this.hud.toast(`Tap the ${def.name} to add ${ANIMALS[def.animal].icon}`, 'info');
  }

  cancelPlacement() {
    const p = this.placing;
    if (!p) return;
    if (p.moveId) { this.objects.setHidden(p.moveId, false); this.animals.setHomeHidden(p.moveId, false); }
    this.finishPlacement();
    this.guide.placementCancelled(p);
  }

  finishPlacement() {
    this.placing = null;
    this.ghost.hide();
    this.hud.hidePlaceBar();
  }

  // ------------------------------------------------------------------ bubbles
  updateBubbles() {
    const g = this.game;
    const now = g.now(); // same clock-guarded time as the rules
    const b = this.bubbles;
    const postReady = g.postStatus().ready;
    b.mark();
    for (const e of this.animals.map.values()) {
      if (!e.obj.visible) continue; // pen is being moved
      const a = e.a;
      const st = g.animalState(a, now);
      const def = ANIMALS[a.type];
      const h = a.type === 'cow' ? 1.15 : a.type === 'sheep' ? 0.95 : 0.65;
      const getPos = (out) => out.copy(e.obj.position).setY(h);
      const home = g.objById.get(a.home);
      if (def.flying) continue; // hives show one bubble instead
      if (st === 'ready') b.set('a' + a.id, getPos, ITEMS[def.product].icon, 'ready', () => this.tendPen(home));
      else if (st === 'hungry' && def.food) {
        const f = g.animalFood(a.type);
        b.set('a' + a.id, getPos, ITEMS[f.item].icon, 'need' + (g.count(f.item) >= f.qty ? '' : ' missing'), () => this.tendPen(home));
      }
    }
    for (const o of g.s.objects) {
      if (this.placing && this.placing.moveId === o.id) continue;
      const def = OBJECTS[o.type];
      const top = (out) => objectCenter(g, o, out).setY(o.type === 'orderboard' ? 1.7 : 2.6);
      if (def.kind === 'factory') {
        const q = g.factoryQueue(o, now);
        const done = q.filter((j) => j.done);
        if (done.length) b.set('o' + o.id, top, done.map((j) => ITEMS[j.recipe].icon).join('') , 'ready', () => { if (!this.collectFactory(o)) this.hud.openFactory(o); });
        else if (q.length) b.set('o' + o.id, top, `${ITEMS[q[0].recipe].icon}<div class="bar"><i style="width:${(q[0].progress * 100).toFixed(0)}%"></i></div>`, 'working', () => this.hud.openFactory(o));
        else b.set('o' + o.id, top, '💤', 'idle', () => this.hud.openFactory(o));
      } else if (def.kind === 'pen' && !g.animalsIn(o.id).length) {
        b.set('o' + o.id, (out) => objectCenter(g, o, out).setY(1.6), `+${ANIMALS[def.animal].icon}`, 'need', () => this.hud.openPen(o));
      } else if (def.kind === 'pen' && ANIMALS[def.animal].flying) {
        const ready = g.animalsIn(o.id).filter((a) => g.animalState(a, now) === 'ready').length;
        const idle = g.animalsIn(o.id).some((a) => g.animalState(a, now) === 'hungry');
        if (!ready && idle) b.set('o' + o.id, (out) => objectCenter(g, o, out).setY(1.8), '▶️', 'need', () => this.tendPen(o));
        else if (ready) b.set('o' + o.id, (out) => objectCenter(g, o, out).setY(1.8), `${ITEMS[ANIMALS[def.animal].product].icon}×${ready}`, 'ready', () => this.tendPen(o));
      } else if (def.kind === 'tree') {
        const st = g.treeState(o, now);
        if (st === 'ready') b.set('o' + o.id, (out) => objectCenter(g, o, out).setY(2.1), ITEMS[def.fruit].icon, 'ready', () => this.harvestTree(o));
        else if (st === 'dead') b.set('o' + o.id, (out) => objectCenter(g, o, out).setY(1.4), '🪓', 'idle', () => this.hud.openTree(o));
      } else if (o.type === 'orderboard') {
        const ready = g.s.orders.some((x) => !x.waitUntil && g.hasItems(x.items));
        if (ready) b.set('o' + o.id, top, '✅', 'ready', () => this.hud.openOrders());
      } else if (o.type === 'mailbox' && postReady) {
        b.set('o' + o.id, (out) => objectCenter(g, o, out).setY(1.6), '📬', 'ready', () => { this.audio.play('click'); this.hud.showPost(); });
      }
    }
    const w = g.s.wagon;
    if (w && w.state === 'here' && this.wagon.group.visible) {
      const left = w.crates.filter((c) => !c.filled);
      const ready = left.some((c) => g.count(c.item) >= c.qty);
      b.set('wagon', (out) => out.copy(this.wagon.group.position).setY(2.4), `🛒<small>${w.crates.length - left.length}/${w.crates.length}</small>`, ready ? 'ready visitor' : 'idle visitor', () => this.hud.openOrders('wagon'));
    }
    for (const [id, def] of Object.entries(PROJECTS)) {
      const site = PROJECT_SITES[id] || (id === 'master' && (() => { const h = g.s.objects.find((o) => o.type === 'farmhouse'); if (!h) return null; const c = objectCenter(g, h); return { x: c.x, z: c.z }; })());
      if (!site || g.s.level < def.level) continue;
      const st = g.s.projects?.[id]?.stage || 0;
      if (st >= def.stages.length) continue;
      b.set('p' + id, (out) => out.set(site.x, 2.8, site.z), `${def.icon}<small>🔨</small>`, 'need visitor', () => this.hud.openProject(id));
    }
    for (const e of this.visitors.map.values()) {
      const v = e.v;
      const enough = g.count(v.item) >= v.qty;
      b.set('v' + v.id, (out) => out.copy(e.obj.position).setY(1.75), `${ITEMS[v.item].icon}<small>×${v.qty}</small>`, enough ? 'ready visitor' : 'need visitor', () => this.hud.openVisitor(v));
    }
    b.sweep();
  }

  // ------------------------------------------------------------------ main loop
  loop() {
    const nowT = performance.now();
    const dt = Math.min(0.05, (nowT - this.lastT) / 1000);
    this.lastT = nowT;
    this.input.twistEnabled = this.game.s.settings.twist !== false && this.hud.revealed('camera');
    this.input.update(dt);
    this.world.rig.update(dt);
    this.hud.updateCompass();
    const t = (((Date.now() - this.game.s.createdAt) / DAY_MS) + 0.05) % 1;
    this.world.updateDayCycle(t);
    this.world.updateEnvironment(dt);
    this.farm.update(dt);
    this.objects.update(dt);
    this.animals.update(dt);
    this.dog.update(dt);
    this.visitors.update(dt);
    this.wagon.update(dt);
    this.projects.update(dt);
    this.effects.update(dt);
    if (this.placing) this.updateGhost();
    this.bubbleTimer -= dt;
    if (this.bubbleTimer <= 0) { this.bubbleTimer = 0.2; this.updateBubbles(); }
    this.bubbles.update();
    this.guide.frame(dt);
    this.world.render();
    requestAnimationFrame(() => this.loop());
  }
}

window.farm = new Controller();
