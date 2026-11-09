// Revolte — melodic synth voice engine: ANALOG, FM, PLUCK, SAMPLE
import { SVF, Ladder, Env, polyblep, fsin, ftanh, mtof, clamp, rng, OnePole } from './dsp.js';
import { FM_RATIOS, LFO_SYNC } from '../shared/params.js';

const SUB = 16; // control-rate sub-block
const ENGINE_IDS = { ANALOG: 0, FM: 1, PLUCK: 2, SAMPLE: 3 };
const SUPER_DET = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1];
const SUPER_GAIN = [0.6, 0.75, 0.85, 1, 0.85, 0.75, 0.6];

// FM algorithms: modulators for each operator (0-indexed), and carriers
const FM_ALGOS = [
  { mods: [[1], [2], [3], []], car: [0] },           // 1: 4>3>2>1
  { mods: [[1], [2, 3], [], []], car: [0] },         // 2: (3+4)>2>1
  { mods: [[1, 2], [], [3], []], car: [0] },         // 3: 2>1, 4>3>1
  { mods: [[], [2], [3], []], car: [0, 1] },         // 4: 4>3>2, 1
  { mods: [[1], [], [3], []], car: [0, 2] },         // 5: 2>1, 4>3
  { mods: [[3], [3], [3], []], car: [0, 1, 2] },     // 6: 4>(1,2,3)
  { mods: [[], [], [3], []], car: [0, 1, 2] },       // 7: 4>3, 1, 2
  { mods: [[], [], [], []], car: [0, 1, 2, 3] },     // 8: additive
];

class Voice {
  constructor(sr) {
    this.sr = sr;
    this.note = 60; this.vel = 1; this.gate = false; this.age = 0; this.active = false;
    this.pitch = 60; this.target = 60; this.glideCoef = 0;
    this.ph1 = 0; this.ph2 = 0; this.phs = 0; this.sup = new Float64Array(7);
    for (let i = 0; i < 7; i++) this.sup[i] = Math.random();
    this.svf = new SVF(); this.svf2 = new SVF(); this.lad = new Ladder();
    this.amp = new Env(); this.env2 = new Env();
    this.opEnv = [new Env(), new Env(), new Env(), new Env()];
    this.opPh = new Float64Array(4); this.opOut = new Float64Array(4); this.fbPrev = 0; this.fbPrev2 = 0;
    this.ks = new Float32Array(8192); this.ksW = 0; this.ksLen = 100; this.ksLp = 0; this.ksDc = 0; this.ksDcOut = 0;
    this.body = new SVF();
    this.spos = 0; this.sinc = 1; this.sEnd = 0; this.sStart = 0; this.sDir = 1;
    this.panL = 1; this.panR = 1; this.detune = 0; this.rand = 0; this.accent = 0;
    this.killRamp = 0; // >0 means fast fade-out in progress
    this.atkScale = 1; this.decScale = 1;
  }
}

export class MelodicSynth {
  constructor(sr, maxVoices = 8) {
    this.sr = sr;
    this.voices = [];
    for (let i = 0; i < maxVoices; i++) this.voices.push(new Voice(sr));
    this.p = null; // effective params object
    this.engine = 0;
    this.stack = []; // held notes for mono modes
    this.lfoPh = 0; this.lfoVal = 0; this.sh = 0; this.slew = 0; this.slewT = 0; this.lastLfoPh = 0;
    this.modw = 0;
    this.ageCounter = 0;
    this.sample = null; // {ch:[Float32Array], sr, len}
    this.tmpL = new Float32Array(128); this.tmpR = new Float32Array(128);
  }

  setParams(p, engineName) {
    this.p = p;
    const e = ENGINE_IDS[engineName] ?? 0;
    if (e !== this.engine) { this.engine = e; this.allOff(true); }
  }

  allOff(hard = false) {
    this.stack.length = 0;
    for (const v of this.voices) {
      v.gate = false;
      if (hard) { v.active = false; v.amp.stage = 0; v.amp.v = 0; }
      else { v.amp.gate(false); v.env2.gate(false); for (const e of v.opEnv) e.gate(false); }
    }
  }

