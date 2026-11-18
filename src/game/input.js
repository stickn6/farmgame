// Unified mouse / touch / keyboard input.
//  - one finger / left mouse: either "paint" (tools, swipe-harvest, moving a ghost) or "pan" (decided by controller).
//    A touch paint waits CAMERA.armMs for a second finger before it starts (moving or lifting starts it at once),
//    so a two-finger gesture never harvests, plows, plants, clears or moves a ghost.
//  - two fingers: pinch zoom + pan, and (once twistEnabled) a twist turns the farm about the fingers
//  - mouse: wheel zoom, Shift+wheel tilt, right-drag pan, middle-drag or Ctrl/⌘+left-drag orbit (turn + tilt)
//  - keyboard: WASD/arrows pan, +/- zoom (turn / tilt / Home keys live in main.js onKey)
//  - cameraLocked (guide hard beats): pan / pinch / twist / orbit / wheel / key moves do nothing; taps and paint still work
import * as THREE from 'three';
import { CAMERA } from './config.js';
import { twistUpdate } from './camera.js';

const TAP_SLOP = 9;

export class Input {
  constructor(canvas, world, handlers) {
    this.canvas = canvas;
    this.world = world;
    this.rig = world.rig;
    this.h = handlers;
    this.pointers = new Map();
    this.gesture = null;
    this.keys = new Set();
    this.grab = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.lastMoveT = 0;
    this._locked = false;
    this.armTimer = null;
    this.twistEnabled = false; // main.js, every frame: the setting is on and 🧭 has been revealed
    this.onLockChange = null; // (locked) the HUD dims 🧭 and closes its pad

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e, true));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      this.h.onKey && this.h.onKey(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // While locked the player can't move the camera (World.frame still can). Also stops any drift.
  get cameraLocked() { return this._locked; }
  set cameraLocked(v) {
    const was = this._locked;
    this._locked = !!v;
    this.rig.locked = this._locked;
    if (this._locked) { this.rig.velocity.set(0, 0, 0); if (this.panVel) this.panVel.set(0, 0, 0); }
    if (was !== this._locked) this.onLockChange?.(this._locked);
  }

  wheel(e) {
    e.preventDefault();
    if (this._locked) return;
    if (e.shiftKey) {
      // Shift+wheel tilts (some browsers turn a shifted wheel into a sideways scroll)
      const d = e.deltaY || e.deltaX;
      this.rig.setPitch(this.rig.goal.pitch + d * CAMERA.orbit.pitchPerWheel);
      clearTimeout(this.tiltSaveTimer);
      this.tiltSaveTimer = setTimeout(() => this.rig.onView?.(), 250);
      return;
    }
    this.rig.zoomBy(Math.pow(1.0015, e.deltaY));
  }

  startPan(x, y) {
    this.rig.velocity.set(0, 0, 0);
    this.world.groundPoint(x, y, this.grab);
    this.panVel = new THREE.Vector3();
  }

  doPan(x, y) {
    if (this._locked) return;
    const p = this.world.groundPoint(x, y, this.tmp);
    if (!p) return;
    const dx = this.grab.x - p.x, dz = this.grab.z - p.z;
    this.rig.target.x += dx;
    this.rig.target.z += dz;
    this.rig.stopGlide();
    this.rig.apply();
    const now = performance.now();
    const dt = Math.max(0.008, (now - this.lastMoveT) / 1000);
    this.lastMoveT = now;
    this.panVel.set(dx / dt, 0, dz / dt).clampLength(0, 40);
  }

  down(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    this.h.onAnyDown && this.h.onAnyDown(e);
    if (this.pointers.size === 1) {
      const mouse = e.pointerType === 'mouse';
      // middle button, or Ctrl/⌘ + left: orbit; right button: pan
      const orbit = mouse && (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey)));
      const mode = orbit ? 'orbit' : mouse && e.button !== 0 ? 'pan' : this.h.decide(e);
      const g = { mode, id: e.pointerId, moved: false, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), armed: true };
      this.gesture = g;
      if (mode === 'pan') this.startPan(e.clientX, e.clientY);
      else if (mode === 'paint') {
        if (e.pointerType === 'touch') {
          // paint arming: wait for a possible second finger (a timer, not update(), which pauses while locked)
          g.armed = false;
          g.pending = { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: e.pointerType };
          clearTimeout(this.armTimer);
          this.armTimer = setTimeout(() => { if (this.gesture === g) this.arm(); }, CAMERA.armMs);
        } else this.h.onPaint(e, true);
      }
    } else if (this.pointers.size === 2) {
      const g = this.gesture;
      if (g && g.mode === 'paint') {
        // an unarmed paint is dropped without a trace (no onPaint, no onPaintEnd); an armed one ends cancelled
        if (!g.armed) this.disarm();
        else this.h.onPaintEnd && this.h.onPaintEnd(true);
      }
      const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      this.gesture = {
        mode: 'pinch', startDist: dist, startCam: this.rig.dist, moved: true,
        twist: { angle0: Math.atan2(b.y - a.y, b.x - a.x), dist0: dist, yaw0: this.rig.goal.yaw, engaged: false, offset: 0 },
      };
      this.startPan(mx, my);
    }
  }

  // the pending touch paint starts (its timer ran out, the finger moved or lifted)
  arm() {
    clearTimeout(this.armTimer);
    this.armTimer = null;
    const g = this.gesture;
    if (!g || g.mode !== 'paint' || g.armed) return;
    g.armed = true;
    this.h.onPaint(g.pending, true);
  }

  disarm() {
    clearTimeout(this.armTimer);
    this.armTimer = null;
    if (this.gesture && this.gesture.mode === 'paint') this.gesture.pending = null;
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') this.h.onHover && this.h.onHover(e);
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    const g = this.gesture;
    if (!g) return;
    if (g.mode === 'pinch' && this.pointers.size >= 2) {
      if (this._locked) return;
      const [a, b] = [...this.pointers.values()];
      // the twist turns the farm about the point between the fingers: doPan below re-anchors the grabbed ground there
      if (this.twistEnabled && g.twist) {
        const r = twistUpdate(g.twist, a, b);
        if (r.engaged) this.rig.twistTo(r.yaw);
      }
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.rig.setDist(g.startCam * (g.startDist / Math.max(20, d)));
      this.rig.goal.dist = this.rig.dist;
      this.doPan((a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (e.pointerId !== g.id) return;
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > TAP_SLOP) g.moved = true;
    if (g.mode === 'pan') { if (g.moved) this.doPan(e.clientX, e.clientY); }
    else if (g.mode === 'orbit') {
      if (g.moved && !this._locked) this.rig.orbitBy(e.clientX - g.lx, e.clientY - g.ly);
      if (g.moved) { g.lx = e.clientX; g.ly = e.clientY; }
    } else if (g.mode === 'paint') {
      if (!g.armed) {
        if (!g.moved) return; // still a possible tap or the start of a two-finger gesture
        this.arm();
      }
      this.h.onPaint(e, false);
    }
  }

  up(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.mode === 'pinch') {
      if (this.pointers.size <= 1 && g.twist?.engaged) {
        g.twist.engaged = false;
        this.rig.snapYaw();
        this.rig.onView?.();
      }
      if (this.pointers.size === 1) {
        // continue panning with the remaining finger, never treat as tap
        const [id, p] = [...this.pointers.entries()][0];
        this.gesture = { mode: 'pan', id, moved: true, sx: p.x, sy: p.y };
        this.startPan(p.x, p.y);
      } else if (this.pointers.size === 0) this.gesture = null;
      return;
    }
    if (e.pointerId !== g.id) return;
    if (g.mode === 'pan') {
      if (!g.moved && !cancelled) this.h.onTap(e);
      else if (!this._locked && this.panVel && performance.now() - this.lastMoveT < 80) this.rig.velocity.copy(this.panVel);
    } else if (g.mode === 'orbit') {
      if (g.moved) { this.rig.snapYaw(); this.rig.onView?.(); }
    } else if (g.mode === 'paint') {
      if (!g.armed) {
        // a quick tap: it still harvests (or tap-harvests its patch); a cancelled touch never painted
        if (cancelled) { this.disarm(); this.gesture = null; return; }
        this.arm();
      }
      this.h.onPaintEnd && this.h.onPaintEnd(cancelled, e, g.moved);
    }
    this.gesture = null;
  }

  update(dt) {
    if (this._locked) return;
    const k = this.keys;
    let fx = 0, fz = 0;
    if (k.has('w') || k.has('arrowup')) fz -= 1;
    if (k.has('s') || k.has('arrowdown')) fz += 1;
    if (k.has('a') || k.has('arrowleft')) fx -= 1;
    if (k.has('d') || k.has('arrowright')) fx += 1;
    if (fx || fz) {
      const yaw = this.rig.yaw;
      const sp = this.rig.dist * 0.9 * dt;
      // screen-relative movement
      this.rig.target.x += (Math.cos(yaw) * fx + Math.sin(yaw) * fz) * sp;
      this.rig.target.z += (-Math.sin(yaw) * fx + Math.cos(yaw) * fz) * sp;
      this.rig.stopGlide();
    }
    if (k.has('+') || k.has('=')) this.rig.zoomBy(1 - dt * 1.5);
    if (k.has('-') || k.has('_')) this.rig.zoomBy(1 + dt * 1.5);
  }
}
