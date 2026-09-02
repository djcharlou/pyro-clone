import { useMemo, useState } from 'react';
import type { AnalyzedTrack } from '@shared/types';

type SortKey =
  | 'title' | 'artist' | 'album' | 'genre'
  | 'bpm' | 'key' | 'energy' | 'duration' | 'added';
type SortDir = 'asc' | 'desc';

interface Props {
  tracks: AnalyzedTrack[];
  selection: Set<string>;
  editing: { id: string; field: EditableField } | null;
  onToggleSelect(id: string, mode?: 'single' | 'multi' | 'range'): void;
  onToggleSelectAll(): void;
  onBeginEdit(id: string, field: EditableField): void;
  onCommitEdit(id: string, field: EditableField, value: string): void;
  onCancelEdit(): void;
}

export type EditableField = 'title' | 'artist' | 'album' | 'genre';

export function LibraryTable({
  tracks,
  selection,
  editing,
  onToggleSelect,
  onToggleSelectAll,
  onBeginEdit,
  onCommitEdit,
  onCancelEdit,
}: Props): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState('');

  const sorted = useMemo(() => {
    const filtered = filter.trim()
      ? tracks.filter((t) => matchesFilter(t, filter.trim()))
      : tracks;
    const arr = [...filtered];
    arr.sort((a, b) => cmp(a, b, sortKey) * (sortDir === 'asc' ? 1 : -1));
    return arr;
  }, [tracks, sortKey, sortDir, filter]);

  const allSelected = sorted.length > 0 && sorted.every((t) => selection.has(t.id));

  function toggleSort(k: SortKey): void {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(k);
      setSortDir('asc');
    }
  }

  return (
    <div className="lib-wrap">
      <div className="lib-toolbar">
        <input
          type="text"
          placeholder="Filter title / artist / album / genre…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="lib-filter"
        />
        <span className="lib-count">
          {sorted.length}{filter ? ` / ${tracks.length}` : ''} tracks
          {selection.size > 0 && ` · ${selection.size} selected`}
        </span>
      </div>

      <div className="lib-scroll">
        <table className="lib-table">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <Sortable label="Title" k="title" cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <Sortable label="Artist" k="artist" cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <Sortable label="Album" k="album" cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <Sortable label="Genre" k="genre" cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <Sortable label="BPM" k="bpm" cur={sortKey} dir={sortDir} onClick={toggleSort} num />
              <Sortable label="Key" k="key" cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <Sortable label="Nrg" k="energy" cur={sortKey} dir={sortDir} onClick={toggleSort} num />
              <Sortable label="Dur" k="duration" cur={sortKey} dir={sortDir} onClick={toggleSort} num />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="lib-empty">
                  {tracks.length === 0
                    ? 'No tracks — use "+ Import" in the header'
                    : `No tracks match "${filter}"`}
                </td>
              </tr>
            )}
            {sorted.map((t) => (
              <Row
                key={t.id}
                track={t}
                selected={selection.has(t.id)}
                editing={editing?.id === t.id ? editing.field : null}
                onToggleSelect={(mode) => onToggleSelect(t.id, mode)}
                onBeginEdit={(field) => onBeginEdit(t.id, field)}
                onCommitEdit={(field, value) => onCommitEdit(t.id, field, value)}
                onCancelEdit={onCancelEdit}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface SortableProps {
  label: string;
  k: SortKey;
  cur: SortKey;
  dir: SortDir;
  onClick(k: SortKey): void;
  num?: boolean;
}

function Sortable({ label, k, cur, dir, onClick, num }: SortableProps): JSX.Element {
  const active = k === cur;
  return (
    <th
      className={`lib-th ${num ? 'lib-th--num' : ''} ${active ? 'lib-th--active' : ''}`}
      onClick={() => onClick(k)}
    >
      {label}
      {active && (dir === 'asc' ? ' ↑' : ' ↓')}
    </th>
  );
}

interface RowProps {
  track: AnalyzedTrack;
  selected: boolean;
  editing: EditableField | null;
  onToggleSelect(mode?: 'single' | 'multi' | 'range'): void;
  onBeginEdit(field: EditableField): void;
  onCommitEdit(field: EditableField, value: string): void;
  onCancelEdit(): void;
}

function Row({
  track: t,
  selected,
  editing,
  onToggleSelect,
  onBeginEdit,
  onCommitEdit,
  onCancelEdit,
}: RowProps): JSX.Element {
  const a = t.analysis;
  return (
    <tr className={selected ? 'lib-row lib-row--selected' : 'lib-row'}>
      <td className="col-check">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect(e.nativeEvent instanceof MouseEvent && (e.nativeEvent as MouseEvent).shiftKey ? 'range' : 'multi')}
          onClick={(e) => {
            if ((e as unknown as React.MouseEvent).shiftKey) onToggleSelect('range');
          }}
          aria-label="Select row"
        />
      </td>
      <Cell value={t.title} editing={editing === 'title'}
        onBegin={() => onBeginEdit('title')}
        onCommit={(v) => onCommitEdit('title', v)}
        onCancel={onCancelEdit}
      />
      <Cell value={t.artist} editing={editing === 'artist'}
        onBegin={() => onBeginEdit('artist')}
        onCommit={(v) => onCommitEdit('artist', v)}
        onCancel={onCancelEdit}
      />
      <Cell value={t.album ?? ''} editing={editing === 'album'}
        onBegin={() => onBeginEdit('album')}
        onCommit={(v) => onCommitEdit('album', v)}
        onCancel={onCancelEdit}
      />
      <Cell value={t.genre ?? ''} editing={editing === 'genre'}
        onBegin={() => onBeginEdit('genre')}
        onCommit={(v) => onCommitEdit('genre', v)}
        onCancel={onCancelEdit}
      />
      <td className="lib-num">{a ? a.beatGrid.bpm.toFixed(0) : '—'}</td>
      <td className="lib-key">{a?.key.camelot ?? '—'}</td>
      <td className="lib-num">{a ? Math.round(a.energy.mean * 10) : '—'}</td>
      <td className="lib-num">{fmtDur(t.durationSec)}</td>
    </tr>
  );
}

interface CellProps {
  value: string;
  editing: boolean;
  onBegin(): void;
  onCommit(v: string): void;
  onCancel(): void;
}

function Cell({ value, editing, onBegin, onCommit, onCancel }: CellProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  if (editing) {
    return (
      <td className="lib-cell lib-cell--edit">
        <input
          type="text"
          defaultValue={value}
          autoFocus
          onFocus={(e) => {
            setDraft(value);
            e.currentTarget.select();
          }}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit(draft);
            else if (e.key === 'Escape') onCancel();
          }}
          onBlur={() => onCommit(draft)}
        />
      </td>
    );
  }
  return (
    <td className="lib-cell" onDoubleClick={onBegin} title="Double-click to edit">
      {value || <span className="lib-cell-empty">—</span>}
    </td>
  );
}

