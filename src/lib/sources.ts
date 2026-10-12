import 'server-only';
import type { NormalizedEvent } from './core';
import { canonicalCity, isIndia, matchArtists, nameKey, INDIA_CITY_NAMES } from './core';
import { robotsAllows } from './robots';
import { extractJsonLd, findEvents, normalizeSchemaEvent, parseRss, type RssItem } from './parsers';
import { fetchText, mapLimit, sha } from './http';
import { extractFromNews, GeminiError, type Extracted } from './gemini';
import { db } from './db';

export type WatchArtist = { id: string; name: string; aliases: string[]; official_tour_url: string | null };
export type SourceRow = { id: string; config: Record<string, unknown>; cursor: Record<string, unknown> };
export type AdapterResult = { items: NormalizedEvent[]; fetched: number; cursor?: Record<string, unknown>; notes?: string[] };
export type Adapter = (src: SourceRow, artists: WatchArtist[]) => Promise<AdapterResult>;

/** District city music pages → schema.org Events. Uses conditional requests per city. */
const district: Adapter = async (src) => {
  const cities = (src.config.cities as string[] | undefined) ?? ['bengaluru'];
  const etags = (src.cursor.etags as Record<string, string> | undefined) ?? {};
  const notes: string[] = [];
  let fetched = 0;
  const results = await mapLimit(cities, 3, async (city) => {
    const url = `https://www.district.in/events/music-in-${city}-book-tickets`;
    const r = await fetchText(url, { headers: etags[city] ? { 'if-none-match': etags[city] } : {} });
    if (r.status === 304) return { city, items: [] as NormalizedEvent[], etag: etags[city] };
    const evs = findEvents(extractJsonLd(r.text)).map(e => normalizeSchemaEvent(e, url)).filter((x): x is NormalizedEvent => !!x);
    return { city, items: evs, etag: r.etag ?? undefined };
  });
  const items: NormalizedEvent[] = [];
  const newEtags: Record<string, string> = {};
  let failures = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') { fetched += r.value.items.length; items.push(...r.value.items); if (r.value.etag) newEtags[r.value.city] = r.value.etag; }
    else { failures++; notes.push(`${cities[i]}: ${(r.reason as Error).message}`); }
  });
  if (failures === cities.length) throw new Error(`All District city pages failed: ${notes.join('; ')}`);
  return { items: items.filter(isIndia), fetched, cursor: { etags: newEtags }, notes };
};

const TOUR_WORDS = /\b(india tour|tour|concert|live in|to perform|performing|gig|announces?|returns? to india|headline)\b/i;
const PAST_WORDS = /\b(review|recap|crowd went|last night|was held|performed|relived|throwback|highlights)\b/i;
const CITY_RE = new RegExp(`\\b(${INDIA_CITY_NAMES.join('|')})\\b`, 'i');

/**
 * Rule-based reading used when Gemini is unavailable. Only headlines that name the artist AND
 * an upcoming-sounding tour/concert phrase count; dates are never guessed (always TBA).
 */
export function headlineFallback(artist: string, items: { title: string; description: string }[]): Extracted[] {
  const k = nameKey(artist);
  return items.flatMap((it, index) => {
    const text = `${it.title} ${it.description}`;
    if (!` ${nameKey(text)} `.includes(` ${k} `) || !TOUR_WORDS.test(it.title) || PAST_WORDS.test(it.title)) return [];
    const city = it.title.match(CITY_RE)?.[1] ?? null;
    if (!city && !/\bindia\b/i.test(it.title)) return [];
    return [{
      index, is_india_event_announcement: true, artist, event_name: `${artist}${/tour/i.test(it.title) ? ' - India tour' : ' live'}`,
      event_type: /tour/i.test(it.title) ? 'tour' as const : 'concert' as const, city, country: 'IN', venue: null, start_date: null,
      ticket_status: 'announced' as const, early_bird: null, evidence_excerpt: it.title.slice(0, 200), confidence: 0.6, uncertain_fields: ['start_date', 'venue'],
    }];
  });
}

