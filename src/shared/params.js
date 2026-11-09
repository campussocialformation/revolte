// Revolte — shared definitions (UI + audio engine)
// Parameter schemas, sequencer constants, scales and chords.

export const NUM_TRACKS = 8;
export const MAX_STEPS = 128;      // 8 bars of 1/16
export const NUM_PATTERNS = 16;    // A..P per track
export const NUM_SCENES = 16;
export const NUM_LANES = 8;        // drum lanes
export const PATTERN_NAMES = 'ABCDEFGHIJKLMNOP'.split('');

// Step resolutions, in beats (quarter notes)
export const RESOLUTIONS = [
  { id: '1/32', beats: 0.125 },
  { id: '1/16T', beats: 1 / 6 },
  { id: '1/16', beats: 0.25 },
  { id: '1/8T', beats: 1 / 3 },
  { id: '1/8', beats: 0.5 },
  { id: '1/4T', beats: 2 / 3 },
  { id: '1/4', beats: 1 },
  { id: '1/2', beats: 2 },
  { id: '1/1', beats: 4 },
  { id: '2 BAR', beats: 8 },
];
export const resBeats = (id) => (RESOLUTIONS.find((r) => r.id === id) || RESOLUTIONS[2]).beats;

export const DIRECTIONS = ['FWD', 'RVRS', 'PING', 'RAND'];

// Trig conditions. a:b = plays on pass a of every b passes.
export const CONDITIONS = [
  { id: 'ALL', label: 'TOUJOURS' },
  { id: 'FILL', label: 'FILL' },
  { id: '!FILL', label: '!FILL' },
  { id: 'FIRST', label: '1ER' },
  { id: '!FIRST', label: '!1ER' },
  { id: 'PRE', label: 'PRE' },
  { id: '!PRE', label: '!PRE' },
  { id: '1:2', a: 1, b: 2 }, { id: '2:2', a: 2, b: 2 },
  { id: '1:3', a: 1, b: 3 }, { id: '2:3', a: 2, b: 3 }, { id: '3:3', a: 3, b: 3 },
  { id: '1:4', a: 1, b: 4 }, { id: '2:4', a: 2, b: 4 }, { id: '3:4', a: 3, b: 4 }, { id: '4:4', a: 4, b: 4 },
  { id: '1:8', a: 1, b: 8 }, { id: '8:8', a: 8, b: 8 },
];

export const LAUNCH_QUANT = ['LOOP', 'BAR', 'BEAT', 'NOW'];

export const SCALES = [
  { id: 'CHROMA', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 'MAJOR', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'MINOR', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'DORIAN', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'PHRYGIAN', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'LYDIAN', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'MIXOLYD', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'LOCRIAN', steps: [0, 1, 3, 5, 6, 8, 10] },
  { id: 'HARM MIN', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'MEL MIN', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'PENTA MAJ', steps: [0, 2, 4, 7, 9] },
  { id: 'PENTA MIN', steps: [0, 3, 5, 7, 10] },
  { id: 'BLUES', steps: [0, 3, 5, 6, 7, 10] },
  { id: 'WHOLE', steps: [0, 2, 4, 6, 8, 10] },
  { id: 'HIRAJOSHI', steps: [0, 2, 3, 7, 8] },
  { id: 'ARABIC', steps: [0, 1, 4, 5, 7, 8, 11] },
];
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n) => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

export function quantizeToScale(note, root, scaleId) {
  const sc = SCALES.find((s) => s.id === scaleId) || SCALES[0];
  if (sc.steps.length === 12) return note;
  const rel = (((note - root) % 12) + 12) % 12;
  let best = sc.steps[0], bd = 99;
  for (const s of sc.steps) {
    for (const cand of [s, s + 12, s - 12]) {
      const d = Math.abs(cand - rel);
      if (d < bd || (d === bd && cand < best)) { bd = d; best = cand; }
    }
  }
  return note - rel + best;
}

