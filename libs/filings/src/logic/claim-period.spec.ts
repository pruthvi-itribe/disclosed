import {
  canonicalPeriod,
  MAX_PERIOD_EVIDENCE_CHARS,
  PERIOD_CONTEXT_CHARS,
  periodLabelsIn,
  periodsIn,
  supportPeriods,
} from './claim-period';

describe('canonicalPeriod', () => {
  it.each([
    ['a bare quarter', 'Q1', 'Q1'],
    ['a two-digit fiscal year', 'FY27', 'FY27'],
    ['a four-digit fiscal year', 'FY2027', 'FY27'],
    ['a spaced fiscal year', 'FY 2027', 'FY27'],
    ['a quarter and year, spaced', 'Q1 FY27', 'Q1FY27'],
    ['a quarter and year, joined', 'Q1FY27', 'Q1FY27'],
    ['a quarter and four-digit year', 'Q1 FY2027', 'Q1FY27'],
    ['a lower-case spelling', 'q1 fy2027', 'Q1FY27'],
    ['a calendar year', 'CY2026', 'CY26'],
    ['a half', 'H1 FY26', 'H1FY26'],
    ['nine months', '9M FY26', '9MFY26'],
    ['a newline between the parts', 'Q1\nFY2027', 'Q1FY27'],
  ])('folds %s', (_label, raw, expected) => {
    expect(canonicalPeriod(raw)).toBe(expected);
  });

  it('KEEPS both years of a hyphenated range', () => {
    // `FY2026-27` is the year ending March 2027 written as a span, and
    // collapsing it into `FY27` would let a claim about one restate the other.
    expect(canonicalPeriod('FY2026-27')).toBe('FY26-27');
    expect(canonicalPeriod('FY26-27')).toBe('FY26-27');
  });

  it('does not equate a range with either of its endpoints', () => {
    expect(canonicalPeriod('FY26-27')).not.toBe(canonicalPeriod('FY27'));
    expect(canonicalPeriod('FY26-27')).not.toBe(canonicalPeriod('FY26'));
  });
});

describe('periodLabelsIn', () => {
  it.each([
    ['a quarter in a heading', 'HIGHLIGHTS FOR Q1 FY27', ['Q1FY27']],
    ['a bare fiscal year', 'Our FY27 guidance 10-13%', ['FY27']],
    ['a four-digit year', 'Q1 FY2027 Strong Growth', ['Q1FY27']],
    ['two periods in one line', 'Q1 FY27 Q1 FY26 Change', ['Q1FY27', 'Q1FY26']],
    ['no period at all', 'Booked order of ₹150 Cr', []],
  ])('reads %s', (_label, text, expected) => {
    expect(periodLabelsIn(text).map((row) => row.canonical)).toEqual(expected);
  });

  it('reads a concatenated chart axis as separate labels', () => {
    // `pdf-parse` flattens a bar chart's category axis into one token. A
    // word-boundary test sees one word; this sees the four quarters it is.
    expect(
      periodLabelsIn('Q2FY25Q3FY25Q4FY25Q1FY27').map((row) => row.canonical),
    ).toEqual(['Q2FY25', 'Q3FY25', 'Q4FY25', 'Q1FY27']);
  });

  it('locates each label so its own bytes can be resliced', () => {
    const text = 'x HIGHLIGHTS FOR Q1 FY27 •Anup reached';
    const [label] = periodLabelsIn(text);
    expect(text.slice(label.start, label.end)).toBe('Q1 FY27');
    expect(label.raw).toBe('Q1 FY27');
  });

  it('does not read a bare H2, because that is hydrogen in a chemicals filing', () => {
    expect(periodLabelsIn('Petrochemicals 11% Hydrogen H2 7%')).toEqual([]);
  });

  it.each([
    ['a letter before a quarter', 'FAQ1 answered'],
    ['a letter before a fiscal year', 'XFY27'],
    ['a longer word ending in a quarter', 'SEQ1'],
  ])('refuses %s', (_label, text) => {
    expect(periodLabelsIn(text)).toEqual([]);
  });

  it('is re-entrant despite the module-level global regex', () => {
    // A `g`-flagged pattern carries `lastIndex` between calls. Without the
    // reset, the second call on the same string returns nothing and every
    // claim after the first in a batch loses its period.
    const text = 'Q1 FY27 revenue';
    expect(periodLabelsIn(text)).toHaveLength(1);
    expect(periodLabelsIn(text)).toHaveLength(1);
    expect(periodLabelsIn(text)).toHaveLength(1);
  });

  it('never throws for an empty string', () => {
    expect(periodLabelsIn('')).toEqual([]);
  });
});

describe('periodsIn', () => {
  it('collapses a repeated period to one', () => {
    expect([...periodsIn('Q1 FY27 revenue; Q1 FY2027 EBITDA')]).toEqual([
      'Q1FY27',
    ]);
  });
});