function matchesFilter(t: AnalyzedTrack, q: string): boolean {
  const s = q.toLowerCase();
  return (
    t.title.toLowerCase().includes(s) ||
    t.artist.toLowerCase().includes(s) ||
    (t.album?.toLowerCase().includes(s) ?? false) ||
    (t.genre?.toLowerCase().includes(s) ?? false) ||
    (t.analysis?.key.camelot.toLowerCase().includes(s) ?? false)
  );
}

function cmp(a: AnalyzedTrack, b: AnalyzedTrack, key: SortKey): number {
  switch (key) {
    case 'title': return a.title.localeCompare(b.title);
    case 'artist': return a.artist.localeCompare(b.artist);
    case 'album': return (a.album ?? '').localeCompare(b.album ?? '');
    case 'genre': return (a.genre ?? '').localeCompare(b.genre ?? '');
    case 'bpm': return (a.analysis?.beatGrid.bpm ?? 0) - (b.analysis?.beatGrid.bpm ?? 0);
    case 'key': return (a.analysis?.key.camelot ?? '').localeCompare(b.analysis?.key.camelot ?? '');
    case 'energy': return (a.analysis?.energy.mean ?? 0) - (b.analysis?.energy.mean ?? 0);
    case 'duration': return a.durationSec - b.durationSec;
    case 'added': return a.addedAt - b.addedAt;
  }
}

function fmtDur(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
