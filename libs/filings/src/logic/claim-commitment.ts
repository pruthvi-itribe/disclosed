/**
 * The dated commitments a verified claim's span printed, and only the ones
 * still ahead.
 *
 * ================================================================
 * WHAT THIS IS FOR
 * ================================================================
 *
 * A company page can say what a company HAS said. This is the one thing it can
 * honestly say about what happens NEXT: a record date, an annual general
 * meeting, an e-voting window, a book closure — appointments the filing itself
 * printed, in the filing's own words, on a day a reader can put in a calendar.
 *
 * Nothing here is a forecast and nothing here is derived. The rule reads the
 * span — the document's own bytes, already matched character for character by
 * `claim-span.ts` — finds a word that names an appointment and a date beside
 * it, and returns both so the page can quote the one and show the other. That
 * is the same discipline `claim-plan.ts` follows, for the same reason: a
 * derived line is admissible only when a reader can check it without opening
 * the PDF.
 *
 * ================================================================
 * WHY A WORD LIST AND NOT JUST A DATE
 * ================================================================
 *
 * Measured over all 4,679 stored claims on 2026-08-08: 574 (12.3%) print a
 * date in some shape, and most of those dates are the past. They are the
 * quarter a figure belongs to ("cash of ₹389.7 crore as on June 30, 2026"), the
 * year a dividend is for, the day a board already met. A section headed
 * "what's next" that listed them would be a page of history under a heading
 * about the future.
 *
 * So both conditions have to hold — the sentence names an appointment AND
 * prints a day still ahead. Of the 4,679 claims, 150 carry one of the phrases
 * below; 93 of those also carry a future date, and they yield 106 dates across
 * 50 of the 1,286 companies held. That is 3.9% of companies, and the section is
 * absent for the rest, which is the section working.
 *
 * ================================================================
 * WHY NOT A GENERIC FUTURE TENSE
 * ================================================================
 *
 * `will be held` / `to be held` would add 18 more dates and is refused for the
 * reason `claim-plan.ts` refuses `will` and `shall`: it is the tense a sentence
 * happens to be written in rather than a thing being scheduled. Every date it
 * adds beyond the list below is already reached through the meeting phrase in
 * the same sentence, so it buys coverage only where the sentence never named
 * what the appointment is — which is exactly where the page could not say what
 * a reader is turning up for.
 */

/**
 * The words a filing uses when it is scheduling something.
 *
 * Each count is how many claims that phrase is the DECIDING one for — the
 * first of the list found in the span — measured over the live collection on
 * 2026-08-08 against an IST day of 2026-08-08. Re-measure rather than re-guess:
 *
 *   record date 53   annual general meeting 20   AGM 9
 *   closure of the register 4   book closure 3
 *   cut-off date 4 (3 hyphenated, 1 not — which is why the hyphen is optional)
 *   e-voting 0   board meeting 0   EGM 0   postal ballot 0
 *
 * THE FOUR ZEROS ARE KEPT AND ARE NOT AN OVERSIGHT. They are the same class of
 * event as the phrases above them, they are what NSE's own intimation
 * categories are named after, and in a 32-day corpus a board-meeting notice
 * usually reports a meeting that already happened. A zero here costs nothing
 * measurable: a phrase that never matched has admitted no wrong date. If one
 * starts firing wrongly, this comment is where the next editor looks.
 *
 * Written as regular-expression sources because the inflections matter, and
 * EVERY GAP IS `\s+` rather than a space — a span carries the line breaks of
 * the PDF page it was set on, and `claim-plan.ts` records the breakage that
 * followed from assuming otherwise.
 */
const COMMITMENT_PHRASES: readonly string[] = [
  'record\\s+date',
  '(?:annual|extra[-\\s]?ordinary)\\s+general\\s+meeting',
  'AGM',
  'EGM',
  'e-?\\s*voting',
  'board\\s+meeting',
  'meeting\\s+of\\s+the\\s+board',
  'book\\s+closure',
  'closure\\s+of\\s+the\\s+register',
  'cut[-\\s]?off\\s+date',
  'postal\\s+ballot',
];

/**
 * The same rule as one word-bounded pattern.
 *
 * A CONSTANT, never assembled from caller input, so it is a fixed predicate
 * rather than a pattern a request chose.
 */
export const COMMITMENT_SPAN_PATTERN = `\\b(?:${COMMITMENT_PHRASES.join('|')})\\b`;

/** Month names as a filing spells them, full or abbreviated. */
const MONTH_NAMES = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const MONTH = `(?:${MONTH_NAMES})[a-z]*`;

/**
 * The two date shapes worth reading, and nothing else.
 *
 * Measured over the 574 dated claims: `September 25, 2026` accounts for 443 and
 * `25th September, 2026` for 111 — 96.5% between them. The numeric forms
 * (`25.09.2026`, `25-09-2026`, `25/09/2026`) total 23, and they are refused
 * rather than read because nothing in the token says which number is the day:
 * `05.09.2026` is the 5th of September to an Indian filer and the 9th of May to
 * a spreadsheet, and there is no way to tell them apart from inside the string.
 * A wrong appointment date about a named listed company is the kind of harm
 * this pipeline exists to refuse, and 4% more coverage does not buy it.
 */
