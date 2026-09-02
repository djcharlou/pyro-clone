/**
 * Cover art extraction — resize the first embedded picture from an audio
 * file down to a small JPEG data-URL so we can render it everywhere without
 * blowing up IndexedDB. Runs off the main thread when possible.
 */

const TARGET_MAX_PX = 256;
const JPEG_QUALITY = 0.82;

export interface RawPicture {
  data: Uint8Array;
  format: string; // e.g. "image/jpeg" or "image/png"
}

/**
 * Convert a raw picture (as returned by music-metadata) into a small
 * JPEG data-URL. Returns undefined on any failure — callers should treat
 * missing cover art as normal and render the placeholder gradient.
 */
export async function pictureToDataUrl(pic: RawPicture): Promise<string | undefined> {
  try {
    const blob = new Blob([new Uint8Array(pic.data)], { type: pic.format || 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    const { canvas, ctx } = makeCanvas(fitInto(bitmap.width, bitmap.height, TARGET_MAX_PX));
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return await canvasToDataUrl(canvas);
  } catch (err) {
    console.warn('[coverArt] failed to process picture', err);
    return undefined;
  }
}

interface Sized { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D }

function makeCanvas(size: { w: number; h: number }): Sized {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(size.w, size.h);
    const ctx = c.getContext('2d');
    if (ctx) return { canvas: c, ctx };
  }
  const c = document.createElement('canvas');
  c.width = size.w;
  c.height = size.h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  return { canvas: c, ctx };
}

async function canvasToDataUrl(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<string> {
  if ('convertToBlob' in canvas) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    return await blobToDataUrl(blob);
  }
  return (canvas as HTMLCanvasElement).toDataURL('image/jpeg', JPEG_QUALITY);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function fitInto(srcW: number, srcH: number, maxPx: number): { w: number; h: number } {
  if (srcW <= maxPx && srcH <= maxPx) return { w: srcW, h: srcH };
  const scale = srcW >= srcH ? maxPx / srcW : maxPx / srcH;
  return { w: Math.max(1, Math.round(srcW * scale)), h: Math.max(1, Math.round(srcH * scale)) };
}
