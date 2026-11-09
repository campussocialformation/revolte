// Revolte — small DOM toolkit and controls (knobs, faders, buttons)
import { toNorm, fromNorm, formatParam } from '../shared/params.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ------------------------------------------------------------------ binding registry
const registry = new Map(); // key -> Set<widget>
export const tkey = (t) => `${t.scope}:${t.t ?? ''}:${t.id}`;
function register(w) {
  const k = tkey(w.target);
  if (!registry.has(k)) registry.set(k, new Set());
  registry.get(k).add(w);
}
export function refreshTarget(target, v) {
  const set = registry.get(tkey(target)); if (!set) return;
  for (const w of set) { if (!w.el.isConnected) { set.delete(w); continue; } w.update(v); }
}
export function refreshAll(store) {
  for (const set of registry.values()) for (const w of set) { if (!w.el.isConnected) { set.delete(w); continue; } w.update(store.get(w.target)); }
}

let learnHandler = null;
export function setLearnHandler(fn) { learnHandler = fn; document.body.classList.toggle('learning', !!fn); }

// ------------------------------------------------------------------ knob
export class Knob {
  constructor(store, target, opts = {}) {
    this.store = store; this.target = target; this.opts = opts;
    this.def = opts.def || store.def(target);
    const d = this.def;
    const size = opts.size || 46;
    this.el = h('div', { class: 'knob' + (opts.big ? ' big' : '') + (opts.cls ? ' ' + opts.cls : ''), title: (d ? d.label : '') + ' — glisser, molette, double-clic = défaut' });
    const r = size / 2 - 4;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    const arc = (cls) => { const p = document.createElementNS(svgNS, 'path'); p.setAttribute('class', cls); svg.append(p); return p; };
    this.track = arc('k-track'); this.val = arc('k-val');
    const dot = document.createElementNS(svgNS, 'line'); dot.setAttribute('class', 'k-dot'); svg.append(dot); this.dot = dot;
    this.size = size; this.r = r;
    this.track.setAttribute('d', arcPath(size / 2, size / 2, r, -135, 135));
    this.label = h('div', { class: 'k-label' }, opts.label || (d ? d.label : '?'));
    this.value = h('div', { class: 'k-value' });
    this.el.append(svg, this.value, this.label);
    if (opts.color) this.el.style.setProperty('--kc', opts.color);
    this.bind();
    register(this);
    this.update(store.get(target));
  }
  update(v) {
    if (v === undefined || !this.def) return;
    this.v = v;
    const n = Math.max(0, Math.min(1, toNorm(this.def, v)));
    const bip = this.def.min < 0 && this.def.max > 0 && !this.def.options;
    const a0 = bip ? 0 : -135, a1 = -135 + 270 * n;
    this.val.setAttribute('d', Math.abs(a1 - a0) < 0.5 ? '' : arcPath(this.size / 2, this.size / 2, this.r, Math.min(a0, a1), Math.max(a0, a1)));
    const rad = ((a1 - 90) * Math.PI) / 180;
    const c = this.size / 2;
    this.dot.setAttribute('x1', c + Math.cos(rad) * (this.r - 9)); this.dot.setAttribute('y1', c + Math.sin(rad) * (this.r - 9));
    this.dot.setAttribute('x2', c + Math.cos(rad) * (this.r - 2)); this.dot.setAttribute('y2', c + Math.sin(rad) * (this.r - 2));
    this.value.textContent = formatParam(this.def, v);
    const locked = this.opts.lockInfo && this.opts.lockInfo();
    this.el.classList.toggle('locked', !!locked);
  }
  setNorm(n, gesture) {
    const v = fromNorm(this.def, n);
    this.store.set(this.target, v);
  }
  bind() {
    const el = this.el;
    let startY = 0, startN = 0, dragging = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (learnHandler) { learnHandler(this.target, this.def); e.preventDefault(); return; }
      el.setPointerCapture(e.pointerId);
      dragging = true; startY = e.clientY; startN = toNorm(this.def, this.store.get(this.target) ?? this.def.def);
      if (this.opts.undo !== false && this.target.scope !== 'fx' && !(this.store.recOn && this.store.playing)) this.store.pushUndo('réglage');
      el.classList.add('active');
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const range = e.shiftKey ? 800 : 180;
      const n = Math.max(0, Math.min(1, startN + (startY - e.clientY) / range));
      if (this.def.options) { const v = Math.round(n * this.def.max); if (v !== Math.round(this.store.get(this.target))) this.store.set(this.target, v); }
      else this.setNorm(n);
    });
    const end = (e) => { if (!dragging) return; dragging = false; el.classList.remove('active'); try { el.releasePointerCapture(e.pointerId); } catch { } };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const cur = this.store.get(this.target) ?? this.def.def;
      if (this.def.options || this.def.int) { this.store.set(this.target, cur + (e.deltaY < 0 ? 1 : -1)); return; }
      const n = toNorm(this.def, cur) + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.004 : 0.02);
      this.setNorm(n);
    }, { passive: false });
    el.addEventListener('dblclick', () => { this.store.set(this.target, this.def.def); });
  }
}
function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => { const rad = ((a - 90) * Math.PI) / 180; return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r]; };
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