export const CHORDS = [
  { id: 'OFF', iv: [0] },
  { id: 'MAJ', iv: [0, 4, 7] },
  { id: 'MIN', iv: [0, 3, 7] },
  { id: 'MAJ7', iv: [0, 4, 7, 11] },
  { id: 'MIN7', iv: [0, 3, 7, 10] },
  { id: 'DOM7', iv: [0, 4, 7, 10] },
  { id: 'SUS2', iv: [0, 2, 7] },
  { id: 'SUS4', iv: [0, 5, 7] },
  { id: 'POWER', iv: [0, 7, 12] },
  { id: 'SCALE', iv: null }, // diatonic triad from the song scale
];
export const VOICINGS = ['CLOSE', 'OPEN', 'DROP2', 'SPREAD', 'INV1'];

export const ARP_MODES = ['OFF', 'UP', 'DOWN', 'UPDN', 'DNUP', 'RAND', 'ORDER', 'CHORD', 'CONV', 'DIV', 'PINKY', 'THUMB', 'UP+OCT', 'RANDWALK'];
export const ARP_RATES = ['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'];

export const LFO_SYNC = [
  { id: 'FREE', beats: 0 }, { id: '4 BAR', beats: 16 }, { id: '2 BAR', beats: 8 }, { id: '1 BAR', beats: 4 },
  { id: '1/2', beats: 2 }, { id: '1/4', beats: 1 }, { id: '1/8', beats: 0.5 }, { id: '1/16', beats: 0.25 },
  { id: '1/32', beats: 0.125 }, { id: '1/4T', beats: 2 / 3 }, { id: '1/8T', beats: 1 / 3 }, { id: '1/16T', beats: 1 / 6 },
];
export const DELAY_SYNC = [
  { id: '1/32', beats: 0.125 }, { id: '1/16T', beats: 1 / 6 }, { id: '1/16', beats: 0.25 }, { id: '1/16D', beats: 0.375 },
  { id: '1/8T', beats: 1 / 3 }, { id: '1/8', beats: 0.5 }, { id: '1/8D', beats: 0.75 }, { id: '1/4T', beats: 2 / 3 },
  { id: '1/4', beats: 1 }, { id: '1/4D', beats: 1.5 }, { id: '1/2', beats: 2 }, { id: '1/1', beats: 4 },
];

export const MOD_SOURCES = ['OFF', 'LFO', 'ENV2', 'VEL', 'KEY', 'RAND', 'MODW', 'S&H', 'SLEW'];
export const MOD_DESTS = ['PITCH', 'CUTOFF', 'RESO', 'SHAPE', 'AMP', 'PAN', 'LFO RATE', 'LFO DEPTH', 'DRIVE', 'ATTACK', 'DECAY'];

export const DRUM_MODELS = ['KICK', 'SNARE', 'CLAP', 'HAT C', 'HAT O', 'TOM', 'RIM', 'COWBELL', 'CLAVE', 'CYMBAL', 'SHAKER', 'ZAP', 'KICK 909', 'SNARE 909', 'SAMPLE'];

export const DRIVE_TYPES = ['OFF', 'SOFT', 'HARD', 'FOLD', 'CRUSH', 'FUZZ'];
export const ENGINES = ['ANALOG', 'FM', 'PLUCK', 'SAMPLE'];

// ---------------------------------------------------------------------------
// Parameter schemas
// p(id, label, min, max, def, opts)
//   opts.curve: 'exp' for log-scaled knobs
//   opts.options: array => enum (value is the index)
//   opts.int: integer
//   opts.unit: display unit
const P = (id, label, min, max, def, o = {}) => ({ id, label, min, max, def, ...o });
const E = (id, label, options, def = 0, o = {}) => ({ id, label, min: 0, max: options.length - 1, def, options, int: true, ...o });

const FM_RATIOS = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
export { FM_RATIOS };

