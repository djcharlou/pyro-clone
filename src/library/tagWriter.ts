import { ID3Writer } from 'browser-id3-writer';
import type { Track, AnalyzedTrack } from '@shared/types';
import { store } from '@/db/IndexedDBStore';
import { fileRegistry } from '@/library/Importer';

export interface TagEdits {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  bpm?: number;
  key?: string;
  camelot?: string;
  comment?: string;
}

export type WriteMode = 'in-place' | 'download';

export interface WriteResult {
  mode: WriteMode;
  bytesWritten: number;
  filename?: string;
}

/**
 * Write ID3 tags to a track's source file.
 *
 * MP3 only for now — flac and m4a need different libs (or a native backend).
 * The result depends on how the file was imported:
 *   - Chromium desktop via showDirectoryPicker → in-place write to disk
 *   - Everything else → downloads a new file with tags embedded
 */
export async function writeTagsToFile(
  track: Track,
  edits: TagEdits
): Promise<WriteResult> {
  if (!isMp3(track.filePath)) {
    throw new Error(`Tag writing not supported for ${extOf(track.filePath)} yet`);
  }

  const file = await fileRegistry.getFile(track.id);
  if (!file) throw new Error('Source file not available in registry');

  const arrayBuffer = await file.arrayBuffer();
  const writer = new ID3Writer(arrayBuffer);

  // Standard frames
  if (edits.title !== undefined) writer.setFrame('TIT2', edits.title);
  if (edits.artist !== undefined) writer.setFrame('TPE1', [edits.artist]);
  if (edits.album !== undefined) writer.setFrame('TALB', edits.album);
  if (edits.genre !== undefined) writer.setFrame('TCON', [edits.genre]);
  if (edits.year !== undefined) writer.setFrame('TYER', edits.year);
  if (edits.bpm !== undefined) writer.setFrame('TBPM', Math.round(edits.bpm));
  if (edits.key !== undefined) writer.setFrame('TKEY', edits.key);
  if (edits.comment !== undefined) writer.setFrame('COMM', {
    description: 'pyro',
    text: edits.comment,
    language: 'eng',
  });
  // Camelot code via user-defined frame — Rekordbox/Serato read this
  if (edits.camelot !== undefined) writer.setFrame('TXXX', {
    description: 'CAMELOT',
    value: edits.camelot,
  });
  const buffer = writer.addTag();
  const blob = writer.getBlob();
  const bytes = buffer.byteLength;

  // Try in-place write via File System Access API
  const handle = await store.getFileHandle(track.id);
  if (handle && (await handleIsWritable(handle))) {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { mode: 'in-place', bytesWritten: bytes };
  }

  // Fallback: download the modified file
  const filename = suggestFilename(track.filePath);
  triggerDownload(blob, filename);
  return { mode: 'download', bytesWritten: bytes, filename };
}

export async function writeTagsBatch(
  edits: Array<{ track: Track; changes: TagEdits }>,
  onProgress?: (done: number, total: number, current: Track) => void
): Promise<Array<{ track: Track; result: WriteResult | null; error?: string }>> {
  const results: Array<{ track: Track; result: WriteResult | null; error?: string }> = [];
  for (let i = 0; i < edits.length; i++) {
    const { track, changes } = edits[i];
    onProgress?.(i, edits.length, track);
    try {
      const result = await writeTagsToFile(track, changes);
      results.push({ track, result });
    } catch (err) {
      results.push({
        track,
        result: null,
        error: (err as Error).message,
      });
    }
  }
  onProgress?.(edits.length, edits.length, edits[edits.length - 1]?.track);
  return results;
}

async function handleIsWritable(handle: FileSystemFileHandle): Promise<boolean> {
  try {
    const perm = await handle.queryPermission?.({ mode: 'readwrite' });
    if (perm === 'granted') return true;
    const req = await handle.requestPermission?.({ mode: 'readwrite' });
    return req === 'granted';
  } catch {
    return false;
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function suggestFilename(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot === -1) return `${base}.tagged.mp3`;
  return `${base.slice(0, dot)}.tagged${base.slice(dot)}`;
}

function isMp3(path: string): boolean {
  return path.toLowerCase().endsWith('.mp3');
}

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i === -1 ? '(no ext)' : path.slice(i);
}

/**
 * Apply tag edits to the in-memory Track object (for optimistic UI).
 * Doesn't touch the file — call writeTagsToFile for that.
 */
export function applyEditsToTrack(t: AnalyzedTrack, edits: TagEdits): AnalyzedTrack {
  return {
    ...t,
    title: edits.title ?? t.title,
    artist: edits.artist ?? t.artist,
    album: edits.album ?? t.album,
    genre: edits.genre ?? t.genre,
  };
}
