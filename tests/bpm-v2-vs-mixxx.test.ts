/**
 * Does Mixxx's constant-region ironing still add anything on top of the v2
 * detector (spectral flux + Rayleigh ACF + Ellis DP tracker)?
 *
 * v2 already produces real beat positions, so this measures whether ironing
 * those beats into one snapped constant tempo beats v2's own refined BPM.
 */
import { detectBpmV2 } from '../src/analyzer/beatTrackerV2';
import { makeConstBpm } from '../src/analyzer/beatUtils';

const RATE = 22050;

function makeTrack(bpm: number, seconds: number, jitter: number, drift = 0, swing = 0): Float32Array {
  const n = RATE * seconds; const buf = new Float32Array(n); let t = 0;
  for (let b = 0; t * RATE < n; b++) {
    const localBpm = bpm + (drift * t) / 60;
    const period = 60 / localBpm;
    let at = t * RATE;
    if (jitter) at += (Math.random() - 0.5) * jitter * period * RATE;
    if (swing && b % 2 === 1) at += swing * period * RATE;
    const i0 = Math.round(at);
    const accent = b % 4 === 0 ? 1.0 : 0.55;
    for (let k = 0; k < 1800 && i0 + k < n && i0 + k >= 0; k++)
      buf[i0 + k] += accent * Math.sin((2 * Math.PI * 60 * k) / RATE) * Math.exp(-k / 500);
    t += period;
  }
  for (let i = 0; i < n; i++) buf[i] += (Math.random() - 0.5) * 0.02;
  return buf;
}

const cases = [
  { name: 'clean 128',        bpm: 128,  sec: 60, jit: 0,    drift: 0,  swing: 0 },
  { name: 'jitter 2%',        bpm: 124,  sec: 60, jit: 0.02, drift: 0,  swing: 0 },
  { name: 'jitter 5%',        bpm: 100,  sec: 60, jit: 0.05, drift: 0,  swing: 0 },
  { name: 'drift +2/min',     bpm: 120,  sec: 60, jit: 0.01, drift: 2,  swing: 0 },
  { name: 'drift -3/min',     bpm: 140,  sec: 60, jit: 0.01, drift: -3, swing: 0 },
  { name: 'swing',            bpm: 110,  sec: 60, jit: 0.01, drift: 0,  swing: 0.08 },
  { name: 'short 20s',        bpm: 132,  sec: 20, jit: 0.01, drift: 0,  swing: 0 },
  { name: 'slow 70',          bpm: 70,   sec: 60, jit: 0.01, drift: 0,  swing: 0 },
  { name: 'fast 175',         bpm: 175,  sec: 60, jit: 0.01, drift: 0,  swing: 0 },
  { name: 'half-int 92.5',    bpm: 92.5, sec: 60, jit: 0.01, drift: 0,  swing: 0 },
  { name: 'dj-edit 106.62',   bpm: 106.62, sec: 60, jit: 0.01, drift: 0, swing: 0 },
];

/** A tempo error worth failing a build over. Below this it is not audible. */
const MATERIAL_BPM = 0.5;

console.log('case              target      v2    ironed    Δv2   Δiron  cov%  verdict');
let v2Sum = 0, mixSum = 0, n = 0, better = 0, worse = 0;
const regressions: string[] = [];
const octaveOff: boolean[] = [];
for (const c of cases) {
  const pcm = makeTrack(c.bpm, c.sec, c.jit, c.drift, c.swing);
  const v2 = detectBpmV2(pcm, RATE);
  const ironed = makeConstBpm(v2.beats);
  const final = ironed?.bpm ?? v2.bpm;          // what the pipeline would use
  const dV2 = Math.abs(v2.bpm - c.bpm);
  const dMix = Math.abs(final - c.bpm);
  v2Sum += dV2; mixSum += dMix; n++;
  // 0.005 BPM is below the noise floor of a stochastic benchmark, so it is
  // reported but never failed on. What would actually hurt a mix is ironing
  // pulling a usable answer off by a musically audible amount.
  const verdict = dMix < dV2 - 0.005 ? 'better' : dMix > dV2 + 0.005 ? 'WORSE' : 'same';
  if (verdict === 'better') better++;
  if (verdict === 'WORSE') worse++;
  if (dMix > dV2 + MATERIAL_BPM) regressions.push(`${c.name}: ${dV2.toFixed(2)} → ${dMix.toFixed(2)}`);
  // Half- or double-time: the ratio is a power of two rather than the tempo
  // being merely imprecise. Tracked separately from ordinary error.
  const ratio = final / c.bpm;
  octaveOff.push(Math.abs(Math.log2(ratio)) > 0.4);
  console.log(
    `${c.name.padEnd(16)} ${String(c.bpm).padStart(6)}  ${v2.bpm.toFixed(2).padStart(6)}  ` +
    `${final.toFixed(2).padStart(7)}  ${dV2.toFixed(2).padStart(5)}  ${dMix.toFixed(2).padStart(5)}  ` +
    `${((ironed?.coverage ?? 0) * 100).toFixed(0).padStart(4)}  ${verdict}`
  );
}
console.log(`\nmean Δ  v2 ${(v2Sum / n).toFixed(3)}   →   with ironing ${(mixSum / n).toFixed(3)}`);
console.log(`${better} improved, ${worse} regressed, ${n - better - worse} unchanged`);

// Octave errors are a separate, known failure mode; call them out so a
// half-time answer cannot hide inside a healthy-looking mean.
const octave = cases.filter((c, i) => octaveOff[i]).map((c) => c.name);
if (octave.length) console.log(`octave errors (known weakness): ${octave.join(', ')}`);

let bad = false;
if (regressions.length) {
  console.log(`\nFAIL ironing regressed by more than ${MATERIAL_BPM} BPM: ${regressions.join(' | ')}`);
  bad = true;
}
if (mixSum > v2Sum) {
  console.log('\nFAIL ironing made the aggregate worse');
  bad = true;
}
console.log(bad ? '' : '\nironing is a net win and regressed nothing audible.');
process.exit(bad ? 1 : 0);
