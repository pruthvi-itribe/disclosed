import type { Model } from 'mongoose';
import type { BseAnnouncement } from './bse.types';

/** The shapes mongoose reports a partial bulk write through. */
interface BulkWriteFailure {
  readonly writeErrors?: ReadonlyArray<{
    readonly err?: { readonly index?: unknown };
    readonly index?: unknown;
  }>;
  readonly insertedDocs?: ReadonlyArray<{ readonly newsId?: unknown }>;
}

const DUPLICATE_KEY = 11000;

const codeOf = (error: unknown): number | null => {
  const code: unknown = (error as { code?: unknown })?.code;
  return typeof code === 'number' ? code : null;
};

/**
 * Stores BSE announcements, letting the unique index decide what is new.
 *
 * THE SAME AUTHORITY MODEL AS THE NSE SIDE, for the same reason. The whole page
 * is offered on every drain and the `newsId` unique index rejects what is
 * already held; nothing here compares timestamps or keeps a high-water mark to
 * decide newness. A cursor is a second opinion about what the database already
 * knows, and the two disagree exactly when it matters — after a crash, a
 * restart, or a page served out of order.
 */
export class BseRepository {
  constructor(private readonly model: Model<BseAnnouncement>) {}

  /**
   * Inserts the announcements not already held, and returns those it wrote.
   *
   * A duplicate key is the normal case, not an error: every drain re-offers a
   * whole day. Anything else is raised.
   *
   * @throws when the write fails, or succeeds in a way that leaves an
   * announcement unaccounted for. A swallowed error here is an announcement
   * lost with no trace — the same rule the filings repository holds to.
   */
  async insertNew(
    announcements: readonly BseAnnouncement[],
  ): Promise<BseAnnouncement[]> {
    if (announcements.length === 0) return [];

    let insertedCount: number;
    try {
      // `throwOnValidationError` is load-bearing here exactly as it is on the
      // NSE side: without it mongoose silently DROPS documents that fail schema
      // validation and resolves as though the batch were clean.
      const docs = await this.model.insertMany(announcements, {
        ordered: false,
        throwOnValidationError: true,
      });
      insertedCount = docs.length;
    } catch (error) {
      const inserted = this.extractInserted(error, announcements);
      if (inserted === null) throw error;
      return inserted;
    }

    if (insertedCount !== announcements.length) {
      throw new Error(
        `insertMany reported ${insertedCount} inserted document(s) for a batch of ` +
          `${announcements.length} announcement(s) and raised no error; ` +
          `refusing to guess which were written`,
      );
    }

    return [...announcements];
  }

  /**
   * Reads which of a partial bulk write actually landed.
   *
   * Returns null when the error is not a duplicate-key rejection, which the
   * caller rethrows. Every row must be accounted for as either inserted or
   * rejected-as-duplicate; a batch where the two do not add up is reported
   * rather than guessed at, because the alternative is quietly deciding an
   * announcement was stored when it was not.
   */
  private extractInserted(
    error: unknown,
    announcements: readonly BseAnnouncement[],
  ): BseAnnouncement[] | null {
    if (codeOf(error) !== DUPLICATE_KEY) return null;

    const failure = error as BulkWriteFailure;
    const writeErrors = failure.writeErrors ?? [];

    // Mongoose remaps the driver's filtered index back to the caller's array
    // index on the top-level `index` field; `err.index` is the unremapped one.
    // Preferring the top-level value is what makes this correct for a batch
    // where an earlier row also failed.
    const rejected = new Set<number>();
    for (const row of writeErrors) {
      const index = typeof row.index === 'number' ? row.index : row.err?.index;
      if (typeof index === 'number') rejected.add(index);
    }

    if (rejected.size !== writeErrors.length) {
      // An error row whose index could not be read means the complement below
      // would count it as inserted. Refuse rather than over-report.
      return null;
    }

    const inserted = announcements.filter(
      (_announcement, index) => !rejected.has(index),
    );

    // Defence in depth, and the same check the filings repository makes:
    // `insertedDocs` is written by the driver and is the one independent
    // account of what landed. Where it is present, it must agree.
    const insertedDocs = failure.insertedDocs;
    if (
      Array.isArray(insertedDocs) &&
      insertedDocs.length !== inserted.length
    ) {
      return null;
    }

    return inserted;
  }

  /**
   * Announcements for one company around an instant, for the overlap report.
   *
   * Scoped by scrip code AND a time window because the join it feeds is
   * "is this the same announcement", not "has this company ever filed" — and
   * an unbounded read of a daily filer grows without limit.
   */
  async around(
    scripCode: number,
    at: Date,
    windowMs: number,
  ): Promise<BseAnnouncement[]> {
    return (await this.model
      .find({
        scripCode,
        disseminatedAt: {
          $gte: new Date(at.getTime() - windowMs),
          $lte: new Date(at.getTime() + windowMs),
        },
      })
      .lean()
      .exec()) as unknown as BseAnnouncement[];
  }

  async count(): Promise<number> {
    return this.model.countDocuments({}).exec();
  }

  /**
   * Builds the declared indexes and fails if they cannot be built.
   *
   * Called at startup rather than trusting the deployment: `insertNew` delegates
   * its entire newness decision to the `newsId` unique index, so a collection
   * missing it does not error — it silently accepts every duplicate on every
   * drain, and a day re-drained forty-two pages deep would store thousands of
   * copies.
   */
  async assertIndexes(): Promise<void> {
    await this.model.createIndexes();
  }
}
