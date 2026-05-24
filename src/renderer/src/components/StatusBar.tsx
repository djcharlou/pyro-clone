import { useStore } from '../state/store';

export function StatusBar(): JSX.Element {
  const importState = useStore((s) => s.importState);
  const analyzingCount = useStore((s) => s.analyzingIds.size);
  const tracks = useStore((s) => s.tracks);
  const analyzed = tracks.filter((t) => t.analysis).length;

  return (
    <footer className="status-bar">
      <span>
        {tracks.length} tracks · {analyzed} analyzed
        {analyzingCount > 0 && ` · analyzing ${analyzingCount}…`}
      </span>
      {importState.running && (
        <span>Importing: {importState.lastTrackTitle || '…'}</span>
      )}
      {!importState.running && importState.added > 0 && (
        <span>
          Imported: {importState.added} added, {importState.failed} failed
        </span>
      )}
    </footer>
  );
}
