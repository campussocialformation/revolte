// Revolte — canvas pattern editors: piano roll, drum grid, lane (step property) editor
import { MAX_STEPS, CONDITIONS, noteName, SCALES, DRUM_MODELS, paramDef, formatParam, toNorm, fromNorm, soundParamDefs } from '../shared/params.js';
import { newStep } from '../shared/model.js';
import { h } from './widgets.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const HEADER = 18;

function fitCanvas(cv) {
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(10, Math.floor(r.width)), hh = Math.max(10, Math.floor(r.height));
  if (cv.width !== w * dpr || cv.height !== hh * dpr) { cv.width = w * dpr; cv.height = hh * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: hh };
}

export class GridEditor {
  constructor(store) {
    this.store = store;
    this.cv = h('canvas', { class: 'grid-canvas', tabindex: 0 });
    this.el = h('div', { class: 'grid-wrap' }, this.cv);
    this.scrollX = 0; // in steps
    this.topNote = 84; // melodic: highest visible note
    this.rowH = 14;
    this.zoom = 0; // 0 = fit
    this.lastLen = 1;
    this.drag = null;
    this.hover = null;
    this.dirty = true;
    this.bind();
    const ro = new ResizeObserver(() => { this.dirty = true; });
    ro.observe(this.el);
    this._raf = () => { if (this.dirty && this.el.isConnected) this.draw(); requestAnimationFrame(this._raf); };
    requestAnimationFrame(this._raf);
    this.centerOnNotes();
  }
  invalidate() { this.dirty = true; }
  get t() { return this.store.selTrack; }
  get drum() { return this.store.isDrum(this.t); }
  get pat() { return this.store.pattern(this.t); }
  get len() { return this.pat ? this.pat.length : 16; }

