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

  /** Safety limiter on the master bus — see constructor. */
  readonly limiter: DynamicsCompressorNode;

  private activeDeck: ActiveDeck = 'A';
  private listeners: EngineListeners;
  private transitionTimer: number | null = null;

  constructor(listeners: EngineListeners = {}) {
    this.listeners = listeners;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    // Equal-power crossfade sums both decks at ~0.7 mid-fade; if each is
    // near unity and content is peak-normalized, the sum can hit 1.4.
    // A conservative master keeps headroom for that + fills of stacked EQs.
    this.master.gain.value = 0.85;

    // Brick-wall-ish limiter after the master fader. Headroom alone can't
    // save us when two loud masters overlap mid-crossfade, and hard digital
    // clipping is exactly the harsh, "cheap" sound to avoid. A high ratio
    // with a fast attack and musical release catches those peaks without
    // pumping the steady-state level.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;

    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

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
   * Beat-matched equal-power crossfade.
   *
   * - Computes BPM ratio (with octave correction) so that deck B plays at
   *   deck A's tempo during the overlap, using playbackRate (pitch changes
   *   slightly with tempo — proper time-stretch is full Phase 4 work).
   * - Clamps the stretch to ±6%; beyond that, B plays at its native tempo
   *   (transition will sound less aligned but won't be pitched into munchkins).
   * - Snaps the fade start to the next downbeat of A within a 4-beat lookahead,
   *   so phase alignment between the two beatgrids is correct from the start.
   * - Falls back to a plain ctxTime start if A has no beatgrid.
   *
   * Returns the AudioContext time at which the fade was scheduled to start
   * (or null if it couldn't be scheduled).
   */
  crossfade(opts: {
    durationBeats?: number;       // default 32
    minDurationSec?: number;      // default 6
    maxDurationSec?: number;      // default 20
    deckBStartOffset?: number;    // default 0 (or B.cues.mixInPoint upstream)
    leadTimeSec?: number;         // default 0.05
  } = {}): number | null {
    void this.ensureRunning();
    const active = this.getActive();
    const next = this.getInactive();
    if (!next.track) {
      console.warn('[AudioEngine] crossfade requested but inactive deck has no track');
      return null;
    }

    const durationBeats = opts.durationBeats ?? 32;
    const minDurationSec = opts.minDurationSec ?? 6;
    const maxDurationSec = opts.maxDurationSec ?? 20;
    const offsetForB = opts.deckBStartOffset ?? 0;
    const leadTimeSec = opts.leadTimeSec ?? 0.05;

    // Compute target stretch ratio for B so B's tempo == A's tempo
    const bpmA = active.bpm;
    const bpmB = next.bpm;
    let ratio = bpmA / bpmB;
    // Octave correction (treat 70 ↔ 140 as the same family)
    while (ratio > 1.4) ratio /= 2;
    while (ratio < 0.7) ratio *= 2;

    const SAFE_RANGE = 0.06;
    const withinSafe = Math.abs(ratio - 1) <= SAFE_RANGE;
    const appliedRatio = withinSafe ? ratio : 1;
    next.setStretchRatio(appliedRatio);

    // Fade duration in seconds, derived from beats at A's BPM, then clamped
    let fadeDur = (durationBeats * 60) / bpmA;
    fadeDur = Math.min(maxDurationSec, Math.max(minDurationSec, fadeDur));

    // Decide start time — prefer snapping to next downbeat of A within lookahead
    const aPos = active.positionSec();
    let startInTrackA = aPos + leadTimeSec;
    const downbeats = active.track?.analysis?.beatGrid.downbeats;
    if (downbeats && downbeats.length) {
      const beatDurA = 60 / bpmA;
      const lookahead = 4 * beatDurA;
      const snap = downbeats.find((db) => db >= aPos + leadTimeSec);
      if (snap !== undefined && snap - aPos <= lookahead + leadTimeSec) {
        startInTrackA = snap;
      }
    }

    // Convert to ctx time
    const t0 = this.ctx.currentTime + (startInTrackA - aPos);
    const t1 = t0 + fadeDur;

    // Start deck B at correct offset (its mix-in point, which is a downbeat)
    if (!next.isPlaying) {
      next.scheduleStart(t0, offsetForB);
    }

    // --- Equal-power crossfade ramp ---------------------------------------
    const SAMPLES = 64;
    active.gain.gain.cancelScheduledValues(t0);
    next.gain.gain.cancelScheduledValues(t0);
    active.gain.gain.setValueAtTime(active.gain.gain.value, t0);
    next.gain.gain.setValueAtTime(0, t0 - 0.001 > 0 ? t0 - 0.001 : 0);

    for (let i = 0; i <= SAMPLES; i++) {
      const x = i / SAMPLES;
      const t = t0 + x * fadeDur;
      active.gain.gain.setValueAtTime(Math.cos((x * Math.PI) / 2), t);
      next.gain.gain.setValueAtTime(Math.sin((x * Math.PI) / 2), t);
    }
    active.gain.gain.setValueAtTime(0, t1 + 0.001);
    next.gain.gain.setValueAtTime(1, t1 + 0.001);

    // --- Bass swap ---------------------------------------------------------
    // Two full-range tracks played on top of each other stack their kick and
    // bass, which is the muddy "two songs at once" sound rather than a mix.
    // Real DJs keep only one low end at a time: the incoming track enters
    // with its bass pulled down, and at the midpoint the two swap over about
    // a beat. Skipped for degraded/short fades where it would be audible as
    // an effect rather than a transition.
    const beatDurA = 60 / bpmA;
    const doBassSwap = fadeDur >= 5 && withinSafe;
    if (doBassSwap) {
      const BASS_CUT_DB = -22;
      const tMid = t0 + fadeDur * 0.5;
      const swapDur = Math.min(beatDurA, fadeDur * 0.12);

      next.lowEQ.gain.cancelScheduledValues(t0);
      active.lowEQ.gain.cancelScheduledValues(t0);

      // Incoming: bass out for the first half, then in.
      next.lowEQ.gain.setValueAtTime(BASS_CUT_DB, t0);
      next.lowEQ.gain.setValueAtTime(BASS_CUT_DB, tMid);
      next.lowEQ.gain.linearRampToValueAtTime(0, tMid + swapDur);

      // Outgoing: bass in until the midpoint, then out.
      active.lowEQ.gain.setValueAtTime(active.lowEQ.gain.value, t0);
      active.lowEQ.gain.setValueAtTime(0, tMid);
      active.lowEQ.gain.linearRampToValueAtTime(BASS_CUT_DB, tMid + swapDur);

      // The outgoing deck is leaving anyway; sweeping a gentle high-pass over
      // its tail thins it out under the incoming track instead of just
      // turning it down.
      active.hp.frequency.cancelScheduledValues(tMid);
      active.hp.frequency.setValueAtTime(20, tMid);
      active.hp.frequency.exponentialRampToValueAtTime(420, t1);
    }

    active.scheduleStop(t1 + 0.1);

    // --- Release the beat-match -------------------------------------------
    // Once the incoming track is alone it should run at its own tempo again,
    // otherwise every track after the first stays permanently pitched. An
    // exponential glide spread over several seconds is inaudible.
    if (withinSafe && Math.abs(appliedRatio - 1) > 0.002) {
      const releaseStart = t1 + 0.2;
      const releaseDur = Math.min(10, Math.max(5, fadeDur * 0.6));
      next.glideStretchTo(1, releaseStart, releaseDur);
    }

    // Reset the outgoing deck's EQ/filter once it is silent, so it starts
    // clean the next time it is used.
    window.setTimeout(() => {
      active.lowEQ.gain.cancelScheduledValues(this.ctx.currentTime);
      active.lowEQ.gain.value = 0;
      active.hp.frequency.cancelScheduledValues(this.ctx.currentTime);
      active.hp.frequency.value = 20;
    }, Math.max(0, (t1 + 0.3 - this.ctx.currentTime) * 1000));

    console.info(
      `[crossfade] A=${bpmA.toFixed(1)}BPM B=${bpmB.toFixed(1)}BPM ` +
        `ratio=${ratio.toFixed(3)}${withinSafe ? '' : ' (out-of-range, no stretch)'} ` +
        `beats=${durationBeats} dur=${fadeDur.toFixed(2)}s ` +
        `snap=${(startInTrackA - aPos).toFixed(2)}s ahead`
    );

    this.listeners.onTransitionStart?.();
    const swapInMs = Math.max(0, (t1 - this.ctx.currentTime) * 1000);
    if (this.transitionTimer !== null) clearTimeout(this.transitionTimer);
    this.transitionTimer = window.setTimeout(() => {
      this.activeDeck = this.activeDeck === 'A' ? 'B' : 'A';
      this.transitionTimer = null;
      this.listeners.onTransitionEnd?.();
      this.listeners.onDeckUpdate?.();
    }, swapInMs);

    return t0;
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
