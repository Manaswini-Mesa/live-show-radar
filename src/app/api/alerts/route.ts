import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession, jsonError } from '@/lib/auth';
import { db } from '@/lib/db';
import { deliverAlerts } from '@/lib/monitor';


export async function GET(req: NextRequest) {
  const deny = requireSession(req); if (deny) return deny;
  const rows = await db()`select a.id, a.kind, a.status, a.attempts, a.last_error, a.created_at, a.delivered_at, a.message, e.title as event_title, e.id as event_id
    from radar.alerts a left join radar.events e on e.id = a.event_id order by a.created_at desc limit 200`;
  return NextResponse.json({ alerts: rows });
}

// POST {ids?: string[]} → manual (re)delivery of pending/failed alerts.
export async function POST(req: NextRequest) {
  const deny = requireSession(req); if (deny) return deny;
  const body = z.object({ ids: z.array(z.string().uuid()).max(50).optional() }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) return jsonError(400, 'Invalid body');
  if (body.data.ids?.length) await db()`update radar.alerts set next_attempt_at = now() where id = any(${body.data.ids}) and status in ('pending','failed')`;
  return NextResponse.json(await deliverAlerts({ ids: body.data.ids }));
}
