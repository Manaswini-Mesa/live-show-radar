import { NextResponse, type NextRequest } from 'next/server';
import { checkState, jsonError, makeState, requireSession } from '@/lib/auth';
import { db, audit } from '@/lib/db';
import { syncSpotify } from '@/lib/spotifySync';
import { env } from '@/lib/env';
import { nameKey } from '@/lib/core';
import { exchangeCode, saveTokens, spotifyFollowedArtists, SPOTIFY_SCOPES } from '@/lib/oauth';

export const maxDuration = 60;

const back = (msg: string) => NextResponse.redirect(`${env.appUrl()}/?view=settings&notice=${encodeURIComponent(msg)}`);

// /api/spotify/login | callback | preview (GET) ; /api/spotify/import | disconnect (POST)
export async function GET(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const deny = requireSession(req);
  if (action === 'login') {
    if (deny) return NextResponse.redirect(`${env.appUrl()}/`);
    if (!env.spotifyId() || !env.spotifySecret()) return back('Spotify is not configured: add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET');
    const u = new URL('https://accounts.spotify.com/authorize');
    u.search = new URLSearchParams({ response_type: 'code', client_id: env.spotifyId(), scope: SPOTIFY_SCOPES, redirect_uri: env.spotifyRedirect(), state: makeState('spotify'), show_dialog: 'true' }).toString();
    return NextResponse.redirect(u.toString());
  }
  if (action === 'callback') {
    if (deny) return NextResponse.redirect(`${env.appUrl()}/`);
    const sp = req.nextUrl.searchParams;
    if (!checkState('spotify', sp.get('state'))) return back('Spotify sign-in failed: invalid or expired state');
    if (sp.get('error')) return back(`Spotify sign-in cancelled: ${sp.get('error')}`);
    try {
      const t = await exchangeCode('spotify', sp.get('code') ?? '');
      const me = await fetch('https://api.spotify.com/v1/me', { headers: { authorization: `Bearer ${t.access_token}` } }).then(r => r.ok ? r.json() : null).catch(() => null);
      await saveTokens('spotify', t, me?.display_name ?? me?.id ?? 'Spotify account');
      await audit('spotify_connected');
      // Import followed artists straight into My Artists - no manual approval step.
      const r = await syncSpotify().catch(e => ({ error: (e as Error).message }));
      return back('error' in r ? `Spotify connected, but the first sync failed: ${r.error}` : `Spotify connected - ${r.fetched} followed artists are now in My Artists.`);
    } catch (e) { return back((e as Error).message); }
  }
  if (deny) return deny;
  if (action === 'preview') {
    try {
      const followed = await spotifyFollowedArtists();
      const existing = new Set((await db()`select name_key from radar.artists union select alias_key from radar.artist_aliases`).map(r => r.name_key));
      return NextResponse.json({ artists: followed.map(a => ({ ...a, alreadyWatched: existing.has(nameKey(a.name)) })) });
    } catch (e) { return jsonError(502, (e as Error).message); }
  }
  return jsonError(404, 'Unknown action');
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const deny = requireSession(req); if (deny) return deny;
  const { action } = await ctx.params;
  const sql = db();
  if (action === 'disconnect') {
    await sql`delete from radar.oauth_connections where provider = 'spotify'`; // manual + imported artists are kept
    return NextResponse.json({ ok: true });
  }
  if (action !== 'import') return jsonError(404, 'Unknown action');
  try { return NextResponse.json({ ok: true, ...(await syncSpotify()) }); }
  catch (e) { return jsonError(502, (e as Error).message); }
}
