/**
 * Enrich local tracks with Spotify audio features.
 *
 * For each candidate:
 *   1. Search Spotify by "artist title", pick the top result whose title
 *      + primary artist fuzzy-match well enough (Levenshtein-lite).
 *   2. Fetch audio-features in a batched call (100 tracks per request).
 *   3. Overwrite the analysis fields we trust Spotify on:
 *        bpm, key/scale/camelot, energy.mean
 *      Everything else (waveform, cues, our own beat grid) stays.
 *   4. Mark analysis.source = 'spotify' and store spotifyTrackId +
 *      spotifyFeatures so the UI can show a badge and future queries
 *      can hit the same ids without re-searching.
 *
 * Rate limiting: Spotify permits ~180 req/min per user in the burst
 * budget. We keep search sequential to stay well below that.
 */

import type { AnalyzedTrack, TrackAnalysis, SpotifyFeatures } from '@shared/types';
import { ANALYZER_VERSION } from '@shared/types';
import {
  searchTracks,
  getAudioFeaturesBatch,
  featuresToOurFormat,
} from './api';
import { store } from '@/db/IndexedDBStore';

export interface EnrichmentProgress {
  phase: 'searching' | 'features' | 'saving' | 'done' | 'error';
  done: number;
  total: number;
  currentTitle?: string;
  matched?: number;
  unmatched?: number;
  error?: string;
}

export interface EnrichmentSummary {
  requested: number;
  matched: number;
  unmatched: number;
  updated: number;
  errors: number;
}

export async function enrichWithSpotify(
  tracks: AnalyzedTrack[],
  onProgress?: (p: EnrichmentProgress) => void
): Promise<EnrichmentSummary> {
  let matched = 0;
  let unmatched = 0;
  let updated = 0;
  let errors = 0;

  // ---- Phase 1: search ----------------------------------------------------
  const matches = new Map<string, string>(); // localId -> spotify id
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    onProgress?.({
      phase: 'searching',
      done: i,
      total: tracks.length,
      currentTitle: t.title,
    });
    try {
      // If we already have a spotifyTrackId cached, reuse it.
      if (t.analysis?.spotifyTrackId) {
        matches.set(t.id, t.analysis.spotifyTrackId);
        matched++;
        continue;
      }
      const query = buildQuery(t.title, t.artist);
      const results = await searchTracks(query, 5);
      const best = pickBestMatch(t.title, t.artist, t.durationSec, results);
      if (best) {
        matches.set(t.id, best.id);
        matched++;
      } else {
        unmatched++;
      }
    } catch (err) {
      errors++;
      console.warn('[spotify enrich] search failed for', t.title, err);
    }
  }

  // ---- Phase 2: audio features -------------------------------------------
  const localToSpotify = [...matches.entries()];
  const spotifyIds = localToSpotify.map(([, sid]) => sid);
  onProgress?.({ phase: 'features', done: 0, total: spotifyIds.length });
  let featuresBySpotifyId = new Map<string, ReturnType<typeof featuresToOurFormat>>();
  try {
    const rawFeatures = await getAudioFeaturesBatch(spotifyIds);
    for (let i = 0; i < spotifyIds.length; i++) {
      const raw = rawFeatures[i];
      if (raw) featuresBySpotifyId.set(spotifyIds[i], featuresToOurFormat(raw));
    }
  } catch (err) {
    errors++;
    console.error('[spotify enrich] audio-features batch failed', err);
    onProgress?.({
      phase: 'error',
      done: 0,
      total: spotifyIds.length,
      error: (err as Error).message,
    });
  }

  // ---- Phase 3: save ------------------------------------------------------
  onProgress?.({ phase: 'saving', done: 0, total: localToSpotify.length });
  for (let i = 0; i < localToSpotify.length; i++) {
    const [localId, spId] = localToSpotify[i];
    const track = tracks.find((t) => t.id === localId);
    const f = featuresBySpotifyId.get(spId);
    if (!track || !f) continue;

    const next = mergeAnalysis(track, spId, f);
    try {
      await store.saveAnalysis(next);
      updated++;
    } catch (err) {
      errors++;
      console.error('[spotify enrich] save failed for', track.title, err);
    }
    onProgress?.({
      phase: 'saving',
      done: i + 1,
      total: localToSpotify.length,
      currentTitle: track.title,
    });
  }

  onProgress?.({
    phase: 'done',
    done: tracks.length,
    total: tracks.length,
    matched,
    unmatched,
  });

  return {
    requested: tracks.length,
    matched,
    unmatched,
    updated,
    errors,
  };
}

