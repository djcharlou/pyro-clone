/**
 * Pitching a deck transposes it, so the key shown on a deck has to follow the
 * pitch fader rather than the tag. Two independent routes exist — via note
 * names and via the Camelot wheel — and they must agree, because the UI shows
 * the wheel badge next to a name derived from the note.
 */
import {
  semitonesForRatio,
  ratioForSemitones,
  transposeKey,
  transposeCamelot,
  pitchedKey,
  ratioToMatchKey,
} from '../src/shared/pitchKey';
import { toCamelot } from '../src/shared/camelot';
import type { Camelot, KeyInfo, NoteRoot, Scale } from '../src/shared/types';

let fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fail++;
};
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

const NOTES: NoteRoot[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const key = (root: NoteRoot, scale: Scale): KeyInfo => ({
  root,
  scale,
  camelot: toCamelot(root, scale),
  confidence: 1,
});

// --- rate <-> semitones ----------------------------------------------------

check('an octave up is 12 semitones', near(semitonesForRatio(2), 12, 1e-9));
check('unity is no shift', semitonesForRatio(1) === 0);
check('an octave down is -12', near(semitonesForRatio(0.5), -12, 1e-9));
// +6% is the pitch range a DJ actually reaches for; it must read as 1 semitone.
check('+6% rounds to one semitone', Math.round(semitonesForRatio(1.06)) === 1,
  semitonesForRatio(1.06).toFixed(3));
check('a semitone is ~5.95%', near(ratioForSemitones(1), 1.059463, 1e-6));
for (const s of [-7, -3, -1, 0, 1, 4, 9]) {
  check(`round trip ${s} st`, near(semitonesForRatio(ratioForSemitones(s)), s, 1e-9));
}
check('a bad ratio does not shift', semitonesForRatio(0) === 0 && semitonesForRatio(NaN) === 0);

// --- named transposition ---------------------------------------------------

check('C minor up one is C# minor', transposeKey(key('C', 'minor'), 1).root === 'C#');
check('B major up one wraps to C', transposeKey(key('B', 'major'), 1).root === 'C');
check('C major down one wraps to B', transposeKey(key('C', 'major'), -1).root === 'B');
check('scale is preserved', transposeKey(key('A', 'minor'), 5).scale === 'minor');
check('zero is identity', transposeKey(key('G', 'major'), 0).root === 'G');
check('an octave is identity', transposeKey(key('G', 'major'), 12).root === 'G');

// --- wheel transposition ---------------------------------------------------

// C major is 8B; a semitone up is C# major, which is 3B. Getting this wrong is
// the classic off-by-a-fifth error, so it is pinned explicitly.
check('8B up one is 3B', transposeCamelot('8B' as Camelot, 1) === '3B');
check('8A up one is 3A', transposeCamelot('8A' as Camelot, 1) === '3A');
check('8B down one is 1B', transposeCamelot('8B' as Camelot, -1) === '1B');
check('twelve semitones is identity', transposeCamelot('5A' as Camelot, 12) === '5A');

// The invariant that matters: both routes agree for every key and every shift.
let mismatches: string[] = [];
for (const scale of ['major', 'minor'] as Scale[]) {
  for (const root of NOTES) {
    for (let s = -12; s <= 12; s++) {
      const viaName = transposeKey(key(root, scale), s).camelot;
      const viaWheel = transposeCamelot(toCamelot(root, scale), s);
      if (viaName !== viaWheel) mismatches.push(`${root} ${scale} ${s > 0 ? '+' : ''}${s}: ${viaName} vs ${viaWheel}`);
    }
  }
}
check('note names and the wheel agree for all 600 cases', mismatches.length === 0,
  mismatches.slice(0, 3).join(' | '));

// --- what the deck strip shows --------------------------------------------

const atUnity = pitchedKey(key('C', 'minor'), 1);
check('unity is not flagged as shifted', !atUnity.shifted && atUnity.key.camelot === '5A',
  atUnity.key.camelot);

const at6 = pitchedKey(key('C', 'minor'), 1.06);
check('+6% shows C minor as C# minor', at6.key.root === 'C#' && at6.key.camelot === '12A',
  `${at6.key.root} ${at6.key.camelot}`);
check('+6% is flagged shifted', at6.shifted);
check('+6% reports a small cents offset', near(at6.centsOff, 0.86, 1),
  at6.centsOff.toFixed(2));

// A nudge is not a key change: showing "1 semitone" for +0.5% would be a lie.
const tiny = pitchedKey(key('C', 'minor'), 1.005);
check('a 0.5% nudge is not a key change', !tiny.shifted && tiny.key.camelot === '5A');
check('a 1.5% nudge is still not a key change', !pitchedKey(key('C', 'minor'), 1.015).shifted);

// The invariant behind that: `shifted` must mean the badge actually changed,
// or the strip draws an arrow from a key to itself labelled "+0 semitones".
let inconsistent: string[] = [];
for (let pct = -12; pct <= 12; pct += 0.1) {
  const ratio = 1 + pct / 100;
  const pk = pitchedKey(key('C', 'minor'), ratio);
  const changed = pk.key.camelot !== '5A';
  if (pk.shifted !== changed) inconsistent.push(`${pct.toFixed(1)}%: shifted=${pk.shifted} key=${pk.key.camelot}`);
  if (pk.shifted && Math.round(pk.semitones) === 0) inconsistent.push(`${pct.toFixed(1)}%: would show "+0 semitones"`);
}
check('shifted is true exactly when the key name moves', inconsistent.length === 0,
  inconsistent.slice(0, 3).join(' | '));

// --- matching a target key -------------------------------------------------

check('8A to 3A is one semitone up',
  near(ratioToMatchKey('8A' as Camelot, '3A' as Camelot), ratioForSemitones(1), 1e-9));
check('8A to 1A is one semitone down',
  near(ratioToMatchKey('8A' as Camelot, '1A' as Camelot), ratioForSemitones(-1), 1e-9));
check('same key needs no shift', ratioToMatchKey('8A' as Camelot, '8A' as Camelot) === 1);
check('crossing modes is refused', ratioToMatchKey('8A' as Camelot, '3B' as Camelot) === 1);
// Never transpose more than a tritone: the long way round is always audible.
let worst = 0;
for (let a = 1; a <= 12; a++) {
  for (let b = 1; b <= 12; b++) {
    const st = Math.abs(semitonesForRatio(ratioToMatchKey(`${a}A` as Camelot, `${b}A` as Camelot)));
    worst = Math.max(worst, st);
  }
}
check('always takes the shorter direction', worst <= 6 + 1e-9, `worst ${worst.toFixed(2)} st`);

// And the ratio it returns must actually land on the requested key.
let landed = 0;
for (let a = 1; a <= 12; a++) {
  for (let b = 1; b <= 12; b++) {
    const from = `${a}A` as Camelot;
    const to = `${b}A` as Camelot;
    const got = transposeCamelot(from, semitonesForRatio(ratioToMatchKey(from, to)));
    if (got === to) landed++;
  }
}
check('the returned ratio lands on the target key', landed === 144, `${landed}/144`);

console.log(fail === 0 ? '\nAll pitch/key checks passed.' : `\n${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
