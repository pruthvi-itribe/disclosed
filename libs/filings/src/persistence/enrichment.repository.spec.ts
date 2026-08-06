import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { IST_DAY_MS } from '@app/common';
import type { Filing } from '../filing.types';
import {
  PENDING_ENRICHMENT,
  type FilingEnrichment,
} from '../logic/enrichment.types';
import {
  attemptsOf,
  DEFAULT_CLAIM_LEASE_MS,
  EnrichmentRepository,
} from './enrichment.repository';
import { FilingSchema, type FilingDocument } from './filing.schema';

const NOW = new Date('2026-08-06T06:00:00.000Z');

interface FilingOverrides {
  readonly symbol?: string;
  readonly category?: string;
  readonly disseminatedAt?: Date;
  readonly attachmentUrl?: string | null;
}

const makeFiling = (
  seqId: number,
  overrides: FilingOverrides = {},
): Filing => ({
  seqId,
  symbol: overrides.symbol ?? 'PANACEABIO',
  isin: 'INE000000001',
  companyName: 'Panacea Biotec Limited',
  industry: 'Pharmaceuticals',
  category: overrides.category ?? 'Bagging/Receiving of orders/contracts',
  summary: `Order number ${seqId}`,
  attachmentUrl:
    overrides.attachmentUrl === undefined
      ? 'https://nsearchives.nseindia.com/corporate/a.pdf'
      : overrides.attachmentUrl,
  announcedAt: new Date('2026-08-05T04:58:17.000Z'),
  disseminatedAt:
    overrides.disseminatedAt ?? new Date('2026-08-05T04:58:18.000Z'),
  ingestedAt: new Date('2026-08-05T04:58:19.000Z'),
});

const enrichedWith = (
  overrides: Partial<FilingEnrichment>,
): FilingEnrichment => ({
  ...PENDING_ENRICHMENT,
  state: 'enriched',
  attempts: 1,
  attemptedAt: NOW,
  ...overrides,
});

let mongo: MongoMemoryServer;
let model: Model<FilingDocument>;
let repo: EnrichmentRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  model = mongoose.model<FilingDocument>('EnrichFiling', FilingSchema);
  await model.syncIndexes();
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await model.deleteMany({});
  repo = new EnrichmentRepository(model);
});

const insert = async (...filings: readonly Filing[]): Promise<void> => {
  await model.insertMany(filings);
};

const storedEnrichment = async (
  seqId: number,
): Promise<FilingEnrichment | undefined> => {
  const doc = await model
    .findOne({ seqId }, { _id: 0, enrichment: 1 })
    .lean()
    .exec();
  return doc?.enrichment;
};

