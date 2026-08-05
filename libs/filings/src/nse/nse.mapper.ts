import type { Filing } from '../filing.types';
import { parseNseDate } from './nse-date';
import type { NseRawRecord } from './nse.types';

const nullIfBlank = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Converts a raw NSE announcement record into the Filing domain entity.
 * Pure: no clock reads beyond `ingestedAt`, no IO.
 *
 * Throws on a malformed record. The NSE payload is untrusted JSON and
 * `NseRawRecord` is a compile-time shape only, so the one field with a
 * downstream runtime contract - `category`, which `isRoutine` calls `.trim()`
 * on - is checked here. Callers are expected to catch per record and skip.
 */
export function mapNseRecord(
  raw: NseRawRecord,
  ingestedAt = new Date(),
): Filing {
  if (typeof raw.desc !== 'string') {
    throw new Error(
      `Malformed NSE record: "desc" must be a string, got ${typeof raw.desc}`,
    );
  }

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
