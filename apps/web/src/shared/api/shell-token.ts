/**
 * The shell's session credential.
 *
 * The web never touches this file: a browser session is an HttpOnly cookie
 * precisely so no script can read it. The shell cannot use that cookie —
 * SameSite=Lax rightly keeps it from crossing capacitor:// to the API
 * origin — so it holds the bearer token the server issues when asked
 * (auth.dto.ts `transport`), in its own WebView's storage: the app's
 * sandbox, which is the standard posture for a native client holding its
 * API credential. main.tsx gates every use on the shell boot mark, and a
 * dead token clears the next time the door is shown.
 */
const KEY = 'shell-session-token';

export const readShellToken = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const writeShellToken = (token: string): void => {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // No storage, no persistence: the session then lasts until the next
    // boot, which is a degraded shell rather than a broken one.
  }
};

export const clearShellToken = (): void => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored where nothing can be stored.
  }
};

/**
 * Wraps a fetcher so every request carries the shell's bearer. Read per
 * call rather than captured: the door writes the token and reboots, but a
 * later revocation must not ride a stale closure.
 */
export const withBearer =
  (fetcher: typeof fetch, token: () => string | null): typeof fetch =>
  (input, init) => {
    const current = token();
    if (current === null) return fetcher(input, init);
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${current}`);
    return fetcher(input, { ...init, headers });
  };
