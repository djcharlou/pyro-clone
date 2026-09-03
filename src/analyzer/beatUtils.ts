/**
 * Tempo refinement, adapted from Mixxx's BeatUtils (GPL-2.0+,
 * mixxx-main/src/track/beatutils.cpp).
 *
 * Two ideas are worth taking from it:
 *
 * 1. Snapping. Produced music sits at a round tempo almost without
 *    exception, so an estimate of 128.66 is far more likely to be a
 *    128.00 track measured imperfectly than a genuine 128.66 track. If a
 *    round value falls inside the measurement's uncertainty band, it is
 *    the better answer.
 *
 * 2. Constant-region ironing. Individual beat detections jitter by a few
 *    milliseconds either side of the truth. Rather than averaging the whole
 *    track — which smears across any tempo change — Mixxx finds the longest
 *    stretch whose beat spacing is constant within tolerance and takes the
 *    tempo from there.
 */

/** A stretch of beats whose spacing is constant within tolerance. */
export interface ConstRegion {
  /** Seconds. */
  firstBeat: number;
  /** Seconds per beat; 0 marks the terminating sentinel region. */
  beatLength: number;
  /** Number of beats the region spans. */
  beatCount: number;
}

// Mixxx uses 25ms: comfortably above its detector's 12ms step and still
// inaudible as a phase error.
const MAX_PHASE_ERROR_SEC = 0.025;
// Guards against sitting inside a region while the phase steadily drifts,
// which means the assumed beat length is slightly wrong.
const MAX_PHASE_ERROR_SUM_SEC = 0.1;
const MAX_OUTLIERS = 1;
const MIN_REGION_BEATS = 16;
/**
 * Minimum share of the track the winning region must span for its tempo to
 * be trusted. Chosen from measurement: at and above this, ironing was exact
 * on every synthetic case; below it, the cases that failed were all tracks
 * with no single true tempo (drift, shuffle).
 */
const MIN_COVERAGE = 0.5;

/**
 * Snap `centerBpm` to a round tempo when one lies inside (minBpm, maxBpm).
 *
 * The ladder of denominators is Mixxx's: whole BPM first, then halves for
 * slow tracks, thirds for the 3/2 and 3/4 relationships, and finally
 * twelfths to catch the remaining common multipliers.
 */
export function roundBpmWithinRange(
  minBpm: number,
  centerBpm: number,
  maxBpm: number
): number {
  if (![minBpm, centerBpm, maxBpm].every((v) => Number.isFinite(v) && v > 0)) {
    return centerBpm;
  }

  const trySnap = (fraction: number): number | null => {
    const snapped = Math.round(centerBpm * fraction) / fraction;
    return snapped > minBpm && snapped < maxBpm ? snapped : null;
  };

  // Whole BPM.
  const whole = trySnap(1);
  if (whole !== null) return whole;

  // Halves, but only for slow tracks — at higher tempos other factors are
  // the more likely explanation.
  if (centerBpm < 85) {
    const half = trySnap(2);
    if (half !== null) return half;
  }

  // Two-thirds, for fast tracks that are really a 3/2 of something slower.
  if (centerBpm > 127) {
    const twoThirds = trySnap(2 / 3);
    if (twoThirds !== null) return twoThirds;
  }

  const third = trySnap(3);
  if (third !== null) return third;

  const twelfth = trySnap(12);
  if (twelfth !== null) return twelfth;

  return centerBpm;
}

/**
 * Uncertainty band around a tempo estimate, expressed as the range of
 * tempos that stay phase-locked to it for `beats` beats.
 *
 * A tempo error only matters once it has accumulated enough phase error to
 * be heard. Over N beats an error of Δbpm drifts by roughly
 * N·60·Δbpm/bpm², so inverting that at the audible threshold gives the
 * band inside which snapping is safe.
 */
export function bpmUncertaintyBand(
  bpm: number,
  beats = 32,
  toleranceSec = MAX_PHASE_ERROR_SEC
): { min: number; max: number } {
  if (!Number.isFinite(bpm) || bpm <= 0) return { min: bpm, max: bpm };
  const delta = (toleranceSec * bpm * bpm) / (beats * 60);
  return { min: bpm - delta, max: bpm + delta };
}

