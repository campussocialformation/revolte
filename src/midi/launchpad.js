// Revolte — Novation Launchpad Mini driver (MK3 in Programmer mode, Launchpad X, and the older Mini MK1/MK2)
//
// Four modes, chosen with the top buttons:
//   SESSION : columns = tracks 1-8, rows = patterns A-H (▲▼ : I-P), right column = scenes
//   STEPS   : step sequencer of the selected track (drums: 8 lanes x 8 steps, melodic: 64 steps), ◀▶ = page
//   KEYS    : play the selected track (scale grid, or the 8 drum lanes)
//   MIXER   : mutes, solos, select, arm, throws, FILL and the 14 performance FX
// In STEPS / KEYS / MIXER the right column selects the track.
import { newStep } from '../shared/model.js';
import { SCALES } from '../shared/params.js';

export const LP_MODES = ['SESSION', 'STEPS', 'KEYS', 'MIXER'];

// colour palette (MK3 / X): index of a bright colour; +2 is a dimmer shade of the same hue
const TRACK_COL = [57, 9, 13, 17, 33, 41, 49, 53];
const C = { off: 0, dim: 1, white: 3, red: 5, redDim: 7, orange: 9, yellow: 13, green: 21, greenDim: 23, cyan: 37, blue: 45, blueDim: 47, purple: 49 };

// legacy Mini MK1/MK2: velocity = 16*green + red + 12 (flags)
const LEG = { off: 12, redL: 13, red: 15, greenL: 28, green: 60, amberL: 29, amber: 63, yellow: 62 };
function legacyColour(col) {
  if (!col) return LEG.off;
  if (col === C.dim || col === C.redDim || col === C.greenDim || col === C.blueDim) return col === C.redDim ? LEG.redL : LEG.greenL;
  if (col === C.red) return LEG.red;
  if (col === C.green || col === C.cyan) return LEG.green;
  if (col === C.white || col === C.yellow) return LEG.yellow;
  if (TRACK_COL.map((x) => x + 2).includes(col)) return LEG.amberL;
  return LEG.amber;
}

export function lpKind(name) {
  const n = (name || '').toLowerCase();
  if (/launchkey|lkmk/.test(n)) return null;
  if (/lpminimk3|launchpad mini mk3/.test(n)) return { dev: 0x0d, legacy: false };
  if (/lpx|launchpad x/.test(n)) return { dev: 0x0c, legacy: false };
  if (/launchpad/.test(n)) return { dev: 0, legacy: true };
  return null;
}

export class LaunchpadDriver {
  constructor(mgr) {
    this.mgr = mgr; this.store = mgr.store;
    this.mode = this.store.settings.lpMode || 'SESSION';
    this.patPage = 0; this.stepPage = 0; this.follow = true; this.keyOct = 3;
    this.cache = new Map();
    this.held = new Map(); // pad -> release action
  }
  get s() { return this.store; }

  // ------------------------------------------------------------------ device setup
  hello(port, kind) {
    this.cache.clear();
    if (kind.legacy) { try { port.send([0xb0, 0x00, 0x00]); } catch { } return; } // reset
    // Programmer mode (needs SysEx)
    try { port.send([0xf0, 0x00, 0x20, 0x29, 0x02, kind.dev, 0x0e, 0x01, 0xf7]); } catch (e) {
      this.store.toast('Launchpad : le mode Programmer a besoin de la permission SysEx (' + e.message + ')', 'error');
    }
  }
  goodbye(port, kind) {
    if (kind.legacy) { try { port.send([0xb0, 0x00, 0x00]); } catch { } return; }
    try { port.send([0xf0, 0x00, 0x20, 0x29, 0x02, kind.dev, 0x0e, 0x00, 0xf7]); } catch { }
  }

