// Revolte — sequencer tools (operate on a pattern in place)
import { MAX_STEPS, SCALES, quantizeToScale } from '../shared/params.js';
import { clone, newStep, emptyPattern } from '../shared/model.js';

export function euclid(k, n, rot = 0) {
  const out = new Array(n).fill(false);
  if (k <= 0) return out;
  for (let i = 0; i < n; i++) out[(i + rot) % n] = ((i * k) % n) < k;
  return out;
}

export const Tools = {
  clear(p, lanes = null) { p.lanes = p.lanes.map((l, i) => (lanes && !lanes.includes(i) ? l : [])); },
  reverse(p, lanes = null) {
    const L = p.length;
    p.lanes = p.lanes.map((l, i) => {
      if (lanes && !lanes.includes(i)) return l;
      const out = [];
      for (let s = 0; s < L; s++) if (l[s]) out[L - 1 - s] = l[s];
      return out;
    });
  },
  shift(p, d, lanes = null) {
    const L = p.length;
    p.lanes = p.lanes.map((l, i) => {
      if (lanes && !lanes.includes(i)) return l;
      const out = [];
      for (let s = 0; s < L; s++) if (l[s]) out[(((s + d) % L) + L) % L] = l[s];
      return out;
    });
  },
  double(p) {
    const L = p.length; if (L * 2 > MAX_STEPS) return false;
    p.lanes = p.lanes.map((l) => { const out = [...l]; out.length = L * 2; for (let s = 0; s < L; s++) if (l[s]) out[s + L] = clone(l[s]); return out; });
    p.length = L * 2; return true;
  },
  half(p) {
    const L = Math.max(1, Math.floor(p.length / 2));
    p.lanes = p.lanes.map((l) => l.slice(0, L));
    p.length = L; return true;
  },
  transpose(p, d) { for (const l of p.lanes) for (const st of l) if (st && st.n) for (const n of st.n) n.p = Math.max(0, Math.min(127, n.p + d)); },
  euclid(p, lane, k, n, rot, isDrum, note = 60) {
    p.length = n;
    const pat = euclid(k, n, rot);
    const l = [];
    pat.forEach((on, i) => { if (on) l[i] = (p.lanes[lane] && p.lanes[lane][i]) || newStep(isDrum, note, 0.8); });
    p.lanes[lane] = l;
  },
  random(p, { lane = 0, isDrum, density = 0.4, scale, root, lo = 48, hi = 72, onlyNotes = false }) {
    const sc = SCALES.find((s) => s.id === scale) || SCALES[0];
    const l = onlyNotes ? p.lanes[lane] : [];
    for (let s = 0; s < p.length; s++) {
      if (onlyNotes) { const st = l[s]; if (st && st.n) st.n.forEach((n) => (n.p = quantizeToScale(lo + Math.floor(Math.random() * (hi - lo)), root, sc.id))); continue; }
      if (Math.random() > density) continue;
      if (isDrum) l[s] = { ...newStep(true, 0, 0.5 + Math.random() * 0.5), prob: Math.random() < 0.2 ? 50 + Math.floor(Math.random() * 40) : 100 };
      else {
        const p0 = quantizeToScale(lo + Math.floor(Math.random() * (hi - lo)), root, sc.id);
        l[s] = newStep(false, p0, 0.6 + Math.random() * 0.4);
        l[s].n[0].l = [0.5, 1, 1, 2][Math.floor(Math.random() * 4)];
      }
    }
    if (!onlyNotes) p.lanes[lane] = l;
  },
  humanize(p) {
    for (const l of p.lanes) for (const st of l) if (st) {
      st.ndg = Math.max(-32, Math.min(31, (st.ndg || 0) + Math.round((Math.random() - 0.5) * 8)));
      if (st.n) st.n.forEach((n) => (n.v = Math.max(0.1, Math.min(1, (n.v ?? 0.8) + (Math.random() - 0.5) * 0.2))));
      else st.v = Math.max(0.1, Math.min(1, (st.v ?? 0.8) + (Math.random() - 0.5) * 0.2));
    }
  },
};

// copy / paste of selected steps (keys lane*1000+idx)
export function copySteps(p, sel) {
  const keys = [...sel].sort((a, b) => (a % 1000) - (b % 1000));
  if (!keys.length) return null;
  const minS = Math.min(...keys.map((k) => k % 1000));
  const minL = Math.min(...keys.map((k) => Math.floor(k / 1000)));
  return keys.map((k) => ({ dl: Math.floor(k / 1000) - minL, ds: (k % 1000) - minS, step: clone(p.lanes[Math.floor(k / 1000)][k % 1000]) })).filter((x) => x.step);
}
export function pasteSteps(p, clip, atStep, atLane = 0) {
  const sel = new Set();
  for (const c of clip) {
    const lane = atLane + c.dl, s = atStep + c.ds;
    if (s >= p.length || lane >= p.lanes.length) continue;
    p.lanes[lane][s] = clone(c.step);
    sel.add(lane * 1000 + s);
  }
  return sel;
}
