import { filingsQuery } from './filings-query';
import { INITIAL_FILTERS } from '../../app/filter-state';

/**
 * The query priority order, ported from the old client's query(): an open
 * company ignores every feed filter, the Brief asks its own fixed question,
 * and only the feed serialises the filter state.
 */
describe('filingsQuery', () => {
  it('an open company wins over everything and ignores the filters', () => {
    const filtered = {
      ...INITIAL_FILTERS,
      topic: 'dividend',
      q: 'query',
      offset: 50,
    };
    // 200 is roughly ten months of the heaviest measured filer.
    expect(filingsQuery(filtered, 'feed', 'TCS')).toBe(
      '/api/filings?limit=200&offset=0&symbol=TCS',
    );
  });

  it('encodes the symbol', () => {
    expect(filingsQuery(INITIAL_FILTERS, 'feed', 'M&M')).toBe(
      '/api/filings?limit=200&offset=0&symbol=M%26M',
    );
  });

  it('the brief asks its own fixed question', () => {
    const filtered = { ...INITIAL_FILTERS, topic: 'orders', offset: 25 };
    // BRIEF_WINDOW = 200: the server caps a page at 200 and a verified IST
    // day is 326 to 463 filings — the cover states the window.
    expect(filingsQuery(filtered, 'brief', null)).toBe(
      '/api/filings?tier=verified&offset=0&limit=200',
    );
  });

  it('the default feed asks for verified because onlyInsights is on', () => {
    expect(filingsQuery(INITIAL_FILTERS, 'feed', null)).toBe(
      '/api/filings?limit=25&offset=0&tier=verified',
    );
  });

  it('turning insights off drops the tier', () => {
    const all = { ...INITIAL_FILTERS, onlyInsights: false };
    expect(filingsQuery(all, 'feed', null)).toBe(
      '/api/filings?limit=25&offset=0',
    );
  });

  it('serialises topic, plans, q and symbol', () => {
    const busy = {
      ...INITIAL_FILTERS,
      topic: 'financial',
      plans: false,
      q: 'dividend rs',
      symbol: 'INFY',
    };
    expect(filingsQuery(busy, 'feed', null)).toBe(
      '/api/filings?limit=25&offset=0&tier=verified&q=dividend%20rs&symbol=INFY&topic=financial',
    );
  });

  // plans=only is the literal single value the server accepts; anything else
  // answers 400.
  it('the Plans axis serialises as plans=only', () => {
    const plans = { ...INITIAL_FILTERS, plans: true };
    expect(filingsQuery(plans, 'feed', null)).toBe(
      '/api/filings?limit=25&offset=0&tier=verified&plans=only',
    );
  });
});
