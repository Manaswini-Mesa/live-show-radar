'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const TABS = ['overview', 'events', 'artists', 'alerts', 'sources', 'settings'] as const;
type Tab = (typeof TABS)[number];

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (r.status === 401) { location.href = '/login'; throw new Error('Signed out'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

const ist = (v?: string | null, time = true) => v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) }) : '—';
const ago = (v?: string | null) => { if (!v) return 'never'; const s = (Date.now() - new Date(v).getTime()) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`; };
const TICKET: Record<string, [string, string]> = {
  on_sale: ['On sale', 'bg-accent/15 text-accent'], not_yet_on_sale: ['Not yet on sale', 'bg-amber-400/15 text-amber-300'],
  sold_out: ['Sold out', 'bg-rose-500/15 text-rose-300'], cancelled: ['Cancelled', 'bg-rose-500/15 text-rose-300'],
  postponed: ['Postponed', 'bg-amber-400/15 text-amber-300'], announced: ['Announced', 'bg-accent3/20 text-violet-300'], unknown: ['Unknown', 'bg-white/5 text-muted'],
};
const STATUS: Record<string, [string, string]> = {
  live: ['Live', 'bg-accent/15 text-accent'], verified: ['Verified', 'bg-accent/15 text-accent'], success: ['Success', 'bg-accent/15 text-accent'], delivered: ['Delivered', 'bg-accent/15 text-accent'], created: ['Added', 'bg-accent/15 text-accent'],
  partial: ['Partial', 'bg-amber-400/15 text-amber-300'], pending: ['Pending', 'bg-white/5 text-muted'], running: ['Running', 'bg-sky-400/15 text-sky-300'], sending: ['Sending', 'bg-sky-400/15 text-sky-300'],
  awaiting_config: ['Awaiting config', 'bg-amber-400/15 text-amber-300'], configured: ['Configured · untested', 'bg-amber-400/15 text-amber-300'], connected: ['Connected', 'bg-accent/15 text-accent'],
  unavailable: ['Unavailable', 'bg-white/5 text-muted'], disabled: ['Disabled', 'bg-white/5 text-muted'], skipped: ['Skipped', 'bg-white/5 text-muted'],
  error: ['Error', 'bg-rose-500/15 text-rose-300'], failed: ['Failed', 'bg-rose-500/15 text-rose-300'], not_configured: ['Not configured', 'bg-white/5 text-muted'],
};
const Pill = ({ s, map = STATUS }: { s: string; map?: Record<string, [string, string]> }) => { const [l, c] = map[s] ?? [s, 'bg-white/5 text-muted']; return <span className={`pill ${c}`}>{l}</span>; };
const VERIF: Record<string, [string, string]> = { verified_structured: ['Verified listing', 'bg-accent/15 text-accent'], reported_news: ['Reported (news)', 'bg-amber-400/15 text-amber-300'], unverified: ['Unverified', 'bg-white/5 text-muted'] };

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<Any>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const notify = useCallback((msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 6000); }, []);
  const refresh = useCallback(() => api('/api/summary').then(setSummary).catch(e => notify(e.message, false)), [notify]);

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const t = sp.get('tab') as Tab; if (TABS.includes(t)) setTab(t);
    const n = sp.get('notice'); if (n) { notify(n, !/fail|invalid|cancel|not configured|error/i.test(n)); history.replaceState(null, '', '/'); }
    refresh();
  }, [refresh, notify]);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-3">
          <RadarLogo />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Live Show Radar</h1>
            <p className="text-xs text-muted">Concert & festival alerts across India</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RunButton onDone={(r) => { refresh(); notify(`Monitoring run ${r.status}: ${r.sources?.filter((s: Any) => s.status !== 'skipped').map((s: Any) => `${s.source} ${s.status}${s.created ? ` (+${s.created} new)` : ''}`).join(', ') || 'no sources due'}`, r.status !== 'failed'); }} onError={e => notify(e, false)} />
          <button className="btn" onClick={async () => { await api('/api/auth', { method: 'DELETE' }); location.href = '/login'; }}>Sign out</button>
        </div>
      </header>
      <nav className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3.5 py-1.5 text-sm capitalize whitespace-nowrap ${tab === t ? 'bg-panel2 text-white shadow-inner' : 'text-muted hover:text-white'}`}>{t}</button>
        ))}
      </nav>
      {tab === 'overview' && <Overview s={summary} goto={setTab} openEvent={setOpenEvent} />}
      {tab === 'events' && <Events openEvent={setOpenEvent} />}
      {tab === 'artists' && <Artists notify={notify} spotify={summary?.integrations?.spotify} onChange={refresh} />}
      {tab === 'alerts' && <Alerts notify={notify} />}
      {tab === 'sources' && <Sources s={summary} notify={notify} refresh={refresh} />}
      {tab === 'settings' && <Settings s={summary} notify={notify} refresh={refresh} />}
      {openEvent && <EventDrawer id={openEvent} close={() => setOpenEvent(null)} notify={notify} />}
      {toast && <div className={`fixed bottom-5 left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 rounded-xl border px-4 py-3 text-sm shadow-2xl ${toast.ok ? 'border-accent/40 bg-[#10241a]' : 'border-rose-500/40 bg-[#2a1218]'}`}>{toast.msg}</div>}
    </div>
  );
}

