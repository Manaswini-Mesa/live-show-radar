import 'server-only';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from './env';

export const SESSION_COOKIE = 'lsr_session';
const MAX_AGE = 60 * 60 * 24 * 14;

const sign = (payload: string) => createHmac('sha256', env.sessionSecret()).update(payload).digest('base64url');

export function createSessionValue(): string {
  const payload = `owner.${Math.floor(Date.now() / 1000) + MAX_AGE}.${randomBytes(8).toString('hex')}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySession(value: string | undefined | null): boolean {
  if (!value || !env.sessionSecret()) return false;
  const i = value.lastIndexOf('.');
  const payload = value.slice(0, i), mac = value.slice(i + 1);
  const expected = sign(payload);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  return Number(payload.split('.')[1]) > Date.now() / 1000;
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest(), hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length > 0;
}

export const sessionCookie = (value: string) => ({ name: SESSION_COOKIE, value, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: MAX_AGE });

/** Returns a 401 response if the request has no valid dashboard session. */
export function requireSession(req: NextRequest): NextResponse | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value) ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function isCron(req: NextRequest): boolean {
  const secret = env.cronSecret();
  const h = req.headers.get('authorization') ?? '';
  return !!secret && safeEqual(h, `Bearer ${secret}`);
}

/** OAuth `state`: signed, short-lived, bound to the session cookie. */
export function makeState(provider: string): string {
  const p = `${provider}.${Math.floor(Date.now() / 1000) + 600}.${randomBytes(12).toString('hex')}`;
  return `${p}.${sign(p)}`;
}
export function checkState(provider: string, state: string | null): boolean {
  if (!state) return false;
  const i = state.lastIndexOf('.');
  const p = state.slice(0, i);
  const expected = sign(p);
  const mac = state.slice(i + 1);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  const [prov, exp] = p.split('.');
  return prov === provider && Number(exp) > Date.now() / 1000;
}

export const jsonError = (status: number, error: string) => NextResponse.json({ error }, { status });
