// Revolte — MIDI: port management, Akai MIDImix, Novation Launchkey Mini, generic keyboards, MIDI learn
import { toNorm, fromNorm, PATTERN_NAMES } from '../shared/params.js';
import { perfKnobIds, stripTarget } from '../ui/live.js';
import { newStep } from '../shared/model.js';
import { LaunchpadDriver, lpKind, LP_MODES } from './launchpad.js';
export { LP_MODES };

export const ROLES = { midimix: 'Akai MIDImix', launchpad: 'Novation Launchpad (Mini MK3 / X / Pro MK3)', 'launchpad-old': 'Novation Launchpad Mini ancien (MK1/MK2)', 'lk-keys': 'Launchkey — clavier/potards', 'lk-daw': 'Launchkey — DAW (pads, transport)', keys: 'Clavier MIDI (joue la piste sélectionnée)', ignore: 'Ignorer' };

export function guessRole(name) {
  const n = (name || '').toLowerCase();
  if (/midi\s*mix/.test(n)) return 'midimix';
  // both USB interfaces of a Launchpad are used: which one carries the pads depends on the model
  if (lpKind(name)) return 'launchpad';
  if (/launchkey|lkmk|lk mini/.test(n)) {
    if (/daw|midiin2|midiout2|\(2\)|\s2$|port 2/.test(n)) return 'lk-daw';
    return 'lk-keys';
  }
  return 'keys';
}

// MIDImix factory mapping (channel 1)
export const MIDIMIX = {
  k1: [16, 20, 24, 28, 46, 50, 54, 58],
  k2: [17, 21, 25, 29, 47, 51, 55, 59],
  k3: [18, 22, 26, 30, 48, 52, 56, 60],
  fader: [19, 23, 27, 31, 49, 53, 57, 61],
  master: 62,
  mute: [1, 4, 7, 10, 13, 16, 19, 22],
  solo: [2, 5, 8, 11, 14, 17, 20, 23],
  arm: [3, 6, 9, 12, 15, 18, 21, 24],
  bankL: 25, bankR: 26, soloBtn: 27,
};
// Launchkey Mini MK3 / MK4 (DAW mode)
export const LK = {
  padsTop: [96, 97, 98, 99, 100, 101, 102, 103],
  padsBottom: [112, 113, 114, 115, 116, 117, 118, 119],
  knobs: [21, 22, 23, 24, 25, 26, 27, 28],
  play: 115, rec: 117, sceneLaunch: 104, stopSoloMute: 105, trackLeft: 103, trackRight: 102, shift: 108,
  drumPads: [36, 37, 38, 39, 44, 45, 46, 47, 40, 41, 42, 43, 48, 49, 50, 51], // bottom row then top row
};
export const PAD_MODES = ['MUTES', 'SCENES', 'PATTERNS', 'FX', 'STEPS'];
// Launchkey colour palette indexes (approximation of the 8 track colours)
const LK_TRACK_COL = [57, 9, 13, 17, 33, 41, 49, 53];

export class MidiManager {
  constructor(store) {
    this.store = store;
    this.access = null;
    this.inputs = []; this.outputs = [];
    this.monitor = [];
    this.learnTarget = null;
    this.mmSoloHeld = false;
    this.lkShift = false;
    this.pickup = new Map(); // targetKey -> waiting
    this.ledCache = new Map();
    this.status = 'non initialisé';
    this.listeners = new Set();
    this.lp = new LaunchpadDriver(this);
    this.detected = {}; this.lpKinds = {}; this.probed = new Set();
    store.on('pos', () => this.refreshLeds());
    store.on('mix', () => this.refreshLeds(true));
    store.on('track', () => this.refreshLeds(true));
    store.on('project', () => { this.pickup.clear(); this.refreshLeds(true); });
    store.on('scene', () => this.refreshLeds(true));
    this.fxOn = new Set();
    store.on('perf', (fx, on) => { on ? this.fxOn.add(fx) : this.fxOn.delete(fx); this.refreshLeds(true); });
    store.on('fill', () => this.refreshLeds(true));
    store.on('pattern', () => this.refreshLeds(true));
    store.on('transport', () => this.refreshLeds(true));
  }
  onChange(fn) { this.listeners.add(fn); }
  changed() { for (const f of this.listeners) f(); }

