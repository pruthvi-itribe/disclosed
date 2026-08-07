import type { CategoryGroup } from '@app/filings';

/**
 * What the type-ahead is answered from: a small, pre-tokenised snapshot of the
 * collection's distinct companies, categories and groups.
 *
 * `terms` IS THE POINT OF THIS SHAPE. Tokenising a company name is the same work
 * whether it is done once per build or once per keystroke per company, and the
 * second is 954 tokenisations per character typed. Precomputing it turns a
 * suggestion into a prefix comparison over strings that already exist.
 *
 * Every field is readonly and every array is rebuilt rather than mutated, so a
 * request being served cannot observe a snapshot half-replaced by a refresh
 * running underneath it.
 */

/** One distinct company: its ticker, its name, and how many filings it has made. */
export interface CompanyEntry {
  readonly symbol: string;
  readonly companyName: string;
  readonly filings: number;
  /** The lowercased symbol and every word of the name. Matched by prefix. */
  readonly terms: readonly string[];
}

/** One distinct NSE category and its share of the collection. */
export interface CategoryEntry {
  readonly category: string;
  readonly filings: number;
  readonly terms: readonly string[];
}

/** One reader-facing category group, counted by folding the categories. */
export interface GroupEntry {
  readonly group: CategoryGroup;
  readonly label: string;
  readonly filings: number;
  readonly terms: readonly string[];
}

/**
 * The whole directory as one immutable value.
 *
 * `builtAt` rides with the data rather than beside it because staleness is a
 * property OF a snapshot: a reader asking "is this list current" is asking about
 * the list they were given, not about whatever the cache holds now.
 */
export interface DirectorySnapshot {
  readonly companies: readonly CompanyEntry[];
  readonly categories: readonly CategoryEntry[];
  readonly groups: readonly GroupEntry[];
  readonly builtAt: Date;
}
