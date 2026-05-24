# pyro-clone

Local-file automix DJ engine. A Serato Pyro-like party-mode auto-DJ that imports your local audio library, analyzes each track (BPM, key, energy, beatgrid), picks the next song with a configurable scoring engine, and crossfades automatically.

This repository contains **MVP phases 1-3**:

- Phase 1 — Two-deck player, local file import, manual play
- Phase 2 — Offline analysis (BPM / key / energy via essentia.js), SQLite persistence
- Phase 3 — Auto-pick next track via scoring, equal-power auto-crossfade

Beatmatching, time-stretch, phrase alignment and timeline editing are deferred to phases 4-5.

## Stack

| Layer | Choice |
| --- | --- |
| UI | React 18 + TypeScript |
| Container | Electron (electron-vite build) |
| Audio | Web Audio API in the renderer |
| Analysis | `essentia.js` (WASM port of Essentia) in a Web Worker |
| Library DB | `better-sqlite3` in the main process |
| Tags | `music-metadata` (ID3 / Vorbis / MP4) |

## Run

```bash
npm install
npm run dev
```

A native rebuild step runs after install for `better-sqlite3` (handled by `electron-builder install-app-deps`).

## Project layout

```
src/
  main/         Electron main process: IPC, fs scan, SQLite
  preload/      contextBridge (typed renderer API)
  renderer/     React app: audio engine, selector, UI
  shared/       Types shared between main and renderer
```

## Roadmap

- [x] Phase 1: player + import + manual fade
- [x] Phase 2: offline analysis + SQLite
- [x] Phase 3: scoring + auto-queue + auto-crossfade
- [ ] Phase 4: time-stretch + phase alignment + bass-swap/filter-fade
- [ ] Phase 5: timeline editor + beatgrid editor
