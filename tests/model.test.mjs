// Model / tools tests (Node)
import assert from 'node:assert/strict';
import { demoProject, normalizeProject, newProject, engineSong, emptyPattern, newStep } from '../src/shared/model.js';
import { Tools, euclid, copySteps, pasteSteps } from '../src/ui/tools.js';
import { quantizeToScale, fromNorm, toNorm, COMMON_PARAMS, FX_PARAMS, formatParam } from '../src/shared/params.js';

let fails = 0;
const test = (n, f) => { try { f(); console.log('ok  -', n); } catch (e) { fails++; console.log('FAIL-', n, e); } };

test('project JSON roundtrip', () => {
  const p = demoProject();
  const q = normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(q.songs.length, 2);
  assert.equal(q.songs[0].tracks.length, 8);
  assert.deepEqual(engineSong(q.songs[0]).tracks[4].patterns[0].lanes[0][0].v, 1);
});
test('rejects foreign files', () => { assert.throws(() => normalizeProject({ hello: 1 })); });
test('8 bars and more: 128-step patterns survive', () => {
  const p = newProject();
  const pat = emptyPattern(false, 128);
  pat.lanes[0][127] = newStep(false, 60);
  p.songs[0].tracks[0].patterns[3] = pat;
  const q = normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(q.songs[0].tracks[0].patterns[3].length, 128);
  assert.equal(q.songs[0].tracks[0].patterns[3].lanes[0][127].n[0].p, 60);
});
test('euclid', () => {
  assert.equal(euclid(3, 8).map((x) => (x ? 'x' : '.')).join(''), 'x..x..x.');
  assert.equal(euclid(4, 16).filter(Boolean).length, 4);
});
test('tools: shift, reverse, double, half', () => {
  const p = emptyPattern(true, 4);
  p.lanes[0][0] = newStep(true);
  Tools.shift(p, 1); assert.ok(p.lanes[0][1]);
  Tools.reverse(p); assert.ok(p.lanes[0][2]);
  Tools.double(p); assert.equal(p.length, 8); assert.ok(p.lanes[0][6]);
  Tools.half(p); assert.equal(p.length, 4);
});
test('copy / paste steps', () => {
  const p = emptyPattern(false, 16);
  p.lanes[0][2] = newStep(false, 64);
  const clip = copySteps(p, new Set([2]));
  const sel = pasteSteps(p, clip, 10);
  assert.ok(sel.has(10)); assert.equal(p.lanes[0][10].n[0].p, 64);
});
test('scale quantize', () => {
  assert.equal(quantizeToScale(61, 0, 'MAJOR'), 60);
  assert.equal(quantizeToScale(66, 9, 'MINOR') % 12, 5);
});
test('param norm conversions invert', () => {
  for (const d of [...COMMON_PARAMS, ...FX_PARAMS]) {
    if (d.options) continue;
    const v = fromNorm(d, toNorm(d, d.def));
    assert.ok(Math.abs(v - d.def) < (d.int ? 0.51 : Math.max(1e-6, Math.abs(d.def) * 1e-3)), d.id + ' ' + v + ' vs ' + d.def);
    assert.equal(typeof formatParam(d, d.def), 'string');
  }
});
console.log(fails ? `${fails} failed` : 'all model tests passed');
process.exit(fails ? 1 : 0);
