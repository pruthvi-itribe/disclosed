import {
  AmountExtraction,
  extractMaterialAmount,
  isTraceableEvidence,
  MAX_SENTENCE_QUOTE_CHARS,
} from './amount-extraction';

const ORDER_WIN = 'Bagging/Receiving of orders/contracts';

const extract = (
  documentText: string,
  category = ORDER_WIN,
  summary = 'Company has informed the Exchange about Bagging/Receiving of orders/contracts',
): AmountExtraction =>
  extractMaterialAmount({ documentText, category, summary });

const rupeesOf = (result: AmountExtraction): number | null =>
  result.outcome === 'extracted' ? result.rupees : null;

const reasonOf = (result: AmountExtraction): string | null =>
  result.outcome === 'refused' ? result.reason : null;

/** The mandated Schedule III row, wrapped in the rows that surround it. */
const scheduleIII = (value: string): string =>
  [
    'f) Time period by which the order(s)/contract(s) is to be executed',
    '12 Months',
    'g) Broad consideration or size of the order(s)/contract(s)',
    value,
    'h) Whether the promoter/promoter group/group companies have any interest',
    'No',
  ].join('\n');

describe('extractMaterialAmount — the SEBI label anchor', () => {
  // Each value is the labelled row of a real filing, in the shape its own PDF
  // text layer produced.
  it.each([
    ['Rs. 0.74 crores (including taxes)', 7_400_000],
    ['Rs. 13.11 crore, exclusive of applicable taxes', 131_100_000],
    ['Order value of ₹ 1.03 Cr. approx.', 10_300_000],
    [
      'TheSizeofOrderasperWorkOrderis Rs.\n18,53,66,820/-(IncludingTax)',
      185_366_820,
    ],
    [
      'Rs. 3,56,91,142.50 /- (Rupees Three Crores Fifty-Six Lakhs)',
      35_691_142.5,
    ],
    [
      'Estimated Contract Value – INR \n93,07,245/-(Rupees Ninety Lakh)',
      9_307_245,
    ],
    ['₹ 5,01,72,500 - Five Crores one Lacs Seventy Two Thousand', 50_172_500],
    ['9,23,44,635/- (Rupees Nine crore twenty-three lakh)', 92_344_635],
    [
      'Rupees  82,17,40,528/-  (Rupees Eighty-Two Crore Seventeen Lakh)',
      821_740_528,
    ],
  ])('reads the labelled row %s', (value, expected) => {
    expect(rupeesOf(extract(scheduleIII(value)))).toBe(expected);
  });

  it('prefers the labelled row over a rounded figure in the covering letter', () => {
    const result = extract(
      'received a Letter of Acceptance at a contract price of Rs. 82.17 Crores (Including GST).\n' +
        scheduleIII('Rupees  82,17,40,528/-  (Rupees Eighty-Two Crore)'),
    );
    // Rs 82.17 crore is the company's own rounding of Rs 82,17,40,528. Reading
    // the round number would be wrong by Rs 40,528 with no way to notice.
    expect(rupeesOf(result)).toBe(821_740_528);
  });

  it('reports the anchor and the label it read from', () => {
    const result = extract(scheduleIII('Rs. 0.74 crores'));
    if (result.outcome !== 'extracted') throw new Error('expected an amount');
    expect(result.provenance.anchor).toBe('sebi-label');
    expect(result.provenance.label).toBe(
      'Broad consideration or size of the order',
    );
  });

  // The dollar figure is the headline in the filer's own subject line and is
  // 90x smaller in numeric terms. Reading it as rupees is the single worst
  // error available to this module.
  it('reads the rupee equivalent and never the foreign figure', () => {
    expect(
      rupeesOf(
        extract(
          scheduleIII(
            '~USD 46.13 million  (equivalent  to  ~INR 441.53 crore)',
          ),
        ),
      ),
    ).toBe(4_415_300_000);
  });

  // The row states the price AND the share count, both in Indian grouping. The
  // marker-less fallback must stay switched off while a marked figure exists.
  it('ignores a share count sitting beside the price in the same row', () => {
    expect(
      rupeesOf(
        extract(
          [
            'Cost of acquisition and/or the price at which the shares are acquired',
            '₹ 50.50 Crores towards acquisition of 50,00,00,000 equity shares of face',
            'value of ₹ 1/- each fully paid up.',
          ].join('\n'),
          'Acquisition',
        ),
      ),
    ).toBe(505_000_000);
  });

  it('refuses when the labelled row states no figure at all', () => {
    const result = extract(
      scheduleIII(
        'To undertake all activities incidental to the Development and Operation of a 5 Star Hotel',
      ),
    );
    expect(reasonOf(result)).toBe('no-candidate');
  });
});

