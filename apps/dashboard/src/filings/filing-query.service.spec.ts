import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { FilingSchema, type Filing, type FilingDocument } from '@app/filings';
import { FilingQueryService } from './filing-query.service';

/**
 * Same harness as `libs/filings/src/persistence/filing.repository.spec.ts`: a
 * real mongod, because half of what this service does is expressed as an
 * aggregation pipeline and a mocked model would only assert that the pipeline
 * is the one we wrote, never that it computes the right answer.
 */

interface FilingOverrides {
  readonly symbol?: string;
  readonly category?: string;
  readonly disseminatedAt?: Date;
  readonly ingestedAt?: Date;
  readonly attachmentUrl?: string | null;
  readonly industry?: string | null;
}

const makeFiling = (seqId: number, overrides: FilingOverrides = {}): Filing => {
  const disseminatedAt =
    overrides.disseminatedAt ?? new Date('2026-08-05T04:58:18.000Z');

  return {
    seqId,
    symbol: overrides.symbol ?? 'TEST',
    isin: 'INE000000001',
    companyName: 'Test Ltd',
    industry: overrides.industry === undefined ? 'Testing' : overrides.industry,
    category: overrides.category ?? 'General Updates',
    summary: `Order number ${seqId}`,
    attachmentUrl:
      overrides.attachmentUrl === undefined ? null : overrides.attachmentUrl,
    announcedAt: new Date(disseminatedAt.getTime() - 1_000),
    disseminatedAt,
    ingestedAt:
      overrides.ingestedAt ?? new Date(disseminatedAt.getTime() + 6_000),
  };
};

let mongo: MongoMemoryServer;
let model: Model<FilingDocument>;
let service: FilingQueryService;
let now: Date;

/** Every test drives the clock; nothing here reads the real one. */
const clock = (): Date => now;

const seed = async (filings: readonly Filing[]): Promise<void> => {
  await model.insertMany(filings);
};

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
  now = new Date('2026-08-05T12:00:00.000Z');
  service = new FilingQueryService(model, clock);
});

describe('FilingQueryService — empty database', () => {
  it('reports zero totals and null cursors rather than throwing', async () => {
    const summary = await service.getSummary();

    expect(summary.totalFilings).toBe(0);
    expect(summary.todayCount).toBe(0);
    expect(summary.maxSeqId).toBeNull();
    expect(summary.newestDisseminatedAt).toBeNull();
    expect(summary.newestDisseminatedAtIst).toBeNull();
  });

  it('reports a null feed lag, not a lag of zero', async () => {
    // "Nothing has ever arrived" and "a filing arrived this instant" are
    // opposite states. A zero here would render as a perfectly healthy feed.
    expect((await service.getSummary()).feedLagMs).toBeNull();
  });

  it('still reports the IST day it counted and when it counted it', async () => {
    const summary = await service.getSummary();

    expect(summary.todayIstDay).toBe('2026-08-05');
    expect(summary.generatedAtIst).toBe('2026-08-05 17:30:00');
  });

  it('returns an empty page with consistent metadata', async () => {
    const page = await service.getRecent({ limit: 25, offset: 0 });

    expect(page.items).toEqual([]);
    expect(page.meta).toEqual({
      total: 0,
      limit: 25,
      offset: 0,
      returned: 0,
      hasMore: false,
    });
  });

  it('returns no categories', async () => {
    expect(await service.getCategories(40)).toEqual([]);
  });

  it('returns a zero-filled day series rather than nothing at all', async () => {
    // The whole point of the series is showing the days that are empty.
    expect(await service.getDaily(3)).toEqual([
      { istDay: '2026-08-03', count: 0 },
      { istDay: '2026-08-04', count: 0 },
      { istDay: '2026-08-05', count: 0 },
    ]);
  });
});

