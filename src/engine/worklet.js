// Revolte — AudioWorklet entry point
import { Engine } from './core.js';

class RevolteProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new Engine(sampleRate);
    this.port.onmessage = (ev) => {
      const d = ev.data;
      if (Array.isArray(d)) for (const m of d) this.engine.handle(m);
      else this.engine.handle(d);
    };
    this.load = 0;
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const t0 = Date.now();
    try {
      this.engine.process(L, R);
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err && err.stack || err) });
    }
    const dt = Date.now() - t0;
    this.load = this.load * 0.99 + dt * 0.01;
    this.engine.cpu = this.load / (128 / sampleRate * 1000);
    const ev = this.engine.events;
    if (ev.length) {
      this.port.postMessage(ev.length === 1 ? ev[0] : ev.slice());
      ev.length = 0;
    }
    return true;
  }
}
registerProcessor('revolte-processor', RevolteProcessor);
