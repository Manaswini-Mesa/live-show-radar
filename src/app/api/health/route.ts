import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { configReport } from '@/lib/env';


// Public health check: no secrets, only booleans and missing *names* of required config.
export async function GET() {
  let database = false;
  try { await db()`select 1 from radar.event_sources limit 1`; database = true; } catch { /* reported below */ }
  const { missingRequired } = configReport();
  const ok = database && missingRequired.length === 0;
  return NextResponse.json({ ok, database, missingRequired, time: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
