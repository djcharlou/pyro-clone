/**
 * The video showed the same track occupying two queue slots, which made the
 * mix loop back onto it. Queue is a playlist: an id may appear at most once.
 */
import { useStore } from '../src/state/store';

const s = () => useStore.getState();
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fail++;
};

s().clearQueue();
s().addToQueue('a');
s().addToQueue('b');
s().addToQueue('a');           // the selector re-picking something queued
check('addToQueue ignores duplicates', s().queue.join(',') === 'a,b', s().queue.join(','));

s().clearQueue();
s().addManyToQueue(['x', 'y', 'x', 'z', 'y']);   // dupes inside the batch
check('addManyToQueue de-dupes within the batch', s().queue.join(',') === 'x,y,z', s().queue.join(','));

s().addManyToQueue(['y', 'w']);                   // overlap with existing
check('addManyToQueue de-dupes against existing', s().queue.join(',') === 'x,y,z,w', s().queue.join(','));

// Order must be preserved, and moving must not duplicate.
s().clearQueue();
s().addManyToQueue(['1', '2', '3', '4']);
s().moveInQueue(0, 2);
check('moveInQueue preserves length', s().queue.length === 4, s().queue.join(','));
check('moveInQueue has no dupes', new Set(s().queue).size === 4, s().queue.join(','));

s().removeFromQueue('3');
check('removeFromQueue drops exactly one', s().queue.length === 3 && !s().queue.includes('3'), s().queue.join(','));

console.log(fail ? `\n${fail} failing` : '\nall green');
process.exit(fail ? 1 : 0);
