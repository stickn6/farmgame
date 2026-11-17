// Small DOM "speech bubbles" pinned to 3D positions (ready products, hungry animals, ...)
import * as THREE from 'three';

export class Bubbles {
  constructor(container, world) {
    this.container = container;
    this.world = world;
    this.map = new Map(); // id -> { el, getPos, html, cls }
    this.tmp = new THREE.Vector3();
  }

  set(id, getPos, html, cls = '', onClick = null) {
    let b = this.map.get(id);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'bubble-anchor';
      const inner = document.createElement('div');
      el.appendChild(inner);
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      el.addEventListener('click', (e) => { e.stopPropagation(); b.onClick && b.onClick(); });
      this.container.appendChild(el);
      b = { el, inner, html: null, cls: null };
      this.map.set(id, b);
    }
    b.getPos = getPos;
    b.onClick = onClick;
    b.seen = true;
    if (b.html !== html) { b.inner.innerHTML = html; b.html = html; }
    if (b.cls !== cls) { b.inner.className = 'bubble ' + cls; b.cls = cls; }
  }

  // call before a batch of set() calls; then sweep() removes bubbles not set this round
  mark() { for (const b of this.map.values()) b.seen = false; }
  sweep() {
    for (const [id, b] of this.map) if (!b.seen) { b.el.remove(); this.map.delete(id); }
  }

  update() {
    const cam = this.world.camera;
    for (const b of this.map.values()) {
      const p = b.getPos(this.tmp);
      if (!p) { b.el.style.display = 'none'; continue; }
      const s = this.world.project(p);
      if (!s.visible) { b.el.style.display = 'none'; continue; }
      b.el.style.display = '';
      b.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    void cam;
  }
}
