/**
 * Raw record shape returned by BSE's `AnnSubCategoryGetData` endpoint.
 *
 * TYPED FROM A LIVE PAYLOAD, not from documentation, and every field here was
 * observed on 2026-08-07. The endpoint answers with `{ Table: [...], Table1:
 * [{ ROWCNT }] }`; `Table` carries the announcements and `Table1` carries the
 * count for the whole date range, which is what makes a BSE day provably
 * complete rather than inferred (see `BseAnnouncementPage`).
 *
 * Almost everything is optional. BSE returns nulls liberally — `QUARTER_ID`,
 * `BSENEWSID`, `RECORDID` and `AUDIO_VIDEO_FILE` were null on every row of the
 * sample — and a payload that adds or drops a field must not stop the lane, so
 * only the fields the mapper genuinely requires are non-optional here and the
 * mapper re-checks all of them at runtime anyway.
 */
export interface BseRawRecord {
  /** BSE's own identity: a GUID, with no ordering. */
  NEWSID?: unknown;
  /** BSE scrip code, e.g. 500825 for Britannia. A number, not a string. */
  SCRIP_CD?: unknown;
  /** Company long name. There is NO ISIN anywhere in this payload. */
  SLONGNAME?: unknown;
  /** The announcement's subject line. */
  NEWSSUB?: unknown;
  /** Broad taxonomy, e.g. "Company Update". */
  CATEGORYNAME?: unknown;
  /** Fine taxonomy, e.g. "Investor Presentation". Closest to NSE's `desc`. */
  SUBCATNAME?: unknown;
  /** Body text. `MORE` and `HEADLINE` carried identical text in the sample. */
  HEADLINE?: unknown;
  MORE?: unknown;
  /** Dissemination instant, IST with no zone marker. The authoritative clock. */
  DissemDT?: unknown;
  /** Announcement instant, same format. */
  NEWS_DT?: unknown;
  DT_TM?: unknown;
  News_submission_dt?: unknown;
  /** PDF filename, served from `AttachLive`. Empty string when there is none. */
  ATTACHMENTNAME?: unknown;
  /**
   * Attachment size in bytes, stated BEFORE anything is downloaded.
   *
   * Verified against the wire: BSE advertised 4,439,475 for Britannia's deck
   * and the file served exactly that. This is the cheapest cross-exchange
   * duplicate signal available — it costs no fetch — though it cannot catch a
   * re-signed document, where the signature timestamp moves the byte count by a
   * handful (LUPIN filed the same deck twice at 21,545 and 21,546 characters).
   */
  Fld_Attachsize?: unknown;
  /** Total pages for the query, repeated on every row. */
  TotalPageCnt?: unknown;
}

/** The envelope: announcements plus the range's own row count. */
export interface BseRawPage {
  Table?: unknown;
  Table1?: unknown;
}

/**
 * One announcement, normalised, and deliberately NOT a `Filing`.
 *
 * `Filing` is NSE-shaped: it requires a numeric `seqId` that is the collection's
 * unique key, and an `isin`, and BSE supplies neither. Forcing this into that
 * shape would mean inventing both — a fabricated identity in the field the
 * no-loss guarantee is built on, and a fabricated ISIN in the field any future
 * cross-exchange join has to trust. So the BSE lane keeps its own record and its
 * own collection until the duplicate rate has been measured against real
 * overlap rather than assumed.
 */
export interface BseAnnouncement {
  /** BSE's GUID. Unique per announcement; carries no ordering. */
  newsId: string;
  /** BSE scrip code. The only machine identifier for the company in the feed. */
  scripCode: number;
  companyName: string;
  /** `SUBCATNAME` when present, else `CATEGORYNAME`. */
  category: string;
  /** The broad taxonomy, kept separately because the two are not a hierarchy. */
  categoryName: string | null;
  summary: string;
  attachmentUrl: string | null;
  /** What BSE says the attachment weighs, or null when it says nothing. */
  attachmentBytes: number | null;
  announcedAt: Date;
  /** Authoritative clock, as on the NSE side. */
  disseminatedAt: Date;
  ingestedAt: Date;
}

/**
 * A page of announcements, with the count that makes completeness provable.
 *
 * `totalForRange` is BSE's own `ROWCNT` for the whole query, not for this page.
 * The NSE lane cannot ask this question — its feed is a rolling window over a
 * global counter, so completeness is inferred from page overlap and was only
 * trusted after being measured over 935,125 polls. BSE simply states it, so the
 * drain can assert it has everything instead of arguing that it probably does.
 */
export interface BseAnnouncementPage {
  readonly announcements: readonly BseAnnouncement[];
  /** Rows BSE says exist for the query, across all pages. Null if unstated. */
  readonly totalForRange: number | null;
  /** Records present in `Table` that could not be mapped. Never silent. */
  readonly skipped: number;
}
