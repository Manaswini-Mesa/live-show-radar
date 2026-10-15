'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type View = 'mine' | 'all' | 'bookings' | 'settings';

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `Something went wrong (${r.status})`), { status: r.status });
  return j;
}

const IST = (v: string, o: Intl.DateTimeFormatOptions) => new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...o });
const ago = (v?: string | null) => { if (!v) return 'not yet'; const s = (Date.now() - new Date(v).getTime()) / 1000; if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`; };
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const TICKET: Record<string, [string, string]> = {
  on_sale: ['🎟 On sale', 'bg-[#8fb39b] text-[#0f0f0f]'], not_yet_on_sale: ['⏳ Coming soon', 'bg-[#c9a96e] text-[#111111]'],
  sold_out: ['😢 Sold out', 'bg-[#a8865a] text-white'], cancelled: ['✖ Cancelled', 'bg-[#111111] text-white'],
  postponed: ['↻ Postponed', 'bg-[#9a7a52] text-white'], announced: ['📣 Announced', 'bg-[#5a5a5a] text-white'], unknown: ['✨ Listed', 'bg-[#7d8a99] text-[#0f0f0f]'],
};

export default function Dashboard() {
  const [view, setView] = useState<View>('mine');
  const [events, setEvents] = useState<Any[] | null>(null);
  const [artists, setArtists] = useState<Any[] | null>(null);
  const [city, setCity] = useState('Bengaluru');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const notify = useCallback((msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 5000); }, []);
  const load = useCallback(() => api('/api/events').then(j => setEvents(j.events)).catch(e => notify(e.message, false)), [notify]);
  const loadArtists = useCallback(() => api('/api/artists').then(j => setArtists(j.artists)).catch(() => setArtists([])), []);

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get('view') === 'settings' || sp.get('tab') === 'settings') setView('settings');
    const n = sp.get('notice'); if (n) { notify(n, !/fail|invalid|cancel|not configured|error/i.test(n)); history.replaceState(null, '', '/'); }
    load(); loadArtists();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load, loadArtists, notify]);

  const bookings = (events ?? []).filter(e => e.interest === 'interested' || e.confirmation); // My Bookings = shows you're interested in
  const favIds = new Set((artists ?? []).filter(a => a.priority).map(a => a.id));
  const reloadAll = () => { load(); loadArtists(); };
  const tabs: [View, string][] = [['mine', 'My Artists'], ['all', 'All Artists'], ['bookings', `My Bookings${bookings.length ? ` · ${bookings.length}` : ''}`]];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 text-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 py-5">
        <button onClick={() => setView('mine')} className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-[#c9a96e]/40 bg-[#0d0d0d]"><span className="eq scale-90"><i /><i /><i /><i /></span></span>
          <span className="text-left">
            <span className="font-display rainbow-text block text-2xl leading-none">KConcerts</span>
            <span className="text-[11px] text-muted">your artists · live across India</span>
          </span>
        </button>
        <nav className="glass flex items-center gap-1 p-1">
          {tabs.map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-full px-3.5 py-1.5 text-[13px] font-normal tracking-wide transition ${view === v ? 'bg-accent text-[#111111]' : 'text-white/70 hover:text-white'}`}>{l}</button>
          ))}
          <button onClick={() => setView('settings')} aria-label="Settings" className={`grid h-8 w-8 place-items-center rounded-full text-base transition hover:rotate-45 ${view === 'settings' ? 'bg-accent text-[#111111]' : 'text-white/70'}`}>⚙</button>
        </nav>
      </header>

      {(view === 'mine' || view === 'all') && (
        <Upcoming key={view} mode={view} events={events} artists={artists} favIds={favIds} city={city} setCity={setCity} reload={reloadAll} notify={notify} goSettings={() => setView('settings')} />
      )}
      {view === 'bookings' && <Bookings events={bookings} loaded={!!events} reload={load} notify={notify} goUpcoming={() => setView('mine')} />}
      {view === 'settings' && <Settings notify={notify} reloadEvents={reloadAll} />}

      {toast && <div className={`fixed bottom-6 left-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 rounded-2xl px-5 py-3 text-[13px] shadow-2xl ${toast.ok ? 'bg-[#f4efe6] text-[#0f0f0f]' : 'bg-[#a8865a] text-white'}`} style={{ animation: 'pop .35s both' }}>{toast.msg}</div>}
    </div>
  );
}

