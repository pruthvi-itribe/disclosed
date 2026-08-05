import type { Model } from 'mongoose';
import type { FilingDocument } from '@app/filings';

/**
 * The filings collection, narrowed to the four methods that cannot write.
 *
 * THIS TYPE IS THE READ-ONLY GUARANTEE, expressed so the compiler enforces it
 * rather than a comment asking nicely. `FilingQueryService` is handed one of
 * these, not a `Model`, so `updateOne`, `deleteMany`, `insertMany`,
 * `findOneAndUpdate`, `bulkWrite` and the rest are not merely discouraged in
 * this application — they do not exist on the object it holds, and a call to
 * one is a compile error, not a code-review finding.
 *
 * `aggregate` is the one member here that COULD write, through a `$out` or
 * `$merge` stage. Every pipeline in this app is `$match`/`$group`/`$sort` and
 * is written literally at the call site, never assembled from request input,
 * so no caller can introduce one.
 *
 * The dashboard shares a database with a live ingest process. A stray write
 * from a viewer would not just corrupt a row, it would corrupt the poller's
 * cursor — `getMaxSeqId` reads the same collection — and re-drain or skip a
 * day of filings.
 */
export type FilingReadModel = Pick<
  Model<FilingDocument>,
  'find' | 'findOne' | 'countDocuments' | 'aggregate'
>;
