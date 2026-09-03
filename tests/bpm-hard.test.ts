import { energyEnvelope, onsetEnvelope, estimateBpmFromOnsets, estimateFirstBeat } from '../src/analyzer/dsp';
import { trackBeats } from '../src/analyzer/beatTracker';
import { makeConstBpm } from '../src/analyzer/beatUtils';

const RATE = 22050, W = 256, FPS = RATE / W;

function makeTrack(bpm: number, seconds: number, jitter: number, drift = 0, swing = 0): Float32Array {
  const n = RATE * seconds; const buf = new Float32Array(n); let t = 0;
  for (let b = 0; t * RATE < n; b++) {
    const localBpm = bpm + (drift * t) / 60;
    const period = 60 / localBpm;
    let at = t * RATE;
    if (jitter) at += (Math.random() - 0.5) * jitter * period * RATE;
    if (swing && b % 2 === 1) at += swing * period * RATE;   // shuffle feel
    const i0 = Math.round(at);
    const accent = b % 4 === 0 ? 1.0 : 0.55;
    for (let k = 0; k < 1800 && i0 + k < n && i0 + k >= 0; k++)
      buf[i0 + k] += accent * Math.sin((2*Math.PI*60*k)/RATE) * Math.exp(-k/500);
    t += period;
  }
  for (let i = 0; i < n; i++) buf[i] += (Math.random() - 0.5) * 0.02;
  return buf;
}

function run(pcm: Float32Array, dur: number) {
  const env = energyEnvelope(pcm, W);
  const on = onsetEnvelope(env);
  const est = estimateBpmFromOnsets(on, FPS);
  const fb = estimateFirstBeat(on, est.bpm, FPS);
  const tr = trackBeats(on, FPS, est.bpm, fb, dur);
  const ir = makeConstBpm(tr.beats);
  return { plain: est.bpm, ironed: ir?.bpm ?? null, cov: ir?.coverage ?? 0, hit: tr.hitRate };
}

const cases: Array<{name:string; bpm:number; sec:number; jit:number; drift:number; swing:number}> = [
  { name: 'clean 128',            bpm:128, sec:60, jit:0,    drift:0,    swing:0 },
  { name: 'human jitter 2%',      bpm:124, sec:60, jit:0.02, drift:0,    swing:0 },
  { name: 'sloppy jitter 5%',     bpm:100, sec:60, jit:0.05, drift:0,    swing:0 },
  { name: 'drift +2bpm/min',      bpm:120, sec:60, jit:0.01, drift:2,    swing:0 },
  { name: 'drift -3bpm/min',      bpm:140, sec:60, jit:0.01, drift:-3,   swing:0 },
  { name: 'swing/shuffle',        bpm:110, sec:60, jit:0.01, drift:0,    swing:0.08 },
  { name: 'short 20s',            bpm:132, sec:20, jit:0.01, drift:0,    swing:0 },
  { name: 'very short 8s',        bpm:126, sec:8,  jit:0.01, drift:0,    swing:0 },
  { name: 'slow 70',              bpm:70,  sec:60, jit:0.01, drift:0,    swing:0 },
  { name: 'fast 175',             bpm:175, sec:60, jit:0.01, drift:0,    swing:0 },
  { name: 'half-int 92.5',        bpm:92.5,sec:60, jit:0.01, drift:0,    swing:0 },
];

console.log('case                    target   plain    ironed   Δplain  Δiron  hit% cov%');
let plainSum=0, ironSum=0, n=0, regressions=0;
for (const c of cases) {
  const pcm = makeTrack(c.bpm, c.sec, c.jit, c.drift, c.swing);
  const r = run(pcm, c.sec);
  const dp = Math.abs(r.plain - c.bpm);
  const di = r.ironed === null ? NaN : Math.abs(r.ironed - c.bpm);
  if (!Number.isNaN(di)) { plainSum+=dp; ironSum+=di; n++; if (di > dp + 0.01) regressions++; }
  console.log(
    `${c.name.padEnd(22)} ${String(c.bpm).padStart(6)}  ${r.plain.toFixed(2).padStart(7)}  ` +
    `${(r.ironed?.toFixed(2) ?? '   —').padStart(7)}  ${dp.toFixed(2).padStart(6)} ${(Number.isNaN(di)?'  —':di.toFixed(2)).padStart(6)}` +
    `  ${(r.hit*100).toFixed(0).padStart(3)} ${(r.cov*100).toFixed(0).padStart(4)}`
  );
}
console.log(`\nmean Δ plain ${(plainSum/n).toFixed(3)}  |  mean Δ ironed ${(ironSum/n).toFixed(3)}  |  regressions ${regressions}/${n}`);
