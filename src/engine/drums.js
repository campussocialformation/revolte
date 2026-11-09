// Revolte — drum kit: 8 lanes, each with a synthesized model (or a sample)
import { SVF, ftanh, fsin, clamp, rng, OnePole } from './dsp.js';

// model ids follow DRUM_MODELS in params.js
const M = { KICK: 0, SNARE: 1, CLAP: 2, HATC: 3, HATO: 4, TOM: 5, RIM: 6, COW: 7, CLAVE: 8, CYM: 9, SHAKER: 10, ZAP: 11, KICK9: 12, SNARE9: 13, SAMPLE: 14 };
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
// decay ranges in seconds (min, max) per model
const DECAY = [
  [0.08, 1.6], [0.06, 0.5], [0.08, 0.8], [0.015, 0.2], [0.12, 1.4], [0.08, 1.2], [0.01, 0.12], [0.04, 0.6],
  [0.015, 0.15], [0.3, 3.5], [0.03, 0.4], [0.03, 0.6], [0.08, 1.4], [0.06, 0.5], [0.05, 4],
];

class LaneVoice {
  constructor() {
    this.on = false; this.t = 0; this.model = 0; this.vel = 1;
    this.ph = 0; this.ph2 = 0; this.mph = new Float64Array(6);
    this.f1 = new SVF(); this.f2 = new SVF(); this.hp = new OnePole();
    this.env = 0; this.decC = 0; this.nEnv = 0; this.nDecC = 0; this.pEnv = 0; this.pDecC = 0;
    this.fade = 1; this.fading = false; this.gL = 1; this.gR = 1;
    this.tune = 1; this.tone = 0.5; this.snap = 0.5; this.dec = 0.3;
    this.spos = 0; this.sinc = 1; this.smp = null;
  }
}

export class DrumKit {
  constructor(sr) {
    this.sr = sr;
    this.lanes = [];
    for (let i = 0; i < 8; i++) this.lanes.push({ voices: [new LaneVoice(), new LaneVoice()], cur: 0 });
    this.p = null;
    this.lp = [new SVF(), new SVF()]; this.hpL = new OnePole(); this.hpR = new OnePole();
    this.tmpL = new Float32Array(128); this.tmpR = new Float32Array(128);
    this.laneSamples = new Array(8).fill(null);
  }
  setParams(p) { this.p = p; }

  allOff() { for (const l of this.lanes) for (const v of l.voices) { if (v.on) { v.fading = true; } } }

