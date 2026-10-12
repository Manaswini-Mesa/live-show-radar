import { describe, expect, it } from 'vitest';
import { canonicalCity, dedupeKey, detectChanges, formatAlert, isIndia, matchArtists, nameKey, schemaAvailability, type NormalizedEvent } from '../src/lib/core';
import { extractJsonLd, findEvents, normalizeSchemaEvent, parseRss } from '../src/lib/parsers';

// Fixtures are synthetic and only exercise parsing/matching logic — they are not evidence of live discovery.
const DISTRICT_FIXTURE = `<html><script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
 {"@type":"ListItem","position":1,"item":{"@type":"Event","name":"Sonu Nigam - The Revolution India Tour | Bengaluru ","url":"https://www.district.in/events/x","eventStatus":"https://schema.org/EventScheduled",
  "location":{"@type":"Place","name":"Bhartiya Mall Of Bengaluru","address":{"@type":"PostalAddress","addressLocality":"Bengaluru","addressCountry":"IN"}},
  "startDate":"2026-10-24T13:30:00.000Z","offers":{"@type":"Offer","url":"https://www.district.in/events/x","price":"3599","priceCurrency":"INR","availability":"https://schema.org/InStock"}}},
 {"@type":"ListItem","position":2,"item":{"@type":"Event","name":"Some Show | Dubai","url":"https://example.com/d","location":{"@type":"Place","name":"Arena","address":{"addressLocality":"Dubai","addressCountry":"AE"}},"startDate":"2026-11-01T15:00:00Z"}}
]}</script><script type="application/ld+json">{ not json</script></html>`;

const artists = [
  { id: 'a1', name: 'Sonu Nigam', aliases: [] },
  { id: 'a2', name: 'Prateek Kuhad', aliases: ['Prateek'] },
  { id: 'a3', name: 'Live', aliases: [] },
];

describe('nameKey & matching', () => {
  it('normalises accents, case and punctuation', () => {
    expect(nameKey('  Beyoncé & Jay-Z ')).toBe('beyonce and jay z');
  });
  it('matches whole words only', () => {
    expect(matchArtists('Sonu Nigam - The Revolution India Tour', artists).map(m => m.artist.id)).toEqual(['a1']);
    expect(matchArtists('Sonunigam fan night', artists)).toHaveLength(0);
  });
  it('does not match short/generic names from titles but does via explicit performer hint', () => {
    expect(matchArtists('Live music night', artists)).toHaveLength(0);
    expect(matchArtists('Whatever', artists, 'Live').map(m => m.artist.id)).toEqual(['a3']);
  });
  it('matches aliases', () => {
    expect(matchArtists('Prateek – Silhouettes Tour Pune', artists)[0].reason).toMatch(/alias/);
  });
});

describe('District JSON-LD parsing & India filter', () => {
  const evs = findEvents(extractJsonLd(DISTRICT_FIXTURE)).map(e => normalizeSchemaEvent(e, 'https://www.district.in/events/music-in-bengaluru-book-tickets')!);
  it('skips malformed blocks and extracts events', () => {
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ city: 'Bengaluru', venue: 'Bhartiya Mall Of Bengaluru', ticketStatus: 'on_sale', priceMin: 3599, currency: 'INR', timeKnown: true, verification: 'verified_structured' });
  });
  it('keeps India and drops other countries', () => {
    expect(evs.filter(isIndia).map(e => e.city)).toEqual(['Bengaluru']);
    expect(isIndia({ country: null, city: 'Bangalore' })).toBe(true);
    expect(isIndia({ country: null, city: 'Dubai' })).toBe(false);
  });
  it('maps schema.org availability', () => {
    expect(schemaAvailability('https://schema.org/SoldOut')).toBe('sold_out');
    expect(schemaAvailability(null, 'https://schema.org/EventCancelled')).toBe('cancelled');
    expect(schemaAvailability('https://schema.org/PreOrder')).toBe('not_yet_on_sale');
  });
});

describe('dedupe', () => {
  const base = { city: 'Bangalore', startAt: '2026-10-24T13:30:00.000Z' };
  it('same artist + same city (alias) + same IST day → same key', () => {
    expect(dedupeKey('a1', base)).toBe(dedupeKey('a1', { city: 'Bengaluru', startAt: '2026-10-24T09:00:00.000Z' }));
  });
  it('different day, city or artist → different key', () => {
    expect(dedupeKey('a1', base)).not.toBe(dedupeKey('a1', { ...base, startAt: '2026-10-25T13:30:00.000Z' }));
    expect(dedupeKey('a1', base)).not.toBe(dedupeKey('a1', { ...base, city: 'Mumbai' }));
    expect(dedupeKey('a1', base)).not.toBe(dedupeKey('a2', base));
  });
  it('uses the IST calendar day, not UTC', () => {
    // 20:00 UTC on the 23rd is 01:30 IST on the 24th
    expect(dedupeKey('a1', { city: 'Mumbai', startAt: '2026-10-23T20:00:00Z' })).toContain('2026-10-24');
  });
  it('canonicalises city names', () => { expect(canonicalCity('gurgaon')).toBe('Gurugram'); });
});