  async init() {
    if (!navigator.requestMIDIAccess) { this.status = 'WebMIDI indisponible'; this.changed(); return; }
    try {
      // SysEx is needed to put the Launchpad in Programmer mode
      try { this.access = await navigator.requestMIDIAccess({ sysex: true }); }
      catch { this.access = await navigator.requestMIDIAccess({ sysex: false }); }
      this.access.onstatechange = () => this.scan();
      this.status = 'OK';
      this.scan();
    } catch (e) { this.status = 'Accès MIDI refusé : ' + e.message; this.changed(); }
  }
  roleOf(port) {
    const o = this.store.settings.portRoles[port.name];
    return o || (this.detected && this.detected[port.name]) || guessRole(port.name);
  }
  scan() {
    if (!this.access) return;
    const prevOut = new Set(this.outputs.map((o) => o.port.id));
    this.inputs = []; this.outputs = [];
    this.portErrors = this.portErrors || {};
    for (const inp of this.access.inputs.values()) {
      if (inp.state === 'disconnected') continue;
      const role = this.roleOf(inp);
      inp.onmidimessage = (ev) => this.onMessage(inp, role, ev.data);
      this.inputs.push({ port: inp, role });
      this.openPort(inp);
    }
    for (const out of this.access.outputs.values()) {
      if (out.state === 'disconnected') continue;
      this.outputs.push({ port: out, role: this.roleOf(out) });
      this.openPort(out);
    }
    // Launchpad: Programmer mode on every newly seen output
    for (const o of this.outputs) {
      if ((o.role === 'launchpad' || o.role === 'launchpad-old') && !prevOut.has(o.port.id)) { const k = this.kindOf(o.port); this.lp.hello(o.port, k); }
    }
    // Launchkey: DAW mode on every newly seen DAW output
    for (const o of this.outputs) {
      if (o.role === 'lk-daw' && !prevOut.has(o.port.id) && this.store.settings.lkDawMode) this.lkDawMode(true, o.port);
    }
    this.ledCache.clear();
    this.refreshLeds(true);
    this.changed();
    this.probeIdentity();
  }
  diagnostic() {
    const L = [`Revolte · ${navigator.userAgent}`, `MIDI : ${this.status} · sysex ${this.access && this.access.sysexEnabled ? 'oui' : 'non'}`, ''];
    for (const x of this.inputs) L.push(`IN  « ${x.port.name} » rôle=${x.role} état=${x.port.state}/${x.port.connection} fabricant=${x.port.manufacturer || '?'}`);
    for (const x of this.outputs) L.push(`OUT « ${x.port.name} » rôle=${x.role} état=${x.port.state}/${x.port.connection}`);
    for (const p of this.lpOutputs()) L.push(`Launchpad « ${p.name} » protocole=${JSON.stringify(this.kindOf(p))} mode=${this.lp.mode}`);
    const errs = Object.entries(this.portErrors || {}); if (errs.length) L.push('', 'Erreurs :', ...errs.map(([k, v]) => `${k} : ${v}`));
    L.push('', 'Derniers messages reçus :', ...this.monitor.slice(0, 20));
    return L.join('\n');
  }
  lpOutputs() { return this.outputs.filter((o) => o.role === 'launchpad' || o.role === 'launchpad-old').map((o) => o.port); }
  kindOf(port) {
    if (this.roleOf(port) === 'launchpad-old') return { dev: 0, legacy: true };
    return this.lpKinds[port.name] || this.lpKinds[baseName(port.name)] || lpKind(port.name) || { dev: 0x0d, legacy: false };
  }
  // Ask unknown devices who they are (Universal Device Inquiry): a Launchpad is then recognised whatever
  // name Windows gives its ports.
  probeIdentity() {
    for (const o of this.outputs) {
      if (o.role !== 'keys' || this.probed.has(o.port.id)) continue;
      this.probed.add(o.port.id);
      try { o.port.send([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]); } catch { /* no SysEx permission */ }
    }
  }
  identity(port, data) {
    // F0 7E <dev> 06 02 <manufacturer 00 20 29 = Novation> <family lsb> <family msb> ...
    if (data.length < 10 || data[1] !== 0x7e || data[3] !== 0x06 || data[4] !== 0x02) return;
    if (!(data[5] === 0x00 && data[6] === 0x20 && data[7] === 0x29)) return;
    const fam = data[8];
    const dev = { 0x13: 0x0d, 0x03: 0x0c, 0x23: 0x0e }[fam];
    if (!dev) return; // not a Launchpad (Launchkey and others keep their name-based role)
    const base = baseName(port.name);
    const kind = { dev, legacy: false };
    this.lpKinds[base] = kind;
    let changed = false;
    for (const x of [...this.inputs, ...this.outputs]) {
      if (baseName(x.port.name) !== base || this.store.settings.portRoles[x.port.name]) continue;
      const role = 'launchpad';
      if (this.detected[x.port.name] !== role) { this.detected[x.port.name] = role; changed = true; }
    }
    if (changed) {
      this.store.toast(`Launchpad reconnu : « ${port.name} »`);
      for (const o of this.outputs) if (baseName(o.port.name) === base) this.probed.delete(o.port.id);
      // re-scan so the new roles apply, and send the Programmer-mode message
      const ids = new Set(this.lpOutputs().map((p) => p.id));
      this.scan();
      for (const p of this.lpOutputs()) if (!ids.has(p.id)) this.lp.hello(p, this.kindOf(p));
    }
  }
  // Windows: a MIDI port used by another application (Ableton, an editor…) cannot be opened
  openPort(port) {
    const key = (port.type === 'input' ? 'IN ' : 'OUT ') + port.name;
    port.open().then(() => {
      if (this.portErrors[key]) { delete this.portErrors[key]; this.changed(); }
    }).catch((e) => {
      this.portErrors[key] = e && e.message ? e.message : String(e);
      this.store.toast(`MIDI : impossible d'ouvrir « ${port.name} » (déjà utilisé par une autre application ?)`, 'error');
      this.changed();
    });
  }
  // summary for the top bar
  summary() {
    if (!this.access) return { ok: false, text: this.status === 'non initialisé' ? 'MIDI…' : 'MIDI ✕', title: this.status };
    const roles = new Set(this.inputs.map((i) => i.role));
    const parts = [];
    if (roles.has('midimix')) parts.push('MIDImix');
    if (roles.has('lk-keys') || roles.has('lk-daw')) parts.push('Launchkey');
    if (roles.has('launchpad') || roles.has('launchpad-old')) parts.push('Launchpad');
    const others = this.inputs.filter((i) => i.role === 'keys').length;
    if (others) parts.push(`+${others}`);
    const errs = Object.keys(this.portErrors || {}).length;
    return { ok: !errs && this.inputs.length > 0, text: 'MIDI ' + (parts.length ? parts.join(' · ') : 'aucun') + (errs ? ' ⚠' : ''), title: this.inputs.map((i) => `${i.port.name} → ${ROLES[i.role]}`).join('\n') + (errs ? '\n\nErreurs :\n' + Object.entries(this.portErrors).map(([k, v]) => k + ' : ' + v).join('\n') : '') || 'Aucune entrée MIDI' };
  }
  out(role) { return this.outputs.filter((o) => o.role === role).map((o) => o.port); }
  sendTo(role, bytes) { for (const p of this.out(role)) { try { p.send(bytes); } catch { /* port gone */ } } }
  lkDawMode(on, port = null) {
    const msg = [0x9f, 0x0c, on ? 0x7f : 0x00];
    if (port) { try { port.send(msg); } catch { } } else this.sendTo('lk-daw', msg);
    this.ledCache.clear();
    if (on) setTimeout(() => this.refreshLeds(true), 150);
  }
  shutdown() {
    for (const p of this.lpOutputs()) this.lp.goodbye(p, this.kindOf(p));
    if (this.store.settings.lkDawMode) this.lkDawMode(false);
    for (let i = 0; i < 27; i++) this.sendTo('midimix', [0x90, i, 0]);
  }

