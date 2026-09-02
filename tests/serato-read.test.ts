import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { readSeratoData } from '../src/library/seratoRead';

const dir = '/Users/charlesrochette/Downloads/Mastermix DJ Beats Vol. 152-G11';
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp3'));

let withBpm = 0, withGrid = 0, withCues = 0, nameMatches = 0, checked = 0;
console.log('file                                             name  serato   1stBeat  cues');
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(join(dir, f)));
  const s = readSeratoData(bytes);
  checked++;
  const named = f.match(/\s(\d{2,3})\s*\.mp3$/)?.[1];
  const bpm = s?.autotags?.bpm;
  const first = s?.beatGrid?.markers?.[0]?.position;
  const nCues = s?.cues.length ?? 0;
  if (bpm) withBpm++;
  if (first !== undefined) withGrid++;
  if (nCues) withCues++;
  if (named && bpm && Math.abs(Number(named) - bpm) < 1.5) nameMatches++;
  console.log(
    `${f.slice(0, 46).padEnd(46)}  ${(named ?? '—').padStart(4)}  ` +
    `${(bpm?.toFixed(2) ?? '—').padStart(6)}  ${(first?.toFixed(4) ?? '—').padStart(7)}  ${nCues}`
  );
}
console.log(`\n${checked} files: ${withBpm} with BPM, ${withGrid} with beatgrid, ${withCues} with cues`);
console.log(`${nameMatches}/${withBpm} Serato BPMs agree with the filename (±1.5)`);
process.exit(withBpm === checked && withGrid === checked ? 0 : 1);
