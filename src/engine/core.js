// Revolte — engine core: tracks, sequencer, mixer, effects. Runs inside the AudioWorklet
// (and in Node for tests). Pure JS, no Web Audio dependency.
import { MelodicSynth } from './synth.js';
import { DrumKit } from './drums.js';
import { ChorusFx, DelayFx, ReverbFx, PerfFx, MasterChain } from './fx.js';
import { OnePole, shape, clamp, rng, fsin } from './dsp.js';
import { resBeats, CONDITIONS, ARP_RATES, NUM_TRACKS, MAX_STEPS, LAUNCH_QUANT, FX_PARAMS, defaultParams } from '../shared/params.js';

const BLOCK = 128;
const ARP_BEATS = { '1/4': 1, '1/8': 0.5, '1/8T': 1 / 3, '1/16': 0.25, '1/16T': 1 / 6, '1/32': 0.125 };
const COND_IDX = new Map(CONDITIONS.map((c, i) => [c.id, c]));

function emptyPattern(isDrum) {
  return { length: 16, res: '1/16', swing: 50, dir: 'FWD', gate: 100, lanes: isDrum ? Array.from({ length: 8 }, () => []) : [[]] };
}

class Track {
  constructor(engine, idx) {
    this.e = engine; this.idx = idx;
    this.kind = 'synth'; this.isDrum = false;
    this.synth = new MelodicSynth(engine.sr, 8);
    this.kit = new DrumKit(engine.sr);
    this.engineName = 'ANALOG';
    this.base = {}; this.lock = new Map(); this.eff = {}; this.laneLockKeys = Array.from({ length: 8 }, () => []);
    this.mix = { vol: 0.8, pan: 0, cho: 0, dly: 0, rev: 0, dtype: 0, damt: 0.3, dtone: 0.6, duck: 0, dsrc: 5, drel: 180 };
    this.play = { arp: 0, arate: 3, aoct: 1, agate: 0.5, achance: 1, ahold: 0, chord: 0, voicing: 0, strum: 0, squant: 0, transp: 0 };
    this.patterns = []; this.list = []; this.cur = 0;
    this.L = new Float32Array(BLOCK); this.R = new Float32Array(BLOCK);
    this.mute = false; this.solo = false; this.cut = false; this.gain = 0;
    this.pendingLaunch = null; this.pendingMute = null;
    this.reset();
    this.toneL = new OnePole(); this.toneR = new OnePole();
    this.duckEnv = 0; this.peak = 0;
    this.arpHeld = []; this.arpNext = -1; this.arpIdx = 0; this.arpDir = 1; this.physDown = 0;
    this.armed = false;
    this.recHeld = new Map();
    this.liveLog = [];
    this.lastStep = 0; this.lastPatStep = 0;
    this.slideUntil = -1e9;
    this.preResult = true;
  }
  reset() {
    this.k = 0; this.startBeat = 0; this.queue = [];
    this.entry = 0; this.entryPass = 0; this.rest = false; this.done = false;
    this.skip = new Set();
    this.pingDir = 1; this.randIdx = 0;
  }
  get pattern() {
    if (this.rest) return this._restPat || (this._restPat = emptyPattern(this.isDrum));
    return this.patterns[this.cur] || (this._empty || (this._empty = emptyPattern(this.isDrum)));
  }
  setSound(kind, sound) {
    this.kind = kind; this.isDrum = kind === 'drum';
    this.engineName = sound.engine || 'ANALOG';
    this.base = { ...sound.params };
    this.rebuildEff();
    if (this.isDrum) this.kit.setParams(this.eff);
    else this.synth.setParams(this.eff, this.engineName);
    this.sampleId = sound.sample || null;
    this.synth.sample = this.sampleId ? this.e.samples.get(this.sampleId) || null : null;
    this.laneSampleIds = sound.laneSamples || [];
    for (let i = 0; i < 8; i++) {
      const id = this.laneSampleIds[i];
      this.kit.laneSamples[i] = id ? this.e.samples.get(id) || null : null;
    }
  }
  rebuildEff() {
    const eff = this.eff;
    for (const k in this.base) eff[k] = this.base[k];
    for (const [k, v] of this.lock) eff[k] = v;
  }
  setParam(id, v) {
    this.base[id] = v;
    if (!this.lock.has(id)) this.eff[id] = v;
    if (id === 'ftype' || id === 'mode') this.synth.allOff();
  }
  applyLocks(lane, locks) {
    const keys = this.laneLockKeys[lane];
    let changed = false;
    if (keys.length) { for (const k of keys) this.lock.delete(k); keys.length = 0; changed = true; }
    if (locks) for (const k in locks) { this.lock.set(k, locks[k]); keys.push(k); changed = true; }
    if (changed) this.rebuildEff();
  }
  push(ev) {
    const q = this.queue;
    let i = q.length;
    while (i > 0 && q[i - 1].t > ev.t) i--;
    q.splice(i, 0, ev);
  }
}

