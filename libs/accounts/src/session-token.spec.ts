import { createHash } from 'crypto';
import {
  clearedSessionCookie,
  hashSessionToken,
  mintSessionToken,
  needsRenewal,
  readSessionCookie,
  RENEW_AFTER_MS,
  SESSION_COOKIE,
  SESSION_TOKEN_BYTES,
  sessionCookie,
  sessionExpiry,
} from './session-token';

/**
 * The session handle: how it is minted, why the raw value is never stored, and
 * exactly what the cookie says.
 *
 * The cookie attributes are asserted as STRINGS rather than through a library,
 * because they are the whole control. `HttpOnly` missing is a session readable
 * by any script that reaches the page; `SameSite` missing is CSRF on every
 * mutation.
 */

describe('mintSessionToken', () => {
  it('returns a token and the hash that will be stored in its place', () => {
    const minted = mintSessionToken();

    expect(typeof minted.token).toBe('string');
    expect(minted.tokenHash).toBe(hashSessionToken(minted.token));
  });

  it('carries 32 bytes of entropy, base64url encoded', () => {
    // 256 bits. The token is a bearer credential with no other factor, so its
    // only defence against guessing is that the space cannot be walked.
    expect(SESSION_TOKEN_BYTES).toBe(32);
    expect(Buffer.from(mintSessionToken().token, 'base64url')).toHaveLength(32);
  });

  it('is URL and cookie safe, so nothing downstream has to escape it', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(mintSessionToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(mintSessionToken().token);
    expect(seen.size).toBe(500);
  });
});

describe('hashSessionToken', () => {
  it('is SHA-256 hex, so a database dump is not a session-hijack kit', () => {
    const token = 'a-token';
    expect(hashSessionToken(token)).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
  });

  it('is stable, because it is the unique index the lookup uses', () => {
    expect(hashSessionToken('x')).toBe(hashSessionToken('x'));
  });

  it('is not reversible to the token by shape alone', () => {
    const minted = mintSessionToken();
    expect(minted.tokenHash).not.toContain(minted.token);
    expect(minted.tokenHash).toHaveLength(64);
  });
});

describe('sessionExpiry', () => {
  const now = new Date('2026-08-08T04:00:00.000Z');

  it('is the TTL ahead of now', () => {
    expect(sessionExpiry(now, 30).toISOString()).toBe(
      '2026-09-07T04:00:00.000Z',
    );
  });

  it('does not mutate the clock it was handed', () => {
    sessionExpiry(now, 30);
    expect(now.toISOString()).toBe('2026-08-08T04:00:00.000Z');
  });
});

describe('needsRenewal', () => {
  const seen = new Date('2026-08-08T04:00:00.000Z');

  it('is false inside the renewal interval, so an active reader costs no write', () => {
    // The Watching tab polls every 4 seconds. A sliding expiry written on every
    // request would be one write per 4 s per open tab, against a database the
    // poller is writing filings to.
    expect(needsRenewal(seen, new Date(seen.getTime() + 1_000))).toBe(false);
  });

  it('is true once the interval has passed', () => {
    expect(needsRenewal(seen, new Date(seen.getTime() + RENEW_AFTER_MS))).toBe(
      true,
    );
  });

  it('is an hour, stated', () => {
    expect(RENEW_AFTER_MS).toBe(3_600_000);
  });

  it('is true when nothing was ever recorded, rather than never renewing', () => {
    expect(needsRenewal(null, seen)).toBe(true);
  });

  it('is true for a clock that went backwards, rather than sticking forever', () => {
    expect(needsRenewal(seen, new Date(seen.getTime() - 60_000))).toBe(true);
  });
});

describe('sessionCookie', () => {
  const cookie = sessionCookie('the-token', { secure: true, ttlDays: 30 });

  it('names the cookie and carries the token', () => {
    expect(cookie.startsWith(`${SESSION_COOKIE}=the-token;`)).toBe(true);
  });

  it.each([
    ['HttpOnly', 'HttpOnly'],
    ['Path=/', 'Path=/'],
    ['SameSite=Lax', 'SameSite=Lax'],
    ['Max-Age', 'Max-Age=2592000'],
  ])('sets %s', (_label, attribute) => {
    expect(cookie).toContain(attribute);
  });

  it('is Lax rather than Strict', () => {
    // Strict drops the cookie on ANY inbound top-level navigation, which breaks
    // a link from an email into a signed-in page — and the email lane is the
    // next thing to land. Lax still withholds the cookie on cross-site POST,
    // which is the CSRF case that matters; the Origin guard is the second layer.
    expect(cookie).not.toContain('SameSite=Strict');
  });

  it('is Secure over https', () => {
    expect(cookie).toContain('Secure');
  });

  it('omits Secure over plain http, or the cookie is never set at all', () => {
    // Day one is loopback with no TLS. A Secure cookie on http is dropped by
    // the browser silently, which presents as a login that appears to succeed
    // and then forgets you.
    const plain = sessionCookie('the-token', { secure: false, ttlDays: 30 });
    expect(plain).not.toContain('Secure');
    expect(plain).toContain('HttpOnly');
  });

  it('refuses a token that would let a value break the header', () => {
    // The token is ours and is base64url, so this can only fire on a bug — but
    // a cookie value carrying a newline is a response-splitting shape and must
    // never be assembled quietly.
    expect(() =>
      sessionCookie('bad\r\nSet-Cookie: x=y', { secure: true, ttlDays: 30 }),
    ).toThrow();
  });
});

describe('clearedSessionCookie', () => {
  it('expires the cookie immediately and empties it', () => {
    const cleared = clearedSessionCookie({ secure: true });

    expect(cleared.startsWith(`${SESSION_COOKIE}=;`)).toBe(true);
    expect(cleared).toContain('Max-Age=0');
  });

  it('repeats every attribute of the cookie it replaces', () => {
    // A browser matches a replacement cookie on name, path and domain. Clearing
    // one written with `Path=/` from a response that omits the path leaves the
    // original in place, and the user stays signed in after clicking sign out.
    const cleared = clearedSessionCookie({ secure: true });
    expect(cleared).toContain('Path=/');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('SameSite=Lax');
  });
});

describe('readSessionCookie', () => {
  it('finds the session in a header with several cookies', () => {
    expect(readSessionCookie(`a=1; ${SESSION_COOKIE}=tok; b=2`)).toBe('tok');
  });

  it('returns null when the header is absent', () => {
    expect(readSessionCookie(undefined)).toBeNull();
  });

  it('returns null when no session cookie is present', () => {
    expect(readSessionCookie('a=1; b=2')).toBeNull();
  });

  it('does not match a cookie whose name merely ends with ours', () => {
    expect(readSessionCookie(`not_${SESSION_COOKIE}=tok`)).toBeNull();
  });

  it('returns null for an empty value rather than an empty token', () => {
    // The cleared cookie is exactly this shape, and an empty string reaching
    // the store would be one `findOne({tokenHash: sha256('')})` per request.
    expect(readSessionCookie(`${SESSION_COOKIE}=`)).toBeNull();
  });

  it('ignores a value that is not token-shaped', () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=has spaces`)).toBeNull();
  });
});
