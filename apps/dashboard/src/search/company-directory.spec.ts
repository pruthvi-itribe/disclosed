import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { FilingSchema, type Filing, type FilingDocument } from '@app/filings';
import { CompanyDirectory, DIRECTORY_TTL_MS } from './company-directory';

/**
 * The directory, against a real mongod.
 *
 * A MOCKED MODEL WOULD PROVE NOTHING HERE. The whole claim this class makes is
 * about a query PLAN — that the two reads behind it are covered index scans that
 * examine zero documents — and a mock can only assert that the pipeline is the
 * one we wrote. The plan assertion below runs `explain('executionStats')` and
 * reads `totalDocsExamined`, which is the only honest form of "this does not
 * scan the collection".
 */

const makeFiling = (
  seqId: number,
  symbol: string,
  companyName: string,
  category: string,
): Filing => ({
  seqId,
  symbol,
  isin: `INE${String(seqId).padStart(9, '0')}`,
  companyName,
  industry: null,
  category,
  summary: `${companyName} has informed the Exchange about ${category}`,
  attachmentUrl: null,
  announcedAt: new Date('2026-08-05T04:58:18.000Z'),
  disseminatedAt: new Date('2026-08-05T04:58:18.000Z'),
  ingestedAt: new Date('2026-08-05T04:58:24.000Z'),
});

let mongo: MongoMemoryServer;
let model: Model<FilingDocument>;
let now: Date;

const clock = (): Date => now;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  model = mongoose.model<FilingDocument>('DirectoryFiling', FilingSchema);
  await model.syncIndexes();
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await model.deleteMany({});
  now = new Date('2026-08-07T06:00:00.000Z');
});

const seed = async (): Promise<void> => {
  await model.insertMany([
    makeFiling(1, 'BRITANNIA', 'Britannia Industries Limited', 'Dividend'),
    makeFiling(2, 'BRITANNIA', 'Britannia Industries Limited', 'Stock split'),
    makeFiling(3, 'BRITANNIA', 'Britannia Industries Limited', 'Stock split'),
    makeFiling(4, 'VIKRAMSOLR', 'Vikram Solar Limited', 'Dividend'),
  ]);
};

describe('CompanyDirectory — what it holds', () => {
  it('collapses filings into distinct companies and counts them', async () => {
    await seed();
    const snapshot = await new CompanyDirectory(model, clock).snapshot();

    expect(snapshot.companies).toEqual([
      expect.objectContaining({
        symbol: 'BRITANNIA',
        companyName: 'Britannia Industries Limited',
        filings: 3,
      }),
      expect.objectContaining({ symbol: 'VIKRAMSOLR', filings: 1 }),
    ]);
  });

  it('pre-tokenises every company, so a keystroke never tokenises anything', async () => {
    await seed();
    const snapshot = await new CompanyDirectory(model, clock).snapshot();

    expect(snapshot.companies[1].terms).toEqual([
      'vikramsolr',
      'vikram',
      'solar',
    ]);
  });

  it('counts categories, so a category suggestion can say how big it is', async () => {
    await seed();
    const snapshot = await new CompanyDirectory(model, clock).snapshot();

    // Count first, then name. Two categories on the same count keep a stable
    // order between refreshes, which is what stops a suggestion list reordering
    // itself under an arrow key.
    expect(snapshot.categories).toEqual([
      expect.objectContaining({ category: 'Dividend', filings: 2 }),
      expect.objectContaining({ category: 'Stock split', filings: 2 }),
    ]);
  });

  it('folds the categories into groups using this codebase own table', async () => {
    // Not a second grouping in the database. The 116-row mapping lives in
    // `category-group.ts` where a test checks it against the corpus, and
    // restating it as a `$switch` would be the same table in two languages.
    await seed();
    const snapshot = await new CompanyDirectory(model, clock).snapshot();
    const capital = snapshot.groups.find((row) => row.group === 'capital');

    expect(capital?.filings).toBe(4);
    expect(capital?.label).toBe('Capital');
  });

  it('holds every group, so one with no filings still offers itself', async () => {
    await seed();
    const snapshot = await new CompanyDirectory(model, clock).snapshot();

    expect(snapshot.groups.length).toBeGreaterThan(1);
    expect(snapshot.groups.some((row) => row.filings === 0)).toBe(true);
  });

  it('returns an empty directory rather than throwing on an empty collection', async () => {
    const snapshot = await new CompanyDirectory(model, clock).snapshot();

    expect(snapshot.companies).toEqual([]);
    expect(snapshot.categories).toEqual([]);
  });
});

/**
 * Counts the aggregations a body issues, and always puts the real method back.
 *
 * A `finally` rather than an `afterEach`, because a test that left the model
 * patched would fail the NEXT test with an error about `exec` — which is how
 * two of these were first written and what they reported was nonsense.
 */
const countingReads = async (
  body: () => Promise<void>,
): Promise<{ reads: number }> => {
  const real = model.aggregate.bind(model);
  let reads = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (model as any).aggregate = (...args: unknown[]) => {
    reads += 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (real as any)(...args);
  };
  try {
    await body();
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).aggregate = real;
  }
  return { reads };
};

