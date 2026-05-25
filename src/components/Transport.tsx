interface Props {
  onPlayPause(): void;
  onPickNext(): void;
  onCrossfade(): void;
}

export function Transport({ onPlayPause, onPickNext, onCrossfade }: Props): JSX.Element {
  return (
    <div className="transport">
      <button className="btn btn-primary" onClick={onPlayPause}>▶ / ❚❚ Play / Pause</button>
      <button className="btn" onClick={onPickNext}>↻ Auto-pick next</button>
      <button className="btn" onClick={onCrossfade}>⇄ Crossfade now (8s)</button>
    </div>
  );
}
