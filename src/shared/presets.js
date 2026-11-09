// Revolte — factory sounds and drum kits
import { soundParamDefs, defaultParams } from './params.js';

const S = (name, type, engine, p) => ({ name, type, engine, params: { ...defaultParams(soundParamDefs('synth', engine)), ...p } });

export const FACTORY_SOUNDS = [
  // ---- BASS
  S('Acid 303', 'BASS', 'ANALOG', { o1w: 0, mix: 0, ftype: 3, cut: 380, res: 0.72, fenv: 0.55, fdrv: 0.35, eD: 220, aA: 1, aD: 300, aS: 0.8, aR: 40, mode: 1, glide: 0, ktrk: 0.2, velc: 0.3, vol: 0.75 }),
  S('Sub Bass', 'BASS', 'ANALOG', { o1w: 3, o2w: 2, o2s: 0, mix: 0.3, sub: 0.5, ftype: 0, cut: 900, res: 0.05, fenv: 0.1, aA: 2, aD: 800, aS: 0.9, aR: 120, mode: 2, glide: 40, vol: 0.85 }),
  S('Reese', 'BASS', 'ANALOG', { o1w: 0, o2w: 0, o2f: 18, mix: 0.5, ftype: 3, cut: 700, res: 0.3, fenv: 0.15, aA: 3, aS: 1, aR: 150, mode: 2, glide: 60, lc: 0.15, lr: 0.3, vol: 0.7 }),
  S('Rubber', 'BASS', 'ANALOG', { o1w: 1, pw: 0.3, mix: 0, ftype: 0, cut: 300, res: 0.55, fenv: 0.6, eD: 140, aD: 250, aS: 0.4, aR: 60, mode: 1, vol: 0.8 }),
  S('Techno Saw', 'BASS', 'ANALOG', { o1w: 0, o2w: 0, o2s: -12, mix: 0.4, ftype: 3, cut: 520, res: 0.45, fenv: 0.45, eD: 160, aD: 200, aS: 0.3, aR: 50, mode: 1, fdrv: 0.5, vol: 0.75 }),
  S('FM Bass', 'BASS', 'FM', { alg: 1, op1r: 2, op2r: 2, op2l: 0.7, op2d: 200, op2s: 0.1, op3l: 0.2, fb: 0.3, cut: 4000, fenv: 0, aS: 0.8, aR: 80, mode: 1, vol: 0.8 }),
  S('Wood Bass', 'BASS', 'PLUCK', { ptone: 0.3, pdamp: 0.6, pdec: 0.7, pbody: 0.5, pmix: 0.4, cut: 2200, res: 0.1, fenv: 0, aS: 1, aR: 200, mode: 1, oct: -1, vol: 0.9 }),
  // ---- LEAD
  S('Saw Lead', 'LEAD', 'ANALOG', { o1w: 0, o2w: 0, o2f: 9, mix: 0.5, cut: 3200, res: 0.25, fenv: 0.3, aA: 3, aS: 0.85, aR: 250, mode: 2, glide: 50, lp: 0.15, lr: 5.5, vol: 0.6 }),
  S('Square Lead', 'LEAD', 'ANALOG', { o1w: 1, o2w: 1, o2s: 12, pw: 0.35, mix: 0.3, cut: 2600, res: 0.3, fenv: 0.25, aS: 0.9, aR: 180, mode: 1, ls: 0.25, lr: 0.8, vol: 0.55 }),
  S('Hoover', 'LEAD', 'ANALOG', { o1w: 4, det: 0.8, o2w: 1, o2s: -12, mix: 0.3, cut: 4500, res: 0.15, e2p: -5, eA: 1, eD: 180, aS: 1, aR: 300, mode: 2, glide: 120, vol: 0.5 }),
  S('FM Bell Lead', 'LEAD', 'FM', { alg: 5, op1r: 2, op2r: 9, op2l: 0.4, op2d: 600, op3r: 2, op3l: 0.8, op4r: 4, op4l: 0.35, op4d: 300, cut: 9000, fenv: 0, aS: 0.7, aR: 600, vol: 0.55 }),
  // ---- PAD
  S('Super Pad', 'PAD', 'ANALOG', { o1w: 4, det: 0.45, o2w: 0, o2s: 12, mix: 0.25, cut: 2400, res: 0.15, fenv: 0.15, eA: 900, eD: 2000, eS: 0.5, aA: 600, aD: 2000, aS: 0.85, aR: 1600, lc: 0.1, lr: 0.2, spread: 0.8, vol: 0.45 }),
  S('Warm Pad', 'PAD', 'ANALOG', { o1w: 0, o2w: 2, o2f: 12, mix: 0.4, cut: 1200, res: 0.2, fenv: 0.2, eA: 1200, eD: 3000, eS: 0.4, aA: 900, aS: 0.9, aR: 2500, ls: 0.3, lr: 0.4, spread: 0.6, vol: 0.5 }),
  S('Glass Pad', 'PAD', 'FM', { alg: 7, op1r: 2, op2r: 4, op2l: 0.3, op3r: 2, op3l: 0.5, op4r: 7, op4l: 0.2, op1a: 600, op2a: 800, op3a: 900, op1s: 0.8, op2s: 0.7, op3s: 0.6, aA: 700, aS: 0.9, aR: 2500, cut: 8000, fenv: 0, vol: 0.45 }),
  // ---- KEYS
  S('E-Piano', 'KEYS', 'FM', { alg: 5, op1r: 2, op2r: 2, op2l: 0.35, op2d: 700, op2s: 0, op3r: 2, op3l: 0.6, op4r: 16, op4l: 0.15, op4d: 120, op4s: 0, op1d: 2500, op1s: 0.2, op3d: 1500, op3s: 0.1, cut: 9000, fenv: 0, aS: 1, aR: 500, vol: 0.6 }),
  S('Organ', 'KEYS', 'FM', { alg: 8, op1r: 2, op2r: 4, op3r: 6, op4r: 8, op1l: 1, op2l: 0.6, op3l: 0.4, op4l: 0.25, op1s: 1, op2s: 1, op3s: 1, op4s: 1, aA: 4, aS: 1, aR: 80, cut: 7000, fenv: 0, la: 0.1, lr: 6, vol: 0.45 }),
  S('Stab Chord', 'KEYS', 'ANALOG', { o1w: 0, o2w: 1, o2s: 7, mix: 0.4, cut: 1800, res: 0.35, fenv: 0.45, eD: 250, aD: 350, aS: 0, aR: 200, vol: 0.55 }),
  // ---- PLUCK
  S('Pluck KS', 'PLUCK', 'PLUCK', { ptone: 0.8, pdamp: 0.35, pdec: 0.6, pbody: 0.25, cut: 7000, fenv: 0, aS: 1, aR: 400, vol: 0.7 }),
  S('Koto', 'PLUCK', 'PLUCK', { ptone: 0.95, pdamp: 0.2, pdec: 0.75, pbody: 0.1, pmix: 0.5, cut: 9000, fenv: 0, aS: 1, aR: 600, vol: 0.65 }),
  S('Synth Pluck', 'PLUCK', 'ANALOG', { o1w: 0, o2w: 1, o2s: 12, mix: 0.3, cut: 900, res: 0.3, fenv: 0.7, eD: 180, aD: 300, aS: 0, aR: 250, vol: 0.6 }),
  S('Marimba', 'PLUCK', 'FM', { alg: 5, op1r: 2, op2r: 8, op2l: 0.35, op2d: 60, op2s: 0, op3r: 2, op3l: 0.4, op4r: 14, op4l: 0.2, op4d: 40, op4s: 0, op1d: 500, op1s: 0, op3d: 300, op3s: 0, cut: 9000, fenv: 0, aR: 400, vol: 0.7 }),
  // ---- FX
  S('Riser Noise', 'FX', 'ANALOG', { o1w: 3, mix: 0, noise: 1, ftype: 1, cut: 800, res: 0.6, fenv: 0.8, eA: 3000, eD: 2000, eS: 1, aA: 2500, aS: 1, aR: 1500, vol: 0.4 }),
  S('Laser', 'FX', 'ANALOG', { o1w: 0, mix: 0, e2p: 24, eA: 1, eD: 120, cut: 5000, aD: 200, aS: 0, aR: 100, vol: 0.5 }),
  // ---- SAMPLE
  S('Sampler', 'FX', 'SAMPLE', { smode: 0, cut: 20000, res: 0, fenv: 0, aA: 1, aD: 1000, aS: 1, aR: 50, vol: 0.8 }),
  S('Slicer', 'FX', 'SAMPLE', { smode: 3, slices: 16, cut: 20000, res: 0, fenv: 0, aA: 1, aD: 1000, aS: 1, aR: 20, vol: 0.8 }),
];

