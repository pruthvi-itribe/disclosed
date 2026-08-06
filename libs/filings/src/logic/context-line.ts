import { istDayKey } from '@app/common';

/**
 * The second line: one factual, auditable statement about where this filing
 * sits among the filings already stored.
 *
 * WHAT THIS MODULE MAY SAY is deliberately narrow. It counts rows and compares
 * stored numbers, and it says only what those two operations support:
 *
 *     "3rd order for PANACEABIO in 30 days"
 *     "largest order for PANACEABIO in the last 30 days"
 *     "first credit-rating action for PANACEABIO since 12-Jul"
 *
 * WHAT IT MAY NEVER SAY: anything predictive, any direction, any valuation, any
 * advice. There is no sentiment word in this file and there must never be one.
 * A count is a fact; "bullish" is a recommendation wearing a fact's clothes,
 * and this pipeline publishes about named listed companies.
 *
 * THE COVERAGE GUARD IS THE HONESTY CONTROL. "Largest in the last 30 days" is
 * a claim about thirty days of data. A database holding two days of filings
 * cannot support it, and stating it anyway would be the most confident lie the
 * system is capable of — every word true, the whole sentence false. So every
 * window is clamped to the data actually held, and a window too short to be
 * worth stating produces no line at all.
 */

/** Below this many covered days, no windowed claim is made at all. */
export const MIN_CONTEXT_WINDOW_DAYS = 2;

/** The window the context line asks about, unless the data is shorter. */
export const DEFAULT_CONTEXT_WINDOW_DAYS = 30;

const MONTHS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * `12-Jul`, in IST.
 *
 * Derived from `istDayKey` rather than from the Date's own fields, so the one
 * IST definition in `libs/common` is the only place the offset lives. A date
 * rendered from a UTC getter would name the previous day for anything filed
 * before 05:30 IST, which is most of the pre-open window.
 */
export function istDayLabel(value: Date): string {
  const [, month, day] = istDayKey(value).split('-');
  return `${day}-${MONTHS[Number(month) - 1]}`;
}

/** `1st`, `2nd`, `3rd`, `4th`, `11th`, `21st`, `111th`. */
export function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] ?? 'th';
  return `${value}${suffix}`;
}

/**
 * Everything the context line is allowed to know. All of it is counted from
 * stored filings by `EnrichmentRepository`; nothing here reads a database.
 */
export interface ContextFacts {
  readonly symbol: string;
  /**
   * The countable-event noun for this filing's category, from
   * `action-phrase.ts`. Null means the category has no countable event, and no
   * context line is produced — "3rd corrigendum" is a sentence nobody needs.
   */
  readonly noun: string | null;
  /** The window that was asked about, in IST days. */
  readonly windowDays: number;
  /**
   * IST days of filings the collection actually holds, ending now. Every claim
   * is clamped to this, because a claim about a window is a claim about data.
   */
  readonly coverageDays: number;
  /** Same symbol AND category, disseminated inside the window, before this one. */
  readonly priorInWindow: number;
  /** The newest same symbol+category filing BEFORE the window, or null. */
  readonly lastPriorAt: Date | null;
  /** This filing's own verified amount, or null. */
  readonly amountRupees: number | null;
  /** Priors in the window that carry a verified amount of their own. */
  readonly priorsWithAmount: number;
  /** Of those, how many are at least as large as this filing's amount. */
  readonly priorsAtLeastAsLarge: number;
}

/**
 * The context line, or null.
 *
 * NULL IS A FIRST-CLASS RESULT and by far the most common one. A filing from a
 * symbol nothing is known about, in a category with no countable event, or on a
 * collection two days old produces no line — and the alert is simply shorter.
 *
 * Rules are tried in descending order of how much they tell a reader who
 * already knows the filing happened. The size comparison first, because "the
 * largest in a month" is the only one of these that speaks to materiality; then
 * the running count; then the break in a quiet run.
 */
export function contextLine(facts: ContextFacts): string | null {
  const {
    symbol,
    noun,
    windowDays,
    coverageDays,
    priorInWindow,
    lastPriorAt,
    amountRupees,
    priorsWithAmount,
    priorsAtLeastAsLarge,
  } = facts;

  if (noun === null) return null;

  const days = Math.min(windowDays, Math.floor(coverageDays));
  if (!Number.isFinite(days) || days < MIN_CONTEXT_WINDOW_DAYS) return null;

  // Largest-so-far, stated only against other filings that carry a verified
  // figure. "Largest of one" is not a comparison, so at least one prior must
  // have an amount of its own to be larger than.
  if (
    amountRupees !== null &&
    priorsWithAmount >= 1 &&
    priorsAtLeastAsLarge === 0
  ) {
    return `largest ${noun} for ${symbol} in the last ${days} days`;
  }

  if (priorInWindow >= 1) {
    return `${ordinal(priorInWindow + 1)} ${noun} for ${symbol} in ${days} days`;
  }

  // Nothing inside the window, but something before it: the run being broken is
  // itself the fact. The date is a stored filing's own timestamp, so the claim
  // is exactly "our records hold none between then and now".
  if (lastPriorAt !== null) {
    return `first ${noun} for ${symbol} since ${istDayLabel(lastPriorAt)}`;
  }

  // Nothing at all is known about this symbol in this category. Saying "first
  // ever" would be a claim about the exchange's history, which this collection
  // is not.
  return null;
}