  // ------------------------------------------------------------------ incoming
  onMessage(port, role, data) {
    const st = data[0] & 0xf0, ch = data[0] & 0x0f, d1 = data[1], d2 = data[2];
    if (data[0] === 0xf0) { this.identity(port, data); return; }
    if (data[0] >= 0xf8) return; // realtime
    const type = st === 0x90 && d2 > 0 ? 'on' : st === 0x80 || (st === 0x90 && d2 === 0) ? 'off' : st === 0xb0 ? 'cc' : st === 0xe0 ? 'pb' : st === 0xd0 ? 'at' : 'other';
    if (this.onActivity) this.onActivity(role);
    this.monitor.unshift(`${port.name.slice(0, 22)} · ${type.toUpperCase()} ch${ch + 1} ${d1 ?? ''} ${d2 ?? ''}`);
    if (this.monitor.length > 30) this.monitor.length = 30;
    this.changed();
    // MIDI learn
    if (this.learnTarget && (type === 'cc')) {
      const m = { port: port.name, type: 'cc', ch, num: d1, target: this.learnTarget };
      const L = this.store.settings.midiLearn.filter((x) => !(x.port === m.port && x.ch === ch && x.num === d1 && x.type === 'cc'));
      L.push(m); this.store.settings.midiLearn = L;
      this.store.toast(`MIDI Learn : CC${d1} (ch${ch + 1}) → ${this.learnTarget.label || this.learnTarget.id}`);
      this.learnTarget = null; this.store.emit('learnDone'); this.changed();
      return;
    }
    if (type === 'cc') {
      const learned = this.store.settings.midiLearn.find((x) => x.type === 'cc' && x.num === d1 && x.ch === ch && (x.port === port.name || x.port === '*'));
      if (learned) { this.applyCC(learned.target, d2, `L${d1}`); return; }
    }
    if (role === 'ignore') return;
    if (role === 'midimix') return this.midimix(type, ch, d1, d2);
    if (role === 'launchpad' || role === 'launchpad-old') { const k = this.kindOf(port); return this.lp.handle(this.lp.decode(type, ch, d1, d2, k.legacy)); }
    if (role === 'lk-daw') return this.launchkey(type, ch, d1, d2, true);
    if (role === 'lk-keys') return this.launchkey(type, ch, d1, d2, false);
    return this.keyboard(type, ch, d1, d2);
  }

