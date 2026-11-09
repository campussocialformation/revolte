// Revolte — STUDIO page: compose and edit (tracks, patterns, steps, sounds)
import { h, clear, Knob, EnumSelect, button, numberField, selectField, modal, prompt2, refreshAll } from './widgets.js';
import { GridEditor, LaneEditor } from './grid.js';
import { Tools, copySteps, pasteSteps } from './tools.js';
import { PATTERN_NAMES, RESOLUTIONS, DIRECTIONS, CONDITIONS, MAX_STEPS, ENGINES, soundParamDefs, DRUM_MODELS, LANE_PARAM_DEFS, ARP_PARAMS, PLAY_PARAMS, SCALES, NOTE_NAMES, noteName, paramDef, formatParam, MIX_PARAMS } from '../shared/params.js';
import { FACTORY_SOUNDS, DRUM_KITS, SOUND_TYPES } from '../shared/presets.js';
import { clone, emptyPattern, newStep } from '../shared/model.js';

export function trackList(store, { compact = false } = {}) {
  const el = h('div', { class: 'tracklist' });
  const rows = [];
  const render = () => {
    clear(el); rows.length = 0;
    store.song.tracks.forEach((tr, i) => {
      const meter = h('div', { class: 'tl-meter' }, h('div', { class: 'tl-meter-in' }));
      const pat = h('span', { class: 'tl-pat' });
      const m = button('M', (e) => { e.stopPropagation(); store.toggleMute(i); }, 'tiny mute' + (tr.mix.mute ? ' on' : ''), 'Mute');
      const s = button('S', (e) => { e.stopPropagation(); store.toggleSolo(i); }, 'tiny solo' + (tr.mix.solo ? ' on' : ''), 'Solo');
      const r = button('●', (e) => { e.stopPropagation(); store.arm(i); }, 'tiny arm' + (store.armed === i ? ' on' : ''), 'Armer pour l\'enregistrement');
      const row = h('div', { class: 'tl-row' + (store.selTrack === i ? ' sel' : ''), style: { '--tc': tr.color }, onclick: () => store.selectTrack(i), ondblclick: () => prompt2('Nom de la piste', tr.name, (v) => { tr.name = v.slice(0, 16).toUpperCase(); store.markDirty(); render(); }) },
        h('div', { class: 'tl-color' }),
        h('div', { class: 'tl-main' },
          h('div', { class: 'tl-name' }, h('span', { class: 'tl-num' }, i + 1), tr.name, pat),
          compact ? null : h('div', { class: 'tl-sound' }, tr.kind === 'drum' ? 'KIT · ' + (tr.sound.name || '') : `${tr.sound.engine} · ${tr.sound.name || ''}`),
          meter),
        h('div', { class: 'tl-btns' }, m, s, r));
      rows.push({ row, meter: meter.firstChild, pat, m, s, r });
      el.append(row);
    });
    updatePos();
  };
  const updatePos = () => {
    const pos = store.pos;
    rows.forEach((r, i) => {
      const tr = store.song.tracks[i];
      const tp = pos && pos.tracks[i];
      r.meter.style.width = Math.min(100, (tp ? tp.peak : 0) * 140) + '%';
      const pend = tp && tp.pend >= 0 ? '→' + PATTERN_NAMES[tp.pend] : '';
      r.pat.textContent = (tp && tp.rest ? '—' : PATTERN_NAMES[tr.cur]) + pend;
      r.m.classList.toggle('on', !!tr.mix.mute);
      r.s.classList.toggle('on', !!tr.mix.solo);
      r.r.classList.toggle('on', store.armed === i);
      r.row.classList.toggle('sel', store.selTrack === i);
    });
  };
  store.on('project', render); store.on('track', updatePos); store.on('mix', updatePos); store.on('pos', updatePos); store.on('transport', updatePos); store.on('sound', render); store.on('cur', updatePos);
  render();
  return el;
}

