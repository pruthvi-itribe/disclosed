import { Injectable, Logger } from '@nestjs/common';
import { describeError, safeText, stackOf } from '@app/common';
import { isRoutine, partitionForAlerting, type Filing } from '@app/filings';
import { formatFilingAlert, TelegramService } from '@app/notify';

export interface AlertOptions {
  alertWindowMs: number;
  /**
   * Symbols to alert on. Empty means alert on every non-routine filing.
   * Entries are matched case-insensitively and trimmed; blank entries are
   * ignored (see `normaliseWatchlist`).
   */
  watchlist: readonly string[];
}

/**
 * Uppercases and trims, so the two sides of a watchlist comparison are
 * normalised identically. A config value arrives as `WATCHLIST=RELIANCE, TCS`
 * split on commas, which leaves a leading space on every entry but the first.
 */
const normalise = (symbol: string): string => symbol.trim().toUpperCase();

/**
 * Blank entries are dropped rather than kept as members that match nothing.
 *
 * `WATCHLIST=` parses to `['']`, not `[]`. Kept as a real entry it matches no
 * symbol and mutes the bot completely — and because the failure mode is "no
 * alerts" rather than an error, a dead channel is indistinguishable from a
 * quiet market. Dropped, it takes the documented empty-watchlist branch and
 * means what the operator wrote: no watchlist.
 */
const normaliseWatchlist = (
  watchlist: readonly string[],
): ReadonlySet<string> =>
  new Set(watchlist.map(normalise).filter((symbol) => symbol.length > 0));

/**
 * Decides which newly-inserted filings become Telegram messages.
 *
 * Three gates, applied independently and in this order: the cold-start window,
 * the routine-category taxonomy, and the optional watchlist. Each exists for a
 * different reason and none subsumes another — a fresh routine filing and a
 * stale market-moving one are both suppressed, by different gates.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly watchlist: ReadonlySet<string>;

  constructor(
    private readonly telegram: TelegramService,
    private readonly options: AlertOptions,
  ) {
    this.watchlist = normaliseWatchlist(options.watchlist);
  }

  /**
   * Alerts on filings the repository confirmed as NEW inserts.
   *
   * PRECONDITION — `filings` MUST be the return value of the repository's
   * insert-only write, never a full poll result. This service holds no state
   * between calls and does no deduplication of its own: that check belongs to
   * the repository's unique index, and duplicating it here would give two
   * places to get it wrong. Hand it a whole poll page and it re-notifies on
   * every record, every poll, and the cold-start window is then the only thing
   * standing between a restart and a thousand duplicate messages.
   *
   * RETURN VALUE — the filings an alert was ATTEMPTED for. It is not proof of
   * delivery and must never be persisted as one. `TelegramService.send()`
   * resolves on a Telegram outage, on a 400, and when credentials are absent
   * entirely, because a notification failure must never stop ingestion. A
   * filing is excluded only when it threw before the send was issued.
   *
   * Never rejects for a bad record: each filing is contained on its own, so one
   * unusable document cannot cost the rest of the batch. (A null or undefined
   * ENTRY is the exception — `partitionForAlerting` reads its timestamp first
   * and would throw. That shape does not come out of the mapper; malformed
   * FIELDS, which a projected read does produce, are handled below.)
   */
  async processInserted(
    filings: readonly Filing[],
    now = new Date(),
  ): Promise<Filing[]> {
    if (filings.length === 0) return [];

    const { alertable, silent } = partitionForAlerting(
      filings,
      now,
      this.options.alertWindowMs,
    );

    if (silent.length > 0) {
      // The cold-start drain is silent on Telegram, never in the log: this line
      // is what distinguishes a working gate from a poller that has died.
      this.logger.log(
        `Stored ${silent.length} filings outside the alert window`,
      );
    }

    // ASCENDING seqId, which is deliberately NOT the order NSE returns.
    //
    // NSE pages newest-first and `partitionForAlerting` preserves input order,
    // so relaying it would send the newest filing FIRST — making it the OLDEST
    // message in the chat, with the freshest news buried above older news.
    // Sending oldest-first puts the newest filing in the most recent message,
    // where the reader is already looking, and the chat reads chronologically.
    //
    // Sorted on a copy. `alertable` is `partitionForAlerting`'s own array today
    // and sorting it in place would be harmless, but that is one refactor away
    // from reordering the caller's batch.
    const ordered = [...alertable].sort((a, b) => a.seqId - b.seqId);

    const attempted: Filing[] = [];

    // SEQUENTIAL, never `Promise.all`. Concurrent sends hit Telegram's per-chat
    // rate limit, and a 429 is swallowed by `send()` by design — so the filing
    // is lost with nothing raised — and they arrive in completion order, which
    // undoes the sort above.
    for (const filing of ordered) {
      try {
        if (!this.shouldAlert(filing)) continue;
        await this.telegram.send(formatFilingAlert(filing));
        attempted.push(filing);
      } catch (error) {
        // `formatFilingAlert` and `isRoutine` both throw a TypeError on a
        // record whose symbol, category or summary is absent or not a string,
        // which a projected read or a pre-migration document can produce.
        // Unhandled, that one record would abort the whole batch — including
        // the filing the user is actually waiting for. Skipped and logged with
        // the seqId instead, so the loss is diagnosable and replayable.
        this.logger.error(
          `Alert failed for seqId ${safeText(filing.seqId)}: ${describeError(
            error,
          )}`,
          stackOf(error),
        );
      }
    }

    return attempted;
  }

  /**
   * The two content gates. Reads `category` and, when a watchlist is
   * configured, `symbol` — both of which can throw on a malformed record, so
   * this is only ever called from inside the loop's try.
   */
  private shouldAlert(filing: Filing): boolean {
    if (isRoutine(filing.category)) return false;
    if (this.watchlist.size === 0) return true;
    return this.watchlist.has(normalise(filing.symbol));
  }
}
