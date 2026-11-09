// Revolte — application bootstrap
import { AudioBridge } from './bridge.js';
import { Store, saveSettings } from './store.js';
import { h, clear, button, momentary, refreshTarget, refreshAll, modal, selectField } from './widgets.js';
import { StudioPage } from './studio.js';
import { LivePage } from './live.js';
import { SongPage } from './song.js';
import { MixerPage } from './mixer.js';
import { SettingsPage } from './settings.js';
import { MidiManager } from '../midi/midi.js';
import { saveProjectFile, openProjectFile, saveBinary, autosaveRead, autosaveWrite, isElectron } from './platform.js';
import { demoProject, FORMAT } from '../shared/model.js';
import { DRUM_MODELS } from '../shared/params.js';

const bridge = new AudioBridge();
const store = new Store(bridge);
window.revolte = { store, bridge };
const midi = new MidiManager(store);

const PAGES = [
  ['studio', 'STUDIO', 'F1'], ['live', 'LIVE', 'F2'], ['song', 'SET · SONG', 'F3'], ['mix', 'MIX · FX', 'F4'], ['midi', 'MIDI · RÉGLAGES', 'F5'],
];
let page = 'studio';
const pages = {};
window.revolte.pages = pages;
window.revolte.midi = midi;

// ------------------------------------------------------------------ top bar
const bpmInput = h('input', { type: 'number', class: 'bpm', min: 30, max: 300, step: 0.5, onchange: () => store.set({ scope: 'song', id: 'bpm' }, +bpmInput.value) });
bpmInput.addEventListener('wheel', (e) => { e.preventDefault(); store.set({ scope: 'song', id: 'bpm' }, store.song.bpm + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.1 : 1)); }, { passive: false });
const playBtn = button('▶', () => store.togglePlay(), 'transport play', 'Lecture / stop (Espace)');
const stopBtn = button('■', () => store.stop(), 'transport', 'Stop (2× = coupe tout)');
const recBtn = button('●', () => store.toggleRec(), 'transport rec', 'Enregistrement (Ctrl+R)');
const songModeSel = h('select', { class: 'songmode', title: 'Mode SONG', onchange: () => store.setSongMode(+songModeSel.value) }, h('option', { value: 0 }, 'BOUCLE'), h('option', { value: 1 }, 'SONG'), h('option', { value: 2 }, 'SONG ×1'));
const songSel = h('select', { class: 'songsel', title: 'Titre du set', onchange: () => store.selectSong(+songSel.value, store.playing) });
const posEl = h('div', { class: 'pos' }, '1.1');
const cpuEl = h('div', { class: 'cpu' });
const meterEl = h('div', { class: 'top-meter' }, h('div'), h('div'));
const titleEl = h('div', { class: 'proj-title' });
const bounceBtn = button('⏺ WAV', () => toggleBounce(), 'small', 'Enregistrer la sortie master en WAV');
const tabs = h('nav', { class: 'pages' }, ...PAGES.map(([id, label, key]) => h('button', { class: 'page-tab', 'data-page': id, onclick: () => showPage(id), title: key }, label)));
const fileMenu = h('div', { class: 'filemenu' },
  button('Nouveau', () => newProjectDialog(), 'small'), button('Ouvrir', () => openProject(), 'small'), button('Sauver', () => saveProject(false), 'small'), button('Sauver sous', () => saveProject(true), 'small'),
  button('↶', () => store.undo(), 'small', 'Annuler (Ctrl+Z)'), button('↷', () => store.redo(), 'small', 'Rétablir (Ctrl+Y)'));
const midiEl = h('button', { class: 'midi-ind', onclick: () => showPage('midi') }, 'MIDI…');
const top = h('header', { class: 'topbar' },
  h('div', { class: 'logo' }, 'REVOLTE'), titleEl, fileMenu,
  h('div', { class: 'transport-box' }, playBtn, stopBtn, recBtn, h('label', { class: 'bpm-box' }, bpmInput, h('span', {}, 'BPM')), button('TAP', () => store.tapTempo(), 'small'), songModeSel,
    momentary('FILL', () => store.setFill(true), () => store.setFill(false), 'small fill'), posEl),
  h('div', { class: 'song-box' }, button('◀', () => store.selectSong(store.songIdx - 1, store.playing), 'tiny'), songSel, button('▶', () => store.selectSong(store.songIdx + 1, store.playing), 'tiny')),
  tabs, midiEl, bounceBtn, meterEl, cpuEl);