describe('extractMaterialAmount — the covering-letter anchor', () => {
  it('reads the subject line of a press-release-layout filing', () => {
    expect(
      rupeesOf(
        extract(
          'Scrip Code: 532714\n\nSub: Press Release – New Orders worth Rs. 1,063 Crores\n\n' +
            'Dear Sir/Madam,\n\nWe are pleased to enclose a copy of the press release with ' +
            'respect to new orders of Rs. 1,063 Crores secured by the Company.',
        ),
      ),
    ).toBe(10_630_000_000);
  });

  // The same press release states a year-to-date order book six times larger.
  // Publishing that as the order value would overstate the news by 500%.
  it('does not read a running total stated elsewhere in the release', () => {
    const result = extract(
      'Sub: Press Release – New Orders worth Rs. 1,063 Crores\n' +
        'KEC International wins New Orders of Rs. 1,063 crores\n' +
        'With these additions, our YTD order intake stands at over Rs. 6,300 crore.',
    );
    expect(rupeesOf(result)).toBe(10_630_000_000);
  });

  // A bilingual PSU scan: the inherited OCR layer puts every token on its own
  // line and inserts a space before the period.
  it('reads through OCR-mangled spacing', () => {
    const result = extract(
      'press\nrelease\ntitled\n"\nBEL\nreceives\norder\nworth\nRs\n.\n847\nCrore\n"\n.',
    );
    expect(rupeesOf(result)).toBe(8_470_000_000);
    if (result.outcome !== 'extracted') throw new Error('expected an amount');
    expect(result.provenance.anchor).toBe('covering-letter');
    expect(result.provenance.label).toBeNull();
  });

  it('refuses a figure that no phrase names as the value of the event', () => {
    expect(
      reasonOf(
        extract(
          'Net Revenue decreased by 3% to Rs. 798 crores as compared to Rs. 823 crores',
          'Press Release',
        ),
      ),
    ).toBe('no-candidate');
  });
});

