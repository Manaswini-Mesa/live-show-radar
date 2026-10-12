import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { checkState, jsonError, makeState, requireSession } from '@/lib/auth';
import { db, audit } from '@/lib/db';
import { env } from '@/lib/env';
import { exchangeCode, googleFetch, saveTokens, GOOGLE_SCOPES } from '@/lib/oauth';


const back = (msg: string) => NextResponse.redirect(`${env.appUrl()}/?tab=settings&notice=${encodeURIComponent(msg)}`);

// /api/google/login | callback | calendars (GET) ; /api/google/select | disconnect (POST)
export async function GET(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const deny = requireSession(req);
  if (action === 'login') {
    if (deny) return NextResponse.redirect(`${env.appUrl()}/login`);
    if (!env.googleId() || !env.googleSecret()) return back('Google Calendar is not configured: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.search = new URLSearchParams({ client_id: env.googleId(), redirect_uri: env.googleRedirect(), response_type: 'code', scope: GOOGLE_SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: makeState('google') }).toString();
    return NextResponse.redirect(u.toString());
  }
  if (action === 'callback') {
    if (deny) return NextResponse.redirect(`${env.appUrl()}/login`);
    const sp = req.nextUrl.searchParams;
    if (!checkState('google', sp.get('state'))) return back('Google sign-in failed: invalid or expired state');
    if (sp.get('error')) return back(`Google sign-in cancelled: ${sp.get('error')}`);
    try {
      const t = await exchangeCode('google', sp.get('code') ?? '');
      await saveTokens('google', t, 'Google account');
      const primary = await googleFetch('/users/me/calendarList/primary').catch(() => null);
      if (primary?.id) await db()`update radar.oauth_connections set account_label = ${primary.summary ?? primary.id}, selected_calendar_id = coalesce(selected_calendar_id, ${primary.id}) where provider = 'google'`;
      await audit('google_connected');
      return back('Google Calendar connected.');
    } catch (e) { return back((e as Error).message); }
  }
  if (deny) return deny;
  if (action === 'calendars') {
    try {
      const j = await googleFetch('/users/me/calendarList?minAccessRole=writer');
      return NextResponse.json({ calendars: (j.items ?? []).map((c: { id: string; summary: string; primary?: boolean }) => ({ id: c.id, summary: c.summary, primary: !!c.primary })) });
    } catch (e) { return jsonError(502, (e as Error).message); }
  }
  return jsonError(404, 'Unknown action');
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const deny = requireSession(req); if (deny) return deny;
  const { action } = await ctx.params;
  if (action === 'disconnect') { await db()`delete from radar.oauth_connections where provider = 'google'`; return NextResponse.json({ ok: true }); }
  if (action !== 'select') return jsonError(404, 'Unknown action');
  const b = z.object({ calendarId: z.string().min(1).max(300) }).safeParse(await req.json().catch(() => null));
  if (!b.success) return jsonError(400, 'calendarId required');
  await db()`update radar.oauth_connections set selected_calendar_id = ${b.data.calendarId} where provider = 'google'`;
  return NextResponse.json({ ok: true });
}