describe('FilingQueryService — IST day bucketing at the 18:30 UTC boundary', () => {
  const LAST_MOMENT_OF_THE_5TH = new Date('2026-08-05T18:29:59.999Z');
  const FIRST_MOMENT_OF_THE_6TH = new Date('2026-08-05T18:30:00.000Z');

  beforeEach(async () => {
    await seed([
      makeFiling(1, { disseminatedAt: LAST_MOMENT_OF_THE_5TH }),
      makeFiling(2, { disseminatedAt: FIRST_MOMENT_OF_THE_6TH }),
    ]);
  });

  it('splits two filings one millisecond apart onto different IST days', async () => {
    // Both are the 5th in UTC. A UTC-day bucketing puts them together and the
    // 6th silently loses its first filing.
    now = new Date('2026-08-06T10:00:00.000Z');

    expect(await service.getDaily(2)).toEqual([
      { istDay: '2026-08-05', count: 1 },
      { istDay: '2026-08-06', count: 1 },
    ]);
  });

  it('counts the 18:29:59.999Z filing as today when now is inside the 5th IST', async () => {
    now = new Date('2026-08-05T18:00:00.000Z');

    const summary = await service.getSummary();

    expect(summary.todayIstDay).toBe('2026-08-05');
    expect(summary.todayCount).toBe(1);
  });

  it('counts the 18:30:00.000Z filing as today the instant the IST day rolls', async () => {
    now = new Date('2026-08-05T18:30:00.000Z');

    const summary = await service.getSummary();

    expect(summary.todayIstDay).toBe('2026-08-06');
    expect(summary.todayCount).toBe(1);
  });

  it('names the day before, so the feed can say Yesterday without a clock', async () => {
    // The pair the browser compares each filing's `istDay` against. It rolls at
    // the same instant `todayIstDay` does — a page that got a stale predecessor
    // would file today's cards under 'Yesterday' for one poll.
    now = new Date('2026-08-05T18:29:59.999Z');
    expect((await service.getSummary()).previousIstDay).toBe('2026-08-04');

    now = new Date('2026-08-05T18:30:00.000Z');
    expect((await service.getSummary()).previousIstDay).toBe('2026-08-05');
  });

  it('crosses a month end rather than subtracting from the day number', async () => {
    // `${month}-${day - 1}` is the bug this guards: on the 1st it produces a
    // day zero, which matches no filing and puts every card under a date.
    now = new Date('2026-09-01T05:00:00.000Z');

    const summary = await service.getSummary();

    expect(summary.todayIstDay).toBe('2026-09-01');
    expect(summary.previousIstDay).toBe('2026-08-31');
  });

  it('excludes a filing dated into the future from today, rather than inflating it', async () => {
    // Today's count is what an operator reads to decide whether ingestion is
    // alive, so it is bounded at both ends. An open-ended $gte would fold a
    // clock-skewed record into it.
    await seed([
      makeFiling(3, { disseminatedAt: new Date('2026-08-09T05:00:00.000Z') }),
    ]);
    now = new Date('2026-08-05T18:00:00.000Z');

    expect((await service.getSummary()).todayCount).toBe(1);
  });

  it('renders the newest dissemination in IST, not UTC', async () => {
    const summary = await service.getSummary();

    expect(summary.newestDisseminatedAt).toBe('2026-08-05T18:30:00.000Z');
    expect(summary.newestDisseminatedAtIst).toBe('2026-08-06 00:00:00');
  });

  it('buckets a whole 24h IST day into exactly one bucket', async () => {
    await model.deleteMany({});
    await seed([
      makeFiling(10, { disseminatedAt: new Date('2026-08-05T18:30:00.000Z') }),
      makeFiling(11, { disseminatedAt: new Date('2026-08-06T00:00:00.000Z') }),
      makeFiling(12, { disseminatedAt: new Date('2026-08-06T18:29:59.999Z') }),
    ]);
    now = new Date('2026-08-06T10:00:00.000Z');

    expect(await service.getDaily(1)).toEqual([
      { istDay: '2026-08-06', count: 3 },
    ]);
  });

  it('leaves a dead day visible as a zero between two live ones', async () => {
    await model.deleteMany({});
    await seed([
      makeFiling(20, { disseminatedAt: new Date('2026-08-03T06:00:00.000Z') }),
      makeFiling(21, { disseminatedAt: new Date('2026-08-05T06:00:00.000Z') }),
    ]);

    expect(await service.getDaily(3)).toEqual([
      { istDay: '2026-08-03', count: 1 },
      { istDay: '2026-08-04', count: 0 },
      { istDay: '2026-08-05', count: 1 },
    ]);
  });

  it('does not count filings older than the requested window', async () => {
    await model.deleteMany({});
    await seed([
      makeFiling(30, { disseminatedAt: new Date('2026-07-01T06:00:00.000Z') }),
      makeFiling(31, { disseminatedAt: new Date('2026-08-05T06:00:00.000Z') }),
    ]);

    const series = await service.getDaily(2);

    expect(series).toEqual([
      { istDay: '2026-08-04', count: 0 },
      { istDay: '2026-08-05', count: 1 },
    ]);
  });

  it('rejects a day count that is not a whole number instead of returning nothing', async () => {
    await expect(service.getDaily(Number.NaN)).rejects.toThrow(/whole number/);
  });
});