export const COMMON_PARAMS = [
  P('vol', 'NIVEAU', 0, 1, 0.7, { group: 'OUT' }),
  E('ftype', 'FILTRE', ['LP', 'BP', 'HP', 'LP4'], 0, { group: 'FILTRE' }),
  P('cut', 'CUTOFF', 20, 20000, 6000, { curve: 'exp', unit: 'Hz', group: 'FILTRE' }),
  P('res', 'RESO', 0, 1, 0.15, { group: 'FILTRE' }),
  P('fdrv', 'DRIVE', 0, 1, 0, { group: 'FILTRE' }),
  P('fenv', 'ENV>CUT', -1, 1, 0.25, { group: 'FILTRE' }),
  P('ktrk', 'KEYTRK', 0, 1, 0.3, { group: 'FILTRE' }),
  P('velc', 'VEL>CUT', 0, 1, 0.2, { group: 'FILTRE' }),
  P('aA', 'ATTACK', 0.5, 8000, 3, { curve: 'exp', unit: 'ms', group: 'AMP' }),
  P('aD', 'DECAY', 1, 8000, 400, { curve: 'exp', unit: 'ms', group: 'AMP' }),
  P('aS', 'SUSTAIN', 0, 1, 0.7, { group: 'AMP' }),
  P('aR', 'RELEASE', 1, 8000, 200, { curve: 'exp', unit: 'ms', group: 'AMP' }),
  P('eA', 'ATTACK', 0.5, 8000, 2, { curve: 'exp', unit: 'ms', group: 'ENV 2' }),
  P('eD', 'DECAY', 1, 8000, 350, { curve: 'exp', unit: 'ms', group: 'ENV 2' }),
  P('eS', 'SUSTAIN', 0, 1, 0, { group: 'ENV 2' }),
  P('eR', 'RELEASE', 1, 8000, 250, { curve: 'exp', unit: 'ms', group: 'ENV 2' }),
  P('e2p', 'ENV>PITCH', -24, 24, 0, { unit: 'st', group: 'ENV 2' }),
  P('e2s', 'ENV>SHAPE', -1, 1, 0, { group: 'ENV 2' }),
  E('lw', 'FORME', ['SINE', 'TRI', 'SAW', 'SQR', 'S&H', 'SLEW'], 0, { group: 'LFO' }),
  P('lr', 'VITESSE', 0.05, 30, 3, { curve: 'exp', unit: 'Hz', group: 'LFO' }),
  E('lsync', 'SYNC', LFO_SYNC.map((s) => s.id), 0, { group: 'LFO' }),
  E('ltrig', 'TRIG', ['FREE', 'NOTE'], 0, { group: 'LFO' }),
  P('lp', 'LFO>PITCH', 0, 12, 0, { unit: 'st', group: 'LFO' }),
  P('lc', 'LFO>CUT', 0, 1, 0, { group: 'LFO' }),
  P('ls', 'LFO>SHAPE', 0, 1, 0, { group: 'LFO' }),
  P('la', 'LFO>AMP', 0, 1, 0, { group: 'LFO' }),
  E('mode', 'VOIX', ['POLY', 'MONO', 'LEGATO', 'UNISON'], 0, { group: 'VOIX' }),
  P('glide', 'GLIDE', 0, 2000, 0, { curve: 'exp', unit: 'ms', group: 'VOIX' }),
  P('udet', 'DETUNE', 0, 1, 0.2, { group: 'VOIX' }),
  P('spread', 'SPREAD', 0, 1, 0.3, { group: 'VOIX' }),
  P('oct', 'OCTAVE', -3, 3, 0, { int: true, group: 'VOIX' }),
  E('m1s', 'SRC 1', MOD_SOURCES, 0, { group: 'MATRICE' }), E('m1d', 'DEST 1', MOD_DESTS, 1, { group: 'MATRICE' }), P('m1a', 'AMT 1', -1, 1, 0, { group: 'MATRICE' }),
  E('m2s', 'SRC 2', MOD_SOURCES, 0, { group: 'MATRICE' }), E('m2d', 'DEST 2', MOD_DESTS, 0, { group: 'MATRICE' }), P('m2a', 'AMT 2', -1, 1, 0, { group: 'MATRICE' }),
  E('m3s', 'SRC 3', MOD_SOURCES, 0, { group: 'MATRICE' }), E('m3d', 'DEST 3', MOD_DESTS, 3, { group: 'MATRICE' }), P('m3a', 'AMT 3', -1, 1, 0, { group: 'MATRICE' }),
  E('m4s', 'SRC 4', MOD_SOURCES, 0, { group: 'MATRICE' }), E('m4d', 'DEST 4', MOD_DESTS, 4, { group: 'MATRICE' }), P('m4a', 'AMT 4', -1, 1, 0, { group: 'MATRICE' }),
];

