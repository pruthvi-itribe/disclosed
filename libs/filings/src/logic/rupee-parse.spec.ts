import {
  resolveUnitMultiplier,
  scanBareAmounts,
  scanRupeeAmounts,
} from './rupee-parse';
import { extractRupeeAmounts } from './ambiguity';

const values = (text: string): number[] =>
  scanRupeeAmounts(text).map((match) => match.rupees);

describe('scanRupeeAmounts — unit-less absolute figures', () => {
  // The single largest miss in real NSE text. Indian filings routinely write
  // the exact rupee figure in Indian digit grouping with no unit word at all,
  // and the parser used to require one.
  it.each([
    ['Rs. 18,53,66,820/-(Including Tax)', 185_366_820],
    ['INR 1,23,45,678', 12_345_678],
    ['₹5,00,000', 500_000],
    ['amounting to Rs. 3,56,91,142.50 /- (Rupees Three Crores…)', 35_691_142.5],
    ['Estimated Contract Value – INR 93,07,245/-', 9_307_245],
    ['LOA amounting to ₹ 5,01,72,500 - Five Crores One Lakh', 50_172_500],
    ['contracts of Rs. 50,172,500/-', 50_172_500],
  ])('reads %s', (text, expected) => {
    expect(values(text)).toEqual([expected]);
  });

  // A unit-less figure carries no scale of its own, so the floor is what keeps
  // face values, share prices and per-unit premiums out of the candidate set.
  it.each([
    'face value of Rs. 10/- each',
    'a premium of Rs. 35,270.84',
    'Commercial Papers INR 1,500',
    'issue price of Rs. 245/- per Equity Share',
  ])('refuses a unit-less figure below one lakh: %s', (text) => {
    expect(values(text)).toEqual([]);
  });

  // Grouping separators are the only thing distinguishing a written-out rupee
  // amount from a tender number, a scrip code or a year.
  it('refuses an ungrouped unit-less figure', () => {
    expect(values('tender ID Rs 20260805')).toEqual([]);
  });

  // `Rs. 30,00,000,00` is in a real filing. It is neither Indian nor
  // international grouping, so its value is not determinable — the digits
  // happen to read as ₹30 crore, but only by accident of where the commas fell.
  it.each(['Rs. 30,00,000,00', 'Rs 1,06,3 crore', 'INR 12,34,5,678'])(
    'refuses a malformed digit grouping: %s',
    (text) => {
      expect(values(text)).toEqual([]);
    },
  );

  it('does not swallow a trailing separator into the figure', () => {
    expect(values('Rs 5,00,000, plus applicable taxes')).toEqual([500_000]);
  });

  // A figure long enough to overflow a double has no representable value, and
  // Infinity formatted into an alert would read as a corrupt post rather than
  // an obviously broken one.
  it('refuses a figure too long to represent', () => {
    const overflowing = `1${',000'.repeat(120)}`;
    expect(values(`Rs ${overflowing}`)).toEqual([]);
  });
});

describe('scanRupeeAmounts — OCR-spaced punctuation', () => {
  // A bilingual PSU scan whose inherited OCR layer puts every token on its own
  // line: `Rs` `\n` `.` `\n` `847` `\n` `Crore`.
  it.each([
    ['Rs . 847 Crore', 8_470_000_000],
    ['Rs.847  Crore', 8_470_000_000],
    ['Rs\n.\n847\nCrore', 8_470_000_000],
    ['Rs.\n18,53,66,820/-', 185_366_820],
    ['₹ \n 1.03 Cr.', 10_300_000],
  ])('reads %s', (text, expected) => {
    expect(values(text)).toEqual([expected]);
  });

  // Tolerating whitespace must not become tolerating distance: a marker at the
  // end of one table cell binding to a number in an unrelated cell two rows
  // down is a wrong number, not a missing one.
  it('does not bind a marker across a blank line to a distant figure', () => {
    expect(values('Particulars Rs.\n\n\n1,00,00,000')).toEqual([]);
  });
});

describe('scanRupeeAmounts — provenance', () => {
  it('reports the verbatim substring and its offset', () => {
    const text = 'Order value of ₹ 1.03 Cr. approx.';
    const [match] = scanRupeeAmounts(text);
    expect(match.text).toBe('₹ 1.03 Cr');
    expect(text.slice(match.start, match.start + match.text.length)).toBe(
      match.text,
    );
    expect(match.rupees).toBe(10_300_000);
  });

  // The distinction that the scale-header guard rests on: a figure naming its
  // own unit cannot be misread by a table header declaring a different one.
  it.each([
    ['Rs. 78.24 Crore', true],
    ['Rs. 18,53,66,820/-', false],
  ])('marks whether %s carries its own unit', (text, carriesUnit) => {
    expect(scanRupeeAmounts(text)[0].carriesUnit).toBe(carriesUnit);
  });

  it('returns matches in document order', () => {
    expect(values('Rs 10 crore and later Rs 5 lakh')).toEqual([
      100_000_000, 500_000,
    ]);
  });
});

