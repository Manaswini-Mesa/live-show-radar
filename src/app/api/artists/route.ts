import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession, jsonError } from '@/lib/auth';
import { db, audit } from '@/lib/db';
import { nameKey } from '@/lib/core';


const ArtistInput = z.object({
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  priority: z.boolean().default(false),
  official_tour_url: z.string().url().startsWith('https://').max(500).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const deny = requireSession(req); if (deny) return deny;
  const rows = await db()`select a.*, coalesce(array_agg(al.alias order by al.alias) filter (where al.alias is not null), '{}') as aliases,
    (select count(*) from radar.event_artists ea where ea.artist_id = a.id)::int as event_count
    from radar.artists a left join radar.artist_aliases al on al.artist_id = a.id group by a.id order by a.priority desc, a.name`;
  return NextResponse.json({ artists: rows });
}

export async function POST(req: NextRequest) {
  const deny = requireSession(req); if (deny) return deny;
  const p = ArtistInput.safeParse(await req.json().catch(() => null));
  if (!p.success) return jsonError(400, 'Invalid artist: ' + p.error.issues.map(i => i.path.join('.') + ' ' + i.message).join(', '));
  const { name, aliases, priority, official_tour_url } = p.data;
  const key = nameKey(name);
  if (!key) return jsonError(400, 'Artist name must contain letters or numbers');
  const sql = db();
  const [dup] = await sql`select a.name from radar.artists a where a.name_key = ${key}
    union select a.name from radar.artist_aliases al join radar.artists a on a.id = al.artist_id where al.alias_key = ${key} limit 1`;
  if (dup) return jsonError(409, `"${name}" is already on the watchlist (as ${dup.name})`);
  const artist = await sql.begin(async tx => {
    const [a] = await tx`insert into radar.artists (name, name_key, priority, official_tour_url) values (${name}, ${key}, ${priority}, ${official_tour_url ?? null}) returning *`;
    for (const al of new Set(aliases.map(x => x.trim()))) {
      const k = nameKey(al); if (k && k !== key) await tx`insert into radar.artist_aliases (artist_id, alias, alias_key) values (${a.id}, ${al}, ${k}) on conflict do nothing`;
    }
    return a;
  });
  await audit('artist_added', { name });
  return NextResponse.json({ artist }, { status: 201 });
}