describe('claimNext', () => {
  it('returns null on an empty collection', async () => {
    expect(await repo.claimNext(NOW)).toBeNull();
  });

  it('claims a filing that has never been attempted', async () => {
    await insert(makeFiling(10));

    const claimed = await repo.claimNext(NOW);
    expect(claimed).not.toBeNull();
    expect(claimed?.filing.seqId).toBe(10);
    expect(claimed?.attempts).toBe(1);
  });

  it('leases the filing before the caller touches the network', async () => {
    await insert(makeFiling(10));
    await repo.claimNext(NOW);

    const enrichment = await storedEnrichment(10);
    expect(enrichment?.state).toBe('pending');
    expect(enrichment?.attempts).toBe(1);
    expect(enrichment?.attemptedAt).toEqual(NOW);
    expect(enrichment?.nextAttemptAt).toEqual(
      new Date(NOW.getTime() + DEFAULT_CLAIM_LEASE_MS),
    );
  });

  it('does not hand the same filing to a second worker inside the lease', async () => {
    await insert(makeFiling(10));

    const first = await repo.claimNext(NOW);
    const second = await repo.claimNext(new Date(NOW.getTime() + 1000));

    expect(first?.filing.seqId).toBe(10);
    expect(second).toBeNull();
  });

  it('offers the filing again once the lease expires', async () => {
    await insert(makeFiling(10));
    await repo.claimNext(NOW);

    const later = new Date(NOW.getTime() + DEFAULT_CLAIM_LEASE_MS + 1);
    const again = await repo.claimNext(later);

    expect(again?.filing.seqId).toBe(10);
    expect(again?.attempts).toBe(2);
  });

  it('claims the newest filing first', async () => {
    // A backlog must never delay the filing that landed a minute ago.
    await insert(
      makeFiling(10, { disseminatedAt: new Date('2026-08-01T04:00:00.000Z') }),
      makeFiling(30, { disseminatedAt: new Date('2026-08-05T04:00:00.000Z') }),
      makeFiling(20, { disseminatedAt: new Date('2026-08-03T04:00:00.000Z') }),
    );

    expect((await repo.claimNext(NOW))?.filing.seqId).toBe(30);
    expect((await repo.claimNext(NOW))?.filing.seqId).toBe(20);
    expect((await repo.claimNext(NOW))?.filing.seqId).toBe(10);
    expect(await repo.claimNext(NOW)).toBeNull();
  });

  it.each(['enriched', 'unparseable', 'failed'] as const)(
    'never re-claims a filing in the terminal state %s',
    async (state) => {
      await insert(makeFiling(10));
      await repo.recordEnrichment(10, { ...PENDING_ENRICHMENT, state });

      expect(await repo.claimNext(NOW)).toBeNull();
      // Nor a year later. Terminal means terminal.
      expect(
        await repo.claimNext(new Date(NOW.getTime() + 365 * IST_DAY_MS)),
      ).toBeNull();
    },
  );

  it('re-claims a filing left pending with an expired backoff', async () => {
    await insert(makeFiling(10));
    await repo.recordEnrichment(10, {
      ...PENDING_ENRICHMENT,
      state: 'pending',
      attempts: 2,
      nextAttemptAt: new Date(NOW.getTime() - 1),
    });

    const claimed = await repo.claimNext(NOW);
    expect(claimed?.attempts).toBe(3);
  });

  it('does not claim a filing whose backoff has not elapsed', async () => {
    await insert(makeFiling(10));
    await repo.recordEnrichment(10, {
      ...PENDING_ENRICHMENT,
      state: 'pending',
      attempts: 2,
      nextAttemptAt: new Date(NOW.getTime() + 60_000),
    });

    expect(await repo.claimNext(NOW)).toBeNull();
  });

  it('carries the whole filing, so the worker needs no second read', async () => {
    await insert(makeFiling(10));
    const claimed = await repo.claimNext(NOW);

    expect(claimed?.filing).toMatchObject({
      seqId: 10,
      symbol: 'PANACEABIO',
      category: 'Bagging/Receiving of orders/contracts',
      attachmentUrl: 'https://nsearchives.nseindia.com/corporate/a.pdf',
    });
  });
});

describe('recordEnrichment', () => {
  it('writes the whole verdict as one block', async () => {
    await insert(makeFiling(10));
    const verdict = enrichedWith({
      amountRupees: 185_366_820,
      amountEvidence: 'Rs. 18,53,66,820',
      amountAnchor: 'sebi-label',
      headline: 'PANACEABIO BAGS ORDER ₹18.54 cr',
    });

    await repo.recordEnrichment(10, verdict);

    const stored = await storedEnrichment(10);
    expect(stored).toMatchObject({
      state: 'enriched',
      amountRupees: 185_366_820,
      amountEvidence: 'Rs. 18,53,66,820',
      headline: 'PANACEABIO BAGS ORDER ₹18.54 cr',
    });
  });

  it('replaces a previous attempt rather than merging with it', async () => {
    // A filing must never end up with an amount from one attempt and a refusal
    // reason from another.
    await insert(makeFiling(10));
    await repo.recordEnrichment(10, enrichedWith({ amountRupees: 1_000_000 }));
    await repo.recordEnrichment(
      10,
      enrichedWith({ amountRefusalReason: 'no-candidate' }),
    );

    const stored = await storedEnrichment(10);
    expect(stored?.amountRupees).toBeNull();
    expect(stored?.amountRefusalReason).toBe('no-candidate');
  });

  it('throws rather than silently doing nothing for a filing that vanished', async () => {
    await expect(repo.recordEnrichment(999, enrichedWith({}))).rejects.toThrow(
      /no filing with seqId 999/,
    );
  });

  it('leaves every other filing alone', async () => {
    await insert(makeFiling(10), makeFiling(20));
    await repo.recordEnrichment(10, enrichedWith({ amountRupees: 5 }));

    expect(await storedEnrichment(20)).toBeUndefined();
  });
});

