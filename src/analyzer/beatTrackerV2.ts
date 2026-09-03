/**
 * BPM & beat detector v2 — spectral-flux onset + Rayleigh-weighted ACF
 * + Ellis 2007 dynamic-programming beat tracker.
 *
 * References
 *   Ellis, D. "Beat Tracking by Dynamic Programming" (2007)
 *   Böck, S. "Enhanced Beat Tracking with Context-Aware Neural Networks"
 *   Klapuri et al. "Analysis of the meter of acoustic musical signals"
 *
 * Steps
 *   1. Downmix + resample to 22.05 kHz (caller's job).
 *   2. STFT with 1024 window / 512 hop → magnitude spectrogram.
 *   3. Spectral flux = sum over bins of max(0, mag[t] - mag[t-1]).
 *      Half-wave rectified, log-compressed for dynamic range.
 *   4. Local-mean normalize the onset envelope so a quiet passage
 *      doesn't kill the beat.
 *   5. Autocorrelate the onset envelope over lags 60..200 BPM.
 *      Weight ACF by a Rayleigh prior centered at 120 BPM — kills
 *      the 60/240 octave ties that our naive detector guessed on.
 *   6. Peak-pick top tempo candidates (best + 2×/½× as sanity checks).
 *   7. Ellis DP beat tracker: for each candidate tempo, find beat
 *      sequence that jointly maximizes (onset strength at beats)
 *      + (smoothness of inter-beat intervals). Pick candidate with
 *      highest DP score.
 *   8. Refine BPM from median of adjacent beat intervals.
 */

import { fftReal, hann, magnitude, nextPow2 } from './fft';

export interface BeatTrackResult {
  bpm: number;
  bpmConfidence: number;
  beats: number[];        // seconds
  firstBeatTime: number;  // seconds
  isStable: boolean;
}

const FFT_WIN = 1024;
// 256 at 22.05 kHz gives an 11.6 ms envelope step. The previous 512 gave
// 23 ms, which quantised beat positions coarsely enough that a median of
// inter-beat intervals landed a whole BPM off (a 128 track measured 129.2),
// and blew the 25 ms constant-region tolerance on anything but perfect
// material. Twice the FFTs, but this is offline analysis.
const FFT_HOP = 256;
const MIN_BPM = 60;
const MAX_BPM = 200;
const RAYLEIGH_CENTER_BPM = 120;

export function detectBpmV2(mono: Float32Array, sampleRate: number): BeatTrackResult {
  const envFps = sampleRate / FFT_HOP;
  const onset = spectralFluxEnvelope(mono);
  const normOnset = localMeanNormalize(onset, Math.floor(envFps * 4));

  const { bpm, confidence, candidates } = tempoFromEnvelope(normOnset, envFps);

  // Try DP beat tracker on the top candidate; if it scores poorly, fall
  // back to the 2×/½× candidates.
  let best: { bpm: number; beats: number[]; score: number } | null = null;
  for (const cand of [bpm, ...candidates].slice(0, 3)) {
    const tracked = ellisBeatTrack(normOnset, envFps, cand);
    if (!best || tracked.score > best.score) {
      best = { bpm: cand, beats: tracked.beats, score: tracked.score };
    }
  }
  const beats = best?.beats ?? [];
  const refinedBpm = refineBpmFromBeats(beats) ?? bpm;
  const firstBeatTime = beats[0] ?? estimateFirstBeat(normOnset, envFps, refinedBpm);
  const isStable = checkBeatStability(beats);

  return {
    bpm: refinedBpm,
    bpmConfidence: confidence,
    beats,
    firstBeatTime,
    isStable,
  };
}

/* ---- Onset envelope via spectral flux -------------------------------- */

