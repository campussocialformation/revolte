// Revolte — SET page: setlist (songs of the project), per-track song lists, scenes
import { h, clear, button, numberField, selectField, modal, prompt2 } from './widgets.js';
import { PATTERN_NAMES, NOTE_NAMES, SCALES } from '../shared/params.js';
import { trackList } from './studio.js';

const MODES = ['OFF (boucle)', 'ON (enchaîne)', 'UNE FOIS'];

export class SongPage {
  constructor(store) {
    this.store = store;
    this.setlist = h('div', { class: 'setlist panel' });
    this.lists = h('div', { class: 'songlists panel' });
    this.scenes = h('div', { class: 'scene-editor panel' });
    this.el = h('div', { class: 'page song' }, this.setlist, h('div', { class: 'song-main' }, this.lists, this.scenes));
    const s = store;
    s.on('project', () => this.render());
    s.on('setlist', () => this.renderSetlist());
    s.on('pendingSong', () => this.renderSetlist());
    s.on('bpm', () => this.renderSetlist());
    s.on('scene', () => this.renderScenes());
    s.on('transport', () => this.renderLists());
    s.on('pos', () => this.updatePos());
    this.render();
  }
  render() { this.renderSetlist(); this.renderLists(); this.renderScenes(); }

  renderSetlist() {
    const s = this.store;
    const el = clear(this.setlist);
    el.append(h('div', { class: 'panel-title' }, 'SET · ', h('span', { class: 'proj-name', ondblclick: () => prompt2('Nom du projet', s.project.name, (v) => { s.project.name = v; s.markDirty(); this.renderSetlist(); s.emit('dirty'); }) }, s.project.name)));
    const list = h('ol', { class: 'songs' });
    s.project.songs.forEach((song, i) => {
      list.append(h('li', { class: 'song-item' + (i === s.songIdx ? ' cur' : '') + (s.pendingSong === i ? ' pend' : '') },
        h('div', { class: 'song-name', onclick: () => s.selectSong(i, s.playing), ondblclick: () => prompt2('Nom du titre', song.name, (v) => { song.name = v; s.markDirty(); this.renderSetlist(); }) },
          h('b', {}, `${i + 1}. ${song.name}`), h('span', { class: 'meta' }, `${song.bpm} BPM · ${NOTE_NAMES[song.scale.root]} ${song.scale.id}`)),
        h('div', { class: 'song-btns' },
          button('▲', () => s.moveSong(i, -1), 'tiny'), button('▼', () => s.moveSong(i, 1), 'tiny'),
          button('⧉', () => { s.addSong(song); }, 'tiny', 'Dupliquer'),
          button('✕', () => modal(`Supprimer « ${song.name} » ?`, h('div', {}, 'Cette action supprime le titre du set.'), [['Supprimer', () => s.deleteSong(i), 'danger']]), 'tiny danger'))));
    });
    el.append(list,
      h('div', { class: 'row' }, button('+ Nouveau titre', () => { const i = s.addSong(); s.selectSong(i); }, 'primary'), button('▶ titre suivant', () => s.selectSong(Math.min(s.project.songs.length - 1, s.songIdx + 1), s.playing), '')),
      h('div', { class: 'hint' }, 'Clic sur un titre pendant la lecture : il démarre à la mesure suivante (enchaînement de set). Double-clic : renommer.'));
    // song properties
    const song = s.song;
    el.append(h('div', { class: 'panel-title' }, 'TITRE EN COURS'),
      h('div', { class: 'col' },
        numberField('BPM', song.bpm, 30, 300, (v) => s.set({ scope: 'song', id: 'bpm' }, v), 0.5),
        selectField('TONIQUE', NOTE_NAMES.map((n, i) => [i, n]), song.scale.root, (v) => { song.scale.root = +v; s.markDirty(); this.renderSetlist(); }),
        selectField('GAMME', SCALES.map((x) => x.id), song.scale.id, (v) => { song.scale.id = v; s.markDirty(); this.renderSetlist(); }),
        h('label', { class: 'col' }, h('span', { class: 'sub' }, 'NOTES'), h('textarea', { rows: 4, oninput: (e) => { song.notes = e.target.value; s.markDirty(); } }, song.notes || ''))));
  }

