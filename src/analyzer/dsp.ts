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
  minBpm = 60,
  maxBpm = 200
): { bpm: number; confidence: number } {
  const minLag = Math.max(2, Math.floor((60 / maxBpm) * envFps));
  const maxLag = Math.ceil((60 / minBpm) * envFps);
  if (maxLag >= onsets.length) {
    return { bpm: 120, confidence: 0 };
  }

  // --- Normalised autocorrelation ----------------------------------------
  // Dividing by the overlap length stops long lags from being penalised
  // simply for having fewer terms in the sum.
  const acf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const n = onsets.length - lag;
    for (let i = 0; i < n; i++) sum += onsets[i] * onsets[i + lag];
    acf[lag] = n > 0 ? sum / n : 0;
  }

  // --- Harmonic scoring ---------------------------------------------------
  // A true beat period P also shows energy at 2P, 3P and 4P. Scoring each
  // candidate by its own peak PLUS its multiples makes the fundamental beat
  // the winner instead of a random subdivision, which is what produced the
  // "81 BPM track detected as 157" class of error.
  const HARMONIC_WEIGHTS = [1, 0.5, 0.33, 0.25];
  const score = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let h = 0; h < HARMONIC_WEIGHTS.length; h++) {
      const l = Math.round(lag * (h + 1));
      if (l > maxLag) break;
      s += HARMONIC_WEIGHTS[h] * acf[l];
    }

    // Sub-harmonic penalty. A candidate at twice the true period (half
    // tempo) sees every real beat as one of its own harmonics, so pure
    // harmonic summation ties with the fundamental. The tell is that the
    // HALF of a half-tempo candidate still lands on strong beats, whereas
    // the half of the true period lands between them. Divide the score by
    // how much energy sits at lag/2 to break that tie toward the faster,
    // correct pulse.
    const halfLag = Math.round(lag / 2);
    if (halfLag >= minLag) {
      const selfPeak = Math.max(1e-9, acf[lag]);
      const halfRatio = acf[halfLag] / selfPeak;
      // halfRatio ≈ 1 → we are on a sub-harmonic; ≈ 0 → true fundamental.
      s /= 1 + 1.6 * Math.max(0, halfRatio);
    }

    // Gentle log-normal prior centred on 125 BPM. Dance/DJ material clusters
    // there, and this only breaks ties — it cannot move a strong peak by an
    // octave on its own.
    const bpmHere = (60 * envFps) / lag;
    const prior = Math.exp(-Math.pow(Math.log(bpmHere / 125), 2) / (2 * 0.35 * 0.35));
    score[lag] = s * (0.75 + 0.25 * prior);
  }

  let peakLag = minLag;
  let peakVal = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (score[lag] > peakVal) {
      peakVal = score[lag];
      peakLag = lag;
    }
  }

  // --- Sub-frame refinement ----------------------------------------------
  // The lag grid is coarse: at 128 BPM and ~86 fps the period is ~40 frames,
  // so integer lags quantise the answer to ±1.6 BPM. Fitting a parabola
  // through the peak and its neighbours recovers the true maximum.
  const refinedLag = parabolicPeak(score, peakLag, minLag, maxLag);
  const bpm = (60 * envFps) / refinedLag;

  // --- Confidence ---------------------------------------------------------
  // Prominence of the winning peak over the median of the score curve.
  const window: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) window.push(score[lag]);
  window.sort((a, b) => a - b);
  const median = window[Math.floor(window.length / 2)] || 1e-9;
  const prominence = peakVal / Math.max(1e-9, median);
  const confidence = clamp01((prominence - 1) / 4);

  return { bpm, confidence };
}

/**
 * Parabolic interpolation around a discrete maximum.
 * Returns a fractional index; falls back to the integer peak at the edges
 * or when the three points do not form a peak.
 */
function parabolicPeak(
  data: Float32Array,
  peak: number,
  lo: number,
  hi: number
): number {
  if (peak <= lo || peak >= hi) return peak;
  const yPrev = data[peak - 1];
  const yHere = data[peak];
  const yNext = data[peak + 1];
  const denom = yPrev - 2 * yHere + yNext;
  if (denom === 0 || !Number.isFinite(denom)) return peak;
  const delta = (0.5 * (yPrev - yNext)) / denom;
  // A well-formed peak has |delta| <= 0.5; anything larger means we are on a
  // slope, not a maximum, so keep the integer lag.
  if (!Number.isFinite(delta) || Math.abs(delta) > 0.5) return peak;
  return peak + delta;
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