// ------------------------------------------------------------------ vertical fader
export class Fader {
  constructor(store, target, opts = {}) {
    this.store = store; this.target = target; this.opts = opts;
    this.def = opts.def || store.def(target);
    this.el = h('div', { class: 'fader', title: (opts.label || this.def.label) + ' — double-clic = défaut' });
    this.slot = h('div', { class: 'f-slot' });
    this.fill = h('div', { class: 'f-fill' });
    this.cap = h('div', { class: 'f-cap' });
    this.meter = opts.meter ? h('div', { class: 'f-meter' }, h('div', { class: 'f-meter-in' })) : null;
    this.slot.append(this.fill, this.cap);
    this.valueEl = h('div', { class: 'f-value' });
    this.el.append(h('div', { class: 'f-body' }, this.slot, this.meter), this.valueEl);
    if (opts.color) this.el.style.setProperty('--kc', opts.color);
    this.bind(); register(this);
    this.update(store.get(target));
  }
  update(v) {
    if (v === undefined) return;
    const n = toNorm(this.def, v);
    this.fill.style.height = n * 100 + '%';
    this.cap.style.bottom = `calc(${n * 100}% - 7px)`;
    const db = v > 0 ? 20 * Math.log10(v) : -Infinity;
    this.valueEl.textContent = this.opts.db ? (db === -Infinity ? '-∞' : (db > 0 ? '+' : '') + db.toFixed(1)) : formatParam(this.def, v);
  }
  setMeter(x) { if (this.meter) this.meter.firstChild.style.height = Math.min(100, x * 100) + '%'; }
  bind() {
    let drag = false;
    const setFromY = (e) => {
      const r = this.slot.getBoundingClientRect();
      const n = 1 - (e.clientY - r.top) / r.height;
      this.store.set(this.target, fromNorm(this.def, n));
    };
    this.slot.addEventListener('pointerdown', (e) => {
      if (learnHandler) { learnHandler(this.target, this.def); return; }
      drag = true; this.slot.setPointerCapture(e.pointerId); setFromY(e);
    });
    this.slot.addEventListener('pointermove', (e) => drag && setFromY(e));
    this.slot.addEventListener('pointerup', () => (drag = false));
    this.slot.addEventListener('dblclick', () => this.store.set(this.target, this.def.def));
    this.el.addEventListener('wheel', (e) => { e.preventDefault(); const n = toNorm(this.def, this.store.get(this.target)) + (e.deltaY < 0 ? 0.02 : -0.02); this.store.set(this.target, fromNorm(this.def, n)); }, { passive: false });
  }
}

// ------------------------------------------------------------------ enum selector bound to a target
export class EnumSelect {
  constructor(store, target, opts = {}) {
    this.store = store; this.target = target;
    this.def = opts.def || store.def(target);
    this.el = h('label', { class: 'enum' }, h('span', {}, opts.label || this.def.label));
    this.sel = h('select', { onchange: () => { if (opts.undo !== false) store.pushUndo('réglage'); store.set(target, +this.sel.value); } },
      ...this.def.options.map((o, i) => h('option', { value: i }, o)));
    this.el.append(this.sel);
    register(this);
    this.update(store.get(target));
  }
  update(v) { if (v !== undefined) this.sel.value = Math.round(v); }
}

export function button(label, onclick, cls = '', title = '') {
  return h('button', { class: 'btn ' + cls, onclick, title }, label);
}
// momentary button: down/up callbacks; shift-click latches
export function momentary(label, down, up, cls = '', title = '') {
  const b = h('button', { class: 'btn mom ' + cls, title });
  b.textContent = label;
  let latched = false;
  b.addEventListener('pointerdown', (e) => {
    if (e.shiftKey) { latched = !latched; b.classList.toggle('latched', latched); latched ? down() : up(); return; }
    if (latched) { latched = false; b.classList.remove('latched'); up(); return; }
    b.setPointerCapture(e.pointerId); b.classList.add('on'); down();
  });
  const rel = () => { if (b.classList.contains('on')) { b.classList.remove('on'); if (!latched) up(); } };
  b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel);
  return b;
}

export function numberField(label, value, min, max, onchange, step = 1) {
  const inp = h('input', { type: 'number', value, min, max, step, onchange: () => onchange(Math.max(min, Math.min(max, +inp.value))) });
  inp.addEventListener('wheel', (e) => { e.preventDefault(); const v = Math.max(min, Math.min(max, +inp.value + (e.deltaY < 0 ? step : -step))); inp.value = v; onchange(v); }, { passive: false });
  return h('label', { class: 'numfield' }, h('span', {}, label), inp);
}
export function selectField(label, options, value, onchange) {
  const sel = h('select', { onchange: () => onchange(sel.value) }, ...options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: String(v) === String(value) }, l);
  }));
  return h('label', { class: 'selfield' }, label ? h('span', {}, label) : null, sel);
}

export function modal(title, body, actions = []) {
  const close = () => wrap.remove();
  const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: 'modal' }, h('div', { class: 'modal-title' }, title), body,
      h('div', { class: 'modal-actions' }, ...actions.map(([l, fn, cls]) => button(l, () => { if (fn() !== false) close(); }, cls)), button('Fermer', close))));
  document.body.append(wrap);
  return close;
}
export function prompt2(title, value, onok) {
  const inp = h('input', { type: 'text', value, class: 'wide' });
  modal(title, inp, [['OK', () => onok(inp.value), 'primary']]);
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { onok(inp.value); document.querySelector('.modal-wrap')?.remove(); } });
}
