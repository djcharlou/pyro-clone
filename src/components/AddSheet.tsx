import { useEffect, useMemo, useState } from 'react';
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
  onImportITunes?: () => void;
  supportsDirectoryPicker: boolean;
  supportsITunes?: boolean;
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
  onImportITunes,
  supportsDirectoryPicker,
  supportsITunes,
}: Props): JSX.Element | null {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset selection whenever the sheet reopens
  useEffect(() => {
    if (open) setSelected(new Set());
  }, [open]);

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

  function toggleOne(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible(): void {
    setSelected(new Set(filtered.filter((t) => !queueIds.has(t.id)).map((t) => t.id)));
  }

  function commitSelected(): void {
    if (selected.size === 0) return;
    onAddMany([...selected]);
    setSelected(new Set());
  }

  const hasSelection = selected.size > 0;
  const addableVisible = filtered.filter((t) => !queueIds.has(t.id)).length;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>Add tracks</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sheet-import-row">
          {supportsDirectoryPicker && (
            <button className="sheet-import-btn" onClick={onImportFolder}>
              📁 Import folder
            </button>
          )}
          <button className="sheet-import-btn" onClick={onImportFiles}>
            🎵 Pick files (multi ok)
          </button>
          {supportsITunes && onImportITunes && (
            <button className="sheet-import-btn" onClick={onImportITunes} title="Read your Music.app / iTunes library XML">
              🍎 Import from Music.app
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

        {tracks.length > 0 && (
          <div className="sheet-multi-bar">
            <button
              className="sheet-multi-btn"
              onClick={selectAllVisible}
              disabled={addableVisible === 0}
            >
              Select all ({addableVisible})
            </button>
            {hasSelection && (
              <button
                className="sheet-multi-btn"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            )}
            <span className="sheet-multi-count">{selected.size} selected</span>
          </div>
        )}

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
            const isSelected = selected.has(t.id);
            return (
              <div
                key={t.id}
                className={`sheet-row ${queued ? 'sheet-row--queued' : ''} ${isSelected ? 'sheet-row--selected' : ''}`}
              >
                <label className="sheet-row-check">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={queued}
                    onChange={() => toggleOne(t.id)}
                  />
                </label>
                <button
                  className="sheet-row-body"
                  onClick={() => {
                    if (queued) return;
                    if (hasSelection) toggleOne(t.id);
                    else onAdd(t.id);
                  }}
                  disabled={queued}
                >
                  <div className="sheet-row-text">
                    <div className="sheet-row-title">{t.title}</div>
                    <div className="sheet-row-artist">{t.artist}</div>
                  </div>
                  <div className="sheet-row-meta">
                    <span>{t.analysis?.beatGrid.bpm.toFixed(0) ?? '—'}</span>
                    <span>{t.analysis?.key.camelot ?? '—'}</span>
                    <span className="sheet-row-add">{queued ? '✓' : (isSelected ? '☒' : '+')}</span>
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        {hasSelection && (
          <div className="sheet-commit-bar">
            <button className="sheet-commit-btn" onClick={commitSelected}>
              Add {selected.size} to queue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
