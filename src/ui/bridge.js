// Revolte — bridge between the UI and the audio engine.
// Two back-ends speak the same message protocol:
//   - 'webaudio': the engine runs in an AudioWorklet (Chromium, WASAPI shared mode)
//   - 'ASIO' | 'WASAPI' | 'DS': the engine runs in a native audio process (Electron only, RtAudio)
const native = typeof window !== 'undefined' ? window.revolteNative : null;
export const NATIVE_AUDIO = !!(native && native.audioConnect);

export class AudioBridge {
  constructor() {
    this.ctx = null; this.node = null; this.handlers = new Map();
    this.queue = []; this.decoded = new Map(); // sample id -> {ch, sr}
    this.ready = false;
    this.capture = null;
    this.backend = null; this.info = null;
    this.nport = null; this.reqs = new Map(); this.reqId = 0;
    this._post = null;
    if (native && native.onAudioHostExit) native.onAudioHostExit((code) => {
      this.nport = null;
      if (this.backend && this.backend !== 'webaudio') {
        this.ready = false; this.backend = null;
        this._dispatch({ type: '__audio', ev: 'hostExit', code });
      }
    });
  }

  // cfg: { backend, latency, api device settings... }
  async start(cfg = {}) {
    const backend = cfg.backend || 'webaudio';
    if (backend !== 'webaudio' && NATIVE_AUDIO) {
      try { await this.startNative(cfg); return { ok: true, backend }; }
      catch (e) { await this.startWeb(cfg.latency); return { ok: false, backend: 'webaudio', error: e.message }; }
    }
    await this.startWeb(cfg.latency);
    return { ok: true, backend: 'webaudio' };
  }
  async stop() {
    this.ready = false;
    if (this.backend === 'webaudio' && this.ctx) {
      try { this.node.disconnect(); } catch { }
      try { await this.ctx.close(); } catch { }
      this.ctx = null; this.node = null;
    } else if (this.backend && this.nport) {
      try { await this.request('close'); } catch { }
    }
    this.backend = null; this.info = null;
  }
  async restart(cfg) { await this.stop(); return this.start(cfg); }

