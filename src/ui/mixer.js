// Revolte — MIX & FX page: track mixer, send effects, master chain
import { h, clear, Knob, Fader, EnumSelect, button } from './widgets.js';
import { FX_PARAMS } from '../shared/params.js';

export class MixerPage {
  constructor(store) {
    this.store = store;
    this.el = h('div', { class: 'page mixer' });
    store.on('project', () => this.render());
    store.on('mix', () => this.update());
    store.on('pos', () => this.meters());
    store.on('sound', () => this.render());
    this.render();
  }
  render() {
    const s = this.store;
    const el = clear(this.el);
    const strips = h('div', { class: 'mix-strips panel' });
    this.chs = s.song.tracks.map((tr, t) => {
      const k = (id) => new Knob(s, { scope: 'mix', t, id }, { size: 38, color: tr.color }).el;
      const fader = new Fader(s, { scope: 'mix', t, id: 'vol' }, { meter: true, color: tr.color, db: true });
      const mute = button('M', () => s.toggleMute(t), 'tiny mute');
      const solo = button('S', () => s.toggleSolo(t), 'tiny solo');
      const ch = h('div', { class: 'mix-ch', style: { '--tc': tr.color } },
        h('div', { class: 'mix-name', onclick: () => s.selectTrack(t) }, `${t + 1} ${tr.name}`),
        h('div', { class: 'mix-sub' }, 'SENDS'), h('div', { class: 'mix-row' }, k('cho'), k('dly'), k('rev')),
        h('div', { class: 'mix-sub' }, 'INSERT'), new EnumSelect(s, { scope: 'mix', t, id: 'dtype' }, { label: '' }).el, h('div', { class: 'mix-row' }, k('damt'), k('dtone')),
        h('div', { class: 'mix-sub' }, 'DUCK (sidechain)'), h('div', { class: 'mix-row' }, k('duck'), k('dsrc'), k('drel')),
        h('div', { class: 'mix-row grow' }, h('div', { class: 'col' }, k('pan'), h('div', { class: 'row' }, mute, solo)), fader.el));
      strips.append(ch);
      return { ch, fader, mute, solo };
    });
    const groups = new Map();
    for (const d of FX_PARAMS) { if (!groups.has(d.group)) groups.set(d.group, []); groups.get(d.group).push(d); }
    const fxPanel = h('div', { class: 'fx-panel panel' });
    for (const [g, ds] of groups) {
      if (g === 'PERF') continue;
      fxPanel.append(h('div', { class: 'group' + (g.startsWith('MASTER') || g === 'COMP' ? ' master' : '') }, h('div', { class: 'group-title' }, g),
        h('div', { class: 'knobs' }, ...ds.map((d) => new Knob(s, { scope: 'fx', id: d.id }, { size: 44 }).el))));
    }
    this.mMeter = h('div', { class: 'master-meter' }, h('div', { class: 'mm-l' }), h('div', { class: 'mm-r' }), h('div', { class: 'mm-gr' }));
    fxPanel.append(h('div', { class: 'group' }, h('div', { class: 'group-title' }, 'SORTIE'), this.mMeter));
    el.append(strips, fxPanel);
    this.update();
  }
  update() {
    const s = this.store; if (!this.chs) return;
    this.chs.forEach((c, t) => { const tr = s.song.tracks[t]; c.mute.classList.toggle('on', !!tr.mix.mute); c.solo.classList.toggle('on', !!tr.mix.solo); c.ch.classList.toggle('sel', s.selTrack === t); });
  }
  meters() {
    const s = this.store, p = s.pos; if (!p || !this.chs || !this.el.isConnected) return;
    this.chs.forEach((c, t) => c.fader.setMeter(p.tracks[t].peak * 1.4));
    const [l, r] = p.master;
    this.mMeter.children[0].style.height = Math.min(100, l * 100) + '%';
    this.mMeter.children[1].style.height = Math.min(100, r * 100) + '%';
    this.mMeter.children[2].style.height = Math.min(100, (p.gr || 0) * 5) + '%';
  }
}