export const ENGINE_PARAMS = {
  ANALOG: [
    E('o1w', 'OSC 1', ['SAW', 'SQR', 'TRI', 'SINE', 'SUPER'], 0, { group: 'OSC' }),
    E('o2w', 'OSC 2', ['SAW', 'SQR', 'TRI', 'SINE'], 1, { group: 'OSC' }),
    P('o2s', 'O2 SEMI', -24, 24, 0, { int: true, unit: 'st', group: 'OSC' }),
    P('o2f', 'O2 FINE', -50, 50, 7, { unit: 'ct', group: 'OSC' }),
    P('mix', 'MIX 1/2', 0, 1, 0.4, { group: 'OSC' }),
    P('pw', 'PW', 0.05, 0.95, 0.5, { group: 'OSC' }),
    P('det', 'SUPER DET', 0, 1, 0.35, { group: 'OSC' }),
    P('sub', 'SUB', 0, 1, 0, { group: 'OSC' }),
    P('noise', 'BRUIT', 0, 1, 0, { group: 'OSC' }),
  ],
  FM: [
    P('alg', 'ALGO', 1, 8, 1, { int: true, group: 'FM' }),
    P('fb', 'FEEDBACK', 0, 1, 0.1, { group: 'FM' }),
    P('fmamt', 'INDEX', 0, 2, 1, { group: 'FM' }),
    ...[1, 2, 3, 4].flatMap((i) => [
      E(`op${i}r`, `OP${i} RATIO`, FM_RATIOS.map(String), [2, 2, 4, 2][i - 1], { group: `OP${i}` }),
      P(`op${i}t`, `OP${i} FINE`, -1, 1, 0, { group: `OP${i}` }),
      P(`op${i}l`, `OP${i} NIV`, 0, 1, [1, 0.5, 0.4, 0.3][i - 1], { group: `OP${i}` }),
      P(`op${i}a`, `OP${i} ATK`, 0.5, 5000, 1, { curve: 'exp', unit: 'ms', group: `OP${i}` }),
      P(`op${i}d`, `OP${i} DEC`, 5, 8000, [800, 400, 300, 200][i - 1], { curve: 'exp', unit: 'ms', group: `OP${i}` }),
      P(`op${i}s`, `OP${i} SUS`, 0, 1, [0.6, 0.2, 0.1, 0][i - 1], { group: `OP${i}` }),
    ]),
  ],
  PLUCK: [
    P('ptone', 'ATTAQUE', 0, 1, 0.7, { group: 'PLUCK' }),
    P('pdamp', 'AMORTI', 0, 1, 0.4, { group: 'PLUCK' }),
    P('pdec', 'TENUE', 0, 1, 0.8, { group: 'PLUCK' }),
    P('pbody', 'POSITION', 0, 1, 0.3, { group: 'PLUCK' }),
    P('pmix', 'CORPS', 0, 1, 0.2, { group: 'PLUCK' }),
  ],
  SAMPLE: [
    E('smode', 'MODE', ['ONESHOT', 'GATE', 'LOOP', 'SLICE'], 0, { group: 'SAMPLE' }),
    P('root', 'NOTE RACINE', 24, 96, 60, { int: true, group: 'SAMPLE' }),
    P('stune', 'ACCORD', -24, 24, 0, { unit: 'st', group: 'SAMPLE' }),
    P('sstart', 'DEBUT', 0, 1, 0, { group: 'SAMPLE' }),
    P('send', 'FIN', 0, 1, 1, { group: 'SAMPLE' }),
    P('slices', 'SLICES', 2, 32, 16, { int: true, group: 'SAMPLE' }),
    E('rev', 'REVERSE', ['OFF', 'ON'], 0, { group: 'SAMPLE' }),
    P('sgain', 'GAIN', 0, 2, 1, { group: 'SAMPLE' }),
  ],
};

