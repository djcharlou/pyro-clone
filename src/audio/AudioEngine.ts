import type { AnalyzedTrack } from '@shared/types';
import { Deck, type DeckId } from './Deck';

export type ActiveDeck = DeckId;

export interface EngineListeners {
  onDeckUpdate?: () => void;
  onTransitionStart?: () => void;
  onTransitionEnd?: () => void;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly deckA: Deck;
  readonly deckB: Deck;

  private activeDeck: ActiveDeck = 'A';
  private listeners: EngineListeners;
  private transitionTimer: number | null = null;

  constructor(listeners: EngineListeners = {}) {
    this.listeners = listeners;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    const notify = (): void => this.listeners.onDeckUpdate?.();

    this.deckA = new Deck(this.ctx, 'A', {
      onPlay: notify,
      onStop: notify,
      onLoad: notify,
    });
    this.deckB = new Deck(this.ctx, 'B', {
      onPlay: notify,
      onStop: notify,
      onLoad: notify,
    });
    this.deckA.connect(this.master);
    this.deckB.connect(this.master);
    // start with deck B muted
    this.deckB.gain.gain.value = 0;
  }

  getDeck(id: DeckId): Deck {
    return id === 'A' ? this.deckA : this.deckB;
  }

  getActive(): Deck {
    return this.getDeck(this.activeDeck);
  }

  getInactive(): Deck {
    return this.getDeck(this.activeDeck === 'A' ? 'B' : 'A');
  }

  getActiveId(): ActiveDeck {
    return this.activeDeck;
  }

  async ensureRunning(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  async loadIntoInactive(track: AnalyzedTrack, audio: ArrayBuffer): Promise<void> {
    await this.getInactive().load(track, audio);
  }

  async loadIntoActive(track: AnalyzedTrack, audio: ArrayBuffer): Promise<void> {
    await this.getActive().load(track, audio);
  }

  playActive(offsetSec = 0): void {
    void this.ensureRunning();
    const d = this.getActive();
    if (this.activeDeck === 'A') {
      this.deckA.gain.gain.value = 1;
      this.deckB.gain.gain.value = 0;
    } else {
      this.deckA.gain.gain.value = 0;
      this.deckB.gain.gain.value = 1;
    }
    d.play(offsetSec);
  }

  /**
   * Equal-power crossfade from active deck to the inactive deck.
   * Schedules ramps on AudioParams + a small JS timer to swap which deck
   * is "active" at the end of the transition.
   */
  crossfade(durationSec: number, offsetForNewDeck = 0): void {
    void this.ensureRunning();
    const active = this.getActive();
    const next = this.getInactive();
    if (!next.track) {
      console.warn('[AudioEngine] crossfade requested but inactive deck has no track');
      return;
    }

    const t0 = this.ctx.currentTime + 0.02;
    const t1 = t0 + durationSec;

    // Start next deck if not running
    if (!next.isPlaying) {
      next.scheduleStart(t0, offsetForNewDeck);
    }

    // Equal-power curve sampled into setValueAtTime calls
    const SAMPLES = 64;
    active.gain.gain.cancelScheduledValues(t0);
    next.gain.gain.cancelScheduledValues(t0);
    active.gain.gain.setValueAtTime(active.gain.gain.value, t0);
    next.gain.gain.setValueAtTime(next.gain.gain.value, t0);

    for (let i = 0; i <= SAMPLES; i++) {
      const x = i / SAMPLES;
      const t = t0 + x * durationSec;
      const fadeOut = Math.cos((x * Math.PI) / 2);
      const fadeIn = Math.sin((x * Math.PI) / 2);
      active.gain.gain.setValueAtTime(fadeOut, t);
      next.gain.gain.setValueAtTime(fadeIn, t);
    }
    active.gain.gain.setValueAtTime(0, t1 + 0.001);
    next.gain.gain.setValueAtTime(1, t1 + 0.001);

    // Stop the outgoing deck shortly after the fade
    active.scheduleStop(t1 + 0.1);

    this.listeners.onTransitionStart?.();
    const swapInMs = Math.max(0, (t1 - this.ctx.currentTime) * 1000);
    if (this.transitionTimer !== null) clearTimeout(this.transitionTimer);
    this.transitionTimer = window.setTimeout(() => {
      this.activeDeck = this.activeDeck === 'A' ? 'B' : 'A';
      this.transitionTimer = null;
      this.listeners.onTransitionEnd?.();
      this.listeners.onDeckUpdate?.();
    }, swapInMs);
  }

  /**
   * Hard switch between decks without crossfade — useful for manual cueing.
   */
  hardSwitch(): void {
    this.activeDeck = this.activeDeck === 'A' ? 'B' : 'A';
    this.listeners.onDeckUpdate?.();
  }

  setMasterVolume(v: number): void {
    this.master.gain.value = Math.max(0, Math.min(1, v));
  }
}