  _alloc() {
    let best = null, bestScore = -1;
    for (const v of this.voices) {
      if (!v.active) return v;
      const score = (v.gate ? 0 : 1e9) + (this.ageCounter - v.age) + (v.gate ? 0 : (1 - v.amp.v) * 1e6);
      if (score > bestScore) { bestScore = score; best = v; }
    }
    return best;
  }

  _modSrc(src, v) {
    switch (src) {
      case 1: return this.lfoVal;
      case 2: return v.env2.v;
      case 3: return v.vel;
      case 4: return (v.note - 60) / 24;
      case 5: return v.rand;
      case 6: return this.modw;
      case 7: return this.sh;
      case 8: return this.slew;
      default: return 0;
    }
  }

  _startVoice(v, note, vel, opts, retrig = true) {
    const p = this.p;
    const sr = this.sr;
    v.note = note; v.vel = vel; v.gate = true; v.active = true; v.age = ++this.ageCounter;
    v.accent = opts.accent ? 1 : 0;
    v.rand = rng.bi();
    v.killRamp = 0;
    // note-time modulations of envelope times
    let atk = 1, dec = 1;
    for (let m = 1; m <= 4; m++) {
      const s = p['m' + m + 's'] | 0; if (!s) continue;
      const d = p['m' + m + 'd'] | 0, a = p['m' + m + 'a'];
      if (d === 9) atk *= Math.pow(4, a * this._modSrc(s, v));
      if (d === 10) dec *= Math.pow(4, a * this._modSrc(s, v));
    }
    v.amp.setup(p.aA * atk, p.aD * dec, p.aS, p.aR, sr);
    v.env2.setup(p.eA * atk, p.eD * dec, p.eS, p.eR, sr);
    if (retrig) {
      v.amp.gate(true); v.env2.gate(true, true);
      if (this.engine === 1) {
        for (let i = 0; i < 4; i++) {
          const o = i + 1;
          v.opEnv[i].setup(p['op' + o + 'a'], p['op' + o + 'd'], p['op' + o + 's'], p.aR, sr);
          v.opEnv[i].gate(true, true);
          v.opPh[i] = 0;
        }
        v.fbPrev = v.fbPrev2 = 0;
      }
      if (this.engine === 2) this._pluck(v, note);
      if (this.engine === 3) this._sampleStart(v, note);
      if (p.ftype !== 3 && v.amp.v < 0.01) v.svf.reset();
    }
    if (p.ltrig === 1) this.lfoPh = 0;
  }

  _pluck(v, note) {
    const p = this.p;
    const f = mtof(note + (p.oct | 0) * 12);
    const len = clamp(this.sr / f, 2, 8000);
    v.ksLen = len;
    const n = Math.ceil(len) + 2;
    // excitation: noise, brightness-filtered, with pick position comb
    let lp = 0; const a = 0.05 + 0.95 * p.ptone * p.ptone;
    const pick = Math.max(1, Math.floor(n * (0.05 + 0.45 * p.pbody)));
    const tmp = v.ks;
    for (let i = 0; i < n; i++) { lp += a * (rng.bi() - lp); tmp[i] = lp; }
    for (let i = n - 1; i >= pick; i--) tmp[i] = (tmp[i] - tmp[i - pick]) * 0.9;
    v.ksW = n % tmp.length; v.ksLp = 0; v.ksDc = 0; v.ksDcOut = 0;
    v.body.reset();
  }

  _sampleStart(v, note) {
    const s = this.sample; const p = this.p;
    if (!s || !s.len) { v.sinc = 0; v.sEnd = 0; return; }
    const mode = p.smode | 0;
    let a = clamp(p.sstart, 0, 1) * s.len, b = clamp(p.send, 0, 1) * s.len;
    if (b < a) { const t = a; a = b; b = t; }
    let rate = s.sr / this.sr;
    if (mode === 3) {
      const nsl = Math.max(2, p.slices | 0);
      const idx = (((note - 36) % nsl) + nsl) % nsl;
      const w = (b - a) / nsl;
      a = a + idx * w; b = a + w;
      rate *= Math.pow(2, p.stune / 12);
    } else {
      rate *= Math.pow(2, (note + (p.oct | 0) * 12 - p.root + p.stune) / 12);
    }
    v.sStart = a; v.sEnd = b;
    v.sDir = p.rev ? -1 : 1;
    v.spos = p.rev ? b - 1 : a;
    v.sinc = rate;
  }

