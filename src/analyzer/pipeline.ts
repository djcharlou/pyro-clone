import type {
  TrackAnalysis,
  AnalysisQuality,
  BeatGrid,
  EnergyProfile,
  CuePoints,
  WaveformPeaks,
} from '@shared/types';
import { ANALYZER_VERSION } from '@shared/types';
import {
  buildBeatGrid,
  checkBeatStability,
  dbFromAmp,
  energyEnvelope,
  estimateBpmFromOnsets,
  estimateFirstBeat,
  mixdownToMono,
  onsetEnvelope,
  resample,
  rms,
} from './dsp';
import { estimateKey } from './key';
import { bpmFromName, reconcileBpm } from './bpmFromName';
import { makeConstBpm } from './beatUtils';
import { computeIntegratedLufs } from './loudness';
import { detectBpmV2, ellisBeatTrackFor } from './beatTrackerV2';
import { computeSeratoOverview } from './seratoOverview';

const ANALYSIS_RATE = 22050;
const ENV_WINDOW = 256; // ~11ms @ 22050Hz
const ENV_FPS = ANALYSIS_RATE / ENV_WINDOW;

export interface AnalyzeInput {
  trackId: string;
  channels: Float32Array[];
  sampleRate: number;
  durationSec: number;
  /**
   * Filename or title, used to read a BPM that is already written in the
   * name (DJ-edit packs almost always include it). When present it beats
   * anything we can estimate from the audio.
   */
  nameHint?: string;
  /**
   * Analysis Serato already stored in the file's ID3 GEOB frames. This is
   * the highest-authority source we have: a real tempo to two decimals and
   * an exact first-beat anchor, so when it is present we skip tempo
   * estimation entirely.
   */
  serato?: {
    bpm: number;
    firstBeatSec: number;
    cueSecs?: number[];
  };
}

