// Revolte — bridge between UI and the AudioWorklet engine
export class AudioBridge {
  constructor() {
    this.ctx = null; this.node = null; this.handlers = new Map();
    this.queue = []; this.decoded = new Map(); // sample id -> {ch, sr}
    this.ready = false;
    this.capture = null;
  }
  async start(latencyHint = 'interactive') {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint, sampleRate: 48000 });
    await this.ctx.audioWorklet.addModule(new URL('../engine/worklet.js', import.meta.url));
    this.node = new AudioWorkletNode(this.ctx, 'revolte-processor', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.gain = this.ctx.createGain();
    this.node.connect(this.gain).connect(this.ctx.destination);
    this.node.port.onmessage = (ev) => {
      const d = ev.data;
      if (Array.isArray(d)) for (const m of d) this._dispatch(m); else this._dispatch(d);
    };
    this.ready = true;
    for (const m of this.queue) this.node.port.postMessage(m);
    this.queue = [];
  }
  async resume() { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); }
  get latencyMs() { return this.ctx ? Math.round(((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000) : 0; }
  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(fn); }
  _dispatch(m) { const hs = this.handlers.get(m.type); if (hs) for (const h of hs) h(m); }
  send(m) { if (this.ready) this.node.port.postMessage(m); else this.queue.push(m); }

  // decode a sample (ArrayBuffer of an audio file) and send it to the engine
  async loadSample(id, arrayBuffer) {
    if (!this.ctx) await this.start();
    const buf = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    const ch = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) ch.push(new Float32Array(buf.getChannelData(c)));
    this.decoded.set(id, { ch, sr: buf.sampleRate, duration: buf.duration });
    this.send({ type: 'sample', id, ch, sr: buf.sampleRate });
    return this.decoded.get(id);
  }

  // real-time recording of the master output into a WAV file
  startCapture() {
    if (!this.ctx || this.capture) return;
    const dest = this.ctx.createMediaStreamDestination();
    const proc = this.ctx.createScriptProcessor(4096, 2, 2);
    const chunksL = [], chunksR = [];
    proc.onaudioprocess = (e) => {
      chunksL.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      chunksR.push(new Float32Array(e.inputBuffer.getChannelData(1)));
    };
    this.gain.connect(proc); proc.connect(dest);
    this.capture = { proc, chunksL, chunksR, dest, t0: performance.now() };
  }
  stopCapture() {
    const c = this.capture; if (!c) return null;
    this.gain.disconnect(c.proc); c.proc.disconnect();
    this.capture = null;
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
