// Revolte — native audio host: runs the engine outside the browser and outputs through
// ASIO / WASAPI / DirectSound (RtAudio via the "audify" module). Speaks the same message
// protocol as the AudioWorklet, plus control messages of type '__audio'.
import { Engine } from '../src/engine/core.js';

export const APIS = { ASIO: 6, WASAPI: 7, DS: 8, ALSA: 2, PULSE: 4, CORE: 1, DEFAULT: 0 };
const FLOAT32 = 0x10;
const BLOCK = 128;

export class AudioHost {
  constructor(post, RtAudioImpl) {
    this.post = post;
    this.RtAudio = RtAudioImpl;
    this.rt = null; this.engine = null;
    this.bL = new Float32Array(BLOCK); this.bR = new Float32Array(BLOCK); this.fpos = BLOCK;
    this.capture = null;
    this.load = 0;
    this.underruns = 0;
  }

  handle(msg) {
    if (Array.isArray(msg)) { for (const m of msg) this.handle(m); return; }
    if (!msg) return;
    if (msg.type === '__audio') { this.control(msg); return; }
    if (this.engine) this.engine.handle(msg);
  }

  reply(o) { this.post({ type: '__audio', ...o }); }

  control(m) {
    try {
      switch (m.cmd) {
        case 'devices': {
          const rt = new this.RtAudio(APIS[m.api] ?? 0);
          const devices = rt.getDevices().filter((d) => d.outputChannels > 0).map((d) => ({
            id: d.id, name: d.name, outputChannels: d.outputChannels, sampleRates: d.sampleRates,
            preferredSampleRate: d.preferredSampleRate, isDefault: !!d.isDefaultOutput,
          }));
          this.reply({ ev: 'devices', id: m.id, api: m.api, apiName: rt.getApi(), devices });
          break;
        }
        case 'open': this.open(m); break;
        case 'close': this.close(); this.reply({ ev: 'closed', id: m.id }); break;
        case 'capture':
          if (m.on) this.capture = { L: [], R: [] };
          else if (this.capture) {
            const c = this.capture; this.capture = null;
            const n = c.L.reduce((a, x) => a + x.length, 0);
            const L = new Float32Array(n), R = new Float32Array(n);
            let o = 0; for (let i = 0; i < c.L.length; i++) { L.set(c.L[i], o); R.set(c.R[i], o); o += c.L[i].length; }
            this.reply({ ev: 'captureData', id: m.id, L, R, sr: this.sr });
          }
          break;
      }
    } catch (err) {
      this.reply({ ev: 'error', id: m.id, message: String(err && err.message || err) });
    }
  }

  open(m) {
    this.close();
    const rt = new this.RtAudio(APIS[m.api] ?? 0);
    const devices = rt.getDevices();
    let dev = devices.find((d) => d.id === m.deviceId) || devices.find((d) => d.name === m.deviceName);
    if (!dev) dev = devices.find((d) => d.isDefaultOutput && d.outputChannels > 0) || devices.find((d) => d.outputChannels > 0);
    if (!dev) throw new Error('Aucune sortie audio trouvée pour ' + m.api);
    const sr = m.sampleRate || dev.preferredSampleRate || 48000;
    const first = Math.min(Math.max(0, m.firstChannel | 0), Math.max(0, dev.outputChannels - 2));
    const frameSize = rt.openStream(
      { deviceId: dev.id, nChannels: 2, firstChannel: first }, null, FLOAT32, sr, m.bufferSize || 128, 'Revolte',
      null, () => this.pump(), 0,
      (type, msg) => this.reply({ ev: 'streamError', message: msg, errType: type }),
    );
    this.rt = rt;
    this.sr = rt.getStreamSampleRate ? rt.getStreamSampleRate() || sr : sr;
    this.frameSize = frameSize || m.bufferSize || 128;
    this.engine = new Engine(this.sr);
    this.fpos = BLOCK;
    this.queue = Math.max(1, Math.min(6, m.queue || 2));
    for (let i = 0; i < this.queue; i++) this.pump();
    rt.start();
    const lat = (rt.getStreamLatency ? rt.getStreamLatency() : 0) || 0;
    this.reply({
      ev: 'opened', id: m.id, api: m.api, apiName: rt.getApi(), device: dev.name, sr: this.sr, frameSize: this.frameSize,
      latencyMs: Math.round(((this.queue + 1) * this.frameSize + lat) / this.sr * 1000 * 10) / 10,
    });
  }

  close() {
    if (this.rt) {
      try { if (this.rt.isStreamRunning()) this.rt.stop(); } catch { }
      try { if (this.rt.isStreamOpen()) this.rt.closeStream(); } catch { }
    }
    this.rt = null; this.engine = null;
  }

  // render one device buffer and queue it
  pump() {
    const e = this.engine, rt = this.rt;
    if (!e || !rt) return;
    const t0 = performance.now();
    const n = this.frameSize;
    const out = new Float32Array(n * 2);
    const bL = this.bL, bR = this.bR;
    let fpos = this.fpos;
    try {
      for (let i = 0; i < n; i++) {
        if (fpos >= BLOCK) { e.process(bL, bR); fpos = 0; }
        out[2 * i] = bL[fpos]; out[2 * i + 1] = bR[fpos]; fpos++;
      }
    } catch (err) {
      this.post({ type: 'error', message: String(err && err.stack || err) });
    }
    this.fpos = fpos;
    rt.write(Buffer.from(out.buffer));
    if (this.capture) {
      const L = new Float32Array(n), R = new Float32Array(n);
      for (let i = 0; i < n; i++) { L[i] = out[2 * i]; R[i] = out[2 * i + 1]; }
      this.capture.L.push(L); this.capture.R.push(R);
    }
    const dt = performance.now() - t0;
    this.load = this.load * 0.95 + dt * 0.05;
    e.cpu = this.load / (n / this.sr * 1000);
    if (e.events.length) { this.post(e.events.length === 1 ? e.events[0] : e.events.slice()); e.events.length = 0; }
  }
}
