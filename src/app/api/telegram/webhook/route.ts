import { NextResponse, type NextRequest } from 'next/server';
import { safeEqual } from '@/lib/auth';
import { db, audit } from '@/lib/db';
import { env } from '@/lib/env';
import { answerCallback, editKeyboard, interestKeyboard, webhookSecret } from '@/lib/telegram';

/**
 * Telegram webhook for the Interested / Not interested buttons.
 * Trusted only when Telegram echoes our secret token AND the press comes from the configured chat.
 */
export async function POST(req: NextRequest) {
  if (!safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', webhookSecret())) return NextResponse.json({ ok: false }, { status: 401 });
  const update = await req.json().catch(() => null);
  const cq = update?.callback_query;
  if (!cq) return NextResponse.json({ ok: true });
  const chatId = cq.message?.chat?.id;
  if (String(chatId) !== env.telegramChatId()) { await answerCallback(cq.id, 'Not allowed'); return NextResponse.json({ ok: true }); }
  const m = /^([in]):([0-9a-f-]{36})$/.exec(String(cq.data ?? ''));
  if (!m) { await answerCallback(cq.id, 'Unknown action'); return NextResponse.json({ ok: true }); }
  const interest = m[1] === 'i' ? 'interested' : 'not_interested';
  const [ev] = await db()`update radar.events set interest = ${interest}, interest_at = now(), notify_me = case when ${interest} = 'not_interested' then false else notify_me end where id = ${m[2]} returning id, title, booking_url`;
  if (!ev) { await answerCallback(cq.id, 'Show not found'); return NextResponse.json({ ok: true }); }
  // A pending "tickets live" nudge is no longer needed once the user has answered.
  await db()`update radar.alerts set status = 'suppressed', last_error = ${`User marked ${interest}`} where event_id = ${ev.id} and status in ('pending','failed') and (kind = 'tickets_live' or ${interest} = 'not_interested')`;
  await audit('interest_set', { event_id: ev.id, interest, via: 'telegram' });
  await answerCallback(cq.id, interest === 'interested' ? '👍 Marked as interested' : '👎 Got it - you won’t hear about this show again');
  // Tick only this show's buttons; digests carry one row per show, so keep the other rows intact.
  const current = cq.message?.reply_markup?.inline_keyboard as { text: string; callback_data?: string; url?: string }[][] | undefined;
  if (current?.length) {
    const strip = (t: string) => t.replace(/^✅ /, '');
    // "Not interested" removes that show's buttons from the message entirely - it won't come back.
    const kept = interest === 'not_interested'
      ? current.filter(row => !row.some(b => b.callback_data === `i:${ev.id}` || b.callback_data === `n:${ev.id}`))
      : current;
    const rows = kept.map(row => row.map(b => {
      if (b.callback_data === `i:${ev.id}`) return { ...b, text: interest === 'interested' ? `✅ ${strip(b.text)}` : strip(b.text) };
      if (b.callback_data === `n:${ev.id}`) return { ...b, text: interest === 'not_interested' ? `✅ ${strip(b.text)}` : strip(b.text) };
      return b;
    }));
    await editKeyboard(chatId, cq.message.message_id, { inline_keyboard: rows });
  } else {
    await editKeyboard(chatId, cq.message.message_id, interestKeyboard(ev.id, interest, ev.booking_url));
  }
  return NextResponse.json({ ok: true });
}