const main = h('main', { class: 'main' });
const renderMidiInd = () => { const sm = midi.summary(); midiEl.textContent = sm.text; midiEl.title = sm.title; midiEl.classList.toggle('ok', sm.ok); midiEl.classList.toggle('bad', !sm.ok); };
midi.onChange(renderMidiInd);
let actT = 0;
midi.onActivity = () => { const now = performance.now(); if (now - actT > 60) { actT = now; midiEl.classList.add('act'); setTimeout(() => midiEl.classList.remove('act'), 90); } };
const toasts = h('div', { class: 'toasts' });
document.body.append(top, main, toasts);

function showPage(id) {
  page = id;
  for (const b of tabs.children) b.classList.toggle('on', b.dataset.page === id);
  clear(main).append(pages[id].el);
  if (id === 'midi') pages.midi.render();
  refreshAll(store);
}

function renderTop() {
  bpmInput.value = store.song.bpm;
  songModeSel.value = store.song.songMode;
  clear(songSel).append(...store.project.songs.map((s, i) => h('option', { value: i, selected: i === store.songIdx }, `${i + 1}. ${s.name}`)));
  titleEl.textContent = `${store.project.name}${store.dirty ? ' •' : ''}`;
  document.title = `Revolte — ${store.project.name}${store.dirty ? ' •' : ''}`;
  playBtn.classList.toggle('on', store.playing);
  recBtn.classList.toggle('on', store.recOn);
}
store.on('project', renderTop); store.on('setlist', renderTop); store.on('bpm', () => (bpmInput.value = store.song.bpm)); store.on('dirty', () => (titleEl.textContent = `${store.project.name} •`));
store.on('transport', () => { playBtn.classList.toggle('on', store.playing); recBtn.classList.toggle('on', store.recOn); songModeSel.value = store.song.songMode; });
store.on('value', (target, v) => refreshTarget(target, v));
store.on('pos', (m) => {
  if (m.beat >= 0) { const bar = Math.floor(m.beat / 4) + 1, beat = Math.floor(m.beat % 4) + 1; posEl.textContent = `${bar}.${beat}`; }
  else posEl.textContent = `-${Math.ceil(-m.beat)}`;
  posEl.classList.toggle('countin', m.beat < 0);
  meterEl.children[0].style.width = Math.min(100, m.master[0] * 100) + '%';
  meterEl.children[1].style.width = Math.min(100, m.master[1] * 100) + '%';
  meterEl.classList.toggle('clip', Math.max(...m.master) >= 0.99);
  cpuEl.textContent = `DSP ${Math.round(m.cpu * 100)}%`;
});
store.on('toast', (text, kind) => {
  const t = h('div', { class: 'toast ' + kind }, text);
  toasts.append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
});

// ------------------------------------------------------------------ files
async function saveProject(saveAs) {
  try {
    store.garbageCollectSamples();
    const json = JSON.stringify(store.project);
    const path = await saveProjectFile(json, store.projectPath, store.project.name, saveAs);
    if (!path) return;
    store.projectPath = path; store.dirty = false;
    store.settings.lastPath = typeof path === 'string' ? path : null; saveSettings(store.settings);
    renderTop(); store.toast('Projet sauvegardé : ' + path);
  } catch (e) { if (e.name !== 'AbortError') store.toast('Erreur de sauvegarde : ' + e.message, 'error'); }
}
async function openProject() {
  try {
    const r = await openProjectFile(); if (!r) return;
    const p = JSON.parse(r.json);
    await store.loadProject(p, r.path);
    store.toast('Projet ouvert : ' + (p.name || r.path));
  } catch (e) { store.toast('Impossible d\'ouvrir : ' + e.message, 'error'); }
}
function newProjectDialog() {
  modal('Nouveau projet', h('div', {}, 'Le projet actuel sera fermé. Pensez à le sauvegarder.'), [
    ['Projet vide', () => store.newProject(), 'primary'],
    ['Projet de démo', () => store.loadProject(demoProject())],
  ]);
}
let bouncing = false;
async function toggleBounce() {
  if (!bouncing) {
    await bridge.startCapture(); bouncing = true; bounceBtn.classList.add('on'); bounceBtn.textContent = '⏹ WAV';
    store.toast('Enregistrement du master… recliquez pour arrêter');
  } else {
    const bytes = await bridge.stopCapture().catch((e) => { store.toast('Export WAV impossible : ' + e.message, 'error'); return null; }); bouncing = false; bounceBtn.classList.remove('on'); bounceBtn.textContent = '⏺ WAV';
    if (bytes) { const p = await saveBinary(bytes, `${store.song.name}.wav`, [{ name: 'WAV', extensions: ['wav'] }]); if (p) store.toast('WAV enregistré : ' + p); }
  }
}

