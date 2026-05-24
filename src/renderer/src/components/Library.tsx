import { useMemo, useState } from 'react';
import type { AnalyzedTrack } from '@shared/types';
import { useStore } from '../state/store';

interface Props {
  tracks: AnalyzedTrack[];
  onLoadActive(track: AnalyzedTrack): void;
  onLoadInactive(track: AnalyzedTrack): void;
  onReanalyze(track: AnalyzedTrack): void;
}

export function Library({ tracks, onLoadActive, onLoadInactive, onReanalyze }: Props): JSX.Element {
  const [filter, setFilter] = useState('');
  const analyzingIds = useStore((s) => s.analyzingIds);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return tracks;
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(f) ||
        t.artist.toLowerCase().includes(f) ||
        (t.album?.toLowerCase().includes(f) ?? false)
    );
  }, [tracks, filter]);

  return (
    <section className="library">
      <div className="library-header">
        <h2>Library ({tracks.length})</h2>
        <input
          className="library-filter"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="library-table">
        <div className="library-row library-row--head">
          <span>Title</span>
          <span>Artist</span>
          <span>BPM</span>
          <span>Key</span>
          <span>Energy</span>
          <span>Quality</span>
          <span>Actions</span>
        </div>
        {filtered.length === 0 ? (
          <div className="library-empty">No tracks yet. Click "Import folder" above.</div>
        ) : (
          filtered.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              analyzing={analyzingIds.has(t.id)}
              onLoadActive={() => onLoadActive(t)}
              onLoadInactive={() => onLoadInactive(t)}
              onReanalyze={() => onReanalyze(t)}
            />
          ))
        )}
      </div>
    </section>
  );
}

interface RowProps {
  track: AnalyzedTrack;
  analyzing: boolean;
  onLoadActive(): void;
  onLoadInactive(): void;
  onReanalyze(): void;
}

function TrackRow({ track, analyzing, onLoadActive, onLoadInactive, onReanalyze }: RowProps): JSX.Element {
  const a = track.analysis;
  return (
    <div className="library-row">
      <span className="ellipsis" title={track.title}>{track.title}</span>
      <span className="ellipsis" title={track.artist}>{track.artist}</span>
      <span>{a ? a.beatGrid.bpm.toFixed(1) : '—'}</span>
      <span>{a ? a.key.camelot : '—'}</span>
      <span>{a ? (a.energy.mean * 100).toFixed(0) + '%' : '—'}</span>
      <span className={`quality quality--${a?.quality ?? 'none'}`}>
        {analyzing ? 'analyzing…' : a?.quality ?? '—'}
      </span>
      <span className="actions">
        <button onClick={onLoadActive} title="Load into active deck">A</button>
        <button onClick={onLoadInactive} title="Load into other deck">B</button>
        <button onClick={onReanalyze} title="Re-analyze">↻</button>
      </span>
    </div>
  );
}
