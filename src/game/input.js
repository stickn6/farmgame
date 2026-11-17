// Unified mouse / touch / keyboard input.
//  - one finger / left mouse: either "paint" (tools, swipe-harvest) or "pan" (decided by controller)
//  - two fingers: pinch zoom + pan; mouse wheel: zoom; right/middle drag: pan
//  - keyboard: WASD/arrows pan, Q/E rotate, +/- zoom
import * as THREE from 'three';

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

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e, true));
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.rig.zoomBy(Math.pow(1.0015, e.deltaY)); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      this.h.onKey && this.h.onKey(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  startPan(x, y) {
    this.rig.velocity.set(0, 0, 0);
    this.world.groundPoint(x, y, this.grab);
    this.panVel = new THREE.Vector3();
  }

  doPan(x, y) {
    const p = this.world.groundPoint(x, y, this.tmp);
    if (!p) return;
    const dx = this.grab.x - p.x, dz = this.grab.z - p.z;
    this.rig.target.x += dx;
    this.rig.target.z += dz;
    this.rig.goal.target = null;
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
      const isMouseAlt = e.pointerType === 'mouse' && e.button !== 0;
      const mode = isMouseAlt ? 'pan' : this.h.decide(e);
      this.gesture = { mode, id: e.pointerId, moved: false, sx: e.clientX, sy: e.clientY, t: performance.now() };
      if (mode === 'pan') this.startPan(e.clientX, e.clientY);
      else this.h.onPaint(e, true);
    } else if (this.pointers.size === 2) {
      if (this.gesture && this.gesture.mode === 'paint') this.h.onPaintEnd && this.h.onPaintEnd(true);
      const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.gesture = { mode: 'pinch', startDist: Math.hypot(a.x - b.x, a.y - b.y), startCam: this.rig.dist, moved: true };
      this.startPan(mx, my);
    }
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
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.rig.setDist(g.startCam * (g.startDist / Math.max(20, d)));
      this.rig.goal.dist = this.rig.dist;
      this.doPan((a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (e.pointerId !== g.id) return;
    if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > TAP_SLOP) g.moved = true;
    if (g.mode === 'pan') { if (g.moved) this.doPan(e.clientX, e.clientY); }
    else if (g.mode === 'paint') this.h.onPaint(e, false);
  }

  up(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.mode === 'pinch') {
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
      else if (this.panVel && performance.now() - this.lastMoveT < 80) this.rig.velocity.copy(this.panVel);
    } else if (g.mode === 'paint') {
      this.h.onPaintEnd && this.h.onPaintEnd(cancelled, e, g.moved);
    }
    this.gesture = null;
  }

  update(dt) {
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
      this.rig.goal.target = null;
    }
    if (k.has('+') || k.has('=')) this.rig.zoomBy(1 - dt * 1.5);
    if (k.has('-') || k.has('_')) this.rig.zoomBy(1 + dt * 1.5);
  }
}
