import {
  createPdfLogFilter,
  isPdfNoise,
  PDFJS_NOISE,
  SUMMARISE_EVERY,
} from './pdf-log-noise';

/**
 * A filter that swallows log lines is only as trustworthy as its allowlist.
 *
 * So the tests that matter here are the ones asserting what still gets
 * through. A suppression rule tested only on what it suppresses is how a real
 * warning goes missing six months later.
 */
describe('isPdfNoise', () => {
  it.each([
    'Warning: Ran out of space in font private use area',
    'Warning: Ran out of space in font private use area.',
    'Warning: TT: undefined function: 21',
    'Warning: TT: undefined function: 5',
  ])('recognises %s', (line) => {
    expect(isPdfNoise(line)).toBe(true);
  });

  // THE LINES THAT MUST SURVIVE. `Indexing all PDF objects` means a document's
  // cross reference table was damaged and pdf.js rebuilt it — that is a fact
  // about a filing, and losing it would be losing evidence.
  it.each([
    'Warning: Indexing all PDF objects',
    'Warning: Invalid absolute docBaseUrl',
    'Warning: Setting up fake worker.',
    'stored 58 filings',
    '',
  ])('leaves %s alone', (line) => {
    expect(isPdfNoise(line)).toBe(false);
  });

  // Anchored at both ends on purpose: a future message that embedded the same
  // words alongside a page number or a file name would be information.
  it('does not match the noise embedded in a longer sentence', () => {
    expect(
      isPdfNoise(
        'Warning: Ran out of space in font private use area on page 4',
      ),
    ).toBe(false);
  });

  it('holds exactly the two patterns measured in production', () => {
    expect(PDFJS_NOISE).toHaveLength(2);
  });
});

describe('createPdfLogFilter', () => {
  const collect = (): { lines: string[]; emit: (line: string) => void } => {
    const lines: string[] = [];
    return { lines, emit: (line: string): void => void lines.push(line) };
  };

  it('passes a line that is not noise straight through', () => {
    const { lines, emit } = collect();
    const filter = createPdfLogFilter(emit);

    filter('Warning: Indexing all PDF objects');
    filter('stored 58 filings');

    expect(lines).toEqual([
      'Warning: Indexing all PDF objects',
      'stored 58 filings',
    ]);
  });

  it('swallows noise', () => {
    const { lines, emit } = collect();
    const filter = createPdfLogFilter(emit);

    filter('Warning: Ran out of space in font private use area');

    expect(lines).toEqual([]);
  });

  // NOTHING IS DISCARDED WITHOUT SAYING SO. The count is what keeps "nothing
  // was noisy" and "forty thousand lines were" different facts.
  it('reports the running total every summariseEvery lines', () => {
    const { lines, emit } = collect();
    const filter = createPdfLogFilter(emit, 3);

    for (let i = 0; i < 7; i += 1) {
      filter('Warning: TT: undefined function: 21');
    }

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('3 so far');
    expect(lines[1]).toContain('6 so far');
  });

  it('counts only the noise, so real lines do not advance the summary', () => {
    const { lines, emit } = collect();
    const filter = createPdfLogFilter(emit, 2);

    filter('Warning: Ran out of space in font private use area');
    filter('a real line');
    filter('Warning: Ran out of space in font private use area');

    expect(lines[0]).toBe('a real line');
    expect(lines[1]).toContain('2 so far');
    expect(lines).toHaveLength(2);
  });

  it('keeps two filters independent of each other', () => {
    const a = collect();
    const b = collect();
    const filterA = createPdfLogFilter(a.emit, 2);
    const filterB = createPdfLogFilter(b.emit, 2);

    filterA('Warning: TT: undefined function: 1');
    filterB('Warning: TT: undefined function: 1');

    // One each: neither has reached two, so neither has summarised.
    expect(a.lines).toEqual([]);
    expect(b.lines).toEqual([]);
  });

  it('defaults to the measured summary interval', () => {
    expect(SUMMARISE_EVERY).toBe(1000);
  });
});