  applyCC(target, val, srcKey, pickupOk = true) {
    const s = this.store;
    const def = s.def(target); if (!def) return;
    const n = val / 127;
    if (s.settings.pickup && pickupOk) {
      const cur = toNorm(def, s.get(target));
      const key = srcKey + JSON.stringify(target);
      const last = this.pickup.get(key);
      if (last === undefined || (Math.abs(n - cur) > 0.04 && !((last - cur) * (n - cur) <= 0))) {
        this.pickup.set(key, n);
        if (Math.abs(n - cur) > 0.04) return;
      }
      this.pickup.set(key, n);
    }
    s.set(target, fromNorm(def, n));
  }

  keyboard(type, ch, d1, d2) {
    const s = this.store;
    if (type === 'on') { this.lastNote = d1; s.liveNote(s.selTrack, d1, d2 / 127, true); }
    else if (type === 'off') s.liveNote(s.selTrack, d1, 0, false);
    else if (type === 'cc' && d1 === 1) s.send({ type: 'modw', t: s.selTrack, v: d2 / 127 });
    else if (type === 'cc' && d1 === 64 && d2 < 64) { /* sustain release: no-op */ }
  }

  // ------------------------------------------------------------------ Akai MIDImix
  midimix(type, ch, d1, d2) {
    const s = this.store, M = MIDIMIX;
    if (type === 'cc') {
      let t;
      if ((t = M.fader.indexOf(d1)) >= 0) return this.applyCC({ scope: 'mix', t, id: 'vol' }, d2, 'mm' + d1);
      if (d1 === M.master) return this.applyCC({ scope: 'fx', id: 'mvol' }, d2, 'mm' + d1);
      for (const [row, ki] of [[M.k1, 0], [M.k2, 1], [M.k3, 2]]) {
        if ((t = row.indexOf(d1)) >= 0) {
          const tr = s.trackAt(t);
          const spec = tr.stripKnobs[ki]; if (!spec) return;
          return this.applyCC(stripTarget(tr, t, spec), d2, 'mm' + d1);
        }
      }
      return;
    }
    if (type === 'on') {
      let t;
      if (d1 === M.soloBtn) { this.mmSoloHeld = true; return; }
      if ((t = M.mute.indexOf(d1)) >= 0) { s.toggleMute(t); return; }
      if ((t = M.solo.indexOf(d1)) >= 0) { s.toggleSolo(t); return; }
      if ((t = M.arm.indexOf(d1)) >= 0) {
        if (this.mmSoloHeld || s.selTrack === t) s.arm(t); else s.selectTrack(t);
        return;
      }
      if (d1 === M.bankL || d1 === M.bankR) {
        const d = d1 === M.bankL ? -1 : 1;
        if (this.mmSoloHeld) { s.selectSong(Math.max(0, Math.min(s.project.songs.length - 1, s.songIdx + d)), s.playing); return; }
        const cur = s.lastScene ?? -1;
        let i = cur;
        for (let k = 0; k < 16; k++) { i = (i + d + 16) % 16; if (s.song.scenes[i]) break; }
        s.launchScene(i);
      }
    }
    if (type === 'off' && d1 === M.soloBtn) this.mmSoloHeld = false;
  }

