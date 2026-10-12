import { NextResponse, type NextRequest } from 'next/server';
import { isCron, requireSession } from '@/lib/auth';
import { runMonitor } from '@/lib/monitor';

export const maxDuration = 60;

// Scheduler (Bearer CRON_SECRET) or signed-in dashboard user.
export async function POST(req: NextRequest) {
  const cron = isCron(req);
  if (!cron) { const deny = requireSession(req); if (deny) return deny; }
  const body = await req.json().catch(() => ({}));
  const force = !cron && body?.force === true;
  const sourceIds = Array.isArray(body?.sources) ? body.sources.filter((s: unknown) => typeof s === 'string').slice(0, 10) : undefined;
  const result = await runMonitor(cron ? 'cron' : 'manual', { force, sourceIds });
  return NextResponse.json(result, { status: result.status === 'failed' ? 500 : 200 });
}

export const GET = POST;
