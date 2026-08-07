import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { FilingSchema, type Filing, type FilingDocument } from '@app/filings';
import { FilingQueryService } from './filing-query.service';

/**
 * The search, against a real mongod.
 *
 * A MOCKED MODEL CANNOT TEST THIS. Every claim here is a claim about what
 * MongoDB does with a `$text` predicate and a computed sort key — that the text
 * index matches a word in the middle of a name, that OR semantics widen a
 * two-word query, that `$meta: 'textScore'` survives into a second `$addFields`.
 * A mock would only confirm that the pipeline is the one we wrote, which is the
 * one thing never in doubt.
 *
 * The fixtures are real rows from the live collection, chosen because they are
 * the queries that returned NOTHING before this change: `britannia` (a name that
 * is also a ticker), `lupin` (a name whose ticker is a different word),
 * `vikram`/`solar` (a word in the middle of a name), `stock split` (a category).
 */

interface Content {
  readonly symbol: string;
  readonly companyName: string;
  readonly category?: string;
  readonly summary?: string;
  readonly claimLine?: string;
  readonly minutesAgo?: number;
}

const BASE = new Date('2026-08-07T06:00:00.000Z');

const makeFiling = (seqId: number, content: Content): Filing => {
  const at = new Date(BASE.getTime() - (content.minutesAgo ?? 0) * 60_000);

  return {
    seqId,
    symbol: content.symbol,
    isin: `INE${String(seqId).padStart(9, '0')}`,
    companyName: content.companyName,
    industry: null,
    category: content.category ?? 'General Updates',
    summary:
      content.summary ??
      `${content.companyName} has informed the Exchange about ${content.category ?? 'General Updates'}`,
    attachmentUrl: null,
    announcedAt: at,
    disseminatedAt: at,
    ingestedAt: new Date(at.getTime() + 6_000),
  };
};

const withClaim = (
  seqId: number,
  content: Content,
): Filing & { enrichment: Record<string, unknown> } => ({
  ...makeFiling(seqId, content),
  enrichment: {
    state: 'enriched',
    claimLine: content.claimLine ?? '',
    claims: [{ text: content.claimLine ?? '', span: '', kind: 'operational' }],
  },
});

let mongo: MongoMemoryServer;
let model: Model<FilingDocument>;
let service: FilingQueryService;

const search = async (q: string, limit = 25): Promise<readonly string[]> =>
  (await service.getRecent({ limit, offset: 0, q })).items.map(
    (row) => row.symbol,
  );

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  model = mongoose.model<FilingDocument>('SearchFiling', FilingSchema);
  await model.syncIndexes();
  service = new FilingQueryService(model, () => BASE);

  await model.insertMany([
    makeFiling(1, {
      symbol: 'BRITANNIA',
      companyName: 'Britannia Industries Limited',
      category: 'Press Release',
      minutesAgo: 10,
    }),
    makeFiling(2, {
      symbol: 'BRITANNIA',
      companyName: 'Britannia Industries Limited',
      category: 'Investor Presentation',
      minutesAgo: 200,
    }),
    makeFiling(3, {
      symbol: 'LUPIN',
      companyName: 'Lupin Limited',
      category: 'Outcome of Board Meeting',
      minutesAgo: 30,
    }),
    makeFiling(4, {
      symbol: 'VIKRAMSOLR',
      companyName: 'Vikram Solar Limited',
      category: 'Change in Auditors',
      minutesAgo: 40,
    }),
    makeFiling(5, {
      symbol: 'SOLARWORLD',
      companyName: 'Solarworld Energy Solutions Limited',
      category: 'General Updates',
      minutesAgo: 50,
    }),
    makeFiling(6, {
      symbol: 'BLSE',
      companyName: 'BLS E-Services Limited',
      category: 'Stock split',
      minutesAgo: 60,
    }),
    withClaim(7, {
      symbol: 'MANGLMCEM',
      companyName: 'Mangalam Cement Limited',
      category: 'Updates',
      claimLine:
        'MANGLMCEM: COMMISSIONED A SOLAR POWER PLANT AT ITS CEMENT WORKS.',
      minutesAgo: 5,
    }),
    withClaim(8, {
      symbol: 'ARSSBL',
      companyName: 'Anand Rathi Share and Stock Brokers Limited',
      category: 'Shareholders meeting',
      minutesAgo: 70,
    }),
    makeFiling(9, {
      symbol: 'EMCURE',
      companyName: 'Emcure Pharmaceuticals Limited',
      category: 'Record Date',
      minutesAgo: 80,
    }),
  ]);
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('search — the queries that used to return nothing', () => {
  it('finds a company by its name', async () => {
    // The whole reason for this change. `symbol` prefix-matching returned zero
    // rows for every one of these.
    expect(await search('britannia')).toEqual(['BRITANNIA', 'BRITANNIA']);
    expect(await search('lupin')).toEqual(['LUPIN']);
  });

  it('finds a company by a word in the MIDDLE of its name', async () => {
    expect(await search('vikram')).toEqual(['VIKRAMSOLR']);
  });

  it('finds a filing by what it said, not only by who said it', async () => {
    // MANGLMCEM's name has no `solar` in it. The word is in its claim line,
    // which is text a model wrote and a span verified.
    expect(await search('solar')).toContain('MANGLMCEM');
  });

  it('finds a filing by its category', async () => {
    expect(await search('stock split')).toContain('BLSE');
  });
});

