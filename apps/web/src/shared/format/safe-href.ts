/**
 * Only http(s) links are ever rendered. Anything else — including the
 * javascript: scheme — returns null and the caller draws nothing rather
 * than a plain-text fallback. Exchange URLs are untrusted input.
 */
export const safeHref = (raw: string | null | undefined): string | null => {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed = new URL(raw, window.location.href);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
};
