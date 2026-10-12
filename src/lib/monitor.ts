import 'server-only';
import { db, audit } from './db';
import { dedupeKey, detectChanges, formatAlert, matchArtists, type Change, type NormalizedEvent } from './core';
import { ADAPTERS, type WatchArtist, type SourceRow } from './sources';
import { interestKeyboard, sendTelegram } from './telegram';
import { env } from './env';
import { sha } from './http';

const SOURCE_NAMES: Record<string, string> = { district: 'District', google_news: 'Google News (reported)', official_pages: 'Official artist page' };
const RUN_BUDGET_MS = 50_000;

export async function loadWatchlist(): Promise<WatchArtist[]> {
  const rows = await db()`select a.id, a.name, a.official_tour_url, coalesce(array_agg(al.alias) filter (where al.alias is not null), '{}') as aliases
    from radar.artists a left join radar.artist_aliases al on al.artist_id = a.id group by a.id order by a.priority desc, a.name`;
  return rows.map(r => ({ id: r.id, name: r.name, aliases: r.aliases, official_tour_url: r.official_tour_url }));
}

type PersistStats = { matched: number; created: number; changed: number };

async function persist(sourceId: string, ev: NormalizedEvent, artists: WatchArtist[], stats: PersistStats) {
  const sql = db();
  const matches = matchArtists(`${ev.title} ${ev.artistHint ?? ''}`, artists, ev.artistHint);
  for (const { artist, reason } of matches) {
    stats.matched++;
    const key = dedupeKey(artist.id, ev);
    const contentHash = await sha(JSON.stringify(ev));
    await sql.begin(async tx => {
      let [existing] = await tx`select * from radar.events where dedupe_key = ${key} for update`;
      if (!existing) {
        // Same artist + same city where one side has no date yet (e.g. a news announcement
        // before the ticket listing exists) is the same show, not a new one.
        const prefix = key.slice(0, key.lastIndexOf('|') + 1);
        [existing] = await tx`select * from radar.events where dedupe_key like ${prefix + '%'}
          and (start_at is null or ${ev.startAt}::timestamptz is null) order by first_seen_at limit 1 for update`;
      }
      let eventId: string;
      let changes: Change[] = [];
      if (!existing) {
        const [row] = await tx`insert into radar.events ${tx({
          dedupe_key: key, title: ev.title, event_type: ev.eventType, city: ev.city, country: 'IN', venue: ev.venue,
          start_at: ev.startAt, end_at: ev.endAt, time_known: ev.timeKnown, ticket_status: ev.ticketStatus,
          price_min: ev.priceMin, currency: ev.currency, early_bird: ev.earlyBird, early_bird_deadline: ev.earlyBirdDeadline,
          booking_url: ev.bookingUrl, official_url: ev.officialUrl, primary_source: sourceId, verification: ev.verification, confidence: ev.confidence,
        })} on conflict (dedupe_key) do nothing returning id`;
        if (!row) return; // raced with a parallel insert; next run will reconcile
        eventId = row.id;
        stats.created++;
        await tx`insert into radar.event_changes (event_id, field, new_value, change_kind, source_id) values (${eventId}, 'event', ${ev.title}, 'new_event', ${sourceId})`;
      } else {
        eventId = existing.id;
        // Lower-trust sources (news) never override structured ticketing data.
        const rank = (v: string) => ({ verified_structured: 2, reported_news: 1, unverified: 0 }[v] ?? 0);
        if (rank(ev.verification) >= rank(existing.verification)) changes = detectChanges(existing as never, ev);
        const upgrade = rank(ev.verification) > rank(existing.verification);
        const gainsDate = !existing.start_at && !!ev.startAt;
        await tx`update radar.events set
          dedupe_key = ${gainsDate ? key : existing.dedupe_key},
          title = ${upgrade ? ev.title : existing.title},
          venue = coalesce(${ev.verification === existing.verification || upgrade ? ev.venue : null}, venue),
          start_at = coalesce(${changes.some(c => c.field === 'start_at') || upgrade ? ev.startAt : null}, start_at, ${ev.startAt}::timestamptz),
          time_known = time_known or ${ev.timeKnown},
          ticket_status = ${changes.some(c => c.field === 'ticket_status') || (upgrade && ev.ticketStatus !== 'unknown') ? ev.ticketStatus : existing.ticket_status},
          price_min = coalesce(${rank(ev.verification) >= rank(existing.verification) ? ev.priceMin : null}, price_min),
          currency = coalesce(currency, ${ev.currency}),
          early_bird = coalesce(${ev.earlyBird}, early_bird),
          booking_url = coalesce(booking_url, ${ev.bookingUrl}),
          verification = ${upgrade ? ev.verification : existing.verification},
          confidence = greatest(confidence, ${ev.confidence}),
          primary_source = ${upgrade ? sourceId : existing.primary_source},
          last_verified_at = now(), updated_at = now()
          where id = ${eventId}`;
        for (const c of changes) await tx`insert into radar.event_changes (event_id, field, old_value, new_value, change_kind, source_id) values (${eventId}, ${c.field}, ${c.oldValue}, ${c.newValue}, ${c.kind}, ${sourceId})`;
        if (changes.length) stats.changed++;
      }
      await tx`insert into radar.event_artists (event_id, artist_id, match_reason) values (${eventId}, ${artist.id}, ${reason}) on conflict do nothing`;
      await tx`insert into radar.event_evidence (event_id, source_id, external_id, source_url, excerpt, published_at, content_hash, raw)
        values (${eventId}, ${sourceId}, ${ev.externalId}, ${ev.sourceUrl}, ${ev.excerpt}, ${ev.publishedAt}, ${contentHash}, ${tx.json(ev as never)})
        on conflict (event_id, source_id, source_url) do update set last_seen_at = now(), content_hash = excluded.content_hash, excerpt = excluded.excerpt`;
      if (ev.bookingUrl || ev.priceMin != null) await tx`insert into radar.ticket_offers (event_id, source_id, availability, price, currency, url)
        values (${eventId}, ${sourceId}, ${ev.ticketStatus}, ${ev.priceMin}, ${ev.currency}, ${ev.bookingUrl ?? ev.sourceUrl})
        on conflict (event_id, source_id, url) do update set availability = excluded.availability, price = excluded.price, observed_at = now()`;

      // Notification rules - each at most once per show (unique idempotency keys):
      //   1. new_show      - first time a show is announced
      //   2. tickets_live  - tickets go on sale AND the user hasn't answered Interested / Not interested
      // Every other change is recorded in history but never notified.
      const alertable = ev.verification === 'verified_structured' || ev.confidence >= 0.7;
      if (!alertable) return;
      const [e] = await tx`select * from radar.events where id = ${eventId}`;
      const base = { artist: artist.name, title: e.title, city: e.city, venue: e.venue, startAt: e.start_at, timeKnown: e.time_known, ticketStatus: e.ticket_status, earlyBird: e.early_bird, lastVerified: e.last_verified_at, source: SOURCE_NAMES[sourceId] ?? sourceId, link: e.booking_url ?? e.official_url, reason };
      if (!existing) {
        await tx`insert into radar.alerts (event_id, kind, idempotency_key, message) values (${eventId}, 'new_show', ${`new:${eventId}`}, ${formatAlert({ ...base, kind: 'new_show' })}) on conflict (idempotency_key) do nothing`;
      } else if (!e.interest && changes.some(c => c.field === 'ticket_status' && c.newValue === 'on_sale')) {
        await tx`insert into radar.alerts (event_id, kind, idempotency_key, message) values (${eventId}, 'tickets_live', ${`live:${eventId}`}, ${formatAlert({ ...base, kind: 'tickets_live' })}) on conflict (idempotency_key) do nothing`;
      }
    });
  }
}

