import { istTimestamp } from '@app/common';
import type {
  CategorySuggestion,
  CompanySuggestion,
  GroupSuggestion,
  SuggestionsView,
} from '../filings/dashboard.types';
import type {
  CategoryEntry,
  CompanyEntry,
  DirectorySnapshot,
  GroupEntry,
} from './directory.types';
import { hasEveryTerm, normaliseQuery, searchTerms } from './search-terms';

/**
 * The type-ahead's ranking. PURE, and over a snapshot rather than a database.
 *
 * Everything here runs on a keystroke, so the only work it is allowed to do is
 * work whose cost is bounded by the number of DISTINCT companies (954 on the
 * live collection) rather than by the number of filings (2,243 and growing
 * without bound). See `company-directory.ts` for how the snapshot is built and
 * what it costs; this file is the part that must be cheap, and the way it stays
 * cheap is that it is string comparison over pre-tokenised terms and nothing
 * else — no regex built from request text, no sort of the whole directory, no
 * allocation per candidate that did not match.
 */

/**
 * Shortest query that produces a suggestion.
 *
 * Two, measured rather than chosen. Over the live directory's 954 companies a
 * single letter matches 87 on average and 253 at worst (`i`); two letters match
 * 8 on average and 233 at worst (`in`). One letter is therefore not a query — it
 * is a request for six arbitrary companies out of eighty-seven, plus a round
 * trip and a repaint on the first keystroke of every search to deliver them.
 *
 * (Both figures are AFTER `limited` is dropped from a company's terms. With it
 * indexed, `l` matched 951 of 954 and `li` matched 948 — see `NAME_SUFFIXES`.)
 */
export const MIN_SUGGEST_LENGTH = 2;

/**
 * How many of each kind reach the listbox.
 *
 * Eleven rows at most, because the list is driven with the arrow keys and a
 * reader has to be able to see where they are in it without scrolling. Companies
 * get the most because a company is what the box is for; groups get the fewest
 * because there are only eleven in the whole taxonomy and a reader who wants one
 * has a row of chips right underneath.
 */
export const SUGGEST_LIMITS = {
  companies: 6,
  categories: 3,
  groups: 2,
} as const;

/**
 * Companies the prefix fallback will ask the database about.
 *
 * Twenty-five, because `{symbol: {$in: [...]}}` costs one index seek per value
 * and an unbounded list assembled from a reader's query is an unbounded plan. It
 * is four times what the listbox shows, so a reader who typed a common prefix
 * and pressed Enter without picking anything still gets more than they could
 * have chosen from — and it is far fewer than the 253 companies the worst single
 * letter matches.
 */
export const PREFIX_FALLBACK_LIMIT = 25;

/** A scored candidate, before the rank is dropped and the row is projected. */
interface Ranked<T> {
  readonly rank: number;
  readonly filings: number;
  readonly tiebreak: string;
  readonly row: T;
}

/**
 * Rank, then filings, then name.
 *
 * THE LAST KEY IS NOT DECORATION. This list is driven with ArrowDown, and two
 * rows that swap places between one keystroke and the next move the highlight
 * out from under the reader. Every key here is a total order over values the
 * snapshot already holds, so the same query always produces the same list.
 */
const byRank = <T>(left: Ranked<T>, right: Ranked<T>): number =>
  left.rank - right.rank ||
  right.filings - left.filings ||
  left.tiebreak.localeCompare(right.tiebreak);

const take = <T>(ranked: readonly Ranked<T>[], limit: number): readonly T[] =>
  [...ranked]
    .sort(byRank)
    .slice(0, limit)
    .map((entry) => entry.row);

/**
 * How strongly a company matches, lower being stronger.
 *
 * THE SAME ORDER THE FEED RANKS BY — ticker, then name, then anything else —
 * and that is a requirement rather than a coincidence. The listbox and the
 * results underneath it are two views of one idea of "best match", and a reader
 * who is offered SOLARWORLD first and then sees Vikram Solar at the top of the
 * feed has been told two different things about their own query.
 *
 * Returns null for no match at all, so a caller never pays for a row it will
 * not show.
 */
const rankCompany = (
  entry: CompanyEntry,
  query: string,
  terms: readonly string[],
): number | null => {
  const symbol = entry.symbol.toLowerCase();

  // A ticker IS an identifier. A reader who typed one in full has NAMED a
  // company; everything below this line is a guess about what they meant.
  if (symbol === query) return 0;
  if (symbol.startsWith(query)) return 1;
  // The name read from the front: what a reader typing `britannia ind` is doing.
  if (entry.companyName.toLowerCase().startsWith(query)) return 2;
  // A word anywhere in the name. THE CASE THE OLD BOX COULD NOT SERVE: `solar`
  // is the third word of `Vikram Solar Limited` and a prefix of nothing.
  if (hasEveryTerm(entry.terms, terms)) return 3;
  return null;
};