  centerOnNotes() {
    const p = this.pat;
    if (!p || this.drum) return;
    let lo = 127, hi = 0;
    for (const st of p.lanes[0]) if (st && st.n) for (const n of st.n) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }
    if (lo > hi) { const tr = this.store.track; lo = tr.kind === 'bass' ? 28 : 55; hi = lo + 14; }
    const rows = Math.floor(((this.el.clientHeight || 300) - HEADER) / this.rowH);
    this.topNote = Math.min(127, Math.max(hi + 3, Math.round((lo + hi) / 2 + rows / 2)));
    this.dirty = true;
  }

  geom(w, hh) {
    const left = this.drum ? 96 : 46;
    const len = this.len;
    let cw = this.zoom || Math.max(10, Math.min(56, Math.floor((w - left - 6) / len)));
    const visible = Math.floor((w - left) / cw);
    this.scrollX = Math.max(0, Math.min(this.scrollX, Math.max(0, len - visible + 1)));
    const rowH = this.drum ? Math.max(18, Math.floor((hh - HEADER) / 8)) : this.rowH;
    return { left, cw, rowH, visible };
  }
  xOf(g, step) { return g.left + (step - this.scrollX) * g.cw; }
  stepAt(g, x) { return Math.floor((x - g.left) / g.cw + this.scrollX); }

  draw() {
    this.dirty = false;
    const { ctx, w, h: hh } = fitCanvas(this.cv);
    this.w = w; this.hh = hh;
    const g = this.g = this.geom(w, hh);
    const store = this.store, tr = store.track, p = this.pat;
    const col = tr.color;
    ctx.fillStyle = css('--bg1'); ctx.fillRect(0, 0, w, hh);
    const len = this.len;
    const playing = store.playing && store.pos;
    const ph = playing ? store.pos.tracks[this.t].step : -1;
    // rows background
    if (this.drum) {
      for (let lane = 0; lane < 8; lane++) {
        const y = HEADER + lane * g.rowH;
        ctx.fillStyle = lane === store.lane ? css('--bg3') : lane % 2 ? css('--bg1') : css('--bg2');
        ctx.fillRect(0, y, w, g.rowH);
        const model = DRUM_MODELS[tr.sound.params[`l${lane}m`] | 0];
        const lm = ((tr.mix.lmute | 0) >> lane) & 1;
        ctx.fillStyle = lm ? css('--fg3') : lane === store.lane ? col : css('--fg2');
        ctx.font = '600 11px var(--font)'; ctx.textBaseline = 'middle';
        ctx.fillText(`${lane + 1} ${model}${lm ? ' (M)' : ''}`, 8, y + g.rowH / 2);
        if (lm) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(g.left, y, w, g.rowH); }
      }
    } else {
      const sc = SCALES.find((s) => s.id === store.song.scale.id) || SCALES[0];
      const rows = Math.ceil((hh - HEADER) / g.rowH);
      for (let r = 0; r < rows; r++) {
        const note = this.topNote - r; if (note < 0) break;
        const y = HEADER + r * g.rowH;
        const pc = ((note % 12) + 12) % 12;
        const black = [1, 3, 6, 8, 10].includes(pc);
        const inScale = sc.steps.includes(((note - store.song.scale.root) % 12 + 12) % 12);
        ctx.fillStyle = black ? css('--bg0') : css('--bg2');
        ctx.fillRect(g.left, y, w - g.left, g.rowH);
        if (inScale && sc.steps.length < 12) { ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(g.left, y, w - g.left, g.rowH); }
        // keys
        ctx.fillStyle = black ? '#1b1d24' : '#d9dbe3';
        if (this.hover && this.hover.note === note) ctx.fillStyle = col;
        ctx.fillRect(0, y, g.left - 2, g.rowH - 1);
        if (pc === 0 || g.rowH >= 14) {
          ctx.fillStyle = black ? '#9aa' : '#333'; ctx.font = '10px var(--font)'; ctx.textBaseline = 'middle';
          ctx.fillText(noteName(note), 4, y + g.rowH / 2);
        }
        if (pc === 0) { ctx.fillStyle = css('--line2'); ctx.fillRect(g.left, y + g.rowH - 1, w, 1); }
      }
    }
    // columns
    for (let s = this.scrollX; s < this.scrollX + g.visible + 1 && s <= MAX_STEPS; s++) {
      const x = this.xOf(g, s);
      if (s >= len) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x, HEADER, g.cw, hh); }
      ctx.fillStyle = s % 16 === 0 ? css('--line2') : s % 4 === 0 ? css('--line1') : css('--line0');
      ctx.fillRect(x, HEADER, 1, hh);
      if (s === ph) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, HEADER, g.cw, hh); }
      // header
      ctx.fillStyle = s === ph ? col : s < len ? css('--bg3') : css('--bg1');
      ctx.fillRect(x + 1, 0, g.cw - 1, HEADER - 2);
      if (s % 4 === 0 || g.cw > 22) {
        ctx.fillStyle = s === ph ? '#000' : css('--fg2'); ctx.font = '10px var(--font)'; ctx.textBaseline = 'middle';
        ctx.fillText(s % 16 === 0 ? `${s / 16 + 1}` : String(s + 1), x + 3, HEADER / 2);
      }
    }
    // step-record cursor
    if (store.recOn && !store.playing && store.armed === this.t) {
      const cx = this.xOf(g, (store.stepCursor || 0) % len);
      ctx.strokeStyle = css('--rec'); ctx.lineWidth = 2; ctx.strokeRect(cx + 1, 1, g.cw - 2, hh - 2);
    }
    // length handle
    const lx = this.xOf(g, len);
    ctx.fillStyle = col; ctx.fillRect(lx - 1, 0, 3, hh);
    ctx.fillRect(lx - 5, 0, 10, 6);
    if (!p) { this.drawHint(ctx, w, hh, 'Pattern vide — cliquez dans la grille pour poser des notes'); return; }
    // steps
    const sel = store.sel;
    if (this.drum) {
      for (let lane = 0; lane < 8; lane++) {
        const steps = p.lanes[lane] || [];
        for (let s = this.scrollX; s < Math.min(len, this.scrollX + g.visible + 1); s++) {
          const st = steps[s]; if (!st) continue;
          const x = this.xOf(g, s) + 2 + ((st.ndg || 0) / 64) * g.cw, y = HEADER + lane * g.rowH + 3;
          const cw = g.cw - 4, ch = g.rowH - 6;
          ctx.globalAlpha = st.lockOnly ? 0.25 : 0.35 + 0.65 * (st.v ?? 0.8);
          ctx.fillStyle = st.acc ? '#fff' : col;
          roundRect(ctx, x, y, cw, ch, 3); ctx.fill();
          ctx.globalAlpha = 1;
          this.decorate(ctx, st, x, y, cw, ch, sel.has(lane * 1000 + s));
        }
      }
    } else {
      const steps = p.lanes[0] || [];
      for (let s = 0; s < len; s++) {
        const st = steps[s]; if (!st || !st.n) continue;
        const sx = this.xOf(g, s + (st.ndg || 0) / 64);
        for (const n of st.n) {
          const r = this.topNote - n.p;
          const y = HEADER + r * g.rowH;
          if (y < HEADER - g.rowH || y > hh) continue;
          const wN = Math.max(4, n.l * g.cw - 2);
          if (sx + wN < g.left || sx > w) continue;
          ctx.globalAlpha = 0.45 + 0.55 * (n.v ?? 0.8);
          ctx.fillStyle = st.acc ? '#fff' : col;
          roundRect(ctx, sx + 1, y + 1, wN, g.rowH - 2, 3); ctx.fill();
          ctx.globalAlpha = 1;
          if (sel.has(s)) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; roundRect(ctx, sx + 1, y + 1, wN, g.rowH - 2, 3); ctx.stroke(); }
        }
        // step markers row under header
        this.decorate(ctx, st, this.xOf(g, s) + 1, HEADER, g.cw - 2, 0, false, true);
      }
    }
    // rubber band
    if (this.drag && this.drag.mode === 'band') {
      const d = this.drag;
      ctx.strokeStyle = '#fff'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.setLineDash([]);
    }
    if (store.lockMode && sel.size) { ctx.fillStyle = css('--warn'); ctx.font = '600 11px var(--font)'; ctx.fillText('P-LOCK : les potards écrivent dans les pas sélectionnés', g.left + 8, hh - 10); }
  }
  decorate(ctx, st, x, y, cw, ch, selected, top = false) {
    const marks = [];
    if (st.prob !== undefined && st.prob < 100) marks.push(st.prob + '%');
    if (st.cond && st.cond !== 'ALL') marks.push(st.cond);
    if (st.flam) marks.push('FL'); else if ((st.rat | 0) > 1) marks.push('x' + st.rat);
    if (st.lk && Object.keys(st.lk).length) marks.push('●');
    if (st.sl) marks.push('/');
    if (top) {
      if (!marks.length) return;
      ctx.fillStyle = css('--warn'); ctx.font = '9px var(--font)'; ctx.textBaseline = 'top';
      ctx.fillText(marks.join(' '), x + 1, y + 1);
      return;
    }
    if (selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; roundRect(ctx, x, y, cw, ch, 3); ctx.stroke(); }
    if (marks.length && cw > 14) {
      ctx.fillStyle = '#000'; ctx.font = '600 9px var(--font)'; ctx.textBaseline = 'top';
      ctx.fillText(marks.join(' '), x + 2, y + 2, cw - 3);
    }
  }
  drawHint(ctx, w, hh, text) {
    ctx.fillStyle = css('--fg2'); ctx.font = '13px var(--font)'; ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, hh / 2); ctx.textAlign = 'start';
  }

  // ------------------------------------------------------------------ hit testing
  noteAt(x, y) {
    const g = this.g, p = this.pat; if (!p) return null;
    const note = this.topNote - Math.floor((y - HEADER) / g.rowH);
    const fstep = (x - g.left) / g.cw + this.scrollX;
    const steps = p.lanes[0] || [];
    let best = null;
    for (let s = 0; s < p.length; s++) {
      const st = steps[s]; if (!st || !st.n) continue;
      const start = s + (st.ndg || 0) / 64;
      for (const n of st.n) {
        if (n.p !== note) continue;
        if (fstep >= start && fstep < start + Math.max(n.l, 0.25)) {
          if (!best || start > best.start) best = { s, n, st, start, edge: (start + n.l - fstep) * g.cw < 7 };
        }
      }
    }
    return best;
  }

  bind() {
    const cv = this.cv;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => this.down(e));
    cv.addEventListener('pointermove', (e) => this.move(e));
    cv.addEventListener('pointerup', (e) => this.up(e));
    cv.addEventListener('dblclick', (e) => this.dbl(e));
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) { const g = this.g; this.zoom = Math.max(8, Math.min(80, (this.zoom || g.cw) * (e.deltaY < 0 ? 1.15 : 0.87))); }
      else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.scrollX = Math.max(0, this.scrollX + Math.sign(e.deltaY || e.deltaX) * 4);
      else if (!this.drum) this.topNote = Math.max(12, Math.min(127, this.topNote - Math.sign(e.deltaY) * 3));
      this.dirty = true;
    }, { passive: false });
    cv.addEventListener('pointerleave', () => { this.hover = null; this.dirty = true; });
  }
  local(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  down(e) {
    this.cv.focus();
    const { x, y } = this.local(e);
    const g = this.g; if (!g) return;
    const store = this.store;
    const t = this.t;
    this.cv.setPointerCapture(e.pointerId);
    // header: length handle or column select
    if (y < HEADER) {
      const lx = this.xOf(g, this.len);
      if (Math.abs(x - lx) < 8) { store.pushUndo('longueur'); this.drag = { mode: 'length' }; return; }
      const s = this.stepAt(g, x);
      if (s >= 0 && s < this.len) {
        store.stepCursor = s;
        if (!e.shiftKey) store.sel.clear();
        const p = this.pat; if (p) p.lanes.forEach((ln, lane) => { if (ln[s]) store.sel.add(lane * 1000 + s); });
        store.emit('selection');
      }
      this.dirty = true; return;
    }
    if (x < g.left) {
      if (this.drum) {
        const lane = Math.floor((y - HEADER) / g.rowH);
        if (lane >= 0 && lane < 8 && (e.button === 2 || e.altKey)) {
          const mx = store.trackAt(t).mix; mx.lmute = (mx.lmute | 0) ^ (1 << lane); store.sendMix(t); store.markDirty(); this.dirty = true; return;
        }
        if (lane >= 0 && lane < 8) { store.lane = lane; store.liveNote(t, lane, 0.9, true, 'lane'); setTimeout(() => store.liveNote(t, lane, 0, false, 'lane'), 120); store.emit('lane'); }
      } else {
        const note = this.topNote - Math.floor((y - HEADER) / g.rowH);
        store.liveNote(t, note, 0.85, true); this.drag = { mode: 'key', note };
      }
      this.dirty = true; return;
    }
    const s = this.stepAt(g, x);
    if (e.shiftKey) { this.drag = { mode: 'band', x0: x, y0: y, x1: x, y1: y, add: e.ctrlKey }; return; }
    if (this.drum) {
      const lane = Math.floor((y - HEADER) / g.rowH);
      if (lane < 0 || lane > 7 || s < 0 || s >= this.len) return;
      store.lane = lane; store.emit('lane');
      const p = store.pattern(t, true);
      const st = p.lanes[lane][s];
      if (e.button === 2 || e.ctrlKey) {
        // select
        if (!e.ctrlKey) store.sel.clear();
        if (st) { const k = lane * 1000 + s; store.sel.has(k) && e.ctrlKey ? store.sel.delete(k) : store.sel.add(k); }
        store.emit('selection'); this.dirty = true; return;
      }
      store.pushUndo('pas');
      const turnOn = !st;
      this.drag = { mode: 'paint', lane, on: turnOn, done: new Set() };
      this.paintCell(lane, s, turnOn);
      return;
    }
    // melodic
    const hit = this.noteAt(x, y);
    if (e.button === 2) {
      if (hit) {
        store.editPattern(t, 'note', (p) => {
          const st = p.lanes[0][hit.s];
          st.n = st.n.filter((n) => n !== hit.n);
          if (!st.n.length) { p.lanes[0][hit.s] = undefined; store.sel.delete(hit.s); }
        });
      } else { store.sel.clear(); store.emit('selection'); }
      return;
    }
    if (hit) {
      if (!store.sel.has(hit.s)) { if (!e.ctrlKey) store.sel.clear(); store.sel.add(hit.s); store.emit('selection'); }
      store.pushUndo('note');
      this.drag = { mode: hit.edge ? 'resize' : 'move', hit, x0: x, y0: y, s0: hit.s, p0: hit.n.p, l0: hit.n.l, moved: false };
      if (store.settings.stepPreview) { store.liveNote(t, hit.n.p, hit.n.v, true); this.previewNote = hit.n.p; }
      this.dirty = true;
      return;
    }
    if (s < 0 || s >= this.len) return;
    const note = this.topNote - Math.floor((y - HEADER) / g.rowH);
    const p = store.pattern(t, true);
    const st0 = p.lanes[0][s];
    if (st0 && st0.n && st0.n.length >= 4) { store.toast('4 notes maximum par pas'); return; }
    store.pushUndo('note');
    let st = st0;
    if (!st) { st = newStep(false, note, 0.8); st.n = []; p.lanes[0][s] = st; }
    const n = { p: note, l: this.lastLen, v: 0.8 };
    st.n.push(n);
    store.sel.clear(); store.sel.add(s); store.emit('selection');
    store.sendPattern(t); store.markDirty();
    if (store.settings.stepPreview) { store.liveNote(t, note, 0.8, true); this.previewNote = note; }
    this.drag = { mode: 'resize', hit: { s, n, st }, x0: x, y0: y, l0: n.l, created: true };
    this.dirty = true;
    store.emit('pattern', t, store.track.cur);
  }
  paintCell(lane, s, on) {
    const store = this.store, t = this.t;
    const p = store.pattern(t, true);
    if (s < 0 || s >= p.length || this.drag.done.has(s)) return;
    this.drag.done.add(s);
    const st = p.lanes[lane][s];
    if (on && !st) {
      p.lanes[lane][s] = newStep(true, 0, 0.8);
      store.sel.clear(); store.sel.add(lane * 1000 + s); store.emit('selection');
      if (store.settings.stepPreview && !store.playing) { store.liveNote(t, lane, 0.8, true, 'lane'); setTimeout(() => store.liveNote(t, lane, 0, false, 'lane'), 80); }
    } else if (!on && st) { p.lanes[lane][s] = undefined; store.sel.delete(lane * 1000 + s); }
    store.sendPattern(t); store.markDirty(); this.dirty = true;
    store.emit('pattern', t, store.track.cur);
  }
  move(e) {
    const { x, y } = this.local(e);
    const g = this.g; if (!g) return;
    if (!this.drag) {
      if (!this.drum && x < g.left) { const note = this.topNote - Math.floor((y - HEADER) / g.rowH); if (!this.hover || this.hover.note !== note) { this.hover = { note }; this.dirty = true; } }
      else if (this.hover) { this.hover = null; this.dirty = true; }
      const hit = !this.drum && x >= g.left && y > HEADER ? this.noteAt(x, y) : null;
      this.cv.style.cursor = y < HEADER && Math.abs(x - this.xOf(g, this.len)) < 8 ? 'ew-resize' : hit ? (hit.edge ? 'ew-resize' : 'grab') : 'crosshair';
      return;
    }
    const d = this.drag, store = this.store, t = this.t;
    if (d.mode === 'length') {
      const s = Math.round((x - g.left) / g.cw + this.scrollX);
      const p = store.pattern(t, true);
      const nl = Math.max(1, Math.min(MAX_STEPS, s));
      if (nl !== p.length) { p.length = nl; store.sendPattern(t); store.emit('pattern', t, store.track.cur); this.dirty = true; }
      return;
    }
    if (d.mode === 'band') { d.x1 = x; d.y1 = y; this.dirty = true; return; }
    if (d.mode === 'paint') {
      const s = this.stepAt(g, x);
      this.paintCell(d.lane, s, d.on);
      return;
    }
    if (d.mode === 'key') return;
    const p = this.pat; if (!p) return;
    if (d.mode === 'resize') {
      const st = d.hit.st;
      const start = d.hit.s + (st.ndg || 0) / 64;
      let l = (x - this.xOf(g, start)) / g.cw;
      l = e.altKey ? Math.max(0.05, Math.round(l * 20) / 20) : Math.max(0.25, Math.round(l * 4) / 4);
      l = Math.min(128, l);
      if (l !== d.hit.n.l) { d.hit.n.l = l; this.lastLen = l; store.sendPattern(t); this.dirty = true; store.emit('pattern', t, store.track.cur); }
      return;
    }
    if (d.mode === 'move') {
      const ds = Math.round((x - d.x0) / g.cw);
      const dp = -Math.round((y - d.y0) / g.rowH);
      const ns = Math.max(0, Math.min(p.length - 1, d.s0 + ds));
      const np = Math.max(0, Math.min(127, d.p0 + dp));
      const cur = d.hit;
      if (np !== cur.n.p) {
        cur.n.p = np;
        if (store.settings.stepPreview) { if (this.previewNote !== undefined) store.liveNote(t, this.previewNote, 0, false); store.liveNote(t, np, cur.n.v, true); this.previewNote = np; }
      }
      if (ns !== cur.s) {
        const src = p.lanes[0][cur.s];
        let dst = p.lanes[0][ns];
        if (dst && dst.n.length >= 4) return;
        src.n = src.n.filter((n) => n !== cur.n);
        if (!dst) { dst = { ...src, n: [], lk: src.lk ? { ...src.lk } : null }; p.lanes[0][ns] = dst; }
        dst.n.push(cur.n);
        if (!src.n.length) p.lanes[0][cur.s] = undefined;
        store.sel.delete(cur.s); store.sel.add(ns);
        cur.s = ns; cur.st = dst;
      }
      d.moved = true;
      store.sendPattern(t); this.dirty = true; store.emit('pattern', t, store.track.cur);
    }
  }
  up(e) {
    const d = this.drag; this.drag = null;
    const store = this.store, t = this.t;
    if (this.previewNote !== undefined) { store.liveNote(t, this.previewNote, 0, false); this.previewNote = undefined; }
    if (!d) return;
    if (d.mode === 'key') store.liveNote(t, d.note, 0, false);
    if (d.mode === 'band') {
      const g = this.g, p = this.pat;
      if (!d.add) store.sel.clear();
      if (p) {
        const s0 = this.stepAt(g, Math.min(d.x0, d.x1)), s1 = this.stepAt(g, Math.max(d.x0, d.x1));
        if (this.drum) {
          const l0 = Math.floor((Math.min(d.y0, d.y1) - HEADER) / g.rowH), l1 = Math.floor((Math.max(d.y0, d.y1) - HEADER) / g.rowH);
          for (let lane = Math.max(0, l0); lane <= Math.min(7, l1); lane++) for (let s = Math.max(0, s0); s <= Math.min(p.length - 1, s1); s++) if (p.lanes[lane][s]) store.sel.add(lane * 1000 + s);
        } else {
          for (let s = Math.max(0, s0); s <= Math.min(p.length - 1, s1); s++) if (p.lanes[0][s]) store.sel.add(s);
        }
      }
      store.emit('selection');
    }
    if (d.mode === 'length') store.markDirty();
    this.dirty = true;
  }
  dbl(e) {
    if (this.drum) return;
    const { x, y } = this.local(e);
    const hit = this.noteAt(x, y);
    if (!hit) return;
    this.store.editPattern(this.t, 'note', (p) => {
      const st = p.lanes[0][hit.s]; if (!st) return;
      st.n = st.n.filter((n) => n.p !== hit.n.p);
      if (!st.n.length) p.lanes[0][hit.s] = undefined;
    });
  }
}

