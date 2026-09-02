import type { AnalyzedTrack } from '@shared/types';

export interface DuplicateCluster {
  kind: 'exact' | 'probable';
  tracks: AnalyzedTrack[];
  reason: string;
}

/**
 * Group tracks into clusters that are likely the same recording.
 *
 * Two passes:
 *   1. Exact: same fileHash (identical bytes at file head)
 *   2. Probable: same normalized (title + artist), duration within ±2s
 */
export function findDuplicates(tracks: AnalyzedTrack[]): DuplicateCluster[] {
  const clusters: DuplicateCluster[] = [];

  // --- Exact by hash ------------------------------------------------------
  const byHash = new Map<string, AnalyzedTrack[]>();
  for (const t of tracks) {
    if (!t.fileHash) continue;
    const arr = byHash.get(t.fileHash) ?? [];
    arr.push(t);
    byHash.set(t.fileHash, arr);
  }
  const exactMembers = new Set<string>();
  for (const [hash, group] of byHash) {
    if (group.length < 2) continue;
    clusters.push({
      kind: 'exact',
      tracks: group,
      reason: `identical file hash (${hash.slice(0, 10)}…)`,
    });
    group.forEach((t) => exactMembers.add(t.id));
  }

  // --- Probable by (title + artist + duration) ----------------------------
  const remaining = tracks.filter((t) => !exactMembers.has(t.id));
  const byKey = new Map<string, AnalyzedTrack[]>();
  for (const t of remaining) {
    const key = normalizeKey(t.title, t.artist);
    if (!key) continue;
    const arr = byKey.get(key) ?? [];
    arr.push(t);
    byKey.set(key, arr);
  }
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    // Split further by duration bucket (±2s tolerance handled by clustering below)
    const subclusters = clusterByDuration(group, 2);
    for (const sub of subclusters) {
      if (sub.length < 2) continue;
      clusters.push({
        kind: 'probable',
        tracks: sub,
        reason: `same title & artist (${key.slice(0, 40)}), duration within 2s`,
      });
    }
  }

  clusters.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'exact' ? -1 : 1));
  return clusters;
}

function normalizeKey(title: string, artist: string): string {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip diacritics
      .replace(/\(.*?\)|\[.*?\]/g, '') // strip parenthetical bits like (remix)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const t = norm(title);
  const a = norm(artist);
  if (!t) return '';
  return `${a}|${t}`;
}

function clusterByDuration(
  tracks: AnalyzedTrack[],
  toleranceSec: number
): AnalyzedTrack[][] {
  const sorted = [...tracks].sort((a, b) => a.durationSec - b.durationSec);
  const clusters: AnalyzedTrack[][] = [];
  let current: AnalyzedTrack[] = [];
  let anchor = -Infinity;
  for (const t of sorted) {
    if (t.durationSec - anchor > toleranceSec) {
      if (current.length) clusters.push(current);
      current = [t];
      anchor = t.durationSec;
    } else {
      current.push(t);
    }
  }
  if (current.length) clusters.push(current);
  return clusters;
}
