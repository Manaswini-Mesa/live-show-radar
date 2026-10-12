# Security

- **Secrets** live only in Vercel environment variables (server-side) and `.env.local` (git-ignored). Nothing secret uses a `NEXT_PUBLIC_` prefix. `.env.example` has placeholders only. Staged changes are scanned for key patterns before each push.
- **Dashboard auth**: a single owner password (`DASHBOARD_PASSWORD`) → HttpOnly, SameSite=Lax, Secure HMAC-signed cookie (14 days). Every management API route calls `requireSession`. Only `/api/health` is public, and it returns booleans and missing variable *names* only.
- **Scheduler**: `/api/monitor/run` accepts `Authorization: Bearer CRON_SECRET` (constant-time compare). The secret is stored in Supabase Vault for pg_cron.
- **OAuth**: signed, 10-minute `state` and a required session on callbacks. Tokens are stored in `radar.oauth_connections`. The `radar` schema isn't exposed through the Supabase Data API, RLS is enabled with no policies, and `anon`/`authenticated` privileges are revoked. Least-privilege scopes: Spotify `user-follow-read`; Google `calendar.events` + `calendar.calendarlist.readonly`. No invitations are sent (`events.import`, no attendees).
- **Untrusted content**: external pages and feeds are treated as data. Gemini prompts fence the data and say to ignore any instructions inside it. Output is schema-validated, and AI output is never treated as proof (news items are labelled "Reported").
- **Telegram**: the bot token is only used in server-side request URLs and is never logged or returned. Error messages are sanitised.
- **Known gap**: the old bot token shared earlier in a conversation should be revoked via @BotFather (`/revoke`). The app never used it.
- **Scraping ethics**: only robots-permitted, public, structured pages. No CAPTCHA/anti-bot bypass; blocked sources are marked unavailable.
