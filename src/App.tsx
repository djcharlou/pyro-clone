import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './state/store';
import { AudioEngine } from './audio/AudioEngine';
import { AnalysisQueue } from './analyzer/AnalysisQueue';
import { pickNext } from './selector/Selector';
import { computeScore } from './selector/scoring';
import type {
  AnalyzedTrack,
  SelectionResult,
  Playlist,
} from '@shared/types';
import { NowPlaying } from './components/NowPlaying';
import { QueueList } from './components/QueueList';
import { Suggestions } from './components/Suggestions';
import { AddSheet } from './components/AddSheet';
import { PlaylistsSheet } from './components/PlaylistsSheet';
import { WorkshopView } from './components/WorkshopView';
import { store } from './db/IndexedDBStore';
import {
  importFiles,
  importViaDirectoryPicker,
  fileRegistry,
  supportsDirectoryPicker,
  type ImportProgress,
} from './library/Importer';

export function App(): JSX.Element {
  const [, forceUpdate] = useState(0);
  const tracks = useStore((s) => s.tracks);
  const setTracks = useStore((s) => s.setTracks);
  const upsertAnalysis = useStore((s) => s.upsertAnalysis);
  const activeDeck = useStore((s) => s.activeDeck);
  const setActiveDeck = useStore((s) => s.setActiveDeck);
  const setDeck = useStore((s) => s.setDeck);
  const session = useStore((s) => s.session);
  const pushHistory = useStore((s) => s.pushHistory);
  const setLastPick = useStore((s) => s.setLastPick);
  const autoMix = useStore((s) => s.autoMix);
  const setAutoMix = useStore((s) => s.setAutoMix);
  const markAnalyzing = useStore((s) => s.markAnalyzing);
  const setImportState = useStore((s) => s.setImportState);
  const importState = useStore((s) => s.importState);
  const queue = useStore((s) => s.queue);
  const setQueue = useStore((s) => s.setQueue);
  const addToQueue = useStore((s) => s.addToQueue);
  const addManyToQueue = useStore((s) => s.addManyToQueue);
  const removeFromQueue = useStore((s) => s.removeFromQueue);
  const moveInQueue = useStore((s) => s.moveInQueue);
  const popQueue = useStore((s) => s.popQueue);
  const playlists = useStore((s) => s.playlists);
  const setPlaylists = useStore((s) => s.setPlaylists);
  const sheet = useStore((s) => s.sheet);
  const openSheet = useStore((s) => s.openSheet);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  const engineRef = useRef<AudioEngine | null>(null);
  const queueRef = useRef<AnalysisQueue | null>(null);
  const loadingNextRef = useRef(false);

  useEffect(() => {
    const engine = new AudioEngine({
      onDeckUpdate: () => forceUpdate((x) => x + 1),
      onTransitionEnd: () => {
        setActiveDeck(engine.getActiveId());
        const active = engine.getActive();
        if (active.track) pushHistory(active.track.id);
      },
    });
    engineRef.current = engine;

    const aq = new AnalysisQueue();
    aq.onProgress = (st) => {
      const on = st.phase === 'analyzing' || st.phase === 'decoding';
      markAnalyzing(st.trackId, on);
    };
    queueRef.current = aq;

    void (async () => {
      await store.open();
      const [initialTracks, initialPlaylists] = await Promise.all([
        store.listTracks(),
        store.listPlaylists(),
      ]);
      setTracks(initialTracks);
      setPlaylists(initialPlaylists);
    })();

    return () => {
      aq.destroy();
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const a = engine.deckA;
      const b = engine.deckB;
      setDeck('A', {
        trackId: a.track?.id ?? null,
        playing: a.isPlaying,
        positionSec: a.positionSec(),
      });
      setDeck('B', {
        trackId: b.track?.id ?? null,
        playing: b.isPlaying,
        positionSec: b.positionSec(),
      });
      forceUpdate((x) => x + 1);
    }, 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!autoMix) return;
    const id = window.setInterval(() => void maybeStartAutoTransition(), 500);
    return () => window.clearInterval(id);
  }, [autoMix, tracks, session, queue]);

  const tracksById = useMemo(() => {
    const m = new Map<string, AnalyzedTrack>();
    for (const t of tracks) m.set(t.id, t);
    return m;
  }, [tracks]);

  const queueTracks = useMemo(
    () => queue.map((id) => tracksById.get(id)).filter((t): t is AnalyzedTrack => !!t),
    [queue, tracksById]
  );

  const queueIds = useMemo(() => new Set(queue), [queue]);

  const currentTrack: AnalyzedTrack | null =
    (engineRef.current?.getActive().track && tracksById.get(engineRef.current.getActive().track!.id)) ||
    engineRef.current?.getActive().track ||
    null;
  const activeDeckObj = engineRef.current?.getActive();
  const playing = activeDeckObj?.isPlaying ?? false;
  const positionSec = activeDeckObj?.positionSec() ?? 0;
  const durationSec = activeDeckObj?.duration ?? currentTrack?.durationSec ?? 0;
  const stretchRatio = activeDeckObj?.getStretchRatio() ?? 1;
  const effectiveBpm =
    currentTrack?.analysis?.beatGrid.bpm !== undefined
      ? currentTrack.analysis.beatGrid.bpm * stretchRatio
      : null;

  // Suggestions: top-ranked matches for the LAST track in queue (or currently
  // playing if queue empty), excluding tracks already in queue + current.
  const suggestions: SelectionResult[] = useMemo(() => {
    const reference = queueTracks.length > 0 ? queueTracks[queueTracks.length - 1] : currentTrack;
    if (!reference || !reference.analysis) return [];
    const excludeIds = new Set([reference.id, ...queue]);
    const pool = tracks.filter((t) => t.analysis && !excludeIds.has(t.id));
    if (pool.length === 0) return [];
    return pool
      .map((cand) => {
        const { score, parts } = computeScore(cand, {
          current: reference,
          historyTracks: queueTracks,
          weights: session.weights,
          targetEnergy: session.targetEnergy,
        });
        return {
          track: cand,
          score,
          parts,
          mode: 'normal' as const,
          reasoning: `score=${score.toFixed(2)} bpm=${parts.bpm.toFixed(2)} key=${parts.key.toFixed(2)}`,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [tracks, queueTracks, currentTrack, session, queue]);

  async function loadAudioBuffer(track: AnalyzedTrack): Promise<ArrayBuffer | null> {
    const file = await fileRegistry.getFile(track.id);
    if (!file) {
      console.warn('[load] no file for', track.title);
      return null;
    }
    return await file.arrayBuffer();
  }

  async function loadTrackIntoInactive(track: AnalyzedTrack): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const buffer = await loadAudioBuffer(track);
    if (!buffer) return;
    await engine.loadIntoInactive(track, buffer);
    forceUpdate((x) => x + 1);
  }

  async function loadTrackIntoActive(track: AnalyzedTrack): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const buffer = await loadAudioBuffer(track);
    if (!buffer) return;
    await engine.loadIntoActive(track, buffer);
    if (engine.getActive().track && !engine.getActive().isPlaying) {
      pushHistory(track.id);
    }
    forceUpdate((x) => x + 1);
  }

  async function maybeStartAutoTransition(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const active = engine.getActive();
    if (!active.track || !active.isPlaying) return;
    const bpmA = active.bpm;
    const fadeBeats = 32;
    const fadeDur = Math.min(20, Math.max(6, (fadeBeats * 60) / bpmA));

    const pos = active.positionSec();
    const dur = active.duration;
    const mixOut = active.track.analysis?.cues.mixOutPoint ?? Math.max(0, dur - 16);
    const triggerAt = mixOut - fadeDur - 0.7;
    if (pos < triggerAt) return;

    const inactive = engine.getInactive();
    if (!inactive.track) {
      if (loadingNextRef.current) return;
      await loadNextIntoInactive();
      return;
    }
    if (inactive.isPlaying) return;
    const offset = inactive.track.analysis?.cues.mixInPoint ?? 0;
    engine.crossfade({ durationBeats: fadeBeats, deckBStartOffset: offset });
    // Pop from queue if the loaded inactive matches the head
    if (queue.length > 0 && queue[0] === inactive.track.id) {
      popQueue();
    }
  }

  async function loadNextIntoInactive(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    loadingNextRef.current = true;
    try {
      // Prefer the head of the queue if any
      if (queue.length > 0) {
        const next = tracksById.get(queue[0]);
        if (next) {
          await loadTrackIntoInactive(next);
          return;
        }
      }
      // Else use the selector
      const active = engine.getActive();
      if (!active.track) return;
      const analyzedPool = tracks.filter(
        (t) => t.analysis && fileRegistry.has(t.id)
      );
      if (analyzedPool.length < 2) return;
      const report = pickNext({
        pool: analyzedPool,
        current: active.track,
        session,
      });
      setLastPick(report.picked);
      addToQueue(report.picked.track.id);
      await loadTrackIntoInactive(report.picked.track);
    } finally {
      loadingNextRef.current = false;
    }
  }

  function handleProgress(ev: ImportProgress): void {
    if (ev.kind === 'track-added' && ev.track) {
      setImportState({ lastTrackTitle: ev.track.title });
    }
  }

  async function handleImportDirectory(): Promise<void> {
    if (!supportsDirectoryPicker()) return;
    setImportState({ running: true, added: 0, failed: 0, lastTrackTitle: '' });
    try {
      const summary = await importViaDirectoryPicker(handleProgress);
      setImportState({
        running: false,
        added: summary.added,
        failed: summary.failed,
        lastTrackTitle: '',
      });
      const refreshed = await store.listTracks();
      setTracks(refreshed);
      void analyzeUnanalyzed(refreshed);
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') {
        console.error('[import]', err);
      }
      setImportState({ running: false, added: 0, failed: 0, lastTrackTitle: '' });
    }
  }

  async function handleImportFiles(files: FileList | File[]): Promise<void> {
    setImportState({ running: true, added: 0, failed: 0, lastTrackTitle: '' });
    try {
      const summary = await importFiles(files, handleProgress);
      setImportState({
        running: false,
        added: summary.added,
        failed: summary.failed,
        lastTrackTitle: '',
      });
      const refreshed = await store.listTracks();
      setTracks(refreshed);
      void analyzeUnanalyzed(refreshed);
    } catch (err) {
      console.error('[import]', err);
      setImportState({ running: false, added: 0, failed: 0, lastTrackTitle: '' });
    }
  }

  async function analyzeUnanalyzed(all: AnalyzedTrack[]): Promise<void> {
    const aq = queueRef.current;
    if (!aq) return;
    const todo = all.filter((t) => !t.analysis && fileRegistry.has(t.id));
    for (const t of todo) {
      try {
        const analysis = await aq.enqueue(t);
        await store.saveAnalysis(analysis);
        upsertAnalysis(t.id, { analysis });
      } catch (err) {
        console.error('[analyze]', t.title, err);
      }
    }
  }

  function handlePlayPause(): void {
    const engine = engineRef.current;
    if (!engine) return;
    const active = engine.getActive();
    if (active.track) {
      if (active.isPlaying) active.stop();
      else {
        engine.playActive(0);
        pushHistory(active.track.id);
      }
    } else if (queueTracks.length > 0) {
      // Start from the queue
      void (async () => {
        const first = queueTracks[0];
        await loadTrackIntoActive(first);
        engine.playActive(first.analysis?.cues.mixInPoint ?? 0);
        popQueue();
      })();
    }
    forceUpdate((x) => x + 1);
  }

  async function handleSkip(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const inactive = engine.getInactive();
    if (!inactive.track) {
      // Load next from queue first
      await loadNextIntoInactive();
    }
    if (engine.getInactive().track) {
      const offset = engine.getInactive().track!.analysis?.cues.mixInPoint ?? 0;
      engine.crossfade({ durationBeats: 8, minDurationSec: 2, deckBStartOffset: offset });
      if (queue.length > 0 && queue[0] === engine.getInactive().track!.id) {
        popQueue();
      }
    }
  }

  function handleSeek(fraction: number): void {
    const engine = engineRef.current;
    if (!engine) return;
    const active = engine.getActive();
    if (!active.track) return;
    const target = fraction * active.duration;
    active.play(target);
  }

  async function handlePlayNowFromQueue(id: string): Promise<void> {
    const track = tracksById.get(id);
    if (!track) return;
    const engine = engineRef.current;
    if (!engine) return;
    await loadTrackIntoActive(track);
    engine.playActive(track.analysis?.cues.mixInPoint ?? 0);
    removeFromQueue(id);
  }

  // Sheet handlers
  async function handleSavePlaylist(name: string): Promise<void> {
    if (queue.length === 0) return;
    const playlist: Playlist = {
      id: crypto.randomUUID(),
      name,
      trackIds: [...queue],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await store.savePlaylist(playlist);
    const list = await store.listPlaylists();
    setPlaylists(list);
  }

  async function handleLoadPlaylist(id: string): Promise<void> {
    const p = playlists.find((x) => x.id === id);
    if (!p) return;
    setQueue(p.trackIds.filter((tid) => tracksById.has(tid)));
    openSheet(null);
  }

  async function handleDeletePlaylist(id: string): Promise<void> {
    await store.deletePlaylist(id);
    const list = await store.listPlaylists();
    setPlaylists(list);
  }

  return (
    <div className={`app app--${view}`}>
      <header className="app-header">
        <div className="app-brand">
          <span className="brand-dot" />
          pyro
        </div>
        <div className="view-tabs">
          <button
            className={`view-tab ${view === 'party' ? 'view-tab--active' : ''}`}
            onClick={() => setView('party')}
          >
            Party
          </button>
          <button
            className={`view-tab ${view === 'workshop' ? 'view-tab--active' : ''}`}
            onClick={() => setView('workshop')}
          >
            Workshop
          </button>
        </div>
        <div className="app-header-actions">
          {view === 'party' && (
            <button
              className={`auto-toggle ${autoMix ? 'auto-toggle--on' : ''}`}
              onClick={() => setAutoMix(!autoMix)}
              title="Auto-mix"
            >
              ⚡ {autoMix ? 'ON' : 'OFF'}
            </button>
          )}
          <button
            className="header-btn"
            onClick={() => openSheet('playlists')}
            title="Playlists"
          >
            ☰
          </button>
        </div>
      </header>

      {view === 'party' ? (
        <>
          <NowPlaying
            track={currentTrack}
            playing={playing}
            positionSec={positionSec}
            durationSec={durationSec}
            effectiveBpm={effectiveBpm}
            stretchRatio={stretchRatio}
            onPlayPause={handlePlayPause}
            onSkip={() => void handleSkip()}
            onSeekFraction={handleSeek}
          />

          <main className="main">
            <QueueList
              queueTracks={queueTracks}
              onRemove={removeFromQueue}
              onMove={moveInQueue}
              onPlayNow={(id) => void handlePlayNowFromQueue(id)}
            />

            <Suggestions
              candidates={suggestions}
              onAdd={(id) => addToQueue(id)}
            />
          </main>
        </>
      ) : (
        <main className="main main--workshop">
          <WorkshopView />
        </main>
      )}

      <button
        className="fab"
        onClick={() => openSheet('add')}
        aria-label="Add tracks"
      >
        +
      </button>

      <footer className="status-bar">
        <span>
          {tracks.length} tracks · {tracks.filter((t) => t.analysis).length} analyzed
          {useStore.getState().analyzingIds.size > 0 &&
            ` · analyzing ${useStore.getState().analyzingIds.size}`}
        </span>
        {importState.running && <span>Importing: {importState.lastTrackTitle || '…'}</span>}
      </footer>

      <AddSheet
        open={sheet === 'add'}
        tracks={tracks}
        queueIds={queueIds}
        onClose={() => openSheet(null)}
        onAdd={(id) => addToQueue(id)}
        onAddMany={(ids) => addManyToQueue(ids.filter((id) => !queueIds.has(id)))}
        onImportFolder={() => void handleImportDirectory()}
        onImportFiles={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.accept = 'audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus';
          input.onchange = () => {
            if (input.files) void handleImportFiles(input.files);
          };
          input.click();
        }}
        supportsDirectoryPicker={supportsDirectoryPicker()}
      />

      <PlaylistsSheet
        open={sheet === 'playlists'}
        playlists={playlists}
        currentQueueLength={queue.length}
        onClose={() => openSheet(null)}
        onSaveCurrent={(name) => void handleSavePlaylist(name)}
        onLoad={(id) => void handleLoadPlaylist(id)}
        onDelete={(id) => void handleDeletePlaylist(id)}
      />
    </div>
  );
}
