// Small DOM "speech bubbles" pinned to 3D positions (ready products, hungry animals, ...)
import * as THREE from 'three';

export class Bubbles {
  constructor(container, world) {
    this.container = container;
    this.world = world;
    this.map = new Map(); // id -> { el, getPos, html, cls }
    this.tmp = new THREE.Vector3();
    this.ndc = new THREE.Vector3();
    // the HUD's boxes (set by main.js): a bubble that slides under the top bar or the toolbar fades, so the white
    // bubble never sits behind the HUD's white text (read 4× a second, before any bubble moves)
    this.hudRects = null;
    this.rects = [];
    this.rectsAt = -1e9;
  }

  set(id, getPos, html, cls = '', onClick = null) {
    let b = this.map.get(id);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'bubble-anchor';
      el.dataset.guide = 'bubble:' + id; // a guide can point at it: bubble:o<objectId>, bubble:a<animalId>, bubble:v<visitorId>
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
    if (b.html !== html) { b.inner.innerHTML = html; b.html = html; b.w = 0; }
    if (b.cls !== cls) { b.inner.className = 'bubble ' + cls; b.cls = cls; b.w = 0; }
  }

  // call before a batch of set() calls; then sweep() removes bubbles not set this round
  mark() { for (const b of this.map.values()) b.seen = false; }
  sweep() {
    for (const [id, b] of this.map) if (!b.seen) { b.el.remove(); this.map.delete(id); }
  }

  update() {
    // layout reads first (the HUD's boxes, new bubbles' sizes, the viewport), then the writes: no read between two
    // bubbles' writes, or each one costs a style recalc while the camera moves
    const now = performance.now();
    if (this.hudRects && now - this.rectsAt > 250) { this.rects = this.hudRects(); this.rectsAt = now; }
    for (const b of this.map.values()) if (!b.w && b.el.style.display !== 'none') { b.w = b.inner.offsetWidth; b.h = b.inner.offsetHeight + 8; }
    const W = window.innerWidth, H = window.innerHeight;
    for (const b of this.map.values()) {
      const p = b.getPos(this.tmp);
      if (!p) { b.el.style.display = 'none'; continue; }
      const s = this.world.project(p, this.ndc, W, H);
      if (!s.visible) { b.el.style.display = 'none'; continue; }
      b.el.style.display = '';
      b.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
      const hw = (b.w || 40) / 2, top = s.y - (b.h || 40);
      const under = this.rects.some((r) => s.x + hw > r.left && s.x - hw < r.right && s.y > r.top && top < r.bottom);
      if (under !== !!b.under) { b.under = under; b.el.classList.toggle('under-hud', under); }
    }
  }
}
