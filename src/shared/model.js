// Revolte — project / song data model, defaults, demo content, (de)serialization
import { NUM_TRACKS, NUM_PATTERNS, NUM_SCENES, MAX_STEPS, MIX_PARAMS, FX_PARAMS, ARP_PARAMS, PLAY_PARAMS, defaultParams, STRIP_KNOBS } from './params.js';
import { FACTORY_SOUNDS, DRUM_KITS } from './presets.js';

export const FORMAT = 'revolte-project';
export const VERSION = 1;

export const TRACK_LAYOUT = [
  { name: 'SYNTH 1', kind: 'synth', color: '#ff5c8a', sound: 'Stab Chord' },
  { name: 'SYNTH 2', kind: 'synth', color: '#ffa94d', sound: 'Pluck KS' },
  { name: 'BASSE 1', kind: 'bass', color: '#ffd43b', sound: 'Acid 303' },
  { name: 'BASSE 2', kind: 'bass', color: '#a9e34b', sound: 'Sub Bass' },
  { name: 'RYTHME 1', kind: 'drum', color: '#38d9a9', kit: '909 Techno' },
  { name: 'RYTHME 2', kind: 'drum', color: '#4dabf7', kit: '808 Classic' },
  { name: 'RYTHME 3', kind: 'drum', color: '#9775fa', kit: 'Perc Tribal' },
  { name: 'SAMPLE', kind: 'sample', color: '#e599f7', sound: 'Sampler' },
];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export function emptyPattern(isDrum, length = 16) {
  return { length, res: '1/16', swing: 50, dir: 'FWD', gate: 100, lanes: isDrum ? Array.from({ length: 8 }, () => []) : [[]] };
}
export function newStep(isDrum, note = 60, vel = 0.8) {
  return isDrum
    ? { v: vel, prob: 100, cond: 'ALL', rat: 1, flam: false, ndg: 0, acc: false, lk: null }
    : { n: [{ p: note, l: 1, v: vel }], prob: 100, cond: 'ALL', rat: 1, flam: false, ndg: 0, acc: false, sl: false, lk: null };
}

export function soundFromPreset(preset) {
  return { engine: preset.engine === 'DRUM' ? 'DRUM' : preset.engine, params: clone(preset.params), name: preset.name, sample: null, laneSamples: [] };
}
export const findSound = (name) => FACTORY_SOUNDS.find((s) => s.name === name) || FACTORY_SOUNDS[0];
export const findKit = (name) => DRUM_KITS.find((s) => s.name === name) || DRUM_KITS[0];

export function newTrack(i) {
  const L = TRACK_LAYOUT[i];
  const isDrum = L.kind === 'drum';
  const sound = soundFromPreset(isDrum ? findKit(L.kit) : findSound(L.sound));
  const mix = { ...defaultParams(MIX_PARAMS), mute: false, solo: false };
  const stripKnobs = isDrum ? STRIP_KNOBS.drum : L.kind === 'bass' ? STRIP_KNOBS.bass : STRIP_KNOBS.melodic;
  return {
    name: L.name, kind: L.kind, color: L.color,
    sound, mix,
    play: { ...defaultParams(ARP_PARAMS), ...defaultParams(PLAY_PARAMS) },
    patterns: Array.from({ length: NUM_PATTERNS }, () => null),
    list: Array.from({ length: 16 }, () => null),
    cur: 0,
    stripKnobs: [...stripKnobs],
  };
}

export function newSong(name = 'Nouveau titre') {
  const tracks = Array.from({ length: NUM_TRACKS }, (_, i) => newTrack(i));
  tracks.forEach((t) => (t.patterns[0] = emptyPattern(t.kind === 'drum')));
  return {
    id: uid(), name, bpm: 124, songMode: 0,
    scale: { root: 0, id: 'MINOR' },
    fx: defaultParams(FX_PARAMS),
    tracks,
    scenes: Array.from({ length: NUM_SCENES }, () => null),
    launchQuant: 'BAR',
    notes: '',
  };
}

export function newProject(name = 'Mon set') {
  return { format: FORMAT, version: VERSION, name, songs: [newSong('Titre 1')], samples: {}, userSounds: [], favorites: [] };
}

// ------------------------------------------------------------------ demo content
function drumSteps(pat, lane, idxs, vel = 0.85, extra = {}) {
  for (const i of idxs) pat.lanes[lane][i] = { ...newStep(true, 0, vel), ...extra };
}
function melo(pat, items) {
  // items: [step, note, len, vel, extra]
  for (const [i, p, l = 1, v = 0.8, ex = {}] of items) {
    const st = pat.lanes[0][i] || { ...newStep(false), n: [] };
    st.n.push({ p, l, v });
    Object.assign(st, ex);
    pat.lanes[0][i] = st;
  }
}

