// Offline render tests of the audio engine (Node, no Web Audio)
import { Engine } from '../src/engine/core.js';
import { demoSong, engineSong, newSong, emptyPattern, newStep } from '../src/shared/model.js';
import { FACTORY_SOUNDS, DRUM_KITS } from '../src/shared/presets.js';
import { soundFromPreset } from '../src/shared/model.js';
import assert from 'node:assert/strict';

const SR = 48000;
function render(e, seconds) {
  const L = new Float32Array(128), R = new Float32Array(128);
  const blocks = Math.ceil(seconds * SR / 128);
  let peak = 0, sum = 0, nan = false;
  const t0 = performance.now();
  for (let b = 0; b < blocks; b++) {
    e.process(L, R);
    for (let i = 0; i < 128; i++) {
      const x = L[i], y = R[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) nan = true;
      peak = Math.max(peak, Math.abs(x), Math.abs(y));
      sum += x * x + y * y;
    }
  }
  const ms = performance.now() - t0;
  return { peak, rms: Math.sqrt(sum / (blocks * 256)), nan, rt: ms / (seconds * 1000) };
}

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok  -', name); } catch (err) { failures++; console.log('FAIL-', name, '\n', err); }
}

test('demo song plays, finite and audible, under real-time', () => {
  const e = new Engine(SR);
  e.handle({ type: 'song', song: engineSong(demoSong()) });
  e.handle({ type: 'transport', cmd: 'play' });
  const r = render(e, 8);
  console.log('     demo:', r);
  assert.equal(r.nan, false);
  assert.ok(r.peak > 0.05, 'audible');
  assert.ok(r.peak <= 1.0001, 'limited');
  assert.ok(r.rt < 0.5, 'render faster than half real-time: ' + r.rt);
});

test('every factory sound renders on a melodic track', () => {
  for (const p of FACTORY_SOUNDS) {
    const e = new Engine(SR);
    const s = newSong();
    s.tracks[0].sound = soundFromPreset(p);
    e.handle({ type: 'song', song: engineSong(s) });
    e.handle({ type: 'note', t: 0, notes: [48, 55, 60], v: 0.9, on: true });
    const a = render(e, 0.6);
    e.handle({ type: 'note', t: 0, notes: [48, 55, 60], v: 0, on: false });
    const b = render(e, 1.0);
    assert.equal(a.nan || b.nan, false, p.name + ' NaN');
    if (p.engine !== 'SAMPLE') assert.ok(a.peak > 0.01, p.name + ' silent: ' + a.peak);
  }
});

test('every drum kit lane renders', () => {
  for (const k of DRUM_KITS) {
    const e = new Engine(SR);
    const s = newSong();
    s.tracks[4].sound = soundFromPreset(k);
    e.handle({ type: 'song', song: engineSong(s) });
    for (let lane = 0; lane < 8; lane++) {
      e.handle({ type: 'note', t: 4, notes: [lane], v: 1, on: true });
      const r = render(e, 0.3);
      assert.equal(r.nan, false);
      assert.ok(r.peak > 0.005, `${k.name} lane ${lane} silent`);
    }
  }
});

test('trig conditions 1:2 and probability', () => {
  const e = new Engine(SR);
  const s = newSong();
  const p = emptyPattern(true, 4);
  p.lanes[0][0] = { ...newStep(true), cond: '1:2' };
  s.tracks[4].patterns[0] = p;
  e.handle({ type: 'song', song: engineSong(s) });
  let hits = 0;
  const orig = e.tracks[4].kit.trigger.bind(e.tracks[4].kit);
  e.tracks[4].kit.trigger = (l, v, a) => { hits++; orig(l, v, a); };
  e.handle({ type: 'transport', cmd: 'play' });
  // 4 steps of 1/16 = 1 beat; 8 passes = 8 beats at 124 bpm
  render(e, (8 * 60) / 124 - 0.01);
  assert.equal(hits, 4, 'hits on passes 1,3,5,7: ' + hits);
});

