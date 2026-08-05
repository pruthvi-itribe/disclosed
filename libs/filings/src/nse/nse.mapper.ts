import type { Filing } from '../filing.types';
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

/** Bound on the untrusted seq_id echoed into error messages and logs. */
const MAX_LABELLED_SEQ_ID_LENGTH = 32;

const nullIfBlank = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Identifies the record in an error message: `seq_id=106725630` when usable,
 * `seq_id=unknown` when seq_id is itself the malformed field. Length-capped
 * because the value is untrusted and ends up in logs.
 */
const labelFor = (raw: NseRawRecord): string => {
  const seqId = typeof raw.seq_id === 'string' ? raw.seq_id.trim() : '';
  return seqId
    ? `seq_id=${seqId.slice(0, MAX_LABELLED_SEQ_ID_LENGTH)}`
    : 'seq_id=unknown';
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

  if (!Number.isFinite(Number(raw.seq_id))) {
    throw malformed(raw, 'seq_id', 'must parse to a finite number');
  }
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

  const announcedAt = parseNseDate(raw.an_dt);
  const disseminated = nullIfBlank(raw.exchdisstime);

  return {
    seqId: Number(raw.seq_id),
    symbol: raw.symbol,
    isin: raw.sm_isin,
    companyName: raw.sm_name,
    industry: nullIfBlank(raw.smIndustry),
    category: raw.desc,
    summary: nullIfBlank(raw.attchmntText) ?? '',
    attachmentUrl: nullIfBlank(raw.attchmntFile),
    announcedAt,
    // NSE occasionally omits exchdisstime; an_dt is the only honest fallback.
    disseminatedAt: disseminated ? parseNseDate(disseminated) : announcedAt,
    ingestedAt,
  };
}
