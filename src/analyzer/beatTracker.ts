/**
 * Locate individual beat positions, given a tempo estimate as a prior.
 *
 * The autocorrelation estimator answers "how fast" but not "where"; it
 * returns one global tempo and a single phase. That is enough to draw a
 * rigid grid, but a rigid grid drifts away from any track that is not
 * machine-perfect, and it gives Mixxx's constant-region ironing nothing to
 * work with.
 *
 * So: predict where each beat should fall, then snap the prediction to the
 * nearest real onset peak within a tolerance window. The result is a list of
 * observed beat times that follows the audio, which the ironing stage can
 * then turn back into a clean tempo.
 */

export interface TrackedBeats {
  /** Observed beat positions in seconds. */
  beats: number[];
  /** Fraction of predicted beats that landed on a real onset peak. */
  hitRate: number;
}

/**
 * @param onsets     Onset-strength envelope.
 * @param envFps     Envelope frames per second.
 * @param bpm        Tempo prior.
 * @param firstBeat  Phase prior, in seconds.
 * @param durationSec Track length.
 */
export function trackBeats(
  onsets: Float32Array,
  envFps: number,
  bpm: number,
  firstBeat: number,
  durationSec: number
): TrackedBeats {
  if (!Number.isFinite(bpm) || bpm <= 0 || onsets.length === 0) {
    return { beats: [], hitRate: 0 };
  }

  const beatPeriod = 60 / bpm;
  // Search ±12% of a beat around each prediction. Wide enough to follow a
  // human performance, tight enough that it cannot lock onto the neighbouring
  // beat and halve the tempo.
  const windowSec = beatPeriod * 0.12;
  const windowFrames = Math.max(1, Math.round(windowSec * envFps));

  const beats: number[] = [];
  let hits = 0;
  let predicted = firstBeat;
  // Track the running interval so the grid can follow a gradual tempo drift
  // instead of accumulating error against a fixed period.
  let interval = beatPeriod;

  while (predicted < durationSec) {
    const centerFrame = Math.round(predicted * envFps);
    const lo = Math.max(0, centerFrame - windowFrames);
    const hi = Math.min(onsets.length - 1, centerFrame + windowFrames);

    let peakFrame = -1;
    let peakValue = 0;
    for (let f = lo; f <= hi; f++) {
      if (onsets[f] > peakValue) {
        peakValue = onsets[f];
        peakFrame = f;
      }
    }

    let observed: number;
    if (peakFrame >= 0 && peakValue > 0) {
      // Parabolic interpolation puts the beat between frames rather than on
      // the 11ms envelope grid.
      observed = refinePeak(onsets, peakFrame) / envFps;
      hits++;
      if (beats.length > 0) {
        const measured = observed - beats[beats.length - 1];
        // Ease the running interval toward what we just measured, ignoring
        // measurements that are implausible for a single beat.
        if (measured > beatPeriod * 0.7 && measured < beatPeriod * 1.3) {
          interval = interval * 0.85 + measured * 0.15;
        }
      }
    } else {
      // Silence or a gap: keep the grid running on the current interval.
      observed = predicted;
    }

    beats.push(observed);
    predicted = observed + interval;
  }

  return { beats, hitRate: beats.length ? hits / beats.length : 0 };
}

/** Sub-frame peak position via parabolic interpolation. */
function refinePeak(data: Float32Array, peak: number): number {
  if (peak <= 0 || peak >= data.length - 1) return peak;
  const a = data[peak - 1];
  const b = data[peak];
  const c = data[peak + 1];
  const denom = a - 2 * b + c;
  if (denom === 0 || !Number.isFinite(denom)) return peak;
  const delta = (0.5 * (a - c)) / denom;
  return Math.abs(delta) <= 0.5 ? peak + delta : peak;
}
