# pyro-clone

Local-file auto-mix DJ + library workshop — inspired by Serato Pyro, MixedInKey, and Platinum Notes. Import your audio folder, let it analyze (BPM / key / energy / cue points), edit tags in bulk, dedupe, and let the party mode auto-pick + beat-match crossfade the whole night.

**Runs three ways from the same codebase:** native Mac app (Tauri), Windows `.exe`, or plain web app (Chrome/Edge/Safari/Firefox, plus mobile as a PWA).

## Two modes

- **Party** — Serato-Pyro-style stack view: NowPlaying with waveform + skip/play, ordered queue of upcoming tracks (drag-color cards), "MATCHING SONGS" suggestions from the scoring engine, save/load playlists, auto-mix toggle.
- **Workshop** — MixedInKey-style dense table: sort/filter your whole library, inline-edit tags, multi-select + bulk edit, find duplicates (exact by hash, probable by title+artist±2s), write tags back to files.

## Run — native (Mac / Windows)

Recommended for the workshop features (writes tags directly to disk).

```bash
# One-time: install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install JS + Rust deps
npm install

# Dev (opens native window, hot reload)
npm run tauri:dev

# Build native binaries
npm run tauri:build           # your current platform
npm run tauri:build:mac       # Mac ARM64 (needs Xcode CLT)
npm run tauri:build:mac-intel # Mac Intel — first: rustup target add x86_64-apple-darwin
npm run tauri:build:win       # Windows (from Windows or WSL)
```

Output lands in `src-tauri/target/release/bundle/`:
- Mac: `macos/pyro-clone.app` and `dmg/pyro-clone_x.y.z_aarch64.dmg`
- Windows: `msi/pyro-clone_x.y.z_x64.msi`

First launch on Mac: right-click → Open (bypasses unsigned-app Gatekeeper).

## Run — web only

```bash
npm install
npm run dev
# open the printed http://localhost:5173
```

Also runs in GitHub Codespaces (`.devcontainer/` is preconfigured, Node 20, auto npm install, port 5173 auto-forwarded).

## Browser support (web only)

| Browser | Folder picker | File picker | Persisted file handles | Tag write-back |
| --- | --- | --- | --- | --- |
| Chrome / Edge desktop | ✅ | ✅ | ✅ | ✅ in-place |
| Firefox / Safari desktop | ⚠️ `<input webkitdirectory>` | ✅ | ❌ per session | ⚠️ downloads copy |
| iOS Safari (PWA) | ❌ | ✅ | ❌ | ⚠️ downloads copy |
| Android Chrome (PWA) | ❌ | ✅ | ❌ | ⚠️ downloads copy |

Native (Tauri) skips all of these limits — full disk access.

## Stack

| Layer | Choice |
| --- | --- |
| UI | React 18 + TypeScript + Vite |
| Desktop shell | Tauri 2 (Rust, ~5 MB binary) |
| Audio playback | Web Audio API |
| Analysis | Pure-JS DSP in a Web Worker (autocorrelation BPM, Krumhansl key, RMS energy, 512-bin waveform peaks) |
| BPM sync | `playbackRate` on `AudioBufferSourceNode` (± 6 % safe range, downbeat-snapped fade start) |
| Library DB | IndexedDB via `idb` |
| Tag read | `music-metadata-browser` |
| Tag write | `browser-id3-writer` (mp3 for now) |

## Project layout

```
src/
  audio/         Deck + AudioEngine (beatmatched crossfader)
  analyzer/      Worker + pure-JS DSP (BPM, key, energy, cues, peaks)
  selector/      Scoring engine + Camelot compatibility + pickNext
  library/       Importer (FSA API + <input>), tagWriter, dedupe
  db/            IndexedDB store + playlists persistence
  components/    Party view (NowPlaying, Queue, Suggestions, AddSheet,
                 PlaylistsSheet) + Workshop view (LibraryTable, BulkEdit,
                 DuplicatesPanel)
  shared/        Types shared across the codebase
  state/         zustand store
src-tauri/       Rust shell — Cargo.toml, main.rs, tauri.conf.json,
                 capabilities/, icons/
```

## Roadmap

- [x] Phase 1: player + import + manual fade
- [x] Phase 2: offline analysis + IndexedDB
- [x] Phase 3: scoring + auto-queue + auto-crossfade
- [x] Phase 4 lite: BPM-matched crossfade via playbackRate
- [x] Pyro-style UI: NowPlaying + waveform + editable queue + PWA
- [x] Sprint A: Library workshop (bulk tag edit + dedupe + write-back)
- [x] Tauri wrap: Mac ARM / Intel / Windows binaries
- [ ] Sprint B: essentia/aubio BPM detector + 8 auto cue points + LUFS
- [ ] Sprint D: MusicBrainz + Chromaprint enrichment
- [ ] Sprint C: bulk file rename + reorganize + undo
- [ ] Phase 4 full: SoundTouch time-stretch in AudioWorklet

## Known limitations

- **BPM detection** uses pure-JS autocorrelation — ~±5 BPM on non-EDM tracks. Sprint B swaps this out.
- **Tag write-back is mp3-only** currently (flac/m4a need separate libs). Native Tauri build can grow this via a Rust `taglib` binding later.
- **BPM sync pitches the audio** — proper time-stretch is deferred.