  trigger(lane, vel, accent = false) {
    const p = this.p; if (!p || lane < 0 || lane > 7) return;
    const L = this.lanes[lane];
    // choke group
    const cg = p[`l${lane}c`] | 0;
    if (cg) {
      for (let j = 0; j < 8; j++) {
        if (j === lane) continue;
        if ((p[`l${j}c`] | 0) === cg) for (const v of this.lanes[j].voices) if (v.on) v.fading = true;
      }
    }
    // declick: fade the previous hit on this lane, start a fresh voice
    const old = L.voices[L.cur];
    if (old.on) old.fading = true;
    L.cur ^= 1;
    const v = L.voices[L.cur];
    const sr = this.sr;
    const model = p[`l${lane}m`] | 0;
    v.model = model; v.on = true; v.t = 0; v.fading = false; v.fade = 1;
    v.vel = clamp(vel, 0, 1) * (accent ? 1.25 : 1);
    v.tune = Math.pow(2, (p[`l${lane}t`] + p.ktune) / 12);
    v.tone = p[`l${lane}o`]; v.snap = p[`l${lane}n`];
    const dr = DECAY[model] || DECAY[0];
    const dsec = dr[0] * Math.pow(dr[1] / dr[0], p[`l${lane}d`]) * p.kdec;
    v.dec = dsec;
    v.env = 1; v.decC = Math.exp(-1 / (dsec * sr / 4.6));
    v.ph = 0; v.ph2 = 0;
    for (let k = 0; k < 6; k++) v.mph[k] = Math.random();
    v.f1.reset(); v.f2.reset();
    const pan = clamp(p[`l${lane}p`], -1, 1);
    const a = (pan + 1) * 0.25 * Math.PI;
    const lvl = p[`l${lane}v`];
    v.gL = Math.cos(a) * 1.4142 * lvl; v.gR = Math.sin(a) * 1.4142 * lvl;
    const tr = v.tune;
    switch (model) {
      case M.KICK: case M.KICK9:
        v.pEnv = 1; v.pDecC = Math.exp(-1 / ((model === M.KICK9 ? 0.012 : 0.02 + 0.03 * (1 - v.snap)) * sr));
        v.nEnv = 1; v.nDecC = Math.exp(-1 / (0.003 * sr));
        v.hp.setHz(1500, sr);
        break;
      case M.SNARE: case M.SNARE9: {
        v.nEnv = 1; v.nDecC = Math.exp(-1 / (dsec * (model === M.SNARE9 ? 1.2 : 0.9) * sr / 4.6));
        v.decC = Math.exp(-1 / ((0.05 + 0.1 * p[`l${lane}d`]) * sr / 4.6));
        v.f1.set(clamp(3000 + v.tone * 6000, 500, 16000) * Math.sqrt(tr), 0.2, sr);
        v.hp.setHz(model === M.SNARE9 ? 1200 : 700, sr);
        v.pEnv = 1; v.pDecC = Math.exp(-1 / (0.01 * sr));
        break;
      }
      case M.CLAP:
        v.f1.set(1100 * tr * (0.7 + v.tone * 0.8), 0.5, sr);
        v.nEnv = 1;
        break;
      case M.HATC: case M.HATO: case M.CYM:
        v.f1.set(clamp((model === M.CYM ? 6500 : 9500) * Math.sqrt(tr), 2000, 18000), 0.35, sr);
        v.hp.setHz(model === M.CYM ? 4000 : 6500, sr);
        if (model === M.CYM) { v.nEnv = 1; v.nDecC = Math.exp(-1 / (0.03 * sr)); }
        break;
      case M.TOM:
        v.pEnv = 1; v.pDecC = Math.exp(-1 / (0.04 * sr));
        v.nEnv = 1; v.nDecC = Math.exp(-1 / (0.01 * sr));
        v.f1.set(2500, 0.2, sr);
        break;
      case M.RIM:
        v.f1.set(1700 * tr, 0.8, sr);
        break;
      case M.COW:
        v.f1.set(900 * tr, 0.6, sr);
        v.pEnv = 1; v.pDecC = Math.exp(-1 / (0.02 * sr));
        break;
      case M.CLAVE:
        break;
      case M.SHAKER:
        v.hp.setHz(4000 + v.tone * 4000, sr);
        v.nEnv = 0;
        break;
      case M.ZAP:
        v.pEnv = 1; v.pDecC = Math.exp(-1 / ((0.01 + 0.06 * v.snap) * sr));
        break;
      case M.SAMPLE: {
        const s = this.laneSamples[lane];
        v.smp = s;
        v.spos = 0; v.sinc = s ? (s.sr / sr) * tr : 0;
        break;
      }
    }
  }

