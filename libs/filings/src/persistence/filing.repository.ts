import type { Model } from 'mongoose';
import type { Filing } from '../filing.types';
import type { FilingDocument } from './filing.schema';

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/** MongoDB "collection does not exist" error code. */
const NAMESPACE_NOT_FOUND = 26;

/** The shape of a listed index that this repository inspects. */
interface IndexDescription {
  readonly key?: Record<string, unknown>;
  readonly unique?: boolean;
}

/** The subset of a bulk-write error this repository is willing to interpret. */
interface BulkWriteFailure {
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
   * PRECONDITION: the collection MUST carry the unique index on `seqId`. This
   * method does not decide for itself whether a filing is new — it asks the
   * database to reject the ones it already has. Without that index nothing is
   * rejected, every re-seen filing is written again AND returned as new, and
   * the alert gate inverts: a restart re-alerts the whole day, which is the one
   * failure this repository exists to prevent. The failure is silent, so call
   * `assertIndexes()` at startup rather than trusting the deployment.
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
   * The newest dissemination timestamp held, which anchors the drain range.
   *
   * Deliberately NOT the timestamp of the record with the highest seqId. NSE
   * disseminates out of seq_id order, so those are different records — and the
   * question a drain asks is "how far forward in TIME do we have evidence
   * for", which only the timestamp answers.
   *
   * @returns the maximum stored `disseminatedAt`, or null when the collection
   * is empty. A null means a cold start: there is no earlier IST day the drain
   * has any evidence for, so it reconciles today alone.
   */
  async getMaxDisseminatedAt(): Promise<Date | null> {
    const top = await this.model
      .findOne({}, { disseminatedAt: 1 })
      .sort({ disseminatedAt: -1 })
      .lean()
      .exec();

    return top?.disseminatedAt ?? null;
  }

  /**
   * Verifies the precondition insertNew rests on: a unique index on `seqId`
   * present in the DATABASE, not merely declared on the schema. Call it once at
   * startup, before polling.
   *
   * It deliberately does NOT create the index. A missing one means the running
   * database is not what this code assumes, and the consequence — an inverted
   * alert gate that re-alerts a day of filings after a restart — is silent
   * enough that it must fail loudly rather than be repaired underneath the
   * operator.
   *
   * @throws when the collection has no unique, single-field index on `seqId`,
   * including when the collection does not exist yet.
   */
  async assertIndexes(): Promise<void> {
    const indexes = await this.listIndexes();

    const hasUniqueSeqId = indexes.some(
      (index) =>
        index.unique === true &&
        index.key !== undefined &&
        Object.keys(index.key).length === 1 &&
        index.key.seqId !== undefined,
    );

    if (hasUniqueSeqId) return;

    throw new Error(
      `collection "${this.model.collection.collectionName}" has no unique index on seqId. ` +
        'insertNew does not decide for itself whether a filing is new: it asks the database ' +
        'to reject the ones it already holds. Without that index nothing is rejected, every ' +
        're-seen filing is written again AND returned as new, and a restart re-alerts the ' +
        'whole day. Build the index (for example with syncIndexes()) before polling.',
    );
  }

  private async listIndexes(): Promise<readonly IndexDescription[]> {
    try {
      return await this.model.collection.indexes();
    } catch (error) {
      // A collection that does not exist yet has no indexes either, and the
      // remedy is the same. Any other failure — connection, auth — belongs to
      // the caller and must not be flattened into "the index is missing".
      if ((error as { code?: number }).code === NAMESPACE_NOT_FOUND) return [];
      throw error;
    }
  }

  /**
   * Works out which filings a failed insertMany actually wrote, or returns null
   * when that cannot be established beyond doubt — in which case the caller
   * rethrows.
   *
   * The ACCOUNTING CHECK below is the load-bearing guard. Mongoose removes
   * documents that fail validation BEFORE sending the batch and reports no
   * per-row error for them, so those rows appear in neither `writeErrors` nor
   * `insertedDocs`. The complement of `writeErrors` therefore includes rows that
   * were never written: for `[invalid(20), duplicate(10), new(30)]` it yields
   * seqIds 20 and 30, and 20 does not exist in the database at all. Alerting on
   * it would announce a filing we do not have. Requiring written + rejected to
   * equal the batch size is what detects the discrepancy.
   *
   * (Mongoose remaps the TOP-LEVEL write-error index back to the caller's array
   * before the error escapes — lib/model.js, via validDocIndexToOriginalIndex —
   * so those indexes are not filtered-relative; only the nested `err.index` is.
   * When nothing is filtered out the remap is the identity and index-matching
   * and seqId-matching provably agree.)
   *
   * `matchInserted` is then defence in depth: `insertedDocs` is index-free, so
   * the mapping cannot go wrong even if a future driver reports indexes this
   * code does not expect.
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
    // The batch-level code is deliberately NOT consulted: it belongs to whichever
    // row failed first, so inferring it for a row whose own report carries no
    // code would file that row under "duplicate" and discard it.
    const allDuplicates = writeErrors.every(
      (we) => (we.err?.code ?? we.code) === DUPLICATE_KEY,
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