  async startWeb(latencyHint = 'interactive') {
    if (this.backend === 'webaudio' && this.ctx) return;
    this.ctx = new AudioContext({ latencyHint, sampleRate: 48000 });
    await this.ctx.audioWorklet.addModule(new URL('../engine/worklet.js', import.meta.url));
    this.node = new AudioWorkletNode(this.ctx, 'revolte-processor', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.gain = this.ctx.createGain();
    this.node.connect(this.gain).connect(this.ctx.destination);
    this.node.port.onmessage = (ev) => this._receive(ev.data);
    this._post = (m) => this.node.port.postMessage(m);
    this.backend = 'webaudio';
    this.info = { apiName: 'Web Audio (WASAPI partagé)', sr: this.ctx.sampleRate };
    this._ready();
  }

  async connectNative() {
    if (this.nport) return this.nport;
    const port = await new Promise((resolve, reject) => {
      const to = setTimeout(() => { window.removeEventListener('message', onMsg); reject(new Error('le processus audio ne répond pas')); }, 8000);
      const onMsg = (ev) => {
        if (ev.source === window && ev.data && ev.data.type === 'revolte-audio-port' && ev.ports && ev.ports[0]) {
          clearTimeout(to); window.removeEventListener('message', onMsg); resolve(ev.ports[0]);
        }
      };
      window.addEventListener('message', onMsg);
      native.audioConnect();
    });
    port.onmessage = (ev) => this._receive(ev.data);
    this.nport = port;
    return port;
  }
  request(cmd, extra = {}, timeout = 10000) {
    if (!this.nport) return Promise.reject(new Error('audio natif non connecté'));
    const id = ++this.reqId;
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { this.reqs.delete(id); reject(new Error('délai dépassé (' + cmd + ')')); }, timeout);
      this.reqs.set(id, { resolve, reject, to });
      this.nport.postMessage({ type: '__audio', cmd, id, ...extra });
    });
  }
  async nativeDevices(api) { await this.connectNative(); return this.request('devices', { api }); }
  async startNative(cfg) {
    if (this.backend === 'webaudio') await this.stop();
    await this.connectNative();
    const info = await this.request('open', {
      api: cfg.backend, deviceId: cfg.deviceId, deviceName: cfg.deviceName, sampleRate: cfg.sampleRate,
      bufferSize: cfg.bufferSize, firstChannel: cfg.firstChannel, queue: cfg.queue,
    }, 20000);
    this.info = info;
    this.backend = cfg.backend;
    this._post = (m) => this.nport.postMessage(m);
    this._ready();
  }
  _ready() {
    this.ready = true;
    for (const m of this.queue) this._post(m);
    this.queue = [];
  }
  _receive(d) {
    if (Array.isArray(d)) { for (const m of d) this._receive(m); return; }
    if (!d) return;
    if (d.type === '__audio' && d.id && this.reqs.has(d.id)) {
      const r = this.reqs.get(d.id); this.reqs.delete(d.id); clearTimeout(r.to);
      if (d.ev === 'error') r.reject(new Error(d.message)); else r.resolve(d);
      return;
    }
    this._dispatch(d);
  }

  async resume() { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); }
  get running() { return this.backend === 'webaudio' ? !!this.ctx && this.ctx.state === 'running' : !!this.backend; }
  get latencyMs() {
    if (this.backend && this.backend !== 'webaudio') return this.info ? this.info.latencyMs : 0;
    return this.ctx ? Math.round(((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000) : 0;
  }
  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(fn); }
  _dispatch(m) { const hs = this.handlers.get(m.type); if (hs) for (const h of hs) h(m); }
  send(m) { if (this.ready) this._post(m); else this.queue.push(m); }

  // decode a sample (ArrayBuffer of an audio file) and send it to the engine
  async loadSample(id, arrayBuffer) {
    const dec = this.ctx || this.decCtx || (this.decCtx = new OfflineAudioContext(2, 1, 48000));
    const buf = await dec.decodeAudioData(arrayBuffer.slice(0));
    const ch = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) ch.push(new Float32Array(buf.getChannelData(c)));
    this.decoded.set(id, { ch, sr: buf.sampleRate, duration: buf.duration });
    this.send({ type: 'sample', id, ch, sr: buf.sampleRate });
    return this.decoded.get(id);
  }
  resendSamples() { for (const [id, d] of this.decoded) this.send({ type: 'sample', id, ch: d.ch, sr: d.sr }); }

  // real-time recording of the master output into a WAV file
  async startCapture() {
    if (this.capture) return;
    if (this.backend !== 'webaudio') { await this.request('capture', { on: true }).catch(() => { }); this.capture = { native: true }; return; }
    const dest = this.ctx.createMediaStreamDestination();
    const proc = this.ctx.createScriptProcessor(4096, 2, 2);
    const chunksL = [], chunksR = [];
    proc.onaudioprocess = (e) => {
      chunksL.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      chunksR.push(new Float32Array(e.inputBuffer.getChannelData(1)));
    };
    this.gain.connect(proc); proc.connect(dest);
    this.capture = { proc, chunksL, chunksR, dest };
  }
  async stopCapture() {
    const c = this.capture; if (!c) return null;
    this.capture = null;
    if (c.native) {
      const r = await this.request('capture', { on: false }, 30000);
      return encodeWav([r.L], [r.R], r.sr);
    }
    this.gain.disconnect(c.proc); c.proc.disconnect();
    return encodeWav(c.chunksL, c.chunksR, this.ctx.sampleRate);
  }
}

export function encodeWav(chunksL, chunksR, sr) {
  const n = chunksL.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 4, true);
  let o = 44;
  for (let k = 0; k < chunksL.length; k++) {
    const L = chunksL[k], R = chunksR[k];
    for (let i = 0; i < L.length; i++) {
      dv.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      dv.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
      o += 4;
    }
  }
  return new Uint8Array(buf);
}

export function b64encode(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
export function b64decode(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
