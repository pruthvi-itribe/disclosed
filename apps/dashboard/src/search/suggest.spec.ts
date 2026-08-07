import { companyTerms, searchTerms } from './search-terms';
import {
  MIN_SUGGEST_LENGTH,
  PREFIX_FALLBACK_LIMIT,
  SUGGEST_LIMITS,
  suggestFrom,
  symbolsMatching,
} from './suggest';
import type {
  CategoryEntry,
  CompanyEntry,
  DirectorySnapshot,
  GroupEntry,
} from './directory.types';

/**
 * The type-ahead's ranking, tested against the companies that made the search
 * box worth rewriting.
 *
 * Every fixture below is a real row from the live collection: BRITANNIA and
 * LUPIN because a reader typing a name got nothing, and the three solar names
 * because "solar" is the query that proves a prefix on the ticker alone is not
 * a search — SOLARWORLD completes it, VIKRAMSOLR does not, and both are
 * companies a reader typing "solar" means.
 */

const company = (
  symbol: string,
  companyName: string,
  filings: number,
): CompanyEntry => ({
  symbol,
  companyName,
  filings,
  terms: companyTerms(symbol, companyName),
});

const category = (name: string, filings: number): CategoryEntry => ({
  category: name,
  filings,
  terms: searchTerms(name),
});

const group = (
  key: GroupEntry['group'],
  label: string,
  filings: number,
): GroupEntry => ({
  group: key,
  label,
  filings,
  terms: searchTerms(label),
});

const snapshot: DirectorySnapshot = {
  companies: [
    company('BRITANNIA', 'Britannia Industries Limited', 9),
    company('LUPIN', 'Lupin Limited', 4),
    company('VIKRAMSOLR', 'Vikram Solar Limited', 6),
    company('SOLARWORLD', 'Solarworld Energy Solutions Limited', 1),
    company('SOLARA', 'Solara Active Pharma Sciences Limited', 3),
    company('RELIANCE', 'Reliance Industries Limited', 12),
  ],
  categories: [
    category('Stock split', 12),
    category('Outcome of Board Meeting', 340),
    category('Copy of Newspaper Publication', 120),
  ],
  groups: [group('results', 'Results', 1545), group('capital', 'Capital', 907)],
  builtAt: new Date('2026-08-07T06:00:00.000Z'),
};

const symbolsFor = (query: string): readonly string[] =>
  suggestFrom(snapshot, query).companies.map((row) => row.symbol);

describe('suggestFrom — the ranking', () => {
  it('puts an exact ticker first, ahead of a company whose name it prefixes', () => {
    // SOLARA's ticker IS the query, so a reader who typed it has named a
    // company rather than described one. Everything else is a guess about what
    // they meant.
    expect(symbolsFor('solara')[0]).toBe('SOLARA');
  });

  it('puts a ticker prefix ahead of a name match, mirroring the feed ranking', () => {
    // "solar" completes SOLARWORLD and SOLARA as tickers and appears mid-name in
    // VIKRAMSOLR. Two controls over one idea — this list and the feed's own
    // ordering — must not disagree about which is the stronger match.
    const found = symbolsFor('solar');

    expect(found.indexOf('SOLARWORLD')).toBeLessThan(
      found.indexOf('VIKRAMSOLR'),
    );
    expect(found).toContain('VIKRAMSOLR');
  });

  it('finds a company by a word in the middle of its name', () => {
    // THE QUERY THIS FEATURE EXISTS FOR. A prefix on the ticker returns nothing
    // for "solar" + Vikram Solar, and the old box did exactly that.
    expect(symbolsFor('vikram')).toEqual(['VIKRAMSOLR']);
  });

  it('finds a company by its name when the ticker shares nothing with it', () => {
    expect(symbolsFor('britannia')).toEqual(['BRITANNIA']);
    expect(symbolsFor('brit')).toEqual(['BRITANNIA']);
  });

  it('breaks a tie on how much the company has actually filed', () => {
    // Both are ticker prefixes of "solar". A reader is more often looking for
    // the company they have seen in the feed, and filing count is the only
    // signal this list holds about that. Deterministic either way: a list that
    // reorders between keystrokes is unusable with the arrow keys.
    expect(symbolsFor('solar').slice(0, 2)).toEqual(['SOLARA', 'SOLARWORLD']);
  });

  it('narrows rather than widens when a second word is typed', () => {
    // "lupin pharma" names no company in this collection. Offering Lupin
    // Limited anyway would be the box ignoring the word just typed, and
    // offering Solara (which has "pharma") would be worse.
    expect(symbolsFor('lupin')).toEqual(['LUPIN']);
    expect(symbolsFor('lupin pharma')).toEqual([]);
  });
});

