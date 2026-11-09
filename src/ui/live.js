// Revolte — LIVE page: everything playable at once, no menu diving
import { h, clear, Knob, Fader, button, momentary, selectField, modal, prompt2 } from './widgets.js';
import { PATTERN_NAMES, PERF_KNOBS, LAUNCH_QUANT, soundParamDefs, MIX_PARAMS, paramDef } from '../shared/params.js';
import { PERF_FX } from '../engine/fx.js';

export function stripTarget(tr, t, spec) {
  if (spec.startsWith('mix:')) return { scope: 'mix', t, id: spec.slice(4) };
  return { scope: 'sound', t, id: spec };
}
export function perfKnobIds(tr) {
  return tr.kind === 'drum' ? PERF_KNOBS.drum : PERF_KNOBS[tr.sound.engine] || PERF_KNOBS.ANALOG;
}

export class LivePage {
  constructor(store) {
    this.store = store;
    this.el = h('div', { class: 'page live' });
    this.strips = h('div', { class: 'strips' });
    this.scenes = h('div', { class: 'scenes panel' });
    this.perfKnobs = h('div', { class: 'perf-knobs panel' });
    this.master = h('div', { class: 'live-master panel' });
    this.fxPads = h('div', { class: 'fx-pads panel' });
    this.el.append(this.strips, this.scenes, this.perfKnobs, this.master, this.fxPads);
    const s = store;
    s.on('project', () => this.render());
    s.on('sound', () => { this.renderStrips(); this.renderPerfKnobs(); });
    s.on('track', () => { this.updateStrips(); this.renderPerfKnobs(); });
    s.on('pos', () => this.updateStrips());
    s.on('cur', () => this.updateStrips());
    s.on('mix', () => this.updateStrips());
    s.on('transport', () => this.updateStrips());
    s.on('scene', () => this.renderScenes());
    s.on('perf', (fx, on) => { const b = this.fxBtns && this.fxBtns[fx]; if (b) b.classList.toggle('on', on); });
    s.on('fill', () => this.fillBtn && this.fillBtn.classList.toggle('on', s.fill));
    this.render();
  }
  render() { this.renderStrips(); this.renderScenes(); this.renderPerfKnobs(); this.renderMaster(); this.renderFx(); }

