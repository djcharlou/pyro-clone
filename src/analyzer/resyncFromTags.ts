import type { AnalyzedTrack, TrackAnalysis } from '@shared/types';
import { bpmFromName, reconcileBpm } from './bpmFromName';
import { buildBeatGrid } from './dsp';
import { readSeratoData } from '@/library/seratoRead';
import { fileRegistry } from '@/library/Importer';

/**
 * Repair stored tempo/beatgrid data without re-decoding audio.
 *
 * Tracks analysed by older builds carry BPMs that can be off by several
 * units or a whole octave. Two sources fix that for far less work than a
 * full re-analysis:
 *
 *   1. Serato GEOB tags in the file — exact tempo and beat anchor. Requires
 *      reading the file bytes, but no decoding, so it is I/O-bound only.
 *   2. A BPM written in the filename — free, no I/O at all.
 *
 * Serato wins when both are present.
 */

export interface ResyncOutcome {
  trackId: string;
  title: string;
  fromBpm: number;
  toBpm: number;
  source: 'serato' | 'name';
}

export interface ResyncReport {
  scanned: number;
  updated: ResyncOutcome[];
  /** Files we couldn't read (moved, permissions, browser-only handle). */
  unreadable: number;
}

/** Cheap, synchronous pass: filename BPM only. */
export function resyncFromName(track: AnalyzedTrack): TrackAnalysis | null {
  const a = track.analysis;
  if (!a) return null;
  const named = bpmFromName(`${track.filePath ?? ''} ${track.title ?? ''}`);
  if (!named) return null;

  const reconciled = reconcileBpm(named, {
    bpm: a.beatGrid.bpm,
    confidence: a.beatGrid.bpmConfidence,
  });
  if (Math.abs(reconciled.bpm - a.beatGrid.bpm) < 0.75) return null;

  return withTempo(track, a, reconciled.bpm, a.beatGrid.firstBeatTime, reconciled.confidence);
}

/** Full pass: reads each file to look for Serato tags, falls back to name. */
export async function resyncLibrary(
  tracks: AnalyzedTrack[],
  onProgress?: (done: number, total: number) => void
): Promise<{ updates: Array<{ track: AnalyzedTrack; analysis: TrackAnalysis }>; report: ResyncReport }> {
  const updates: Array<{ track: AnalyzedTrack; analysis: TrackAnalysis }> = [];
  const outcomes: ResyncOutcome[] = [];
  let unreadable = 0;
  let scanned = 0;

  const candidates = tracks.filter((t) => t.analysis);
  for (let i = 0; i < candidates.length; i++) {
    const track = candidates[i];
    onProgress?.(i, candidates.length);
    scanned++;
    const a = track.analysis;
    if (!a) continue;

    let next: TrackAnalysis | null = null;
    let source: ResyncOutcome['source'] = 'name';

    // 1. Serato tags — only worth reading for formats that carry them.
    if (/\.mp3$/i.test(track.filePath ?? '')) {
      try {
        const file = await fileRegistry.getFile(track.id);
        if (file) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const serato = readSeratoData(bytes);
          const bpm = serato?.autotags?.bpm ?? serato?.beatGrid?.markers?.[0]?.bpm;
          const first = serato?.beatGrid?.markers?.[0]?.position;
          if (bpm && Number.isFinite(bpm) && first !== undefined && Number.isFinite(first)) {
            const bpmChanged = Math.abs(bpm - a.beatGrid.bpm) >= 0.05;
            const anchorChanged = Math.abs(first - a.beatGrid.firstBeatTime) >= 0.01;
            if (bpmChanged || anchorChanged) {
              next = withTempo(track, a, bpm, first, 1);
              source = 'serato';
            } else {
              next = null; // already matches Serato exactly
            }
          }
        } else {
          unreadable++;
        }
      } catch {
        unreadable++;
      }
    }

    // 2. Filename fallback.
    if (!next) {
      const byName = resyncFromName(track);
      if (byName) {
        next = byName;
        source = 'name';
      }
    }

    if (next) {
      updates.push({ track, analysis: next });
      outcomes.push({
        trackId: track.id,
        title: track.title,
        fromBpm: a.beatGrid.bpm,
        toBpm: next.beatGrid.bpm,
        source,
      });
    }
  }

  onProgress?.(candidates.length, candidates.length);
  return { updates, report: { scanned, updated: outcomes, unreadable } };
}

/** Rebuild an analysis around a known-good tempo and beat anchor. */
function withTempo(
  track: AnalyzedTrack,
  a: TrackAnalysis,
  bpm: number,
  firstBeatTime: number,
  confidence: number
): TrackAnalysis {
  const { beats, downbeats } = buildBeatGrid(firstBeatTime, bpm, track.durationSec);
  return {
    ...a,
    beatGrid: {
      ...a.beatGrid,
      bpm,
      bpmConfidence: confidence,
      firstBeatTime,
      beats,
      downbeats,
      // A grid derived from a known tempo is regular by construction.
      isStable: true,
    },
    quality: a.quality === 'unreliable' ? 'partial' : a.quality,
  };
}
