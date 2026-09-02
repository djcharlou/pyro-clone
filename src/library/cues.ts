import type { AnalyzedTrack, CuePoints } from '@shared/types';

/**
 * Return cue points with heuristic overrides applied.
 *
 * "DJ Beats" / "DJ Edit" / karaoke-style tracks conventionally have an
 * 8-beat drum-only intro and outro. Our energy-based cue detector often
 * misses these because the drums are quieter than the full mix, so we
 * detect it from the filename and force cues on the beat grid.
 */
export function effectiveCues(track: AnalyzedTrack): CuePoints | undefined {
  const a = track.analysis;
  if (!a) return undefined;

  const label = `${track.title} ${track.filePath}`;
  const isDjBeats = /\b(dj[\s._-]*beats?|dj[\s._-]*edit)\b/i.test(label);
  if (!isDjBeats) return a.cues;

  const bpm = a.beatGrid.bpm || 120;
  const beatDur = 60 / bpm;
  const first = a.beatGrid.firstBeatTime ?? 0;
  const dur = track.durationSec;

  // 8 drum beats at intro → mixInPoint = first downbeat, mixOut = last 8 beats
  const introOut = first + 8 * beatDur;
  const outroIn = Math.max(introOut + 4 * beatDur, dur - 8 * beatDur);

  return {
    ...a.cues,
    introStart: first,
    introEnd: introOut,
    mixInPoint: first,
    outroStart: outroIn,
    outroEnd: dur,
    mixOutPoint: outroIn,
  };
}

export function effectiveMixInPoint(track: AnalyzedTrack): number {
  return effectiveCues(track)?.mixInPoint ?? 0;
}

export function effectiveMixOutPoint(track: AnalyzedTrack, fallbackHeadSec = 16): number {
  return effectiveCues(track)?.mixOutPoint ?? Math.max(0, track.durationSec - fallbackHeadSec);
}