  noteOn(note, vel, opts = {}) {
    const p = this.p; if (!p) return;
    const mode = p.mode | 0;
    if (mode === 0) { // POLY
      // retrigger same note on same voice to avoid stacking
      let v = null;
      for (const x of this.voices) if (x.active && x.gate && x.note === note) { v = x; break; }
      if (!v) v = this._alloc();
      v.pitch = v.target = note; v.detune = 0;
      v.panL = v.panR = 1;
      const sp = p.spread * ((v.age & 1) ? 1 : -1) * 0.8;
      this._setPan(v, sp);
      this._startVoice(v, note, vel, opts, true);
      return;
    }
    const legatoHeld = this.stack.length > 0;
    const idx = this.stack.indexOf(note); if (idx >= 0) this.stack.splice(idx, 1);
    this.stack.push(note);
    const glideMs = opts.slide ? Math.max(p.glide, 60) : p.glide;
    const doGlide = glideMs > 0 && (legatoHeld || mode === 1) && (legatoHeld || opts.slide);
    const nv = mode === 3 ? 4 : 1;
    const retrig = mode === 1 ? !opts.slide : !legatoHeld;
    for (let i = 0; i < nv; i++) {
      const v = this.voices[i];
      const wasActive = v.active && v.amp.v > 0.001;
      v.target = note;
      if (!wasActive || !doGlide) v.pitch = note;
      v.glideCoef = doGlide ? Math.exp(-1 / Math.max(1, (glideMs * 0.001 * this.sr) / SUB / 3)) : 0;
      v.detune = nv > 1 ? (i - 1.5) / 1.5 * p.udet * 0.35 : 0;
      this._setPan(v, nv > 1 ? (i - 1.5) / 1.5 * p.spread : 0);
      if (retrig || !v.active) this._startVoice(v, note, vel, opts, true);
      else { v.note = note; v.gate = true; v.vel = vel; v.accent = opts.accent ? 1 : 0; }
    }
  }

  _setPan(v, pan) {
    const a = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI;
    v.panL = Math.cos(a) * 1.4142; v.panR = Math.sin(a) * 1.4142;
  }

  noteOff(note) {
    const p = this.p; if (!p) return;
    const mode = p.mode | 0;
    if (mode === 0) {
      for (const v of this.voices) {
        if (v.active && v.gate && v.note === note) {
          v.gate = false;
          if (!(this.engine === 3 && (p.smode | 0) === 0)) { v.amp.gate(false); }
          v.env2.gate(false); for (const e of v.opEnv) e.gate(false);
        }
      }
      return;
    }
    const idx = this.stack.indexOf(note);
    if (idx < 0) return;
    this.stack.splice(idx, 1);
    const nv = mode === 3 ? 4 : 1;
    if (this.stack.length > 0) {
      const back = this.stack[this.stack.length - 1];
      for (let i = 0; i < nv; i++) {
        const v = this.voices[i];
        v.target = back; v.note = back;
        if (p.glide <= 0) v.pitch = back; else v.glideCoef = Math.exp(-1 / Math.max(1, (p.glide * 0.001 * this.sr) / SUB / 3));
      }
    } else {
      for (let i = 0; i < nv; i++) {
        const v = this.voices[i];
        if (v.note !== note && v.target !== note) continue;
        v.gate = false;
        if (!(this.engine === 3 && (p.smode | 0) === 0)) v.amp.gate(false);
        v.env2.gate(false); for (const e of v.opEnv) e.gate(false);
      }
    }
  }