/** Deliver pending/failed alerts. Delivered only when Telegram confirms. */
export async function deliverAlerts(opts: { ids?: string[]; limit?: number } = {}) {
  const sql = db();
  if (!env.telegramToken() || !env.telegramChatId()) return { attempted: 0, delivered: 0, skipped: 'Telegram not configured' };
  const claimedIds = (opts.ids?.length
    ? await sql`update radar.alerts set status = 'sending' where id = any(${opts.ids}) and status in ('pending','failed') returning id`
    : await sql`update radar.alerts set status = 'sending' where id in (select id from radar.alerts where status in ('pending','failed') and attempts < 6 and next_attempt_at <= now() order by created_at limit ${opts.limit ?? 15} for update skip locked) returning id`).map(r => r.id);
  const claimed = claimedIds.length ? await sql`select a.id, a.kind, a.message, a.attempts, a.event_id, e.interest, e.booking_url
    from radar.alerts a left join radar.events e on e.id = a.event_id where a.id = any(${claimedIds}) order by a.created_at` : [];
  let delivered = 0;
  for (const a of claimed) {
    // The user already answered for this show → a "tickets live" nudge is no longer needed.
    if (a.kind === 'tickets_live' && a.interest) {
      await sql`update radar.alerts set status = 'suppressed', last_error = ${`User already marked ${a.interest}`} where id = ${a.id}`;
      continue;
    }
    const r = await sendTelegram(a.message, undefined, a.event_id ? interestKeyboard(a.event_id, a.interest, a.booking_url) : undefined);
    await sql`insert into radar.alert_attempts (alert_id, ok, http_status, error) values (${a.id}, ${r.ok}, ${r.ok ? 200 : r.status}, ${r.ok ? null : r.error})`;
    if (r.ok) { delivered++; await sql`update radar.alerts set status = 'delivered', delivered_at = now(), attempts = attempts + 1, telegram_message_id = ${r.messageId}, last_error = null where id = ${a.id}`; }
    else await sql`update radar.alerts set status = 'failed', attempts = attempts + 1, last_error = ${r.error}, next_attempt_at = now() + make_interval(mins => ${2 ** Math.min(a.attempts + 1, 6)}) where id = ${a.id}`;
  }
  return { attempted: claimed.length, delivered };
}

