import type {
  AnalyzedTrack,
  ScoringWeights,
  ScoreBreakdown,
  SessionState,
} from '@shared/types';
import { camelotCompatibility } from '@shared/camelot';

export function bpmScore(currentBpm: number, candidateBpm: number, sigma = 3): number {
  // Consider also doubled / halved BPM
  const candidates = [candidateBpm, candidateBpm * 2, candidateBpm / 2];
  return candidates.reduce((best, bpm) => {
    const s = Math.exp(-((bpm - currentBpm) ** 2) / (2 * sigma * sigma));
    return Math.max(best, s);
  }, 0);
}

export function keyScore(a: AnalyzedTrack, b: AnalyzedTrack): number {
  const ka = a.analysis?.key;
  const kb = b.analysis?.key;
  if (!ka || !kb) return 0.5;
  if (ka.confidence < 0.3 || kb.confidence < 0.3) return 0.5;
  return camelotCompatibility(ka.camelot, kb.camelot);
}

export function energyScore(candidate: AnalyzedTrack, targetEnergy: number): number {
  const e = candidate.analysis?.energy.mean ?? 0.5;
  return Math.max(0, 1 - Math.abs(e - targetEnergy) * 1.5);
}

export function varietyScore(c: AnalyzedTrack, historyTracks: AnalyzedTrack[]): number {
  const last5 = historyTracks.slice(-5);
  const sameArtist = last5.filter((t) => t.artist === c.artist).length;
  const sameGenre = last5.filter((t) => !!t.genre && t.genre === c.genre).length;
  return Math.max(0, 1 - 0.3 * sameArtist - 0.1 * sameGenre);
}

export function qualityScore(c: AnalyzedTrack): number {
  const q = c.analysis?.quality;
  if (q === 'good') return 1;
  if (q === 'partial') return 0.6;
  if (q === 'unreliable') return 0.3;
  return 0; // unanalyzed
}

export function recencyPenalty(c: AnalyzedTrack, historyIds: string[]): number {
  const idx = historyIds.lastIndexOf(c.id);
  if (idx === -1) return 0;
  const distanceFromEnd = historyIds.length - 1 - idx;
  if (distanceFromEnd < 20) return 1.0;
  if (distanceFromEnd < 50) return 0.3;
  return 0;
}

export interface ScoreContext {
  current: AnalyzedTrack;
  historyTracks: AnalyzedTrack[]; // ordered, last = current
  weights: ScoringWeights;
  targetEnergy: number;
}

export function computeScore(
  candidate: AnalyzedTrack,
  ctx: ScoreContext
): { score: number; parts: ScoreBreakdown } {
  const W = ctx.weights;
  const curBpm = ctx.current.analysis?.beatGrid.bpm ?? 120;
  const candBpm = candidate.analysis?.beatGrid.bpm ?? 120;
  const historyIds = ctx.historyTracks.map((t) => t.id);

  const parts: ScoreBreakdown = {
    bpm: bpmScore(curBpm, candBpm),
    key: keyScore(ctx.current, candidate),
    energy: energyScore(candidate, ctx.targetEnergy),
    variety: varietyScore(candidate, ctx.historyTracks),
    quality: qualityScore(candidate),
    recency: recencyPenalty(candidate, historyIds),
  };

  const score =
    W.bpm * parts.bpm +
    W.key * parts.key +
    W.energy * parts.energy +
    W.variety * parts.variety +
    W.quality * parts.quality -
    W.recency * parts.recency;

  return { score, parts };
}

export function sessionTargetEnergy(state: SessionState): number {
  return state.targetEnergy;
}
