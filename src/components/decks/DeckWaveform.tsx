import { useEffect, useRef, useState } from 'react';
import type { AutoCue, WaveformPeaks } from '@shared/types';

interface Props {
  peaks: WaveformPeaks | undefined;
  cues?: AutoCue[];
  sectionEnergy?: Array<{ startSec: number; endSec: number; energy: number }>;
  positionSec: number;
  durationSec: number;
  /** Waveform colour for this deck. */
  color: string;
  height?: number;
  onScrub?(fraction: number): void;
}

/**
 * Full-width deck waveform with cue markers and a per-section energy strip.
 *
 * The waveform alone tells you where the loud parts are; the cue ribbon along
 * the top and the energy numbers along the bottom tell you what the parts
 * *are*, which is what you actually mix on. Zoom follows the playhead so the
 * detail stays where you are working.
 */
export function DeckWaveform({
  peaks,
  cues = [],
  sectionEnergy = [],
  positionSec,
  durationSec,
  color,
  height = 150,
  onScrub,
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [dragFrac, setDragFrac] = useState<number | null>(null);
  const dragging = useRef(false);
  const [size, setSize] = useState({ w: 0, h: height });

  const CUE_BAND = 26;
  const ENERGY_BAND = 22;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  // Visible slice of the track, in 0..1 of its duration. At zoom 1 the whole
  // track is shown; deeper zooms centre on the playhead.
  const progress =
    durationSec > 0 && Number.isFinite(positionSec)
      ? Math.max(0, Math.min(1, positionSec / durationSec))
      : 0;
  const span = 1 / zoom;
  let viewStart = progress - span / 2;
  viewStart = Math.max(0, Math.min(1 - span, viewStart));
  const viewEnd = viewStart + span;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = size.w;
    const h = size.h;
    if (canvas.width !== w * dpr) canvas.width = w * dpr;
    if (canvas.height !== h * dpr) canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const waveTop = CUE_BAND;
    const waveH = h - CUE_BAND - ENERGY_BAND;
    const waveMid = waveTop + waveH / 2;
    const xOf = (frac: number): number => ((frac - viewStart) / span) * w;

    // --- Waveform -------------------------------------------------------
    const values = peaks?.values ?? [];
    const barW = 2;
    const gap = 1;
    const bars = Math.floor(w / (barW + gap));
    for (let i = 0; i < bars; i++) {
      const frac = viewStart + (i / bars) * span;
      const v = values.length
        ? values[Math.min(values.length - 1, Math.floor(frac * values.length))] ?? 0
        : 0.35 + 0.25 * Math.sin(i * 0.35);
      const bh = Math.max(2, v * (waveH - 4));
      const played = frac <= progress;
      ctx.fillStyle = played ? color : 'rgba(255,255,255,0.20)';
      ctx.fillRect(i * (barW + gap), waveMid - bh / 2, barW, bh);
    }

    // Times only mean something once the duration is known; without this the
    // fractions below are Infinity and nothing is drawn.
    const timed = durationSec > 0 && Number.isFinite(durationSec);

    // --- Energy strip ----------------------------------------------------
    const energyTop = h - ENERGY_BAND;
    for (const seg of timed ? sectionEnergy : []) {
      const f0 = seg.startSec / durationSec;
      const f1 = seg.endSec / durationSec;
      if (f1 < viewStart || f0 > viewEnd) continue;
      const x0 = xOf(f0);
      const x1 = xOf(f1);
      // Energy shown as a filled height, so the shape of the arrangement is
      // readable at a glance rather than needing the numbers read one by one.
      const bh = Math.max(2, seg.energy * (ENERGY_BAND - 6));
      ctx.fillStyle = `rgba(255,255,255,${0.12 + seg.energy * 0.35})`;
      ctx.fillRect(x0, energyTop + (ENERGY_BAND - 4) - bh, Math.max(1, x1 - x0 - 1), bh);
    }

    // --- Cue markers -----------------------------------------------------
    ctx.font = '600 10px -apple-system, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const cue of timed ? cues : []) {
      const frac = cue.timeSec / durationSec;
      if (frac < viewStart || frac > viewEnd) continue;
      const x = xOf(frac);
      const tint = cueColor(cue.type);
      ctx.strokeStyle = tint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, CUE_BAND);
      ctx.lineTo(x, h - ENERGY_BAND);
      ctx.stroke();

      const label = cue.label ?? 'Cue';
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = tint;
      ctx.fillRect(x, 3, tw, CUE_BAND - 8);
      ctx.fillStyle = '#0d0f14';
      ctx.fillText(label, x + 5, 3 + (CUE_BAND - 8) / 2);
    }

    // --- Playhead --------------------------------------------------------
    const px = xOf(dragFrac ?? progress);
    ctx.fillStyle = dragFrac !== null ? '#ffd76a' : '#ffe14d';
    ctx.fillRect(px - 1, 0, 2, h);
  }, [
    peaks, cues, sectionEnergy, progress, durationSec, color,
    size.w, size.h, viewStart, viewEnd, span, dragFrac,
  ]);

  function fracFromEvent(e: { clientX: number }): number {
    const el = wrapRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return 0;
    const local = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    return Math.max(0, Math.min(1, viewStart + local * span));
  }

  return (
    <div className="dwave" style={{ height }}>
      <div
        ref={wrapRef}
        className="dwave-canvas-wrap"
        style={{ cursor: onScrub ? 'ew-resize' : 'default', touchAction: 'none' }}
        onPointerDown={(e) => {
          if (!onScrub) return;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          dragging.current = true;
          setDragFrac(fracFromEvent(e));
        }}
        onPointerMove={(e) => {
          if (!onScrub || !dragging.current) return;
          setDragFrac(fracFromEvent(e));
        }}
        onPointerUp={(e) => {
          if (!onScrub) return;
          try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
          if (dragging.current) {
            const f = dragFrac ?? fracFromEvent(e);
            dragging.current = false;
            setDragFrac(null);
            onScrub(f);
          }
        }}
        onPointerCancel={() => { dragging.current = false; setDragFrac(null); }}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <div className="dwave-zoom">
        <button onClick={() => setZoom((z) => Math.max(1, z / 2))} title="Zoom out" aria-label="Zoom out">−</button>
        <button onClick={() => setZoom((z) => Math.min(32, z * 2))} title="Zoom in" aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}

function cueColor(type: AutoCue['type']): string {
  switch (type) {
    case 'intro': return '#8fe3a0';
    case 'drop': return '#ff9d4d';
    case 'break': return '#7fb4ff';
    case 'outro': return '#e08fd0';
    default: return '#d8d8d8';
  }
}
