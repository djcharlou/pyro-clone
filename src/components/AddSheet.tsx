import { useMemo, useState } from 'react';
import type { AnalyzedTrack } from '@shared/types';

interface Props {
  open: boolean;
  tracks: AnalyzedTrack[];
  queueIds: Set<string>;
  onClose(): void;
  onAdd(id: string): void;
  onAddMany(ids: string[]): void;
  onImportFolder(): void;
  onImportFiles(): void;
  supportsDirectoryPicker: boolean;
}

export function AddSheet({
  open,
  tracks,
  queueIds,
  onClose,
  onAdd,
  onAddMany,
  onImportFolder,
  onImportFiles,
  supportsDirectoryPicker,
}: Props): JSX.Element | null {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const base = tracks.filter((t) => t.analysis);
    if (!f) return base;
    return base.filter(
      (t) =>
        t.title.toLowerCase().includes(f) ||
        t.artist.toLowerCase().includes(f)
    );
  }, [tracks, filter]);

  if (!open) return null;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>Add tracks</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="sheet-import-row">
          {supportsDirectoryPicker && (
            <button className="sheet-import-btn" onClick={onImportFolder}>
              📁 Import folder
            </button>
          )}
          <button className="sheet-import-btn" onClick={onImportFiles}>
            🎵 Pick files
          </button>
          {tracks.length > 0 && (
            <button
              className="sheet-import-btn sheet-import-btn--ghost"
              onClick={() => onAddMany(filtered.map((t) => t.id))}
            >
              Add all shown ({filtered.length})
            </button>
          )}
        </div>

        <input
          type="text"
          className="sheet-filter"
          placeholder="Search library…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <div className="sheet-list">
          {tracks.length === 0 && (
            <div className="sheet-empty">
              No tracks imported yet. Use the buttons above to add some.
            </div>
          )}
          {filtered.length === 0 && tracks.length > 0 && (
            <div className="sheet-empty">No tracks match "{filter}".</div>
          )}
          {filtered.map((t) => {
            const queued = queueIds.has(t.id);
            return (
              <button
                key={t.id}
                className={`sheet-row ${queued ? 'sheet-row--queued' : ''}`}
                onClick={() => onAdd(t.id)}
                disabled={queued}
              >
                <div className="sheet-row-text">
                  <div className="sheet-row-title">{t.title}</div>
                  <div className="sheet-row-artist">{t.artist}</div>
                </div>
                <div className="sheet-row-meta">
                  <span>{t.analysis?.beatGrid.bpm.toFixed(0) ?? '—'}</span>
                  <span>{t.analysis?.key.camelot ?? '—'}</span>
                  <span className="sheet-row-add">{queued ? '✓' : '+'}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
