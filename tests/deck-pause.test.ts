/**
 * Pause must hold the playhead, and resume must continue from there —
 * not restart the track. Exercised against a minimal fake AudioContext so
 * the position arithmetic is verified without a browser.
 */
import { Deck } from '../src/audio/Deck';
import type { AnalyzedTrack } from '../src/shared/types';

let now = 0;
const param = (v = 0) => ({
  value: v,
  setValueAtTime() {}, linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {}, cancelScheduledValues() {},
  setValueCurveAtTime() {},
});
const node = () => ({
  connect(n: unknown) { return n; }, disconnect() {},
  frequency: param(20), Q: param(1), gain: param(0),
});
const fakeCtx = {
  get currentTime() { return now; },
  state: 'running',
  createBiquadFilter: () => ({ ...node(), type: '' }),
  createGain: () => node(),
  createBufferSource: () => ({
    ...node(), buffer: null as unknown, playbackRate: param(1),
    onended: null as unknown, start() {}, stop() {},
  }),
  decodeAudioData: async () => ({ duration: 200, numberOfChannels: 2, sampleRate: 44100 }),
  resume: async () => {},
} as unknown as AudioContext;

const track = { id: 't', title: 'T', durationSec: 200 } as AnalyzedTrack;

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fail++;
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;

const d = new Deck(fakeCtx, 'A');
await d.load(track, new ArrayBuffer(8));

now = 0;
d.play(10);                     // start 10s into the track
now = 25;                       // 25s of wall clock elapsed
// 10s offset + 25s elapsed at rate 1 = 35s into the track
check('position tracks while playing', near(d.positionSec(), 35), String(d.positionSec()));

d.pause();
check('pause stops playback', !d.isPlaying);
check('pause sets the paused flag', d.isPaused);
const held = d.positionSec();
check('pause holds position', near(held, 35), String(held));

now = 90;                       // a long time passes while paused
check('position frozen while paused', near(d.positionSec(), 35), String(d.positionSec()));

d.resume();
check('resume restarts playback', d.isPlaying);
check('resume clears the paused flag', !d.isPaused);
check('resume continues, does not restart', near(d.positionSec(), 35), String(d.positionSec()));

now = 95;                       // 5s after resuming at 90
check('position advances after resume', near(d.positionSec(), 40), String(d.positionSec()));

// pause on a stopped deck must be a no-op, not a crash
d.stop();
d.pause();
check('pause on stopped deck is inert', !d.isPaused);

console.log(fail ? `\n${fail} failing` : '\nall green');
process.exit(fail ? 1 : 0);