function spectralFluxEnvelope(mono: Float32Array): Float32Array {
  const N = FFT_WIN;
  const H = FFT_HOP;
  const win = hann(N);
  const numFrames = Math.max(0, Math.floor((mono.length - N) / H));
  const flux = new Float32Array(numFrames);
  let prev: Float32Array | null = null;
  const buf = new Float32Array(N);
  for (let f = 0; f < numFrames; f++) {
    const off = f * H;
    for (let i = 0; i < N; i++) buf[i] = mono[off + i] * win[i];
    const spec = fftReal(buf);
    const mag = magnitude(spec);
    // log compression flattens dynamic range so a quiet drop still contributes
    for (let i = 0; i < mag.length; i++) mag[i] = Math.log1p(mag[i] * 1000);
    if (prev) {
      let sum = 0;
      for (let i = 0; i < mag.length; i++) {
        const d = mag[i] - prev[i];
        if (d > 0) sum += d;
      }
      flux[f] = sum;
    }
    prev = mag.slice();
  }
  return flux;
}

function localMeanNormalize(env: Float32Array, windowFrames: number): Float32Array {
  const out = new Float32Array(env.length);
  const half = Math.max(1, Math.floor(windowFrames / 2));
  for (let i = 0; i < env.length; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(env.length, i + half);
    let mean = 0;
    for (let j = a; j < b; j++) mean += env[j];
    mean /= Math.max(1, b - a);
    out[i] = Math.max(0, env[i] - mean);
  }
  return out;
}

/* ---- Tempo from ACF ---------------------------------------------------- */

function tempoFromEnvelope(
  onset: Float32Array,
  envFps: number
): { bpm: number; confidence: number; candidates: number[] } {
  const minLag = Math.floor((60 / MAX_BPM) * envFps);
  const maxLag = Math.ceil((60 / MIN_BPM) * envFps);
  const acf = new Float32Array(maxLag + 1);

  // Un-normalized autocorrelation (fast enough for a 22 kHz envelope)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < onset.length; i++) s += onset[i] * onset[i + lag];
    acf[lag] = s;
  }

  // Rayleigh weighting centred around 120 BPM. Kills octave picks that
  // an unweighted ACF prefers on kick-heavy tracks.
  const rayleighCenterLag = (60 / RAYLEIGH_CENTER_BPM) * envFps;
  // sigma = centerLag/sqrt(2) is empirical, not the textbook mode. Setting
  // sigma to the centre lag itself (so the Rayleigh peaks there) measures
  // markedly worse — mean error 38 BPM against 15 — because this weight
  // multiplies an un-normalised ACF whose sums shrink with lag, and the two
  // biases have to offset each other. Swept the alternatives before keeping
  // this; see tests/bpm-v2-vs-mixxx.test.ts.
  const sigma = rayleighCenterLag / Math.sqrt(2);
  const weighted = new Float32Array(acf.length);
  for (let lag = minLag; lag <= maxLag; lag++) {
    const r = (lag / (sigma * sigma)) * Math.exp(-(lag * lag) / (2 * sigma * sigma));
    weighted[lag] = acf[lag] * r;
  }

  // Peak-pick the top 3 local maxima
  const peaks: Array<{ lag: number; score: number }> = [];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (weighted[lag] > weighted[lag - 1] && weighted[lag] > weighted[lag + 1]) {
      peaks.push({ lag, score: weighted[lag] });
    }
  }
  peaks.sort((a, b) => b.score - a.score);
  const top = peaks.slice(0, 5);

  if (top.length === 0) {
    return { bpm: 120, confidence: 0, candidates: [] };
  }

  const bpmOf = (lag: number): number => (60 * envFps) / lag;

  // Confidence = top peak height relative to mean weighted ACF
  let mean = 0;
  let count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    mean += weighted[lag];
    count++;
  }
  mean /= Math.max(1, count);
  const confidence = clamp01((top[0].score / Math.max(1e-9, mean) - 1) / 4);

  const candidates = top.slice(1).map((p) => bpmOf(p.lag));
  return { bpm: bpmOf(top[0].lag), confidence, candidates };
}

/* ---- Ellis DP beat tracker -------------------------------------------- */

const TIGHTNESS = 300; // higher = beats stick to expected interval more strictly

