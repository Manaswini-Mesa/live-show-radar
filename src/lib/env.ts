import 'server-only';

// Server-side configuration. Never import this from client components.
const get = (k: string) => (process.env[k] ?? '').trim();

export const env = {
  appUrl: () => (get('NEXT_PUBLIC_APP_URL') || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')).replace(/\/$/, ''),
  databaseUrl: () => get('DATABASE_URL') || get('POSTGRES_URL'),
  geminiKey: () => get('GEMINI_API_KEY'),
  geminiModel: () => get('GEMINI_MODEL') || 'gemini-3.6-flash',
  telegramToken: () => get('TELEGRAM_BOT_TOKEN'),
  telegramChatId: () => get('TELEGRAM_CHAT_ID'),
  cronSecret: () => get('CRON_SECRET'),
  dashboardPassword: () => get('DASHBOARD_PASSWORD'),
  sessionSecret: () => get('SESSION_SECRET') || get('CRON_SECRET'),
  spotifyId: () => get('SPOTIFY_CLIENT_ID'),
  spotifySecret: () => get('SPOTIFY_CLIENT_SECRET'),
  spotifyRedirect: () => get('SPOTIFY_REDIRECT_URI') || `${env.appUrl()}/api/spotify/callback`,
  googleId: () => get('GOOGLE_CLIENT_ID'),
  googleSecret: () => get('GOOGLE_CLIENT_SECRET'),
  googleRedirect: () => get('GOOGLE_REDIRECT_URI') || `${env.appUrl()}/api/google/callback`,
};

const REQUIRED = ['DATABASE_URL|POSTGRES_URL', 'DASHBOARD_PASSWORD', 'SESSION_SECRET', 'CRON_SECRET'];
const OPTIONAL: Record<string, string[]> = {
  gemini: ['GEMINI_API_KEY'],
  telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
  spotify: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
};

/** Names (never values) of missing configuration. */
export function configReport() {
  const has = (spec: string) => spec.split('|').some(k => get(k));
  return {
    missingRequired: REQUIRED.filter(k => !has(k)),
    missingOptional: Object.fromEntries(Object.entries(OPTIONAL).map(([g, ks]) => [g, ks.filter(k => !get(k))])),
  };
}
