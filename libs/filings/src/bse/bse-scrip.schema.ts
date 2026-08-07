import { Schema } from 'mongoose';

/**
 * One BSE scrip code and the ISIN it resolves to.
 *
 * WHY THIS IS A COLLECTION AND NOT A LOOKUP. BSE's announcement feed carries no
 * ISIN — only `SCRIP_CD` and a company long name — so every cross-exchange match
 * needs one extra request per company. Two days of announcements span 1,217
 * distinct scrip codes, which at the pacing this codebase reads exchanges with
 * is 16.2 minutes of requests. Per run. The first version of the overlap tool
 * did exactly that and it is the reason this exists.
 *
 * A scrip's ISIN changes about as often as a company restructures its equity,
 * so this is a cache with no expiry policy by design: a stale entry is corrected
 * by deleting it, and an entry that never changes costs one request ever.
 *
 * `isin` IS NULLABLE AND THE NULL IS THE POINT. A scrip BSE will not resolve —
 * a delisted company, a debt instrument, a code the quote API does not answer
 * for — must be remembered as unresolvable, or every run pays the same failing
 * request again for the same company forever. Null here means "asked, no
 * answer", which is different from absent, meaning "never asked".
 */
export interface BseScrip {
  scripCode: number;
  isin: string | null;
  companyName: string | null;
  resolvedAt: Date;
}

export const BseScripSchema = new Schema<BseScrip>(
  {
    scripCode: { type: Number, required: true, unique: true, index: true },
    isin: { type: String, default: null },
    companyName: { type: String, default: null },
    resolvedAt: { type: Date, required: true },
  },
  { collection: 'bse_scrips', versionKey: false },
);
