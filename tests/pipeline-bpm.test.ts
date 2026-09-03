/**
 * End-to-end check on analyzeTrack: does the wired pipeline actually deliver
 * the accuracy the component benchmarks promised, and does each source of
 * truth win in the right order?
 */
import { analyzeTrack } from '../src/analyzer/pipeline';

const RATE = 22050;
function mk(bpm: number, sec: number, jit = 0.01): Float32Array {
  const n = RATE * sec; const b = new Float32Array(n); let t = 0;
  for (let i = 0; t * RATE < n; i++) {
    const per = 60 / bpm;
    let at = t * RATE + (Math.random() - 0.5) * jit * per * RATE;
    const i0 = Math.round(at); const a = i % 4 === 0 ? 1 : 0.55;
    for (let k = 0; k < 1800 && i0 + k < n && i0 + k >= 0; k++)
      b[i0 + k] += a * Math.sin(2 * Math.PI * 60 * k / RATE) * Math.exp(-k / 500);
    t += per;
  }
  for (let i = 0; i < n; i++) b[i] += (Math.random() - 0.5) * 0.02;
  return b;
}
const run = (pcm: Float32Array, sec: number, extra = {}) =>
  analyzeTrack({ trackId: 't', channels: [pcm], sampleRate: RATE, durationSec: sec, ...extra });

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fail++;
};

// 1. Audio-only accuracy across the tempo range.
console.log('--- audio only');
let errs: number[] = [];
for (const t of [92, 100, 124, 128, 140, 175]) {
  const a = run(mk(t, 60), 60);
  const e = Math.abs(a.beatGrid.bpm - t);
  errs.push(e);
  check(`${t} BPM`, e < 1.0, `got ${a.beatGrid.bpm.toFixed(2)} (err ${e.toFixed(2)})`);
}
const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
check('mean audio error under 0.5 BPM', mean < 0.5, mean.toFixed(3));

// 2. Filename BPM must override the audio estimate.
console.log('\n--- source precedence');
{
  const a = run(mk(128, 60), 60, { nameHint: 'Artist - Title (Dj Beats) 96' });
  check('filename BPM wins over audio', Math.abs(a.beatGrid.bpm - 96) < 0.01, `got ${a.beatGrid.bpm}`);
}
// 3. Serato must override everything.
{
  const a = run(mk(128, 60), 60, {
    nameHint: 'Artist - Title (Dj Beats) 96',
    serato: { bpm: 106.62, firstBeatSec: 0.3886 },
  });
  check('serato wins over filename', Math.abs(a.beatGrid.bpm - 106.62) < 0.01, `got ${a.beatGrid.bpm}`);
  check('serato anchors the first beat', Math.abs(a.beatGrid.firstBeatTime - 0.3886) < 1e-6);
  check('serato marks the grid stable', a.beatGrid.isStable);
}

// 4. The grid must actually match the reported tempo.
console.log('\n--- grid integrity');
{
  const a = run(mk(124, 60), 60);
  const bg = a.beatGrid;
  check('beats are present', bg.beats.length > 50, `${bg.beats.length} beats`);
  const iv: number[] = [];
  for (let i = 1; i < bg.beats.length; i++) iv.push(bg.beats[i] - bg.beats[i - 1]);
  const m = iv.reduce((x, y) => x + y, 0) / iv.length;
  check('grid spacing matches reported BPM', Math.abs(60 / m - bg.bpm) < 0.05,
        `grid ${(60 / m).toFixed(3)} vs reported ${bg.bpm.toFixed(3)}`);
  check('beats ascend monotonically', bg.beats.every((v, i) => i === 0 || v > bg.beats[i - 1]));
  check('downbeats are a subset of beats', bg.downbeats.every((d) => bg.beats.some((b) => Math.abs(b - d) < 1e-9)));
  check('waveform peaks produced', (a.waveform?.values.length ?? 0) > 0);
  check('cues inside track bounds',
        a.cues.mixInPoint >= 0 && a.cues.mixOutPoint <= 60 && a.cues.mixInPoint < a.cues.mixOutPoint,
        `in ${a.cues.mixInPoint.toFixed(1)} out ${a.cues.mixOutPoint.toFixed(1)}`);
}

console.log(fail ? `\n${fail} failing` : '\nall green');
process.exit(fail ? 1 : 0);