describe('extractMaterialAmount — refusals', () => {
  it('refuses when a table header re-denominates the figures', () => {
    // Rs 7,15,126 under "(Rs. in thousands)" is Rs 71.5 crore, not Rs 7.15
    // lakh. Multiplying would be guessing which table the figure belongs to.
    const result = extract(
      'Turnover of the Target Entity for FY 2024-25 (Rs. in thousands): Rs.7,15,126\n' +
        'Cost of acquisition and/or the price at which the shares are acquired\n' +
        'an aggregate consideration of Rs. 34,99,92,034 towards subscription',
      'Acquisition',
    );
    expect(reasonOf(result)).toBe('unit-scaled-header');
    if (result.outcome !== 'refused') throw new Error('expected a refusal');
    expect(result.detail).toContain('Rs. in thousands');
  });

  // A figure that names its own unit cannot be re-scaled by a header, so the
  // guard must not fire on it — otherwise every results-bearing filing with a
  // labelled order row would be refused.
  it('leaves a figure that states its own unit alone', () => {
    expect(
      rupeesOf(
        extract(
          'Statement of Financial Results (Rs. In Lakhs)\n' +
            scheduleIII('Rs. 13.11 crore, exclusive of applicable taxes'),
        ),
      ),
    ).toBe(131_100_000);
  });

  it('refuses when the anchored positions disagree', () => {
    const result = extract(
      'Cost of acquisition or the price at which the shares are acquired\n' +
        'First tranche consideration was Rs. 348 Crores. Second tranche consideration is Rs. 206.80 Crores.',
      'Acquisition',
    );
    expect(reasonOf(result)).toBe('multiple-candidates');
    if (result.outcome !== 'refused') throw new Error('expected a refusal');
    expect(result.detail).toContain('3480000000');
    expect(result.detail).toContain('2068000000');
  });

  it('does not treat the same figure stated twice as a disagreement', () => {
    expect(
      rupeesOf(
        extract(
          scheduleIII('Rs. 0.74 crores') +
            '\n' +
            scheduleIII('Rs. 0.74 crores (including taxes)'),
        ),
      ),
    ).toBe(7_400_000);
  });

  it('refuses when the filer published a band instead of a figure', () => {
    const result = extract(
      'Re : L&T Energy CarbonLite Solutions Secures LNTP for Mega* Order\n' +
        '*Order Classification\n' +
        'Classification Significant Large Major Mega Ultra-Mega\n' +
        'Value in ₹ Cr 1,000 to 2,500 2,500 to 5,000 5,000 to 10,000',
    );
    expect(reasonOf(result)).toBe('range-only');
  });

  // A band table alongside a stated figure is still a band: nothing says which
  // of the two the alert should quote.
  it('refuses a figure that sits beside a published band', () => {
    expect(
      reasonOf(
        extract(
          scheduleIII('Rs. 6,000 crore') + '\nValue in ₹ Cr 5,000 to 10,000',
        ),
      ),
    ).toBe('range-only');
  });

  it.each([
    ['Received a Letter of Intent for supply worth Rs. 16,90,52,450/-', 'LoI'],
    ['emerged as L1 bidder for a project of Rs. 500 crore', 'L1 bidder'],
    [
      'extended subject to necessary compliances, order of Rs. 5 crore',
      'conditional',
    ],
    ['clarification on news item about orders of Rs. 700 crore', 'rumour'],
  ])('refuses conditional or rumour language (%s)', (text) => {
    expect(reasonOf(extract(scheduleIII('Rs. 5 crore') + '\n' + text))).toBe(
      'ambiguity-keyword',
    );
  });

  // The one-line NSE summary is boilerplate for most categories, but when it
  // does carry conditional language the document may not repeat it.
  it('refuses on conditional language in the summary alone', () => {
    expect(
      reasonOf(
        extractMaterialAmount({
          documentText: scheduleIII('Rs. 5 crore'),
          category: ORDER_WIN,
          summary: 'Company emerged as L1 bidder',
        }),
      ),
    ).toBe('ambiguity-keyword');
  });

  it.each([
    ['', 'nothing at all'],
    ['   \n\n  ', 'whitespace only'],
    ['y', 'a scanned page with no OCR layer'],
  ])('refuses a document carrying %s (%s)', (text) => {
    expect(reasonOf(extract(text))).toBe('no-candidate');
  });

  it('names the reason a labelled document still yielded nothing', () => {
    const result = extract(scheduleIII('To be mutually agreed'));
    if (result.outcome !== 'refused') throw new Error('expected a refusal');
    expect(result.detail).toBe('the disclosure row states no figure');
  });
});

/**
 * Conditional framing, scoped to the sentence that states the figure.
 *
 * Tested against the whole document this rule refused 566 live filings, because
 * `subject to` is boilerplate in nearly every Indian filing. The tests below pin
 * BOTH directions of the narrower rule: the boilerplate no longer refuses, and
 * a phrase that genuinely qualifies the candidate's own clause still does. The
 * second half is the one that must never regress — a figure emitted out of
 * "received a Letter of Intent worth…" is a wrong number with a company's name
 * attached, which is the error class this whole module exists to prevent.
 */
