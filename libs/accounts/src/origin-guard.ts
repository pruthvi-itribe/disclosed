/**
 * The second CSRF layer, after `SameSite=Lax`.
 *
 * Two layers and no token plumbing. `SameSite=Lax` already withholds the
 * session cookie on a cross-site POST; this refuses the request outright when
 * the browser says it came from somewhere else. Double-submit tokens would be a
 * third layer and a lot of plumbing, and with no cross-site surface and no CORS
 * enabled they are not earning it.
 *
 * AN ABSENT `Origin` IS REFUSED, and that is the only interesting decision
 * here. Browsers send `Origin` on every cross-origin request and on every
 * same-origin POST, so an absent one on a mutation is not a browser this
 * application serves. Allowing it would make the guard trivially bypassable by
 * anything that can omit a header, which is everything except a browser.
 *
 * THAT PARAGRAPH USED TO END "which holds no cookie this design would honour
 * anyway", and told the reader to revisit it if a mobile client ever appeared.
 * One has. `Authorization: Bearer` is now a second credential transport, so a
 * non-browser client does hold a credential this design honours and the
 * sentence is retired rather than left standing.
 *
 * WHAT DID NOT CHANGE IS THIS FUNCTION. An absent `Origin` is still refused on
 * every request that reaches it. What changed is upstream, in
 * `session.guard.ts`: `OriginGuard` now asks this only of cookie-carried
 * mutations, because CSRF defends ambient authority and a Bearer token is not
 * ambient — a browser never attaches that header by itself.
 */

/**
 * Trailing slashes are equal and case is not significant in a scheme or a host,
 * so both sides are folded before the comparison. Nothing else is normalised:
 * an origin has no path, and a value carrying one is not an origin.
 */
const fold = (origin: string): string =>
  origin.trim().replace(/\/+$/, '').toLowerCase();

/**
 * Whether this request's `Origin` is the one origin this application serves.
 *
 * An EXACT match on the folded value, never a prefix or a suffix test:
 * `http://127.0.0.1:7717.evil.example` starts with our origin and
 * `http://evil.http://127.0.0.1:7717` ends with it.
 */
export const isAllowedOrigin = (
  origin: string | undefined,
  allowed: string,
): boolean => {
  // A blank allowlist is a misconfiguration, and it must fail CLOSED. An empty
  // allowed origin matching an empty header would turn a missing setting into
  // no CSRF defence at all.
  if (typeof allowed !== 'string' || allowed.trim() === '') return false;

  // Express hands a repeated header through as an array, and `String(array)`
  // would join it into something that could match.
  if (typeof origin !== 'string') return false;

  // What a sandboxed iframe and some privacy tools send. It is not this origin.
  if (origin === 'null') return false;

  return fold(origin) !== '' && fold(origin) === fold(allowed);
};
