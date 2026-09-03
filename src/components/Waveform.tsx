import { useMemo, useRef, useState } from 'react';
import type { WaveformPeaks } from '@shared/types';

interface Props {
  peaks: WaveformPeaks | undefined;
  progress: number; // 0..1
  height?: number;
  playedColor?: string;
  remainingColor?: string;
  /** Fires ONCE on pointer release with the final 0..1 fraction. */
  onScrub?: (fraction: number) => void;
}

const BAR_TOTAL = 220; // fewer bars than v1 canvas — SVG DOM node count matters
const VB_HEIGHT = 100;

/**
 * SVG waveform renderer.
 *
 * SVG instead of canvas because canvas needed a two-step retry to survive
 * the first paint after a deck swap — the wrap was measured at zero width
 * on mount and never redrawn. SVG uses a viewBox so the bars are drawn in
 * their own coordinate space and scale to whatever CSS width the wrap
 * ends up with, no matter when layout runs.
 *
 * Always renders SOMETHING: real peaks when analysed, otherwise a synthetic
 * build/peak/tail placeholder so users see a waveform on tracks imported
 * before we started storing peaks.
 */
export function Waveform({
  peaks,
  progress,
  height = 100,
  playedColor = '#ffffff',
  remainingColor = 'rgba(255,255,255,0.35)',
  onScrub,
}: Props): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);
  const [dragFrac, setDragFrac] = useState<number | null>(null);
  const draggingRef = useRef(false);

  const rawDisplay = dragFrac ?? progress;
  const displayProgress = Number.isFinite(rawDisplay)
    ? Math.max(0, Math.min(1, rawDisplay))
    : 0;

  // Precompute bar heights (0..1). Recomputes only when the peaks source
  // changes, not every progress tick.
  const bars = useMemo(() => sampleBars(peaks, BAR_TOTAL), [peaks]);

  const barWidth = 1000 / BAR_TOTAL; // viewBox is 0..1000 wide
  const step = barWidth;

  const cursorPct = displayProgress * 100;
  const hoverPct = hoverFrac !== null ? hoverFrac * 100 : null;

  function fractionFromEvent(e: { clientX: number }): number {
    const el = wrapRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  return (
    <div
      ref={wrapRef}
      className="waveform-wrap"
      style={{
        width: '100%',
        height,
        position: 'relative',
        cursor: onScrub ? (dragFrac !== null ? 'grabbing' : 'ew-resize') : 'default',
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        if (!onScrub) return;
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        draggingRef.current = true;
        setDragFrac(fractionFromEvent(e));
      }}
      onPointerMove={(e) => {
        if (!onScrub) return;
        const f = fractionFromEvent(e);
        setHoverFrac(f);
        if (draggingRef.current) setDragFrac(f);
      }}
      onPointerUp={(e) => {
        if (!onScrub) return;
        try {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        if (draggingRef.current) {
          const finalFrac = dragFrac ?? fractionFromEvent(e);
          draggingRef.current = false;
          setDragFrac(null);
          onScrub(finalFrac);
        }
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
        setDragFrac(null);
      }}
      onPointerLeave={() => setHoverFrac(null)}
    >
      <svg
        viewBox={`0 0 1000 ${VB_HEIGHT}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {/* Bars — always render, using synthetic values when there are no peaks */}
        {bars.map((v, i) => {
          const barH = Math.max(2, v * (VB_HEIGHT - 4));
          const y = (VB_HEIGHT - barH) / 2;
          const x = i * step;
          const played = i / bars.length <= displayProgress;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={Math.max(0.6, barWidth * 0.7)}
              height={barH}
              fill={played ? playedColor : remainingColor}
            />
          );
        })}

        {/* Hover cursor */}
        {hoverPct !== null && onScrub && dragFrac === null && (
          <line
            x1={hoverPct * 10}
            x2={hoverPct * 10}
            y1={0}
            y2={VB_HEIGHT}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={2}
          />
        )}

        {/* Playhead */}
        <line
          x1={cursorPct * 10}
          x2={cursorPct * 10}
          y1={0}
          y2={VB_HEIGHT}
          stroke={dragFrac !== null ? '#ffd76a' : '#ffffff'}
          strokeWidth={dragFrac !== null ? 3 : 2}
        />
      </svg>
    </div>
  );
}

/**
 * Map the peaks array to exactly BAR_TOTAL sample values in [0..1].
 * When peaks are missing, draw a plausible build→peak→tail silhouette
 * with a bit of pseudo-random jitter so it doesn't look mechanical.
 */
function sampleBars(peaks: WaveformPeaks | undefined, n: number): number[] {
  if (!peaks || peaks.values.length === 0) {
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const x = i / Math.max(1, n - 1);
      const envelope = 0.35 + 0.55 * Math.sin(x * Math.PI);
      const jitter = 0.12 * ((Math.sin(i * 12.9898) * 43758.5453) % 1);
      out[i] = clamp01(envelope + jitter);
    }
    return out;
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor((i / n) * peaks.values.length);
    out[i] = clamp01(peaks.values[idx] ?? 0);
  }
  return out;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
