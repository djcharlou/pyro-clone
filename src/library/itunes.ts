import * as plist from 'plist';
import type { Track } from '@shared/types';
import { store } from '@/db/IndexedDBStore';
import { fileRegistry, type ImportProgress } from '@/library/Importer';

/**
 * Import from an iTunes / Music.app library XML.
 *
 * Only runs in the Tauri native build — the plist is read from disk via the
 * @tauri-apps/plugin-fs plugin. In a browser build importFromITunes returns
 * { available: false } so the UI can fall back cleanly.
 *
 * Enable the XML export in Music.app:
 *   Music → Settings → Advanced → "Share Music Library XML with other apps".
 */

const AUDIO_KINDS = /^(MPEG audio file|AAC audio file|Apple Lossless audio file|WAV audio file|AIFF audio file|Purchased AAC audio file)/;

export interface ITunesImportSummary {
  available: boolean;
  xmlPath?: string;
  scanned: number;
  added: number;
  skipped: number;
  failed: number;
  reason?: string;
}

export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    (('__TAURI_INTERNALS__' in window) || ('__TAURI__' in window))
  );
}

export async function importFromITunes(
  onProgress?: (ev: ImportProgress) => void
): Promise<ITunesImportSummary> {
  if (!isTauri()) {
    return {
      available: false,
      scanned: 0,
      added: 0,
      skipped: 0,
      failed: 0,
      reason: 'iTunes import is only available in the native (Tauri) app.',
    };
  }

  const fs = await import('@tauri-apps/plugin-fs');
  const pathApi = await import('@tauri-apps/api/path');

  const home = await pathApi.homeDir();
  const candidates = [
    `${home}/Music/iTunes/iTunes Music Library.xml`,
    `${home}/Music/iTunes/iTunes Library.xml`,
    `${home}/Music/Music/Library.xml`,
  ];
  let xmlPath: string | null = null;
  for (const cand of candidates) {
    try {
      if (await fs.exists(cand)) {
        xmlPath = cand;
        break;
      }
    } catch {
      /* try next candidate */
    }
  }

  if (!xmlPath) {
    return {
      available: true,
      scanned: 0,
      added: 0,
      skipped: 0,
      failed: 0,
      reason:
        'No iTunes / Music library XML found. In Music.app, enable ' +
        'Settings → Advanced → "Share Music Library XML with other applications", ' +
        'then retry.',
    };
  }

  const xmlText = await fs.readTextFile(xmlPath);
  const parsed = plist.parse(xmlText) as unknown as ITunesLibrary;
  const tracksDict = parsed?.Tracks ?? {};
  const trackList = Object.values(tracksDict);
  onProgress?.({ kind: 'scan-found', count: trackList.length });

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of trackList) {
    try {
      if (!t.Location) { skipped++; continue; }
      if (t.Kind && !AUDIO_KINDS.test(t.Kind)) { skipped++; continue; }

      const absPath = fileUrlToPath(t.Location);
      if (!absPath) { skipped++; continue; }
      if (await store.hasTrackByPath(absPath)) { skipped++; continue; }

      try {
        if (!(await fs.exists(absPath))) { skipped++; continue; }
      } catch {
        skipped++;
        continue;
      }

      const track: Track = {
        id: crypto.randomUUID(),
        filePath: absPath,
        fileHash: `itunes:${t['Persistent ID'] ?? t['Track ID']}`,
        title: t.Name ?? filenameOf(absPath),
        artist: t.Artist ?? t['Album Artist'] ?? 'Unknown Artist',
        album: t.Album ?? undefined,
        genre: t.Genre ?? undefined,
        durationSec: (t['Total Time'] ?? 0) / 1000,
        sampleRate: t['Sample Rate'] ?? 44100,
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
        filePath: t.Location,
        error: (err as Error).message,
      });
    }
  }

  return {
    available: true,
    xmlPath,
    scanned: trackList.length,
    added,
    skipped,
    failed,
  };
}

function fileUrlToPath(location: string): string | null {
  if (!location.startsWith('file://')) return null;
  try {
    const url = new URL(location);
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

function filenameOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

interface ITunesTrack {
  'Track ID'?: number;
  'Persistent ID'?: string;
  Name?: string;
  Artist?: string;
  'Album Artist'?: string;
  Album?: string;
  Genre?: string;
  Kind?: string;
  Location?: string;
  'Total Time'?: number;
  'Sample Rate'?: number;
  BPM?: number;
  Year?: number;
  Comments?: string;
}

interface ITunesLibrary {
  Tracks: Record<string, ITunesTrack>;
  Playlists?: Array<{
    Name?: string;
    'Playlist ID'?: number;
    'Playlist Items'?: Array<{ 'Track ID': number }>;
  }>;
}
