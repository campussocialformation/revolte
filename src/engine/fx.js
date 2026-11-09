// Revolte — send effects, master chain and performance FX layer
import { SVF, OnePole, DelayLine, ftanh, fsin, clamp, rng, dbToGain, TWO_PI } from './dsp.js';
import { DELAY_SYNC } from '../shared/params.js';

// ---------------------------------------------------------------- Chorus / Flanger / Phaser
export class ChorusFx {
  constructor(sr) {
    this.sr = sr;
    this.dl = new DelayLine(Math.ceil(sr * 0.06)); this.dr = new DelayLine(Math.ceil(sr * 0.06));
    this.ph = 0; this.fbL = 0; this.fbR = 0;
    this.apL = new Float64Array(6); this.apR = new Float64Array(6);
  }
  process(inL, inR, outL, outR, n, p) {
    const sr = this.sr, mode = p.chmode | 0;
    const rate = p.chrate, depth = p.chdepth, fb = p.chfb;
    for (let i = 0; i < n; i++) {
      this.ph += rate / sr; if (this.ph >= 1) this.ph -= 1;
      const mL = fsin(this.ph), mR = fsin(this.ph + 0.25);
      const xl = inL[i], xr = inR[i];
      let yl, yr;
      if (mode === 0) { // chorus
        const base = 0.012 * sr, dep = 0.006 * sr * depth;
        this.dl.write(xl + this.fbL * fb * 0.5); this.dr.write(xr + this.fbR * fb * 0.5);
        yl = this.dl.read(base + dep * mL); yr = this.dr.read(base + dep * mR);
      } else if (mode === 1) { // flanger
        const base = 0.0015 * sr, dep = 0.004 * sr * depth;
        this.dl.write(xl + this.fbL * fb); this.dr.write(xr + this.fbR * fb);
        yl = this.dl.read(base + dep * (0.5 + 0.5 * mL)); yr = this.dr.read(base + dep * (0.5 + 0.5 * mR));
      } else { // phaser: 6 allpass stages
        const fl = 300 + 2700 * depth * (0.5 + 0.5 * mL), fr = 300 + 2700 * depth * (0.5 + 0.5 * mR);
        yl = this._ap(this.apL, xl + this.fbL * fb, fl);
        yr = this._ap(this.apR, xr + this.fbR * fb, fr);
      }
      this.fbL = yl; this.fbR = yr;
      outL[i] += yl; outR[i] += yr;
    }
  }
  _ap(st, x, fc) {
    const t = Math.tan(Math.PI * fc / this.sr); const a = (t - 1) / (t + 1);
    for (let k = 0; k < 6; k++) { const y = a * x + st[k]; st[k] = x - a * y; x = y; }
    return x;
  }
}

