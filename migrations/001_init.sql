-- Live Show Radar — initial schema.
-- Everything lives in the dedicated `radar` schema so it can never collide with
-- other apps' tables in `public`. The schema is NOT exposed through the Supabase
-- Data API; the Next.js server talks to Postgres directly. RLS is enabled on every
-- table with no policies, so the anon/authenticated API roles can read nothing.

create schema if not exists radar;
revoke all on schema radar from anon, authenticated;

create table radar.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_key text not null,                       -- normalised name for dedupe
  priority boolean not null default false,
  origin text not null default 'manual' check (origin in ('manual','spotify')),
  spotify_id text unique,
  spotify_url text,
  image_url text,
  official_tour_url text,                       -- optional: official page with schema.org events
  following boolean not null default true,      -- false once un-followed on Spotify (kept if manual)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name_key)
);

create table radar.artist_aliases (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references radar.artists(id) on delete cascade,
  alias text not null,
  alias_key text not null,
  unique (artist_id, alias_key)
);
create index on radar.artist_aliases (alias_key);

create table radar.spotify_syncs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running','success','failed')),
  fetched int not null default 0,
  added int not null default 0,
  error text
);

create table radar.event_sources (
  id text primary key,                          -- e.g. 'district', 'google_news'
  name text not null,
  source_type text not null,                    -- structured_data | rss | official_page | api
  status text not null default 'pending',       -- live | awaiting_config | unavailable | error | pending | disabled
  coverage_notes text,
  enabled boolean not null default true,
  requires_credentials boolean not null default false,
  supports_booking_url boolean not null default false,
  poll_interval_minutes int not null default 30,
  config jsonb not null default '{}'::jsonb,
  cursor jsonb not null default '{}'::jsonb,    -- rotation state (e.g. next artist batch)
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  consecutive_failures int not null default 0,
  backoff_until timestamptz,
  updated_at timestamptz not null default now()
);

create table radar.events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,              -- artist + local date + city
  title text not null,
  event_type text not null default 'concert',   -- concert | festival | tour | other
  city text,
  country text not null default 'IN',
  venue text,
  start_at timestamptz,
  end_at timestamptz,
  timezone text not null default 'Asia/Kolkata',
  time_known boolean not null default false,
  ticket_status text not null default 'unknown',-- on_sale | not_yet_on_sale | sold_out | cancelled | postponed | announced | unknown
  price_min numeric,
  currency text,
  early_bird text,
  early_bird_deadline timestamptz,
  booking_url text,
  official_url text,
  primary_source text not null,
  verification text not null default 'unverified', -- verified_structured | reported_news | unverified
  confidence numeric not null default 0.5,
  is_synthetic boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on radar.events (start_at);
create index on radar.events (city);

create table radar.event_artists (
  event_id uuid not null references radar.events(id) on delete cascade,
  artist_id uuid not null references radar.artists(id) on delete cascade,
  match_reason text not null,
  primary key (event_id, artist_id)
);

create table radar.event_evidence (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references radar.events(id) on delete cascade,
  source_id text not null references radar.event_sources(id),
  external_id text,
  source_url text not null,
  excerpt text,
  published_at timestamptz,
  content_hash text not null,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (event_id, source_id, source_url)
);

create table radar.ticket_offers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references radar.events(id) on delete cascade,
  source_id text not null references radar.event_sources(id),
  availability text,
  price numeric,
  currency text,
  valid_from timestamptz,
  url text,
  observed_at timestamptz not null default now(),
  unique (event_id, source_id, url)
);

create table radar.event_changes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references radar.events(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  change_kind text not null,                    -- new_event | date_change | venue_change | ticket_status | price_change | booking_link | early_bird | cancelled | postponed | sold_out
  source_id text,
  detected_at timestamptz not null default now()
);
create index on radar.event_changes (event_id, detected_at desc);

create table radar.alerts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references radar.events(id) on delete cascade,
  kind text not null,                           -- new_show | update | test
  idempotency_key text not null unique,
  message text not null,
  status text not null default 'pending' check (status in ('pending','sending','delivered','failed')),
  attempts int not null default 0,
  last_error text,
  telegram_message_id bigint,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  next_attempt_at timestamptz not null default now()
);
create index on radar.alerts (status, next_attempt_at);

