// Mirror of the private helper in Deck.ts, verified against brute-force
// numerical integration of the exact curve Web Audio traces.
function integrateExpRamp(from: number, to: number, D: number, e: number): number {
  const el = Math.max(0, Math.min(e, D));
  if (D <= 0) return 0;
  const k = to / from;
  if (!Number.isFinite(k) || k <= 0 || Math.abs(k - 1) < 1e-9) return from * el;
  const lnK = Math.log(k);
  return (from * D / lnK) * (Math.pow(k, el / D) - 1);
}

function numeric(from: number, to: number, D: number, e: number, steps = 2_000_00): number {
  const el = Math.max(0, Math.min(e, D));
  const h = el / steps;
  let acc = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * h;
    acc += from * Math.pow(to / from, t / D) * h;
  }
  return acc;
}

const cases: [number, number, number, number][] = [
  // from,  to,   D,   elapsed
  [1.04,   1.0,  8,   8],    // typical release after a +4% match
  [0.96,   1.0,  8,   8],    // release after a -4% match
  [1.0,    1.0,  8,   4],    // degenerate: no change
  [1.06,   1.0,  6,   3],    // mid-ramp
  [0.94,   1.0, 10,   7.5],
];

let worst = 0;
console.log('from    to     D   elap    closed      numeric      diff');
for (const [f, t, D, e] of cases) {
  const a = integrateExpRamp(f, t, D, e);
  const b = numeric(f, t, D, e);
  const d = Math.abs(a - b);
  worst = Math.max(worst, d);
  console.log(
    `${f.toFixed(2)}  ${t.toFixed(2)}  ${String(D).padStart(2)}  ${String(e).padStart(4)}  ` +
    `${a.toFixed(9).padStart(11)}  ${b.toFixed(9).padStart(11)}  ${d.toExponential(2)}`
  );
}
console.log(`\nworst abs diff: ${worst.toExponential(2)} s`);

// Sanity: an 8s release from +4% should "lose" well under a beat of position
const lost = 8 * 1.04 - integrateExpRamp(1.04, 1.0, 8, 8);
console.log(`position consumed vs holding +4% for 8s: ${lost.toFixed(4)}s slower (expected ~0.16s)`);
process.exit(worst < 1e-6 ? 0 : 1);
