import { bpmFromName, reconcileBpm } from '../src/analyzer/bpmFromName';

const cases: [string, number | null][] = [
  ['Queen - We Will Rock You (Dj Beats) 81', 81],
  ['Sum 41 - In Too Deep (Dj Beats) 116', 116],
  ['Status Quo - Caroline (Dj Beats) 155', 155],
  ["Guns N' Roses - You Could Be Mine (Dj Beats) 150", 150],
  ['Judas Priest - Living After Midnight (Dj Beats) 135', 135],
  ['Artist - Title [128]', 128],
  ['Artist - Title (124 BPM)', 124],
  ['Artist - Title - 124bpm', 124],
  ['083 - Village People - Ymca', null],          // track index, not tempo
  ['007 - Whitney Houston - I Wanna Dance', null],// index out of range anyway
  ['Blink 182 - All The Small Things', null],     // band name, not trailing
  ['Just A Title With No Number', null],
];

let pass = 0, fail = 0;
for (const [name, want] of cases) {
  const got = bpmFromName(name);
  const gotBpm = got?.bpm ?? null;
  const ok = gotBpm === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(gotBpm).padStart(4)} (want ${String(want).padStart(4)})  ${name}`);
}

// reconcile: filename 81, estimator said 157 (roughly 2x → octave error)
const r = reconcileBpm(bpmFromName('Queen - We Will Rock You (Dj Beats) 81'), { bpm: 157, confidence: 0.4 });
console.log('\nreconcile 81 vs est 157 =>', r);
const r2 = reconcileBpm(null, { bpm: 128.4, confidence: 0.8 });
console.log('reconcile no-name       =>', r2);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