describe('search — the ranking', () => {
  it('puts an exact ticker at the very top, above its own newer filings', async () => {
    // LUPIN is a ticker AND a word in a company name. Tier 0 is the ticker, and
    // it has to beat a name match even when the name match is more recent.
    const found = await search('lupin');

    expect(found[0]).toBe('LUPIN');
  });

  it('puts a company-name match above a body match, whatever the text score', async () => {
    // THE ASSERTION THE TIERS EXIST FOR. Mangalam Cement's claim line says
    // SOLAR in a short field with a high weight and its filing is the NEWEST of
    // the three by 35 minutes; on text score plus recency alone it would lead.
    // A reader typing `solar` means the solar companies.
    const found = await search('solar');

    expect(found[found.length - 1]).toBe('MANGLMCEM');
  });

  it('orders one company own filings newest first, not by term frequency', async () => {
    // Inside a tier every row is the same company, so the text score is
    // measuring how often `britannia` appears in Britannia's own PDFs. The
    // press release is 10 minutes old and the presentation 200; the reader
    // wants them in that order and nothing else is defensible.
    const page = await service.getRecent({
      limit: 25,
      offset: 0,
      q: 'britannia',
    });

    expect(page.items.map((row) => row.seqId)).toEqual([1, 2]);
  });

  it('widens on a second word rather than narrowing, and says how far', async () => {
    // MongoDB's `$text` is OR over terms. `stock split` therefore matches every
    // filing saying either — which is a real answer and not a bug, and the
    // reason the type-ahead offers the CATEGORY as a separate, exact route.
    const found = await search('stock split');

    expect(found).toContain('BLSE');
    expect(found).toContain('ARSSBL');
  });
});

describe('search — the whole-word limit, and the prefix that answers it', () => {
  it('a text index matches WORDS, so a prefix finds nothing on its own', async () => {
    // THE LIMIT, PINNED RATHER THAN HIDDEN. `brit` is not a word in any filing;
    // it is the first four keystrokes of every search for Britannia. And
    // `solar` does not match `Solarworld Energy Solutions Limited`, whose name
    // tokenises to the single word `solarworld` — measured on the live
    // collection, where `$search: 'solar'` returns 29 filings and none of them
    // is Solarworld's.
    expect(await search('brit')).toEqual([]);
    expect(await search('solar')).not.toContain('SOLARWORLD');
  });

  it('resolves a prefix through the directory when the text index found nothing', async () => {
    // The directory holds 954 pre-tokenised companies in memory and answers
    // prefixes; the text index cannot. Wired together, `brit` is a search for
    // Britannia and `solar` still means the three companies the words matched.
    const withPrefix = new FilingQueryService(
      model,
      () => BASE,
      async (q) => (q.startsWith('brit') ? ['BRITANNIA'] : []),
    );

    const page = await withPrefix.getRecent({
      limit: 25,
      offset: 0,
      q: 'brit',
    });

    expect(page.items.map((row) => row.symbol)).toEqual([
      'BRITANNIA',
      'BRITANNIA',
    ]);
    expect(page.meta.total).toBe(2);
  });

  it('does not fall back when the text index DID find something', async () => {
    // The fallback is a miss path. Firing it beside a successful search would
    // be a second query per request on the route the page polls.
    let asked = 0;
    const counting = new FilingQueryService(
      model,
      () => BASE,
      async () => {
        asked += 1;
        return ['BRITANNIA'];
      },
    );

    await counting.getRecent({ limit: 25, offset: 0, q: 'lupin' });

    expect(asked).toBe(0);
  });

  it('orders a prefix completion newest first, since every row is one company', async () => {
    const withPrefix = new FilingQueryService(
      model,
      () => BASE,
      async () => ['BRITANNIA'],
    );

    const page = await withPrefix.getRecent({
      limit: 25,
      offset: 0,
      q: 'brit',
    });

    expect(page.items.map((row) => row.seqId)).toEqual([1, 2]);
  });

  it('keeps the other filters when it falls back', async () => {
    // A fallback that dropped the group filter would answer a question the
    // reader did not ask, which is worse than answering none.
    const withPrefix = new FilingQueryService(
      model,
      () => BASE,
      async () => ['BRITANNIA'],
    );

    const page = await withPrefix.getRecent({
      limit: 25,
      offset: 0,
      q: 'brit',
      group: 'narrative',
    });

    expect(page.items.map((row) => row.seqId)).toEqual([1, 2]);

    const none = await withPrefix.getRecent({
      limit: 25,
      offset: 0,
      q: 'brit',
      group: 'ratings',
    });

    expect(none.items).toEqual([]);
  });
});

