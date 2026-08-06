import { SENTENCE_REACH_CHARS, sentenceAt } from './sentence-scope';

/** The span's own bytes, trimmed, which is what a caller ever reads. */
const at = (text: string, offset: number, reach?: number): string =>
  sentenceAt(text, offset, reach).text.trim();

describe('sentenceAt — what counts as a sentence end', () => {
  it('returns the sentence a full stop delimits', () => {
    const text =
      'The Board met today. The Company received a work order worth 5 crore. ' +
      'The order will be executed in 12 months.';
    expect(at(text, text.indexOf('5 crore'))).toBe(
      'The Company received a work order worth 5 crore.',
    );
  });

  it.each(['?', '!'])('ends a sentence on %s', (mark) => {
    const text = `Is the order confirmed${mark} The figure is 5 crore.`;
    expect(at(text, text.indexOf('5 crore'))).toBe('The figure is 5 crore.');
  });

  it('quotes the source exactly at the offsets it reports', () => {
    const text = 'One thing happened. Then Rs. 5 crore was received. The end.';
    const span = sentenceAt(text, text.indexOf('5 crore'));
    expect(text.slice(span.start, span.end)).toBe(span.text);
  });

  // THE SPLIT THAT WOULD BREAK THE PROTECTION. `Rs.` is followed by a space in
  // almost every Indian filing, so a naive rule cuts the figure away from the
  // words that condition it and the extractor emits a conditional amount.
  it('does not split on the full stop in "Rs."', () => {
    const text =
      'The Company emerged as L1 bidder for a project of Rs. 500 crore.';
    expect(at(text, text.indexOf('500 crore'))).toContain('L1 bidder');
  });

  it.each([
    ['Ltd.', 'Awarded by Sterling Ltd. for Rs. 5 crore against a tender.'],
    ['Pvt.', 'Awarded by Sterling Pvt. Ltd. for Rs. 5 crore under an MoU.'],
    ['No.', 'Under contract No. 44 the value is Rs. 5 crore, subject to tax.'],
    ['M/s.', 'Awarded to M/s. Sterling for Rs. 5 crore, subject to approval.'],
    [
      'an initial',
      'Signed by A. K. Sharma for Rs. 5 crore, subject to review.',
    ],
  ])('does not split on the abbreviation %s', (_label, text) => {
    expect(at(text, text.indexOf('5 crore'))).toBe(text);
  });

  // A sentence starting in lower case is not a sentence starting. The token
  // before the stop is deliberately NOT an abbreviation, so this pins the
  // lower-case guard rather than passing on the abbreviation list.
  it('does not split when the next word is lower case', () => {
    const text =
      'The order of 5 crore was signed on 3 February. subject to approval.';
    expect(at(text, text.indexOf('5 crore'))).toContain('subject to');
  });

  // Requiring whitespace after the terminator is what keeps a decimal point out
  // of this. Without it `78.24` is two sentences and the clause that conditions
  // the figure sits in the first of them.
  it('does not split inside a decimal figure', () => {
    const text =
      'The Company received a Letter of Intent for Rs. 78.24 crore in total.';
    expect(at(text, text.indexOf('24 crore'))).toContain('Letter of Intent');
  });

  // The reported start is the sentence's own first character. Starting it at
  // the previous sentence's full stop would quote a refusal detail that opens
  // with somebody else's punctuation.
  it('starts the sentence after the previous one ends', () => {
    const text = 'The Board met today. The value is 5 crore.';
    const span = sentenceAt(text, text.indexOf('5 crore'));
    expect(span.start).toBe(text.indexOf('The value'));
  });

  // The FIRST boundary after the offset closes the sentence. Taking the last
  // one in reach would swallow every following sentence up to the bound.
  it('ends at the first boundary after the offset, not the last', () => {
    const text =
      'The value is 5 crore. A second sentence follows. A third one too. ';
    expect(at(text, text.indexOf('5 crore'))).toBe('The value is 5 crore.');
  });

  // A number followed by a stop IS a break: a numbered clause, or a date
  // ending one. Both are real boundaries in a filing's own layout.
  it('splits after a numbered clause marker', () => {
    const text = '1. The Board approved. 2. The order value is 5 crore.';
    expect(at(text, text.indexOf('5 crore'))).toBe(
      'The order value is 5 crore.',
    );
  });

  // `pdf-parse` puts every token of an OCR text layer on its own line, so a
  // full stop with nothing before it is scanning debris, not punctuation.
  it('does not split on a full stop with only whitespace before it', () => {
    const text = 'letter\nof\nintent\nRs\n.\n847\nCrore\nreceived';
    expect(at(text, text.indexOf('847'))).toContain('intent');
  });

  it('treats a closing bracket after the stop as part of the sentence ending', () => {
    const text = '(as amended.) The order value is 5 crore and it is final.';
    expect(at(text, text.indexOf('5 crore'))).toBe(
      'The order value is 5 crore and it is final.',
    );
  });

  it('ends a sentence at the end of the text', () => {
    const text = 'The order was received. The value is 5 crore. ';
    expect(at(text, text.indexOf('5 crore'))).toBe('The value is 5 crore.');
  });
});

