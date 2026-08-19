/**
 * The abbreviations a filing uses and a reader may not, in plain words.
 *
 * MEASURED BEFORE IT WAS BUILT, over the 3,461 claim texts in the
 * direction corpus (2026-08-19): 40% of claims carry at least one of the
 * terms below. YoY 17.2%, FY26-style years 16.1%, EBITDA 8.1%, PAT 5.6%,
 * Q1FY27-style quarters 5.4%, then a long tail under 1.5% each. The
 * legal boilerplate a first read blames — "record date" 1.6%,
 * "preferential issue" 0.3%, regulation citations 0.1% — is rare enough
 * that a glossary for it would be furniture. This list is the answer to
 * "too much terminology" because it is where the terminology actually
 * is; fourteen entries reach two in five cards.
 *
 * THE DEFINITIONS ARE OURS AND SAY SO. They describe what a WORD means,
 * never what a filing said — no definition may name a company, a number
 * or an outcome, because that would be a claim about the document
 * arriving without a matched span. The verbatim gate is untouched: the
 * document's own words stay on screen exactly as they were, and this
 * layer only appears when a reader asks for it.
 */

export interface Jargon {
  /** What matches in the claim text. Word-bounded, case-sensitive. */
  readonly pattern: RegExp;
  /** How the term is titled in the explainer. */
  readonly term: (matched: string) => string;
  /** One line, plain, about the word and nothing else. */
  readonly plain: string;
}

export const JARGON: readonly Jargon[] = [
  {
    pattern: /\bYoY\b/,
    term: () => 'YoY',
    plain: 'Year on year — this quarter against the same quarter last year.',
  },
  {
    pattern: /\bQoQ\b/,
    term: () => 'QoQ',
    plain: 'Quarter on quarter — this quarter against the one before it.',
  },
  {
    pattern: /\bQ[1-4]\s?FY\d{2}\b/,
    term: (m) => m,
    plain:
      'A quarter of an Indian financial year, which runs April to March: Q1 is April-June.',
  },
  {
    pattern: /\bFY\s?\d{2,4}\b/,
    term: (m) => m,
    plain:
      'An Indian financial year, April to March. FY26 ended in March 2026.',
  },
  {
    pattern: /\bEBITDA\b/,
    term: () => 'EBITDA',
    plain:
      'Earnings before interest, tax, depreciation and amortisation — profit from operations, before financing and accounting charges.',
  },
  {
    pattern: /\bPAT\b/,
    term: () => 'PAT',
    plain: 'Profit after tax — what is left after every cost, including tax.',
  },
  {
    pattern: /\bPBT\b/,
    term: () => 'PBT',
    plain: 'Profit before tax.',
  },
  {
    pattern: /\bEPS\b/,
    term: () => 'EPS',
    plain: 'Earnings per share — profit divided by the number of shares.',
  },
  {
    pattern: /\bbps\b/,
    term: () => 'bps',
    plain:
      'Basis points. One hundred of them make one percentage point, so 50 bps is half a point.',
  },
  {
    pattern: /\bAUM\b/,
    term: () => 'AUM',
    plain: 'Assets under management — the money a firm manages for others.',
  },
  {
    pattern: /\bQIP\b/,
    term: () => 'QIP',
    plain:
      'Qualified institutional placement — new shares sold to institutions rather than to the public.',
  },
  {
    pattern: /\bESOP\b/,
    term: () => 'ESOP',
    plain: 'Employee stock option plan — shares issued to staff.',
  },
  {
    pattern: /\b(?:AGM|EGM)\b/,
    term: (m) => m,
    plain:
      'A shareholders’ meeting: the annual one, or an extraordinary one called between them.',
  },
  {
    pattern: /\bCAGR\b/,
    term: () => 'CAGR',
    plain:
      'Compound annual growth rate — the average yearly rate over several years.',
  },
  {
    pattern: /\b(?:G?NPA)\b/,
    term: (m) => m,
    plain:
      'Non-performing assets — loans a lender is not being repaid on. Gross NPA counts them before provisions.',
  },
  {
    pattern: /\b(?:ROE|ROCE)\b/,
    term: (m) => m,
    plain:
      'A return ratio: profit measured against the equity, or the capital, used to earn it.',
  },
  {
    pattern: /\bMTPA\b/,
    term: () => 'MTPA',
    plain: 'Million tonnes per annum — a plant’s yearly capacity.',
  },
  {
    pattern: /\b(?:MW|GWh)\b/,
    term: (m) => m,
    plain:
      'Power units: MW is capacity at an instant, GWh is energy over time.',
  },
];

/** One regex over the whole list, so a claim is scanned once. */
export const JARGON_PATTERN = new RegExp(
  JARGON.map((entry) => entry.pattern.source).join('|'),
  'g',
);

/** The entry a matched token belongs to, or null when none claims it. */
export const jargonFor = (token: string): Jargon | null =>
  JARGON.find((entry) =>
    new RegExp(`^(?:${entry.pattern.source})$`).test(token),
  ) ?? null;
