/**
 * Deciding whether a BSE announcement and an NSE filing are the same event.
 *
 * WHY THIS IS NOT `isin === isin`. That was the obvious key and it fails
 * silently. Measured over the companies on one BSE page: the full ISIN agreed
 * on 6 of 8, and the two that disagreed — BRITANNIA and LUPIN — disagreed only
 * in the last three characters (INE216A01014 against INE216A01030). Those three
 * digits carry the face value, so a stock split mints a new ISIN, and NSE's
 * announcement feed was serving the OLD one for both. An exact-ISIN join would
 * have declared a quarter of the market's dual-filed announcements distinct and
 * paid to extract each of them twice.
 *
 * The first nine characters — country, issuer, security type — agreed on 8 of
 * 8. That is the company, which is the thing being matched.
 *
 * WHY THE PREFIX IS NOT ENOUGH ON ITS OWN. It identifies a company, not an
 * announcement, and a company files several times a day: LUPIN filed a deck, a
 * press release and a board outcome inside nine minutes. So the prefix selects
 * candidates and two further pieces of evidence decide between them.
 */
import type { Filing } from '../filing.types';
import type { BseAnnouncement } from './bse.types';

/**
 * How much of an ISIN identifies the company rather than the security series.
 *
 * `INE216A01` + `014`. Country (2), issuer (5), security type (2) — then the
 * series digits that a face-value change rewrites.
 */
export const ISIN_COMPANY_CHARS = 9;

/**
 * How far apart the same announcement may be disseminated by the two exchanges.
 *
 * MEASURED, and the number is uncomfortable. Across eight matched pairs on one
 * morning the gaps ran 62s, 76s, 201s, 283s, 376s, 479s, 1466s and 1672s —
 * neither exchange consistently first, and the worst nearly 28 minutes. Ninety
 * minutes clears the largest observed gap by 3.2x.
 *
 * It is deliberately generous because of what each error costs. A window too
 * narrow splits one announcement into two and we pay a model call twice and
 * publish the same fact twice, which is the failure a reader sees. A window too
 * wide can only ever admit a candidate that must then also match on size or on
 * category — this bound never decides anything by itself.
 */
export const DISSEMINATION_WINDOW_MS = 90 * 60 * 1000;

/** The company part of an ISIN, or null when there is not enough of one. */
export const isinCompanyKey = (
  isin: string | null | undefined,
): string | null => {
  if (typeof isin !== 'string') return null;
  const trimmed = isin.trim().toUpperCase();
  return trimmed.length >= ISIN_COMPANY_CHARS
    ? trimmed.slice(0, ISIN_COMPANY_CHARS)
    : null;
};

/**
 * Normalises a company name for comparison.
 *
 * The fallback when no ISIN is available for a scrip, and only ever a fallback:
 * BSE writes `Kokuyo Camlin Ltd-$` where NSE writes `Kokuyo Camlin Limited`,
 * and the suffix soup (`Ltd`, `Limited`, `-$`, `.`) is exactly what makes name
 * matching unreliable enough to need the ISIN in the first place.
 */
