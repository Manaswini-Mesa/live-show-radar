// Pure, dependency-free logic (unit-tested in tests/core.test.ts).

export type Artist = { id: string; name: string; aliases: string[] };

export type NormalizedEvent = {
  title: string;
  artistHint?: string | null;        // explicit artist name from the source, if any
  eventType: 'concert' | 'festival' | 'tour' | 'other';
  city: string | null;
  country: string | null;
  venue: string | null;
  startAt: string | null;            // ISO UTC
  endAt: string | null;
  timeKnown: boolean;
  ticketStatus: TicketStatus;
  priceMin: number | null;
  currency: string | null;
  earlyBird: string | null;
  earlyBirdDeadline: string | null;
  bookingUrl: string | null;
  officialUrl: string | null;
  externalId: string | null;
  sourceUrl: string;
  excerpt: string | null;
  publishedAt: string | null;
  verification: 'verified_structured' | 'reported_news' | 'unverified';
  confidence: number;
};

export type TicketStatus = 'on_sale' | 'not_yet_on_sale' | 'sold_out' | 'cancelled' | 'postponed' | 'announced' | 'unknown';

export function nameKey(s: string): string {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

const GENERIC = new Set(['the', 'live', 'music', 'band', 'dj', 'india', 'tour', 'concert', 'festival', 'show']);

/**
 * Match an event title/hint against the watchlist using whole-word matching on the
 * normalised artist name or alias. Very short or generic names need an exact hint
 * match to avoid false positives (e.g. an artist called "Live").
 */
export function matchArtists(text: string, artists: Artist[], hint?: string | null): { artist: Artist; reason: string }[] {
  const hay = ` ${nameKey(text)} `;
  const hintKey = hint ? nameKey(hint) : '';
  const out: { artist: Artist; reason: string }[] = [];
  for (const a of artists) {
    for (const n of [a.name, ...a.aliases]) {
      const k = nameKey(n);
      if (!k) continue;
      if (hintKey && hintKey === k) { out.push({ artist: a, reason: `Source lists performer "${hint}" which equals ${n === a.name ? 'watched artist' : 'alias'} "${n}"` }); break; }
      const weak = k.length < 4 || GENERIC.has(k);
      if (!weak && hay.includes(` ${k} `)) { out.push({ artist: a, reason: `Event title contains ${n === a.name ? 'watched artist' : 'alias'} "${n}" as a whole word` }); break; }
    }
  }
  return out;
}

export const INDIA_CITY_NAMES = ['Bengaluru', 'Bangalore', 'Mumbai', 'Delhi', 'New Delhi', 'Gurugram', 'Gurgaon', 'Noida', 'Hyderabad', 'Pune', 'Chennai', 'Kolkata', 'Goa', 'Ahmedabad', 'Jaipur', 'Chandigarh', 'Kochi', 'Lucknow', 'Indore', 'Shillong', 'Guwahati', 'Surat', 'Vadodara', 'Nagpur', 'Mysuru', 'Mysore', 'Coimbatore', 'Visakhapatnam', 'Bhubaneswar', 'Dehradun', 'Udaipur', 'Navi Mumbai', 'Thane'];
const INDIA_CITIES = ['bengaluru', 'bangalore', 'mumbai', 'delhi', 'new delhi', 'gurugram', 'gurgaon', 'noida', 'hyderabad', 'pune', 'chennai', 'kolkata', 'goa', 'ahmedabad', 'jaipur', 'chandigarh', 'kochi', 'lucknow', 'indore', 'shillong', 'guwahati', 'surat', 'vadodara', 'nagpur', 'mysuru', 'mysore', 'thiruvananthapuram', 'coimbatore', 'visakhapatnam', 'bhubaneswar', 'dehradun', 'udaipur', 'navi mumbai', 'thane'];

/** Tribute / cover / revival nights are not the artist performing - never treat them as the artist's show. */
export const TRIBUTE_RE = /\b(tribute|tributes|revival|cover band|covers night|the [a-z0-9 ]+ experience|unplugged by|songs of|night of|vdj|dj night|karaoke|screening)\b/i;
export const isTributeOrCover = (title: string) => TRIBUTE_RE.test(title);

export function isIndia(ev: Pick<NormalizedEvent, 'country' | 'city'>): boolean {
  const c = (ev.country ?? '').trim().toLowerCase();
  if (c === 'in' || c === 'india' || c === 'ind') return true;
  if (c) return false;
  return !!ev.city && INDIA_CITIES.includes(nameKey(ev.city));
}

export function canonicalCity(city: string | null): string | null {
  if (!city) return null;
  const k = nameKey(city);
  const map: Record<string, string> = { bangalore: 'Bengaluru', bengaluru: 'Bengaluru', gurgaon: 'Gurugram', 'new delhi': 'Delhi', 'delhi ncr': 'Delhi', mysore: 'Mysuru', bombay: 'Mumbai' };
  return map[k] ?? city.trim().replace(/\b\w/g, m => m.toUpperCase());
}

/** IST calendar day (YYYY-MM-DD) for an ISO instant. */
export function istDay(iso: string | null): string {
  if (!iso) return 'tba';
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Canonical identity of a show: one artist, one city, one local day.
 * Two listings only merge when all three agree - similar names alone never merge.
 */
export function dedupeKey(artistId: string, ev: Pick<NormalizedEvent, 'city' | 'startAt'>): string {
  return `${artistId}|${nameKey(canonicalCity(ev.city) ?? 'unknown')}|${istDay(ev.startAt)}`;
}

export function schemaAvailability(av?: string | null, status?: string | null): TicketStatus {
  const s = `${status ?? ''} ${av ?? ''}`.toLowerCase();
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('postpon') || s.includes('rescheduled')) return 'postponed';
  if (s.includes('soldout') || s.includes('sold_out') || s.includes('outofstock')) return 'sold_out';
  if (s.includes('preorder') || s.includes('presale')) return 'not_yet_on_sale';
  if (s.includes('instock') || s.includes('limitedavailability')) return 'on_sale';
  return 'unknown';
}

export type StoredEvent = {
  title: string; city: string | null; venue: string | null; start_at: string | Date | null;
  ticket_status: string; price_min: string | number | null; booking_url: string | null;
  early_bird: string | null; early_bird_deadline: string | Date | null;
};

export type Change = { field: string; oldValue: string | null; newValue: string | null; kind: string };

const iso = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);