  // ------------------------------------------------------------------ Novation Launchkey Mini
  launchkey(type, ch, d1, d2, dawPort) {
    const s = this.store;
    if (type === 'cc') {
      const k = LK.knobs.indexOf(d1);
      if (k >= 0) {
        const tr = s.track; const ids = perfKnobIds(tr);
        if (ids[k]) this.applyCC({ scope: 'sound', t: s.selTrack, id: ids[k] }, d2, 'lk' + d1);
        return;
      }
      if (d1 === LK.play) { if (d2 > 0) s.togglePlay(); return; }
      if (d1 === LK.rec) { if (d2 > 0) s.toggleRec(); return; }
      if (d1 === LK.shift) { this.lkShift = d2 > 0; return; }
      if (d1 === LK.sceneLaunch) {
        if (d2 > 0) {
          const i = PAD_MODES.indexOf(s.settings.lkPadMode);
          s.settings.lkPadMode = PAD_MODES[(i + (this.lkShift ? PAD_MODES.length - 1 : 1)) % PAD_MODES.length];
          s.toast('Pads Launchkey : ' + s.settings.lkPadMode);
          this.refreshLeds(true); this.changed();
        }
        return;
      }
      if (d1 === LK.stopSoloMute) { s.setFill(d2 > 0); return; }
      if (d1 === LK.trackLeft && d2 > 0) { s.selectTrack(Math.max(0, s.selTrack - 1)); return; }
      if (d1 === LK.trackRight && d2 > 0) { s.selectTrack(Math.min(7, s.selTrack + 1)); return; }
      if (d1 === 1) { s.send({ type: 'modw', t: s.selTrack, v: d2 / 127 }); return; }
      return;
    }
    if (type !== 'on' && type !== 'off') return;
    // session pads (DAW mode)
    let pad = LK.padsTop.indexOf(d1);
    if (pad < 0) { const b = LK.padsBottom.indexOf(d1); if (b >= 0) pad = 8 + b; }
    if (dawPort && pad >= 0 && ch === 0) return this.pad(pad, type === 'on', d2);
    // drum pads (channel 10)
    if (ch === 9) {
      const i = LK.drumPads.indexOf(d1);
      if (i >= 0) {
        const t = s.isDrum(s.selTrack) ? s.selTrack : s.song.tracks.findIndex((x) => x.kind === 'drum');
        if (t >= 0) s.liveNote(t, i % 8, d2 / 127, type === 'on', 'lane');
        return;
      }
    }
    if (dawPort) return; // DAW port: nothing else plays notes
    // keys
    if (type === 'on') { this.lastNote = d1; s.liveNote(s.selTrack, d1, d2 / 127, true); } else s.liveNote(s.selTrack, d1, 0, false);
  }

  pad(i, on, vel) {
    const s = this.store;
    const mode = s.settings.lkPadMode;
    switch (mode) {
      case 'MUTES':
        if (!on) return;
        if (i < 8) { if (this.lkShift) s.toggleSolo(i); else s.toggleMute(i); } else s.selectTrack(i - 8);
        break;
      case 'SCENES':
        if (on) this.lkShift ? s.storeScene(i) : s.launchScene(i);
        break;
      case 'PATTERNS':
        if (on) s.launch(s.selTrack, i, this.lkShift ? 'NOW' : s.song.launchQuant);
        break;
      case 'FX':
        if (i < 14) s.perf(i, on);
        else if (i === 14) s.setFill(on);
        else s.throwFx('dly', on);
        break;
      case 'STEPS': {
        if (!on) return;
        const t = s.selTrack;
        const p = s.pattern(t, true);
        const page = this.stepPage(t);
        const idx = page * 16 + i;
        if (idx >= p.length) return;
        const drum = s.isDrum(t);
        const lane = drum ? s.lane : 0;
        s.editPattern(t, 'pas', (pp) => {
          const cur = pp.lanes[lane][idx];
          if (cur) pp.lanes[lane][idx] = undefined;
          else pp.lanes[lane][idx] = newStep(drum, this.lastNote ?? (s.track.kind === 'bass' ? 36 : 60), Math.max(0.3, vel / 127));
        });
        break;
      }
    }
    this.refreshLeds(true);
  }
  stepPage(t) {
    const s = this.store, p = s.pattern(t);
    if (!p) return 0;
    if (s.playing && s.pos) return Math.floor(s.pos.tracks[t].step / 16);
    return this.manualPage || 0;
  }