/**
 * Find stretches of beats whose spacing is constant within tolerance.
 *
 * Walks from the left, shrinking the right edge until the span between them
 * holds a single beat length to within the phase tolerance, then continues
 * from that right edge. A region is rejected when it drifts cumulatively,
 * when it has more than one outlier, or when its first and last intervals
 * both pull the mean the same way (which would bend it off the true tempo).
 */
export function retrieveConstRegions(beatsSec: number[]): ConstRegion[] {
  if (beatsSec.length < 2) return [];

  const regions: ConstRegion[] = [];
  let leftIndex = 0;
  let rightIndex = beatsSec.length - 1;

  while (leftIndex < beatsSec.length - 1) {
    const meanBeatLength =
      (beatsSec[rightIndex] - beatsSec[leftIndex]) / (rightIndex - leftIndex);

    let outliers = 0;
    let ironedBeat = beatsSec[leftIndex];
    let phaseErrorSum = 0;
    let i = leftIndex + 1;

    for (; i <= rightIndex; i++) {
      ironedBeat += meanBeatLength;
      const phaseError = ironedBeat - beatsSec[i];
      phaseErrorSum += phaseError;
      if (Math.abs(phaseError) > MAX_PHASE_ERROR_SEC) {
        outliers++;
        // The first beat anchors the region, so it may never be an outlier.
        if (outliers > MAX_OUTLIERS || i === leftIndex + 1) break;
      }
      if (Math.abs(phaseErrorSum) > MAX_PHASE_ERROR_SUM_SEC) break;
    }

    if (i > rightIndex) {
      // Reject regions whose first and last intervals are both correction
      // beats in the same direction — they would skew the mean.
      let borderError = 0;
      if (rightIndex > leftIndex + 2) {
        const firstLen = beatsSec[leftIndex + 1] - beatsSec[leftIndex];
        const lastLen = beatsSec[rightIndex] - beatsSec[rightIndex - 1];
        borderError = Math.abs(firstLen + lastLen - 2 * meanBeatLength);
      }
      if (borderError < MAX_PHASE_ERROR_SEC / 2) {
        regions.push({
          firstBeat: beatsSec[leftIndex],
          beatLength: meanBeatLength,
          beatCount: rightIndex - leftIndex,
        });
        leftIndex = rightIndex;
        rightIndex = beatsSec.length - 1;
        continue;
      }
    }
    rightIndex--;
  }

  // Sentinel marking the end, matching Mixxx's structure.
  regions.push({
    firstBeat: beatsSec[beatsSec.length - 1],
    beatLength: 0,
    beatCount: 0,
  });
  return regions;
}

/**
 * Derive one constant tempo (and its phase) from the detected beats.
 *
 * Returns null when there are too few beats to say anything useful, so the
 * caller can fall back to its own global estimate.
 */
export function makeConstBpm(
  beatsSec: number[],
  minCoverage = MIN_COVERAGE
): { bpm: number; firstBeat: number; coverage: number } | null {
  if (beatsSec.length < MIN_REGION_BEATS) return null;

  const regions = retrieveConstRegions(beatsSec);
  const real = regions.filter((r) => r.beatLength > 0);
  if (real.length === 0) return null;

  // Longest region wins: the tempo that explains the most of the track.
  let best = real[0];
  for (const r of real) if (r.beatCount > best.beatCount) best = r;

  const rawBpm = 60 / best.beatLength;
  const band = bpmUncertaintyBand(rawBpm);
  const bpm = roundBpmWithinRange(band.min, rawBpm, band.max);

  // Re-anchor the phase onto the snapped tempo so the grid still lines up
  // with the audio after rounding.
  const beatLength = 60 / bpm;
  const firstBeat = ((best.firstBeat % beatLength) + beatLength) % beatLength;

  const coverage = best.beatCount / Math.max(1, beatsSec.length - 1);
  // A short constant region inside a track that is mostly *not* constant
  // describes a passage, not the track. Measured on drifting and shuffled
  // material, a region covering less than half the beats gives a worse
  // answer than the global estimate — so refuse rather than mislead.
  if (coverage < minCoverage) return null;

  return { bpm, firstBeat, coverage };
}
