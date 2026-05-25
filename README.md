# pyro-clone

Local-file automix DJ — a Serato Pyro-like party-mode auto-DJ that runs **entirely in your browser**. Pick a folder of audio files, the app analyzes each track (BPM, key, energy, cue points), picks the next song with a configurable scoring engine, and crossfades automatically.

**Pure web app — no install, no native code.** Works in Chrome/Edge/Safari/Firefox on desktop. Also runs in mobile browsers (with caveats — see below).

## What's in this MVP (Phases 1-3)

- **Phase 1** — Dual-deck Web Audio player, folder import, manual crossfade
- **Phase 2** — Offline analysis (BPM via autocorrelation, key via Krumhansl, energy via RMS, cue points from energy curve), persisted in IndexedDB
- **Phase 3** — Auto-pick next track via scoring engine (BPM proximity / key compatibility / energy / variety / quality / recency), equal-power auto-crossfade triggered before mix-out cue

Phases 4-5 (beatmatching, time-stretch, phrase alignment, timeline editor) are not implemented yet.

## Stack

| Layer | Choice |
| --- | --- |
| UI | React 18 + TypeScript + Vite |
| Audio | Web Audio API |
| Analysis | Pure-JS DSP in a Web Worker (autocorrelation BPM, Krumhansl-Schmuckler key estimation) |
| Library DB | IndexedDB (via `idb`) |
| Tags | `music-metadata-browser` |
| File access | File System Access API (Chrome/Edge desktop) + `<input webkitdirectory>` fallback |

## Run locally

```bash
npm install
npm run dev
# open http://localhost:5173
```

## Run in GitHub Codespaces

1. Open this repo in a Codespace
2. In the terminal: `npm install && npm run dev`
3. Codespaces auto-forwards port 5173 — click the URL it shows you ("Open in Browser")

The dev server is configured with `host: true` so the forwarded port works out of the box.

## Browser support

| Browser | Folder picker | Files picker | Persisted file handles |
| --- | --- | --- | --- |
| Chrome / Edge desktop | ✅ (File System Access API) | ✅ | ✅ across reloads |
| Firefox / Safari desktop | ⚠️ via `<input webkitdirectory>` | ✅ | ❌ re-pick each session |
| iOS Safari | ❌ no folder pick | ✅ Files picker only | ❌ |
| Android Chrome | ❌ no folder pick | ✅ Files picker | ❌ |

## Project layout

```
src/
  audio/         Deck + AudioEngine (Web Audio crossfader)
  analyzer/      AnalysisQueue + Worker + pure-JS DSP (BPM, key, energy, cues)
  selector/      Scoring engine + Camelot helpers + pickNext
  library/       File System Access API importer + file picker fallback
  db/            IndexedDB store (idb wrapper)
  components/    React UI (Library, DeckView, Transport, QueuePanel, Status)
  shared/        Types shared across modules
  state/         zustand store
```

## Known limitations

- **BPM detection** uses pure-JS autocorrelation — ~±5 BPM on non-EDM tracks. Phase 4 will swap in `essentia.js` or `aubio-wasm` for accuracy.
- **No time-stretch** — crossfade mixes without aligning beats. Phase 4 adds `soundtouch-js` in an AudioWorklet.
- **Audio data is not persisted** — file handles are (on Chrome/Edge). On other browsers you re-pick the files each session.
- **Mobile** works for one-off file picks but lacks library persistence + auto-play restrictions (first interaction required to start audio).

## Roadmap

- [x] Phase 1: player + import + manual fade
- [x] Phase 2: offline analysis + IndexedDB
- [x] Phase 3: scoring + auto-queue + auto-crossfade
- [ ] Phase 4: time-stretch + phase alignment + bass-swap / filter-fade / echo-out
- [ ] Phase 5: timeline editor + beatgrid editor + waveform viz
