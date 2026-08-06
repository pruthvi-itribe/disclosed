import {
  findEventPhraseEnds,
  findLabelWindows,
  HEADLINE_SCAN_CHARS,
  isPhraseAnchored,
  LABEL_WINDOW_CHARS,
  PHRASE_REACH_CHARS,
} from './amount-anchors';

describe('findLabelWindows — the SEBI Schedule III anchor', () => {
  // Every spelling below is how a real filer in the sample wrote the mandated
  // row label. The variation is the point: filers reproduce the wording, not
  // the punctuation, and PDF extraction then stretches or removes the spaces.
  it.each([
    ['Broad consideration or size of the order(s)/contract(s)', 'order win'],
    // The row is identified by "consideration or size of the order"; the
    // leading "Broad" is how SEBI words it but is not what makes it unique.
    ['Consideration or size of the order(s)/contract(s)', 'no "broad"'],
    [
      'Broad consideration or size of order(s)/contract(s) (in INR);',
      'no "the"',
    ],
    [
      'Broad commercial consideration or size of the order(s)/contract(s);',
      'commercial',
    ],
    [
      'Broad   consideration   or   size   of   the   order(s)/ contract(s);',
      'stretched',
    ],
    [
      'Broad  consideration  or  size  of  the \norder(s)/contract(s)',
      'line broken',
    ],
    ['Broadconsiderationorsizeoforder(s)/contract(s)', 'glued'],
    [
      'Cost of acquisition or the price at which the shares are acquired',
      'acquisition',
    ],
    [
      'Cost of acquisition and/or the price at which the shares are acquired;',
      'and/or',
    ],
  ])('recognises %s (%s)', (label) => {
    expect(findLabelWindows(`${label} Rs. 5 crore`).length).toBe(1);
  });

  // "Size of Agreement/ Memorandum of Agreement" is a different Schedule III
  // row on a different disclosure, and its figure is a vessel price in dollars.
  it.each([
    'c) Size of Agreement/ Memorandum of Agreement Purchase Price of the Vessel',
    'Percentage of shareholding / control acquired',
    'Time period by which the order(s)/contract(s) is to be executed',
    'Name of the entity awarding the order(s)/contract(s)',
  ])('does not recognise the unrelated row: %s', (text) => {
    expect(findLabelWindows(text)).toEqual([]);
  });

  // The label travels into the provenance, where it is the thing a human reads
  // to decide whether the figure was taken from the right row. It must be what
  // the filer wrote, not a canonical rewrite of it.
  it.each([
    [
      'g)  Broad   consideration  or  size  of  the\norder(s)/contract(s) Rs. 5 crore',
      'Broad consideration or size of the order',
    ],
    [
      '7. Broad commercial consideration or size of the order(s)/contract(s); Rs. 5 crore',
      'Broad commercial consideration or size of the order',
    ],
    [
      'h) Cost of acquisition and/or the price at which the shares are acquired Rs. 5 crore',
      'Cost of acquisition and/or the price at which the shares are acquired',
    ],
  ])('returns the label verbatim, with whitespace squashed', (text, label) => {
    expect(findLabelWindows(text)[0].label).toBe(label);
  });

  it('scopes the window to the text that follows the label', () => {
    const text = `Rs. 99 crore appears BEFORE. Broad consideration or size of the order(s) Rs. 5 crore`;
    const [window] = findLabelWindows(text);
    expect(window.text).toContain('Rs. 5 crore');
    expect(window.text).not.toContain('Rs. 99 crore');
    expect(text.slice(window.start, window.start + window.text.length)).toBe(
      window.text,
    );
  });

  it('stops before the next disclosure row can contribute a figure', () => {
    const window = findLabelWindows(
      `Broad consideration or size of the order(s)/contract(s) Rs. 5 crore${'.'.repeat(
        LABEL_WINDOW_CHARS,
      )} Rs. 99 crore`,
    )[0];
    expect(window.text).not.toContain('Rs. 99 crore');
  });

  // Both label families are searched separately, so without an explicit sort
  // an acquisition row would be reported before an order row that precedes it,
  // and the first candidate would be read from the wrong part of the document.
  it('returns every occurrence, in document order', () => {
    const windows = findLabelWindows(
      'Cost of acquisition or the price at which the shares are acquired FIRST. ' +
        'Broad consideration or size of the order(s) SECOND.',
    );
    expect(windows).toHaveLength(2);
    expect(windows[0].label).toBe(
      'Cost of acquisition or the price at which the shares are acquired',
    );
    expect(windows[1].label).toBe('Broad consideration or size of the order');
  });

  // A global regex shared across calls keeps `lastIndex` between them unless
  // the matcher is careful. If it leaked, the SECOND document scanned would
  // start halfway through and silently lose its label.
  it('does not carry regex state between documents', () => {
    const text =
      'Broad consideration or size of the order(s)/contract(s) Rs. 5 crore';
    expect(findLabelWindows(text)).toHaveLength(1);
    expect(findLabelWindows(text)).toHaveLength(1);
    expect(findLabelWindows(text)).toHaveLength(1);
  });
});