export class Engine {
  constructor(sr) {
    this.sr = sr;
    this.samples = new Map();
    this.tracks = [];
    for (let i = 0; i < NUM_TRACKS; i++) this.tracks.push(new Track(this, i));
    this.bpm = 120; this.beat = 0; this.playing = false;
    this.songMode = 0; this.fill = false;
    this.fx = defaultParams(FX_PARAMS);
    this.loaded = false;
    this.chorus = new ChorusFx(sr); this.delay = new DelayFx(sr); this.reverb = new ReverbFx(sr);
    this.perf = new PerfFx(sr); this.master = new MasterChain(sr);
    this.bus = { L: new Float32Array(BLOCK), R: new Float32Array(BLOCK) };
    this.sends = [0, 1, 2].map(() => ({ L: new Float32Array(BLOCK), R: new Float32Array(BLOCK) }));
    this.ret = { L: new Float32Array(BLOCK), R: new Float32Array(BLOCK) };
    this.events = []; // outgoing messages
    this.blockCount = 0;
    this.rec = { on: false, quantize: true, countIn: true, click: true, clickAlways: false, overdub: true };
    this.click = { ph: 0, env: 0, f: 1000 };
    this.throws = { cut: 0, rev: 0, dly: 0, dist: 0 };
    this.throwHeld = { cut: false, rev: false, dly: false, dist: false };
    this.throwLatch = { cut: false, rev: false, dly: false, dist: false };
    this.cpu = 0;
    this.out = null;
  }

  post(msg) { this.events.push(msg); }

  // ------------------------------------------------------------------ messages
  handle(m) {
    switch (m.type) {
      case 'song': this.loadSong(m.song); break;
      case 'sample': {
        this.samples.set(m.id, { ch: m.ch, sr: m.sr, len: m.ch[0].length });
        for (const t of this.tracks) {
          if (t.sampleId === m.id) t.synth.sample = this.samples.get(m.id);
          for (let i = 0; i < 8; i++) if (t.laneSampleIds && t.laneSampleIds[i] === m.id) t.kit.laneSamples[i] = this.samples.get(m.id);
        }
        break;
      }
      case 'sound': { const t = this.tracks[m.t]; t.setSound(m.kind || t.kind, m.sound); break; }
      case 'param': {
        const t = this.tracks[m.t];
        if (m.rec && this.playing && t.armed && this.rec.on) this.recordLock(t, m.id, m.v);
        else t.setParam(m.id, m.v);
        break;
      }
      case 'mix': Object.assign(this.tracks[m.t].mix, m.mix); break;
      case 'play': Object.assign(this.tracks[m.t].play, m.play); if (!this.tracks[m.t].play.arp) this.arpClear(this.tracks[m.t]); break;
      case 'pattern': {
        const t = this.tracks[m.t]; t.patterns[m.slot] = m.pattern;
        break;
      }
      case 'patterns': this.tracks[m.t].patterns = m.patterns; break;
      case 'list': this.tracks[m.t].list = m.list; break;
      case 'fx': Object.assign(this.fx, m.fx); break;
      case 'bpm': this.bpm = clamp(m.bpm, 30, 300); break;
      case 'songMode': this.songMode = m.mode; break;
      case 'transport': this.transport(m.cmd, m); break;
      case 'launch': this.launch(m.t, m.slot, m.quant); break;
      case 'scene': this.scene(m.scene, m.quant); break;
      case 'mute': this.setMute(m.t, m.on, m.quant); break;
      case 'solo': this.tracks[m.t].solo = m.on; break;
      case 'cut': this.tracks[m.t].cut = m.on; break;
      case 'note': this.liveNote(m); break;
      case 'allNotesOff': for (const t of this.tracks) { t.synth.allOff(); t.kit.allOff(); this.arpClear(t); } break;
      case 'perf': this.perf.set(m.fx, m.on); if (m.fx === 11) this.dub = m.on; if (m.fx === 7) this.reverb.freeze = m.on && false; break;
      case 'throw': {
        this.throwHeld[m.which] = m.on;
        if (m.latch !== undefined) this.throwLatch[m.which] = m.latch;
        break;
      }
      case 'fill': this.fill = m.on; break;
      case 'arm': for (const t of this.tracks) t.armed = false; if (m.t >= 0) this.tracks[m.t].armed = true; break;
      case 'rec': Object.assign(this.rec, m.rec); break;
      case 'modw': this.tracks[m.t].synth.modw = m.v; break;
      case 'take': this.take(m.t); break;
      case 'locate': this.locate(m); break;
    }
  }

  loadSong(song) {
    this.bpm = song.bpm || 120;
    this.songMode = song.songMode || 0;
    this.fx = { ...defaultParams(FX_PARAMS), ...song.fx };
    this.loaded = true;
    song.tracks.forEach((ts, i) => {
      const t = this.tracks[i];
      t.setSound(ts.kind, ts.sound);
      t.mix = { ...t.mix, ...ts.mix };
      t.play = { ...t.play, ...ts.play };
      t.patterns = ts.patterns;
      t.list = ts.list || [];
      t.cur = ts.cur || 0;
      t.mute = !!ts.mix.mute; t.solo = !!ts.mix.solo;
      t.synth.allOff(true); t.kit.allOff();
      t.pendingLaunch = null; t.pendingMute = null;
      t.reset(); t.lock.clear(); t.laneLockKeys.forEach((k) => (k.length = 0)); t.rebuildEff();
    });
  }