  render(outL, outR, start, n) {
    const p = this.p; if (!p) return;
    const sr = this.sr;
    const tL = this.tmpL, tR = this.tmpR;
    tL.fill(0, start, n); tR.fill(0, start, n);
    let any = false;
    for (let li = 0; li < 8; li++) {
      for (const v of this.lanes[li].voices) {
        if (!v.on) continue;
        any = true;
        this._renderVoice(v, tL, tR, start, n, sr);
      }
    }
    if (!any && this._idle) return;
    this._idle = !any;
    // kit bus: HP, LP, drive
    const cut = p.cut, useLp = cut < 19000;
    if (useLp) { this.lp[0].set(cut, p.res * 0.95, sr); this.lp[1].set(cut, p.res * 0.95, sr); }
    const useHp = p.hpf > 25; if (useHp) { this.hpL.setHz(p.hpf, sr); this.hpR.setHz(p.hpf, sr); }
    const drv = p.kdrv; const pre = 1 + drv * 8; const comp = 1 / (1 + drv * 2);
    const vol = p.vol * 0.6;
    for (let i = start; i < n; i++) {
      let l = tL[i], r = tR[i];
      if (useHp) { l = this.hpL.hp(l); r = this.hpR.hp(r); }
      if (useLp) { l = this.lp[0].tick(l, 0); r = this.lp[1].tick(r, 0); }
      if (drv > 0) { l = ftanh(l * pre) * (1 + drv) * comp; r = ftanh(r * pre) * (1 + drv) * comp; }
      outL[i] += l * vol; outR[i] += r * vol;
    }
  }

