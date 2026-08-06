/**
 * What scale a results table is denominated in, read from the table's own words.
 *
 * ================================================================
 * WHY THE SCALE IS NEVER CONVERTED, AND NEVER ASSUMED
 * ================================================================
 *
 * The cells of a results statement are bare numbers. `73,977.90` means seventy
 * four billion rupees or seven hundred and forty crore depending entirely on a
 * line of text printed above the table — `₹ Million`, `(₹ in Crores)`,
 * `Rs. in Lakhs` — and nothing inside the cell says which.
 *
 * That is the same hazard `amount-hazards.ts` already refuses on for the amount
 * lane: a unit-less figure takes its scale from its surroundings, so a document
 * that re-denominates any of its tables can silently re-denominate this one. The
 * amount lane's answer is to refuse. Here the table's scale is genuinely
 * recoverable, so the answer is to read it — from a bounded neighbourhood of the
 * table's own column header, refusing when nothing declares it and refusing when
 * two declarations in reach disagree.
 *
 * WHAT IS NEVER DONE IS ARITHMETIC. A table in millions is published in
 * millions. The competitor's line for the same filing reads
 * `Q1 REVENUE 74B RUPEES`, which is `73,977.90` million rescaled and rounded;
 * this pipeline prints `₹73,977.90 MN`, because the rescale is a calculation the
 * filing did not perform. The abbreviation of the filer's own declared word —
 * `Million` to `MN`, `Crores` to `CR` — is typography, the same class of change
 * as collapsing whitespace to match a span: no digit moves and no scale changes.
 */

import type { ResultsMetric } from './results.types';

/** The scales a results table is written in, and how each is spelled on the wire. */
export const SCALE_TOKENS: Readonly<Record<string, string>> = {
  crore: 'CR',
  crores: 'CR',
  lakh: 'LAKH',
  lakhs: 'LAKH',
  lac: 'LAKH',
  lacs: 'LAKH',
  million: 'MN',
  millions: 'MN',
  billion: 'BN',
  billions: 'BN',
  thousand: 'THOUSAND',
  thousands: 'THOUSAND',
};

/**
 * A currency marker followed by a scale word.
 *
 * The currency marker is REQUIRED. `million` on its own appears in prose — "a
 * million units", "one in a million" — and reading a table's denomination out of
 * a sentence is how a figure ends up three orders of magnitude wrong.
 *
 * The alternation is GENERATED from the keys of `SCALE_TOKENS`, longest first so
 * `crores` is not cut short by `crore`. Written out by hand it would be a second
 * list to keep in step with the first, and the failure mode of their drifting
 * apart is a scale word this recognises and cannot name.
 */
const SCALE_WORDS = Object.keys(SCALE_TOKENS)
  .sort((left, right) => right.length - left.length)
  .join('|');

const SCALE_DECLARATION = new RegExp(
  String.raw`(?:₹|Rs\.?|INR|rupees)\s*(?:in\s+)?['’]?\s*(${SCALE_WORDS})\b`,
  'gi',
);

/** One scale declaration, located. */
export interface ScaleDeclaration {
  readonly offset: number;
  /** Exactly as the document writes it. */
  readonly raw: string;
  /** `CR`, `LAKH`, `MN`, `BN`, `THOUSAND`. */
  readonly token: string;
}

/** How far above a column header a scale declaration may sit. */
export const SCALE_REACH = 400;

/** Every scale declaration in a document, in the order written. NEVER THROWS. */
export function scaleDeclarationsIn(
  documentText: string,
): readonly ScaleDeclaration[] {
  const found: ScaleDeclaration[] = [];
  for (const match of documentText.matchAll(SCALE_DECLARATION)) {
    // Indexed directly rather than guarded: the pattern's alternation is
    // generated from nothing but the keys of this table, so a miss is not a
    // case this can be in — and an unreachable guard is a claim nobody can
    // check. A test asserts the two stay in step.
    const token = SCALE_TOKENS[match[1].toLowerCase()];
    found.push({ offset: match.index, raw: match[0].trim(), token });
  }
  return found;
}

export type GoverningScale =
  | {
      readonly outcome: 'ok';
      readonly token: string;
      readonly evidence: string;
    }
  | { readonly outcome: 'none'; readonly detail: string };

/**
 * The scale governing the table whose column header sits at `headerOffset`.
 *
 * The window runs from `reach` characters above the header to the END of the
 * header, because filers write the denomination both ways — `₹ Million` on its
 * own line above the dates, and `PARTICULARS (₹ in Lakhs)` inside the header row
 * itself.
 *
 * Returns `none` rather than a default when nothing declares a scale, and when
 * two declarations in the window disagree. A default would be this module
 * choosing a magnitude the document did not state.
 */
export function governingScale(
  documentText: string,
  headerOffset: number,
  headerLength: number,
  reach: number = SCALE_REACH,
): GoverningScale {
  const from = Math.max(0, headerOffset - reach);
  const to = headerOffset + headerLength;
  const inReach = scaleDeclarationsIn(documentText).filter(
    (declaration) => declaration.offset >= from && declaration.offset <= to,
  );

  if (inReach.length === 0) {
    return {
      outcome: 'none',
      detail:
        `no currency scale is declared in the ${reach} characters above the ` +
        `table's column header`,
    };
  }

  const tokens = [...new Set(inReach.map((declaration) => declaration.token))];
  if (tokens.length > 1) {
    return {
      outcome: 'none',
      detail: `two scales are declared over this table: ${tokens.join(', ')}`,
    };
  }

  const nearest = inReach[inReach.length - 1];
  return { outcome: 'ok', token: nearest.token, evidence: nearest.raw };
}

/**
 * Metrics whose unit comes from the ROW rather than from the table's scale.
 *
 * A statement denominated in millions still prints earnings per share in rupees
 * per share and a margin in per cent — the scale header does not reach those
 * rows, and applying it would publish `₹5.52 MN` for an EPS of five rupees
 * fifty-two. So those two metrics take their unit from their own row and are
 * refused when the row does not declare one.
 */
export const ROW_SCOPED_UNIT_METRICS: ReadonlySet<ResultsMetric> =
  new Set<ResultsMetric>(['eps', 'ebitda-margin']);

/** A currency marker in a row, which is what an EPS row declares. */
export const ROW_CURRENCY = /(?:₹|Rs\.?|INR)/;
/** A per-cent marker in a row, which is what a margin row declares. */
export const ROW_PERCENT = /%|per\s*cent/i;
