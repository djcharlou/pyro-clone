/**
 * Small DSP helpers used by the pure-JS analyzer.
 * Kept dependency-free so it works in both main thread and Web Workers.
 */

export function mixdownToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  const inv = 1 / channels.length;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) sum += channels[c][i];
    out[i] = sum * inv;
  }
  return out;
}

/**
 * Naive linear-interpolation resampler. Good enough for analysis only.
 */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const frac = x - i0;
    const a = input[i0];
    const b = input[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

export function rms(samples: Float32Array, start = 0, end?: number): number {
  const e = end ?? samples.length;
  let sum = 0;
  for (let i = start; i < e; i++) sum += samples[i] * samples[i];
  const n = e - start;
  return Math.sqrt(sum / Math.max(1, n));
}

export function dbFromAmp(amp: number): number {
  return 20 * Math.log10(Math.max(1e-9, amp));
}

/**
 * Energy envelope (RMS per fixed-size window).
 */
export function energyEnvelope(samples: Float32Array, windowSize: number): Float32Array {
  const out = new Float32Array(Math.floor(samples.length / windowSize));
  for (let i = 0; i < out.length; i++) {
    out[i] = rms(samples, i * windowSize, (i + 1) * windowSize);
  }
  return out;
}

/**
 * Spectral-flux-ish onset envelope (cheap version using positive energy diff).
 * Returns one value per envelope frame.
 */
export function onsetEnvelope(envelope: Float32Array): Float32Array {
  const out = new Float32Array(envelope.length);
  for (let i = 1; i < envelope.length; i++) {
    const d = envelope[i] - envelope[i - 1];
    out[i] = d > 0 ? d : 0;
  }
  return out;
}

/**
 * Autocorrelation-based BPM estimator on an onset envelope.
 * - envFps is the envelope sample-rate (frames per second)
 * - returns { bpm, confidence } with bpm in [minBpm, maxBpm]
 */
export function estimateBpmFromOnsets(
  onsets: Float32Array,
  envFps: number,
  minBpm = 70,
  maxBpm = 180
): { bpm: number; confidence: number } {
  const minLag = Math.floor((60 / maxBpm) * envFps);
  const maxLag = Math.ceil((60 / minBpm) * envFps);
  const acf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < onsets.length; i++) {
      sum += onsets[i] * onsets[i + lag];
    }
    acf[lag] = sum;
  }
  // Find peak
  let peakLag = minLag;
  let peakVal = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (acf[lag] > peakVal) {
      peakVal = acf[lag];
      peakLag = lag;
    }
  }
  // Confidence: peak prominence vs mean of ACF
  let meanAcf = 0;
  for (let lag = minLag; lag <= maxLag; lag++) meanAcf += acf[lag];
  meanAcf /= (maxLag - minLag + 1);
  const confidence = clamp01((peakVal / Math.max(1e-9, meanAcf) - 1) / 3);

  const bpm = (60 * envFps) / peakLag;
  return { bpm, confidence };
}

/**
 * Given an onset envelope and target BPM, locate the most likely first beat
 * by sliding a comb pattern.
 */
export function estimateFirstBeat(
  onsets: Float32Array,
  bpm: number,
  envFps: number,
  searchWindowSec = 4
): number {
  const beatPeriodFrames = (60 / bpm) * envFps;
  const searchFrames = Math.min(onsets.length, Math.floor(searchWindowSec * envFps));
  let bestPhase = 0;
  let bestScore = -Infinity;
  const N_BEATS = 16;
  for (let phase = 0; phase < searchFrames; phase++) {
    let s = 0;
    for (let k = 0; k < N_BEATS; k++) {
      const idx = Math.round(phase + k * beatPeriodFrames);
      if (idx >= onsets.length) break;
      s += onsets[idx];
    }
    if (s > bestScore) {
      bestScore = s;
      bestPhase = phase;
    }
  }
  return bestPhase / envFps;
}

export function buildBeatGrid(
  firstBeatSec: number,
  bpm: number,
  durationSec: number
): { beats: number[]; downbeats: number[] } {
  const period = 60 / bpm;
  const beats: number[] = [];
  const downbeats: number[] = [];
  let t = firstBeatSec;
  let i = 0;
  while (t < durationSec) {
    beats.push(t);
    if (i % 4 === 0) downbeats.push(t);
    t += period;
    i++;
  }
  return { beats, downbeats };
}

export function checkBeatStability(beats: number[]): boolean {
  if (beats.length < 8) return false;
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
  const stdev = Math.sqrt(variance);
  return stdev / mean < 0.05;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
