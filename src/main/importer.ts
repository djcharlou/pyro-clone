import { parseFile } from 'music-metadata';
import { readdir, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { createHash } from 'crypto';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import type { Track } from '@shared/types';
import { LibraryStore } from './store';

const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.flac', '.aiff', '.aif', '.m4a', '.aac', '.ogg', '.opus',
]);

export interface ImportSummary {
  added: number;
  skipped: number;
  failed: number;
  tracks: Track[];
}

export type ImportProgressFn = (event: {
  kind: 'scan-found' | 'track-added' | 'track-failed';
  count?: number;
  track?: Track;
  filePath?: string;
  error?: string;
}) => void;

export async function importDirectory(
  dir: string,
  store: LibraryStore,
  onProgress?: ImportProgressFn
): Promise<ImportSummary> {
  const files = await collectAudioFiles(dir);
  onProgress?.({ kind: 'scan-found', count: files.length });

  let added = 0;
  let skipped = 0;
  let failed = 0;
  const tracks: Track[] = [];

  for (const filePath of files) {
    try {
      if (store.hasTrackByPath(filePath)) {
        skipped++;
        continue;
      }
      const track = await fileToTrack(filePath);
      store.upsertTrack(track);
      tracks.push(track);
      added++;
      onProgress?.({ kind: 'track-added', track });
    } catch (err) {
      failed++;
      onProgress?.({
        kind: 'track-failed',
        filePath,
        error: (err as Error).message,
      });
    }
  }

  return { added, skipped, failed, tracks };
}

async function collectAudioFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(current, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) continue;
        stack.push(full);
      } else if (e.isFile()) {
        if (AUDIO_EXTS.has(extname(e.name).toLowerCase())) {
          out.push(full);
        }
      }
    }
  }
  return out;
}

async function fileToTrack(filePath: string): Promise<Track> {
  const [metadata, st, hash] = await Promise.all([
    parseFile(filePath, { duration: true }),
    stat(filePath),
    hashFileHead(filePath),
  ]);

  const common = metadata.common;
  const format = metadata.format;
  return {
    id: randomUUID(),
    filePath,
    fileHash: hash,
    title: common.title ?? baseName(filePath),
    artist: common.artist ?? common.albumartist ?? 'Unknown Artist',
    album: common.album ?? undefined,
    genre: common.genre?.[0] ?? undefined,
    durationSec: format.duration ?? 0,
    sampleRate: format.sampleRate ?? 44100,
    channels: format.numberOfChannels ?? 2,
    addedAt: Date.now(),
  };
}

function baseName(p: string): string {
  return p.split('/').pop()?.replace(/\.[^.]+$/, '') ?? p;
}

function hashFileHead(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = createReadStream(filePath, { start: 0, end: 256 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
