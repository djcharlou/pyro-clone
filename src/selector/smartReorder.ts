import type { AnalyzedTrack, SessionState } from '@shared/types';
import { computeScore } from './scoring';

/**
 * Greedy nearest-neighbor reordering of a queue by mix compatibility.
 *
 * Given a set of tracks (typically the current queue) and an optional
 * "anchor" (usually the currently-playing track), we build an order in
 * which each next track has the highest scoring transition from the
 * previous one, given the session's weights.
 *
 * Not optimal (that would be a TSP), but O(n²) and typically better than
 * a random or import-order shuffle.
 */
export function smartReorderQueue(
  queueTracks: AnalyzedTrack[],
  anchor: AnalyzedTrack | null,
  session: SessionState
): AnalyzedTrack[] {
  if (queueTracks.length <= 1) return queueTracks;

  const pool = [...queueTracks];
  const ordered: AnalyzedTrack[] = [];

  // First pick: the track that best follows the anchor.
  // If no anchor, start with whichever track has the strongest connection
  // to the mean of all others.
  let current: AnalyzedTrack;
  if (anchor && anchor.analysis) {
    current = pickBestNext(anchor, pool, session);
  } else {
    current = seedWithBestGraphConnection(pool, session);
  }
  removeById(pool, current.id);
  ordered.push(current);

  while (pool.length > 0) {
    const next = pickBestNext(current, pool, session);
    ordered.push(next);
    removeById(pool, next.id);
    current = next;
  }

  return ordered;
}

function pickBestNext(
  from: AnalyzedTrack,
  pool: AnalyzedTrack[],
  session: SessionState
): AnalyzedTrack {
  let best = pool[0];
  let bestScore = -Infinity;
  for (const candidate of pool) {
    const { score } = computeScore(candidate, {
      current: from,
      historyTracks: [from],
      weights: session.weights,
      targetEnergy: session.targetEnergy,
    });
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function seedWithBestGraphConnection(
  pool: AnalyzedTrack[],
  session: SessionState
): AnalyzedTrack {
  // Simple heuristic: pick the track whose average outgoing score to all
  // others is highest — good "hub" to start from.
  let bestIdx = 0;
  let bestAvg = -Infinity;
  for (let i = 0; i < pool.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = 0; j < pool.length; j++) {
      if (i === j) continue;
      const { score } = computeScore(pool[j], {
        current: pool[i],
        historyTracks: [pool[i]],
        weights: session.weights,
        targetEnergy: session.targetEnergy,
      });
      sum += score;
      n++;
    }
    const avg = n > 0 ? sum / n : 0;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestIdx = i;
    }
  }
  return pool[bestIdx];
}

function removeById(arr: AnalyzedTrack[], id: string): void {
  const i = arr.findIndex((t) => t.id === id);
  if (i >= 0) arr.splice(i, 1);
}
