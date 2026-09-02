import type { AnalyzedTrack } from '@shared/types';

interface Props {
  track: AnalyzedTrack;
  /** 0..1 — match quality against the preceding track (1 = perfect). */
  matchScore: number | null;
  onRemove(): void;
  onMoveUp?(): void;
  onMoveDown?(): void;
  onPlayNow?(): void;
  /** HTML5 drag props (desktop). */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  isDropTarget?: boolean;
  isDragging?: boolean;
}

export function QueueCard({
  track,
  matchScore,
  onRemove,
  onMoveUp,
  onMoveDown,
  onPlayNow,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDropTarget,
  isDragging,
}: Props): JSX.Element {
  const bpm = track.analysis?.beatGrid.bpm;
  const key = track.analysis?.key.camelot;

  // Color by match quality — restrained: red-orange for low, warm amber
  // for good, and a muted olive for excellent (not neon green).
  //   0.0 → red (hue 5), 0.5 → amber (hue 32), 1.0 → warm olive (hue 55)
  const t = matchScore === null ? 0.5 : Math.max(0, Math.min(1, matchScore));
  const hue = lerp(5, 55, t);
  const sat = lerp(78, 58, t);
  const lit = lerp(46, 42, t);
  const cardBg = `linear-gradient(90deg, hsl(${hue}, ${sat}%, ${lit}%), hsl(${hue + 6}, ${sat}%, ${lit + 3}%))`;
  const badgeText = matchScore === null ? '—' : `${Math.round(matchScore * 100)}`;

  const classes = [
    'qcard',
    draggable ? 'qcard--draggable' : '',
    isDragging ? 'qcard--dragging' : '',
    isDropTarget ? 'qcard--drop' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{ background: cardBg }}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {draggable && <span className="qcard-grip" aria-hidden="true">⋮⋮</span>}
      <div className="qcard-cover">
        {track.coverArtDataUrl ? (
          <img src={track.coverArtDataUrl} alt="" loading="lazy" />
        ) : (
          <span className="qcard-cover-fallback">♪</span>
        )}
      </div>
      <div className="qcard-text">
        <div className="qcard-title">{track.title}</div>
        <div className="qcard-artist">{track.artist}</div>
      </div>
      <div className="qcard-meta">
        {bpm !== undefined && <span>{bpm.toFixed(0)}</span>}
        {key && <span>{key}</span>}
      </div>
      <div
        className="qcard-score"
        title={`Match score vs previous track: ${badgeText}/100`}
      >
        {badgeText}
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
