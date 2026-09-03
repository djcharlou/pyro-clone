/**
 * SYNC: match the follower deck's tempo to the leader, fold octaves, and
 * refuse gaps too wide for playbackRate to bridge without obvious pitching.
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
const check = (n: string, ok: boolean, d = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${d ? '  — ' + d : ''}`); if (!ok) fail++;
};
const near = (a: number, b: number, t = 1e-6) => Math.abs(a - b) < t;

async function load(engine: AudioEngine, side: 'A' | 'B', t: AnalyzedTrack) {
  await (side === 'A' ? engine.deckA : engine.deckB).load(t, new ArrayBuffer(8));
}

// --- close tempos: sync should engage -------------------------------------
{
  const e = new AudioEngine();
  await load(e, 'A', track('a', 128));
  await load(e, 'B', track('b', 124));
  const r = e.syncDeck('B', { matchPhase: false });
  check('syncs a 124 track to a 128 leader', r.ok, r.reason ?? '');
  check('ratio is leader/follower', near(r.ratio ?? 0, 128 / 124, 1e-9), String(r.ratio));
  check('follower now runs at the leader tempo', near(r.followerBpm ?? 0, 128, 1e-6), String(r.followerBpm));
  check('deck stretch actually applied', near(e.deckB.getStretchRatio(), 128 / 124, 1e-9));
}

// --- octave folding: 70 should follow 140 ---------------------------------
{
  const e = new AudioEngine();
  await load(e, 'A', track('a', 140));
  await load(e, 'B', track('b', 70));
  const r = e.syncDeck('B', { matchPhase: false });
  check('folds an octave rather than refusing', r.ok, r.reason ?? '');
  check('ratio folded to ~1', near(r.ratio ?? 0, 1, 1e-9), String(r.ratio));
}

// --- too wide: must refuse rather than pitch absurdly ----------------------
{
  const e = new AudioEngine();
  await load(e, 'A', track('a', 128));
  await load(e, 'B', track('b', 105));
  const r = e.syncDeck('B', { matchPhase: false });
  check('refuses a gap playbackRate cannot hide', !r.ok, r.reason ?? '');
  check('leaves the deck untouched when refusing', near(e.deckB.getStretchRatio(), 1));
}

// --- missing material ------------------------------------------------------
{
  const e = new AudioEngine();
  await load(e, 'A', track('a', 128));
  const r = e.syncDeck('B', { matchPhase: false });
  check('refuses with an empty follower', !r.ok && /No track/.test(r.reason ?? ''), r.reason ?? '');
}

// --- syncing to an already-stretched leader --------------------------------
{
  const e = new AudioEngine();
  await load(e, 'A', track('a', 120));
  await load(e, 'B', track('b', 124));
  e.deckA.setPitchPercent(5);            // leader now effectively 126
  const r = e.syncDeck('B', { matchPhase: false });
  check('follows the leader\'s *current* tempo, not its tag', r.ok && near(r.leaderBpm ?? 0, 126, 1e-6),
        `leaderBpm ${r.leaderBpm?.toFixed(3)}`);
  check('follower matches that', near(r.followerBpm ?? 0, 126, 1e-6), String(r.followerBpm));
}

console.log(fail ? `\n${fail} failing` : '\nall green');
process.exit(fail ? 1 : 0);
