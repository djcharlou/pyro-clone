import type { AnalyzedTrack, TrackAnalysis } from '@shared/types';
import { bpmFromName, reconcileBpm } from './bpmFromName';
import { buildBeatGrid } from './dsp';

export interface BpmRepairResult {
  checked: number;
  repaired: number;
  details: Array<{ title: string; from: number; to: number }>;
}

/**
 * Correct stored BPMs using the tempo written in the filename.
 *
 * Tracks analysed before the estimator was fixed carry BPMs that can be off
 * by an octave (an 81 BPM edit stored as 157). Re-running the full audio
 * analysis on a whole library is minutes of work; reading the tempo from the
 * name is instant and, for DJ-edit packs, more accurate than the estimator
 * ever was. So on startup we sweep the library and fix what we can for free.
 *
 * The beatgrid is rebuilt from the corrected tempo, keeping the detected
 * first-beat offset, so cue points and phrase snapping stay aligned.
 */
export function repairAnalysisFromName(
  track: AnalyzedTrack
): TrackAnalysis | null {
  const a = track.analysis;
  if (!a) return null;

  const named = bpmFromName(`${track.filePath ?? ''} ${track.title ?? ''}`);
  if (!named) return null;

  const current = a.beatGrid.bpm;
  // Already correct (within rounding) — nothing to do.
  if (Math.abs(current - named.bpm) < 0.75) return null;

  const reconciled = reconcileBpm(named, {
    bpm: current,
    confidence: a.beatGrid.bpmConfidence,
  });
  if (Math.abs(reconciled.bpm - current) < 0.75) return null;

  const { beats, downbeats } = buildBeatGrid(
    a.beatGrid.firstBeatTime,
    reconciled.bpm,
    track.durationSec
  );

  return {
    ...a,
    beatGrid: {
      ...a.beatGrid,
      bpm: reconciled.bpm,
      bpmConfidence: reconciled.confidence,
      beats,
      downbeats,
      // A grid derived from a known tempo is regular by construction.
      isStable: true,
    },
    // Tempo drives cue placement, so the old energy-derived cues are now
    // suspect. They stay put (still roughly right in absolute seconds) but
    // quality is downgraded so the transition planner is a bit more careful.
    quality: a.quality === 'unreliable' ? 'partial' : a.quality,
  };
}

/** Sweep a whole library. Pure — returns what changed, writes nothing. */
export function repairLibrary(tracks: AnalyzedTrack[]): {
  updates: Array<{ track: AnalyzedTrack; analysis: TrackAnalysis }>;
  report: BpmRepairResult;
} {
  const updates: Array<{ track: AnalyzedTrack; analysis: TrackAnalysis }> = [];
  const details: BpmRepairResult['details'] = [];
  let checked = 0;

  for (const t of tracks) {
    if (!t.analysis) continue;
    checked++;
    const fixed = repairAnalysisFromName(t);
    if (!fixed) continue;
    updates.push({ track: t, analysis: fixed });
    details.push({
      title: t.title,
      from: t.analysis.beatGrid.bpm,
      to: fixed.beatGrid.bpm,
    });
  }

  return {
    updates,
    report: { checked, repaired: updates.length, details },
  };
}