describe('search — what it must not do', () => {
  it('returns nothing rather than everything for a query of punctuation', async () => {
    // A query that reduces to no terms must not silently become "no filter",
    // which would return the whole collection and read as a successful search.
    expect(await search('---')).toEqual([]);
    expect(
      (await service.getRecent({ limit: 25, offset: 0, q: '  ' })).meta.total,
    ).toBe(0);
  });

  it('treats a hyphen as a separator rather than as a negation', async () => {
    // `$search: '-solar'` negates the only term and matches nothing. Measured
    // on the live collection: 0 of 2,243.
    expect(await search('-solar')).toContain('VIKRAMSOLR');
  });

  it('is not a regex, so metacharacters match literally or not at all', async () => {
    // No pattern is ever built from request text, so there is nothing here to
    // escape and no input that can cost more than a word lookup.
    expect(await search('.*')).toEqual([]);
    expect(await search('(a+)+$')).toEqual([]);
  });

  it('counts what it returns, so paging through a search is honest', async () => {
    const first = await service.getRecent({ limit: 1, offset: 0, q: 'solar' });
    const second = await service.getRecent({ limit: 1, offset: 1, q: 'solar' });

    expect(first.meta.total).toBe(2);
    expect(first.meta.hasMore).toBe(true);
    expect(second.items[0].symbol).not.toBe(first.items[0].symbol);
  });

  it('combines with the other filters instead of replacing them', async () => {
    const page = await service.getRecent({
      limit: 25,
      offset: 0,
      q: 'solar',
      group: 'governance',
    });

    // Change in Auditors is governance; the other two solar rows are not.
    expect(page.items.map((row) => row.symbol)).toEqual(['VIKRAMSOLR']);
  });

  it('keeps `symbol` exact when the type-ahead applies it', async () => {
    // A reader who PICKED Britannia gets Britannia, not every filing that
    // mentions it. The two parameters do different jobs and both are needed.
    const page = await service.getRecent({
      limit: 25,
      offset: 0,
      symbol: 'britannia',
    });

    expect(page.items).toHaveLength(2);
    expect(page.meta.total).toBe(2);
  });
});

describe('search — the query plan', () => {
  it('is served by the text index and examines no more documents than it returns', async () => {
    const explained = await model
      .find({ $text: { $search: 'solar' } })
      .explain('executionStats');

    const stats = (
      explained as unknown as {
        executionStats: {
          nReturned: number;
          totalDocsExamined: number;
          totalKeysExamined: number;
        };
      }
    ).executionStats;

    // KEYS EXAMINED EQUALS ROWS RETURNED is the shape of a query the index
    // answered completely. Anything more means the FETCH is reading documents
    // to throw them away, which is what a scan looks like from the inside.
    expect(stats.nReturned).toBe(2);
    expect(stats.totalKeysExamined).toBe(2);
    expect(stats.totalDocsExamined).toBe(2);
  });

  it('never plans a collection scan for a search', async () => {
    const explained = (await model
      .find({ $text: { $search: 'solar' } })
      .explain()) as unknown as { queryPlanner: { winningPlan: unknown } };

    expect(JSON.stringify(explained.queryPlanner.winningPlan)).not.toContain(
      'COLLSCAN',
    );
  });
});
