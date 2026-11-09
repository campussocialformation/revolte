// Revolte — DSP building blocks (no allocations in the audio path)

export const TWO_PI = Math.PI * 2;

export function ftanh(x) {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

export const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Sine table for fast oscillators (FM)
const SIN_N = 4096;
export const SIN_TABLE = new Float32Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN_TABLE[i] = Math.sin((i / SIN_N) * TWO_PI);
export function fsin(phase) {
  // phase in cycles, any real value
  let p = phase - Math.floor(phase);
  const f = p * SIN_N;
  const i = f | 0;
  const fr = f - i;
  return SIN_TABLE[i] + (SIN_TABLE[i + 1] - SIN_TABLE[i]) * fr;
}

export function polyblep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  } else if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

// Fast PRNG (xorshift)
export class Rng {
  constructor(seed = 22222) { this.s = seed >>> 0 || 1; }
  next() { // 0..1
    let x = this.s;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 4294967296;
  }
  bi() { return this.next() * 2 - 1; }
}
export const rng = new Rng(12345);

// Zero-delay-feedback state variable filter (Zavalishin / Simper)
export class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 2; }
  set(fc, res, sr) {
    const f = clamp(fc, 10, sr * 0.45);
    const g = Math.tan((Math.PI * f) / sr);
    this.k = 2 - 1.96 * clamp(res, 0, 1);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  // mode: 0 LP, 1 BP, 2 HP
  tick(v0, mode) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    if (mode === 0) return v2;
    if (mode === 1) return v1;
    return v0 - this.k * v1 - v2;
  }
  reset() { this.ic1 = this.ic2 = 0; }
}

// Non-linear 4 pole ladder (Huovilainen-style, cheap tanh)
export class Ladder {
  constructor() { this.s1 = 0; this.s2 = 0; this.s3 = 0; this.s4 = 0; this.g = 0.1; this.r = 0; }
  set(fc, res, sr) {
    const f = clamp(fc, 10, sr * 0.22) / sr;
    this.g = 1 - Math.exp(-TWO_PI * f);
    this.r = clamp(res, 0, 1) * 4.1;
    this.comp = 1 + this.r * 0.25; // passband loss compensation
  }
  tick(x) {
    const g = this.g;
    const u = ftanh((x * this.comp - this.r * this.s4));
    this.s1 += g * (u - ftanh(this.s1));
    this.s2 += g * (ftanh(this.s1) - ftanh(this.s2));
    this.s3 += g * (ftanh(this.s2) - ftanh(this.s3));
    this.s4 += g * (ftanh(this.s3) - ftanh(this.s4));
    return this.s4;
  }
  reset() { this.s1 = this.s2 = this.s3 = this.s4 = 0; }
}

// One pole lowpass / highpass helpers
export class OnePole {
  constructor() { this.z = 0; this.a = 0.5; }
  setHz(fc, sr) { this.a = 1 - Math.exp((-TWO_PI * clamp(fc, 1, sr * 0.49)) / sr); }
  lp(x) { this.z += this.a * (x - this.z); return this.z; }
  hp(x) { this.z += this.a * (x - this.z); return x - this.z; }
}

// ADSR with linear attack and exponential decay/release
export class Env {
  constructor() { this.stage = 0; this.v = 0; this.aInc = 0; this.dC = 0; this.rC = 0; this.s = 0; }
  // times in ms
  setup(a, d, s, r, sr) {
    this.aInc = 1 / Math.max(1, (a * 0.001) * sr);
    this.dC = Math.exp(-1 / Math.max(1, (d * 0.001 * sr) / 4.6));
    this.rC = Math.exp(-1 / Math.max(1, (r * 0.001 * sr) / 4.6));
    this.s = s;
  }
  gate(on, retrigFromZero = false) {
    if (on) { this.stage = 1; if (retrigFromZero) this.v = 0; } else if (this.stage !== 0) this.stage = 4;
  }
  tick() {
    switch (this.stage) {
      case 1:
        this.v += this.aInc;
        if (this.v >= 1) { this.v = 1; this.stage = 2; }
        break;
      case 2:
        this.v = this.s + (this.v - this.s) * this.dC;
        if (Math.abs(this.v - this.s) < 1e-4) { this.v = this.s; this.stage = 3; }
        break;
      case 3:
        this.v = this.s;
        break;
      case 4:
        this.v *= this.rC;
        if (this.v < 1e-5) { this.v = 0; this.stage = 0; }
        break;
    }
    return this.v;
  }
  // advance n samples at once (for control-rate envelopes); returns value
  tickN(n) {
    for (let i = 0; i < n; i++) this.tick();
    return this.v;
  }
  get active() { return this.stage !== 0; }
}

// Simple fixed-size delay line with fractional read
export class DelayLine {
  constructor(size) { this.buf = new Float32Array(size); this.size = size; this.w = 0; }
  write(x) { this.buf[this.w] = x; this.w = (this.w + 1) % this.size; }
  read(d) { // d in samples (>=1)
    let rp = this.w - d;
    while (rp < 0) rp += this.size;
    const i = rp | 0;
    const f = rp - i;
    const a = this.buf[i];
    const b = this.buf[(i + 1) % this.size];
    return a + (b - a) * f;
  }
  clear() { this.buf.fill(0); }
}

// Waveshapers used by insert distortion
export function shape(type, x, drive) {
  switch (type) {
    case 1: return ftanh(x * (1 + drive * 8)); // SOFT
    case 2: { const y = x * (1 + drive * 15); return y > 1 ? 1 : y < -1 ? -1 : y; } // HARD
    case 3: { // FOLD
      let y = x * (1 + drive * 6);
      for (let i = 0; i < 4 && (y > 1 || y < -1); i++) y = y > 1 ? 2 - y : y < -1 ? -2 - y : y;
      return y;
    }
    case 5: { // FUZZ (asymmetric)
      const y = x * (1 + drive * 20);
      return y > 0 ? 1 - Math.exp(-y) : -1 + Math.exp(y * 0.7);
    }
    default: return x;
  }
}