  _lfo(n, bpm) {
    const p = this.p;
    const sync = LFO_SYNC[p.lsync | 0];
    let rate = sync && sync.beats ? bpm / 60 / sync.beats : p.lr;
    // LFO RATE / DEPTH via matrix (track-level sources only)
    let depth = 1;
    for (let m = 1; m <= 4; m++) {
      const s = p['m' + m + 's'] | 0; if (!s) continue;
      const d = p['m' + m + 'd'] | 0, a = p['m' + m + 'a'];
      if (d !== 6 && d !== 7) continue;
      const sv = s === 6 ? this.modw : s === 7 ? this.sh : s === 8 ? this.slew : 0;
      if (d === 6) rate *= Math.pow(4, a * sv); else depth *= clamp(1 + a * sv, 0, 2);
    }
    this.lfoPh += (rate * n) / this.sr;
    let wrapped = false;
    if (this.lfoPh >= 1) { this.lfoPh -= Math.floor(this.lfoPh); wrapped = true; }
    const ph = this.lfoPh;
    if (wrapped) { this.sh = rng.bi(); this.slewT = this.sh; }
    this.slew += (this.slewT - this.slew) * Math.min(1, rate * n / this.sr * 4);
    let v;
    switch (p.lw | 0) {
      case 0: v = fsin(ph); break;
      case 1: v = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph; break;
      case 2: v = 1 - 2 * ph; break;
      case 3: v = ph < 0.5 ? 1 : -1; break;
      case 4: v = this.sh; break;
      default: v = this.slew;
    }
    this.lfoVal = v * depth;
  }

  // render samples [start, end) (multiples of SUB), ADD into outL/outR
  render(outL, outR, start, end0, bpm) {
    const p = this.p; if (!p) return;
    const sr = this.sr;
    const eng = this.engine;
    const ftype = p.ftype | 0;
    const octOff = (p.oct | 0) * 12;
    const vol = p.vol * 0.35;
    let anyActive = false;
    for (const v of this.voices) if (v.active) { anyActive = true; break; }
    for (let s0 = start; s0 < end0; s0 += SUB) {
      this._lfo(SUB, bpm);
      if (!anyActive) continue;
      const lfo = this.lfoVal;
      for (const v of this.voices) {
        if (!v.active) continue;
        // glide
        if (v.glideCoef > 0) v.pitch = v.target + (v.pitch - v.target) * v.glideCoef; else v.pitch = v.target;
        const e2 = v.env2.tickN(SUB);
        // matrix
        let mPitch = 0, mCut = 0, mRes = 0, mShape = 0, mAmp = 1, mPan = 0, mDrv = 0;
        for (let m = 1; m <= 4; m++) {
          const s = p['m' + m + 's'] | 0; if (!s) continue;
          const val = this._modSrc(s, v) * p['m' + m + 'a'];
          switch (p['m' + m + 'd'] | 0) {
            case 0: mPitch += val * 12; break;
            case 1: mCut += val * 4; break;
            case 2: mRes += val; break;
            case 3: mShape += val; break;
            case 4: mAmp *= clamp(1 + val, 0, 2); break;
            case 5: mPan += val; break;
            case 8: mDrv += val; break;
          }
        }
        const pitch = v.pitch + octOff + p.e2p * e2 + lfo * p.lp + mPitch + v.detune;
        const f0 = mtof(pitch);
        const acc = v.accent;
        const cutOct = (p.fenv * (1 + acc * 0.6)) * e2 * 6 + lfo * p.lc * 3 + p.ktrk * (v.note - 60) / 12 + p.velc * (v.vel - 0.7) * 3 + mCut;
        const fc = clamp(p.cut * Math.pow(2, cutOct), 16, sr * 0.45);
        const res = clamp(p.res + mRes + acc * 0.1, 0, 1);
        if (ftype === 3) v.lad.set(fc, res, sr); else v.svf.set(fc, res * 0.97, sr);
        const drive = clamp(p.fdrv + mDrv, 0, 1);
        const shapeMod = p.e2s * e2 + lfo * p.ls + mShape;
        const ampMod = (1 - p.la * (0.5 + 0.5 * lfo)) * mAmp * (0.55 + 0.45 * v.vel) * (1 + acc * 0.35);
        let pl = v.panL, pr = v.panR;
        if (mPan) { const a = (clamp(mPan, -1, 1) + 1) * 0.25 * Math.PI; pl *= Math.cos(a) * 1.4142; pr *= Math.sin(a) * 1.4142; }
        const dt = f0 / sr;
        const end = s0 + SUB;
        // oscillator section
        const buf = this.tmpL;
        if (eng === 0) this._analog(v, buf, s0, end, dt, shapeMod);
        else if (eng === 1) this._fm(v, buf, s0, end, dt, shapeMod);
        else if (eng === 2) this._ks(v, buf, s0, end, f0);
        else this._smp(v, buf, s0, end);
        // filter + amp
        const pre = 1 + drive * 6;
        for (let i = s0; i < end; i++) {
          let x = buf[i];
          if (drive > 0) x = ftanh(x * pre) / (0.6 + drive * 0.4);
          let y;
          if (ftype === 3) y = v.lad.tick(x);
          else y = v.svf.tick(x, ftype);
          let a = v.amp.tick();
          if (v.killRamp > 0) { v.killRamp -= 1; a *= v.killRamp / 64; if (v.killRamp <= 0) { v.active = false; v.amp.stage = 0; } }
          const o = y * a * ampMod * vol;
          outL[i] += o * pl; outR[i] += o * pr;
        }
        if (!v.amp.active) v.active = false;
        if (eng === 3 && v.sinc === 0) v.active = false;
      }
    }
  }

