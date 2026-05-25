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
      this.source.playbackRate.value = ratio;
    }
  }

  getStretchRatio(): number {
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
    return (
      this.bufferStartOffset +
      (this.ctx.currentTime - this.startedAtCtx) * this.stretchRatio
    );
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
