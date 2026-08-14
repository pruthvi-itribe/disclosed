import { JsonOnlyGuard } from './json-only.guard';

/**
 * The layer that makes skipping the Origin check for Bearer safe.
 *
 * An HTML form can emit only `application/x-www-form-urlencoded`,
 * `multipart/form-data` or `text/plain`. Requiring `application/json` means a
 * cross-origin form POST cannot reach a mutating handler at all, and every
 * remaining cross-origin attempt is preflighted — which the CORS allowlist can
 * refuse before the request is ever sent.
 */
const contextFor = (contentType: string | undefined) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers:
          contentType === undefined ? {} : { 'content-type': contentType },
      }),
    }),
  }) as never;

describe('JsonOnlyGuard', () => {
  const guard = new JsonOnlyGuard();

  it('accepts application/json', () => {
    expect(guard.canActivate(contextFor('application/json'))).toBe(true);
  });

  // A charset parameter is legal and common; fetch does not add one, but a
  // hand-written client will.
  it('accepts application/json with a charset parameter', () => {
    expect(
      guard.canActivate(contextFor('application/json; charset=utf-8')),
    ).toBe(true);
  });

  it.each([
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'text/plain',
    'application/json-patch+json',
  ])('refuses %s with 415', (type) => {
    expect(() => guard.canActivate(contextFor(type))).toThrow(
      expect.objectContaining({ status: 415 }),
    );
  });

  // A bodyless mutation is exactly where this could have been made optional,
  // and must not be: `POST /api/watchlist?symbol=X` takes its argument from the
  // query string, so a form whose action carries the query needs no body at all.
  it('refuses a missing content type with 415', () => {
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      expect.objectContaining({ status: 415 }),
    );
  });
});
