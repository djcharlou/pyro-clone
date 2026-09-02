/**
 * Spotify OAuth 2.0 with PKCE (Authorization Code Flow with Proof Key for
 * Code Exchange). This is the browser-safe flow — no client secret needed.
 *
 * Flow:
 *   1. Generate a random 43-128 char `code_verifier`, base64-URL-encode
 *      its SHA-256 hash as `code_challenge`.
 *   2. Redirect user to Spotify with `code_challenge`, they authorize.
 *   3. Spotify redirects back with a `code` parameter.
 *   4. Exchange `code` + original `code_verifier` for access/refresh tokens.
 *   5. Refresh access token when it expires (typ. 1 hour).
 *
 * The Client ID is user-supplied — the user creates a Spotify developer app
 * at https://developer.spotify.com/dashboard and pastes the ID once.
 * No secrets ever hit our code or a server.
 *
 * https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
 */

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'streaming', // required for Web Playback SDK
];

const STORAGE_KEY = 'pyro.spotify.auth';

export interface SpotifyAuthState {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms epoch
  scope: string;
  user?: {
    id: string;
    displayName: string | null;
    productTier?: 'free' | 'premium';
  };
}

interface AuthPending {
  clientId: string;
  codeVerifier: string;
  redirectUri: string;
}

const PENDING_KEY = 'pyro.spotify.pending';

export function loadAuth(): SpotifyAuthState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SpotifyAuthState;
  } catch {
    return null;
  }
}

export function saveAuth(state: SpotifyAuthState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PENDING_KEY);
}

/** Kick off the auth flow — redirects the whole tab to Spotify. */
export async function beginLogin(clientId: string): Promise<void> {
  const codeVerifier = randomCodeVerifier();
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const redirectUri = buildRedirectUri();
  const state = crypto.randomUUID();

  const pending: AuthPending = { clientId, codeVerifier, redirectUri };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state,
  });

  window.location.href = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

/**
 * If the current URL is the OAuth callback (has ?code=), exchange it for
 * tokens and return the auth state. Otherwise returns null.
 * Removes ?code and ?state from the URL either way.
 */
export async function completeLoginIfCallback(): Promise<SpotifyAuthState | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return null;

  // Always strip the query so a reload doesn't retry
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, '', cleanUrl);

  if (error) {
    console.warn('[spotify] auth error', error);
    sessionStorage.removeItem(PENDING_KEY);
    throw new Error(`Spotify auth failed: ${error}`);
  }

  const rawPending = sessionStorage.getItem(PENDING_KEY);
  if (!rawPending) {
    throw new Error('Spotify auth callback with no pending state');
  }
  sessionStorage.removeItem(PENDING_KEY);
  const pending = JSON.parse(rawPending) as AuthPending;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: pending.redirectUri,
    client_id: pending.clientId,
    code_verifier: pending.codeVerifier,
  });
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Spotify token exchange failed: ${res.status}`);
  const tok = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  const state: SpotifyAuthState = {
    clientId: pending.clientId,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
    scope: tok.scope,
  };

  // Fetch user profile (for display + Premium detection)
  try {
    const me = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${state.accessToken}` },
    });
    if (me.ok) {
      const u = (await me.json()) as {
        id: string;
        display_name: string | null;
        product?: string;
      };
      state.user = {
        id: u.id,
        displayName: u.display_name,
        productTier: u.product === 'premium' ? 'premium' : 'free',
      };
    }
  } catch (err) {
    console.warn('[spotify] failed to fetch profile', err);
  }

  saveAuth(state);
  return state;
}

/**
 * Return a valid access token — refreshing the stored one if it's expired.
 * Throws if we have no auth state.
 */
export async function getAccessToken(): Promise<string> {
  let state = loadAuth();
  if (!state) throw new Error('Not connected to Spotify');
  // Refresh 30s before expiry
  if (Date.now() > state.expiresAt - 30_000) {
    state = await refreshAccessToken(state);
  }
  return state.accessToken;
}

async function refreshAccessToken(state: SpotifyAuthState): Promise<SpotifyAuthState> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: state.refreshToken,
    client_id: state.clientId,
  });
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    clearAuth();
    throw new Error('Spotify session expired — please reconnect');
  }
  const tok = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  const next: SpotifyAuthState = {
    ...state,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? state.refreshToken,
    expiresAt: Date.now() + tok.expires_in * 1000,
    scope: tok.scope ?? state.scope,
  };
  saveAuth(next);
  return next;
}

/** The redirect URI depends on where we're running. */
function buildRedirectUri(): string {
  return window.location.origin + window.location.pathname;
}

function randomCodeVerifier(len = 96): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, len);
}

async function sha256Base64Url(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
