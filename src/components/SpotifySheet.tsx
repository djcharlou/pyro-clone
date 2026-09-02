import { useState } from 'react';
import type { SpotifyAuthState } from '@/spotify/oauth';
import { beginLogin, clearAuth } from '@/spotify/oauth';

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
}

const CLIENT_ID_KEY = 'pyro.spotify.clientId';

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
}: Props): JSX.Element | null {
  const [clientId, setClientId] = useState(
    () => localStorage.getItem(CLIENT_ID_KEY) ?? ''
  );

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
