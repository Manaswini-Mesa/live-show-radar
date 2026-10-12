import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession, jsonError } from '@/lib/auth';
import { db, audit } from '@/lib/db';

const Body = z.object({ interest: z.enum(['interested', 'not_interested']).nullable() });

// Same effect as the Telegram buttons, from the dashboard. null clears the answer.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const deny = requireSession(req); if (deny) return deny;
  const id = z.string().uuid().safeParse((await ctx.params).id); if (!id.success) return jsonError(400, 'Invalid id');
  const b = Body.safeParse(await req.json().catch(() => null)); if (!b.success) return jsonError(400, 'Invalid body');
  const [ev] = await db()`update radar.events set interest = ${b.data.interest}, interest_at = ${b.data.interest ? new Date() : null} where id = ${id.data} returning id`;
  if (!ev) return jsonError(404, 'Event not found');
  if (b.data.interest) await db()`update radar.alerts set status = 'suppressed', last_error = ${`User marked ${b.data.interest}`} where event_id = ${id.data} and kind = 'tickets_live' and status in ('pending','failed')`;
  await audit('interest_set', { event_id: id.data, interest: b.data.interest, via: 'dashboard' });
  return NextResponse.json({ ok: true });
}
