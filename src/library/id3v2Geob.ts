/**
 * Post-process an mp3 that already has an ID3v2 header (written by e.g.
 * browser-id3-writer) and inject one or more GEOB frames into the tag.
 *
 * Why: browser-id3-writer doesn't expose a way to add GEOB frames, and
 * Serato reads its custom binary payloads exclusively through GEOB.
 *
 * ID3v2.3/4 tag layout:
 *   header (10 bytes): "ID3" ver(2) flags(1) size(4 syncsafe)
 *   [ext header, if flag set]
 *   frames: id(4) size(4) flags(2) data(size)
 *   padding (zeros)
 *   [footer, if flag set]
 *   audio data
 *
 * Frame size encoding differs by version:
 *   v2.3: plain big-endian uint32
 *   v2.4: syncsafe uint32 (each byte is 7 bits)
 */

import { concat } from './seratoTags';

export interface GeobFrame {
  mime: string;         // e.g. "application/octet-stream"
  filename: string;     // usually empty
  description: string;  // e.g. "Serato Autotags"
  data: Uint8Array;
}

/**
 * Return a new mp3 buffer with the given GEOB frames added to the tag.
 * If the input has no ID3v2 header, we wrap the audio in a fresh tag.
 */
export function injectGeobFrames(mp3: Uint8Array, frames: GeobFrame[]): Uint8Array {
  if (frames.length === 0) return mp3;

  const header = readTagHeader(mp3);
  if (!header) {
    // No ID3v2 tag — build one from scratch (v2.3, plain size).
    const frameBytes = concat(frames.map((f) => encodeGeobFrame(f, 3)));
    return concat([buildTagHeader(3, frameBytes.length + 1024), frameBytes, new Uint8Array(1024), mp3]);
  }

  const audio = mp3.subarray(header.totalTagSize);
  // Extract existing frames (skip padding — bytes of 00 at the end of frames area).
  const framesArea = mp3.subarray(10 + (header.extHeaderSize ?? 0), header.totalTagSize);
  const existingLength = trimTrailingZeros(framesArea);
  const existingFrames = framesArea.subarray(0, existingLength);

  const newFrameBytes = concat(frames.map((f) => encodeGeobFrame(f, header.version)));

  const combinedFrames = concat([existingFrames, newFrameBytes]);

  // Give a comfortable padding so future edits don't need to shift the audio.
  const PADDING = 2048;
  const padding = new Uint8Array(PADDING);

  const newTagBody = concat([combinedFrames, padding]);
  const newHeader = buildTagHeaderRaw(header.version, header.flags, newTagBody.length);
  return concat([newHeader, newTagBody, audio]);
}

/* ---------- tag header parsing ------------------------------------------ */

interface ID3Header {
  version: number;              // major version (3 or 4)
  flags: number;
  bodySize: number;             // size field value (bytes after 10-byte header)
  totalTagSize: number;         // 10 + bodySize
  extHeaderSize: number | null; // bytes of extended header if present
}

function readTagHeader(mp3: Uint8Array): ID3Header | null {
  if (mp3.length < 10) return null;
  if (mp3[0] !== 0x49 || mp3[1] !== 0x44 || mp3[2] !== 0x33) return null; // "ID3"
  const version = mp3[3];
  const flags = mp3[5];
  const bodySize = readSyncsafe(mp3, 6);
  let extHeaderSize: number | null = null;
  if (flags & 0x40) {
    // Extended header present
    extHeaderSize = readSyncsafe(mp3, 10);
    if (version >= 4) extHeaderSize += 0; // v2.4 size is syncsafe and includes size field itself
  }
  return {
    version,
    flags,
    bodySize,
    totalTagSize: 10 + bodySize,
    extHeaderSize,
  };
}

function readSyncsafe(buf: Uint8Array, off: number): number {
  return (
    ((buf[off] & 0x7f) << 21) |
    ((buf[off + 1] & 0x7f) << 14) |
    ((buf[off + 2] & 0x7f) << 7) |
    (buf[off + 3] & 0x7f)
  );
}

function writeSyncsafe(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (n >> 21) & 0x7f;
  b[1] = (n >> 14) & 0x7f;
  b[2] = (n >> 7) & 0x7f;
  b[3] = n & 0x7f;
  return b;
}

function u32BE(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

function trimTrailingZeros(buf: Uint8Array): number {
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0x00) end--;
  return end;
}

/* ---------- GEOB encoding ------------------------------------------------ */

function encodeGeobFrame(frame: GeobFrame, version: number): Uint8Array {
  // Payload:
  //   text_encoding (1) = 03 (UTF-8)
  //   mime_type (null-terminated ASCII)
  //   filename (null-terminated, encoded per text_encoding)
  //   description (null-terminated, encoded per text_encoding)
  //   binary data
  const enc = new TextEncoder();
  const payload = concat([
    new Uint8Array([0x03]),
    enc.encode(frame.mime + '\0'),
    enc.encode(frame.filename + '\0'),
    enc.encode(frame.description + '\0'),
    frame.data,
  ]);

  const id = new TextEncoder().encode('GEOB');
  const size = version >= 4 ? writeSyncsafe(payload.length) : u32BE(payload.length);
  const flags = new Uint8Array([0x00, 0x00]);

  return concat([id, size, flags, payload]);
}

/* ---------- Building a fresh tag ---------------------------------------- */

function buildTagHeader(version: number, bodySize: number): Uint8Array {
  return buildTagHeaderRaw(version, 0x00, bodySize);
}

function buildTagHeaderRaw(version: number, flags: number, bodySize: number): Uint8Array {
  const header = new Uint8Array(10);
  header[0] = 0x49; // 'I'
  header[1] = 0x44; // 'D'
  header[2] = 0x33; // '3'
  header[3] = version;
  header[4] = 0x00; // revision
  header[5] = flags;
  // Tag size is ALWAYS syncsafe (in the top-level header), regardless of version.
  const size = writeSyncsafe(bodySize);
  header[6] = size[0];
  header[7] = size[1];
  header[8] = size[2];
  header[9] = size[3];
  return header;
}
