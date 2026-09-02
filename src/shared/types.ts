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
