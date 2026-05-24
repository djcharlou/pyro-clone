import Database from 'better-sqlite3';
import { app } from 'electron';
import { mkdirSync } from 'fs';
import { join } from 'path';
import type {
  Track,
  TrackAnalysis,
  AnalyzedTrack,
} from '@shared/types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  file_hash TEXT NOT NULL,
  title TEXT,
  artist TEXT,
  album TEXT,
  genre TEXT,
  duration_sec REAL NOT NULL,
  sample_rate INTEGER NOT NULL,
  channels INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analyses (
  track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  analyzer_version TEXT NOT NULL,
  analyzed_at INTEGER NOT NULL,
  quality TEXT NOT NULL,
  bpm REAL NOT NULL,
  bpm_confidence REAL NOT NULL,
  first_beat REAL NOT NULL,
  beat_stable INTEGER NOT NULL,
  beats_json TEXT NOT NULL,
  downbeats_json TEXT NOT NULL,
  key_root TEXT NOT NULL,
  key_scale TEXT NOT NULL,
  key_camelot TEXT NOT NULL,
  key_confidence REAL NOT NULL,
  energy_mean REAL NOT NULL,
  energy_peak REAL NOT NULL,
  energy_per_bar_json TEXT NOT NULL,
  energy_rms_db REAL NOT NULL,
  replay_gain_db REAL,
  cue_intro_start REAL NOT NULL,
  cue_intro_end REAL NOT NULL,
  cue_outro_start REAL NOT NULL,
  cue_outro_end REAL NOT NULL,
  cue_mix_in REAL NOT NULL,
  cue_mix_out REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analyses_bpm ON analyses(bpm);
CREATE INDEX IF NOT EXISTS idx_analyses_camelot ON analyses(key_camelot);
`;

export class LibraryStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? this.defaultPath();
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  private defaultPath(): string {
    const dir = join(app.getPath('userData'), 'pyro-clone');
    mkdirSync(dir, { recursive: true });
    return join(dir, 'library.sqlite');
  }

  close(): void {
    this.db.close();
  }

  upsertTrack(t: Track): void {
    this.db
      .prepare(
        `INSERT INTO tracks
           (id, file_path, file_hash, title, artist, album, genre,
            duration_sec, sample_rate, channels, added_at)
         VALUES (@id, @filePath, @fileHash, @title, @artist, @album, @genre,
                 @durationSec, @sampleRate, @channels, @addedAt)
         ON CONFLICT(id) DO UPDATE SET
           file_path=excluded.file_path,
           file_hash=excluded.file_hash,
           title=excluded.title,
           artist=excluded.artist,
           album=excluded.album,
           genre=excluded.genre,
           duration_sec=excluded.duration_sec,
           sample_rate=excluded.sample_rate,
           channels=excluded.channels`
      )
      .run(t);
  }

  hasTrackByPath(filePath: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM tracks WHERE file_path = ?')
      .get(filePath);
    return !!row;
  }

  getTrack(id: string): Track | undefined {
    const row = this.db
      .prepare('SELECT * FROM tracks WHERE id = ?')
      .get(id) as TrackRow | undefined;
    return row ? rowToTrack(row) : undefined;
  }

  listTracks(): AnalyzedTrack[] {
    const rows = this.db
      .prepare(
        `SELECT t.*,
                a.analyzer_version, a.analyzed_at, a.quality,
                a.bpm, a.bpm_confidence, a.first_beat, a.beat_stable,
                a.beats_json, a.downbeats_json,
                a.key_root, a.key_scale, a.key_camelot, a.key_confidence,
                a.energy_mean, a.energy_peak, a.energy_per_bar_json, a.energy_rms_db,
                a.replay_gain_db,
                a.cue_intro_start, a.cue_intro_end,
                a.cue_outro_start, a.cue_outro_end,
                a.cue_mix_in, a.cue_mix_out
         FROM tracks t LEFT JOIN analyses a ON a.track_id = t.id
         ORDER BY t.added_at DESC`
      )
      .all() as JoinedRow[];

    return rows.map(rowToAnalyzedTrack);
  }

  saveAnalysis(a: TrackAnalysis): void {
    this.db
      .prepare(
        `INSERT INTO analyses
           (track_id, analyzer_version, analyzed_at, quality,
            bpm, bpm_confidence, first_beat, beat_stable,
            beats_json, downbeats_json,
            key_root, key_scale, key_camelot, key_confidence,
            energy_mean, energy_peak, energy_per_bar_json, energy_rms_db,
            replay_gain_db,
            cue_intro_start, cue_intro_end,
            cue_outro_start, cue_outro_end,
            cue_mix_in, cue_mix_out)
         VALUES (@trackId, @analyzerVersion, @analyzedAt, @quality,
                 @bpm, @bpmConfidence, @firstBeat, @beatStable,
                 @beatsJson, @downbeatsJson,
                 @keyRoot, @keyScale, @keyCamelot, @keyConfidence,
                 @energyMean, @energyPeak, @energyPerBarJson, @energyRmsDb,
                 @replayGainDb,
                 @cueIntroStart, @cueIntroEnd,
                 @cueOutroStart, @cueOutroEnd,
                 @cueMixIn, @cueMixOut)
         ON CONFLICT(track_id) DO UPDATE SET
           analyzer_version=excluded.analyzer_version,
           analyzed_at=excluded.analyzed_at,
           quality=excluded.quality,
           bpm=excluded.bpm,
           bpm_confidence=excluded.bpm_confidence,
           first_beat=excluded.first_beat,
           beat_stable=excluded.beat_stable,
           beats_json=excluded.beats_json,
           downbeats_json=excluded.downbeats_json,
           key_root=excluded.key_root,
           key_scale=excluded.key_scale,
           key_camelot=excluded.key_camelot,
           key_confidence=excluded.key_confidence,
           energy_mean=excluded.energy_mean,
           energy_peak=excluded.energy_peak,
           energy_per_bar_json=excluded.energy_per_bar_json,
           energy_rms_db=excluded.energy_rms_db,
           replay_gain_db=excluded.replay_gain_db,
           cue_intro_start=excluded.cue_intro_start,
           cue_intro_end=excluded.cue_intro_end,
           cue_outro_start=excluded.cue_outro_start,
           cue_outro_end=excluded.cue_outro_end,
           cue_mix_in=excluded.cue_mix_in,
           cue_mix_out=excluded.cue_mix_out`
      )
      .run({
        trackId: a.trackId,
        analyzerVersion: a.analyzerVersion,
        analyzedAt: a.analyzedAt,
        quality: a.quality,
        bpm: a.beatGrid.bpm,
        bpmConfidence: a.beatGrid.bpmConfidence,
        firstBeat: a.beatGrid.firstBeatTime,
        beatStable: a.beatGrid.isStable ? 1 : 0,
        beatsJson: JSON.stringify(a.beatGrid.beats),
        downbeatsJson: JSON.stringify(a.beatGrid.downbeats),
        keyRoot: a.key.root,
        keyScale: a.key.scale,
        keyCamelot: a.key.camelot,
        keyConfidence: a.key.confidence,
        energyMean: a.energy.mean,
        energyPeak: a.energy.peak,
        energyPerBarJson: JSON.stringify(a.energy.perBar),
        energyRmsDb: a.energy.rmsDb,
        replayGainDb: a.energy.replayGainDb ?? null,
        cueIntroStart: a.cues.introStart,
        cueIntroEnd: a.cues.introEnd,
        cueOutroStart: a.cues.outroStart,
        cueOutroEnd: a.cues.outroEnd,
        cueMixIn: a.cues.mixInPoint,
        cueMixOut: a.cues.mixOutPoint,
      });
  }
}

interface TrackRow {
  id: string;
  file_path: string;
  file_hash: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  duration_sec: number;
  sample_rate: number;
  channels: number;
  added_at: number;
}

interface JoinedRow extends TrackRow {
  analyzer_version: string | null;
  analyzed_at: number | null;
  quality: string | null;
  bpm: number | null;
  bpm_confidence: number | null;
  first_beat: number | null;
  beat_stable: number | null;
  beats_json: string | null;
  downbeats_json: string | null;
  key_root: string | null;
  key_scale: string | null;
  key_camelot: string | null;
  key_confidence: number | null;
  energy_mean: number | null;
  energy_peak: number | null;
  energy_per_bar_json: string | null;
  energy_rms_db: number | null;
  replay_gain_db: number | null;
  cue_intro_start: number | null;
  cue_intro_end: number | null;
  cue_outro_start: number | null;
  cue_outro_end: number | null;
  cue_mix_in: number | null;
  cue_mix_out: number | null;
}

function rowToTrack(r: TrackRow): Track {
  return {
    id: r.id,
    filePath: r.file_path,
    fileHash: r.file_hash,
    title: r.title ?? '',
    artist: r.artist ?? '',
    album: r.album ?? undefined,
    genre: r.genre ?? undefined,
    durationSec: r.duration_sec,
    sampleRate: r.sample_rate,
    channels: r.channels,
    addedAt: r.added_at,
  };
}

function rowToAnalyzedTrack(r: JoinedRow): AnalyzedTrack {
  const base = rowToTrack(r);
  if (r.analyzer_version === null) return base;
  const analysis: TrackAnalysis = {
    trackId: r.id,
    analyzerVersion: r.analyzer_version,
    analyzedAt: r.analyzed_at!,
    quality: r.quality as TrackAnalysis['quality'],
    beatGrid: {
      bpm: r.bpm!,
      bpmConfidence: r.bpm_confidence!,
      firstBeatTime: r.first_beat!,
      isStable: !!r.beat_stable,
      beats: JSON.parse(r.beats_json!) as number[],
      downbeats: JSON.parse(r.downbeats_json!) as number[],
    },
    key: {
      root: r.key_root as TrackAnalysis['key']['root'],
      scale: r.key_scale as TrackAnalysis['key']['scale'],
      camelot: r.key_camelot as TrackAnalysis['key']['camelot'],
      confidence: r.key_confidence!,
    },
    energy: {
      mean: r.energy_mean!,
      peak: r.energy_peak!,
      perBar: JSON.parse(r.energy_per_bar_json!) as number[],
      rmsDb: r.energy_rms_db!,
      replayGainDb: r.replay_gain_db ?? undefined,
    },
    cues: {
      introStart: r.cue_intro_start!,
      introEnd: r.cue_intro_end!,
      outroStart: r.cue_outro_start!,
      outroEnd: r.cue_outro_end!,
      mixInPoint: r.cue_mix_in!,
      mixOutPoint: r.cue_mix_out!,
    },
  };
  return { ...base, analysis };
}
