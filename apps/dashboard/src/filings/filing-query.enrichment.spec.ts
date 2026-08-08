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
    //
    // `topic` is null and not absent because this fixture stores none, which is
    // what a claim written before the classifier existed looks like. The page
    // draws it as "everything else" and must be able to tell that from a claim
    // the rules genuinely could not name.
    expect(view.claims).toEqual([
      {
        ...CLAIM,
        echo: false,
        topic: null,
        direction: null,
        directionEvidence: null,
        // Computed on read from the kind and the span: this one is a `target`
        // whose sentence names a year it is aiming at, so the company page may
        // quote it under "plans, in their words".
        planEvidence: 'by FY31',
        // Also computed on read, and empty here because the sentence schedules
        // nothing. Empty rather than absent: "this claim names no appointment"
        // and "nobody looked" must not read the same.
        commitments: [],
      },
    ]);
    // The document's own line break survives the round trip, because the span
    // is what a reviewer checks against the source.
    expect(view.claims[0].span).toContain('\n');
    expect(view.claimsProposed).toBe(1);
  });

  it('sends the topic it already filters on', async () => {
    // THE FILTER AND THE PICTURE MUST COME FROM ONE FIELD. The topic query has
    // always run against `enrichment.claims.topic`; the view did not send it,
    // so a page could ask for dividends and could not say how much of a company
    // was dividends. The company page's mix bar read "Everything else: 31" for
    // a company whose claims carry five different topics.
    await seed([
      [
        1,
        enrichment({
          claims: [
            { ...CLAIM, topic: 'financial' },
            {
              ...CLAIM,
              text: 'declared an interim dividend of Rs 5 per share',
              topic: 'dividend',
            },
          ],
        }),
      ],
    ]);

    const { items } = await page();
    expect(items[0].enrichment.claims.map((claim) => claim.topic)).toEqual([
      'financial',
      'dividend',
    ]);
  });

  it('sends the printed movement and the characters that prove it', async () => {
    // THE MARK AND ITS EVIDENCE TRAVEL TOGETHER. The card draws a glyph from
    // `direction` and puts `directionEvidence` in its title, so a reader can
    // check the mark against the document's own words without leaving the
    // page. Sending one without the other would be a mark nobody can check,
    // which is the only kind this pipeline may not show.
    await seed([
      [
        1,
        enrichment({
          claims: [
            {
              ...CLAIM,
              span: 'Revenue up 16% YoY and down 2% QoQ',
              direction: 'mixed',
              directionEvidence: 'up 16% YoY and down 2%',
            },
            { ...CLAIM, direction: 'unrated', directionEvidence: null },
          ],
        }),
      ],
    ]);

    const { items } = await page();
    expect(
      items[0].enrichment.claims.map((claim) => [
        claim.direction,
        claim.directionEvidence,
      ]),
    ).toEqual([
      ['mixed', 'up 16% YoY and down 2%'],
      ['unrated', null],
    ]);
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

  it('says which claims a plans section may quote, and which it may not', async () => {
    // THE FIELD THE COMPANY PAGE SELECTS ON. The extractor files a great deal
    // under `guidance` that points nowhere ahead — measured 2026-08-08, 634 of
    // 813 such claims are last quarter's figures, a declared dividend or an AGM
    // date — so the read path answers the question rather than leaving the
    // browser to guess it from the kind.
    await seed([
      [
        1,
        enrichment({
          claims: [
            {
              ...CLAIM,
              span: 'we expect our organic growth in FY27 to be better than FY26',
              kind: 'guidance',
            },
            {
              ...CLAIM,
              text: 'cash and equivalents at Rs 4,566.70 million',
              span: 'Cash and Cash Equivalents (including investments) were at ₹ 4566.70 million as at June 30, 2026.',
              kind: 'guidance',
            },
          ],
        }),
      ],
    ]);

    const { items } = await page();
    expect(
      items[0].enrichment.claims.map((claim) => claim.planEvidence),
    ).toEqual(['expect', null]);
  });

  it('sends the dated commitments a claim printed, against the server IST day', async () => {
    // THE BROWSER HOLDS NO VOCABULARY AND NO CALENDAR. `datedCommitments` runs
    // here, where the one IST definition lives, so "still ahead" is decided
    // against the server's day rather than against whatever the reader's
    // machine is set to — a browser on UTC rolls its day 5½ hours late and
    // would show yesterday's record date as upcoming for half the evening.
    await seed([
      [
        1,
        enrichment({
          claims: [
            {
              ...CLAIM,
              span: 'the Company has fixed August 18, 2026 (Tuesday), as the Record Date for the purpose of determining the entitlement of equity Shareholders.',
              kind: 'operational',
            },
            {
              ...CLAIM,
              span: 'Approved convening 31 st AGM of Hinduja Global Solutions Limited on Friday, September 25, 2025',
              kind: 'operational',
            },
          ],
        }),
      ],
    ]);

    const { items } = await page();

    // The clock is 2026-08-06 IST. The record date is ahead of it and travels
    // with the words that made it one; the 2025 AGM is behind it and is gone.
    expect(
      items[0].enrichment.claims.map((claim) => claim.commitments),
    ).toEqual([
      [
        {
          date: '2026-08-18',
          dateText: 'August 18, 2026',
          evidence: 'Record Date',
        },
      ],
      [],
    ]);
  });

  it('filters to the filings where the company said what it plans', async () => {
    // THE PAIR, NOT ONE OF THEM. `guidance` and `target` are two shapes of one
    // thing — the company's own statement about its own future — and measured
    // on the live collection on 2026-08-08 they are 748 and 65 claims, so a
    // filter on `guidance` alone answers the reader's question wrongly by 8%
    // while looking like it worked.
    await seed([
      [1, enrichment({ claims: [{ ...CLAIM, kind: 'guidance' }] })],
      [2, enrichment({ claims: [{ ...CLAIM, kind: 'target' }] })],
      [3, enrichment({ claims: [{ ...CLAIM, kind: 'operational' }] })],
      [4, enrichment({ claimRefusalReason: 'no-claims' })],
      [5, undefined],
    ]);

    const { items, meta } = await page({ plans: 'only' });

    expect(meta.total).toBe(2);
    expect(items.map((item) => item.seqId).sort()).toEqual([1, 2]);
  });

  it('keeps a filing whose plan sits among claims of other kinds', async () => {
    // The same "any claim" reading the topic filter has: a results presentation
    // that also states next year's guidance belongs under both.
    await seed([
      [
        1,
        enrichment({
          claims: [
            { ...CLAIM, kind: 'operational' },
            { ...CLAIM, kind: 'guidance' },
          ],
        }),
      ],
    ]);

    expect((await page({ plans: 'only' })).meta.total).toBe(1);
  });

  it('drops a filing whose plan-kind claim points nowhere ahead', async () => {
    // The chip and the company page's quoted section answer to one rule, so a
    // filing that would show an empty section must not reach the chip's feed.
    await seed([
      [
        1,
        enrichment({
          claims: [
            {
              ...CLAIM,
              kind: 'guidance',
              span: 'Consolidated Revenue for Q1 FY2027 at ₹ 3637 million - up 54% Y-o-Y',
            },
          ],
        }),
      ],
    ]);

    expect((await page({ plans: 'only' })).meta.total).toBe(0);
  });

  it('will not build one plan out of two different claims', async () => {
    // `$elemMatch`, and this is the filing it exists for: the forward-looking
    // words are in an OPERATIONAL claim and the guidance claim says nothing of
    // the kind. Two dotted paths would match this and the section would be
    // empty on the page the chip led to.
    await seed([
      [
        1,
        enrichment({
          claims: [
            {
              ...CLAIM,
              kind: 'operational',
              span: 'we expect the plant to be commissioned in FY28',
            },
            {
              ...CLAIM,
              kind: 'guidance',
              span: 'Q1 FY27 revenue stood at ₹ 3,637 million',
            },
          ],
        }),
      ],
    ]);

    expect((await page({ plans: 'only' })).meta.total).toBe(0);
  });

  it('returns everything when the plans filter is not asked for', async () => {
    await seed([
      [1, enrichment({ claims: [{ ...CLAIM, kind: 'guidance' }] })],
      [2, enrichment({ claims: [{ ...CLAIM, kind: 'operational' }] })],
    ]);

    expect((await page()).meta.total).toBe(2);
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
        // Rendered HERE, by the same `renderResultsValue` the wire line uses,
        // for the reason `amountDisplay` is: a second implementation of the
        // currency mark and the unit suffix in the browser is a second thing to
        // keep in step with the message that actually goes out.
        currentDisplay: '₹73,977.90 MN',
        priorDisplay: '₹65,607.59 MN',
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

  it('renders a per-share figure and a margin without inventing a scale', async () => {
    // The unit is the DOCUMENT's own declaration and the empty one is not a
    // missing value: EPS is rupees per share and takes the currency mark with
    // no scale word after it, and a margin the filer printed takes a percent
    // sign. Neither number is rescaled — that is the whole policy in
    // `results-line.ts`, and the page must not undo it by formatting its own.
    await seed([
      [
        7,
        enrichment({
          results: {
            basis: 'standalone',
            basisSpan: 'STANDALONE FINANCIAL RESULTS',
            columnsSpan: '30.06.2026 30.06.2025',
            period: 'Q1 FY27',
            priorPeriod: 'Q1 FY26',
            figures: [
              {
                metric: 'eps',
                current: '5.52',
                prior: '0.20',
                unit: '',
                span: 'Basic EPS (Rs.) 5.52 0.20',
              },
              {
                metric: 'ebitda-margin',
                current: '11.73',
                prior: '(13.32)',
                unit: '%',
                span: 'EBITDA Margin (%) 11.73 (13.32)',
              },
            ],
          },
        }),
      ],
    ]);

    const { items } = await page();
    const figures = items[0].enrichment.results?.figures ?? [];

    expect(figures.map((one) => one.currentDisplay)).toEqual([
      '₹5.52',
      '11.73%',
    ]);
    // A bracketed figure is a negative in an Indian statement, and the renderer
    // says so with a sign rather than leaving the reader to know the convention.
    expect(figures.map((one) => one.priorDisplay)).toEqual([
      '₹0.20',
      '-13.32%',
    ]);
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
