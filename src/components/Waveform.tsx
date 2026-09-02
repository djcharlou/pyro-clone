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
  /** Called with a 0..1 fraction while the user drags/clicks the wave. */
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
  const [dragging, setDragging] = useState(false);

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

    const p = Math.max(0, Math.min(1, progress));

    if (!peaks || peaks.values.length === 0) {
      // Fallback: a full-height progress bar so the user still sees
      // the playhead when analysis hasn't produced peaks yet.
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

    // Playhead line
    const px = Math.round(w * p);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px - 1, 0, 2, h);

    // Hover indicator
    if (hoverFrac !== null && onScrub) {
      const hx = Math.round(w * hoverFrac);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(hx - 1, 0, 2, h);
    }
  }, [peaks, progress, barWidth, barGap, playedColor, remainingColor, hoverFrac, onScrub]);

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
      style={{ width: '100%', height, cursor: onScrub ? 'ew-resize' : 'default' }}
      onPointerDown={(e) => {
        if (!onScrub) return;
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        setDragging(true);
        onScrub(fractionFromEvent(e));
      }}
      onPointerMove={(e) => {
        if (!onScrub) return;
        const f = fractionFromEvent(e);
        setHoverFrac(f);
        if (dragging) onScrub(f);
      }}
      onPointerUp={(e) => {
        if (!onScrub) return;
        try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
        setDragging(false);
      }}
      onPointerLeave={() => {
        setHoverFrac(null);
        setDragging(false);
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
