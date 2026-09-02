import { useState } from 'react';
import type { AnalyzedTrack } from '@shared/types';

interface Props {
  selection: AnalyzedTrack[];
  onApply(patch: { genre?: string; artist?: string; album?: string; year?: number }): void;
  onWriteToFiles(): void;
  onClear(): void;
  writing: boolean;
  writeMode: 'in-place' | 'download' | null;
}

export function BulkEditPanel({
  selection,
  onApply,
  onWriteToFiles,
  onClear,
  writing,
  writeMode,
}: Props): JSX.Element | null {
  const [genre, setGenre] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [year, setYear] = useState('');

  if (selection.length === 0) return null;

  function apply(): void {
    const patch: {
      genre?: string;
      artist?: string;
      album?: string;
      year?: number;
    } = {};
    if (genre.trim()) patch.genre = genre.trim();
    if (artist.trim()) patch.artist = artist.trim();
    if (album.trim()) patch.album = album.trim();
    if (year.trim()) {
      const y = parseInt(year, 10);
      if (!Number.isNaN(y)) patch.year = y;
    }
    if (Object.keys(patch).length === 0) return;
    onApply(patch);
    setGenre(''); setArtist(''); setAlbum(''); setYear('');
  }

  return (
    <div className="bulk-panel">
      <div className="bulk-head">
        <span className="bulk-count">{selection.length} tracks selected</span>
        <button className="bulk-clear" onClick={onClear}>Clear selection</button>
      </div>
      <div className="bulk-fields">
        <input
          type="text"
          placeholder="Set genre"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
        />
        <input
          type="text"
          placeholder="Set artist"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
        />
        <input
          type="text"
          placeholder="Set album"
          value={album}
          onChange={(e) => setAlbum(e.target.value)}
        />
        <input
          type="number"
          placeholder="Year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
      </div>
      <div className="bulk-actions">
        <button
          className="bulk-btn bulk-btn--primary"
          onClick={apply}
          disabled={!genre && !artist && !album && !year}
        >
          Apply to {selection.length}
        </button>
        <button
          className="bulk-btn"
          onClick={onWriteToFiles}
          disabled={writing || selection.length === 0}
          title="Write current tags to the source mp3 files"
        >
          {writing ? 'Writing…' : `💾 Write tags to files`}
        </button>
        {writeMode && (
          <span className="bulk-mode-note">
            {writeMode === 'in-place'
              ? 'Wrote directly to disk (Chromium desktop).'
              : 'Downloaded new files (browser can\'t write in place — Firefox/Safari/iOS).'}
          </span>
        )}
      </div>
    </div>
  );
}
