import type { AnalyzedTrack } from '@shared/types';
import type { Deck } from '@/audio/Deck';
import { KeyBadge } from './KeyBadge';
import { pitchedKey } from '@shared/pitchKey';

interface Props {
  side: 'A' | 'B';
  deck: Deck | null;
  track: AnalyzedTrack | null;
  playing: boolean;
  positionSec: number;
  durationSec: number;
  onPlayPause(): void;
  onCue(): void;
  onSync(): void;
  onLoad(): void;
  syncNote?: string | null;
  synced?: boolean;
}

/**
 * The information row under a deck's waveform.
 *
 * Reads left to right the way you need it mid-mix: what is playing, what key
 * it is *now* (which is not the tagged key once the pitch fader has moved),
 * how fast, how energetic, how much is left.
 */
export function DeckStrip({
  side,
  deck,
  track,
  playing,
  positionSec,
  durationSec,
  onPlayPause,
  onCue,
  onSync,
  onLoad,
  syncNote = null,
  synced = false,
}: Props): JSX.Element {
  const analysis = track?.analysis;
  const ratio = deck?.getStretchRatio() ?? 1;
  const pk = analysis ? pitchedKey(analysis.key, ratio) : null;
  const liveBpm = analysis ? analysis.beatGrid.bpm * ratio : null;
  const energy10 = analysis ? Math.round(analysis.energy.mean * 10) : null;

  return (
    <div className={`dstrip dstrip--${side.toLowerCase()}`}>
      <button
        className={`dstrip-play ${playing ? 'dstrip-play--on' : ''}`}
        onClick={onPlayPause}
        disabled={!track}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        <span className={playing ? 'dstrip-icon-pause' : 'dstrip-icon-play'} />
      </button>

      <div className="dstrip-title" title={track ? `${track.artist} — ${track.title}` : undefined}>
        {track ? `${track.artist} - ${track.title}` : 'No track loaded'}
      </div>

      <div className="dstrip-meta">
        {pk ? (
          <>
            {/* When the pitch has moved the track off its written key, show
                the move explicitly rather than quietly displaying the tag. */}
            {pk.shifted ? (
              <span className="dstrip-keyshift">
                <KeyBadge camelot={analysis!.key.camelot} size="sm" dim />
                <span className="dstrip-arrow">→</span>
                <KeyBadge camelot={pk.key.camelot} size="sm" />
                <span className="dstrip-semitones">
                  {pk.semitones > 0 ? '+' : ''}{Math.round(pk.semitones)} semitone
                  {Math.abs(Math.round(pk.semitones)) === 1 ? '' : 's'}
                </span>
              </span>
            ) : (
              <>
                <KeyBadge camelot={analysis!.key.camelot} />
                <span className="dstrip-keyname">{keyName(pk.key.root, pk.key.scale)}</span>
              </>
            )}
            <span className="dstrip-stat">
              <em>Tempo</em> {liveBpm!.toFixed(liveBpm! % 1 === 0 ? 0 : 1)}
            </span>
            <span className="dstrip-stat"><em>Energy</em> {energy10}</span>
          </>
        ) : (
          <span className="dstrip-empty">Press LOAD to bring in the next queued track</span>
        )}
        <span className="dstrip-time">
          {fmt(positionSec)} / {fmt(durationSec)}
        </span>
      </div>

      <div className="dstrip-actions">
        <button className={`dstrip-btn ${synced ? 'dstrip-btn--on' : ''}`} onClick={onSync} disabled={!track}
                title="Match tempo and beat phase to the other deck">
          Sync
        </button>
        <button className="dstrip-btn" onClick={onCue} disabled={!track} title="Jump to the mix-in point">
          Cue
        </button>
        <button className="dstrip-btn" onClick={onLoad} title="Load the next queued track onto this deck">
          Load
        </button>
      </div>

      {syncNote && <div className="dstrip-note">{syncNote}</div>}
    </div>
  );
}

function keyName(root: string, scale: string): string {
  const spoken = root.replace('#', '-sharp');
  return `${spoken} ${scale === 'minor' ? 'Minor' : 'Major'}`;
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