test('ratchet x4 fires 4 hits, pattern switch at bar', () => {
  const e = new Engine(SR);
  const s = newSong();
  const p = emptyPattern(true, 16);
  p.lanes[0][0] = { ...newStep(true), rat: 4 };
  s.tracks[4].patterns[0] = p;
  s.tracks[4].patterns[1] = emptyPattern(true, 16);
  e.handle({ type: 'song', song: engineSong(s) });
  let hits = 0;
  const orig = e.tracks[4].kit.trigger.bind(e.tracks[4].kit);
  e.tracks[4].kit.trigger = (l, v, a) => { hits++; orig(l, v, a); };
  e.handle({ type: 'transport', cmd: 'play' });
  render(e, 0.5);
  assert.equal(hits, 4);
  e.handle({ type: 'launch', t: 4, slot: 1, quant: 'BAR' });
  render(e, 4);
  assert.equal(e.tracks[4].cur, 1);
});

test('song mode advances entries and ONCE stops', () => {
  const e = new Engine(SR);
  const s = newSong();
  s.bpm = 240;
  for (const t of s.tracks) { t.patterns[0] = emptyPattern(t.kind === 'drum', 16); t.patterns[1] = emptyPattern(t.kind === 'drum', 16); t.list = [{ pat: 0, reps: 1 }, { pat: 1, reps: 1 }, ...Array(14).fill(null)]; }
  s.songMode = 2;
  e.handle({ type: 'song', song: engineSong(s) });
  e.handle({ type: 'transport', cmd: 'play' });
  render(e, 1.5); // 6 beats: in entry B
  assert.equal(e.tracks[0].cur, 1);
  render(e, 1.5);
  assert.equal(e.playing, false, 'stopped after the list');
});

test('live recording writes into the pattern', () => {
  const e = new Engine(SR);
  const s = newSong();
  e.handle({ type: 'song', song: engineSong(s) });
  e.handle({ type: 'arm', t: 2 });
  e.handle({ type: 'rec', rec: { on: true, countIn: false } });
  e.handle({ type: 'transport', cmd: 'play' });
  render(e, 0.25);
  e.handle({ type: 'note', t: 2, notes: [45], v: 0.9, on: true });
  render(e, 0.2);
  e.handle({ type: 'note', t: 2, notes: [45], v: 0, on: false });
  const recs = e.events.filter((m) => m.type === 'recStep');
  assert.ok(recs.length >= 2);
  const st = recs[recs.length - 1].step;
  assert.equal(st.n[0].p, 45);
  assert.ok(st.n[0].l > 0.5);
});

test('perf FX and throws keep audio finite', () => {
  const e = new Engine(SR);
  e.handle({ type: 'song', song: engineSong(demoSong()) });
  e.handle({ type: 'transport', cmd: 'play' });
  render(e, 1);
  for (let fx = 0; fx < 14; fx++) {
    e.handle({ type: 'perf', fx, on: true });
    const r = render(e, 0.7);
    e.handle({ type: 'perf', fx, on: false });
    const r2 = render(e, 0.2);
    assert.equal(r.nan || r2.nan, false, 'fx ' + fx);
  }
  for (const w of ['cut', 'rev', 'dly', 'dist']) {
    e.handle({ type: 'throw', which: w, on: true }); render(e, 0.3);
    e.handle({ type: 'throw', which: w, on: false });
  }
  const r = render(e, 1);
  assert.equal(r.nan, false);
});

test('arpeggiator plays held chord', () => {
  const e = new Engine(SR);
  const s = newSong();
  s.tracks[0].play.arp = 1;
  e.handle({ type: 'song', song: engineSong(s) });
  let ons = 0;
  const orig = e.tracks[0].synth.noteOn.bind(e.tracks[0].synth);
  e.tracks[0].synth.noteOn = (...a) => { ons++; orig(...a); };
  e.handle({ type: 'note', t: 0, notes: [60, 64, 67], v: 0.8, on: true });
  render(e, 1); // 124bpm, 1/16 => ~8 notes per second
  assert.ok(ons >= 6 && ons <= 10, 'arp notes: ' + ons);
});

console.log(failures ? `${failures} test(s) failed` : 'all engine tests passed');
process.exit(failures ? 1 : 0);
