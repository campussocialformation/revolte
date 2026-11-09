// Native audio host (ASIO/WASAPI path) tested with a fake RtAudio driver
import assert from 'node:assert/strict';
import { AudioHost } from '../electron/audio-host.mjs';
import { demoSong, engineSong } from '../src/shared/model.js';

class FakeRt {
  constructor(api) { this.api = api; this.queue = []; this.running = false; this.open = false; }
  getApi() { return this.api === 6 ? 'ASIO' : 'Fake'; }
  getDevices() { return [{ id: 7, name: 'Focusrite USB ASIO', outputChannels: 4, inputChannels: 2, isDefaultOutput: 1, sampleRates: [44100, 48000], preferredSampleRate: 48000 }]; }
  openStream(out, inp, fmt, sr, frame, name, inCb, outCb) { this.out = out; this.fmt = fmt; this.sr = sr; this.frame = frame; this.cb = outCb; this.open = true; return frame; }
  getStreamSampleRate() { return this.sr; }
  getStreamLatency() { return 0; }
  start() { this.running = true; }
  stop() { this.running = false; }
  isStreamRunning() { return this.running; }
  isStreamOpen() { return this.open; }
  closeStream() { this.open = false; }
  write(buf) { this.queue.push(buf); }
  // simulate the device consuming one buffer
  tick() { const b = this.queue.shift(); this.cb(); return b; }
}

const msgs = [];
const host = new AudioHost((m) => msgs.push(m), FakeRt);
host.handle({ type: '__audio', cmd: 'devices', id: 1, api: 'ASIO' });
const dev = msgs.find((m) => m.ev === 'devices');
assert.equal(dev.devices[0].name, 'Focusrite USB ASIO');

host.handle({ type: '__audio', cmd: 'open', id: 2, api: 'ASIO', deviceId: 7, sampleRate: 48000, bufferSize: 96, firstChannel: 2, queue: 2 });
const op = msgs.find((m) => m.ev === 'opened');
assert.ok(op, 'opened: ' + JSON.stringify(msgs.at(-1)));
assert.equal(op.frameSize, 96); assert.equal(op.apiName, 'ASIO');
console.log('opened', op);
const rt = host.rt;
assert.equal(rt.fmt, 0x10); assert.equal(rt.out.firstChannel, 2); assert.equal(rt.queue.length, 2);

host.handle({ type: 'song', song: engineSong(demoSong()) });
host.handle({ type: 'transport', cmd: 'play' });
host.handle({ type: '__audio', cmd: 'capture', id: 3, on: true });
let peak = 0, nan = false, frames = 0;
const t0 = performance.now();
const seconds = 4;
const n = Math.ceil(seconds * 48000 / 96);
for (let i = 0; i < n; i++) {
  const b = rt.tick();
  const f = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  assert.equal(f.length, 96 * 2);
  for (const x of f) { if (!Number.isFinite(x)) nan = true; peak = Math.max(peak, Math.abs(x)); }
  frames += 96;
}
const ms = performance.now() - t0;
assert.equal(rt.queue.length, 2, 'queue depth stays constant');
assert.equal(nan, false); assert.ok(peak > 0.05, 'audible ' + peak);
assert.ok(msgs.some((m) => m.type === 'pos' && m.playing), 'position reports');
host.handle({ type: '__audio', cmd: 'capture', id: 4, on: false });
const cap = msgs.find((m) => m.ev === 'captureData');
assert.equal(cap.L.length, frames);
console.log(`ok - ${seconds}s rendered through fake ASIO (buffer 96) in ${ms.toFixed(0)} ms, peak ${peak.toFixed(2)}`);
host.handle({ type: '__audio', cmd: 'close', id: 5 });
assert.equal(rt.open, false);
console.log('all audio host tests passed');
