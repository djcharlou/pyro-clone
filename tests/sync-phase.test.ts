/**
 * SYNC, the half that actually makes a mix lock: beat phase.
 *
 * tests/sync.test.ts covers tempo only, and every case there passes
 * `matchPhase: false` — so nothing exercised the alignment that decides
 * whether two decks sound together or merely at the same speed.
 */
import { AudioEngine } from '../src/audio/AudioEngine';
import type { AnalyzedTrack } from '../src/shared/types';

let now = 0;
const param = (v = 0) => ({
  value: v, setValueAtTime() {}, linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {}, cancelScheduledValues() {},
  setValueCurveAtTime() {}, setTargetAtTime(t: number) { (this as any).value = t; },
});
const node = () => ({ connect(n: unknown) { return n; }, disconnect() {},
  frequency: param(20), Q: param(1), gain: param(1), threshold: param(0),
  knee: param(0), ratio: param(1), attack: param(0), release: param(0) });
(globalThis as any).AudioContext = class {
  get currentTime() { return now; }
  state = 'running';
  destination = node();
  createBiquadFilter() { return { ...node(), type: '' }; }
  createGain() { return node(); }
  createDynamicsCompressor() { return node(); }
  createBufferSource() {
    return { ...node(), buffer: null, playbackRate: param(1), onended: null,
             start() {}, stop() {} };
  }
  async decodeAudioData() { return { duration: 240, numberOfChannels: 2, sampleRate: 44100 }; }
  async resume() {}
};
(globalThis as any).window = { setTimeout: setTimeout, clearTimeout: clearTimeout };

function track(id: string, bpm: number, firstBeat = 0): AnalyzedTrack {
  return {
    id, filePath: `/${id}.mp3`, fileHash: id, title: id, artist: 'x',
    durationSec: 240, sampleRate: 44100, channels: 2, addedAt: 0,
    analysis: {
      trackId: id, analyzerVersion: 't', analyzedAt: 0, quality: 'good',
      beatGrid: { firstBeatTime: firstBeat, bpm, bpmConfidence: 1, beats: [], downbeats: [], isStable: true },
      key: { root: 'C', scale: 'major', camelot: '8B', confidence: 1 },
      energy: { mean: 0.5, peak: 0.8, perBar: [], rmsDb: -12 },
      cues: { introStart: 0, introEnd: 8, outroStart: 220, outroEnd: 240, mixInPoint: 8, mixOutPoint: 220 },
    },
  } as AnalyzedTrack;
}

