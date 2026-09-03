import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Track currently on the active deck — highlighted, not dimmed. */
  playingId?: string | null;
}

export function QueueList({
  queueTracks,
  currentTrack,
  session,
  onRemove,
  onMove,
  onPlayNow,
  playingId = null,
}: Props): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  // Pointer state lives in a ref: the window listeners are installed once
  // per drag and must not close over stale React state.
  const drag = useRef<{ from: number; startY: number; started: boolean } | null>(null);

  /** Which row index a given viewport Y falls on. */
  const indexAtY = useCallback((clientY: number): number | null => {
    const list = listRef.current;
    if (!list) return null;
    const cards = [...list.querySelectorAll('.qcard')];
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return i;
    }
    // Past either end: clamp so dragging off the list still lands somewhere.
    if (cards.length === 0) return null;
    const first = cards[0].getBoundingClientRect();
    return clientY < first.top ? 0 : cards.length - 1;
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
    setDragIdx(null);
    setDropIdx(null);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', endDrag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      // Small threshold so a plain click on a card button is never read as
      // the start of a reorder.
      if (!d.started) {
        if (Math.abs(e.clientY - d.startY) < 4) return;
        d.started = true;
        setDragIdx(d.from);
      }
      e.preventDefault();
      const over = indexAtY(e.clientY);
      if (over !== null) setDropIdx(over);
    },
    [indexAtY]
  );

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (d?.started) {
        const to = indexAtY(e.clientY);
        if (to !== null && to !== d.from) onMove(d.from, to);
      }
      endDrag();
    },
    [indexAtY, onMove, endDrag]
  );

  // Listeners are attached on drag start; make sure nothing leaks if the
  // component unmounts mid-drag.
  useEffect(() => endDrag, [endDrag]);

  function beginDrag(index: number, e: React.PointerEvent): void {
    drag.current = { from: index, startY: e.clientY, started: false };
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', endDrag);
  }

  if (queueTracks.length === 0) {
    return (
      <div className="queue-empty">
        Queue is empty — tap <strong>+</strong> to add tracks, or turn on
        Auto-mix and the engine will pick what's next.
      </div>
    );
  }

  return (
    <div className="queue-list" ref={listRef}>
      {queueTracks.map((t, i) => {
        // Match score against the PREVIOUS track (or the currently-playing
        // track for the first queue slot). Null when we can't compute.
        const reference = i === 0 ? currentTrack : queueTracks[i - 1];
        const matchScore = computeMatchScore(reference, t, session);
        // The queue behaves like a playlist: entries stay put after they
        // play. Without a visual cue the list looks like it is repeating
        // itself, so mark what is done and what is on the deck right now.
        const isPlaying = t.id === playingId;
        const isPlayed = !isPlaying && session.history.includes(t.id);
        return (
          <QueueCard
            key={`${t.id}-${i}`}
            track={t}
            matchScore={matchScore}
            isPlaying={isPlaying}
            isPlayed={isPlayed}
            onRemove={() => onRemove(t.id)}
            onMoveUp={i > 0 ? () => onMove(i, i - 1) : undefined}
            onMoveDown={i < queueTracks.length - 1 ? () => onMove(i, i + 1) : undefined}
            onPlayNow={() => onPlayNow(t.id)}
            isDragging={dragIdx === i}
            isDropTarget={dropIdx === i && dragIdx !== null && dragIdx !== i}
            onGripPointerDown={(e) => beginDrag(i, e)}
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
