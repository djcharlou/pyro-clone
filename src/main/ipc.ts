import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { readFile } from 'fs/promises';
import { LibraryStore } from './store';
import { importDirectory } from './importer';
import type { TrackAnalysis, AnalyzedTrack } from '@shared/types';

export const IPC = {
  ImportDirectory: 'library:import-directory',
  ListTracks: 'library:list',
  SaveAnalysis: 'analysis:save',
  ReadAudioFile: 'audio:read-file',
  ImportProgress: 'library:import-progress',
} as const;

export function registerIpc(store: LibraryStore): void {
  ipcMain.handle(IPC.ImportDirectory, async (event): Promise<{ added: number; skipped: number; failed: number }> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? undefined as unknown as BrowserWindow, {
      properties: ['openDirectory'],
      title: 'Pick a folder to import',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { added: 0, skipped: 0, failed: 0 };
    }
    const dir = result.filePaths[0];
    const summary = await importDirectory(dir, store, (ev) => {
      event.sender.send(IPC.ImportProgress, ev);
    });
    return { added: summary.added, skipped: summary.skipped, failed: summary.failed };
  });

  ipcMain.handle(IPC.ListTracks, async (): Promise<AnalyzedTrack[]> => {
    return store.listTracks();
  });

  ipcMain.handle(IPC.SaveAnalysis, async (_event, analysis: TrackAnalysis): Promise<void> => {
    store.saveAnalysis(analysis);
  });

  ipcMain.handle(IPC.ReadAudioFile, async (_event, filePath: string): Promise<ArrayBuffer> => {
    const buf = await readFile(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  });
}

export function appReady(): Promise<void> {
  return app.whenReady();
}
