import { useEffect, useMemo, useState } from 'react';
import type { AnalyzedTrack } from '@shared/types';
import type { AudioEngine } from '@/audio/AudioEngine';
import { DeckWaveform } from './DeckWaveform';
import { DeckStrip } from './DeckStrip';
import { Fader } from './Fader';
import { Knob } from './Knob';
import { LibraryBrowser } from './LibraryBrowser';

interface Props {
  engine: AudioEngine | null;
  tracksById: Map<string, AnalyzedTrack>;
  tracks: AnalyzedTrack[];
  onLoadNext(side: 'A' | 'B'): void;
  onLoadTrack(side: 'A' | 'B', trackId: string): void;
  onSeek(side: 'A' | 'B', fraction: number): void;
  onCue(side: 'A' | 'B'): void;
  onPlayPause(side: 'A' | 'B'): void;
  /** Why a deck refused the last track, if it did. */
  notes?: { A: string | null; B: string | null };
}

const COLOR: Record<'A' | 'B', string> = { A: '#4fe3c1', B: '#ff8fb0' };

/**
 * Two-deck mixing view: a full-width waveform per deck with its cue points
 * and energy shape, a mixer between them, and the library underneath.
 *
 * The waveforms get the space because they are what you read while mixing;
 * the controls are sized to be hit, not admired.
 */
export function DecksView({
  engine,
  tracksById,
  tracks,
  onLoadNext,
  onLoadTrack,
  onSeek,
  onCue,
  onPlayPause,
  notes,
}: Props): JSX.Element {
  // The audio graph is not React state, so repaint on a timer.
  const [, setTick] = useState(0);
  const [crossfader, setCrossfader] = useState(() => engine?.getCrossfader() ?? 0);
  const [syncNote, setSyncNote] = useState<{ A: string | null; B: string | null }>({ A: null, B: null });

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 50);
    return () => window.clearInterval(id);
  }, []);

  // Hand the mix to the faders while this view is open; the auto-fade's gain
  // staging otherwise keeps the inactive deck muted.
  useEffect(() => {
    engine?.setManualMode(true);
    setCrossfader(engine?.getCrossfader() ?? 0);
    return () => engine?.setManualMode(false);
  }, [engine]);

  const deckA = engine?.deckA ?? null;
  const deckB = engine?.deckB ?? null;

  const trackFor = (side: 'A' | 'B'): AnalyzedTrack | null => {
    const deck = side === 'A' ? deckA : deckB;
    if (!deck?.track) return null;
    return tracksById.get(deck.track.id) ?? deck.track;
  };

  function handleSync(side: 'A' | 'B'): void {
    const r = engine?.syncDeck(side);
    if (!r) return;
    if (r.ok) setSyncNote({ A: null, B: null });
    else setSyncNote((p) => ({ ...p, [side]: r.reason ?? 'Sync unavailable' }));
  }

  const analysisReady = useMemo(
    () => tracks.filter((t) => t.analysis).length,
    [tracks]
  );

  const renderDeck = (side: 'A' | 'B'): JSX.Element => {
    const deck = side === 'A' ? deckA : deckB;
    const track = trackFor(side);
    const position = deck?.positionSec() ?? 0;
    // The deck reports 0 until its buffer has decoded, and `??` does not catch
    // a zero — without this the waveform divides by it and drops every cue.
    const deckDuration = deck?.duration ?? 0;
    const duration = deckDuration > 0 ? deckDuration : track?.durationSec ?? 0;
    return (
      <div className={`deckcol deckcol--${side.toLowerCase()}`}>
        <DeckWaveform
          peaks={track?.analysis?.waveform}
          cues={track?.analysis?.autoCues}
          sectionEnergy={track?.analysis?.sectionEnergy}
          positionSec={position}
          durationSec={duration}
          color={COLOR[side]}
          height={150}
          onScrub={track ? (f) => onSeek(side, f) : undefined}
        />
        <DeckStrip
          side={side}
          deck={deck}
          track={track}
          playing={deck?.isPlaying ?? false}
          positionSec={position}
          durationSec={duration}
          onPlayPause={() => onPlayPause(side)}
          onCue={() => onCue(side)}
          onSync={() => handleSync(side)}
          onLoad={() => onLoadNext(side)}
          syncNote={notes?.[side] ?? syncNote[side]}
          // Ask the engine, not the ratio: two tracks already at the same
          // tempo sync to a ratio of exactly 1, and reading the ratio would
          // leave the button dark as if the press had done nothing.
          synced={engine?.isSynced(side) ?? false}
        />
      </div>
    );
  };

  return (
    <div className="mixdesk">
      <div className="mixdesk-top">
        {renderDeck('A')}

        <div className="mixdesk-center">
          <div className="mixdesk-center-head">Mixer</div>

          <div className="mixdesk-eqs">
            {(['A', 'B'] as const).map((side) => {
              const deck = side === 'A' ? deckA : deckB;
              return (
                <div key={side} className="mixdesk-eqcol">
                  <div className="mixdesk-eqlabel" style={{ color: COLOR[side] }}>{side}</div>
                  {(['high', 'mid', 'low'] as const).map((band) => (
                    <Knob
                      key={band}
                      label={band.toUpperCase()}
                      value={deck?.getEq(band) ?? 0}
                      min={-26}
                      max={6}
                      center={0}
                      size={38}
                      format={(v) => (v <= -25.5 ? 'KILL' : `${v > 0 ? '+' : ''}${v.toFixed(0)}`)}
                      onChange={(v) => deck?.setEq(band, v)}
                    />
                  ))}
                  <Fader
                    value={deck?.getVolume() ?? 1}
                    min={0}
                    max={1}
                    center={1}
                    length={92}
                    format={(v) => `${Math.round(v * 100)}`}
                    onChange={(v) => deck?.setVolume(v)}
                  />
                </div>
              );
            })}
          </div>

          <div className="mixdesk-xfader">
            <Fader
              value={crossfader}
              min={-1}
              max={1}
              center={0}
              centerDetent
              orientation="horizontal"
              length={190}
              onChange={(v) => { setCrossfader(v); engine?.setCrossfader(v); }}
            />
            <div className="mixdesk-xfader-ends"><span>A</span><span>B</span></div>
          </div>
        </div>

        {renderDeck('B')}
      </div>

      <LibraryBrowser
        tracks={tracks}
        analysedCount={analysisReady}
        onLoadTo={(side, id) => onLoadTrack(side, id)}
      />
    </div>
  );
}
