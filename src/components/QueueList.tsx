import { useState } from 'react';
import type { AnalyzedTrack, ScoringWeights, SessionState } from '@shared/types';
import { QueueCard } from './QueueCard';
import { computeScore } from '@/selector/scoring';

interface Props {
  queueTracks: AnalyzedTrack[];
  currentTrack: AnalyzedTrack | null;
  session: SessionState;
  onRemove(id: string): void;
  onMove(fromIdx: number, toIdx: number): void;
  onPlayNow(id: string): void;
}

export function QueueList({
  queueTracks,
  currentTrack,
  session,
  onRemove,
  onMove,
  onPlayNow,
}: Props): JSX.Element {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

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
      {queueTracks.map((t, i) => {
        // Match score against the PREVIOUS track (or the currently-playing
        // track for the first queue slot). Null when we can't compute.
        const reference = i === 0 ? currentTrack : queueTracks[i - 1];
        const matchScore = computeMatchScore(reference, t, session);
        return (
          <QueueCard
            key={`${t.id}-${i}`}
            track={t}
            matchScore={matchScore}
            onRemove={() => onRemove(t.id)}
            onMoveUp={i > 0 ? () => onMove(i, i - 1) : undefined}
            onMoveDown={i < queueTracks.length - 1 ? () => onMove(i, i + 1) : undefined}
            onPlayNow={() => onPlayNow(t.id)}
            draggable
            isDragging={dragIdx === i}
            isDropTarget={dropIdx === i && dragIdx !== null && dragIdx !== i}
            onDragStart={(e) => {
              setDragIdx(i);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(i));
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dropIdx !== i) setDropIdx(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = Number(e.dataTransfer.getData('text/plain'));
              if (Number.isFinite(from) && from !== i) onMove(from, i);
              setDragIdx(null);
              setDropIdx(null);
            }}
            onDragEnd={() => {
              setDragIdx(null);
              setDropIdx(null);
            }}
          />
        );
      })}
    </div>
  );
}

/** Compute match score against a reference track, or null if inputs incomplete. */
function computeMatchScore(
  reference: AnalyzedTrack | null,
  candidate: AnalyzedTrack,
  session: SessionState
): number | null {
  if (!reference || !reference.analysis || !candidate.analysis) return null;
  const weights: ScoringWeights = session.weights;
  const totalPositive = weights.bpm + weights.key + weights.energy + weights.variety + weights.quality;
  const { score } = computeScore(candidate, {
    current: reference,
    historyTracks: [],
    weights,
    targetEnergy: session.targetEnergy,
  });
  // Normalize to 0..1 (score can be negative if recency penalty hits, but
  // for queue display we don't apply recency there — it's future material).
  return Math.max(0, Math.min(1, score / Math.max(0.1, totalPositive)));
}