/** Google News RSS per artist (rotating batch) → Gemini structured extraction. */
const googleNews: Adapter = async (src, artists) => {
  if (!artists.length) return { items: [], fetched: 0, notes: ['No artists in watchlist'] };
  const per = Number(src.config.artists_per_run ?? 5);
  const offset = Number(src.cursor.offset ?? 0) % artists.length;
  const batch = [...artists.slice(offset), ...artists.slice(0, offset)].slice(0, per);
  const items: NormalizedEvent[] = [];
  const notes: string[] = [];
  let fetched = 0;
  const cutoff = Date.now() - 45 * 86400_000;
  const res = await mapLimit(batch, 2, async (a) => {
    const q = encodeURIComponent(`"${a.name}" (concert OR tour OR tickets OR festival) India when:30d`);
    const { text } = await fetchText(`https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`);
    const rss = parseRss(text).filter(i => !i.pubDate || Date.parse(i.pubDate) > cutoff).slice(0, 8);
    fetched += rss.length;
    if (!rss.length) return;
    const hash = await sha(rss.map(i => i.link).join('|'));
    const [prev] = await db()`select content_hash from radar.source_documents where source_id = 'google_news' and doc_key = ${a.id}`;
    if (prev?.content_hash === hash) return; // unchanged → no repeated AI processing
    let extracted: Extracted[];
    try { extracted = await extractFromNews(a.name, rss); }
    catch (e) {
      if (!(e instanceof GeminiError)) throw e;
      extracted = headlineFallback(a.name, rss); // Gemini quota/overload → conservative rule-based reading
    }
    for (const x of extracted) {
      const it = rss[x.index];
      if (!x.is_india_event_announcement || x.confidence < 0.6 || !it) continue;
      const startAt = x.start_date ? new Date(`${x.start_date}T00:00:00+05:30`).toISOString() : null;
      if (startAt && Date.parse(startAt) < Date.now() - 86400_000) continue;
      items.push({
        title: x.event_name ?? `${a.name} live`, artistHint: a.name, eventType: x.event_type ?? 'concert',
        city: canonicalCity(x.city), country: x.country ?? 'IN', venue: x.venue, startAt, endAt: null, timeKnown: false,
        ticketStatus: x.ticket_status === 'unknown' ? 'announced' : x.ticket_status,
        priceMin: null, currency: null, earlyBird: x.early_bird, earlyBirdDeadline: null,
        bookingUrl: null, officialUrl: it.link, externalId: it.link, sourceUrl: it.link,
        excerpt: x.evidence_excerpt ?? it.title, publishedAt: it.pubDate ? new Date(it.pubDate).toISOString() : null,
        verification: 'reported_news', confidence: Math.min(x.confidence, 0.8),
      });
    }
    await db()`insert into radar.source_documents (source_id, doc_key, content_hash, result) values ('google_news', ${a.id}, ${hash}, ${db().json(extracted as never)})
      on conflict (source_id, doc_key) do update set content_hash = excluded.content_hash, result = excluded.result, processed_at = now()`;
  });
  let geminiFailures = 0;
  res.forEach((r, i) => { if (r.status === 'rejected') { notes.push(`${batch[i].name}: ${(r.reason as Error).message}`); if (r.reason instanceof GeminiError) geminiFailures++; } });
  if (res.length && res.every(r => r.status === 'rejected')) throw new Error(notes.join('; '));
  return { items: items.filter(isIndia), fetched, cursor: { offset: (offset + per) % artists.length }, notes: geminiFailures ? [...notes, `${geminiFailures} Gemini failure(s)`] : notes };
};

/** Official tour pages saved on artists → schema.org events (performer = that artist). */
const officialPages: Adapter = async (_src, artists) => {
  const withUrl = artists.filter(a => a.official_tour_url);
  if (!withUrl.length) return { items: [], fetched: 0, notes: ['No artist has an official tour URL yet'] };
  const items: NormalizedEvent[] = []; const notes: string[] = []; let fetched = 0;
  const res = await mapLimit(withUrl.slice(0, 10), 3, async (a) => {
    const url = a.official_tour_url!;
    const { text } = await fetchText(url);
    const evs = findEvents(extractJsonLd(text)).map(e => normalizeSchemaEvent(e, url)).filter((x): x is NormalizedEvent => !!x);
    fetched += evs.length;
    for (const e of evs) items.push({ ...e, artistHint: a.name });
  });
  res.forEach((r, i) => r.status === 'rejected' && notes.push(`${withUrl[i].name}: ${(r.reason as Error).message}`));
  return { items: items.filter(isIndia), fetched, notes };
};

/* ───────────── Readers for public sites without an API (robots.txt always respected) ───────────── */

const robotsCache = new Map<string, string>();
async function politeFetch(url: string, init: Parameters<typeof fetchText>[1] = {}) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    const txt = await fetchText(`${u.origin}/robots.txt`, { timeoutMs: 8000 }).then(r => r.text).catch(() => '');
    robotsCache.set(u.origin, txt);
  }
  if (!robotsAllows(robotsCache.get(u.origin)!, u.pathname)) throw new Error(`robots.txt disallows ${u.host}${u.pathname}`);
  return fetchText(url, init);
}

const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

