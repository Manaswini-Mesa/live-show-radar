import 'server-only';

export const USER_AGENT = 'Mozilla/5.0 (compatible; LiveShowRadar/0.1; +https://github.com/Manaswini-Mesa/live-show-radar)';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** fetch with a hard timeout and a descriptive User-Agent. */
export async function fetchText(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ status: number; text: string; etag: string | null; lastModified: string | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xml,application/json;q=0.9,*/*;q=0.8', ...(init.headers ?? {}) }, cache: 'no-store' });
    if (res.status === 304) return { status: 304, text: '', etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} from ${new URL(url).host}`);
    return { status: res.status, text: await res.text(), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`Timeout fetching ${new URL(url).host}`);
    throw e;
  } finally { clearTimeout(t); }
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = { status: 'fulfilled', value: await fn(items[k]) }; } catch (e) { out[k] = { status: 'rejected', reason: e }; } }
  }));
  return out;
}

export const sha = async (s: string) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))).toString('hex').slice(0, 32);
