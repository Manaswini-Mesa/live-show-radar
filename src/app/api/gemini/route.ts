import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/auth';
import { audit } from '@/lib/db';
import { geminiPing } from '@/lib/gemini';

// POST → live Gemini check; result stored so the dashboard shows a verified status.
export async function POST(req: NextRequest) {
  const deny = requireSession(req); if (deny) return deny;
  const r = await geminiPing();
  await audit('gemini_check', r);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
