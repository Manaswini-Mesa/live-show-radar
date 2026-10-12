# Integrations & Sources (verified 2026-10-12)

| Source / service | Status | Evidence |
|---|---|---|
| **District** city music pages (`/events/music-in-<city>-book-tickets`) | ✅ Live | robots.txt allows `/events`; pages embed schema.org `ItemList` of `Event` with venue, start time, INR price, availability and booking URL. First live run: 139 listings across 12 cities, 5 matched to the test watchlist. ~12 featured listings per city page — not the full catalogue. |
| **Google News RSS** search | ✅ Feed reachable; extraction depends on Gemini | Public RSS. Items are *reported news*, not ticket listings; labelled "Reported (news)", confidence capped at 0.8, never override District data. |
| **Official artist tour pages** | ✅ Implemented | Reads schema.org events from the tour URL saved on an artist. Only as good as the site's structured data. |
| **Gemini Flash** (`gemini-3.6-flash`) | ✅ Key valid (HTTP 200) | Structured extraction with `responseSchema` + zod validation; handles 429/5xx/timeouts; one retry on 5xx. Google Search grounding returned 429 on this free key, so it isn't used. |
| Ticketmaster Discovery | 🟡 Awaiting key | Free key at developer.ticketmaster.com; India coverage minimal. Adapter not built yet. |
| Bandsintown | 🟡 Awaiting approved app_id | Anonymous `app_id` → HTTP 403. |
| BookMyShow | ⛔ Unavailable | HTTP 403 to automated requests (even robots.txt). Not bypassed. |
| Paytm Insider | ⛔ Unavailable | HTTP 502; listings moved to District. |
| SkillBox | ⛔ Not implemented | Crawlable but no structured event data. |
| Telegram Bot API | ✅ Live — test message + 5 real show alerts delivered 2026-10-12 | `sendMessage` (HTML), `getMe`, `getUpdates` for chat discovery. |
| Spotify Web API | 🟡 Blocked: developer account lacks Spotify Premium (Web API greyed out) | Scope `user-follow-read`; `GET /v1/me/following?type=artist` with cursor pagination (50/page). |
| Google Calendar API | 🟡 OAuth client configured (Internal, Workspace); awaiting owner sign-in | Scopes `calendar.events` + `calendar.calendarlist.readonly`; `events.import` with deterministic iCalUID. |
| Supabase Postgres + pg_cron + pg_net | ✅ Live | Migrations applied; cron job active every 5 minutes. |

## Coverage limitations
- Not full India-wide coverage. District city pages show featured listings for 12 configured cities; smaller shows or other platforms (BookMyShow) may be missed.
- News-derived items may lack dates/venues and can describe past events; they're filtered by date and confidence, and shown as "Reported".
- A news-only announcement (no date) and a later District listing for the same show have different dedupe keys (date unknown vs known) and may appear as two records.