// Drum kit parameters: 8 lanes x lane params + kit-wide
export const LANE_PARAM_DEFS = [
  ['m', 'MODELE'], ['t', 'TUNE'], ['d', 'DECAY'], ['o', 'TONE'], ['n', 'SNAP'], ['v', 'NIVEAU'], ['p', 'PAN'], ['c', 'CHOKE'],
];
export function laneParams(i) {
  return [
    E(`l${i}m`, `L${i + 1} MODELE`, DRUM_MODELS, [0, 1, 2, 3, 4, 5, 6, 7][i], { group: `L${i + 1}` }),
    P(`l${i}t`, `L${i + 1} TUNE`, -24, 24, 0, { unit: 'st', group: `L${i + 1}` }),
    P(`l${i}d`, `L${i + 1} DECAY`, 0, 1, 0.5, { group: `L${i + 1}` }),
    P(`l${i}o`, `L${i + 1} TONE`, 0, 1, 0.5, { group: `L${i + 1}` }),
    P(`l${i}n`, `L${i + 1} SNAP`, 0, 1, 0.5, { group: `L${i + 1}` }),
    P(`l${i}v`, `L${i + 1} NIVEAU`, 0, 1, 0.8, { group: `L${i + 1}` }),
    P(`l${i}p`, `L${i + 1} PAN`, -1, 1, 0, { group: `L${i + 1}` }),
    P(`l${i}c`, `L${i + 1} CHOKE`, 0, 3, i === 3 || i === 4 ? 1 : 0, { int: true, group: `L${i + 1}` }),
  ];
}
export const DRUM_PARAMS = [
  P('vol', 'NIVEAU', 0, 1, 0.8, { group: 'KIT' }),
  P('kdec', 'DECAY KIT', 0.25, 2, 1, { group: 'KIT' }),
  P('ktune', 'TUNE KIT', -12, 12, 0, { unit: 'st', group: 'KIT' }),
  P('cut', 'CUTOFF', 20, 20000, 20000, { curve: 'exp', unit: 'Hz', group: 'KIT' }),
  P('res', 'RESO', 0, 1, 0.1, { group: 'KIT' }),
  P('hpf', 'PASSE-HAUT', 20, 2000, 20, { curve: 'exp', unit: 'Hz', group: 'KIT' }),
  P('kdrv', 'DRIVE KIT', 0, 1, 0, { group: 'KIT' }),
  ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => laneParams(i)),
];

export const MIX_PARAMS = [
  P('vol', 'VOLUME', 0, 1.2, 0.8, { group: 'MIX' }),
  P('pan', 'PAN', -1, 1, 0, { group: 'MIX' }),
  P('cho', 'CHORUS', 0, 1, 0, { group: 'SENDS' }),
  P('dly', 'DELAY', 0, 1, 0, { group: 'SENDS' }),
  P('rev', 'REVERB', 0, 1, 0, { group: 'SENDS' }),
  E('dtype', 'DIST', DRIVE_TYPES, 0, { group: 'INSERT' }),
  P('damt', 'DIST AMT', 0, 1, 0.3, { group: 'INSERT' }),
  P('dtone', 'DIST TONE', 0, 1, 0.6, { group: 'INSERT' }),
  P('duck', 'DUCK', 0, 1, 0, { group: 'DUCK' }),
  P('dsrc', 'DUCK SRC', 1, 8, 5, { int: true, group: 'DUCK' }),
  P('drel', 'DUCK REL', 20, 1000, 180, { curve: 'exp', unit: 'ms', group: 'DUCK' }),
];

