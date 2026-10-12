import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession, jsonError } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const deny = requireSession(req); if (deny) return deny;
  const id = z.string().uuid().safeParse((await ctx.params).id); if (!id.success) return jsonError(400, 'Invalid id');
  const sql = db();
  const [event] = await sql`select * from radar.events where id = ${id.data}`;
  if (!event) return jsonError(404, 'Event not found');
  const [evidence, changes, offers, alerts, [calendar]] = await Promise.all([
    sql`select id, source_id, source_url, excerpt, published_at, first_seen_at, last_seen_at from radar.event_evidence where event_id = ${id.data} order by first_seen_at`,
    sql`select * from radar.event_changes where event_id = ${id.data} order by detected_at desc`,
    sql`select * from radar.ticket_offers where event_id = ${id.data} order by observed_at desc`,
    sql`select id, kind, status, attempts, last_error, created_at, delivered_at from radar.alerts where event_id = ${id.data} order by created_at desc`,
    sql`select * from radar.calendar_links where event_id = ${id.data}`,
  ]);
  const artists = await sql`select a.id, a.name, ea.match_reason from radar.event_artists ea join radar.artists a on a.id = ea.artist_id where ea.event_id = ${id.data}`;
  return NextResponse.json({ event, artists, evidence, changes, offers, alerts, calendar: calendar ?? null });
}