export async function runMonitor(trigger: 'cron' | 'manual', opts: { force?: boolean; sourceIds?: string[] } = {}) {
  const sql = db();
  const started = Date.now();
  await sql`update radar.monitor_runs set status = 'failed', finished_at = now(), error = 'Stale lock released (run exceeded 10 minutes)' where status = 'running' and started_at < now() - interval '10 minutes'`;
  let runId: string;
  try {
    [{ id: runId }] = await sql`insert into radar.monitor_runs (trigger) values (${trigger}) returning id`;
  } catch {
    const [r] = await sql`insert into radar.monitor_runs (trigger, status, finished_at, error) values (${trigger}, 'skipped', now(), 'Another run is in progress') returning id`;
    return { runId: r.id, status: 'skipped' as const, sources: [] };
  }
  const summary: { source: string; status: string; fetched?: number; matched?: number; created?: number; changed?: number; error?: string; notes?: string[] }[] = [];
  try {
    const artists = await loadWatchlist();
    const sources = await sql<(SourceRow & { poll_interval_minutes: number; last_checked_at: Date | null; backoff_until: Date | null; consecutive_failures: number })[]>`
      select * from radar.event_sources where enabled order by (id = 'google_news'), id`;
    for (const s of sources) {
      if (opts.sourceIds && !opts.sourceIds.includes(s.id)) continue;
      const adapter = ADAPTERS[s.id];
      if (!adapter) continue;
      const due = !s.last_checked_at || Date.now() - new Date(s.last_checked_at).getTime() >= s.poll_interval_minutes * 60_000 - 30_000;
      const backoff = s.backoff_until && new Date(s.backoff_until).getTime() > Date.now();
      if ((!due || backoff) && !opts.force) { summary.push({ source: s.id, status: 'skipped', error: backoff ? 'in backoff' : 'not due' }); continue; }
      if (Date.now() - started > RUN_BUDGET_MS) { summary.push({ source: s.id, status: 'skipped', error: 'run time budget exhausted' }); continue; }
      const t0 = Date.now();
      const stats = { matched: 0, created: 0, changed: 0 };
      try {
        const res = await adapter(s, artists);
        for (const ev of res.items) await persist(s.id, ev, artists, stats);
        await sql`update radar.event_sources set status = 'live', last_checked_at = now(), last_success_at = now(), last_error = ${res.notes?.length ? res.notes.join('; ').slice(0, 500) : null},
          consecutive_failures = 0, backoff_until = null, cursor = ${sql.json({ ...s.cursor, ...(res.cursor ?? {}) } as never)}, updated_at = now() where id = ${s.id}`;
        await sql`insert into radar.monitor_source_results (run_id, source_id, status, items_fetched, events_matched, events_new, events_changed, duration_ms, error)
          values (${runId}, ${s.id}, 'success', ${res.fetched}, ${stats.matched}, ${stats.created}, ${stats.changed}, ${Date.now() - t0}, ${res.notes?.join('; ').slice(0, 500) ?? null})`;
        summary.push({ source: s.id, status: 'success', fetched: res.fetched, ...stats, notes: res.notes });
      } catch (e) {
        const msg = (e as Error).message.slice(0, 500);
        const fails = s.consecutive_failures + 1;
        await sql`update radar.event_sources set status = 'error', last_checked_at = now(), last_error = ${msg}, last_error_at = now(), consecutive_failures = ${fails},
          backoff_until = now() + make_interval(mins => ${Math.min(5 * 2 ** (fails - 1), 240)}), updated_at = now() where id = ${s.id}`;
        await sql`insert into radar.monitor_source_results (run_id, source_id, status, duration_ms, error) values (${runId}, ${s.id}, 'failed', ${Date.now() - t0}, ${msg})`;
        summary.push({ source: s.id, status: 'failed', error: msg });
      }
    }
    const delivery = await deliverAlerts();
    const failed = summary.filter(x => x.status === 'failed').length;
    const ran = summary.filter(x => x.status !== 'skipped').length;
    const status = failed === 0 ? 'success' : failed === ran ? 'failed' : 'partial';
    await sql`update radar.monitor_runs set status = ${status}, finished_at = now(), summary = ${sql.json({ sources: summary, delivery, artists: artists.length, ms: Date.now() - started } as never)} where id = ${runId}`;
    return { runId, status, sources: summary, delivery };
  } catch (e) {
    await sql`update radar.monitor_runs set status = 'failed', finished_at = now(), error = ${(e as Error).message.slice(0, 500)}, summary = ${sql.json({ sources: summary } as never)} where id = ${runId}`;
    await audit('monitor_failed', { error: (e as Error).message });
    return { runId, status: 'failed' as const, sources: summary, error: (e as Error).message };
  }
}
