// Pure parsers for external content (unit-tested). External content is untrusted data.
import { canonicalCity, schemaAvailability, type NormalizedEvent } from './core';

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1])); } catch { /* skip malformed blocks */ }
  }
  return out;
}

/** Flatten JSON-LD (arrays, @graph, ItemList) into schema.org Event-like nodes. */
export function findEvents(nodes: unknown[]): Json[] {
  const res: Json[] = [];
  const visit = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== 'object') return;
    const o = n as Json;
    const t = ([] as unknown[]).concat(o['@type'] ?? []).map(String);
    if (t.some(x => /Event$/.test(x))) res.push(o);
    if (o['@graph']) visit(o['@graph']);
    if (o.itemListElement) visit(o.itemListElement);
    if (o.item) visit(o.item);
    if (o.subEvent) visit(o.subEvent);
  };
  nodes.forEach(visit);
  return res;
}

export function normalizeSchemaEvent(e: Json, sourceUrl: string): NormalizedEvent | null {
  const title = str(e.name);
  if (!title) return null;
  const loc = (Array.isArray(e.location) ? e.location[0] : e.location) as Json | undefined;
  const addr = (loc?.address ?? {}) as Json;
  const offers = ([] as unknown[]).concat(e.offers ?? []) as Json[];
  const prices = offers.map(o => Number(o.price ?? o.lowPrice)).filter(n => Number.isFinite(n) && n > 0);
  const performer = ([] as unknown[]).concat(e.performer ?? [])[0] as Json | undefined;
  const startAt = str(e.startDate);
  const url = str(e.url) ?? str(offers[0]?.url) ?? sourceUrl;
  const t = String(e['@type'] ?? '');
  return {
    title: title.replace(/\s+/g, ' '),
    artistHint: str(performer?.name),
    eventType: /festival/i.test(t + ' ' + title) ? 'festival' : 'concert',
    city: canonicalCity(str(addr.addressLocality) ?? str(addr.addressRegion)),
    country: str(addr.addressCountry) ?? (typeof addr.addressCountry === 'object' ? str((addr.addressCountry as Json)?.name) : null),
    venue: str(loc?.name),
    startAt: startAt && !Number.isNaN(Date.parse(startAt)) ? new Date(startAt).toISOString() : null,
    endAt: str(e.endDate) && !Number.isNaN(Date.parse(String(e.endDate))) ? new Date(String(e.endDate)).toISOString() : null,
    timeKnown: !!startAt && /T\d{2}:\d{2}/.test(startAt),
    ticketStatus: schemaAvailability(str(offers[0]?.availability), str(e.eventStatus)),
    priceMin: prices.length ? Math.min(...prices) : null,
    currency: str(offers[0]?.priceCurrency),
    earlyBird: null,
    earlyBirdDeadline: null,
    bookingUrl: str(offers[0]?.url) ?? url,
    officialUrl: url,
    externalId: url,
    sourceUrl,
    excerpt: `${title} — ${str(loc?.name) ?? ''} ${startAt ?? ''}`.trim(),
    publishedAt: null,
    verification: 'verified_structured',
    confidence: 0.95,
  };
}

export type RssItem = { title: string; link: string; pubDate: string | null; source: string | null; description: string };

export function parseRss(xml: string): RssItem[] {
  const dec = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const tag = (block: string, t: string) => { const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? dec(m[1]).trim() : null; };
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({
    title: tag(m[1], 'title') ?? '',
    link: tag(m[1], 'link') ?? '',
    pubDate: tag(m[1], 'pubDate'),
    source: tag(m[1], 'source'),
    description: (tag(m[1], 'description') ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  })).filter(i => i.title && i.link);
}
