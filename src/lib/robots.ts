// Minimal robots.txt evaluation for the "*" user-agent group (longest-match wins; Allow beats
// Disallow on ties). Pure and unit-tested; used before any public page is read.

export function robotsAllows(robots: string, path: string): boolean {
  const rules: { allow: boolean; pattern: string }[] = [];
  let inStar = false;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      inStar = lastWasAgent ? inStar || val === '*' : val === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (inStar && (key === 'allow' || key === 'disallow') && val) rules.push({ allow: key === 'allow', pattern: val });
  }
  let best: { allow: boolean; pattern: string } | null = null;
  for (const r of rules) {
    const anchored = r.pattern.endsWith('$');
    const body = (anchored ? r.pattern.slice(0, -1) : r.pattern).split('*').map(escapeRe).join('.*');
    if (!new RegExp(`^${body}${anchored ? '$' : ''}`).test(path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

function escapeRe(s: string) {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}
