import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { FilingRepository } from './filing.repository';
import { FilingSchema, type FilingDocument } from './filing.schema';
import type { Filing } from '../filing.types';

const makeFiling = (seqId: number): Filing => ({
  seqId,
  symbol: 'TEST',
  isin: 'INE000000001',
  companyName: 'Test Ltd',
  industry: 'Testing',
  category: 'Bagging/Receiving of orders/contracts',
  summary: `Order number ${seqId}`,
  attachmentUrl: null,
  announcedAt: new Date('2026-08-05T04:58:17.000Z'),
  disseminatedAt: new Date('2026-08-05T04:58:18.000Z'),
  ingestedAt: new Date('2026-08-05T04:58:19.000Z'),
});

let mongo: MongoMemoryServer;
let model: Model<FilingDocument>;
let repo: FilingRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  model = mongoose.model<FilingDocument>('Filing', FilingSchema);
  await model.syncIndexes();
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await model.deleteMany({});
  repo = new FilingRepository(model);
});

/** seqIds actually persisted, ascending. The ground truth every test checks. */
const storedSeqIds = async (): Promise<number[]> => {
  const docs = await model.find({}, { seqId: 1 }).lean().exec();
  return docs.map((d) => d.seqId).sort((a, b) => a - b);
};

describe('FilingRepository', () => {
  it('inserts new filings and returns them', async () => {
    const inserted = await repo.insertNew([makeFiling(10), makeFiling(20)]);

    expect(inserted.map((f) => f.seqId).sort()).toEqual([10, 20]);
    expect(await model.countDocuments()).toBe(2);
  });

  it('returns only genuinely new filings on a second call', async () => {
    await repo.insertNew([makeFiling(10), makeFiling(20)]);

    const second = await repo.insertNew([makeFiling(20), makeFiling(30)]);

    expect(second.map((f) => f.seqId)).toEqual([30]);
    expect(await model.countDocuments()).toBe(3);
  });

  it('is idempotent — re-inserting the same batch yields nothing new', async () => {
    const batch = [makeFiling(10), makeFiling(20)];
    await repo.insertNew(batch);

    expect(await repo.insertNew(batch)).toEqual([]);
    expect(await model.countDocuments()).toBe(2);
  });

  it('getMaxSeqId returns null on an empty collection', async () => {
    expect(await repo.getMaxSeqId()).toBeNull();
  });

  it('getMaxSeqId returns the highest seqId', async () => {
    await repo.insertNew([makeFiling(10), makeFiling(500), makeFiling(200)]);

    expect(await repo.getMaxSeqId()).toBe(500);
  });

  it('handles an empty batch without touching the database', async () => {
    expect(await repo.insertNew([])).toEqual([]);
  });

  it('enforces uniqueness on seqId at the index level', async () => {
    const indexes = await model.collection.indexes();
    const seqIndex = indexes.find((i) => i.key?.seqId !== undefined);

    expect(seqIndex?.unique).toBe(true);
  });
});

/**
 * The return value of insertNew is the alert gate: Task 11 alerts on exactly
 * what comes back, so "which rows came back" is a correctness property, not a
 * count. Every case below asserts the returned seqIds AND the seqIds that
 * actually reached the database, so a wrong-but-same-length answer fails.
 */
