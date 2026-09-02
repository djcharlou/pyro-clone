import type { AnalyzedTrack } from '@shared/types';

export type DeckId = 'A' | 'B';

export interface DeckListeners {
  onPlay?: () => void;
  onStop?: () => void;
  onLoad?: (track: AnalyzedTrack) => void;
}

export class Deck {
  readonly id: DeckId;
  readonly gain: GainNode;
  readonly lowEQ: BiquadFilterNode;
  readonly midEQ: BiquadFilterNode;
  readonly highEQ: BiquadFilterNode;
  readonly hp: BiquadFilterNode;
  readonly output: GainNode;

  private ctx: AudioContext;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private startedAtCtx = 0;
  private bufferStartOffset = 0;
  private playing = false;
  private listeners: DeckListeners;
  private stretchRatio = 1;
  /**
   * Playback-rate ramps scheduled on the current source, so positionSec()
   * can integrate the actual rate curve instead of assuming it is constant.
   * Cleared whenever a new source is created.
   */
  private rateSegments: Array<{
    startCtx: number;
    endCtx: number;
    from: number;
    to: number;
  }> = [];
  /** Rate the current source was started at, before any scheduled ramp. */
  private rateAtStart = 1;
  track: AnalyzedTrack | null = null;

  constructor(ctx: AudioContext, id: DeckId, listeners: DeckListeners = {}) {
    this.ctx = ctx;
    this.id = id;
    this.listeners = listeners;

    this.lowEQ = ctx.createBiquadFilter();
    this.lowEQ.type = 'lowshelf';
    this.lowEQ.frequency.value = 120;
    this.lowEQ.gain.value = 0;

    this.midEQ = ctx.createBiquadFilter();
    this.midEQ.type = 'peaking';
    this.midEQ.frequency.value = 1000;
    this.midEQ.Q.value = 1;
    this.midEQ.gain.value = 0;

    this.highEQ = ctx.createBiquadFilter();
    this.highEQ.type = 'highshelf';
    this.highEQ.frequency.value = 8000;
    this.highEQ.gain.value = 0;

    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 20;
    this.hp.Q.value = 0.7;

    this.gain = ctx.createGain();
    this.gain.gain.value = 1;

    this.output = ctx.createGain();
    this.output.gain.value = 1;

    this.lowEQ
      .connect(this.midEQ)
      .connect(this.highEQ)
      .connect(this.hp)
      .connect(this.gain)
      .connect(this.output);
  }

  connect(destination: AudioNode): void {
    this.output.connect(destination);
  }

  async load(track: AnalyzedTrack, audioData: ArrayBuffer): Promise<void> {
    this.stop();
    const decoded = await this.ctx.decodeAudioData(audioData);
    this.buffer = decoded;
    this.track = track;
    this.stretchRatio = 1;
    // LUFS-driven output gain — only ATTENUATE loud tracks toward target.
    // Never boost (positive dB would clip during the crossfade sum since
    // both decks briefly sit at ~0.7 gain).
    const suggested = track.analysis?.loudness?.suggestedGainDb;
    if (suggested !== undefined && Number.isFinite(suggested)) {
      const cutOnly = Math.max(-12, Math.min(0, suggested));
      this.output.gain.value = Math.pow(10, cutOnly / 20);
    } else {
      this.output.gain.value = 1;
    }
    this.listeners.onLoad?.(track);
  }

  /**
   * Set the playback rate ratio (1.0 = native, 1.05 = 5% faster).
   * Pitch changes with tempo (no proper time-stretch yet — that's Phase 4 full).
   * Stored across source recreations so it applies to scheduleStart() too.
   */
  setStretchRatio(ratio: number): void {
    this.stretchRatio = ratio;
    if (this.source) {
      this.source.playbackRate.cancelScheduledValues(this.ctx.currentTime);
      this.source.playbackRate.value = ratio;
    }
  }

  /**
   * Ease the playback rate to `target` over `durationSec`, starting at
   * `startCtxTime`.
   *
   * Used to release the beat-match after a transition finishes: the incoming
   * track is stretched to the outgoing track's tempo for the overlap, then
   * glides back to its own tempo once it is alone. Spread over several
   * seconds the drift is inaudible, and it stops every track after the first
   * from being permanently pitched.
   *
   * positionSec() stays correct because we track the rate change on the same
   * timeline — see `rateSegments`.
   */
  glideStretchTo(target: number, startCtxTime: number, durationSec: number): void {
    if (!this.source) {
      this.stretchRatio = target;
      return;
    }
    const from = this.stretchRatio;
    if (Math.abs(from - target) < 0.0005) return;

    const param = this.source.playbackRate;
    param.cancelScheduledValues(startCtxTime);
    param.setValueAtTime(from, startCtxTime);
    // exponentialRamp cannot cross zero and is smoother than linear for
    // pitch; both endpoints are strictly positive here.
    param.exponentialRampToValueAtTime(target, startCtxTime + durationSec);

    // Record the ramp so positionSec() can integrate over it instead of
    // assuming a constant rate.
    this.rateSegments.push({
      startCtx: startCtxTime,
      endCtx: startCtxTime + durationSec,
      from,
      to: target,
    });
    this.stretchRatio = target;
  }