export class StudioPage {
  constructor(store) {
    this.store = store;
    this.grid = new GridEditor(store);
    this.lane = new LaneEditor(store, this.grid);
    this.patbar = h('div', { class: 'patbar' });
    this.inspector = h('div', { class: 'inspector panel' });
    this.bottomTab = 'son';
    this.bottom = h('div', { class: 'bottom panel' });
    this.el = h('div', { class: 'page studio' },
      h('aside', { class: 'left' }, trackList(store)),
      h('section', { class: 'center' }, this.patbar, this.grid.el, this.lane.el),
      this.inspector,
      this.bottom);
    const s = store;
    s.on('project', () => this.renderAll());
    s.on('track', () => { this.grid.centerOnNotes(); this.renderAll(); });
    s.on('pattern', (t) => { if (t === s.selTrack) { this.grid.invalidate(); this.lane.invalidate(); this.renderPatbar(); this.renderInspector(); } });
    s.on('steps', () => this.renderInspector());
    s.on('selection', () => { this.grid.invalidate(); this.lane.invalidate(); this.renderInspector(); });
    s.on('cur', (t) => { if (t === s.selTrack) { this.grid.invalidate(); this.lane.invalidate(); this.renderPatbar(); this.renderInspector(); } });
    s.on('pos', () => { if (s.playing) { this.grid.invalidate(); this.updatePatbarPos(); } });
    s.on('transport', () => this.grid.invalidate());
    s.on('sound', (t) => { if (t === s.selTrack) { this.renderBottom(); this.grid.invalidate(); this.lane.rebuildOptions(); } });
    s.on('lane', () => { this.grid.invalidate(); this.lane.rebuildOptions(); this.lane.invalidate(); if (this.bottomTab === 'son') this.renderBottom(); });
    s.on('value', (target) => { if (target.scope === 'sound' && s.lockMode) { this.grid.invalidate(); this.renderInspector(); } });
    this.renderAll();
  }
  renderAll() { this.renderPatbar(); this.renderInspector(); this.renderBottom(); this.lane.rebuildOptions(); this.grid.invalidate(); this.lane.invalidate(); }