describe('extractMaterialAmount — conditional framing is sentence-scoped', () => {
  /** Paragraphs of neutral prose, long enough to be out of a sentence's reach. */
  const filler = (paragraphs: number): string =>
    Array.from(
      { length: paragraphs },
      () => 'This paragraph states nothing about the value of the order.',
    ).join('\n\n');

  it('extracts when the only conditional language is boilerplate elsewhere', () => {
    const text = [
      'Sub: Disclosure under Regulation 30 of SEBI LODR',
      '',
      scheduleIII('Rs. 13.11 crore, exclusive of applicable taxes'),
      '',
      filler(9),
      '',
      'The above is subject to the terms and conditions of the agreement.',
    ].join('\n');
    expect(rupeesOf(extract(text))).toBe(131_100_000);
  });

  it('refuses when the sentence stating the figure conditions it', () => {
    const result = extract(
      'Sub: Receipt of an order\n\n' +
        'The Company has received a Letter of Intent from the customer amounting ' +
        'to Rs. 16,90,52,450/- for the supply of goods.\n\n' +
        'Kindly take the same on record.',
    );
    expect(reasonOf(result)).toBe('ambiguity-keyword');
    if (result.outcome !== 'refused') throw new Error('expected a refusal');
    expect(result.detail).toContain('"Letter of Intent"');
    expect(result.detail).toContain('amounting to Rs. 16,90,52,450/-');
  });

  // THE DANGEROUS DIRECTION. A PDF text layer wraps a sentence wherever the
  // source PDF did, so a rule that ended a sentence at one newline would read
  // the figure's clause as starting after "Letter of Intent" and emit it.
  it('refuses when a line wrap separates the phrase from the figure', () => {
    const result = extract(
      'Sub: Receipt of an order\n\n' +
        'The Company has received a Letter of Intent\nfrom the customer\n' +
        'amounting to Rs. 5 crore.\n\nKindly take the same on record.',
    );
    expect(reasonOf(result)).toBe('ambiguity-keyword');
  });

  it.each([
    [
      'an L1 award',
      'having emerged as the L1 bidder, amounting to Rs. 5 crore',
    ],
    ['a letter of intent', 'under a Letter of Intent amounting to Rs. 5 crore'],
    ['a memorandum', 'under an MoU with the customer amounting to Rs. 5 crore'],
    [
      'a preferred bidder',
      'having been named preferred bidder, amounting to Rs. 5 crore',
    ],
    [
      'an in-principle approval',
      'with in-principle approval received, amounting to Rs. 5 crore',
    ],
    [
      'a conditional award',
      'awarded subject to statutory approvals, amounting to Rs. 5 crore',
    ],
  ])('still refuses a figure qualified by %s', (_label, sentence) => {
    expect(
      reasonOf(extract(`Sub: Update\n\nThe Company reports ${sentence}.\n`)),
    ).toBe('ambiguity-keyword');
  });

  it('drops the conditioned figure and reads the settled one', () => {
    const text = [
      'Cost of acquisition and/or the price at which the shares are acquired',
      'Rs. 500 crore, subject to receipt of regulatory approvals',
      '',
      filler(9),
      '',
      scheduleIII('Rs. 13.11 crore, exclusive of applicable taxes'),
    ].join('\n');
    // Both rows are anchored positions, so before the split this document
    // refused for conditional language and after it would refuse for a
    // disagreement. Neither is right: one of the two figures is settled.
    expect(rupeesOf(extract(text))).toBe(131_100_000);
  });

  // Rumour framing keeps document scope. Whether the filing is restating a
  // press claim is a fact about the filing, so a spotless disclosure row inside
  // one is still a journalist's number.
  it('refuses on rumour framing however clean the figure sentence is', () => {
    const result = extract(
      [
        'The Exchange has sought clarification on a recent news item.',
        '',
        filler(9),
        '',
        scheduleIII('Rs. 13.11 crore, exclusive of applicable taxes'),
      ].join('\n'),
    );
    expect(reasonOf(result)).toBe('ambiguity-keyword');
    if (result.outcome !== 'refused') throw new Error('expected a refusal');
    expect(result.detail).toContain('unverified news report');
  });

  it('refuses on conditional language in the summary and quotes it', () => {
    const result = extractMaterialAmount({
      documentText: scheduleIII('Rs. 5 crore'),
      category: ORDER_WIN,
      summary: 'Company emerged as L1 bidder',
    });
    expect(reasonOf(result)).toBe('ambiguity-keyword');
    if (result.outcome !== 'refused') throw new Error('expected a refusal');
    expect(result.detail).toContain('Company emerged as L1 bidder');
  });

  it('pins the length of the sentence a refusal may quote', () => {
    expect(MAX_SENTENCE_QUOTE_CHARS).toBe(160);
  });

  it('bounds and de-fangs the sentence it quotes', () => {
    const padding = 'for the supply of assorted goods and related services '
      .repeat(5)
      .trim();
    const result = extract(
      `Sub: Update\n\nThe Company has received a Letter of Intent ${padding}\n` +
        `amounting to Rs. 5 crore.\n\nEnd of letter.`,
    );
    if (result.outcome !== 'refused') throw new Error('expected a refusal');
    const quoted = /: "([\s\S]+)"$/.exec(result.detail);
    if (quoted === null) throw new Error('expected a quoted sentence');
    expect(quoted[1]).toHaveLength(160);
    // A newline in a stored detail forges a second log line.
    expect(result.detail).not.toContain('\n');
  });
});

