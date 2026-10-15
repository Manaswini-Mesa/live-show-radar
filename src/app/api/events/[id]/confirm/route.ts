import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession, jsonError } from '@/lib/auth';
import { db, audit } from '@/lib/db';
import { getConnection, googleFetch } from '@/lib/oauth';

const Body = z.object({ confirmation: z.enum(['booked', 'attending']), explicit: z.literal(true) });

/**
 * Explicit user confirmation → Google Calendar event. This is the ONLY code path that
 * writes to Google Calendar; discovery and alerts never do.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const deny = requireSession(req); if (deny) return deny;
  const id = z.string().uuid().safeParse((await ctx.params).id); if (!id.success) return jsonError(400, 'Invalid id');
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'Explicit confirmation ("booked" or "attending") is required');
  const sql = db();
  const [ev] = await sql`select * from radar.events where id = ${id.data}`;
  if (!ev) return jsonError(404, 'Event not found');
  if (!ev.start_at) return jsonError(422, 'This event has no verified date yet, so it cannot be added to a calendar');

  // Record the confirmation (idempotent per event) and lock it for this request.
  const [link] = await sql`insert into radar.calendar_links (event_id, confirmation) values (${id.data}, ${body.data.confirmation})
    on conflict (event_id) do update set confirmation = excluded.confirmation returning *`;
  // Already added? Only skip if it's still on the calendar - if it was deleted there, add it again.
  if (link.status === 'created' && link.google_event_id && link.calendar_id) {
    const still = await googleFetch(`/calendars/${encodeURIComponent(link.calendar_id)}/events/${encodeURIComponent(link.google_event_id)}`).catch(() => null);
    if (still && still.status !== 'cancelled') return NextResponse.json({ ok: true, duplicate: true, calendar: link });
  }

  const conn = await getConnection('google');
  if (!conn?.access_token) {
    await sql`update radar.calendar_links set status = 'pending', error = 'Google Calendar not connected' where id = ${link.id}`;
    return jsonError(409, 'Confirmation saved, but Google Calendar is not connected yet. Connect it in Settings, then press "Add to calendar" again.');
  }
  const calendarId = conn.selected_calendar_id ?? 'primary';
  const artists = await sql`select a.name from radar.event_artists ea join radar.artists a on a.id = ea.artist_id where ea.event_id = ${id.data}`;
  const start = new Date(ev.start_at);
  const end = ev.end_at ? new Date(ev.end_at) : new Date(start.getTime() + 3 * 3600_000);
  const day = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const timing = ev.time_known
    ? { start: { dateTime: start.toISOString(), timeZone: ev.timezone }, end: { dateTime: end.toISOString(), timeZone: ev.timezone } }
    : { start: { date: day(start) }, end: { date: day(new Date(start.getTime() + 86400_000)) } }; // time unknown → all-day, never invented
  const description = [
    `Artist: ${artists.map(a => a.name).join(', ')}`,
    `Status: ${body.data.confirmation === 'booked' ? 'Tickets booked' : 'Planning to attend'}`,
    ev.booking_url ? `Booking: ${ev.booking_url}` : null,
    ev.official_url ? `Source: ${ev.official_url}` : null,
    !ev.time_known ? 'Start time not verified - added as an all-day event.' : null,
    'Added by Live Show Radar after explicit confirmation.',
  ].filter(Boolean).join('\n');
  try {
    // Deterministic iCalUID guards against duplicates even if our DB write were lost.
    const created = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events/import`, {
      method: 'POST',
      body: JSON.stringify({ iCalUID: `lsr-${ev.id}@live-show-radar`, status: 'confirmed', summary: `🎤 ${ev.title}`, location: [ev.venue, ev.city, 'India'].filter(Boolean).join(', '), description, ...timing, source: ev.booking_url ? { title: 'Booking', url: ev.booking_url } : undefined }),
    });
    const [saved] = await sql`update radar.calendar_links set status = 'created', calendar_id = ${calendarId}, google_event_id = ${created.id}, google_event_url = ${created.htmlLink ?? null}, error = null where id = ${link.id} returning *`;
    await audit('calendar_event_created', { event_id: ev.id });
    return NextResponse.json({ ok: true, calendar: saved });
  } catch (e) {
    await sql`update radar.calendar_links set status = 'failed', error = ${(e as Error).message.slice(0, 300)} where id = ${link.id}`;
    return jsonError(502, (e as Error).message);
  }
}
