# Architecture

See [COMPONENTS_MAP.md](COMPONENTS_MAP.md) for the diagram.

- **Runtime**: Next.js 16 App Router on Vercel (Node runtime). One client dashboard (`src/app/dashboard.tsx`) + JSON API routes (`src/app/api/**`).
- **Database**: Supabase Postgres, schema `radar` (isolated from `public`), accessed server-side with `postgres` (transaction pooler, `prepare:false`). Migrations in `migrations/`, applied by `scripts/migrate.mjs`.
- **Core logic** (`src/lib`):
  - `core.ts` - pure functions: name normalisation, artist matching, India filter, dedupe key, change detection, alert formatting (unit tested).
  - `parsers.ts` - JSON-LD and RSS parsing (unit tested).
  - `sources.ts` - adapters (`district`, `google_news`, `official_pages`) returning normalised events.
  - `monitor.ts` - run orchestration, persistence, change history, alert creation & delivery.
  - `gemini.ts`, `telegram.ts`, `oauth.ts` - provider clients.
  - `auth.ts` - password session cookie (HMAC-SHA256), cron bearer check, signed OAuth state.
- **Scheduling**: Supabase `pg_cron` → `pg_net.http_post` every 5 minutes. Vercel Hobby cron is limited to daily jobs, so it isn't used.
- **Run budget**: each run stops starting new sources after 50 s (function `maxDuration` 60 s); skipped sources run next time.

## Key tables
`artists`, `artist_aliases`, `spotify_syncs`, `event_sources` (registry + health + cursor), `events` (canonical, `dedupe_key` unique), `event_artists`, `event_evidence`, `ticket_offers`, `event_changes`, `alerts` (`idempotency_key` unique), `alert_attempts`, `monitor_runs` (single-running unique index = lock), `monitor_source_results`, `source_documents` (AI cache), `calendar_links` (one per event), `oauth_connections`, `audit_events`.
