import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import {
  PENDING_ENRICHMENT,
  FilingSchema,
  type Filing,
  type FilingDocument,
  type ClaimDiscard,
  type FilingEnrichment,
  type VerifiedClaim,
} from '@app/filings';
import { FilingQueryService } from './filing-query.service';

/**
 * The enrichment half of the dashboard, against a real mongod.
 *
 * A mocked model would only assert that the filter is the one we wrote. The
 * thing that has to be true here is subtler and Mongo-specific: a filing the
 * worker has never reached carries NO `enrichment` field at all — the schema
 * declares no default, so the poller's hot path writes nothing extra — and the
 * `pending` filter has to match that absence. Only a real database can prove it.
 */

const AT = new Date('2026-08-05T04:58:18.000Z');

const makeFiling = (
  seqId: number,
  overrides: Partial<Filing> = {},
): Filing => ({
  seqId,
  symbol: 'RAILTEL',
  isin: 'INE000000001',
  companyName: 'RailTel Corporation of India Limited',
  industry: 'Telecom',
  category: 'Bagging/Receiving of orders/contracts',
  summary: `Filing ${seqId}`,
  attachmentUrl: 'https://nsearchives.nseindia.com/corporate/a.pdf',
  announcedAt: AT,
  disseminatedAt: AT,
  ingestedAt: new Date(AT.getTime() + 6_000),
  ...overrides,
});

const enrichment = (
  overrides: Partial<FilingEnrichment>,
): FilingEnrichment => ({
  ...PENDING_ENRICHMENT,
  state: 'enriched',
  attempts: 1,
  attemptedAt: AT,
  ...overrides,
});

let mongo: MongoMemoryServer;
let model: Model<FilingDocument>;
let service: FilingQueryService;

const clock = (): Date => new Date('2026-08-06T12:00:00.000Z');

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  model = mongoose.model<FilingDocument>('EnrichView', FilingSchema);
  await model.syncIndexes();
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await model.deleteMany({});
  service = new FilingQueryService(model, clock);
});

const seed = async (
  rows: ReadonlyArray<readonly [number, FilingEnrichment | undefined]>,
): Promise<void> => {
  await model.insertMany(
    rows.map(([seqId, block]) =>
      block === undefined
        ? makeFiling(seqId)
        : { ...makeFiling(seqId), enrichment: block },
    ),
  );
};

const page = async (query: Record<string, unknown> = {}) =>
  service.getRecent({ limit: 50, offset: 0, ...query });

describe('the enrichment view on a filing row', () => {
  it('reports a filing the worker has never reached as pending', async () => {
    await seed([[1, undefined]]);
    const { items } = await page();

    expect(items[0].enrichment).toEqual({
      state: 'pending',
      attempts: 0,
      // Empty arrays rather than undefined, so a filing stored before the claim
      // lane existed renders as "no claims" rather than as a missing field.
      claims: [],
      claimDiscards: [],
      claimLine: null,
      claimsProposed: null,
      claimRefusalReason: null,
      claimRefusalDetail: null,
      // Model prose, kept in its own field and never merged into `claims`.
      documentSummary: null,
      documentSummaryRefusalReason: null,
      // Read back as nulls and an empty array on every filing stored before the
      // results lane existed, which is every filing in the live collection.
      results: null,
      resultsLine: null,
      resultsDiscards: [],
      resultsProposed: null,
      resultsRefusalReason: null,
      resultsRefusalDetail: null,
      attemptedAtIst: null,
      unparseableReason: null,
      lastError: null,
      documentSource: null,
      // Null on every filing read before the hybrid parser existed, which reads
      // as `pdf-parse` because that is what read them. A page that had to test
      // for absence would render "read by the cheap parser" and "never read" the
      // same.
      parseRoute: null,
      parseFallbackReason: null,
      coverageSkip: null,
      amountRupees: null,
      amountDisplay: null,
      amountEvidence: null,
      amountAnchor: null,
      amountRefusalReason: null,
      amountRefusalDetail: null,
      counterparty: null,
      counterpartyRefusalReason: null,
      headline: null,
      contextLine: null,
    });
  });

  it('formats the amount server-side, the way the headline states it', async () => {
    // The browser must not do this. A second implementation of Indian
    // crore/lakh grouping would be a second thing to keep in step with the
    // message that actually goes out.
    await seed([[1, enrichment({ amountRupees: 185_366_820 })]]);
    const { items } = await page();

    expect(items[0].enrichment.amountRupees).toBe(185_366_820);
    expect(items[0].enrichment.amountDisplay).toBe('₹18.54 cr');
  });

  it('carries the refusal reason, its detail and the state', async () => {
    await seed([
      [
        1,
        enrichment({
          amountRefusalReason: 'unit-scaled-header',
          amountRefusalDetail: 'the document re-denominates figures',
        }),
      ],
    ]);
    const { items } = await page();

    expect(items[0].enrichment).toMatchObject({
      state: 'enriched',
      amountDisplay: null,
      amountRefusalReason: 'unit-scaled-header',
      amountRefusalDetail: 'the document re-denominates figures',
    });
  });

  it('carries the verbatim evidence and the anchor it was read from', async () => {
    await seed([
      [
        1,
        enrichment({
          amountRupees: 185_366_820,
          amountEvidence: 'Rs.\n18,53,66,820',
          amountAnchor: 'sebi-label',
          amountLabel: 'Broad consideration or size of the order',
        }),
      ],
    ]);
    const { items } = await page();

    expect(items[0].enrichment.amountEvidence).toBe('Rs.\n18,53,66,820');
    expect(items[0].enrichment.amountAnchor).toBe('sebi-label');
  });

  it('renders the attempt time in IST', async () => {
    await seed([[1, enrichment({ attemptedAt: AT })]]);
    const { items } = await page();
    expect(items[0].enrichment.attemptedAtIst).toBe('2026-08-05 10:28:18');
  });
});