describe('FilingRepository.insertNew: batch composition', () => {
  interface BatchCase {
    readonly label: string;
    /** Persisted by a first call, before the batch under test. */
    readonly preexisting: readonly number[];
    readonly batch: readonly number[];
    /** Expected return, in input order. */
    readonly expectedNew: readonly number[];
    /** Expected collection contents afterwards, ascending. */
    readonly expectedStored: readonly number[];
  }

  const CASES: readonly BatchCase[] = [
    {
      label: 'all new',
      preexisting: [],
      batch: [10, 20, 30],
      expectedNew: [10, 20, 30],
      expectedStored: [10, 20, 30],
    },
    {
      label: 'all duplicate',
      preexisting: [10, 20],
      batch: [10, 20],
      expectedNew: [],
      expectedStored: [10, 20],
    },
    {
      label: 'mixed — new, known, new',
      preexisting: [20],
      batch: [10, 20, 30],
      expectedNew: [10, 30],
      expectedStored: [10, 20, 30],
    },
    {
      label: 'mixed — the known row is first',
      preexisting: [10],
      batch: [10, 20],
      expectedNew: [20],
      expectedStored: [10, 20],
    },
    {
      label: 'mixed — the known row is last',
      preexisting: [20],
      batch: [10, 20],
      expectedNew: [10],
      expectedStored: [10, 20],
    },
    {
      label: 'empty batch',
      preexisting: [10],
      batch: [],
      expectedNew: [],
      expectedStored: [10],
    },
    {
      label: 'single new row',
      preexisting: [],
      batch: [10],
      expectedNew: [10],
      expectedStored: [10],
    },
    {
      label: 'single duplicate row',
      preexisting: [10],
      batch: [10],
      expectedNew: [],
      expectedStored: [10],
    },
    {
      label: 'internal duplicate — same seqId twice in one call',
      preexisting: [],
      batch: [10, 10, 20],
      expectedNew: [10, 20],
      expectedStored: [10, 20],
    },
    {
      label: 'internal duplicate of a row already stored',
      preexisting: [10],
      batch: [10, 10, 20],
      expectedNew: [20],
      expectedStored: [10, 20],
    },
    {
      label: 'internal duplicate only, nothing else new',
      preexisting: [],
      batch: [10, 10],
      expectedNew: [10],
      expectedStored: [10],
    },
    {
      label: 'seqId 0 is an ordinary row, not an absent one',
      preexisting: [],
      batch: [0, 1],
      expectedNew: [0, 1],
      expectedStored: [0, 1],
    },
    {
      label: 'seqId 0 already stored is a duplicate like any other',
      preexisting: [0],
      batch: [0, 1],
      expectedNew: [1],
      expectedStored: [0, 1],
    },
  ];

  it.each(CASES)(
    'returns exactly the newly written rows: $label',
    async ({ preexisting, batch, expectedNew, expectedStored }: BatchCase) => {
      if (preexisting.length > 0) {
        await repo.insertNew(preexisting.map(makeFiling));
      }

      const returned = await repo.insertNew(batch.map(makeFiling));

      expect(returned.map((f) => f.seqId)).toEqual([...expectedNew]);
      expect(await storedSeqIds()).toEqual([...expectedStored]);
    },
  );

  it.each(CASES)(
    'never returns a row that is absent from the database: $label',
    async ({ preexisting, batch }: BatchCase) => {
      if (preexisting.length > 0) {
        await repo.insertNew(preexisting.map(makeFiling));
      }

      const returned = await repo.insertNew(batch.map(makeFiling));
      const stored = await storedSeqIds();

      expect(returned.filter((f) => !stored.includes(f.seqId))).toEqual([]);
    },
  );

  it.each(CASES)(
    'a repeat of the same batch returns nothing new: $label',
    async ({ preexisting, batch, expectedStored }: BatchCase) => {
      if (preexisting.length > 0) {
        await repo.insertNew(preexisting.map(makeFiling));
      }
      await repo.insertNew(batch.map(makeFiling));

      // A restart replays the batch. Nothing may come back, or the alerter
      // would fire a second time on filings we already had.
      expect(await repo.insertNew(batch.map(makeFiling))).toEqual([]);
      expect(await storedSeqIds()).toEqual([...expectedStored]);
    },
  );
});

