// Revolte — application state, actions and engine synchronisation
import { NUM_TRACKS, MAX_STEPS, CHORDS, SCALES, quantizeToScale, soundParamDefs, MIX_PARAMS, FX_PARAMS, ARP_PARAMS, PLAY_PARAMS, paramDef, defaultParams, fromNorm } from '../shared/params.js';
import { clone, demoProject, newProject, newSong, normalizeProject, engineSong, emptyPattern, newStep, soundFromPreset, uid } from '../shared/model.js';
import { b64decode, b64encode } from './bridge.js';

const MIX_DEFS = new Map(MIX_PARAMS.map((d) => [d.id, d]));
const FX_DEFS = new Map(FX_PARAMS.map((d) => [d.id, d]));
const PLAY_DEFS = new Map([...ARP_PARAMS, ...PLAY_PARAMS].map((d) => [d.id, d]));

export class Store {
  constructor(bridge) {
    this.bridge = bridge;
    this.listeners = new Map();
    this.project = demoProject();
    this.songIdx = 0;
    this.selTrack = 0;
    this.lane = 0;
    this.sel = new Set(); // keys lane*1000+idx
    this.clipboard = null;
    this.undoStack = []; this.redoStack = [];
    this.playing = false; this.recOn = false; this.armed = -1;
    this.pos = null;
    this.lockMode = false;
    this.fill = false;
    this.projectPath = null; this.dirty = false;
    this.liveMap = new Map(); // `${t}:${note}` -> notes sent
    this.editFollow = true;
    this.settings = loadSettings();
    this.pendingSong = null;
    this.bindEngine();
  }

