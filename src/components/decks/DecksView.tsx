import { useEffect, useState } from 'react';
import type { AnalyzedTrack } from '@shared/types';
import type { AudioEngine } from '@/audio/AudioEngine';
import { DeckPanel } from './DeckPanel';
import { Mixer } from './Mixer';

interface Props {
  engine: AudioEngine | null;
  /** Latest store copies, so metadata added after load still shows. */
  tracksById: Map<string, AnalyzedTrack>;
  onLoadNext(side: 'A' | 'B'): void;
  onSeek(side: 'A' | 'B', fraction: number): void;
  onCue(side: 'A' | 'B'): void;
  onPlayPause(side: 'A' | 'B'): void;
}

/**
 * Two-deck CDJ layout: a deck either side of a mixer strip.
 *
 * Everything here drives the audio engine directly rather than going through
 * the auto-mix queue, so it is the manual counterpart to the Party view.
 */
export function DecksView({
  engine,
  tracksById,
  onLoadNext,
  onSeek,
  onCue,
  onPlayPause,
}: Props): JSX.Element {
  // The audio graph is not React state, so drive repaints from a timer.
  // 20fps is enough for the jog wheel to read as continuous rotation while
  // staying far cheaper than requestAnimationFrame on a canvas this size.
  const [tick, setTick] = useState(0);
  const [crossfader, setCrossfader] = useState(() => engine?.getCrossfader() ?? 0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 50);
    return () => window.clearInterval(id);
  }, []);

  const deckA = engine?.deckA ?? null;
  const deckB = engine?.deckB ?? null;
  const activeId = engine?.getActiveId() ?? 'A';

  const trackFor = (side: 'A' | 'B'): AnalyzedTrack | null => {
    const deck = side === 'A' ? deckA : deckB;
    if (!deck?.track) return null;
    return tracksById.get(deck.track.id) ?? deck.track;
  };

  return (
    <div className="decks-view">
      <DeckPanel
        side="A"
        deck={deckA}
        track={trackFor('A')}
        isActive={activeId === 'A'}
        tick={tick}
        onPlayPause={() => onPlayPause('A')}
        onCue={() => onCue('A')}
        onSeekFraction={(f) => onSeek('A', f)}
        onPitchChange={(p) => deckA?.setPitchPercent(p)}
        onNudge={(d) => deckA?.nudge(d)}
        onLoadFromQueue={() => onLoadNext('A')}
      />

      <Mixer
        deckA={deckA}
        deckB={deckB}
        crossfader={crossfader}
        tick={tick}
        onCrossfader={(v) => {
          setCrossfader(v);
          engine?.setCrossfader(v);
        }}
        onVolume={(side, v) => (side === 'A' ? deckA : deckB)?.setVolume(v)}
        onEq={(side, band, db) => (side === 'A' ? deckA : deckB)?.setEq(band, db)}
      />

      <DeckPanel
        side="B"
        deck={deckB}
        track={trackFor('B')}
        isActive={activeId === 'B'}
        tick={tick}
        onPlayPause={() => onPlayPause('B')}
        onCue={() => onCue('B')}
        onSeekFraction={(f) => onSeek('B', f)}
        onPitchChange={(p) => deckB?.setPitchPercent(p)}
        onNudge={(d) => deckB?.nudge(d)}
        onLoadFromQueue={() => onLoadNext('B')}
      />
    </div>
  );
}