describe('FilingRepository.insertNew: returned rows are the rows written', () => {
  it('returns the field values of the filings it wrote, not just their ids', async () => {
    const batch = [makeFiling(10), makeFiling(20)];

    const returned = await repo.insertNew(batch);

    expect(returned).toEqual(batch);
  });

  it('leaves an existing row untouched and does not return it', async () => {
    const original = { ...makeFiling(20), summary: 'first version' };
    await repo.insertNew([original]);

    const returned = await repo.insertNew([
      { ...makeFiling(20), summary: 'REWRITTEN' },
      makeFiling(30),
    ]);

    // insertNew is insert-only: a second sighting of seqId 20 must neither
    // overwrite the stored row nor re-enter the alert path.
    expect(returned.map((f) => f.seqId)).toEqual([30]);
    const stored = await model.findOne({ seqId: 20 }).lean().exec();
    expect(stored?.summary).toBe('first version');
  });

  it('returns the copy that won when one batch carries the same seqId twice', async () => {
    const first = { ...makeFiling(10), summary: 'copy A' };
    const second = { ...makeFiling(10), summary: 'copy B' };

    const returned = await repo.insertNew([first, second]);

    const stored = await model.findOne({ seqId: 10 }).lean().exec();
    expect(returned).toHaveLength(1);
    expect(returned[0].summary).toBe(stored?.summary);
    expect(returned[0]).toEqual(first);
  });

  it('returns the same shape whether or not the batch hit a duplicate', async () => {
    const allNew = await repo.insertNew([makeFiling(10)]);
    const partial = await repo.insertNew([makeFiling(10), makeFiling(20)]);

    // A caller cannot branch on how the write went; both paths must hand back
    // plain Filing objects with identical keys.
    expect(Object.keys(partial[0]).sort()).toEqual(
      Object.keys(allNew[0]).sort(),
    );
    expect(Object.keys(allNew[0]).sort()).toEqual(
      Object.keys(makeFiling(1)).sort(),
    );
  });

  it('round-trips every field through the schema without loss', async () => {
    const filing: Filing = {
      ...makeFiling(42),
      industry: null,
      attachmentUrl: 'https://nsearchives.nseindia.com/corporate/x.pdf',
      summary: 'Order worth Rs 250 crore',
    };

    await repo.insertNew([filing]);

    const stored = await model.findOne({ seqId: 42 }).lean().exec();
    expect(stored).toMatchObject({
      seqId: 42,
      symbol: 'TEST',
      isin: 'INE000000001',
      companyName: 'Test Ltd',
      industry: null,
      category: 'Bagging/Receiving of orders/contracts',
      summary: 'Order worth Rs 250 crore',
      attachmentUrl: 'https://nsearchives.nseindia.com/corporate/x.pdf',
      announcedAt: filing.announcedAt,
      disseminatedAt: filing.disseminatedAt,
      ingestedAt: filing.ingestedAt,
    });
  });
});

/**
 * getMaxSeqId is the persisted cursor the poller resumes from. Returning null
 * where a number belongs makes the poller cold-start and re-drain the day;
 * returning a number where null belongs makes it skip the day's filings.
 */
describe('FilingRepository.getMaxSeqId: the persisted cursor', () => {
  it('returns 0, not null, when the only stored seqId is 0', async () => {
    // 0 is falsy. A `?? null` written as `|| null` here, or a truthiness check
    // in the caller, turns a real cursor into "no cursor" and re-drains the
    // whole day on every poll, forever.
    await repo.insertNew([makeFiling(0)]);

    const cursor = await repo.getMaxSeqId();

    expect(cursor).toBe(0);
    expect(cursor).not.toBeNull();
  });

  it('distinguishes a stored 0 from an empty collection', async () => {
    expect(await repo.getMaxSeqId()).toBeNull();

    await repo.insertNew([makeFiling(0)]);

    expect(await repo.getMaxSeqId()).toBe(0);
  });

  it.each([
    { label: 'ascending inserts', seqIds: [1, 2, 3], expected: 3 },
    { label: 'descending inserts', seqIds: [3, 2, 1], expected: 3 },
    { label: 'unordered inserts', seqIds: [2, 9, 5, 1], expected: 9 },
    { label: 'a single row', seqIds: [7], expected: 7 },
    {
      label: 'a realistic NSE id',
      seqIds: [106725492, 106725630],
      expected: 106725630,
    },
    {
      label: 'a negative sentinel below real ids',
      seqIds: [-1, 4],
      expected: 4,
    },
    { label: 'only a negative id', seqIds: [-1], expected: -1 },
  ])('returns the maximum: $label', async ({ seqIds, expected }) => {
    await repo.insertNew(seqIds.map(makeFiling));

    expect(await repo.getMaxSeqId()).toBe(expected);
  });

  it('compares numerically, not lexicographically', async () => {
    // 9 sorts after 10 as a string. A string index or a lexicographic sort
    // would park the cursor at 9 and re-alert everything above it.
    await repo.insertNew([makeFiling(9), makeFiling(10), makeFiling(100)]);

    expect(await repo.getMaxSeqId()).toBe(100);
  });

  it('advances only as far as the rows that were actually written', async () => {
    await repo.insertNew([makeFiling(10)]);
    await repo.insertNew([makeFiling(10), makeFiling(50)]);

    expect(await repo.getMaxSeqId()).toBe(50);
  });
});

