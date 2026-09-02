/**
 * Extract a BPM that is already written in the filename or title.
 *
 * DJ-edit packs (DJ Beats, Mastermix, Ultimix, X-Mix, DMC…) almost always
 * put the tempo in the name. When it's there it is ground truth — far more
 * reliable than anything we can estimate from the audio — so we trust it
 * and skip the estimator's octave guessing entirely.
 *
 * Recognised shapes:
 *   "Queen - We Will Rock You (Dj Beats) 81"     → 81   (trailing number)
 *   "Artist - Title [128]"                        → 128
 *   "Artist - Title (128 BPM)"                    → 128
 *   "128 - Artist - Title"                        → 128  (leading, DJ pool style)
 *   "Artist - Title - 124bpm"                     → 124
 *
 * Deliberately NOT matched:
 *   "Blink-182 - What's My Age Again"  → 182 is part of the band name, but it
 *                                        is out of the 60-200 sane range check
 *                                        only by luck, so we also require the
 *                                        number to be delimited and not glued
 *                                        to letters.
 *   "007 - Whitney Houston - ..."      → 7 is a track index; rejected by range.
 *   "100 - Chris de Burgh - ..."       → ambiguous! See `leading` note below.
 */

export interface BpmFromNameResult {
  bpm: number;
  /** Which pattern matched — useful for logging / debugging bad guesses. */
  source: 'bpm-suffix' | 'bracket' | 'trailing' | 'leading';
  confidence: number;
}

const MIN_BPM = 60;
const MAX_BPM = 200;

export function bpmFromName(
  name: string,
  opts: { allowLeading?: boolean } = {}
): BpmFromNameResult | null {
  const base = stripExtension(name).trim();

  // 1. Explicit "128 BPM" / "128bpm" — unambiguous, highest confidence.
  const explicit = base.match(/(?<![\d.])(\d{2,3})\s*bpm\b/i);
  if (explicit) {
    const v = Number(explicit[1]);
    if (inRange(v)) return { bpm: v, source: 'bpm-suffix', confidence: 1 };
  }

  // 2. Bracketed at the end: "... [128]" or "... (128)".
  const bracket = base.match(/[[(](\d{2,3})[\])]\s*$/);
  if (bracket) {
    const v = Number(bracket[1]);
    if (inRange(v)) return { bpm: v, source: 'bracket', confidence: 0.95 };
  }

  // 3. Trailing bare number: "... (Dj Beats) 81".
  //    Requires whitespace before it so we never grab digits glued to a word.
  const trailing = base.match(/\s(\d{2,3})\s*$/);
  if (trailing) {
    const v = Number(trailing[1]);
    if (inRange(v)) return { bpm: v, source: 'trailing', confidence: 0.9 };
  }

  // 4. Leading number — DJ pools use this for BOTH tempo and track index,
  //    so it is only consulted when the caller opts in (e.g. after the
  //    audio estimate agrees with it).
  if (opts.allowLeading) {
    const leading = base.match(/^(\d{2,3})\s*[-_.\s]/);
    if (leading) {
      const v = Number(leading[1]);
      if (inRange(v)) return { bpm: v, source: 'leading', confidence: 0.5 };
    }
  }

  return null;
}

/**
 * Reconcile a filename BPM with the audio-derived estimate.
 *
 * The name wins when it is present and the estimate is within an octave of
 * it (i.e. the estimator found the right pulse but picked the wrong
 * multiple). If the two disagree wildly the name is still preferred but the
 * confidence is lowered so downstream code treats the beatgrid as soft.
 */
export function reconcileBpm(
  named: BpmFromNameResult | null,
  estimated: { bpm: number; confidence: number }
): { bpm: number; confidence: number; source: 'name' | 'audio' } {
  if (!named) return { ...estimated, source: 'audio' };

  const ratio = estimated.bpm / named.bpm;
  const octaveAgrees =
    near(ratio, 1) || near(ratio, 2) || near(ratio, 0.5) ||
    near(ratio, 1.5) || near(ratio, 2 / 3);

  return {
    bpm: named.bpm,
    confidence: octaveAgrees
      ? Math.max(named.confidence, estimated.confidence)
      : named.confidence * 0.7,
    source: 'name',
  };
}

function near(x: number, target: number, tol = 0.04): boolean {
  return Math.abs(x - target) <= tol * target;
}

function inRange(v: number): boolean {
  return v >= MIN_BPM && v <= MAX_BPM;
}

function stripExtension(name: string): string {
  const base = name.split('/').pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}
