import type { AnalyzedTrack } from '@shared/types';
import type { Deck } from '@/audio/Deck';
import { Waveform } from '../Waveform';
import { JogWheel } from './JogWheel';
import { Fader } from './Fader';

interface Props {
  side: 'A' | 'B';
  deck: Deck | null;
  track: AnalyzedTrack | null;
  /** Deck currently feeding the auto-mix, highlighted. */
  isActive: boolean;
  /** Bumped by the parent's animation tick to force a repaint. */
  tick: number;
  onPlayPause(): void;
  onCue(): void;
  onSeekFraction(f: number): void;
  onPitchChange(percent: number): void;
  onNudge(delta: number): void;
  onLoadFromQueue(): void;
}

const ACCENT: Record<'A' | 'B', string> = { A: '#ff9d4d', B: '#5fd3d0' };

export function DeckPanel({
  side,
  deck,
  track,
  isActive,
  onPlayPause,
  onCue,
  onSeekFraction,
  onPitchChange,
  onNudge,
  onLoadFromQueue,
}: Props): JSX.Element {
  const playing = deck?.isPlaying ?? false;
  const position = deck?.positionSec() ?? 0;
  const duration = deck?.duration ?? track?.durationSec ?? 0;
  const progress = duration > 0 && Number.isFinite(position)
    ? Math.max(0, Math.min(1, position / duration))
    : 0;
  const pitch = deck?.getPitchPercent() ?? 0;
  const baseBpm = track?.analysis?.beatGrid.bpm;
  const liveBpm = baseBpm !== undefined ? baseBpm * (1 + pitch / 100) : undefined;
  const accent = ACCENT[side];

  return (
    <section className={`deckp ${isActive ? 'deckp--active' : ''}`}>
      <header className="deckp-head">
        <span className="deckp-id" style={{ background: accent }}>{side}</span>
        <div className="deckp-title-wrap">
          <div className="deckp-title">{track?.title ?? 'No track loaded'}</div>
          <div className="deckp-artist">{track?.artist ?? '—'}</div>
        </div>
        {isActive && track && <span className="deckp-live">LIVE</span>}
      </header>

      <div className="deckp-wave">
        <Waveform
          peaks={track?.analysis?.waveform}
          progress={progress}
          height={70}
          playedColor={accent}
          remainingColor="rgba(255,255,255,0.28)"
          onScrub={track ? onSeekFraction : undefined}
        />
        <div className="deckp-times">
          <span>{fmt(position)}</span>
          <span>-{fmt(Math.max(0, duration - position))}</span>
        </div>
      </div>

      <div className={`deckp-meta ${track ? '' : 'deckp-meta--empty'}`}>
        {track ? (
          <>
            <span className="deckp-bpm">
              {liveBpm !== undefined ? liveBpm.toFixed(1) : '—'}
              <em> BPM</em>
            </span>
            {baseBpm !== undefined && Math.abs(pitch) > 0.05 && (
              <span className="deckp-basebpm">was {baseBpm.toFixed(1)}</span>
            )}
            {track.analysis && <span className="deckp-key">{track.analysis.key.camelot}</span>}
          </>
        ) : (
          <span className="deckp-hint">Press LOAD to pull the next queued track onto this deck</span>
        )}
      </div>

      <div className="deckp-body">
        <JogWheel
          positionSec={position}
          playing={playing}
          size={140}
          accent={accent}
          onNudge={onNudge}
          onTap={onPlayPause}
        />
        <Fader
          label="PITCH"
          value={pitch}
          min={-8}
          max={8}
          center={0}
          centerDetent
          length={140}
          format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
          onChange={onPitchChange}
        />
      </div>

      <div className="deckp-transport">
        <button className="deckp-btn" onClick={onCue} disabled={!track} title="Jump to the mix-in point">
          CUE
        </button>
        <button
          className={`deckp-btn deckp-btn--play ${playing ? 'deckp-btn--on' : ''}`}
          onClick={onPlayPause}
          disabled={!track}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="deckp-btn" onClick={onLoadFromQueue} title="Load the next queued track onto this deck">
          LOAD
        </button>
      </div>
    </section>
  );
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