  // ------------------------------------------------------------------ LED feedback
  led(role, status, note, val) {
    const key = role + ':' + status + ':' + note;
    if (this.ledCache.get(key) === val) return;
    this.ledCache.set(key, val);
    this.sendTo(role, [status, note, val]);
  }
  refreshLeds(force = false) {
    const now = performance.now();
    if (!force && now - (this._ledT || 0) < 60) return;
    this._ledT = now;
    if (!this.outputs.length) return;
    const s = this.store, M = MIDIMIX;
    // MIDImix
    if (this.out('midimix').length) {
      s.song.tracks.forEach((tr, t) => {
        this.led('midimix', 0x90, M.mute[t], tr.mix.mute ? 127 : 0);
        this.led('midimix', 0x90, M.solo[t], tr.mix.solo ? 127 : 0);
        this.led('midimix', 0x90, M.arm[t], s.selTrack === t || s.armed === t ? 127 : 0);
      });
    }
    // Launchkey pads
    // Launchpad
    for (const p of this.lpOutputs()) this.lp.paint(p, this.kindOf(p));
    if (!this.out('lk-daw').length || !s.settings.lkDawMode) return;
    const mode = s.settings.lkPadMode;
    const pos = s.pos;
    const pads = [...LK.padsTop, ...LK.padsBottom];
    const set = (i, col, anim = 0) => { // anim 0 static, 1 flash, 2 pulse
      const note = pads[i];
      const prev = this.ledCache.get('lkpad' + i);
      const v = anim * 1000 + col;
      if (prev === v) return;
      this.ledCache.set('lkpad' + i, v);
      if (anim) this.sendTo('lk-daw', [0x90, note, 0]);
      this.sendTo('lk-daw', [0x90 + anim, note, col]);
    };
    for (let i = 0; i < 16; i++) {
      let col = 0, anim = 0;
      switch (mode) {
        case 'MUTES':
          if (i < 8) col = s.song.tracks[i].mix.mute ? 7 : LK_TRACK_COL[i];
          else col = s.selTrack === i - 8 ? 3 : LK_TRACK_COL[i - 8] + 2;
          break;
        case 'SCENES':
          col = s.song.scenes[i] ? (s.lastScene === i ? 21 : 45) : 0;
          break;
        case 'PATTERNS': {
          const tr = s.track, t = s.selTrack;
          const tp = pos && pos.tracks[t];
          col = tr.patterns[i] ? (tr.cur === i ? LK_TRACK_COL[t] : LK_TRACK_COL[t] + 2) : 0;
          if (tp && tp.pend === i) { col = 3; anim = 1; }
          break;
        }
        case 'FX':
          col = i < 14 ? (this.fxOn.has(i) ? 5 : 11) : i === 14 ? (s.fill ? 13 : 15) : 41;
          break;
        case 'STEPS': {
          const t = s.selTrack, p = s.pattern(t);
          const page = this.stepPage(t);
          const idx = page * 16 + i;
          if (!p || idx >= p.length) { col = 0; break; }
          const lane = s.isDrum(t) ? s.lane : 0;
          col = p.lanes[lane] && p.lanes[lane][idx] ? LK_TRACK_COL[t] : 1;
          if (s.playing && pos && pos.tracks[t].step === idx) col = 3;
          break;
        }
      }
      set(i, col, anim);
    }
  }
}

// "MIDIIN2 (LPMiniMK3 MIDI)" / "LPMiniMK3 MIDI" -> "lpminimk3"
export function baseName(name) {
  return (name || '').toLowerCase().replace(/^midi(in|out)\d*\s*\((.*)\)$/, '$2').replace(/\b(midi|in|out|port|daw)\b/g, '').replace(/[^a-z0-9]/g, '');
}
