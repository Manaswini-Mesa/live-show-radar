'use client';
import { useState } from 'react';

export default function Login() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (r.ok) location.href = '/'; else { setErr((await r.json().catch(() => ({}))).error ?? 'Sign-in failed'); setBusy(false); }
  }
  return (
    <main className="min-h-screen grid place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm card p-8 space-y-5">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Live Show Radar</h1>
            <p className="text-sm text-muted">Private dashboard</p>
          </div>
        </div>
        <label className="block text-sm">
          <span className="text-muted">Dashboard password</span>
          <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} className="input mt-1" />
        </label>
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <button disabled={busy || !pw} className="btn-primary w-full">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

function Logo() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="18" fill="none" stroke="var(--accent)" strokeOpacity=".35" strokeWidth="2" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="var(--accent)" strokeOpacity=".6" strokeWidth="2" />
      <circle cx="20" cy="20" r="4" fill="var(--accent)" />
      <path d="M20 20 L34 9" stroke="var(--accent-2)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