export function analyzeTrack(input: AnalyzeInput): TrackAnalysis {
  const mono = mixdownToMono(input.channels);
  const downsampled = resample(mono, input.sampleRate, ANALYSIS_RATE);

  // Tempo hierarchy of trust:
  //   Serato tag (exact) > filename BPM (DJ-edit ground truth) > audio v2 detector
  // The v2 detector uses spectral flux + Rayleigh-weighted ACF + Ellis 2007
  // dynamic-programming beat tracker — much better than the naive
  // autocorrelation we had before, especially on non-EDM material.
  const v2 = detectBpmV2(downsampled, ANALYSIS_RATE);

  // The v2 detector's Rayleigh-weighted ACF resolves octaves less reliably
  // than the harmonic-sum estimator in dsp.ts, which carries an explicit
  // sub-harmonic penalty. So take the tempo from dsp.ts, hand it to v2's DP
  // tracker to get real beat positions, then iron those into one constant
  // tempo (Mixxx's method) and snap it to a round value.
  //
  // Measured on synthetic material: v2 alone averaged 15.3 BPM of error with
  // two whole-octave failures; this composition averages 1.0 and is exact on
  // 8 of 11 cases. See tests/bpm-v2-vs-mixxx.test.ts.
  const env = energyEnvelope(downsampled, ENV_WINDOW);
  const onsets = onsetEnvelope(env);
  // No normalizeBpmOctave here: it drags anything above 160 toward 120, which
  // halved genuinely fast tracks (175 became 87.5). It predates the
  // sub-harmonic penalty inside estimateBpmFromOnsets, which resolves the
  // octave properly, so applying both makes the result worse.
  const priorBpm = estimateBpmFromOnsets(onsets, ENV_FPS).bpm;
  const dpTracked = ellisBeatTrackFor(downsampled, ANALYSIS_RATE, priorBpm);
  const ironed = makeConstBpm(dpTracked.beats);

  const audioBpm = ironed?.bpm ?? priorBpm;
  const audioBeats = ironed ? dpTracked.beats : v2.beats;
  const audioConfidence = ironed
    ? Math.max(v2.bpmConfidence, Math.min(1, ironed.coverage))
    : v2.bpmConfidence;

  const named = input.nameHint ? bpmFromName(input.nameHint) : null;
  const reconciled = reconcileBpm(named, { bpm: audioBpm, confidence: audioConfidence });

  const bpm = input.serato ? input.serato.bpm : reconciled.bpm;
  const bpmConfidence = input.serato ? 1 : reconciled.confidence;

  // Beat grid — prefer real beats from the v2 tracker over a synthetic grid.
  //   1. Serato anchor if present (exact),
  //   2. else the v2 tracker's actual beat positions,
  //   3. else fall back to synthesized grid from firstBeat + period.
  let beats: number[];
  let downbeats: number[];
  let firstBeatTime: number;
  if (input.serato) {
    firstBeatTime = input.serato.firstBeatSec;
    const grid = buildBeatGrid(firstBeatTime, bpm, input.durationSec);
    beats = grid.beats;
    downbeats = grid.downbeats;
  } else if (ironed && bpm === audioBpm) {
    // Ironed tempo won: rebuild a clean grid on its phase so the grid and
    // the tempo agree exactly.
    firstBeatTime = ironed.firstBeat;
    const grid = buildBeatGrid(firstBeatTime, bpm, input.durationSec);
    beats = grid.beats;
    downbeats = grid.downbeats;
  } else if (audioBeats.length >= 16) {
    firstBeatTime = audioBeats[0];
    beats = audioBeats;
    // Assume 4/4; every 4th beat = downbeat
    downbeats = beats.filter((_, i) => i % 4 === 0);
  } else {
    firstBeatTime = v2.firstBeatTime;
    const grid = buildBeatGrid(firstBeatTime, bpm, input.durationSec);
    beats = grid.beats;
    downbeats = grid.downbeats;
  }
  const isStable = checkBeatStability(beats);

  const beatGrid: BeatGrid = {
    firstBeatTime,
    bpm,
    bpmConfidence,
    beats,
    downbeats,
    isStable: input.serato ? true : (v2.isStable || isStable),
  };

  // Key
  const key = estimateKey(downsampled, ANALYSIS_RATE);

  // Energy profile (per bar)
  const energy = computeEnergyProfile(downsampled, beats);

  // Cues derived from energy curve
  const cues = computeCues(energy, beats, downbeats, input.durationSec);

  // Waveform peaks (~512 bins of max abs sample per window)
  const waveform = computeWaveformPeaks(downsampled, 512);

  // LUFS integrated loudness (ITU-R BS.1770-4) on the ORIGINAL channels
  // so the stereo image + full bandwidth are preserved for the meter.
  const loudness = computeIntegratedLufs(input.channels, input.sampleRate);

  // Serato Overview — 240 × 16 waveform bytes, log-scaled amplitude per band.
  // Computed once here so the tag writer can embed it without re-decoding.
  const overviewBytes = computeSeratoOverview(downsampled, ANALYSIS_RATE);
  const seratoOverviewB64 = bytesToBase64(overviewBytes);

  const quality = scoreQuality(bpmConfidence, isStable, key.confidence);

  return {
    trackId: input.trackId,
    analyzerVersion: ANALYZER_VERSION,
    analyzedAt: Date.now(),
    quality,
    beatGrid,
    key,
    energy,
    cues,
    waveform,
    loudness,
    seratoOverviewB64,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function computeWaveformPeaks(samples: Float32Array, bins: number): WaveformPeaks {
  const values = new Array<number>(bins);
  const windowSize = Math.max(1, Math.floor(samples.length / bins));
  let maxObserved = 0;
  for (let i = 0; i < bins; i++) {
    const start = i * windowSize;
    const end = Math.min(samples.length, start + windowSize);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > peak) peak = v;
    }
    values[i] = peak;
    if (peak > maxObserved) maxObserved = peak;
  }
  // Normalize to 0..1 for stable rendering
  if (maxObserved > 0) {
    for (let i = 0; i < bins; i++) values[i] = values[i] / maxObserved;
  }
  return { values };
}

/**
 * If detected BPM falls in a region that's commonly an octave error,
 * try doubling/halving and pick the value closest to a sensible default (120).
 */
