import { ID3Writer } from 'browser-id3-writer';
import type { Track, AnalyzedTrack } from '@shared/types';
import { store } from '@/db/IndexedDBStore';
import { fileRegistry } from '@/library/Importer';
import {
  encodeSeratoAutotags,
  encodeSeratoBeatGrid,
  encodeSeratoMarkers2,
  type SeratoCue,
} from './seratoTags';
import { injectGeobFrames, type GeobFrame } from './id3v2Geob';

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
  /** Analysis data to embed as Serato-compatible GEOB frames. */
  serato?: {
    bpm: number;
    autoGainDb?: number;
    gainDb?: number;
    beats?: number[];
    cues?: SeratoCue[];
    trackColor?: number;
    bpmLocked?: boolean;
  };
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
  let taggedBuffer: ArrayBuffer = writer.addTag();

  // Serato-compatible GEOB frames — injected AFTER browser-id3-writer's tag
  // so we can co-exist with its standard frames without re-implementing them.
  if (edits.serato) {
    const geob = buildSeratoGeobFrames(edits.serato);
    if (geob.length > 0) {
      const injected = injectGeobFrames(new Uint8Array(taggedBuffer), geob);
      taggedBuffer = injected.buffer.slice(injected.byteOffset, injected.byteOffset + injected.byteLength) as ArrayBuffer;
    }
  }

  const bytes = taggedBuffer.byteLength;
  const blob = new Blob([taggedBuffer], { type: 'audio/mpeg' });

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

function buildSeratoGeobFrames(s: NonNullable<TagEdits['serato']>): GeobFrame[] {
  const frames: GeobFrame[] = [];
  frames.push({
    mime: 'application/octet-stream',
    filename: '',
    description: 'Serato Autotags',
    data: encodeSeratoAutotags(s.bpm, s.autoGainDb ?? 0, s.gainDb ?? 0),
  });
  if (s.beats && s.beats.length > 0) {
    frames.push({
      mime: 'application/octet-stream',
      filename: '',
      description: 'Serato BeatGrid',
      data: encodeSeratoBeatGrid(s.beats, s.bpm),
    });
  }
  frames.push({
    mime: 'application/octet-stream',
    filename: '',
    description: 'Serato Markers2',
    data: encodeSeratoMarkers2({
      trackColor: s.trackColor,
      bpmLocked: s.bpmLocked ?? true,
      cues: s.cues,
    }),
  });
  return frames;
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
