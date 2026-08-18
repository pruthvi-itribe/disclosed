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
      topic: '',
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
