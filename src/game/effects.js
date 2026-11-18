// Visual juice: particle bursts in 3D, floating text and "fly to UI" icons in DOM.
import * as THREE from 'three';

// puff() palettes: flying bits + the dust cloud colour. Leafy bits flutter down slowly.
export const PUFF_KINDS = {
  weed: { bits: ['#3f7f2f', '#5c9a38', '#8fd45f', '#2f6526', '#f7cf3b'], dust: '#e3dcc0', leaf: true },
  stone: { bits: ['#a9a59b', '#8a867d', '#c9c5ba', '#7fa653'], dust: '#e6e2d8' },
  stump: { bits: ['#6e4a2c', '#e2b47a', '#c79459', '#5c9a38'], dust: '#e3d2b0' },
  dust: { bits: ['#c9b083', '#a87447', '#ffffff'], dust: '#efe6cf' },
};

export class Effects {
  constructor(world, layer) {
    this.world = world;
    this.layer = layer;
    this.particles = [];
    this.fades = []; // dust clouds and ground rings that grow and fade out
    this.geo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    this.leafGeo = new THREE.BoxGeometry(0.13, 0.015, 0.07);
    this.cloudGeo = new THREE.IcosahedronGeometry(1, 0);
    this.ringGeo = new THREE.RingGeometry(0.82, 1, 20).rotateX(-Math.PI / 2);
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

  // Debris-clear "poof": a soft dust cloud, a ground ring and a spray of leaves / grit / wood chips.
  // kind: 'weed' | 'stone' | 'stump' | 'dust' (see PUFF_KINDS); pos is the object's ground centre.
  puff(pos, kind = 'dust', { power = 1, colors } = {}) {
    const k = PUFF_KINDS[kind] || PUFF_KINDS.dust;
    const scene = this.world.scene;
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(this.cloudGeo, new THREE.MeshStandardMaterial({ color: k.dust, roughness: 1, flatShading: true, transparent: true, opacity: 0.8, depthWrite: false }));
      const a = (i / 5) * Math.PI * 2 + Math.random() * 0.6;
      m.position.set(pos.x + Math.cos(a) * 0.18, 0.18 + Math.random() * 0.2, pos.z + Math.sin(a) * 0.18);
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      scene.add(m);
      const v = new THREE.Vector3(Math.cos(a) * 0.9, 0.7 + Math.random() * 0.5, Math.sin(a) * 0.9).multiplyScalar(power);
      this.fades.push({ m, v, life: 0, max: 0.55 + Math.random() * 0.25, s0: 0.12 * power, s1: (0.26 + Math.random() * 0.1) * power, o0: 0.85 });
    }
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: k.dust, transparent: true, opacity: 0.7, depthWrite: false }));
    ring.position.set(pos.x, 0.04, pos.z);
    scene.add(ring);
    this.fades.push({ m: ring, v: null, life: 0, max: 0.45, s0: 0.25 * power, s1: 0.95 * power, o0: 0.7 });
    const bits = colors || k.bits;
    const n = Math.round(12 * power);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(k.leaf && i % 4 ? this.leafGeo : this.geo, this.mat(bits[i % bits.length]));
      m.position.set(pos.x + (Math.random() - 0.5) * 0.3, 0.25, pos.z + (Math.random() - 0.5) * 0.3);
      const a = Math.random() * Math.PI * 2;
      const sp = (0.8 + Math.random() * 1.4) * power;
      const v = new THREE.Vector3(Math.cos(a) * sp, (2.4 + Math.random() * 1.6) * power, Math.sin(a) * sp);
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      const s = 0.7 + Math.random() * 0.7;
      m.scale.setScalar(s);
      scene.add(m);
      const leaf = k.leaf && i % 4 !== 0;
      this.particles.push({ m, v, life: 0, max: leaf ? 1.1 + Math.random() * 0.4 : 0.7 + Math.random() * 0.4, s, g: leaf ? 4 : 9, drag: leaf ? 0.25 : 1, phase: Math.random() * 6 });
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.v.y -= (p.g ?? 9) * dt;
      if (p.drag !== undefined && p.drag < 1) {
        // leaves: air drag + a side-to-side flutter
        p.v.multiplyScalar(Math.pow(p.drag, dt));
        p.m.position.x += Math.sin(p.life * 9 + p.phase) * dt * 0.5;
        p.m.rotation.z += dt * 4;
      }
      p.m.position.addScaledVector(p.v, dt);
      if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.v.y *= -0.3; p.v.x *= 0.6; p.v.z *= 0.6; }
      p.m.rotation.x += dt * 6;
      const t = p.life / p.max;
      p.m.scale.setScalar(p.s * (1 - t * t));
      if (t >= 1) { this.world.scene.remove(p.m); this.particles.splice(i, 1); }
    }
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i];
      f.life += dt;
      const t = Math.min(1, f.life / f.max);
      const e = 1 - (1 - t) * (1 - t);
      f.m.scale.setScalar(f.s0 + (f.s1 - f.s0) * e);
      f.m.material.opacity = f.o0 * (1 - t);
      if (f.v) { f.m.position.addScaledVector(f.v, dt); f.v.multiplyScalar(Math.pow(0.08, dt)); }
      if (t >= 1) { this.world.scene.remove(f.m); f.m.material.dispose(); this.fades.splice(i, 1); }
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
