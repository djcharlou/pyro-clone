import type { AnalyzedTrack } from '@shared/types';

/**
 * Template renaming for audio files.
 * Tokens: {artist} {title} {album} {genre} {bpm} {key} {camelot} {year}
 * Any missing value becomes empty; adjacent separators are collapsed.
 *
 * The output preserves the original file extension. Directory portion of
 * the original path is left untouched — this renames within its folder.
 */

const TOKEN_RE = /\{(artist|title|album|genre|bpm|key|camelot|year)\}/gi;

export interface RenamePreview {
  trackId: string;
  originalPath: string;
  originalName: string;
  newName: string;
  changed: boolean;
  reason?: string;
}

export function renderTemplate(t: AnalyzedTrack, template: string): string {
  return template.replace(TOKEN_RE, (_m, key: string) => {
    const k = key.toLowerCase();
    const a = t.analysis;
    switch (k) {
      case 'artist': return sanitize(t.artist);
      case 'title': return sanitize(t.title);
      case 'album': return sanitize(t.album ?? '');
      case 'genre': return sanitize(t.genre ?? '');
      case 'bpm': return a ? String(Math.round(a.beatGrid.bpm)) : '';
      case 'key': return a ? sanitize(camelotToKey(a.key.camelot)) : '';
      case 'camelot': return a?.key.camelot ?? '';
      case 'year': return ''; // year not on Track type yet
      default: return '';
    }
  });
}

export function buildPreview(
  tracks: AnalyzedTrack[],
  template: string
): RenamePreview[] {
  return tracks.map((t) => {
    const originalName = basename(t.filePath);
    const ext = extname(originalName);
    const rendered = renderTemplate(t, template).trim();
    const cleaned = collapseSeparators(rendered);
    const newName = cleaned ? `${cleaned}${ext}` : originalName;
    return {
      trackId: t.id,
      originalPath: t.filePath,
      originalName,
      newName,
      changed: newName !== originalName,
      reason: !cleaned ? 'template rendered empty (missing tags?)' : undefined,
    };
  });
}

function sanitize(s: string): string {
  return s
    .replace(/[/\\:*?"<>|]/g, '_')      // filesystem-unsafe chars
    .replace(/\s+/g, ' ')
    .trim();
}

function collapseSeparators(s: string): string {
  return s
    .replace(/\s*[-_·]\s*[-_·]/g, ' -')
    .replace(/\[\s*\]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([)\]}])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .trim();
}

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

function extname(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '';
}

function camelotToKey(c: string): string {
  const map: Record<string, string> = {
    '1A':'G#m','1B':'B', '2A':'D#m','2B':'F#', '3A':'A#m','3B':'C#',
    '4A':'Fm','4B':'G#', '5A':'Cm','5B':'D#', '6A':'Gm','6B':'A#',
    '7A':'Dm','7B':'F',  '8A':'Am','8B':'C',  '9A':'Em','9B':'G',
    '10A':'Bm','10B':'D','11A':'F#m','11B':'A','12A':'C#m','12B':'E',
  };
  return map[c] ?? '';
}

/**
 * Rename files on disk. Native (Tauri) only. Returns per-track results.
 * Uses the fs plugin's rename call — will fail if target already exists
 * and `overwrite` is false (default), keeping the operation safe.
 */
export async function applyRenames(
  previews: RenamePreview[]
): Promise<Array<{ trackId: string; ok: boolean; error?: string; newPath?: string }>> {
  const results: Array<{ trackId: string; ok: boolean; error?: string; newPath?: string }> = [];
  const fs = await import('@tauri-apps/plugin-fs');
  for (const p of previews) {
    if (!p.changed) {
      results.push({ trackId: p.trackId, ok: true, newPath: p.originalPath });
      continue;
    }
    const dir = p.originalPath.slice(0, p.originalPath.length - p.originalName.length);
    const newPath = dir + p.newName;
    try {
      // Guard against overwriting an existing file
      if (await fs.exists(newPath)) {
        results.push({ trackId: p.trackId, ok: false, error: 'Target file already exists' });
        continue;
      }
      await fs.rename(p.originalPath, newPath);
      results.push({ trackId: p.trackId, ok: true, newPath });
    } catch (err) {
      results.push({ trackId: p.trackId, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
