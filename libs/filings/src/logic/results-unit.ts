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

/**
 * How far above a column header a scale declaration may sit, in `pdf-parse`
 * output.
 *
 * NO SWEEP STANDS BEHIND THIS 400, and saying so is the point of these four
 * lines. It is `BASIS_HEADING_REACH`'s number, which measured the distance from
 * a statement HEADING to its column header in `pdf-parse` output — a different
 * pairing in the same text. It is left where it is rather than moved on a
 * guess: the on-disk text cache holds 9 results-eligible `pdf-parse` documents,
 * which is not a distribution. `DOCLING_SCALE_REACH` below is the one that was
 * measured, because that is where the refusals are.
 */
export const SCALE_REACH = 400;

/**
 * The same bound, for text Docling produced.
 *
 * ================================================================
 * WHAT PUTS A DECLARATION 1,784 CHARACTERS ABOVE ITS OWN TABLE
 * ================================================================
 *
 * Not the document. Docling emits markdown, and a wide statement's own header
 * row plus its separator row of dashes run to well over a thousand characters
 * of padding before the row carrying the column dates ever appears. ENERGYDEV
 * (seqId 106734890) prints `(Rs. in lakhs, unless otherwise stated)` directly
 * under its statement title and the dates land 1,784 characters later; ASHIANA
 * (seqId 106737436) prints `{INR in Lakhs except stated otherwise)` and the
 * dates land 1,097 later. That padding is the difference between the two
 * parsers on those documents: 91,233 characters against `pdf-parse`'s 46,036,
 * and 126,860 against 53,508. So the bound is a property of the parser, exactly
 * as `DOCLING_BASIS_HEADING_REACH` is, and 400 was never measured against this
 * output.
 *
 * MEASURED over 42 live results filings re-converted by `docling-serve` with
 * `do_ocr=false` — the production route and settings, and all 42 re-conversions
 * returned the exact character count the filing already had stored. 103 markdown
 * table headers (a row of pipes carrying two or more column dates, which is
 * what the extractor quotes as `columnsSpan`), paired with the nearest scale
 * declaration above them. 37 have none anywhere in the document; the other 66:
 *
 *     0, 0, 0, 0, 0, 0, 0, 14, 14, 15, 15, 175, 192, 270, 280, 287, 296, 309,
 *     310, 348, 351, 352, 355, 364, 365, 385, 446, 466, 469, 471, 496, 538,
 *     718, 978, 990, 1027, 1031, 1097, 1784, | 5070, 5847, 6263, 6405, 7105,
 *     7144, 7495, 8866, 9070, 9127, 9208, 9501, 11374, 11665, 12168, 13314,
 *     13905, 15285, 15640, 16816, 17614, 22217, 27604, 28555, 28989, 34892,
 *     101300
 *
 * The hole is 1,784 to 5,070 — 3,286 characters wide, where no other gap below
 * 17,000 exceeds 1,873. Everything above it is a table no declaration governs:
 * HGS's second statement (seqId 106731968) sits 5,070 characters below the only
 * `(Rs.in Crores)` above it with six notes about social-security codes, tax
 * proceedings and a dividend in between; MAN INDUSTRIES' consolidated SEGMENT
 * REPORT (seqId 106737655) sits 8,866 below its statement's `Rs. in Lakhs`.
 * Reaching those would be inheriting a magnitude across a document.
 *
 * 2,400 sits in the LOW half of that hole on purpose. It clears the furthest
 * genuine pairing by 1.35x and stops 2.1x short of the nearest ungoverned one,
 * and the asymmetry is the same one `results-basis.ts` argues: a table refused
 * is a line nobody sees, a table scaled from someone else's declaration is a
 * wrong number about a named listed company. On this sample 2,000, 2,400 and
 * 3,000 are indistinguishable — 39 of 103 headers read, against 26 at 400 — and
 * 4,000 starts pulling a SECOND, disagreeing declaration into reach on 2 of
 * them, which the gate refuses. It is the same number as
 * `DOCLING_BASIS_HEADING_REACH` and that is a coincidence of two distributions
 * rather than a copy: the basis gap runs 2,370 to 2,948 and this one runs 1,784
 * to 5,070.
 *
 * WHAT THIS DOES NOT FIX, so the next reader does not expect 59 refusals to
 * vanish. Of the six `unit-not-determinable` filings in the sample, one
 * (KPIGREEN, seqId 106736172) gains a readable scale here; the other five
 * declare none anywhere, and no reach reaches what is not written. SENCO (seqId
 * 106737696) writes `(Amount in millions, unless otherwise stated)`, which
 * `SCALE_DECLARATION` deliberately refuses without a currency marker. The other
 * four are worse and are a defect of their own: Docling loses the rupee glyph
 * on those documents, so OIL's `₹ 289.56 crore` arrives as `t 289.56 crore`,
 * HINDCOPPER's declaration as `(f in crore except EPS)`, TITAN's as
 * `~20,753 crores` and NAUKRI's as `, 142.72 million`. That is a reading
 * problem, not a distance problem, and this constant cannot answer it.
 */
export const DOCLING_SCALE_REACH = 2_400;

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
