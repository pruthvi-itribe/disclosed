import { safeHref } from './safe-href';

/**
 * Exchange URLs are untrusted. Only http(s) is ever rendered; anything else —
 * including the javascript: scheme — returns null and the caller draws
 * nothing rather than a plain-text fallback.
 */
describe('safeHref', () => {
  it('passes https and http', () => {
    expect(safeHref('https://example.invalid/doc.pdf')).toBe(
      'https://example.invalid/doc.pdf',
    );
    expect(safeHref('http://example.invalid/doc.pdf')).toBe(
      'http://example.invalid/doc.pdf',
    );
  });

  it('refuses the javascript scheme', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
  });

  it('refuses other schemes', () => {
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('ftp://example.invalid/x')).toBeNull();
  });

  it('refuses nothing and non-strings', () => {
    expect(safeHref('')).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});