  _renderVoice(v, outL, outR, start, n, sr) {
    const tr = v.tune, vel = v.vel, inv = 1 / sr;
    const tone = v.tone, snap = v.snap;
    for (let i = start; i < n; i++) {
      let y = 0;
      const tsec = v.t * inv;
      switch (v.model) {
        case M.KICK: case M.KICK9: {
          const nine = v.model === M.KICK9;
          const base = (nine ? 52 : 46) * tr;
          const sweep = (nine ? 3 : 2) + tone * 6;
          const f = base * (1 + sweep * v.pEnv);
          v.pEnv *= v.pDecC;
          v.ph += f * inv; if (v.ph >= 1) v.ph -= 1;
          let body = fsin(v.ph) * v.env;
          const click = rng.bi() * v.nEnv * snap * (nine ? 0.9 : 0.5);
          v.nEnv *= v.nDecC;
          y = body + v.hp.hp(click);
          y = ftanh(y * (1.2 + (nine ? 1.2 : 0.4) * snap)) * 0.95;
          v.env *= v.decC;
          break;
        }
        case M.SNARE: case M.SNARE9: {
          const nine = v.model === M.SNARE9;
          const f1 = (nine ? 210 : 180) * tr * (1 + v.pEnv * 0.5), f2 = (nine ? 360 : 330) * tr * (1 + v.pEnv * 0.3);
          v.pEnv *= v.pDecC;
          v.ph += f1 * inv; if (v.ph >= 1) v.ph -= 1;
          v.ph2 += f2 * inv; if (v.ph2 >= 1) v.ph2 -= 1;
          const body = (fsin(v.ph) * 0.65 + fsin(v.ph2) * 0.35) * v.env;
          const nz = v.f1.tick(v.hp.hp(rng.bi()), 0) * v.nEnv;
          y = body * (1.1 - snap * 0.6) + nz * (0.5 + snap * 1.4);
          v.env *= v.decC; v.nEnv *= v.nDecC;
          if (v.nEnv < 1e-4 && v.env < 1e-4) v.on = false;
          break;
        }
        case M.CLAP: {
          // three short bursts then a tail
          const ms = tsec * 1000;
          let e;
          const sp = 7 + snap * 8;
          if (ms < sp * 3) { const ph = (ms % sp) / sp; e = Math.exp(-ph * 6); }
          else e = v.env;
          if (ms >= sp * 3) v.env *= v.decC;
          y = v.f1.tick(rng.bi(), 1) * e * 2.2;
          break;
        }
        case M.HATC: case M.HATO: case M.CYM: {
          let m = 0;
          for (let k = 0; k < 6; k++) {
            v.mph[k] += METAL[k] * tr * (v.model === M.CYM ? 1.0 : 1.4) * inv;
            if (v.mph[k] >= 1) v.mph[k] -= 1;
            m += v.mph[k] < 0.5 ? 1 : -1;
          }
          const nz = rng.bi();
          let x = m * 0.18 * (1 - tone * 0.7) + nz * (0.25 + tone * 0.6);
          x = v.hp.hp(v.f1.tick(x, 1) * 2 + x * 0.3 * snap);
          y = x * v.env * 1.3;
          if (v.model === M.CYM) { y += nz * v.nEnv * 0.3 * snap; v.nEnv *= v.nDecC; }
          v.env *= v.decC;
          break;
        }
        case M.TOM: {
          const f = 95 * tr * (1 + v.pEnv * (0.4 + tone * 0.8));
          v.pEnv *= v.pDecC;
          v.ph += f * inv; if (v.ph >= 1) v.ph -= 1;
          y = fsin(v.ph) * v.env + v.f1.tick(rng.bi(), 0) * v.nEnv * snap * 0.4;
          v.env *= v.decC; v.nEnv *= v.nDecC;
          y = ftanh(y * 1.3);
          break;
        }
        case M.RIM: {
          v.ph += 470 * tr * inv; if (v.ph >= 1) v.ph -= 1;
          v.ph2 += 1700 * tr * inv; if (v.ph2 >= 1) v.ph2 -= 1;
          const x = (v.ph < 0.5 ? 1 : -1) * 0.4 + (v.ph2 < 0.5 ? 1 : -1) * 0.6 + rng.bi() * snap * 0.4;
          y = v.f1.tick(x, 1) * v.env * 1.5;
          v.env *= v.decC;
          break;
        }
        case M.COW: {
          v.ph += 540 * tr * inv; if (v.ph >= 1) v.ph -= 1;
          v.ph2 += 800 * tr * inv; if (v.ph2 >= 1) v.ph2 -= 1;
          const x = ((v.ph < 0.5 ? 1 : -1) + (v.ph2 < 0.5 ? 1 : -1)) * 0.4;
          const e = v.env * (0.6 + 0.4 * v.pEnv);
          v.pEnv *= v.pDecC;
          y = v.f1.tick(x, 1) * e * 1.4;
          v.env *= v.decC;
          break;
        }
        case M.CLAVE: {
          v.ph += 2500 * tr * inv * (0.7 + tone * 0.6); if (v.ph >= 1) v.ph -= 1;
          y = fsin(v.ph) * v.env;
          v.env *= v.decC;
          break;
        }
        case M.SHAKER: {
          const atk = 0.004 + 0.02 * (1 - snap);
          const a = tsec < atk ? tsec / atk : 1;
          y = v.hp.hp(rng.bi()) * a * v.env * 0.9;
          if (tsec >= atk) v.env *= v.decC;
          break;
        }
        case M.ZAP: {
          const f = (60 + 2400 * v.pEnv * (0.5 + tone)) * tr;
          v.pEnv *= v.pDecC;
          v.ph += f * inv; if (v.ph >= 1) v.ph -= 1;
          y = fsin(v.ph) * v.env;
          v.env *= v.decC;
          break;
        }
        case M.SAMPLE: {
          const s = v.smp;
          if (!s || v.spos >= s.len - 1) { v.on = false; y = 0; break; }
          const ip = v.spos | 0, fr = v.spos - ip;
          const c0 = s.ch[0], c1 = s.ch[1] || c0;
          const a = (c0[ip] + c1[ip]) * 0.5, b = (c0[ip + 1] + c1[ip + 1]) * 0.5;
          y = (a + (b - a) * fr) * v.env;
          v.spos += v.sinc;
          v.env *= v.decC;
          break;
        }
      }
      if (v.fading) { v.fade -= 1 / (0.004 * sr); if (v.fade <= 0) { v.on = false; v.fade = 0; } y *= v.fade; }
      y *= vel;
      outL[i] += y * v.gL; outR[i] += y * v.gR;
      v.t++;
      if (v.env < 2e-5 && v.model !== M.CLAP && v.model !== M.SHAKER) {
        if (v.model !== M.SNARE && v.model !== M.SNARE9) { v.on = false; }
      }
      if ((v.model === M.CLAP || v.model === M.SHAKER) && v.env < 2e-5) v.on = false;
      if (!v.on) break;
    }
  }
}
