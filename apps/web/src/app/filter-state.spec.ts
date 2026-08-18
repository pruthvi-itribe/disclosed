import { filterReducer, INITIAL_FILTERS, LIMIT_STEPS } from './filter-state';

describe('the filter reducer', () => {
  // "Only filings that said something" is on by default: roughly three
  // filings in five said nothing verifiable.
  it('starts with onlyInsights on, 25 rows, no filters', () => {
    expect(INITIAL_FILTERS).toEqual({
      limit: 25,
      offset: 0,
      q: '',
      symbol: '',
      category: '',
      picked: null,
      topic: '',
      group: '',
      plans: false,
      onlyInsights: true,
    });
  });

  // The chip row holds two axes and exactly one chip is ever lit: picking
  // either axis clears the other, so every click writes BOTH.
  it('a topic chip writes both axes and zeroes the offset', () => {
    const grown = { ...INITIAL_FILTERS, offset: 50, plans: true };
    const next = filterReducer(grown, {
      type: 'chip',
      topic: 'dividend',
      plans: false,
    });
    expect(next.topic).toBe('dividend');
    expect(next.plans).toBe(false);
    expect(next.offset).toBe(0);
  });

  it('the Plans chip clears the topic the same way', () => {
    const topical = { ...INITIAL_FILTERS, topic: 'orders', offset: 25 };
    const next = filterReducer(topical, {
      type: 'chip',
      topic: '',
      plans: true,
    });
    expect(next.plans).toBe(true);
    expect(next.topic).toBe('');
    expect(next.offset).toBe(0);
  });

  it('the insights toggle zeroes the offset', () => {
    const paged = { ...INITIAL_FILTERS, offset: 25 };
    const next = filterReducer(paged, { type: 'onlyInsights', value: false });
    expect(next.onlyInsights).toBe(false);
    expect(next.offset).toBe(0);
  });

  // Load more GROWS the window rather than paging: a feed a reader is
  // part-way down must not jump to the top. It walks the admin select's own
  // steps because assigning a select a value it has no option for blanks it —
  // which once snapped a 75-row feed back to 25.
  it('grow steps through the limits and keeps the offset', () => {
    expect(LIMIT_STEPS).toEqual([25, 50, 100, 200, 500]);
    let state = { ...INITIAL_FILTERS, offset: 0 };
    state = filterReducer(state, { type: 'grow' });
    expect(state.limit).toBe(50);
    state = filterReducer({ ...state, limit: 75 }, { type: 'grow' });
    expect(state.limit).toBe(100);
  });

  it('grow at the cap changes nothing', () => {
    const capped = { ...INITIAL_FILTERS, limit: 500 };
    expect(filterReducer(capped, { type: 'grow' })).toEqual(capped);
  });

  it('does not mutate its input', () => {
    const before = { ...INITIAL_FILTERS };
    filterReducer(before, { type: 'chip', topic: 'financial', plans: false });
    expect(before).toEqual(INITIAL_FILTERS);
  });
});

describe('the group tag', () => {
  // The feed's group CHIPS were deleted, but the card's group tag still
  // filters: pickGroup toggles — clicking the active group clears it.
  it('picks a group and zeroes the offset', () => {
    const paged = { ...INITIAL_FILTERS, offset: 25 };
    const next = filterReducer(paged, { type: 'pickGroup', group: 'results' });
    expect(next.group).toBe('results');
    expect(next.offset).toBe(0);
  });

  it('picking the active group clears it', () => {
    const grouped = { ...INITIAL_FILTERS, group: 'results' };
    const next = filterReducer(grouped, {
      type: 'pickGroup',
      group: 'results',
    });
    expect(next.group).toBe('');
  });
});

describe('search and the picked suggestion', () => {
  it('starts with no query, no category, no pick', () => {
    expect(INITIAL_FILTERS.q).toBe('');
    expect(INITIAL_FILTERS.category).toBe('');
    expect(INITIAL_FILTERS.picked).toBeNull();
  });

  it('applying a company suggestion sets the exact symbol', () => {
    const next = filterReducer(
      { ...INITIAL_FILTERS, q: 'brit', offset: 25 },
      {
        type: 'applySuggestion',
        item: {
          kind: 'company',
          value: 'BRITANNIA',
          head: 'BRITANNIA',
          name: 'Britannia Industries',
          filings: 120,
        },
      },
    );
    expect(next.symbol).toBe('BRITANNIA');
    expect(next.q).toBe('');
    expect(next.offset).toBe(0);
    expect(next.picked?.kind).toBe('company');
  });

  it('applying a category suggestion sets the category', () => {
    const next = filterReducer(INITIAL_FILTERS, {
      type: 'applySuggestion',
      item: {
        kind: 'category',
        value: 'Stock Split',
        head: 'Stock Split',
        name: '',
        filings: 8,
      },
    });
    expect(next.category).toBe('Stock Split');
  });

  // undoPicked reverses ONLY what a pick did — a blanket reset would clear
  // a group set from the card's tag.
  it('a new pick undoes exactly the previous one', () => {
    const company = filterReducer(INITIAL_FILTERS, {
      type: 'applySuggestion',
      item: {
        kind: 'company',
        value: 'TCS',
        head: 'TCS',
        name: 'TCS',
        filings: 9,
      },
    });
    const grouped = { ...company, group: 'results' };
    const next = filterReducer(grouped, {
      type: 'applySuggestion',
      item: {
        kind: 'group',
        value: 'capital',
        head: 'Capital',
        name: '',
        filings: 30,
      },
    });
    expect(next.symbol).toBe('');
    expect(next.group).toBe('capital');
  });

  it('typing a free-text search undoes the pick and sets q', () => {
    const picked = filterReducer(INITIAL_FILTERS, {
      type: 'applySuggestion',
      item: {
        kind: 'company',
        value: 'TCS',
        head: 'TCS',
        name: 'TCS',
        filings: 9,
      },
    });
    const next = filterReducer(picked, { type: 'submitSearch', q: 'dividend' });
    expect(next.symbol).toBe('');
    expect(next.picked).toBeNull();
    expect(next.q).toBe('dividend');
    expect(next.offset).toBe(0);
  });

  it('clearing the search resets query and pick together', () => {
    const searched = filterReducer(INITIAL_FILTERS, {
      type: 'submitSearch',
      q: 'dividend',
    });
    const next = filterReducer(searched, { type: 'clearSearch' });
    expect(next.q).toBe('');
    expect(next.picked).toBeNull();
  });

  // The undo's promise is 'reverse exactly what the pick did'. A group
  // applied LATER from a card's tag overwrote the pick's write, so it is
  // not the pick's to take — clearing on kind alone silently widened the
  // feed to everything. (The old client has the same defect; not ported.)
  it('typing after a pick leaves a group a card tag applied later', () => {
    const picked = filterReducer(INITIAL_FILTERS, {
      type: 'applySuggestion',
      item: {
        kind: 'group',
        value: 'capital',
        head: 'Capital',
        name: '',
        filings: 30,
      },
    });
    const retagged = filterReducer(picked, {
      type: 'pickGroup',
      group: 'results',
    });
    const next = filterReducer(retagged, { type: 'undoPick' });
    expect(next.group).toBe('results');
    expect(next.picked).toBeNull();
  });
});