// ------------------------------------------------------------------ keyboard
const PIANO = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16 };
// event.code uses QWERTY names for physical keys: on AZERTY, KeyA is "Q", KeyW is "Z", KeyZ is "W", Semicolon is "M"
let octave = 4;
const held = new Map();
window.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveProject(e.shiftKey); }
    else if (k === 'o') { e.preventDefault(); openProject(); }
    else if (k === 'n') { e.preventDefault(); newProjectDialog(); }
    else if (k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
    else if (k === 'y') { e.preventDefault(); store.redo(); }
    else if (k === 'r') { e.preventDefault(); store.toggleRec(); }
    else if (k === 'c' && page === 'studio') { e.preventDefault(); pages.studio.copy(); }
    else if (k === 'v' && page === 'studio') { e.preventDefault(); pages.studio.paste(); }
    else if (k === 'a' && page === 'studio') { e.preventDefault(); pages.studio.selectAll(); }
    return;
  }
  if (e.code.startsWith('F') && /^F[1-5]$/.test(e.code)) { e.preventDefault(); showPage(PAGES[+e.code.slice(1) - 1][0]); return; }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) store.togglePlay(); return; }
  if (e.code === 'NumpadMultiply') { store.toggleRec(); return; }
  if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) store.setFill(true); return; }
  if ((e.code === 'Delete' || e.code === 'Backspace') && page === 'studio') { pages.studio.deleteSel(); return; }
  if (e.code === 'Escape') { store.sel.clear(); store.emit('selection'); return; }
  if ((e.code === 'ArrowRight' || e.code === 'ArrowLeft') && store.recOn && !store.playing) { store.moveStepCursor(e.code === 'ArrowRight' ? 1 : -1); return; }
  const dm = /^Digit([1-8])$/.exec(e.code);
  if (dm) { const t = +dm[1] - 1; if (e.shiftKey) store.toggleMute(t); else store.selectTrack(t); return; }
  if (e.code === 'KeyZ') { octave = Math.max(0, octave - 1); store.toast('Octave clavier : ' + octave); return; }
  if (e.code === 'KeyX') { octave = Math.min(8, octave + 1); store.toast('Octave clavier : ' + octave); return; }
  if (e.code in PIANO && !e.repeat) {
    const t = store.selTrack;
    const note = store.isDrum(t) ? 48 + PIANO[e.code] : 12 * (octave + 1) + PIANO[e.code];
    held.set(e.code, { t, note });
    midi.lastNote = note;
    store.liveNote(t, note, 0.85, true);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') store.setFill(false);
  const hd = held.get(e.code);
  if (hd) { held.delete(e.code); store.liveNote(hd.t, hd.note, 0, false); }
});
window.addEventListener('blur', () => { for (const hd of held.values()) store.liveNote(hd.t, hd.note, 0, false); held.clear(); store.allLiveOff(); });

// ------------------------------------------------------------------ drag & drop samples / projects
window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
window.addEventListener('dragleave', () => document.body.classList.remove('dropping'));
window.addEventListener('drop', async (e) => {
  e.preventDefault(); document.body.classList.remove('dropping');
  const f = e.dataTransfer.files[0]; if (!f) return;
  if (/\.(rvlt|json)$/i.test(f.name)) { try { await store.loadProject(JSON.parse(await f.text()), f.name); } catch (err) { store.toast('Projet illisible : ' + err.message, 'error'); } return; }
  const t = store.selTrack, tr = store.track;
  try {
    const id = await store.importSample(f);
    store.pushUndo('sample');
    if (tr.kind === 'drum') {
      tr.sound.laneSamples = tr.sound.laneSamples || [];
      tr.sound.laneSamples[store.lane] = id;
      tr.sound.params[`l${store.lane}m`] = DRUM_MODELS.indexOf('SAMPLE');
      store.toast(`« ${f.name} » sur la lane ${store.lane + 1} de ${tr.name}`);
    } else {
      if (tr.sound.engine !== 'SAMPLE') store.setEngine(t, 'SAMPLE');
      tr.sound.sample = id;
      store.toast(`« ${f.name} » chargé sur ${tr.name}`);
    }
    store.sendSound(t); store.emit('sound', t);
  } catch (err) { store.toast('Fichier audio illisible', 'error'); }
});