describe('contextCounts', () => {
  const day = (n: number): Date =>
    new Date(new Date('2026-08-06T04:00:00.000Z').getTime() - n * IST_DAY_MS);

  it('counts only the same symbol and category inside the window', async () => {
    await insert(
      makeFiling(1, { disseminatedAt: day(1) }),
      makeFiling(2, { disseminatedAt: day(2) }),
      makeFiling(3, { disseminatedAt: day(3), symbol: 'OTHER' }),
      makeFiling(4, { disseminatedAt: day(4), category: 'Press Release' }),
      makeFiling(5, { disseminatedAt: day(40) }),
    );

    const counts = await repo.contextCounts({
      symbol: 'PANACEABIO',
      category: 'Bagging/Receiving of orders/contracts',
      disseminatedAt: day(0),
      windowDays: 30,
      amountRupees: null,
    });

    expect(counts.priorInWindow).toBe(2);
  });

  it('counts priors STRICTLY before this filing, never itself', async () => {
    // NSE stamps to the second and publishes several filings within one. `$lte`
    // would count the filing against itself and report every first as a second.
    const at = day(1);
    await insert(makeFiling(1, { disseminatedAt: at }));

    const counts = await repo.contextCounts({
      symbol: 'PANACEABIO',
      category: 'Bagging/Receiving of orders/contracts',
      disseminatedAt: at,
      windowDays: 30,
      amountRupees: null,
    });

    expect(counts.priorInWindow).toBe(0);
  });

  it('finds the last prior before the window when the window is empty', async () => {
    const old = day(45);
    await insert(makeFiling(1, { disseminatedAt: old }));

    const counts = await repo.contextCounts({
      symbol: 'PANACEABIO',
      category: 'Bagging/Receiving of orders/contracts',
      disseminatedAt: day(0),
      windowDays: 30,
      amountRupees: null,
    });

    expect(counts.priorInWindow).toBe(0);
    expect(counts.lastPriorAt).toEqual(old);
  });

  it('does not look for a last prior when the window has filings', async () => {
    await insert(
      makeFiling(1, { disseminatedAt: day(2) }),
      makeFiling(2, { disseminatedAt: day(45) }),
    );

    const counts = await repo.contextCounts({
      symbol: 'PANACEABIO',
      category: 'Bagging/Receiving of orders/contracts',
      disseminatedAt: day(0),
      windowDays: 30,
      amountRupees: null,
    });

    expect(counts.priorInWindow).toBe(1);
    expect(counts.lastPriorAt).toBeNull();
  });

  it('returns null for a symbol with no history at all', async () => {
    const counts = await repo.contextCounts({
      symbol: 'NEWCO',
      category: 'Bagging/Receiving of orders/contracts',
      disseminatedAt: day(0),
      windowDays: 30,
      amountRupees: null,
    });

    expect(counts).toEqual({
      priorInWindow: 0,
      lastPriorAt: null,
      priorsWithAmount: 0,
      priorsAtLeastAsLarge: 0,
    });
  });

  it('compares amounts only against priors that carry one', async () => {
    await insert(
      makeFiling(1, { disseminatedAt: day(1) }),
      makeFiling(2, { disseminatedAt: day(2) }),
      makeFiling(3, { disseminatedAt: day(3) }),
    );
    await repo.recordEnrichment(1, enrichedWith({ amountRupees: 100_000_000 }));
    await repo.recordEnrichment(2, enrichedWith({ amountRupees: 900_000_000 }));
    await repo.recordEnrichment(
      3,
      enrichedWith({ amountRefusalReason: 'no-candidate' }),
    );

    const counts = await repo.contextCounts({
      symbol: 'PANACEABIO',
      category: 'Bagging/Receiving of orders/contracts',
      disseminatedAt: day(0),
      windowDays: 30,
      amountRupees: 500_000_000,
    });

    expect(counts.priorInWindow).toBe(3);
    expect(counts.priorsWithAmount).toBe(2);
    expect(counts.priorsAtLeastAsLarge).toBe(1);
  });

  it('does not count amounts at all when this filing has none', async () => {
    await insert(makeFiling(1, { disseminatedAt: day(1) }));
    await repo.recordEnrichment(1, enrichedWith({ amountRupees: 100_000_000 }));

    const counts = await repo.contextCounts({
      symbol: 'PANACEABIO',
      category: 'Bagging/Receiving of orders/contracts',
      disseminatedAt: day(0),
      windowDays: 30,
      amountRupees: null,
    });

    expect(counts.priorsWithAmount).toBe(0);
    expect(counts.priorsAtLeastAsLarge).toBe(0);
  });

  it('counts an equal amount as at least as large', async () => {
    await insert(makeFiling(1, { disseminatedAt: day(1) }));
    await repo.recordEnrichment(1, enrichedWith({ amountRupees: 500_000_000 }));

    const counts = await repo.contextCounts({
      symbol: 'PANACEABIO',
      category: 'Bagging/Receiving of orders/contracts',
      disseminatedAt: day(0),
      windowDays: 30,
      amountRupees: 500_000_000,
    });

    expect(counts.priorsAtLeastAsLarge).toBe(1);
  });

  it('is answered by an index rather than a collection scan', async () => {
    await insert(makeFiling(1, { disseminatedAt: day(1) }));

    const plan = await model
      .find({
        symbol: 'PANACEABIO',
        category: 'Bagging/Receiving of orders/contracts',
        disseminatedAt: { $gte: day(30), $lt: day(0) },
      })
      .explain('queryPlanner');

    const stringified = JSON.stringify(plan);
    // The alert path must not grow a collection scan as the collection grows.
    expect(stringified).toContain('IXSCAN');
    expect(stringified).toContain('symbol_1_category_1_disseminatedAt_-1');
  });
});

