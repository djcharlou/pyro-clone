import { useEffect, useRef } from 'react';
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
}

export function Waveform({
  peaks,
  progress,
  height = 56,
  barWidth = 2,
  barGap = 1,
  playedColor = 'rgba(255,255,255,0.95)',
  remainingColor = 'rgba(255,255,255,0.35)',
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!peaks || peaks.values.length === 0) {
      ctx.fillStyle = remainingColor;
      ctx.fillRect(0, h / 2 - 1, w, 2);
      return;
    }

    const step = barWidth + barGap;
    const bars = Math.floor(w / step);
    const playedBars = Math.floor(bars * Math.max(0, Math.min(1, progress)));
    const mid = h / 2;
    for (let i = 0; i < bars; i++) {
      const idxInPeaks = Math.floor((i / bars) * peaks.values.length);
      const v = peaks.values[idxInPeaks] ?? 0;
      const barH = Math.max(1, v * (h - 2));
      ctx.fillStyle = i <= playedBars ? playedColor : remainingColor;
      ctx.fillRect(i * step, mid - barH / 2, barWidth, barH);
    }
  }, [peaks, progress, barWidth, barGap, playedColor, remainingColor]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      style={{ width: '100%', height: `${height}px`, display: 'block' }}
    />
  );
}
