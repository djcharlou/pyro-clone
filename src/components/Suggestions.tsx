import type { AnalyzedTrack, SelectionResult } from '@shared/types';

interface Props {
  candidates: SelectionResult[];
  onAdd(id: string): void;
}

export function Suggestions({ candidates, onAdd }: Props): JSX.Element | null {
  if (candidates.length === 0) return null;
  return (
    <section className="suggestions">
      <div className="suggestions-head">MATCHING SONGS</div>
      <div className="suggestions-list">
        {candidates.slice(0, 5).map((c) => (
          <button
            key={c.track.id}
            className="suggestion-row"
            onClick={() => onAdd(c.track.id)}
            title={c.reasoning || `score: ${c.score.toFixed(3)}`}
          >
            <div className="suggestion-text">
              <div className="suggestion-title">{c.track.title}</div>
              <div className="suggestion-artist">{c.track.artist}</div>
            </div>
            <div className="suggestion-meta">
              <span>{c.track.analysis?.beatGrid.bpm.toFixed(0) ?? '—'}</span>
              <span>{c.track.analysis?.key.camelot ?? '—'}</span>
              <span className="suggestion-score">{(c.score * 100).toFixed(0)}</span>
              <span className="suggestion-add">+</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

export function topCandidates(
  pool: AnalyzedTrack[],
  excludeIds: Set<string>,
  // We re-use the scoring through this lightweight interface; pickNext
  // includes too much state for inline reuse. Compute here.
  rankFn: (track: AnalyzedTrack) => number
): AnalyzedTrack[] {
  return pool
    .filter((t) => !excludeIds.has(t.id) && t.analysis)
    .map((t) => ({ t, score: rankFn(t) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.t);
}
