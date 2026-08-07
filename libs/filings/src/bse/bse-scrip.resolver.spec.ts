import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { type Model } from 'mongoose';
import { BseScripResolver, type ScripIsinSource } from './bse-scrip.resolver';
import { BseScripSchema, type BseScrip } from './bse-scrip.schema';

let mongo: MongoMemoryServer;
let model: Model<BseScrip>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  model = mongoose.model<BseScrip>('BseScrip', BseScripSchema);
  await model.syncIndexes();
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await model.deleteMany({});
});

/** Records what it was asked, so a test can assert a request did NOT happen. */
class CountingSource implements ScripIsinSource {
  readonly asked: number[] = [];
  constructor(
    private readonly answers: Readonly<Record<number, string | null>>,
  ) {}
  isinForScrip(scripCode: number): Promise<string | null> {
    this.asked.push(scripCode);
    return Promise.resolve(this.answers[scripCode] ?? null);
  }
}

const resolver = (source: ScripIsinSource) =>
  new BseScripResolver(model, source, 0);

describe('BseScripResolver', () => {
  it('fetches an unknown scrip and answers with its ISIN', async () => {
    const source = new CountingSource({ 500825: 'INE216A01030' });
    const { isins, stats } = await resolver(source).resolve([500825]);

    expect(isins.get(500825)).toBe('INE216A01030');
    expect(stats).toEqual({
      requested: 1,
      cached: 0,
      fetched: 1,
      unresolved: 0,
    });
  });

  it('never asks twice for the same scrip', async () => {
    // THE WHOLE POINT. Two days of announcements span 1,217 companies, which at
    // this codebase's exchange pacing is 16.2 minutes of requests — paid again
    // on every run if the answer is not kept.
    const source = new CountingSource({ 500825: 'INE216A01030' });
    await resolver(source).resolve([500825]);
    const second = await resolver(source).resolve([500825]);

    expect(source.asked).toEqual([500825]);
    expect(second.stats.cached).toBe(1);
    expect(second.stats.fetched).toBe(0);
    expect(second.isins.get(500825)).toBe('INE216A01030');
  });

  it('remembers that a scrip could NOT be resolved', async () => {
    // The half most easily got wrong. A scrip BSE will not answer for is
    // usually delisted or not an equity, not a transient failure — and the
    // unresolvable tail is exactly the set that grows. Not caching the null
    // means re-asking the same question forever and getting the same silence.
    const source = new CountingSource({});
    const first = await resolver(source).resolve([999999]);
    const second = await resolver(source).resolve([999999]);

    expect(first.stats.unresolved).toBe(1);
    expect(source.asked).toEqual([999999]);
    expect(second.stats.fetched).toBe(0);
    expect(second.isins.get(999999)).toBeNull();
  });

  it('distinguishes "asked, no answer" from "never asked"', async () => {
    const source = new CountingSource({});
    const { isins } = await resolver(source).resolve([999999]);

    // Present in the map, with a null value.
    expect(isins.has(999999)).toBe(true);
    expect(isins.get(999999)).toBeNull();
    expect(isins.has(123456)).toBe(false);
  });

  it('fetches only what is missing from a mixed batch', async () => {
    const source = new CountingSource({
      500825: 'INE216A01030',
      500257: 'INE326A01037',
    });
    await resolver(source).resolve([500825]);
    const { stats } = await resolver(source).resolve([500825, 500257]);

    expect(stats).toEqual({
      requested: 2,
      cached: 1,
      fetched: 1,
      unresolved: 0,
    });
    expect(source.asked).toEqual([500825, 500257]);
  });

  it('deduplicates a repeated scrip within one call', async () => {
    // A company files a dozen times a day; the codes arrive once per
    // announcement, not once per company.
    const source = new CountingSource({ 500825: 'INE216A01030' });
    const { stats } = await resolver(source).resolve([500825, 500825, 500825]);

    expect(source.asked).toEqual([500825]);
    expect(stats.requested).toBe(1);
  });

  it('keeps answers already paid for when a pass is interrupted', async () => {
    // A pass over a thousand companies runs for minutes. Writing at the end
    // would throw away every answer bought before the interruption.
    const exploding: ScripIsinSource = {
      isinForScrip: (code) =>
        code === 2
          ? Promise.reject(new Error('network died'))
          : Promise.resolve('INE216A01030'),
    };

    await expect(resolver(exploding).resolve([1, 2, 3])).rejects.toThrow(
      'network died',
    );

    const kept = await model.find({}).lean().exec();
    expect(kept.map((row) => row.scripCode)).toEqual([1]);
  });

  it('reports progress so a long pass is not silent', async () => {
    const source = new CountingSource({ 1: 'INE216A01030', 2: null });
    const seen: string[] = [];
    await resolver(source).resolve([1, 2], (done, total) =>
      seen.push(`${done}/${total}`),
    );
    expect(seen).toEqual(['1/2', '2/2']);
  });

  it('answers every requested code, cached or not', async () => {
    const source = new CountingSource({ 1: 'INE216A01030' });
    const { isins } = await resolver(source).resolve([1, 2, 3]);
    expect([...isins.keys()].sort()).toEqual([1, 2, 3]);
  });
});
