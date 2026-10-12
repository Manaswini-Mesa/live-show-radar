# Troubleshooting

| Symptom | Fix |
|---|---|
| `/api/health` → `database:false` | Check the Supabase integration is connected to the Vercel project (Vercel → Storage). Run `npm run migrate`. Supabase free projects pause after inactivity — resume from the Supabase dashboard. |
| Login says "DASHBOARD_PASSWORD is not configured" | Add it in Vercel env vars and redeploy. |
| Google News source "failed: Gemini HTTP 503/429" | Gemini is overloaded or the free quota is used up. The source backs off automatically; District keeps working. |
| No events after a run | Events only appear for watchlist artists. Check Sources → District "fetched" count; add artists who are touring (e.g. those listed on district.in). |
| "Last scheduled run: not yet observed" | `select * from cron.job_run_details order by start_time desc limit 5;` and `select * from net._http_response order by created desc limit 5;` A 401 means the Vault secret ≠ Vercel `CRON_SECRET` — rerun `scripts/setup-cron.mjs`. |
| Spotify 403 on import | Add your account under the Spotify app's **User Management**. |
| Spotify "INVALID_CLIENT: Invalid redirect URI" | The redirect URI in the Spotify dashboard must exactly match `SPOTIFY_REDIRECT_URI`. Locally use `http://127.0.0.1:3000/...`. |
| Google `redirect_uri_mismatch` | Add the exact URI shown in Settings to the OAuth client. |
| Google "access blocked / not a test user" | Add your account under OAuth consent screen → Test users. |
| Telegram "chat not found" | Press **Start** on the bot first; use the ID from "Check bot & find chat ID". |
| Vercel build `npm install` ERESOLVE | `.npmrc` must contain `legacy-peer-deps=true`. |