/** A category matches from the front, or on any word inside it. */
const rankCategory = (
  entry: CategoryEntry,
  query: string,
  terms: readonly string[],
): number | null => {
  if (entry.category.toLowerCase().startsWith(query)) return 0;
  if (hasEveryTerm(entry.terms, terms)) return 1;
  return null;
};

/** A group matches on its reader-facing label, the only text it has. */
const rankGroup = (
  entry: GroupEntry,
  query: string,
  terms: readonly string[],
): number | null => {
  if (entry.label.toLowerCase().startsWith(query)) return 0;
  if (hasEveryTerm(entry.terms, terms)) return 1;
  return null;
};

/** Every company the query reaches, scored. Shared by the listbox and the fallback. */
const rankCompanies = (
  snapshot: DirectorySnapshot,
  query: string,
  terms: readonly string[],
): readonly Ranked<CompanySuggestion>[] => {
  const found: Ranked<CompanySuggestion>[] = [];

  for (const entry of snapshot.companies) {
    const rank = rankCompany(entry, query, terms);
    if (rank === null) continue;
    found.push({
      rank,
      filings: entry.filings,
      tiebreak: entry.symbol,
      row: {
        symbol: entry.symbol,
        companyName: entry.companyName,
        filings: entry.filings,
      },
    });
  }

  return found;
};

/**
 * The tickers a query completes, best first — the prefix half of search.
 *
 * THE SAME RANKING THE LISTBOX USES, from the same function, and that is the
 * point rather than an economy. A reader who typed `brit`, saw BRITANNIA
 * offered, and pressed Enter without picking it must get Britannia's filings. If
 * this ordered candidates differently from the list above the box, the row they
 * were looking at and the rows they got would be two different answers to one
 * keystroke.
 *
 * Bounded by the same minimum length as a suggestion: a fallback that fired on
 * one character would ask the database about 253 companies to rescue a query
 * nobody has finished typing.
 */
export const symbolsMatching = (
  snapshot: DirectorySnapshot,
  raw: string,
): readonly string[] => {
  const query = normaliseQuery(raw);
  const terms = searchTerms(raw);

  if (query.length < MIN_SUGGEST_LENGTH || terms.length === 0) return [];

  return take(rankCompanies(snapshot, query, terms), PREFIX_FALLBACK_LIMIT).map(
    (row) => row.symbol,
  );
};

/** The empty answer, shared so a miss and a too-short query render identically. */
const nothing = (snapshot: DirectorySnapshot): SuggestionsView => ({
  companies: [],
  categories: [],
  groups: [],
  builtAtIst: istTimestamp(snapshot.builtAt),
  companiesKnown: snapshot.companies.length,
});

/**
 * Everything the reader might have meant, best first.
 *
 * The three passes are separate loops rather than one because the three ranking
 * scales are not comparable: a company at rank 3 and a category at rank 0 are
 * not the same distance from what the reader typed, and interleaving them by a
 * shared number would be inventing a comparison nothing supports. They are three
 * lists and the page draws them as three groups.
 */
export const suggestFrom = (
  snapshot: DirectorySnapshot,
  raw: string,
): SuggestionsView => {
  const query = normaliseQuery(raw);
  const terms = searchTerms(raw);

  // Length is measured on the NORMALISED query rather than the raw one, so
  // `--` and `  a ` are both too short rather than one of them being long
  // enough to fire a request that can only return nothing.
  if (query.length < MIN_SUGGEST_LENGTH || terms.length === 0) {
    return nothing(snapshot);
  }

  const companies = rankCompanies(snapshot, query, terms);

  const categories: Ranked<CategorySuggestion>[] = [];
  for (const entry of snapshot.categories) {
    const rank = rankCategory(entry, query, terms);
    if (rank === null) continue;
    categories.push({
      rank,
      filings: entry.filings,
      tiebreak: entry.category,
      row: { category: entry.category, filings: entry.filings },
    });
  }

  const groups: Ranked<GroupSuggestion>[] = [];
  for (const entry of snapshot.groups) {
    const rank = rankGroup(entry, query, terms);
    if (rank === null) continue;
    groups.push({
      rank,
      filings: entry.filings,
      tiebreak: entry.label,
      row: { group: entry.group, label: entry.label, filings: entry.filings },
    });
  }

  return {
    companies: take(companies, SUGGEST_LIMITS.companies),
    categories: take(categories, SUGGEST_LIMITS.categories),
    groups: take(groups, SUGGEST_LIMITS.groups),
    builtAtIst: istTimestamp(snapshot.builtAt),
    companiesKnown: snapshot.companies.length,
  };
};