create table radar.alert_attempts (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references radar.alerts(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  ok boolean not null,
  http_status int,
  error text
);

create table radar.monitor_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null,                        -- cron | manual
  status text not null default 'running' check (status in ('running','success','partial','failed','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  error text
);
-- Only one run may be "running" at a time: this is the monitoring lock.
create unique index monitor_single_running on radar.monitor_runs ((true)) where status = 'running';
create index on radar.monitor_runs (started_at desc);

create table radar.monitor_source_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references radar.monitor_runs(id) on delete cascade,
  source_id text not null references radar.event_sources(id),
  status text not null,                         -- success | failed | skipped
  items_fetched int not null default 0,
  events_matched int not null default 0,
  events_new int not null default 0,
  events_changed int not null default 0,
  duration_ms int,
  error text,
  created_at timestamptz not null default now()
);

-- Cache of processed source documents, so unchanged content is never sent to Gemini twice.
create table radar.source_documents (
  source_id text not null references radar.event_sources(id),
  doc_key text not null,
  content_hash text not null,
  processed_at timestamptz not null default now(),
  result jsonb,
  primary key (source_id, doc_key)
);

create table radar.calendar_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references radar.events(id) on delete cascade,
  confirmation text not null check (confirmation in ('booked','attending')),
  confirmed_at timestamptz not null default now(),
  calendar_id text,
  google_event_id text,
  google_event_url text,
  status text not null default 'pending' check (status in ('pending','created','failed')),
  error text
);

-- OAuth tokens: server-only. RLS on, no policies, schema not exposed via the Data API.
create table radar.oauth_connections (
  provider text primary key check (provider in ('spotify','google')),
  account_label text,
  scopes text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  selected_calendar_id text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table radar.audit_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  action text not null,
  detail jsonb
);

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'radar' loop
    execute format('alter table radar.%I enable row level security', t);
    execute format('revoke all on radar.%I from anon, authenticated', t);
  end loop;
end $$;

-- Source registry seed (honest initial statuses; the monitor updates them).
insert into radar.event_sources (id, name, source_type, status, coverage_notes, requires_credentials, supports_booking_url, poll_interval_minutes, enabled, config) values
('district', 'District (by Zomato) — city music listings', 'structured_data', 'pending',
 'Public schema.org Event JSON-LD on District city music pages (robots.txt allows /events). Covers the cities configured below; ~12 featured listings per city page.',
 false, true, 30, true,
 '{"cities":["bengaluru","mumbai","delhi-ncr","hyderabad","pune","chennai","kolkata","goa","ahmedabad","jaipur","chandigarh","kochi"]}'),
('google_news', 'Google News RSS (announcement discovery)', 'rss', 'pending',
 'Public RSS search feed per artist. Headlines are reported news, not ticket listings; Gemini extracts structured details and items are labelled "reported", never "verified".',
 false, false, 60, true, '{"artists_per_run":8}'),
('official_pages', 'Official artist tour pages', 'official_page', 'pending',
 'Fetches the official tour URL saved on an artist and reads schema.org MusicEvent JSON-LD. Only artists with a tour URL are checked.',
 false, true, 360, true, '{}'),
('ticketmaster', 'Ticketmaster Discovery API', 'api', 'awaiting_config',
 'Official API, free key at developer.ticketmaster.com. India coverage is very limited. Adapter not enabled until TICKETMASTER_API_KEY is set.',
 true, true, 60, false, '{}'),
('bandsintown', 'Bandsintown API', 'api', 'awaiting_config',
 'Requires an approved app_id; anonymous requests return 403 (verified 2026-10-12).',
 true, true, 60, false, '{}'),
('bookmyshow', 'BookMyShow', 'official_page', 'unavailable',
 'Blocks automated requests (HTTP 403 on robots.txt, verified 2026-10-12). Not collected; no bypass attempted.',
 false, true, 0, false, '{}'),
('insider', 'Paytm Insider', 'official_page', 'unavailable',
 'insider.in returned HTTP 502 (verified 2026-10-12); listings have moved to District.',
 false, true, 0, false, '{}'),
('skillbox', 'SkillBox', 'official_page', 'unavailable',
 'robots.txt allows crawling but pages expose no structured event data; not implemented yet.',
 false, true, 0, false, '{}');