export function demoSong() {
  const s = newSong('Révolte (démo)');
  s.bpm = 128;
  s.scale = { root: 9, id: 'MINOR' };
  const T = s.tracks;
  // RYTHME 1: 909 techno
  {
    const a = emptyPattern(true, 16);
    drumSteps(a, 0, [0, 4, 8, 12], 1);
    drumSteps(a, 3, [2, 6, 10, 14], 0.7);
    drumSteps(a, 4, [], 0.6);
    drumSteps(a, 2, [4, 12], 0.75);
    drumSteps(a, 3, [15], 0.5, { prob: 50 });
    drumSteps(a, 5, [7], 0.6, { cond: '2:4' });
    drumSteps(a, 7, [1, 3, 5, 9, 11, 13], 0.45, { prob: 70 });
    a.lanes[3][14].rat = 2;
    const b = JSON.parse(JSON.stringify(a));
    drumSteps(b, 4, [2, 6, 10, 14], 0.55);
    drumSteps(b, 6, [0], 0.5);
    drumSteps(b, 1, [12, 13, 14, 15], 0.55, { cond: 'FILL' });
    b.lanes[1][15].rat = 4;
    const c = emptyPattern(true, 16);
    drumSteps(c, 3, [2, 6, 10, 14], 0.6);
    drumSteps(c, 2, [4, 12], 0.6);
    T[4].patterns[0] = a; T[4].patterns[1] = b; T[4].patterns[2] = c;
    T[4].mix.vol = 0.9;
  }
  // RYTHME 2: 808 (claps, toms, shaker), 32 steps
  {
    const a = emptyPattern(true, 32);
    drumSteps(a, 1, [12, 28], 0.6, { prob: 100 });
    drumSteps(a, 5, [22, 30], 0.5, { cond: '1:2' });
    drumSteps(a, 6, [23, 31], 0.45, { cond: '2:2' });
    drumSteps(a, 7, [3, 11, 19, 27], 0.5);
    a.lanes[7][27].flam = true;
    T[5].patterns[0] = a; T[5].mix.vol = 0.7; T[5].mix.rev = 0.15;
  }
  // RYTHME 3: tribal percs, 12 steps polyrhythm at 1/16
  {
    const a = emptyPattern(true, 12);
    drumSteps(a, 0, [0, 7], 0.6);
    drumSteps(a, 1, [3, 10], 0.55);
    drumSteps(a, 3, [2, 5, 8, 11], 0.5, { prob: 75 });
    drumSteps(a, 6, [1, 4, 6, 9], 0.4, { prob: 60 });
    T[6].patterns[0] = a; T[6].mix.vol = 0.55; T[6].mix.dly = 0.18; T[6].mix.pan = 0.2;
  }
  // BASSE 1: acid line
  {
    const a = emptyPattern(false, 16);
    const r = 33; // A1
    melo(a, [[0, r, 0.5, 0.9, { acc: true }], [2, r, 0.5], [3, r + 12, 0.5, 0.8, { sl: true }], [4, r + 10, 0.5], [6, r, 0.5], [7, r + 3, 0.5, 0.8, { acc: true }],
      [8, r, 0.5], [10, r + 12, 0.5, 0.8, { sl: true }], [11, r + 7, 0.5], [12, r, 0.5, 0.9, { acc: true }], [14, r + 15, 0.5, 0.7, { prob: 60 }], [15, r + 12, 0.5]]);
    T[2].patterns[0] = a;
    const b = JSON.parse(JSON.stringify(a)); b.lanes[0].forEach((st) => st && st.n.forEach((n) => (n.p += 5)));
    T[2].patterns[1] = b;
    T[2].mix.dly = 0.12; T[2].mix.duck = 0.4; T[2].mix.dsrc = 5; T[2].mix.vol = 0.75;
  }
  // BASSE 2: sub off-beats, 8 bars progression (128 steps)
  {
    const a = emptyPattern(false, 64);
    const roots = [33, 33, 29, 31];
    for (let bar = 0; bar < 4; bar++) for (let q = 0; q < 4; q++) melo(a, [[bar * 16 + q * 4 + 2, roots[bar], 1.5, 0.85]]);
    T[3].patterns[0] = a; T[3].mix.duck = 0.7; T[3].mix.dsrc = 5; T[3].mix.vol = 0.8;
  }
  // SYNTH 1: stab chords
  {
    const a = emptyPattern(false, 64);
    const chords = [[57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
    for (let bar = 0; bar < 4; bar++) {
      for (const st of [0, 6, 10]) melo(a, chords[bar].map((p) => [bar * 16 + st, p, 1, 0.75]));
    }
    a.lanes[0][10].cond = '1:2';
    a.lanes[0][10].lk = { cut: 3500 };
    T[0].patterns[0] = a; T[0].mix.dly = 0.25; T[0].mix.rev = 0.3; T[0].mix.vol = 0.55; T[0].mix.duck = 0.5; T[0].mix.dsrc = 5;
  }
  // SYNTH 2: pluck arpeggio with probabilities
  {
    const a = emptyPattern(false, 16);
    const notes = [69, 72, 76, 79, 76, 72, 81, 76];
    notes.forEach((p, i) => melo(a, [[i * 2, p, 0.75, 0.7, { prob: i % 3 === 2 ? 65 : 100 }]]));
    a.lanes[0][6].rat = 2;
    T[1].patterns[0] = a; T[1].mix.dly = 0.35; T[1].mix.rev = 0.25; T[1].mix.pan = -0.25; T[1].mix.vol = 0.5;
  }
  // song lists and scenes
  s.scenes[0] = { name: 'INTRO', pats: [-1, -1, -1, 0, 0, -1, 0, -1], mutes: [true, true, true, false, false, true, false, true] };
  s.scenes[1] = { name: 'GROOVE', pats: [0, 0, 0, 0, 0, 0, 0, -1], mutes: [false, false, false, false, false, false, false, true] };
  s.scenes[2] = { name: 'BREAK', pats: [0, 0, 1, 0, 2, 0, 0, -1], mutes: [false, false, true, true, false, false, false, true] };
  s.scenes[3] = { name: 'DROP', pats: [0, 0, 1, 0, 1, 0, 0, -1], mutes: [false, false, false, false, false, false, false, true] };
  T[4].list = [{ pat: 0, reps: 4 }, { pat: 1, reps: 4 }, { pat: 2, reps: 2 }, { pat: 1, reps: 6 }, ...Array(12).fill(null)];
  T[2].list = [{ pat: -1, reps: 4 }, { pat: 0, reps: 4 }, { pat: 1, reps: 2 }, { pat: 0, reps: 6 }, ...Array(12).fill(null)];
  T[0].list = [{ pat: -1, reps: 1 }, { pat: 0, reps: 1 }, { pat: -1, reps: 1 }, { pat: 0, reps: 1 }, ...Array(12).fill(null)];
  T[1].list = [{ pat: -1, reps: 8 }, { pat: 0, reps: 8 }, ...Array(14).fill(null)];
  T[3].list = [{ pat: 0, reps: 1 }, ...Array(15).fill(null)];
  T[5].list = [{ pat: 0, reps: 1 }, ...Array(15).fill(null)];
  T[6].list = [{ pat: 0, reps: 1 }, ...Array(15).fill(null)];
  s.fx.cmix = 0.5;
  return s;
}

export function demoProject() {
  const p = newProject('Set de démo');
  p.songs = [demoSong(), newSong('Titre 2')];
  return p;
}

// ------------------------------------------------------------------ validation / migration
export function normalizeProject(p) {
  if (!p || p.format !== FORMAT) throw new Error('Fichier non reconnu (format Revolte attendu)');
  p.samples = p.samples || {};
  p.userSounds = p.userSounds || [];
  p.favorites = p.favorites || [];
  for (const s of p.songs) normalizeSong(s);
  return p;
}
export function normalizeSong(s) {
  s.id = s.id || uid();
  s.fx = { ...defaultParams(FX_PARAMS), ...(s.fx || {}) };
  s.scenes = s.scenes || Array.from({ length: NUM_SCENES }, () => null);
  s.launchQuant = s.launchQuant || 'BAR';
  s.scale = s.scale || { root: 0, id: 'MINOR' };
  s.tracks.forEach((t, i) => {
    const d = newTrack(i);
    t.mix = { ...d.mix, ...t.mix };
    t.play = { ...d.play, ...t.play };
    t.sound.params = { ...d.sound.engine === t.sound.engine ? d.sound.params : {}, ...t.sound.params };
    t.sound.laneSamples = t.sound.laneSamples || [];
    t.list = t.list || Array(16).fill(null);
    t.stripKnobs = t.stripKnobs || d.stripKnobs;
    t.patterns = t.patterns || Array(NUM_PATTERNS).fill(null);
    while (t.patterns.length < NUM_PATTERNS) t.patterns.push(null);
    for (const pat of t.patterns) if (pat) { pat.lanes = pat.lanes || [[]]; pat.length = Math.min(MAX_STEPS, pat.length || 16); }
  });
  return s;
}

// song data sent to the engine (drops UI-only fields)
export function engineSong(song) {
  return {
    bpm: song.bpm, songMode: song.songMode, fx: song.fx,
    tracks: song.tracks.map((t) => ({ kind: t.kind, sound: t.sound, mix: t.mix, play: t.play, patterns: t.patterns, list: t.list, cur: t.cur })),
  };
}
