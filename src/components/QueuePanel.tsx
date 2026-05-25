import type {
  AnalyzedTrack,
  SelectionResult,
  SessionState,
} from '@shared/types';

interface Props {
  lastPick: SelectionResult | null;
  session: SessionState;
  tracks: AnalyzedTrack[];
}

export function QueuePanel({ lastPick, session, tracks }: Props): JSX.Element {
  const tracksById = new Map(tracks.map((t) => [t.id, t]));
  const history = session.history.slice(-12).reverse();

  return (
    <aside className="queue-panel">
      <h2>Selector</h2>
      {lastPick ? (
        <div className="last-pick">
          <div className="last-pick-title">{lastPick.track.title}</div>
          <div className="last-pick-artist">{lastPick.track.artist}</div>
          <div className="last-pick-score">
            score: <strong>{lastPick.score.toFixed(3)}</strong> · mode: {lastPick.mode}
          </div>
          <div className="last-pick-reason">{lastPick.reasoning}</div>
        </div>
      ) : (
        <div className="last-pick last-pick--empty">No pick yet.</div>
      )}

      <h3>Session</h3>
      <div className="session-meta">
        <div>Target energy: {(session.targetEnergy * 100).toFixed(0)}%</div>
        <div>History: {session.history.length} tracks</div>
      </div>

      <h3>Recent</h3>
      <ol className="history-list">
        {history.length === 0 && <li className="history-empty">—</li>}
        {history.map((id, idx) => {
          const t = tracksById.get(id);
          return (
            <li key={`${id}-${idx}`}>
              {t ? `${t.artist} — ${t.title}` : `(missing) ${id}`}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
