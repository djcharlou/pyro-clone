import { useCallback, useRef, useState } from 'react';

interface Props {
  label: string;
  /** Current value, in the same unit as min/max. */
  value: number;
  min: number;
  max: number;
  /** Value the knob snaps back to on double-click. */
  center?: number;
  size?: number;
  /** Formats the readout under the knob. */
  format?: (v: number) => string;
  onChange(value: number): void;
}

/**
 * Rotary control, dragged vertically like every piece of DJ/studio software.
 *
 * Vertical drag rather than circular: circular tracking feels precise in
 * principle but is fiddly with a trackpad, and no hardware-style UI actually
 * uses it. Double-click returns to centre, which is how you undo an EQ tweak
 * mid-mix.
 */
export function Knob({
  label,
  value,
  min,
  max,
  center,
  size = 46,
  format,
  onChange,
}: Props): JSX.Element {
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const range = max - min;
  const norm = Math.max(0, Math.min(1, (value - min) / range));
  // Leave a gap at the bottom so the sweep reads as a dial, not a full circle.
  const ANGLE_RANGE = 270;
  const angle = -135 + norm * ANGLE_RANGE;

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // Full range over ~160px of travel; Shift for fine control.
      const sensitivity = e.shiftKey ? 480 : 160;
      const delta = ((d.startY - e.clientY) / sensitivity) * range;
      onChange(Math.max(min, Math.min(max, d.startValue + delta)));
    },
    [min, max, range, onChange]
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', endDrag);
  }, [handlePointerMove]);

  return (
    <div className="knob" style={{ width: size }}>
      <div
        className={`knob-dial ${dragging ? 'knob-dial--active' : ''}`}
        style={{ width: size, height: size }}
        role="slider"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          dragRef.current = { startY: e.clientY, startValue: value };
          setDragging(true);
          window.addEventListener('pointermove', handlePointerMove);
          window.addEventListener('pointerup', endDrag);
        }}
        onDoubleClick={() => onChange(center ?? (min + max) / 2)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? range / 100 : range / 20;
          if (e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(max, value + step)); }
          if (e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(min, value - step)); }
        }}
        title={`${label} — drag to adjust, double-click to reset`}
      >
        <div className="knob-indicator" style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <div className="knob-label">{label}</div>
      <div className="knob-value">{format ? format(value) : Math.round(value)}</div>
    </div>
  );
}
