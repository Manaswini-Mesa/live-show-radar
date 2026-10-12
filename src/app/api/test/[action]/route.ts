import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession, jsonError } from '@/lib/auth';
import { db, audit } from '@/lib/db';
import { env } from '@/lib/env';
import { formatAlert } from '@/lib/core';
import { getConnection, googleFetch } from '@/lib/oauth';
import { interestKeyboard, sendTelegram } from '@/lib/telegram';

/**
 * Repeatable end-to-end test workflow on ONE synthetic show (is_synthetic = true):
 *   create → Telegram alert with buttons → Interested / Not interested → book → Google Calendar
 *   (optionally inviting one extra email) → reset (removes the calendar event, cancelling the invite).
 * Real shows are never touched.
 */
const TEST_KEY = 'test|kconcerts-sample-show';
const INVITE_LIMIT_PER_DAY = 10; // the dashboard is open, so cap how many invites can be sent

async function current() {
  const [ev] = await db()`select * from radar.events where dedupe_key = ${TEST_KEY}`;
  if (!ev) return null;
  const [alert] = await db()`select status, delivered_at, last_error from radar.alerts where event_id = ${ev.id} and kind = 'test_show' order by created_at desc limit 1`;
  const [cal] = await db()`select * from radar.calendar_links where event_id = ${ev.id}`;
  return { ev, alert: alert ?? null, cal: cal ?? null };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const deny = requireSession(req); if (deny) return deny;
  if ((await ctx.params).action !== 'status') return jsonError(404, 'Unknown action');
  const c = await current();
  const g = await getConnection('google');
  const tgOk = !!(env.telegramToken() && env.telegramChatId());
  return NextResponse.json({
    ready: { telegram: tgOk, google: !!g?.access_token },
    show: c && { id: c.ev.id, title: c.ev.title, start_at: c.ev.start_at, interest: c.ev.interest, interest_at: c.ev.interest_at, created: c.ev.first_seen_at },
    alert: c?.alert ?? null,
    calendar: c?.cal ? { status: c.cal.status, url: c.cal.google_event_url, confirmation: c.cal.confirmation, error: c.cal.error } : null,
    invitee: c ? (await db()`select detail->>'email' as email from radar.audit_events where action = 'test_invite' and detail->>'event_id' = ${c.ev.id} order by at desc limit 1`)[0]?.email ?? null : null,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const deny = requireSession(req); if (deny) return deny;
  const { action } = await ctx.params;
  const sql = db();

  if (action === 'create') {
    if (await current()) return jsonError(409, 'A sample show already exists - reset it first');
    // Next Saturday-ish: 7 days out, 7:30 pm IST.
    const d = new Date(Date.now() + 7 * 86400_000);
    const start = new Date(`${d.toISOString().slice(0, 10)}T19:30:00+05:30`);
    const [ev] = await sql`insert into radar.events ${sql({
      dedupe_key: TEST_KEY, title: 'KConcerts Sample Show (TEST)', event_type: 'concert', city: 'Bengaluru', country: 'IN',
      venue: 'Sample Venue, Indiranagar', start_at: start.toISOString(), end_at: new Date(start.getTime() + 3 * 3600_000).toISOString(),
      time_known: true, ticket_status: 'on_sale', price_min: 999, currency: 'INR', booking_url: env.appUrl(), official_url: env.appUrl(),
      primary_source: 'test', verification: 'unverified', confidence: 1, is_synthetic: true,
    })} returning id`;
    await sql`insert into radar.event_changes (event_id, field, new_value, change_kind, source_id) values (${ev.id}, 'event', 'Sample show created for testing', 'new_event', null)`;
    await audit('test_created', { event_id: ev.id });
    return NextResponse.json({ ok: true });
  }

  const c = await current();
  if (!c) return jsonError(409, 'Create the sample show first');

  if (action === 'alert') {
    if (!env.telegramToken() || !env.telegramChatId()) return jsonError(409, 'Telegram is not set up');
    const msg = formatAlert({ kind: 'new_show', artist: 'KConcerts Test Artist', title: c.ev.title, city: c.ev.city, venue: c.ev.venue, startAt: c.ev.start_at,
      timeKnown: true, ticketStatus: 'on_sale', earlyBird: null, lastVerified: new Date(), source: 'KConcerts test', link: c.ev.booking_url, reason: 'This is a test alert - tap a button below to test the response flow' });
    const [a] = await sql`insert into radar.alerts (event_id, kind, idempotency_key, message, status) values (${c.ev.id}, 'test_show', ${`testshow:${c.ev.id}:${Date.now()}`}, ${msg}, 'sending') returning id`;
    const r = await sendTelegram(`🧪 <b>TEST</b>\n${msg}`, undefined, interestKeyboard(c.ev.id, c.ev.interest, null));
    await sql`insert into radar.alert_attempts (alert_id, ok, http_status, error) values (${a.id}, ${r.ok}, ${r.ok ? 200 : r.status}, ${r.ok ? null : r.error})`;
    if (!r.ok) { await sql`update radar.alerts set status = 'failed', attempts = 1, last_error = ${r.error}, next_attempt_at = 'infinity' where id = ${a.id}`; return jsonError(502, `Telegram rejected it: ${r.error}`); }
    await sql`update radar.alerts set status = 'delivered', attempts = 1, delivered_at = now(), telegram_message_id = ${r.messageId} where id = ${a.id}`;
    return NextResponse.json({ ok: true });
  }

  if (action === 'book') {
    const body = z.object({ confirmation: z.enum(['booked', 'attending']).default('booked'), email: z.string().trim().email().max(254).optional().or(z.literal('')) })
      .safeParse(await req.json().catch(() => ({})));
    if (!body.success) return jsonError(400, 'That email address does not look valid');
    if (c.cal?.status === 'created') return NextResponse.json({ ok: true, duplicate: true });
    const conn = await getConnection('google');
    if (!conn?.access_token) return jsonError(409, 'Google Calendar is not connected');
    const email = body.data.email || null;
    if (email) {
      const [{ n }] = await sql`select count(*)::int as n from radar.audit_events where action = 'test_invite' and at > now() - interval '1 day'`;
      if (n >= INVITE_LIMIT_PER_DAY) return jsonError(429, `Invite limit reached (${INVITE_LIMIT_PER_DAY} per day) - try again tomorrow or book without an extra email`);
    }
    const calendarId = conn.selected_calendar_id ?? 'primary';
    await sql`insert into radar.calendar_links (event_id, confirmation) values (${c.ev.id}, ${body.data.confirmation}) on conflict (event_id) do update set confirmation = excluded.confirmation`;
    try {
      // events.insert (not import) so Google emails the optional invitee; no one else is invited.
      const created = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${email ? 'all' : 'none'}`, {
        method: 'POST',
        body: JSON.stringify({
          summary: '🎤 KConcerts Sample Show (TEST)', location: `${c.ev.venue}, ${c.ev.city}, India`,
          description: `This is a TEST event created by the KConcerts test workflow.\nBooking: ${c.ev.booking_url}\nIt will be removed when the test is reset.`,
          start: { dateTime: new Date(c.ev.start_at).toISOString(), timeZone: 'Asia/Kolkata' }, end: { dateTime: new Date(c.ev.end_at).toISOString(), timeZone: 'Asia/Kolkata' },
          ...(email ? { attendees: [{ email }], guestsCanModify: false, guestsCanInviteOthers: false } : {}),
        }),
      });
      await sql`update radar.calendar_links set status = 'created', calendar_id = ${calendarId}, google_event_id = ${created.id}, google_event_url = ${created.htmlLink ?? null}, error = null where event_id = ${c.ev.id}`;
      if (email) await audit('test_invite', { event_id: c.ev.id, email });
      await audit('test_booked', { event_id: c.ev.id, invited: !!email });
      return NextResponse.json({ ok: true, url: created.htmlLink ?? null, invited: email });
    } catch (e) {
      await sql`update radar.calendar_links set status = 'failed', error = ${(e as Error).message.slice(0, 300)} where event_id = ${c.ev.id}`;
      return jsonError(502, (e as Error).message);
    }
  }

  if (action === 'reset') {
    // Remove the Google event first (this also cancels the invite for the extra email), then the sample show.
    if (c.cal?.google_event_id && c.cal.calendar_id) {
      try { await googleFetch(`/calendars/${encodeURIComponent(c.cal.calendar_id)}/events/${encodeURIComponent(c.cal.google_event_id)}?sendUpdates=all`, { method: 'DELETE' }); }
      catch (e) { if (!/404|410/.test((e as Error).message)) return jsonError(502, `Could not remove the test event from Google Calendar: ${(e as Error).message}`); }
    }
    await sql`delete from radar.events where id = ${c.ev.id} and is_synthetic`;
    await audit('test_reset', { event_id: c.ev.id });
    return NextResponse.json({ ok: true });
  }

  return jsonError(404, 'Unknown action');
}