describe('extractMaterialAmount — provenance is verifiable', () => {
  // When the same figure is stated more than once, the earliest statement is
  // the one quoted. Any other choice makes the offset unpredictable, and an
  // offset a reviewer cannot anticipate is provenance nobody will check.
  it('quotes the first occurrence when a figure is repeated', () => {
    const text =
      scheduleIII('Rs. 0.74 crores') + '\n' + scheduleIII('Rs. 0.74 crores');
    const result = extract(text);
    if (result.outcome !== 'extracted') throw new Error('expected an amount');
    expect(result.provenance.offset).toBe(text.indexOf('Rs. 0.74 crores'));
  });

  // The marker-less fallback exists for rows that state nothing marked. While
  // a marked figure is present it must stay switched off, or a row that quotes
  // both a price and a quantity reads as a disagreement and is refused.
  it('prefers the figure that says it is money over a bare quantity', () => {
    expect(
      rupeesOf(
        extract(
          scheduleIII('₹ 50.50 Crores against 50,00,00,000/- equity shares'),
        ),
      ),
    ).toBe(505_000_000);
  });

  it('points at an exact substring of the source', () => {
    const text = scheduleIII('Rs. 3,56,91,142.50 /- (Rupees Three Crores)');
    const result = extract(text);
    if (result.outcome !== 'extracted') throw new Error('expected an amount');
    const { evidence, offset } = result.provenance;
    expect(text.slice(offset, offset + evidence.length)).toBe(evidence);
    expect(evidence).toBe('Rs. 3,56,91,142.50');
  });
});

describe('isTraceableEvidence', () => {
  const text = 'row: Rs. 78.24 Crore stated here';

  it('accepts evidence that is present and re-reads to the same value', () => {
    expect(
      isTraceableEvidence(
        text,
        { evidence: 'Rs. 78.24 Crore', offset: 5 },
        782_400_000,
      ),
    ).toBe(true);
  });

  // An offset arithmetic slip while shifting a window-relative index to an
  // absolute one would ship provenance pointing at the wrong part of the
  // document — which survives human review, unlike a missing amount.
  it('rejects evidence quoted at the wrong offset', () => {
    expect(
      isTraceableEvidence(
        text,
        { evidence: 'Rs. 78.24 Crore', offset: 6 },
        782_400_000,
      ),
    ).toBe(false);
  });

  it('rejects a value the evidence does not actually state', () => {
    expect(
      isTraceableEvidence(
        text,
        { evidence: 'Rs. 78.24 Crore', offset: 5 },
        782_400_001,
      ),
    ).toBe(false);
  });

  it('accepts marker-less evidence read back through the bare scanner', () => {
    expect(
      isTraceableEvidence(
        'x 9,23,44,635/- y',
        { evidence: '9,23,44,635/-', offset: 2 },
        92_344_635,
      ),
    ).toBe(true);
  });
});
