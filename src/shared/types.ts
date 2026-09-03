export type Camelot = `${number}${'A' | 'B'}`;

export type NoteRoot =
  | 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F'
  | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export type Scale = 'major' | 'minor';

export type AnalysisQuality = 'good' | 'partial' | 'unreliable';

export interface BeatGrid {
  firstBeatTime: number;
  bpm: number;
  bpmConfidence: number;
  beats: number[];
  downbeats: number[];
  isStable: boolean;
}

export interface KeyInfo {
  root: NoteRoot;
  scale: Scale;
  camelot: Camelot;
  confidence: number;
}

export interface EnergyProfile {
  mean: number;
  peak: number;
  perBar: number[];
  rmsDb: number;
  replayGainDb?: number;
}

export interface LoudnessInfo {
  integratedLufs: number;   // ITU-R BS.1770-4, in LUFS
  suggestedGainDb: number;  // dB to apply to reach targetLufs
  targetLufs: number;       // reference target used for suggestion
}

export type CueType = 'intro' | 'outro' | 'drop' | 'break' | 'phrase';

export interface AutoCue {
  timeSec: number;
  type: CueType;
  score: number; // 0..1, higher = more significant
  label?: string;
}

export interface CuePoints {
  introStart: number;
  introEnd: number;
  outroStart: number;
  outroEnd: number;
  mixInPoint: number;
  mixOutPoint: number;
}

export interface WaveformPeaks {
  /** One value per bin in [0, 1]. Length is typically 512. */
  values: number[];
}

/**
 * Serato Overview GEOB payload as base64. 3842 bytes = 2-byte header + 240
 * timesteps × 16 frequency bands (byte per band). Stored so the tag writer
 * can embed it without re-decoding the audio.
 */
export type SeratoOverviewB64 = string;

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Track {
  id: string;
  filePath: string;
  fileHash: string;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  addedAt: number;
  /** Small (~200×200) JPEG data-URL extracted from the file's cover art. */
  coverArtDataUrl?: string;
}

export interface TrackAnalysis {
  trackId: string;
  analyzerVersion: string;
  analyzedAt: number;
  quality: AnalysisQuality;
  beatGrid: BeatGrid;
  key: KeyInfo;
  energy: EnergyProfile;
  cues: CuePoints;
  waveform?: WaveformPeaks;
  loudness?: LoudnessInfo;
  autoCues?: AutoCue[];
  /** Per-bar energy 0..1, for the coloured strip under the waveform. */
  sectionEnergy?: Array<{ startSec: number; endSec: number; energy: number }>;
  /** Serato Overview GEOB bytes as base64 — ready to embed at tag-write time. */
  seratoOverviewB64?: SeratoOverviewB64;
  /** Which service provided this analysis (default: our local DSP). */
  source?: 'local' | 'spotify';
  /** Spotify track URI (e.g. "spotify:track:xxx") if enriched from Spotify. */
  spotifyTrackId?: string;
  /** Extra Spotify audio features not covered by our other fields. */
  spotifyFeatures?: SpotifyFeatures;
}

export interface SpotifyFeatures {
  danceability: number;
  valence: number;
  acousticness: number;
  instrumentalness: number;
  speechiness: number;
  liveness: number;
  timeSignature: number;
}

export interface AnalyzedTrack extends Track {
  analysis?: TrackAnalysis;
}

export interface SessionState {
  history: string[];
  targetEnergy: number;
  elapsedSeconds: number;
  weights: ScoringWeights;
}

export interface ScoringWeights {
  bpm: number;
  key: number;
  energy: number;
  variety: number;
  quality: number;
  recency: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  bpm: 0.35,
  key: 0.20,
  energy: 0.20,
  variety: 0.10,
  quality: 0.10,
  recency: 0.50,
};

export interface ScoreBreakdown {
  bpm: number;
  key: number;
  energy: number;
  variety: number;
  quality: number;
  recency: number;
}

export interface SelectionResult {
  track: AnalyzedTrack;
  score: number;
  parts: ScoreBreakdown;
  mode: 'normal' | 'relaxed-bpm' | 'forced';
  reasoning: string;
}

export type TransitionType = 'crossfade' | 'bassSwap' | 'filterFade' | 'echoOut';

export interface TransitionPlan {
  type: TransitionType;
  deckAMixOutPoint: number;
  deckBStartOffsetInBuffer: number;
  startAtCtxTime: number;
  durationSec: number;
  beatsCount: number;
  stretchRatioB: number;
  fadeCurve: 'linear' | 'equalPower';
  safetyLevel: 'full' | 'safe' | 'degraded';
  reasoning: string;
}

export type ImportProgressEvent =
  | { kind: 'scan-start'; dir: string }
  | { kind: 'scan-found'; count: number }
  | { kind: 'track-added'; track: Track }
  | { kind: 'done'; added: number; skipped: number };

export const ANALYZER_VERSION = '0.1.0';
