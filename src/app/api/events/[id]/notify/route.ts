import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession, jsonError } from '@/lib/auth';
import { db, audit } from '@/lib/db';

// Toggle "Notify me" for a show whose date isn't announced yet.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const deny = requireSession(req); if (deny) return deny;
  const id = z.string().uuid().safeParse((await ctx.params).id); if (!id.success) return jsonError(400, 'Invalid id');
  const b = z.object({ on: z.boolean() }).safeParse(await req.json().catch(() => null)); if (!b.success) return jsonError(400, 'Invalid body');
  const [ev] = await db()`update radar.events set notify_me = ${b.data.on} where id = ${id.data} returning id`;
  if (!ev) return jsonError(404, 'Show not found');
  await audit('notify_me', { event_id: id.data, on: b.data.on });
  return NextResponse.json({ ok: true });
}
