import { useEffect, useRef, useState } from 'react';
import type { WaveformPeaks } from '@shared/types';

interface Props {
  peaks: WaveformPeaks | undefined;
  progress: number; // 0..1
  height?: number;
  barWidth?: number;
  barGap?: number;
  /** Color before the playhead */
  playedColor?: string;
  /** Color after the playhead */
  remainingColor?: string;
  /**
   * Called with a 0..1 fraction ONCE, when the user releases the pointer.
   * During the drag the playhead line moves smoothly but no audio seek
   * fires, so playback keeps going uninterrupted until commit.
   */
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

  const displayProgress = dragFrac ?? progress;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const p = Math.max(0, Math.min(1, displayProgress));

    if (!peaks || peaks.values.length === 0) {
      const mid = h / 2;
      const barH = h * 0.6;
      ctx.fillStyle = remainingColor;
      ctx.fillRect(0, mid - barH / 2, w, barH);
      ctx.fillStyle = playedColor;
      ctx.fillRect(0, mid - barH / 2, w * p, barH);
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

    // Playhead line (thicker + a scrub highlight when dragging)
    const px = Math.round(w * p);
    if (dragFrac !== null) {
      // Amber highlight while scrubbing so it's obvious this isn't the
      // real playback position yet.
      ctx.fillStyle = '#ffd76a';
      ctx.fillRect(px - 2, 0, 4, h);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px - 1, 0, 2, h);
    }

    // Hover indicator (only when NOT dragging — dragFrac takes over)
    if (dragFrac === null && hoverFrac !== null && onScrub) {
      const hx = Math.round(w * hoverFrac);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(hx - 1, 0, 2, h);
    }
  }, [
    peaks,
    displayProgress,
    barWidth,
    barGap,
    playedColor,
    remainingColor,
    hoverFrac,
    onScrub,
    dragFrac,
  ]);

  function fractionFromEvent(e: { clientX: number }): number {
    const el = wrapRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
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
          // Commit only once, at release — no audio interruption during drag.
          onScrub(finalFrac);
        }
      }}
      onPointerCancel={() => {
        // Aborted drag — don't seek, just clear scrub state.
        draggingRef.current = false;
        setDragFrac(null);
      }}
      onPointerLeave={() => {
        setHoverFrac(null);
      }}
    >
      <canvas
        ref={canvasRef}
        className="waveform"
        style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
      />
    </div>
  );
}
