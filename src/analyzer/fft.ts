/**
 * Iterative radix-2 Cooley-Tukey FFT.
 *
 * Small and dependency-free. Real input, complex output stored as two
 * parallel arrays. N must be a power of two.
 *
 * Meant for offline analysis at ~22 kHz with N ≤ 4096 — fine on the
 * main thread when called from a Web Worker (as our analyzer does).
 */

export interface Complex {
  re: Float32Array;
  im: Float32Array;
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Compute FFT of a real signal, in-place-style (writes into re/im buffers). */
export function fftReal(input: Float32Array, out?: Complex): Complex {
  const N = input.length;
  if ((N & (N - 1)) !== 0) throw new Error(`FFT length must be power of 2, got ${N}`);
  const re = out?.re && out.re.length === N ? out.re : new Float32Array(N);
  const im = out?.im && out.im.length === N ? out.im : new Float32Array(N);
  for (let i = 0; i < N; i++) {
    re[i] = input[i];
    im[i] = 0;
  }
  return fftInPlace({ re, im });
}

/** In-place FFT on complex input. Returns the same object for chaining. */
export function fftInPlace(x: Complex): Complex {
  const N = x.re.length;
  if ((N & (N - 1)) !== 0) throw new Error(`FFT length must be power of 2, got ${N}`);
  const re = x.re;
  const im = x.im;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j &= ~bit;
    j |= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  // Butterflies
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = (2 * Math.PI) / size;
    for (let i = 0; i < N; i += size) {
      let angle = 0;
      for (let k = 0; k < half; k++) {
        const cos = Math.cos(angle);
        const sin = -Math.sin(angle);
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cos - im[b] * sin;
        const ti = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        angle += step;
      }
    }
  }
  return x;
}

/** Magnitude spectrum |X[k]|, first N/2 bins (positive frequencies). */
export function magnitude(x: Complex): Float32Array {
  const halfN = x.re.length >> 1;
  const out = new Float32Array(halfN);
  for (let i = 0; i < halfN; i++) {
    out[i] = Math.sqrt(x.re[i] * x.re[i] + x.im[i] * x.im[i]);
  }
  return out;
}

/** Hann window of length N. */
export function hann(N: number): Float32Array {
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  return w;
}
