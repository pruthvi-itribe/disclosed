/**
 * The one tokeniser every search path shares.
 *
 * There are three consumers — the `$text` filter on `api/filings`, the company
 * directory's in-memory prefix match, and the type-ahead's ranking — and they
 * MUST agree about what a reader's query is made of. A directory that thought
 * `e-commerce` was one term while the text search thought it was two would
 * suggest a company and then return nothing when the reader picked it.
 *
 * ================================================================
 * WHY THE TOKENISER IS ALSO THE SANITISER
 * ================================================================
 *
 * `$text: {$search: ...}` is a GRAMMAR, not a string. A double quote opens a
 * phrase, a leading hyphen negates a term, and neither is anything a reader
 * typing into a search box means. Measured against the live collection of 2,243
 * filings:
 *
 *   $search: 'rel"iance'  →  0 matches   (an unterminated phrase)
 *   $search: '-dividend'  →  0 matches   (the only term negated)
 *   $search: 'a -b'       →  0 matches
 *
 * None of those throws. They return an empty page, which on a search box is
 * indistinguishable from "nothing was found" — the same failure mode this
 * codebase rejects everywhere else.
 *
 * So the query is never passed through and escaped. It is DECOMPOSED into terms
 * of letters and digits and reassembled, which means no operator character can
 * survive by construction rather than by an escaping table somebody has to keep
 * complete. The same property removes the regex-injection and ReDoS surface that
 * `filing-query.service.ts` already refuses for the `symbol` filter: nothing
 * here ever becomes a pattern.
 */

/**
 * Terms considered from one query.
 *
 * Eight, and the bound is about work rather than taste: every term is a separate
 * IXSCAN under `TEXT_OR` (measured — "stock split" plans as two), and every term
 * is a pass over the in-memory directory on the type-ahead path. A pasted
 * paragraph must not become forty index scans on a keystroke. Nobody searching a
 * filings feed types nine words; a reader who does gets the first eight, which
 * is already narrower than any query they meant.
 */
export const MAX_SEARCH_TERMS = 8;

/**
 * Everything that is not a letter or a digit separates two terms.
 *
 * Unicode-aware rather than `[^a-z0-9]`, so a name carrying an accent stays one
 * term instead of splitting in the middle. NSE's names are ASCII today; the
 * exchange does not promise that and a tokeniser is a bad place to find out.
 */
const SEPARATOR = /[^\p{L}\p{N}]+/u;

/** Lowercased, trimmed, with every run of whitespace collapsed to one space. */
export const normaliseQuery = (raw: string): string =>
  raw.toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * The query as terms: lowercase, letters and digits only, capped.
 *
 * `filter` before `slice`, so the cap counts real terms rather than the empty
 * strings a leading or trailing separator produces.
 */
export const searchTerms = (raw: string): readonly string[] =>
  raw
    .toLowerCase()
    .split(SEPARATOR)
    .filter((term) => term !== '')
    .slice(0, MAX_SEARCH_TERMS);

/**
 * The query as a `$text` search string, or null when nothing searchable is left.
 *
 * NULL RATHER THAN AN EMPTY STRING. `$text: {$search: ''}` is a query error, not
 * an empty result set, so the caller has to be able to tell "the reader typed
 * punctuation" from "the reader typed a word" before it builds a filter.
 */
export const toTextSearch = (raw: string): string | null => {
  const terms = searchTerms(raw);
  return terms.length === 0 ? null : terms.join(' ');
};

/**
 * Words carried by nearly every company name, and therefore by none usefully.
 *
 * MEASURED, not curated. Over the live directory's 954 distinct companies,
 * `limited` appears in 947 name (99.3%); the next commonest word is `india` at
 * 93 (9.7%). That is a cliff, not a judgement call, and the consequence of
 * ignoring it was concrete: with `limited` indexed, the letter `l` matched 951
 * of 954 companies and the pair `li` matched 948 — so the first two keystrokes
 * of any search beginning with an L returned the whole exchange. Without it the
 * worst single letter is `i` at 253 and the worst pair `in` at 233, with means
 * of 87 and 8.
 *
 * DELIBERATELY TWO WORDS AND NOT A LIST. `india` at 9.7% is a real
 * discriminator — a reader typing it means a company with India in its name —
 * and every entry added past the cliff starts removing signal instead of noise.
 * A company whose name is only a suffix keeps its ticker as a term, so nothing
 * can become unreachable.
 */
const NAME_SUFFIXES = new Set(['limited', 'ltd']);

/**
 * The terms a company is findable by: its ticker, then every meaningful word of
 * its name.
 *
 * The ticker is FIRST and is never dropped, so a company survives whatever the
 * exchange put in the name field.
 *
 * DEDUPLICATED, which is not tidiness. A large cap's ticker usually IS the first
 * word of its name — BRITANNIA / "Britannia Industries Limited", LUPIN / "Lupin
 * Limited" — so without this every one of them costs a second identical string
 * comparison on every keystroke, forever, to reach the same answer.
 */
export const companyTerms = (
  symbol: string,
  companyName: string,
): readonly string[] => [
  ...new Set([
    symbol.toLowerCase(),
    ...searchTerms(companyName).filter((term) => !NAME_SUFFIXES.has(term)),
  ]),
];

/**
 * Whether every query term is a PREFIX of some term the entry carries.
 *
 * Prefix, not substring: a type-ahead answers "what have I typed so far", and a
 * substring match would offer BRITANNIA for `ban`, which completes nothing the
 * reader started.
 *
 * ALL query terms, not any: the second word a reader types is there to narrow.
 * An `any` here would return more rows for "lupin pharma" than for "lupin",
 * which reads as the box ignoring the thing just typed into it.
 *
 * Empty terms match NOTHING rather than everything. The vacuous truth of
 * `[].every(...)` would make an empty search box suggest the entire directory.
 */
export const hasEveryTerm = (
  entryTerms: readonly string[],
  queryTerms: readonly string[],
): boolean =>
  queryTerms.length > 0 &&
  queryTerms.every((term) =>
    entryTerms.some((candidate) => candidate.startsWith(term)),
  );
