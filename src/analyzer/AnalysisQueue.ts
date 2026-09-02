import type { AnalyzedTrack, TrackAnalysis, Track } from '@shared/types';
import type { AnalyzeRequest, AnalyzeResponse } from './worker';
import { fileRegistry } from '@/library/Importer';

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
          const audioBuffer = await this.decodeTrack(track.id);
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

  private async decodeTrack(trackId: string): Promise<AudioBuffer> {
    const file = await fileRegistry.getFile(trackId);
    if (!file) throw new Error(`No file handle available for track ${trackId}`);
    const buf = await file.arrayBuffer();
    return await this.decodeCtx.decodeAudioData(buf);
  }

  private analyzeInWorker(input: {
    trackId: string;
    channels: Float32Array[];
    sampleRate: number;
    durationSec: number;
    nameHint?: string;
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
