import 'server-only';
import { db } from './db';
import { env } from './env';

export const SPOTIFY_SCOPES = 'user-follow-read';
// Least privilege: create/edit events only + read the calendar list for selection.
export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly';

type Conn = { provider: string; access_token: string | null; refresh_token: string | null; expires_at: Date | null; selected_calendar_id: string | null; account_label: string | null; scopes: string | null; connected_at: Date };

export async function getConnection(provider: 'spotify' | 'google'): Promise<Conn | null> {
  const [r] = await db()<Conn[]>`select * from radar.oauth_connections where provider = ${provider}`;
  return r ?? null;
}

export async function saveTokens(provider: 'spotify' | 'google', t: { access_token: string; refresh_token?: string; expires_in: number; scope?: string }, label?: string) {
  await db()`insert into radar.oauth_connections (provider, access_token, refresh_token, expires_at, scopes, account_label)
    values (${provider}, ${t.access_token}, ${t.refresh_token ?? null}, now() + make_interval(secs => ${t.expires_in - 60}), ${t.scope ?? null}, ${label ?? null})
    on conflict (provider) do update set access_token = excluded.access_token,
      refresh_token = coalesce(excluded.refresh_token, radar.oauth_connections.refresh_token),
      expires_at = excluded.expires_at, scopes = coalesce(excluded.scopes, radar.oauth_connections.scopes),
      account_label = coalesce(excluded.account_label, radar.oauth_connections.account_label), updated_at = now()`;
}

async function tokenRequest(url: string, body: Record<string, string>, basic?: string) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(basic ? { authorization: `Basic ${basic}` } : {}) }, body: new URLSearchParams(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Token exchange failed: ${j.error_description ?? j.error ?? res.status}`);
  return j as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
}

const spotifyBasic = () => Buffer.from(`${env.spotifyId()}:${env.spotifySecret()}`).toString('base64');
const TOKEN = { spotify: 'https://accounts.spotify.com/api/token', google: 'https://oauth2.googleapis.com/token' };

export async function exchangeCode(provider: 'spotify' | 'google', code: string) {
  return provider === 'spotify'
    ? tokenRequest(TOKEN.spotify, { grant_type: 'authorization_code', code, redirect_uri: env.spotifyRedirect() }, spotifyBasic())
    : tokenRequest(TOKEN.google, { grant_type: 'authorization_code', code, redirect_uri: env.googleRedirect(), client_id: env.googleId(), client_secret: env.googleSecret() });
}

export async function accessToken(provider: 'spotify' | 'google'): Promise<string> {
  const c = await getConnection(provider);
  if (!c?.access_token) throw new Error(`${provider} is not connected`);
  if (c.expires_at && new Date(c.expires_at).getTime() > Date.now()) return c.access_token;
  if (!c.refresh_token) throw new Error(`${provider} token expired; reconnect`);
  const t = provider === 'spotify'
    ? await tokenRequest(TOKEN.spotify, { grant_type: 'refresh_token', refresh_token: c.refresh_token }, spotifyBasic())
    : await tokenRequest(TOKEN.google, { grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: env.googleId(), client_secret: env.googleSecret() });
  await saveTokens(provider, t);
  return t.access_token;
}

export type SpotifyArtist = { id: string; name: string; url: string; image: string | null; genres: string[] };

/** All followed artists, following the cursor-based pagination. */
export async function spotifyFollowedArtists(): Promise<SpotifyArtist[]> {
  const token = await accessToken('spotify');
  const out: SpotifyArtist[] = [];
  let url: string | null = 'https://api.spotify.com/v1/me/following?type=artist&limit=50';
  for (let page = 0; url && page < 40; page++) {
    const res: Response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 429) throw new Error('Spotify rate limit reached; try again shortly');
    if (res.status === 403) throw new Error('Spotify returned 403 - is your account added to the app’s User Management allowlist?');
    if (!res.ok) throw new Error(`Spotify HTTP ${res.status}`);
    const j = await res.json();
    for (const a of j.artists.items) out.push({ id: a.id, name: a.name, url: a.external_urls?.spotify, image: a.images?.[a.images.length - 1]?.url ?? null, genres: a.genres ?? [] });
    url = j.artists.next;
  }
  return out;
}

export async function googleFetch(path: string, init: RequestInit = {}) {
  const token = await accessToken('google');
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Calendar error ${res.status}: ${j.error?.message ?? 'unknown'}`);
  return j;
}