let fail = 0;
const check = (n: string, ok: boolean, d = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${d ? '  — ' + d : ''}`); if (!ok) fail++;
};
const near = (a: number, b: number, t: number): boolean => Math.abs(a - b) < t;

async function load(engine: AudioEngine, side: 'A' | 'B', t: AnalyzedTrack): Promise<void> {
  await (side === 'A' ? engine.deckA : engine.deckB).load(t, new ArrayBuffer(8));
}

/** Fraction of its own beat that a deck has elapsed, 0..1. */
function phaseOf(deck: { positionSec(): number; track: AnalyzedTrack | null }): number {
  const g = deck.track!.analysis!.beatGrid;
  const beat = 60 / g.bpm;
  const m = ((deck.positionSec() - g.firstBeatTime) % beat) / beat;
  return m < 0 ? m + 1 : m;
}

// --- Changing the rate must not move the playhead -------------------------
// positionSec() is offset + elapsed x rate, so setting a new rate without
// re-anchoring rewrites where the deck has already been. SYNC sets the rate
// and then reads the position to align phase, so a jump here poisons that.
{
  now = 0;
  const e = new AudioEngine();
  await load(e, 'A', track('a', 128));
  e.deckA.play(0);
  now = 60;
  const before = e.deckA.positionSec();
  check('plays at real time before any stretch', near(before, 60, 1e-9), before.toFixed(4));
  e.deckA.setStretchRatio(1.05);
  const after = e.deckA.positionSec();
  check('the playhead does not jump when the rate changes',
        near(after, before, 1e-6), `${before.toFixed(3)} → ${after.toFixed(3)}`);
  now = 70;
  check('and it advances at the new rate afterwards',
        near(e.deckA.positionSec(), before + 10 * 1.05, 1e-6),
        e.deckA.positionSec().toFixed(4));
}

// --- Phase alignment -------------------------------------------------------
{
  now = 0;
  const e = new AudioEngine();
  await load(e, 'A', track('a', 128));
  await load(e, 'B', track('b', 128));
  const beat = 60 / 128;
  e.deckA.play(0);
  e.deckB.play(beat * 0.37);        // deliberately off by 0.37 of a beat
  now = 20;

  const gap = Math.abs(phaseOf(e.deckA) - phaseOf(e.deckB));
  check('starts out of phase', gap > 0.2, gap.toFixed(3));

  e.syncDeck('B');
  const lead = phaseOf(e.deckA);
  const foll = phaseOf(e.deckB);
  let d = Math.abs(lead - foll);
  if (d > 0.5) d = 1 - d;           // wrap: 0.99 and 0.01 are 0.02 apart
  check('sync puts the decks in phase', d < 0.01,
        `leader ${lead.toFixed(3)} vs follower ${foll.toFixed(3)}`);
}

// --- It must not jump the track around to get there -----------------------
// Half a beat is the furthest an aligned deck should ever move; anything
// more means it skipped or repeated audible material.
{
  now = 0;
  const e = new AudioEngine();
  await load(e, 'A', track('a', 128));
  await load(e, 'B', track('b', 128));
  const beat = 60 / 128;
  e.deckA.play(0);
  e.deckB.play(beat * 0.4);
  now = 30;
  const posBefore = e.deckB.positionSec();
  e.syncDeck('B');
  const moved = Math.abs(e.deckB.positionSec() - posBefore);
  check('moves the follower by at most half a beat', moved <= beat / 2 + 1e-6,
        `${moved.toFixed(4)}s (beat ${beat.toFixed(4)}s)`);
}

// --- Phase alignment across a tempo change --------------------------------
// The follower is stretched to the leader's tempo first; the alignment has to
// be computed in the follower's own track seconds, not real ones.
{
  now = 0;
  const e = new AudioEngine();
  await load(e, 'A', track('a', 128));
  await load(e, 'B', track('b', 124));
  e.deckA.play(0);
  e.deckB.play(0.3);
  now = 25;
  const r = e.syncDeck('B');
  check('tempo sync still succeeds', r.ok, r.reason ?? '');
  const lead = phaseOf(e.deckA);
  const foll = phaseOf(e.deckB);
  let d = Math.abs(lead - foll);
  if (d > 0.5) d = 1 - d;
  check('in phase after a stretch too', d < 0.01,
        `leader ${lead.toFixed(3)} vs follower ${foll.toFixed(3)}`);
}

// --- A deck with an offset grid -------------------------------------------
// firstBeatTime is a position inside the track, so it must not be scaled by
// the playback rate.
{
  now = 0;
  const e = new AudioEngine();
  await load(e, 'A', track('a', 126, 0.31));
  await load(e, 'B', track('b', 126, 1.07));
  e.deckA.play(0);
  e.deckB.play(0);
  now = 40;
  e.syncDeck('B');
  const lead = phaseOf(e.deckA);
  const foll = phaseOf(e.deckB);
  let d = Math.abs(lead - foll);
  if (d > 0.5) d = 1 - d;
  check('respects each deck\'s own first-beat offset', d < 0.01,
        `leader ${lead.toFixed(3)} vs follower ${foll.toFixed(3)}`);
}

// --- Does it hold? ---------------------------------------------------------
// Aligning once is easy; a sync that drifts apart over a few minutes is worse
// than none, because you stop watching it.
{
  now = 0;
  const e = new AudioEngine();
  await load(e, 'A', track('a', 128));
  await load(e, 'B', track('b', 124));
  e.deckA.play(0);
  e.deckB.play(0.9);
  now = 10;
  e.syncDeck('B');
  const phaseGap = (): number => {
    let d = Math.abs(phaseOf(e.deckA) - phaseOf(e.deckB));
    return d > 0.5 ? 1 - d : d;
  };
  const atSync = phaseGap();
  now = 10 + 300;                    // five minutes later
  const after = phaseGap();
  check('still in phase five minutes on', after < 0.02,
        `${atSync.toFixed(4)} → ${after.toFixed(4)} of a beat`);
}

// --- Syncing twice must not make it worse ---------------------------------
{
  now = 0;
  const e = new AudioEngine();
  await load(e, 'A', track('a', 128));
  await load(e, 'B', track('b', 126));
  e.deckA.play(0);
  e.deckB.play(0.21);
  now = 15;
  e.syncDeck('B');
  now = 45;
  e.syncDeck('B');                   // pressed again mid-set
  let d = Math.abs(phaseOf(e.deckA) - phaseOf(e.deckB));
  if (d > 0.5) d = 1 - d;
  check('a second press keeps it locked', d < 0.01, d.toFixed(4));
  check('and does not re-pitch the deck',
        near(e.deckB.getStretchRatio(), 128 / 126, 1e-9), String(e.deckB.getStretchRatio()));
}

// --- An unanalysed deck must refuse, not invent a tempo -------------------
{
  now = 0;
  const e = new AudioEngine();
  const raw = track('b', 124);
  delete (raw as { analysis?: unknown }).analysis;
  await load(e, 'A', track('a', 128));
  await load(e, 'B', raw);
  const r = e.syncDeck('B');
  check('refuses to sync an unanalysed track', !r.ok, r.reason ?? 'accepted it');
  check('and leaves its rate alone', near(e.deckB.getStretchRatio(), 1, 1e-9));
}

// --- A stopped deck --------------------------------------------------------
// The real workflow: park a track on B, press SYNC, then press PLAY. Tempo
// alone is not enough — two tracks at the same speed and the wrong phase is
// exactly what "sync doesn't work" sounds like.
{
  now = 0;
  const e = new AudioEngine();
  await load(e, 'A', track('a', 128));
  await load(e, 'B', track('b', 124));
  e.deckA.play(0);
  now = 12;
  const r = e.syncDeck('B');           // deck B never started
  check('tempo still syncs onto a stopped deck', r.ok, r.reason ?? '');
  check('stopped deck takes the leader tempo',
        near(e.deckB.getStretchRatio(), 128 / 124, 1e-9), String(e.deckB.getStretchRatio()));
  check('and is remembered as synced', e.isSynced('B'));

  now = 18;
  e.deckB.play(11.7);                  // user presses PLAY at an arbitrary moment
  let d0 = Math.abs(phaseOf(e.deckA) - phaseOf(e.deckB));
  if (d0 > 0.5) d0 = 1 - d0;
  check('starting it lands out of phase on its own', d0 > 0.02, d0.toFixed(4));

  e.alignPhaseIfSynced('B');
  let d1 = Math.abs(phaseOf(e.deckA) - phaseOf(e.deckB));
  if (d1 > 0.5) d1 = 1 - d1;
  check('aligning on start locks it', d1 < 0.01, `${d0.toFixed(4)} → ${d1.toFixed(4)}`);
}

// --- Sync must not survive a track change ---------------------------------
{
  now = 0;
  const e = new AudioEngine();
  await load(e, 'A', track('a', 128));
  await load(e, 'B', track('b', 124));
  e.deckA.play(0);
  e.deckB.play(0);
  now = 5;
  e.syncDeck('B');
  check('synced', e.isSynced('B'));
  e.clearSync('B');
  check('a new track hands the tempo back', !e.isSynced('B'));
  check('and aligning is then a no-op', !e.alignPhaseIfSynced('B'));
}

console.log(fail ? `\n${fail} failing` : '\nall green');
process.exit(fail ? 1 : 0);
