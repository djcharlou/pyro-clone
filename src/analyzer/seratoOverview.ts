/**
 * Serato Overview GEOB — the compact 16-band waveform Serato renders in the
 * track's overview strip.
 *
 * Layout (from reverse-engineered docs):
 *   header (2 bytes): 01 05
 *   240 timesteps × 16 bytes each = 3840 bytes
 *   → 3842 bytes total
 *
 * Each of the 16 bytes at a timestep is the amplitude of one frequency band
 * for that slice of the track (0..255, log-compressed).
 *
 * Bands are log-spaced from ~40 Hz to Nyquist so bass lives in a few low
 * bands and treble spreads across the upper ones, matching what Serato's
 * own overviews look like.
 */

import { fftReal, hann, magnitude } from './fft';

const NUM_COLS = 240;
const NUM_BANDS = 16;
const FFT_SIZE = 1024;

export function computeSeratoOverview(mono: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(2 + NUM_COLS * NUM_BANDS);
  out[0] = 0x01;
  out[1] = 0x05;

  if (mono.length < FFT_SIZE) return out;

  // Log-spaced band edges: 40 Hz → Nyquist
  const nyquist = sampleRate / 2;
  const bandEdgesHz = new Array<number>(NUM_BANDS + 1);
  for (let b = 0; b <= NUM_BANDS; b++) {
    const t = b / NUM_BANDS;
    bandEdgesHz[b] = 40 * Math.pow(nyquist / 40, t);
  }
  const binEdges = bandEdgesHz.map((f) => Math.min(FFT_SIZE / 2, Math.max(1, Math.floor((f * FFT_SIZE) / sampleRate))));

  const samplesPerCol = Math.floor(mono.length / NUM_COLS);
  const win = hann(FFT_SIZE);
  const buf = new Float32Array(FFT_SIZE);

  // Pass 1: compute raw band energies for every column, find max for normalization.
  const raw = new Float32Array(NUM_COLS * NUM_BANDS);
  let globalMax = 0;

  for (let c = 0; c < NUM_COLS; c++) {
    const colStart = c * samplesPerCol;
    // Overlapping FFTs within the column, averaged. If the column is smaller
    // than an FFT frame, we take a single frame anchored to its start.
    const nFft = Math.max(1, Math.floor(samplesPerCol / (FFT_SIZE / 2)));
    const bandMags = new Float32Array(NUM_BANDS);
    let framesUsed = 0;

    for (let k = 0; k < nFft; k++) {
      const off = colStart + k * (FFT_SIZE / 2);
      if (off + FFT_SIZE > mono.length) break;
      for (let i = 0; i < FFT_SIZE; i++) buf[i] = mono[off + i] * win[i];
      const spec = fftReal(buf);
      const mag = magnitude(spec);
      for (let b = 0; b < NUM_BANDS; b++) {
        let sum = 0;
        const from = binEdges[b];
        const to = binEdges[b + 1];
        for (let i = from; i < to; i++) sum += mag[i];
        // per-bin average keeps a wide band from dominating over a narrow one
        bandMags[b] += sum / Math.max(1, to - from);
      }
      framesUsed++;
    }
    if (framesUsed > 0) {
      for (let b = 0; b < NUM_BANDS; b++) bandMags[b] /= framesUsed;
    }
    for (let b = 0; b < NUM_BANDS; b++) {
      // log compression matches the perceived scale better than raw magnitude
      const v = Math.log1p(bandMags[b] * 50);
      raw[c * NUM_BANDS + b] = v;
      if (v > globalMax) globalMax = v;
    }
  }

  // Pass 2: normalize to 0..255. Leave a small headroom (0.95) so a genuine
  // peak reaches 255 without clipping mid-mag values downward.
  const scale = globalMax > 0 ? 255 / (globalMax * 0.95) : 0;
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i] * scale;
    out[2 + i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }
  return out;
}