describe('the enrichment filters', () => {
  const seedMixed = () =>
    seed([
      [1, undefined],
      [2, enrichment({ state: 'pending', attempts: 2 })],
      [3, enrichment({ amountRupees: 100 })],
      [4, enrichment({ amountRefusalReason: 'no-candidate' })],
      [5, enrichment({ amountRefusalReason: 'ambiguity-keyword' })],
      [6, enrichment({ state: 'unparseable', unparseableReason: 'not-a-pdf' })],
      [7, enrichment({ state: 'failed', lastError: 'timeout' })],
    ]);

  it('matches a MISSING enrichment block under the pending filter', async () => {
    // The whole reason the schema declares no default. Filtering on the string
    // alone would show an empty queue while a thousand filings waited in it.
    await seedMixed();
    const { items, meta } = await page({ state: 'pending' });

    expect(meta.total).toBe(2);
    expect(items.map((item) => item.seqId).sort()).toEqual([1, 2]);
  });

  it.each([
    ['enriched', [3, 4, 5]],
    ['unparseable', [6]],
    ['failed', [7]],
  ])('filters on state %s', async (state, expected) => {
    await seedMixed();
    const { items } = await page({ state });
    expect(items.map((item) => item.seqId).sort()).toEqual(expected);
  });

  it('filters to the filings that carry a figure', async () => {
    await seedMixed();
    const { items } = await page({ amount: 'extracted' });
    expect(items.map((item) => item.seqId)).toEqual([3]);
  });

  it('filters to the filings whose figure was refused', async () => {
    await seedMixed();
    const { meta } = await page({ amount: 'refused' });
    // Everything without an amount, including the ones never attempted.
    expect(meta.total).toBe(6);
  });

  it.each([
    ['no-candidate', [4]],
    ['ambiguity-keyword', [5]],
    ['not-a-pdf', [6]],
  ])('filters on the refusal reason %s', async (refusal, expected) => {
    // The reason a refusal is worth showing at all: it has to be clickable.
    await seedMixed();
    const { items } = await page({ refusal });
    expect(items.map((item) => item.seqId)).toEqual(expected);
  });

  it('combines an enrichment filter with a symbol filter', async () => {
    await model.insertMany([
      {
        ...makeFiling(1, { symbol: 'RAILTEL' }),
        enrichment: enrichment({ amountRefusalReason: 'no-candidate' }),
      },
      {
        ...makeFiling(2, { symbol: 'KEC' }),
        enrichment: enrichment({ amountRefusalReason: 'no-candidate' }),
      },
    ]);

    const { items } = await page({ symbol: 'kec', refusal: 'no-candidate' });
    expect(items.map((item) => item.seqId)).toEqual([2]);
  });

  it('returns everything when no enrichment filter is given', async () => {
    await seedMixed();
    expect((await page()).meta.total).toBe(7);
  });
});

