import { LANGUAGE_LABELS } from '@/locales/config';

export type RasaBot = {
  lang: string; // BCP 47 tag
  url: string;
  label: string;
};

function normalizeRasaBaseUrl(input: string): string {
  return input.trim().replace(/\/$/, "");
}

export function getRasaAuthToken(): string | null {
  const token = process.env.RASA_AUTH_TOKEN?.trim();
  return token ? token : null;
}

export function withRasaAuth(url: string): string {
  const normalized = normalizeRasaBaseUrl(url);
  const token = getRasaAuthToken();
  if (!token) {
    return normalized;
  }

  const target = new URL(normalized);
  target.searchParams.set("token", token);
  return target.toString();
}

function normalizeLang(input?: string | null): string | null {
  if (!input) return null;
  const token = input.split(',')[0]?.trim().split(';')[0]?.toLowerCase();
  return token || null;
}

export function getRasaBots(): RasaBot[] {
  // Single source of truth: RASA_URL_LIST
  const rawList = process.env.RASA_URL_LIST || '';

  let entries: Array<{ lang: string; url: string }> = [];

  if (rawList) {
    try {
      const parsed = JSON.parse(rawList);
      if (Array.isArray(parsed)) {
        entries = parsed.filter((e) => typeof e?.lang === 'string' && typeof e?.url === 'string');
      }
    } catch {
  // Fallback: parse list like "en=http://...;el=http://..." or with commas/newlines
  const parts = rawList.split(/[;,\n\r]+/).map((p) => p.trim()).filter(Boolean);
      entries = parts
        .map((p) => p.split('='))
        .filter((kv) => kv.length === 2)
        .map(([lang, url]) => ({ lang: lang.trim(), url: url.trim() }));
    }
  }

  // No legacy/default fallback: require RASA_URL_LIST to define bots

  const bots: RasaBot[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const norm = normalizeLang(e.lang);
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    // Label: use known UI label if base language is supported, otherwise show the tag
    const base = norm.split('-')[0] as keyof typeof LANGUAGE_LABELS;
    const label = LANGUAGE_LABELS[base] || norm.toUpperCase();
    bots.push({ lang: norm, url: e.url, label });
  }

  return bots;
}

export function getRasaUrlForRequest(headers: Headers, cookies: Map<string, string>): string | null {
  const bots = getRasaBots();
  if (bots.length === 0) return null;

  const cookieLang = cookies.get('lang') ?? null;
  const headerLang = headers.get('accept-language');
  const pref = normalizeLang(cookieLang) || normalizeLang(headerLang);

  let found: RasaBot | undefined;
  if (pref) {
    // Try full tag first
    found = bots.find((b) => b.lang.toLowerCase() === pref);
    if (!found) {
      // Try progressively less specific tags (e.g., zh-Hant-TW -> zh-Hant -> zh)
      const parts = pref.split('-');
      for (let i = parts.length - 1; i > 0 && !found; i--) {
        const sub = parts.slice(0, i).join('-');
        found = bots.find((b) => b.lang.toLowerCase() === sub);
      }
      if (!found) {
        // Finally try base language match
        const base = parts[0];
        found = bots.find((b) => b.lang.split('-')[0].toLowerCase() === base);
      }
    }
  }
  if (!found) found = bots[0];
  return found?.url ?? null;
}