// ---------------------------------------------------------------- Delay
export class DelayFx {
  constructor(sr) {
    this.sr = sr;
    this.l = new DelayLine(Math.ceil(sr * 4)); this.r = new DelayLine(Math.ceil(sr * 4));
    this.tL = sr * 0.3; this.tR = sr * 0.3;
    this.lpL = new OnePole(); this.lpR = new OnePole(); this.hpL = new OnePole(); this.hpR = new OnePole();
    this.boostFb = 0;
  }
  process(inL, inR, outL, outR, n, p, bpm) {
    const sr = this.sr;
    const sync = DELAY_SYNC[p.dltime | 0] || DELAY_SYNC[5];
    const target = clamp((sync.beats * 60 / bpm) * sr, 16, sr * 3.9);
    const mode = p.dlmode | 0;
    const width = p.dlwidth;
    const tgtR = mode === 1 ? target * (1 + 0.12 * width) : target;
    const fb = clamp(p.dlfb + this.boostFb * (0.92 - p.dlfb), 0, 0.97);
    const c = p.dlcolor;
    this.lpL.setHz(600 * Math.pow(2, c * 5), sr); this.lpR.setHz(600 * Math.pow(2, c * 5), sr);
    this.hpL.setHz(40 + 400 * (1 - c) * (1 - c), sr); this.hpR.setHz(40 + 400 * (1 - c) * (1 - c), sr);
    for (let i = 0; i < n; i++) {
      this.tL += (target - this.tL) * 0.0005; this.tR += (tgtR - this.tR) * 0.0005;
      const dl = this.l.read(this.tL), dr = this.r.read(this.tR);
      let fl = this.hpL.hp(this.lpL.lp(dl)), fr = this.hpR.hp(this.lpR.lp(dr));
      fl = ftanh(fl * 1.1); fr = ftanh(fr * 1.1);
      const xl = inL[i], xr = inR[i];
      if (mode === 0) { // mono
        const m = (xl + xr) * 0.5;
        this.l.write(m + fl * fb); this.r.write(m + fl * fb);
        outL[i] += dl; outR[i] += dl;
      } else if (mode === 1) { // stereo
        this.l.write(xl + fl * fb); this.r.write(xr + fr * fb);
        outL[i] += dl; outR[i] += dr;
      } else { // ping-pong
        const m = (xl + xr) * 0.5;
        this.l.write(m + fr * fb); this.r.write(fl * fb);
        const w = 0.5 + 0.5 * width;
        outL[i] += dl * w + dr * (1 - w); outR[i] += dr * w + dl * (1 - w);
      }
    }
  }
}

// ---------------------------------------------------------------- Reverb (Freeverb-style, stereo)
const COMB = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLP = [556, 441, 341, 225];
class Comb {
  constructor(n) { this.b = new Float32Array(n); this.n = n; this.i = 0; this.z = 0; }
  tick(x, fb, d) {
    const y = this.b[this.i];
    this.z = y * (1 - d) + this.z * d;
    this.b[this.i] = x + this.z * fb;
    if (++this.i >= this.n) this.i = 0;
    return y;
  }
}
class Allp {
  constructor(n) { this.b = new Float32Array(n); this.n = n; this.i = 0; }
  tick(x) {
    const bo = this.b[this.i]; const y = -x + bo;
    this.b[this.i] = x + bo * 0.5;
    if (++this.i >= this.n) this.i = 0;
    return y;
  }
}
export class ReverbFx {
  constructor(sr) {
    this.sr = sr;
    const k = sr / 44100;
    this.sets = [0.55, 1.0, 0.8].map((scale) => ({
      cl: COMB.map((c) => new Comb(Math.round(c * k * scale * 1.15))),
      cr: COMB.map((c) => new Comb(Math.round((c + 23) * k * scale * 1.15))),
      al: ALLP.map((a) => new Allp(Math.round(a * k))),
      ar: ALLP.map((a) => new Allp(Math.round((a + 23) * k))),
    }));
    this.pre = new DelayLine(Math.ceil(sr * 0.25)); this.preR = new DelayLine(Math.ceil(sr * 0.25));
    this.hpL = new OnePole(); this.hpR = new OnePole();
    this.freeze = false;
  }
  process(inL, inR, outL, outR, n, p) {
    const set = this.sets[p.rvtype | 0] || this.sets[1];
    const fz = this.freeze;
    const fb = fz ? 1 : 0.7 + 0.28 * p.rvsize;
    const d = fz ? 0 : (p.rvtype === 2 ? 0.15 : 0.1) + p.rvdamp * 0.5;
    const pre = Math.max(1, p.rvpre * 0.001 * this.sr);
    const g = fz ? 0 : 0.03;
    const lvl = p.rvlvl;
    this.hpL.setHz(120, this.sr); this.hpR.setHz(120, this.sr);
    for (let i = 0; i < n; i++) {
      this.pre.write(inL[i]); this.preR.write(inR[i]);
      const xl = this.hpL.hp(this.pre.read(pre)) * g, xr = this.hpR.hp(this.preR.read(pre)) * g;
      const x = (xl + xr);
      let l = 0, r = 0;
      for (let k = 0; k < 8; k++) { l += set.cl[k].tick(x, fb, d); r += set.cr[k].tick(x, fb, d); }
      for (let k = 0; k < 4; k++) { l = set.al[k].tick(l); r = set.ar[k].tick(r); }
      outL[i] += l * lvl; outR[i] += r * lvl;
    }
  }
}

