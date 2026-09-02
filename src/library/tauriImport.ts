import type { Track } from '@shared/types';
import { store } from '@/db/IndexedDBStore';
import { fileRegistry, type ImportProgress, type ImportSummary } from '@/library/Importer';
import { isTauri } from '@/library/itunes';

const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'aiff', 'aif', 'm4a', 'aac', 'ogg', 'opus'];

/**
 * Native file picker (Tauri) — returns absolute paths persistable across
 * app restarts, unlike the browser <input type="file"> path which is just
 * a filename.
 *
 * If not in Tauri, falls back to null so the caller can use the browser
 * picker instead.
 */
export async function pickAudioFilesNative(
  onProgress?: (ev: ImportProgress) => void
): Promise<ImportSummary | null> {
  if (!isTauri()) return null;
  const dialog = await import('@tauri-apps/plugin-dialog');
  const paths = await dialog.open({
    multiple: true,
    filters: [
      { name: 'Audio', extensions: AUDIO_EXTS },
      { name: 'All files', extensions: ['*'] },
    ],
    title: 'Pick audio files',
  });
  if (!paths) return { added: 0, skipped: 0, failed: 0 };
  const arr = Array.isArray(paths) ? paths : [paths];
  return importPaths(arr, onProgress);
}

/**
 * Native folder picker (Tauri) — walks the tree via Tauri fs and imports
 * all audio files, storing absolute paths.
 */
export async function pickFolderNative(
  onProgress?: (ev: ImportProgress) => void
): Promise<ImportSummary | null> {
  if (!isTauri()) return null;
  const dialog = await import('@tauri-apps/plugin-dialog');
  const fs = await import('@tauri-apps/plugin-fs');
  const folder = await dialog.open({
    directory: true,
    multiple: false,
    title: 'Pick a folder',
  });
  if (!folder || Array.isArray(folder)) return { added: 0, skipped: 0, failed: 0 };
  const paths: string[] = [];
  await walkTauriDir(fs, folder, paths);
  return importPaths(paths, onProgress);
}

interface TauriFsEntry { name: string; isDirectory: boolean; isFile: boolean }
interface TauriFs {
  readDir(path: string): Promise<TauriFsEntry[]>;
}

async function walkTauriDir(fs: unknown, dir: string, acc: string[]): Promise<void> {
  const typedFs = fs as TauriFs;
  let entries: TauriFsEntry[];
  try {
    entries = await typedFs.readDir(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = `${dir}/${e.name}`;
    if (e.isDirectory) {
      await walkTauriDir(typedFs, full, acc);
    } else if (e.isFile) {
      const ext = e.name.split('.').pop()?.toLowerCase();
      if (ext && AUDIO_EXTS.includes(ext)) acc.push(full);
    }
  }
}

async function importPaths(
  paths: string[],
  onProgress?: (ev: ImportProgress) => void
): Promise<ImportSummary> {
  onProgress?.({ kind: 'scan-found', count: paths.length });
  let added = 0;
  let skipped = 0;
  let failed = 0;

  const fs = await import('@tauri-apps/plugin-fs');

  for (const absPath of paths) {
    try {
      if (await store.hasTrackByPath(absPath)) {
        skipped++;
        continue;
      }
      if (!(await fs.exists(absPath))) {
        skipped++;
        continue;
      }
      const track: Track = {
        id: crypto.randomUUID(),
        filePath: absPath,
        fileHash: `native:${absPath.slice(-32)}`,
        title: filenameOf(absPath),
        artist: 'Unknown Artist',
        durationSec: 0,
        sampleRate: 44100,
        channels: 2,
        addedAt: Date.now(),
      };
      await store.upsertTrack(track);
      fileRegistry.putTauriPath(track.id, absPath);
      added++;
      onProgress?.({ kind: 'track-added', track });
    } catch (err) {
      failed++;
      onProgress?.({
        kind: 'track-failed',
        filePath: absPath,
        error: (err as Error).message,
      });
    }
  }
  return { added, skipped, failed };
}

function filenameOf(p: string): string {
  const base = p.split('/').pop() ?? p;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}