export const FX_PARAMS = [
  E('chmode', 'MODE', ['CHORUS', 'FLANGER', 'PHASER'], 0, { group: 'CHORUS' }),
  P('chrate', 'VITESSE', 0.05, 8, 0.6, { curve: 'exp', unit: 'Hz', group: 'CHORUS' }),
  P('chdepth', 'PROF.', 0, 1, 0.5, { group: 'CHORUS' }),
  P('chfb', 'FEEDBACK', 0, 0.95, 0.2, { group: 'CHORUS' }),
  E('dlmode', 'MODE', ['MONO', 'STEREO', 'PING'], 2, { group: 'DELAY' }),
  E('dltime', 'TEMPS', DELAY_SYNC.map((d) => d.id), 6, { group: 'DELAY' }),
  P('dlfb', 'FEEDBACK', 0, 0.98, 0.45, { group: 'DELAY' }),
  P('dlcolor', 'COULEUR', 0, 1, 0.55, { group: 'DELAY' }),
  P('dlwidth', 'LARGEUR', 0, 1, 0.8, { group: 'DELAY' }),
  E('rvtype', 'TYPE', ['ROOM', 'HALL', 'PLATE'], 1, { group: 'REVERB' }),
  P('rvsize', 'TAILLE', 0, 1, 0.75, { group: 'REVERB' }),
  P('rvdamp', 'AMORTI', 0, 1, 0.45, { group: 'REVERB' }),
  P('rvpre', 'PRE-DELAY', 0, 200, 15, { unit: 'ms', group: 'REVERB' }),
  P('rvlvl', 'RETOUR', 0, 1.5, 0.8, { group: 'REVERB' }),
  // master chain
  P('mfilt', 'FILTRE DJ', -1, 1, 0, { group: 'MASTER' }),
  P('mres', 'RESO DJ', 0, 1, 0.3, { group: 'MASTER' }),
  P('eqlo', 'EQ BAS', -15, 15, 0, { unit: 'dB', group: 'MASTER EQ' }),
  P('eqmid', 'EQ MEDIUM', -15, 15, 0, { unit: 'dB', group: 'MASTER EQ' }),
  P('eqhi', 'EQ AIGU', -15, 15, 0, { unit: 'dB', group: 'MASTER EQ' }),
  P('mdrive', 'SATURATION', 0, 1, 0, { group: 'MASTER' }),
  P('mcrush', 'CRUSH', 0, 1, 0, { group: 'MASTER' }),
  P('cthr', 'COMP SEUIL', -40, 0, -10, { unit: 'dB', group: 'COMP' }),
  P('cratio', 'COMP RATIO', 1, 20, 3, { curve: 'exp', group: 'COMP' }),
  P('catk', 'COMP ATK', 0.1, 100, 10, { curve: 'exp', unit: 'ms', group: 'COMP' }),
  P('crel', 'COMP REL', 10, 1000, 150, { curve: 'exp', unit: 'ms', group: 'COMP' }),
  P('cmix', 'COMP MIX', 0, 1, 0, { group: 'COMP' }),
  P('mwidth', 'STEREO', 0, 2, 1, { group: 'MASTER' }),
  P('mvol', 'VOLUME', 0, 1.5, 0.9, { group: 'MASTER' }),
  E('limit', 'LIMITEUR', ['OFF', 'ON'], 1, { group: 'MASTER' }),
  // performance macros
  P('pdepth', 'FX DEPTH', 0, 1, 1, { group: 'PERF' }),
  P('throw', 'THROW', 0, 1, 0, { group: 'PERF' }),
];

export const ARP_PARAMS = [
  E('arp', 'ARP', ARP_MODES, 0, { group: 'ARP' }),
  E('arate', 'VITESSE', ARP_RATES, 3, { group: 'ARP' }),
  P('aoct', 'OCTAVES', 1, 4, 1, { int: true, group: 'ARP' }),
  P('agate', 'GATE', 0.05, 1, 0.5, { group: 'ARP' }),
  P('achance', 'CHANCE', 0, 1, 1, { group: 'ARP' }),
  E('ahold', 'HOLD', ['OFF', 'ON'], 0, { group: 'ARP' }),
];