// ---------------------------------------------------------------- Biquad (RBJ)
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; this.key = ''; }
  setShelf(type, f, db, sr) {
    const key = type + f + db; if (key === this.key) return; this.key = key;
    const A = Math.pow(10, db / 40), w = TWO_PI * f / sr, cs = Math.cos(w), sn = Math.sin(w);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'peak') {
      const alpha = sn / (2 * 0.7);
      b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
    } else {
      const alpha = sn / 2 * Math.SQRT2; const sq = 2 * Math.sqrt(A) * alpha;
      if (type === 'low') {
        b0 = A * ((A + 1) - (A - 1) * cs + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - sq);
        a0 = (A + 1) + (A - 1) * cs + sq; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - sq;
      } else {
        b0 = A * ((A + 1) + (A - 1) * cs + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - sq);
        a0 = (A + 1) - (A - 1) * cs + sq; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - sq;
      }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  tick(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// ---------------------------------------------------------------- Performance FX (buffer based)
export const PERF_FX = ['REPEAT 1/8', 'REPEAT 1/16', 'REPEAT 1/32', 'REVERSE', 'LPF SWEEP', 'HPF SWEEP', 'TAPE STOP', 'FREEZE', 'OCT UP', 'OCT DOWN', 'GATE', 'DUB', 'FLANGE', 'VINYL'];
export const PERF_BUFFERED = new Set([0, 1, 2, 3, 6, 7, 8, 9, 12, 13]);

export class PerfFx {
  constructor(sr) {
    this.sr = sr;
    this.size = Math.ceil(sr * 8);
    this.bl = new Float32Array(this.size); this.br = new Float32Array(this.size);
    this.w = 0;
    this.active = new Array(PERF_FX.length).fill(false);
    this.order = []; // buffered effects, last pressed last
    this.cur = -1; this.curStart = 0; this.elapsed = 0; this.tapeRate = 1; this.tapePos = 0;
    this.writing = true;
    this.mix = 0; // crossfade into the effect
    this.svfL = new SVF(); this.svfR = new SVF(); this.sweep = 0; this.sweepDir = 0;
    this.gateG = 1;
    this.flPh = 0; this.flL = new DelayLine(Math.ceil(sr * 0.02)); this.flR = new DelayLine(Math.ceil(sr * 0.02)); this.flFbL = 0; this.flFbR = 0;
    this.psPh = 0;
    this.vinLp = [new OnePole(), new OnePole()]; this.wowPh = 0; this.wowL = new DelayLine(Math.ceil(sr * 0.05)); this.wowR = new DelayLine(Math.ceil(sr * 0.05));
    this.pending = []; // [{fx, on}] waiting for next 1/16
  }
  set(fx, on) {
    if (this.active[fx] === on) return;
    this.active[fx] = on;
    if (PERF_BUFFERED.has(fx)) {
      const i = this.order.indexOf(fx); if (i >= 0) this.order.splice(i, 1);
      if (on) this.order.push(fx);
      const next = this.order.length ? this.order[this.order.length - 1] : -1;
      if (next !== this.cur) this._start(next);
    }
    if (fx === 4 || fx === 5) { this.sweep = 0; }
  }
  _start(fx) {
    this.cur = fx; this.curStart = this.w; this.elapsed = 0; this.tapeRate = 1; this.tapePos = 0;
    this.writing = true; this.mix = fx >= 0 ? this.mix : this.mix;
  }
  get anyOn() { return this.active.some((a) => a); }

  process(L, R, n, bpm, beat, depth) {
    const sr = this.sr, size = this.size;
    const spb = sr * 60 / bpm;
    const any = this.cur >= 0 || this.active[4] || this.active[5] || this.active[10] || this.mix > 0.0001;
    if (!any) {
      for (let i = 0; i < n; i++) { this.bl[this.w] = L[i]; this.br[this.w] = R[i]; this.w = (this.w + 1) % size; }
      return;
    }
    const cur = this.cur;
    let loopLen = 0;
    if (cur === 0) loopLen = spb * 0.5; else if (cur === 1) loopLen = spb * 0.25; else if (cur === 2) loopLen = spb * 0.125; else if (cur === 7) loopLen = Math.round(sr * 0.09);
    // sweep filters
    const sweepOn = this.active[4] || this.active[5];
    if (sweepOn) this.sweep = Math.min(1, this.sweep + n / (spb * 4)); else this.sweep = Math.max(0, this.sweep - n / (spb * 0.5));
    if (this.sweep > 0) {
      const hp = this.active[5] || (!this.active[4] && this.sweepDir === 2);
      this.sweepDir = this.active[4] ? 1 : this.active[5] ? 2 : this.sweepDir;
      const fc = this.sweepDir === 1 ? 20000 * Math.pow(150 / 20000, this.sweep * depth) : 20 * Math.pow(5000 / 20, this.sweep * depth);
      this.svfL.set(fc, 0.55, sr); this.svfR.set(fc, 0.55, sr);
      this._sweepMode = hp ? 2 : 0;
    }
    const xfStep = 1 / (0.004 * sr);
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = R[i];
      if (this.writing) { this.bl[this.w] = xl; this.br[this.w] = xr; }
      let wl = xl, wr = xr;
      if (cur >= 0) {
        const e = this.elapsed;
        if (loopLen > 0) { // repeat / freeze
          if (e >= loopLen) this.writing = false;
          const L0 = Math.max(16, Math.floor(loopLen));
          const pos = e % L0;
          const rp = (this.curStart + pos) % size;
          wl = this.bl[rp]; wr = this.br[rp];
          const edge = Math.min(pos, L0 - pos);
          const fw = cur === 7 ? Math.min(1, edge / (L0 * 0.4)) : Math.min(1, edge / (0.002 * sr));
          if (e >= L0) {
            if (cur === 7) { // freeze: two overlapping windows
              const pos2 = (pos + (L0 >> 1)) % L0; const rp2 = (this.curStart + pos2) % size;
              const fw2 = Math.min(1, Math.min(pos2, L0 - pos2) / (L0 * 0.4));
              wl = wl * fw + this.bl[rp2] * fw2; wr = wr * fw + this.br[rp2] * fw2;
            } else { wl *= fw; wr *= fw; }
          }
        } else if (cur === 3) { // reverse
          this.writing = false;
          const rp = ((this.curStart - e) % size + size) % size;
          const fw = Math.min(1, e / (0.003 * sr));
          wl = this.bl[rp] * fw + xl * (1 - fw); wr = this.br[rp] * fw + xr * (1 - fw);
        } else if (cur === 6) { // tape stop
          this.tapeRate = Math.max(0, this.tapeRate - 1 / (spb * 1.5));
          this.tapePos += this.tapeRate;
          const lag = e - this.tapePos;
          const rpf = this.w - lag; const rp = ((Math.floor(rpf) % size) + size) % size;
          wl = this.bl[rp] * Math.min(1, this.tapeRate * 3); wr = this.br[rp] * Math.min(1, this.tapeRate * 3);
        } else if (cur === 8 || cur === 9) { // pitch shift, 2 taps
          const ratio = cur === 8 ? 2 : 0.5;
          const win = Math.floor(0.06 * sr);
          this.psPh += (1 - ratio) / win; this.psPh -= Math.floor(this.psPh);
          const d1 = this.psPh * win + 2, d2 = ((this.psPh + 0.5) % 1) * win + 2;
          const g1 = Math.sin(Math.PI * this.psPh), g2 = Math.sin(Math.PI * ((this.psPh + 0.5) % 1));
          const r1 = ((this.w - Math.floor(d1)) % size + size) % size, r2 = ((this.w - Math.floor(d2)) % size + size) % size;
          wl = xl * 0.6 + (this.bl[r1] * g1 + this.bl[r2] * g2) * 0.8;
          wr = xr * 0.6 + (this.br[r1] * g1 + this.br[r2] * g2) * 0.8;
        } else if (cur === 12) { // flange jet
          this.flPh += 1 / (spb * 8);
          const m = 0.5 - 0.5 * Math.cos(TWO_PI * this.flPh);
          const d = (0.0004 + 0.006 * m) * sr;
          this.flL.write(xl + this.flFbL * 0.75); this.flR.write(xr + this.flFbR * 0.75);
          const yl = this.flL.read(d), yr = this.flR.read(d * 1.02);
          this.flFbL = yl; this.flFbR = yr;
          wl = (xl + yl) * 0.6; wr = (xr + yr) * 0.6;
        } else if (cur === 13) { // vinyl
          this.wowPh += 0.55 / sr;
          const d = (0.004 + 0.0015 * Math.sin(TWO_PI * this.wowPh) + 0.0003 * Math.sin(TWO_PI * this.wowPh * 7.3)) * sr;
          this.wowL.write(xl); this.wowR.write(xr);
          this.vinLp[0].setHz(5000, sr); this.vinLp[1].setHz(5000, sr);
          wl = this.vinLp[0].lp(this.wowL.read(d)); wr = this.vinLp[1].lp(this.wowR.read(d));
          const r = rng.next();
          const crackle = r > 0.9993 ? rng.bi() * 0.5 : rng.bi() * 0.004;
          const m = (wl + wr) * 0.5; wl = m * 0.6 + wl * 0.4 + crackle; wr = m * 0.6 + wr * 0.4 + crackle;
        }
        this.elapsed++;
        if (this.mix < 1) this.mix = Math.min(1, this.mix + xfStep);
      } else if (this.mix > 0) {
        this.mix = Math.max(0, this.mix - xfStep);
        wl = this._lastL ?? xl; wr = this._lastR ?? xr;
      }
      this._lastL = wl; this._lastR = wr;
      const m = this.mix * depth;
      let ol = xl + (wl - xl) * m, or = xr + (wr - xr) * m;
      if (this.sweep > 0) { const sl = this.svfL.tick(ol, this._sweepMode), sr2 = this.svfR.tick(or, this._sweepMode); ol = sl; or = sr2; }
      if (this.active[10]) { // gate on 16ths
        const ph = ((beat + i / spb) * 4) % 1;
        const tg = ph < 0.5 ? 1 : 1 - depth;
        this.gateG += (tg - this.gateG) * 0.01;
      } else this.gateG += (1 - this.gateG) * 0.01;
      ol *= this.gateG; or *= this.gateG;
      L[i] = ol; R[i] = or;
      this.w = (this.w + 1) % size;
    }
    if (cur < 0 && this.mix <= 0) this.writing = true;
  }
}

// ---------------------------------------------------------------- Master chain
export class MasterChain {
  constructor(sr) {
    this.sr = sr;
    this.djL = new SVF(); this.djR = new SVF();
    this.eq = [[new Biquad(), new Biquad(), new Biquad()], [new Biquad(), new Biquad(), new Biquad()]];
    this.compEnv = 0; this.limG = 1;
    this.crushPh = 0; this.holdL = 0; this.holdR = 0;
    this.peakL = 0; this.peakR = 0; this.gr = 0;
    this.thrCut = 0; this.thrDist = 0;
  }
  process(L, R, n, p) {
    const sr = this.sr;
    // DJ filter, including the CUTOFF throw
    let f = p.mfilt;
    if (this.thrCut > 0) f = Math.min(f, -0.9 * this.thrCut);
    const useDj = Math.abs(f) > 0.01;
    let djMode = 0;
    if (useDj) {
      if (f < 0) { const fc = 20000 * Math.pow(60 / 20000, -f); this.djL.set(fc, p.mres * 0.9, sr); this.djR.set(fc, p.mres * 0.9, sr); djMode = 0; }
      else { const fc = 20 * Math.pow(8000 / 20, f); this.djL.set(fc, p.mres * 0.9, sr); this.djR.set(fc, p.mres * 0.9, sr); djMode = 2; }
    }
    const crush = p.mcrush;
    const bits = crush > 0 ? Math.pow(2, 16 - crush * 13) : 0;
    const srRed = crush > 0 ? 1 - crush * 0.92 : 1;
    const drive = clamp(p.mdrive + this.thrDist, 0, 1);
    const pre = 1 + drive * 10;
    const useEq = p.eqlo !== 0 || p.eqmid !== 0 || p.eqhi !== 0;
    if (useEq) {
      for (const ch of this.eq) { ch[0].setShelf('low', 180, p.eqlo, sr); ch[1].setShelf('peak', 1100, p.eqmid, sr); ch[2].setShelf('high', 5000, p.eqhi, sr); }
    }
    const cmix = p.cmix;
    const thr = p.cthr, ratio = p.cratio;
    const atk = Math.exp(-1 / (p.catk * 0.001 * sr)), rel = Math.exp(-1 / (p.crel * 0.001 * sr));
    const makeup = dbToGain(Math.max(0, -thr * (1 - 1 / ratio) * 0.5));
    const width = p.mwidth;
    const vol = p.mvol;
    const lim = (p.limit | 0) === 1;
    let pkL = 0, pkR = 0, grMax = 0;
    for (let i = 0; i < n; i++) {
      let l = L[i], r = R[i];
      if (useDj) { l = this.djL.tick(l, djMode); r = this.djR.tick(r, djMode); }
      if (crush > 0) {
        this.crushPh += srRed;
        if (this.crushPh >= 1) { this.crushPh -= 1; this.holdL = Math.round(l * bits) / bits; this.holdR = Math.round(r * bits) / bits; }
        l = this.holdL; r = this.holdR;
      }
      if (drive > 0) { l = ftanh(l * pre) / (0.5 + 0.5 * Math.min(1, pre * 0.3)); r = ftanh(r * pre) / (0.5 + 0.5 * Math.min(1, pre * 0.3)); }
      if (useEq) { l = this.eq[0][2].tick(this.eq[0][1].tick(this.eq[0][0].tick(l))); r = this.eq[1][2].tick(this.eq[1][1].tick(this.eq[1][0].tick(r))); }
      if (cmix > 0) {
        const lvl = Math.max(Math.abs(l), Math.abs(r));
        const c = lvl > this.compEnv ? atk : rel;
        this.compEnv = lvl + (this.compEnv - lvl) * c;
        const db = 20 * Math.log10(this.compEnv + 1e-9);
        const over = db - thr;
        const grDb = over > 0 ? over * (1 - 1 / ratio) : 0;
        if (grDb > grMax) grMax = grDb;
        const g = dbToGain(-grDb) * makeup;
        l = l * (1 - cmix) + l * g * cmix; r = r * (1 - cmix) + r * g * cmix;
      }
      if (width !== 1) { const m = (l + r) * 0.5, s = (l - r) * 0.5 * width; l = m + s; r = m - s; }
      l *= vol; r *= vol;
      if (lim) {
        const pk = Math.max(Math.abs(l), Math.abs(r));
        const tg = pk > 0.95 ? 0.95 / pk : 1;
        if (tg < this.limG) this.limG = tg; else this.limG += (1 - this.limG) * 0.0002;
        l *= this.limG; r *= this.limG;
        l = l > 1 ? 1 : l < -1 ? -1 : l; r = r > 1 ? 1 : r < -1 ? -1 : r;
      }
      L[i] = l; R[i] = r;
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > pkL) pkL = al; if (ar > pkR) pkR = ar;
    }
    this.peakL = Math.max(pkL, this.peakL * 0.9); this.peakR = Math.max(pkR, this.peakR * 0.9);
    this.gr = grMax;
  }
}
