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
  onMixNow?(): void;
  onNextRecommended?(): void;
  onSeekFraction(x: number): void;

  nextTrack?: AnalyzedTrack | null;
  nextPositionSec?: number;
  nextDurationSec?: number;
  nextIsPlaying?: boolean;
  nextStretchRatio?: number;

  autoMixInSec?: number | null;
  autoMixOn?: boolean;
}

/**
 * Redesigned NowPlaying — waveform is the visual hero, always at the top,
 * always full-width, always visible. Meta info + controls flow below.
 *
 * Layout:
 *   ┌────────────────────────────────────────┐
 *   │              WAVEFORM (100px)          │  ← scrubs, playhead, hover
 *   │  0:12   ⚡ mix in 2:14         −3:24    │
 *   ├────────────────────────────────────────┤
 *   │  [cover] 083 – Village People – YMCA  │
 *   │          Unknown Artist               │
 *   │          126 BPM  ·  2A  ·  7/10      │
 *   │                                        │
 *   │  ────  [❚❚]     [▶▶]     ────         │
 *   │        Play      Skip                 │
 *   │  ┌ Mix now ┐  ┌ Next best match ┐     │
 *   └────────────────────────────────────────┘
 */
export function NowPlaying({
  track,
  playing,
  positionSec,
  durationSec,
  effectiveBpm,
  stretchRatio,
  onPlayPause,
  onSkip,
  onMixNow,
  onNextRecommended,
  onSeekFraction,
  nextTrack,
  nextPositionSec = 0,
  nextDurationSec = 0,
  nextIsPlaying = false,
  nextStretchRatio = 1,
  autoMixInSec = null,
  autoMixOn = false,
}: Props): JSX.Element {
  const progress = durationSec > 0 && Number.isFinite(positionSec)
    ? Math.max(0, Math.min(1, positionSec / durationSec))
    : 0;
  const nextProgress = nextDurationSec > 0 && Number.isFinite(nextPositionSec)
    ? Math.max(0, Math.min(1, nextPositionSec / nextDurationSec))
    : 0;
  const inMix = !!nextTrack && nextIsPlaying;
  const coverUrl = track?.coverArtDataUrl;

  return (
    <section className={`now-playing ${playing ? 'now-playing--playing' : ''} ${inMix ? 'now-playing--mixing' : ''}`}>
      {coverUrl && (
        <div
          className="np-backdrop"
          style={{ backgroundImage: `url("${coverUrl}")` }}
          aria-hidden="true"
        />
      )}

      {/* ---- Waveform (always visible, always at top) --------------------- */}
      <div className="np-wave-region">
        <Waveform
          peaks={track?.analysis?.waveform}
          progress={progress}
          height={inMix ? 78 : 110}
          playedColor="#ffffff"
          remainingColor="rgba(255,255,255,0.4)"
          onScrub={track ? onSeekFraction : undefined}
        />
        <div className="np-times">
          <span>{formatTime(positionSec)}</span>
          {autoMixOn && autoMixInSec !== null && autoMixInSec > 0 && !inMix && (
            <span className="np-countdown">⚡ mix in {formatCountdown(autoMixInSec)}</span>
          )}
          {inMix && <span className="np-mixing-badge">⇄ MIXING</span>}
          <span>-{formatTime(Math.max(0, durationSec - positionSec))}</span>
        </div>
      </div>

      {/* ---- Second deck waveform (only during a live mix) --------------- */}
      {inMix && nextTrack && (
        <div className="np-wave-region np-wave-region--next">
          <div className="np-next-head">
            <span className="np-next-label">NEXT</span>
            <span className="np-next-title">{nextTrack.title}</span>
            {nextTrack.analysis && (
              <span className="np-next-bpm">
                {(nextTrack.analysis.beatGrid.bpm * nextStretchRatio).toFixed(0)} BPM · {nextTrack.analysis.key.camelot}
              </span>
            )}
          </div>
          <Waveform
            peaks={nextTrack.analysis?.waveform}
            progress={nextProgress}
            height={60}
            playedColor="#7fff9d"
            remainingColor="rgba(127,255,157,0.35)"
          />
        </div>
      )}

      {/* ---- Track meta + cover ------------------------------------------ */}
      <div className="np-info">
        <div className={`np-cover ${playing ? 'np-cover--playing' : ''}`}>
          {coverUrl ? <img src={coverUrl} alt="" /> : <div className="np-cover-fallback">♪</div>}
        </div>
        <div className="np-text">
          <div className="np-title">{track?.title ?? 'No track playing'}</div>
          <div className="np-artist">{track?.artist ?? '—'}</div>
          {track?.analysis && (
            <div className="np-chips">
              <span className="np-chip np-chip--bpm">
                {(effectiveBpm ?? track.analysis.beatGrid.bpm).toFixed(0)} BPM
                {Math.abs(stretchRatio - 1) > 0.001 && (
                  <span className="np-stretch">
                    {' '}({stretchRatio > 1 ? '+' : ''}{((stretchRatio - 1) * 100).toFixed(1)}%)
                  </span>
                )}
              </span>
              <span className="np-chip np-chip--key">{track.analysis.key.camelot}</span>
              <span className="np-chip">{Math.round(track.analysis.energy.mean * 10)}/10</span>
            </div>
          )}
        </div>
      </div>

      {/* ---- Transport --------------------------------------------------- */}
      <div className="np-transport">
        <button
          className="np-btn np-btn--secondary"
          onClick={onPlayPause}
          disabled={!track && !nextTrack}
          aria-label={playing ? 'Pause' : 'Play'}
          title={!track && !nextTrack ? 'Add a track to your queue first' : (playing ? 'Pause' : 'Play')}
        >
          {playing ? PauseIcon : PlayIcon}
        </button>
        <button
          className="np-btn np-btn--primary"
          onClick={onSkip}
          disabled={!track}
          aria-label="Skip to next"
          title="Quick 8-beat beat-matched fade to next"
        >
          {NextIcon}
        </button>
      </div>

      {(onMixNow || onNextRecommended) && (
        <div className="np-actions">
          {onMixNow && (
            <button
              className="np-action-btn np-action-btn--primary"
              onClick={onMixNow}
              disabled={!track || inMix}
              title="Smooth 32-beat beat-matched crossfade to the next track"
            >
              🎚️ Mix now
            </button>
          )}
          {onNextRecommended && (
            <button
              className="np-action-btn"
              onClick={onNextRecommended}
              disabled={!track || inMix}
              title="Ignore queue — pick the best match from the library and mix"
            >
              ✨ Next best match
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatCountdown(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  return `${Math.ceil(sec)}s`;
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