  transport(cmd, m) {
    if (cmd === 'play') {
      const countIn = this.rec.on && this.rec.countIn && this.tracks.some((t) => t.armed);
      this.beat = countIn ? -4 : 0;
      this.playing = true;
      for (const t of this.tracks) {
        t.reset();
        t.lock.clear(); t.laneLockKeys.forEach((k) => (k.length = 0)); t.rebuildEff();
        if (t.pendingLaunch) { t.cur = t.pendingLaunch.slot; t.pendingLaunch = null; }
        if (t.pendingMute) { t.mute = t.pendingMute.on; t.pendingMute = null; }
        if (this.songMode) this.enterEntry(t, m && m.fromEntry ? m.fromEntry : 0, true);
      }
      this.post({ type: 'state', playing: true });
    } else if (cmd === 'stop') {
      this.playing = false;
      for (const t of this.tracks) {
        // flush note offs
        for (const ev of t.queue) if (ev.type === 'off') this.fireEvent(t, ev);
        t.queue = [];
        t.synth.allOff(); t.lock.clear(); t.laneLockKeys.forEach((k) => (k.length = 0)); t.rebuildEff();
        t.recHeld.clear();
      }
      this.post({ type: 'state', playing: false });
    }
  }

  locate(m) { /* reserved: start from bar */ }

  quantBeat(quant, t) {
    const b = this.beat;
    switch (quant) {
      case 'BAR': return Math.ceil((b + 1e-6) / 4) * 4;
      case 'BEAT': return Math.ceil(b + 1e-6);
      case 'NOW': return 'NOW';
      default: return 'LOOP';
    }
  }

  launch(ti, slot, quant) {
    const t = this.tracks[ti];
    if (!this.playing) { t.cur = slot; t.rest = false; t.done = false; t.pendingLaunch = null; this.post({ type: 'cur', t: ti, slot }); return; }
    const at = this.quantBeat(quant, t);
    if (at === 'NOW') {
      t.cur = slot; t.rest = false; t.done = false; t.pendingLaunch = null;
      this.post({ type: 'cur', t: ti, slot });
      return;
    }
    t.pendingLaunch = { slot, at };
    this.post({ type: 'pending', t: ti, slot });
  }

  scene(sc, quant) {
    if (!sc) return;
    sc.pats.forEach((slot, i) => { if (slot !== null && slot !== undefined && slot >= 0) this.launch(i, slot, quant); });
    if (sc.mutes) sc.mutes.forEach((on, i) => this.setMute(i, !!on, quant));
  }

  setMute(ti, on, quant) {
    const t = this.tracks[ti];
    if (!this.playing || !quant || quant === 'NOW') { t.mute = on; t.pendingMute = null; this.post({ type: 'mute', t: ti, on }); return; }
    const at = this.quantBeat(quant, t);
    t.pendingMute = { on, at };
  }

