import type { Filing } from '@app/filings';

/**
 * How many proven-stored seqIds to keep. See the class doc for the derivation.
 */
export const RECENT_SEQ_ID_CAPACITY = 4096;

/**
 * A bounded pre-filter over seqIds the database has already accounted for.
 *
 * WHAT THIS IS NOT: it is not the newness authority. That is the unique index
 * on `seqId` plus `insertNew`'s return value, and nothing else. This only
 * suppresses work that would provably be rejected, and a MISS always falls
 * through to `insertNew` — so the worst a stale or evicted entry can cost is
 * one duplicate-key rejection, never a lost filing. It exists because the
 * poller offers the ENTIRE hot page every poll (NSE disseminates out of seq_id
 * order, so a cursor cannot decide newness), and almost all of that is a
 * re-offer of rows we already hold.
 *
 * MEASURED, not assumed. Replaying the recorded 32-day corpus through this
 * service at the real 2s cadence across the 07:00–23:00 IST window — 904,536
 * simulated polls — the whole-page offer costs:
 *
 *   - without this filter: 17,859,905 rows offered (558,122/day), of which 545
 *     a day are new. 99.90% of the work is a re-offer.
 *   - with it:             17,438 rows in 16,632 `insertNew` calls (545/day).
 *     A 1,024x reduction in rows, and 98.2% of polls skip the database
 *     entirely.
 *
 * The suppressed call is not free: an all-duplicate 20-row `insertNew` resolves
 * through mongoose's bulk-write ERROR path, building 20 duplicate-key
 * `writeErrors` and running `extractInserted`'s accounting every time. Measured
 * at 1.02 ms against an in-process Mongo (0.0001 ms when skipped), which is
 * ~30 seconds of wall clock per day on the hot path alone, before the
 * five-minute drain re-offers a whole IST day on top. Materiality confirmed.
 *
 * CAPACITY. The corpus's busiest IST day held 1,023 filings and the mean is
 * 545, so 4,096 entries hold between four and seven days of distinct ids. That
 * bound is chosen against the DRAIN, not the hot page: a scheduled drain
 * re-offers the whole IST day every five minutes, and a capacity below one
 * day's volume would let each drain evict the entries the next drain needs.
 * Twenty entries would serve the hot page alone. Cost at capacity is a Set of
 * 4,096 numbers — tens of kilobytes, fixed, and reached only after several days
 * of continuous running.
 *
 * EVICTION is oldest-first. A `Set` iterates in insertion order, so the first
 * value it yields is the oldest still held.
 *
 * The one behaviour to be aware of: rows deleted from the collection behind the
 * poller's back stay suppressed until they age out. That self-heals within
 * `capacity` admissions and is a deliberate trade — the alternative is asking
 * the database the same question ~575,000 times a day to defend against an
 * event that is not part of normal operation.
 */
export class RecentSeqIds {
  private readonly seen = new Set<number>();

  constructor(private readonly capacity: number = RECENT_SEQ_ID_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      // A capacity of 0 would make `remember` a no-op and every poll would pay
      // the full duplicate-key round trip; a negative or fractional one would
      // loop or never evict. Neither loses a filing, but both are silent.
      throw new Error(
        `RecentSeqIds capacity must be a whole number >= 1, but was ${capacity}`,
      );
    }
  }

  /** Filings this pre-filter cannot prove are already stored. A new array. */
  unseen(filings: readonly Filing[]): readonly Filing[] {
    return filings.filter((filing) => !this.seen.has(filing.seqId));
  }

  /**
   * Records filings as proven stored. Call ONLY after `insertNew` resolved:
   * a throw leaves the batch's fate unknown, and remembering it then would
   * suppress the retry that recovers it.
   */
  remember(filings: readonly Filing[]): void {
    for (const filing of filings) {
      // Delete-then-add would make this a recency cache. It is deliberately
      // insertion-ordered instead: a seqId re-offered on every one of the next
      // 28,800 polls must not hold itself in memory forever.
      if (!this.seen.has(filing.seqId)) this.seen.add(filing.seqId);
    }
    this.evict();
  }

  /** How many ids are currently held. For tests and diagnostics. */
  size(): number {
    return this.seen.size;
  }

  private evict(): void {
    while (this.seen.size > this.capacity) {
      const oldest = this.seen.values().next();
      if (oldest.done === true) return;
      this.seen.delete(oldest.value);
    }
  }
}
