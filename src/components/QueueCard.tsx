import type { AnalyzedTrack } from '@shared/types';

interface Props {
  track: AnalyzedTrack;
  /** 0..1 — match quality against the preceding track (1 = perfect). */
  matchScore: number | null;
  onRemove(): void;
  onMoveUp?(): void;
  onMoveDown?(): void;
  onPlayNow?(): void;
  /**
   * Reordering uses pointer events rather than HTML5 drag-and-drop:
   * WKWebView (which Tauri uses on macOS) does not fire the HTML5 drag
   * events reliably, and pointer events work on touch as well.
   */
  onGripPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  isDropTarget?: boolean;
  isDragging?: boolean;
  /** On the active deck right now. */
  isPlaying?: boolean;
  /** Already played this session — dimmed so the running order stays legible. */
  isPlayed?: boolean;
}

export function QueueCard({
  track,
  matchScore,
  onRemove,
  onMoveUp,
  onMoveDown,
  onPlayNow,
  onGripPointerDown,
  isDropTarget,
  isDragging,
  isPlaying,
  isPlayed,
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
    onGripPointerDown ? 'qcard--draggable' : '',
    isDragging ? 'qcard--dragging' : '',
    isDropTarget ? 'qcard--drop' : '',
    isPlaying ? 'qcard--playing' : '',
    isPlayed ? 'qcard--played' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{ background: cardBg }}
    >
      {onGripPointerDown && (
        <span
          className="qcard-grip"
          onPointerDown={onGripPointerDown}
          title="Drag to reorder"
          aria-label="Drag to reorder"
          role="button"
        >
          ⋮⋮
        </span>
      )}
      <div className="qcard-cover">
        {track.coverArtDataUrl ? (
          <img src={track.coverArtDataUrl} alt="" loading="lazy" />
        ) : (
          <span className="qcard-cover-fallback">♪</span>
        )}
      </div>
      <div className="qcard-text">
        <div className="qcard-title">
          {isPlaying && <span className="qcard-flag qcard-flag--live">▶ NOW</span>}
          {isPlayed && <span className="qcard-flag">PLAYED</span>}
          {track.title}
        </div>
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
