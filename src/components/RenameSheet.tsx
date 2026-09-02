import { useMemo, useState } from 'react';
import type { AnalyzedTrack } from '@shared/types';
import { buildPreview, applyRenames, type RenamePreview } from '@/library/renameTemplate';
import { store } from '@/db/IndexedDBStore';
import { useStore } from '@/state/store';
import { isTauri } from '@/library/itunes';

interface Props {
  open: boolean;
  selection: AnalyzedTrack[];
  onClose(): void;
}

const DEFAULT_TEMPLATE = '{artist} - {title} [{camelot} {bpm}]';

export function RenameSheet({ open, selection, onClose }: Props): JSX.Element | null {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<Array<{ trackId: string; ok: boolean; error?: string }>>([]);
  const updateTrackFields = useStore((s) => s.updateTrackFields);

  const previews: RenamePreview[] = useMemo(
    () => (open ? buildPreview(selection, template) : []),
    [open, selection, template]
  );

  const changedCount = previews.filter((p) => p.changed).length;
  const native = isTauri();

  if (!open) return null;

  async function handleApply(): Promise<void> {
    if (!native) {
      alert('Rename on disk requires the native (Tauri) app. In browser mode, this is preview only.');
      return;
    }
    setApplying(true);
    setResults([]);
    try {
      const res = await applyRenames(previews);
      setResults(res);
      // Update in-memory tracks + IDB for successful renames
      for (const r of res) {
        if (!r.ok || !r.newPath) continue;
        const track = selection.find((t) => t.id === r.trackId);
        if (!track) continue;
        const updated = { ...track, filePath: r.newPath };
        await store.upsertTrack(updated);
        updateTrackFields(r.trackId, {});
      }
    } catch (err) {
      alert(`Bulk rename failed: ${(err as Error).message}`);
    } finally {
      setApplying(false);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>Bulk rename ({selection.length})</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={{ padding: '0 18px 10px' }}>
          <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.5, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
            Template
          </label>
          <input
            type="text"
            className="sheet-filter"
            style={{ margin: 0, width: '100%', fontFamily: 'ui-monospace, monospace' }}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>
            Tokens: {'{artist} {title} {album} {genre} {bpm} {key} {camelot}'}
          </div>
        </div>

        <div className="sheet-list" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
          {previews.map((p) => {
            const result = results.find((r) => r.trackId === p.trackId);
            return (
              <div key={p.trackId} style={{
                padding: '8px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                color: p.changed ? '#fff' : 'rgba(255,255,255,0.4)',
              }}>
                <div style={{ opacity: 0.6, fontSize: 10 }}>{p.originalName}</div>
                <div style={{
                  color: result?.ok === false ? '#ff8a80'
                       : result?.ok ? '#7fff9d'
                       : p.changed ? '#ffd76a'
                       : 'rgba(255,255,255,0.4)',
                }}>
                  → {p.newName}
                  {result?.error && ` — ${result.error}`}
                  {result?.ok && ' ✓'}
                </div>
                {p.reason && <div style={{ color: '#ff8a80', fontSize: 10 }}>{p.reason}</div>}
              </div>
            );
          })}
        </div>

        <div className="sheet-commit-bar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', flex: 1 }}>
            {changedCount} will change{results.length > 0 ? ` · ${okCount} done, ${failCount} failed` : ''}
            {!native && ' · Preview only (Tauri required to rename on disk)'}
          </span>
          <button
            className="sheet-commit-btn"
            style={{ width: 'auto', padding: '10px 20px' }}
            onClick={() => void handleApply()}
            disabled={applying || changedCount === 0 || !native}
          >
            {applying ? 'Renaming…' : `Rename ${changedCount} files`}
          </button>
        </div>
      </div>
    </div>
  );
}