  _analog(v, buf, s0, end, dt, shapeMod) {
    const p = this.p;
    const w1 = p.o1w | 0, w2 = p.o2w | 0;
    const dt2 = dt * Math.pow(2, (p.o2s + p.o2f / 100) / 12);
    const pw = clamp(p.pw + shapeMod * 0.4, 0.05, 0.95);
    const mix = clamp(p.mix + (w1 === 4 ? 0 : 0), 0, 1);
    const g1 = 1 - mix, g2 = mix, gs = p.sub, gn = p.noise;
    const det = p.det;
    for (let i = s0; i < end; i++) {
      let o1;
      if (w1 === 4) { // supersaw
        o1 = 0;
        for (let k = 0; k < 7; k++) {
          const d = dt * (1 + SUPER_DET[k] * det * 0.06 * (1 + shapeMod));
          let ph = v.sup[k] + d; if (ph >= 1) ph -= 1; v.sup[k] = ph;
          o1 += (2 * ph - 1 - polyblep(ph, d)) * SUPER_GAIN[k];
        }
        o1 *= 0.28;
      } else o1 = osc(w1, v.ph1, dt, pw);
      const o2 = osc(w2, v.ph2, dt2, pw);
      v.ph1 += dt; if (v.ph1 >= 1) { v.ph1 -= 1; }
      v.ph2 += dt2; if (v.ph2 >= 1) v.ph2 -= 1;
      v.phs += dt * 0.5; if (v.phs >= 1) v.phs -= 1;
      let x = o1 * g1 + o2 * g2;
      if (gs > 0) x += (v.phs < 0.5 ? 1 : -1) * gs * 0.7;
      if (gn > 0) x += rng.bi() * gn * 0.6;
      buf[i] = x;
    }
  }

