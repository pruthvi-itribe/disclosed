import { extractMaterialAmount } from './amount-extraction';
import corpus from './__fixtures__/amount-corpus.json';
import groundTruth from './__fixtures__/amount-ground-truth.json';

/**
 * The precision gate.
 *
 * `extractMaterialAmount` makes one promise — it never emits a wrong number —
 * and this suite is the only thing that can hold it to it. The corpus is 60
 * real NSE filings (the text NSE's own PDFs carry, verbatim); the ground truth
 * is what a human read in each of them, recorded one document at a time. Both
 * are committed so the measurement is reproducible and auditable rather than
 * asserted.
 *
 * A change that raises recall by loosening a rule will show up here as a WRONG
 * emission, which fails the build. A change that lowers recall shows up as a
 * count below the pinned floor, which also fails — deliberately, so that
 * silently refusing everything is not a way to pass this suite.
 *
 * The five verdicts a document can carry:
 *   amount      exactly one defensible material figure; emitting it is correct
 *   none        no material rupee figure exists; ANY emission is wrong
 *   ambiguous   figures exist but none is THE figure; ANY emission is wrong
 *   band        the filer published a range, not a value; ANY emission is wrong
 *   unreadable  no usable text layer; ANY emission is wrong
 */

interface Label {
  readonly seqId: number;
  readonly symbol: string;
  readonly verdict: string;
  readonly rupees: number | null;
  readonly evidence: string | null;
  readonly note: string;
}

const labels = new Map<number, Label>(
  (groundTruth as readonly Label[]).map((label) => [label.seqId, label]),
);

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

const ORDER_WIN_CATEGORIES: ReadonlySet<string> = new Set([
  'Bagging/Receiving of orders/contracts',
  'Awarding of order(s)/contract(s)',
]);

const run = (filing: (typeof corpus)[number]) =>
  extractMaterialAmount({
    documentText: filing.text,
    category: filing.category,
    summary: filing.summary,
  });

const emittedRupees = (filing: (typeof corpus)[number]): number | null => {
  const result = run(filing);
  return result.outcome === 'extracted' ? result.rupees : null;
};

describe('the labelled corpus itself', () => {
  it('labels every filing exactly once', () => {
    expect(labels.size).toBe(corpus.length);
    expect(corpus.every((filing) => labels.has(filing.seqId))).toBe(true);
  });

  // A label quoting text that is not in the document is a stale label, and a
  // stale label makes every number this suite reports meaningless.
  it.each(
    (groundTruth as readonly Label[])
      .filter((label) => label.evidence !== null)
      .map((label) => [label.symbol, label.seqId, label.evidence as string]),
  )(
    '%s (%s) quotes text that is in the document',
    (_symbol, seqId, evidence) => {
      const filing = corpus.find((row) => row.seqId === seqId);
      expect(squash(filing?.text ?? '')).toContain(squash(evidence));
    },
  );

  it('gives every stated amount a value and every other verdict none', () => {
    for (const label of groundTruth as readonly Label[]) {
      expect(label.verdict === 'amount').toBe(label.rupees !== null);
    }
  });
});

describe('precision: every emitted amount is exactly right', () => {
  it.each(corpus.map((filing) => [filing.symbol, filing.seqId] as const))(
    '%s (%s)',
    (_symbol, seqId) => {
      const filing = corpus.find((row) => row.seqId === seqId);
      if (filing === undefined) throw new Error('missing filing');
      const label = labels.get(seqId);
      if (label === undefined) throw new Error('missing label');

      const emitted = emittedRupees(filing);
      if (emitted === null) return; // a refusal is always an acceptable outcome

      // Emitting on a document with no single defensible figure is exactly the
      // failure this module exists to prevent, so it is checked before value.
      expect(label.verdict).toBe('amount');
      expect(emitted).toBe(label.rupees);
    },
  );

  it('emits nothing wrong across the whole corpus', () => {
    const wrong = corpus.filter((filing) => {
      const emitted = emittedRupees(filing);
      const label = labels.get(filing.seqId);
      return emitted !== null && emitted !== label?.rupees;
    });
    expect(wrong.map((filing) => filing.symbol)).toEqual([]);
  });
});

