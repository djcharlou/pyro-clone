import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './state/store';
import { AudioEngine } from './audio/AudioEngine';
import { AnalysisQueue } from './analyzer/AnalysisQueue';
import { pickNext } from './selector/Selector';
import type { AnalyzedTrack, SelectionResult } from '@shared/types';
import { Library } from './components/Library';
import { DeckView } from './components/DeckView';
import { Transport } from './components/Transport';
import { QueuePanel } from './components/QueuePanel';
import { StatusBar } from './components/StatusBar';

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
  const lastPick = useStore((s) => s.lastPick);
  const autoMix = useStore((s) => s.autoMix);
  const setAutoMix = useStore((s) => s.setAutoMix);
  const markAnalyzing = useStore((s) => s.markAnalyzing);
  const setImportState = useStore((s) => s.setImportState);

  const engineRef = useRef<AudioEngine | null>(null);
  const queueRef = useRef<AnalysisQueue | null>(null);

  // Initialize engine + queue once
  useEffect(() => {
    const engine = new AudioEngine({
      onDeckUpdate: () => forceUpdate((x) => x + 1),
      onTransitionEnd: () => {
        const newActive = engine.getActiveId();
        setActiveDeck(newActive);
        const active = engine.getActive();
        if (active.track) pushHistory(active.track.id);
      },
    });
    engineRef.current = engine;

    const aq = new AnalysisQueue();
    aq.onProgress = (state) => {
      if (state.phase === 'analyzing' || state.phase === 'decoding') {
        markAnalyzing(state.trackId, true);
      } else {
        markAnalyzing(state.trackId, false);
      }
    };
    queueRef.current = aq;

    // Load library
    void window.pyro.listTracks().then(setTracks);

    return () => {
      aq.destroy();
    };
  }, []);

  // Tick deck positions
  useEffect(() => {
    const interval = setInterval(() => {
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
    return () => clearInterval(interval);
  }, []);

  // Auto-mix scheduling
  useEffect(() => {
    if (!autoMix) return;
    const engine = engineRef.current;
    if (!engine) return;
    const interval = setInterval(() => {
      void maybeStartAutoTransition();
    }, 500);
    return () => clearInterval(interval);
  }, [autoMix, tracks, session]);

  const analyzedTrackById = useMemo(() => {
    const m = new Map<string, AnalyzedTrack>();
    for (const t of tracks) m.set(t.id, t);
    return m;
  }, [tracks]);

  async function maybeStartAutoTransition(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const active = engine.getActive();
    if (!active.track || !active.isPlaying) return;
    const pos = active.positionSec();
    const dur = active.duration;
    const mixOut = active.track.analysis?.cues.mixOutPoint ?? Math.max(0, dur - 16);
    const fadeDur = 12;
    const timeToFadeStart = mixOut - fadeDur - pos;
    if (timeToFadeStart > 0.7) return;

    const inactive = engine.getInactive();
    if (!inactive.track) {
      // Pick + load next track
      await loadNextIntoInactive();
      return;
    }
    // Begin fade if not already in progress
    if (inactive.isPlaying) return;
    const offset = inactive.track.analysis?.cues.mixInPoint ?? 0;
    engine.crossfade(fadeDur, offset);
  }

  async function loadNextIntoInactive(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const active = engine.getActive();
    if (!active.track) return;
    const analyzedPool = tracks.filter((t) => t.analysis);
    if (analyzedPool.length < 2) return;
    const report = pickNext({
      pool: analyzedPool,
      current: active.track,
      session,
    });
    setLastPick(report.picked);
    await loadTrackIntoInactive(report.picked.track);
  }

  async function loadTrackIntoInactive(track: AnalyzedTrack): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const buffer = await window.pyro.readAudioFile(track.filePath);
    await engine.loadIntoInactive(track, buffer);
    forceUpdate((x) => x + 1);
  }

  async function loadTrackIntoActive(track: AnalyzedTrack): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const buffer = await window.pyro.readAudioFile(track.filePath);
    await engine.loadIntoActive(track, buffer);
    if (engine.getActive().track && !engine.getActive().isPlaying) {
      pushHistory(track.id);
    }
    forceUpdate((x) => x + 1);
  }

  async function handleImport(): Promise<void> {
    setImportState({ running: true, added: 0, failed: 0, lastTrackTitle: '' });
    const cleanup = window.pyro.onImportProgress((ev: unknown) => {
      const e = ev as { kind: string; track?: { title: string } };
      if (e.kind === 'track-added' && e.track) {
        setImportState({ lastTrackTitle: e.track.title });
      }
    });
    try {
      const result = await window.pyro.importDirectory();
      setImportState({
        running: false,
        added: result.added,
        failed: result.failed,
        lastTrackTitle: '',
      });
      const refreshed = await window.pyro.listTracks();
      setTracks(refreshed);
      // Auto-analyze any newly added tracks
      void analyzeUnanalyzed(refreshed);
    } finally {
      cleanup();
    }
  }

  async function analyzeUnanalyzed(all: AnalyzedTrack[]): Promise<void> {
    const aq = queueRef.current;
    if (!aq) return;
    const todo = all.filter((t) => !t.analysis);
    for (const t of todo) {
      try {
        const analysis = await aq.enqueue(t);
        await window.pyro.saveAnalysis(analysis);
        upsertAnalysis(t.id, { analysis });
      } catch (err) {
        console.error('[analyze] failed', t.title, err);
      }
    }
  }

  async function handleReanalyze(track: AnalyzedTrack): Promise<void> {
    const aq = queueRef.current;
    if (!aq) return;
    try {
      const analysis = await aq.enqueue(track);
      await window.pyro.saveAnalysis(analysis);
      upsertAnalysis(track.id, { analysis });
    } catch (err) {
      console.error('[reanalyze] failed', track.title, err);
    }
  }

  function handlePlayPause(): void {
    const engine = engineRef.current;
    if (!engine) return;
    const active = engine.getActive();
    if (!active.track) return;
    if (active.isPlaying) active.stop();
    else {
      engine.playActive(0);
      pushHistory(active.track.id);
    }
    forceUpdate((x) => x + 1);
  }

  async function handlePickNow(): Promise<void> {
    await loadNextIntoInactive();
  }

  function handleCrossfadeNow(): void {
    const engine = engineRef.current;
    if (!engine) return;
    const inactive = engine.getInactive();
    if (!inactive.track) return;
    const offset = inactive.track.analysis?.cues.mixInPoint ?? 0;
    engine.crossfade(8, offset);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>pyro-clone</h1>
        <div className="header-actions">
          <button onClick={handleImport}>+ Import folder</button>
          <label className="auto-mix-toggle">
            <input
              type="checkbox"
              checked={autoMix}
              onChange={(e) => setAutoMix(e.target.checked)}
            />
            Auto-mix
          </label>
        </div>
      </header>

      <div className="decks">
        <DeckView
          side="A"
          isActive={activeDeck === 'A'}
          deckRef={engineRef.current?.deckA ?? null}
          track={
            engineRef.current?.deckA.track
              ? analyzedTrackById.get(engineRef.current.deckA.track.id) ?? engineRef.current.deckA.track
              : null
          }
        />
        <DeckView
          side="B"
          isActive={activeDeck === 'B'}
          deckRef={engineRef.current?.deckB ?? null}
          track={
            engineRef.current?.deckB.track
              ? analyzedTrackById.get(engineRef.current.deckB.track.id) ?? engineRef.current.deckB.track
              : null
          }
        />
      </div>

      <Transport
        onPlayPause={handlePlayPause}
        onPickNext={handlePickNow}
        onCrossfade={handleCrossfadeNow}
      />

      <div className="main-content">
        <Library
          tracks={tracks}
          onLoadActive={loadTrackIntoActive}
          onLoadInactive={loadTrackIntoInactive}
          onReanalyze={handleReanalyze}
        />
        <QueuePanel lastPick={lastPick} session={session} tracks={tracks} />
      </div>

      <StatusBar />
    </div>
  );
}

export type { SelectionResult };