describe('getEnrichmentSummary', () => {
  it('is all zeros and no rows on an empty collection', async () => {
    const summary = await service.getEnrichmentSummary();
    expect(summary).toMatchObject({
      total: 0,
      byState: [],
      withAmount: 0,
      byRefusal: [],
      byUnparseable: [],
      withCounterparty: 0,
      withEnrichedHeadline: 0,
    });
    expect(summary.generatedAtIst).toBe('2026-08-06 17:30:00');
  });

  it('counts states, with a missing block counted as pending', async () => {
    await seed([
      [1, undefined],
      [2, undefined],
      [3, enrichment({ amountRupees: 1 })],
      [4, enrichment({ state: 'unparseable', unparseableReason: 'not-a-pdf' })],
    ]);

    const summary = await service.getEnrichmentSummary();
    expect(summary.total).toBe(4);
    expect(summary.byState).toEqual([
      { key: 'pending', count: 2 },
      { key: 'enriched', count: 1 },
      { key: 'unparseable', count: 1 },
    ]);
  });

  it('breaks refusals down by machine-readable reason, largest first', async () => {
    await seed([
      [1, enrichment({ amountRefusalReason: 'no-candidate' })],
      [2, enrichment({ amountRefusalReason: 'no-candidate' })],
      [3, enrichment({ amountRefusalReason: 'no-candidate' })],
      [4, enrichment({ amountRefusalReason: 'ambiguity-keyword' })],
      [5, enrichment({ amountRefusalReason: 'range-only' })],
      [6, enrichment({ amountRupees: 500 })],
    ]);

    const summary = await service.getEnrichmentSummary();
    expect(summary.byRefusal).toEqual([
      { key: 'no-candidate', count: 3 },
      { key: 'ambiguity-keyword', count: 1 },
      { key: 'range-only', count: 1 },
    ]);
    expect(summary.withAmount).toBe(1);
  });

  it('breaks unreadable documents down separately from refused amounts', async () => {
    // Two different failures with two different remedies: one is the extractor
    // declining to guess, the other is a document nobody can read.
    await seed([
      [1, enrichment({ state: 'unparseable', unparseableReason: 'not-a-pdf' })],
      [
        2,
        enrichment({
          state: 'unparseable',
          unparseableReason: 'truncated-at-origin',
        }),
      ],
      [3, enrichment({ amountRefusalReason: 'no-candidate' })],
    ]);

    const summary = await service.getEnrichmentSummary();
    expect(summary.byUnparseable).toEqual([
      { key: 'not-a-pdf', count: 1 },
      { key: 'truncated-at-origin', count: 1 },
    ]);
    expect(summary.byRefusal).toEqual([{ key: 'no-candidate', count: 1 }]);
  });

  it('counts verified counterparties and enriched headlines', async () => {
    await seed([
      [
        1,
        enrichment({
          amountRupees: 185_366_820,
          counterparty: 'South Western Railway',
          headline: 'RAILTEL BAGS ORDER ₹18.54 cr from South Western Railway',
        }),
      ],
      [
        2,
        enrichment({
          amountRupees: 500_000_000,
          headline: 'RAILTEL BAGS ORDER ₹50 cr',
        }),
      ],
      [
        3,
        enrichment({
          amountRefusalReason: 'no-candidate',
          headline: 'RAILTEL — BAGGING/RECEIVING OF ORDERS/CONTRACTS',
        }),
      ],
    ]);

    const summary = await service.getEnrichmentSummary();
    expect(summary.withCounterparty).toBe(1);
    // The degraded headline is not counted: it states no figure.
    expect(summary.withEnrichedHeadline).toBe(2);
  });
});

/**
 * The claim lane on the dashboard.
 *
 * Against a real mongod for the same reason the rest of this suite is: the
 * claim fields are sub-document arrays, every filing stored before the lane
 * existed carries none of them, and "no claims" and "not looked at" must not
 * render the same.
 */