describe('suggestFrom — categories and groups', () => {
  it('offers the category a reader has typed the name of', () => {
    // "stock split" is a category, not a company. A free-text search for it
    // ranks by term frequency and puts Anand Rathi Share and Stock Brokers
    // first (measured); the exact category is one click instead.
    const found = suggestFrom(snapshot, 'stock split');

    expect(found.categories.map((row) => row.category)).toEqual([
      'Stock split',
    ]);
    expect(found.categories[0].filings).toBe(12);
  });

  it('matches a category on a word inside it', () => {
    expect(
      suggestFrom(snapshot, 'newspaper').categories.map((row) => row.category),
    ).toEqual(['Copy of Newspaper Publication']);
  });

  it('offers a group, which costs nothing because the set is this codebase own', () => {
    const found = suggestFrom(snapshot, 'result');

    expect(found.groups.map((row) => row.group)).toEqual(['results']);
    expect(found.groups[0].filings).toBe(1545);
  });

  it('suggests nothing at all rather than guessing, when nothing matches', () => {
    const found = suggestFrom(snapshot, 'zzzqqq');

    expect(found.companies).toEqual([]);
    expect(found.categories).toEqual([]);
    expect(found.groups).toEqual([]);
  });
});

describe('suggestFrom — the bounds that make it safe to fire on a keystroke', () => {
  it('suggests nothing below the minimum length', () => {
    // Measured on the live directory: one character matches 87 of 954
    // companies on average and 253 at worst. Six of those is not a suggestion,
    // and it costs a round trip and a repaint on every search to deliver them.
    expect(MIN_SUGGEST_LENGTH).toBe(2);
    expect(suggestFrom(snapshot, 'b').companies).toEqual([]);
    expect(suggestFrom(snapshot, '').companies).toEqual([]);
  });

  it('ignores a query that is only punctuation', () => {
    expect(suggestFrom(snapshot, '-- ').companies).toEqual([]);
  });

  it('caps each kind, so the listbox stays arrow-key sized', () => {
    const wide: DirectorySnapshot = {
      ...snapshot,
      companies: Array.from({ length: 40 }, (_, i) =>
        company(`SOL${i}`, `Solar Number ${i} Limited`, i),
      ),
    };

    expect(suggestFrom(wide, 'sol').companies).toHaveLength(
      SUGGEST_LIMITS.companies,
    );
  });

  it('reports when the directory was built, so staleness is visible', () => {
    expect(suggestFrom(snapshot, 'brit').builtAtIst).toContain('2026-08-07');
  });
});

describe('symbolsMatching — the prefix half of search', () => {
  it('resolves a prefix the text index cannot answer', () => {
    // `brit` is not a word in any filing; it is the first four keystrokes of
    // every search for Britannia. A text index matches whole words, so this is
    // the only thing that can answer it.
    expect(symbolsMatching(snapshot, 'brit')).toEqual(['BRITANNIA']);
  });

  it('ranks exactly as the listbox does, so Enter agrees with what was shown', () => {
    // A reader who saw SOLARWORLD offered and pressed Enter without picking it
    // must get the same answer they were looking at. Two rankings would be two
    // answers to one keystroke.
    expect(symbolsMatching(snapshot, 'solar')).toEqual(
      suggestFrom(snapshot, 'solar').companies.map((row) => row.symbol),
    );
  });

  it('goes wider than the listbox, because Enter is not a pick', () => {
    // The list shows six; a reader who typed a prefix and did not choose from
    // it meant all of them.
    const wide: DirectorySnapshot = {
      ...snapshot,
      companies: Array.from({ length: 40 }, (_, i) =>
        company(`SOL${i}`, `Solar Number ${i} Limited`, i),
      ),
    };

    expect(symbolsMatching(wide, 'sol')).toHaveLength(PREFIX_FALLBACK_LIMIT);
    expect(PREFIX_FALLBACK_LIMIT).toBeGreaterThan(SUGGEST_LIMITS.companies);
  });

  it('resolves nothing below the minimum length', () => {
    // An unbounded `$in` assembled from one character is an unbounded query
    // plan: measured on the live directory, `i` reaches 253 companies.
    expect(symbolsMatching(snapshot, 'b')).toEqual([]);
    expect(symbolsMatching(snapshot, '--')).toEqual([]);
  });

  it('resolves nothing for a query that matches no company', () => {
    // So the fallback issues no second read at all on a genuine miss.
    expect(symbolsMatching(snapshot, 'zzzqqq')).toEqual([]);
  });
});
