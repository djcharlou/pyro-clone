import { useMemo, useState } from 'react';
import type { AnalyzedTrack, Camelot } from '@shared/types';
import { KeyBadge } from './KeyBadge';
import { parseCamelot } from '@shared/camelot';

interface Props {
  tracks: AnalyzedTrack[];
  analysedCount: number;
  onLoadTo(side: 'A' | 'B', trackId: string): void;
}

type SortKey = 'artist' | 'title' | 'key' | 'tempo' | 'energy' | 'cues';

/**
 * Library browser sized for digging mid-set.
 *
 * The filters are the point: with a few thousand tracks, "what is in a
 * compatible key, near this tempo, at this energy" is the only question worth
 * asking, and answering it by scrolling is hopeless.
 */
export function LibraryBrowser({ tracks, analysedCount, onLoadTo }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [keyFilter, setKeyFilter] = useState<string>('');
  const [tempoFilter, setTempoFilter] = useState<string>('');
  const [energyFilter, setEnergyFilter] = useState<string>('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'artist', dir: 1 });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = tracks.filter((t) => {
      if (q && !(`${t.artist} ${t.title} ${t.album ?? ''}`.toLowerCase().includes(q))) return false;
      const a = t.analysis;
      if (keyFilter) {
        if (!a) return false;
        if (keyFilter === 'compatible') return true; // handled below, needs a reference
        if (a.key.camelot !== keyFilter) return false;
      }
      if (tempoFilter && a) {
        const [lo, hi] = tempoFilter.split('-').map(Number);
        if (a.beatGrid.bpm < lo || a.beatGrid.bpm > hi) return false;
      } else if (tempoFilter && !a) return false;
      if (energyFilter && a) {
        const e = Math.round(a.energy.mean * 10);
        if (String(e) !== energyFilter) return false;
      } else if (energyFilter && !a) return false;
      return true;
    });

    const val = (t: AnalyzedTrack): string | number => {
      switch (sort.key) {
        case 'artist': return t.artist.toLowerCase();
        case 'title': return t.title.toLowerCase();
        case 'key': return t.analysis ? camelotOrder(t.analysis.key.camelot) : 999;
        case 'tempo': return t.analysis?.beatGrid.bpm ?? 0;
        case 'energy': return t.analysis?.energy.mean ?? 0;
        case 'cues': return t.analysis?.autoCues?.length ?? 0;
      }
    };
    out = [...out].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return 0;
    });
    return out;
  }, [tracks, query, keyFilter, tempoFilter, energyFilter, sort]);

  const keysPresent = useMemo(() => {
    const set = new Set<string>();
    for (const t of tracks) if (t.analysis) set.add(t.analysis.key.camelot);
    return [...set].sort((a, b) => camelotOrder(a as Camelot) - camelotOrder(b as Camelot));
  }, [tracks]);

  const reset = (): void => {
    setQuery(''); setKeyFilter(''); setTempoFilter(''); setEnergyFilter('');
  };
  const filtering = !!(query || keyFilter || tempoFilter || energyFilter);

  const head = (key: SortKey, label: string, cls = ''): JSX.Element => (
    <th
      className={`${cls} lib2-th ${sort.key === key ? 'lib2-th--on' : ''}`}
      onClick={() => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }))}
    >
      {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <section className="lib2">
      <div className="lib2-bar">
        <span className="lib2-count">
          All Music <em>({rows.length}{filtering ? ` of ${tracks.length}` : ''})</em>
        </span>

        <input
          className="lib2-search"
          placeholder="Search artist, title, album…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <select className="lib2-select" value={keyFilter} onChange={(e) => setKeyFilter(e.target.value)}>
          <option value="">Key</option>
          {keysPresent.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>

        <select className="lib2-select" value={tempoFilter} onChange={(e) => setTempoFilter(e.target.value)}>
          <option value="">Tempo</option>
          <option value="60-99">60–99</option>
          <option value="100-119">100–119</option>
          <option value="120-129">120–129</option>
          <option value="130-139">130–139</option>
          <option value="140-200">140+</option>
        </select>

        <select className="lib2-select" value={energyFilter} onChange={(e) => setEnergyFilter(e.target.value)}>
          <option value="">Energy</option>
          {[1,2,3,4,5,6,7,8,9,10].map((n) => <option key={n} value={String(n)}>{n}</option>)}
        </select>

        {filtering && <button className="lib2-reset" onClick={reset}>Reset</button>}
        <span className="lib2-analysed">{analysedCount} analysed</span>
      </div>

      <div className="lib2-scroll">
        <table className="lib2-table">
          <thead>
            <tr>
              <th className="lib2-cover" />
              {head('artist', 'Artist')}
              {head('title', 'Title')}
              {head('key', 'Key', 'lib2-c')}
              {head('tempo', 'Tempo', 'lib2-c')}
              {head('energy', 'Energy', 'lib2-c')}
              {head('cues', 'Cues', 'lib2-c')}
              <th className="lib2-c">Load</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="lib2-empty">
                {tracks.length === 0 ? 'No tracks imported yet.' : 'Nothing matches those filters.'}
              </td></tr>
            )}
            {rows.slice(0, 400).map((t) => (
              <tr key={t.id}>
                <td className="lib2-cover">
                  {t.coverArtDataUrl
                    ? <img src={t.coverArtDataUrl} alt="" loading="lazy" />
                    : <span className="lib2-cover-none">♪</span>}
                </td>
                <td className="lib2-ellipsis">{t.artist}</td>
                <td className="lib2-ellipsis">{t.title}</td>
                <td className="lib2-c"><KeyBadge camelot={t.analysis?.key.camelot} size="sm" /></td>
                <td className="lib2-c lib2-num">{t.analysis ? t.analysis.beatGrid.bpm.toFixed(0) : '—'}</td>
                <td className="lib2-c lib2-num">{t.analysis ? Math.round(t.analysis.energy.mean * 10) : '—'}</td>
                <td className="lib2-c lib2-num">{t.analysis?.autoCues?.length ?? '—'}</td>
                <td className="lib2-c lib2-load">
                  <button onClick={() => onLoadTo('A', t.id)} title="Load onto deck A">A</button>
                  <button onClick={() => onLoadTo('B', t.id)} title="Load onto deck B">B</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 400 && (
          <div className="lib2-more">Showing the first 400 of {rows.length} — narrow the filters to see the rest.</div>
        )}
      </div>
    </section>
  );
}

/** Wheel order so sorting by key groups harmonically-adjacent tracks. */
function camelotOrder(c: Camelot): number {
  const [num, letter] = parseCamelot(c);
  return num * 2 + (letter === 'A' ? 0 : 1);
}
