import { useEffect, useRef } from 'react';

interface Props {
  /** Playback position in seconds — drives the rotation. */
  positionSec: number;
  playing: boolean;
  size?: number;
  /** Accent colour for the platter marker. */
  accent?: string;
  /**
   * Called while the wheel is dragged, with a rate delta:
   * positive nudges forward, negative pulls back.
   */
  onNudge?(ratioDelta: number): void;
  /** Called on a click that was not a drag — used to cue/play. */
  onTap?(): void;
}

/** Revolutions per minute of the drawn platter. 1⅓ RPS reads as "turntable". */
const RPM = 80;

/**
 * CDJ-style jog wheel.
 *
 * The platter rotates in step with the playhead, so it doubles as a
 * fine-grained position readout: a drifting beat is visible as the marker
 * creeping away from where you expect it. Dragging it nudges the tempo the
 * way pushing a real platter does.
 */
export function JogWheel({
  positionSec,
  playing,
  size = 150,
  accent = '#ffffff',
  onNudge,
  onTap,
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ lastAngle: number; moved: boolean } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== size * dpr) canvas.width = size * dpr;
    if (canvas.height !== size * dpr) canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const c = size / 2;
    const rOuter = c - 2;
    const rInner = rOuter * 0.55;

    // Platter body
    const body = ctx.createRadialGradient(c, c, rInner * 0.4, c, c, rOuter);
    body.addColorStop(0, 'rgba(255,255,255,0.14)');
    body.addColorStop(0.7, 'rgba(255,255,255,0.05)');
    body.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.beginPath();
    ctx.arc(c, c, rOuter, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Rotation follows the playhead, so it stops dead when playback stops.
    const angle = (positionSec * (RPM / 60)) * Math.PI * 2;

    // Spokes give the rotation something to read against.
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(angle);
    for (let i = 0; i < 6; i++) {
      ctx.rotate((Math.PI * 2) / 6);
      ctx.beginPath();
      ctx.moveTo(rInner + 3, 0);
      ctx.lineTo(rOuter - 4, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Position marker
    ctx.beginPath();
    ctx.moveTo(rInner, 0);
    ctx.lineTo(rOuter - 3, 0);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // Centre hub
    ctx.beginPath();
    ctx.arc(c, c, rInner, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Play state in the hub
    ctx.fillStyle = playing ? accent : 'rgba(255,255,255,0.3)';
    if (playing) {
      ctx.beginPath();
      ctx.moveTo(c - 5, c - 8);
      ctx.lineTo(c + 8, c);
      ctx.lineTo(c - 5, c + 8);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(c - 7, c - 8, 5, 16);
      ctx.fillRect(c + 2, c - 8, 5, 16);
    }
  }, [positionSec, playing, size, accent]);

  function angleAt(e: { clientX: number; clientY: number }): number {
    const el = canvasRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  }

  return (
    <canvas
      ref={canvasRef}
      className="jog-wheel"
      style={{ width: size, height: size, touchAction: 'none' }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
        drag.current = { lastAngle: angleAt(e), moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !onNudge) return;
        const a = angleAt(e);
        let delta = a - d.lastAngle;
        // Normalise across the ±π seam so a wrap doesn't read as a huge jump.
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        if (Math.abs(delta) > 0.01) d.moved = true;
        d.lastAngle = a;
        // Scale angular velocity into a modest rate offset.
        onNudge(Math.max(-0.35, Math.min(0.35, delta * 1.6)));
      }}
      onPointerUp={(e) => {
        try { (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
        const wasTap = drag.current && !drag.current.moved;
        drag.current = null;
        if (wasTap) onTap?.();
      }}
      onPointerCancel={() => { drag.current = null; }}
    />
  );
}
