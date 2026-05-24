/**
 * Krumhansl-Schmuckler key estimation, pure-JS.
 *
 * Computes a chroma histogram via a simple DFT-magnitude bank tuned to
 * the 12 pitch classes, then correlates it against major/minor key profiles.
 * Not as accurate as Essentia's KeyExtractor, but useful as a first pass.
 */
import type { NoteRoot, Scale, KeyInfo } from '@shared/types';
import { toCamelot } from '@shared/camelot';

const NOTE_NAMES: NoteRoot[] = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

const REF_A4 = 440;

export function estimateKey(samples: Float32Array, sampleRate: number): KeyInfo {
  const chroma = computeChroma(samples, sampleRate);
  return correlateProfiles(chroma);
}

/**
 * Computes a 12-bin chroma vector by summing energy at A4=440Hz-relative
 * pitch class frequencies across the lower 4 octaves. Very rough but cheap.
 */
function computeChroma(samples: Float32Array, sampleRate: number): Float32Array {
  const chroma = new Float32Array(12);
  // Use blocks of ~93ms (4096 @44100), step 46ms (2048).
  const block = 4096;
  const step = 2048;
  const window = hann(block);

  const referenceFreqs: number[] = [];
  for (let pc = 0; pc < 12; pc++) {
    // 4 octaves starting at C3 (130.81Hz)
    const startMidi = 48 + pc; // C3=48
    for (let oct = 0; oct < 4; oct++) {
      const midi = startMidi + oct * 12;
      const freq = REF_A4 * Math.pow(2, (midi - 69) / 12);
      referenceFreqs.push(freq);
    }
  }

  // Frequencies array ordered as 12 pitch classes × 4 octaves
  const freqByPc: number[][] = Array.from({ length: 12 }, () => []);
  for (let pc = 0; pc < 12; pc++) {
    for (let oct = 0; oct < 4; oct++) {
      freqByPc[pc].push(referenceFreqs[pc * 4 + oct]);
    }
  }

  const buffer = new Float32Array(block);
  for (let off = 0; off + block < samples.length; off += step) {
    for (let i = 0; i < block; i++) buffer[i] = samples[off + i] * window[i];
    for (let pc = 0; pc < 12; pc++) {
      let energy = 0;
      for (const f of freqByPc[pc]) {
        energy += goertzelMag(buffer, sampleRate, f);
      }
      chroma[pc] += energy;
    }
  }
  // Normalize
  let max = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
  if (max > 0) for (let i = 0; i < 12; i++) chroma[i] /= max;
  return chroma;
}

function correlateProfiles(chroma: Float32Array): KeyInfo {
  let bestScore = -Infinity;
  let bestRoot = 0;
  let bestScale: Scale = 'major';

  for (let shift = 0; shift < 12; shift++) {
    const majorScore = correlate(chroma, MAJOR_PROFILE, shift);
    const minorScore = correlate(chroma, MINOR_PROFILE, shift);
    if (majorScore > bestScore) {
      bestScore = majorScore;
      bestRoot = shift;
      bestScale = 'major';
    }
    if (minorScore > bestScore) {
      bestScore = minorScore;
      bestRoot = shift;
      bestScale = 'minor';
    }
  }
  // Compute confidence as how much better the best is vs the runner-up
  const others: number[] = [];
  for (let shift = 0; shift < 12; shift++) {
    others.push(correlate(chroma, MAJOR_PROFILE, shift));
    others.push(correlate(chroma, MINOR_PROFILE, shift));
  }
  others.sort((a, b) => b - a);
  const runnerUp = others[1] ?? 0;
  const confidence = Math.max(0, Math.min(1, (bestScore - runnerUp) * 2));
  const root = NOTE_NAMES[bestRoot];

  return {
    root,
    scale: bestScale,
    camelot: toCamelot(root, bestScale),
    confidence,
  };
}

function correlate(chroma: Float32Array, profile: number[], shift: number): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < 12; i++) {
    const c = chroma[(i + shift) % 12];
    dot += c * profile[i];
    normA += c * c;
    normB += profile[i] * profile[i];
  }
  return dot / Math.max(1e-9, Math.sqrt(normA * normB));
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

/**
 * Goertzel algorithm — magnitude at a single frequency, O(N).
 */
function goertzelMag(samples: Float32Array, sampleRate: number, freq: number): number {
  const n = samples.length;
  const k = Math.round((n * freq) / sampleRate);
  const omega = (2 * Math.PI * k) / n;
  const cosw = Math.cos(omega);
  const coeff = 2 * cosw;
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  for (let i = 0; i < n; i++) {
    q0 = coeff * q1 - q2 + samples[i];
    q2 = q1;
    q1 = q0;
  }
  const real = q1 - q2 * cosw;
  const imag = q2 * Math.sin(omega);
  return Math.sqrt(real * real + imag * imag);
}
