import type { AnalyzedTrack } from '@shared/types';
import { Waveform } from './Waveform';

interface Props {
  track: AnalyzedTrack | null;
  playing: boolean;
  positionSec: number;
  durationSec: number;
  effectiveBpm: number | null;
  stretchRatio: number;
  onPlayPause(): void;
  onSkip(): void;
  onSeekFraction(x: number): void;
}

export function NowPlaying({
  track,
  playing,
  positionSec,
  durationSec,
  effectiveBpm,
  stretchRatio,
  onPlayPause,
  onSkip,
  onSeekFraction,
}: Props): JSX.Element {
  const progress = durationSec > 0 ? positionSec / durationSec : 0;

  return (
    <section className="now-playing">
      <div className="np-title-row">
        <div className="np-text">
          <div className="np-title">{track?.title ?? 'No track playing'}</div>
          <div className="np-artist">{track?.artist ?? '—'}</div>
        </div>
        <div className="np-meta">
          {track?.analysis && (
            <>
              <span className="np-bpm">
                {(effectiveBpm ?? track.analysis.beatGrid.bpm).toFixed(0)} BPM
                {Math.abs(stretchRatio - 1) > 0.001 && (
                  <span className="np-stretch"> ({stretchRatio > 1 ? '+' : ''}{((stretchRatio - 1) * 100).toFixed(1)}%)</span>
                )}
              </span>
              <span className="np-key">{track.analysis.key.camelot}</span>
            </>
          )}
        </div>
      </div>

      <div
        className="np-waveform-wrap"
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          onSeekFraction((e.clientX - rect.left) / rect.width);
        }}
      >
        <Waveform peaks={track?.analysis?.waveform} progress={progress} height={64} />
      </div>

      <div className="np-times">
        <span>{formatTime(positionSec)}</span>
        <span>-{formatTime(Math.max(0, durationSec - positionSec))}</span>
      </div>

      <div className="np-transport">
        <button
          className="np-btn np-btn--secondary"
          onClick={onPlayPause}
          disabled={!track}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? PauseIcon : PlayIcon}
        </button>
        <button
          className="np-btn np-btn--primary"
          onClick={onSkip}
          disabled={!track}
          aria-label="Skip to next"
        >
          {NextIcon}
        </button>
      </div>
    </section>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const PlayIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const PauseIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
    <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
  </svg>
);
const NextIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
    <path d="M6 6l8.5 6L6 18V6zm10 0h2v12h-2z" />
  </svg>
);
