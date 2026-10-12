// Applies migrations/*.sql in order, once each. Usage: node scripts/migrate.mjs
// Reads DATABASE_URL_NON_POOLING / POSTGRES_URL_NON_POOLING / DATABASE_URL from env or .env.local.
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

function loadEnv() {
  if (!fs.existsSync('.env.local')) return;
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
loadEnv();
const url = process.env.DATABASE_URL_NON_POOLING || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }
const sql = postgres(url, { prepare: false, ssl: 'require', onnotice: () => {} });

await sql`create table if not exists public._radar_migrations (name text primary key, applied_at timestamptz default now())`;
await sql`alter table public._radar_migrations enable row level security`;
const done = new Set((await sql`select name from public._radar_migrations`).map(r => r.name));
const dir = path.join(process.cwd(), 'migrations');
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  if (done.has(f)) { console.log('skip', f); continue; }
  await sql.begin(async tx => {
    await tx.unsafe(fs.readFileSync(path.join(dir, f), 'utf8'));
    await tx`insert into public._radar_migrations (name) values (${f})`;
  });
  console.log('applied', f);
}
await sql.end();
