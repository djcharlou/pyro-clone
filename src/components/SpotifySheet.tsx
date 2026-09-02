import { useState } from 'react';
import type { SpotifyAuthState } from '@/spotify/oauth';
import { beginLogin, clearAuth } from '@/spotify/oauth';
import type { PlayerBridge } from '@/spotify/player';

interface Props {
  open: boolean;
  onClose(): void;
  auth: SpotifyAuthState | null;
  onDisconnect(): void;
  onEnrichAll(): void;
  onEnrichSelected(): void;
  enrichmentStatus: string;
  enrichmentBusy: boolean;
  tracksTotal: number;
  tracksWithoutSpotify: number;
  // Playback
  playbackBridge: PlayerBridge | null;
  onEnablePlayback(): void;
  onPlayUri(uri: string): void;
}

const CLIENT_ID_KEY = 'pyro.spotify.clientId';

/**
 * Accept either a spotify: URI or an https://open.spotify.com/track/... URL,
 * normalize to `spotify:track:<id>`. Returns null on anything unrecognized.
 */
function normalizeUri(input: string): string | null {
  if (!input) return null;
  if (input.startsWith('spotify:track:')) return input;
  const m = input.match(/open\.spotify\.com\/(?:intl-\w+\/)?track\/([a-zA-Z0-9]+)/);
  if (m) return `spotify:track:${m[1]}`;
  const bare = input.match(/^[a-zA-Z0-9]{22}$/);
  if (bare) return `spotify:track:${input}`;
  return null;
}