  // ------------------------------------------------------------------ pattern bar
  renderPatbar() {
    const s = this.store, t = s.selTrack, tr = s.track, p = s.pattern(t);
    const el = clear(this.patbar);
    const slots = h('div', { class: 'slots' });
    this.slotEls = PATTERN_NAMES.map((n, i) => {
      const b = h('button', {
        class: 'slot' + (tr.patterns[i] ? ' full' : '') + (tr.cur === i ? ' cur' : ''), style: { '--tc': tr.color },
        title: `Pattern ${n} — clic : jouer/éditer · clic droit : copier/coller/effacer`,
        onclick: () => s.launch(t, i, s.playing ? s.song.launchQuant : 'NOW'),
        oncontextmenu: (e) => { e.preventDefault(); this.slotMenu(i); },
      }, n);
      slots.append(b); return b;
    });
    el.append(h('div', { class: 'pb-title', style: { color: tr.color } }, `${t + 1} · ${tr.name}`), slots);
    if (!p) {
      el.append(button('+ Créer le pattern ' + PATTERN_NAMES[tr.cur], () => { s.pushUndo('pattern'); tr.patterns[tr.cur] = emptyPattern(tr.kind === 'drum'); s.sendPattern(t); s.emit('pattern', t, tr.cur); }, 'primary'));
      return;
    }
    const set = (label, fn) => { s.pushUndo(label); fn(); s.sendPattern(t); s.markDirty(); s.emit('pattern', t, tr.cur); };
    el.append(
      numberField('PAS', p.length, 1, MAX_STEPS, (v) => set('longueur', () => (p.length = v))),
      h('span', { class: 'bars' }, `${(p.length / 16).toFixed(p.length % 16 ? 2 : 0)} mes.`),
      selectField('RES', RESOLUTIONS.map((r) => r.id), p.res, (v) => set('résolution', () => (p.res = v))),
      numberField('SWING', p.swing ?? 50, 50, 75, (v) => set('swing', () => (p.swing = v))),
      selectField('DIR', DIRECTIONS, p.dir, (v) => set('direction', () => (p.dir = v))),
      numberField('GATE', p.gate ?? 100, 5, 200, (v) => set('gate', () => (p.gate = v)), 5),
      this.toolsMenu(),
    );
  }
  updatePatbarPos() {
    const s = this.store, tp = s.pos && s.pos.tracks[s.selTrack];
    if (!this.slotEls || !tp) return;
    this.slotEls.forEach((b, i) => { b.classList.toggle('cur', s.track.cur === i); b.classList.toggle('pend', tp.pend === i); });
  }
  slotMenu(i) {
    const s = this.store, t = s.selTrack, tr = s.track;
    const close = modal(`Pattern ${PATTERN_NAMES[i]} — ${tr.name}`, h('div', { class: 'col' },
      button('Copier', () => { s.patClip = { kind: tr.kind, pat: clone(tr.patterns[i]) }; s.toast('Pattern copié'); close(); }),
      button('Coller', () => { if (!s.patClip || (s.patClip.kind === 'drum') !== (tr.kind === 'drum')) { s.toast('Presse-papier incompatible'); return; } s.pushUndo('coller pattern'); tr.patterns[i] = clone(s.patClip.pat); s.sendPatterns(t); s.emit('pattern', t, i); close(); }),
      button('Dupliquer vers le prochain slot vide', () => { const j = tr.patterns.findIndex((x, k) => k > i && !x); if (j < 0) { s.toast('Aucun slot libre'); return; } s.pushUndo('dupliquer'); tr.patterns[j] = clone(tr.patterns[i]); s.sendPatterns(t); s.emit('pattern', t, j); this.renderPatbar(); close(); }),
      button('Effacer', () => { s.pushUndo('effacer pattern'); tr.patterns[i] = null; s.sendPatterns(t); s.emit('pattern', t, i); close(); }, 'danger'),
    ));
  }
  toolsMenu() {
    const s = this.store;
    const t = () => s.selTrack;
    const drum = () => s.isDrum(t());
    const lanes = () => (drum() && s.settings.toolsLaneOnly ? [s.lane] : null);
    const op = (label, fn) => () => s.editPattern(t(), label, (p, tr) => fn(p, tr));
    const wrap = h('div', { class: 'tools' },
      button('Effacer', op('effacer', (p) => Tools.clear(p, lanes())), 'small', 'Effacer le pattern (ou la lane)'),
      button('◀', op('décaler', (p) => Tools.shift(p, -1, lanes())), 'small', 'Décaler à gauche'),
      button('▶', op('décaler', (p) => Tools.shift(p, 1, lanes())), 'small', 'Décaler à droite'),
      button('Inverser', op('inverser', (p) => Tools.reverse(p, lanes())), 'small'),
      button('x2', op('doubler', (p) => { if (!Tools.double(p)) s.toast('128 pas maximum'); }), 'small', 'Doubler la longueur (copie)'),
      button('½', op('moitié', (p) => Tools.half(p)), 'small', 'Moitié de longueur'),
      button('Euclide', () => this.euclidDialog(), 'small'),
      button('Aléatoire', () => this.randomDialog(), 'small'),
      button('Humaniser', op('humaniser', (p) => Tools.humanize(p)), 'small'),
      button('TAKE', () => s.send({ type: 'take', t: t() }), 'small accent', 'Garder la dernière boucle jouée au clavier'),
    );
    if (!drum()) wrap.append(button('-12', op('transposer', (p) => Tools.transpose(p, -12)), 'small'), button('-1', op('transposer', (p) => Tools.transpose(p, -1)), 'small'), button('+1', op('transposer', (p) => Tools.transpose(p, 1)), 'small'), button('+12', op('transposer', (p) => Tools.transpose(p, 12)), 'small'));
    else {
      const cb = h('input', { type: 'checkbox', checked: !!s.settings.toolsLaneOnly, onchange: () => (s.settings.toolsLaneOnly = cb.checked) });
      wrap.append(h('label', { class: 'chk', title: 'Les outils n\'agissent que sur la lane sélectionnée' }, cb, 'lane seule'));
    }
    return wrap;
  }
  euclidDialog() {
    const s = this.store, t = s.selTrack, drum = s.isDrum(t);
    let k = 4, n = s.pattern(t)?.length || 16, r = 0, note = 48;
    const body = h('div', { class: 'col' },
      numberField('Coups', k, 1, 64, (v) => (k = v)), numberField('Pas', n, 1, 64, (v) => (n = v)), numberField('Rotation', r, 0, 63, (v) => (r = v)),
      drum ? h('div', {}, `Lane ${s.lane + 1}`) : numberField('Note', note, 0, 127, (v) => (note = v)));
    modal('Rythme euclidien', body, [['Appliquer', () => s.editPattern(t, 'euclide', (p) => Tools.euclid(p, drum ? s.lane : 0, Math.min(k, n), n, r % n, drum, note)), 'primary']]);
  }
  randomDialog() {
    const s = this.store, t = s.selTrack, drum = s.isDrum(t);
    let dens = 40, lo = s.track.kind === 'bass' ? 33 : 57, hi = lo + 14;
    const body = h('div', { class: 'col' }, numberField('Densité %', dens, 5, 100, (v) => (dens = v)),
      drum ? h('div', {}, `Lane ${s.lane + 1}`) : h('div', { class: 'row' }, numberField('Note basse', lo, 0, 127, (v) => (lo = v)), numberField('Note haute', hi, 0, 127, (v) => (hi = v))),
      h('div', { class: 'hint' }, `Notes dans la gamme ${NOTE_NAMES[s.song.scale.root]} ${s.song.scale.id}`));
    const go = (onlyNotes) => s.editPattern(t, 'aléatoire', (p) => Tools.random(p, { lane: drum ? s.lane : 0, isDrum: drum, density: dens / 100, scale: s.song.scale.id, root: s.song.scale.root, lo, hi, onlyNotes }));
    const acts = [['Générer', () => go(false), 'primary']];
    if (!drum) acts.push(['Seulement les hauteurs', () => go(true)]);
    modal('Aléatoire', body, acts);
  }

