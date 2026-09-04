/**
 * Moving the playhead on a running deck — beat-phase alignment, or dragging
 * the waveform — replaces the buffer source mid-waveform. That is a step
 * discontinuity, and a step is a click. It has to be faded.
 *
 * A cold start must NOT be faded or delayed: the auto-mix schedules against
 * those instants, so shifting them would smear every transition.
 */
import { Deck } from '../src/audio/Deck';
import type { AnalyzedTrack } from '../src/shared/types';

let now = 0;

interface Event { kind: string; value?: number; time: number }
const events: Event[] = [];

function param(v = 0, name = ''): Record<string, unknown> {
  return {
    value: v,
    setValueAtTime(x: number, t: number) { if (name) events.push({ kind: `${name}.set`, value: x, time: t }); (this as { value: number }).value = x; },
    linearRampToValueAtTime(x: number, t: number) { if (name) events.push({ kind: `${name}.ramp`, value: x, time: t }); (this as { value: number }).value = x; },
    exponentialRampToValueAtTime() {},
    cancelScheduledValues() {},
    setValueCurveAtTime() {},
    setTargetAtTime(x: number) { (this as { value: number }).value = x; },
  };
}
const node = (): Record<string, unknown> => ({
  connect(n: unknown) { return n; }, disconnect() {},
  frequency: param(20), Q: param(1), gain: param(1),
  threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0),
});

let sourcesMade = 0;
(globalThis as any).AudioContext = class {
  get currentTime() { return now; }
  state = 'running';
  destination = node();
  createBiquadFilter() { return { ...node(), type: '' }; }
  createGain() {
    // Only the deck's first gain node is the declick (constructed first).
    const isDeclick = sourcesMade === 0 && !declickTaken;
    if (isDeclick) { declickTaken = true; return { ...node(), gain: param(1, 'declick') }; }
    return node();
  }
  createDynamicsCompressor() { return node(); }
  createBufferSource() {
    sourcesMade++;
    const id = sourcesMade;
    return {
      ...node(), buffer: null, playbackRate: param(1), onended: null,
      start(when: number, offset: number) { events.push({ kind: `src${id}.start`, value: offset, time: when }); },
      stop(when?: number) { events.push({ kind: `src${id}.stop`, time: when ?? now }); },
    };
  }
  async decodeAudioData() { return { duration: 240, numberOfChannels: 2, sampleRate: 44100 }; }
  async resume() {}
};
let declickTaken = false;

function track(bpm = 128): AnalyzedTrack {
  return {
    id: 't', filePath: '/t.mp3', fileHash: 't', title: 't', artist: 'x',
    durationSec: 240, sampleRate: 44100, channels: 2, addedAt: 0,
    analysis: {
      trackId: 't', analyzerVersion: 't', analyzedAt: 0, quality: 'good',
      beatGrid: { firstBeatTime: 0, bpm, bpmConfidence: 1, beats: [], downbeats: [], isStable: true },
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

const ctx = new (globalThis as any).AudioContext();
const deck = new Deck(ctx, 'A');
await deck.load(track(), new ArrayBuffer(8));

// --- Cold start ------------------------------------------------------------
events.length = 0;
now = 0;
deck.play(0);
{
  const starts = events.filter((e) => e.kind.endsWith('.start'));
  check('a cold start starts one source', starts.length === 1, JSON.stringify(starts));
  check('at the current instant, not later', near(starts[0].time, 0, 1e-9), String(starts[0].time));
  const ramps = events.filter((e) => e.kind.startsWith('declick.ramp'));
  check('with no fade scheduled', ramps.length === 0, JSON.stringify(ramps));
  check('the deck is playing', deck.isPlaying);
}

// --- Mid-playback splice ---------------------------------------------------
now = 30;
const posBefore = deck.positionSec();
events.length = 0;
deck.play(45);                       // a scrub, or a phase alignment
{
  check('position was tracked up to the splice', near(posBefore, 30, 1e-9), posBefore.toFixed(4));

  const down = events.find((e) => e.kind === 'declick.ramp' && e.value === 0);
  check('fades the outgoing source out', !!down, JSON.stringify(events.filter(e => e.kind.startsWith('declick'))));

  const stop = events.find((e) => e.kind.endsWith('.stop'));
  check('stops the old source at the fade bottom, not instantly',
        !!stop && !!down && near(stop.time, down!.time, 1e-9),
        `stop ${stop?.time} vs fade bottom ${down?.time}`);

  const start = events.filter((e) => e.kind.endsWith('.start')).pop();
  check('starts the new source at that same instant',
        !!start && !!down && near(start!.time, down!.time, 1e-9),
        `start ${start?.time}`);
  check('from the requested offset', near(start!.value ?? -1, 45, 1e-9), String(start?.value));

  const up = events.filter((e) => e.kind === 'declick.ramp' && e.value === 1).pop();
  check('then fades back in', !!up && up!.time > down!.time, `up at ${up?.time}`);
  check('and the whole splice is under 10ms',
        !!up && up!.time - 30 < 0.01, `${((up?.time ?? 0) - 30).toFixed(4)}s`);

  check('the deck never stops playing', deck.isPlaying);
}

// --- Position after the splice --------------------------------------------
{
  // The new source starts a hair in the future, so until then the deck still
  // reports where it was told to go rather than running backwards.
  check('reports the new position immediately', near(deck.positionSec(), 45, 1e-9),
        deck.positionSec().toFixed(4));
  now = 40;
  check('and advances from there', near(deck.positionSec(), 45 + (40 - 30.004), 1e-6),
        deck.positionSec().toFixed(4));
}

console.log(fail ? `\n${fail} failing` : '\nall green');
process.exit(fail ? 1 : 0);
