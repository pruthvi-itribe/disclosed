/**
 * Where the API lives, as a fetch wrapper.
 *
 * '' in the browser — same origin, the only value the web build ever uses,
 * which is what lets page.spec.ts keep proving the served document carries
 * no absolute URL. The mobile shell is the one caller that needs more: its
 * WebView serves the bundle from a local scheme with no server behind it,
 * so its build injects the production origin at BUILD time via
 * VITE_API_ORIGIN. The repo never carries that hostname (repo-hygiene's
 * rule); the shell's build command supplies it.
 *
 * Only paths that start with '/' are prefixed: everything this client asks
 * for is root-relative, and an absolute URL passed through here untouched
 * would be a bug worth seeing rather than silently rewriting.
 */
export const createOriginFetcher =
  (origin: string, fetcher: typeof fetch = fetch): typeof fetch =>
  (input, init) =>
    typeof input === 'string' && input.startsWith('/')
      ? fetcher(`${origin}${input}`, init)
      : fetcher(input, init);
