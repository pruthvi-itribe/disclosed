import { decodeHtmlEntities } from '../logic/html-entities';
import { parseBseDate } from './bse-date';
import type {
  BseAnnouncement,
  BseAnnouncementPage,
  BseRawPage,
  BseRawRecord,
} from './bse.types';

/**
 * Where BSE serves announcement attachments.
 *
 * `AttachLive`, verified on the wire. The obvious sibling `AttachHis` answers
 * 404 for a current filing — and answers it with 8,405 bytes of HTML error
 * page, which is worth knowing about: any check of the form "did bytes come
 * back" passes on that response. Only the status says whether a document
 * arrived.
 */
export const BSE_ATTACHMENT_BASE =
  'https://www.bseindia.com/xml-data/corpfiling/AttachLive';

/**
 * A filename this module is willing to put in a URL.
 *
 * BSE supplies the name and the result is fetched, so the name is untrusted
 * input to a request. Restricted to the shape BSE actually sends — a GUID with
 * an extension — which excludes a path separator, a scheme, a protocol-relative
 * prefix and a traversal by construction rather than by blocklist.
 */
const ATTACHMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]{1,8}$/;

const trimmed = (value: unknown): string | null =>
  typeof value === 'string' ? value.trim() || null : null;

/** Announcement prose, entity-decoded before the blank check as on the NSE side. */
const text = (value: unknown): string | null => {
  const raw = trimmed(value);
  return raw === null ? null : decodeHtmlEntities(raw).trim() || null;
};

/**
 * BSE sends the scrip code as a number. A digit string is the same identifier
 * and is accepted; anything else is not a scrip code and the record is dropped
 * rather than admitted under an invented one.
 */
const scripCodeOf = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const raw = trimmed(value);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * The advertised attachment size, or null.
 *
 * NULL AND ZERO ARE DIFFERENT ANSWERS and are kept different. Zero is a size a
 * document could plausibly have; "BSE stated nothing" is not a size at all.
 * Collapsing them would make an unstated value look like an empty file to any
 * duplicate check keyed on size — and the size is the cheapest cross-exchange
 * duplicate signal there is, because it costs no download.
 */
const attachmentBytesOf = (value: unknown): number | null => {
  // The absent case is settled BEFORE any arithmetic, because `Number(null)` is
  // 0 and `Number(undefined)` is NaN — so routing an absent value through the
  // numeric path turns "BSE said nothing" into "BSE said zero bytes" for one of
  // them and not the other. That is the exact conflation this function exists
  // to prevent, and it survived into the first draft of the function itself.
  if (typeof value !== 'number') {
    const raw = trimmed(value);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

const attachmentUrlOf = (value: unknown): string | null => {
  const name = trimmed(value);
  if (name === null || !ATTACHMENT_NAME.test(name)) return null;
  return `${BSE_ATTACHMENT_BASE}/${name}`;
};

/** Parses a BSE timestamp, or returns null. Never throws for the caller. */
const instantOf = (value: unknown): Date | null => {
  const raw = trimmed(value);
  if (raw === null) return null;
  try {
    return parseBseDate(raw);
  } catch {
    return null;
  }
};

/**
 * Maps one raw BSE record, or returns null when it cannot be mapped.
 *
 * NULL RATHER THAN A THROW. A page carries eleven announcements and one
 * malformed row must cost that row, not the poll — the same rule the NSE mapper
 * follows. What must never happen is a row being dropped without anybody being
 * able to count it, which is `mapBsePage`'s job.
 *
 * The required set is deliberately small: an identity, a company, a category, a
 * name and a dissemination instant. Everything else BSE sends is optional
 * because it was observed null on real rows.
 */
export function mapBseAnnouncement(
  raw: BseRawRecord,
  ingestedAt: Date,
): BseAnnouncement | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const newsId = trimmed(raw.NEWSID);
  const scripCode = scripCodeOf(raw.SCRIP_CD);
  const companyName = text(raw.SLONGNAME);
  // The fine taxonomy is the resolution NSE's `desc` sits at and the one the
  // category-group table was built against. The broad one is a fallback, not a
  // parent: a "Company Update" may be a presentation, a press release or
  // neither, so both are carried.
  const categoryName = text(raw.CATEGORYNAME);
  const category = text(raw.SUBCATNAME) ?? categoryName;
  const disseminatedAt = instantOf(raw.DissemDT);

  if (
    newsId === null ||
    scripCode === null ||
    companyName === null ||
    category === null ||
    disseminatedAt === null
  ) {
    return null;
  }

  return {
    newsId,
    scripCode,
    companyName,
    category,
    categoryName,
    // NEWSSUB is the subject line and HEADLINE the body; either is a usable
    // summary and an announcement with neither is still a real announcement.
    summary: text(raw.NEWSSUB) ?? text(raw.HEADLINE) ?? category,
    attachmentUrl: attachmentUrlOf(raw.ATTACHMENTNAME),
    attachmentBytes: attachmentBytesOf(raw.Fld_Attachsize),
    // `announcedAt` may fall back; `disseminatedAt` may not. The second is the
    // clock every latency figure and alert window is measured against, and a
    // guessed one is worse than a dropped record.
    announcedAt: instantOf(raw.NEWS_DT) ?? disseminatedAt,
    disseminatedAt,
    ingestedAt,
  };
}

/**
 * Reads BSE's `ROWCNT`, which is how many rows exist for the WHOLE query.
 *
 * This is the field that makes a BSE day provably complete. The NSE lane cannot
 * ask the question — its feed is a rolling window over a global counter, so
 * completeness is inferred from page overlap and was only trusted after being
 * measured across 935,125 polls. BSE states it outright.
 *
 * Which is exactly why it is never guessed. A fabricated count would turn a
 * proof back into an assumption while still looking like a proof.
 */
const rangeCountOf = (value: unknown): number | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first: unknown = value[0];
  if (typeof first !== 'object' || first === null) return null;
  const count: unknown = (first as Record<string, unknown>).ROWCNT;
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
    ? count
    : null;
};

/**
 * Maps a whole page, counting what it could not map.
 *
 * `skipped` is not diagnostics. It is the number that distinguishes "BSE had a
 * quiet afternoon" from "BSE changed its payload and we have been ingesting
 * nothing since", and those two states are otherwise identical from the outside.
 */
export function mapBsePage(
  raw: BseRawPage,
  ingestedAt: Date,
): BseAnnouncementPage {
  const rows: unknown = raw?.Table;
  if (!Array.isArray(rows)) {
    return { announcements: [], totalForRange: null, skipped: 0 };
  }

  const announcements: BseAnnouncement[] = [];
  let skipped = 0;

  for (const row of rows) {
    const mapped =
      typeof row === 'object' && row !== null
        ? mapBseAnnouncement(row as BseRawRecord, ingestedAt)
        : null;
    if (mapped === null) {
      skipped += 1;
      continue;
    }
    announcements.push(mapped);
  }

  return {
    announcements,
    totalForRange: rangeCountOf(raw?.Table1),
    skipped,
  };
}