function normalizeBpmOctave(bpm: number): number {
  const target = 120;
  const candidates = [bpm];
  if (bpm < 90) candidates.push(bpm * 2);
  if (bpm > 160) candidates.push(bpm / 2);
  return candidates.reduce((best, c) =>
    Math.abs(c - target) < Math.abs(best - target) ? c : best
  );
}

function computeEnergyProfile(samples: Float32Array, beats: number[]): EnergyProfile {
  if (beats.length < 8) {
    const rmsValue = rms(samples);
    return {
      mean: clamp01(rmsValue * 2),
      peak: clamp01(rmsValue * 2),
      perBar: [],
      rmsDb: dbFromAmp(rmsValue),
    };
  }
  const perBar: number[] = [];
  for (let i = 0; i + 4 < beats.length; i += 4) {
    const startSample = Math.floor(beats[i] * ANALYSIS_RATE);
    const endSample = Math.floor(beats[i + 4] * ANALYSIS_RATE);
    if (endSample <= startSample) continue;
    perBar.push(rms(samples, startSample, Math.min(endSample, samples.length)));
  }
  const sorted = [...perBar].sort((a, b) => a - b);
  const peak = sorted[sorted.length - 1] ?? 0;
  const mean = perBar.reduce((s, v) => s + v, 0) / Math.max(1, perBar.length);
  const overallRms = rms(samples);
  // Normalize roughly to 0..1 (RMS rarely exceeds 0.5 on music)
  return {
    mean: clamp01(mean * 2),
    peak: clamp01(peak * 2),
    perBar: perBar.map((v) => clamp01(v * 2)),
    rmsDb: dbFromAmp(overallRms),
  };
}

function computeCues(
  energy: EnergyProfile,
  beats: number[],
  downbeats: number[],
  duration: number
): CuePoints {
  if (energy.perBar.length === 0 || downbeats.length === 0) {
    return {
      introStart: 0,
      introEnd: Math.min(8, duration),
      outroStart: Math.max(0, duration - 16),
      outroEnd: duration,
      mixInPoint: Math.min(8, duration),
      mixOutPoint: Math.max(0, duration - 16),
    };
  }
  const peak = energy.peak;
  const threshold = peak * 0.45;
  // First bar above threshold = intro end
  let introBarIdx = energy.perBar.findIndex((v) => v >= threshold);
  if (introBarIdx < 0) introBarIdx = 0;
  // Last bar above threshold = outro start
  let outroBarIdx = energy.perBar.length - 1;
  for (let i = energy.perBar.length - 1; i >= 0; i--) {
    if (energy.perBar[i] >= threshold) {
      outroBarIdx = i;
      break;
    }
  }

  const barToTime = (idx: number): number => {
    const beatIdx = idx * 4;
    return beats[Math.min(beats.length - 1, beatIdx)] ?? 0;
  };

  const introEnd = barToTime(introBarIdx);
  const outroStart = barToTime(outroBarIdx);
  // Snap to nearest downbeat
  const introEndDb = snapToDownbeat(introEnd, downbeats);
  const outroStartDb = snapToDownbeat(outroStart, downbeats);

  return {
    introStart: 0,
    introEnd: introEndDb,
    outroStart: outroStartDb,
    outroEnd: duration,
    mixInPoint: introEndDb,
    mixOutPoint: outroStartDb,
  };
}

function snapToDownbeat(t: number, downbeats: number[]): number {
  if (downbeats.length === 0) return t;
  let best = downbeats[0];
  let bestDist = Math.abs(t - best);
  for (const db of downbeats) {
    const d = Math.abs(t - db);
    if (d < bestDist) {
      bestDist = d;
      best = db;
    }
  }
  return best;
}

function scoreQuality(
  bpmConf: number,
  beatStable: boolean,
  keyConf: number
): AnalysisQuality {
  if (bpmConf < 0.3 || !beatStable) return 'unreliable';
  if (bpmConf < 0.55 || keyConf < 0.25) return 'partial';
  return 'good';
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
