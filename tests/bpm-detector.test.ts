import { energyEnvelope, onsetEnvelope, estimateBpmFromOnsets } from '../src/analyzer/dsp';

const RATE = 22050, ENV_WINDOW = 256, ENV_FPS = RATE / ENV_WINDOW;

/** Synthesise a kick-on-every-beat track at a known tempo. */
function makeClickTrack(bpm: number, seconds = 60, jitter = 0): Float32Array {
  const n = RATE * seconds;
  const buf = new Float32Array(n);
  const period = (60 / bpm) * RATE;
  for (let b = 0; ; b++) {
    let at = b * period;
    if (jitter) at += (Math.random() - 0.5) * jitter * period;
    const i0 = Math.round(at);
    if (i0 >= n) break;
    // short decaying thump
    for (let k = 0; k < 1800 && i0 + k < n; k++) {
      buf[i0 + k] += Math.sin((2 * Math.PI * 60 * k) / RATE) * Math.exp(-k / 500);
    }
  }
  // light noise floor so the onset curve isn't perfectly clean
  for (let i = 0; i < n; i++) buf[i] += (Math.random() - 0.5) * 0.01;
  return buf;
}

function detect(bpm: number, jitter = 0): { got: number; conf: number } {
  const pcm = makeClickTrack(bpm, 60, jitter);
  const env = energyEnvelope(pcm, ENV_WINDOW);
  const ons = onsetEnvelope(env);
  const r = estimateBpmFromOnsets(ons, ENV_FPS);
  return { got: r.bpm, conf: r.confidence };
}

const targets = [81, 92, 100, 116, 124, 128, 135, 140, 150, 155, 174];
let worst = 0, sum = 0;
console.log('target   got     err    conf');
for (const t of targets) {
  const { got, conf } = detect(t);
  const err = Math.abs(got - t);
  worst = Math.max(worst, err); sum += err;
  const flag = err > 2 ? '  <-- off' : '';
  console.log(
    `${String(t).padStart(6)}  ${got.toFixed(2).padStart(6)}  ${err.toFixed(2).padStart(5)}  ${conf.toFixed(2)}${flag}`
  );
}
console.log(`\nmean err ${(sum / targets.length).toFixed(2)} BPM, worst ${worst.toFixed(2)} BPM`);

// with human-ish timing jitter
console.log('\nwith 2% jitter:');
let jw = 0;
for (const t of [100, 128, 150]) {
  const { got } = detect(t, 0.02);
  const err = Math.abs(got - t); jw = Math.max(jw, err);
  console.log(`${String(t).padStart(6)}  ${got.toFixed(2).padStart(6)}  ${err.toFixed(2)}`);
}
console.log(`worst jittered err ${jw.toFixed(2)} BPM`);
