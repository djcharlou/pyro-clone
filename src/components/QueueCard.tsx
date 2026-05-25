import type { AnalyzedTrack } from '@shared/types';

interface Props {
  track: AnalyzedTrack;
  /** 0..1 — used to interpolate the card color across the queue */
  tone: number;
  onRemove(): void;
  onMoveUp?(): void;
  onMoveDown?(): void;
  onPlayNow?(): void;
}

export function QueueCard({
  track,
  tone,
  onRemove,
  onMoveUp,
  onMoveDown,
  onPlayNow,
}: Props): JSX.Element {
  const bpm = track.analysis?.beatGrid.bpm;
  const key = track.analysis?.key.camelot;

  // Color goes from deep red at top of queue to amber at bottom
  const hue = lerp(5, 35, tone);
  const sat = lerp(80, 80, tone);
  const lit = lerp(48, 55, tone);
  const cardBg = `linear-gradient(90deg, hsl(${hue}, ${sat}%, ${lit}%), hsl(${hue + 6}, ${sat}%, ${lit + 4}%))`;

  return (
    <div className="qcard" style={{ background: cardBg }}>
      <div className="qcard-text">
        <div className="qcard-title">{track.title}</div>
        <div className="qcard-artist">{track.artist}</div>
      </div>
      <div className="qcard-meta">
        {bpm !== undefined && <span>{bpm.toFixed(0)}</span>}
        {key && <span>{key}</span>}
      </div>
      <div className="qcard-actions">
        {onPlayNow && (
          <button
            className="qcard-btn qcard-btn--play"
            onClick={onPlayNow}
            aria-label="Play now"
            title="Play now"
          >
            ▶
          </button>
        )}
        {onMoveUp && (
          <button
            className="qcard-btn"
            onClick={onMoveUp}
            aria-label="Move up"
            title="Move up"
          >
            ↑
          </button>
        )}
        {onMoveDown && (
          <button
            className="qcard-btn"
            onClick={onMoveDown}
            aria-label="Move down"
            title="Move down"
          >
            ↓
          </button>
        )}
        <button
          className="qcard-btn qcard-btn--remove"
          onClick={onRemove}
          aria-label="Remove from queue"
          title="Remove"
        >
          ⊖
        </button>
      </div>
    </div>
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
