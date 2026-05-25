import { useRef } from 'react';

interface Props {
  supportsDirectory: boolean;
  onPickDirectory(): void;
  onPickFiles(files: FileList | File[]): void;
}

export function ImportControls({
  supportsDirectory,
  onPickDirectory,
  onPickFiles,
}: Props): JSX.Element {
  const dirInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="import-controls">
      {supportsDirectory && (
        <button onClick={onPickDirectory} title="Pick a folder (Chrome/Edge desktop)">
          + Import folder
        </button>
      )}
      <button
        onClick={() => dirInputRef.current?.click()}
        title="Pick a folder (fallback / Firefox / Safari desktop)"
      >
        + Folder
      </button>
      <button
        onClick={() => fileInputRef.current?.click()}
        title="Pick individual audio files"
      >
        + Files
      </button>

      <input
        ref={dirInputRef}
        type="file"
        // @ts-expect-error webkitdirectory not in TS yet
        webkitdirectory=""
        multiple
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) onPickFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) onPickFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
