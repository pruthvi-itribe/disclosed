import type { Model } from 'mongoose';
import type { Filing } from '../filing.types';
import type { FilingDocument } from './filing.schema';

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/** The subset of a bulk-write error this repository is willing to interpret. */
interface BulkWriteFailure {
  readonly code?: number;
  readonly writeErrors?: ReadonlyArray<{
    readonly index?: number;
    readonly code?: number;
    readonly err?: { readonly index?: number; readonly code?: number };
  }>;
  /** Mongoose's record of the documents that actually reached the collection. */
  readonly insertedDocs?: ReadonlyArray<{ readonly seqId?: unknown }>;
}

export class FilingRepository {
  constructor(private readonly model: Model<FilingDocument>) {}

  /**
   * Inserts filings, returning ONLY those that did not already exist.
   *
   * The return value is what gates alerting: an alert fires on insert, never on
   * a record we have already seen. Using unordered insertMany plus duplicate-key
   * filtering keeps that decision atomic at the database, so a restart mid-poll
   * cannot re-alert.
   *
   * Contract:
   * - The result is a subset of `filings`, in the caller's order, holding the
   *   caller's own objects. It is never a database echo, so it carries no `_id`
   *   and no mongoose document machinery.
   * - Every returned filing is in the collection. Rows already present are
   *   absent from the result, as are rows this call could not prove it wrote.
   * - Anything other than a fully-accounted set of duplicate rejections THROWS.
   *   A caller must not read a throw as "nothing new" — some rows may have been
   *   written, and the batch's outcome is unknown until the error is dealt with.
   *
   * @throws when the write fails, or succeeds in a way that leaves any filing
   * unaccounted for. Silence is never an option: a swallowed error here means a
   * filing lost with no alert and no trace.
   */
  async insertNew(filings: readonly Filing[]): Promise<Filing[]> {
    if (filings.length === 0) return [];

    let insertedCount: number;
    try {
      // throwOnValidationError is load-bearing. Without it mongoose drops
      // documents that fail schema validation, resolves as though the batch
      // were clean, and the filing is gone with no error anywhere.
      const docs = await this.model.insertMany(filings, {
        ordered: false,
        throwOnValidationError: true,
      });
      insertedCount = docs.length;
    } catch (error) {
      const inserted = this.extractInserted(error, filings);
      if (inserted === null) throw error;
      return inserted;
    }

    if (insertedCount !== filings.length) {
      throw new Error(
        `insertMany reported ${insertedCount} inserted document(s) for a batch of ` +
          `${filings.length} filing(s) and raised no error; refusing to guess which were written`,
      );
    }

    return [...filings];
  }

  /**
   * The persisted cursor the poller resumes from.
   *
   * @returns the highest stored seqId, or null when the collection is empty.
   * `0` is a VALID cursor and is returned as `0` — callers must null-check, not
   * truthiness-check, or a stored seqId of 0 reads as "no cursor" and re-drains
   * the whole day on every poll.
   */
  async getMaxSeqId(): Promise<number | null> {
    const top = await this.model
      .findOne({}, { seqId: 1 })
      .sort({ seqId: -1 })
      .lean()
      .exec();

    return top?.seqId ?? null;
  }

  /**
   * Works out which filings a failed insertMany actually wrote, or returns null
   * when that cannot be established beyond doubt — in which case the caller
   * rethrows.
   *
   * Mongoose removes documents that fail validation BEFORE sending the batch,
   * so the driver's write-error indexes count positions in that filtered array,
   * not in `filings`. Matching on those indexes silently returns the wrong rows
   * whenever a batch carries both an invalid row and a duplicate — it can hand
   * back a filing we already had, which is exactly the re-alert this repository
   * exists to prevent. Mongoose's `insertedDocs` is index-free and is therefore
   * the only signal trusted here.
   */
  private extractInserted(
    error: unknown,
    filings: readonly Filing[],
  ): Filing[] | null {
    const bulk = error as BulkWriteFailure;
    const { writeErrors, insertedDocs } = bulk;

    // Not a bulk-write failure at all: a connection or validation error.
    if (!Array.isArray(writeErrors) || !Array.isArray(insertedDocs))
      return null;
    if (writeErrors.length === 0) return null;

    // A row rejected for any other reason failed to persist for a reason worth
    // surfacing; dropping it quietly from the result would lose it in silence.
    const allDuplicates = writeErrors.every(
      (we) => (we.err?.code ?? we.code ?? bulk.code) === DUPLICATE_KEY,
    );
    if (!allDuplicates) return null;

    // Every filing must be either written or rejected as a duplicate. A batch
    // that does not add up has lost a row somewhere the driver did not report.
    if (insertedDocs.length + writeErrors.length !== filings.length)
      return null;

    return this.matchInserted(filings, insertedDocs);
  }

  /**
   * Maps written documents back onto the caller's filings by seqId, consuming
   * each written seqId once so a batch carrying the same seqId twice returns
   * the single copy that won. Returns null if any written row cannot be matched.
   */
  private matchInserted(
    filings: readonly Filing[],
    insertedDocs: ReadonlyArray<{ readonly seqId?: unknown }>,
  ): Filing[] | null {
    const remaining = new Map<number, number>();
    for (const doc of insertedDocs) {
      if (typeof doc.seqId !== 'number') return null;
      remaining.set(doc.seqId, (remaining.get(doc.seqId) ?? 0) + 1);
    }

    const inserted = filings.filter((filing) => {
      const left = remaining.get(filing.seqId) ?? 0;
      if (left === 0) return false;
      remaining.set(filing.seqId, left - 1);
      return true;
    });

    return inserted.length === insertedDocs.length ? inserted : null;
  }
}