  // ------------------------------------------------------------------ step inspector
  renderInspector() {
    const s = this.store, t = s.selTrack, p = s.pattern(t), drum = s.isDrum(t);
    const el = clear(this.inspector);
    const keys = [...s.sel].filter((k) => p && p.lanes[Math.floor(k / 1000)] && p.lanes[Math.floor(k / 1000)][k % 1000]);
    el.append(h('div', { class: 'panel-title' }, 'PAS', h('span', { class: 'count' }, keys.length ? `${keys.length} sélectionné${keys.length > 1 ? 's' : ''}` : 'aucun')));
    const lockBtn = button('P-LOCK ' + (s.lockMode ? 'ON' : 'OFF'), () => { s.lockMode = !s.lockMode; this.renderInspector(); this.grid.invalidate(); }, 'lockbtn' + (s.lockMode ? ' on' : ''), 'Quand actif, les potards du son écrivent des verrous de paramètre dans les pas sélectionnés');
    const clipRow = h('div', { class: 'row wrap' },
      button('Copier', () => this.copy(), 'small'), button('Coller', () => this.paste(), 'small'), button('Suppr.', () => this.deleteSel(), 'small danger'), button('Tout', () => this.selectAll(), 'small'));
    if (!keys.length) {
      el.append(h('div', { class: 'hint' }, drum ? 'Clic gauche : poser/retirer un coup · clic droit : sélectionner · Maj+glisser : sélection' : 'Clic : poser une note (glisser = longueur) · clic droit : supprimer · Maj+glisser : sélection · Ctrl+molette : zoom'), clipRow, lockBtn);
      return;
    }
    const steps = keys.map((k) => p.lanes[Math.floor(k / 1000)][k % 1000]);
    const st0 = steps[0];
    const editAll = (label, fn) => { s.pushUndo(label); steps.forEach(fn); s.sendPattern(t); s.markDirty(); this.grid.invalidate(); this.lane.invalidate(); this.renderInspector(); };
    const k0 = keys[0];
    el.append(h('div', { class: 'insp-pos' }, drum ? `Lane ${Math.floor(k0 / 1000) + 1} · pas ${(k0 % 1000) + 1}` : `Pas ${(k0 % 1000) + 1}`));
    // notes of the first step
    if (!drum && st0.n) {
      const notes = h('div', { class: 'notes' });
      st0.n.forEach((n, ni) => {
        notes.append(h('div', { class: 'note-row' },
          numberField(noteName(n.p), n.p, 0, 127, (v) => { s.pushUndo('note'); n.p = v; s.sendPattern(t); this.grid.invalidate(); this.renderInspector(); }),
          numberField('LONG', n.l, 0.05, 128, (v) => { s.pushUndo('note'); n.l = v; s.sendPattern(t); this.grid.invalidate(); }, 0.25),
          numberField('VEL', Math.round((n.v ?? 0.8) * 127), 1, 127, (v) => { s.pushUndo('note'); n.v = v / 127; s.sendPattern(t); this.grid.invalidate(); this.lane.invalidate(); }),
          button('✕', () => editAll('note', () => { st0.n.splice(ni, 1); if (!st0.n.length) p.lanes[0][k0 % 1000] = undefined; }), 'tiny')));
      });
      if (st0.n.length < 4) notes.append(button('+ note (accord)', () => editAll('note', () => st0.n.push({ p: (st0.n[st0.n.length - 1]?.p ?? 60) + 4, l: st0.n[0]?.l ?? 1, v: 0.8 })), 'small'));
      el.append(notes);
    }
    if (drum) el.append(numberField('VÉLOCITÉ', Math.round((st0.v ?? 0.8) * 127), 1, 127, (v) => editAll('vélocité', (st) => (st.v = v / 127))));
    el.append(
      numberField('PROBA %', st0.prob ?? 100, 0, 100, (v) => editAll('proba', (st) => (st.prob = v)), 5),
      selectField('CONDITION', CONDITIONS.map((c) => [c.id, c.label || c.id]), st0.cond || 'ALL', (v) => editAll('condition', (st) => (st.cond = v))),
      selectField('RATCHET', [['1', 'x1'], ['2', 'x2'], ['3', 'x3'], ['4', 'x4'], ['5', 'FLAM']], st0.flam ? 5 : st0.rat || 1, (v) => editAll('ratchet', (st) => { st.flam = v === '5'; st.rat = v === '5' ? 1 : +v; })),
      numberField('NUDGE /64', st0.ndg || 0, -32, 31, (v) => editAll('nudge', (st) => (st.ndg = v))),
      h('div', { class: 'row' },
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!st0.acc, onchange: (e) => editAll('accent', (st) => (st.acc = e.target.checked)) }), 'ACCENT'),
        drum ? null : h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!st0.sl, onchange: (e) => editAll('slide', (st) => (st.sl = e.target.checked)) }), 'SLIDE')),
    );
    // locks
    const tr = s.track;
    const lk = st0.lk || {};
    const locks = h('div', { class: 'locks' }, h('div', { class: 'sub' }, 'VERROUS (P-LOCKS)'));
    for (const [id, v] of Object.entries(lk)) {
      const d = paramDef(tr.kind, tr.sound.engine, id);
      locks.append(h('div', { class: 'lock-row' }, h('span', {}, d ? d.label : id), h('b', {}, d ? formatParam(d, v) : v), button('✕', () => editAll('verrou', (st) => { if (st.lk) { delete st.lk[id]; if (!Object.keys(st.lk).length) st.lk = null; } }), 'tiny')));
    }
    if (!Object.keys(lk).length) locks.append(h('div', { class: 'hint' }, 'Activez P-LOCK puis tournez un potard du son.'));
    el.append(locks, lockBtn, clipRow);
  }
  copy() {
    const s = this.store, p = s.pattern(s.selTrack); if (!p) return;
    s.clipboard = { drum: s.isDrum(s.selTrack), steps: copySteps(p, s.sel) };
    s.toast(`${s.clipboard.steps ? s.clipboard.steps.length : 0} pas copiés`);
  }
  paste() {
    const s = this.store, t = s.selTrack;
    if (!s.clipboard || !s.clipboard.steps || s.clipboard.drum !== s.isDrum(t)) { s.toast('Rien à coller ici'); return; }
    const keys = [...s.sel];
    const at = keys.length ? Math.min(...keys.map((k) => k % 1000)) : (s.pos && s.playing ? s.pos.tracks[t].step : 0);
    const lane = s.isDrum(t) ? (keys.length ? Math.min(...keys.map((k) => Math.floor(k / 1000))) : s.lane) : 0;
    s.editPattern(t, 'coller', (p) => { s.sel = pasteSteps(p, s.clipboard.steps, at, lane); });
    s.emit('selection');
  }
  deleteSel() {
    const s = this.store; if (!s.sel.size) return;
    s.editPattern(s.selTrack, 'supprimer', (p) => { for (const k of s.sel) { const l = p.lanes[Math.floor(k / 1000)]; if (l) l[k % 1000] = undefined; } });
    s.sel.clear(); s.emit('selection');
  }
  selectAll() {
    const s = this.store, p = s.pattern(s.selTrack); if (!p) return;
    s.sel.clear();
    p.lanes.forEach((l, lane) => { for (let i = 0; i < p.length; i++) if (l[i]) s.sel.add(lane * 1000 + i); });
    s.emit('selection');
  }

  // ------------------------------------------------------------------ bottom panel: sound / play / mix
  renderBottom() {
    const el = clear(this.bottom);
    const tabs = h('div', { class: 'tabs' }, ...[['son', 'SON'], ['jeu', 'ARP · ACCORDS · GAMME'], ['mix', 'MIX PISTE']].map(([id, l]) =>
      h('button', { class: 'tab' + (this.bottomTab === id ? ' on' : ''), onclick: () => { this.bottomTab = id; this.renderBottom(); } }, l)));
    el.append(tabs);
    const body = h('div', { class: 'tab-body' });
    el.append(body);
    if (this.bottomTab === 'son') body.append(soundEditor(this.store, this.store.selTrack));
    else if (this.bottomTab === 'jeu') body.append(playEditor(this.store, this.store.selTrack));
    else body.append(trackMixEditor(this.store, this.store.selTrack));
  }
}