function ellisBeatTrack(
  onset: Float32Array,
  envFps: number,
  bpm: number
): { beats: number[]; score: number } {
  const period = (60 / bpm) * envFps; // in envelope frames
  const N = onset.length;
  const cumScore = new Float32Array(N);
  const backlink = new Int32Array(N);
  for (let i = 0; i < N; i++) backlink[i] = -1;

  // Look back between half a period and two periods for the previous beat.
  // Expressed as positive distances rather than signed offsets: the signed
  // form invited a Math.max(1, negative) clamp that collapsed the window to
  // a single frame and made the inner loop dead code.
  // Floor the gap between consecutive beats at 70% of the expected period.
  // At 50% the tracker could treat a straight off-beat hi-hat as a beat and
  // split one beat into two — measured as intervals like 546/267/279ms on
  // house-style material, which wrecked the constant-region analysis
  // downstream. Raising the floor forbids that structurally.
  const minBack = Math.max(1, Math.floor(0.7 * period));
  const maxBack = Math.max(minBack + 1, Math.ceil(2 * period));

  for (let t = 0; t < N; t++) {
    let bestPrev = -1;
    let bestScore = -Infinity;
    for (let back = minBack; back <= maxBack; back++) {
      const p = t - back;
      if (p < 0) break;
      const interval = back;
      // Transition cost — log-sq deviation from the ideal period
      const dev = Math.log(interval / period);
      const cost = TIGHTNESS * (dev * dev);
      const score = cumScore[p] - cost;
      if (score > bestScore) {
        bestScore = score;
        bestPrev = p;
      }
    }
    if (bestPrev < 0) {
      cumScore[t] = onset[t];
      backlink[t] = -1;
    } else {
      cumScore[t] = onset[t] + bestScore;
      backlink[t] = bestPrev;
    }
  }

  // Backtrace from the maximum cumulative score
  let endT = 0;
  let endS = -Infinity;
  // Only accept endpoints that are close to the end (last ~2 periods)
  const searchFrom = Math.max(0, N - Math.ceil(2 * period));
  for (let t = searchFrom; t < N; t++) {
    if (cumScore[t] > endS) {
      endS = cumScore[t];
      endT = t;
    }
  }
  const beatsFrames: number[] = [];
  let cur = endT;
  while (cur >= 0) {
    beatsFrames.push(cur);
    cur = backlink[cur];
  }
  beatsFrames.reverse();
  const beats = beatsFrames.map((fr) => fr / envFps);
  const score = beats.length > 0 ? endS / beats.length : -Infinity;
  return { beats, score };
}

/* ---- Refinement ------------------------------------------------------- */

function refineBpmFromBeats(beats: number[]): number | null {
  if (beats.length < 8) return null;
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  if (median <= 0) return null;
  const bpm = 60 / median;
  // Snap to nearest 0.01 BPM
  return Math.round(bpm * 100) / 100;
}

function checkBeatStability(beats: number[]): boolean {
  if (beats.length < 8) return false;
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
  const stdev = Math.sqrt(variance);
  return stdev / mean < 0.05;
}

function estimateFirstBeat(onset: Float32Array, envFps: number, bpm: number): number {
  const periodFrames = (60 / bpm) * envFps;
  const searchFrames = Math.min(onset.length, Math.floor(envFps * 4));
  const N_BEATS = 16;
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let phase = 0; phase < searchFrames; phase++) {
    let s = 0;
    for (let k = 0; k < N_BEATS; k++) {
      const idx = Math.round(phase + k * periodFrames);
      if (idx >= onset.length) break;
      s += onset[idx];
    }
    if (s > bestScore) {
      bestScore = s;
      bestPhase = phase;
    }
  }
  return bestPhase / envFps;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Run the DP beat tracker against a tempo decided elsewhere.
 *
 * The tempo estimator in dsp.ts resolves octaves more reliably than the
 * Rayleigh-weighted ACF here, so the pipeline pairs its tempo with this
 * tracker's beat positions rather than using either half alone.
 */
export function ellisBeatTrackFor(
  mono: Float32Array,
  sampleRate: number,
  bpm: number
): { beats: number[]; score: number; envFps: number } {
  const envFps = sampleRate / FFT_HOP;
  const onset = spectralFluxEnvelope(mono);
  const normOnset = localMeanNormalize(onset, Math.floor(envFps * 4));
  const tracked = ellisBeatTrack(normOnset, envFps, bpm);
  return { ...tracked, envFps };
}
