import { useMemo, useState } from 'react';
import type { AnalyzedTrack } from '@shared/types';
import { LibraryTable, type EditableField } from './LibraryTable';
import { BulkEditPanel } from './BulkEditPanel';
import { DuplicatesPanel } from './DuplicatesPanel';
import { RenameSheet } from './RenameSheet';
import { findDuplicates } from '@/library/dedupe';
import { writeTagsBatch, type TagEdits, type WriteMode } from '@/library/tagWriter';
import { store } from '@/db/IndexedDBStore';
import { useStore } from '@/state/store';

type Tab = 'all' | 'dupes';

export function WorkshopView(): JSX.Element {
  const tracks = useStore((s) => s.tracks);
  const updateTrackFields = useStore((s) => s.updateTrackFields);

  const [tab, setTab] = useState<Tab>('all');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: EditableField } | null>(null);
  const [writing, setWriting] = useState(false);
  const [writeMode, setWriteMode] = useState<WriteMode | null>(null);
  const [writeStatus, setWriteStatus] = useState<string>('');
  const [renameOpen, setRenameOpen] = useState(false);

  const selectionArray = useMemo(
    () => tracks.filter((t) => selection.has(t.id)),
    [tracks, selection]
  );

  const duplicates = useMemo(
    () => (tab === 'dupes' ? findDuplicates(tracks) : []),
    [tracks, tab]
  );

  function handleToggleSelect(id: string, mode: 'single' | 'multi' | 'range' = 'multi'): void {
    setSelection((prev) => {
      const next = new Set(prev);
      if (mode === 'range' && lastSelected) {
        const ordered = tracks.map((t) => t.id);
        const start = ordered.indexOf(lastSelected);
        const end = ordered.indexOf(id);
        if (start >= 0 && end >= 0) {
          const [a, b] = start < end ? [start, end] : [end, start];
          for (let i = a; i <= b; i++) next.add(ordered[i]);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastSelected(id);
  }

  function handleToggleSelectAll(): void {
    setSelection((prev) =>
      prev.size === tracks.length ? new Set() : new Set(tracks.map((t) => t.id))
    );
  }

  async function handleCommitEdit(id: string, field: EditableField, value: string): Promise<void> {
    setEditing(null);
    const trimmed = value.trim();
    const patch: Partial<Pick<AnalyzedTrack, 'title' | 'artist' | 'album' | 'genre'>> = {};
    patch[field] = trimmed || (field === 'title' || field === 'artist' ? 'Unknown' : '');
    updateTrackFields(id, patch);
    // Persist Track record to IDB (without touching source file yet)
    const track = tracks.find((t) => t.id === id);
    if (track) {
      await store.upsertTrack({ ...track, ...patch });
    }
  }

  async function handleBulkApply(bulk: {
    genre?: string; artist?: string; album?: string; year?: number;
  }): Promise<void> {
    for (const t of selectionArray) {
      const patch: Partial<Pick<AnalyzedTrack, 'genre' | 'artist' | 'album'>> = {};
      if (bulk.genre !== undefined) patch.genre = bulk.genre;
      if (bulk.artist !== undefined) patch.artist = bulk.artist;
      if (bulk.album !== undefined) patch.album = bulk.album;
      updateTrackFields(t.id, patch);
      await store.upsertTrack({ ...t, ...patch });
    }
    // year not on Track type yet — could add later
  }

  async function handleWriteToFiles(): Promise<void> {
    if (selectionArray.length === 0) return;
    setWriting(true);
    setWriteMode(null);
    setWriteStatus('');
    const edits = selectionArray
      .filter((t) => t.filePath.toLowerCase().endsWith('.mp3'))
      .map((t) => {
        const a = t.analysis;
        const serato = a
          ? {
              bpm: a.beatGrid.bpm,
              autoGainDb: a.loudness ? clampGain(a.loudness.suggestedGainDb) : 0,
              gainDb: 0,
              beats: a.beatGrid.beats,
              bpmLocked: true,
              trackColor: 0xffffff,
              overviewB64: a.seratoOverviewB64,
            }
          : undefined;
        return {
          track: t,
          changes: {
            title: t.title,
            artist: t.artist,
            album: t.album,
            genre: t.genre,
            bpm: a?.beatGrid.bpm,
            key: a ? camelotToTraktorKey(a.key.camelot) : undefined,
            camelot: a?.key.camelot,
            serato,
          } satisfies TagEdits,
        };
      });
    const skipped = selectionArray.length - edits.length;
    if (edits.length === 0) {
      setWriting(false);
      setWriteStatus(`Nothing to write — only mp3 is supported (${skipped} non-mp3 skipped)`);
      return;
    }
    const results = await writeTagsBatch(edits, (done, total, cur) => {
      setWriteStatus(`Writing ${done}/${total}: ${cur.title}`);
    });
    const ok = results.filter((r) => r.result).length;
    const failed = results.length - ok;
    const modes = new Set(results.map((r) => r.result?.mode).filter(Boolean));
    if (modes.size === 1) setWriteMode([...modes][0] as WriteMode);
    setWriteStatus(
      `Done: ${ok} written, ${failed} failed${skipped ? `, ${skipped} skipped (non-mp3)` : ''}`
    );
    setWriting(false);
  }

  return (
    <div className="workshop">
      <div className="workshop-tabs">
        <button
          className={`workshop-tab ${tab === 'all' ? 'workshop-tab--active' : ''}`}
          onClick={() => setTab('all')}
        >
          Library ({tracks.length})
        </button>
        <button
          className={`workshop-tab ${tab === 'dupes' ? 'workshop-tab--active' : ''}`}
          onClick={() => setTab('dupes')}
        >
          Duplicates
        </button>
      </div>

      {tab === 'all' && (
        <LibraryTable
          tracks={tracks}
          selection={selection}
          editing={editing}
          onToggleSelect={handleToggleSelect}
          onToggleSelectAll={handleToggleSelectAll}
          onBeginEdit={(id, field) => setEditing({ id, field })}
          onCommitEdit={(id, field, v) => void handleCommitEdit(id, field, v)}
          onCancelEdit={() => setEditing(null)}
        />
      )}

      {tab === 'dupes' && (
        <DuplicatesPanel
          clusters={duplicates}
          onFocus={(id) => {
            setTab('all');
            setSelection(new Set([id]));
          }}
        />
      )}

      {tab === 'all' && (
        <>
          <BulkEditPanel
            selection={selectionArray}
            onApply={(p) => void handleBulkApply(p)}
            onWriteToFiles={() => void handleWriteToFiles()}
            onClear={() => setSelection(new Set())}
            writing={writing}
            writeMode={writeMode}
          />
          {selectionArray.length > 0 && (
            <div className="workshop-status" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="bulk-btn"
                onClick={() => setRenameOpen(true)}
                title="Bulk rename files by template"
              >
                ✎ Rename {selectionArray.length}…
              </button>
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                {`{artist} - {title} [{camelot} {bpm}]`}
              </span>
            </div>
          )}
        </>
      )}

      {writeStatus && (
        <div className="workshop-status">{writeStatus}</div>
      )}

      <RenameSheet
        open={renameOpen}
        selection={selectionArray}
        onClose={() => setRenameOpen(false)}
      />
    </div>
  );
}

function clampGain(db: number): number {
  return Math.max(-12, Math.min(12, db));
}

/**
 * Camelot code → common musical-key text for TKEY frame.
 * (Traktor / Rekordbox recognize both; we keep Camelot in a TXXX frame too.)
 */
function camelotToTraktorKey(camelot: string): string {
  const map: Record<string, string> = {
    '1A': 'G#m', '1B': 'B',
    '2A': 'D#m', '2B': 'F#',
    '3A': 'A#m', '3B': 'C#',
    '4A': 'Fm', '4B': 'G#',
    '5A': 'Cm', '5B': 'D#',
    '6A': 'Gm', '6B': 'A#',
    '7A': 'Dm', '7B': 'F',
    '8A': 'Am', '8B': 'C',
    '9A': 'Em', '9B': 'G',
    '10A': 'Bm', '10B': 'D',
    '11A': 'F#m', '11B': 'A',
    '12A': 'C#m', '12B': 'E',
  };
  return map[camelot] ?? '';
}