  // ------------------------------------------------------------------ song mode
  enterEntry(t, e, first = false) {
    const list = t.list || [];
    let last = -1;
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].pat !== undefined && list[i].pat !== null) last = i;
    if (last < 0) { t.rest = false; return; } // no list: loop current pattern
    if (e > last) {
      if (this.songMode === 2) { t.done = true; t.rest = true; this.post({ type: 'entry', t: t.idx, entry: -1 }); return; }
      e = 0;
    }
    t.entry = e; t.entryPass = 0;
    const en = list[e];
    if (!en || en.pat === -1 || en.pat === null || en.pat === undefined) { t.rest = true; }
    else { t.rest = false; t.cur = en.pat; }
    this.post({ type: 'entry', t: t.idx, entry: e, slot: t.rest ? -1 : t.cur });
  }

  // ------------------------------------------------------------------ live notes
  liveNote(m) {
    const t = this.tracks[m.t];
    const notes = m.notes || [m.n];
    if (m.on) {
      t.physDown++;
      const strum = t.isDrum ? 0 : t.play.strum;
      notes.forEach((n, i) => {
        const nn = t.isDrum ? n : n + (t.play.transp | 0);
        if (strum > 0 && i > 0) {
          const dt = (strum * i * 0.001) * this.bpm / 60;
          t.push({ t: this.beat + dt, type: 'on', n: nn, v: m.v, live: true });
        } else this.noteOnTrack(t, nn, m.v, { live: true });
        if (this.playing && t.armed && this.rec.on && this.beat >= 0) this.recordNote(t, n, m.v);
        this.logLive(t, n, m.v);
      });
    } else {
      t.physDown = Math.max(0, t.physDown - 1);
      notes.forEach((n) => {
        const nn = t.isDrum ? n : n + (t.play.transp | 0);
        this.noteOffTrack(t, nn, true);
        if (t.recHeld.has(n)) this.recordNoteOff(t, n);
        this.logLiveOff(t, n);
      });
    }
  }

  noteOnTrack(t, n, v, opts = {}) {
    if (t.isDrum) {
      if (((t.mix.lmute | 0) >> n) & 1) return;
      t.kit.trigger(n, v, opts.accent);
      if (n === 0) this.duckTrigger(t.idx);
      return;
    }
    if (t.play.arp && !opts.fromArp) {
      if (opts.live && t.play.ahold && t.physDown <= 1) {
        // new chord after all keys were released
        if (!t._holdKeysDown) t.arpHeld.length = 0;
      }
      if (opts.live) t._holdKeysDown = true;
      if (!t.arpHeld.includes(n)) t.arpHeld.push(n);
      if (t.arpNext < 0) { const rb = ARP_BEATS[ARP_RATES[t.play.arate | 0]] || 0.25; t.arpNext = Math.ceil((this.beat + 1e-6) / rb) * rb; t.arpIdx = 0; }
      return;
    }
    t.synth.noteOn(n, v, opts);
    this.duckTrigger(t.idx);
  }

  noteOffTrack(t, n, live = false) {
    if (t.isDrum) return;
    if (t.play.arp) {
      if (live && t.physDown === 0) t._holdKeysDown = false;
      if (t.play.ahold && live) return;
      const i = t.arpHeld.indexOf(n); if (i >= 0) t.arpHeld.splice(i, 1);
      if (!t.arpHeld.length) t.arpNext = -1;
      return;
    }
    t.synth.noteOff(n);
  }

  arpClear(t) { t.arpHeld.length = 0; t.arpNext = -1; t.synth.allOff(); }

  arpTick(t, b1) {
    if (!t.play.arp || !t.arpHeld.length || t.arpNext < 0) return;
    const rb = ARP_BEATS[ARP_RATES[t.play.arate | 0]] || 0.25;
    let guard = 0;
    while (t.arpNext < b1 && guard++ < 16) {
      const notes = this.arpNotes(t);
      if (notes.length && rng.next() <= t.play.achance) {
        const len = rb * clamp(t.play.agate, 0.05, 1);
        for (const n of notes) {
          t.push({ t: t.arpNext, type: 'on', n, v: 0.85, arp: true });
          t.push({ t: t.arpNext + len, type: 'off', n, arp: true });
        }
      }
      t.arpNext += rb;
    }
  }

  arpNotes(t) {
    const mode = t.play.arp | 0;
    const oct = clamp(t.play.aoct | 0, 1, 4);
    const sorted = [...t.arpHeld].sort((a, b) => a - b);
    const order = mode === 6 ? [...t.arpHeld] : sorted;
    const full = [];
    for (let o = 0; o < oct; o++) for (const n of order) full.push(n + 12 * o);
    const L = full.length; if (!L) return [];
    const i = t.arpIdx++;
    switch (mode) {
      case 1: case 6: return [full[i % L]];
      case 2: return [full[L - 1 - (i % L)]];
      case 3: { const per = Math.max(1, 2 * L - 2); const k = i % per; return [full[k < L ? k : per - k]]; }
      case 4: { const per = Math.max(1, 2 * L - 2); const k = i % per; return [full[L - 1 - (k < L ? k : per - k)]]; }
      case 5: return [full[(rng.next() * L) | 0]];
      case 7: return full;
      case 8: { const k = i % L; const h = k >> 1; return [k % 2 ? full[L - 1 - h] : full[h]]; }
      case 9: { const mid = (L - 1) / 2; const k = i % L; const h = (k + 1) >> 1; return [full[clamp(Math.round(mid + (k % 2 ? h : -h)), 0, L - 1)]]; }
      case 10: { const k = i % (2 * Math.max(1, L - 1)); return [k % 2 === 0 ? full[L - 1] : full[(k >> 1) % Math.max(1, L - 1)]]; }
      case 11: { const k = i % (2 * Math.max(1, L - 1)); return [k % 2 === 0 ? full[0] : full[1 + ((k >> 1) % Math.max(1, L - 1))] ?? full[0]]; }
      case 12: { const n = full[(i >> 1) % L]; return [i % 2 ? n + 12 : n]; }
      case 13: { t.arpWalk = clamp((t.arpWalk || 0) + (rng.next() < 0.5 ? -1 : 1), 0, L - 1); return [full[t.arpWalk]]; }
    }
    return [full[i % L]];
  }

  duckTrigger(src) {
    for (const t of this.tracks) if (t.mix.duck > 0 && (t.mix.dsrc | 0) - 1 === src && t !== this.tracks[src]) t.duckEnv = 1;
  }

  // ------------------------------------------------------------------ recording
  stepPos(t) {
    const sb = resBeats(t.pattern.res);
    return (this.beat - t.startBeat) / sb; // fractional counter
  }
  patIndex(t, k) {
    const len = Math.max(1, t.pattern.length | 0);
    return ((k % len) + len) % len;
  }
  recordNote(t, n, v) {
    if (t.rest) return;
    const pat = this.ensurePattern(t);
    const s = this.stepPos(t);
    const kq = Math.round(s);
    const idx = this.patIndex(t, kq);
    const nudge = this.rec.quantize ? 0 : clamp(Math.round((s - kq) * 64), -32, 31);
    let lane = 0, note = n;
    if (t.isDrum) { lane = clamp(n, 0, 7); }
    const steps = pat.lanes[lane] || (pat.lanes[lane] = []);
    let st = steps[idx];
    if (t.isDrum) {
      st = { v: v, prob: 100, cond: 'ALL', rat: 1, flam: false, ndg: nudge, acc: false, lk: (st && st.lk) || null };
    } else {
      if (!st) st = { n: [], prob: 100, cond: 'ALL', rat: 1, flam: false, ndg: nudge, acc: false, sl: false, lk: null };
      st.n = st.n.filter((x) => x.p !== note);
      if (st.n.length >= 4) st.n.shift();
      st.n.push({ p: note, l: 1, v });
      st.ndg = nudge;
    }
    steps[idx] = st;
    if (kq >= t.k) t.skip.add(kq * 16 + lane);
    t.recHeld.set(n, { s, lane, idx, slot: t.cur, note });
    this.post({ type: 'recStep', t: t.idx, slot: t.cur, lane, idx, step: st });
  }
  recordNoteOff(t, n) {
    const h = t.recHeld.get(n); t.recHeld.delete(n);
    if (!h || t.isDrum) return;
    const pat = t.patterns[h.slot]; if (!pat) return;
    const st = pat.lanes[h.lane][h.idx]; if (!st || !st.n) return;
    const s = this.stepPos(t);
    let len = Math.max(0.1, s - h.s);
    len = len >= 1 ? Math.round(len * 4) / 4 : Math.round(len * 20) / 20;
    for (const x of st.n) if (x.p === h.note) x.l = clamp(len, 0.05, 128);
    this.post({ type: 'recStep', t: t.idx, slot: h.slot, lane: h.lane, idx: h.idx, step: st });
  }
  recordLock(t, id, v) {
    const pat = this.ensurePattern(t);
    let lane = 0;
    const m = /^l(\d)/.exec(id); if (t.isDrum && m) lane = +m[1];
    const idx = t.lastPatStep | 0;
    const steps = pat.lanes[lane] || (pat.lanes[lane] = []);
    let st = steps[idx];
    if (!st) {
      // lock on an empty step: create a lock-only trig
      st = t.isDrum ? { v: 0, prob: 100, cond: 'ALL', rat: 1, flam: false, ndg: 0, acc: false, lk: {}, lockOnly: true }
        : { n: [], prob: 100, cond: 'ALL', rat: 1, flam: false, ndg: 0, acc: false, sl: false, lk: {} };
      steps[idx] = st;
    }
    st.lk = st.lk || {}; st.lk[id] = v;
    t.lock.set(id, v); t.eff[id] = v;
    if (!t.laneLockKeys[lane].includes(id)) t.laneLockKeys[lane].push(id);
    this.post({ type: 'recStep', t: t.idx, slot: t.cur, lane, idx, step: st });
  }
  ensurePattern(t) {
    if (!t.patterns[t.cur]) t.patterns[t.cur] = emptyPattern(t.isDrum);
    return t.patterns[t.cur];
  }
  logLive(t, n, v) {
    if (!this.playing) return;
    t.liveLog.push({ s: this.stepPos(t), n, v, l: 1, slot: t.cur, open: true });
    if (t.liveLog.length > 512) t.liveLog.splice(0, t.liveLog.length - 512);
  }
  logLiveOff(t, n) {
    if (!this.playing) return;
    for (let i = t.liveLog.length - 1; i >= 0; i--) {
      const e = t.liveLog[i];
      if (e.n === n && e.open) { e.open = false; e.l = Math.max(0.1, this.stepPos(t) - e.s); break; }
    }
  }
  take(ti) {
    const t = this.tracks[ti];
    const pat = this.ensurePattern(t);
    const len = pat.length;
    const now = this.stepPos(t);
    const from = Math.floor(now / len) * len - len; // the last complete pass
    const notes = t.liveLog.filter((e) => e.slot === t.cur && e.s >= from - 0.5 && e.s < now);
    if (!notes.length) { this.post({ type: 'toast', text: 'TAKE : rien à garder' }); return; }
    // use the last full pass if any notes there, else the current partial one
    const base = notes.some((e) => e.s < from + len - 0.5) ? from : from + len;
    for (const e of notes) {
      if (e.s < base - 0.5 || e.s >= base + len - 0.5) continue;
      const kq = Math.round(e.s);
      const idx = this.patIndex(t, kq);
      const lane = t.isDrum ? clamp(e.n, 0, 7) : 0;
      const steps = pat.lanes[lane] || (pat.lanes[lane] = []);
      if (t.isDrum) steps[idx] = { v: e.v, prob: 100, cond: 'ALL', rat: 1, flam: false, ndg: 0, acc: false, lk: null };
      else {
        const st = steps[idx] || { n: [], prob: 100, cond: 'ALL', rat: 1, flam: false, ndg: 0, acc: false, sl: false, lk: null };
        st.n = st.n.filter((x) => x.p !== e.n); if (st.n.length >= 4) st.n.shift();
        const l = e.open ? 1 : e.l;
        st.n.push({ p: e.n, l: l >= 1 ? Math.round(l * 4) / 4 : Math.round(l * 20) / 20, v: e.v });
        steps[idx] = st;
      }
    }
    this.post({ type: 'patternUpdate', t: ti, slot: t.cur, pattern: pat });
    this.post({ type: 'toast', text: 'TAKE gardé' });
  }

  // ------------------------------------------------------------------ sequencer
  sequence(t, b0, b1) {
    let guard = 0;
    while (guard++ < 256) {
      let pat = t.pattern;
      let sb = resBeats(pat.res);
      let tNom = t.startBeat + t.k * sb;
      // quantized launch (BAR / BEAT)
      if (t.pendingLaunch && t.pendingLaunch.at !== 'LOOP' && tNom >= t.pendingLaunch.at - 1e-9) {
        this.switchTo(t, t.pendingLaunch.slot, t.pendingLaunch.at);
        continue;
      }
      if (tNom - 0.5 * sb >= b1) break;
      const len = Math.max(1, pat.length | 0);
      if (t.k > 0 && t.k % len === 0 && t._bound !== t.k) {
        t._bound = t.k;
        // pass end
        if (t.pendingMute && t.pendingMute.at === 'LOOP') t.pendingMute.at = tNom;
        if (t.pendingLaunch && t.pendingLaunch.at === 'LOOP') { this.switchTo(t, t.pendingLaunch.slot, tNom); continue; }
        if (this.songMode && !t.done && (t.list || []).some((e) => e && e.pat !== undefined && e.pat !== null)) {
          t.entryPass++;
          const en = t.list[t.entry];
          const reps = en ? Math.max(1, en.reps | 0) : 1;
          if (t.entryPass >= reps) {
            const prevLen = pat.length, prevRes = pat.res;
            this.enterEntry(t, t.entry + 1);
            if (t.rest && t._restPat) { t._restPat.length = prevLen; t._restPat.res = prevRes; }
            t.startBeat = tNom; t.k = 0; t._bound = -1; t.skip.clear();
            if (t.done) this.checkSongEnd(tNom);
            continue;
          }
        }
      }
      this.evalStep(t, pat, sb, tNom);
      t.k++;
    }
  }

  switchTo(t, slot, at) {
    t.cur = slot; t.rest = false; t.done = false;
    t.startBeat = at; t.k = 0; t._bound = -1; t.pendingLaunch = null; t.skip.clear();
    t.liveLog.length = 0;
    this.post({ type: 'cur', t: t.idx, slot });
  }

  checkSongEnd(at) {
    if (this.tracks.every((t) => t.done || !(t.list || []).some((e) => e && e.pat !== undefined && e.pat !== null))) {
      this._stopAt = at;
    }
  }

  evalStep(t, pat, sb, tNom) {
    const len = Math.max(1, pat.length | 0);
    const k = t.k;
    const pass = Math.floor(k / len);
    const within = k % len;
    let idx;
    switch (pat.dir) {
      case 'RVRS': idx = len - 1 - within; break;
      case 'PING': { const per = Math.max(1, 2 * len - 2); const m = k % per; idx = len === 1 ? 0 : m < len ? m : per - m; break; }
      case 'RAND': idx = (rng.next() * len) | 0; break;
      default: idx = within;
    }
    t.lastPatStep = idx; t.lastStep = k;
    if (t.rest || t.done) return;
    const swing = clamp(((pat.swing || 50) - 50) / 50, 0, 0.5);
    const swOff = (k % 2 === 1) ? sb * swing : 0; // 50% => straight, 75% => half a step late
    const gate = (pat.gate || 100) / 100;
    for (let lane = 0; lane < pat.lanes.length; lane++) {
      const st = pat.lanes[lane][idx];
      if (!st) { if (t.laneLockKeys[lane].length) t.push({ t: tNom + swOff, type: 'lock', lane, lk: null }); continue; }
      if (t.skip.has(k * 16 + lane)) { t.skip.delete(k * 16 + lane); continue; }
      // condition
      const cond = st.cond || 'ALL';
      let ok = true, condUsed = false;
      if (cond !== 'ALL') {
        const c = COND_IDX.get(cond);
        condUsed = true;
        switch (cond) {
          case 'FILL': ok = this.fill; condUsed = false; break;
          case '!FILL': ok = !this.fill; condUsed = false; break;
          case 'FIRST': ok = pass === 0; break;
          case '!FIRST': ok = pass !== 0; break;
          case 'PRE': ok = t.preResult; condUsed = false; break;
          case '!PRE': ok = !t.preResult; condUsed = false; break;
          default: if (c && c.b) ok = (pass % c.b) === c.a - 1;
        }
      }
      if (ok && st.prob !== undefined && st.prob < 100) { ok = rng.next() * 100 < st.prob; condUsed = true; }
      if (condUsed) t.preResult = ok;
      const tEv = tNom + swOff + ((st.ndg || 0) / 64) * sb;
      if (!ok) continue;
      t.push({ t: tEv, type: 'lock', lane, lk: st.lk || null });
      if (st.lockOnly) continue;
      const rat = clamp(st.rat | 0 || 1, 1, 4);
      const hits = [];
      if (st.flam) { hits.push({ dt: 0, vm: 0.55 }); hits.push({ dt: sb * 0.14, vm: 1 }); }
      else for (let r = 0; r < rat; r++) hits.push({ dt: (r * sb) / rat, vm: r === 0 ? 1 : 0.85 });
      const sub = (st.flam || rat > 1) ? sb / Math.max(rat, 2) : 0;
      if (t.isDrum) {
        for (const h of hits) t.push({ t: tEv + h.dt, type: 'on', n: lane, v: clamp((st.v ?? 0.8) * h.vm, 0, 1), acc: !!st.acc });
      } else {
        const strum = t.play.strum > 0 ? (t.play.strum * 0.001) * this.bpm / 60 : 0;
        const slideIn = t.slideUntil > tEv + 1e-6;
        const transp = t.play.transp | 0;
        const notes = st.n || [];
        for (const h of hits) {
          notes.forEach((nt, ni) => {
            const ton = tEv + h.dt + ni * strum;
            let l = sub ? sub * 0.8 : nt.l * sb * gate;
            if (st.sl) l = Math.max(l, sb * 1.05);
            const n = nt.p + transp;
            t.push({ t: ton, type: 'on', n, v: clamp((nt.v ?? 0.8) * h.vm, 0, 1), acc: !!st.acc, slide: slideIn });
            t.push({ t: ton + Math.max(0.01, l), type: 'off', n });
          });
        }
        if (st.sl) t.slideUntil = tEv + sb * 1.05; else if (!slideIn) t.slideUntil = -1e9;
      }
    }
  }

  fireEvent(t, ev) {
    switch (ev.type) {
      case 'on':
        if (t.isDrum) this.noteOnTrack(t, ev.n, ev.v, { accent: ev.acc });
        else this.noteOnTrack(t, ev.n, ev.v, { accent: ev.acc, slide: ev.slide, fromArp: ev.arp });
        break;
      case 'off':
        if (ev.arp) t.synth.noteOff(ev.n); else this.noteOffTrack(t, ev.n);
        break;
      case 'lock': t.applyLocks(ev.lane, ev.lk); break;
    }
  }

  // ------------------------------------------------------------------ audio
  process(outL, outR) {
    const n = BLOCK;
    if (!this.loaded) { outL.fill(0); outR.fill(0); return; }
    const sr = this.sr;
    const spb = sr * 60 / this.bpm; // samples per beat
    const b0 = this.beat, b1 = b0 + n / spb;
    const fx = this.fx;
    const bus = this.bus, sends = this.sends;
    bus.L.fill(0); bus.R.fill(0);
    for (const s of sends) { s.L.fill(0); s.R.fill(0); }

    // pending mutes
    for (const t of this.tracks) {
      if (t.pendingMute && t.pendingMute.at !== 'LOOP' && b1 > t.pendingMute.at) {
        t.mute = t.pendingMute.on; this.post({ type: 'mute', t: t.idx, on: t.mute }); t.pendingMute = null;
      }
    }
    if (this.playing) {
      for (const t of this.tracks) this.sequence(t, b0, b1);
      if (this._stopAt !== undefined && b0 >= this._stopAt) { this._stopAt = undefined; this.transport('stop'); }
    }
    for (const t of this.tracks) this.arpTick(t, b1);

    const anySolo = this.tracks.some((t) => t.solo);
    for (const t of this.tracks) {
      t.L.fill(0); t.R.fill(0);
      // render with sample-accurate-ish (16 samples) event splitting
      let pos = 0;
      const q = t.queue;
      while (q.length && q[0].t < b1) {
        const ev = q.shift();
        let off = Math.floor((ev.t - b0) * spb);
        off = off < 0 ? 0 : off > n ? n : off;
        off = off & ~15;
        if (off > pos) { this.renderTrack(t, pos, off); pos = off; }
        this.fireEvent(t, ev);
      }
      if (pos < n) this.renderTrack(t, pos, n);
      this.mixTrack(t, anySolo, n);
    }

    // throws
    for (const k of ['cut', 'rev', 'dly', 'dist']) {
      const held = this.throwHeld[k] || this.throwLatch[k];
      if (held) this.throws[k] = Math.min(1, this.throws[k] + n / (sr * 0.05));
      else this.throws[k] = Math.max(0, this.throws[k] - n / (spb * 4));
    }
    const thrRev = this.throws.rev + (fx.throw || 0), thrDly = this.throws.dly + (fx.throw || 0) + (this.dub ? 0.9 : 0);
    if (thrRev > 0 || thrDly > 0) {
      for (let i = 0; i < n; i++) {
        sends[1].L[i] += bus.L[i] * thrDly; sends[1].R[i] += bus.R[i] * thrDly;
        sends[2].L[i] += bus.L[i] * thrRev; sends[2].R[i] += bus.R[i] * thrRev;
      }
    }
    this.delay.boostFb = this.dub ? 1 : 0;
    // send effects
    const ret = this.ret; ret.L.fill(0); ret.R.fill(0);
    this.chorus.process(sends[0].L, sends[0].R, ret.L, ret.R, n, fx);
    this.delay.process(sends[1].L, sends[1].R, ret.L, ret.R, n, fx, this.bpm);
    this.reverb.process(sends[2].L, sends[2].R, ret.L, ret.R, n, fx);
    for (let i = 0; i < n; i++) { bus.L[i] += ret.L[i]; bus.R[i] += ret.R[i]; }
    // perf FX, master chain
    this.perf.process(bus.L, bus.R, n, this.bpm, this.beat, fx.pdepth ?? 1);
    this.master.thrCut = this.throws.cut; this.master.thrDist = this.throws.dist * 0.8;
    this.master.process(bus.L, bus.R, n, fx);
    // click
    this.renderClick(bus.L, bus.R, b0, b1, spb);
    outL.set(bus.L); outR.set(bus.R);
    this.beat = b1;
    if (++this.blockCount % 8 === 0) this.report();
  }

  renderTrack(t, a, b) {
    if (t.isDrum) t.kit.render(t.L, t.R, a, b);
    else t.synth.render(t.L, t.R, a, b, this.bpm);
  }

  mixTrack(t, anySolo, n) {
    const m = t.mix;
    const audible = !t.mute && !t.cut && (!anySolo || t.solo);
    const target = audible ? m.vol : 0;
    const L = t.L, R = t.R;
    const dtype = m.dtype | 0;
    if (dtype) {
      const drv = m.damt;
      t.toneL.setHz(800 * Math.pow(2, m.dtone * 4.5), this.sr); t.toneR.setHz(800 * Math.pow(2, m.dtone * 4.5), this.sr);
      const comp = dtype === 4 ? 1 : 1 / (1 + drv * 1.5);
      if (dtype === 4) {
        const bits = Math.pow(2, 12 - drv * 10);
        const hold = Math.max(1, Math.round(1 + drv * 16));
        for (let i = 0; i < n; i++) {
          if (i % hold === 0) { t._chL = Math.round(L[i] * bits) / bits; t._chR = Math.round(R[i] * bits) / bits; }
          L[i] = t.toneL.lp(t._chL); R[i] = t.toneR.lp(t._chR);
        }
      } else {
        for (let i = 0; i < n; i++) { L[i] = t.toneL.lp(shape(dtype, L[i], drv)) * comp; R[i] = t.toneR.lp(shape(dtype, R[i], drv)) * comp; }
      }
    }
    // duck
    const duckRel = Math.exp(-n / (m.drel * 0.001 * this.sr / 3));
    const duckG0 = 1 - m.duck * t.duckEnv;
    if (t.duckEnv > 0) t.duckEnv *= duckRel;
    const duckG1 = 1 - m.duck * t.duckEnv;
    const pa = (clamp(m.pan, -1, 1) + 1) * 0.25 * Math.PI;
    const pl = Math.cos(pa) * 1.4142, pr = Math.sin(pa) * 1.4142;
    const g0 = t.gain, g1 = g0 + (target - g0) * 0.35;
    t.gain = Math.abs(g1 - target) < 1e-4 ? target : g1;
    const bus = this.bus, s = this.sends;
    const cho = m.cho, dly = m.dly, rev = m.rev;
    let pk = 0;
    for (let i = 0; i < n; i++) {
      const fr = i / n;
      const g = (g0 + (g1 - g0) * fr) * (duckG0 + (duckG1 - duckG0) * fr);
      const l = L[i] * g * pl, r = R[i] * g * pr;
      bus.L[i] += l; bus.R[i] += r;
      if (cho) { s[0].L[i] += l * cho; s[0].R[i] += r * cho; }
      if (dly) { s[1].L[i] += l * dly; s[1].R[i] += r * dly; }
      if (rev) { s[2].L[i] += l * rev; s[2].R[i] += r * rev; }
      const a = Math.abs(l) + Math.abs(r);
      if (a > pk) pk = a;
    }
    t.peak = Math.max(pk * 0.5, t.peak * 0.92);
  }

  renderClick(L, R, b0, b1, spb) {
    const on = this.rec.click && ((this.playing && this.beat < 0) || (this.playing && this.rec.on && this.tracks.some((t) => t.armed)) || (this.playing && this.rec.clickAlways));
    const c = this.click;
    if (on) {
      const nb = Math.ceil(b0 - 1e-9);
      if (nb < b1) {
        c.start = Math.floor((nb - b0) * spb); c.env = 1; c.f = (((nb % 4) + 4) % 4) === 0 ? 1600 : 1000; c.ph = 0;
      } else c.start = 0;
    }
    if (c.env < 0.001) return;
    const dec = Math.exp(-1 / (0.012 * this.sr));
    for (let i = c.start || 0; i < BLOCK; i++) {
      c.ph += c.f / this.sr;
      const y = fsin(c.ph) * c.env * 0.3;
      c.env *= dec;
      L[i] += y; R[i] += y;
    }
    c.start = 0;
  }

  report() {
    this.post({
      type: 'pos',
      beat: this.beat,
      playing: this.playing,
      tracks: this.tracks.map((t) => ({ step: t.lastPatStep, cur: t.cur, rest: t.rest, done: t.done, peak: t.peak, entry: t.entry, pend: t.pendingLaunch ? t.pendingLaunch.slot : -1, mute: t.mute, pmute: t.pendingMute ? t.pendingMute.on : null, voices: t.isDrum ? 0 : t.synth.activeCount })),
      master: [this.master.peakL, this.master.peakR],
      gr: this.master.gr,
      throws: { ...this.throws },
      cpu: this.cpu,
    });
  }
}
