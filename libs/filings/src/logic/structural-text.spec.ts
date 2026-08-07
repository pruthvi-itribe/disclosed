import { forStructuralTest } from './structural-text';
import { RESULTS_STATEMENT_PATTERN } from './results-eligibility';

/**
 * GKENERGY's row label as `pdf-parse` actually emitted it.
 *
 * The parser rendered this document one word per line — 1,495 `" \n"` pairs in
 * 22,708 characters — on a filing carrying two complete Regulation 33
 * statements.
 */
const AS_PARSED = 'Total \nincome 5,086.36 \n4,210.86 \n2,969.53 \n';

describe('forStructuralTest', () => {
  it('makes a row label the pattern can see', () => {
    // The whole point, stated as the measured failure. Without this GKENERGY is
    // refused with "the document states none of a results statement's row
    // labels" about a document whose first table says `Total income`.
    expect(RESULTS_STATEMENT_PATTERN.test(AS_PARSED)).toBe(false);
    expect(RESULTS_STATEMENT_PATTERN.test(forStructuralTest(AS_PARSED))).toBe(
      true,
    );
  });

  it.each([
    ['a line break inside a label', 'Revenue from\noperations'],
    ['one word per line', 'Profit\nafter\ntax'],
    ['a tab', 'Total\tincome'],
    ['runs of spaces', 'Total     income'],
    ['a carriage return', 'Total\r\nincome'],
    ['a non-breaking space', 'Total income'],
  ])('joins %s', (_label, text) => {
    expect(RESULTS_STATEMENT_PATTERN.test(forStructuralTest(text))).toBe(true);
  });

  it('does not invent a label that is not there', () => {
    // The direction that would be dangerous. Collapsing whitespace must not
    // manufacture a row label out of two unrelated words, which is the reason
    // this is a whitespace collapse and not a punctuation or character fold.
    expect(
      RESULTS_STATEMENT_PATTERN.test(forStructuralTest('Total\nassets')),
    ).toBe(false);
    expect(
      RESULTS_STATEMENT_PATTERN.test(
        forStructuralTest('a notice of a meeting'),
      ),
    ).toBe(false);
  });

  it('leaves a well-formed document unchanged in substance', () => {
    const clean = 'Revenue from operations 5,051.92';
    expect(forStructuralTest(clean)).toBe(clean);
  });

  it('changes no character that is not whitespace', () => {
    // THE SAFETY PROPERTY. Everything offset-based in this pipeline — the
    // verbatim span match, the basis heading reach, the column header search —
    // reads the STORED document, and this projection exists only to answer
    // boolean "is it present" questions. If it altered a non-whitespace
    // character it would no longer be describing the same document.
    const messy = 'Total \n income  5,086.36\t(unaudited)';
    const strip = (text: string): string => text.replace(/\s/g, '');
    expect(strip(forStructuralTest(messy))).toBe(strip(messy));
  });

  it('is idempotent', () => {
    const once = forStructuralTest(AS_PARSED);
    expect(forStructuralTest(once)).toBe(once);
  });

  it('handles an empty document without throwing', () => {
    expect(forStructuralTest('')).toBe('');
  });
});

describe('the two gates that must agree', () => {
  it('rescues GKENERGY through eligibility AND routing together', async () => {
    // THE CIRCULARITY THIS FIX BREAKS. Before it, a document whose cheap text
    // was mangled was refused for having no row labels AND denied the parser
    // that would have unmangled it, because both gates read the same raw text
    // through the same pattern. `hasUsableTextLayer` could not rescue it
    // either: that test counts non-space characters, and GKENERGY's 22,708
    // characters of one-word-per-line garbage passes it comfortably.
    const { resultsEligibility } = await import('./results-eligibility');
    const { looksLikeResultsStatement } = await import('../pdf/parse-route');

    // The shape pdf-parse produced: row labels split, headings intact.
    const mangled = [
      'STATEMENT OF UNAUDITED STANDALONE FINANCIAL RESULTS',
      'Sr\nNo\nParticulars',
      'Revenue\nfrom\noperations 5,051.92 4,185.72 2,952.68',
      'Total \nincome 5,086.36 4,210.86 2,969.53',
      'Consolidated\nresults follow.',
    ].join('\n');

    expect(looksLikeResultsStatement(mangled)).toBe(true);
    expect(
      resultsEligibility(
        {
          symbol: 'GKENERGY',
          category: 'Outcome of Board Meeting',
          summary: 'financial results',
        } as never,
        mangled.padEnd(2500, ' '),
      ).eligible,
    ).toBe(true);
  });
});
