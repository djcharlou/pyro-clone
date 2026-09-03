import type { Deck } from '@/audio/Deck';
import { Knob } from './Knob';
import { Fader } from './Fader';

interface Props {
  deckA: Deck | null;
  deckB: Deck | null;
  crossfader: number;
  onCrossfader(v: number): void;
  onVolume(side: 'A' | 'B', v: number): void;
  onEq(side: 'A' | 'B', band: 'low' | 'mid' | 'high', db: number): void;
  /** Bumped by the parent tick so knob positions follow engine state. */
  tick: number;
}

const BANDS: Array<{ band: 'high' | 'mid' | 'low'; label: string }> = [
  { band: 'high', label: 'HIGH' },
  { band: 'mid', label: 'MID' },
  { band: 'low', label: 'LOW' },
];

export function Mixer({
  deckA,
  deckB,
  crossfader,
  onCrossfader,
  onVolume,
  onEq,
}: Props): JSX.Element {
  return (
    <section className="mixer">
      <div className="mixer-channels">
        {(['A', 'B'] as const).map((side) => {
          const deck = side === 'A' ? deckA : deckB;
          return (
            <div key={side} className="mixer-channel">
              <div className="mixer-channel-id">{side}</div>
              {BANDS.map(({ band, label }) => (
                <Knob
                  key={band}
                  label={label}
                  value={deck?.getEq(band) ?? 0}
                  min={-26}
                  max={6}
                  center={0}
                  size={42}
                  format={(v) => (v <= -25.5 ? 'KILL' : `${v > 0 ? '+' : ''}${v.toFixed(0)}`)}
                  onChange={(v) => onEq(side, band, v)}
                />
              ))}
              <Fader
                value={deck?.getVolume() ?? 1}
                min={0}
                max={1}
                center={1}
                length={110}
                format={(v) => `${Math.round(v * 100)}`}
                onChange={(v) => onVolume(side, v)}
              />
            </div>
          );
        })}
      </div>

      <div className="mixer-xfader">
        <Fader
          value={crossfader}
          min={-1}
          max={1}
          center={0}
          centerDetent
          orientation="horizontal"
          length={220}
          onChange={onCrossfader}
        />
        <div className="mixer-xfader-ends">
          <span>A</span>
          <span>B</span>
        </div>
      </div>
    </section>
  );
}
