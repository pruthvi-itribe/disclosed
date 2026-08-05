import { decodeHtmlEntities } from './html-entities';

describe('decodeHtmlEntities', () => {
  it('decodes the numeric rupee sign NSE emits', () => {
    expect(decodeHtmlEntities('PAT of &#8377;76 Mn')).toBe('PAT of ₹76 Mn');
  });

  it('decodes hexadecimal references', () => {
    expect(decodeHtmlEntities('&#x20B9;561 cr')).toBe('₹561 cr');
  });

  it.each([
    ['Larsen &amp; Toubro', 'Larsen & Toubro'],
    ['&lt;redacted&gt;', '<redacted>'],
    ['a &quot;material&quot; event', 'a "material" event'],
    ['the Company&#39;s board', "the Company's board"],
  ])('decodes named and numeric references: %s', (input, expected) => {
    expect(decodeHtmlEntities(input)).toBe(expected);
  });

  it('decodes a non-breaking space to whitespace that trims away', () => {
    expect(decodeHtmlEntities('&nbsp;').trim()).toBe('');
  });

  it('leaves text with no entities untouched', () => {
    expect(decodeHtmlEntities('Order worth Rs. 78.24 Crore')).toBe(
      'Order worth Rs. 78.24 Crore',
    );
  });

  it('leaves an unknown named entity alone', () => {
    expect(decodeHtmlEntities('P&L; and &foo; remain')).toBe(
      'P&L; and &foo; remain',
    );
  });

  // An out-of-range code point makes String.fromCodePoint throw. NSE text is
  // untrusted, so a malformed reference must not take down the mapper.
  it.each(['&#999999999;', '&#xFFFFFFFF;', '&#55296;'])(
    'leaves an out-of-range code point alone: %s',
    (input) => {
      expect(decodeHtmlEntities(input)).toBe(input);
    },
  );

  // A single pass only: text that legitimately contains "&amp;#8377;" means the
  // literal string "&#8377;", not a rupee sign.
  it('does not decode recursively', () => {
    expect(decodeHtmlEntities('&amp;#8377;')).toBe('&#8377;');
  });

  it('decodes every occurrence', () => {
    expect(decodeHtmlEntities('&#8377;10 crore and &#8377;5 lakh')).toBe(
      '₹10 crore and ₹5 lakh',
    );
  });

  it('returns an empty string unchanged', () => {
    expect(decodeHtmlEntities('')).toBe('');
  });
});