/**
 * The system's promise is that it never silently loses a filing. Anything that
 * is not a clean, fully-accounted duplicate rejection must reach the caller as
 * a thrown error — never as "nothing new", which is indistinguishable from a
 * quiet poll and would bury the incident.
 */
describe('FilingRepository.insertNew: failures are never reported as "nothing new"', () => {
  it('rethrows a cast failure instead of reporting an empty batch', async () => {
    // NaN is a `number` to the type system, so this is reachable without any
    // cast. Mongoose drops such a document client-side and, by default,
    // resolves as though nothing had happened.
    //
    // The error must also name the field that failed. An operator reading it
    // has to know WHICH filing to go and look at; a generic "the batch was
    // short" tells them a filing was lost but not which one.
    await expect(repo.insertNew([makeFiling(NaN)])).rejects.toThrow(/seqId/);
    expect(await storedSeqIds()).toEqual([]);
  });

  it('rethrows a validation failure rather than dropping the row in silence', async () => {
    // An empty symbol is a valid `Filing` to the type system but fails the
    // schema's `required`. Without an explicit throw, this filing disappears
    // with no error, no alert and no trace — the exact loss this system
    // promises never to have.
    const invalid: Filing = { ...makeFiling(20), symbol: '' };

    await expect(repo.insertNew([invalid])).rejects.toThrow(/symbol/);
    expect(await storedSeqIds()).toEqual([]);
  });

  it('rethrows when an invalid row travels with valid ones', async () => {
    const invalid: Filing = { ...makeFiling(20), symbol: '' };

    await expect(
      repo.insertNew([makeFiling(10), invalid, makeFiling(30)]),
    ).rejects.toThrow(/symbol/);

    // Mongoose writes the valid documents before it reports the failure, so
    // the survivors are persisted. They are deliberately NOT returned: the
    // caller is told the batch failed rather than being handed a partial
    // answer it would mistake for the whole one.
    expect(await storedSeqIds()).toEqual([10, 30]);
  });

  it('rethrows when a duplicate and an invalid row share a batch', async () => {
    // The dangerous shape. Mongoose drops the invalid document before the write
    // and reports no per-row error for it, so it appears in neither the write
    // errors nor the inserted docs. Taking the complement of the write errors
    // would therefore return a row that was never written: measured against
    // real Mongo, this batch yields seqIds 20 and 30 while only 10 and 30 are
    // stored — an alert announcing filing 20, which does not exist in the
    // database at all. The accounting check is what catches it.
    await repo.insertNew([makeFiling(10)]);
    const invalid: Filing = { ...makeFiling(20), symbol: '' };

    await expect(
      repo.insertNew([invalid, makeFiling(10), makeFiling(30)]),
    ).rejects.toThrow();

    expect(await storedSeqIds()).toEqual([10, 30]);
  });

  it('propagates a connection failure', async () => {
    // A model on a connection that was never opened, which is the error path a
    // connection dropped mid-poll takes: mongoose buffers the write and then
    // rejects. The buffer window is shortened here purely to keep the suite
    // quick — mongoose's default is ten seconds.
    //
    // Note for anyone tempted to use bufferCommands:false instead: mongoose
    // then throws out of band and the insertMany promise never settles at all.
    const detachedSchema = FilingSchema.clone();
    detachedSchema.set('bufferTimeoutMS', 250);
    const disconnected = new FilingRepository(
      mongoose
        .createConnection()
        .model<FilingDocument>('Detached', detachedSchema),
    );

    await expect(
      disconnected.insertNew([makeFiling(10)]),
    ).rejects.toBeInstanceOf(Error);
  });
});