describe('change detection', () => {
  const stored = { title: 'X', city: 'Pune', venue: 'Arena', start_at: '2026-11-01T14:00:00.000Z', ticket_status: 'not_yet_on_sale', price_min: 1500, booking_url: null, early_bird: null, early_bird_deadline: null };
  const fresh = (o: Partial<NormalizedEvent>): NormalizedEvent => ({ title: 'X', eventType: 'concert', city: 'Pune', country: 'IN', venue: 'Arena', startAt: '2026-11-01T14:00:00.000Z', endAt: null, timeKnown: true, ticketStatus: 'not_yet_on_sale', priceMin: 1500, currency: 'INR', earlyBird: null, earlyBirdDeadline: null, bookingUrl: null, officialUrl: null, externalId: null, sourceUrl: 'u', excerpt: null, publishedAt: null, verification: 'verified_structured', confidence: 0.9, ...o });
  it('no change → nothing', () => { expect(detectChanges(stored, fresh({}))).toEqual([]); });
  it('detects on-sale, booking link, price, venue, date', () => {
    const kinds = detectChanges(stored, fresh({ ticketStatus: 'on_sale', bookingUrl: 'https://b', priceMin: 1999, venue: 'Stadium', startAt: '2026-11-02T14:00:00.000Z' })).map(c => c.kind).sort();
    expect(kinds).toEqual(['booking_link', 'date_change', 'price_change', 'ticket_status', 'venue_change']);
  });
  it('cancellation is its own kind', () => { expect(detectChanges(stored, fresh({ ticketStatus: 'cancelled' }))[0].kind).toBe('cancelled'); });
  it('unknown values never count as changes', () => { expect(detectChanges(stored, fresh({ ticketStatus: 'unknown', venue: null, priceMin: null, startAt: null }))).toEqual([]); });
});

describe('alert formatting', () => {
  it('includes required fields and escapes HTML', () => {
    const m = formatAlert({ kind: 'new_show', artist: 'A<b>', title: 'T', city: 'Pune', venue: null, startAt: '2026-11-01T14:00:00Z', timeKnown: true, ticketStatus: 'on_sale', earlyBird: null, lastVerified: '2026-10-12T00:00:00Z', source: 'District', link: 'https://x', reason: 'r' });
    expect(m).toContain('NEW SHOW DETECTED');
    expect(m).toContain('A&lt;b&gt;');
    expect(m).toContain('Direct booking link');
    expect(m).toContain('7:30 pm IST');
  });
});

describe('RSS parsing', () => {
  it('parses items and CDATA', () => {
    const xml = `<rss><channel><item><title><![CDATA[Prateek Kuhad announces India tour]]></title><link>https://n/1</link><pubDate>Mon, 12 Oct 2026 07:00:00 GMT</pubDate><source url="x">Rolling Stone India</source><description>&lt;a&gt;x&lt;/a&gt;</description></item></channel></rss>`;
    expect(parseRss(xml)).toEqual([{ title: 'Prateek Kuhad announces India tour', link: 'https://n/1', pubDate: 'Mon, 12 Oct 2026 07:00:00 GMT', source: 'Rolling Stone India', description: 'x' }]);
  });
});

describe('notification kinds', () => {
  it('tickets-live alert has its own header', () => {
    const m = formatAlert({ kind: 'tickets_live', artist: 'A', title: 'T', city: 'Pune', venue: 'V', startAt: null, timeKnown: false, ticketStatus: 'on_sale', earlyBird: null, lastVerified: '2026-10-12T00:00:00Z', source: 'District', link: 'https://x', reason: 'r' });
    expect(m).toContain('TICKETS ARE LIVE');
    expect(m).toContain('Date TBA');
  });
});

import { robotsAllows } from '../src/lib/robots';
describe('robots.txt', () => {
  const r = `User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin/\nDisallow: /*?\nAllow: /admin/public$\n`;
  it('applies only the * group', () => { expect(robotsAllows(r, '/events')).toBe(true); });
  it('honours disallow, wildcards and longest match', () => {
    expect(robotsAllows(r, '/admin/x')).toBe(false);
    expect(robotsAllows(r, '/search?q=1')).toBe(false);
    expect(robotsAllows(r, '/admin/public')).toBe(true);
  });
  it('empty robots allows everything', () => { expect(robotsAllows('', '/anything')).toBe(true); });
});

import { isTributeOrCover } from '../src/lib/core';
describe('tribute filter', () => {
  it('flags tribute and cover nights', () => {
    for (const t of ['Tribute To Arijit Singh Ft South Side Nirvana', 'The Iron Maiden Experience Ft Maiden Voyage', 'Jai Ho A R Rahman Revival Ft Trisha Vox Live', 'Dandiya Night Ft Vdj Shaan']) expect(isTributeOrCover(t)).toBe(true);
  });
  it('keeps real shows', () => {
    for (const t of ['Seedhe Maut India Tour Delhi', 'Job Kurian Live', "Darshan Raval's Love Letters India Tour | Bengaluru"]) expect(isTributeOrCover(t)).toBe(false);
  });
});
