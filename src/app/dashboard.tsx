'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type View = 'upcoming' | 'bookings' | 'settings';

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
  on_sale: ['🎟 On sale', 'bg-[#2ee6a8] text-[#0d3b2c]'], not_yet_on_sale: ['⏳ Coming soon', 'bg-[#ffd23f] text-[#3b2a00]'],
  sold_out: ['😢 Sold out', 'bg-[#ff4fa3] text-white'], cancelled: ['✖ Cancelled', 'bg-[#1d1236] text-white'],
  postponed: ['↻ Postponed', 'bg-[#ff8a3d] text-white'], announced: ['📣 Announced', 'bg-[#7c5cff] text-white'], unknown: ['✨ Listed', 'bg-[#3ec7ff] text-[#062b3b]'],
};

export default function Dashboard() {
  const [view, setView] = useState<View>('upcoming');
  const [events, setEvents] = useState<Any[] | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const notify = useCallback((msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 5000); }, []);
  const load = useCallback(() => api('/api/events').then(j => setEvents(j.events)).catch(e => notify(e.message, false)), [notify]);

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get('view') === 'settings' || sp.get('tab') === 'settings') setView('settings');
    const n = sp.get('notice'); if (n) { notify(n, !/fail|invalid|cancel|not configured|error/i.test(n)); history.replaceState(null, '', '/'); }
    load();
    const t = setInterval(load, 60_000); // stay fresh while the 5-minute scanner adds shows
    return () => clearInterval(t);
  }, [load, notify]);

  const bookings = (events ?? []).filter(e => e.confirmation);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <button onClick={() => setView('upcoming')} className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#ff4fa3] via-[#ff8a3d] to-[#ffd23f] shadow-[0_10px_30px_-8px_#ff4fa3]"><span className="eq"><i /><i /><i /><i /></span></span>
          <span className="text-left">
            <span className="font-display rainbow-text block text-3xl leading-none">KConcerts</span>
            <span className="text-xs text-muted">your artists · live across India</span>
          </span>
        </button>
        <nav className="glass flex items-center gap-1 p-1.5">
          {([['upcoming', '🎤 Upcoming concerts'], ['bookings', `🎟 My bookings${bookings.length ? ` · ${bookings.length}` : ''}`]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${view === v ? 'bg-accent text-[#1d1236] shadow-[0_6px_20px_-6px_#ffd23f]' : 'text-white/80 hover:text-white'}`}>{l}</button>
          ))}
          <button onClick={() => setView('settings')} aria-label="Settings" className={`grid h-9 w-9 place-items-center rounded-full text-lg transition hover:rotate-45 ${view === 'settings' ? 'bg-accent text-[#1d1236]' : 'text-white/80'}`}>⚙</button>
        </nav>
      </header>

      {view === 'upcoming' && <Upcoming events={events} reload={load} notify={notify} goSettings={() => setView('settings')} />}
      {view === 'bookings' && <Bookings events={bookings} loaded={!!events} reload={load} notify={notify} goUpcoming={() => setView('upcoming')} />}
      {view === 'settings' && <Settings notify={notify} reloadEvents={load} />}

      {toast && <div className={`fixed bottom-6 left-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-semibold shadow-2xl ${toast.ok ? 'bg-[#2ee6a8] text-[#0d3b2c]' : 'bg-[#ff4fa3] text-white'}`} style={{ animation: 'pop .35s both' }}>{toast.msg}</div>}
    </div>
  );
}

function Upcoming({ events, reload, notify, goSettings }: { events: Any[] | null; reload: () => void; notify: (m: string, ok?: boolean) => void; goSettings: () => void }) {
  const [city, setCity] = useState('');
  const [q, setQ] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const cities = useMemo(() => [...new Set((events ?? []).map(e => e.city).filter(Boolean))].sort(), [events]);
  if (!events) return <Loading />;
  const all = events.filter(e => (!city || e.city === city) && (!q || `${e.title} ${e.artists.map((a: Any) => a.name).join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  const hidden = all.filter(e => e.interest === 'not_interested');
  const list = all.filter(e => e.interest !== 'not_interested');
  return (
    <div className="space-y-6">
      <section className="glass relative overflow-hidden p-6 sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[.2em] text-accent">Coming up</p>
        <h1 className="font-display mt-1 text-4xl sm:text-5xl">{list.length ? <>{list.length} show{list.length > 1 ? 's' : ''} for <span className="rainbow-text">your artists</span></> : <>Your stage is <span className="rainbow-text">waiting</span></>}</h1>
        <p className="mt-2 max-w-xl text-muted">Fresh listings land here automatically — we check every few minutes and ping you on Telegram the moment something new drops.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="🔎 Search artist or show" value={q} onChange={e => setQ(e.target.value)} />
          <button onClick={() => setCity('')} className={`chip text-sm ${!city ? 'bg-accent text-[#1d1236]' : 'bg-white/10'}`}>All cities</button>
          {cities.map(c => <button key={c} onClick={() => setCity(c)} className={`chip text-sm ${city === c ? 'bg-accent text-[#1d1236]' : 'bg-white/10 hover:bg-white/20'}`}>📍 {c}</button>)}
        </div>
      </section>

      {list.length === 0 ? (
        <div className="glass p-10 text-center">
          <p className="text-5xl">🎶</p>
          <p className="font-display mt-3 text-2xl">No shows yet</p>
          <p className="mx-auto mt-1 max-w-md text-muted">Add the artists you love and we’ll hunt down their gigs across India.</p>
          <button className="btn-sun mt-4" onClick={goSettings}>➕ Add artists</button>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">{list.map((e, i) => <Ticket key={e.id} e={e} i={i} reload={reload} notify={notify} />)}</div>
      )}

      {hidden.length > 0 && (
        <div className="text-center">
          <button className="btn" onClick={() => setShowHidden(!showHidden)}>{showHidden ? 'Hide' : 'Show'} {hidden.length} not-interested show{hidden.length > 1 ? 's' : ''}</button>
          {showHidden && <div className="mt-5 grid gap-5 text-left md:grid-cols-2">{hidden.map((e, i) => <Ticket key={e.id} e={e} i={i} reload={reload} notify={notify} />)}</div>}
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
  async function going(c: 'booked' | 'attending') {
    setBusy(c);
    try {
      const r = await api(`/api/events/${e.id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmation: c, explicit: true }) });
      notify(r.duplicate ? 'Already in your Google Calendar 📅' : '🎉 Added to My bookings + Google Calendar!');
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
          <span className="font-display text-5xl leading-none">{IST(e.start_at, { day: 'numeric' })}</span>
          <span className="text-xs font-semibold opacity-90">{IST(e.start_at, { weekday: 'short' })}{e.time_known ? ` · ${IST(e.start_at, { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
        </>) : <span className="font-display text-2xl">Date<br />TBA</span>}
      </div>
      <div className="min-w-0 flex-1 p-4 pl-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`chip ${cls}`}>{label}</span>
          {isNew && <span className="chip animate-pulse bg-[#ff4fa3] text-white">NEW</span>}
          {e.interest === 'interested' && <span className="chip bg-[#ffd23f] text-[#3b2a00]">💛 Interested</span>}
          {e.confirmation && <span className="chip bg-[#1d1236] text-white">{e.confirmation === 'booked' ? '✅ Booked' : '🙌 Going'}</span>}
        </div>
        <h3 className="font-display mt-2 truncate text-2xl leading-tight">{artist}</h3>
        <p className="line-clamp-1 text-sm font-medium text-[#1d1236]/80">{title}</p>
        <p className="mt-1 line-clamp-1 text-sm text-[#1d1236]/70">📍 {e.venue ?? 'Venue TBA'}{e.city ? ` · ${e.city}` : ''}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {e.price_min && <span className="font-display text-lg">₹{Number(e.price_min).toLocaleString('en-IN')}<span className="text-xs font-sans text-[#1d1236]/60"> onwards</span></span>}
          {(e.booking_url || e.official_url) && <a href={e.booking_url ?? e.official_url} target="_blank" rel="noopener noreferrer" className="tbtn border-transparent bg-[#1d1236] text-white!">{e.booking_url ? 'Book now ↗' : 'Read more ↗'}</a>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t-2 border-dashed border-[#1d1236]/10 pt-3">
          {booking ? (
            e.calendar_status === 'created'
              ? <span className="tbtn border-[#2ee6a8] bg-[#2ee6a8]/20">📅 In Google Calendar</span>
              : <button className="tbtn" disabled={!!busy} onClick={() => going(e.confirmation)}>{busy ? '…' : '📅 Add to Google Calendar'}</button>
          ) : (<>
            <button className={`tbtn ${e.interest === 'interested' ? 'border-[#ffd23f] bg-[#ffd23f]' : ''}`} disabled={!!busy} onClick={() => interest('interested')}>👍 Interested</button>
            <button className={`tbtn ${e.interest === 'not_interested' ? 'border-[#ff4fa3] bg-[#ff4fa3]/20' : ''}`} disabled={!!busy} onClick={() => interest('not_interested')}>👎 Not for me</button>
            {!e.confirmation && <>
              <button className="tbtn border-[#7c5cff]/50" disabled={!!busy || !e.start_at} onClick={() => going('booked')}>{busy === 'booked' ? '…' : '✅ I booked'}</button>
              <button className="tbtn border-[#7c5cff]/50" disabled={!!busy || !e.start_at} onClick={() => going('attending')}>{busy === 'attending' ? '…' : '🙌 I’m going'}</button>
            </>}
          </>)}
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
        <p className="text-sm font-semibold uppercase tracking-[.2em] text-accent">My bookings</p>
        <h1 className="font-display mt-1 text-4xl sm:text-5xl">{events.length ? <>You’ve got <span className="rainbow-text">{events.length} night{events.length > 1 ? 's' : ''} out</span></> : <>No plans <span className="rainbow-text">yet</span></>}</h1>
        <p className="mt-2 text-muted">Shows you’ve booked or said you’re going to. We add them to your Google Calendar — never without your say-so.</p>
      </section>
      {events.length === 0
        ? <div className="glass p-10 text-center"><p className="text-5xl">🎟</p><p className="mt-3 text-muted">Tap “I booked” or “I’m going” on any upcoming show.</p><button className="btn-sun mt-4" onClick={goUpcoming}>See upcoming concerts</button></div>
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
    try { const r = await api('/api/monitor/run', { method: 'POST', body: JSON.stringify({ force: true }) }); const n = r.sources?.reduce((a: number, x: Any) => a + (x.created ?? 0), 0) ?? 0; notify(n ? `🎉 Found ${n} new show${n > 1 ? 's' : ''}!` : 'All caught up — no new shows right now.'); reloadEvents(); refresh(); }
    catch (e: Any) { notify(e.message, false); }
    setScanning(false);
  }
  return (
    <div className="space-y-5">
      <section className="glass flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h1 className="font-display text-4xl">Settings</h1>
          <p className="text-muted">Last checked for new shows {ago(s?.runs?.[0]?.started_at)} · we look again every 5 minutes</p>
        </div>
        <button className="btn-sun" disabled={scanning} onClick={scan}>{scanning ? '🔭 Scanning…' : '🔭 Check for new shows now'}</button>
      </section>
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3"><Artists notify={notify} spotify={s?.integrations?.spotify} onChange={() => { refresh(); reloadEvents(); }} /></div>
        <div className="space-y-5 lg:col-span-2">
          <Connections s={s} notify={notify} refresh={refresh} />
          <Sources s={s} />
        </div>
      </div>
    </div>
  );
}

function Artists({ notify, spotify, onChange }: { notify: (m: string, ok?: boolean) => void; spotify: Any; onChange: () => void }) {
  const [list, setList] = useState<Any[] | null>(null);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<Any[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/api/artists').then(j => setList(j.artists)).catch(e => notify(e.message, false)), [notify]);
  useEffect(() => { load(); }, [load]);
  async function add(e: React.FormEvent) {
    e.preventDefault(); if (!name.trim()) return;
    try { await api('/api/artists', { method: 'POST', body: JSON.stringify({ name }) }); notify(`💖 ${name} added`); setName(''); load(); onChange(); } catch (err: Any) { notify(err.message, false); }
  }
  async function remove(a: Any) {
    if (!confirm(`Stop watching ${a.name}?`)) return;
    try { await api(`/api/artists/${a.id}`, { method: 'DELETE' }); load(); onChange(); } catch (err: Any) { notify(err.message, false); }
  }
  async function star(a: Any) { await api(`/api/artists/${a.id}`, { method: 'PATCH', body: JSON.stringify({ priority: !a.priority }) }).catch(() => {}); load(); }
  async function loadPreview() {
    setBusy(true);
    try { const j = await api('/api/spotify/preview'); setPreview(j.artists); setSel(new Set(j.artists.filter((a: Any) => !a.alreadyWatched).map((a: Any) => a.id))); } catch (e: Any) { notify(e.message, false); }
    setBusy(false);
  }
  async function doImport() {
    setBusy(true);
    try { const r = await api('/api/spotify/import', { method: 'POST', body: JSON.stringify({ ids: [...sel] }) }); notify(`🎧 Synced! ${r.added} new artist${r.added === 1 ? '' : 's'} added`); setPreview(null); load(); onChange(); } catch (e: Any) { notify(e.message, false); }
    setBusy(false);
  }
  return (
    <section className="glass p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl">🎤 My artists <span className="text-base text-muted">({list?.length ?? 0})</span></h2>
        {spotify?.connected
          ? <button className="btn" disabled={busy} onClick={loadPreview}>🎧 {busy ? 'Loading…' : 'Sync from Spotify'}</button>
          : <a className={`btn ${spotify?.configured ? '' : 'pointer-events-none opacity-50'}`} href="/api/spotify/login">🎧 Connect Spotify</a>}
      </div>
      {spotify?.lastSync && <p className="mt-1 text-xs text-muted">Last Spotify sync {ago(spotify.lastSync.started_at)}</p>}
      <form onSubmit={add} className="mt-4 flex gap-2">
        <input className="input" placeholder="Add an artist — e.g. Prateek Kuhad" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn-sun shrink-0" disabled={!name.trim()}>Add</button>
      </form>
      {preview ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between"><p className="font-semibold">Pick who to follow ({sel.size} selected)</p><div className="flex gap-2"><button className="btn" onClick={() => setPreview(null)}>Cancel</button><button className="btn-sun" disabled={busy || !sel.size} onClick={doImport}>Add {sel.size}</button></div></div>
          <div className="flex max-h-80 flex-wrap gap-2 overflow-y-auto">{preview.map(a => (
            <label key={a.id} className={`chip cursor-pointer gap-2 py-1.5 text-sm ${a.alreadyWatched ? 'bg-white/5 text-white/40' : sel.has(a.id) ? 'bg-accent text-[#1d1236]' : 'bg-white/10'}`}>
              <input type="checkbox" className="sr-only" disabled={a.alreadyWatched} checked={sel.has(a.id) || a.alreadyWatched} onChange={ev => { const n = new Set(sel); if (ev.target.checked) n.add(a.id); else n.delete(a.id); setSel(n); }} />
              {a.image && <img src={a.image} alt="" className="h-5 w-5 rounded-full" />}{a.name}
            </label>
          ))}</div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {!list ? <p className="text-muted">Loading…</p> : list.length === 0 ? <p className="text-muted">No artists yet — add your first one above ✨</p> : list.map((a, i) => (
            <span key={a.id} className={`chip gap-2 py-1.5 pl-1.5 text-sm text-white grad-${hash(a.name) % 5}`} style={{ animation: `pop .4s ${i * 25}ms both` }}>
              {a.image_url ? <img src={a.image_url} alt="" className="h-6 w-6 rounded-full" /> : <span className="grid h-6 w-6 place-items-center rounded-full bg-white/25 text-xs">{a.name[0]}</span>}
              {a.name}{a.event_count ? <span className="rounded-full bg-white/25 px-1.5 text-[10px]">{a.event_count}</span> : null}
              <button title="Favourite" onClick={() => star(a)} className="opacity-90 hover:scale-125">{a.priority ? '⭐' : '☆'}</button>
              <button title="Remove" onClick={() => remove(a)} className="opacity-70 hover:opacity-100">✕</button>
            </span>
          ))}
        </div>
      )}
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
      <h2 className="font-display text-2xl">🔌 Connections</h2>
      <Row icon="💬" name="Telegram alerts" ok={!!i.telegram.lastSuccess} status={i.telegram.configured ? (i.telegram.lastSuccess ? `Working · last alert ${ago(i.telegram.lastSuccess)}` : 'Ready — send a test') : 'Not set up yet'}>
        {i.telegram.configured && <button className="btn" disabled={!!busy} onClick={() => run('tg', async () => { await api('/api/telegram', { method: 'POST' }); notify('📬 Test sent — check Telegram!'); })}>{busy === 'tg' ? '…' : 'Test'}</button>}
      </Row>
      <Row icon="📅" name="Google Calendar" ok={i.google.connected} status={i.google.connected ? 'Connected — bookings sync here' : i.google.configured ? 'One click to connect' : 'Not set up yet'}>
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

const FRIENDLY: Record<string, string> = { district: 'District', google_news: 'News announcements', official_pages: 'Official artist pages', ticketmaster: 'Ticketmaster', bandsintown: 'Bandsintown', bookmyshow: 'BookMyShow', insider: 'Paytm Insider', skillbox: 'SkillBox' };

function Sources({ s }: { s: Any }) {
  if (!s) return null;
  return (
    <section className="glass p-6">
      <h2 className="font-display text-2xl">📡 Where shows come from</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {s.sources.map((x: Any) => {
          const live = x.enabled && x.status === 'live';
          return (
            <li key={x.id} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${live ? 'bg-mint shadow-[0_0_10px_#2ee6a8]' : x.enabled ? 'bg-accent' : 'bg-white/25'}`} />{FRIENDLY[x.id] ?? x.name}</span>
              <span className="text-xs text-muted">{live ? `checked ${ago(x.last_success_at)}` : x.enabled ? 'warming up' : 'not connected'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
