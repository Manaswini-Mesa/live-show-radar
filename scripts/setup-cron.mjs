// Schedules the monitor every 5 minutes with Supabase pg_cron + pg_net.
// The CRON_SECRET is stored in Supabase Vault (never in SQL files or git).
// Usage: APP_URL=https://<app>.vercel.app node scripts/setup-cron.mjs
import fs from 'node:fs';
import postgres from 'postgres';

for (const line of fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const appUrl = process.env.APP_URL; const secret = process.env.CRON_SECRET;
if (!appUrl?.startsWith('https://') || !secret) { console.error('Need APP_URL (https) and CRON_SECRET'); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL_NON_POOLING || process.env.POSTGRES_URL_NON_POOLING, { prepare: false, ssl: 'require', onnotice: () => {} });

await sql`create extension if not exists pg_cron`;
await sql`create extension if not exists pg_net`;
const [existing] = await sql`select id from vault.secrets where name = 'radar_cron_secret'`;
if (existing) await sql`select vault.update_secret(${existing.id}::uuid, ${secret})`;
else await sql`select vault.create_secret(${secret}, 'radar_cron_secret', 'Bearer secret for Live Show Radar monitor')`;
const [u] = await sql`select id from vault.secrets where name = 'radar_app_url'`;
if (u) await sql`select vault.update_secret(${u.id}::uuid, ${appUrl})`;
else await sql`select vault.create_secret(${appUrl}, 'radar_app_url', 'Live Show Radar base URL')`;

await sql.unsafe(`select cron.unschedule('live-show-radar-monitor') where exists (select 1 from cron.job where jobname = 'live-show-radar-monitor')`);
await sql.unsafe(`select cron.schedule('live-show-radar-monitor', '*/5 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'radar_app_url') || '/api/monitor/run',
    headers := jsonb_build_object('content-type', 'application/json',
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'radar_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$)`);
console.log(await sql`select jobid, jobname, schedule, active from cron.job where jobname = 'live-show-radar-monitor'`);
await sql.end();
