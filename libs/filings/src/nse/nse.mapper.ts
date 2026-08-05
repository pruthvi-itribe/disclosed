import type { Filing } from '../filing.types';
import { decodeHtmlEntities } from '../logic/html-entities';
import { safeEcho } from '../logic/safe-echo';
import { parseNseDate } from './nse-date';
import type { NseRawRecord } from './nse.types';

/**
 * Fields NSE must supply for a record to yield a well-formed Filing. Each must
 * be present and a non-empty string. Every other field on NseRawRecord is
 * genuinely optional and is normalised rather than rejected.
 */
const REQUIRED_STRING_FIELDS: ReadonlyArray<keyof NseRawRecord> = [
  'seq_id',
  'symbol',
  'sm_name',
  'sm_isin',
  'desc',
  'an_dt',
];

/**
 * NSE sequence ids are plain digit strings. Hex, decimals and scientific
 * notation all coerce to some number, but not the one the exchange issued, so
 * they are rejected rather than silently accepted as a different record.
 */
const SEQ_ID_PATTERN = /^\d+$/;

/**
 * Normalises an optional field to a trimmed string or null.
 *
 * Takes `unknown` on purpose: the NSE payload is untrusted JSON, so an
 * optional field can hold anything. Non-string junk is absent data, not an
 * error - coercing it to null keeps the record mappable, where an earlier
 * `value?.trim()` threw a bare TypeError naming neither field nor record.
 */
const nullIfBlank = (value: unknown): string | null =>
  typeof value === 'string' ? value.trim() || null : null;

/**
 * Normalises announcement text, decoding HTML entities before the blank check.
 *
 * Order matters: NSE escapes its text, so a summary of `&nbsp;` carries no
 * content but is not blank until decoded. Decoding first makes it normalise to
 * '' like any other empty summary instead of surviving as literal markup.
 */
const decodedOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? nullIfBlank(decodeHtmlEntities(value)) : null;

/**
 * Identifies the record in an error message: `seq_id=106725630` when usable,
 * `seq_id=unknown` when seq_id is itself the malformed field. Passed through
 * safeEcho because the value is untrusted and ends up in logs.
 */
const labelFor = (raw: NseRawRecord): string => {
  const seqId = nullIfBlank(raw.seq_id);
  return seqId ? `seq_id=${safeEcho(seqId)}` : 'seq_id=unknown';
};

/** Describes what arrived without echoing an untrusted value into the log. */
const describeValue = (value: unknown): string =>
  typeof value === 'string' ? 'a blank string' : typeof value;

const malformed = (raw: NseRawRecord, field: string, problem: string): Error =>
  new Error(`Malformed NSE record (${labelFor(raw)}): "${field}" ${problem}`);

/**
 * Rejects any record that cannot produce a well-formed Filing.
 *
 * The NSE payload is untrusted JSON and `NseRawRecord` is a compile-time shape
 * only, so this is the runtime boundary check. Two failures matter most: a
 * non-string `category` makes `isRoutine` throw far downstream, and a `seqId`
 * of NaN compares false against any cursor, so the record would be skipped
 * silently - a lost filing rather than a visible error.
 */
const assertWellFormed = (raw: NseRawRecord): void => {
  for (const field of REQUIRED_STRING_FIELDS) {
    const value = raw[field];
    if (typeof value !== 'string' || !value.trim()) {
      throw malformed(
        raw,
        field,
        `must be a non-empty string, got ${describeValue(value)}`,
      );
    }
  }
};

/**
 * Validates and returns the sequence id in one place, so the guarantee and the
 * value cannot drift apart.
 *
 * Must run after `assertWellFormed`, which establishes that seq_id is a
 * non-empty string. `Number.isSafeInteger` rather than `Number.isFinite`: ids
 * past MAX_SAFE_INTEGER collapse distinct values onto the same double, and two
 * filings that compare equal to the cursor means one of them is never emitted.
 */
const parseSeqId = (raw: NseRawRecord): number => {
  const text = raw.seq_id.trim();
  const seqId = Number(text);

  if (!SEQ_ID_PATTERN.test(text) || !Number.isSafeInteger(seqId)) {
    throw malformed(raw, 'seq_id', 'must parse to a safe integer');
  }

  return seqId;
};

/**
 * Converts a raw NSE announcement record into the Filing domain entity.
 * Pure: no clock reads beyond `ingestedAt`, no IO.
 *
 * Throws on a malformed record, naming the offending field and the seq_id so
 * that a caller catching per record logs something diagnosable. Callers are
 * expected to catch and skip per record rather than fail a whole page.
 */
export function mapNseRecord(
  raw: NseRawRecord,
  ingestedAt = new Date(),
): Filing {
  assertWellFormed(raw);

  const seqId = parseSeqId(raw);
  const announcedAt = parseNseDate(raw.an_dt);
  const disseminated = nullIfBlank(raw.exchdisstime);

  return {
    seqId,
    symbol: raw.symbol,
    isin: raw.sm_isin,
    companyName: raw.sm_name,
    industry: nullIfBlank(raw.smIndustry),
    category: raw.desc,
    summary: decodedOrNull(raw.attchmntText) ?? '',
    attachmentUrl: nullIfBlank(raw.attchmntFile),
    announcedAt,
    // NSE occasionally omits exchdisstime; an_dt is the only honest fallback.
    disseminatedAt: disseminated ? parseNseDate(disseminated) : announcedAt,
    ingestedAt,
  };
}