describe('event phrases — the covering-letter anchor', () => {
  it.each([
    'Sub: Press Release – New Orders worth Rs. 1,063 Crores',
    'has secured new orders of Rs. 1,063 crores',
    'BEL receives order worth Rs . 847 Crore',
    'Order value of ₹ 1.03 Cr.',
    'at a contract price of Rs. 82.17 Crores',
    'The aggregate value of purchase orders is Rs. 13.11 crore',
    'for a total value of the work amounting to Rs. 16,90,52,450 /-',
    'for an aggregate consideration of Rs. 34,99,92,034',
    'has issued Letter of Acceptance of Rs. 0.74 crores',
  ])('names the figure in: %s', (text) => {
    expect(findEventPhraseEnds(text).length).toBeGreaterThan(0);
  });

  // The sentence this list exists to exclude. It sits in the same KEC press
  // release as "new orders of Rs. 1,063 crores" and is six times larger.
  it.each([
    'our YTD order intake stands at over Rs. 6,300 crore',
    'Net Revenue decreased by 3% to Rs. 798 crores',
    'total revenues of Rs. 14,916 lakhs',
    'Turnover: Rs. 52.78 /- Crores (As on 31.03.2026)',
    'Authorized Share Capital of Rs. 4,00,00,000',
  ])('does not name the figure in: %s', (text) => {
    expect(findEventPhraseEnds(text)).toEqual([]);
  });

  // The offsets are ENDS, not starts. Measuring reach from where a phrase
  // begins shortens it by the phrase's own length, which quietly drops the
  // longer phrases first — the specific ones that carry the most meaning.
  it('reports where the phrase ends, not where it begins', () => {
    const text = 'New Orders worth Rs. 1,063 Crores';
    expect(findEventPhraseEnds(text)).toEqual([text.indexOf(' Rs.')]);
  });

  // These three are policy limits, measured against the sampled corpus rather
  // than chosen: the figure sits within ~150 characters of its label, the
  // covering letter runs to about page two, and a phrase names a figure that
  // follows it immediately. Widening any of them turns the extractor back into
  // "largest number nearby", which is what it exists not to be, and no
  // individual document in the corpus notices — so the bound is pinned here.
  it('pins the measured windows', () => {
    expect(LABEL_WINDOW_CHARS).toBe(260);
    expect(HEADLINE_SCAN_CHARS).toBe(4_000);
    expect(PHRASE_REACH_CHARS).toBe(60);
  });

  // A covering letter is the first page or two. Past that the document is an
  // annexure or a slide deck, where a matching phrase proves much less.
  it('ignores phrases beyond the covering letter', () => {
    expect(
      findEventPhraseEnds(`${'x'.repeat(4_000)} orders of Rs. 5 crore`),
    ).toEqual([]);
  });

  it('anchors a figure that follows the phrase within reach', () => {
    expect(isPhraseAnchored([10], 10 + 60)).toBe(true);
    expect(isPhraseAnchored([10], 10 + 61)).toBe(false);
  });

  it('does not anchor a figure that precedes the phrase', () => {
    expect(isPhraseAnchored([10], 9)).toBe(false);
  });

  it('is not anchored when no phrase was found at all', () => {
    expect(isPhraseAnchored([], 0)).toBe(false);
  });
});
