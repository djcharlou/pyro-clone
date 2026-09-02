import type { AnalyzedTrack, TrackAnalysis, Track } from '@shared/types';
import type { AnalyzeRequest, AnalyzeResponse } from './worker';
import { fileRegistry } from '@/library/Importer';
import { readSeratoData } from '@/library/seratoRead';

interface PendingJob {
  resolve(a: TrackAnalysis): void;
  reject(e: Error): void;
}

/**
 * Single Web Worker that processes one track at a time.
 * Audio is decoded in the main thread (AudioContext) then the raw
 * Float32Array channels are transferred to the worker.
 */
export class AnalysisQueue {
  private worker: Worker;
  private pending = new Map<string, PendingJob>();
  private nextId = 1;
  private decodeCtx: OfflineAudioContext;
  private queue: Array<() => Promise<void>> = [];
  private busy = false;
  onProgress?: (state: {
    trackId: string;
    phase: 'decoding' | 'analyzing' | 'done' | 'error';
    error?: string;
  }) => void;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (e: MessageEvent<AnalyzeResponse>): void => {
      const msg = e.data;
      const job = this.pending.get(msg.id);
      if (!job) return;
      this.pending.delete(msg.id);
      if (msg.ok) job.resolve(msg.result);
      else job.reject(new Error(msg.error));
    };
    this.decodeCtx = new OfflineAudioContext(1, 1, 44100);
  }

  enqueue(track: Track): Promise<TrackAnalysis> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          this.onProgress?.({ trackId: track.id, phase: 'decoding' });
          // Read the raw bytes once: they feed both the Serato tag reader
          // and the audio decoder, so we avoid loading the file twice.
          const raw = await this.readTrackBytes(track.id);
          const serato = extractSeratoHints(raw);
          const audioBuffer = await this.decodeBytes(raw);
          this.onProgress?.({ trackId: track.id, phase: 'analyzing' });
          const channels: Float32Array[] = [];
          for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
            channels.push(audioBuffer.getChannelData(c).slice());
          }
          const result = await this.analyzeInWorker({
            trackId: track.id,
            // Filename first: DJ-edit packs write the real BPM there, and
            // the title tag is often missing or wrong on those files.
            nameHint: `${track.filePath ?? ''} ${track.title ?? ''}`,
            serato,
            channels,
            sampleRate: audioBuffer.sampleRate,
            durationSec: audioBuffer.duration,
          });
          this.onProgress?.({ trackId: track.id, phase: 'done' });
          resolve(result);
        } catch (err) {
          this.onProgress?.({
            trackId: track.id,
            phase: 'error',
            error: (err as Error).message,
          });
          reject(err as Error);
        }
      });
      void this.pump();
    });
  }

  enqueueMany(tracks: AnalyzedTrack[]): Promise<TrackAnalysis>[] {
    return tracks.map((t) => this.enqueue(t));
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        await job();
      }
    } finally {
      this.busy = false;
    }
  }

  private async readTrackBytes(trackId: string): Promise<ArrayBuffer> {
    const file = await fileRegistry.getFile(trackId);
    if (!file) throw new Error(`No file handle available for track ${trackId}`);
    return await file.arrayBuffer();
  }

  private async decodeBytes(raw: ArrayBuffer): Promise<AudioBuffer> {
    // decodeAudioData detaches the buffer it is given, so hand it a copy and
    // keep `raw` intact for the tag reader.
    return await this.decodeCtx.decodeAudioData(raw.slice(0));
  }

  private analyzeInWorker(input: {
    trackId: string;
    channels: Float32Array[];
    sampleRate: number;
    durationSec: number;
    nameHint?: string;
    serato?: { bpm: number; firstBeatSec: number; cueSecs?: number[] };
  }): Promise<TrackAnalysis> {
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const req: AnalyzeRequest = { id, input };
      const transferList: Transferable[] = input.channels.map(
        (c) => c.buffer as ArrayBuffer
      );
      this.worker.postMessage(req, transferList);
    });
  }

  destroy(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}

/**
 * Pull tempo, beat anchor and cues out of a file's Serato GEOB frames.
 * Returns undefined for files Serato has never touched, in which case the
 * pipeline falls back to filename parsing and then audio estimation.
 */
function extractSeratoHints(raw: ArrayBuffer):
  | { bpm: number; firstBeatSec: number; cueSecs?: number[] }
  | undefined {
  try {
    const data = readSeratoData(new Uint8Array(raw));
    if (!data) return undefined;
    const bpm = data.autotags?.bpm ?? data.beatGrid?.markers?.[0]?.bpm;
    const firstBeatSec = data.beatGrid?.markers?.[0]?.position;
    if (!bpm || !Number.isFinite(bpm) || bpm <= 0) return undefined;
    if (firstBeatSec === undefined || !Number.isFinite(firstBeatSec)) return undefined;
    const cueSecs = data.cues.length ? data.cues.map((c) => c.positionSec) : undefined;
    return { bpm, firstBeatSec, cueSecs };
  } catch {
    // A malformed tag must never block analysis.
    return undefined;
  }
}