describe('the claim lane', () => {
  const CLAIM: VerifiedClaim = {
    text: 'targets ₹10,000 Cr adjusted EBITDA by FY31',
    span: 'setting out its goal to build a ₹10,000 Cr.\nAdjusted EBITDA business by FY31',
    kind: 'target',
    periodSpan: null,
  };

  const DISCARD: ClaimDiscard = {
    reason: 'span-not-found',
    claim: 'plans to double capacity',
    detail: 'the quoted source is not in the document',
  };

  it('shows the line, each claim and the sentence behind it', async () => {
    await seed([
      [
        1,
        enrichment({
          claims: [CLAIM],
          claimLine: 'SWIGGY: TARGETS ₹10,000 CR ADJUSTED EBITDA BY FY31',
          claimsProposed: 1,
        }),
      ],
    ]);

    const { items } = await page();
    const view = items[0].enrichment;

    expect(view.claimLine).toBe(
      'SWIGGY: TARGETS ₹10,000 CR ADJUSTED EBITDA BY FY31',
    );
    // Every stored field survives, plus `echo`, which the page computes across
    // the response: a claim whose fact an earlier item already stated for this
    // company is marked rather than removed. A single filing can echo nothing.
    expect(view.claims).toEqual([{ ...CLAIM, echo: false }]);
    // The document's own line break survives the round trip, because the span
    // is what a reviewer checks against the source.
    expect(view.claims[0].span).toContain('\n');
    expect(view.claimsProposed).toBe(1);
  });

  it('shows every discard with the rule that refused it', async () => {
    await seed([
      [
        1,
        enrichment({
          claimDiscards: [DISCARD],
          claimsProposed: 1,
          claimRefusalReason: 'all-discarded',
        }),
      ],
    ]);

    const { items } = await page();
    const view = items[0].enrichment;

    expect(view.claimDiscards).toEqual([DISCARD]);
    expect(view.claimRefusalReason).toBe('all-discarded');
  });

  it('reports empty lists, not absent fields, for a filing stored before the lane', async () => {
    await seed([[1, enrichment({})]]);

    const { items } = await page();
    expect(items[0].enrichment.claims).toEqual([]);
    expect(items[0].enrichment.claimDiscards).toEqual([]);
    expect(items[0].enrichment.claimLine).toBeNull();
  });

  it.each([
    ['emitted', 1],
    ['none', 2],
  ] as const)('filters on claim=%s', async (claim, expected) => {
    await seed([
      [1, enrichment({ claimLine: 'SYM: A CLAIM' })],
      [2, enrichment({ claimRefusalReason: 'no-claims' })],
      [3, undefined],
    ]);

    const { meta } = await page({ claim });
    expect(meta.total).toBe(expected);
  });

  it('lets a discard reason filter the table', async () => {
    // The refusal filter reaches the claim lane as well as the amount lane, so
    // clicking `span-not-found` in the panel shows the documents it happened on.
    await seed([
      [1, enrichment({ claimDiscards: [DISCARD] })],
      [2, enrichment({ claimRefusalReason: 'not-eligible' })],
    ]);

    expect((await page({ refusal: 'span-not-found' })).meta.total).toBe(1);
    expect((await page({ refusal: 'not-eligible' })).meta.total).toBe(1);
  });

  it('counts claims and groups every discard in the summary', async () => {
    await seed([
      [1, enrichment({ claimLine: 'SYM: A CLAIM', claims: [CLAIM] })],
      [2, enrichment({ claimDiscards: [DISCARD, DISCARD] })],
      [3, enrichment({ claimRefusalReason: 'not-eligible' })],
    ]);

    const summary = await service.getEnrichmentSummary();

    expect(summary.withClaims).toBe(1);
    // Per DISCARD, not per filing: one document proposing two inventions is two
    // data points about the extractor rather than one.
    expect(summary.byClaimDiscard).toEqual([
      { key: 'span-not-found', count: 2 },
    ]);
    expect(summary.byClaimRefusal).toEqual([{ key: 'not-eligible', count: 1 }]);
  });
});

describe('the results view on a filing row', () => {
  it('renders the figures and the two quotes they rest on', async () => {
    await seed([
      [
        1,
        enrichment({
          resultsLine:
            'APOLLOTYRE Q1 FY27 (CONSOLIDATED): REVENUE ₹73,977.90 MN VS ₹65,607.59 MN (YOY)',
          results: {
            basis: 'consolidated',
            basisSpan: 'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
            columnsSpan: '30.06.202631.03.202630.06.202531.03.2026',
            period: 'Q1 FY27',
            priorPeriod: 'Q1 FY26',
            figures: [
              {
                metric: 'revenue',
                current: '73,977.90',
                prior: '65,607.59',
                unit: 'MN',
                span: 'Revenue from operations 73,977.90 73,356.74 65,607.59',
              },
            ],
          },
          resultsProposed: 1,
          resultsDiscards: [
            {
              reason: 'label-mismatch',
              metric: 'net-profit',
              figure: 'Profit before tax 4,676.93',
              detail: 'the quoted row does not carry a net-profit label',
            },
          ],
        }),
      ],
    ]);
    const { items } = await page();

    const view = items[0].enrichment;
    expect(view.resultsLine).toContain('Q1 FY27 (CONSOLIDATED)');
    // The two quotes are what makes the line checkable: the heading that fixed
    // the basis and the column dates that made the comparison year-on-year.
    expect(view.results?.basisSpan).toContain('CONSOLIDATED');
    expect(view.results?.columnsSpan).toContain('30.06.2025');
    expect(view.results?.figures).toEqual([
      {
        metric: 'revenue',
        current: '73,977.90',
        prior: '65,607.59',
        unit: 'MN',
        span: 'Revenue from operations 73,977.90 73,356.74 65,607.59',
      },
    ]);
    expect(view.resultsDiscards).toEqual([
      {
        reason: 'label-mismatch',
        metric: 'net-profit',
        figure: 'Profit before tax 4,676.93',
        detail: 'the quoted row does not carry a net-profit label',
      },
    ]);
    expect(view.resultsProposed).toBe(1);
  });

  it('counts results lines and refusals apart from the claim ones', async () => {
    await seed([
      [
        2,
        enrichment({
          resultsLine: 'ACME Q1 FY27 (CONSOLIDATED): EPS ₹5.52 VS ₹0.20 (YOY)',
          resultsProposed: 1,
        }),
      ],
      [3, enrichment({ resultsRefusalReason: 'basis-not-determinable' })],
      [4, enrichment({ resultsRefusalReason: 'no-results' })],
    ]);
    const summary = await service.getEnrichmentSummary();

    expect(summary.withResults).toBe(1);
    expect(summary.byResultsRefusal).toEqual([
      { key: 'basis-not-determinable', count: 1 },
      { key: 'no-results', count: 1 },
    ]);
  });
});