describe('CompanyDirectory — the cost per keystroke', () => {
  it('reads NOTHING from the database on a warm snapshot', async () => {
    await seed();
    const directory = new CompanyDirectory(model, clock);
    await directory.snapshot();

    // THE HONEST MEASUREMENT of "does not scan per keystroke": count the reads
    // the next hundred calls issue, not the milliseconds they take.
    const { reads } = await countingReads(async () => {
      for (let i = 0; i < 100; i += 1) await directory.snapshot();
    });

    expect(reads).toBe(0);
  });

  it('serves the stale snapshot while a refresh runs, so no keystroke waits', async () => {
    await seed();
    const directory = new CompanyDirectory(model, clock);
    const first = await directory.snapshot();

    await model.insertMany([
      makeFiling(5, 'LUPIN', 'Lupin Limited', 'Press Release'),
    ]);
    now = new Date(now.getTime() + DIRECTORY_TTL_MS + 1);

    // Returns IMMEDIATELY with what it has. A reader mid-word must not pay for
    // a rebuild triggered by the clock rather than by anything they did.
    const stale = await directory.snapshot();
    expect(stale.companies).toHaveLength(2);
    expect(stale.builtAt).toEqual(first.builtAt);

    await directory.settled();
    expect((await directory.snapshot()).companies).toHaveLength(3);
  });

  it('rebuilds once for a burst of concurrent cold requests', async () => {
    // A cold cache and a reader holding a key down is the one moment this could
    // stampede the database with twenty identical pairs of aggregations.
    await seed();
    const directory = new CompanyDirectory(model, clock);

    const { reads } = await countingReads(async () => {
      await Promise.all(
        Array.from({ length: 20 }, async () => directory.snapshot()),
      );
    });

    // Two: one for the companies, one for the categories. Not forty.
    expect(reads).toBe(2);
  });

  it('keeps serving the last good snapshot when a refresh fails', async () => {
    // A dashboard whose search box empties itself because one aggregation timed
    // out is worse than one offering a list a minute old.
    await seed();
    const directory = new CompanyDirectory(model, clock);
    await directory.snapshot();

    const real = model.aggregate.bind(model);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (model as any).aggregate = () => {
      throw new Error('mongod went away');
    };
    now = new Date(now.getTime() + DIRECTORY_TTL_MS + 1);

    try {
      await directory.snapshot();
      await directory.settled();
      expect((await directory.snapshot()).companies).toHaveLength(2);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any).aggregate = real;
    }
  });

  it('does not retry a dead database on every keystroke', async () => {
    // Staleness is measured from the ATTEMPT, not from the last success. Without
    // that, a failed refresh leaves the snapshot permanently stale and every
    // subsequent keystroke launches another pair of aggregations at a mongod
    // that is already not answering.
    await seed();
    const directory = new CompanyDirectory(model, clock);
    await directory.snapshot();
    now = new Date(now.getTime() + DIRECTORY_TTL_MS + 1);

    const { reads } = await countingReads(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const broken = (model as any).aggregate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any).aggregate = (...args: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (broken as any)(...args);
        throw new Error('mongod went away');
      };
      await directory.snapshot();
      await directory.settled();
      for (let i = 0; i < 50; i += 1) await directory.snapshot();
    });

    // ONE. The failed attempt's first aggregation throws before the second is
    // even constructed, and the fifty calls after it issue nothing at all.
    expect(reads).toBe(1);
  });
});

describe('CompanyDirectory — the query plan', () => {
  it('builds the company list from an index alone, examining zero documents', async () => {
    await seed();

    const explained = await model
      .aggregate(CompanyDirectory.COMPANY_PIPELINE, {
        hint: CompanyDirectory.COMPANY_INDEX,
      })
      .explain('executionStats');

    const stats = cursorStats(explained);
    // THE ASSERTION THAT MAKES THE FEATURE TRUE. A covered index scan reads keys
    // and never touches a document; the moment `totalDocsExamined` is non-zero
    // this is a collection scan wearing an index's name.
    expect(stats.totalDocsExamined).toBe(0);
    expect(stats.totalKeysExamined).toBe(4);
  });

  it('builds the category list from an index alone too', async () => {
    await seed();

    const explained = await model
      .aggregate(CompanyDirectory.CATEGORY_PIPELINE, {
        hint: CompanyDirectory.CATEGORY_INDEX,
      })
      .explain('executionStats');

    expect(cursorStats(explained).totalDocsExamined).toBe(0);
  });
});

interface CursorStats {
  readonly totalKeysExamined: number;
  readonly totalDocsExamined: number;
}

/**
 * Digs the executionStats out of an aggregation explain.
 *
 * An aggregation explains as a list of stages whose first one wraps the query
 * plan; a `find` explains as the plan itself. Reading `stages[0].$cursor` is
 * therefore the shape, not a convenience.
 */
const cursorStats = (explained: unknown): CursorStats => {
  const stages = (explained as { stages?: { $cursor?: unknown }[] }).stages;
  const cursor = stages?.[0]?.$cursor as
    { executionStats?: CursorStats } | undefined;
  const stats = cursor?.executionStats;
  if (stats === undefined) {
    throw new Error(
      `no executionStats in the explain output: ${JSON.stringify(explained).slice(0, 400)}`,
    );
  }
  return stats;
};