  // ------------------------------------------------------------------ input
  // normalised events: {kind:'grid', x, y (0 = bottom row)} | {kind:'top', i (0-7)} | {kind:'side', y (0 = bottom)}
  decode(type, ch, d1, d2, legacy) {
    const on = (type === 'on') || (type === 'cc' && d2 > 0);
    if (legacy) {
      if (type === 'cc' && d1 >= 104 && d1 <= 111) return { kind: 'top', i: d1 - 104, on };
      if (type === 'on' || type === 'off') {
        const r = d1 >> 4, c = d1 & 15;
        if (r > 7) return null;
        if (c === 8) return { kind: 'side', y: 7 - r, on };
        if (c < 8) return { kind: 'grid', x: c, y: 7 - r, on };
      }
      return null;
    }
    if (type === 'cc') {
      if (d1 >= 91 && d1 <= 98) return { kind: 'top', i: d1 - 91, on };
      if (d1 % 10 === 9 && d1 >= 19 && d1 <= 89) return { kind: 'side', y: (d1 - 19) / 10, on };
      return null;
    }
    if (type === 'on' || type === 'off') {
      const r = Math.floor(d1 / 10), c = d1 % 10;
      if (r >= 1 && r <= 8 && c >= 1 && c <= 8) return { kind: 'grid', x: c - 1, y: r - 1, on };
      if (c === 9 && r >= 1 && r <= 8) return { kind: 'side', y: r - 1, on };
    }
    return null;
  }

  handle(ev) {
    if (!ev) return;
    const s = this.s;
    const key = ev.kind + (ev.x ?? '') + ':' + (ev.y ?? ev.i);
    if (!ev.on) { const rel = this.held.get(key); if (rel) { this.held.delete(key); rel(); } this.mgr.refreshLeds(true); return; }
    if (ev.kind === 'top') { this.top(ev.i); this.mgr.refreshLeds(true); return; }
    if (ev.kind === 'side') {
      const row = 7 - ev.y;
      if (this.mode === 'SESSION') s.launchScene(this.patPage * 8 + row);
      else s.selectTrack(row);
      this.mgr.refreshLeds(true); return;
    }
    const { x, y } = ev;
    const row = 7 - y; // 0 = top row
    switch (this.mode) {
      case 'SESSION': {
        const slot = this.patPage * 8 + row;
        s.launch(x, slot, s.playing ? s.song.launchQuant : 'NOW');
        break;
      }
      case 'STEPS': this.toggleStep(x, row); break;
      case 'KEYS': {
        const t = s.selTrack;
        if (s.isDrum(t)) {
          if (y > 1) return;
          s.liveNote(t, x, 0.9, true, 'lane');
          this.held.set(key, () => s.liveNote(t, x, 0, false, 'lane'));
        } else {
          const n = this.keyNote(x, y);
          this.mgr.lastNote = n;
          s.liveNote(t, n, 0.85, true);
          this.held.set(key, () => s.liveNote(t, n, 0, false));
        }
        break;
      }
      case 'MIXER': this.mixer(x, row, key); break;
    }
    this.mgr.refreshLeds(true);
  }

  top(i) {
    const s = this.s;
    // ▲ ▼ ◀ ▶  then the four mode buttons
    if (i === 0 || i === 1) {
      const d = i === 0 ? -1 : 1;
      if (this.mode === 'KEYS') this.keyOct = Math.max(0, Math.min(7, this.keyOct - d));
      else if (this.mode === 'STEPS') s.selectTrack(Math.max(0, Math.min(7, s.selTrack + d)));
      else this.patPage = d > 0 ? 1 : 0;
      if (this.mode === 'SESSION') s.toast(this.patPage ? 'Launchpad : patterns I–P · scènes 9–16' : 'Launchpad : patterns A–H · scènes 1–8');
      return;
    }
    if (i === 2 || i === 3) {
      const p = s.pattern(s.selTrack);
      const per = s.isDrum(s.selTrack) ? 8 : 64;
      const pages = Math.max(1, Math.ceil((p ? p.length : 16) / per));
      this.follow = false;
      this.stepPage = Math.max(0, Math.min(pages - 1, this.stepPage + (i === 2 ? -1 : 1)));
      return;
    }
    const m = LP_MODES[i - 4];
    if (m) {
      if (m === 'STEPS') this.follow = true;
      this.mode = m; s.settings.lpMode = m;
      s.toast('Launchpad : ' + m);
      this.mgr.changed();
    }
  }