  // ------------------------------------------------------------------ events
  on(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, new Set()); this.listeners.get(ev).add(fn); return () => this.listeners.get(ev).delete(fn); }
  emit(ev, ...a) { const s = this.listeners.get(ev); if (s) for (const f of s) { try { f(...a); } catch (e) { console.error(e); } } }
  toast(text, kind = 'info') { this.emit('toast', text, kind); }

  get song() { return this.project.songs[this.songIdx]; }
  get track() { return this.song.tracks[this.selTrack]; }
  trackAt(t) { return this.song.tracks[t]; }
  isDrum(t) { return this.trackAt(t).kind === 'drum'; }

  // edited pattern = the track's current pattern
  editSlot(t = this.selTrack) { return this.trackAt(t).cur; }
  pattern(t = this.selTrack, create = false) {
    const tr = this.trackAt(t);
    let p = tr.patterns[tr.cur];
    if (!p && create) { p = tr.patterns[tr.cur] = emptyPattern(tr.kind === 'drum'); }
    return p;
  }

  markDirty() { this.dirty = true; this.emit('dirty'); }

  // ------------------------------------------------------------------ engine sync
  bindEngine() {
    const b = this.bridge;
    b.on('pos', (m) => {
      this.pos = m;
      if (m.playing !== this.playing) { this.playing = m.playing; this.emit('transport'); }
      m.tracks.forEach((tp, i) => {
        const tr = this.song.tracks[i];
        if (tr.cur !== tp.cur) { tr.cur = tp.cur; this.emit('cur', i); }
        if (!!tr.mix.mute !== !!tp.mute) { tr.mix.mute = tp.mute; this.emit('mix', i); }
      });
      this.emit('pos', m);
    });
    b.on('state', (m) => { this.playing = m.playing; this.emit('transport'); });
    b.on('cur', (m) => { this.song.tracks[m.t].cur = m.slot; this.emit('cur', m.t); });
    b.on('mute', (m) => { this.song.tracks[m.t].mix.mute = m.on; this.emit('mix', m.t); });
    b.on('recStep', (m) => {
      const tr = this.song.tracks[m.t];
      let p = tr.patterns[m.slot];
      if (!p) p = tr.patterns[m.slot] = emptyPattern(tr.kind === 'drum');
      while (p.lanes.length <= m.lane) p.lanes.push([]);
      p.lanes[m.lane][m.idx] = m.step;
      this.markDirty();
      this.emit('pattern', m.t, m.slot);
    });
    b.on('patternUpdate', (m) => {
      this.song.tracks[m.t].patterns[m.slot] = m.pattern;
      this.markDirty(); this.emit('pattern', m.t, m.slot);
    });
    b.on('toast', (m) => this.toast(m.text));
    b.on('error', (m) => { console.error('engine:', m.message); this.toast('Erreur moteur : ' + m.message.split('\n')[0], 'error'); });
  }
  send(m) { this.bridge.send(m); }
  sendSong() { this.send({ type: 'song', song: engineSong(this.song) }); this.sendRecState(); }
  sendPattern(t, slot = this.trackAt(t).cur) { this.send({ type: 'pattern', t, slot, pattern: this.trackAt(t).patterns[slot] }); }
  sendPatterns(t) { this.send({ type: 'patterns', t, patterns: this.trackAt(t).patterns }); }
  sendSound(t) { const tr = this.trackAt(t); this.send({ type: 'sound', t, kind: tr.kind, sound: tr.sound }); }
  sendMix(t) { this.send({ type: 'mix', t, mix: this.trackAt(t).mix }); }
  sendPlay(t) { this.send({ type: 'play', t, play: this.trackAt(t).play }); }
  sendList(t) { this.send({ type: 'list', t, list: this.trackAt(t).list }); }
  sendFx() { this.send({ type: 'fx', fx: this.song.fx }); }
  sendRecState() {
    this.send({ type: 'rec', rec: { on: this.recOn, quantize: this.settings.recQuantize, countIn: this.settings.countIn, click: this.settings.click, clickAlways: this.settings.clickAlways } });
    this.send({ type: 'arm', t: this.armed });
  }

  // after an audio back-end change: the new engine starts empty
  resyncEngine() {
    this.playing = false;
    this.sendSong();
    this.bridge.resendSamples();
    this.emit('transport');
  }
  // samples: decode every sample referenced by the project
  async loadProjectSamples() {
    for (const [id, s] of Object.entries(this.project.samples)) {
      if (this.bridge.decoded.has(id)) { const d = this.bridge.decoded.get(id); this.send({ type: 'sample', id, ch: d.ch, sr: d.sr }); continue; }
      try { await this.bridge.loadSample(id, b64decode(s.data).buffer); } catch (e) { this.toast(`Sample ${s.name} illisible`, 'error'); }
    }
  }
  async importSample(file) {
    const ab = await file.arrayBuffer();
    const id = uid();
    const bytes = new Uint8Array(ab);
    await this.bridge.loadSample(id, ab);
    this.project.samples[id] = { name: file.name, data: b64encode(bytes), size: bytes.length };
    this.markDirty();
    return id;
  }
  garbageCollectSamples() {
    const used = new Set();
    for (const s of this.project.songs) for (const t of s.tracks) { if (t.sound.sample) used.add(t.sound.sample); for (const l of t.sound.laneSamples || []) if (l) used.add(l); }
    for (const u of this.project.userSounds) { if (u.sample) used.add(u.sample); }
    for (const id of Object.keys(this.project.samples)) if (!used.has(id)) delete this.project.samples[id];
  }

  // ------------------------------------------------------------------ project / songs
  async loadProject(p, path = null) {
    this.stop();
    this.project = normalizeProject(p);
    this.projectPath = path;
    this.songIdx = 0; this.selTrack = 0; this.sel.clear();
    this.undoStack = []; this.redoStack = [];
    this.dirty = false;
    this.sendSong();
    await this.loadProjectSamples();
    this.emit('project');
  }
  newProject() { return this.loadProject(newProject()); }
  selectSong(i, queued = false) {
    if (i < 0 || i >= this.project.songs.length) return;
    if (queued && this.playing) {
      this.pendingSong = i;
      this.toast(`« ${this.project.songs[i].name} » démarre à la prochaine mesure`);
      this.emit('pendingSong');
      this._waitBar();
      return;
    }
    this.songIdx = i; this.sel.clear(); this.undoStack = []; this.redoStack = [];
    const wasPlaying = this.playing;
    this.sendSong();
    if (wasPlaying) this.send({ type: 'transport', cmd: 'play' });
    this.emit('project');
  }
  _waitBar() {
    // switch on the next bar line (approximated from engine position)
    const check = () => {
      if (this.pendingSong === null) return;
      const b = this.pos ? this.pos.beat : 0;
      const next = Math.ceil((b + 0.01) / 4) * 4;
      const spb = 60 / this.song.bpm;
      const ms = (next - b) * spb * 1000 - 30;
      setTimeout(() => {
        if (this.pendingSong === null) return;
        const i = this.pendingSong; this.pendingSong = null;
        this.songIdx = i; this.sel.clear(); this.undoStack = []; this.redoStack = [];
        this.sendSong(); this.send({ type: 'transport', cmd: 'play' });
        this.emit('project'); this.emit('pendingSong');
      }, Math.max(0, ms));
    };
    check();
  }
  addSong(copyFrom = null) {
    const s = copyFrom ? clone(copyFrom) : newSong(`Titre ${this.project.songs.length + 1}`);
    if (copyFrom) { s.id = uid(); s.name = copyFrom.name + ' (copie)'; }
    this.project.songs.push(s);
    this.markDirty(); this.emit('setlist');
    return this.project.songs.length - 1;
  }
  deleteSong(i) {
    if (this.project.songs.length <= 1) { this.toast('Un projet garde au moins un titre'); return; }
    this.project.songs.splice(i, 1);
    if (this.songIdx >= this.project.songs.length) this.songIdx = this.project.songs.length - 1;
    else if (i < this.songIdx) this.songIdx--;
    this.markDirty(); this.sendSong(); this.emit('project');
  }
  moveSong(i, d) {
    const j = i + d; const S = this.project.songs;
    if (j < 0 || j >= S.length) return;
    [S[i], S[j]] = [S[j], S[i]];
    if (this.songIdx === i) this.songIdx = j; else if (this.songIdx === j) this.songIdx = i;
    this.markDirty(); this.emit('setlist');
  }

  // ------------------------------------------------------------------ undo
  pushUndo(label = '') {
    this.undoStack.push({ label, song: clone(this.song) });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    this.markDirty();
  }
  _restore(snap) {
    const s = snap.song;
    // keep live state of transport-related fields
    s.tracks.forEach((t, i) => { t.cur = this.song.tracks[i].cur; });
    this.project.songs[this.songIdx] = s;
    s.tracks.forEach((t, i) => { this.sendPatterns(i); this.sendSound(i); this.sendMix(i); this.sendPlay(i); this.sendList(i); });
    this.sendFx(); this.send({ type: 'bpm', bpm: s.bpm });
    this.emit('project');
  }
  undo() {
    const s = this.undoStack.pop(); if (!s) { this.toast('Rien à annuler'); return; }
    this.redoStack.push({ label: s.label, song: clone(this.song) });
    this._restore(s); this.toast('Annulé ' + (s.label || ''));
  }
  redo() {
    const s = this.redoStack.pop(); if (!s) return;
    this.undoStack.push({ label: s.label, song: clone(this.song) });
    this._restore(s); this.toast('Rétabli ' + (s.label || ''));
  }

  // ------------------------------------------------------------------ values (knobs/faders/MIDI)
  // target: {scope:'sound'|'mix'|'fx'|'play'|'song', t, id}
  def(target) {
    switch (target.scope) {
      case 'sound': { const tr = this.trackAt(target.t); return paramDef(tr.kind, tr.sound.engine, target.id); }
      case 'mix': return MIX_DEFS.get(target.id);
      case 'fx': return FX_DEFS.get(target.id);
      case 'play': return PLAY_DEFS.get(target.id);
      case 'song': if (target.id === 'bpm') return { id: 'bpm', label: 'BPM', min: 30, max: 300, def: 120 }; return null;
    }
    return null;
  }
  get(target) {
    switch (target.scope) {
      case 'sound': return this.trackAt(target.t).sound.params[target.id];
      case 'mix': return this.trackAt(target.t).mix[target.id];
      case 'fx': return this.song.fx[target.id];
      case 'play': return this.trackAt(target.t).play[target.id];
      case 'song': return this.song[target.id];
    }
  }
  set(target, v, opts = {}) {
    const d = this.def(target);
    if (d) { v = Math.min(d.max, Math.max(d.min, v)); if (d.int || d.options) v = Math.round(v); }
    const { t, id } = target;
    switch (target.scope) {
      case 'sound': {
        // p-lock mode: write locks into the selected steps instead
        if (this.lockMode && t === this.selTrack && this.sel.size && !opts.noLock) { this.writeLock(id, v); return; }
        const tr = this.trackAt(t);
        const rec = this.recOn && this.playing && this.armed === t;
        if (rec) { this.send({ type: 'param', t, id, v, rec: true }); this.emit('value', target, v); return; }
        tr.sound.params[id] = v;
        this.send({ type: 'param', t, id, v });
        break;
      }
      case 'mix': this.trackAt(t).mix[id] = v; this.sendMix(t); break;
      case 'fx': this.song.fx[id] = v; this.send({ type: 'fx', fx: { [id]: v } }); break;
      case 'play': this.trackAt(t).play[id] = v; this.sendPlay(t); break;
      case 'song': if (id === 'bpm') { this.song.bpm = Math.round(v * 10) / 10; this.send({ type: 'bpm', bpm: this.song.bpm }); this.emit('bpm'); } break;
    }
    this.dirty = true;
    this.emit('value', target, v);
  }
  setNorm(target, n, opts) {
    const d = this.def(target); if (!d) return;
    this.set(target, fromNorm(d, n), opts);
  }

  writeLock(id, v) {
    const p = this.pattern(this.selTrack, true);
    const isDrum = this.isDrum(this.selTrack);
    let n = 0;
    for (const key of this.sel) {
      const lane = Math.floor(key / 1000), idx = key % 1000;
      const st = p.lanes[lane] && p.lanes[lane][idx];
      if (!st) continue;
      if (isDrum && /^l\d/.test(id) && +id[1] !== lane) continue;
      st.lk = st.lk || {}; st.lk[id] = v; n++;
    }
    if (n) { this.sendPattern(this.selTrack); this.emit('pattern', this.selTrack, this.track.cur); this.markDirty(); }
    this.emit('value', { scope: 'sound', t: this.selTrack, id }, v);
  }

  // ------------------------------------------------------------------ pattern editing
  editPattern(t, label, fn, { undo = true } = {}) {
    if (undo) this.pushUndo(label);
    const p = this.pattern(t, true);
    fn(p, this.trackAt(t));
    this.sendPattern(t);
    this.markDirty();
    this.emit('pattern', t, this.trackAt(t).cur);
  }
  // sound changes
  loadSound(t, preset) {
    this.pushUndo('son');
    const tr = this.trackAt(t);
    const keepSample = tr.sound.sample;
    tr.sound = soundFromPreset(preset);
    if (preset.sample) tr.sound.sample = preset.sample; else if (keepSample && tr.sound.engine === 'SAMPLE') tr.sound.sample = keepSample;
    if (preset.laneSamples) tr.sound.laneSamples = [...preset.laneSamples];
    this.sendSound(t);
    this.emit('sound', t);
  }
  setEngine(t, engine) {
    const tr = this.trackAt(t);
    if (tr.kind === 'drum' || tr.sound.engine === engine) return;
    this.pushUndo('moteur');
    const old = tr.sound.params;
    const defs = soundParamDefs(tr.kind, engine);
    const np = defaultParams(defs);
    for (const k in np) if (k in old && !['vol'].includes(k)) np[k] = old[k];
    tr.sound = { ...tr.sound, engine, params: np, name: engine + ' init' };
    this.sendSound(t); this.emit('sound', t);
  }

  // ------------------------------------------------------------------ transport
  async play() {
    await this.bridge.resume();
    this.send({ type: 'transport', cmd: 'play' });
    this.playing = true; this.emit('transport');
  }
  stop() {
    this.send({ type: 'transport', cmd: 'stop' });
    if (this.playing) { this.playing = false; this.emit('transport'); }
    else this.send({ type: 'allNotesOff' });
  }
  togglePlay() { this.playing ? this.stop() : this.play(); }
  toggleRec() {
    this.recOn = !this.recOn;
    if (this.recOn && this.armed < 0) this.armed = this.selTrack;
    if (this.recOn) this.pushUndo('enregistrement');
    this.sendRecState(); this.emit('transport');
  }
  arm(t) { this.armed = this.armed === t ? -1 : t; this.sendRecState(); this.emit('transport'); }
  setSongMode(m) { this.song.songMode = m; this.send({ type: 'songMode', mode: m }); this.markDirty(); this.emit('transport'); }
  setFill(on) { this.fill = on; this.send({ type: 'fill', on }); this.emit('fill'); }
  tapTempo() {
    const now = performance.now();
    this._taps = (this._taps || []).filter((x) => now - x < 2500);
    this._taps.push(now);
    if (this._taps.length >= 2) {
      const d = (this._taps[this._taps.length - 1] - this._taps[0]) / (this._taps.length - 1);
      this.set({ scope: 'song', id: 'bpm' }, Math.round(60000 / d * 10) / 10);
    }
  }

  launch(t, slot, quant = this.song.launchQuant) {
    this.send({ type: 'launch', t, slot, quant: quant });
    if (!this.playing) { this.trackAt(t).cur = slot; this.emit('cur', t); }
  }
  launchScene(i, quant = this.song.launchQuant) {
    const sc = this.song.scenes[i];
    if (!sc) { this.toast(`Scène ${i + 1} vide — Maj+clic pour la mémoriser`); return; }
    this.send({ type: 'scene', scene: sc, quant });
    if (!this.playing) {
      sc.pats.forEach((s, k) => { if (s >= 0) this.trackAt(k).cur = s; });
      sc.mutes.forEach((m, k) => (this.trackAt(k).mix.mute = !!m));
      this.emit('project');
    }
    this.lastScene = i; this.emit('scene', i);
  }
  storeScene(i) {
    this.pushUndo('scène');
    this.song.scenes[i] = { name: (this.song.scenes[i] && this.song.scenes[i].name) || `SCENE ${i + 1}`, pats: this.song.tracks.map((t) => t.cur), mutes: this.song.tracks.map((t) => !!t.mix.mute) };
    this.toast(`Scène ${i + 1} mémorisée`);
    this.emit('scene', i);
  }
  toggleMute(t, quant = null) {
    const tr = this.trackAt(t);
    const on = !tr.mix.mute;
    const q = quant || this.settings.muteQuant || 'NOW';
    this.send({ type: 'mute', t, on, quant: q });
    if (q === 'NOW' || !this.playing) { tr.mix.mute = on; this.emit('mix', t); }
    this.markDirty();
  }
  cut(t, on) { this.send({ type: 'cut', t, on }); }
  toggleSolo(t) {
    const tr = this.trackAt(t); tr.mix.solo = !tr.mix.solo;
    this.send({ type: 'solo', t, on: tr.mix.solo }); this.emit('mix', t);
  }
  selectTrack(t) {
    if (t < 0 || t >= NUM_TRACKS) return;
    this.selTrack = t; this.sel.clear(); this.lane = 0;
    if (this.recOn && this.settings.armFollows) { this.armed = t; this.sendRecState(); }
    this.emit('track');
  }
  perf(fx, on) { this.send({ type: 'perf', fx, on }); this.emit('perf', fx, on); }
  throwFx(which, on, latch) { this.send({ type: 'throw', which, on, latch }); this.emit('throw', which, on); }

  // ------------------------------------------------------------------ live notes (keys, pads, MIDI)
  liveNote(t, note, vel, on, src = 'keys') {
    const tr = this.trackAt(t);
    const key = `${t}:${note}`;
    if (!on) {
      const notes = this.liveMap.get(key);
      if (!notes) return;
      this.liveMap.delete(key);
      this.send({ type: 'note', t, notes, v: 0, on: false });
      if (this._stepHeld) this.stepRecRelease();
      this.emit('liveNote', t, notes, false);
      return;
    }
    let notes;
    if (tr.kind === 'drum') {
      const lane = src === 'lane' ? note : (((note - 48) % 8) + 8) % 8;
      notes = [lane];
    } else {
      notes = this.voiceChord(tr, note);
    }
    if (this.liveMap.has(key)) this.send({ type: 'note', t, notes: this.liveMap.get(key), v: 0, on: false });
    this.liveMap.set(key, notes);
    this.send({ type: 'note', t, notes, v: vel, on: true });
    if (this.recOn && !this.playing && this.armed === t && src !== 'preview') this.stepRecord(t, notes, vel);
    this.emit('liveNote', t, notes, true);
  }
  // step recording (transport stopped, REC on, track armed): keys pressed together form a chord on the cursor step
  stepRecord(t, notes, vel) {
    const tr = this.trackAt(t);
    const p = this.pattern(t, true);
    const idx = ((this.stepCursor || 0) % p.length + p.length) % p.length;
    const drum = tr.kind === 'drum';
    if (!this._stepHeld) this.pushUndo('pas à pas');
    if (drum) {
      for (const lane of notes) p.lanes[lane][idx] = newStep(true, 0, vel);
      this.lane = notes[0];
    } else {
      let st = p.lanes[0][idx];
      if (!st || !this._stepHeld) { st = newStep(false, notes[0], vel); st.n = []; p.lanes[0][idx] = st; }
      for (const n of notes) if (st.n.length < 4 && !st.n.some((x) => x.p === n)) st.n.push({ p: n, l: 1, v: vel });
    }
    this._stepHeld = (this._stepHeld || 0) + 1;
    this._stepIdx = idx;
    this.sel.clear(); this.sel.add((drum ? notes[0] : 0) * 1000 + idx);
    this.sendPattern(t); this.markDirty();
    this.emit('pattern', t, tr.cur); this.emit('selection');
  }
  stepRecRelease() {
    if (!this._stepHeld) return;
    this._stepHeld--;
    if (this._stepHeld === 0) {
      const p = this.pattern(this.selTrack);
      this.stepCursor = ((this._stepIdx ?? 0) + 1) % (p ? p.length : 16);
      this.emit('selection');
    }
  }
  moveStepCursor(d) {
    const p = this.pattern(this.selTrack); const L = p ? p.length : 16;
    this.stepCursor = (((this.stepCursor || 0) + d) % L + L) % L;
    this.emit('selection');
  }
  voiceChord(tr, note) {
    const sc = this.song.scale;
    let root = note;
    if (tr.play.squant) root = quantizeToScale(note, sc.root, sc.id);
    const ch = CHORDS[tr.play.chord | 0] || CHORDS[0];
    let notes;
    if (ch.id === 'SCALE') {
      const scale = SCALES.find((s) => s.id === sc.id) || SCALES[1];
      const degs = [];
      const base = quantizeToScale(root, sc.root, sc.id);
      const rel = (((base - sc.root) % 12) + 12) % 12;
      let i = scale.steps.indexOf(rel); if (i < 0) i = 0;
      const n = scale.steps.length;
      for (const k of [0, 2, 4]) {
        const j = i + k; const oct = Math.floor(j / n);
        degs.push(base - rel + scale.steps[j % n] + 12 * oct);
      }
      notes = degs;
    } else notes = ch.iv.map((i) => root + i);
    switch (tr.play.voicing | 0) {
      case 1: if (notes.length > 1) notes[1] += 12; break;
      case 2: if (notes.length > 2) notes[notes.length - 2] -= 12; break;
      case 3: notes = notes.map((n, i) => (i % 2 ? n + 12 : n)); break;
      case 4: if (notes.length > 1) notes[0] += 12; break;
    }
    return notes.sort((a, b) => a - b).slice(0, 4);
  }
  allLiveOff() {
    for (const [key, notes] of this.liveMap) { const t = +key.split(':')[0]; this.send({ type: 'note', t, notes, v: 0, on: false }); }
    this.liveMap.clear();
  }
}

// ------------------------------------------------------------------ settings
const SETTINGS_KEY = 'revolte.settings.v1';
export const DEFAULT_SETTINGS = {
  latency: 'interactive', recQuantize: true, countIn: true, click: true, clickAlways: false, armFollows: true,
  muteQuant: 'NOW', midiLearn: [], lkDawMode: true, lkPadMode: 'MUTES', pickup: false,
  portRoles: {}, keyboardLayout: 'auto', autosave: true, lastPath: null, stepPreview: true,
  audioBackend: 'webaudio', audioDeviceId: null, audioDeviceName: null, audioSampleRate: 48000, audioBufferSize: 128, audioFirstChannel: 0, audioQueue: 2,
};
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
