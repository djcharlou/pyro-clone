import type { Camelot } from '@shared/types';
import { parseCamelot } from '@shared/camelot';

/**
 * Camelot key badge, coloured by position on the wheel.
 *
 * The colour is the point: harmonically compatible keys sit next to each
 * other on the wheel, so neighbouring hues means a safe blend and opposite
 * hues means a clash. That is readable at a glance across a whole library in
 * a way the text alone is not.
 */
export function KeyBadge({
  camelot,
  size = 'md',
  dim = false,
}: {
  camelot?: Camelot | null;
  size?: 'sm' | 'md';
  dim?: boolean;
}): JSX.Element {
  if (!camelot) {
    return <span className={`keybadge keybadge--${size} keybadge--empty`}>—</span>;
  }
  const [num, letter] = parseCamelot(camelot);
  // Twelve hues around the wheel; the minor (A) ring sits slightly darker so
  // the two rings stay distinguishable at the same number.
  const hue = ((num - 1) / 12) * 360;
  const light = letter === 'A' ? 62 : 72;
  const bg = `hsl(${hue}, 70%, ${dim ? light - 22 : light}%)`;
  return (
    <span
      className={`keybadge keybadge--${size}`}
      style={{ background: bg, color: '#10131a' }}
      title={`Camelot ${camelot}`}
    >
      {camelot}
    </span>
  );
}
