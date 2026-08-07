import {
  MAX_SEARCH_TERMS,
  companyTerms,
  hasEveryTerm,
  normaliseQuery,
  searchTerms,
  toTextSearch,
} from './search-terms';

/**
 * The tokeniser every search path shares.
 *
 * Two of these describe a SECURITY property rather than a nicety: `toTextSearch`
 * is the only thing standing between a reader's query string and Mongo's `$text`
 * grammar, which reads `"` as a phrase delimiter and a leading `-` as a
 * negation. Measured against the live collection: `$search: '-dividend'` matches
 * 0 of 2,243 filings and `$search: 'rel"iance'` matches 0, both silently — a
 * search box that returns nothing for `e-commerce` is indistinguishable from one
 * that is broken.
 */

describe('normaliseQuery', () => {
  it('lowercases, trims and collapses the whitespace a reader actually types', () => {
    expect(normaliseQuery('  Britannia   Industries  ')).toBe(
      'britannia industries',
    );
  });

  it('collapses tabs and newlines, which arrive from a paste', () => {
    expect(normaliseQuery('lupin\t\npharma')).toBe('lupin pharma');
  });

  it('is empty for a query that is only punctuation', () => {
    expect(normaliseQuery('   ')).toBe('');
  });
});

describe('searchTerms', () => {
  it('splits on anything that is not a letter or a digit', () => {
    // The reader's own spellings: NSE names carry ampersands, hyphens and
    // brackets, and none of them is a term.
    expect(searchTerms('M&A')).toEqual(['m', 'a']);
    expect(searchTerms('e-commerce')).toEqual(['e', 'commerce']);
    expect(searchTerms('GAIL (India) Limited')).toEqual([
      'gail',
      'india',
      'limited',
    ]);
  });

  it('keeps digits, because a symbol may carry one', () => {
    expect(searchTerms('3IINFOLTD')).toEqual(['3iinfoltd']);
  });

  it('yields nothing for a query with no letters or digits at all', () => {
    expect(searchTerms('---')).toEqual([]);
    expect(searchTerms('')).toEqual([]);
  });

  it('caps the term count, so one pasted paragraph is not one query per word', () => {
    const many = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');

    expect(searchTerms(many)).toHaveLength(MAX_SEARCH_TERMS);
  });
});

describe('toTextSearch', () => {
  it('separates on the phrase delimiter rather than special-casing it', () => {
    // Measured: `$search: 'rel"iance'` returns 0 of 2,243 filings because the
    // quote opens a phrase that never closes. It becomes a separator like every
    // other non-alphanumeric — ONE rule with no exceptions, because a stripping
    // table is a list somebody has to keep complete and a separator rule is not.
    expect(toTextSearch('rel"iance')).toBe('rel iance');
  });

  it('strips the negation prefix, so a hyphen is a separator and not an operator', () => {
    // Measured: `$search: '-dividend'` returns 0 — the term is negated and no
    // positive term remains. A reader typing a hyphenated name means neither.
    expect(toTextSearch('e-commerce')).toBe('e commerce');
    expect(toTextSearch('-dividend')).toBe('dividend');
  });

  it('cannot emit a character Mongo reads as an operator', () => {
    const hostile = toTextSearch('"quote" -neg \\esc $where {js}');

    expect(hostile).not.toBeNull();
    expect(hostile as string).toMatch(/^[a-z0-9 ]+$/);
  });

  it('is null when nothing survives, so no caller sends an empty $text', () => {
    // `$text: {$search: ''}` is a query error, not an empty result set.
    expect(toTextSearch('   ')).toBeNull();
    expect(toTextSearch('!!!')).toBeNull();
  });
});

describe('companyTerms', () => {
  it('carries the ticker and every word of the name', () => {
    expect(companyTerms('VIKRAMSOLR', 'Vikram Solar Limited')).toEqual([
      'vikramsolr',
      'vikram',
      'solar',
    ]);
  });

  it('drops the incorporation suffix, which 99.3% of names share', () => {
    // MEASURED over the live directory's 954 distinct companies: `limited`
    // appears in 947 of them and the next commonest word, `india`, in 93. It is
    // not a discriminator, it is a suffix — and keeping it made `l` match 951
    // companies and `li` match 948, so the first two keystrokes of any search
    // returned the whole exchange. Dropping it: `i` is the worst single letter
    // at 253 and `in` the worst pair at 233, with a mean of 87 and 8.
    expect(companyTerms('BRITANNIA', 'Britannia Industries Limited')).toEqual([
      'britannia',
      'industries',
    ]);
    expect(companyTerms('XYZ', 'Some Company Ltd')).toEqual([
      'xyz',
      'some',
      'company',
    ]);
  });

  it('never returns an empty term list, whatever the exchange sent', () => {
    // A name of nothing but punctuation would otherwise make the company
    // unreachable by any query. The ticker is always there to find it by.
    expect(companyTerms('ODDONE', '---')).toEqual(['oddone']);
  });
});

describe('hasEveryTerm', () => {
  it('matches when every query term is a prefix of some entry term', () => {
    const entry = ['vikramsolr', 'vikram', 'solar', 'limited'];

    expect(hasEveryTerm(entry, ['solar'])).toBe(true);
    expect(hasEveryTerm(entry, ['vik', 'sol'])).toBe(true);
  });

  it('requires ALL terms, so a second word narrows rather than widens', () => {
    // "lupin pharma" must not return Lupin Limited: the reader added a word to
    // narrow the list, and an OR here would hand back more rows than "lupin"
    // alone did — which reads as the box ignoring what was typed.
    expect(hasEveryTerm(['lupin', 'limited'], ['lupin', 'pharma'])).toBe(false);
  });

  it('matches a prefix and never a suffix or an infix', () => {
    // A type-ahead is answering "what have I typed so far". A substring match
    // would make 'ban' offer BRITANNIA, which is not a completion of anything.
    expect(hasEveryTerm(['britannia'], ['brit'])).toBe(true);
    expect(hasEveryTerm(['britannia'], ['ann'])).toBe(false);
  });

  it('is false for no terms at all, so an empty box suggests nothing', () => {
    expect(hasEveryTerm(['britannia'], [])).toBe(false);
  });
});