// ------------------------------------------------------------------ sound editor (shared with other pages)
export function presetBrowser(store, t) {
  const tr = store.trackAt(t);
  const drum = tr.kind === 'drum';
  const filter = store.settings.presetFilter || 'ALL';
  const user = store.project.userSounds.filter((u) => (drum ? u.engine === 'DRUM' : u.engine !== 'DRUM'));
  let list;
  if (drum) list = [...DRUM_KITS, ...user];
  else if (filter === 'USER') list = user;
  else if (filter === 'FAV') list = [...FACTORY_SOUNDS, ...user].filter((p) => store.project.favorites.includes(p.name));
  else list = [...FACTORY_SOUNDS, ...user].filter((p) => filter === 'ALL' || p.type === filter);
  const idx = list.findIndex((p) => p.name === tr.sound.name);
  const load = (i) => { if (!list.length) return; const k = ((i % list.length) + list.length) % list.length; store.loadSound(t, list[k]); };
  const sel = h('select', { class: 'preset-sel', onchange: () => load(+sel.value) },
    idx < 0 ? h('option', { value: -1 }, `${tr.sound.name || 'son modifié'} *`) : null,
    ...list.map((p, i) => h('option', { value: i, selected: i === idx }, `${p.name}${drum ? '' : ' · ' + p.engine}${p.user ? ' (user)' : ''}`)));
  const fav = store.project.favorites.includes(tr.sound.name);
  return h('div', { class: 'preset-browser' },
    drum ? null : selectField('', SOUND_TYPES, filter, (v) => { store.settings.presetFilter = v; store.emit('sound', t); }),
    button('◀', () => load(idx - 1), 'small'), sel, button('▶', () => load(idx + 1), 'small'),
    button(fav ? '★' : '☆', () => { const f = store.project.favorites; const i = f.indexOf(tr.sound.name); i >= 0 ? f.splice(i, 1) : f.push(tr.sound.name); store.markDirty(); store.emit('sound', t); }, 'small', 'Favori'),
    button('Sauver son', () => prompt2('Nom du son utilisateur', tr.sound.name || 'Mon son', (name) => {
      const types = ['BASS', 'LEAD', 'PAD', 'KEYS', 'PLUCK', 'FX'];
      const entry = { name, type: drum ? 'DRUM' : (FACTORY_SOUNDS.find((p) => p.name === tr.sound.name)?.type || (tr.kind === 'bass' ? 'BASS' : 'LEAD')), engine: tr.sound.engine, params: clone(tr.sound.params), user: true, sample: tr.sound.sample || null, laneSamples: [...(tr.sound.laneSamples || [])] };
      const ex = store.project.userSounds.findIndex((u) => u.name === name);
      if (ex >= 0) store.project.userSounds[ex] = entry; else store.project.userSounds.push(entry);
      tr.sound.name = name; store.markDirty(); store.toast(`Son « ${name} » sauvé dans le projet`); store.emit('sound', t);

    }), 'small'),
  );
}