  stepsLayout(t) {
    const s = this.s, p = s.pattern(t);
    const drum = s.isDrum(t);
    const per = drum ? 8 : 64;
    const len = p ? p.length : 16;
    let page = this.stepPage;
    if (this.follow && s.playing && s.pos) page = Math.floor(s.pos.tracks[t].step / per);
    page = Math.min(page, Math.max(0, Math.ceil(len / per) - 1));
    return { drum, per, len, page, p };
  }
  toggleStep(x, row) {
    const s = this.s, t = s.selTrack;
    const L = this.stepsLayout(t);
    const lane = L.drum ? row : 0;
    const idx = L.drum ? L.page * 8 + x : L.page * 64 + row * 8 + x;
    if (idx >= L.len) return;
    if (L.drum) s.lane = lane;
    s.editPattern(t, 'pas', (p) => {
      if (p.lanes[lane][idx]) p.lanes[lane][idx] = undefined;
      else p.lanes[lane][idx] = newStep(L.drum, this.mgr.lastNote ?? (s.track.kind === 'bass' ? 36 : 60), 0.8);
    });
  }
  keyNote(x, y) {
    const sc = this.s.song.scale;
    const steps = (SCALES.find((q) => q.id === sc.id) || SCALES[2]).steps;
    const deg = x + 3 * y; // each row a fourth up (3 scale degrees)
    const n = steps.length;
    return 12 * (this.keyOct + 1) + sc.root + steps[deg % n] + 12 * Math.floor(deg / n);
  }
  mixer(x, row, key) {
    const s = this.s;
    switch (row) {
      case 0: s.toggleMute(x); break;
      case 1: s.toggleSolo(x); break;
      case 2: s.selectTrack(x); break;
      case 3: s.arm(x); break;
      case 4: {
        const th = ['cut', 'rev', 'dly', 'dist'];
        if (x < 4) { s.throwFx(th[x], true); this.held.set(key, () => s.throwFx(th[x], false)); }
        else if (x === 4) { s.setFill(true); this.held.set(key, () => s.setFill(false)); }
        else if (x === 7) s.togglePlay();
        break;
      }
      case 6: case 7: {
        const fx = row === 7 ? x : 8 + x; // bottom row FX 1-8, the row above FX 9-14
        if (fx < 14) { s.perf(fx, true); this.held.set(key, () => s.perf(fx, false)); }
        break;
      }
    }
  }