  renderStrips() {
    const s = this.store;
    const el = clear(this.strips);
    this.stripEls = s.song.tracks.map((tr, t) => {
      const pads = h('div', { class: 'pads' });
      const padEls = PATTERN_NAMES.map((n, i) => {
        const b = h('button', { class: 'pad', style: { '--tc': tr.color }, title: `Lancer ${n} (quantisation ${s.song.launchQuant})`, onclick: (e) => s.launch(t, i, e.shiftKey ? 'NOW' : s.song.launchQuant) }, n);
        pads.append(b); return b;
      });
      const knobs = h('div', { class: 'strip-knobs' }, ...tr.stripKnobs.map((spec, ki) => {
        const target = stripTarget(tr, t, spec);
        const def = s.def(target);
        if (!def) return h('div', { class: 'knob empty' });
        const k = new Knob(s, target, { size: 40, color: tr.color, undo: false });
        k.el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.assignStripKnob(t, ki); });
        k.el.title += ' — clic droit : réassigner';
        return k.el;
      }));
      const fader = new Fader(s, { scope: 'mix', t, id: 'vol' }, { meter: true, color: tr.color, db: true });
      const mute = h('button', { class: 'big-btn mute', onpointerdown: (e) => { if (e.altKey) { s.cut(t, true); mute.classList.add('cut'); } else s.toggleMute(t); }, onpointerup: () => { if (mute.classList.contains('cut')) { s.cut(t, false); mute.classList.remove('cut'); } }, title: 'Mute (Alt maintenu = coupure momentanée)' }, 'MUTE');
      const solo = button('SOLO', () => s.toggleSolo(t), 'solo-btn');
      const sel = button('SEL', () => s.selectTrack(t), 'sel-btn', 'Sélectionner (potards du Launchkey, clavier)');
      const arm = button('●', () => s.arm(t), 'arm-btn', 'Armer pour l\'enregistrement');
      const strip = h('div', { class: 'strip', style: { '--tc': tr.color } },
        h('div', { class: 'strip-head', onclick: () => s.selectTrack(t) }, h('span', { class: 'num' }, t + 1), h('span', { class: 'name' }, tr.name), h('div', { class: 'sound' }, tr.kind === 'drum' ? tr.sound.name : `${tr.sound.engine} · ${tr.sound.name}`)),
        h('div', { class: 'step-dots' }),
        pads, knobs,
        h('div', { class: 'strip-low' }, fader.el, h('div', { class: 'strip-btns' }, mute, solo, h('div', { class: 'row' }, sel, arm))));
      el.append(strip);
      return { strip, padEls, fader, mute, solo, sel, arm, dots: strip.querySelector('.step-dots') };
    });
    this.updateStrips();
  }
  updateStrips() {
    const s = this.store; if (!this.stripEls) return;
    const pos = s.pos;
    this.stripEls.forEach((x, t) => {
      const tr = s.song.tracks[t];
      const tp = pos && pos.tracks[t];
      x.padEls.forEach((b, i) => {
        b.classList.toggle('full', !!tr.patterns[i]);
        b.classList.toggle('cur', tr.cur === i && !(tp && tp.rest));
        b.classList.toggle('pend', !!tp && tp.pend === i);
      });
      x.mute.classList.toggle('on', !!tr.mix.mute);
      x.mute.classList.toggle('pending', !!tp && tp.pmute !== null && tp.pmute !== undefined);
      x.solo.classList.toggle('on', !!tr.mix.solo);
      x.sel.classList.toggle('on', s.selTrack === t);
      x.arm.classList.toggle('on', s.armed === t);
      x.strip.classList.toggle('selected', s.selTrack === t);
      x.strip.classList.toggle('muted', !!tr.mix.mute);
      x.fader.setMeter(tp ? tp.peak * 1.4 : 0);
      // step position as a progress bar
      const p = tr.patterns[tr.cur];
      const frac = tp && p && s.playing ? (tp.step + 1) / p.length : 0;
      x.dots.style.setProperty('--prog', (frac * 100).toFixed(1) + '%');
    });
  }
  assignStripKnob(t, ki) {
    const s = this.store, tr = s.trackAt(t);
    const opts = [...soundParamDefs(tr.kind, tr.sound.engine).map((d) => [d.id, 'SON · ' + d.label]), ...MIX_PARAMS.map((d) => ['mix:' + d.id, 'MIX · ' + d.label])];
    const sel = h('select', {}, ...opts.map(([v, l]) => h('option', { value: v, selected: v === tr.stripKnobs[ki] }, l)));
    modal(`Potard ${ki + 1} de ${tr.name} (MIDImix)`, sel, [['Assigner', () => { tr.stripKnobs[ki] = sel.value; s.markDirty(); this.renderStrips(); }, 'primary']]);
  }

  renderScenes() {
    const s = this.store;
    const el = clear(this.scenes);
    el.append(h('div', { class: 'panel-title' }, 'SCÈNES', h('span', { class: 'hint' }, 'Maj+clic : mémoriser · clic droit : renommer')));
    const grid = h('div', { class: 'scene-grid' });
    s.song.scenes.forEach((sc, i) => {
      grid.append(h('button', {
        class: 'scene' + (sc ? ' full' : '') + (s.lastScene === i ? ' last' : ''),
        onclick: (e) => (e.shiftKey ? s.storeScene(i) : s.launchScene(i)),
        oncontextmenu: (e) => { e.preventDefault(); if (sc) prompt2('Nom de la scène', sc.name, (v) => { sc.name = v.slice(0, 12).toUpperCase(); s.markDirty(); this.renderScenes(); }); },
        title: sc ? sc.name : 'vide',
      }, h('b', {}, i + 1), h('span', {}, sc ? sc.name : '—')));
    });
    el.append(grid,
      selectField('LANCEMENT', LAUNCH_QUANT, s.song.launchQuant, (v) => { s.song.launchQuant = v; s.markDirty(); }),
      selectField('MUTES', LAUNCH_QUANT.map((q) => [q, q === 'LOOP' ? 'FIN DE BOUCLE' : q]), s.settings.muteQuant, (v) => { s.settings.muteQuant = v; }));
  }

  renderPerfKnobs() {
    const s = this.store, t = s.selTrack, tr = s.track;
    const el = clear(this.perfKnobs);
    el.style.setProperty('--tc', tr.color);
    el.append(h('div', { class: 'panel-title' }, h('span', { style: { color: tr.color } }, `${t + 1} · ${tr.name}`), h('span', { class: 'hint' }, 'potards Launchkey 1–8')));
    const ids = perfKnobIds(tr);
    el.append(h('div', { class: 'knobs' }, ...ids.map((id) => paramDef(tr.kind, tr.sound.engine, id) ? new Knob(s, { scope: 'sound', t, id }, { size: 58, big: true, color: tr.color, undo: false }).el : null)));
    el.append(h('div', { class: 'knobs small' },
      new Knob(s, { scope: 'mix', t, id: 'dly' }, { color: tr.color, undo: false }).el,
      new Knob(s, { scope: 'mix', t, id: 'rev' }, { color: tr.color, undo: false }).el,
      new Knob(s, { scope: 'mix', t, id: 'damt' }, { color: tr.color, undo: false }).el,
      new Knob(s, { scope: 'mix', t, id: 'pan' }, { color: tr.color, undo: false }).el,
      tr.kind !== 'drum' ? new Knob(s, { scope: 'play', t, id: 'arp' }, { color: tr.color, undo: false }).el : null,
      tr.kind !== 'drum' ? new Knob(s, { scope: 'play', t, id: 'transp' }, { color: tr.color, undo: false }).el : null,
    ));
  }

  renderMaster() {
    const s = this.store;
    const el = clear(this.master);
    const k = (id, o = {}) => new Knob(s, { scope: 'fx', id }, { undo: false, ...o }).el;
    el.append(h('div', { class: 'panel-title' }, 'MASTER'),
      h('div', { class: 'knobs' }, k('mfilt', { size: 72, big: true, color: '#fff' }), k('mres'), k('mcrush'), k('mdrive'), k('throw'), k('pdepth'), k('dlfb'), k('rvsize'), k('mvol', { size: 58, big: true })));
  }

  renderFx() {
    const s = this.store;
    const el = clear(this.fxPads);
    el.append(h('div', { class: 'panel-title' }, 'FX PERFORMANCE', h('span', { class: 'hint' }, 'maintenir · Maj+clic = verrouiller')));
    const grid = h('div', { class: 'fx-grid' });
    this.fxBtns = PERF_FX.map((name, i) => {
      const b = momentary(name, () => s.perf(i, true), () => s.perf(i, false), 'fx');
      grid.append(b); return b;
    });
    const thr = h('div', { class: 'fx-grid throws' }, ...[['cut', 'THROW CUTOFF'], ['rev', 'THROW REVERB'], ['dly', 'THROW DELAY'], ['dist', 'THROW DIST']].map(([w, l]) =>
      momentary(l, () => s.throwFx(w, true), () => s.throwFx(w, false), 'throw', 'Retour en douceur sur une mesure au relâchement')));
    this.fillBtn = momentary('FILL', () => s.setFill(true), () => s.setFill(false), 'fill', 'Active les pas conditionnés FILL');
    el.append(grid, thr, this.fillBtn);
  }
}
