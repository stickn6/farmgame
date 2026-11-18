// Dev-only model gallery: /gallery.html?keys=coop,cow,crop:wheat:3:0  (or ?set=debris, ?set=album)
// Lays out the requested models in a grid with labels, for visual review of assets. A recoloured decoration's
// type (bluebath, goldlamp, …) draws its model with its tint.
import * as THREE from 'three';
import { makeObject, BUILDERS } from './game/assets.js';
import { OBJECTS } from './game/config.js';
import { applyTint, tintOf } from './game/views.js';
import './game/models/index.js';

// named presets for ?set=
const SETS = {
  debris: 'weed,weed:1,weed:2,stone,stone:1,stone:2,stump,stump:1,stump:2,soil,scarecrow,birdbath',
  album: 'bluebath,copperwell,rosepicnic,blossomarch,harvestmill,mossfountain,lilacgazebo,silverrooster,curio,skyballoon,goldscarecrow,goldlamp,blossomoak,frostpine,mailbox:up',
};

const params = new URLSearchParams(location.search);
const keys = (params.get('keys') || SETS[params.get('set')] || Object.keys(BUILDERS).filter((k) => !['crop', 'cloud', 'truck', 'tree', 'npc'].includes(k)).join(',')).split(',').filter(Boolean);
const cell = +(params.get('cell') || 4);
let yaw = +(params.get('angle') || 0.6);
const pitch = +(params.get('pitch') || 0.75);

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fd8ff');
scene.add(new THREE.HemisphereLight('#dff1ff', '#5f8a45', 1.1));
const sun = new THREE.DirectionalLight('#fff3dd', 2.2);
sun.position.set(15, 30, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 120 });
scene.add(sun);

const cols = Math.ceil(Math.sqrt(keys.length));
const rows = Math.ceil(keys.length / cols);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(cols * cell + 4, rows * cell + 4), new THREE.MeshStandardMaterial({ color: '#79c453' }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const labels = [];
keys.forEach((k, i) => {
  const c = i % cols, r = Math.floor(i / cols);
  const x = (c - (cols - 1) / 2) * cell, z = (r - (rows - 1) / 2) * cell;
  let obj;
  const def = !BUILDERS[k.split(':')[0]] && OBJECTS[k];
  try { obj = def ? applyTint(makeObject(def.model || k), tintOf(k)) : makeObject(k); } catch (e) { console.error(k, e); return; }
  obj.position.set(x, 0, z);
  scene.add(obj);
  const tile = new THREE.Mesh(new THREE.PlaneGeometry(cell - 0.3, cell - 0.3), new THREE.MeshStandardMaterial({ color: (r + c) % 2 ? '#86cf5f' : '#74bf50' }));
  tile.rotation.x = -Math.PI / 2; tile.position.set(x, 0.005, z); tile.receiveShadow = true;
  scene.add(tile);
  const el = document.createElement('div');
  el.className = 'lbl';
  el.textContent = k;
  document.body.appendChild(el);
  labels.push({ el, pos: new THREE.Vector3(x, 0, z + cell / 2 - 0.4) });
});

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
const span = Math.max(cols, rows) * cell;
let dist = +(params.get('dist') || span * 1.25 + 4);
function place() {
  camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(0, 0.6, 0);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
let drag = null;
canvas.addEventListener('pointerdown', (e) => (drag = e.clientX));
addEventListener('pointerup', () => (drag = null));
addEventListener('pointermove', (e) => { if (drag != null) { yaw -= (e.clientX - drag) * 0.01; drag = e.clientX; } });
canvas.addEventListener('wheel', (e) => { dist *= Math.pow(1.001, e.deltaY); });
resize();
const tmp = new THREE.Vector3();
function loop() {
  place();
  renderer.render(scene, camera);
  for (const l of labels) {
    tmp.copy(l.pos).project(camera);
    l.el.style.left = (tmp.x * 0.5 + 0.5) * innerWidth + 'px';
    l.el.style.top = (-tmp.y * 0.5 + 0.5) * innerHeight + 'px';
  }
  requestAnimationFrame(loop);
}
loop();
window.galleryReady = true;
