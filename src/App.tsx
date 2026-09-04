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
import { HUD } from './components/HUD';
import { SpotifySheet } from './components/SpotifySheet';
import { smartReorderQueue } from './selector/smartReorder';
import { store } from './db/IndexedDBStore';
import { completeLoginIfCallback, loadAuth, type SpotifyAuthState } from './spotify/oauth';
import { enrichWithSpotify } from './spotify/enrichment';
import { initPlayer, playSpotifyUris, type PlayerBridge } from './spotify/player';
import {
  importFiles,
  importViaDirectoryPicker,
  fileRegistry,
  supportsDirectoryPicker,
  type ImportProgress,
} from './library/Importer';
import { importFromITunes, isTauri } from './library/itunes';
import { pickAudioFilesNative, pickFolderNative } from './library/tauriImport';
import { effectiveMixInPoint, effectiveMixOutPoint } from './library/cues';
import { resyncLibrary } from './analyzer/resyncFromTags';
import { DecksView } from './components/decks/DecksView';

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
  const clearQueue = useStore((s) => s.clearQueue);
  const resetSession = useStore((s) => s.resetSession);
  const playlists = useStore((s) => s.playlists);
  const setPlaylists = useStore((s) => s.setPlaylists);
  const sheet = useStore((s) => s.sheet);
  const openSheet = useStore((s) => s.openSheet);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const analyzingIds = useStore((s) => s.analyzingIds);
  const analysisTotal = useStore((s) => s.analysisTotal);
  const setAnalysisTotal = useStore((s) => s.setAnalysisTotal);
  const incrementAnalysisTotal = useStore((s) => s.incrementAnalysisTotal);

  const engineRef = useRef<AudioEngine | null>(null);
  const queueRef = useRef<AnalysisQueue | null>(null);
  const loadingNextRef = useRef(false);
  const [spotifyAuth, setSpotifyAuth] = useState<SpotifyAuthState | null>(() => loadAuth());
  const [enrichmentBusy, setEnrichmentBusy] = useState(false);
  const [enrichmentStatus, setEnrichmentStatus] = useState('');
  const [playbackBridge, setPlaybackBridge] = useState<PlayerBridge | null>(null);
  // A deck that refuses a track has to say so. Silently doing nothing is how a
  // moved file or a stale handle turns into "the button doesn't work".
  const [deckNote, setDeckNote] = useState<{ A: string | null; B: string | null }>({
    A: null,
    B: null,
  });
  // Whether a track leaves the queue once it has played. Off by default:
  // the queue reads as a playlist you can replay from. Persisted so the
  // choice survives a restart.
  const [drainQueue, setDrainQueue] = useState<boolean>(() => {
    try { return localStorage.getItem('pyro.drainQueue') === '1'; } catch { return false; }
  });

  useEffect(() => {
    const engine = new AudioEngine({
      onDeckUpdate: () => forceUpdate((x) => x + 1),
      onTransitionEnd: () => {
        setActiveDeck(engine.getActiveId());
        const active = engine.getActive();
        if (!active.track) return;
        pushHistory(active.track.id);
        // In drain mode the track that just finished leaves the queue, so
        // the list behaves like a crate you work through. Read the flag
        // from localStorage rather than closing over React state, since
        // this callback is created once at mount.
        let drain = false;
        try { drain = localStorage.getItem('pyro.drainQueue') === '1'; } catch { /* private mode */ }
        if (drain) {
          const finishedId = engine.getInactive().track?.id;
          if (finishedId) removeFromQueue(finishedId);
        }
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

      // Repair tempo data from authoritative sources before anything plays.
      // Serato writes its exact BPM and beat anchor into the file's ID3
      // tags, and DJ-edit packs put the tempo in the filename — both beat
      // whatever an older build of the estimator guessed. This reads files
      // but never decodes them, so it is quick even on a large library.
      void (async () => {
        try {
          const { updates, report } = await resyncLibrary(initialTracks);
          if (updates.length === 0) return;
          for (const u of updates) {
            await store.saveAnalysis(u.analysis);
          }
          const refreshed = await store.listTracks();
          setTracks(refreshed);
          const bySerato = report.updated.filter((u) => u.source === 'serato').length;
          console.info(
            `[resync] corrected ${updates.length}/${report.scanned} tempos ` +
            `(${bySerato} from Serato tags, ${updates.length - bySerato} from filename)`
          );
          for (const u of report.updated.slice(0, 20)) {
            console.info(`[resync]   ${u.fromBpm.toFixed(1)} -> ${u.toBpm.toFixed(2)} (${u.source})  ${u.title}`);
          }
        } catch (err) {
          console.error('[resync] failed', err);
        }
      })();
      // Complete Spotify OAuth if we came back with ?code=
      try {
        const auth = await completeLoginIfCallback();
        if (auth) {
          setSpotifyAuth(auth);
          openSheet('spotify');
        }
      } catch (err) {
        console.error('[spotify oauth]', err);
      }
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
    // Manual mixing owns the decks in the Decks view — an auto transition
    // firing over the user's fader moves would be actively hostile.
    if (!autoMix || view === 'decks') return;
    const id = window.setInterval(() => void maybeStartAutoTransition(), 500);
    return () => window.clearInterval(id);
  }, [autoMix, tracks, session, queue, view]);

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

  const autoMixNextInSec: number | null = useMemo(() => {
    if (!autoMix || !currentTrack || !playing) return null;
    const bpmA = currentTrack.analysis?.beatGrid.bpm ?? 120;
    const fadeBeats = 64;
    const fadeDur = Math.min(20, Math.max(6, (fadeBeats * 60) / bpmA));
    const mixOut = effectiveMixOutPoint(currentTrack, 16);
    return Math.max(0, mixOut - fadeDur - positionSec);
  }, [autoMix, currentTrack, playing, positionSec, durationSec]);

  const analyzedCount = useMemo(
    () => tracks.filter((t) => t.analysis).length,
    [tracks]
  );

  /** Tracks whose file we can't reach — imported in a previous session
   * via browser-only APIs, so the relative filePath is unusable now. */
  const orphanTracks = useMemo(() => {
    if (!isTauri()) return [] as AnalyzedTrack[];
    return tracks.filter((t) =>
      !fileRegistry.has(t.id) &&
      !(t.filePath ?? '').startsWith('/')
    );
  }, [tracks]);

  async function handleCleanupOrphans(): Promise<void> {
    if (orphanTracks.length === 0) return;
    const ok = confirm(
      `${orphanTracks.length} track${orphanTracks.length > 1 ? 's are' : ' is'} unreachable ` +
      `(imported in a previous session via the browser file picker). ` +
      `Remove them from the library? Files on disk stay untouched.`
    );
    if (!ok) return;
    const ids = orphanTracks.map((t) => t.id);
    await store.deleteTracks(ids);
    for (const id of ids) removeFromQueue(id);
    const refreshed = await store.listTracks();
    setTracks(refreshed);
  }

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
    let file = await fileRegistry.getFile(track.id);
    // In Tauri (native) mode, a track loaded from iTunes or scanned in a
    // previous session may not have a registry entry yet (the in-memory
    // map is per-session). track.filePath is the absolute path on disk —
    // register it on the fly and retry once.
    if (!file && isTauri() && track.filePath?.startsWith('/')) {
      console.info('[load] re-registering tauri path for', track.title, track.filePath);
      fileRegistry.putTauriPath(track.id, track.filePath);
      file = await fileRegistry.getFile(track.id);
    }
    if (!file) {
      console.warn('[load] no file available for', track.title,
        '— filePath was', track.filePath,
        '— run in Tauri native or re-import the folder to get a fresh file handle.');
      return null;
    }
    try {
      return await file.arrayBuffer();
    } catch (err) {
      console.error('[load] arrayBuffer() failed for', track.title, err);
      return null;
    }
  }

  async function loadTrackIntoInactive(track: AnalyzedTrack): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const buffer = await loadAudioBuffer(track);
    if (!buffer) return;
    try {
      await engine.loadIntoInactive(track, buffer);
    } catch (err) {
      console.error('[decode] failed for', track.title, err);
      alert(`Cannot decode ${track.title}: ${(err as Error).message}`);
      return;
    }
    forceUpdate((x) => x + 1);
  }

  async function loadTrackIntoActive(track: AnalyzedTrack): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const buffer = await loadAudioBuffer(track);
    if (!buffer) return;
    try {
      await engine.loadIntoActive(track, buffer);
    } catch (err) {
      console.error('[decode] failed for', track.title, err);
      alert(`Cannot decode ${track.title}: ${(err as Error).message}\n\nIf this is a DRM-protected iTunes file (.m4p) or an unusual codec, the browser cannot decode it.`);
      return;
    }
    if (engine.getActive().track && !engine.getActive().isPlaying) {
      pushHistory(track.id);
    }
    forceUpdate((x) => x + 1);
  }

  async function maybeStartAutoTransition(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const active = engine.getActive();

    // AUTO-START: if nothing is playing and there's material to work with,
    // kick things off automatically. Also covers the "track ended without
    // a crossfade because auto-mix couldn't schedule one in time" case.
    if (!active.track || !active.isPlaying) {
      // A deliberate pause is not "nothing is playing" — without this the
      // 500ms auto-mix tick restarts playback and pause appears to do
      // nothing at all.
      if (active.isPaused) return;
      if (loadingNextRef.current) return;
      loadingNextRef.current = true;
      try {
        // If a track was loaded but ended without a crossfade, mark it as
        // played so we don't pick it again next tick (the "same track
        // restarts" bug).
        const endedId = active.track?.id;
        if (endedId && !session.history.includes(endedId)) {
          pushHistory(endedId);
        }
        const playedSet = new Set([
          ...session.history,
          ...(endedId ? [endedId] : []),
        ]);
        // Pick first queue entry not yet played, else first library track
        const firstQueuedId = queue.find((id) => !playedSet.has(id));
        const first = firstQueuedId
          ? tracksById.get(firstQueuedId) ?? null
          : tracks.find((t) => t.analysis && fileRegistry.has(t.id) && !playedSet.has(t.id)) ?? null;
        if (!first) return;
        if (active.track?.id !== first.id) {
          await loadTrackIntoActive(first);
        }
        engine.playActive(effectiveMixInPoint(first));
        // Mark it as played immediately so nothing picks it again.
        pushHistory(first.id);
      } finally {
        loadingNextRef.current = false;
      }
      return;
    }

    const bpmA = active.bpm;
    const fadeBeats = 64;
    const fadeDur = Math.min(20, Math.max(6, (fadeBeats * 60) / bpmA));

    const pos = active.positionSec();
    const dur = active.duration;
    const mixOut = effectiveMixOutPoint(active.track, 16);
    const triggerAt = mixOut - fadeDur - 0.7;
    if (pos < triggerAt) return;

    const inactive = engine.getInactive();
    if (!inactive.track) {
      if (loadingNextRef.current) return;
      await loadNextIntoInactive();
      return;
    }
    if (inactive.isPlaying) return;
    const offset = effectiveMixInPoint(inactive.track);
    engine.crossfade({ durationBeats: fadeBeats, deckBStartOffset: offset });
    // Pop from queue if the loaded inactive matches the head
    /* Queue is a playlist — do NOT pop it. History tracks what already
     * played; loadNextIntoInactive skips history entries. */
  }

  async function loadNextIntoInactive(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    loadingNextRef.current = true;
    try {
      // Never pick the currently-active track as the next one — that would
      // crossfade the same song to itself (perceived as a restart).
      const active = engine.getActive();
      const activeId = active.track?.id;
      const playedSet = new Set([...session.history, ...(activeId ? [activeId] : [])]);
      // Prefer the first queue entry not yet played AND not the current one.
      const nextIdInQueue = queue.find((id) => !playedSet.has(id));
      if (nextIdInQueue) {
        const next = tracksById.get(nextIdInQueue);
        if (next) {
          await loadTrackIntoInactive(next);
          return;
        }
      }
      // Else use the selector
      if (!active.track) return;
      const analyzedPool = tracks.filter(
        (t) => t.analysis && fileRegistry.has(t.id) && t.id !== activeId
      );
      if (analyzedPool.length < 1) return;
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
    setImportState({ running: true, added: 0, failed: 0, lastTrackTitle: '' });
    try {
      // Prefer the native Tauri picker when available — absolute paths
      // that survive across app restarts.
      const summary =
        (await pickFolderNative(handleProgress)) ??
        (supportsDirectoryPicker() ? await importViaDirectoryPicker(handleProgress) : { added: 0, skipped: 0, failed: 0 });
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

  async function handleImportFilesNative(): Promise<void> {
    setImportState({ running: true, added: 0, failed: 0, lastTrackTitle: '' });
    try {
      const summary = await pickAudioFilesNative(handleProgress);
      if (!summary) return;
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
      console.error('[import-native]', err);
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

  async function handleImportITunes(): Promise<void> {
    setImportState({ running: true, added: 0, failed: 0, lastTrackTitle: '' });
    try {
      const summary = await importFromITunes(handleProgress);
      if (!summary.available) {
        alert(summary.reason ?? 'iTunes import is unavailable in the browser build.');
        setImportState({ running: false, added: 0, failed: 0, lastTrackTitle: '' });
        return;
      }
      if (summary.reason && summary.added === 0) alert(summary.reason);
      setImportState({
        running: false,
        added: summary.added,
        failed: summary.failed,
        lastTrackTitle: `${summary.added} added, ${summary.skipped} skipped`,
      });
      const refreshed = await store.listTracks();
      setTracks(refreshed);
      void analyzeUnanalyzed(refreshed);
    } catch (err) {
      console.error('[itunes]', err);
      alert(`iTunes import failed: ${(err as Error).message}`);
      setImportState({ running: false, added: 0, failed: 0, lastTrackTitle: '' });
    }
  }

  async function analyzeUnanalyzed(all: AnalyzedTrack[]): Promise<void> {
    const aq = queueRef.current;
    if (!aq) return;
    const todo = all.filter((t) => !t.analysis && fileRegistry.has(t.id));
    if (todo.length === 0) return;
    incrementAnalysisTotal(todo.length);
    for (const t of todo) {
      try {
        const analysis = await aq.enqueue(t);
        await store.saveAnalysis(analysis);
        upsertAnalysis(t.id, { analysis });
      } catch (err) {
        console.error('[analyze]', t.title, err);
      } finally {
        incrementAnalysisTotal(-1);
      }
    }
  }

  function handlePlayPause(): void {
    const engine = engineRef.current;
    if (!engine) return;
    const active = engine.getActive();
    if (active.track) {
      if (active.isPlaying) {
        // Hold position instead of tearing the deck down, so pressing play
        // again continues rather than restarting the track.
        active.pause();
        // Mid-crossfade both decks are audible; pausing one alone would
        // leave the incoming track playing on its own.
        const other = engine.getInactive();
        if (other.isPlaying) other.pause();
      } else if (active.isPaused) {
        active.resume();
        const other = engine.getInactive();
        if (other.isPaused) other.resume();
      } else {
        engine.playActive(effectiveMixInPoint(active.track));
        pushHistory(active.track.id);
      }
    } else if (queueTracks.length > 0) {
      // Start from the queue — playlist mode, don't pop
      void (async () => {
        const first = queueTracks[0];
        await loadTrackIntoActive(first);
        engine.playActive(effectiveMixInPoint(first));
      })();
    }
    forceUpdate((x) => x + 1);
  }

  async function handleSkip(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const inactive = engine.getInactive();
    if (!inactive.track) {
      await loadNextIntoInactive();
    }
    if (engine.getInactive().track) {
      const offset = effectiveMixInPoint(engine.getInactive().track!);
      // 8-beat quick beat-matched fade for manual skip
      engine.crossfade({ durationBeats: 8, minDurationSec: 2, deckBStartOffset: offset });
      /* No popQueue — playlist stays put, history advances via onTransitionEnd */
    }
  }

  /** Smooth 32-beat beatmatched crossfade to the next queued (or picked) track. */
  async function handleMixNow(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const inactive = engine.getInactive();
    if (!inactive.track) {
      await loadNextIntoInactive();
    }
    const nextDeck = engine.getInactive();
    if (nextDeck.track) {
      const offset = effectiveMixInPoint(nextDeck.track);
      engine.crossfade({ durationBeats: 64, deckBStartOffset: offset });
    }
  }

  /** Bypass the queue — pick the current top match from the selector and
   *  smooth-mix straight into it. */
  async function handleNextRecommended(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const active = engine.getActive();
    if (!active.track) return;
    const activeId = active.track.id;
    const pool = tracks.filter(
      (t) => t.analysis && fileRegistry.has(t.id) && t.id !== activeId &&
              !session.history.includes(t.id)
    );
    if (pool.length === 0) return;
    const report = pickNext({ pool, current: active.track, session });
    setLastPick(report.picked);
    // Insert at head of the queue so the visible playlist reflects the pick
    setQueue([report.picked.track.id, ...queue.filter((id) => id !== report.picked.track.id)]);
    await loadTrackIntoInactive(report.picked.track);
    const nextDeck = engine.getInactive();
    if (nextDeck.track) {
      const offset = effectiveMixInPoint(nextDeck.track);
      engine.crossfade({ durationBeats: 64, deckBStartOffset: offset });
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
    engine.playActive(effectiveMixInPoint(track));
    pushHistory(id);
    /* Keep the entry in the playlist — history advancement is enough
     * for the auto-mix to skip it next round. */
  }

  function handleToggleDrainQueue(next: boolean): void {
    setDrainQueue(next);
    try { localStorage.setItem('pyro.drainQueue', next ? '1' : '0'); } catch { /* private mode */ }
    // Turning it on retroactively clears what has already played, so the
    // list immediately matches the setting the user just chose.
    if (next) {
      const played = new Set(session.history);
      setQueue(queue.filter((id) => !played.has(id) || id === currentTrack?.id));
    }
  }

  function handleResetSession(): void {
    if (!confirm('Clear the queue and forget what has played? Your library stays.')) return;
    engineRef.current?.getActive().stop();
    engineRef.current?.getInactive().stop();
    clearQueue();
    resetSession();
    setLastPick(null);
    forceUpdate((x) => x + 1);
  }

  async function handleResetLibrary(): Promise<void> {
    if (!confirm(
      `Erase all ${tracks.length} tracks, their analysis and every saved playlist?\n\n` +
      'This only clears what pyro stored — your audio files on disk are not touched.'
    )) return;
    engineRef.current?.getActive().stop();
    engineRef.current?.getInactive().stop();
    await store.clearAll();
    clearQueue();
    resetSession();
    setLastPick(null);
    setTracks([]);
    setPlaylists([]);
    forceUpdate((x) => x + 1);
  }

  /* ---------------- Manual deck controls (Decks view) ---------------- */

  function deckFor(side: 'A' | 'B') {
    const engine = engineRef.current;
    return side === 'A' ? engine?.deckA ?? null : engine?.deckB ?? null;
  }

  function handleDeckPlayPause(side: 'A' | 'B'): void {
    const deck = deckFor(side);
    if (!deck?.track) return;
    void engineRef.current?.ensureRunning();
    if (deck.isPlaying) deck.pause();
    else if (deck.isPaused) deck.resume();
    else deck.play(effectiveMixInPoint(deck.track));
    forceUpdate((x) => x + 1);
  }

  function handleDeckCue(side: 'A' | 'B'): void {
    const deck = deckFor(side);
    if (!deck?.track) return;
    void engineRef.current?.ensureRunning();
    // CDJ behaviour: cue jumps to the cue point and plays from there.
    deck.play(effectiveMixInPoint(deck.track));
    forceUpdate((x) => x + 1);
  }

  function handleDeckSeek(side: 'A' | 'B', fraction: number): void {
    const deck = deckFor(side);
    if (!deck?.track) return;
    deck.play(Math.max(0, Math.min(1, fraction)) * deck.duration);
    forceUpdate((x) => x + 1);
  }

  /** Load one specific track onto a named deck (library A/B buttons). */
  async function handleDeckLoadTrack(side: 'A' | 'B', trackId: string): Promise<void> {
    const deck = deckFor(side);
    const track = tracksById.get(trackId);
    if (!deck || !track) return;
    const note = (msg: string | null): void => setDeckNote((p) => ({ ...p, [side]: msg }));
    const buffer = await loadAudioBuffer(track);
    if (!buffer) {
      note(
        isTauri()
          ? 'File not found — it may have moved since it was imported.'
          : 'No file handle — re-import the folder to grant access again.'
      );
      return;
    }
    try {
      await deck.load(track, buffer);
    } catch (err) {
      console.error('[decks] load failed', track.title, err);
      note('Could not decode this file.');
      return;
    }
    note(null);
    forceUpdate((x) => x + 1);
  }

  /** Load the first not-yet-played queue entry onto a specific deck. */
  async function handleDeckLoad(side: 'A' | 'B'): Promise<void> {
    const engine = engineRef.current;
    const deck = deckFor(side);
    if (!engine || !deck) return;
    const played = new Set(session.history);
    const onDecks = new Set(
      [engine.deckA.track?.id, engine.deckB.track?.id].filter(Boolean) as string[]
    );
    const nextId =
      queue.find((id) => !played.has(id) && !onDecks.has(id)) ??
      queue.find((id) => !onDecks.has(id));
    const track = nextId ? tracksById.get(nextId) : undefined;
    if (!track) return;
    const buffer = await loadAudioBuffer(track);
    if (!buffer) return;
    try {
      await deck.load(track, buffer);
    } catch (err) {
      console.error('[decks] load failed', track.title, err);
      return;
    }
    forceUpdate((x) => x + 1);
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

  function handleSmartReorder(): void {
    if (queue.length <= 1) return;
    const anchor = currentTrack;
    const reordered = smartReorderQueue(queueTracks, anchor, session);
    setQueue(reordered.map((t) => t.id));
  }

  async function runEnrichment(pool: AnalyzedTrack[]): Promise<void> {
    if (pool.length === 0 || enrichmentBusy) return;
    setEnrichmentBusy(true);
    setEnrichmentStatus(`Starting enrichment on ${pool.length} track${pool.length > 1 ? 's' : ''}…`);
    try {
      const summary = await enrichWithSpotify(pool, (p) => {
        if (p.phase === 'searching') {
          setEnrichmentStatus(`Searching Spotify: ${p.done}/${p.total} · ${p.currentTitle ?? ''}`);
        } else if (p.phase === 'features') {
          setEnrichmentStatus(`Fetching audio features for ${p.total} tracks…`);
        } else if (p.phase === 'saving') {
          setEnrichmentStatus(`Saving: ${p.done}/${p.total}`);
        } else if (p.phase === 'error') {
          setEnrichmentStatus(`Error: ${p.error ?? 'unknown'}`);
        }
      });
      setEnrichmentStatus(
        `Done — ${summary.matched} matched, ${summary.unmatched} unmatched, ${summary.updated} updated${summary.errors ? `, ${summary.errors} errors` : ''}.`
      );
      const refreshed = await store.listTracks();
      setTracks(refreshed);
    } catch (err) {
      setEnrichmentStatus(`Failed: ${(err as Error).message}`);
    } finally {
      setEnrichmentBusy(false);
    }
  }

  function handleEnrichAll(): void {
    const pool = tracks.filter((t) => !t.analysis?.spotifyTrackId);
    void runEnrichment(pool);
  }

  function handleEnrichSelected(): void {
    // For now: enrich everything without a spotifyTrackId — Workshop
    // selection state is local to WorkshopView. We'll wire it up
    // properly when we move selection into the store.
    handleEnrichAll();
  }

  async function handleEnablePlayback(): Promise<void> {
    try {
      // Show a placeholder bridge state so the UI reflects "connecting…"
      setPlaybackBridge({ ready: false, deviceId: null, state: null, error: null });
      await initPlayer((bridge) => setPlaybackBridge(bridge));
    } catch (err) {
      setPlaybackBridge({
        ready: false,
        deviceId: null,
        state: null,
        error: (err as Error).message,
      });
    }
  }

  async function handlePlayUri(uri: string): Promise<void> {
    try {
      await playSpotifyUris([uri]);
    } catch (err) {
      setPlaybackBridge((prev) =>
        prev ? { ...prev, error: (err as Error).message } : prev
      );
    }
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
            className={`view-tab ${view === 'decks' ? 'view-tab--active' : ''}`}
            onClick={() => setView('decks')}
          >
            Decks
          </button>
          <button
            className={`view-tab ${view === 'workshop' ? 'view-tab--active' : ''}`}
            onClick={() => setView('workshop')}
          >
            Workshop
          </button>
        </div>
        <div className="app-header-actions">
          {orphanTracks.length > 0 && (
            <button
              className="auto-toggle"
              style={{ background: 'rgba(184, 64, 53, 0.9)', color: '#fff' }}
              onClick={() => void handleCleanupOrphans()}
              title="Remove tracks from earlier sessions whose file paths were lost"
            >
              🧹 Clean {orphanTracks.length}
            </button>
          )}
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
            className={`header-btn ${spotifyAuth ? 'header-btn--on' : ''}`}
            onClick={() => openSheet('spotify')}
            title={spotifyAuth ? `Spotify — connected as ${spotifyAuth.user?.displayName ?? 'user'}` : 'Connect Spotify'}
          >
            🎧
          </button>
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
          <HUD
            analyzingCount={analyzingIds.size}
            totalTracks={tracks.length}
            analyzedCount={analyzedCount}
            autoMixOn={autoMix}
            autoMixNextInSec={autoMixNextInSec}
            queueLength={queue.length}
          />

          <NowPlaying
            track={currentTrack}
            playing={playing}
            positionSec={positionSec}
            durationSec={durationSec}
            effectiveBpm={effectiveBpm}
            stretchRatio={stretchRatio}
            onPlayPause={handlePlayPause}
            onSkip={() => void handleSkip()}
            onMixNow={() => void handleMixNow()}
            onNextRecommended={() => void handleNextRecommended()}
            onSeekFraction={handleSeek}
            nextTrack={
              engineRef.current?.getInactive().track
                ? tracksById.get(engineRef.current.getInactive().track!.id) ?? engineRef.current.getInactive().track
                : null
            }
            nextIsPlaying={engineRef.current?.getInactive().isPlaying ?? false}
            nextPositionSec={engineRef.current?.getInactive().positionSec() ?? 0}
            nextDurationSec={engineRef.current?.getInactive().duration ?? 0}
            nextStretchRatio={engineRef.current?.getInactive().getStretchRatio() ?? 1}
            autoMixOn={autoMix}
            autoMixInSec={autoMixNextInSec}
          />

          <main className="main">
            {queue.length > 0 && (
              <div className="queue-toolbar">
                {queue.length > 1 && (
                  <button
                    className="queue-tool-btn"
                    onClick={handleSmartReorder}
                    title="Reorder the queue for best transitions"
                  >
                    🎯 Smart reorder
                  </button>
                )}
                <button
                  className="queue-tool-btn"
                  onClick={() => {
                    if (confirm(`Clear ${queue.length} track${queue.length > 1 ? 's' : ''} from the queue?`)) {
                      clearQueue();
                      resetSession();
                    }
                  }}
                  title="Empty the queue and reset the session history"
                >
                  🗑️ Clear playlist
                </button>
                <span className="queue-tool-count">{queue.length} in queue</span>
              </div>
            )}
            <QueueList
              queueTracks={queueTracks}
              currentTrack={currentTrack}
              session={session}
              onRemove={removeFromQueue}
              onMove={moveInQueue}
              onPlayNow={(id) => void handlePlayNowFromQueue(id)}
              playingId={currentTrack?.id ?? null}
            />

            <Suggestions
              candidates={suggestions}
              onAdd={(id) => addToQueue(id)}
            />
          </main>
        </>
      ) : view === 'decks' ? (
        <main className="main main--decks">
          <DecksView
            engine={engineRef.current}
            tracksById={tracksById}
            tracks={tracks}
            onLoadNext={(side) => void handleDeckLoad(side)}
            onLoadTrack={(side, id) => void handleDeckLoadTrack(side, id)}
            notes={deckNote}
            onSeek={handleDeckSeek}
            onCue={handleDeckCue}
            onPlayPause={handleDeckPlayPause}
          />
        </main>
      ) : (
        <main className="main main--workshop">
          <WorkshopView />
        </main>
      )}

      <button
        className={`fab ${view !== 'party' ? 'fab--hidden' : ''}`}
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
          // Native (Tauri) → dialog.open() gives absolute paths persistable
          // across app restarts. Browser → <input> gives File objects that
          // only live in memory.
          if (isTauri()) {
            void handleImportFilesNative();
          } else {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = 'audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus';
            input.onchange = () => {
              if (input.files) void handleImportFiles(input.files);
            };
            input.click();
          }
        }}
        supportsDirectoryPicker={supportsDirectoryPicker() || isTauri()}
        supportsITunes={isTauri()}
        onImportITunes={() => void handleImportITunes()}
      />

      <SpotifySheet
        open={sheet === 'spotify'}
        onClose={() => openSheet(null)}
        auth={spotifyAuth}
        onDisconnect={() => setSpotifyAuth(null)}
        onEnrichAll={handleEnrichAll}
        onEnrichSelected={handleEnrichSelected}
        enrichmentStatus={enrichmentStatus}
        enrichmentBusy={enrichmentBusy}
        tracksTotal={tracks.length}
        tracksWithoutSpotify={tracks.filter((t) => !t.analysis?.spotifyTrackId).length}
        playbackBridge={playbackBridge}
        onEnablePlayback={() => void handleEnablePlayback()}
        onPlayUri={(uri) => void handlePlayUri(uri)}
      />

      <PlaylistsSheet
        open={sheet === 'playlists'}
        playlists={playlists}
        currentQueueLength={queue.length}
        onClose={() => openSheet(null)}
        onSaveCurrent={(name) => void handleSavePlaylist(name)}
        onLoad={(id) => void handleLoadPlaylist(id)}
        onDelete={(id) => void handleDeletePlaylist(id)}
        onResetSession={handleResetSession}
        onResetLibrary={() => void handleResetLibrary()}
        libraryCount={tracks.length}
        drainQueue={drainQueue}
        onToggleDrainQueue={handleToggleDrainQueue}
      />
    </div>
  );
}
