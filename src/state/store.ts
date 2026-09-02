import { create } from 'zustand';
import type {
  AnalyzedTrack,
  Playlist,
  SessionState,
  SelectionResult,
} from '@shared/types';
import { DEFAULT_WEIGHTS } from '@shared/types';

export type DeckSide = 'A' | 'B';

interface DeckState {
  trackId: string | null;
  loading: boolean;
  playing: boolean;
  positionSec: number;
}

interface ImportState {
  running: boolean;
  added: number;
  failed: number;
  lastTrackTitle: string;
}

interface AppState {
  tracks: AnalyzedTrack[];
  setTracks(tracks: AnalyzedTrack[]): void;
  upsertAnalysis(trackId: string, partial: Partial<AnalyzedTrack>): void;

  decks: Record<DeckSide, DeckState>;
  setDeck(side: DeckSide, patch: Partial<DeckState>): void;

  activeDeck: DeckSide;
  setActiveDeck(side: DeckSide): void;

  session: SessionState;
  pushHistory(trackId: string): void;
  resetSession(): void;

  lastPick: SelectionResult | null;
  setLastPick(pick: SelectionResult | null): void;

  autoMix: boolean;
  setAutoMix(on: boolean): void;

  importState: ImportState;
  setImportState(patch: Partial<ImportState>): void;

  analyzingIds: Set<string>;
  markAnalyzing(id: string, on: boolean): void;

  // Total pending analysis (for HUD progress bar). Distinct from analyzingIds:
  // total is set when a batch enqueues, decremented when each finishes.
  analysisTotal: number;
  setAnalysisTotal(n: number): void;
  incrementAnalysisTotal(delta: number): void;

  // Queue: ordered list of track IDs to play next (after current)
  queue: string[];
  setQueue(ids: string[]): void;
  addToQueue(id: string): void;
  addManyToQueue(ids: string[]): void;
  removeFromQueue(id: string): void;
  moveInQueue(fromIdx: number, toIdx: number): void;
  popQueue(): string | null;
  clearQueue(): void;

  // Stored playlists
  playlists: Playlist[];
  setPlaylists(p: Playlist[]): void;

  // UI: bottom sheet open state
  sheet: 'add' | 'playlists' | 'library' | 'spotify' | null;
  openSheet(s: AppState['sheet']): void;

  // Top-level view mode
  view: 'party' | 'workshop';
  setView(v: 'party' | 'workshop'): void;

  // Update in-memory track fields (call sites also persist to IDB)
  updateTrackFields(
    id: string,
    patch: Partial<Pick<AnalyzedTrack, 'title' | 'artist' | 'album' | 'genre'>>
  ): void;
}

export const useStore = create<AppState>((set) => ({
  tracks: [],
  setTracks: (tracks) => set({ tracks }),
  upsertAnalysis: (trackId, partial) =>
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, ...partial } : t)),
    })),

  decks: {
    A: { trackId: null, loading: false, playing: false, positionSec: 0 },
    B: { trackId: null, loading: false, playing: false, positionSec: 0 },
  },
  setDeck: (side, patch) =>
    set((s) => ({ decks: { ...s.decks, [side]: { ...s.decks[side], ...patch } } })),

  activeDeck: 'A',
  setActiveDeck: (side) => set({ activeDeck: side }),

  session: {
    history: [],
    targetEnergy: 0.55,
    elapsedSeconds: 0,
    weights: DEFAULT_WEIGHTS,
  },
  pushHistory: (trackId) =>
    set((s) => ({ session: { ...s.session, history: [...s.session.history, trackId] } })),
  resetSession: () =>
    set({
      session: {
        history: [],
        targetEnergy: 0.55,
        elapsedSeconds: 0,
        weights: DEFAULT_WEIGHTS,
      },
    }),

  lastPick: null,
  setLastPick: (pick) => set({ lastPick: pick }),

  autoMix: true,
  setAutoMix: (on) => set({ autoMix: on }),

  importState: { running: false, added: 0, failed: 0, lastTrackTitle: '' },
  setImportState: (patch) =>
    set((s) => ({ importState: { ...s.importState, ...patch } })),

  analyzingIds: new Set<string>(),
  markAnalyzing: (id, on) =>
    set((s) => {
      const next = new Set(s.analyzingIds);
      if (on) next.add(id);
      else next.delete(id);
      return { analyzingIds: next };
    }),

  analysisTotal: 0,
  setAnalysisTotal: (n) => set({ analysisTotal: n }),
  incrementAnalysisTotal: (delta) =>
    set((s) => ({ analysisTotal: Math.max(0, s.analysisTotal + delta) })),

  queue: [],
  setQueue: (ids) => set({ queue: ids }),
  addToQueue: (id) => set((s) => ({ queue: [...s.queue, id] })),
  addManyToQueue: (ids) => set((s) => ({ queue: [...s.queue, ...ids] })),
  removeFromQueue: (id) =>
    set((s) => ({ queue: s.queue.filter((q) => q !== id) })),
  moveInQueue: (fromIdx, toIdx) =>
    set((s) => {
      const arr = [...s.queue];
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return { queue: arr };
    }),
  popQueue: () => {
    let popped: string | null = null;
    set((s) => {
      if (s.queue.length === 0) return s;
      popped = s.queue[0];
      return { queue: s.queue.slice(1) };
    });
    return popped;
  },
  clearQueue: () => set({ queue: [] }),

  playlists: [],
  setPlaylists: (p) => set({ playlists: p }),

  sheet: null,
  openSheet: (s) => set({ sheet: s }),

  view: 'party',
  setView: (v) => set({ view: v }),

  updateTrackFields: (id, patch) =>
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
}));