/**
 * Guards over error shapes the live driver does not currently produce. Each one
 * is a way the "which rows were written" answer could silently become wrong;
 * the repository must refuse to guess and rethrow instead.
 */
describe('FilingRepository.insertNew: refuses to guess under unfamiliar errors', () => {
  const DUPLICATE_KEY = 11000;

  const stubModel = (
    insertMany: () => Promise<unknown>,
  ): Model<FilingDocument> =>
    ({ insertMany }) as unknown as Model<FilingDocument>;

  const rejectingWith = (error: unknown): Model<FilingDocument> =>
    stubModel(() => Promise.reject(error));

  const bulkError = (props: Record<string, unknown>): Error =>
    Object.assign(new Error('E11000 duplicate key error'), props);

  it('rethrows a duplicate error that carries no per-row write errors', async () => {
    // Without write errors there is nothing to say WHICH row collided, so the
    // complement is unknowable. Assuming "everything was inserted" here would
    // re-alert an entire batch we already had.
    const repoStub = new FilingRepository(
      rejectingWith(bulkError({ code: DUPLICATE_KEY, insertedDocs: [] })),
    );

    await expect(
      repoStub.insertNew([makeFiling(10), makeFiling(20)]),
    ).rejects.toThrow();
  });

  it('rethrows an error whose report explains nothing that failed', async () => {
    // The report says every row went in, yet an error was raised anyway — a
    // write-concern failure has this shape. There is no per-row rejection to
    // interpret, so "all of them are new" is a guess. Vacuous truth makes this
    // the easy case to get wrong: `[].every(isDuplicate)` is true.
    const repoStub = new FilingRepository(
      rejectingWith(
        bulkError({
          code: DUPLICATE_KEY,
          writeErrors: [],
          insertedDocs: [{ seqId: 10 }, { seqId: 20 }],
        }),
      ),
    );

    await expect(
      repoStub.insertNew([makeFiling(10), makeFiling(20)]),
    ).rejects.toThrow();
  });

  it('rethrows when a write error is not a duplicate-key error', async () => {
    // One row failed for a reason of its own. Quietly excluding it from the
    // return would lose that filing with no error anywhere.
    const repoStub = new FilingRepository(
      rejectingWith(
        bulkError({
          code: DUPLICATE_KEY,
          writeErrors: [
            { index: 0, err: { index: 0, code: DUPLICATE_KEY } },
            { index: 1, err: { index: 1, code: 2 } },
          ],
          insertedDocs: [],
        }),
      ),
    );

    await expect(
      repoStub.insertNew([makeFiling(10), makeFiling(20)]),
    ).rejects.toThrow();
  });

  it('rethrows when inserted and failed rows do not account for the batch', async () => {
    // 1 inserted + 1 duplicate = 2, but three filings went in. The missing one
    // vanished without an error of its own; that must not pass as success.
    const repoStub = new FilingRepository(
      rejectingWith(
        bulkError({
          code: DUPLICATE_KEY,
          writeErrors: [{ index: 0, err: { index: 0, code: DUPLICATE_KEY } }],
          insertedDocs: [{ seqId: 30 }],
        }),
      ),
    );

    await expect(
      repoStub.insertNew([makeFiling(10), makeFiling(20), makeFiling(30)]),
    ).rejects.toThrow();
  });

  it('rethrows when an inserted row is not one of the filings submitted', async () => {
    // DO NOT DELETE AS REDUNDANT. This is the only possible pin for two
    // mutations: reverting to the brief's write-error-index complement, and
    // dropping the check that every written row was matched. No real-Mongo
    // case can distinguish them — whenever mongoose filters a row out, the
    // accounting check throws first, and whenever it filters nothing out,
    // mongoose's index remap is the identity and index-matching and
    // seqId-matching provably agree. Only a hand-built error reaches here.
    const repoStub = new FilingRepository(
      rejectingWith(
        bulkError({
          code: DUPLICATE_KEY,
          writeErrors: [{ index: 0, err: { index: 0, code: DUPLICATE_KEY } }],
          insertedDocs: [{ seqId: 999 }],
        }),
      ),
    );

    await expect(
      repoStub.insertNew([makeFiling(10), makeFiling(20)]),
    ).rejects.toThrow();
  });

  it('does not infer a row error code from the batch-level code', async () => {
    // The row failed, but its own report carries no code. The batch-level
    // 11000 belongs to some OTHER row, so reading it here would file this row
    // under "duplicate" and quietly drop it from the result — losing whatever
    // actually went wrong with it. Accounting adds up, so only the code chain
    // can catch this.
    const repoStub = new FilingRepository(
      rejectingWith(
        bulkError({
          code: DUPLICATE_KEY,
          writeErrors: [{ index: 0, err: { index: 0 } }],
          insertedDocs: [{ seqId: 20 }],
        }),
      ),
    );

    await expect(
      repoStub.insertNew([makeFiling(10), makeFiling(20)]),
    ).rejects.toThrow();
  });

  it('rethrows a plain error with no bulk-write information at all', async () => {
    const repoStub = new FilingRepository(
      rejectingWith(new Error('connection reset by peer')),
    );

    await expect(repoStub.insertNew([makeFiling(10)])).rejects.toThrow(
      'connection reset by peer',
    );
  });

  it('throws when a silent insertMany returns fewer documents than submitted', async () => {
    // The failure mode mongoose exhibits by default: invalid documents are
    // dropped and the promise resolves. Counting is the backstop that keeps a
    // dropped filing from being reported as a successful batch.
    const repoStub = new FilingRepository(
      stubModel(() => Promise.resolve([{ seqId: 10 }])),
    );

    await expect(
      repoStub.insertNew([makeFiling(10), makeFiling(20)]),
    ).rejects.toThrow(/2/);
  });

  it('does not go near the database for an empty batch', async () => {
    const exploding = new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(`database touched: ${String(property)}`);
        },
      },
    ) as Model<FilingDocument>;

    await expect(
      new FilingRepository(exploding).insertNew([]),
    ).resolves.toEqual([]);
  });
});

