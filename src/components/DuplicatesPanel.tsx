import type { AnalyzedTrack } from '@shared/types';
import type { DuplicateCluster } from '@/library/dedupe';

interface Props {
  clusters: DuplicateCluster[];
  onFocus(trackId: string): void;
}

export function DuplicatesPanel({ clusters, onFocus }: Props): JSX.Element {
  if (clusters.length === 0) {
    return (
      <div className="dup-empty">
        No duplicates found. Nice and clean.
      </div>
    );
  }
  return (
    <div className="dup-wrap">
      <div className="dup-summary">
        {clusters.length} cluster{clusters.length > 1 ? 's' : ''}
        {' · '}
        {clusters.reduce((s, c) => s + c.tracks.length, 0)} tracks total
      </div>
      {clusters.map((c, i) => (
        <div key={i} className={`dup-cluster dup-cluster--${c.kind}`}>
          <div className="dup-head">
            <span className={`dup-badge dup-badge--${c.kind}`}>
              {c.kind === 'exact' ? 'EXACT' : 'PROBABLE'}
            </span>
            <span className="dup-reason">{c.reason}</span>
          </div>
          <ul className="dup-list">
            {c.tracks.map((t) => (
              <li key={t.id}>
                <button className="dup-item" onClick={() => onFocus(t.id)}>
                  <span className="dup-item-title">{t.title}</span>
                  <span className="dup-item-artist"> — {t.artist}</span>
                  <span className="dup-item-meta">
                    {' · '}
                    {fmtDur(t.durationSec)}
                    {' · '}
                    <code>{shortPath(t.filePath)}</code>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function shortPath(p: string): string {
  const parts = p.split('/');
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join('/')}`;
}

// Re-export type used by parent
export type { AnalyzedTrack };
