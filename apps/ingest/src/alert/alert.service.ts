import { Injectable, Logger } from '@nestjs/common';
import { describeError, safeText, stackOf } from '@app/common';
import {
  normaliseWatchlist,
  partitionForAlerting,
  passesContentGates,
  type Filing,
} from '@app/filings';
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
 * Supplies the derived-context line for a filing, or null when none can be
 * computed confidently.
 *
 * An INTERFACE rather than the concrete service, and nullable in the
 * constructor, because the alert path must remain runnable — and testable —
 * with no database attached. The poller's two-second budget is the whole reason
 * this pipeline exists; a hard dependency from the send path to a collection
 * would make every alert wait on a query.
 */
export interface FilingContextProvider {
  contextFor(filing: Filing, now: Date): Promise<string | null>;
}

/**
 * What an empty watchlist actually costs, measured rather than guessed.
 *
 * From the recorded 32-day corpus: 12,415 of 17,442 filings (71.2%) survive the
 * routine-category gate, which is the only other content filter in the alert
 * path. Per IST day that is ~388 messages, and the busiest observed hour held
 * 106.
 */
const FILINGS_PER_DAY_UNFILTERED = 388;
const PEAK_FILINGS_PER_HOUR = 106;

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
    /**
     * Null means "send the alert without a context line", which is exactly what
     * this service did before derived context existed. Defaulted rather than
     * required so every existing construction — and every existing test — keeps
     * working without a database.
     */
    private readonly context: FilingContextProvider | null = null,
  ) {
    this.watchlist = normaliseWatchlist(options.watchlist);
    this.warnIfUnfiltered();
  }

  /**
   * Says out loud, once at startup, what the SHIPPED default does.
   *
   * An empty watchlist means alert on everything, which is the documented
   * behaviour and is deliberately left alone — an operator who wants the full
   * feed should get the full feed. What is not acceptable is that the volume is
   * invisible until the chat is unusable: at ~388 messages a day the channel
   * gets muted within a day, and every operator alert this system produces —
   * INGEST DEGRADED, BLIND, DRAIN FAILED, WRITE FAILED, RECORDS SKIPPED — is
   * muted with it. The pipeline then goes dark at exactly the moment it most
   * needs to be heard, and nothing anywhere reports that.
   *
   * A warning rather than a refusal: this is a defensible configuration, and
   * refusing to boot on it would be the library deciding policy for its
   * operator. But it must be a decision, not an accident.
   */
  private warnIfUnfiltered(): void {
    if (this.watchlist.size > 0) return;

    this.logger.warn(
      'WATCHLIST is empty, so every non-routine filing is alerted. Measured ' +
        `over a 32-day corpus that is ~${FILINGS_PER_DAY_UNFILTERED} Telegram ` +
        `messages a day, peaking at ${PEAK_FILINGS_PER_HOUR} in one hour. A ` +
        'channel at that volume gets muted, and every operator alert is muted ' +
        'with it. Set WATCHLIST before pointing this at a chat you rely on.',
    );
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
        await this.telegram.send(
          formatFilingAlert(filing, await this.contextFor(filing, now)),
        );
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
   *
   * The policy itself lives in `libs/filings/src/logic/alert-gate.ts`, shared
   * with the enrichment worker's follow-up messages. A second copy here would
   * let an operator set a watchlist, watch this lane fall silent, and keep
   * receiving the other one.
   */
  private shouldAlert(filing: Filing): boolean {
    return passesContentGates(filing, this.watchlist);
  }

  /**
   * The derived-context line, or null.
   *
   * CONTAINED SEPARATELY FROM THE SEND, and that separation is the point. This
   * reaches a database on the path whose latency budget is the reason the
   * project exists, so a slow or failing query must cost the context line and
   * nothing else. Folding it into the surrounding try would let a Mongo blip
   * suppress the ALERT, turning a decoration into a single point of failure for
   * the thing it decorates.
   *
   * The error is logged, never swallowed: a context provider that has been
   * throwing for a week must not look like a system that simply had nothing to
   * say.
   */
  private async contextFor(filing: Filing, now: Date): Promise<string | null> {
    if (this.context === null) return null;

    try {
      return await this.context.contextFor(filing, now);
    } catch (error) {
      this.logger.error(
        `Derived context failed for seqId ${safeText(filing.seqId)}; ` +
          `alerting without it: ${describeError(error)}`,
        stackOf(error),
      );
      return null;
    }
  }
}
