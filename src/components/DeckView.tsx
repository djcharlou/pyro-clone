import type { AnalyzedTrack } from '@shared/types';
import type { Deck } from '../audio/Deck';

interface Props {
  side: 'A' | 'B';
  isActive: boolean;
  track: AnalyzedTrack | null;
  deckRef: Deck | null;
}

export function DeckView({ side, isActive, track, deckRef }: Props): JSX.Element {
  const playing = deckRef?.isPlaying ?? false;
  const pos = deckRef?.positionSec() ?? 0;
  const dur = deckRef?.duration ?? track?.durationSec ?? 0;
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  const ratio = deckRef?.getStretchRatio() ?? 1;
  const stretched = Math.abs(ratio - 1) > 0.001;
  const effectiveBpm = (track?.analysis?.beatGrid.bpm ?? 0) * ratio;

  return (
    <div className={`deck deck--${side.toLowerCase()} ${isActive ? 'deck--active' : ''}`}>
      <div className="deck-head">
        <span className="deck-label">DECK {side}</span>
        {isActive && <span className="deck-tag">ACTIVE</span>}
        {playing && <span className="deck-tag deck-tag--playing">▶</span>}
      </div>
      {track ? (
        <>
          <div className="deck-title">{track.title}</div>
          <div className="deck-artist">{track.artist}</div>
          <div className="deck-meta">
            <span>
              {track.analysis?.beatGrid.bpm.toFixed(1) ?? '—'} BPM
              {stretched && (
                <span className="deck-stretch" title={`Stretched to ${effectiveBpm.toFixed(1)} BPM (${((ratio - 1) * 100).toFixed(1)}%)`}>
                  {' '}→ {effectiveBpm.toFixed(1)}
                </span>
              )}
            </span>
            <span>{track.analysis?.key.camelot ?? '—'}</span>
            <span>
              {track.analysis ? (track.analysis.energy.mean * 100).toFixed(0) + '%' : '—'}
            </span>
          </div>
          <div className="deck-progress">
            <div className="deck-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="deck-time">
            {formatTime(pos)} / {formatTime(dur)}
          </div>
          {track.analysis && (
            <div className="deck-cues">
              <span title="Mix in">In: {formatTime(track.analysis.cues.mixInPoint)}</span>
              <span title="Mix out">Out: {formatTime(track.analysis.cues.mixOutPoint)}</span>
            </div>
          )}
        </>
      ) : (
        <div className="deck-empty">— No track loaded —</div>
      )}
    </div>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
