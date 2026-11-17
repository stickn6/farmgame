// Visual juice: particle bursts in 3D, floating text and "fly to UI" icons in DOM.
import * as THREE from 'three';

export class Effects {
  constructor(world, layer) {
    this.world = world;
    this.layer = layer;
    this.particles = [];
    this.geo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    this.mats = new Map();
  }

  mat(color) {
    let m = this.mats.get(color);
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true }); this.mats.set(color, m); }
    return m;
  }

  burst(pos, colors, count = 10, power = 1) {
    colors = Array.isArray(colors) ? colors : [colors];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.geo, this.mat(colors[i % colors.length]));
      m.position.copy(pos);
      m.position.y += 0.2;
      const a = Math.random() * Math.PI * 2;
      const sp = (1 + Math.random() * 1.5) * power;
      const v = new THREE.Vector3(Math.cos(a) * sp, (2.5 + Math.random() * 2) * power, Math.sin(a) * sp);
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      const s = 0.6 + Math.random() * 0.8;
      m.scale.setScalar(s);
      this.world.scene.add(m);
      this.particles.push({ m, v, life: 0, max: 0.7 + Math.random() * 0.4, s });
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.v.y -= 9 * dt;
      p.m.position.addScaledVector(p.v, dt);
      if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.v.y *= -0.3; p.v.x *= 0.6; p.v.z *= 0.6; }
      p.m.rotation.x += dt * 6;
      const t = p.life / p.max;
      p.m.scale.setScalar(p.s * (1 - t * t));
      if (t >= 1) { this.world.scene.remove(p.m); this.particles.splice(i, 1); }
    }
  }

  screenPos(worldPos) {
    return this.world.project(worldPos);
  }

  floatText(worldPos, text, cls = '') {
    const p = this.screenPos(worldPos);
    this.floatTextAt(p.x, p.y, text, cls);
  }

  floatTextAt(x, y, text, cls = '') {
    const el = document.createElement('div');
    el.className = 'float-text ' + cls;
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  // Emoji flies in an arc from a world position to a DOM element (e.g. the barn button)
  fly(worldPos, emoji, targetEl, { delay = 0, onArrive } = {}) {
    const p = this.screenPos(worldPos);
    this.flyFrom(p.x, p.y, emoji, targetEl, { delay, onArrive });
  }

  flyFrom(x, y, emoji, targetEl, { delay = 0, onArrive } = {}) {
    if (!targetEl) return;
    const el = document.createElement('div');
    el.className = 'fly-icon';
    el.textContent = emoji;
    this.layer.appendChild(el);
    const r = targetEl.getBoundingClientRect();
    const tx = r.left + r.width / 2, ty = r.top + r.height / 2;
    const start = performance.now() + delay;
    const dur = 650 + Math.random() * 150;
    const midX = (x + tx) / 2 + (Math.random() - 0.5) * 120;
    const midY = Math.min(y, ty) - 80 - Math.random() * 60;
    el.style.transform = `translate(${x}px, ${y}px) scale(0)`;
    const step = (now) => {
      const t = Math.min(1, Math.max(0, (now - start) / dur));
      const e = t * t * (3 - 2 * t);
      const ix = (1 - e) * (1 - e) * x + 2 * (1 - e) * e * midX + e * e * tx;
      const iy = (1 - e) * (1 - e) * y + 2 * (1 - e) * e * midY + e * e * ty;
      const s = t < 0.15 ? t / 0.15 * 1.3 : 1.3 - (t - 0.15) * 0.6;
      el.style.transform = `translate(${ix}px, ${iy}px) translate(-50%, -50%) scale(${s})`;
      if (t < 1) requestAnimationFrame(step);
      else {
        el.remove();
        targetEl.classList.remove('bump');
        void targetEl.offsetWidth;
        targetEl.classList.add('bump');
        onArrive && onArrive();
      }
    };
    requestAnimationFrame(step);
  }
}
