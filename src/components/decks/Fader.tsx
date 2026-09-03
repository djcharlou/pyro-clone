import { useCallback, useRef, useState } from 'react';

interface Props {
  value: number;
  min: number;
  max: number;
  orientation?: 'vertical' | 'horizontal';
  /** Snap-back target on double-click. */
  center?: number;
  length?: number;
  label?: string;
  format?: (v: number) => string;
  /** Draw a tick at the centre — used by the crossfader and pitch fader. */
  centerDetent?: boolean;
  onChange(value: number): void;
}

/**
 * Linear fader. Used for channel level (vertical), the crossfader
 * (horizontal) and pitch (vertical, centre-detented).
 */
export function Fader({
  value,
  min,
  max,
  orientation = 'vertical',
  center,
  length = 130,
  label,
  format,
  centerDetent = false,
  onChange,
}: Props): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const range = max - min;
  const norm = Math.max(0, Math.min(1, (value - min) / range));
  const vertical = orientation === 'vertical';

  const valueFromEvent = useCallback(
    (clientX: number, clientY: number): number => {
      const el = trackRef.current;
      if (!el) return value;
      const r = el.getBoundingClientRect();
      // Vertical faders run bottom-to-top, so the axis is inverted.
      const t = vertical
        ? 1 - (clientY - r.top) / r.height
        : (clientX - r.left) / r.width;
      const raw = min + Math.max(0, Math.min(1, t)) * range;
      // Soft detent: within 3% of centre, snap to it. Makes "back to zero"
      // reachable without pixel-hunting.
      if (centerDetent && center !== undefined) {
        if (Math.abs(raw - center) < range * 0.03) return center;
      }
      return raw;
    },
    [vertical, min, range, value, centerDetent, center]
  );

  const onMove = useCallback(
    (e: PointerEvent) => onChange(valueFromEvent(e.clientX, e.clientY)),
    [onChange, valueFromEvent]
  );

  const endDrag = useCallback(() => {
    setDragging(false);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onMove]);

  return (
    <div className={`fader fader--${orientation}`}>
      {label && <div className="fader-label">{label}</div>}
      <div
        ref={trackRef}
        className={`fader-track ${dragging ? 'fader-track--active' : ''}`}
        style={vertical ? { height: length } : { width: length }}
        role="slider"
        aria-label={label ?? 'fader'}
        aria-valuenow={Number(value.toFixed(2))}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging(true);
          onChange(valueFromEvent(e.clientX, e.clientY));
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', endDrag);
        }}
        onDoubleClick={() => center !== undefined && onChange(center)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? range / 100 : range / 20;
          const up = vertical ? 'ArrowUp' : 'ArrowRight';
          const down = vertical ? 'ArrowDown' : 'ArrowLeft';
          if (e.key === up) { e.preventDefault(); onChange(Math.min(max, value + step)); }
          if (e.key === down) { e.preventDefault(); onChange(Math.max(min, value - step)); }
        }}
      >
        {centerDetent && <div className="fader-detent" />}
        <div
          className="fader-cap"
          style={vertical ? { bottom: `${norm * 100}%` } : { left: `${norm * 100}%` }}
        />
      </div>
      {format && <div className="fader-value">{format(value)}</div>}
    </div>
  );
}
