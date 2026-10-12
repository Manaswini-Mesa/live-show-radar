import { NextResponse, type NextRequest } from 'next/server';
import { requireSession, jsonError } from '@/lib/auth';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { recentChats, sendTelegram, telegramBotInfo } from '@/lib/telegram';


// GET → bot validation + chats that recently messaged the bot (to find TELEGRAM_CHAT_ID).
export async function GET(req: NextRequest) {
  const deny = requireSession(req); if (deny) return deny;
  if (!env.telegramToken()) return NextResponse.json({ bot: { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }, chats: [], chatConfigured: !!env.telegramChatId() });
  const bot = await telegramBotInfo();
  let chats: Awaited<ReturnType<typeof recentChats>> = [];
  let chatsError: string | undefined;
  try { chats = await recentChats(); } catch (e) { chatsError = (e as Error).message; }
  return NextResponse.json({ bot, chats, chatsError, chatConfigured: !!env.telegramChatId() });
}

// POST → real test message, persisted as an alert with delivery attempts.
export async function POST(req: NextRequest) {
  const deny = requireSession(req); if (deny) return deny;
  if (!env.telegramToken() || !env.telegramChatId()) return jsonError(409, 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first');
  const sql = db();
  const msg = `✅ <b>Live Show Radar test message</b>\nYour alerts are connected. Sent ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST.`;
  const [a] = await sql`insert into radar.alerts (kind, idempotency_key, message, status) values ('test', ${'test:' + Date.now()}, ${msg}, 'sending') returning id`;
  const r = await sendTelegram(msg);
  await sql`insert into radar.alert_attempts (alert_id, ok, http_status, error) values (${a.id}, ${r.ok}, ${r.ok ? 200 : r.status}, ${r.ok ? null : r.error})`;
  if (r.ok) await sql`update radar.alerts set status = 'delivered', delivered_at = now(), attempts = 1, telegram_message_id = ${r.messageId} where id = ${a.id}`;
  else await sql`update radar.alerts set status = 'failed', attempts = 1, last_error = ${r.error}, next_attempt_at = 'infinity' where id = ${a.id}`;
  return r.ok ? NextResponse.json({ ok: true }) : jsonError(502, `Telegram rejected the message: ${r.error}`);
}
