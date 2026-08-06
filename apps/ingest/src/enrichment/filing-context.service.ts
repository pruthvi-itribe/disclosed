import { Injectable } from '@nestjs/common';
import {
  contextLine,
  DEFAULT_CONTEXT_WINDOW_DAYS,
  eventNounFor,
  type EnrichmentRepository,
  type Filing,
} from '@app/filings';

/**
 * Turns stored filings into the one line of factual context an alert carries.
 *
 * The thinnest possible seam: it counts, it clamps, and it hands the counts to
 * `contextLine`, which owns every decision about what may be SAID. Nothing here
 * composes English, so the rule that this pipeline never states anything
 * predictive is enforced in one pure, exhaustively tested module rather than
 * spread across a service that also talks to a database.
 *
 * THE QUERY BUDGET IS THE DESIGN CONSTRAINT. This runs on the alert path, once
 * per filing that is about to become a message. So:
 *
 *   - a category with no countable event costs ZERO queries, because the noun
 *     is looked up in memory first and a null noun short-circuits everything;
 *   - a filing with no verified amount costs one indexed count, plus a second
 *     only when that count came back zero;
 *   - the coverage read is one index-covered `findOne` and is memoised, because
 *     the oldest filing in the collection does not move between two alerts in
 *     the same second.
 *
 * There is no aggregation pipeline and no collection scan anywhere in it.
 */
@Injectable()
export class FilingContextService {
  /**
   * The oldest-filing read, memoised.
   *
   * A burst of twenty filings arriving in one poll would otherwise issue twenty
   * identical reads for a value that changes only when the collection's oldest
   * record is deleted — which nothing in this system does.
   */
  private coverage: { readonly days: number; readonly atMs: number } | null =
    null;

  constructor(
    private readonly repository: EnrichmentRepository,
    private readonly windowDays: number = DEFAULT_CONTEXT_WINDOW_DAYS,
    private readonly coverageTtlMs: number = 60_000,
  ) {}

  /**
   * The context line for a filing that carries no verified amount — the hot
   * alert path, where the PDF has not been read yet.
   */
  async contextFor(filing: Filing, now: Date): Promise<string | null> {
    return this.compute(filing, now, null);
  }

  /**
   * The context line for a filing whose amount HAS been verified.
   *
   * Separate entry point rather than an optional argument, so a caller cannot
   * accidentally omit the amount and silently lose the size comparison — which
   * is the one context line that speaks to materiality.
   */
  async contextForAmount(
    filing: Filing,
    now: Date,
    amountRupees: number | null,
  ): Promise<string | null> {
    return this.compute(filing, now, amountRupees);
  }

  private async compute(
    filing: Filing,
    now: Date,
    amountRupees: number | null,
  ): Promise<string | null> {
    // In memory, and first. A category with no countable event can produce no
    // line at all, so it must not cost a round trip to discover that.
    const noun = eventNounFor(filing.category);
    if (noun === null) return null;

    const [counts, coverageDays] = await Promise.all([
      this.repository.contextCounts({
        symbol: filing.symbol,
        category: filing.category,
        disseminatedAt: filing.disseminatedAt,
        windowDays: this.windowDays,
        amountRupees,
      }),
      this.coverageDays(now),
    ]);

    return contextLine({
      symbol: filing.symbol,
      noun,
      windowDays: this.windowDays,
      coverageDays,
      amountRupees,
      ...counts,
    });
  }

  private async coverageDays(now: Date): Promise<number> {
    const cached = this.coverage;
    if (cached !== null && now.getTime() - cached.atMs < this.coverageTtlMs) {
      // The cached value is the coverage AS OF `atMs`; the collection has only
      // grown since, so it is a lower bound on the truth. A lower bound is the
      // safe direction: it can shorten a stated window, never lengthen one past
      // the data actually held.
      return cached.days;
    }

    const days = await this.repository.coverageDays(now);
    this.coverage = { days, atMs: now.getTime() };
    return days;
  }
}
