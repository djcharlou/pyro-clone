/**
 * Read Serato's GEOB ID3 tags out of an MP3.
 *
 * Serato stores its analysis inside ID3v2 `GEOB` (General Encapsulated
 * Object) frames, identified by their description string. Libraries that
 * have been through Serato — Mastermix / DJ Beats packs and anything the
 * user has analysed themselves — therefore already carry a precise tempo,
 * beatgrid anchor and hot cues.
 *
 * That is ground truth, and it is strictly better than anything we can
 * estimate from the decoded audio, so the analyzer prefers it when present.
 *
 * Format reference: https://github.com/Holzhaus/serato-tags
 */

export interface SeratoAutotags {
  bpm: number;
  autoGainDb: number;
  gainDb: number;
}

export interface SeratoBeatGridMarker {
  /** Seconds from the start of the file. */
  position: number;
  /** Present on the final ("terminal") marker: tempo from here on. */
  bpm?: number;
  /** Present on non-terminal markers: beats until the next marker. */
  beatsTillNext?: number;
}

export interface SeratoBeatGrid {
  markers: SeratoBeatGridMarker[];
}

export interface SeratoCuePoint {
  index: number;
  positionSec: number;
  color: [number, number, number];
  name: string;
}

export interface SeratoData {
  autotags?: SeratoAutotags;
  beatGrid?: SeratoBeatGrid;
  cues: SeratoCuePoint[];
  bpmLocked?: boolean;
  /** Raw frame descriptions found, for diagnostics. */
  framesFound: string[];
}

/** Parse every GEOB frame in an ID3v2 tag, keyed by description. */
export function readGeobFrames(mp3: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (mp3.length < 10) return out;
  if (mp3[0] !== 0x49 || mp3[1] !== 0x44 || mp3[2] !== 0x33) return out; // "ID3"

  const major = mp3[3];
  const flags = mp3[5];
  const tagSize = synchsafe(mp3, 6);

  let p = 10;
  if (flags & 0x40) {
    // Extended header — v2.4 uses a synchsafe size that INCLUDES itself,
    // v2.3 a plain size that EXCLUDES the 4 size bytes.
    p += major === 4 ? synchsafe(mp3, p) : readU32(mp3, p) + 4;
  }

  const end = Math.min(mp3.length, 10 + tagSize);
  const view = new DataView(mp3.buffer, mp3.byteOffset, mp3.byteLength);

  while (p + 10 <= end) {
    const id = latin1(mp3, p, p + 4);
    // Padding (all zero bytes) marks the end of real frames.
    if (!/^[A-Z0-9]{4}$/.test(id)) break;

    const frameSize = major === 4 ? synchsafe(mp3, p + 4) : view.getUint32(p + 4, false);
    const body = p + 10;
    if (frameSize <= 0 || body + frameSize > end) break;

    if (id === 'GEOB') {
      const parsed = parseGeobBody(mp3, body, body + frameSize);
      if (parsed) out.set(parsed.description, parsed.data);
    }
    p = body + frameSize;
  }
  return out;
}

/**
 * GEOB body layout: encoding byte, MIME (NUL-terminated), filename
 * (NUL-terminated), description (NUL-terminated), then the payload.
 */
function parseGeobBody(
  b: Uint8Array,
  start: number,
  end: number
): { description: string; data: Uint8Array } | null {
  let p = start + 1; // skip text-encoding byte
  const mimeEnd = indexOfZero(b, p, end);
  if (mimeEnd < 0) return null;
  p = mimeEnd + 1;
  const fileEnd = indexOfZero(b, p, end);
  if (fileEnd < 0) return null;
  p = fileEnd + 1;
  const descEnd = indexOfZero(b, p, end);
  if (descEnd < 0) return null;
  const description = latin1(b, p, descEnd);
  return { description, data: b.subarray(descEnd + 1, end) };
}

/** Full Serato payload for a track, or null when the file has none. */
export function readSeratoData(mp3: Uint8Array): SeratoData | null {
  const frames = readGeobFrames(mp3);
  if (frames.size === 0) return null;

  const framesFound = [...frames.keys()];
  const hasAny = framesFound.some((k) => k.startsWith('Serato'));
  if (!hasAny) return null;

  const result: SeratoData = { cues: [], framesFound };

  const at = frames.get('Serato Autotags');
  if (at) result.autotags = parseAutotags(at) ?? undefined;

  const bg = frames.get('Serato BeatGrid');
  if (bg) result.beatGrid = parseBeatGrid(bg) ?? undefined;

  const m2 = frames.get('Serato Markers2');
  if (m2) {
    const parsed = parseMarkers2(m2);
    result.cues = parsed.cues;
    result.bpmLocked = parsed.bpmLocked;
  }

  return result;
}