function RadarLogo() {
  return (
    <svg width="36" height="36" viewBox="0 0 40 40" aria-hidden className="shrink-0">
      <circle cx="20" cy="20" r="18" fill="none" stroke="var(--accent)" strokeOpacity=".35" strokeWidth="2" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="var(--accent)" strokeOpacity=".6" strokeWidth="2" />
      <circle cx="20" cy="20" r="4" fill="var(--accent)" />
      <path d="M20 20 L34 9" stroke="var(--accent-2)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function RunButton({ onDone, onError }: { onDone: (r: Any) => void; onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  return <button className="btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { onDone(await api('/api/monitor/run', { method: 'POST', body: JSON.stringify({ force: true }) })); } catch (e: Any) { onError(e.message); } setBusy(false); }}>{busy ? 'Scanning sources…' : 'Run check now'}</button>;
}

function Stat({ label, value, hint, accent }: { label: string; value: Any; hint?: string; accent?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${accent ?? ''}`}>{value ?? '–'}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function integrationState(i: Any, kind: string): string {
  if (!i) return 'pending';
  if (kind === 'telegram') return !i.configured ? 'not_configured' : i.lastSuccess ? 'verified' : i.lastFailure ? 'failed' : 'configured';
  if (kind === 'gemini') return !i.configured ? 'not_configured' : i.lastCheck ? (i.lastCheck.detail?.ok ? 'verified' : 'failed') : 'configured';
  if (kind === 'spotify') return !i.configured ? 'not_configured' : i.connected ? (i.lastSync?.status === 'success' ? 'verified' : 'connected') : 'configured';
  if (kind === 'google') return !i.configured ? 'not_configured' : i.connected ? 'connected' : 'configured';
  return 'pending';
}

function Overview({ s, goto, openEvent }: { s: Any; goto: (t: Tab) => void; openEvent: (id: string) => void }) {
  const [events, setEvents] = useState<Any[] | null>(null);
  const [alerts, setAlerts] = useState<Any[] | null>(null);
  useEffect(() => { api('/api/events').then(j => setEvents(j.events)).catch(() => setEvents([])); api('/api/alerts').then(j => setAlerts(j.alerts)).catch(() => setAlerts([])); }, [s]);
  if (!s) return <p className="text-muted">Loading dashboard…</p>;
  const c = s.counts; const last = s.runs?.[0]; const ok = s.lastSuccessfulRun;
  const confirmed = (events ?? []).filter(e => e.calendar_status === 'created' || e.confirmation);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Stat label="Watched artists" value={c.artists} hint={`${c.priority_artists} priority`} />
        <Stat label="Upcoming events" value={c.upcoming} accent="text-accent" />
        <Stat label="New this week" value={c.new_7d} />
        <Stat label="Ticket updates" value={c.ticket_updates_7d} hint="last 7 days" />
        <Stat label="Alerts sent" value={c.alerts_delivered} hint={`${c.alerts_pending} pending`} />
        <Stat label="Confirmed" value={c.confirmed} hint="in calendar" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Upcoming shows</h2><button className="text-sm text-accent" onClick={() => goto('events')}>All events →</button></div>
          {!events ? <p className="text-sm text-muted">Loading…</p> : events.length === 0 ? <Empty title="No matched shows yet" body="Add artists to your watchlist, then press “Run check now”. Live Show Radar only lists events that match an artist you watch." action={<button className="btn" onClick={() => goto('artists')}>Add artists</button>} /> : (
            <ul className="divide-y divide-line">
              {events.slice(0, 8).map(e => (
                <li key={e.id} className="flex cursor-pointer items-center gap-3 py-2.5 hover:bg-white/[.02]" onClick={() => openEvent(e.id)}>
                  <DateBadge v={e.start_at} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{e.title}</p>
                    <p className="truncate text-xs text-muted">{e.artists.map((a: Any) => a.name).join(', ')} · {e.venue ?? 'Venue TBA'} · {e.city ?? 'City TBA'}</p>
                  </div>
                  <Pill s={e.ticket_status} map={TICKET} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="mb-2 font-semibold">Monitoring</h2>
            <dl className="space-y-1.5 text-sm">
              <Row k="Last run" v={last ? <span className="flex items-center gap-2">{ago(last.started_at)} <Pill s={last.status} /></span> : 'never'} />
              <Row k="Last successful run" v={ok ? ago(ok.finished_at) : 'none yet'} />
              <Row k="Scheduler" v={`every ${s.scheduler.intervalMinutes} min`} />
              <Row k="Last scheduled run" v={s.scheduler.lastCronRun ? ago(s.scheduler.lastCronRun) : <span className="text-amber-300">not yet observed</span>} />
              <Row k="Next scheduled run" v={s.scheduler.lastCronRun ? `≈ ${ist(new Date(new Date(s.scheduler.lastCronRun).getTime() + 5 * 60000).toISOString())}` : 'unknown'} />
            </dl>
          </div>
          <div className="card p-4">
            <h2 className="mb-2 font-semibold">Connections</h2>
            <dl className="space-y-1.5 text-sm">
              {(['telegram', 'gemini', 'spotify', 'google'] as const).map(k => <Row key={k} k={{ telegram: 'Telegram', gemini: 'Gemini Flash', spotify: 'Spotify', google: 'Google Calendar' }[k]} v={<Pill s={integrationState(s.integrations[k], k)} />} />)}
            </dl>
            <button className="mt-3 text-sm text-accent" onClick={() => goto('settings')}>Manage connections →</button>
          </div>
          <div className="card p-4">
            <h2 className="mb-2 font-semibold">Source health</h2>
            <ul className="space-y-1.5 text-sm">{s.sources.filter((x: Any) => x.enabled).map((x: Any) => <li key={x.id} className="flex items-center justify-between gap-2"><span className="truncate">{x.name.split(' — ')[0].split(' (')[0]}</span><span className="flex items-center gap-2 text-xs text-muted">{ago(x.last_success_at)} <Pill s={x.status} /></span></li>)}</ul>
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">Recent alerts</h2>
          {!alerts ? <p className="text-sm text-muted">Loading…</p> : alerts.length === 0 ? <p className="text-sm text-muted">No alerts yet.</p> : <ul className="divide-y divide-line text-sm">{alerts.slice(0, 6).map(a => <li key={a.id} className="flex items-center justify-between gap-2 py-2"><span className="truncate">{a.kind === 'test' ? 'Test message' : a.event_title}</span><span className="flex shrink-0 items-center gap-2 text-xs text-muted">{ago(a.created_at)} <Pill s={a.status} /></span></li>)}</ul>}
        </div>
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">Confirmed plans</h2>
          {confirmed.length === 0 ? <p className="text-sm text-muted">Open an event and confirm you booked or plan to attend — only then is it added to Google Calendar.</p> : <ul className="divide-y divide-line text-sm">{confirmed.map(e => <li key={e.id} className="flex items-center justify-between py-2"><span className="truncate">{e.title}</span><Pill s={e.calendar_status ?? 'pending'} /></li>)}</ul>}
        </div>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex items-center justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right">{v}</dd></div>;
function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line p-6 text-center"><p className="font-medium">{title}</p><p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>{action && <div className="mt-3">{action}</div>}</div>;
}
function DateBadge({ v }: { v: string | null }) {
  if (!v) return <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-panel2 text-[10px] text-muted">TBA</div>;
  const d = new Date(v);
  const p = (o: Intl.DateTimeFormatOptions) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...o });
  return <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-gradient-to-b from-accent3/30 to-accent2/20 leading-none"><span className="text-[10px] uppercase text-muted">{p({ month: 'short' })}</span><span className="text-lg font-semibold">{p({ day: 'numeric' })}</span></div>;
}

function Events({ openEvent }: { openEvent: (id: string) => void }) {
  const [events, setEvents] = useState<Any[] | null>(null);
  const [f, setF] = useState({ artist: '', city: '', type: '', ticket: '', from: '', to: '' });
  useEffect(() => { api('/api/events').then(j => setEvents(j.events)).catch(() => setEvents([])); }, []);
  const cities = useMemo(() => [...new Set((events ?? []).map(e => e.city).filter(Boolean))].sort(), [events]);
  const rows = (events ?? []).filter(e =>
    (!f.artist || e.artists.some((a: Any) => a.name.toLowerCase().includes(f.artist.toLowerCase())) || e.title.toLowerCase().includes(f.artist.toLowerCase())) &&
    (!f.city || e.city === f.city) && (!f.type || e.event_type === f.type) && (!f.ticket || e.ticket_status === f.ticket) &&
    (!f.from || (e.start_at && e.start_at >= f.from)) && (!f.to || (e.start_at && e.start_at <= f.to + 'T23:59:59Z')));
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-2 gap-2 border-b border-line p-3 md:grid-cols-6">
        <input className="input" placeholder="Artist or event" value={f.artist} onChange={e => setF({ ...f, artist: e.target.value })} />
        <select className="input" value={f.city} onChange={e => setF({ ...f, city: e.target.value })}><option value="">All cities</option>{cities.map(c => <option key={c}>{c}</option>)}</select>
        <select className="input" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option value="">All types</option>{['concert', 'festival', 'tour', 'other'].map(c => <option key={c}>{c}</option>)}</select>
        <select className="input" value={f.ticket} onChange={e => setF({ ...f, ticket: e.target.value })}><option value="">Any ticket status</option>{Object.entries(TICKET).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="input" type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} aria-label="From date" />
        <input className="input" type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} aria-label="To date" />
      </div>
      {!events ? <p className="p-4 text-sm text-muted">Loading events…</p> : rows.length === 0 ? <div className="p-4"><Empty title="No events match" body="Events appear here once a monitoring run finds a show for an artist on your watchlist." /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-panel2/60"><tr><th className="th">Date (IST)</th><th className="th">Event</th><th className="th">City · Venue</th><th className="th">Tickets</th><th className="th">Verification</th><th className="th">Source</th><th className="th">Verified</th><th className="th"></th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map(e => (
                <tr key={e.id} className="cursor-pointer hover:bg-white/[.02]" onClick={() => openEvent(e.id)}>
                  <td className="td whitespace-nowrap">{e.start_at ? ist(e.start_at, e.time_known) : 'TBA'}</td>
                  <td className="td"><p className="font-medium">{e.title}</p><p className="text-xs text-muted">{e.artists.map((a: Any) => a.name).join(', ')}{e.change_count ? ` · ${e.change_count} change(s)` : ''}{e.is_synthetic ? ' · TEST RECORD' : ''}</p></td>
                  <td className="td"><p className={e.city === 'Bengaluru' ? 'text-accent' : ''}>{e.city ?? '—'}</p><p className="text-xs text-muted">{e.venue ?? 'Venue TBA'}</p></td>
                  <td className="td"><Pill s={e.ticket_status} map={TICKET} />{e.price_min && <p className="mt-1 text-xs text-muted">from {e.currency ?? ''} {Number(e.price_min).toLocaleString('en-IN')}</p>}{e.early_bird && <p className="mt-1 text-xs text-amber-300">Early-bird: {e.early_bird}</p>}</td>
                  <td className="td"><Pill s={e.verification} map={VERIF} /></td>
                  <td className="td text-xs text-muted">{e.primary_source}</td>
                  <td className="td text-xs text-muted whitespace-nowrap">{ago(e.last_verified_at)}</td>
                  <td className="td">{(e.booking_url || e.official_url) && <a className="text-sm text-accent" href={e.booking_url ?? e.official_url} target="_blank" rel="noopener noreferrer" onClick={ev => ev.stopPropagation()}>{e.booking_url ? 'Book ↗' : 'Source ↗'}</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EventDrawer({ id, close, notify }: { id: string; close: () => void; notify: (m: string, ok?: boolean) => void }) {
  const [d, setD] = useState<Any>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<'booked' | 'attending' | ''>('');
  const load = useCallback(() => api(`/api/events/${id}`).then(setD).catch(e => notify(e.message, false)), [id, notify]);
  useEffect(() => { load(); }, [load]);
  async function confirm() {
    if (!choice) return;
    setBusy(true);
    try { const r = await api(`/api/events/${id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmation: choice, explicit: true }) }); notify(r.duplicate ? 'Already in your calendar — no duplicate created.' : 'Added to Google Calendar.'); }
    catch (e: Any) { notify(e.message, false); }
    setBusy(false); load();
  }
  const e = d?.event;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={close}>
      <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-line bg-panel p-5" onClick={ev => ev.stopPropagation()}>
        <button className="btn mb-4" onClick={close}>Close</button>
        {!e ? <p className="text-muted">Loading…</p> : (
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex flex-wrap gap-2"><Pill s={e.ticket_status} map={TICKET} /><Pill s={e.verification} map={VERIF} />{e.is_synthetic && <span className="pill bg-rose-500/15 text-rose-300">Test record</span>}</div>
              <h2 className="text-xl font-semibold">{e.title}</h2>
              <p className="text-sm text-muted">{d.artists.map((a: Any) => a.name).join(', ')}</p>
            </div>
            <dl className="card space-y-1.5 p-4 text-sm">
              <Row k="Date & time" v={e.start_at ? `${ist(e.start_at, e.time_known)}${e.time_known ? ' IST' : ' (time TBA)'}` : 'Not announced'} />
              <Row k="City" v={e.city ?? 'Unknown'} /><Row k="Venue" v={e.venue ?? 'Unknown'} />
              <Row k="Price" v={e.price_min ? `from ${e.currency ?? ''} ${Number(e.price_min).toLocaleString('en-IN')}` : 'Not verified'} />
              <Row k="Early-bird" v={e.early_bird ?? 'None verified'} />
              <Row k="Last verified" v={ist(e.last_verified_at)} />
              <Row k="Confidence" v={`${Math.round(Number(e.confidence) * 100)}%`} />
              {e.booking_url && <Row k="Booking" v={<a className="text-accent" href={e.booking_url} target="_blank" rel="noopener noreferrer">Open booking page ↗</a>} />}
            </dl>
            <div className="card p-4">
              <h3 className="mb-1 font-semibold">Add to my calendar</h3>
              {d.calendar?.status === 'created' ? <p className="text-sm">✅ In Google Calendar ({d.calendar.confirmation}). {d.calendar.google_event_url && <a className="text-accent" href={d.calendar.google_event_url} target="_blank" rel="noopener noreferrer">Open ↗</a>}</p> : (
                <>
                  <p className="mb-3 text-sm text-muted">Nothing is added automatically. Confirm first:</p>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {(['booked', 'attending'] as const).map(c => <label key={c} className={`btn cursor-pointer ${choice === c ? 'border-accent text-accent' : ''}`}><input type="radio" className="sr-only" name="c" checked={choice === c} onChange={() => setChoice(c)} />{c === 'booked' ? 'I booked tickets' : 'I plan to attend'}</label>)}
                  </div>
                  <button className="btn-primary" disabled={!choice || busy || !e.start_at} onClick={confirm}>{busy ? 'Adding…' : 'Confirm & add to Google Calendar'}</button>
                  {!e.start_at && <p className="mt-2 text-xs text-amber-300">No verified date yet — can’t add to a calendar.</p>}
                  {d.calendar?.error && <p className="mt-2 text-xs text-rose-300">{d.calendar.error}</p>}
                </>
              )}
            </div>
            <div><h3 className="mb-2 font-semibold">Why it matched</h3><ul className="space-y-1 text-sm text-muted">{d.artists.map((a: Any) => <li key={a.id}>• {a.match_reason}</li>)}</ul></div>
            <div><h3 className="mb-2 font-semibold">Source evidence</h3><ul className="space-y-2">{d.evidence.map((x: Any) => <li key={x.id} className="card p-3 text-sm"><p className="text-xs text-muted">{x.source_id} · first seen {ist(x.first_seen_at)} · last seen {ago(x.last_seen_at)}</p>{x.excerpt && <p className="mt-1">“{x.excerpt}”</p>}<a className="mt-1 block truncate text-xs text-accent" href={x.source_url} target="_blank" rel="noopener noreferrer">{x.source_url}</a></li>)}</ul></div>
            <div><h3 className="mb-2 font-semibold">Change history</h3><ul className="space-y-1 text-sm">{d.changes.map((c: Any) => <li key={c.id} className="flex justify-between gap-3"><span>{c.change_kind === 'new_event' ? 'First detected' : `${c.field}: ${c.old_value ?? '—'} → ${c.new_value ?? '—'}`}</span><span className="shrink-0 text-xs text-muted">{ist(c.detected_at)}</span></li>)}</ul></div>
            <div><h3 className="mb-2 font-semibold">Alerts</h3>{d.alerts.length === 0 ? <p className="text-sm text-muted">None.</p> : <ul className="space-y-1 text-sm">{d.alerts.map((a: Any) => <li key={a.id} className="flex justify-between"><span>{a.kind}</span><Pill s={a.status} /></li>)}</ul>}</div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Artists({ notify, spotify, onChange }: { notify: (m: string, ok?: boolean) => void; spotify: Any; onChange: () => void }) {
  const [list, setList] = useState<Any[] | null>(null);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ name: '', aliases: '', priority: false, url: '' });
  const [edit, setEdit] = useState<Any>(null);
  const [preview, setPreview] = useState<Any[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/api/artists').then(j => setList(j.artists)).catch(e => notify(e.message, false)), [notify]);
  useEffect(() => { load(); }, [load]);
  const split = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    try { await api('/api/artists', { method: 'POST', body: JSON.stringify({ name: form.name, aliases: split(form.aliases), priority: form.priority, official_tour_url: form.url || null }) }); setForm({ name: '', aliases: '', priority: false, url: '' }); notify(`Added ${form.name}`); load(); onChange(); }
    catch (err: Any) { notify(err.message, false); }
  }
  async function save() {
    try { await api(`/api/artists/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ name: edit.name, aliases: split(edit.aliasText), priority: edit.priority, official_tour_url: edit.official_tour_url || null }) }); setEdit(null); load(); notify('Saved'); }
    catch (err: Any) { notify(err.message, false); }
  }
  async function remove(a: Any) {
    if (!confirm(`Remove ${a.name} from the watchlist? Their matched events stay in history.`)) return;
    try { await api(`/api/artists/${a.id}`, { method: 'DELETE' }); load(); onChange(); notify(`Removed ${a.name}`); } catch (err: Any) { notify(err.message, false); }
  }
  async function loadPreview() {
    setBusy(true);
    try { const j = await api('/api/spotify/preview'); setPreview(j.artists); setSel(new Set(j.artists.filter((a: Any) => !a.alreadyWatched).map((a: Any) => a.id))); } catch (e: Any) { notify(e.message, false); }
    setBusy(false);
  }
  async function doImport() {
    setBusy(true);
    try { const r = await api('/api/spotify/import', { method: 'POST', body: JSON.stringify({ ids: [...sel] }) }); notify(`Spotify sync: ${r.fetched} followed, ${r.added} added`); setPreview(null); load(); onChange(); } catch (e: Any) { notify(e.message, false); }
    setBusy(false);
  }
  const rows = (list ?? []).filter(a => !q || a.name.toLowerCase().includes(q.toLowerCase()) || a.aliases.some((x: string) => x.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4">
        <form onSubmit={add} className="card space-y-3 p-4">
          <h2 className="font-semibold">Add artist</h2>
          <input className="input" placeholder="Artist name, e.g. Prateek Kuhad" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          <input className="input" placeholder="Aliases (comma-separated)" value={form.aliases} onChange={e => setForm({ ...form, aliases: e.target.value })} />
          <input className="input" placeholder="Official tour page URL (optional, https://)" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.priority} onChange={e => setForm({ ...form, priority: e.target.checked })} /> Priority artist</label>
          <button className="btn-primary w-full" disabled={!form.name.trim()}>Add to watchlist</button>
        </form>
        <div className="card space-y-2 p-4">
          <h2 className="font-semibold">Spotify import</h2>
          {!spotify?.configured ? <p className="text-sm text-muted">Spotify isn’t configured yet (see Settings). Manual artists work without it.</p> : !spotify.connected ? <a className="btn" href="/api/spotify/login">Connect Spotify</a> : (
            <>
              <p className="text-sm text-muted">Connected as {spotify.account}. Last sync: {spotify.lastSync ? `${ago(spotify.lastSync.started_at)} (${spotify.lastSync.status}, ${spotify.lastSync.added} added)` : 'never'}</p>
              <button className="btn" disabled={busy} onClick={loadPreview}>{busy ? 'Loading…' : 'Preview followed artists'}</button>
            </>
          )}
        </div>
      </div>
      <div className="card lg:col-span-2">
        {preview ? (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Spotify preview · {preview.length} followed</h2><div className="flex gap-2"><button className="btn" onClick={() => setPreview(null)}>Cancel</button><button className="btn-primary" disabled={busy || sel.size === 0} onClick={doImport}>Import {sel.size} artists</button></div></div>
            <ul className="grid max-h-[60vh] gap-1 overflow-y-auto sm:grid-cols-2">{preview.map(a => <li key={a.id}><label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5"><input type="checkbox" checked={sel.has(a.id)} disabled={a.alreadyWatched} onChange={e => { const s = new Set(sel); if (e.target.checked) s.add(a.id); else s.delete(a.id); setSel(s); }} />{a.image && <img src={a.image} alt="" className="h-6 w-6 rounded-full" />}<span className="truncate">{a.name}</span>{a.alreadyWatched && <span className="text-xs text-muted">(watching)</span>}</label></li>)}</ul>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-line p-3"><h2 className="pl-1 font-semibold">Watchlist · {list?.length ?? 0}</h2><input className="input max-w-xs" placeholder="Search artists" value={q} onChange={e => setQ(e.target.value)} /></div>
            {!list ? <p className="p-4 text-sm text-muted">Loading…</p> : rows.length === 0 ? <div className="p-4"><Empty title={list.length ? 'No artists match' : 'Your watchlist is empty'} body="Add a few artists to start — e.g. artists touring India right now. You don’t need all 60 to try it." /></div> : (
              <ul className="divide-y divide-line">{rows.map(a => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  {edit?.id === a.id ? (
                    <div className="grid w-full gap-2 sm:grid-cols-2">
                      <input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} />
                      <input className="input" placeholder="Aliases" value={edit.aliasText} onChange={e => setEdit({ ...edit, aliasText: e.target.value })} />
                      <input className="input sm:col-span-2" placeholder="Official tour URL" value={edit.official_tour_url ?? ''} onChange={e => setEdit({ ...edit, official_tour_url: e.target.value })} />
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.priority} onChange={e => setEdit({ ...edit, priority: e.target.checked })} /> Priority</label>
                      <div className="flex justify-end gap-2"><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></div>
                    </div>
                  ) : (
                    <>
                      {a.image_url ? <img src={a.image_url} alt="" className="h-9 w-9 rounded-full" /> : <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-accent3/40 to-accent2/30 text-sm font-semibold">{a.name[0]}</div>}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{a.priority && <span className="mr-1 text-amber-300">★</span>}{a.name}</p>
                        <p className="truncate text-xs text-muted">{a.origin === 'spotify' ? 'Spotify' : 'Manual'}{!a.following ? ' · unfollowed on Spotify' : ''}{a.aliases.length ? ` · aka ${a.aliases.join(', ')}` : ''}{a.official_tour_url ? ' · tour page set' : ''} · {a.event_count} event(s)</p>
                      </div>
                      <button className="btn" onClick={() => setEdit({ ...a, aliasText: a.aliases.join(', ') })}>Edit</button>
                      <button className="btn-danger" onClick={() => remove(a)}>Remove</button>
                    </>
                  )}
                </li>
              ))}</ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Alerts({ notify }: { notify: (m: string, ok?: boolean) => void }) {
  const [list, setList] = useState<Any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api('/api/alerts').then(j => setList(j.alerts)).catch(e => notify(e.message, false)), [notify]);
  useEffect(() => { load(); }, [load]);
  async function retry(ids?: string[]) { try { const r = await api('/api/alerts', { method: 'POST', body: JSON.stringify({ ids }) }); notify(r.skipped ? r.skipped : `Delivered ${r.delivered} of ${r.attempted}`, !r.skipped); load(); } catch (e: Any) { notify(e.message, false); } }
  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-line p-3"><h2 className="pl-1 font-semibold">Telegram alerts</h2><button className="btn" onClick={() => retry()}>Send pending now</button></div>
      {!list ? <p className="p-4 text-sm text-muted">Loading…</p> : list.length === 0 ? <div className="p-4"><Empty title="No alerts yet" body="Alerts are created when a monitoring run finds a new show or a meaningful change, then delivered to Telegram." /></div> : (
        <ul className="divide-y divide-line">{list.map(a => (
          <li key={a.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <Pill s={a.status} />
              <span className="min-w-0 flex-1 truncate text-sm">{a.kind === 'test' ? 'Test message' : `${a.kind === 'new_show' ? 'New show' : 'Update'} · ${a.event_title}`}</span>
              <span className="text-xs text-muted">{a.attempts} attempt(s) · {a.delivered_at ? `delivered ${ago(a.delivered_at)}` : `created ${ago(a.created_at)}`}</span>
              <button className="text-xs text-accent" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide' : 'Preview'}</button>
              {a.status === 'failed' && a.kind !== 'test' && <button className="btn" onClick={() => retry([a.id])}>Retry</button>}
            </div>
            {a.last_error && <p className="mt-1 text-xs text-rose-300">{a.last_error}</p>}
            {open === a.id && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-panel2 p-3 text-xs text-muted">{a.message.replace(/<[^>]+>/g, '')}</pre>}
          </li>
        ))}</ul>
      )}
    </div>
  );
}

function Sources({ s, notify, refresh }: { s: Any; notify: (m: string, ok?: boolean) => void; refresh: () => void }) {
  if (!s) return <p className="text-muted">Loading…</p>;
  async function toggle(id: string, enabled: boolean) { try { await api(`/api/sources/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }); refresh(); } catch (e: Any) { notify(e.message, false); } }
  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[960px]">
          <thead className="bg-panel2/60"><tr><th className="th">Source</th><th className="th">Type</th><th className="th">Status</th><th className="th">Poll</th><th className="th">Last success</th><th className="th">Last error</th><th className="th">Creds</th><th className="th">Booking URL</th><th className="th">Enabled</th></tr></thead>
          <tbody className="divide-y divide-line">{s.sources.map((x: Any) => (
            <tr key={x.id}>
              <td className="td"><p className="font-medium">{x.name}</p><p className="max-w-sm text-xs text-muted">{x.coverage_notes}</p></td>
              <td className="td text-xs text-muted">{x.source_type}</td>
              <td className="td"><Pill s={x.status} /></td>
              <td className="td text-xs whitespace-nowrap">{x.poll_interval_minutes ? `${x.poll_interval_minutes} min` : '—'}</td>
              <td className="td text-xs whitespace-nowrap">{ago(x.last_success_at)}</td>
              <td className="td max-w-xs text-xs text-rose-300/90">{x.last_error ?? ''}</td>
              <td className="td text-xs">{x.requires_credentials ? 'Yes' : 'No'}</td>
              <td className="td text-xs">{x.supports_booking_url ? 'Yes' : 'No'}</td>
              <td className="td"><input type="checkbox" checked={x.enabled} onChange={e => toggle(x.id, e.target.checked)} aria-label={`Enable ${x.name}`} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card p-4">
        <h2 className="mb-1 font-semibold">Monitoring history</h2>
        <p className="mb-3 text-xs text-muted">The scheduler fires every 5 minutes; each source is only polled when its own interval has elapsed (shown above), so most runs skip most sources.</p>
        <ul className="divide-y divide-line text-sm">{s.runs.map((r: Any) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
            <Pill s={r.status} /><span className="text-xs text-muted">{r.trigger}</span><span>{ist(r.started_at)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{r.error ?? (r.summary?.sources ?? []).map((x: Any) => `${x.source}: ${x.status}${x.fetched != null ? ` (${x.fetched} fetched, ${x.matched} matched, ${x.created} new)` : x.error ? ` (${x.error})` : ''}`).join(' · ')}</span>
          </li>
        ))}</ul>
      </div>
    </div>
  );
}

function Settings({ s, notify, refresh }: { s: Any; notify: (m: string, ok?: boolean) => void; refresh: () => void }) {
  const [tg, setTg] = useState<Any>(null);
  const [cals, setCals] = useState<Any[] | null>(null);
  const [busy, setBusy] = useState('');
  if (!s) return <p className="text-muted">Loading…</p>;
  const i = s.integrations;
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } catch (e: Any) { notify(e.message, false); } setBusy(''); refresh(); };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Telegram</h2><Pill s={integrationState(i.telegram, 'telegram')} /></div>
        {i.telegram.missing.length > 0 && <p className="text-sm text-amber-300">Missing on server: {i.telegram.missing.join(', ')}</p>}
        <p className="text-xs text-muted">Last successful delivery: {i.telegram.lastSuccess ? ist(i.telegram.lastSuccess) : 'never'}{i.telegram.lastFailure ? ` · last failure: ${i.telegram.lastFailure.error}` : ''}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={!!busy} onClick={() => run('tgc', async () => setTg(await api('/api/telegram')))}>Check bot & find chat ID</button>
          <button className="btn-primary" disabled={!!busy || i.telegram.missing.length > 0} onClick={() => run('tgt', async () => { await api('/api/telegram', { method: 'POST' }); notify('Test message delivered — check Telegram.'); })}>{busy === 'tgt' ? 'Sending…' : 'Send test message'}</button>
        </div>
        {tg && <div className="rounded-lg bg-panel2 p-3 text-sm">
          <p>Bot: {tg.bot.ok ? `@${tg.bot.username} ✓` : `not reachable (${tg.bot.error})`}</p>
          {tg.bot.ok && (tg.chats.length ? <><p className="mt-2 text-muted">Chats that messaged the bot — copy the ID into TELEGRAM_CHAT_ID:</p><ul className="mt-1 font-mono text-xs">{tg.chats.map((c: Any) => <li key={c.id}>{c.id} — {c.title} ({c.type})</li>)}</ul></> : <p className="mt-2 text-muted">No chats found. Open your bot in Telegram, press Start / send “hi”, then click the button again.</p>)}
        </div>}
      </section>
      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Gemini Flash</h2><Pill s={integrationState(i.gemini, 'gemini')} /></div>
        <p className="text-sm text-muted">Model: <span className="font-mono">{i.gemini.model}</span>. Used to extract structured details from news announcements. AI output is never treated as proof — events from news are labelled “Reported”.</p>
        {i.gemini.lastCheck && <p className="text-xs text-muted">Last check {ago(i.gemini.lastCheck.at)}: {i.gemini.lastCheck.detail?.ok ? 'OK' : i.gemini.lastCheck.detail?.error}</p>}
        <button className="btn" disabled={!!busy} onClick={() => run('gem', async () => { const r = await api('/api/gemini', { method: 'POST' }); notify(`Gemini ${r.model} responded OK`); })}>{busy === 'gem' ? 'Checking…' : 'Run live check'}</button>
      </section>
      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Spotify</h2><Pill s={integrationState(i.spotify, 'spotify')} /></div>
        {i.spotify.missing.length > 0 && <p className="text-sm text-amber-300">Missing on server: {i.spotify.missing.join(', ')}</p>}
        <p className="text-xs text-muted">Redirect URI to register: <code className="break-all text-white">{i.spotify.redirectUri}</code></p>
        {i.spotify.connected ? <div className="flex gap-2"><span className="text-sm">Connected as {i.spotify.account}</span><button className="btn" onClick={() => run('spd', async () => { await api('/api/spotify/disconnect', { method: 'POST' }); })}>Disconnect</button></div> : <a className={`btn ${i.spotify.missing.length ? 'pointer-events-none opacity-50' : ''}`} href="/api/spotify/login">Connect Spotify</a>}
      </section>
      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Google Calendar</h2><Pill s={integrationState(i.google, 'google')} /></div>
        {i.google.missing.length > 0 && <p className="text-sm text-amber-300">Missing on server: {i.google.missing.join(', ')}</p>}
        <p className="text-xs text-muted">Redirect URI to register: <code className="break-all text-white">{i.google.redirectUri}</code></p>
        {i.google.connected ? (
          <div className="space-y-2 text-sm">
            <p>Connected · calendar: <span className="font-mono text-xs">{i.google.calendarId ?? 'primary'}</span></p>
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => run('cal', async () => setCals((await api('/api/google/calendars')).calendars))}>Choose calendar</button>
              <button className="btn" onClick={() => run('gd', async () => { await api('/api/google/disconnect', { method: 'POST' }); })}>Disconnect</button>
            </div>
            {cals && <select className="input" defaultValue={i.google.calendarId ?? ''} onChange={e => run('cs', async () => { await api('/api/google/select', { method: 'POST', body: JSON.stringify({ calendarId: e.target.value }) }); notify('Calendar selected'); })}>{cals.map(c => <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (primary)' : ''}</option>)}</select>}
          </div>
        ) : <a className={`btn ${i.google.missing.length ? 'pointer-events-none opacity-50' : ''}`} href="/api/google/login">Connect Google Calendar</a>}
        <p className="text-xs text-muted">Events are only created after you confirm “booked” or “plan to attend” on an event. No invitations are sent.</p>
      </section>
    </div>
  );
}