// ------------------------------------------------------------------ autosave / close
async function autosave() {
  if (!store.settings.autosave) return;
  try { await autosaveWrite({ format: FORMAT, project: store.project, songIdx: store.songIdx, path: store.projectPath, dirty: store.dirty, t: Date.now() }); } catch (e) { console.warn('autosave', e); }
}
setInterval(() => { if (store.dirty) autosave(); }, 20000);
if (isElectron) {
  window.revolteNative.onCloseRequest(async () => {
    await autosave();
    midi.shutdown();
    if (store.dirty) {
      const r = await window.revolteNative.confirm('Le projet a des modifications non sauvegardées. Sauvegarder avant de quitter ?', ['Sauvegarder', 'Quitter sans sauver', 'Annuler']);
      if (r === 2) return;
      if (r === 0) { await saveProject(false); if (store.dirty) return; }
    }
    window.revolteNative.quit();
  });
  window.revolteNative.onOpenFile(async (path, json) => { try { await store.loadProject(JSON.parse(json), path); } catch (e) { store.toast('Projet illisible', 'error'); } });
} else {
  window.addEventListener('beforeunload', (e) => { autosave(); midi.shutdown(); if (store.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

// ------------------------------------------------------------------ audio back-end (Web Audio or native ASIO / WASAPI / DirectSound)
function audioConfig() {
  const st = store.settings;
  return { backend: st.audioBackend, latency: st.latency, deviceId: st.audioDeviceId, deviceName: st.audioDeviceName, sampleRate: st.audioSampleRate, bufferSize: st.audioBufferSize, firstChannel: st.audioFirstChannel, queue: st.audioQueue };
}
async function applyAudio() {
  store.stop();
  const r = await bridge.restart(audioConfig());
  store.resyncEngine();
  if (r.ok) store.toast(`Audio : ${bridge.info.apiName}${bridge.info.device ? ' · ' + bridge.info.device : ''} · ${bridge.info.sr} Hz${bridge.info.frameSize ? ' · ' + bridge.info.frameSize + ' éch.' : ''} · ~${bridge.latencyMs} ms`);
  else store.toast(`Impossible d'ouvrir ${store.settings.audioBackend} : ${r.error}. Retour sur Web Audio.`, 'error');
  store.emit('audio');
  return r;
}
window.revolte.applyAudio = applyAudio;
bridge.on('__audio', async (m) => {
  if (m.ev === 'streamError') store.toast('Audio : ' + m.message, 'error');
  if (m.ev === 'hostExit') {
    store.toast('Le processus audio natif s\'est arrêté : retour sur Web Audio', 'error');
    await bridge.start({ backend: 'webaudio', latency: store.settings.latency });
    store.resyncEngine(); store.emit('audio');
  }
});

// ------------------------------------------------------------------ start
async function start() {
  pages.studio = new StudioPage(store);
  pages.live = new LivePage(store);
  pages.song = new SongPage(store);
  pages.mix = new MixerPage(store);
  pages.midi = new SettingsPage(store, midi);
  midi.init(); // MIDI never waits for the audio driver
  const r = await bridge.start(audioConfig());
  if (!r.ok) store.toast(`Sortie ${store.settings.audioBackend} indisponible (${r.error}) : retour sur Web Audio`, 'error');
  const last = store.settings.autosave ? await autosaveRead() : null;
  if (last && last.project) {
    try {
      await store.loadProject(last.project, last.path);
      if (last.songIdx) store.selectSong(Math.min(last.songIdx, store.project.songs.length - 1));
      store.dirty = !!last.dirty;
      store.toast('Session précédente restaurée');
    } catch (e) { await store.loadProject(demoProject()); }
  } else await store.loadProject(demoProject());
  renderTop();
  showPage('studio');
  if (bridge.backend === 'webaudio' && bridge.ctx.state !== 'running') {
    const ov = h('div', { class: 'start-overlay', onclick: async () => { await bridge.resume(); ov.remove(); } }, h('div', { class: 'logo big' }, 'REVOLTE'), h('div', {}, 'Cliquez pour démarrer le moteur audio'));
    document.body.append(ov);
  }
}
start().catch((e) => { console.error(e); document.body.append(h('pre', { class: 'fatal' }, 'Erreur au démarrage :\n' + (e.stack || e))); });