describe('sentenceAt — newlines', () => {
  // A PDF text layer wraps mid-sentence wherever the source PDF did. Treating
  // one newline as a break would separate a conditioning clause from the figure
  // it conditions, which is the failure this module must never make.
  it('does not end a sentence at a single newline', () => {
    const text =
      'The Company has received a Letter of Intent\nfrom the customer for supply\nof goods worth Rs. 5 crore.';
    expect(at(text, text.indexOf('5 crore'))).toContain('Letter of Intent');
  });

  it.each([
    [
      'a blank line',
      'Prior paragraph about approvals.\n\nThe value is 5 crore.',
    ],
    [
      'a blank line with trailing spaces',
      'Prior paragraph about approvals.\n   \nThe value is 5 crore.',
    ],
  ])('ends a sentence at %s', (_label, text) => {
    expect(at(text, text.indexOf('5 crore'))).toBe('The value is 5 crore.');
  });

  it('starts a new sentence after a blank line', () => {
    const text = 'The value is 5 crore.\n\nsubject to shareholder approval';
    expect(at(text, text.indexOf('5 crore'))).not.toContain('subject to');
  });
});

describe('sentenceAt — the bound', () => {
  // Schedule III disclosures are tables: label, value, label, value, one per
  // line, no full stops and no blank lines anywhere. Unbounded, the "sentence"
  // containing a figure in one would be the whole filing, which is the
  // document-wide test this module exists to replace.
  const table = (rows: number): string =>
    Array.from(
      { length: rows },
      (_, index) => `row ${index} label of the disclosure`,
    ).join('\n');

  it('never returns the whole document for text with no punctuation', () => {
    const text = `${table(400)}\nvalue 5 crore\n${table(400)}`;
    const span = sentenceAt(text, text.indexOf('5 crore'));
    expect(text.length).toBeGreaterThan(10_000);
    // Reach either side of the anchor, plus the anchor character itself.
    expect(span.end - span.start).toBe(1_601);
  });

  it('does not reach a phrase further away than the bound', () => {
    const text = `subject to approval\n${'x '.repeat(900)}\nvalue 5 crore`;
    expect(at(text, text.indexOf('5 crore'))).not.toContain('subject to');
  });

  it('reaches a phrase inside the bound', () => {
    const text = `subject to approval\n${'x '.repeat(300)}\nvalue 5 crore`;
    expect(at(text, text.indexOf('5 crore'))).toContain('subject to');
  });

  it('honours a caller-supplied reach', () => {
    const text = `subject to approval\n${'x '.repeat(300)}\nvalue 5 crore`;
    expect(at(text, text.indexOf('5 crore'), 20)).not.toContain('subject to');
  });

  it('is symmetric, so a clause after the figure is reachable too', () => {
    const text = 'value 5 crore\nrow of a table\nsubject to approval';
    expect(at(text, text.indexOf('5 crore'))).toContain('subject to');
  });

  it('exposes the bound it applies', () => {
    expect(SENTENCE_REACH_CHARS).toBe(800);
  });
});

describe('sentenceAt — degenerate inputs', () => {
  it('returns an empty span for empty text', () => {
    expect(sentenceAt('', 0)).toEqual({ start: 0, end: 0, text: '' });
  });

  it.each([
    ['a negative offset', -50],
    ['an offset past the end', 10_000],
  ])('clamps %s into the text', (_label, offset) => {
    const text = 'The Board met. The value is 5 crore. The end.';
    const span = sentenceAt(text, offset);
    expect(span.start).toBeGreaterThanOrEqual(0);
    expect(span.end).toBeLessThanOrEqual(text.length);
    expect(span.text.length).toBeGreaterThan(0);
  });

  it('returns the only sentence when the text has no boundary at all', () => {
    const text = 'value 5 crore stated once';
    expect(sentenceAt(text, 6)).toEqual({
      start: 0,
      end: text.length,
      text,
    });
  });

  // The module-level patterns are `/g`, so a leaked `lastIndex` would make the
  // second call on the same text answer differently from the first.
  it('answers identically when called twice on the same text', () => {
    const text = 'One sentence here. The value is 5 crore. And a third one.';
    const offset = text.indexOf('5 crore');
    expect(sentenceAt(text, offset)).toEqual(sentenceAt(text, offset));
  });
});
