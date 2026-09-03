import type { Camelot, KeyInfo, NoteRoot, Scale } from './types';
import { toCamelot, parseCamelot } from './camelot';

/**
 * Key follows pitch.
 *
 * Changing playback rate transposes the audio: at +6% a track is roughly a
 * semitone sharp, so a set mixed on written keys goes out of tune the moment
 * a deck is pitched. Harmonic mixing has to use the key you are actually
 * hearing, not the one stored in the tag.
 */

/** Semitones of transposition produced by a playback-rate ratio. */
export function semitonesForRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return 12 * Math.log2(ratio);
}

/** The playback-rate ratio that transposes by a given number of semitones. */
export function ratioForSemitones(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

const NOTES: NoteRoot[] = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

/**
 * Transpose a key by whole semitones.
 *
 * Only whole semitones are meaningful for a key name; the caller decides how
 * to round, since a +0.4 semitone pitch is genuinely between keys and
 * reporting it as either neighbour would be a small lie either way.
 */
export function transposeKey(key: KeyInfo, semitones: number): KeyInfo {
  const steps = Math.round(semitones);
  if (steps === 0) return key;
  const idx = NOTES.indexOf(key.root);
  if (idx < 0) return key;
  const root = NOTES[(((idx + steps) % 12) + 12) % 12];
  return {
    ...key,
    root,
    camelot: toCamelot(root, key.scale),
  };
}

/** Transpose a Camelot code directly, without going via note names. */
export function transposeCamelot(camelot: Camelot, semitones: number): Camelot {
  const steps = Math.round(semitones);
  if (steps === 0) return camelot;
  const [num, letter] = parseCamelot(camelot);
  // One semitone up is seven positions clockwise on the wheel (the circle of
  // fifths), which is what the Camelot numbering encodes.
  const shifted = (((num - 1 + steps * 7) % 12) + 12) % 12 + 1;
  return `${shifted}${letter}` as Camelot;
}

export interface PitchedKey {
  /** Key as it now sounds. Equals the original when the shift rounds to 0. */
  key: KeyInfo;
  /** Exact transposition, before rounding to a named key. */
  semitones: number;
  /** How far the sounding pitch sits from the named key, in semitones. */
  centsOff: number;
  /** True when the track now sounds in a different named key. */
  shifted: boolean;
}

/**
 * Key of a deck given its current playback ratio.
 *
 * `shifted` tracks the same rounding `transposeKey` uses, so it is true
 * exactly when the key name has actually moved. A looser threshold would let
 * the UI draw an arrow from a key to itself labelled "+0 semitones"; anything
 * short of a full semitone is detune, and `centsOff` is what reports it.
 */
export function pitchedKey(key: KeyInfo, ratio: number): PitchedKey {
  const semitones = semitonesForRatio(ratio);
  const rounded = Math.round(semitones);
  const centsOff = (semitones - rounded) * 100;
  return {
    key: transposeKey(key, semitones),
    semitones,
    centsOff,
    shifted: rounded !== 0,
  };
}

/**
 * Playback ratio that puts `from` into `to`, choosing the smallest shift.
 *
 * Used by key-lock style helpers: rather than always transposing up, pick
 * whichever direction is the shorter move around the octave.
 */
export function ratioToMatchKey(from: Camelot, to: Camelot): number {
  const [fromNum, fromLetter] = parseCamelot(from);
  const [toNum, toLetter] = parseCamelot(to);
  // Different modes cannot be reconciled by transposition alone.
  if (fromLetter !== toLetter) return 1;
  // Each Camelot step is a fifth; inverting gives the semitone distance.
  const wheelSteps = (((toNum - fromNum) % 12) + 12) % 12;
  // 7 semitones per wheel step, mod 12 → the semitone shift.
  let semis = (wheelSteps * 7) % 12;
  if (semis > 6) semis -= 12; // take the shorter direction
  return ratioForSemitones(semis);
}

export type { Scale };