describe('coverageDays', () => {
  it('is zero on an empty collection', async () => {
    expect(await repo.coverageDays(NOW)).toBe(0);
  });

  it('measures from the oldest filing held', async () => {
    await insert(
      makeFiling(1, {
        disseminatedAt: new Date(NOW.getTime() - 10 * IST_DAY_MS),
      }),
      makeFiling(2, {
        disseminatedAt: new Date(NOW.getTime() - 2 * IST_DAY_MS),
      }),
    );

    expect(await repo.coverageDays(NOW)).toBeCloseTo(10, 6);
  });

  it('never reports negative coverage for a filing stamped in the future', async () => {
    await insert(
      makeFiling(1, { disseminatedAt: new Date(NOW.getTime() + IST_DAY_MS) }),
    );
    expect(await repo.coverageDays(NOW)).toBe(0);
  });
});

describe('tallyByState and pendingCount', () => {
  it('reports a never-attempted filing as pending', async () => {
    await insert(makeFiling(10), makeFiling(20));
    expect(await repo.tallyByState()).toEqual([{ state: 'pending', count: 2 }]);
    expect(await repo.pendingCount(NOW)).toBe(2);
  });

  it('counts each state separately', async () => {
    await insert(
      makeFiling(10),
      makeFiling(20),
      makeFiling(30),
      makeFiling(40),
    );
    await repo.recordEnrichment(10, {
      ...PENDING_ENRICHMENT,
      state: 'enriched',
    });
    await repo.recordEnrichment(20, {
      ...PENDING_ENRICHMENT,
      state: 'enriched',
    });
    await repo.recordEnrichment(30, {
      ...PENDING_ENRICHMENT,
      state: 'unparseable',
      unparseableReason: 'not-a-pdf',
    });

    const tally = await repo.tallyByState();
    expect(tally).toEqual([
      { state: 'enriched', count: 2 },
      { state: 'pending', count: 1 },
      { state: 'unparseable', count: 1 },
    ]);
  });

  it('excludes leased filings from the pending count', async () => {
    await insert(makeFiling(10), makeFiling(20));
    await repo.claimNext(NOW);

    expect(await repo.pendingCount(NOW)).toBe(1);
  });
});

describe('attemptsOf', () => {
  it.each([
    ['a first claim', { enrichment: { attempts: 1 } }, 1],
    ['a fourth claim', { enrichment: { attempts: 4 } }, 4],
    ['a zeroed counter', { enrichment: { attempts: 0 } }, 0],
  ])('reads %s as %d', (_label, document, expected) => {
    expect(attemptsOf(document)).toBe(expected);
  });

  it.each([
    ['no enrichment block at all', {}],
    ['an enrichment block with no counter', { enrichment: {} }],
    ['a counter that is not a number', { enrichment: { attempts: undefined } }],
    ['NaN', { enrichment: { attempts: Number.NaN } }],
    ['Infinity', { enrichment: { attempts: Number.POSITIVE_INFINITY } }],
  ])('falls back to 1 for %s', (_label, document) => {
    // Not reachable through claimNext, which always $incs. It is here because
    // an undefined attempt count makes the backoff NaN and a filing retries on
    // every tick forever — the exact failure the terminal states exist to stop.
    expect(attemptsOf(document)).toBe(1);
  });
});
