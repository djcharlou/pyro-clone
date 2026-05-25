import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type {
  Track,
  TrackAnalysis,
  AnalyzedTrack,
} from '@shared/types';

const DB_NAME = 'pyro-clone';
const DB_VERSION = 1;

interface FileHandleRecord {
  id: string;
  handle: FileSystemFileHandle;
}

interface PyroSchema extends DBSchema {
  tracks: {
    key: string;
    value: Track;
    indexes: { byPath: string; byAddedAt: number };
  };
  analyses: {
    key: string; // trackId
    value: TrackAnalysis;
  };
  fileHandles: {
    key: string; // trackId
    value: FileHandleRecord;
  };
}

export class IndexedDBStore {
  private db: IDBPDatabase<PyroSchema> | null = null;

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await openDB<PyroSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('tracks')) {
          const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
          tracks.createIndex('byPath', 'filePath', { unique: true });
          tracks.createIndex('byAddedAt', 'addedAt');
        }
        if (!db.objectStoreNames.contains('analyses')) {
          db.createObjectStore('analyses', { keyPath: 'trackId' });
        }
        if (!db.objectStoreNames.contains('fileHandles')) {
          db.createObjectStore('fileHandles', { keyPath: 'id' });
        }
      },
    });
  }

  private require(): IDBPDatabase<PyroSchema> {
    if (!this.db) throw new Error('IndexedDBStore not opened');
    return this.db;
  }

  async upsertTrack(t: Track): Promise<void> {
    await this.require().put('tracks', t);
  }

  async hasTrackByPath(filePath: string): Promise<boolean> {
    const key = await this.require().getKeyFromIndex('tracks', 'byPath', filePath);
    return key !== undefined;
  }

  async saveAnalysis(a: TrackAnalysis): Promise<void> {
    await this.require().put('analyses', a);
  }

  async saveFileHandle(trackId: string, handle: FileSystemFileHandle): Promise<void> {
    try {
      await this.require().put('fileHandles', { id: trackId, handle });
    } catch (err) {
      // Some browsers may not allow structured-cloning of FileSystemFileHandle
      console.warn('[db] could not persist file handle for', trackId, err);
    }
  }

  async getFileHandle(trackId: string): Promise<FileSystemFileHandle | null> {
    const rec = await this.require().get('fileHandles', trackId);
    return rec?.handle ?? null;
  }

  async listTracks(): Promise<AnalyzedTrack[]> {
    const db = this.require();
    const [tracks, analyses] = await Promise.all([
      db.getAllFromIndex('tracks', 'byAddedAt'),
      db.getAll('analyses'),
    ]);
    const analysisByTrackId = new Map<string, TrackAnalysis>();
    for (const a of analyses) analysisByTrackId.set(a.trackId, a);
    const merged: AnalyzedTrack[] = tracks.map((t) => ({
      ...t,
      analysis: analysisByTrackId.get(t.id),
    }));
    merged.sort((a, b) => b.addedAt - a.addedAt);
    return merged;
  }

  async clearAll(): Promise<void> {
    const db = this.require();
    await Promise.all([
      db.clear('tracks'),
      db.clear('analyses'),
      db.clear('fileHandles'),
    ]);
  }
}

export const store = new IndexedDBStore();