/** `01 01` then three NUL-terminated ASCII decimals: BPM, auto gain, gain. */
function parseAutotags(d: Uint8Array): SeratoAutotags | null {
  let p = 2;
  const [bpmStr, p1] = readZeroTerminated(d, p);
  const [autoStr, p2] = readZeroTerminated(d, p1);
  const [gainStr] = readZeroTerminated(d, p2);
  const bpm = parseFloat(bpmStr);
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  return {
    bpm,
    autoGainDb: safeFloat(autoStr),
    gainDb: safeFloat(gainStr),
  };
}

/**
 * `01 00`, uint32 marker count, then markers. Every marker is
 * float32 position + 4 bytes that mean BPM on the terminal marker and a
 * beat count on the others. One trailing footer byte.
 */
function parseBeatGrid(d: Uint8Array): SeratoBeatGrid | null {
  if (d.length < 6) return null;
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const count = view.getUint32(2, false);
  // Guard against a corrupt count claiming more data than the frame holds.
  if (count === 0 || 6 + count * 8 > d.length) return null;

  const markers: SeratoBeatGridMarker[] = [];
  let p = 6;
  for (let i = 0; i < count; i++) {
    const position = view.getFloat32(p, false);
    if (i === count - 1) {
      markers.push({ position, bpm: view.getFloat32(p + 4, false) });
    } else {
      markers.push({ position, beatsTillNext: view.getUint32(p + 4, false) });
    }
    p += 8;
  }
  return { markers };
}

/**
 * Markers2 is a base64 blob (newline-wrapped) holding a sequence of
 * NUL-terminated entry names, each followed by a uint32 length and body.
 * We only care about CUE, BPMLOCK and COLOR.
 */
function parseMarkers2(d: Uint8Array): { cues: SeratoCuePoint[]; bpmLocked?: boolean } {
  const cues: SeratoCuePoint[] = [];
  let bpmLocked: boolean | undefined;

  const b64 = latin1(d, 2, d.length).replace(/\0[\s\S]*$/, '').replace(/\s+/g, '');
  let buf: Uint8Array;
  try {
    buf = base64ToBytes(b64);
  } catch {
    return { cues, bpmLocked };
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 2; // version header
  while (p + 5 <= buf.length) {
    const nameEnd = indexOfZero(buf, p, buf.length);
    if (nameEnd < 0) break;
    const name = latin1(buf, p, nameEnd);
    if (!name) break;
    const lenAt = nameEnd + 1;
    if (lenAt + 4 > buf.length) break;
    const len = view.getUint32(lenAt, false);
    const bodyStart = lenAt + 4;
    const bodyEnd = bodyStart + len;
    if (bodyEnd > buf.length) break;
    const body = buf.subarray(bodyStart, bodyEnd);

    if (name === 'CUE' && body.length >= 13) {
      const bv = new DataView(body.buffer, body.byteOffset, body.byteLength);
      cues.push({
        index: body[1],
        positionSec: bv.getUint32(2, false) / 1000,
        color: [body[7], body[8], body[9]],
        name: readZeroTerminated(body, 12)[0],
      });
    } else if (name === 'BPMLOCK' && body.length >= 1) {
      bpmLocked = body[0] !== 0;
    }

    p = bodyEnd;
  }

  cues.sort((a, b) => a.positionSec - b.positionSec);
  return { cues, bpmLocked };
}

/* ------------------------------- helpers ------------------------------- */

function synchsafe(b: Uint8Array, off: number): number {
  return (
    ((b[off] & 0x7f) << 21) |
    ((b[off + 1] & 0x7f) << 14) |
    ((b[off + 2] & 0x7f) << 7) |
    (b[off + 3] & 0x7f)
  );
}

function readU32(b: Uint8Array, off: number): number {
  return (
    ((b[off] << 24) >>> 0) + (b[off + 1] << 16) + (b[off + 2] << 8) + b[off + 3]
  );
}

function indexOfZero(b: Uint8Array, from: number, to: number): number {
  for (let i = from; i < to; i++) if (b[i] === 0) return i;
  return -1;
}

function latin1(b: Uint8Array, from: number, to: number): string {
  let s = '';
  for (let i = from; i < to; i++) s += String.fromCharCode(b[i]);
  return s;
}

function readZeroTerminated(b: Uint8Array, from: number): [string, number] {
  let e = from;
  while (e < b.length && b[e] !== 0) e++;
  return [latin1(b, from, e), e + 1];
}

function safeFloat(s: string): number {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
}

function base64ToBytes(b64: string): Uint8Array {
  // atob exists in browsers and in the Tauri webview; Buffer is the Node
  // fallback used by the test harness.
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const g = globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } };
  if (g.Buffer) return g.Buffer.from(b64, 'base64');
  throw new Error('no base64 decoder available');
}
