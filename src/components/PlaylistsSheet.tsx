import { useState } from 'react';
import type { Playlist } from '@shared/types';

interface Props {
  open: boolean;
  playlists: Playlist[];
  currentQueueLength: number;
  onClose(): void;
  onSaveCurrent(name: string): void;
  onLoad(playlistId: string): void;
  onDelete(playlistId: string): void;
  /** Wipe every imported track, analysis and playlist. */
  onResetLibrary(): void;
  /** Clear queue + play history, keep the imported library. */
  onResetSession(): void;
  libraryCount: number;
  /** Whether played tracks are removed from the queue automatically. */
  drainQueue: boolean;
  onToggleDrainQueue(next: boolean): void;
}

export function PlaylistsSheet({
  open,
  playlists,
  currentQueueLength,
  onClose,
  onSaveCurrent,
  onLoad,
  onDelete,
  onResetLibrary,
  onResetSession,
  libraryCount,
  drainQueue,
  onToggleDrainQueue,
}: Props): JSX.Element | null {
  const [name, setName] = useState('');

  if (!open) return null;

  function handleSave(): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSaveCurrent(trimmed);
    setName('');
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>Playlists</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sheet-save-row">
          <input
            type="text"
            className="sheet-filter"
            placeholder={`Save current queue (${currentQueueLength}) as…`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <button
            className="sheet-import-btn"
            onClick={handleSave}
            disabled={!name.trim() || currentQueueLength === 0}
          >
            Save
          </button>
        </div>

        <div className="sheet-settings">
          <label className="sheet-setting-row">
            <input
              type="checkbox"
              checked={drainQueue}
              onChange={(e) => onToggleDrainQueue(e.target.checked)}
            />
            <span>
              <strong>Remove tracks once played</strong>
              <em>
                {drainQueue
                  ? 'The queue empties as it plays, like a DJ crate.'
                  : 'Played tracks stay in the list, dimmed, so you can replay them.'}
              </em>
            </span>
          </label>
        </div>

        <div className="sheet-list">
          {playlists.length === 0 && (
            <div className="sheet-empty">No saved playlists yet.</div>
          )}
          {playlists.map((p) => (
            <div key={p.id} className="sheet-row sheet-row--playlist">
              <div className="sheet-row-text">
                <div className="sheet-row-title">{p.name}</div>
                <div className="sheet-row-artist">
                  {p.trackIds.length} tracks · saved {formatRelative(p.updatedAt)}
                </div>
              </div>
              <div className="sheet-row-meta">
                <button
                  className="qcard-btn qcard-btn--play"
                  onClick={() => onLoad(p.id)}
                  aria-label="Load playlist"
                >
                  ▶
                </button>
                <button
                  className="qcard-btn qcard-btn--remove"
                  onClick={() => onDelete(p.id)}
                  aria-label="Delete playlist"
                >
                  ⊖
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="sheet-danger">
          <div className="sheet-danger-head">Reset</div>
          <div className="sheet-danger-actions">
            <button
              className="sheet-danger-btn"
              onClick={onResetSession}
              title="Empty the queue and forget what has played — keeps your library"
            >
              Reset session
            </button>
            <button
              className="sheet-danger-btn sheet-danger-btn--destructive"
              onClick={onResetLibrary}
              title="Remove every imported track, analysis and playlist"
            >
              Erase library ({libraryCount})
            </button>
          </div>
          <p className="sheet-danger-note">
            Erasing the library only clears what pyro stored. Your audio files
            on disk are never touched.
          </p>
        </div>
      </div>
    </div>
  );
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