const DATE_PATTERN = new RegExp(
  `\\b(?:(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})` +
    `|(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH}),?\\s+(\\d{4}))\\b`,
  'ig',
);

/**
 * What a date is NOT an appointment after.
 *
 * One family of phrases, and it is in the list because it fires: RAIN's record
 * date sits in a sentence that also names "the Financial Year ending December
 * 31, 2026", which is a period boundary rather than a day anybody attends. Three
 * of the 109 dates that otherwise survive are that one sentence, and a reporting
 * period listed under "what's next" is a wrong fact rather than a thin one.
 *
 * Anchored at the end, and read against the 45 characters before the date, so
 * it only ever fires on the words immediately in front of it.
 */
const PERIOD_BOUNDARY =
  /(?:year|quarter|period|half[-\s]?year)\s+(?:ended|ending)\s*(?:on\s*)?$/i;

/** How far back of a date is read for the period phrase above. */
const LOOKBEHIND_CHARS = 45;

/** The one day-key shape this compares against — what `istDayKey` returns. */
const IST_DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** One appointment a filing printed, and the words that put it here. */
export interface DatedCommitment {
  /** The IST calendar day the document named, as `YYYY-MM-DD`. */
  readonly date: string;
  /** The document's own characters for the date. */
  readonly dateText: string;
  /** The document's own word that made this a commitment rather than a date. */
  readonly evidence: string;
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const monthIndex = (word: string): number =>
  MONTH_NAMES.split('|').indexOf(word.toLowerCase().slice(0, 3));

/**
 * A day key for a named month, day and year — or null when no calendar has it.
 *
 * ROUND-TRIPPED THROUGH `Date.UTC` rather than range-checked by hand, because
 * that is the check that also knows about February. A PDF that dropped a digit
 * prints `September 31, 2026`, which parses cleanly and is not a day.
 */
const dayKey = (
  monthWord: string,
  day: string,
  year: string,
): string | null => {
  const month = monthIndex(monthWord);
  if (month < 0) return null;

  const yearNumber = Number(year);
  const dayNumber = Number(day);
  const at = new Date(Date.UTC(yearNumber, month, dayNumber));
  if (
    at.getUTCFullYear() !== yearNumber ||
    at.getUTCMonth() !== month ||
    at.getUTCDate() !== dayNumber
  ) {
    return null;
  }

  return `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
};

/**
 * Every appointment in one claim's span that is still ahead, soonest first.
 *
 * `todayIstDay` is what `istDayKey(now)` returns and is compared as a string,
 * which is exact for this format and needs no second timezone implementation —
 * IST is server-owned and defined in one place. A value of another shape THROWS
 * rather than returning nothing: the failure it would otherwise cause is every
 * past date admitted as upcoming, which is the loudest thing this rule can get
 * wrong and the quietest way to get it wrong.
 *
 * An empty list means the span names no appointment, or names one whose day has
 * passed. The caller does not need to tell those apart — both end with the
 * sentence not appearing under a heading about what happens next.
 */
export function datedCommitments(
  span: string,
  todayIstDay: string,
): readonly DatedCommitment[] {
  if (!IST_DAY_KEY.test(todayIstDay)) {
    throw new Error(
      `datedCommitments needs an IST day key shaped YYYY-MM-DD, but was given "${todayIstDay}".`,
    );
  }
  if (typeof span !== 'string' || span.trim() === '') return [];

  const text = collapse(span);
  const commitment = new RegExp(COMMITMENT_SPAN_PATTERN, 'i').exec(text);
  if (commitment === null) return [];

  const found = new Map<string, DatedCommitment>();
  const dates = new RegExp(DATE_PATTERN.source, DATE_PATTERN.flags);
  let match = dates.exec(text);
  while (match !== null) {
    const [
      whole,
      leadingMonth,
      dayAfter,
      yearAfter,
      dayFirst,
      trailingMonth,
      yearBefore,
    ] = match;
    const date =
      leadingMonth === undefined
        ? dayKey(trailingMonth, dayFirst, yearBefore)
        : dayKey(leadingMonth, dayAfter, yearAfter);

    const before = text.slice(
      Math.max(0, match.index - LOOKBEHIND_CHARS),
      match.index,
    );
    if (date !== null && date > todayIstDay && !PERIOD_BOUNDARY.test(before)) {
      // First mention wins, so a sentence that repeats one appointment is one
      // entry rather than two identical ones.
      if (!found.has(date)) {
        found.set(date, { date, dateText: whole, evidence: commitment[0] });
      }
    }
    match = dates.exec(text);
  }

  return [...found.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
