import { IST_DAY_MS } from '@app/common';
import type {
  ContextCounts,
  ContextQuery,
  EnrichmentRepository,
  Filing,
} from '@app/filings';
import { FilingContextService } from './filing-context.service';

const NOW = new Date('2026-08-06T06:00:00.000Z');

const filing = (overrides: Partial<Filing> = {}): Filing => ({
  seqId: 1,
  symbol: 'PANACEABIO',
  isin: 'INE000000001',
  companyName: 'Panacea Biotec Limited',
  industry: null,
  category: 'Bagging/Receiving of orders/contracts',
  summary: 'order',
  attachmentUrl: null,
  announcedAt: NOW,
  disseminatedAt: NOW,
  ingestedAt: NOW,
  ...overrides,
});

const NO_COUNTS: ContextCounts = {
  priorInWindow: 0,
  lastPriorAt: null,
  priorsWithAmount: 0,
  priorsAtLeastAsLarge: 0,
};

class StubRepository {
  public readonly queries: ContextQuery[] = [];
  public coverageCalls = 0;

  constructor(
    private counts: ContextCounts = NO_COUNTS,
    private days = 45,
  ) {}

  async contextCounts(query: ContextQuery): Promise<ContextCounts> {
    this.queries.push(query);
    return this.counts;
  }

  async coverageDays(): Promise<number> {
    this.coverageCalls += 1;
    return this.days;
  }
}

const serviceWith = (
  repository: StubRepository,
  windowDays = 30,
  ttlMs = 60_000,
): FilingContextService =>
  new FilingContextService(
    repository as unknown as EnrichmentRepository,
    windowDays,
    ttlMs,
  );

describe('FilingContextService', () => {
  it('composes the running count from the repository', async () => {
    const repository = new StubRepository({ ...NO_COUNTS, priorInWindow: 2 });
    const line = await serviceWith(repository).contextFor(filing(), NOW);
    expect(line).toBe('3rd order for PANACEABIO in 30 days');
  });

  it('asks the repository about the right window and filing', async () => {
    const repository = new StubRepository();
    await serviceWith(repository, 14).contextFor(filing(), NOW);

    expect(repository.queries).toEqual([
      {
        symbol: 'PANACEABIO',
        category: 'Bagging/Receiving of orders/contracts',
        disseminatedAt: NOW,
        windowDays: 14,
        amountRupees: null,
      },
    ]);
  });

  it('spends no query at all on a category with no countable event', async () => {
    // The noun is an in-memory lookup, and it must short-circuit BEFORE the
    // round trip: this runs once per filing on the alert path.
    const repository = new StubRepository();
    const line = await serviceWith(repository).contextFor(
      filing({ category: 'Corrigendum' }),
      NOW,
    );

    expect(line).toBeNull();
    expect(repository.queries).toHaveLength(0);
    expect(repository.coverageCalls).toBe(0);
  });

  it('spends no query on a category the action table does not map', async () => {
    const repository = new StubRepository();
    await serviceWith(repository).contextFor(
      filing({ category: 'Something NSE Invented' }),
      NOW,
    );
    expect(repository.queries).toHaveLength(0);
  });

  it('passes the amount through so the size comparison can be made', async () => {
    const repository = new StubRepository({
      priorInWindow: 3,
      lastPriorAt: null,
      priorsWithAmount: 2,
      priorsAtLeastAsLarge: 0,
    });

    const line = await serviceWith(repository).contextForAmount(
      filing(),
      NOW,
      782_412_000,
    );

    expect(line).toBe('largest order for PANACEABIO in the last 30 days');
    expect(repository.queries[0].amountRupees).toBe(782_412_000);
  });

  it('clamps the stated window to the data actually held', async () => {
    const repository = new StubRepository(
      { ...NO_COUNTS, priorInWindow: 2 },
      9,
    );
    const line = await serviceWith(repository).contextFor(filing(), NOW);
    expect(line).toBe('3rd order for PANACEABIO in 9 days');
  });

  it('says nothing at all on a collection too young to support a window', async () => {
    const repository = new StubRepository(
      { ...NO_COUNTS, priorInWindow: 5 },
      1,
    );
    expect(await serviceWith(repository).contextFor(filing(), NOW)).toBeNull();
  });
});

describe('FilingContextService — the coverage memo', () => {
  it('reads the oldest filing once for a burst of alerts', async () => {
    const repository = new StubRepository({ ...NO_COUNTS, priorInWindow: 1 });
    const service = serviceWith(repository);

    for (let index = 0; index < 20; index += 1) {
      await service.contextFor(filing(), new Date(NOW.getTime() + index));
    }

    expect(repository.queries).toHaveLength(20);
    expect(repository.coverageCalls).toBe(1);
  });

  it('re-reads once the memo has aged out', async () => {
    const repository = new StubRepository({ ...NO_COUNTS, priorInWindow: 1 });
    const service = serviceWith(repository, 30, 1000);

    await service.contextFor(filing(), NOW);
    await service.contextFor(filing(), new Date(NOW.getTime() + 999));
    await service.contextFor(filing(), new Date(NOW.getTime() + 1001));

    expect(repository.coverageCalls).toBe(2);
  });

  it('never states a longer window because the memo is stale', async () => {
    // The cached value is coverage as of when it was read, and the collection
    // only grows — so a stale memo is a LOWER bound, which can shorten a stated
    // window but never lengthen one past the data held.
    const repository = new StubRepository(
      { ...NO_COUNTS, priorInWindow: 1 },
      5,
    );
    const service = serviceWith(repository);

    const first = await service.contextFor(filing(), NOW);
    const later = await service.contextFor(
      filing(),
      new Date(NOW.getTime() + 30 * IST_DAY_MS),
    );

    expect(first).toBe('2nd order for PANACEABIO in 5 days');
    expect(later).toBe('2nd order for PANACEABIO in 5 days');
  });
});

describe('FilingContextService — the shipped defaults', () => {
  it('asks about the project default window when none is given', async () => {
    const repository = new StubRepository();
    const service = new FilingContextService(
      repository as unknown as EnrichmentRepository,
    );

    await service.contextFor(filing(), NOW);
    expect(repository.queries[0].windowDays).toBe(30);
  });

  it('memoises coverage with the default TTL', async () => {
    const repository = new StubRepository();
    const service = new FilingContextService(
      repository as unknown as EnrichmentRepository,
    );

    await service.contextFor(filing(), NOW);
    await service.contextFor(filing(), new Date(NOW.getTime() + 5_000));
    expect(repository.coverageCalls).toBe(1);
  });
});