describe('FilingQueryService — summary cursors', () => {
  it('reports the highest seqId, which is not the newest record', async () => {
    // NSE disseminates out of seq_id order, so these are genuinely different
    // rows. The cursor the poller resumes from is the id, not the timestamp.
    await seed([
      makeFiling(900, { disseminatedAt: new Date('2026-08-05T06:00:00.000Z') }),
      makeFiling(100, { disseminatedAt: new Date('2026-08-05T07:00:00.000Z') }),
    ]);

    const summary = await service.getSummary();

    expect(summary.maxSeqId).toBe(900);
    expect(summary.newestDisseminatedAt).toBe('2026-08-05T07:00:00.000Z');
  });

  it('measures feed lag from now to the newest dissemination', async () => {
    await seed([
      makeFiling(1, { disseminatedAt: new Date('2026-08-05T11:58:00.000Z') }),
    ]);

    expect((await service.getSummary()).feedLagMs).toBe(120_000);
  });
});

describe('FilingQueryService — pagination', () => {
  const MINUTE = 60_000;
  const BASE = new Date('2026-08-05T06:00:00.000Z').getTime();

  beforeEach(async () => {
    // Ten filings a minute apart; seqId ascends with time.
    await seed(
      Array.from({ length: 10 }, (_unused, index) =>
        makeFiling(index + 1, {
          disseminatedAt: new Date(BASE + index * MINUTE),
        }),
      ),
    );
  });

  it('returns the newest page first', async () => {
    const page = await service.getRecent({ limit: 3, offset: 0 });

    expect(page.items.map((f) => f.seqId)).toEqual([10, 9, 8]);
  });

  it('reports the unpaged total alongside the page', async () => {
    const page = await service.getRecent({ limit: 3, offset: 0 });

    expect(page.meta).toEqual({
      total: 10,
      limit: 3,
      offset: 0,
      returned: 3,
      hasMore: true,
    });
  });

  it('walks the whole collection exactly once across pages', async () => {
    const seen: number[] = [];
    for (let offset = 0; offset < 10; offset += 4) {
      const page = await service.getRecent({ limit: 4, offset });
      seen.push(...page.items.map((f) => f.seqId));
    }

    expect(seen).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('clears hasMore on the last page', async () => {
    const page = await service.getRecent({ limit: 4, offset: 8 });

    expect(page.meta.returned).toBe(2);
    expect(page.meta.hasMore).toBe(false);
  });

  it('returns an empty page past the end without claiming there is more', async () => {
    const page = await service.getRecent({ limit: 5, offset: 50 });

    expect(page.items).toEqual([]);
    expect(page.meta.total).toBe(10);
    expect(page.meta.hasMore).toBe(false);
  });

  it('orders filings sharing a dissemination second by seqId, descending', async () => {
    // NSE stamps to the second and routinely publishes several filings inside
    // one. Without the seqId tiebreak the order among them is undefined, and a
    // row can appear on two pages or on neither.
    await model.deleteMany({});
    const sameSecond = new Date('2026-08-05T06:00:00.000Z');
    await seed([
      makeFiling(41, { disseminatedAt: sameSecond }),
      makeFiling(43, { disseminatedAt: sameSecond }),
      makeFiling(42, { disseminatedAt: sameSecond }),
    ]);

    const first = await service.getRecent({ limit: 2, offset: 0 });
    const second = await service.getRecent({ limit: 2, offset: 2 });

    expect(first.items.map((f) => f.seqId)).toEqual([43, 42]);
    expect(second.items.map((f) => f.seqId)).toEqual([41]);
  });
});

describe('FilingQueryService — filters', () => {
  beforeEach(async () => {
    await seed([
      makeFiling(1, { symbol: 'RELIANCE', category: 'General Updates' }),
      makeFiling(2, { symbol: 'RELIANCE', category: 'Board Meeting' }),
      makeFiling(3, { symbol: 'TCS', category: 'General Updates' }),
      makeFiling(4, { symbol: 'INFY', category: 'Board Meeting' }),
    ]);
  });

  it('filters by symbol', async () => {
    const page = await service.getRecent({
      limit: 25,
      offset: 0,
      symbol: 'RELIANCE',
    });

    expect(page.items.map((f) => f.seqId).sort()).toEqual([1, 2]);
    expect(page.meta.total).toBe(2);
  });

  it('accepts a symbol typed in lower case', async () => {
    const page = await service.getRecent({
      limit: 25,
      offset: 0,
      symbol: 'reliance',
    });

    expect(page.meta.total).toBe(2);
  });

  it('accepts a symbol typed in mixed case', async () => {
    const page = await service.getRecent({
      limit: 25,
      offset: 0,
      symbol: 'ReLiAnCe',
    });

    expect(page.meta.total).toBe(2);
  });

  it('filters by category, matched exactly and not case-folded', async () => {
    const page = await service.getRecent({
      limit: 25,
      offset: 0,
      category: 'Board Meeting',
    });

    expect(page.items.map((f) => f.seqId).sort()).toEqual([2, 4]);
  });

  it('treats a category in the wrong case as no match rather than as all', async () => {
    const page = await service.getRecent({
      limit: 25,
      offset: 0,
      category: 'board meeting',
    });

    expect(page.meta.total).toBe(0);
  });

  it('combines symbol and category', async () => {
    const page = await service.getRecent({
      limit: 25,
      offset: 0,
      symbol: 'RELIANCE',
      category: 'Board Meeting',
    });

    expect(page.items.map((f) => f.seqId)).toEqual([2]);
  });

  it('returns an empty page for a symbol that does not exist', async () => {
    const page = await service.getRecent({
      limit: 25,
      offset: 0,
      symbol: 'NOSUCH',
    });

    expect(page.items).toEqual([]);
    expect(page.meta.total).toBe(0);
  });

  it('paginates the filtered set, not the whole collection', async () => {
    const page = await service.getRecent({
      limit: 1,
      offset: 0,
      symbol: 'RELIANCE',
    });

    expect(page.meta.total).toBe(2);
    expect(page.meta.hasMore).toBe(true);
  });

  it('does not let a filter value smuggle in a Mongo operator', async () => {
    // The service is handed a validated string; this pins that it is used as a
    // VALUE. A filter interpolated as an object would match everything.
    const page = await service.getRecent({
      limit: 25,
      offset: 0,
      symbol: '{"$ne":null}',
    });

    expect(page.meta.total).toBe(0);
  });
});

describe('FilingQueryService — category breakdown', () => {
  beforeEach(async () => {
    await seed([
      makeFiling(1, { category: 'General Updates' }),
      makeFiling(2, { category: 'General Updates' }),
      makeFiling(3, { category: 'General Updates' }),
      makeFiling(4, { category: 'Board Meeting' }),
      makeFiling(5, { category: 'Board Meeting' }),
      makeFiling(6, { category: 'Analysts/Institutional Investor Meet' }),
    ]);
  });

  it('counts each category, largest first', async () => {
    expect(await service.getCategories(40)).toEqual([
      { category: 'General Updates', count: 3 },
      { category: 'Board Meeting', count: 2 },
      { category: 'Analysts/Institutional Investor Meet', count: 1 },
    ]);
  });

  it('caps the breakdown at the requested limit', async () => {
    const rows = await service.getCategories(2);

    expect(rows).toHaveLength(2);
    expect(rows[0].category).toBe('General Updates');
  });

  it('breaks a count tie by name, so the order is stable between polls', async () => {
    // A live page re-renders this list every few seconds. Two categories on the
    // same count swapping places on every poll reads as data changing.
    await model.deleteMany({});
    await seed([
      makeFiling(1, { category: 'Zeta' }),
      makeFiling(2, { category: 'Alpha' }),
    ]);

    expect((await service.getCategories(40)).map((r) => r.category)).toEqual([
      'Alpha',
      'Zeta',
    ]);
  });
});

describe('FilingQueryService — when each watched company last filed', () => {
  beforeEach(async () => {
    await seed([
      makeFiling(1, {
        symbol: 'RELIANCE',
        disseminatedAt: new Date('2026-08-01T04:00:00.000Z'),
      }),
      makeFiling(2, {
        symbol: 'RELIANCE',
        disseminatedAt: new Date('2026-08-04T09:30:00.000Z'),
      }),
      makeFiling(3, {
        symbol: 'TCS',
        disseminatedAt: new Date('2026-07-02T05:15:00.000Z'),
      }),
    ]);
  });

  it('reports the newest filing per symbol, not the newest overall', async () => {
    const last = await service.lastFiledFor(['RELIANCE', 'TCS']);

    expect(last.get('RELIANCE')).toEqual(new Date('2026-08-04T09:30:00.000Z'));
    expect(last.get('TCS')).toEqual(new Date('2026-07-02T05:15:00.000Z'));
  });

  it('omits a symbol nothing is held for rather than dating it now', async () => {
    // "Nothing was found" and "nothing was looked for" must not render the
    // same: an absent key becomes "nothing yet in our window" on the page, and
    // a defaulted date would become a filing that never happened.
    const last = await service.lastFiledFor(['RELIANCE', 'NOSUCHCO']);

    expect(last.has('NOSUCHCO')).toBe(false);
    expect(last.size).toBe(1);
  });

  it('answers an empty symbol list without a read', async () => {
    const spy = jest.spyOn(model, 'aggregate');

    expect((await service.lastFiledFor([])).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});

describe('FilingQueryService — the filing view', () => {
  it('renders every timestamp in IST and keeps the raw instant alongside', async () => {
    await seed([
      makeFiling(7, {
        disseminatedAt: new Date('2026-08-05T04:58:18.000Z'),
        ingestedAt: new Date('2026-08-05T04:58:24.925Z'),
      }),
    ]);

    const [view] = (await service.getRecent({ limit: 1, offset: 0 })).items;

    expect(view.disseminatedAt).toBe('2026-08-05T04:58:18.000Z');
    expect(view.disseminatedAtIst).toBe('2026-08-05 10:28:18');
    expect(view.announcedAtIst).toBe('2026-08-05 10:28:17');
    expect(view.ingestedAtIst).toBe('2026-08-05 10:28:24');
  });

  it('reports pipeline lag as ingestion minus dissemination', async () => {
    await seed([
      makeFiling(7, {
        disseminatedAt: new Date('2026-08-05T04:58:18.000Z'),
        ingestedAt: new Date('2026-08-05T04:58:24.925Z'),
      }),
    ]);

    const [view] = (await service.getRecent({ limit: 1, offset: 0 })).items;

    expect(view.pipelineLagMs).toBe(6_925);
  });

  it('carries the display fields and omits the ones nothing renders', async () => {
    await seed([
      makeFiling(7, {
        symbol: 'RELIANCE',
        attachmentUrl: 'https://nsearchives.nseindia.com/corporate/x.pdf',
      }),
    ]);

    const [view] = (await service.getRecent({ limit: 1, offset: 0 })).items;

    expect(view).toMatchObject({
      seqId: 7,
      symbol: 'RELIANCE',
      companyName: 'Test Ltd',
      industry: 'Testing',
      category: 'General Updates',
      summary: 'Order number 7',
      attachmentUrl: 'https://nsearchives.nseindia.com/corporate/x.pdf',
    });
    expect(Object.keys(view)).not.toContain('_id');
    expect(Object.keys(view)).not.toContain('isin');
  });

  it('passes a null attachment and a null industry through as null', async () => {
    await seed([makeFiling(7, { attachmentUrl: null, industry: null })]);

    const [view] = (await service.getRecent({ limit: 1, offset: 0 })).items;

    expect(view.attachmentUrl).toBeNull();
    expect(view.industry).toBeNull();
    // NEITHER EXCHANGE HAS ONE, which is a third state and not the BSE one.
    expect(view.industrySource).toBeNull();
  });
});

/**
 * Which exchange classified the company.
 *
 * NSE's feed printed an industry for 522 of the 1,289 companies held. BSE's
 * scrip header covers a further 357, on a different vocabulary — so the view
 * has to answer both "what is it" and "who said so", and the second question
 * only exists because the answers to the first are not interchangeable.
 */
describe('FilingQueryService — industry source', () => {
  const firstView = async () =>
    (await service.getRecent({ limit: 1, offset: 0 })).items[0];

  it("marks NSE's own string as NSE's", async () => {
    await seed([makeFiling(7, { industry: 'Computers - Software' })]);

    const view = await firstView();

    expect(view.industry).toBe('Computers - Software');
    expect(view.industrySource).toBe('nse');
  });

  it("falls back to BSE's, and says so", async () => {
    await model.create({
      ...makeFiling(7, { industry: null }),
      bseIndustry: 'Civil Construction',
    });

    const view = await firstView();

    expect(view.industry).toBe('Civil Construction');
    expect(view.industrySource).toBe('bse');
  });

  it("never shows BSE's over NSE's when both are stored", async () => {
    // THE ONE THAT WOULD BE A QUIET EDIT OF THE RECORD. A company whose chip has
    // always read "Airconditioners" must not start reading "Consumer Durables"
    // on the day a BSE lookup ran over it.
    await model.create({
      ...makeFiling(7, { industry: 'Airconditioners' }),
      bseIndustry: 'Consumer Durables',
    });

    const view = await firstView();

    expect(view.industry).toBe('Airconditioners');
    expect(view.industrySource).toBe('nse');
  });

  it('leaves the source null when BSE was asked and had nothing either', async () => {
    // An explicit null means the lookup ran and BSE had no industry; an absent
    // field means no lookup has run. Both draw no chip, and the tool that wrote
    // the null is the only thing that can tell them apart.
    await model.create({
      ...makeFiling(7, { industry: null }),
      bseIndustry: null,
    });

    const view = await firstView();

    expect(view.industry).toBeNull();
    expect(view.industrySource).toBeNull();
  });
});

describe('FilingQueryService — read-only', () => {
  it('leaves the collection untouched after every query it can run', async () => {
    await seed([makeFiling(1), makeFiling(2), makeFiling(3)]);
    const before = await model.find({}, { _id: 0 }).lean().exec();

    await service.getSummary();
    await service.getRecent({ limit: 2, offset: 0, symbol: 'TEST' });
    await service.getCategories(10);
    await service.getDaily(7);

    const after = await model.find({}, { _id: 0 }).lean().exec();
    expect(after).toEqual(before);
    expect(await model.countDocuments()).toBe(3);
  });

  it('uses the real clock when none is injected', async () => {
    // The production wiring passes `() => new Date()`; this pins the default so
    // the constructor signature cannot silently drift to a frozen clock.
    const live = new FilingQueryService(model);

    const before = Date.now();
    const summary = await live.getSummary();
    const after = Date.now();

    expect(new Date(summary.generatedAt).getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(new Date(summary.generatedAt).getTime()).toBeLessThanOrEqual(after);
  });
});

/**
 * THE HERO'S TRIPLET, and the one relation that makes it a sentence.
 *
 * The feed prints "N filings today" beside "M of them said something". Read as
 * English that says M is a subset of N, so the two have to be the same UNIT
 * (filings, not claims) over the same WINDOW (one IST day). They were not:
 * the first came from here and the second was counted in the browser over
 * whatever rows the feed had loaded — on the live collection at 10:36 IST on
 * 2026-08-09 that printed "8" beside "22", and Load more took the 22 to 44.
 *
 * This suite pins the half that lives on the server, which is the half that can
 * be pinned: same window, same unit, and therefore M <= N whatever is stored.
 */
describe('getSummary — today, and how much of it said something', () => {
  /** A filing inside the 2026-08-05 IST day, with whatever enrichment. */
  const inDay = (
    seqId: number,
    enrichment?: Record<string, unknown>,
  ): Filing & { enrichment?: Record<string, unknown> } => ({
    ...makeFiling(seqId, {
      disseminatedAt: new Date('2026-08-05T06:00:00.000Z'),
    }),
    ...(enrichment === undefined ? {} : { enrichment }),
  });

  /** A filing at an exact instant, so an IST-day boundary can be sat on. */
  const onDay = (
    seqId: number,
    at: string,
    enrichment: Record<string, unknown>,
  ): Filing =>
    ({
      ...makeFiling(seqId, { disseminatedAt: new Date(at) }),
      enrichment,
    }) as Filing;

  const claim = (text: string): Record<string, unknown> => ({
    state: 'enriched',
    claims: [{ text, span: text, kind: 'operational' }],
  });

  it('counts FILINGS, not claims, so it can never exceed the day', async () => {
    // THE ARITHMETIC THAT PRODUCED AN IMPOSSIBLE HEADLINE. Three filings, six
    // claims. Counted per claim this says 6 insights over 3 filings; counted
    // per filing it says 3, which is the only reading the label supports.
    await seed([
      inDay(1, {
        state: 'enriched',
        claims: [
          { text: 'a', span: 'a', kind: 'operational' },
          { text: 'b', span: 'b', kind: 'operational' },
          { text: 'c', span: 'c', kind: 'operational' },
        ],
      }),
      inDay(2, {
        state: 'enriched',
        claims: [
          { text: 'd', span: 'd', kind: 'operational' },
          { text: 'e', span: 'e', kind: 'operational' },
        ],
      }),
      inDay(3, claim('f')),
    ]);
    now = new Date('2026-08-05T12:00:00.000Z');

    const summary = await service.getSummary();

    expect(summary.todayCount).toBe(3);
    expect(summary.todayVerified).toBe(3);
  });

  it('never reports more insights than filings, whatever is stored', async () => {
    // THE INVARIANT, asserted over a mixed day rather than a convenient one:
    // some filings say nothing, one says several things, one is a results
    // table, one carries only an amount.
    await seed([
      inDay(10),
      inDay(11),
      inDay(12, claim('BOARD APPROVED A DIVIDEND OF RS 4 PER SHARE.')),
      inDay(13, {
        state: 'enriched',
        claims: [
          { text: 'x', span: 'x', kind: 'operational' },
          { text: 'y', span: 'y', kind: 'operational' },
        ],
      }),
      inDay(14, { state: 'enriched', resultsLine: 'REVENUE 1,000 vs 900' }),
      inDay(15, { state: 'enriched', amountRupees: 4_000_000 }),
    ]);
    now = new Date('2026-08-05T12:00:00.000Z');

    const summary = await service.getSummary();

    expect(summary.todayCount).toBe(6);
    expect(summary.todayVerified).toBeLessThanOrEqual(summary.todayCount);
    // Two with claims and one with a results line. The amount-only filing is
    // NOT one: it draws a quiet card with no line on it, and a number that
    // counted it would promise a reader an insight they cannot find.
    expect(summary.todayVerified).toBe(3);
  });

  it('counts a results-only filing, because a card draws it as a line', async () => {
    // It did not before, and the card did — 6 filings on the busiest day of
    // the live collection (2026-08-05: 376 with a claim or a results line
    // against 370 with a claim).
    await seed([
      inDay(20, { state: 'enriched', resultsLine: 'EPS 12.4 vs 9.1' }),
    ]);
    now = new Date('2026-08-05T12:00:00.000Z');

    expect((await service.getSummary()).todayVerified).toBe(1);
  });

  it('measures it over the SAME IST day as todayCount, both ends bounded', async () => {
    // A verified filing from yesterday and one from tomorrow must not appear
    // in either number. The window is the thing the two share.
    await seed([
      // 2026-08-04 IST, one millisecond before the roll.
      onDay(30, '2026-08-04T18:29:59.999Z', claim('yesterday')),
      // 2026-08-05 IST, the instant it rolls.
      onDay(31, '2026-08-04T18:30:00.000Z', claim('today')),
      // 2026-08-06 IST.
      onDay(32, '2026-08-05T18:30:00.000Z', claim('tomorrow')),
    ]);
    now = new Date('2026-08-05T12:00:00.000Z');

    const summary = await service.getSummary();

    expect(summary.todayIstDay).toBe('2026-08-05');
    expect(summary.todayCount).toBe(1);
    expect(summary.todayVerified).toBe(1);
  });

  it('is zero rather than absent on a day that produced nothing', async () => {
    // "Nothing was found" and "nothing was looked for" are different facts.
    // A day with filings and no insights is the first; both numbers are real.
    await seed([inDay(40), inDay(41)]);
    now = new Date('2026-08-05T12:00:00.000Z');

    const summary = await service.getSummary();

    expect(summary.todayCount).toBe(2);
    expect(summary.todayVerified).toBe(0);
  });
});
