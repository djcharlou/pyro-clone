/**
 * Auto cues must land on real section boundaries, not arbitrary points.
 * Built from a track with a known arrangement so the answer is checkable.
 */
import { analyzeTrack } from '../src/analyzer/pipeline';

const RATE = 22050;
const BPM = 128;
const BAR = (60 / BPM) * 4;   // seconds per bar

/** Arrangement: intro / build / DROP / break / DROP / outro, 16 bars each. */
function buildArrangement(): { pcm: Float32Array; boundaries: number[]; dur: number } {
  const sections = [
    { bars: 16, kick: 0.0, hat: 0.35, bass: 0.0 },  // intro — hats only
    { bars: 16, kick: 0.8, hat: 0.4,  bass: 0.0 },  // build — kick in
    { bars: 16, kick: 1.0, hat: 0.5,  bass: 0.9 },  // DROP — bass arrives
    { bars: 16, kick: 0.0, hat: 0.3,  bass: 0.0 },  // break — everything out
    { bars: 16, kick: 1.0, hat: 0.5,  bass: 0.9 },  // DROP again
    { bars: 16, kick: 0.6, hat: 0.3,  bass: 0.0 },  // outro
  ];
  const dur = sections.reduce((s, x) => s + x.bars * BAR, 0);
  const pcm = new Float32Array(Math.ceil(dur * RATE));
  const beat = 60 / BPM;
  const boundaries: number[] = [];
  let t = 0;
  for (const s of sections) {
    boundaries.push(t);
    for (let b = 0; b < s.bars * 4; b++) {
      const at = Math.round((t + b * beat) * RATE);
      if (s.kick) tone(pcm, at, s.kick, 55, 900);
      if (s.bass) tone(pcm, at + 200, s.bass, 90, 2500);
      if (s.hat) tone(pcm, at + Math.round(beat * RATE / 2), s.hat, 5000, 120);
    }
    t += s.bars * BAR;
  }
  for (let i = 0; i < pcm.length; i++) pcm[i] += (Math.random() - 0.5) * 0.01;
  return { pcm, boundaries, dur };
}
function tone(b: Float32Array, at: number, amp: number, f: number, decay: number) {
  for (let k = 0; k < 3000 && at + k < b.length && at + k >= 0; k++)
    b[at + k] += amp * Math.sin(2 * Math.PI * f * k / RATE) * Math.exp(-k / decay);
}

let fail = 0;
const check = (n: string, ok: boolean, d = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${d ? '  — ' + d : ''}`); if (!ok) fail++;
};

const { pcm, boundaries, dur } = buildArrangement();
const a = analyzeTrack({ trackId: 't', channels: [pcm], sampleRate: RATE, durationSec: dur });
const cues = a.autoCues ?? [];

console.log(`track ${dur.toFixed(1)}s, ${boundaries.length} real boundaries at ` +
            boundaries.map(b => b.toFixed(1)).join(', '));
console.log(`detected ${cues.length} cues: ` +
            cues.map(c => `${c.timeSec.toFixed(1)}(${c.type})`).join(' '));

check('produces cues at all', cues.length > 0, `${cues.length}`);
check('never exceeds 8', cues.length <= 8, `${cues.length}`);
check('all inside the track', cues.every(c => c.timeSec >= 0 && c.timeSec <= dur));
check('sorted by time', cues.every((c, i) => i === 0 || c.timeSec >= cues[i - 1].timeSec));
check('scores are normalised', cues.every(c => c.score >= 0 && c.score <= 1));
check('every cue is labelled', cues.every(c => !!c.label));

// Each cue should sit on a downbeat.
const downbeats = a.beatGrid.downbeats;
const offGrid = cues.filter(c => !downbeats.some(d => Math.abs(d - c.timeSec) < 0.06));
check('cues sit on downbeats', offGrid.length === 0,
      offGrid.map(c => c.timeSec.toFixed(2)).join(',') || 'all on grid');

// The real payoff: do they find the actual section changes?
const tol = BAR * 1.5;
const hit = boundaries.filter(b => cues.some(c => Math.abs(c.timeSec - b) < tol));
check('finds the real section boundaries', hit.length >= 5,
      `${hit.length}/${boundaries.length} within ${tol.toFixed(1)}s`);

// Localisation, not just detection. Ranking on a smoothed novelty curve but
// taking the position from the raw one is what moved this from ~2 bars early
// to on the boundary; a regression here means the smoothing is leaking back
// into the placement.
const offsets = boundaries
  .map(b => cues.map(c => c.timeSec - b).sort((x, y) => Math.abs(x) - Math.abs(y))[0])
  .filter(o => o !== undefined && Math.abs(o) < tol) as number[];
const worstOffset = Math.max(...offsets.map(Math.abs));
check('lands within a bar of the boundary', worstOffset < BAR,
      `worst ${worstOffset.toFixed(2)}s (bar ${BAR.toFixed(2)}s)`);

// The two drops should be classified as such.
const drops = cues.filter(c => c.type === 'drop');
check('labels at least one drop', drops.length >= 1,
      `types: ${[...new Set(cues.map(c => c.type))].join(',')}`);

// Specifically: the bass arriving at 60s and 120s is what a DJ calls a drop,
// and a cue sitting there must say so rather than a generic "phrase".
for (const at of [boundaries[2], boundaries[4]]) {
  const near = cues.filter(c => Math.abs(c.timeSec - at) < tol);
  check(`the drop at ${at.toFixed(0)}s is labelled a drop`,
        near.some(c => c.type === 'drop'),
        near.map(c => `${c.timeSec.toFixed(1)}(${c.type})`).join(' ') || 'no cue there');
}
// And the bass leaving at 90s is a break, not a drop.
const atBreak = cues.filter(c => Math.abs(c.timeSec - boundaries[3]) < tol);
check('the break at 90s is labelled a break',
      atBreak.some(c => c.type === 'break') && !atBreak.some(c => c.type === 'drop'),
      atBreak.map(c => `${c.timeSec.toFixed(1)}(${c.type})`).join(' ') || 'no cue there');

// Per-bar energy strip for the waveform display.
const se = a.sectionEnergy ?? [];
check('section energy produced', se.length > 10, `${se.length} bars`);
check('energy normalised 0..1', se.every(s => s.energy >= 0 && s.energy <= 1));
const breakBar = se.find(s => s.startSec > boundaries[3] + BAR && s.startSec < boundaries[3] + 8 * BAR);
const dropBar = se.find(s => s.startSec > boundaries[2] + BAR && s.startSec < boundaries[2] + 8 * BAR);
check('break reads quieter than drop',
      !!breakBar && !!dropBar && breakBar.energy < dropBar.energy,
      `break ${breakBar?.energy.toFixed(2)} vs drop ${dropBar?.energy.toFixed(2)}`);

console.log(fail ? `\n${fail} failing` : '\nall green');
process.exit(fail ? 1 : 0);