  // ------------------------------------------------------------------ LEDs: returns [{kind,x,y,i,col,anim}]
  frame() {
    const s = this.s, out = [];
    const grid = (x, y, col, anim = 0) => out.push({ kind: 'grid', x, y, col, anim });
    const pos = s.pos;
    // top buttons
    for (let i = 0; i < 8; i++) {
      let col = C.dim;
      if (i >= 4) col = LP_MODES[i - 4] === this.mode ? C.white : C.dim;
      if (i < 2 && this.mode === 'SESSION') col = (i === 1) === (this.patPage === 1) ? C.cyan : C.dim;
      out.push({ kind: 'top', i, col });
    }
    for (let y = 0; y < 8; y++) {
      const row = 7 - y;
      let col = C.off;
      if (this.mode === 'SESSION') { const sc = s.song.scenes[this.patPage * 8 + row]; col = sc ? (s.lastScene === this.patPage * 8 + row ? C.green : C.blue) : C.off; }
      else col = s.selTrack === row ? C.white : TRACK_COL[row] + 2;
      out.push({ kind: 'side', y, col });
    }
    if (this.mode === 'SESSION') {
      for (let x = 0; x < 8; x++) {
        const tr = s.song.tracks[x], tp = pos && pos.tracks[x];
        for (let y = 0; y < 8; y++) {
          const slot = this.patPage * 8 + (7 - y);
          let col = tr.patterns[slot] ? TRACK_COL[x] + 2 : C.off, anim = 0;
          if (tr.cur === slot && !(tp && tp.rest)) { col = tr.mix.mute ? C.redDim : TRACK_COL[x]; anim = s.playing && !tr.mix.mute ? 2 : 0; }
          if (tp && tp.pend === slot) { col = C.white; anim = 1; }
          grid(x, y, col, anim);
        }
      }
    } else if (this.mode === 'STEPS') {
      const t = s.selTrack, L = this.stepsLayout(t);
      const ph = s.playing && pos ? pos.tracks[t].step : -1;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const row = 7 - y;
        const lane = L.drum ? row : 0;
        const idx = L.drum ? L.page * 8 + x : L.page * 64 + row * 8 + x;
        let col = C.off;
        if (idx < L.len) {
          const st = L.p && L.p.lanes[lane] && L.p.lanes[lane][idx];
          col = st ? (st.acc ? C.white : TRACK_COL[t]) : (L.drum && lane === s.lane ? C.dim : (idx % 4 === 0 ? C.dim : C.off));
          if (idx === ph) col = st ? C.white : C.greenDim;
        }
        grid(x, y, col);
      }
    } else if (this.mode === 'KEYS') {
      const t = s.selTrack;
      if (s.isDrum(t)) {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) grid(x, y, y < 2 ? (y === 0 ? TRACK_COL[t] : TRACK_COL[t] + 2) : C.off);
      } else {
        const root = s.song.scale.root;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const n = this.keyNote(x, y);
          grid(x, y, ((n - root) % 12 + 12) % 12 === 0 ? TRACK_COL[t] : C.dim);
        }
      }
    } else {
      for (let x = 0; x < 8; x++) {
        const tr = s.song.tracks[x];
        grid(x, 7, tr.mix.mute ? C.red : TRACK_COL[x]);
        grid(x, 6, tr.mix.solo ? C.blue : C.blueDim);
        grid(x, 5, s.selTrack === x ? C.white : TRACK_COL[x] + 2);
        grid(x, 4, s.armed === x ? C.red : C.redDim);
        grid(x, 3, x < 4 ? C.cyan : x === 4 ? (s.fill ? C.yellow : C.orange) : x === 7 ? (s.playing ? C.green : C.greenDim) : C.off);
        grid(x, 2, C.off);
        grid(x, 1, x < 6 ? (this.mgr.fxOn.has(8 + x) ? C.red : C.orange + 2) : C.off);
        grid(x, 0, this.mgr.fxOn.has(x) ? C.red : C.orange + 2);
      }
    }
    return out;
  }

  // send changed LEDs to a port
  paint(port, kind) {
    for (const l of this.frame()) {
      let status, num;
      if (kind.legacy) {
        if (l.kind === 'top') { status = 0xb0; num = 104 + l.i; }
        else if (l.kind === 'side') { status = 0x90; num = (7 - l.y) * 16 + 8; }
        else { status = 0x90; num = (7 - l.y) * 16 + l.x; }
        const v = legacyColour(l.col);
        const k = port.id + num + status;
        if (this.cache.get(k) === v) continue;
        this.cache.set(k, v);
        try { port.send([status, num, v]); } catch { }
        continue;
      }
      if (l.kind === 'top') { status = 0xb0; num = 91 + l.i; }
      else if (l.kind === 'side') { status = 0xb0; num = 19 + 10 * l.y; }
      else { status = 0x90; num = 11 + 10 * l.y + l.x; }
      const anim = l.anim || 0;
      const v = anim * 1000 + l.col;
      const k = port.id + ':' + num;
      if (this.cache.get(k) === v) continue;
      this.cache.set(k, v);
      try {
        if (anim) { port.send([status, num, 0]); port.send([status + anim, num, l.col]); }
        else port.send([status, num, l.col]);
      } catch { }
    }
  }
}