export const PLAY_PARAMS = [
  E('chord', 'ACCORD', CHORDS.map((c) => c.id), 0, { group: 'JEU' }),
  E('voicing', 'VOICING', VOICINGS, 0, { group: 'JEU' }),
  P('strum', 'STRUM', 0, 100, 0, { unit: 'ms', group: 'JEU' }),
  E('squant', 'GAMME', ['OFF', 'ON'], 0, { group: 'JEU' }),
  P('transp', 'TRANSPOSE', -24, 24, 0, { int: true, unit: 'st', group: 'JEU' }),
];

export function soundParamDefs(kind, engine) {
  if (kind === 'drum') return DRUM_PARAMS;
  return [...(ENGINE_PARAMS[engine] || ENGINE_PARAMS.ANALOG), ...COMMON_PARAMS];
}

const _defCache = new Map();
export function paramDef(kind, engine, id) {
  const key = kind === 'drum' ? 'drum' : engine;
  let m = _defCache.get(key);
  if (!m) {
    m = new Map();
    for (const d of soundParamDefs(kind, engine)) m.set(d.id, d);
    _defCache.set(key, m);
  }
  return m.get(id);
}

export function defaultParams(defs) {
  const o = {};
  for (const d of defs) o[d.id] = d.def;
  return o;
}

// Live-page knobs (Launchkey 8 knobs) per engine
export const PERF_KNOBS = {
  ANALOG: ['cut', 'res', 'fenv', 'eD', 'aA', 'aR', 'lc', 'mix'],
  FM: ['fmamt', 'fb', 'op2l', 'op3l', 'cut', 'aD', 'aR', 'lp'],
  PLUCK: ['cut', 'res', 'ptone', 'pdamp', 'pdec', 'pbody', 'aR', 'fenv'],
  SAMPLE: ['cut', 'res', 'stune', 'sstart', 'aA', 'aD', 'aR', 'fenv'],
  drum: ['kdec', 'cut', 'res', 'l0t', 'l1t', 'l3d', 'l4d', 'kdrv'],
};
// MIDImix strip knobs (3 per track), default per kind
export const STRIP_KNOBS = {
  melodic: ['cut', 'res', 'mix:dly'],
  bass: ['cut', 'res', 'fenv'],
  drum: ['cut', 'kdec', 'mix:rev'],
};

// value <-> normalized 0..1 conversion for knobs and MIDI
export function toNorm(def, v) {
  if (def.options) return def.max ? v / def.max : 0;
  if (def.curve === 'exp' && def.min > 0) return Math.log(v / def.min) / Math.log(def.max / def.min);
  if (def.curve === 'exp' && def.min === 0) {
    const m = 1; // offset log for ranges starting at 0
    return Math.log((v + m) / m) / Math.log((def.max + m) / m);
  }
  return (v - def.min) / (def.max - def.min);
}
export function fromNorm(def, n) {
  n = Math.min(1, Math.max(0, n));
  let v;
  if (def.options) v = Math.round(n * def.max);
  else if (def.curve === 'exp' && def.min > 0) v = def.min * Math.pow(def.max / def.min, n);
  else if (def.curve === 'exp' && def.min === 0) v = Math.pow(def.max + 1, n) - 1;
  else v = def.min + n * (def.max - def.min);
  if (def.int) v = Math.round(v);
  return v;
}
export function formatParam(def, v) {
  if (def.options) return def.options[Math.round(v)] ?? '?';
  if (def.unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + 'k' : v.toFixed(v < 10 ? 2 : 0);
  if (def.unit === 'ms') return v >= 1000 ? (v / 1000).toFixed(2) + 's' : v.toFixed(v < 10 ? 1 : 0) + 'ms';
  if (def.unit === 'dB') return (v > 0 ? '+' : '') + v.toFixed(1);
  if (def.int) return String(Math.round(v));
  if (def.unit === 'st') return (v > 0 ? '+' : '') + v.toFixed(1);
  if (def.min < 0 && def.max <= 1) return (v > 0 ? '+' : '') + Math.round(v * 100);
  if (def.min < 0) return (v > 0 ? '+' : '') + (Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v));
  if (def.max <= 2) return Math.round(v * 100) + (def.max === 1 ? '' : '%');
  return v.toFixed(0);
}
