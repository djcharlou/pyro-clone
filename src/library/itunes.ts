/**
 * iTunes / Music.app library import — placeholder.
 *
 * Real implementation is deferred (needs Tauri fs + plist parser).
 * This stub keeps the import site compiling so other work isn't blocked.
 */
import type { ImportProgress } from '@/library/Importer';

export interface ITunesImportSummary {
  available: boolean;
  reason?: string;
  added: number;
  skipped: number;
  failed: number;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined'
    && (('__TAURI_INTERNALS__' in window) || ('__TAURI__' in window));
}

export async function importFromITunes(
  _onProgress?: (ev: ImportProgress) => void
): Promise<ITunesImportSummary> {
  return {
    available: false,
    reason: 'iTunes / Music.app import is not implemented yet',
    added: 0,
    skipped: 0,
    failed: 0,
  };
}
