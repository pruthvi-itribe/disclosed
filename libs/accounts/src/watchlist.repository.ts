import type { Model } from 'mongoose';
import type { WatchlistDocument, WatchlistEntry } from './account.schemas';
import { MAX_WATCHED_SYMBOLS } from './watchlist-cap';

/** Why an add did not add. Each is a different answer to the caller. */
export type AddOutcome = 'added' | 'already-present' | 'full';

/**
 * Every read and write against `watchlists`.
 *
 * ONE DOCUMENT PER USER, so "show me my watchlist" is one `findOne` — the
 * common read is the cheapest one.
 *
 * EVERY MUTATION IS AN ATOMIC ARRAY OPERATOR, never a read-modify-write. Two
 * tabs adding two symbols at the same moment would both read the same array and
 * the second write would drop the first's entry; `$push` under a filter and
 * `$pull` cannot do that. It is also what makes the cap real: the size check is
 * part of the update's own filter, so it is evaluated against the document at
 * write time rather than against a copy read a moment earlier.
 */
export class WatchlistRepository {
  constructor(private readonly watchlists: Model<WatchlistDocument>) {}

  /** The whole watchlist, oldest entry first. Empty when nothing was ever added. */
  async entriesFor(userId: string): Promise<readonly WatchlistEntry[]> {
    const found = await this.watchlists
      .findOne({ userId })
      .lean<WatchlistDocument>()
      .exec();
    return found?.entries ?? [];
  }

  /**
   * Adds a symbol, or says why it did not.
   *
   * THE FILTER CARRIES BOTH RULES:
   *
   *   - `'entries.symbol': {$ne: symbol}` — on an array field this means "no
   *     element equals this", which makes the add idempotent. A double-click is
   *     not an error, and re-adding must not move the `addedAt` a reader can
   *     see. (This is not the `$ne: null` the house rule forbids: that one is
   *     forbidden because it MATCHES an empty array when asking about
   *     existence. Here an empty array correctly means "not present".)
   *   - `$expr: {$lt: [{$size: '$entries'}, cap]}` — the cap, evaluated
   *     server-side against the document being written.
   *
   * A miss is therefore either "already there" or "full", and one read tells
   * them apart. Doing that read FIRST instead would be a check-then-act with a
   * window in it.
   */
  async add(
    userId: string,
    symbol: string,
    now: Date,
  ): Promise<{ outcome: AddOutcome; used: number }> {
    // The document is created here rather than by an upsert on the guarded
    // update below: an upsert whose filter names `entries.symbol` would insert
    // that path as a field on the new document.
    await this.watchlists
      .updateOne(
        { userId },
        { $setOnInsert: { userId, entries: [], updatedAt: now } },
        { upsert: true },
      )
      .exec();

    const result = await this.watchlists
      .updateOne(
        {
          userId,
          'entries.symbol': { $ne: symbol },
          $expr: { $lt: [{ $size: '$entries' }, MAX_WATCHED_SYMBOLS] },
        },
        {
          $push: { entries: { symbol, addedAt: now } },
          $set: { updatedAt: now },
        },
      )
      .exec();

    const entries = await this.entriesFor(userId);
    if (result.modifiedCount > 0) {
      return { outcome: 'added', used: entries.length };
    }

    return {
      outcome: entries.some((entry) => entry.symbol === symbol)
        ? 'already-present'
        : 'full',
      used: entries.length,
    };
  }

  /**
   * Removes a symbol. Absent is not an error, for the same reason a double-add
   * is not: the caller asked for a state, and the state is what it gets.
   */
  async remove(
    userId: string,
    symbol: string,
    now: Date,
  ): Promise<{ used: number }> {
    await this.watchlists
      .updateOne(
        { userId },
        { $pull: { entries: { symbol } }, $set: { updatedAt: now } },
      )
      .exec();

    return { used: (await this.entriesFor(userId)).length };
  }
}
