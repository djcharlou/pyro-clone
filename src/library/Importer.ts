import { parseBlob } from 'music-metadata-browser';
import type { Track } from '@shared/types';
import { store } from '@/db/IndexedDBStore';
import { pictureToDataUrl } from '@/library/coverArt';

const AUDIO_EXTS = new Set([
  'mp3', 'wav', 'flac', 'aiff', 'aif', 'm4a', 'aac', 'ogg', 'opus',
]);

export interface ImportProgress {
  kind: 'scan-found' | 'track-added' | 'track-failed';
  count?: number;
  track?: Track;
  filePath?: string;
  error?: string;
}

export interface ImportSummary {
  added: number;
  skipped: number;
  failed: number;
}

/**
 * In-memory map from track id -> File-source.
 * Three shapes are supported:
 *   - a `File`                         (from <input type="file">)
 *   - a `FileSystemFileHandle`         (Chromium's showDirectoryPicker)
 *   - a Tauri absolute path            (native runtime, e.g. iTunes import)
 *
 * The audio bytes are never persisted in IDB (would balloon storage).
 * File handles are persisted where the browser allows; Tauri paths are
 * kept in memory only, but re-obtainable on next launch by re-scanning
 * the iTunes library.
 */
interface TauriPath { kind: 'tauri-path'; path: string }
type FileSource = File | FileSystemFileHandle | TauriPath;

class FileRegistry {
  private byTrackId = new Map<string, FileSource>();

  put(trackId: string, item: File | FileSystemFileHandle): void {
    this.byTrackId.set(trackId, item);
  }

  putTauriPath(trackId: string, path: string): void {
    this.byTrackId.set(trackId, { kind: 'tauri-path', path });
  }

  async getFile(trackId: string): Promise<File | null> {
    const item = this.byTrackId.get(trackId);
    if (!item) {
      // Try to restore from IndexedDB-persisted handle (browser flow)
      const handle = await store.getFileHandle(trackId);
      if (!handle) return null;
      const permission = await ensureReadPermission(handle);
      if (!permission) return null;
      const file = await handle.getFile();
      this.byTrackId.set(trackId, file);
      return file;
    }
    if (isTauriPath(item)) {
      return await tauriPathToFile(item.path);
    }
    if ('getFile' in item && typeof item.getFile === 'function') {
      const file = await item.getFile();
      this.byTrackId.set(trackId, file);
      return file;
    }
    return item as File;
  }

  has(trackId: string): boolean {
    return this.byTrackId.has(trackId);
  }
}

function isTauriPath(x: FileSource): x is TauriPath {
  return typeof x === 'object' && x !== null && 'kind' in x && (x as TauriPath).kind === 'tauri-path';
}

async function tauriPathToFile(path: string): Promise<File | null> {
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const bytes = await fs.readFile(path);
    const name = path.split('/').pop() ?? 'audio';
    const mime = guessMime(name);
    // Uint8Array is a valid BlobPart
    return new File([bytes], name, { type: mime });
  } catch (err) {
    console.warn('[fileRegistry] tauri readFile failed for', path, err);
    return null;
  }
}

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'flac': return 'audio/flac';
    case 'm4a':
    case 'aac': return 'audio/mp4';
    case 'ogg': return 'audio/ogg';
    case 'opus': return 'audio/opus';
    case 'aiff':
    case 'aif': return 'audio/aiff';
    default: return 'application/octet-stream';
  }
}

export const fileRegistry = new FileRegistry();

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Open a directory via File System Access API and import all audio files.
 * Only available on Chromium-based desktop browsers.
 */
export async function importViaDirectoryPicker(
  onProgress?: (ev: ImportProgress) => void
): Promise<ImportSummary> {
  // @ts-expect-error showDirectoryPicker is not in lib.dom yet but exists at runtime
  const dirHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
    mode: 'read',
  });
  const files: { handle: FileSystemFileHandle; path: string }[] = [];
  await walkDirectory(dirHandle, '', files);
  return importFileHandles(files, onProgress);
}