describe('supportPeriods', () => {
  const document =
    'INVESTOR PRESENTATION Q1 FY27 OPERATIONAL HIGHLIGHTS 01 7 OPERATIONAL ' +
    'HIGHLIGHTS HIGHLIGHTS FOR Q1 FY27 •Anup reached Revenue & EBITDA of ' +
    '₹125.2 Cr and ₹9.5 Cr respectively. •Performance during the quarter ' +
    'reflects a planned lower execution.';
  const span =
    '•Anup reached Revenue & EBITDA of ₹125.2 Cr and ₹9.5 Cr respectively.';
  const spanOffset = document.indexOf(span);

  it('supports a period stated by the heading above the sentence', () => {
    // The measured failure: a deck states its quarter in the slide header and
    // its numbers in the bullet, so the bullet alone never contains `Q1 FY27`.
    const result = supportPeriods({
      claimText: 'Q1 FY27 revenue of ₹125.2 Cr and EBITDA of ₹9.5 Cr',
      span,
      spanOffset,
      documentText: document,
    });
    expect(result.missing).toEqual([]);
  });

  it('stores the document bytes that supported it', () => {
    const result = supportPeriods({
      claimText: 'Q1 FY27 revenue of ₹125.2 Cr',
      span,
      spanOffset,
      documentText: document,
    });
    expect(result.evidence).toContain('Q1 FY27');
    expect(document.replace(/\s+/g, ' ')).toContain(result.evidence);
  });

  it('needs no evidence when the span states the period itself', () => {
    const result = supportPeriods({
      claimText: 'FY2026 value market share rose to 58%',
      span: 'with FY2026 value market share increasing to 58%',
      spanOffset: 0,
      documentText: 'with FY2026 value market share increasing to 58%',
    });
    expect(result).toEqual({ missing: [], evidence: null });
  });

  it('supports a claim that names no period at all', () => {
    expect(
      supportPeriods({
        claimText: 'Booked order of more than ₹150 Cr for Thermal Power plants',
        span: 'Booked order of more than ₹150 Cr for Thermal Power plants',
        spanOffset: 0,
        documentText:
          'Booked order of more than ₹150 Cr for Thermal Power plants',
      }),
    ).toEqual({ missing: [], evidence: null });
  });

  it('REFUSES a period the neighbourhood does not state', () => {
    // The anti-invention half. A model that moves a real figure into the wrong
    // quarter is the highest-consequence error this check exists to catch.
    const result = supportPeriods({
      claimText: 'Q4 FY26 revenue of ₹125.2 Cr',
      span,
      spanOffset,
      documentText: document,
    });
    expect(result.missing).toEqual(['Q4FY26']);
    expect(result.evidence).toBeNull();
  });

  it('REFUSES a period that is in the document but outside the neighbourhood', () => {
    // Document-scope would accept this, which is why it is not document-scope:
    // a deck's appendix names every quarter of the last three years.
    // The gap is sized from an EXPLICIT reach, never from
    // `PERIOD_CONTEXT_CHARS`. A fixture built as `PERIOD_CONTEXT_CHARS * 2`
    // passes for any value of the constant it is supposed to pin — including a
    // value that makes the neighbourhood the whole document, which is the one
    // thing this test exists to refuse.
    const far = `Q3 FY24 appendix.${' '.repeat(4_000)}${document}`;
    const result = supportPeriods({
      claimText: 'Q3 FY24 revenue of ₹125.2 Cr',
      span,
      spanOffset: far.indexOf(span),
      documentText: far,
      contextChars: 800,
    });
    expect(result.missing).toEqual(['Q3FY24']);
  });

  it('keeps the neighbourhood a neighbourhood', () => {
    // Pinned against a LITERAL as well as against the measurement: 800 is the
    // whole difference between "the region of the filing states this period"
    // and "the filing mentions it somewhere", and a bound asserted only as
    // "big enough" can be widened to the document and still pass.
    expect(PERIOD_CONTEXT_CHARS).toBe(800);
  });

  it('names every unsupported period, so a discard can be reviewed', () => {
    const result = supportPeriods({
      claimText: 'Q3 FY24 and Q2 FY23 revenue of ₹125.2 Cr',
      span,
      spanOffset,
      documentText: document,
    });
    expect(result.missing).toEqual(['Q3FY24', 'Q2FY23']);
  });

  it('honours a caller-supplied reach', () => {
    const result = supportPeriods({
      claimText: 'Q1 FY27 revenue of ₹125.2 Cr',
      span,
      spanOffset,
      documentText: document,
      contextChars: 1,
    });
    expect(result.missing).toEqual(['Q1FY27']);
  });

  it('bounds the stored evidence', () => {
    const heading = 'Q1 FY27 ';
    const long = `${heading.repeat(40)}${span}`;
    const result = supportPeriods({
      claimText: 'Q1 FY27 revenue of ₹125.2 Cr',
      span,
      spanOffset: long.indexOf(span),
      documentText: long,
    });
    expect(result.evidence).not.toBeNull();
    expect((result.evidence ?? '').length).toBeLessThanOrEqual(
      MAX_PERIOD_EVIDENCE_CHARS,
    );
  });

  it('reads a period from AFTER the sentence as well as before', () => {
    // A flattened two-column slide puts the header after the bullet as often
    // as before it.
    const after = `${span} INVESTOR PRESENTATION Q1 FY27`;
    expect(
      supportPeriods({
        claimText: 'Q1 FY27 revenue of ₹125.2 Cr',
        span,
        spanOffset: 0,
        documentText: after,
      }).missing,
    ).toEqual([]);
  });

  it('never throws for an empty document', () => {
    expect(
      supportPeriods({
        claimText: 'Q1 FY27 revenue of ₹125.2 Cr',
        span,
        spanOffset: 0,
        documentText: '',
      }).missing,
    ).toEqual(['Q1FY27']);
  });
});
