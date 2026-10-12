import { NextResponse, type NextRequest } from 'next/server';
import { createSessionValue, safeEqual, sessionCookie, SESSION_COOKIE, jsonError } from '@/lib/auth';
import { env } from '@/lib/env';
import { audit } from '@/lib/db';

// POST {password} → session cookie. DELETE → logout.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const pw = typeof body.password === 'string' ? body.password : '';
  if (!env.dashboardPassword()) return jsonError(503, 'DASHBOARD_PASSWORD is not configured on the server');
  await new Promise(r => setTimeout(r, 300)); // slow brute force a little
  if (!safeEqual(pw, env.dashboardPassword())) { await audit('login_failed'); return jsonError(401, 'Wrong password'); }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(createSessionValue()));
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 });
  return res;
}