async function walkDirectory(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  acc: { handle: FileSystemFileHandle; path: string }[]
): Promise<void> {
  for await (const entry of dir.values() as AsyncIterable<FileSystemHandle>) {
    const name = entry.name;
    if (name.startsWith('.')) continue;
    if (entry.kind === 'file') {
      const ext = name.split('.').pop()?.toLowerCase();
      if (ext && AUDIO_EXTS.has(ext)) {
        acc.push({ handle: entry as FileSystemFileHandle, path: `${prefix}${name}` });
      }
    } else if (entry.kind === 'directory') {
      await walkDirectory(entry as FileSystemDirectoryHandle, `${prefix}${name}/`, acc);
    }
  }
}

async function importFileHandles(
  entries: { handle: FileSystemFileHandle; path: string }[],
  onProgress?: (ev: ImportProgress) => void
): Promise<ImportSummary> {
  onProgress?.({ kind: 'scan-found', count: entries.length });
  let added = 0;
  let skipped = 0;
  let failed = 0;
  for (const e of entries) {
    try {
      if (await store.hasTrackByPath(e.path)) {
        skipped++;
        continue;
      }
      const file = await e.handle.getFile();
      const track = await fileToTrack(file, e.path);
      await store.upsertTrack(track);
      await store.saveFileHandle(track.id, e.handle);
      fileRegistry.put(track.id, e.handle);
      added++;
      onProgress?.({ kind: 'track-added', track });
    } catch (err) {
      failed++;
      onProgress?.({
        kind: 'track-failed',
        filePath: e.path,
        error: (err as Error).message,
      });
    }
  }
  return { added, skipped, failed };
}

/**
 * Fallback for browsers without showDirectoryPicker (Safari, Firefox, iOS).
 * Uses a hidden <input type="file" webkitdirectory> or multi-file picker.
 * File handles cannot be persisted across reloads in this mode.
 */
export async function importFiles(
  files: FileList | File[],
  onProgress?: (ev: ImportProgress) => void
): Promise<ImportSummary> {
  const list = Array.from(files).filter((f) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    return ext && AUDIO_EXTS.has(ext);
  });
  onProgress?.({ kind: 'scan-found', count: list.length });
  let added = 0;
  let skipped = 0;
  let failed = 0;
  for (const file of list) {
    try {
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      if (await store.hasTrackByPath(path)) {
        skipped++;
        continue;
      }
      const track = await fileToTrack(file, path);
      await store.upsertTrack(track);
      fileRegistry.put(track.id, file);
      added++;
      onProgress?.({ kind: 'track-added', track });
    } catch (err) {
      failed++;
      onProgress?.({
        kind: 'track-failed',
        filePath: file.name,
        error: (err as Error).message,
      });
    }
  }
  return { added, skipped, failed };
}

async function fileToTrack(file: File, path: string): Promise<Track> {
  let title = file.name.replace(/\.[^.]+$/, '');
  let artist = 'Unknown Artist';
  let album: string | undefined;
  let genre: string | undefined;
  let durationSec = 0;
  let sampleRate = 44100;
  let channels = 2;
  let coverArtDataUrl: string | undefined;

  try {
    const metadata = await parseBlob(file);
    title = metadata.common.title ?? title;
    artist = metadata.common.artist ?? metadata.common.albumartist ?? artist;
    album = metadata.common.album ?? undefined;
    genre = metadata.common.genre?.[0] ?? undefined;
    durationSec = metadata.format.duration ?? 0;
    sampleRate = metadata.format.sampleRate ?? 44100;
    channels = metadata.format.numberOfChannels ?? 2;
    const pic = metadata.common.picture?.[0];
    if (pic?.data) {
      coverArtDataUrl = await pictureToDataUrl({
        data: pic.data as Uint8Array,
        format: pic.format || 'image/jpeg',
      });
    }
  } catch {
    // ignore — keep filename defaults
  }

  const id = await hashFile(file);
  return {
    id,
    filePath: path,
    fileHash: id.slice(0, 16),
    title,
    artist,
    album,
    genre,
    durationSec,
    sampleRate,
    channels,
    addedAt: Date.now(),
    coverArtDataUrl,
  };
}

async function hashFile(file: File): Promise<string> {
  const slice = file.slice(0, Math.min(file.size, 256 * 1024));
  const buf = await slice.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-1', buf);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function ensureReadPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opts = { mode: 'read' as const };
  // @ts-expect-error queryPermission not in lib.dom yet
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  // @ts-expect-error requestPermission not in lib.dom yet
  return (await handle.requestPermission(opts)) === 'granted';
}
