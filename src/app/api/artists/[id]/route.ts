import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession, jsonError } from '@/lib/auth';
import { db, audit } from '@/lib/db';
import { nameKey } from '@/lib/core';

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  priority: z.boolean().optional(),
  official_tour_url: z.string().url().startsWith('https://').max(500).nullable().optional(),
});
const Id = z.string().uuid();

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const deny = requireSession(req); if (deny) return deny;
  const id = Id.safeParse((await ctx.params).id); if (!id.success) return jsonError(400, 'Invalid id');
  const p = Patch.safeParse(await req.json().catch(() => null));
  if (!p.success) return jsonError(400, 'Invalid update');
  const sql = db();
  try {
    await sql.begin(async tx => {
      const [cur] = await tx`select * from radar.artists where id = ${id.data} for update`;
      if (!cur) throw Object.assign(new Error('Artist not found'), { status: 404 });
      const name = p.data.name ?? cur.name;
      await tx`update radar.artists set name = ${name}, name_key = ${nameKey(name)}, priority = ${p.data.priority ?? cur.priority},
        official_tour_url = ${p.data.official_tour_url === undefined ? cur.official_tour_url : p.data.official_tour_url}, updated_at = now() where id = ${id.data}`;
      if (p.data.aliases) {
        await tx`delete from radar.artist_aliases where artist_id = ${id.data}`;
        for (const al of new Set(p.data.aliases)) { const k = nameKey(al); if (k && k !== nameKey(name)) await tx`insert into radar.artist_aliases (artist_id, alias, alias_key) values (${id.data}, ${al}, ${k}) on conflict do nothing`; }
      }
    });
  } catch (e) {
    const err = e as Error & { status?: number; code?: string };
    if (err.code === '23505') return jsonError(409, 'Another artist already has that name');
    return jsonError(err.status ?? 500, err.status ? err.message : 'Update failed');
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const deny = requireSession(req); if (deny) return deny;
  const id = Id.safeParse((await ctx.params).id); if (!id.success) return jsonError(400, 'Invalid id');
  const [a] = await db()`delete from radar.artists where id = ${id.data} returning name`;
  if (!a) return jsonError(404, 'Artist not found');
  await audit('artist_removed', { name: a.name });
  return NextResponse.json({ ok: true });
}