function Upcoming({ mode, events, artists, favIds, city, setCity, reload, notify, goSettings }: {
  mode: 'mine' | 'all'; events: Any[] | null; artists: Any[] | null; favIds: Set<string>; city: string; setCity: (c: string) => void;
  reload: () => void; notify: (m: string, ok?: boolean) => void; goSettings: () => void;
}) {
  const [q, setQ] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [sel, setSel] = useState<DateSel | null>(null);
  const cities = useMemo(() => [...new Set(['Bengaluru', ...(events ?? []).map(e => e.city).filter(Boolean)])].sort(), [events]);
  if (!events) return <Loading />;
  const scoped = mode === 'mine' ? events.filter(e => e.artists.some((a: Any) => favIds.has(a.id))) : events;
  const inRange = (e: Any) => !sel || (!!e.start_at && dayKey(e.start_at) >= sel.from && dayKey(e.start_at) <= sel.to);
  const cityQ = scoped.filter(e => (!city || e.city === city) && (!q || `${e.title} ${e.artists.map((a: Any) => a.name).join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  const showDays = new Set(cityQ.filter(e => e.start_at && e.interest !== 'not_interested').map(e => dayKey(e.start_at)));
  const all = cityQ.filter(inRange);
  const hidden = all.filter(e => e.interest === 'not_interested');
  const list = all.filter(e => e.interest !== 'not_interested');
  const where = `${city ? `in ${city}` : 'across India'}${sel ? ` · ${selLabel(sel).toLowerCase()}` : ''}`;
  return (
    <div className="space-y-5">
      <section className="glass relative z-20 p-5 sm:p-6">
        <p className="text-[11px] font-normal uppercase tracking-[.25em] text-accent">{mode === 'mine' ? 'My artists' : 'All artists'}</p>
        <h1 className="font-display mt-1 text-2xl sm:text-3xl">{list.length ? <>{list.length} show{list.length > 1 ? 's' : ''} <span className="rainbow-text">{where}</span></> : <>Nothing scheduled <span className="rainbow-text">{where}</span></>}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <input className="input max-w-[220px] py-1.5 text-[13px]" placeholder="Search artist or show" value={q} onChange={e => setQ(e.target.value)} />
          <select value={city} onChange={e => setCity(e.target.value)} className="rounded-full border border-white/10 bg-[#141415] px-3 py-1.5 text-[12px] font-light text-white/75 outline-none focus:border-[#c9a96e]">
            <option value="">All cities</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <DateRangeDropdown value={sel} onChange={setSel} showDays={showDays} />
        </div>
      </section>

      <ArtistStrip mode={mode} artists={artists} notify={notify} reload={reload} goSettings={goSettings} />


      {list.length === 0 ? (
        <div className="glass p-8 text-center">
          <p className="font-display text-xl">No shows {where} yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">{mode === 'mine' ? 'Connect Spotify in Settings, or star artists in All Artists.' : 'Try “All cities”, or check back - we look for new shows every 30 minutes.'}</p>
          {city && <button className="btn mt-4 text-[12px]" onClick={() => setCity('')}>Show all cities</button>}
        </div>
      ) : (
        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">{list.map((e, i) => <Ticket key={e.id} e={e} i={i} reload={reload} notify={notify} />)}</div>
      )}

      {hidden.length > 0 && (
        <div className="text-center">
          <button className="btn text-[12px]" onClick={() => setShowHidden(!showHidden)}>{showHidden ? 'Hide' : 'Show'} {hidden.length} not-interested show{hidden.length > 1 ? 's' : ''}</button>
          {showHidden && <div className="mt-4 grid gap-4 text-left md:grid-cols-2">{hidden.map((e, i) => <Ticket key={e.id} e={e} i={i} reload={reload} notify={notify} />)}</div>}
        </div>
      )}
    </div>
  );
}

function ArtistStrip({ mode, artists, notify, reload, goSettings }: { mode: 'mine' | 'all'; artists: Any[] | null; notify: (m: string, ok?: boolean) => void; reload: () => void; goSettings: () => void }) {
  const [open, setOpen] = useState(mode === 'mine'); // All Artists starts collapsed
  const [q, setQ] = useState('');
  if (!artists) return null;
  const shown = (mode === 'mine' ? artists.filter(a => a.priority) : artists).filter(a => !q || a.name.toLowerCase().includes(q.toLowerCase()));
  async function star(a: Any) {
    try { await api(`/api/artists/${a.id}`, { method: 'PATCH', body: JSON.stringify({ priority: !a.priority }) }); notify(a.priority ? `${a.name} removed from My Artists` : `${a.name} added to My Artists`); reload(); } catch (e: Any) { notify(e.message, false); }
  }
  return (
    <section className="glass p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={() => setOpen(!open)} className="text-[12px] uppercase tracking-[.2em] text-white/70 hover:text-white">{mode === 'mine' ? `My artists · ${shown.length}` : `All artists · ${artists.length}`} <span className="text-accent">{open ? '▴' : '▾'}</span></button>
        <div className="flex items-center gap-2">
          {open && <input className="input max-w-[180px] py-1 text-[12px]" placeholder="Find artist" value={q} onChange={e => setQ(e.target.value)} />}
          <button className="btn py-1 text-[12px]" onClick={goSettings}>Add / sync Spotify</button>
        </div>
      </div>
      {open && (
        <div className="mt-3 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
          {shown.length === 0 ? <p className="text-[12px] text-muted">{mode === 'mine' ? 'No favourites yet - open All Artists and tap ☆ to add some.' : 'No artists match.'}</p> : shown.map(a => (
            <button key={a.id} onClick={() => star(a)} title={a.priority ? 'Remove from My Artists' : 'Add to My Artists'}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-light transition ${a.priority ? 'border-[#c9a96e]/60 text-[#e6d5b0]' : 'border-white/10 text-white/65 hover:border-white/30'}`}>
              <span className={a.priority ? 'text-accent' : 'text-white/35'}>{a.priority ? '★' : '☆'}</span>{a.name}{a.event_count ? <span className="text-[10px] text-accent">{a.event_count}</span> : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

type DateSel = { from: string; to: string; preset?: string };

/** YYYY-MM-DD in India time. */
function dayKey(v: string | Date): string {
  return new Date(new Date(v).getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
const plusDays = (n: number) => dayKey(new Date(Date.now() + n * 86400_000));
const fmtDay = (k: string) => new Date(`${k}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const selLabel = (s: DateSel) => s.preset ?? (s.from === s.to ? fmtDay(s.from) : `${fmtDay(s.from)} - ${fmtDay(s.to)}`);

function presets(): [string, DateSel][] {
  const dow = new Date(Date.now() + 330 * 60_000).getUTCDay(); // 0 Sun … 6 Sat
  const weekend: [number, number] = dow === 0 ? [0, 0] : dow >= 5 ? [0, 7 - dow] : [5 - dow, 7 - dow];
  return [
    ['Today', { from: plusDays(0), to: plusDays(0), preset: 'Today' }],
    ['This weekend', { from: plusDays(weekend[0]), to: plusDays(weekend[1]), preset: 'This weekend' }],
    ['Next 7 days', { from: plusDays(0), to: plusDays(7), preset: 'Next 7 days' }],
    ['Next 30 days', { from: plusDays(0), to: plusDays(30), preset: 'Next 30 days' }],
    ['Next 3 months', { from: plusDays(0), to: plusDays(92), preset: 'Next 3 months' }],
  ];
}

/**
 * One dropdown for dates: quick presets plus a month calendar. Tap a start day, then an end day
 * (or the same day twice for a single date). Days with shows carry a gold dot.
 */
function DateRangeDropdown({ value, onChange, showDays }: { value: DateSel | null; onChange: (v: DateSel | null) => void; showDays: Set<string> }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState((value?.from ?? dayKey(new Date())).slice(0, 7));
  const [pick, setPick] = useState<string | null>(null); // first click of a custom range
  const [hover, setHover] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setPick(null); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const [y, m] = month.split('-').map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const shift = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  const today = dayKey(new Date());
  const lo = pick ? (hover && hover < pick ? hover : pick) : value?.from;
  const hi = pick ? (hover && hover > pick ? hover : pick) : value?.to;
  function choose(k: string) {
    if (!pick) { setPick(k); return; }
    const [from, to] = k < pick ? [k, pick] : [pick, k];
    onChange({ from, to }); setPick(null); setOpen(false);
  }
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-light transition ${value ? 'border-[#c9a96e]/70 text-[#e6d5b0]' : 'border-white/10 bg-[#141415] text-white/75'}`}>
        <span aria-hidden>📅</span>{value ? selLabel(value) : 'Any dates'}<span className="text-white/40">▾</span>
      </button>
      {value && <button onClick={() => onChange(null)} className="ml-1 text-[12px] text-white/40 hover:text-white" aria-label="Clear dates">✕</button>}
      {open && (
        <div className="fixed inset-x-4 top-28 z-50 mx-auto max-w-[340px] rounded-2xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[340px] border border-white/10 bg-[#141415] p-4 shadow-2xl" style={{ animation: 'pop .2s both' }}>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => { onChange(null); setOpen(false); setPick(null); }} className={`rounded-full border px-2.5 py-1 text-[11px] ${!value ? 'border-[#c9a96e] text-[#e6d5b0]' : 'border-white/10 text-white/65 hover:border-white/30'}`}>Any dates</button>
            {presets().map(([l, v]) => (
              <button key={l} onClick={() => { onChange(v); setOpen(false); setPick(null); }} className={`rounded-full border px-2.5 py-1 text-[11px] ${value?.preset === l ? 'border-[#c9a96e] text-[#e6d5b0]' : 'border-white/10 text-white/65 hover:border-white/30'}`}>{l}</button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <button className="px-2 text-white/60 hover:text-white" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
            <p className="font-display text-lg">{new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
            <button className="px-2 text-white/60 hover:text-white" onClick={() => shift(1)} aria-label="Next month">›</button>
          </div>
          <div className="mt-2 grid grid-cols-7 text-center text-[10px] uppercase tracking-widest text-white/35">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="py-1">{d}</span>)}</div>
          <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(null)}>
            {cells.map((k, i) => {
              if (!k) return <span key={`x${i}`} />;
              const inSel = !!lo && !!hi && k >= lo && k <= hi;
              const edge = k === lo || k === hi;
              return (
                <button key={k} disabled={k < today} onClick={() => choose(k)} onMouseEnter={() => setHover(k)}
                  className={`relative mx-auto grid h-9 w-9 place-items-center rounded-full text-[12px] transition disabled:opacity-25 ${edge ? 'bg-accent text-[#111]' : inSel ? 'bg-[#c9a96e]/20 text-[#e6d5b0]' : 'text-white/75 hover:bg-white/10'} ${k === today && !edge ? 'ring-1 ring-white/30' : ''}`}>
                  {Number(k.slice(8))}
                  {showDays.has(k) && <span className={`absolute bottom-1 h-1 w-1 rounded-full ${edge ? 'bg-[#111]' : 'bg-accent'}`} />}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-white/45">{pick ? 'Now tap the end date (or the same day again).' : 'Tap a start date, then an end date. Gold dots mark days with shows.'}</p>
        </div>
      )}
    </div>
  );
}

function Ticket({ e, i, reload, notify, booking }: { e: Any; i: number; reload: () => void; notify: (m: string, ok?: boolean) => void; booking?: boolean }) {
  const [busy, setBusy] = useState('');
  const artist = e.artists.map((a: Any) => a.name).join(' × ') || 'Live';
  const g = `grad-${hash(artist) % 5}`;
  const isNew = Date.now() - new Date(e.first_seen_at).getTime() < 48 * 3600_000;
  const [label, cls] = TICKET[e.ticket_status] ?? TICKET.unknown;
  const title = e.title.replace(/\s*\|\s*[^|]+$/, '').trim();
  async function interest(v: 'interested' | 'not_interested') {
    setBusy(v);
    try { await api(`/api/events/${e.id}/interest`, { method: 'POST', body: JSON.stringify({ interest: e.interest === v ? null : v }) }); reload(); } catch (err: Any) { notify(err.message, false); }
    setBusy('');
  }
  async function toggleNotify() {
    setBusy('notify');
    try { await api(`/api/events/${e.id}/notify`, { method: 'POST', body: JSON.stringify({ on: !e.notify_me }) }); notify(e.notify_me ? 'Notifications off for this show' : '🔔 We’ll message you on Telegram when the date or tickets are announced'); reload(); }
    catch (err: Any) { notify(err.message, false); }
    setBusy('');
  }
  async function going(c: 'booked' | 'attending') {
    setBusy(c);
    try {
      const r = await api(`/api/events/${e.id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmation: c, explicit: true }) });
      notify(r.duplicate ? 'Already in your Google Calendar 📅' : '📅 Added to your Google Calendar');
    } catch (err: Any) {
      if (err.status === 409) notify('🎉 Saved to My bookings! Connect Google Calendar in Settings to sync it.');
      else notify(err.message, false);
    }
    setBusy(''); reload();
  }
  return (
    <article className={`ticket ${e.interest === 'not_interested' ? 'dim' : ''}`} style={{ animationDelay: `${Math.min(i, 10) * 60}ms` }}>
      <span className="notch top" /><span className="notch bottom" />
      <div className={`stub ${g}`}>
        {e.start_at ? (<>
          <span className="text-xs font-bold uppercase tracking-widest opacity-90">{IST(e.start_at, { month: 'short' })}</span>
          <span className="font-display text-3xl font-light leading-none">{IST(e.start_at, { day: 'numeric' })}</span>
          <span className="text-xs font-semibold opacity-90">{IST(e.start_at, { weekday: 'short' })}{e.time_known ? ` · ${IST(e.start_at, { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
        </>) : <span className="font-display text-xl">Date<br />TBA</span>}
      </div>
      <div className="min-w-0 flex-1 p-3.5 pl-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`chip ${cls}`}>{label}</span>
          {isNew && <span className="chip bg-[#a8865a] text-white">NEW</span>}
          {e.interest === 'interested' && <span className="chip bg-[#c9a96e] text-[#111111]">💛 Interested</span>}
          {e.confirmation && <span className="chip bg-[#111111] text-white">{e.confirmation === 'booked' ? '✅ Booked' : '🙌 Going'}</span>}
        </div>
        <h3 className="font-display mt-1 truncate text-lg leading-tight">{artist}</h3>
        <p className="line-clamp-1 text-[13px] font-light text-[#111111]/75">{title}</p>
        <p className="mt-1 line-clamp-1 text-[12px] font-light text-[#111111]/60">📍 {e.venue ?? 'Venue TBA'}{e.city ? ` · ${e.city}` : ''}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {e.price_min && <span className="font-display text-lg">₹{Number(e.price_min).toLocaleString('en-IN')}<span className="text-xs font-sans text-[#111111]/60"> onwards</span></span>}
          {(() => {
            // Prefer the booking page, then the show's own page; if neither exists, send people to the listing page it was found on.
            const href = e.booking_url ?? e.official_url ?? e.listing_url;
            if (!href) return null;
            const label = e.booking_url ? 'Book now ↗' : e.official_url ? 'Read more ↗' : 'See listing ↗';
            return <a href={href} target="_blank" rel="noopener noreferrer" className="tbtn border-transparent bg-[#111111] text-[#f4efe6]!">{label}</a>;
          })()}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t-2 border-dashed border-[#111111]/10 pt-3">
          <button className={`tbtn ${e.interest === 'interested' ? 'border-[#c9a96e] bg-[#c9a96e]' : ''}`} disabled={!!busy} onClick={() => interest('interested')}>👍 Interested</button>
          <button className={`tbtn ${e.interest === 'not_interested' ? 'border-[#a8865a] bg-[#a8865a]/20' : ''}`} disabled={!!busy} onClick={() => interest('not_interested')}>👎 Not interested</button>
          {e.start_at && (e.calendar_status === 'created'
            ? <button className="tbtn border-[#8fb39b] bg-[#8fb39b]/20" disabled={!!busy} title="In your Google Calendar - tap to add it again if you deleted it there" onClick={() => going(e.confirmation ?? 'attending')}>{busy ? '…' : '📅 In calendar ✓'}</button>
            : <button className="tbtn border-[#5a5a5a]/50" disabled={!!busy} title="Add this show to your Google Calendar" onClick={() => going(e.confirmation ?? 'attending')}>{busy === 'attending' || busy === 'booked' ? '…' : '📅 Add to calendar'}</button>)}
          {!e.start_at && (
            <button onClick={toggleNotify} disabled={!!busy} aria-pressed={!!e.notify_me} title={e.notify_me ? 'You’ll get a Telegram message when the date or tickets are announced - tap to stop' : 'Notify me on Telegram when the date or tickets are announced'}
              className={`tbtn ${e.notify_me ? 'border-[#c9a96e] bg-[#c9a96e]/25' : ''}`}>{e.notify_me ? '🔔 Notifying' : '🔕 Notify me'}</button>
          )}
          <span className="barcode ml-auto hidden sm:block" />
        </div>
      </div>
    </article>
  );
}

function Bookings({ events, loaded, reload, notify, goUpcoming }: { events: Any[]; loaded: boolean; reload: () => void; notify: (m: string, ok?: boolean) => void; goUpcoming: () => void }) {
  if (!loaded) return <Loading />;
  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <p className="text-[11px] uppercase tracking-[.25em] text-accent">My bookings</p>
        <h1 className="font-display mt-1 text-2xl sm:text-3xl">{events.length ? <><span className="rainbow-text">{events.length} show{events.length > 1 ? 's' : ''}</span> you’re interested in</> : <>No plans <span className="rainbow-text">yet</span></>}</h1>
        <p className="mt-2 text-muted">Shows you marked 👍 Interested.</p>
      </section>
      {events.length === 0
        ? <div className="glass p-10 text-center"><p className="mt-3 text-muted">Tap 👍 Interested on any upcoming show and it lands here.</p><button className="btn-sun mt-4" onClick={goUpcoming}>See upcoming concerts</button></div>
        : <div className="grid gap-5 md:grid-cols-2">{events.map((e, i) => <Ticket key={e.id} e={e} i={i} reload={reload} notify={notify} booking />)}</div>}
    </div>
  );
}

function Loading() {
  return <div className="grid place-items-center py-24"><span className="eq scale-[2]"><i /><i /><i /><i /></span><p className="mt-6 text-muted">Tuning up…</p></div>;
}

/* ───────────────────────────── Settings ───────────────────────────── */

function Settings({ notify, reloadEvents }: { notify: (m: string, ok?: boolean) => void; reloadEvents: () => void }) {
  const [s, setS] = useState<Any>(null);
  const refresh = useCallback(() => api('/api/summary').then(setS).catch(e => notify(e.message, false)), [notify]);
  useEffect(() => { refresh(); }, [refresh]);
  const [scanning, setScanning] = useState(false);
  async function scan() {
    setScanning(true);
    try { const r = await api('/api/monitor/run', { method: 'POST', body: JSON.stringify({ force: true }) }); const n = r.sources?.reduce((a: number, x: Any) => a + (x.created ?? 0), 0) ?? 0; notify(n ? `🎉 Found ${n} new show${n > 1 ? 's' : ''}!` : 'All caught up - no new shows right now.'); reloadEvents(); refresh(); }
    catch (e: Any) { notify(e.message, false); }
    setScanning(false);
  }
  return (
    <div className="space-y-5">
      <section className="glass flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h1 className="font-display text-3xl">Settings</h1>
          <p className="text-muted">Last checked for new shows {ago(s?.runs?.[0]?.started_at)} · we look every 30 minutes · new shows on Telegram instantly · favourites reminder at 9 am and 6 pm</p>
        </div>
        <button className="btn-sun" disabled={scanning} onClick={scan}>{scanning ? '🔭 Scanning…' : '🔭 Check for new shows now'}</button>
      </section>
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3"><Artists notify={notify} spotify={s?.integrations?.spotify} onChange={() => { refresh(); reloadEvents(); }} /></div>
        <div className="space-y-5 lg:col-span-2">
          <Connections s={s} notify={notify} refresh={refresh} />
        </div>
      </div>
    </div>
  );
}

function Artists({ notify, spotify, onChange }: { notify: (m: string, ok?: boolean) => void; spotify: Any; onChange: () => void }) {
  const [list, setList] = useState<Any[] | null>(null);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/api/artists').then(j => setList(j.artists)).catch(e => notify(e.message, false)), [notify]);
  useEffect(() => { load(); }, [load]);
  async function add(e: React.FormEvent) {
    e.preventDefault(); if (!name.trim()) return;
    try { await api('/api/artists', { method: 'POST', body: JSON.stringify({ name, priority: true }) }); notify(`${name} added to My Artists`); setName(''); load(); onChange(); } catch (err: Any) { notify(err.message, false); }
  }
  async function remove(a: Any) {
    if (!confirm(`Remove ${a.name} from the list?`)) return;
    try { await api(`/api/artists/${a.id}`, { method: 'DELETE' }); load(); onChange(); } catch (err: Any) { notify(err.message, false); }
  }
  async function star(a: Any) { await api(`/api/artists/${a.id}`, { method: 'PATCH', body: JSON.stringify({ priority: !a.priority }) }).catch(() => {}); load(); onChange(); }
  async function syncNow() {
    setBusy(true);
    try { const r = await api('/api/spotify/import', { method: 'POST', body: '{}' }); notify(`Spotify synced - ${r.fetched} followed artists in My Artists`); load(); onChange(); } catch (e: Any) { notify(e.message, false); }
    setBusy(false);
  }
  const mine = (list ?? []).filter(a => a.priority);
  const rest = (list ?? []).filter(a => !a.priority && (!q || a.name.toLowerCase().includes(q.toLowerCase())));
  const Chip = ({ a }: { a: Any }) => (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-light ${a.priority ? 'border-[#c9a96e]/60 text-[#e6d5b0]' : 'border-white/10 text-white/65'}`}>
      <button onClick={() => star(a)} className={a.priority ? 'text-accent' : 'text-white/35 hover:text-accent'} title={a.priority ? 'Remove from My Artists' : 'Add to My Artists'}>{a.priority ? '★' : '☆'}</button>
      {a.name}{a.origin === 'spotify' && <span className="text-[10px] text-[#8fb39b]">spotify</span>}
      <button onClick={() => remove(a)} className="text-white/30 hover:text-white" title="Remove">✕</button>
    </span>
  );
  return (
    <section className="glass p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl">Artists</h2>
        {spotify?.connected
          ? <button className="btn py-1 text-[12px]" disabled={busy} onClick={syncNow}>{busy ? 'Syncing…' : 'Sync Spotify now'}</button>
          : <a className={`btn py-1 text-[12px] ${spotify?.configured ? '' : 'pointer-events-none opacity-50'}`} href="/api/spotify/login">Connect Spotify</a>}
      </div>
      <p className="mt-1 text-[12px] text-muted">{spotify?.connected ? `Spotify syncs automatically every 6 hours${spotify.lastSync ? ` · last ${ago(spotify.lastSync.started_at)}` : ''}. Everyone you follow lands in My Artists.` : 'Connect Spotify and everyone you follow is added to My Artists automatically.'}</p>
      <form onSubmit={add} className="mt-4 flex gap-2">
        <input className="input py-2 text-[13px]" placeholder="Add an artist" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn-sun shrink-0 py-2" disabled={!name.trim()}>Add</button>
      </form>
      <details open className="group mt-4 rounded-2xl border border-white/[.07] p-3">
        <summary className="cursor-pointer list-none text-[12px] uppercase tracking-[.2em] text-white/70">My artists · {mine.length} <span className="text-accent group-open:hidden">+</span><span className="hidden text-accent group-open:inline">−</span></summary>
        <div className="mt-3 flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">{!list ? <p className="text-muted">Loading…</p> : mine.length ? mine.map(a => <Chip key={a.id} a={a} />) : <p className="text-[12px] text-muted">None yet - star artists below or connect Spotify.</p>}</div>
      </details>
      <details className="group mt-3 rounded-2xl border border-white/[.07] p-3">
        <summary className="cursor-pointer list-none text-[12px] uppercase tracking-[.2em] text-white/70">All other artists · {(list ?? []).length - mine.length} <span className="text-accent group-open:hidden">+</span><span className="hidden text-accent group-open:inline">−</span></summary>
        <input className="input mt-3 py-1.5 text-[12px]" placeholder="Find artist" value={q} onChange={e => setQ(e.target.value)} />
        <div className="mt-3 flex max-h-72 flex-wrap gap-1.5 overflow-y-auto">{rest.map(a => <Chip key={a.id} a={a} />)}</div>
      </details>
    </section>
  );
}

function Connections({ s, notify, refresh }: { s: Any; notify: (m: string, ok?: boolean) => void; refresh: () => void }) {
  const [busy, setBusy] = useState('');
  if (!s) return <section className="glass p-6"><p className="text-muted">Loading…</p></section>;
  const i = s.integrations;
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } catch (e: Any) { notify(e.message, false); } setBusy(''); refresh(); };
  const Row = ({ icon, name, ok, status, children }: { icon: string; name: string; ok: boolean; status: string; children?: React.ReactNode }) => (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/5 p-3">
      <span className="text-2xl">{icon}</span>
      <div className="min-w-0 flex-1"><p className="font-semibold">{name}</p><p className={`text-xs ${ok ? 'text-mint' : 'text-accent'}`}>{status}</p></div>
      {children}
    </div>
  );
  return (
    <section className="glass space-y-3 p-6">
      <h2 className="font-display text-xl">🔌 Connections</h2>
      <Row icon="💬" name="Telegram alerts" ok={!!i.telegram.lastSuccess} status={i.telegram.configured ? (i.telegram.lastSuccess ? `Working · last alert ${ago(i.telegram.lastSuccess)}` : 'Ready - send a test') : 'Not set up yet'}>
        {i.telegram.configured && <button className="btn" disabled={!!busy} onClick={() => run('tg', async () => { await api('/api/telegram', { method: 'POST' }); notify('📬 Test sent - check Telegram!'); })}>{busy === 'tg' ? '…' : 'Test'}</button>}
      </Row>
      <Row icon="📅" name="Google Calendar" ok={i.google.connected} status={i.google.connected ? 'Connected - bookings sync here' : i.google.configured ? 'One click to connect' : 'Not set up yet'}>
        {i.google.connected
          ? <button className="btn" onClick={() => run('gd', async () => { await api('/api/google/disconnect', { method: 'POST' }); })}>Disconnect</button>
          : <a className={`btn-sun ${i.google.configured ? '' : 'pointer-events-none opacity-50'}`} href="/api/google/login">Connect</a>}
      </Row>
      <Row icon="🎧" name="Spotify" ok={i.spotify.connected} status={i.spotify.connected ? `Connected${i.spotify.account ? ` as ${i.spotify.account}` : ''}` : i.spotify.configured ? 'One click to connect' : 'Setting up…'}>
        {i.spotify.connected
          ? <button className="btn" onClick={() => run('sd', async () => { await api('/api/spotify/disconnect', { method: 'POST' }); })}>Disconnect</button>
          : <a className={`btn-sun ${i.spotify.configured ? '' : 'pointer-events-none opacity-50'}`} href="/api/spotify/login">Connect</a>}
      </Row>
    </section>
  );
}

