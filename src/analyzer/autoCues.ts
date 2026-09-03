import type { AutoCue, CueType } from '@shared/types';

/**
 * Automatic cue points at musically meaningful positions.
 *
 * A DJ's cues sit where the track changes: the first downbeat, the drop, the
 * break, the point the vocal enters. Those are all moments where the sound
 * *changes character*, which is measurable — compute how different each
 * moment is from the one before, and the peaks of that curve are the section
 * boundaries.
 *
 * Everything is snapped to a downbeat, because a cue that lands off the grid
 * is useless for mixing.
 */

/** Bars of smoothing used to rank changes — and to bound the raw-peak search. */
const SMOOTH_RADIUS = 2;
/** Bars either side of a boundary used to decide what kind of change it is. */
const CLASSIFY_WINDOW = 4;

export interface AutoCueOptions {
  /** How many cues to return. Eight matches the CDJ hot-cue bank. */
  max?: number;
  /** Minimum gap between cues, in bars, so they don't cluster on one change. */
  minGapBars?: number;
}

/**
 * @param mono        Downsampled mono signal.
 * @param sampleRate  Its sample rate.
 * @param beats       Beat positions in seconds.
 * @param downbeats   Downbeat positions in seconds.
 * @param durationSec Track length.
 */
export function detectAutoCues(
  mono: Float32Array,
  sampleRate: number,
  beats: number[],
  downbeats: number[],
  durationSec: number,
  opts: AutoCueOptions = {}
): AutoCue[] {
  const max = opts.max ?? 8;
  const minGapBars = opts.minGapBars ?? 4;
  if (downbeats.length < 2 || mono.length === 0) return [];

  // --- Per-bar feature vectors -------------------------------------------
  // One vector per bar: energy plus a coarse spectral shape. Comparing
  // neighbouring bars in this space is what makes a "the track changed here"
  // signal rather than just "it got louder".
  const bars = buildBars(downbeats, durationSec);
  if (bars.length < 4) return [];

  const features = bars.map((b) => barFeature(mono, sampleRate, b.start, b.end));

  // --- Novelty: how different is each bar from the one before? ------------
  const novelty = new Float32Array(features.length);
  for (let i = 1; i < features.length; i++) {
    novelty[i] = featureDistance(features[i - 1], features[i]);
  }
  // Smooth lightly so a single odd bar doesn't outrank a real section change.
  const smoothed = smooth(novelty, SMOOTH_RADIUS);

  // --- Candidates ---------------------------------------------------------
  // The two curves do different jobs. Smoothing tells you *which* changes are
  // big enough to matter, but it spreads a one-bar section change into a
  // plateau several bars wide, and picking the argmax of a plateau puts the
  // cue wherever the rounding falls — measured two bars early. So rank on the
  // smoothed curve and take the position from the raw one underneath it.
  const seen = new Set<number>();
  const candidates: Array<{ barIndex: number; score: number }> = [];
  for (let i = 1; i < smoothed.length - 1; i++) {
    // Local maximum only: a rising slope is the approach to a change, not
    // the change itself.
    if (smoothed[i] >= smoothed[i - 1] && smoothed[i] > smoothed[i + 1]) {
      const at = sharpestNear(novelty, i, SMOOTH_RADIUS);
      if (seen.has(at)) continue;
      seen.add(at);
      candidates.push({ barIndex: at, score: smoothed[i] });
    }
  }

  const peak = Math.max(...smoothed, 1e-9);
  candidates.sort((a, b) => b.score - a.score);

  // --- Pick, keeping them spread out -------------------------------------
  const chosen: typeof candidates = [];
  for (const c of candidates) {
    if (chosen.length >= max - 1) break; // one slot reserved for the intro cue
    if (chosen.some((x) => Math.abs(x.barIndex - c.barIndex) < minGapBars)) continue;
    chosen.push(c);
  }

  const cues: AutoCue[] = chosen.map((c) => ({
    timeSec: bars[c.barIndex].start,
    type: classify(features, c.barIndex),
    score: Math.max(0, Math.min(1, c.score / peak)),
  }));

  // The first playable downbeat is always worth a cue — it is where you drop
  // the track in, and it may not be a point of change at all.
  const firstDownbeat = downbeats.find((d) => d >= 0) ?? beats[0] ?? 0;
  cues.push({ timeSec: firstDownbeat, type: 'intro', score: 1, label: 'Start' });

  cues.sort((a, b) => a.timeSec - b.timeSec);
  return cues.slice(0, max).map((c, i) => ({ ...c, label: c.label ?? `Cue ${i + 1}` }));
}

/** Energy of each bar, 0..1, for display under the waveform. */
export function barEnergies(
  mono: Float32Array,
  sampleRate: number,
  downbeats: number[],
  durationSec: number
): Array<{ startSec: number; endSec: number; energy: number }> {
  const bars = buildBars(downbeats, durationSec);
  if (bars.length === 0) return [];
  const raw = bars.map((b) => rms(mono, secToIdx(b.start, sampleRate), secToIdx(b.end, sampleRate)));
  const peak = Math.max(...raw, 1e-9);
  return bars.map((b, i) => ({
    startSec: b.start,
    endSec: b.end,
    energy: Math.max(0, Math.min(1, raw[i] / peak)),
  }));
}

/* ------------------------------- internals ------------------------------ */

interface Bar { start: number; end: number }

function buildBars(downbeats: number[], durationSec: number): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < downbeats.length - 1; i++) {
    bars.push({ start: downbeats[i], end: downbeats[i + 1] });
  }
  const last = downbeats[downbeats.length - 1];
  if (last !== undefined && last < durationSec) bars.push({ start: last, end: durationSec });
  return bars;
}