/**
 * insertNew delegates the entire new-versus-seen decision to the database's
 * unique index. The existing "enforces uniqueness on seqId at the index level"
 * test proves the SCHEMA declares that index; it says nothing about whether the
 * running database has built it. Nothing in production wiring calls
 * syncIndexes(), and mongoose's autoIndex default is routinely turned off in
 * production, so this precondition can be absent at runtime with no warning.
 */
describe('FilingRepository.assertIndexes: the unique index is a precondition', () => {
  /** A model whose collection is never given the unique index. */
  const looseModel = (collection: string): Model<FilingDocument> => {
    const schema = FilingSchema.clone();
    schema.set('autoIndex', false);
    return mongoose.model<FilingDocument>(collection, schema, collection);
  };

  it('resolves when the collection carries the unique index', async () => {
    await expect(repo.assertIndexes()).resolves.toBeUndefined();
  });

  it('throws when the collection has no unique index on seqId', async () => {
    const loose = looseModel('filings_no_index');
    await loose.collection.insertOne({ seqId: 1 });

    await expect(new FilingRepository(loose).assertIndexes()).rejects.toThrow(
      /seqId/,
    );
  });

  it('names the consequence, not just the missing index', async () => {
    const loose = looseModel('filings_no_index_message');
    await loose.collection.insertOne({ seqId: 1 });

    // Whoever reads this at startup needs to know why it matters, not merely
    // that an index is absent.
    await expect(new FilingRepository(loose).assertIndexes()).rejects.toThrow(
      /unique/i,
    );
  });

  it('rejects a non-unique index on seqId', async () => {
    const loose = looseModel('filings_plain_index');
    await loose.collection.insertOne({ seqId: 1 });
    await loose.collection.createIndex({ seqId: 1 });

    // An index makes the query fast; only uniqueness makes insertNew correct.
    await expect(new FilingRepository(loose).assertIndexes()).rejects.toThrow(
      /seqId/,
    );
  });

  it('rejects a compound unique index that only includes seqId', async () => {
    const loose = looseModel('filings_compound_index');
    await loose.collection.insertOne({ seqId: 1 });
    await loose.collection.createIndex(
      { seqId: 1, symbol: 1 },
      { unique: true },
    );

    // Uniqueness of the PAIR permits the same seqId twice under two symbols,
    // which is precisely the duplicate insertNew must never be handed.
    await expect(new FilingRepository(loose).assertIndexes()).rejects.toThrow(
      /seqId/,
    );
  });

  it('throws when the collection does not exist yet', async () => {
    const loose = looseModel('filings_never_created');

    // A fresh deployment is exactly when this guard earns its keep.
    await expect(new FilingRepository(loose).assertIndexes()).rejects.toThrow(
      /seqId/,
    );
  });

  it('does not create the missing index behind the operator back', async () => {
    const loose = looseModel('filings_not_created_for_me');
    await loose.collection.insertOne({ seqId: 1 });

    await expect(new FilingRepository(loose).assertIndexes()).rejects.toThrow();

    const indexes = await loose.collection.indexes();
    expect(indexes.filter((i) => i.key?.seqId !== undefined)).toEqual([]);
  });

  it('is what stands between a missing index and a re-alert of the whole day', async () => {
    // The teeth behind the precondition. Without the unique index the database
    // accepts the same filing twice, so insertNew hands back a row it has
    // already returned once — the restart re-alert this repository exists to
    // prevent. The alert gate inverts silently; nothing throws.
    const loose = looseModel('filings_inverted_gate');
    const looseRepo = new FilingRepository(loose);

    const first = await looseRepo.insertNew([makeFiling(10)]);
    const second = await looseRepo.insertNew([makeFiling(10)]);

    expect(first.map((f) => f.seqId)).toEqual([10]);
    expect(second.map((f) => f.seqId)).toEqual([10]);
    expect(await loose.countDocuments()).toBe(2);

    // assertIndexes is the only thing that would have caught this at startup.
    await expect(looseRepo.assertIndexes()).rejects.toThrow();
  });
});

