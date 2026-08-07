import { isAllowedOrigin } from './origin-guard';

/**
 * The second CSRF layer, after `SameSite=Lax`.
 *
 * TWELVE LINES, and the only interesting decision in it is that an ABSENT
 * `Origin` is refused rather than allowed. Browsers send `Origin` on every
 * cross-origin request and on every same-origin POST, so an absent one on a
 * mutation is a non-browser client — and a non-browser client has no cookie
 * this design would honour anyway.
 */

const ALLOWED = 'http://127.0.0.1:7717';

describe('isAllowedOrigin', () => {
  it('accepts the configured origin exactly', () => {
    expect(isAllowedOrigin(ALLOWED, ALLOWED)).toBe(true);
  });

  it('refuses an absent Origin header', () => {
    expect(isAllowedOrigin(undefined, ALLOWED)).toBe(false);
  });

  it('refuses the literal "null" origin a sandboxed frame sends', () => {
    expect(isAllowedOrigin('null', ALLOWED)).toBe(false);
  });

  it.each([
    ['a different host', 'http://evil.example'],
    ['a different port', 'http://127.0.0.1:7718'],
    ['a different scheme', 'https://127.0.0.1:7717'],
    ['our origin as a prefix of theirs', 'http://127.0.0.1:7717.evil.example'],
    ['our origin as a suffix of theirs', 'http://evil.http://127.0.0.1:7717'],
    ['a path appended', 'http://127.0.0.1:7717/x'],
  ])('refuses %s', (_label, origin) => {
    expect(isAllowedOrigin(origin, ALLOWED)).toBe(false);
  });

  it('compares scheme and host case-insensitively, which is what a URL is', () => {
    expect(isAllowedOrigin('HTTP://127.0.0.1:7717', ALLOWED)).toBe(true);
  });

  it('tolerates a trailing slash on either side', () => {
    expect(isAllowedOrigin(`${ALLOWED}/`, ALLOWED)).toBe(true);
    expect(isAllowedOrigin(ALLOWED, `${ALLOWED}/`)).toBe(true);
  });

  it('refuses everything when the allowed origin is blank, rather than everything passing', () => {
    // A misconfiguration must fail CLOSED here. An empty allowlist that matched
    // an empty header would turn a missing setting into no CSRF defence at all.
    expect(isAllowedOrigin(ALLOWED, '')).toBe(false);
    expect(isAllowedOrigin('', '')).toBe(false);
  });

  it('refuses a header that arrived more than once', () => {
    // Express hands a repeated header through as an array.
    expect(
      isAllowedOrigin([ALLOWED, ALLOWED] as unknown as string, ALLOWED),
    ).toBe(false);
  });
});
