import { useEffect, useRef, useState } from 'react';
import type { WaveformPeaks } from '@shared/types';

interface Props {
  peaks: WaveformPeaks | undefined;
  progress: number; // 0..1
  height?: number;
  barWidth?: number;
  barGap?: number;
  playedColor?: string;
  remainingColor?: string;
  /** Fires ONCE on pointer release with the final 0..1 fraction. */
  onScrub?: (fraction: number) => void;
}

export function Waveform({
  peaks,
  progress,
  height = 56,
  barWidth = 2,
  barGap = 1,
  playedColor = 'rgba(255,255,255,0.95)',
  remainingColor = 'rgba(255,255,255,0.35)',
  onScrub,
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);
  const [dragFrac, setDragFrac] = useState<number | null>(null);
  const draggingRef = useRef(false);
  // Trigger a redraw whenever the container is resized (layout swaps
  // during deck transitions can leave the canvas at zero width otherwise).
  const [resizeTick, setResizeTick] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setResizeTick((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // NaN-safe display progress (durationSec can briefly be 0 during a swap).
  const rawDisplay = dragFrac ?? progress;
  const displayProgress =
    Number.isFinite(rawDisplay) ? Math.max(0, Math.min(1, rawDisplay)) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = (): boolean => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return false;
      if (canvas.width !== w * dpr) canvas.width = w * dpr;
      if (canvas.height !== h * dpr) canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const p = displayProgress;

      if (!peaks || peaks.values.length === 0) {
        // Synthetic placeholder — plausible wave shape so users see SOMETHING
        // even before analysis has stored peaks for this track.
        const step = barWidth + barGap;
        const bars = Math.floor(w / step);
        const playedBars = Math.floor(bars * p);
        const mid = h / 2;
        for (let i = 0; i < bars; i++) {
          // pseudo-random envelope shaped like a track (build → peak → tail)
          const x = i / Math.max(1, bars - 1);
          const envelope = 0.4 + 0.5 * Math.sin(x * Math.PI);
          const jitter = 0.15 * ((Math.sin(i * 12.9898) * 43758.5453) % 1);
          const v = Math.max(0.08, Math.min(1, envelope + jitter));
          const barH = Math.max(2, v * (h - 4));
          ctx.fillStyle = i <= playedBars ? playedColor : remainingColor;
          ctx.fillRect(i * step, mid - barH / 2, barWidth, barH);
        }
      } else {
        const step = barWidth + barGap;
        const bars = Math.floor(w / step);
        const playedBars = Math.floor(bars * p);
        const mid = h / 2;
        for (let i = 0; i < bars; i++) {
          const idxInPeaks = Math.floor((i / bars) * peaks.values.length);
          const v = peaks.values[idxInPeaks] ?? 0;
          const barH = Math.max(2, v * (h - 2));
          ctx.fillStyle = i <= playedBars ? playedColor : remainingColor;
          ctx.fillRect(i * step, mid - barH / 2, barWidth, barH);
        }
      }

      // Playhead cursor + hover cursor (drawn on top of bars)
      const px = Math.round(w * p);
      if (dragFrac !== null) {
        ctx.fillStyle = '#ffd76a';
        ctx.fillRect(px - 2, 0, 4, h);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(px - 1, 0, 2, h);
      }
      if (dragFrac === null && hoverFrac !== null && onScrub) {
        const hx = Math.round(w * hoverFrac);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(hx - 1, 0, 2, h);
      }
      return true;
    };

    // First try — layout usually settled by useEffect time
    if (!draw()) {
      // Canvas had 0 size — retry on next frame (common in the first paint
      // after a route/deck swap, before layout has run once)
      requestAnimationFrame(() => {
        if (!draw()) requestAnimationFrame(draw);
      });
    }
  }, [
    peaks,
    displayProgress,
    barWidth,
    barGap,
    playedColor,
    remainingColor,
    hoverFrac,
    dragFrac,
    onScrub,
    resizeTick,
    height,
  ]);

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
      <canvas
        ref={canvasRef}
        className="waveform"
        style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
      />
    </div>
  );
}