function roundRect(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + hh - r); ctx.quadraticCurveTo(x + w, y + hh, x + w - r, y + hh);
  ctx.lineTo(x + r, y + hh); ctx.quadraticCurveTo(x, y + hh, x, y + hh - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// ------------------------------------------------------------------ lane editor (per-step properties)
export const LANE_PROPS = [
  { id: 'vel', label: 'VÉLOCITÉ', min: 0, max: 1, def: 0.8 },
  { id: 'prob', label: 'PROBABILITÉ', min: 0, max: 100, def: 100 },
  { id: 'cond', label: 'CONDITION', min: 0, max: CONDITIONS.length - 1, def: 0 },
  { id: 'rat', label: 'RATCHET / FLAM', min: 1, max: 5, def: 1 },
  { id: 'ndg', label: 'NUDGE (micro-timing)', min: -32, max: 31, def: 0, bip: true },
  { id: 'acc', label: 'ACCENT', min: 0, max: 1, def: 0, bool: true },
  { id: 'sl', label: 'SLIDE', min: 0, max: 1, def: 0, bool: true, melodic: true },
  { id: 'len', label: 'LONGUEUR NOTE', min: 0.25, max: 16, def: 1, melodic: true },
];

export class LaneEditor {
  constructor(store, grid) {
    this.store = store; this.grid = grid;
    this.prop = 'vel'; this.lockId = null;
    this.sel = h('select', { onchange: () => { const v = this.sel.value; if (v.startsWith('lk:')) { this.prop = 'lock'; this.lockId = v.slice(3); } else { this.prop = v; this.lockId = null; } this.dirty = true; } });
    this.cv = h('canvas', { class: 'lane-canvas' });
    this.el = h('div', { class: 'lane-wrap' }, h('div', { class: 'lane-head' }, this.sel, h('span', { class: 'hint' }, 'glisser = peindre · clic droit = défaut · s\'applique à toute la sélection')), h('div', { class: 'lane-body' }, this.cv));
    this.dirty = true;
    this.rebuildOptions();
    this.bind();
    new ResizeObserver(() => (this.dirty = true)).observe(this.cv);
    const raf = () => { if (this.dirty && this.el.isConnected) this.draw(); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  invalidate() { this.dirty = true; }
  rebuildOptions() {
    const store = this.store, tr = store.track;
    const drum = tr.kind === 'drum';
    const cur = this.prop === 'lock' ? 'lk:' + this.lockId : this.prop;
    while (this.sel.firstChild) this.sel.firstChild.remove();
    for (const p of LANE_PROPS) if (!(p.melodic && drum)) this.sel.append(h('option', { value: p.id }, p.label));
    const og = h('optgroup', { label: 'P-LOCKS' });
    const defs = soundParamDefs(tr.kind, tr.sound.engine).filter((d) => !d.options || d.options.length > 2);
    const filtered = drum ? defs.filter((d) => !/^l\d/.test(d.id) || d.id.startsWith(`l${store.lane}`)) : defs;
    for (const d of filtered) og.append(h('option', { value: 'lk:' + d.id }, 'LOCK ' + d.label));
    this.sel.append(og);
    this.sel.value = cur;
    if (this.sel.value !== cur) { this.sel.value = 'vel'; this.prop = 'vel'; this.lockId = null; }
  }
  propDef() {
    if (this.prop === 'lock') { const tr = this.store.track; const d = paramDef(tr.kind, tr.sound.engine, this.lockId); return d && { ...d, lock: true }; }
    return LANE_PROPS.find((p) => p.id === this.prop);
  }
  getV(st, d) {
    if (d.lock) return st.lk && st.lk[d.id] !== undefined ? st.lk[d.id] : null;
    switch (d.id) {
      case 'vel': return st.n ? (st.n.length ? st.n.reduce((a, n) => a + (n.v ?? 0.8), 0) / st.n.length : 0.8) : st.v ?? 0.8;
      case 'prob': return st.prob ?? 100;
      case 'cond': return Math.max(0, CONDITIONS.findIndex((c) => c.id === (st.cond || 'ALL')));
      case 'rat': return st.flam ? 5 : st.rat || 1;
      case 'ndg': return st.ndg || 0;
      case 'acc': return st.acc ? 1 : 0;
      case 'sl': return st.sl ? 1 : 0;
      case 'len': return st.n && st.n.length ? Math.max(...st.n.map((n) => n.l)) : 1;
    }
  }
  setV(st, d, v) {
    if (d.lock) { if (v === null) { if (st.lk) { delete st.lk[d.id]; if (!Object.keys(st.lk).length) st.lk = null; } } else { st.lk = st.lk || {}; st.lk[d.id] = v; } return; }
    switch (d.id) {
      case 'vel': if (st.n) st.n.forEach((n) => (n.v = v)); else st.v = v; break;
      case 'prob': st.prob = Math.round(v); break;
      case 'cond': st.cond = CONDITIONS[Math.round(v)].id; break;
      case 'rat': { const r = Math.round(v); st.flam = r === 5; st.rat = r === 5 ? 1 : r; break; }
      case 'ndg': st.ndg = Math.round(v); break;
      case 'acc': st.acc = v >= 0.5; break;
      case 'sl': st.sl = v >= 0.5; break;
      case 'len': if (st.n) st.n.forEach((n) => (n.l = Math.round(v * 4) / 4 || 0.25)); break;
    }
  }
  norm(d, v) {
    if (d.lock) return toNorm(d, v);
    if (d.id === 'len') return Math.log(v / 0.25) / Math.log(64);
    return (v - d.min) / (d.max - d.min);
  }
  denorm(d, n) {
    n = Math.max(0, Math.min(1, n));
    if (d.lock) return fromNorm(d, n);
    if (d.id === 'len') return 0.25 * Math.pow(64, n);
    let v = d.min + n * (d.max - d.min);
    if (d.id !== 'vel') v = Math.round(v);
    return v;
  }
  laneIdx() { return this.store.isDrum(this.store.selTrack) ? this.store.lane : 0; }
  draw() {
    this.dirty = false;
    const { ctx, w, h: hh } = fitCanvas(this.cv);
    const g = this.grid.g; if (!g) { this.dirty = true; return; }
    const store = this.store, p = store.pattern(store.selTrack), d = this.propDef();
    ctx.fillStyle = css('--bg0'); ctx.fillRect(0, 0, w, hh);
    if (!p || !d) return;
    const col = store.track.color;
    const lane = p.lanes[this.laneIdx()] || [];
    const top = 4, bh = hh - 8;
    if (d.bip) { ctx.fillStyle = css('--line1'); ctx.fillRect(g.left, top + bh / 2, w, 1); }
    for (let s = this.grid.scrollX; s < Math.min(p.length, this.grid.scrollX + g.visible + 1); s++) {
      const x = this.grid.xOf(g, s);
      ctx.fillStyle = s % 4 === 0 ? css('--line1') : css('--line0'); ctx.fillRect(x, 0, 1, hh);
      const st = lane[s]; if (!st) continue;
      const v = this.getV(st, d);
      const sel = store.sel.has(this.laneIdx() * 1000 + s);
      if (v === null) { ctx.fillStyle = css('--line2'); ctx.fillRect(x + 3, top + bh - 3, g.cw - 6, 3); continue; }
      const n = Math.max(0, Math.min(1, this.norm(d, v)));
      ctx.fillStyle = sel ? '#fff' : col;
      if (d.bip) { const y0 = top + bh / 2, y1 = top + bh * (1 - n); ctx.fillRect(x + 3, Math.min(y0, y1), g.cw - 6, Math.max(2, Math.abs(y1 - y0))); }
      else ctx.fillRect(x + 3, top + bh * (1 - n), g.cw - 6, Math.max(2, bh * n));
      if (g.cw > 26 && (d.id === 'cond' || d.id === 'rat' || d.lock || d.id === 'prob')) {
        const txt = d.id === 'cond' ? CONDITIONS[v].id : d.id === 'rat' ? (v === 5 ? 'FL' : 'x' + v) : d.lock ? formatParam(d, v) : v + '%';
        ctx.fillStyle = css('--fg1'); ctx.font = '9px var(--font)'; ctx.textBaseline = 'top'; ctx.fillText(txt, x + 3, top, g.cw - 4);
      }
    }
    ctx.fillStyle = css('--fg2'); ctx.font = '10px var(--font)'; ctx.textBaseline = 'top';
    if (store.isDrum(store.selTrack)) ctx.fillText(`L${store.lane + 1}`, 6, 6);
  }
  bind() {
    const cv = this.cv;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    let painting = false, right = false;
    const apply = (e) => {
      const g = this.grid.g; const store = this.store; const d = this.propDef(); if (!g || !d) return;
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const s = this.grid.stepAt(g, x);
      const p = store.pattern(store.selTrack); if (!p || s < 0 || s >= p.length) return;
      const st = (p.lanes[this.laneIdx()] || [])[s]; if (!st) return;
      const n = 1 - (y - 4) / (r.height - 8);
      const v = right ? (d.lock ? null : d.def) : this.denorm(d, d.bool ? (n > 0.5 ? 1 : 0) : n);
      // apply to the whole selection if this step is selected
      const key = this.laneIdx() * 1000 + s;
      const targets = store.sel.has(key) && store.sel.size > 1 ? [...store.sel] : [key];
      for (const k of targets) { const ts = p.lanes[Math.floor(k / 1000)][k % 1000]; if (ts) this.setV(ts, d, v); }
      store.sendPattern(store.selTrack); store.markDirty();
      this.dirty = true; this.grid.invalidate(); store.emit('steps');
    };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); painting = true; right = e.button === 2; this.store.pushUndo('pas'); apply(e); });
    cv.addEventListener('pointermove', (e) => painting && apply(e));
    cv.addEventListener('pointerup', () => (painting = false));
  }
}
