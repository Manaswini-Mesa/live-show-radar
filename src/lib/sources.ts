import 'server-only';
import type { NormalizedEvent } from './core';
import { canonicalCity, isIndia } from './core';
import { extractJsonLd, findEvents, normalizeSchemaEvent, parseRss } from './parsers';
import { fetchText, mapLimit, sha } from './http';
import { extractFromNews, GeminiError } from './gemini';
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
    const extracted = await extractFromNews(a.name, rss);
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

export const ADAPTERS: Record<string, Adapter> = { district, google_news: googleNews, official_pages: officialPages };