  renderLists() {
    const s = this.store;
    const el = clear(this.lists);
    const song = s.song;
    el.append(h('div', { class: 'panel-title' }, 'MODE SONG : LISTES DES PISTES',
      h('div', { class: 'seg' }, ...MODES.map((m, i) => h('button', { class: 'seg-btn' + (song.songMode === i ? ' on' : ''), onclick: () => { s.setSongMode(i); this.renderLists(); } }, m)))));
    el.append(h('div', { class: 'hint' }, 'Chaque piste descend sa liste : une entrée = un pattern (ou un silence) joué N fois. Clic sur une case pour la modifier. « Jouer d\'ici » démarre le morceau depuis une colonne.'));
    const table = h('div', { class: 'list-grid' });
    table.append(h('div', { class: 'lg-head' }, ''), ...Array.from({ length: 16 }, (_, e) => h('div', { class: 'lg-head', title: 'Jouer le morceau depuis cette entrée', onclick: () => this.playFrom(e) }, `${e + 1} ▸`)));
    this.cells = [];
    song.tracks.forEach((tr, t) => {
      table.append(h('div', { class: 'lg-track', style: { '--tc': tr.color } }, `${t + 1} ${tr.name}`));
      const row = [];
      for (let e = 0; e < 16; e++) {
        const en = tr.list[e];
        const txt = !en ? '' : en.pat === -1 ? `— ×${en.reps}` : `${PATTERN_NAMES[en.pat]} ×${en.reps}`;
        const c = h('div', { class: 'lg-cell' + (en ? (en.pat === -1 ? ' rest' : ' full') : ''), style: { '--tc': tr.color }, onclick: () => this.editEntry(t, e) }, txt);
        table.append(c); row.push(c);
      }
      this.cells.push(row);
    });
    el.append(table,
      h('div', { class: 'row' },
        button('Remplir depuis les scènes…', () => this.fromScenes()),
        button('Vider toutes les listes', () => { s.pushUndo('listes'); song.tracks.forEach((tr, t) => { tr.list = Array(16).fill(null); s.sendList(t); }); this.renderLists(); }, 'danger')));
  }
  updatePos() {
    const s = this.store; if (!this.cells || !s.pos) return;
    s.pos.tracks.forEach((tp, t) => this.cells[t] && this.cells[t].forEach((c, e) => c.classList.toggle('playing', s.playing && s.song.songMode > 0 && tp.entry === e && !tp.done)));
  }
  editEntry(t, e) {
    const s = this.store, tr = s.trackAt(t);
    const en = tr.list[e] || { pat: tr.cur, reps: 1 };
    let pat = en.pat, reps = en.reps;
    const body = h('div', { class: 'col' },
      selectField('PATTERN', [[-1, '— silence'], ...PATTERN_NAMES.map((n, i) => [i, `${n}${tr.patterns[i] ? ` (${tr.patterns[i].length} pas)` : ' (vide)'}`])], pat, (v) => (pat = +v)),
      numberField('RÉPÉTITIONS', reps, 1, 64, (v) => (reps = v)));
    modal(`${tr.name} — entrée ${e + 1}`, body, [
      ['OK', () => { s.pushUndo('liste'); tr.list[e] = { pat, reps }; s.sendList(t); this.renderLists(); }, 'primary'],
      ['Vider', () => { s.pushUndo('liste'); tr.list[e] = null; s.sendList(t); this.renderLists(); }, 'danger'],
    ]);
  }
  playFrom(e) {
    const s = this.store;
    if (!s.song.songMode) s.setSongMode(1);
    s.send({ type: 'transport', cmd: 'play', fromEntry: e });
    s.bridge.resume();
  }
  fromScenes() {
    const s = this.store, song = s.song;
    const rows = [];
    const body = h('div', { class: 'col' }, h('div', { class: 'hint' }, 'Construit les listes à partir d\'une suite de scènes (ex. 1:4 2:8 3:4 = scène 1 pendant 4 boucles, puis scène 2 pendant 8…).'));
    const inp = h('input', { type: 'text', class: 'wide', value: '1:4 2:8 3:4 4:8' });
    body.append(inp);
    void rows;
    modal('Listes depuis les scènes', body, [['Construire', () => {
      const parts = inp.value.trim().split(/\s+/).map((x) => x.split(':').map(Number)).filter(([a]) => a >= 1 && a <= 16);
      s.pushUndo('listes');
      song.tracks.forEach((tr, t) => {
        tr.list = Array(16).fill(null);
        parts.slice(0, 16).forEach(([sc, reps], e) => {
          const scene = song.scenes[sc - 1];
          const slot = scene ? scene.pats[t] : -1;
          const muted = scene ? scene.mutes[t] : true;
          tr.list[e] = { pat: muted || slot < 0 ? -1 : slot, reps: reps || 1 };
        });
        s.sendList(t);
      });
      this.renderLists();
    }, 'primary']]);
  }

  renderScenes() {
    const s = this.store, song = s.song;
    const el = clear(this.scenes);
    el.append(h('div', { class: 'panel-title' }, 'SCÈNES (pattern et mute de chaque piste)'));
    const grid = h('div', { class: 'scene-table' });
    grid.append(h('div', { class: 'st-h' }, ''), ...song.tracks.map((tr) => h('div', { class: 'st-h', style: { color: tr.color } }, tr.name)), h('div', { class: 'st-h' }, ''));
    song.scenes.forEach((sc, i) => {
      grid.append(h('div', { class: 'st-name', ondblclick: () => sc && prompt2('Nom de la scène', sc.name, (v) => { sc.name = v.slice(0, 12).toUpperCase(); s.markDirty(); this.renderScenes(); }) }, `${i + 1}. ${sc ? sc.name : '—'}`));
      song.tracks.forEach((tr, t) => {
        if (!sc) { grid.append(h('div', { class: 'st-cell empty' }, '')); return; }
        const slot = sc.pats[t], m = sc.mutes[t];
        grid.append(h('div', {
          class: 'st-cell' + (m ? ' muted' : ''), style: { '--tc': tr.color }, title: 'clic : pattern suivant · clic droit : mute',
          onclick: () => { s.pushUndo('scène'); sc.pats[t] = slot >= 15 ? -1 : slot + 1; s.markDirty(); this.renderScenes(); },
          oncontextmenu: (e) => { e.preventDefault(); s.pushUndo('scène'); sc.mutes[t] = !m; s.markDirty(); this.renderScenes(); },
        }, slot < 0 ? '=' : PATTERN_NAMES[slot], m ? ' M' : ''));
      });
      grid.append(h('div', { class: 'st-btns' }, button('▶', () => s.launchScene(i), 'tiny'), button('⦿', () => { s.storeScene(i); this.renderScenes(); }, 'tiny', 'Mémoriser l\'état actuel'), sc ? button('✕', () => { s.pushUndo('scène'); song.scenes[i] = null; s.markDirty(); this.renderScenes(); }, 'tiny danger') : null));
    });
    el.append(grid, h('div', { class: 'hint' }, '« = » : la piste garde son pattern. Les scènes se lancent sur la quantisation choisie (page LIVE).'));
  }
}
