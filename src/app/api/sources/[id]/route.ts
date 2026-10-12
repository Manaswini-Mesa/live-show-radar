import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession, jsonError } from '@/lib/auth';
import { db, audit } from '@/lib/db';
import { ADAPTERS } from '@/lib/sources';

const Body = z.object({ enabled: z.boolean().optional(), poll_interval_minutes: z.number().int().min(5).max(1440).optional() });

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const deny = requireSession(req); if (deny) return deny;
  const { id } = await ctx.params;
  const b = Body.safeParse(await req.json().catch(() => null)); if (!b.success) return jsonError(400, 'Invalid body');
  if (b.data.enabled && !ADAPTERS[id]) return jsonError(409, 'This source has no working adapter yet, so it cannot be enabled');
  const [s] = await db()`update radar.event_sources set enabled = coalesce(${b.data.enabled ?? null}, enabled),
    poll_interval_minutes = coalesce(${b.data.poll_interval_minutes ?? null}, poll_interval_minutes),
    status = case when ${b.data.enabled ?? null}::boolean = false then 'disabled' when ${b.data.enabled ?? null}::boolean = true and status = 'disabled' then 'pending' else status end,
    updated_at = now() where id = ${id} returning id`;
  if (!s) return jsonError(404, 'Unknown source');
  await audit('source_updated', { id, ...b.data });
  return NextResponse.json({ ok: true });
}
