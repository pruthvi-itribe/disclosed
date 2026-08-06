/**
 * Fiscal period labels — `Q1`, `FY27`, `Q1 FY2027`, `9M FY26` — and why they are
 * not figures.
 *
 * ================================================================
 * THE BUG THIS MODULE EXISTS TO FIX
 * ================================================================
 *
 * `claim-numbers.ts` reads every run of digits in a claim as a figure the quoted
 * sentence must contain. Measured against the live DeepSeek run, that rule threw
 * away five real claims out of six discards, and every one of them failed the
 * same way:
 *
 *     claim: "Q1 FY27 revenue from operations rose 20.2% YoY to INR 15.4 billion"
 *     span : "Revenue from operations increased to INR 15.4 billion (+20.2% YoY)"
 *     verdict: states 1, 27, which the quoted source does not
 *
 * The figures were there. `1` and `27` are not figures — they are the digits
 * inside `Q1` and `FY27`, which name the PERIOD the sentence is about. A slide
 * deck states its period in the slide header and its numbers in the bullet, so
 * demanding the period inside the bullet's own sentence refuses the shape almost
 * every investor presentation is written in. Measured over 60 real eligible
 * documents: only 20.7% of figure-bearing sentences carry a period label inside
 * themselves.
 *
 * ================================================================
 * AND IT WAS ALSO TOO WEAK, WHICH IS THE HALF NOBODY NOTICED
 * ================================================================
 *
 * Reading `Q1` as the bare digit `1` does not only reject true claims — it
 * ACCEPTS false ones. A claim saying `Q1` is satisfied today by any stray `1` in
 * the sentence, and over those same 60 documents a bare `1` appears in 24.3% of
 * figure-bearing sentences, a bare `27` in 16.2%. So roughly one time in four a
 * claim could attribute a figure to the wrong quarter and the gate would agree,
 * because a `+1% YoY` somewhere in the sentence spelled the quarter for it.
 *
 * Matching the LABEL — `Q1` as `Q1`, not as `1` — is strictly stronger than
 * matching its digits, in both directions. That is the whole argument for this
 * module: it is not a relaxation with a good excuse, it is a sharper rule that
 * happens to accept the claims the blunt one refused.
 *
 * ================================================================
 * WHERE A PERIOD MAY BE READ FROM, AND WHY IT IS NOT THE DOCUMENT
 * ================================================================
 *
 * Figures stay strictly span-scoped. Periods are checked against the span first
 * and then against a BOUNDED NEIGHBOURHOOD of it, because that is where a
 * document states them and nowhere else is honest. Measured over the same 60
 * documents, the distinct period labels a claim could reach:
 *
 *     document-scope   mean 5.1   median 5   max 15
 *     +-800 characters mean 1.5   median 1   30% of positions reach none at all
 *
 * So the neighbourhood is roughly three and a half times more discriminating
 * than the document, and unlike the document it can answer "this region of the
 * filing states no period at all", which is the answer that refuses an invented
 * one. `PERIOD_CONTEXT_CHARS` is argued at its definition.
 *
 * NOTHING HERE APPLIES TO FIGURES. Widening the figure check to the same
 * neighbourhood was measured and rejected: a +-800 window carries 27.5 distinct
 * numbers against a sentence's 3.7, which is a 7.4x weaker check and exactly the
 * loosening this pipeline must not make.
 */

/** One period label, located in the text it was read from. */
export interface PeriodLabel {
  /** Index into the text this was found in. */
  readonly start: number;
  /** One past the last character, in the same coordinates. */
  readonly end: number;
  /** Exactly as the text writes it, whitespace and all. */
  readonly raw: string;
  /** The comparison key. See `canonicalPeriod`. */
  readonly canonical: string;
}

/**
 * How far either side of a quoted sentence a period label may be read from.
 *
 * 800 characters, and the number comes from the three real filings this fix was
 * built against rather than from taste. The distance from the quoted sentence
 * back to the heading that states its period measured 43 characters (ANUP's
 * `HIGHLIGHTS FOR Q1 FY27`), 272 (FSL's `Our FY27 guidance`) and 593 (TENNECO's
 * `18.4% Q1 FY2027 VAR Growth`), so 800 clears the worst observed case with
 * margin while still leaving a median of ONE distinct label reachable.
 *
 * Symmetric, because a heading can follow its content as easily as precede it
 * once `pdf-parse` has flattened a two-column slide into one stream.
 */
export const PERIOD_CONTEXT_CHARS = 800;

/** The longest period evidence stored on an accepted claim. */
export const MAX_PERIOD_EVIDENCE_CHARS = 160;

/** How much of the document is kept either side of a supporting label. */
const PERIOD_EVIDENCE_PAD = 40;

/**
 * Every shape a fiscal period is written in, in the corpus this reads.
 *
 * ORDERED LONGEST FIRST, because a regex alternation is first-match and `FY27`
 * would otherwise consume the tail of `Q1 FY27` and leave a stray `Q1`.
 *
 * `\s{0,2}` rather than `\s*` between the parts: a `pdf-parse` line break is one
 * `\n` or a `\r\n`, so two characters covers the real separator while stopping
 * `Q1` and an unrelated `FY27` a paragraph later from being read as one label.
 *
 * The trailing `(?!\d)` rather than `\b` is what makes a chart axis readable —
 * `Q2FY25Q3FY25Q4FY25Q1FY27` is one token to a word-boundary test and four
 * labels to this one.
 *
 * Bare `H1`/`H2` are DELIBERATELY ABSENT while bare `Q1`-`Q4` are present. `H2`
 * is hydrogen in a chemicals filing and this corpus contains one; there is no
 * such collision for a bare quarter.
 */
