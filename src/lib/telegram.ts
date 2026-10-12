import 'server-only';
import { createHmac } from 'node:crypto';
import { env } from './env';

type TgResult = { ok: true; messageId: number } | { ok: false; status: number; error: string };

async function call(method: string, body?: object): Promise<{ status: number; json: { ok: boolean; result?: unknown; description?: string } }> {
  const token = env.telegramToken();
  if (!token) return { status: 0, json: { ok: false, description: 'TELEGRAM_BOT_TOKEN not set' } };
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return { status: res.status, json: await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` })) };
  } catch (e) {
    // Never include the request URL (it contains the token) in errors.
    return { status: 0, json: { ok: false, description: (e as Error).name === 'AbortError' ? 'Telegram timeout' : 'Network error contacting Telegram' } };
  } finally { clearTimeout(t); }
}

export type InlineKeyboard = { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] };

/** Interested / Not interested buttons for an event; the current choice is ticked. */
export function interestKeyboard(eventId: string, current: string | null, bookingUrl?: string | null): InlineKeyboard {
  const rows: InlineKeyboard['inline_keyboard'] = [[
    { text: `${current === 'interested' ? '✅ ' : '👍 '}Interested`, callback_data: `i:${eventId}` },
    { text: `${current === 'not_interested' ? '✅ ' : '👎 '}Not interested`, callback_data: `n:${eventId}` },
  ]];
  if (bookingUrl && /^https:\/\//.test(bookingUrl)) rows.push([{ text: '🎟 Open booking page', url: bookingUrl }]);
  return { inline_keyboard: rows };
}

/** Secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token; derived so no extra env var is needed. */
export function webhookSecret(): string {
  return createHmac('sha256', env.sessionSecret()).update('telegram-webhook').digest('hex').slice(0, 48);
}

export async function answerCallback(id: string, text: string) { await call('answerCallbackQuery', { callback_query_id: id, text }); }
export async function editKeyboard(chatId: number | string, messageId: number, markup: InlineKeyboard) {
  await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: markup });
}
export async function setWebhook(url: string) {
  const r = await call('setWebhook', { url, secret_token: webhookSecret(), allowed_updates: ['callback_query'], drop_pending_updates: false });
  return { ok: r.json.ok, description: r.json.description };
}

export async function sendTelegram(html: string, chatId = env.telegramChatId(), replyMarkup?: InlineKeyboard): Promise<TgResult> {
  if (!chatId) return { ok: false, status: 0, error: 'TELEGRAM_CHAT_ID not set' };
  const r = await call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: false }, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
  if (r.json.ok) return { ok: true, messageId: (r.json.result as { message_id: number }).message_id };
  return { ok: false, status: r.status, error: r.json.description ?? 'Unknown Telegram error' };
}

export async function telegramBotInfo(): Promise<{ ok: boolean; username?: string; error?: string }> {
  const r = await call('getMe');
  return r.json.ok ? { ok: true, username: (r.json.result as { username: string }).username } : { ok: false, error: r.json.description };
}

/** Chats that recently messaged the bot - used to discover TELEGRAM_CHAT_ID. */
export async function recentChats(): Promise<{ id: number; title: string; type: string }[]> {
  const r = await call('getUpdates', { limit: 50, allowed_updates: ['message'] });
  if (!r.json.ok) throw new Error(r.json.description ?? 'getUpdates failed');
  const seen = new Map<number, { id: number; title: string; type: string }>();
  for (const u of (r.json.result as { message?: { chat: { id: number; type: string; title?: string; first_name?: string; username?: string } } }[])) {
    const c = u.message?.chat; if (c) seen.set(c.id, { id: c.id, type: c.type, title: c.title ?? c.first_name ?? c.username ?? 'chat' });
  }
  return [...seen.values()];
}