export function soundEditor(store, t) {
  const tr = store.trackAt(t);
  const drum = tr.kind === 'drum';
  const wrap = h('div', { class: 'sound-editor' });
  const head = h('div', { class: 'se-head' }, presetBrowser(store, t));
  if (!drum) {
    head.append(selectField('MOTEUR', ENGINES, tr.sound.engine, (v) => store.setEngine(t, v)));
    if (tr.sound.engine === 'SAMPLE') head.append(sampleLoader(store, t, null));
  }
  wrap.append(head);
  const lockInfo = (id) => () => {
    const p = store.pattern(t); if (!p) return false;
    for (const k of store.sel) { const st = p.lanes[Math.floor(k / 1000)]?.[k % 1000]; if (st && st.lk && st.lk[id] !== undefined) return true; }
    return false;
  };
  const groups = new Map();
  let defs = soundParamDefs(tr.kind, tr.sound.engine);
  if (drum) {
    const lane = store.lane;
    const tabs = h('div', { class: 'lane-tabs' }, ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => h('button', {
      class: 'tab' + (i === lane ? ' on' : ''), style: { '--tc': tr.color },
      onclick: () => { store.lane = i; store.emit('lane'); },
      onpointerdown: () => { store.liveNote(t, i, 0.9, true, 'lane'); setTimeout(() => store.liveNote(t, i, 0, false, 'lane'), 100); },
    }, `${i + 1} ${DRUM_MODELS[tr.sound.params[`l${i}m`] | 0]}`)));
    wrap.append(tabs);
    defs = defs.filter((d) => !/^l\d/.test(d.id) || d.id.startsWith(`l${lane}`));
    if ((tr.sound.params[`l${lane}m`] | 0) === DRUM_MODELS.indexOf('SAMPLE')) wrap.append(sampleLoader(store, t, lane));
  }
  for (const d of defs) {
    const g = d.group || 'X';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(d);
  }
  const body = h('div', { class: 'groups' });
  for (const [g, ds] of groups) {
    const box = h('div', { class: 'group' }, h('div', { class: 'group-title' }, g));
    const knobs = h('div', { class: 'knobs' });
    for (const d of ds) {
      let label = d.label;
      if (drum && /^l\d/.test(d.id)) label = LANE_PARAM_DEFS.find(([k]) => k === d.id.slice(2))?.[1] || label;
      knobs.append(new Knob(store, { scope: 'sound', t, id: d.id }, { label, color: tr.color, lockInfo: lockInfo(d.id) }).el);
    }
    box.append(knobs); body.append(box);
  }
  wrap.append(body);
  return wrap;
}

