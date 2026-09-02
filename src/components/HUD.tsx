interface Props {
  analyzingCount: number;
  totalTracks: number;
  analyzedCount: number;
  autoMixOn: boolean;
  autoMixNextInSec: number | null;
  queueLength: number;
}

/**
 * A slim top-of-app strip that surfaces what the engine is doing right now:
 *  - analysis progress
 *  - auto-mix countdown
 * If nothing needs surfacing, renders nothing (no wasted vertical space).
 */
export function HUD({
  analyzingCount,
  totalTracks,
  analyzedCount,
  autoMixOn,
  autoMixNextInSec,
  queueLength,
}: Props): JSX.Element | null {
  const showAnalysis = analyzingCount > 0;
  const showAuto = autoMixOn && autoMixNextInSec !== null;

  if (!showAnalysis && !showAuto) return null;

  return (
    <div className="hud">
      {showAnalysis && (
        <div className="hud-item hud-item--analysis">
          <span className="hud-dot hud-dot--pulse" />
          <span className="hud-label">Analyzing</span>
          <span className="hud-val">
            {analyzedCount} / {totalTracks}
            {analyzingCount > 1 && ` · ${analyzingCount} in flight`}
          </span>
        </div>
      )}
      {showAuto && (
        <div className="hud-item hud-item--auto">
          <span className="hud-dot hud-dot--on" />
          <span className="hud-label">Auto-mix</span>
          <span className="hud-val">
            {autoMixNextInSec! > 0
              ? `next in ${formatSec(autoMixNextInSec!)}`
              : queueLength > 0
                ? 'fading now…'
                : 'waiting for queue'}
          </span>
        </div>
      )}
    </div>
  );
}

function formatSec(sec: number): string {
  if (sec < 60) return `${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.ceil(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
