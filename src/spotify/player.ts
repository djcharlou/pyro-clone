/**
 * Spotify Web Playback SDK integration.
 *
 * Loads Spotify's own player script, registers pyro-clone as a Spotify
 * Connect device, and exposes a tiny wrapper around play / pause / seek.
 *
 * Requires Spotify Premium (Free accounts can connect but cannot stream
 * — the SDK reports { name: 'PlaybackError' } when they try).
 *
 * The audio is DRM-encrypted — we cannot read samples or mix it with our
 * Web Audio engine. This is a "hand off between local decks and Spotify"
 * flow, not a real crossfade.
 *
 * https://developer.spotify.com/documentation/web-playback-sdk
 */

import { getAccessToken, loadAuth } from './oauth';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const DEVICE_NAME = 'pyro-clone';

// The SDK is loaded on window as `window.Spotify.Player` (a constructor).
// We describe just enough of it to type-check our calls.
declare global {
  interface Window {
    Spotify?: {
      Player: SpotifyPlayerConstructor;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

interface SpotifyPlayerConstructor {
  new (opts: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }): SpotifyPlayerInstance;
}

interface SpotifyPlayerInstance {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: 'ready', cb: (e: { device_id: string }) => void): void;
  addListener(event: 'not_ready', cb: (e: { device_id: string }) => void): void;
  addListener(event: 'player_state_changed', cb: (state: SpotifyPlayerState | null) => void): void;
  addListener(
    event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
    cb: (e: { message: string }) => void
  ): void;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getCurrentState(): Promise<SpotifyPlayerState | null>;
}

export interface SpotifyPlayerState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: {
    current_track: {
      id: string | null;
      uri: string;
      name: string;
      artists: Array<{ name: string; uri: string }>;
      album: { name: string; images: Array<{ url: string }> };
      duration_ms: number;
    };
  };
}

export interface PlayerBridge {
  ready: boolean;
  deviceId: string | null;
  state: SpotifyPlayerState | null;
  error: string | null;
}

let cachedInstance: SpotifyPlayerInstance | null = null;
let cachedDeviceId: string | null = null;
let sdkLoadPromise: Promise<void> | null = null;

/**
 * Load the Spotify SDK script (idempotent), then return a Player instance
 * connected to the user's account. The instance stays alive across calls.
 */
export async function initPlayer(
  onStateChange: (bridge: PlayerBridge) => void
): Promise<SpotifyPlayerInstance> {
  const auth = loadAuth();
  if (!auth) throw new Error('Not connected to Spotify');

  if (cachedInstance) return cachedInstance;

  await ensureSdkLoaded();
  if (!window.Spotify?.Player) {
    throw new Error('Spotify SDK failed to expose window.Spotify.Player');
  }

  const player = new window.Spotify.Player({
    name: DEVICE_NAME,
    volume: 0.85,
    getOAuthToken: (cb) => {
      void getAccessToken().then(cb).catch((err) => {
        console.error('[spotify player] token fetch failed', err);
      });
    },
  });

  player.addListener('ready', ({ device_id }) => {
    cachedDeviceId = device_id;
    onStateChange({ ready: true, deviceId: device_id, state: null, error: null });
  });
  player.addListener('not_ready', ({ device_id }) => {
    onStateChange({ ready: false, deviceId: device_id, state: null, error: 'Device offline' });
  });
  player.addListener('player_state_changed', (state) => {
    onStateChange({
      ready: true,
      deviceId: cachedDeviceId,
      state,
      error: null,
    });
  });
  player.addListener('initialization_error', ({ message }) => {
    onStateChange({ ready: false, deviceId: null, state: null, error: `Init: ${message}` });
  });
  player.addListener('authentication_error', ({ message }) => {
    onStateChange({ ready: false, deviceId: null, state: null, error: `Auth: ${message}` });
  });
  player.addListener('account_error', ({ message }) => {
    onStateChange({
      ready: false,
      deviceId: null,
      state: null,
      error: `Account: ${message} (Premium required)`,
    });
  });
  player.addListener('playback_error', ({ message }) => {
    onStateChange({ ready: true, deviceId: cachedDeviceId, state: null, error: `Playback: ${message}` });
  });

  const ok = await player.connect();
  if (!ok) throw new Error('Player.connect() returned false');

  cachedInstance = player;
  return player;
}

export function currentDeviceId(): string | null {
  return cachedDeviceId;
}

export function disconnectPlayer(): void {
  if (cachedInstance) {
    cachedInstance.disconnect();
    cachedInstance = null;
    cachedDeviceId = null;
  }
}

/**
 * Play one or more Spotify track URIs on our device. Automatically
 * transfers playback to us first so we don't step on the user's other
 * device (phone/computer). Only works when the SDK reported 'ready'.
 */
export async function playSpotifyUris(uris: string[]): Promise<void> {
  if (!cachedDeviceId) throw new Error('Player not ready');
  const token = await getAccessToken();

  // Transfer playback to our device but do not start (we'll start with
  // the specific URIs below — this avoids the "already-playing-elsewhere"
  // race that skips our uris payload).
  await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ device_ids: [cachedDeviceId], play: false }),
  });

  const res = await fetch(
    `https://api.spotify.com/v1/me/player/play?device_id=${cachedDeviceId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris }),
    }
  );
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`Spotify play failed: ${res.status} ${text}`);
  }
}

function ensureSdkLoaded(): Promise<void> {
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    if (window.Spotify?.Player) {
      resolve();
      return;
    }
    // The SDK calls this hook when ready.
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error(`Failed to load ${SDK_URL}`));
    document.head.appendChild(script);
    // 20 s safety net
    setTimeout(() => reject(new Error('Spotify SDK load timeout')), 20_000);
  });
  return sdkLoadPromise;
}
