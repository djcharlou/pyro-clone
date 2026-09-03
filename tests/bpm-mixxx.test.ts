/**
 * Does the Mixxx-derived refinement actually beat the plain estimator?
 * Measured, not assumed: same synthetic tracks through both paths.
 */
import { energyEnvelope, onsetEnvelope, estimateBpmFromOnsets, estimateFirstBeat } from '../src/analyzer/dsp';
import { trackBeats } from '../src/analyzer/beatTracker';
import { makeConstBpm, roundBpmWithinRange, bpmUncertaintyBand } from '../src/analyzer/beatUtils';

const RATE = 22050, ENV_WINDOW = 256, ENV_FPS = RATE / ENV_WINDOW;

function makeTrack(bpm: number, seconds: number, jitter: number, drift = 0): Float32Array {
  const n = RATE * seconds;
  const buf = new Float32Array(n);
  let t = 0;
  for (let b = 0; t * RATE < n; b++) {
    // `drift` linearly changes tempo across the track (BPM per minute).
    const localBpm = bpm + (drift * t) / 60;
    const period = 60 / localBpm;
    let at = t * RATE;
    if (jitter) at += (Math.random() - 0.5) * jitter * period * RATE;
    const i0 = Math.round(at);
    const accent = b % 4 === 0 ? 1.0 : 0.6;   // downbeat accent, like real music
    for (let k = 0; k < 1800 && i0 + k < n && i0 + k >= 0; k++) {
      buf[i0 + k] += accent * Math.sin((2 * Math.PI * 60 * k) / RATE) * Math.exp(-k / 500);
    }
    t += period;
  }
  for (let i = 0; i < n; i++) buf[i] += (Math.random() - 0.5) * 0.02;
  return buf;
}

function analyse(pcm: Float32Array, durationSec: number) {
  const env = energyEnvelope(pcm, ENV_WINDOW);
  const onsets = onsetEnvelope(env);
  const est = estimateBpmFromOnsets(onsets, ENV_FPS);
  const firstBeat = estimateFirstBeat(onsets, est.bpm, ENV_FPS);

  // Path A: today's behaviour — global ACF tempo only.
  const plain = est.bpm;

  // Path B: snap the global estimate into its uncertainty band.
  const band = bpmUncertaintyBand(est.bpm);
  const snapped = roundBpmWithinRange(band.min, est.bpm, band.max);

  // Path C: track beats, then iron constant regions (Mixxx's approach).
  const tracked = trackBeats(onsets, ENV_FPS, est.bpm, firstBeat, durationSec);
  const ironed = makeConstBpm(tracked.beats);

  return { plain, snapped, ironed: ironed?.bpm ?? null, hitRate: tracked.hitRate, coverage: ironed?.coverage ?? 0 };
}

const targets = [81, 92, 100, 116, 124, 128, 135, 140, 150, 155, 174];
const rows: Array<{ t: number; plain: number; snapped: number; ironed: number }> = [];

console.log('target   plain    snapped   ironed   hit%  cov%');
for (const t of targets) {
  const pcm = makeTrack(t, 60, 0.01);
  const r = analyse(pcm, 60);
  rows.push({
    t,
    plain: Math.abs(r.plain - t),
    snapped: Math.abs(r.snapped - t),
    ironed: r.ironed === null ? NaN : Math.abs(r.ironed - t),
  });
  console.log(
    `${String(t).padStart(6)}  ${r.plain.toFixed(2).padStart(7)}  ${r.snapped.toFixed(2).padStart(8)}  ` +
    `${(r.ironed?.toFixed(2) ?? '  —').padStart(7)}  ${(r.hitRate * 100).toFixed(0).padStart(4)}  ${(r.coverage * 100).toFixed(0).padStart(4)}`
  );
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const worst = (xs: number[]) => Math.max(...xs);
const plainErr = rows.map((r) => r.plain);
const snapErr = rows.map((r) => r.snapped);
const ironErr = rows.map((r) => r.ironed).filter((v) => !Number.isNaN(v));

console.log(`\n            mean err   worst err   exact`);
const exact = (xs: number[]) => xs.filter((e) => e < 0.005).length;
console.log(`plain      ${mean(plainErr).toFixed(3).padStart(8)}  ${worst(plainErr).toFixed(3).padStart(10)}  ${exact(plainErr)}/${plainErr.length}`);
console.log(`snapped    ${mean(snapErr).toFixed(3).padStart(8)}  ${worst(snapErr).toFixed(3).padStart(10)}  ${exact(snapErr)}/${snapErr.length}`);
console.log(`ironed     ${mean(ironErr).toFixed(3).padStart(8)}  ${worst(ironErr).toFixed(3).padStart(10)}  ${exact(ironErr)}/${ironErr.length}`);