  _fm(v, buf, s0, end, dt, shapeMod) {
    const p = this.p;
    const alg = FM_ALGOS[clamp((p.alg | 0) - 1, 0, 7)];
    const ratios = this._ratios || (this._ratios = new Float64Array(4));
    const levels = this._levels || (this._levels = new Float64Array(4));
    for (let i = 0; i < 4; i++) {
      const o = i + 1;
      ratios[i] = FM_RATIOS[p['op' + o + 'r'] | 0] * (1 + p['op' + o + 't'] * 0.02);
      levels[i] = p['op' + o + 'l'];
    }
    const idx = p.fmamt * (1 + shapeMod) * 2.2;
    const fb = p.fb * 0.6;
    const nc = alg.car.length;
    const carG = 1 / Math.sqrt(nc) * 0.8;
    const out = v.opOut, ph = v.opPh, env = v.opEnv;
    const isCar = this._isCar || (this._isCar = [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) isCar[i] = 0;
    for (const c of alg.car) isCar[c] = 1;
    const mods = alg.mods;
    for (let i = s0; i < end; i++) {
      // op 4 .. 1
      for (let o = 3; o >= 0; o--) {
        let pm = 0;
        if (o === 3) pm = (v.fbPrev + v.fbPrev2) * 0.5 * fb;
        const ml = mods[o];
        for (let k = 0; k < ml.length; k++) pm += out[ml[k]] * idx;
        const e = env[o].tick();
        ph[o] += dt * ratios[o]; if (ph[o] >= 1) ph[o] -= Math.floor(ph[o]);
        const y = fsin(ph[o] + pm) * e * levels[o];
        out[o] = y;
        if (o === 3) { v.fbPrev2 = v.fbPrev; v.fbPrev = y; }
      }
      let s = 0;
      for (let o = 0; o < 4; o++) if (isCar[o]) s += out[o];
      buf[i] = s * carG;
    }
  }

  _ks(v, buf, s0, end, f0) {
    const p = this.p;
    const len = clamp(this.sr / f0, 2, 8000);
    const size = v.ks.length;
    const damp = 0.05 + 0.9 * (1 - p.pdamp); // lowpass coefficient in loop
    const fb = 0.9 + 0.0999 * Math.pow(p.pdec, 0.3);
    const bodyMix = p.pmix;
    v.body.set(clamp(f0 * 2.5, 80, 6000), 0.6, this.sr);
    for (let i = s0; i < end; i++) {
      let rp = v.ksW - len; while (rp < 0) rp += size;
      const ip = rp | 0, fr = rp - ip;
      const a = v.ks[ip], b = v.ks[(ip + 1) % size];
      const y = a + (b - a) * fr;
      v.ksLp += damp * (y - v.ksLp);
      v.ks[v.ksW] = v.ksLp * fb;
      v.ksW = (v.ksW + 1) % size;
      // dc block
      const dc = y - v.ksDc + 0.995 * v.ksDcOut; v.ksDc = y; v.ksDcOut = dc;
      buf[i] = dc * 1.4 + v.body.tick(dc, 1) * bodyMix * 2;
    }
  }

  _smp(v, buf, s0, end) {
    const s = this.sample; const p = this.p;
    if (!s || v.sinc === 0) { for (let i = s0; i < end; i++) buf[i] = 0; return; }
    const ch0 = s.ch[0], ch1 = s.ch[1] || s.ch[0];
    const mode = p.smode | 0;
    const g = p.sgain * 1.6;
    for (let i = s0; i < end; i++) {
      const pos = v.spos;
      if ((v.sDir > 0 && pos >= v.sEnd - 1) || (v.sDir < 0 && pos <= v.sStart)) {
        if (mode === 2 && v.gate) { v.spos = v.sDir > 0 ? v.sStart : v.sEnd - 1; }
        else { buf[i] = 0; v.sinc = 0; for (let k = i + 1; k < end; k++) buf[k] = 0; return; }
      }
      const ip = v.spos | 0, fr = v.spos - ip;
      const a = (ch0[ip] + ch1[ip]) * 0.5, b = (ch0[ip + 1] + ch1[ip + 1]) * 0.5 || 0;
      buf[i] = (a + (b - a) * fr) * g;
      v.spos += v.sinc * v.sDir;
    }
  }

  get activeCount() { let c = 0; for (const v of this.voices) if (v.active) c++; return c; }
}

function osc(w, ph, dt, pw) {
  switch (w) {
    case 0: return 2 * ph - 1 - polyblep(ph, dt);
    case 1: {
      let y = ph < pw ? 1 : -1;
      y += polyblep(ph, dt);
      let t2 = ph - pw; if (t2 < 0) t2 += 1;
      y -= polyblep(t2, dt);
      return y * 0.8;
    }
    case 2: return (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph);
    default: return fsin(ph);
  }
}