/**
 * Evidence-backed meaningful changes between a stored event and a fresh observation.
 * Unknown/missing values in the new observation never overwrite known ones.
 */
export function detectChanges(old: StoredEvent, fresh: NormalizedEvent): Change[] {
  const ch: Change[] = [];
  if (fresh.startAt && iso(old.start_at) && iso(old.start_at) !== iso(fresh.startAt))
    ch.push({ field: 'start_at', oldValue: iso(old.start_at), newValue: iso(fresh.startAt), kind: 'date_change' });
  if (fresh.venue && old.venue && nameKey(old.venue) !== nameKey(fresh.venue))
    ch.push({ field: 'venue', oldValue: old.venue, newValue: fresh.venue, kind: 'venue_change' });
  if (fresh.ticketStatus !== 'unknown' && old.ticket_status !== fresh.ticketStatus) {
    const kind = ['cancelled', 'postponed', 'sold_out'].includes(fresh.ticketStatus) ? fresh.ticketStatus : 'ticket_status';
    ch.push({ field: 'ticket_status', oldValue: old.ticket_status, newValue: fresh.ticketStatus, kind });
  }
  if (fresh.priceMin != null && old.price_min != null && Number(old.price_min) !== fresh.priceMin)
    ch.push({ field: 'price_min', oldValue: String(old.price_min), newValue: String(fresh.priceMin), kind: 'price_change' });
  if (fresh.bookingUrl && !old.booking_url)
    ch.push({ field: 'booking_url', oldValue: null, newValue: fresh.bookingUrl, kind: 'booking_link' });
  if (fresh.earlyBird && fresh.earlyBird !== old.early_bird)
    ch.push({ field: 'early_bird', oldValue: old.early_bird, newValue: fresh.earlyBird, kind: 'early_bird' });
  if (fresh.earlyBirdDeadline && iso(fresh.earlyBirdDeadline) !== iso(old.early_bird_deadline))
    ch.push({ field: 'early_bird_deadline', oldValue: iso(old.early_bird_deadline), newValue: iso(fresh.earlyBirdDeadline), kind: 'early_bird' });
  return ch;
}

export function fmtIST(isoStr: string | Date | null, timeKnown = true): string {
  if (!isoStr) return 'Date TBA';
  const d = new Date(isoStr);
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', ...(timeKnown ? { hour: 'numeric', minute: '2-digit' } : {}) }) + (timeKnown ? ' IST' : ' (time TBA)');
}

const TICKET_LABEL: Record<string, string> = { on_sale: 'On sale', not_yet_on_sale: 'Not yet on sale', sold_out: 'Sold out', cancelled: 'Cancelled', postponed: 'Postponed', announced: 'Announced (no ticket link yet)', unknown: 'Unknown' };
export const ticketLabel = (s: string) => TICKET_LABEL[s] ?? s;

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

export function formatAlert(p: {
  kind: 'new_show' | 'update' | 'tickets_live'; artist: string; title: string; city: string | null; venue: string | null;
  startAt: string | Date | null; timeKnown: boolean; ticketStatus: string; earlyBird: string | null;
  lastVerified: string | Date; source: string; link: string | null; reason: string; changes?: Change[];
}): string {
  const lines = [
    `<b>${p.kind === 'new_show' ? '🎤 NEW SHOW DETECTED' : p.kind === 'tickets_live' ? '🎟 TICKETS ARE LIVE' : '🔔 SHOW UPDATE'}</b>`,
    `<b>Artist:</b> ${esc(p.artist)}`,
    `<b>Event:</b> ${esc(p.title)}`,
    `<b>City:</b> ${esc(p.city ?? 'Unknown')}`,
    `<b>Venue:</b> ${esc(p.venue ?? 'Unknown')}`,
    `<b>Date and local time:</b> ${esc(fmtIST(p.startAt, p.timeKnown))}`,
    `<b>Ticket status:</b> ${esc(ticketLabel(p.ticketStatus))}`,
  ];
  if (p.earlyBird) lines.push(`<b>Early-bird:</b> ${esc(p.earlyBird)}`);
  if (p.changes?.length) lines.push(`<b>What changed:</b> ${esc(p.changes.map(c => `${c.field}: ${c.oldValue ?? '-'} → ${c.newValue ?? '-'}`).join('; '))}`);
  lines.push(`<b>Last verified:</b> ${esc(fmtIST(p.lastVerified))}`, `<b>Source:</b> ${esc(p.source)}`);
  lines.push(`<b>${p.ticketStatus === 'on_sale' ? 'Direct booking link' : 'Official link'}:</b> ${p.link ? esc(p.link) : 'Not available yet'}`);
  lines.push(`<i>Why: ${esc(p.reason)}</i>`);
  return lines.join('\n');
}