describe('scanRupeeAmounts — the currency marker itself', () => {
  // Without a leading word boundary the "rs" tail of an ordinary word acts as
  // a currency marker: "issued to shareholde|rs| 5 crore equity shares" parses
  // as Rs 5 crore. The guard lives here now that the scan does.
  it.each([
    'issued to shareholders 5 crore equity shares',
    'the transfers 25 lakh units',
  ])('does not treat the tail of a word as a marker: %s', (text) => {
    expect(values(text)).toEqual([]);
  });

  it('still reads a marker at the start of a word boundary', () => {
    expect(values('(Rs 5 crore)')).toEqual([50_000_000]);
  });
});

describe('scanRupeeAmounts — the words-in-brackets restatement', () => {
  // `(Rupees Three Crores Fifty-Six Lakhs…)` restates ₹3,56,91,142.50. The
  // words are never parsed: reading only the leading two would report ₹3 crore,
  // a 16% under-report presented as an exact number.
  it('does not read "Rupees" as a currency marker', () => {
    expect(
      values('(Rupees Three Crores Fifty-Six Lakhs Ninety-One Thousand)'),
    ).toEqual([]);
  });

  it('reads only the digits when both forms are present', () => {
    expect(
      values('Rs. 16,90,52,450 /- (Rupees Sixteen Crores Ninety Lakhs)'),
    ).toEqual([169_052_450]);
  });
});

describe('extractRupeeAmounts', () => {
  it('is the value-only view of the same scan', () => {
    const text = 'orders of Rs. 1,063 crores and Rs. 18,53,66,820/-';
    expect(extractRupeeAmounts(text)).toEqual(
      scanRupeeAmounts(text).map((match) => match.rupees),
    );
  });
});

describe('resolveUnitMultiplier', () => {
  it.each([
    ['crore', undefined, 10_000_000],
    ['Crores', undefined, 10_000_000],
    ['lakh', 'crore', 1e12],
    ['lac', 'crs', 1e12],
  ])('resolves %s %s', (first, second, expected) => {
    expect(resolveUnitMultiplier(first, second)).toBe(expected);
  });

  // The unit spellings live in the regex and the multipliers live in a table.
  // Adding a spelling to one without the other must refuse, not silently read
  // the figure unscaled — which would report Rs 500 for "Rs 500 trillion".
  it.each([
    ['trillion', undefined],
    ['crore', 'trillion'],
    ['crore', 'crore'],
  ])('refuses the unrecognised or nonsensical pair %s %s', (first, second) => {
    expect(resolveUnitMultiplier(first, second)).toBeNull();
  });
});

describe('scanBareAmounts', () => {
  // Two real filings write the consideration with no currency marker at all.
  it.each([
    ['9,23,44,635/- (Rupees Nine crore twenty-three lakh)', 92_344_635],
    ['Rupees  82,17,40,528/-  (Rupees Eighty-Two Crore)', 821_740_528],
  ])('reads a marker-less figure terminated by /-: %s', (text, expected) => {
    expect(scanBareAmounts(text).map((m) => m.rupees)).toEqual([expected]);
  });

  // The `/-` terminator is what separates a rupee amount from the counts and
  // quantities that share Indian grouping and sit in the same annexure row.
  it.each([
    '50,00,00,000 equity shares of face value of ₹ 1/- each',
    'Entire 15,96,500 equity shares',
    'sale of 24,00,000 sq. ft. of residential buildings',
  ])('refuses a grouped count with no /- terminator: %s', (text) => {
    expect(scanBareAmounts(text).map((m) => m.rupees)).toEqual([]);
  });

  // Reading USD 70,000,000 as ₹7 crore is the worst error this module can make.
  it('refuses a figure behind a foreign currency code', () => {
    expect(
      scanBareAmounts('Purchase Price will be: USD 70,000,000/- as per').map(
        (m) => m.rupees,
      ),
    ).toEqual([]);
  });

  it('refuses a bare figure below one lakh', () => {
    expect(scanBareAmounts('fee of 6,101/- only').map((m) => m.rupees)).toEqual(
      [],
    );
  });

  it('refuses a malformed grouping', () => {
    expect(scanBareAmounts('30,00,000,00/-').map((m) => m.rupees)).toEqual([]);
  });
});