export function SpotifySheet({
  open,
  onClose,
  auth,
  onDisconnect,
  onEnrichAll,
  onEnrichSelected,
  enrichmentStatus,
  enrichmentBusy,
  tracksTotal,
  tracksWithoutSpotify,
  playbackBridge,
  onEnablePlayback,
  onPlayUri,
}: Props): JSX.Element | null {
  const [clientId, setClientId] = useState(
    () => localStorage.getItem(CLIENT_ID_KEY) ?? ''
  );
  const [uriInput, setUriInput] = useState('');

  if (!open) return null;

  function connect(): void {
    const id = clientId.trim();
    if (!id) return;
    localStorage.setItem(CLIENT_ID_KEY, id);
    void beginLogin(id);
  }

  function disconnect(): void {
    clearAuth();
    onDisconnect();
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>Spotify</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="spotify-body">
          {auth ? (
            <>
              <div className="spotify-status">
                <div className="spotify-connected-dot" />
                <div className="spotify-status-text">
                  <div className="spotify-status-primary">
                    Connected as {auth.user?.displayName ?? auth.user?.id ?? 'unknown'}
                  </div>
                  <div className="spotify-status-secondary">
                    {auth.user?.productTier === 'premium'
                      ? '✓ Premium — Web Playback available (coming soon)'
                      : 'Free tier — enrichment works, streaming does not'}
                  </div>
                </div>
              </div>

              <h3 className="spotify-section-head">Enrich local library</h3>
              <p className="spotify-blurb">
                Match each of your tracks against Spotify's catalog by title +
                artist, then pull precise BPM, key and energy from their
                pre-computed audio-features. Overwrites our local analysis
                for the fields Spotify is more accurate on.
              </p>
              <div className="spotify-stats">
                <span>{tracksTotal} tracks in library</span>
                <span>{tracksWithoutSpotify} not yet enriched</span>
              </div>
              <div className="spotify-actions">
                <button
                  className="sheet-import-btn"
                  onClick={onEnrichAll}
                  disabled={enrichmentBusy || tracksWithoutSpotify === 0}
                >
                  {enrichmentBusy
                    ? 'Enriching…'
                    : `Enrich all (${tracksWithoutSpotify})`}
                </button>
                <button
                  className="sheet-import-btn sheet-import-btn--ghost"
                  onClick={onEnrichSelected}
                  disabled={enrichmentBusy}
                  title="Only enrich the tracks currently selected in Workshop"
                >
                  Enrich Workshop selection
                </button>
              </div>
              {enrichmentStatus && (
                <div className="spotify-status-line">{enrichmentStatus}</div>
              )}

              <h3 className="spotify-section-head">Web Playback</h3>
              {auth.user?.productTier !== 'premium' ? (
                <p className="spotify-blurb">
                  Web Playback needs Spotify <strong>Premium</strong>. You can still use enrichment above on a free account.
                </p>
              ) : !playbackBridge ? (
                <>
                  <p className="spotify-blurb">
                    Register this app as a Spotify Connect device — after that
                    you can play any Spotify track from here (or send tracks
                    to pyro-clone from your phone/desktop).
                    <br />
                    <em>No real crossfade with local decks — Spotify audio is DRM-encrypted.</em>
                  </p>
                  <button className="sheet-import-btn" onClick={onEnablePlayback}>
                    Enable playback
                  </button>
                </>
              ) : (
                <>
                  <div className="spotify-status-line">
                    {playbackBridge.error
                      ? `⚠ ${playbackBridge.error}`
                      : playbackBridge.ready
                        ? `✓ Ready — device "pyro-clone" (${playbackBridge.deviceId?.slice(0, 8)}…)`
                        : 'Connecting…'}
                  </div>
                  {playbackBridge.state?.track_window.current_track && (
                    <div className="spotify-status" style={{ marginTop: 8 }}>
                      {playbackBridge.state.track_window.current_track.album.images[0] && (
                        <img
                          src={playbackBridge.state.track_window.current_track.album.images[0].url}
                          alt=""
                          style={{ width: 40, height: 40, borderRadius: 6 }}
                        />
                      )}
                      <div className="spotify-status-text">
                        <div className="spotify-status-primary">
                          {playbackBridge.state.track_window.current_track.name}
                        </div>
                        <div className="spotify-status-secondary">
                          {playbackBridge.state.track_window.current_track.artists.map((a) => a.name).join(', ')}
                          {' · '}
                          {playbackBridge.state.paused ? 'Paused' : 'Playing'}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="sheet-save-row" style={{ marginTop: 12 }}>
                    <input
                      type="text"
                      className="sheet-filter"
                      placeholder="spotify:track:… or open URL"
                      value={uriInput}
                      onChange={(e) => setUriInput(e.target.value)}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const uri = normalizeUri(uriInput.trim());
                          if (uri) onPlayUri(uri);
                        }
                      }}
                    />
                    <button
                      className="sheet-import-btn"
                      onClick={() => {
                        const uri = normalizeUri(uriInput.trim());
                        if (uri) onPlayUri(uri);
                      }}
                      disabled={!uriInput.trim() || !playbackBridge.ready}
                    >
                      Play
                    </button>
                  </div>
                </>
              )}

              <div className="spotify-danger">
                <button className="spotify-disconnect" onClick={disconnect}>
                  Disconnect Spotify
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="spotify-blurb">
                You need a Spotify Developer Client ID (free, ~2 min to set
                up). We use PKCE so no client secret is required — nothing
                sensitive is stored anywhere but on this device.
              </p>
              <ol className="spotify-steps">
                <li>
                  Go to <code>developer.spotify.com/dashboard</code>, log in with
                  your Spotify account.
                </li>
                <li>
                  Click <strong>Create app</strong>. Any name + description.
                </li>
                <li>
                  Under <strong>Redirect URIs</strong>, add
                  {' '}<code>{typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''}</code>
                  {' '}exactly.
                </li>
                <li>
                  Copy the <strong>Client ID</strong> from the app's settings and paste it here.
                </li>
              </ol>
              <input
                type="text"
                className="sheet-filter"
                placeholder="Spotify Client ID"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                className="sheet-commit-btn"
                onClick={connect}
                disabled={!clientId.trim()}
                style={{ marginTop: 12 }}
              >
                Connect Spotify
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