describe('echoed claims', () => {
  const withClaim = (text: string): FilingEnrichment =>
    enrichment({
      claims: [
        { text, span: text, kind: 'operational', periodSpan: null },
      ] as FilingEnrichment['claims'],
    });

  it('marks a repeat of a fact the same company already stated', async () => {
    // DHARMAJ filed an investor presentation and a press release a minute
    // apart, both saying revenue grew 5% in Q1FY27. Both are true and both were
    // matched against their own source document; printing both tells a reader
    // one thing twice, and the grid layout puts them side by side.
    await model.insertMany([
      {
        ...makeFiling(2, {
          symbol: 'DHARMAJ',
          disseminatedAt: new Date('2026-08-05T06:00:00.000Z'),
        }),
        enrichment: withClaim('Revenue growth of 5% YOY in Q1FY27'),
      },
      {
        ...makeFiling(1, {
          symbol: 'DHARMAJ',
          disseminatedAt: new Date('2026-08-05T05:59:00.000Z'),
        }),
        enrichment: withClaim('Revenue grew 5% YOY in Q1FY27.'),
      },
    ]);

    const { items } = await page();
    // Newest first, so the newest telling keeps the claim and the older
    // restatement is the echo — a company restating a figure in a later
    // document is usually confirming or correcting it.
    expect(items[0].enrichment.claims[0].echo).toBe(false);
    expect(items[1].enrichment.claims[0].echo).toBe(true);
  });

  it('never marks an echo across two different companies', async () => {
    // Two firms can report the same revenue in the same quarter. Collapsing
    // those would hide one company's results entirely, which is a far worse
    // failure than showing a fact twice.
    await model.insertMany([
      {
        ...makeFiling(2, {
          symbol: 'ACME',
          disseminatedAt: new Date('2026-08-05T06:00:00.000Z'),
        }),
        enrichment: withClaim('Q1 revenue Rs 1,089 Cr, up 2.3% YoY'),
      },
      {
        ...makeFiling(1, {
          symbol: 'OTHER',
          disseminatedAt: new Date('2026-08-05T05:59:00.000Z'),
        }),
        enrichment: withClaim('Q1 revenue Rs 1,089 Cr, up 2.3% YoY'),
      },
    ]);

    const { items } = await page();
    expect(items[0].enrichment.claims[0].echo).toBe(false);
    expect(items[1].enrichment.claims[0].echo).toBe(false);
  });

  it('leaves an unquantified claim alone however often it repeats', async () => {
    // The empty figure set is shared by every qualitative claim in the
    // collection, so treating it as a match would fold a company's whole
    // narrative output into one line.
    await model.insertMany([
      {
        ...makeFiling(2, {
          disseminatedAt: new Date('2026-08-05T06:00:00.000Z'),
        }),
        enrichment: withClaim('Commissioned the plant'),
      },
      {
        ...makeFiling(1, {
          disseminatedAt: new Date('2026-08-05T05:59:00.000Z'),
        }),
        enrichment: withClaim('Commissioned the plant'),
      },
    ]);

    const { items } = await page();
    expect(items[0].enrichment.claims[0].echo).toBe(false);
    expect(items[1].enrichment.claims[0].echo).toBe(false);
  });
});
