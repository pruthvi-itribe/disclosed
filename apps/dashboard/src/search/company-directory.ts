import {
  categoryGroupFor,
  CATEGORY_GROUPS,
  CATEGORY_GROUP_LABEL,
  type CategoryGroup,
} from '@app/filings';
import type { PipelineStage } from 'mongoose';
import type { FilingReadModel } from '../filings/filing-read.model';
import type {
  CategoryEntry,
  CompanyEntry,
  DirectorySnapshot,
  GroupEntry,
} from './directory.types';
import { companyTerms, searchTerms } from './search-terms';

/**
 * The company directory: the type-ahead's whole data source.
 *
 * ================================================================
 * WHY THIS IS A CACHE AND NOT A QUERY
 * ================================================================
 *
 * A type-ahead fires on a keystroke. The set it searches is DISTINCT COMPANIES —
 * 954 of them behind 2,243 filings — and there is no MongoDB index that answers
 * "which distinct companies have a word beginning with `sol`" without either a
 * stored token array (a new field on every document, a change to the ingest
 * write path and a backfill of the whole collection) or a scan. Neither is worth
 * paying per keystroke for a set that fits in 40KB of memory.
 *
 * So the directory is built by TWO READS and then answered from memory. What
 * makes that honest rather than a dodge is the shape of the two reads, which is
 * asserted by `company-directory.spec.ts` with `explain('executionStats')`:
 *
 *   companies   IXSCAN on symbol_1_companyName_1 → PROJECTION_COVERED
 *               2,243 keys examined, 0 DOCUMENTS examined, 5ms
 *   categories  IXSCAN on category_1             → PROJECTION_COVERED
 *               2,243 keys examined, 0 DOCUMENTS examined, 2ms
 *
 * Zero documents. Both reads are answered out of index pages the poller is
 * already keeping warm, and neither one competes with the ingest for the
 * document working set — which is the thing that actually matters when a viewer
 * and a live poller share one collection.
 *
 * ================================================================
 * WHAT A KEYSTROKE COSTS
 * ================================================================
 *
 * Nothing. `snapshot()` returns the held value and issues no read at all; the
 * spec asserts that a hundred consecutive calls issue zero. A refresh happens on
 * a CLOCK, not on a request: at most one pair of index scans per
 * `DIRECTORY_TTL_MS`, however fast anybody types.
 *
 * A stale snapshot is served WHILE the refresh runs rather than after it, so no
 * reader ever waits for one. The cost of that is bounded staleness, and the
 * response carries `builtAtIst` so the staleness is visible rather than implied.
 *
 * ================================================================
 * WHAT GOES WRONG, AND WHAT IT COSTS WHEN IT DOES
 * ================================================================
 *
 * A company that filed for the FIRST time within the last TTL is missing from
 * the type-ahead. It is not missing from the search — `q` goes to the text index
 * on every request — and it is not missing from the feed. Only the suggestion is
 * late, and only for a company nobody has ever seen before, which is the one
 * case where a reader has nothing to complete anyway.
 *
 * A refresh that FAILS keeps the last good snapshot and does not retry until the
 * next TTL. A search box that empties itself because one aggregation timed out
 * is worse than one offering a list a minute old, and a box that retries a dead
 * mongod on every keystroke is worse than both.
 */

/**
 * How long a snapshot is served before a refresh is started behind it.
 *
 * Sixty seconds, and the number follows from what actually changes. A new filing
 * from a company already in the directory only moves a COUNT — the suggestion
 * itself is already correct. The directory only gains a ROW when a company files
 * for the very first time, which on this collection happened 954 times in the
 * 2,243 filings it holds and is rarest exactly for the companies a reader is
 * most likely to be looking for. Sixty seconds of lag on a row nobody has seen
 * before, against one pair of index scans a minute, is the trade this makes.
 */
export const DIRECTORY_TTL_MS = 60_000;

/** One `$group` result, whatever the key is. */
interface Grouped<TKey> {
  readonly _id: TKey;
  readonly filings: number;
}

export class CompanyDirectory {
  /**
   * The index each read is PINNED to, and pinning is deliberate.
   *
   * Without a hint MongoDB plans both of these as a COLLSCAN — measured: 2,243
   * documents examined, 0 keys — because a `$group` over the whole collection
   * has no predicate to give the planner a reason to prefer an index, even
   * though the index covers the projection completely. The hint is what turns a
   * collection scan into `PROJECTION_COVERED`, and it is therefore part of the
   * contract rather than a tuning knob: the spec asserts the plan, and the
   * schema comment beside each index says which read it exists for.
   */
  static readonly COMPANY_INDEX = 'symbol_1_companyName_1';
  static readonly CATEGORY_INDEX = 'category_1';

  /**
   * Distinct companies with their filing counts.
   *
   * `$group` on the pair rather than on the symbol alone. They are 1:1 in
   * practice, but a company that renamed itself mid-corpus would otherwise have
   * whichever of its two names `$first` happened to see — and the pair is what
   * the index carries, so grouping on it is free.
   */
  static readonly COMPANY_PIPELINE: PipelineStage[] = [
    {
      $group: {
        _id: { symbol: '$symbol', companyName: '$companyName' },
        filings: { $sum: 1 },
      },
    },
    // Sorted in the DATABASE and not on read, so the snapshot is already in the
    // order the type-ahead breaks ties by and a refresh cannot reorder a list
    // the reader is arrowing through.
    { $sort: { filings: -1, '_id.symbol': 1 } },
  ];

