import { create } from 'zustand';
import type {
  AnalyzedTrack,
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

  autoMix: false,
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
}));