export const companyKey = (name: string | null | undefined): string | null => {
  if (typeof name !== 'string') return null;
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(ltd|limited|the|and|co|corp|corporation|inc|plc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? null : cleaned;
};

/** How confident the pairing is, and what made it so. */
export type MatchConfidence =
  /** Same company AND the exchanges advertise the same byte count. */
  | 'same-document'
  /** Same company, same category, inside the window. No size to compare. */
  | 'same-event'
  /** Same company inside the window, nothing else agreeing. */
  | 'same-company'
  | 'none';

export interface CrossExchangeCandidate {
  /** Company key both sides resolved to, for the report. */
  readonly key: string;
  readonly confidence: MatchConfidence;
  /** Signed gap: positive when BSE disseminated FIRST. */
  readonly bseLeadMs: number;
  readonly sizeAgrees: boolean;
  readonly categoryAgrees: boolean;
}

/** What the caller knows about the NSE side, plus the BSE ISIN it looked up. */
export interface MatchInput {
  readonly filing: Pick<
    Filing,
    'isin' | 'companyName' | 'category' | 'disseminatedAt'
  >;
  /** Bytes the NSE attachment weighed, when the fetcher recorded it. */
  readonly filingBytes: number | null;
  readonly announcement: BseAnnouncement;
  /** ISIN resolved for the announcement's scrip code, when one is known. */
  readonly announcementIsin: string | null;
  readonly windowMs?: number;
}

/**
 * Normalises a category to the coarse shape the two exchanges agree on.
 *
 * They do not share a taxonomy. NSE says `Investor Presentation` and BSE says
 * `Investor Presentation` for the same event but `Press Release / Media
 * Release` where NSE says `Press Release`, and `AGM` where NSE says
 * `Shareholders meeting`. Comparing the raw strings would report agreement only
 * where the two happen to have chosen identical words, so this compares the
 * words they share rather than the whole label.
 */
const categoryWords = (raw: string): ReadonlySet<string> =>
  new Set(
    raw
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );

const categoriesAgree = (a: string, b: string): boolean => {
  const left = categoryWords(a);
  const right = categoryWords(b);
  if (left.size === 0 || right.size === 0) return false;
  for (const word of left) if (right.has(word)) return true;
  return false;
};

/**
 * Scores one BSE announcement against one NSE filing.
 *
 * NEVER RETURNS BETTER THAN `same-company` ON THE COMPANY ALONE. The whole
 * point of tiering the answer is that the caller decides what is safe to act
 * on: suppressing a model call on `same-document` costs nothing if wrong except
 * a missed duplicate, while treating `same-company` as identity would collapse
 * a company's three filings in one morning into one.
 */
export function matchAcrossExchanges(
  input: MatchInput,
): CrossExchangeCandidate {
  const { filing, announcement } = input;
  const windowMs = input.windowMs ?? DISSEMINATION_WINDOW_MS;

  // ISIN prefix first, company name only when a scrip has no ISIN resolved.
  const nseKey = isinCompanyKey(filing.isin);
  const bseKey = isinCompanyKey(input.announcementIsin);
  const key =
    nseKey !== null && bseKey !== null && nseKey === bseKey
      ? nseKey
      : ((): string | null => {
          const left = companyKey(filing.companyName);
          const right = companyKey(announcement.companyName);
          return left !== null && left === right ? left : null;
        })();

  // Positive means BSE was first, which is the direction a reader cares about.
  const bseLeadMs =
    filing.disseminatedAt.getTime() - announcement.disseminatedAt.getTime();

  const none: CrossExchangeCandidate = {
    key: key ?? '',
    confidence: 'none',
    bseLeadMs,
    sizeAgrees: false,
    categoryAgrees: false,
  };

  if (key === null) return none;
  if (Math.abs(bseLeadMs) > windowMs) return none;

  // Both sides must have stated a size. Absent is not agreement — treating
  // "neither exchange said" as a match would promote every pair with no size
  // to the strongest tier, which is exactly backwards.
  const sizeAgrees =
    input.filingBytes !== null &&
    announcement.attachmentBytes !== null &&
    input.filingBytes === announcement.attachmentBytes;

  const categoryAgrees = categoriesAgree(
    filing.category,
    announcement.category,
  );

  if (sizeAgrees) {
    return {
      key,
      confidence: 'same-document',
      bseLeadMs,
      sizeAgrees,
      categoryAgrees,
    };
  }
  if (categoryAgrees) {
    return {
      key,
      confidence: 'same-event',
      bseLeadMs,
      sizeAgrees,
      categoryAgrees,
    };
  }
  return {
    key,
    confidence: 'same-company',
    bseLeadMs,
    sizeAgrees,
    categoryAgrees,
  };
}

/**
 * Picks the best pairing for one announcement out of several candidates.
 *
 * A company files repeatedly in a morning, so several NSE filings can sit
 * inside the window. Ranked by confidence and then by closeness in time, which
 * is the only tie-breaker available that does not require reading either
 * document.
 */
const RANK: Readonly<Record<MatchConfidence, number>> = {
  'same-document': 3,
  'same-event': 2,
  'same-company': 1,
  none: 0,
};

export function bestMatch(
  candidates: readonly CrossExchangeCandidate[],
): CrossExchangeCandidate | null {
  let best: CrossExchangeCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.confidence === 'none') continue;
    if (best === null) {
      best = candidate;
      continue;
    }
    const better = RANK[candidate.confidence] - RANK[best.confidence];
    if (
      better > 0 ||
      (better === 0 && Math.abs(candidate.bseLeadMs) < Math.abs(best.bseLeadMs))
    ) {
      best = candidate;
    }
  }
  return best;
}
