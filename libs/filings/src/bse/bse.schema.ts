import { Schema, type HydratedDocument } from 'mongoose';
import type { BseAnnouncement } from './bse.types';

export type BseAnnouncementDocument = HydratedDocument<BseAnnouncement>;

/**
 * The BSE shadow collection.
 *
 * SEPARATE FROM `filings`, AND THAT IS THE DESIGN RATHER THAN A STAGING STEP.
 * The `filings` collection is keyed on `seqId` — NSE's global counter, unique
 * index, and the field the no-loss guarantee is argued from. BSE has no
 * equivalent: its identity is a GUID with no ordering. Merging the two would
 * mean either inventing a seqId for BSE rows or rewriting the uniqueness model
 * that the most heavily measured guarantee in this codebase sits on, and doing
 * either before the duplicate rate has been measured would be changing the part
 * we understand to accommodate the part we do not.
 *
 * So BSE lands here, the NSE lane is untouched, and the overlap between them
 * becomes a thing that can be counted rather than assumed. What that count says
 * decides whether these ever merge.
 */
export const BseAnnouncementSchema = new Schema<BseAnnouncement>(
  {
    /**
     * BSE's GUID. Unique, and the collection's newness authority — the same
     * role `seqId` plays for NSE, minus the ordering.
     *
     * The ordering is what does NOT transfer, and it matters: NSE's rollover
     * detection asks "is the oldest id on this page above my cursor", which is
     * a question about a monotonic counter. There is no such question to ask
     * here. Completeness on this side comes from BSE's own ROWCNT instead, and
     * it is a stronger answer — stated by the exchange rather than inferred
     * from page overlap.
     */
    newsId: { type: String, required: true, unique: true, index: true },
    /**
     * BSE scrip code. The only machine identifier for the company in the
     * announcement payload — there is NO ISIN in it, which is why the
     * cross-exchange join needs a scrip lookup and cannot be done from this
     * record alone.
     */
    scripCode: { type: Number, required: true, index: true },
    companyName: { type: String, required: true },
    category: { type: String, required: true, index: true },
    categoryName: { type: String, default: null },
    summary: { type: String, default: '' },
    attachmentUrl: { type: String, default: null },
    /**
     * What BSE says the attachment weighs, stated before anything is fetched.
     *
     * NULL AND ZERO MEAN DIFFERENT THINGS HERE and the mapper keeps them
     * different. This is the cheapest cross-exchange duplicate signal available
     * — verified exact against the wire, 4,439,475 advertised and 4,439,475
     * served — and a duplicate check keyed on size must be able to tell "BSE
     * stated nothing" from "BSE stated an empty file".
     */
    attachmentBytes: { type: Number, default: null },
    announcedAt: { type: Date, required: true },
    disseminatedAt: { type: Date, required: true, index: true },
    ingestedAt: { type: Date, required: true },
  },
  { collection: 'bse_announcements', versionKey: false },
);

/**
 * Serves the overlap query, which asks for one company's announcements around
 * a given instant.
 *
 * Scrip code alone would scan every announcement a company has ever made, and
 * a company filing daily accumulates those without bound — the same reason the
 * NSE side indexes symbol with a date rather than symbol alone.
 */
BseAnnouncementSchema.index(
  { scripCode: 1, disseminatedAt: -1 },
  { name: 'scripCode_1_disseminatedAt_-1' },
);

/**
 * Serves the day drain and every "what arrived recently" read.
 */
BseAnnouncementSchema.index(
  { disseminatedAt: -1 },
  { name: 'disseminatedAt_-1' },
);