const PERIOD_PATTERN = new RegExp(
  [
    // Q1 FY2027, Q1FY27, H1 FY26, 9M FY26, and hyphenated years.
    String.raw`(?<![A-Za-z])(?:Q[1-4]|H[12]|9M)\s{0,2}FY\s{0,2}\d{2,4}(?:-\d{2,4})?(?!\d)`,
    // FY2026-27, FY26-27
    String.raw`(?<![A-Za-z])(?:FY|CY)\s{0,2}\d{2,4}-\d{2,4}(?!\d)`,
    // FY27, FY 2027, CY2026
    String.raw`(?<![A-Za-z])(?:FY|CY)\s{0,2}\d{2,4}(?!\d)`,
    // A bare quarter.
    String.raw`(?<![A-Za-z0-9])Q[1-4](?![\dA-Za-z])`,
  ].join('|'),
  'gi',
);

/**
 * The comparison key for a period label.
 *
 * Whitespace removed and upper-cased, then a four-digit year shortened to two.
 * `Q1 FY2027`, `Q1FY27` and `Q1 FY 27` are one quarter written three ways, and
 * six of the 43 label-carrying documents measured use both forms in the same
 * file — so refusing over the difference would refuse a claim for quoting the
 * document's own other spelling.
 *
 * THIS IS TYPOGRAPHY, NOT ARITHMETIC, and the distinction is the same one
 * `claim-numbers.ts` draws when it canonicalises commas but refuses to turn
 * `₹10,000 Cr` into `100 billion`. `FY2027` and `FY27` are the same identifier;
 * a hyphenated range keeps BOTH of its years, so `FY26-27` never collapses into
 * `FY27`.
 */
export const canonicalPeriod = (raw: string): string =>
  raw
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(
      /(FY|CY)(\d{2,4})(?:-(\d{2,4}))?/g,
      (_whole, prefix: string, first: string, second?: string) =>
        second === undefined
          ? `${prefix}${first.slice(-2)}`
          : `${prefix}${first.slice(-2)}-${second.slice(-2)}`,
    );

/**
 * Every period label in a piece of text, in the order written.
 *
 * NEVER THROWS and never guesses. A text with no period in it returns an empty
 * list, which is the ordinary case for a claim about an order win.
 */
export function periodLabelsIn(text: string): readonly PeriodLabel[] {
  const labels: PeriodLabel[] = [];
  // NO `lastIndex = 0` HERE, deliberately. The pattern is module-level and
  // `g`-flagged, which usually means state leaks between calls — but this loop
  // runs until `exec` returns null, and a failed `exec` resets `lastIndex`
  // itself. A reset would therefore be a line no input can distinguish from
  // its absence, and an unreachable guard is a claim nobody can check. The
  // re-entrancy property is pinned by a test rather than by dead code.
  let match = PERIOD_PATTERN.exec(text);
  while (match !== null) {
    labels.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      canonical: canonicalPeriod(match[0]),
    });
    match = PERIOD_PATTERN.exec(text);
  }
  return labels;
}

/** The distinct canonical periods a piece of text states. */
export const periodsIn = (text: string): ReadonlySet<string> =>
  new Set(periodLabelsIn(text).map((label) => label.canonical));

export interface PeriodSupportInput {
  /** The claim, whose periods must be supported. */
  readonly claimText: string;
  /** The document's own bytes at the matched position. */
  readonly span: string;
  /** Where `span` starts in `documentText`. */
  readonly spanOffset: number;
  readonly documentText: string;
  readonly contextChars?: number;
}

export interface PeriodSupport {
  /** Canonical periods the claim states that its context does not. */
  readonly missing: readonly string[];
  /**
   * The document's own bytes around the labels that supported the claim from
   * OUTSIDE its span, or null when the span stated them itself.
   *
   * Stored so a reviewer reading an accepted claim can see the heading it took
   * its quarter from. Without it, "Q1 FY27 revenue of ₹125.2 Cr" would be
   * evidenced by a sentence that mentions neither Q1 nor FY27 — provenance that
   * survives review without meaning anything, which is the failure
   * `claim-span.ts` already refuses to make with offsets.
   */
  readonly evidence: string | null;
}

/**
 * Decides whether the document supports the periods a claim names.
 *
 * NEVER THROWS. A claim naming no period is supported trivially, which is the
 * common case — most published wire lines carry no quarter at all.
 */
export function supportPeriods(input: PeriodSupportInput): PeriodSupport {
  const wanted = [...periodsIn(input.claimText)];
  if (wanted.length === 0) return { missing: [], evidence: null };

  const inSpan = periodsIn(input.span);
  const outstanding = wanted.filter((period) => !inSpan.has(period));
  if (outstanding.length === 0) return { missing: [], evidence: null };

  const reach = input.contextChars ?? PERIOD_CONTEXT_CHARS;
  const from = Math.max(0, input.spanOffset - reach);
  const to = Math.min(
    input.documentText.length,
    input.spanOffset + input.span.length + reach,
  );
  const window = input.documentText.slice(from, to);
  const nearby = periodLabelsIn(window);

  const missing: string[] = [];
  const found: PeriodLabel[] = [];
  for (const period of outstanding) {
    const hit = nearby.find((label) => label.canonical === period);
    if (hit === undefined) missing.push(period);
    else found.push(hit);
  }

  if (missing.length > 0) return { missing, evidence: null };

  // The document's own bytes, padded so the label is readable in context and
  // bounded so a claim naming three periods cannot store a paragraph.
  const evidence = found
    .map((label) =>
      window.slice(
        Math.max(0, label.start - PERIOD_EVIDENCE_PAD),
        Math.min(window.length, label.end + PERIOD_EVIDENCE_PAD),
      ),
    )
    .join(' … ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PERIOD_EVIDENCE_CHARS);

  return { missing: [], evidence };
}