describe('FilingRepository.insertNew: immutability', () => {
  it('does not mutate or reorder the caller batch', async () => {
    await repo.insertNew([makeFiling(20)]);
    const batch = [makeFiling(10), makeFiling(20), makeFiling(30)];
    const snapshot = batch.map((f) => ({ ...f }));

    await repo.insertNew(batch);

    expect(batch).toEqual(snapshot);
  });

  it('does not mutate the filings it was handed', async () => {
    const filing = makeFiling(10);
    const snapshot = { ...filing };

    await repo.insertNew([filing]);

    // insertMany must not be allowed to stamp _id or __v onto the caller's
    // object; the alert path formats exactly these fields.
    expect(filing).toEqual(snapshot);
    expect(Object.keys(filing).sort()).toEqual(Object.keys(snapshot).sort());
  });

  it('returns an array the caller can mutate without reaching the batch', async () => {
    const batch = [makeFiling(10)];

    const returned = await repo.insertNew(batch);
    returned.push(makeFiling(99));

    expect(batch).toHaveLength(1);
  });

  it('accepts a readonly, frozen batch', async () => {
    const batch: readonly Filing[] = Object.freeze([
      Object.freeze(makeFiling(10)),
      Object.freeze(makeFiling(20)),
    ]);

    await expect(repo.insertNew(batch)).resolves.toHaveLength(2);
  });
});
