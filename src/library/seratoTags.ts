/**
 * Encoders for the ID3 GEOB payloads Serato reads.
 *
 * Format specs reverse-engineered by Jan Holthuis:
 *   https://homepage.ruhr-uni-bochum.de/jan.holthuis/posts/reversing-seratos-geob-tags
 * Full docs vendored in mes repos/serato-tags-main/docs.
 *
 * Byte-order everywhere is big-endian (Serato's convention).
 */

/** Serato Autotags — BPM, Auto Gain and Gain dB, each ASCII zero-terminated. */
export function encodeSeratoAutotags(
  bpm: number,
  autoGainDb: number,
  gainDb = 0
): Uint8Array {
  const parts: Uint8Array[] = [
    new Uint8Array([0x01, 0x01]),
    asciiFloatZ(bpm, 2),
    asciiFloatZ(autoGainDb, 3),
    asciiFloatZ(gainDb, 3),
  ];
  return concat(parts);
}

/**
 * Serato BeatGrid.
 *
 * Non-terminal markers store [position float, uint32 beatsUntilNext].
 * Terminal marker stores    [position float, float bpm].
 * We collapse the grid into evenly-spaced markers so the input list is small
 * enough (Serato caps at ~128 markers per track): one marker every 8 beats,
 * with a terminal marker whose BPM is our detected bpm.
 */
export function encodeSeratoBeatGrid(
  beats: number[],
  bpm: number,
  everyN = 8
): Uint8Array {
  if (beats.length === 0) {
    return concat([
      new Uint8Array([0x01, 0x00]),
      u32BE(0),
      new Uint8Array([randomFooter()]),
    ]);
  }
  // Pick every Nth beat and always the last one for the terminal marker.
  const sampled: number[] = [];
  for (let i = 0; i < beats.length; i += everyN) sampled.push(beats[i]);
  if (sampled[sampled.length - 1] !== beats[beats.length - 1]) {
    sampled.push(beats[beats.length - 1]);
  }
  const parts: Uint8Array[] = [];
  parts.push(new Uint8Array([0x01, 0x00]));
  parts.push(u32BE(sampled.length));
  for (let i = 0; i < sampled.length; i++) {
    const pos = sampled[i];
    const isTerminal = i === sampled.length - 1;
    parts.push(f32BE(pos));
    if (isTerminal) parts.push(f32BE(bpm));
    else parts.push(u32BE(everyN));
  }
  parts.push(new Uint8Array([randomFooter()]));
  return concat(parts);
}

/**
 * Serato Markers2 (base64-wrapped container).
 *
 * We currently emit COLOR + BPMLOCK, plus optional CUE entries for hot cues.
 * Cue entries take Serato-style RGB colours (default palette rotates).
 */
export interface SeratoCue {
  index: number;         // 0..7
  positionMs: number;    // integer ms
  color?: number;        // 0xRRGGBB
  name?: string;
}

const DEFAULT_CUE_COLORS = [
  0xcc0000, 0xcc4400, 0xcc8800, 0x88cc00, 0x00cc44, 0x00cccc, 0x0044cc, 0x8800cc,
];

export function encodeSeratoMarkers2(opts: {
  trackColor?: number; // 0xRRGGBB
  bpmLocked?: boolean;
  cues?: SeratoCue[];
} = {}): Uint8Array {
  const entries: Uint8Array[] = [];

  // COLOR entry — 4 bytes payload: 1 pad + RGB
  const trackColor = opts.trackColor ?? 0xffffff;
  entries.push(makeEntry('COLOR', concat([
    new Uint8Array([0x00]),
    rgbBytes(trackColor),
  ])));

  // BPMLOCK entry — 1 byte
  entries.push(makeEntry('BPMLOCK', new Uint8Array([opts.bpmLocked ? 0x01 : 0x00])));

  // CUE entries
  const cues = opts.cues ?? [];
  for (const cue of cues) {
    entries.push(makeEntry('CUE', encodeCuePayload(cue)));
  }

  // Concatenate: 01 01 + entries + trailing 00
  const inner = concat([
    new Uint8Array([0x01, 0x01]),
    ...entries,
    new Uint8Array([0x00]),
  ]);

  // Base64 encode with linefeed every 72 bytes (Serato convention)
  const b64 = base64WithLineFeeds(inner, 72);
  const b64Bytes = new TextEncoder().encode(b64);
  // Tag header 01 01 + base64 payload + null padding to 470 bytes
  const header = new Uint8Array([0x01, 0x01]);
  const withoutPadding = concat([header, b64Bytes]);
  const MIN_LEN = 470;
  if (withoutPadding.length >= MIN_LEN) return withoutPadding;
  const padding = new Uint8Array(MIN_LEN - withoutPadding.length);
  return concat([withoutPadding, padding]);
}

function makeEntry(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type + '\0');
  return concat([typeBytes, u32BE(data.length), data]);
}

function encodeCuePayload(cue: SeratoCue): Uint8Array {
  const color = cue.color ?? DEFAULT_CUE_COLORS[cue.index % DEFAULT_CUE_COLORS.length];
  const name = new TextEncoder().encode((cue.name ?? '') + '\0');
  return concat([
    new Uint8Array([0x00]),                    // pad
    new Uint8Array([cue.index & 0xff]),        // index
    u32BE(Math.max(0, Math.round(cue.positionMs))),
    new Uint8Array([0x00]),                    // pad
    rgbBytes(color),                           // RGB
    new Uint8Array([0x00, 0x00]),              // pad
    name,
  ]);
}

/* ---------- helpers ------------------------------------------------------ */

export function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function asciiFloatZ(value: number, decimals: number): Uint8Array {
  const s = value.toFixed(decimals) + '\0';
  return new TextEncoder().encode(s);
}

function u32BE(n: number): Uint8Array {
  const b = new Uint8Array(4);
  const view = new DataView(b.buffer);
  view.setUint32(0, n >>> 0, false);
  return b;
}

function f32BE(n: number): Uint8Array {
  const b = new Uint8Array(4);
  const view = new DataView(b.buffer);
  view.setFloat32(0, n, false);
  return b;
}

function rgbBytes(rgb: number): Uint8Array {
  return new Uint8Array([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff]);
}

function randomFooter(): number {
  // Docs note this byte is "apparently random". Any value works; use a
  // stable one for reproducibility.
  return 0x37;
}

function base64WithLineFeeds(bytes: Uint8Array, every: number): string {
  const b64 = bytesToBase64(bytes);
  if (every <= 0) return b64;
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += every) chunks.push(b64.slice(i, i + every));
  return chunks.join('\n');
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
