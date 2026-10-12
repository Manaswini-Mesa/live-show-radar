# Setup Guide

Production: **https://live-show-radar-chi.vercel.app**

## Local development

```bash
npm install            # .npmrc sets legacy-peer-deps
cp .env.example .env.local   # fill in values (or `vercel env pull`)
npm run migrate        # applies migrations/*.sql once each (schema "radar")
npm run dev            # http://localhost:3000  (Spotify needs http://127.0.0.1:3000)
npm test               # unit tests
npm run build          # production build
```

## Database

Supabase project `live-show-radar-db` was provisioned through the Vercel Marketplace (free plan) and is connected to the Vercel project, so `POSTGRES_URL*` and `SUPABASE_*` env vars are injected automatically. `npm run migrate` uses the non-pooling URL.

## Scheduler (every 5 minutes)

```bash
APP_URL=https://live-show-radar-chi.vercel.app node scripts/setup-cron.mjs
```
Creates/updates the `live-show-radar-monitor` pg_cron job and stores the URL and `CRON_SECRET` in Supabase Vault. Verify:
```sql
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
select status_code, created from net._http_response order by created desc limit 5;
```
The dashboard's "Last scheduled run" shows the last run with `trigger = 'cron'`.

## Telegram (≈2 minutes)

1. Rotate the old token: Telegram → **@BotFather** → `/revoke` → choose your bot → copy the new token (don't paste it in chat with anyone).
2. Vercel → project **live-show-radar** → Settings → Environment Variables → add `TELEGRAM_BOT_TOKEN` (Production) → Save.
3. In Telegram open your bot and press **Start** (or send "hi").
4. Redeploy (Vercel → Deployments → ⋯ → Redeploy), sign in to the dashboard → **Settings → Telegram → Check bot & find chat ID**. Copy the number shown.
5. Add `TELEGRAM_CHAT_ID` in Vercel the same way, redeploy, then click **Send test message**. Success = message arrives and the status shows "Verified".

## Spotify

1. https://developer.spotify.com/dashboard → **Create app**. Name: Live Show Radar. Redirect URI: `https://live-show-radar-chi.vercel.app/api/spotify/callback`. API: **Web API**. Save.
2. App → **User Management** → add the name + email of the Spotify account you'll import from (Development Mode only allows allow-listed users; Spotify currently also requires the app owner to have Premium).
3. App → Settings → copy **Client ID** and **Client secret** → add `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` in Vercel → Redeploy.
4. Dashboard → Settings → **Connect Spotify** → approve → Artists → **Preview followed artists** → choose → **Import**.

## Google Calendar

1. https://console.cloud.google.com → create/select a project.
2. **APIs & Services → Library → Google Calendar API → Enable**.
3. **OAuth consent screen** (Google Auth Platform): User type **External**, app name Live Show Radar, your email as support/developer contact. Under **Audience → Test users** add your Google account. Under **Data access** add scopes `.../auth/calendar.events` and `.../auth/calendar.calendarlist.readonly`.
4. **Clients → Create client → Web application**. Authorised redirect URI: `https://live-show-radar-chi.vercel.app/api/google/callback`. Create → copy Client ID and secret.
5. Vercel env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` → Redeploy.
6. Dashboard → Settings → **Connect Google Calendar** → approve (you'll see an "unverified app" notice for test mode — continue). Optionally **Choose calendar**.
7. Test: open any event → choose "I booked tickets" → **Confirm & add to Google Calendar**. Press it again → "Already in your calendar — no duplicate created".
