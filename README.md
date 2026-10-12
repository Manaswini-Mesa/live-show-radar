# 🎤 Live Show Radar

AI-assisted concert and festival alerts across India for the artists you follow.

**Live app:** https://live-show-radar-chi.vercel.app (private dashboard, password-protected)
**Repo:** https://github.com/Manaswini-Mesa/live-show-radar

Live Show Radar watches legitimate public event sources and matches listings to your artist watchlist (manual or imported from Spotify). It deduplicates shows across sources, tracks meaningful changes (on-sale, price, venue, date, cancellations), and sends Telegram alerts with direct booking links. A show goes into Google Calendar **only after you confirm** you booked it or plan to attend.

## What works today (verified 2026-10-12)
- ✅ Dashboard (Overview, Events with filters + evidence + change history, Artists, Alerts, Sources, Settings) on Vercel
- ✅ Manual watchlist: add/edit/remove, aliases, priority, search, duplicate prevention
- ✅ **District** live source: schema.org event data from 12 Indian city music pages (139 live listings fetched on the first run)
- ✅ India filter, artist matching, dedupe (artist + city + IST day), change detection, evidence storage
- ✅ Supabase Postgres (isolated project + `radar` schema), migrations, RLS
- ✅ Gemini Flash key verified; schema-validated extraction from Google News RSS (with retry/backoff on overload)
- ✅ Supabase pg_cron job every 5 minutes → `/api/monitor/run` (see docs for verification)
- ✅ Telegram alerts verified live (test + real show alerts delivered)
- 🟡 Google Calendar: OAuth client configured, awaiting owner sign-in · Spotify: needs a Premium developer account (see [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md))

## Quick start
```bash
npm install
cp .env.example .env.local      # fill in values
npm run migrate
npm run dev
npm test
```

## Docs
- [Components Map](docs/COMPONENTS_MAP.md) · [Architecture](docs/ARCHITECTURE.md) · [Setup Guide](docs/SETUP_GUIDE.md)
- [Integrations & sources](docs/INTEGRATIONS.md) · [Security](docs/SECURITY.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

## Honest limitations
Not full India-wide coverage: BookMyShow blocks automated access, Insider is offline, and Ticketmaster/Bandsintown need keys. District city pages show featured listings (~12 per city). News-derived items are labelled "Reported" and never treated as verified.
