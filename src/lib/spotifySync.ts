import 'server-only';
import { db } from './db';
import { nameKey } from './core';
import { getConnection, spotifyFollowedArtists } from './oauth';

/**
 * Pull every artist the connected Spotify account follows into the watchlist as a favourite
 * ("My Artists"). Runs on connect and automatically every few hours - no manual approval.
 * Unfollowed Spotify artists stay on the full list but leave My Artists. Nothing is deleted.
 */
export async function syncSpotify() {
  const sql = db();
  const [sync] = await sql`insert into radar.spotify_syncs (status) values ('running') returning id`;
  try {
    const followed = await spotifyFollowedArtists();
    let added = 0;
    for (const a of followed) {
      const [r] = await sql`insert into radar.artists (name, name_key, origin, spotify_id, spotify_url, image_url, priority)
        values (${a.name}, ${nameKey(a.name)}, 'spotify', ${a.id}, ${a.url}, ${a.image}, true)
        on conflict (name_key) do update set spotify_id = coalesce(radar.artists.spotify_id, excluded.spotify_id), spotify_url = excluded.spotify_url,
          image_url = coalesce(radar.artists.image_url, excluded.image_url), following = true, priority = true, updated_at = now()
        returning (xmax = 0) as inserted`;
      if (r?.inserted) added++;
    }
    const ids = followed.map(a => a.id);
    await sql`update radar.artists set following = false, priority = false, updated_at = now()
      where spotify_id is not null and following and not (spotify_id = any(${ids}))`;
    await sql`update radar.spotify_syncs set status = 'success', finished_at = now(), fetched = ${followed.length}, added = ${added} where id = ${sync.id}`;
    return { fetched: followed.length, added };
  } catch (e) {
    await sql`update radar.spotify_syncs set status = 'failed', finished_at = now(), error = ${(e as Error).message} where id = ${sync.id}`;
    throw e;
  }
}

/** Called from each monitoring run: re-sync when connected and the last good sync is older than 6 hours. */
export async function syncSpotifyIfDue(): Promise<string | null> {
  const conn = await getConnection('spotify');
  if (!conn?.access_token) return null;
  const [last] = await db()`select finished_at from radar.spotify_syncs where status = 'success' order by finished_at desc limit 1`;
  if (last && Date.now() - new Date(last.finished_at).getTime() < 6 * 3600_000) return null;
  try { const r = await syncSpotify(); return `Spotify sync: ${r.fetched} followed, ${r.added} new`; }
  catch (e) { return `Spotify sync failed: ${(e as Error).message}`; }
}