  getStretchRatio(): number {
    return this.stretchRatio;
  }

  /**
   * Current audible rate, accounting for an in-flight glide.
   * Display code wants this rather than the settled target.
   */
  getCurrentRate(): number {
    const now = this.ctx.currentTime;
    for (const seg of this.rateSegments) {
      if (now >= seg.startCtx && now < seg.endCtx) {
        const x = (now - seg.startCtx) / (seg.endCtx - seg.startCtx);
        // matches exponentialRampToValueAtTime
        return seg.from * Math.pow(seg.to / seg.from, x);
      }
    }
    return this.stretchRatio;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get bpm(): number {
    return this.track?.analysis?.beatGrid.bpm ?? 120;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  positionSec(): number {
    if (!this.playing) return this.bufferStartOffset;
    const now = this.ctx.currentTime;
    const elapsedCtx = now - this.startedAtCtx;
    if (elapsedCtx <= 0) return this.bufferStartOffset;

    if (this.rateSegments.length === 0) {
      return this.bufferStartOffset + elapsedCtx * this.stretchRatio;
    }

    // Walk the timeline in pieces: constant rate between ramps, integrated
    // exponential during them. Without this the playhead drifts (and the
    // waveform lies) for the whole duration of a tempo glide.
    let consumed = 0;
    let cursor = this.startedAtCtx;
    let rate = this.rateAtStart;

    const segs = [...this.rateSegments].sort((a, b) => a.startCtx - b.startCtx);
    for (const seg of segs) {
      if (seg.startCtx >= now) break;
      if (seg.startCtx > cursor) {
        consumed += (Math.min(seg.startCtx, now) - cursor) * rate;
        cursor = Math.min(seg.startCtx, now);
      }
      if (now <= cursor) break;
      const segEnd = Math.min(seg.endCtx, now);
      consumed += integrateExpRamp(seg.from, seg.to, seg.endCtx - seg.startCtx, segEnd - seg.startCtx);
      cursor = segEnd;
      rate = seg.to;
      if (segEnd < seg.endCtx) {
        // still mid-ramp; nothing after it has happened yet
        return this.bufferStartOffset + consumed;
      }
    }
    if (now > cursor) consumed += (now - cursor) * rate;
    return this.bufferStartOffset + consumed;
  }

  play(offsetSec = 0): void {
    if (!this.buffer) return;
    this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.stretchRatio;
    src.connect(this.lowEQ);
    src.onended = () => {
      if (this.source === src) {
        this.playing = false;
        this.listeners.onStop?.();
      }
    };
    src.start(0, offsetSec);
    this.source = src;
    this.rateSegments = [];
    this.rateAtStart = this.stretchRatio;
    this.startedAtCtx = this.ctx.currentTime;
    this.bufferStartOffset = offsetSec;
    this.playing = true;
    this.listeners.onPlay?.();
  }

  scheduleStart(ctxTime: number, offsetSec = 0): void {
    if (!this.buffer) return;
    this.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.stretchRatio;
    src.connect(this.lowEQ);
    src.onended = () => {
      if (this.source === src) {
        this.playing = false;
        this.listeners.onStop?.();
      }
    };
    src.start(ctxTime, offsetSec);
    this.source = src;
    this.rateSegments = [];
    this.rateAtStart = this.stretchRatio;
    this.startedAtCtx = ctxTime;
    this.bufferStartOffset = offsetSec;
    this.playing = true;
    this.listeners.onPlay?.();
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.rateSegments = [];
    if (this.playing) {
      this.playing = false;
      this.listeners.onStop?.();
    }
  }

  scheduleStop(ctxTime: number): void {
    if (!this.source) return;
    try {
      this.source.stop(ctxTime);
    } catch {
      /* may already be scheduled */
    }
  }
}

/**
 * Buffer-seconds consumed by an exponential playbackRate ramp.
 *
 * Web Audio's exponentialRampToValueAtTime traces
 *   r(t) = from · (to/from)^(t/D)
 * so the position advanced after `elapsed` seconds is its integral:
 *   ∫₀^e r dt = from·D/ln(to/from) · ((to/from)^(e/D) − 1)
 * degenerating to from·e when the endpoints are equal.
 */
function integrateExpRamp(
  from: number,
  to: number,
  durationSec: number,
  elapsedSec: number
): number {
  const e = Math.max(0, Math.min(elapsedSec, durationSec));
  if (durationSec <= 0) return 0;
  const k = to / from;
  if (!Number.isFinite(k) || k <= 0 || Math.abs(k - 1) < 1e-9) {
    return from * e;
  }
  const lnK = Math.log(k);
  return (from * durationSec / lnK) * (Math.pow(k, e / durationSec) - 1);
}
