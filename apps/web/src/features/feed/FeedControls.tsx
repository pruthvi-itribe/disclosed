import type { FilterState } from '../../app/filter-state';

/**
 * The chip row and the insight toggle. The search box that shares the old
 * feedbar arrives with suggest in Plan 3.
 *
 * ONE ROW OF FILTERS, and it is the TOPIC axis rather than NSE's category
 * groups: measured over the whole collection, topic 'financial' finds 368
 * filings against group 'results' 152, 'acquisition' 129 against 'mna' 31,
 * 'orders' 48 against 22 — NSE's category names the DOCUMENT TYPE, and one
 * results event files under three of them. Plans is the one chip that is not
 * a topic: it asks what SHAPE a claim is (813 of 3,994 stored claims are
 * guidance/target; 179 print a forward word; those sit in 128 filings). It
 * shares the row because a reader uses it the same way — one lens at a time
 * — and the price is the rule the reducer keeps: exactly one chip is lit.
 */
const TOPIC_CHIPS: readonly (readonly [string, string])[] = [
  ['', 'Everything'],
  ['financial', 'Financials'],
  ['dividend', 'Dividends'],
  ['orders', 'Order wins'],
  ['acquisition', 'Deals'],
  ['capacity', 'Capacity'],
  ['product', 'Product'],
  ['ratings', 'Ratings'],
];

export function FeedControls({
  filters,
  search,
  note,
  onChip,
  onOnlyInsights,
}: {
  readonly filters: FilterState;
  /** The search box, slotted in so this file owns no fetch. */
  readonly search?: JSX.Element;
  /** The search note, under the row the way the old page places it. */
  readonly note?: JSX.Element;
  readonly onChip: (topic: string, plans: boolean) => void;
  readonly onOnlyInsights: (value: boolean) => void;
}): JSX.Element {
  return (
    <div className="feedbar" data-ui="feed-controls">
      <div className="feedtop">
        {search}
        <label className="onlyinsights">
          <input
            id="only-insights"
            type="checkbox"
            checked={filters.onlyInsights}
            onChange={(event) => onOnlyInsights(event.target.checked)}
          />
          <span>Only filings with verified claims</span>
        </label>
      </div>
      <div id="topics" className="chips topics">
        {TOPIC_CHIPS.map(([topic, label]) => (
          <button
            key={label}
            type="button"
            className={
              !filters.plans && filters.topic === topic ? 'chip active' : 'chip'
            }
            data-topic={topic}
            onClick={() => onChip(topic, false)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={filters.plans ? 'chip active' : 'chip'}
          data-plans="only"
          title="Filings carrying a sentence in which the company stated its own guidance or a target it has set."
          onClick={() => onChip('', true)}
        >
          Plans
        </button>
      </div>
      {note}
    </div>
  );
}
