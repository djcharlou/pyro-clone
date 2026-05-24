import type { Camelot, NoteRoot, Scale } from './types';

const KEY_TO_CAMELOT: Record<string, Camelot> = {
  'C major': '8B',  'A minor':  '8A',
  'G major': '9B',  'E minor':  '9A',
  'D major': '10B', 'B minor':  '10A',
  'A major': '11B', 'F# minor': '11A',
  'E major': '12B', 'C# minor': '12A',
  'B major': '1B',  'G# minor': '1A',
  'F# major': '2B', 'D# minor': '2A',
  'C# major': '3B', 'A# minor': '3A',
  'G# major': '4B', 'F minor':  '4A',
  'D# major': '5B', 'C minor':  '5A',
  'A# major': '6B', 'G minor':  '6A',
  'F major':  '7B', 'D minor':  '7A',
};

const ENHARMONIC: Record<string, NoteRoot> = {
  Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#',
};

export function normalizeRoot(raw: string): NoteRoot {
  const trimmed = raw.trim();
  if (trimmed in ENHARMONIC) return ENHARMONIC[trimmed];
  return trimmed as NoteRoot;
}

export function toCamelot(root: NoteRoot, scale: Scale): Camelot {
  const key = `${root} ${scale}`;
  const c = KEY_TO_CAMELOT[key];
  if (!c) throw new Error(`Unknown key: ${key}`);
  return c;
}

export function parseCamelot(c: Camelot): [number, 'A' | 'B'] {
  const letter = c.slice(-1) as 'A' | 'B';
  const number = parseInt(c.slice(0, -1), 10);
  return [number, letter];
}

/** 0..1 — 1 = perfect harmonic match. */
export function camelotCompatibility(a: Camelot, b: Camelot): number {
  const [na, la] = parseCamelot(a);
  const [nb, lb] = parseCamelot(b);
  if (na === nb && la === lb) return 1.0;
  if (la === lb && cyclicDistance(na, nb, 12) === 1) return 0.9;
  if (na === nb && la !== lb) return 0.85;
  if (la === lb && cyclicDistance(na, nb, 12) === 7) return 0.7;
  return 0.25;
}

function cyclicDistance(a: number, b: number, mod: number): number {
  const d = Math.abs(a - b) % mod;
  return Math.min(d, mod - d);
}
