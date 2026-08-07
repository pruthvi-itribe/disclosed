import type { Model } from 'mongoose';
import type { BseScrip } from './bse-scrip.schema';

/** Just the part of `BseClient` this needs, so a test needs no HTTP. */
export interface ScripIsinSource {
  isinForScrip(scripCode: number): Promise<string | null>;
}

/** What a resolve pass did, so a caller can report it rather than guess. */
export interface ScripResolveStats {
  readonly requested: number;
  /** Answered from the collection, costing no request. */
  readonly cached: number;
  /** Fetched from BSE this pass. */
  readonly fetched: number;
  /** Fetched and BSE had no ISIN. Remembered, so it is not asked again. */
  readonly unresolved: number;
}

/**
 * Resolves scrip codes to ISINs, asking BSE once per code ever.
 *
 * THE COST THIS REMOVES IS NOT INCIDENTAL. Two days of BSE announcements span
 * 1,217 distinct companies; at the 800ms pacing this codebase reads exchanges
 * with, resolving them is 16.2 minutes of requests, and without a cache that is
 * paid again on every single run.
 *
 * A NULL ANSWER IS CACHED TOO, and that is the half most easily got wrong.
 * A scrip BSE will not resolve is not a transient failure to retry forever — it
 * is usually a delisted company or an instrument the quote endpoint does not
 * serve. Not recording the null means every future run re-asks the same
 * question and gets the same silence, and the unresolvable tail is exactly the
 * set that grows.
 */
export class BseScripResolver {
  constructor(
    private readonly model: Model<BseScrip>,
    private readonly source: ScripIsinSource,
    /** Pause between the requests this actually has to make. */
    private readonly delayMs: number = 800,
  ) {}

  async assertIndexes(): Promise<void> {
    await this.model.createIndexes();
  }

  /**
   * ISINs for the given codes, fetching only those never asked about.
   *
   * Returns a map covering every requested code, with null where BSE had no
   * answer — so a caller can tell "no ISIN" from "not in the map" without
   * knowing anything about the cache.
   */
  async resolve(
    scripCodes: readonly number[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<{
    readonly isins: ReadonlyMap<number, string | null>;
    readonly stats: ScripResolveStats;
  }> {
    const wanted = [...new Set(scripCodes)];
    const isins = new Map<number, string | null>();

    const held = (await this.model
      .find({ scripCode: { $in: wanted } })
      .lean()
      .exec()) as unknown as BseScrip[];
    for (const row of held) isins.set(row.scripCode, row.isin);

    const missing = wanted.filter((code) => !isins.has(code));
    let fetched = 0;
    let unresolved = 0;

    for (const code of missing) {
      const isin = await this.source.isinForScrip(code);
      isins.set(code, isin);
      fetched += 1;
      if (isin === null) unresolved += 1;

      // Written one at a time rather than batched at the end: a resolve pass
      // over a thousand companies takes minutes, and an interruption partway
      // through must not throw away every answer it had already paid for.
      await this.model
        .updateOne(
          { scripCode: code },
          { $set: { scripCode: code, isin, resolvedAt: new Date() } },
          { upsert: true },
        )
        .exec();

      onProgress?.(fetched, missing.length);
      if (this.delayMs > 0 && fetched < missing.length) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
    }

    return {
      isins,
      stats: {
        requested: wanted.length,
        cached: wanted.length - missing.length,
        fetched,
        unresolved,
      },
    };
  }
}
