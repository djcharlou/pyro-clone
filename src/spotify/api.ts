import { getAccessToken } from './oauth';
import type { SpotifyFeatures, NoteRoot, Camelot } from '@shared/types';
import { toCamelot } from '@shared/camelot';

const BASE = 'https://api.spotify.com/v1';

export interface SpotifySearchResult {
  id: string;
  uri: string;
  title: string;
  artists: string[];
  album: string;
  durationSec: number;
  previewUrl: string | null;
  albumImageUrl?: string;
}

interface SearchTracksResponse {
  tracks: {
    items: Array<{
      id: string;
      uri: string;
      name: string;
      duration_ms: number;
      preview_url: string | null;
      artists: Array<{ name: string }>;
      album: {
        name: string;
        images: Array<{ url: string; width: number; height: number }>;
      };
    }>;
  };
}

interface AudioFeaturesResponse {
  tempo: number;
  key: number; // 0..11 or -1
  mode: number; // 0=minor, 1=major
  time_signature: number;
  energy: number;
  danceability: number;
  valence: number;
  acousticness: number;
  instrumentalness: number;
  speechiness: number;
  liveness: number;
  loudness: number; // in dB
}

interface MultipleAudioFeaturesResponse {
  audio_features: Array<AudioFeaturesResponse & { id: string } | null>;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '1', 10);
      await sleep(retryAfter * 1000);
      return api<T>(path, init);
    }
    throw new Error(`Spotify API ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Search Spotify for a track, returning the top 5 candidates. */
export async function searchTracks(query: string, limit = 5): Promise<SpotifySearchResult[]> {
  const q = encodeURIComponent(query);
  const res = await api<SearchTracksResponse>(`/search?q=${q}&type=track&limit=${limit}`);
  return res.tracks.items.map((t) => ({
    id: t.id,
    uri: t.uri,
    title: t.name,
    artists: t.artists.map((a) => a.name),
    album: t.album.name,
    durationSec: t.duration_ms / 1000,
    previewUrl: t.preview_url,
    albumImageUrl: t.album.images[0]?.url,
  }));
}

/** Get audio features for one track. */
export async function getAudioFeatures(trackId: string): Promise<AudioFeaturesResponse> {
  return api<AudioFeaturesResponse>(`/audio-features/${trackId}`);
}

/** Get audio features for up to 100 tracks in a single request. */
export async function getAudioFeaturesBatch(
  trackIds: string[]
): Promise<Array<AudioFeaturesResponse | null>> {
  if (trackIds.length === 0) return [];
  const results: Array<AudioFeaturesResponse | null> = [];
  for (let i = 0; i < trackIds.length; i += 100) {
    const chunk = trackIds.slice(i, i + 100);
    const res = await api<MultipleAudioFeaturesResponse>(
      `/audio-features?ids=${chunk.join(',')}`
    );
    results.push(...res.audio_features);
  }
  return results;
}

const KEY_ROOTS: NoteRoot[] = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

/**
 * Convert Spotify audio features (integer key + mode) into the tuple our
 * scoring engine expects, and extract the extra features we persist.
 */
export function featuresToOurFormat(f: AudioFeaturesResponse): {
  bpm: number;
  key: NoteRoot;
  scale: 'major' | 'minor';
  camelot: Camelot;
  energy: number;
  loudnessDb: number;
  extras: SpotifyFeatures;
} {
  const keyIdx = f.key >= 0 && f.key <= 11 ? f.key : 0;
  const root = KEY_ROOTS[keyIdx];
  const scale = f.mode === 1 ? 'major' : 'minor';
  return {
    bpm: f.tempo,
    key: root,
    scale,
    camelot: toCamelot(root, scale),
    energy: f.energy,
    loudnessDb: f.loudness,
    extras: {
      danceability: f.danceability,
      valence: f.valence,
      acousticness: f.acousticness,
      instrumentalness: f.instrumentalness,
      speechiness: f.speechiness,
      liveness: f.liveness,
      timeSignature: f.time_signature,
    },
  };
}
