import type {
  AnalyzedTrack,
  SelectionResult,
  SessionState,
  ScoringWeights,
} from '@shared/types';
import { DEFAULT_WEIGHTS } from '@shared/types';
import { computeScore } from './scoring';

export interface PickOptions {
  pool: AnalyzedTrack[];
  current: AnalyzedTrack;
  session: SessionState;
  /** Min score under which we trigger fallback. */
  acceptThreshold?: number;
  /** Return top-N for logging / UI. */
  topN?: number;
}

export interface PickReport {
  picked: SelectionResult;
  topCandidates: SelectionResult[];
}

export function pickNext(opts: PickOptions): PickReport {
  const { pool, current, session, acceptThreshold = 0.55, topN = 10 } = opts;

  const historyTracks = session.history
    .map((id) => pool.find((t) => t.id === id))
    .filter((t): t is AnalyzedTrack => !!t);

  const ctx = {
    current,
    historyTracks,
    weights: session.weights,
    targetEnergy: session.targetEnergy,
  };

  const scored = pool
    .filter((t) => t.id !== current.id)
    .map<SelectionResult>((t) => {
      const { score, parts } = computeScore(t, ctx);
      return {
        track: t,
        score,
        parts,
        mode: 'normal',
        reasoning: '',
      };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    throw new Error('Pool is empty');
  }

  const top = scored[0];
  const usable = scored.filter((s) => s.parts.recency < 1);
  const top5 = scored.slice(0, topN);

  if (usable.length > 0 && usable[0].score >= acceptThreshold) {
    const picked = { ...usable[0], reasoning: buildReason('normal', usable[0]) };
    return { picked, topCandidates: top5 };
  }

  // Fallback 1: relax BPM constraint
  const curBpm = current.analysis?.beatGrid.bpm ?? 120;
  const relaxed = usable.find((s) => {
    const b = s.track.analysis?.beatGrid.bpm ?? 120;
    return Math.abs(b - curBpm) < 12;
  });
  if (relaxed) {
    const picked = {
      ...relaxed,
      mode: 'relaxed-bpm' as const,
      reasoning: buildReason('relaxed-bpm', relaxed),
    };
    return { picked, topCandidates: top5 };
  }

  // Fallback 2: just take best score, force safe transition
  const forced = {
    ...top,
    mode: 'forced' as const,
    reasoning: buildReason('forced', top),
  };
  return { picked: forced, topCandidates: top5 };
}

function buildReason(mode: SelectionResult['mode'], s: SelectionResult): string {
  const p = s.parts;
  const parts = [
    `bpm=${p.bpm.toFixed(2)}`,
    `key=${p.key.toFixed(2)}`,
    `energy=${p.energy.toFixed(2)}`,
    `variety=${p.variety.toFixed(2)}`,
    `quality=${p.quality.toFixed(2)}`,
  ];
  if (p.recency > 0) parts.push(`recency_penalty=${p.recency.toFixed(2)}`);
  return `${mode}: ${parts.join(', ')}`;
}

export function freshSession(weights: ScoringWeights = DEFAULT_WEIGHTS): SessionState {
  return {
    history: [],
    targetEnergy: 0.55,
    elapsedSeconds: 0,
    weights,
  };
}
