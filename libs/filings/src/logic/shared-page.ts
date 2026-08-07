/**
 * Whether a document is one company's filing or a page several companies share.
 *
 * ================================================================
 * THE FAILURE THIS EXISTS TO STOP
 * ================================================================
 *
 * Every claim this pipeline publishes is matched character-for-character
 * against a span of the source document. That guarantees the sentence IS in the
 * document. It does not guarantee the sentence is ABOUT the filer, and on a
 * newspaper page the two come apart — a company files the page it advertised on,
 * and that page carries other companies' statutory notices beside its own.
 *
 * It has already happened. SANOFI INDIA LIMITED, a pharmaceutical company,
 * carries the stored claim:
 *
 *     "Shareholders approved MOA alteration to include telecom and
 *      communication cables business"
 *
 * which is another company's notice on the same page, verified against a real
 * span, and therefore indistinguishable on the dashboard from a true one. That
 * is the most expensive shape of error this product has: it does not look like
 * an error.
 *
 * ================================================================
 * WHY PROXIMITY DOES NOT WORK, MEASURED BEFORE THIS WAS WRITTEN
 * ================================================================
 *
 * The obvious rule is "accept a span only when it sits near the filer's own
 * name". It was measured against the live collection and it cannot work, because
 * the two distributions sit on top of each other:
 *
 *     the filer's OWN claims, distance to their own name    median   623 chars
 *     ANOTHER company's identity, distance to that name     median   972 chars
 *
 * Another company sits within 500 characters of the filer on 41% of shared
 * pages and within 1,000 on 50%, while the filer's own claims run out to 4,324.
 * A bound tight enough to exclude the neighbour refuses most of the filer's own
 * content; a bound loose enough to keep it admits the neighbour on 85% of pages.
 * There is no threshold in between, so this module does not pretend to find one.
 *
 * ================================================================
 * WHAT SEPARATES INSTEAD: HOW MANY COMPANIES THE PAGE IS ADDRESSED TO
 * ================================================================
 *
 * A CIN is exact — it identifies one registered company and cannot be confused
 * with another — and the COUNT of distinct ones is a property of the whole
 * document rather than of a position in it. Measured over 1,257 live documents:
 *
 *     distinct CINs      newspaper pages      every other category
 *     0                        83                     273
 *     1                       162                     519
 *     2-3                      92                      54
 *     4 or more                71                       3
 *
 * A company's own filing legitimately names a second company — a subsidiary in a
 * presentation, a counterparty in an amalgamation — which is why two is not the
 * bound and a two-CIN rule would refuse 111 sound claims. Naming FOUR is a
 * different thing: it happens on 71 newspaper pages and on three filings in the
 * rest of the collection.
 *
 * ================================================================
 * WHAT IT COSTS, STATED RATHER THAN ROUNDED AWAY
 * ================================================================
 *
 * Those three filings are real and their claims are correctly attributed —
 * 3i Infotech's AGM notice listing its group companies' registration numbers,
 * NHPC's 50th AGM notice — and this refuses six good claims to remove the
 * SANOFI class. That trade is deliberate and it is the trade this codebase makes
 * everywhere else: a wrong attribution is unbounded and silent, a refusal is
 * bounded and SAYS SO. The filings become "not read: shared page" on the
 * dashboard rather than rendering empty, and both companies state the same facts
 * in their other filings, which are untouched.
 *
 * NO SECONDARY METRIC RESCUES THEM. Name density and the filer's share of the
 * CIN occurrences were both measured and both overlap; with three documents on
 * one side of the question, any threshold that separated them would be fitted to
 * three points and would be a claim about nothing.
 */

/**
 * A Corporate Identification Number, as the Registrar of Companies issues it.
 *
 * Twenty-one characters: listing status, a five-digit industry code, a
 * two-letter state, a four-digit year of incorporation, three letters of company
 * class and a six-digit registration number. Matched case-insensitively because
 * filings print it both ways, and bounded at both ends so a longer alphanumeric
 * run cannot contribute a false one.
 */
const COMPANY_IDENTITY = /\b[LU]\d{5}[A-Za-z]{2}\d{4}[A-Za-z]{3}\d{6}\b/g;

/**
 * Every distinct company registration number the document prints.
 *
 * Upper-cased before counting, so one company writing its own CIN two ways is
 * one company and not two — which would otherwise push an ordinary filing over
 * the bound by itself.
 */
export function companyIdentitiesIn(documentText: string): ReadonlySet<string> {
  const found = documentText.match(COMPANY_IDENTITY) ?? [];
  return new Set(found.map((cin) => cin.toUpperCase()));
}

/**
 * Distinct companies a document may name before it stops being one company's.
 *
 * Four, from the table above, and the bound is on the count of DISTINCT
 * identities rather than on occurrences: a filing that prints its own CIN in a
 * header on every page is still one company's filing.
 */
export const SHARED_PAGE_MIN_IDENTITIES = 4;

/**
 * True when the document is addressed to several companies at once.
 *
 * NEVER THROWS and takes no other input: it is a property of the bytes, which
 * is what lets it sit in front of an extractor without knowing which filing it
 * is looking at. Deliberately NOT keyed on the category — `claim-eligibility.ts`
 * records at length why a test on a name NSE controls hides the next thing NSE
 * names differently, and a shared page filed under `General Updates` carries the
 * same hazard as one filed under `Copy of Newspaper Publication`. Three of the
 * live ones are filed under something else.
 */
export const isSharedPage = (documentText: string): boolean =>
  companyIdentitiesIn(documentText).size >= SHARED_PAGE_MIN_IDENTITIES;