interface BarFeature {
  energy: number;
  /** Coarse spectral shape: energy in four bands, normalised. */
  bands: [number, number, number, number];
}

/**
 * Four bands are enough to tell a break from a drop: what distinguishes them
 * is mostly whether the low end is present, and how much top there is.
 */
function barFeature(
  mono: Float32Array,
  sampleRate: number,
  startSec: number,
  endSec: number
): BarFeature {
  const a = secToIdx(startSec, sampleRate);
  const b = Math.min(mono.length, secToIdx(endSec, sampleRate));
  if (b <= a) return { energy: 0, bands: [0, 0, 0, 0] };

  const energy = rms(mono, a, b);

  // Band energies via zero-crossing-weighted partitioning would be crude;
  // instead run four one-pole filters over the window, which is cheap and
  // stable enough for a similarity measure.
  const cutoffs = [200, 800, 3000];
  let lp1 = 0, lp2 = 0, lp3 = 0;
  const k = cutoffs.map((f) => Math.exp((-2 * Math.PI * f) / sampleRate));
  let e0 = 0, e1 = 0, e2 = 0, e3 = 0;
  for (let i = a; i < b; i++) {
    const x = mono[i];
    lp1 = x + k[0] * (lp1 - x);
    lp2 = x + k[1] * (lp2 - x);
    lp3 = x + k[2] * (lp3 - x);
    const low = lp1;
    const lowMid = lp2 - lp1;
    const highMid = lp3 - lp2;
    const high = x - lp3;
    e0 += low * low; e1 += lowMid * lowMid; e2 += highMid * highMid; e3 += high * high;
  }
  const n = b - a;
  const bands: [number, number, number, number] = [
    Math.sqrt(e0 / n), Math.sqrt(e1 / n), Math.sqrt(e2 / n), Math.sqrt(e3 / n),
  ];
  // Normalise the shape so the comparison is about balance, not level —
  // level is already carried by `energy`.
  const sum = bands[0] + bands[1] + bands[2] + bands[3];
  if (sum > 1e-9) for (let i = 0; i < 4; i++) bands[i] /= sum;

  return { energy, bands };
}

function featureDistance(a: BarFeature, b: BarFeature): number {
  // Spectral balance change plus level change, weighted so that a track
  // dropping out (big level change) and a track changing timbre both count.
  let spectral = 0;
  for (let i = 0; i < 4; i++) spectral += Math.abs(a.bands[i] - b.bands[i]);
  const level = Math.abs(a.energy - b.energy) / Math.max(1e-9, Math.max(a.energy, b.energy));
  return spectral + 0.8 * level;
}

/**
 * What kind of change this is.
 *
 * Judged over a few bars either side rather than one: sections run sixteen
 * bars, and the bar on the boundary is usually half of each, so a single-bar
 * comparison reads a half-strength change and calls everything a phrase.
 */
function classify(features: BarFeature[], i: number, win = CLASSIFY_WINDOW): CueType {
  const before = meanFeature(features, i - win, i);
  const after = meanFeature(features, i, i + win);
  if (!before || !after) return 'phrase';
  const scale = Math.max(1e-9, Math.max(before.energy, after.energy));
  const relative = (after.energy - before.energy) / scale;
  // A big lift with the low end intact is a drop; a big fall is a break.
  // The low-band test is a floor, not a strict rise: when a bass line joins a
  // kick they share the band, so the *share* can dip slightly even though the
  // bottom end plainly arrived. What disqualifies a drop is the low end
  // collapsing — a thin, filtered lift is a build, not a drop.
  if (relative > 0.35 && after.bands[0] >= before.bands[0] * 0.9) return 'drop';
  if (relative < -0.35) return 'break';
  return 'phrase';
}

/** Mean feature over bars [from, to), clamped to the track. */
function meanFeature(features: BarFeature[], from: number, to: number): BarFeature | null {
  const lo = Math.max(0, from);
  const hi = Math.min(features.length, to);
  if (hi <= lo) return null;
  const bands: [number, number, number, number] = [0, 0, 0, 0];
  let energy = 0;
  for (let i = lo; i < hi; i++) {
    energy += features[i].energy;
    for (let b = 0; b < 4; b++) bands[b] += features[i].bands[b];
  }
  const n = hi - lo;
  for (let b = 0; b < 4; b++) bands[b] /= n;
  return { energy: energy / n, bands };
}

/** Index of the sharpest raw change within `radius` bars of a smoothed peak. */
function sharpestNear(raw: Float32Array, i: number, radius: number): number {
  let best = i;
  let bestV = -1;
  for (let j = Math.max(1, i - radius); j <= Math.min(raw.length - 1, i + radius); j++) {
    if (raw[j] > bestV) { bestV = raw[j]; best = j; }
  }
  return best;
}

function smooth(x: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(x.length - 1, i + radius); j++) {
      s += x[j]; c++;
    }
    out[i] = s / Math.max(1, c);
  }
  return out;
}

function rms(x: Float32Array, a: number, b: number): number {
  const lo = Math.max(0, a);
  const hi = Math.min(x.length, b);
  if (hi <= lo) return 0;
  let s = 0;
  for (let i = lo; i < hi; i++) s += x[i] * x[i];
  return Math.sqrt(s / (hi - lo));
}

function secToIdx(sec: number, sampleRate: number): number {
  return Math.max(0, Math.round(sec * sampleRate));
}