/**
 * SkillBox: its pages are JavaScript-only, but robots.txt advertises public event sitemaps whose
 * page names carry the artist, venue and city. Recently updated entries are matched to the
 * watchlist; dates aren't in the sitemap, so these show as "Date TBA" with a link to the page.
 */
const skillbox: Adapter = async (src, artists) => {
  const maxAgeDays = Number(src.config.max_age_days ?? 14);
  const etag = src.cursor.etag as string | undefined;
  const r = await politeFetch('https://www.skillboxes.com/media/sitemap/sitemap-ticket.xml', { timeoutMs: 20_000, headers: etag ? { 'if-none-match': etag } : {} });
  if (r.status === 304) return { items: [], fetched: 0, cursor: { etag } };
  const cutoff = Date.now() - maxAgeDays * 86400_000;
  const entries = [...r.text.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)]
    .map(m => ({ loc: m[1].trim(), lastmod: m[2] ? Date.parse(m[2]) : NaN }))
    .filter(e => Number.isFinite(e.lastmod) && e.lastmod > cutoff);
  const watch = artists.map(a => ({ id: a.id, name: a.name, aliases: a.aliases }));
  const items: NormalizedEvent[] = [];
  for (const e of entries) {
    const slug = decodeURIComponent(e.loc.split('/').filter(Boolean).pop() ?? '').replace(/-[a-z0-9]{6,10}$/i, '');
    const words = slug.replace(/-/g, ' ');
    const city = words.match(CITY_RE)?.[1] ?? null;
    for (const { artist } of matchArtists(words, watch)) {
      items.push({
        title: titleCase(words), artistHint: artist.name, eventType: 'concert', city: canonicalCity(city), country: 'IN', venue: null,
        startAt: null, endAt: null, timeKnown: false, ticketStatus: 'unknown', priceMin: null, currency: null, earlyBird: null, earlyBirdDeadline: null,
        bookingUrl: e.loc, officialUrl: e.loc, externalId: e.loc, sourceUrl: e.loc, excerpt: `SkillBox listing: ${words}`,
        publishedAt: new Date(e.lastmod).toISOString(), verification: 'unverified', confidence: 0.65,
      });
    }
  }
  return { items, fetched: entries.length, cursor: { etag: r.etag ?? undefined } };
};

/**
 * Music press RSS (Rolling Stone India, Indian Express, The Hindu, News18, Mid-day, HT, Homegrown):
 * every headline is checked against every watched artist with the same conservative rules as the
 * news fallback - artist named + upcoming tour/concert wording + an Indian city or "India".
 */
const musicPress: Adapter = async (src, artists) => {
  const feeds = (src.config.feeds as string[] | undefined) ?? [];
  const cutoff = Date.now() - 30 * 86400_000;
  const notes: string[] = [];
  const all: RssItem[] = [];
  const res = await mapLimit(feeds, 3, async f => parseRss((await politeFetch(f, { timeoutMs: 12_000 })).text));
  res.forEach((r, i) => r.status === 'fulfilled' ? all.push(...r.value) : notes.push(`${new URL(feeds[i]).host}: ${(r.reason as Error).message}`));
  if (feeds.length && res.every(r => r.status === 'rejected')) throw new Error(notes.join('; '));
  const recent = all.filter(i => !i.pubDate || Date.parse(i.pubDate) > cutoff);
  const keyed = recent.map(i => ({ i, k: ` ${nameKey(`${i.title} ${i.description}`)} ` }));
  const items: NormalizedEvent[] = [];
  for (const a of artists) {
    const keys = [a.name, ...a.aliases].map(nameKey).filter(k => k.length >= 4);
    const hits = keyed.filter(x => keys.some(k => x.k.includes(` ${k} `))).map(x => x.i);
    for (const x of headlineFallback(a.name, hits)) {
      const it = hits[x.index];
      items.push({
        title: x.event_name ?? `${a.name} live`, artistHint: a.name, eventType: x.event_type ?? 'concert', city: canonicalCity(x.city), country: 'IN',
        venue: null, startAt: null, endAt: null, timeKnown: false, ticketStatus: 'announced', priceMin: null, currency: null, earlyBird: null, earlyBirdDeadline: null,
        bookingUrl: null, officialUrl: it.link, externalId: it.link, sourceUrl: it.link, excerpt: it.title.slice(0, 200),
        publishedAt: it.pubDate ? new Date(it.pubDate).toISOString() : null, verification: 'reported_news', confidence: 0.6,
      });
    }
  }
  return { items: items.filter(isIndia), fetched: recent.length, notes };
};

export const ADAPTERS: Record<string, Adapter> = { district, google_news: googleNews, official_pages: officialPages, skillbox, music_press: musicPress };
