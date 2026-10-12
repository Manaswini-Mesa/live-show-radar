import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { checkState, jsonError, makeState, requireSession } from '@/lib/auth';
import { db, audit } from '@/lib/db';
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
      return back('Spotify connected. Open Artists → Import from Spotify.');
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
  const body = z.object({ ids: z.array(z.string().regex(/^[A-Za-z0-9]{10,40}$/)).max(2000) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'Select artists to import');
  const [sync] = await sql`insert into radar.spotify_syncs (status) values ('running') returning id`;
  try {
    const followed = await spotifyFollowedArtists();
    const chosen = followed.filter(a => body.data.ids.includes(a.id));
    let added = 0;
    for (const a of chosen) {
      const r = await sql`insert into radar.artists (name, name_key, origin, spotify_id, spotify_url, image_url) values (${a.name}, ${nameKey(a.name)}, 'spotify', ${a.id}, ${a.url}, ${a.image})
        on conflict (name_key) do update set spotify_id = coalesce(radar.artists.spotify_id, excluded.spotify_id), spotify_url = excluded.spotify_url, image_url = coalesce(radar.artists.image_url, excluded.image_url), following = true, updated_at = now()
        returning (xmax = 0) as inserted`;
      if (r[0]?.inserted) added++;
    }
    // Spotify artists no longer followed are flagged, never deleted.
    await sql`update radar.artists set following = false where origin = 'spotify' and spotify_id is not null and not (spotify_id = any(${followed.map(a => a.id)}))`;
    await sql`update radar.spotify_syncs set status = 'success', finished_at = now(), fetched = ${followed.length}, added = ${added} where id = ${sync.id}`;
    return NextResponse.json({ ok: true, fetched: followed.length, added });
  } catch (e) {
    await sql`update radar.spotify_syncs set status = 'failed', finished_at = now(), error = ${(e as Error).message} where id = ${sync.id}`;
    return jsonError(502, (e as Error).message);
  }
}
