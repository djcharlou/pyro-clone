import type { AnalyzedTrack } from '@shared/types';
import { QueueCard } from './QueueCard';

interface Props {
  queueTracks: AnalyzedTrack[];
  onRemove(id: string): void;
  onMove(fromIdx: number, toIdx: number): void;
  onPlayNow(id: string): void;
}

export function QueueList({
  queueTracks,
  onRemove,
  onMove,
  onPlayNow,
}: Props): JSX.Element {
  if (queueTracks.length === 0) {
    return (
      <div className="queue-empty">
        Queue is empty — tap <strong>+</strong> to add tracks, or turn on
        Auto-mix and the engine will pick what's next.
      </div>
    );
  }

  return (
    <div className="queue-list">
      {queueTracks.map((t, i) => (
        <QueueCard
          key={`${t.id}-${i}`}
          track={t}
          tone={queueTracks.length === 1 ? 0 : i / (queueTracks.length - 1)}
          onRemove={() => onRemove(t.id)}
          onMoveUp={i > 0 ? () => onMove(i, i - 1) : undefined}
          onMoveDown={i < queueTracks.length - 1 ? () => onMove(i, i + 1) : undefined}
          onPlayNow={() => onPlayNow(t.id)}
        />
      ))}
    </div>
  );
}
