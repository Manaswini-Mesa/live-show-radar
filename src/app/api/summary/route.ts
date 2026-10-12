import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { configReport, env } from '@/lib/env';
import { getConnection } from '@/lib/oauth';


// Dashboard summary: counts, run status, source registry and integration status.
// Integration "verified" flags come only from stored test results, never from config alone.
export async function GET(req: NextRequest) {
  const deny = requireSession(req); if (deny) return deny;
  const sql = db();
  const [counts] = await sql`select
    (select count(*) from radar.artists)::int as artists,
    (select count(*) from radar.artists where priority)::int as priority_artists,
    (select count(*) from radar.events where coalesce(start_at, now()) >= now() - interval '1 day' and not is_synthetic)::int as upcoming,
    (select count(*) from radar.events where first_seen_at > now() - interval '7 days')::int as new_7d,
    (select count(*) from radar.event_changes where change_kind in ('ticket_status','early_bird','booking_link','price_change') and detected_at > now() - interval '7 days')::int as ticket_updates_7d,
    (select count(*) from radar.alerts where status = 'delivered')::int as alerts_delivered,
    (select count(*) from radar.alerts where status in ('pending','failed'))::int as alerts_pending,
    (select count(*) from radar.calendar_links where status = 'created')::int as confirmed`;
  const runs = await sql`select id, trigger, status, started_at, finished_at, summary, error from radar.monitor_runs order by started_at desc limit 12`;
  const [lastOk] = await sql`select started_at, finished_at, summary from radar.monitor_runs where status in ('success','partial') order by started_at desc limit 1`;
  const sources = await sql`select id, name, source_type, status, coverage_notes, enabled, requires_credentials, supports_booking_url, poll_interval_minutes, last_checked_at, last_success_at, last_error, last_error_at, consecutive_failures, backoff_until from radar.event_sources order by enabled desc, id`;
  const [spotify, google] = await Promise.all([getConnection('spotify'), getConnection('google')]);
  const [lastSync] = await sql`select * from radar.spotify_syncs order by started_at desc limit 1`;
  const [tgOk] = await sql`select max(attempted_at) as at from radar.alert_attempts where ok`;
  const [tgLastFail] = await sql`select attempted_at, error from radar.alert_attempts where not ok order by attempted_at desc limit 1`;
  const [gemini] = await sql`select detail, at from radar.audit_events where action = 'gemini_check' order by at desc limit 1`;
  const [cron] = await sql`select max(started_at) as at from radar.monitor_runs where trigger = 'cron'`;
  const cfg = configReport();
  return NextResponse.json({
    counts, runs, lastSuccessfulRun: lastOk ?? null, sources,
    scheduler: { lastCronRun: cron?.at ?? null, intervalMinutes: 5, mechanism: 'Supabase pg_cron → pg_net → /api/monitor/run' },
    integrations: {
      telegram: { configured: cfg.missingOptional.telegram.length === 0, missing: cfg.missingOptional.telegram, lastSuccess: tgOk?.at ?? null, lastFailure: tgLastFail ?? null },
      gemini: { configured: cfg.missingOptional.gemini.length === 0, model: env.geminiModel(), lastCheck: gemini ?? null },
      spotify: { configured: cfg.missingOptional.spotify.length === 0, missing: cfg.missingOptional.spotify, connected: !!spotify?.access_token, account: spotify?.account_label ?? null, lastSync: lastSync ?? null, redirectUri: env.spotifyRedirect() },
      google: { configured: cfg.missingOptional.google.length === 0, missing: cfg.missingOptional.google, connected: !!google?.access_token, account: google?.account_label ?? null, calendarId: google?.selected_calendar_id ?? null, redirectUri: env.googleRedirect() },
    },
  });
}
