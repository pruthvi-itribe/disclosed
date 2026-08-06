import {
  INDIAN_GROUPING,
  INTERNATIONAL_GROUPING,
  isWellGroupedInteger,
  isWellGroupedNumber,
  malformedGroupingIn,
} from './grouped-number';

describe('the two grouping conventions', () => {
  it.each([
    ['a nine-digit Indian amount', '18,53,66,820'],
    ['a lakh figure', '1,48,388'],
    ['the JKIL row total', '2,84,706'],
    ['the smallest grouped Indian number', '1,000'],
  ])('reads %s as Indian grouping', (_label, token) => {
    expect(INDIAN_GROUPING.test(token)).toBe(true);
  });

  it.each([
    ['a millions figure', '50,172,500'],
    ['a thousands figure', '54,618'],
    ['a leading group of one digit', '4,191'],
  ])('reads %s as international grouping', (_label, token) => {
    expect(INTERNATIONAL_GROUPING.test(token)).toBe(true);
  });

  it('keeps the two conventions apart', () => {
    // They disagree about every group except the last, and a number written in
    // one must not be readable as the other — otherwise a mis-grouped token
    // could satisfy the wrong pattern and pass.
    expect(INTERNATIONAL_GROUPING.test('18,53,66,820')).toBe(false);
    expect(INDIAN_GROUPING.test('50,172,500')).toBe(false);
  });
});

describe('isWellGroupedInteger', () => {
  it.each([
    ['an ungrouped integer', '500'],
    ['a five-digit integer written without separators', '54618'],
    ['a single digit', '7'],
    ['Indian grouping', '18,53,66,820'],
    ['international grouping', '50,172,500'],
  ])('accepts %s', (_label, part) => {
    expect(isWellGroupedInteger(part)).toBe(true);
  });

  it.each([
    ['the JKIL decimal-as-comma reading', '1,48,388,57'],
    ['its shorter sibling', '3,114,25'],
    ['a pdf-parse column weld', '88,06,567000000'],
    ['two JINDALSTEL columns welded together', '4,3034,26899'],
  ])('refuses %s', (_label, part) => {
    expect(isWellGroupedInteger(part)).toBe(false);
  });

  it('has nothing to say about a number that uses no separators', () => {
    // A part with no comma states its value unambiguously. This rule is about
    // separators being wrong, not about a value being surprising, so a
    // sixteen-digit run is accepted rather than flagged.
    expect(isWellGroupedInteger('1234567890123456')).toBe(true);
  });
});

describe('isWellGroupedNumber', () => {
  it.each([
    ['a plain Indian amount', '18,53,66,820'],
    ['a plain international amount', '50,172,500'],
    ['an ungrouped integer', '54618'],
    ['a grouped amount with paise', '1,48,388.57'],
    ['a figure with no integer grouping at all', '3114.25'],
  ])('accepts %s', (_label, token) => {
    expect(isWellGroupedNumber(token)).toBe(true);
  });

  it.each([
    // Presentation rather than value. A loss is not a malformed number, and a
    // rupee mark is not a digit.
    ['accounting parentheses around a loss', '(4,191.73)'],
    ['a leading minus', '-1,48,388.57'],
    ['a leading plus', '+50,172,500'],
    ['a rupee sign', '₹1,48,388.57'],
    ['a trailing percent', '12.5%'],
    ['surrounding whitespace', '  54,618.69  '],
    ['a bracketed rupee loss with spaces', '( ₹ 4,191.73 )'],
  ])('strips %s before judging the grouping', (_label, token) => {
    expect(isWellGroupedNumber(token)).toBe(true);
  });

  it.each([
    // Measured on JKIL's scanned consolidated statement against the rendered
    // page: every digit correct, only the separator wrong. Stripping commas and
    // reading what is left turns 148,388.57 into 14,838,857 — a hundredfold
    // error, in the silent direction, about a named listed company.
    ['the JKIL ground truth 1,48,388.57 as OCR emitted it', '1,48,388,57'],
    ['the JKIL ground truth 3,114.25 as OCR emitted it', '3,114,25'],
  ])('REFUSES %s', (_label, token) => {
    expect(isWellGroupedNumber(token)).toBe(false);
  });

  it.each([
    // pdf-parse produces the same shape by column flattening, at a measured
    // 8.40% of comma-bearing numbers — a higher rate than OCR.
    ['six welded zero columns', '88,06,567000000'],
    ['two welded JINDALSTEL columns', '4,3034,26899'],
    ['the rupee-parse example that reads as crore by accident', '30,00,000,00'],
  ])('REFUSES %s', (_label, token) => {
    expect(isWellGroupedNumber(token)).toBe(false);
  });

  it.each([
    // The same OCR that turns a point into a comma turns a comma into a point,
    // so both directions of the confusion have to be refused.
    ['two decimal points', '1.48.388'],
    ['three decimal points', '1.48.388.57'],
    ['a comma inside the fractional part', '3,114.2,5'],
    ['a fractional part that is itself grouped', '1,48,388.5,7'],
  ])('REFUSES %s', (_label, token) => {
    expect(isWellGroupedNumber(token)).toBe(false);
  });

  it.each([
    ['an empty token', ''],
    ['whitespace only', '   '],
    ['decoration with no digits', '(₹ %)'],
    ['a bare sign', '-'],
  ])('REFUSES %s rather than throwing', (_label, token) => {
    expect(isWellGroupedNumber(token)).toBe(false);
  });

  it('never throws on anything the extractor can propose', () => {
    // It takes the token verbatim, in the form the document prints, so it has
    // to survive prose, symbols and stray punctuation without an exception.
    const odd = ['Rs.', 'NIL', '—', '1,2,3,4', 'n/a', '..', ','];
    for (const token of odd) {
      expect(() => isWellGroupedNumber(token)).not.toThrow();
    }
  });
});

describe('malformedGroupingIn', () => {
  it('returns null when every cell can be read', () => {
    expect(
      malformedGroupingIn(['54,618.69', '52,369.69', '(4,191.73)', '500']),
    ).toBeNull();
  });

  it('returns null for nothing to check', () => {
    expect(malformedGroupingIn([])).toBeNull();
  });

  it('returns the FIRST offender so the refusal can name it', () => {
    // A refusal that says which cell it could not read is the difference
    // between an operator finding the OCR fault and re-reading the whole page.
    expect(malformedGroupingIn(['54,618.69', '1,48,388,57', '3,114,25'])).toBe(
      '1,48,388,57',
    );
  });

  it('finds an offender in the last position', () => {
    expect(malformedGroupingIn(['54,618.69', '52,369.69', '3,114,25'])).toBe(
      '3,114,25',
    );
  });
});
