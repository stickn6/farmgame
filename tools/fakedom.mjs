// A tiny stand-in for the DOM, enough for the HUD's h() builder and for reading what a panel renders in node tests
// (element tree, classes, attributes, text, click listeners). Not a browser: no layout, no CSS.
export class FakeEl {
  constructor(tag = 'div') {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.childNodes = [];
    this.attrs = {};
    this.dataset = {};
    this.className = '';
    this.style = { cssText: '', setProperty() {}, getPropertyValue: () => '' };
    this.listeners = {};
    this.parentNode = null;
    this.isConnected = true;
  }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    const add = (...cs) => { el.className = [...new Set([...list(), ...cs])].join(' '); };
    const remove = (...cs) => { el.className = list().filter((x) => !cs.includes(x)).join(' '); };
    return {
      contains: (c) => list().includes(c),
      add,
      remove,
      toggle: (c, on) => { const has = list().includes(c); const want = on === undefined ? !has : !!on; if (want !== has) (want ? add : remove)(c); return want; },
    };
  }
  append(...xs) { for (const x of xs) { if (x == null) continue; const n = typeof x === 'object' ? x : fakeDocument.createTextNode(String(x)); n.parentNode = this; this.childNodes.push(n); } }
  appendChild(x) { this.append(x); return x; }
  remove() { const p = this.parentNode; if (p) p.childNodes = p.childNodes.filter((c) => c !== this); this.parentNode = null; this.isConnected = false; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  click() { for (const fn of this.listeners.click || []) fn({ target: this, stopPropagation() {}, preventDefault() {} }); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes = [fakeDocument.createTextNode(String(v))]; }
  set innerHTML(v) { this.childNodes = v ? [fakeDocument.createTextNode(String(v))] : []; }
  get innerHTML() { return this.textContent; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
  // every element under this one (depth first), and the ones matching a test
  all() { const out = []; const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } }; walk(this); return out; }
  find(test) { return this.all().filter(test); }
  // '.cls', 'tag', '[data-guide="key"]' (one simple selector)
  querySelectorAll(sel) {
    const m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel);
    if (m) return this.find((e) => e.getAttribute(m[1]) === m[2]);
    if (sel.startsWith('.')) return this.find((e) => e.classList.contains(sel.slice(1)));
    return this.find((e) => e.tagName === sel.toUpperCase());
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest() { return null; }
  blur() {}
}

export const fakeDocument = {
  hidden: false,
  body: new FakeEl('body'),
  activeElement: null,
  createElement: (tag) => new FakeEl(tag),
  createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: () => [],
  querySelector: () => null,
  elementsFromPoint: () => [],
};

// run fn with globalThis.document (and friends) faked; restores whatever was there
export async function withFakeDom(fn, extra = {}) {
  const keys = ['document', 'innerWidth', 'innerHeight', 'requestAnimationFrame', ...Object.keys(extra)];
  const old = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const set = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  set('document', fakeDocument);
  set('innerWidth', 390);
  set('innerHeight', 844);
  set('requestAnimationFrame', () => 0);
  for (const [k, v] of Object.entries(extra)) set(k, v);
  try { return await fn(); } finally {
    for (const [k, d] of old) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    fakeDocument.hidden = false;
  }
}
