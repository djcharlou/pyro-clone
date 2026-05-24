import { contextBridge, ipcRenderer } from 'electron';
import type { TrackAnalysis, AnalyzedTrack } from '@shared/types';
import { IPC } from '../main/ipc';

export interface PyroApi {
  importDirectory(): Promise<{ added: number; skipped: number; failed: number }>;
  listTracks(): Promise<AnalyzedTrack[]>;
  saveAnalysis(a: TrackAnalysis): Promise<void>;
  readAudioFile(filePath: string): Promise<ArrayBuffer>;
  onImportProgress(cb: (ev: unknown) => void): () => void;
}

const api: PyroApi = {
  importDirectory: () => ipcRenderer.invoke(IPC.ImportDirectory),
  listTracks: () => ipcRenderer.invoke(IPC.ListTracks),
  saveAnalysis: (a) => ipcRenderer.invoke(IPC.SaveAnalysis, a),
  readAudioFile: (filePath) => ipcRenderer.invoke(IPC.ReadAudioFile, filePath),
  onImportProgress: (cb) => {
    const listener = (_e: unknown, ev: unknown): void => cb(ev);
    ipcRenderer.on(IPC.ImportProgress, listener);
    return () => ipcRenderer.removeListener(IPC.ImportProgress, listener);
  },
};

contextBridge.exposeInMainWorld('pyro', api);

declare global {
  interface Window {
    pyro: PyroApi;
  }
}