// Drum kits: lane overrides [model, tune, decay, tone, snap, level, pan, choke]
const lane = (m, t = 0, d = 0.5, o = 0.5, n = 0.5, v = 0.8, p = 0, c = 0) => ({ m, t, d, o, n, v, p, c });
function kit(name, lanes, extra = {}) {
  const params = { ...defaultParams(soundParamDefs('drum')), ...extra };
  lanes.forEach((l, i) => {
    params[`l${i}m`] = l.m; params[`l${i}t`] = l.t; params[`l${i}d`] = l.d; params[`l${i}o`] = l.o;
    params[`l${i}n`] = l.n; params[`l${i}v`] = l.v; params[`l${i}p`] = l.p; params[`l${i}c`] = l.c;
  });
  return { name, type: 'DRUM', engine: 'DRUM', params };
}
export const DRUM_KITS = [
  kit('808 Classic', [lane(0, 0, 0.6, 0.4, 0.3, 0.95), lane(1, 0, 0.45, 0.5, 0.6, 0.7), lane(2, 0, 0.4, 0.5, 0.5, 0.7, 0.1), lane(3, 0, 0.3, 0.5, 0.5, 0.55, 0.2, 1), lane(4, 0, 0.45, 0.5, 0.5, 0.5, 0.2, 1), lane(5, 0, 0.5, 0.5, 0.4, 0.65, -0.3), lane(5, 7, 0.45, 0.5, 0.4, 0.6, 0.3), lane(7, 0, 0.4, 0.5, 0.5, 0.5, -0.2)]),
  kit('909 Techno', [lane(12, 0, 0.5, 0.45, 0.7, 1), lane(13, 0, 0.45, 0.6, 0.7, 0.7), lane(2, 2, 0.35, 0.6, 0.6, 0.7, 0.1), lane(3, 2, 0.25, 0.6, 0.6, 0.5, 0.25, 1), lane(4, 2, 0.4, 0.6, 0.6, 0.45, 0.25, 1), lane(6, 0, 0.4, 0.5, 0.6, 0.55, -0.2), lane(9, 0, 0.45, 0.6, 0.5, 0.35, -0.3), lane(10, 0, 0.35, 0.6, 0.6, 0.4, 0.35)]),
  kit('Perc Tribal', [lane(5, -5, 0.5, 0.6, 0.4, 0.8, -0.4), lane(5, 0, 0.45, 0.5, 0.4, 0.75, 0), lane(5, 7, 0.4, 0.4, 0.4, 0.7, 0.4), lane(8, 0, 0.4, 0.5, 0.5, 0.6, 0.3), lane(7, 0, 0.45, 0.5, 0.5, 0.5, -0.3), lane(6, 0, 0.5, 0.5, 0.5, 0.6, 0.2), lane(10, 0, 0.3, 0.5, 0.3, 0.5, -0.2), lane(11, 0, 0.3, 0.5, 0.4, 0.45, 0)]),
  kit('Minimal Click', [lane(0, 3, 0.35, 0.25, 0.8, 0.95), lane(6, 2, 0.3, 0.5, 0.8, 0.6), lane(2, 5, 0.25, 0.7, 0.4, 0.55), lane(3, 5, 0.15, 0.8, 0.8, 0.45, 0, 1), lane(4, 5, 0.3, 0.8, 0.6, 0.4, 0, 1), lane(8, 3, 0.3, 0.5, 0.5, 0.5, 0.4), lane(11, 0, 0.2, 0.7, 0.2, 0.4, -0.4), lane(10, 0, 0.2, 0.8, 0.8, 0.35)]),
  kit('Industrial', [lane(12, -3, 0.7, 0.7, 1, 1), lane(13, -2, 0.6, 0.3, 0.9, 0.8), lane(2, -4, 0.6, 0.3, 0.8, 0.75), lane(3, -3, 0.3, 0.2, 0.9, 0.5, 0, 1), lane(9, -5, 0.6, 0.2, 0.8, 0.4), lane(5, -12, 0.7, 0.8, 0.8, 0.7), lane(11, -5, 0.5, 0.9, 0.8, 0.5), lane(7, -7, 0.5, 0.5, 0.5, 0.45)], { kdrv: 0.4 }),
  kit('Lo-Fi Soft', [lane(0, -2, 0.5, 0.2, 0.1, 0.85), lane(1, -3, 0.35, 0.3, 0.3, 0.6), lane(10, 0, 0.3, 0.3, 0.2, 0.45), lane(3, -4, 0.2, 0.2, 0.2, 0.4, 0, 1), lane(4, -4, 0.35, 0.2, 0.2, 0.35, 0, 1), lane(6, -3, 0.3, 0.3, 0.3, 0.5), lane(8, -5, 0.3, 0.3, 0.3, 0.45), lane(5, -2, 0.4, 0.3, 0.2, 0.5)], { cut: 7000 }),
];
export const SOUND_TYPES = ['ALL', 'BASS', 'LEAD', 'PAD', 'KEYS', 'PLUCK', 'FX', 'FAV', 'USER'];