describe('recall: the extractor is not merely silent', () => {
  const stated = corpus.filter(
    (filing) => labels.get(filing.seqId)?.verdict === 'amount',
  );
  const extracted = corpus.filter((filing) => emittedRupees(filing) !== null);

  // 14 of the 18 filings that state a figure. The four it declines are all
  // deliberate: a Letter of Intent (conditional), a board outcome that also
  // uses conditional language, an acquisition whose row states two tranches,
  // and an acquisition whose document re-denominates figures in thousands.
  it('extracts from at least 14 of the 18 filings that state an amount', () => {
    expect(stated).toHaveLength(18);
    expect(extracted.length).toBeGreaterThanOrEqual(14);
  });

  // The category the pipeline exists for. Only the Letter of Intent is missed.
  it('extracts from at least 13 of the 14 order wins that state an amount', () => {
    const orderWins = stated.filter((filing) =>
      ORDER_WIN_CATEGORIES.has(filing.category),
    );
    expect(orderWins).toHaveLength(14);
    expect(
      orderWins.filter((filing) => emittedRupees(filing) !== null),
    ).toHaveLength(13);
  });

  it('reaches both anchors, not just the labelled one', () => {
    const anchors = new Set(
      corpus
        .map(run)
        .filter((result) => result.outcome === 'extracted')
        .map((result) =>
          result.outcome === 'extracted' ? result.provenance.anchor : '',
        ),
    );
    expect([...anchors].sort()).toEqual(['covering-letter', 'sebi-label']);
  });

  it('quotes evidence that is a verbatim substring of the source', () => {
    for (const filing of corpus) {
      const result = run(filing);
      if (result.outcome !== 'extracted') continue;
      const { evidence, offset } = result.provenance;
      expect(filing.text.slice(offset, offset + evidence.length)).toBe(
        evidence,
      );
    }
  });
});

describe('the four adversarial documents from the extraction spike', () => {
  const outcomeOf = (symbol: string, seqId: number): string => {
    const filing = corpus.find((row) => row.seqId === seqId);
    if (filing === undefined) throw new Error(`no filing for ${symbol}`);
    const result = run(filing);
    return result.outcome === 'extracted'
      ? `extracted:${result.rupees}`
      : `refused:${result.reason}`;
  };

  // A turnover table headed "Rs. in thousands". Reading its Rs 7,15,126 at
  // face value under-reports by 1,000x.
  it('NIPPOBATRY refuses rather than risk the thousands table', () => {
    expect(outcomeOf('NIPPOBATRY', 106715046)).toBe(
      'refused:unit-scaled-header',
    );
  });

  // Authorised share capital Rs 4,00,00,000 and paid-up Rs 1,59,65,000 sit in
  // the same annexure as the Rs 72.16 crore the company actually paid.
  it('GROBTEA reads the acquisition cost, not the share capital', () => {
    expect(outcomeOf('GROBTEA', 106713513)).toBe('extracted:721618000');
  });

  // The deck's largest figure is the size of the Indian warehousing market.
  it('PATINTLOG refuses the investor deck outright', () => {
    expect(outcomeOf('PATINTLOG', 106722434)).toBe('refused:no-candidate');
  });

  it.each([
    ['LTM', 106694940],
    ['NEWGEN', 106700026],
    ['PUNJABCHEM', 106718927],
    ['SUDEEPPHRM', 106725235],
    ['PATINTLOG', 106722434],
  ])('the %s investor presentation yields no figure', (symbol, seqId) => {
    expect(outcomeOf(symbol, seqId).startsWith('refused:')).toBe(true);
  });

  // Priced in dollars with the rupee equivalent alongside. 46.13 must never
  // reach an alert.
  it('HFCL reads the rupee equivalent of a dollar-priced order', () => {
    expect(outcomeOf('HFCL', 106716521)).toBe('extracted:4415300000');
  });

  // L&T publishes an order class instead of a value, on purpose.
  it.each([
    ['LT', 106714725],
    ['LT', 106716553],
  ])('%s (%s) refuses a published value band', (symbol, seqId) => {
    expect(outcomeOf(symbol, seqId)).toBe('refused:range-only');
  });
});

describe('refusal reasons are machine-readable and complete', () => {
  it('classifies every refusal into a known reason', () => {
    const counts = new Map<string, number>();
    for (const filing of corpus) {
      const result = run(filing);
      if (result.outcome !== 'refused') continue;
      counts.set(result.reason, (counts.get(result.reason) ?? 0) + 1);
    }
    // Every reason the module can return is exercised by a real document,
    // except verbatim-mismatch, which is an internal-consistency guard that no
    // input can provoke and is covered directly in amount-extraction.spec.ts.
    expect([...counts.keys()].sort()).toEqual([
      'ambiguity-keyword',
      'multiple-candidates',
      'no-candidate',
      'range-only',
      'unit-scaled-header',
    ]);
  });
});
