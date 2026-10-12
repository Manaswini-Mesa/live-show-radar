import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';


export async function GET(req: NextRequest) {
  const deny = requireSession(req); if (deny) return deny;
  const includePast = req.nextUrl.searchParams.get('past') === '1';
  const rows = await db()`select e.*,
      coalesce((select json_agg(json_build_object('id', a.id, 'name', a.name, 'reason', ea.match_reason)) from radar.event_artists ea join radar.artists a on a.id = ea.artist_id where ea.event_id = e.id), '[]') as artists,
      (select count(*) from radar.event_evidence ev where ev.event_id = e.id)::int as evidence_count,
      (select count(*) from radar.event_changes c where c.event_id = e.id and c.change_kind <> 'new_event')::int as change_count,
      cl.status as calendar_status, cl.confirmation, cl.google_event_url
    from radar.events e left join radar.calendar_links cl on cl.event_id = e.id
    where ${includePast} or e.start_at is null or e.start_at >= now() - interval '1 day'
    order by e.start_at asc nulls last limit 500`;
  return NextResponse.json({ events: rows });
}