/**
 * Build a Spotify search query. Strips common noise like "(Remastered)"
 * and stops the search from being too specific.
 */
function buildQuery(title: string, artist: string): string {
  const clean = (s: string): string =>
    s
      .replace(/\(.*?\)|\[.*?\]/g, '') // drop bracketed variants
      .replace(/\s+-\s+.*/g, '') // drop " - Remastered 2015" etc
      .replace(/\s+feat\..*/gi, '') // drop featured artists in search
      .trim();
  return `track:${clean(title)} artist:${clean(artist)}`;
}

interface MatchCandidate {
  id: string;
  title: string;
  artists: string[];
  durationSec: number;
}

function pickBestMatch(
  wantTitle: string,
  wantArtist: string,
  wantDurationSec: number,
  candidates: MatchCandidate[]
): MatchCandidate | null {
  if (candidates.length === 0) return null;
  const normWantTitle = normalize(wantTitle);
  const normWantArtist = normalize(wantArtist);
  let best: MatchCandidate | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const titleScore = stringOverlap(normWantTitle, normalize(c.title));
    const artistScore = Math.max(
      ...c.artists.map((a) => stringOverlap(normWantArtist, normalize(a))),
      0
    );
    const durationDiff = Math.abs(c.durationSec - wantDurationSec);
    const durationScore = wantDurationSec > 0
      ? Math.max(0, 1 - durationDiff / 10) // 10s tolerance
      : 0.5;
    // Weighted score — title matters most, then artist, duration is a tiebreak
    const score = titleScore * 0.6 + artistScore * 0.3 + durationScore * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  // Require a minimum quality to accept the match
  return bestScore >= 0.55 ? best : null;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Simple bag-of-words overlap ratio. Good enough for track/artist match. */
function stringOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.split(' ').filter(Boolean));
  const wordsB = new Set(b.split(' ').filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  for (const w of wordsA) if (wordsB.has(w)) common++;
  return common / Math.max(wordsA.size, wordsB.size);
}

function mergeAnalysis(
  track: AnalyzedTrack,
  spotifyId: string,
  f: ReturnType<typeof featuresToOurFormat>
): TrackAnalysis {
  const base = track.analysis;
  const now = Date.now();
  const extras: SpotifyFeatures = f.extras;
  if (!base) {
    // No prior analysis — build a minimal one that our engine can use.
    return {
      trackId: track.id,
      analyzerVersion: ANALYZER_VERSION,
      analyzedAt: now,
      quality: 'good',
      beatGrid: {
        firstBeatTime: 0,
        bpm: f.bpm,
        bpmConfidence: 0.95,
        beats: [],
        downbeats: [],
        isStable: true,
      },
      key: {
        root: f.key,
        scale: f.scale,
        camelot: f.camelot,
        confidence: 0.9,
      },
      energy: {
        mean: f.energy,
        peak: Math.min(1, f.energy * 1.2),
        perBar: [],
        rmsDb: f.loudnessDb,
      },
      cues: {
        introStart: 0,
        introEnd: Math.min(8, track.durationSec),
        outroStart: Math.max(0, track.durationSec - 16),
        outroEnd: track.durationSec,
        mixInPoint: Math.min(8, track.durationSec),
        mixOutPoint: Math.max(0, track.durationSec - 16),
      },
      source: 'spotify',
      spotifyTrackId: spotifyId,
      spotifyFeatures: extras,
    };
  }
  // Merge: keep our waveform + cues + beatgrid layout, but Spotify wins
  // on the aggregate numbers (bpm, key, energy mean).
  return {
    ...base,
    beatGrid: {
      ...base.beatGrid,
      bpm: f.bpm,
      bpmConfidence: 0.95,
    },
    key: {
      root: f.key,
      scale: f.scale,
      camelot: f.camelot,
      confidence: 0.9,
    },
    energy: {
      ...base.energy,
      mean: f.energy,
      rmsDb: f.loudnessDb,
    },
    quality: 'good',
    source: 'spotify',
    spotifyTrackId: spotifyId,
    spotifyFeatures: extras,
  };
}