export function sampleLoader(store, t, lane) {
  const tr = store.trackAt(t);
  const id = lane === null ? tr.sound.sample : (tr.sound.laneSamples || [])[lane];
  const info = id && store.project.samples[id] ? store.project.samples[id].name : 'aucun sample';
  const input = h('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const f = input.files[0]; if (!f) return;
    try {
      const nid = await store.importSample(f);
      store.pushUndo('sample');
      if (lane === null) tr.sound.sample = nid; else { tr.sound.laneSamples = tr.sound.laneSamples || []; tr.sound.laneSamples[lane] = nid; }
      store.sendSound(t); store.toast(`Sample « ${f.name} » chargé`); store.emit('sound', t);
    } catch (e) { store.toast('Impossible de lire ce fichier audio', 'error'); }
  });
  return h('div', { class: 'sample-loader' }, input, button(lane === null ? 'Charger un sample…' : `Sample lane ${lane + 1}…`, () => input.click(), 'small primary'), h('span', { class: 'sample-name' }, info),
    h('span', { class: 'hint' }, 'ou glissez un fichier audio sur la fenêtre'));
}

export function playEditor(store, t) {
  const tr = store.trackAt(t);
  const wrap = h('div', { class: 'groups' });
  if (tr.kind !== 'drum') {
    const arp = h('div', { class: 'group' }, h('div', { class: 'group-title' }, 'ARPÉGIATEUR'), h('div', { class: 'knobs' }, ...ARP_PARAMS.map((d) => new Knob(store, { scope: 'play', t, id: d.id }, { color: tr.color }).el)));
    const play = h('div', { class: 'group' }, h('div', { class: 'group-title' }, 'CLAVIER · ACCORDS'), h('div', { class: 'knobs' }, ...PLAY_PARAMS.map((d) => new Knob(store, { scope: 'play', t, id: d.id }, { color: tr.color }).el)));
    wrap.append(arp, play);
  } else wrap.append(h('div', { class: 'hint' }, 'Piste rythmique : les touches C3 à G3 (et les pads) jouent les lanes 1 à 8.'));
  const sc = store.song.scale;
  wrap.append(h('div', { class: 'group' }, h('div', { class: 'group-title' }, 'GAMME DU TITRE'),
    h('div', { class: 'col' },
      selectField('TONIQUE', NOTE_NAMES.map((n, i) => [i, n]), sc.root, (v) => { sc.root = +v; store.markDirty(); store.emit('scale'); }),
      selectField('GAMME', SCALES.map((s) => s.id), sc.id, (v) => { sc.id = v; store.markDirty(); store.emit('scale'); }),
      h('div', { class: 'hint' }, 'Utilisée par GAMME (quantize clavier), l\'accord SCALE, l\'aléatoire et le surlignage du piano roll.'))));
  return wrap;
}

export function trackMixEditor(store, t) {
  const tr = store.trackAt(t);
  const groups = new Map();
  for (const d of MIX_PARAMS) { if (!groups.has(d.group)) groups.set(d.group, []); groups.get(d.group).push(d); }
  const wrap = h('div', { class: 'groups' });
  for (const [g, ds] of groups) wrap.append(h('div', { class: 'group' }, h('div', { class: 'group-title' }, g), h('div', { class: 'knobs' }, ...ds.map((d) => new Knob(store, { scope: 'mix', t, id: d.id }, { color: tr.color }).el))));
  return wrap;
}
