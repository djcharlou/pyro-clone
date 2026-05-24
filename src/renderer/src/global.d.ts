import type { AnalyzedTrack, TrackAnalysis } from '@shared/types';

export {};

declare global {
  interface PyroApi {
    importDirectory(): Promise<{ added: number; skipped: number; failed: number }>;
    listTracks(): Promise<AnalyzedTrack[]>;
    saveAnalysis(a: TrackAnalysis): Promise<void>;
    readAudioFile(filePath: string): Promise<ArrayBuffer>;
    onImportProgress(cb: (ev: unknown) => void): () => void;
  }
  interface Window {
    pyro: PyroApi;
  }
}
