import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import {
  PENDING_ENRICHMENT,
  FilingSchema,
  type Filing,
  type FilingDocument,
  type FilingEnrichment,
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
      attemptedAtIst: null,
      unparseableReason: null,
      lastError: null,
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
