import 'server-only';
import postgres from 'postgres';
import { env } from './env';

const g = globalThis as unknown as { __radarSql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!g.__radarSql) {
    const url = env.databaseUrl();
    if (!url) throw new Error('Database is not configured (DATABASE_URL / POSTGRES_URL missing)');
    // prepare:false - required for the Supabase transaction pooler.
    g.__radarSql = postgres(url, { prepare: false, ssl: 'require', max: 3, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  }
  return g.__radarSql;
}

export async function audit(action: string, detail: Record<string, unknown> = {}) {
  try { await db()`insert into radar.audit_events (action, detail) values (${action}, ${db().json(detail as never)})`; } catch { /* audit must never break a request */ }
}