  /** Distinct categories with their filing counts. */
  static readonly CATEGORY_PIPELINE: PipelineStage[] = [
    { $group: { _id: '$category', filings: { $sum: 1 } } },
    { $sort: { filings: -1, _id: 1 } },
  ];

  /** The snapshot every request is answered from, or null before the first build. */
  private held: DirectorySnapshot | null = null;

  /** The refresh in progress, so a burst of cold requests rebuilds once. */
  private inFlight: Promise<DirectorySnapshot> | null = null;

  /**
   * When a build was last ATTEMPTED, which is not when one last succeeded.
   *
   * Staleness is measured from the attempt so that a failing mongod is retried
   * once per TTL rather than once per keystroke. `builtAt` on the snapshot still
   * reports when the data is actually from, so the wire never claims a failed
   * refresh was a successful one.
   */
  private attemptedAt: number | null = null;

  constructor(
    private readonly filings: FilingReadModel,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs: number = DIRECTORY_TTL_MS,
  ) {}

  /**
   * The directory, immediately.
   *
   * Awaits a build ONLY on a cold cache — the very first suggestion request
   * after a restart. Every other call returns what is held and, when the clock
   * says so, leaves a refresh running behind it.
   */
  async snapshot(): Promise<DirectorySnapshot> {
    const held = this.held;
    if (held === null) return this.refresh();

    if (this.isStale()) {
      // Deliberately not awaited. The refresh resolves to the stale snapshot on
      // failure, so this can never become an unhandled rejection.
      void this.refresh();
    }

    return held;
  }

  /**
   * Resolves when no refresh is in flight.
   *
   * Exists for the tests and for shutdown: a background rebuild is the one piece
   * of work this read-only application starts on its own, and something has to
   * be able to wait for it rather than assume a timeout.
   */
  async settled(): Promise<void> {
    const running = this.inFlight;
    if (running !== null) await running;
  }

  private isStale(): boolean {
    return (
      this.attemptedAt === null ||
      this.now().getTime() - this.attemptedAt >= this.ttlMs
    );
  }

  private refresh(): Promise<DirectorySnapshot> {
    const running = this.inFlight;
    if (running !== null) return running;

    this.attemptedAt = this.now().getTime();

    const job = this.build()
      .then((built) => {
        this.held = built;
        return built;
      })
      .catch((error: unknown) => {
        const held = this.held;
        // A cold failure has nothing to fall back to and must reach the caller
        // as a 500 rather than as an empty suggestion list, which would read as
        // "this company does not exist".
        if (held === null) throw error;
        return held;
      })
      .finally(() => {
        this.inFlight = null;
      });

    this.inFlight = job;
    return job;
  }

  /**
   * The two reads, issued together.
   *
   * Together rather than in sequence because they are independent and this is
   * the one place the directory blocks a reader — the cold start. Serialising
   * them would double the only latency this design has.
   */
  private async build(): Promise<DirectorySnapshot> {
    const [companyRows, categoryRows] = await Promise.all([
      this.filings
        .aggregate<Grouped<{ symbol: string; companyName: string }>>(
          CompanyDirectory.COMPANY_PIPELINE,
          { hint: CompanyDirectory.COMPANY_INDEX },
        )
        .exec(),
      this.filings
        .aggregate<Grouped<string | null>>(CompanyDirectory.CATEGORY_PIPELINE, {
          hint: CompanyDirectory.CATEGORY_INDEX,
        })
        .exec(),
    ]);

    const companies: readonly CompanyEntry[] = companyRows.map((row) => ({
      symbol: row._id.symbol,
      companyName: row._id.companyName,
      filings: row.filings,
      // TOKENISED ONCE, HERE. The same work done on read would be 954
      // tokenisations per character typed, to reach an answer that cannot have
      // changed since the snapshot was built.
      terms: companyTerms(row._id.symbol, row._id.companyName),
    }));

    const categories: readonly CategoryEntry[] = categoryRows.map((row) => ({
      // Defensive rather than decorative: `category` is `required` on the
      // schema, but this collection predates that and a null key here would
      // otherwise reach `toLowerCase` on a keystroke.
      category: row._id ?? '',
      filings: row.filings,
      terms: searchTerms(row._id ?? ''),
    }));

    return {
      companies,
      categories,
      groups: foldGroups(categories),
      builtAt: this.now(),
    };
  }
}

/**
 * Every group, counted by folding the categories through this codebase's own
 * mapping table.
 *
 * NOT A SECOND `$group` IN THE DATABASE, for the reason `getEnrichmentSummary`
 * gives at length: the 116-row table lives in `category-group.ts` where a test
 * checks it against the corpus, and restating it as a `$switch` would be the
 * same table written twice in two languages — with the second copy being the one
 * that silently stops matching when NSE renames something.
 *
 * ALL ELEVEN ARE RETURNED, including the ones on zero. A group is a filter this
 * page already offers as a chip; a reader typing its name must be told it exists
 * and is empty, rather than told nothing and left to conclude the box is broken.
 */
const foldGroups = (
  categories: readonly CategoryEntry[],
): readonly GroupEntry[] => {
  const totals = new Map<CategoryGroup, number>(
    CATEGORY_GROUPS.map((group) => [group, 0]),
  );

  for (const entry of categories) {
    const group = categoryGroupFor(entry.category);
    totals.set(group, (totals.get(group) ?? 0) + entry.filings);
  }

  return CATEGORY_GROUPS.map((group) => ({
    group,
    label: CATEGORY_GROUP_LABEL[group],
    filings: totals.get(group) ?? 0,
    terms: searchTerms(CATEGORY_GROUP_LABEL[group]),
  }));
};
