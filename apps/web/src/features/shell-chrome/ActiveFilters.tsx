import type { FilterAction, FilterState } from '../../app/filter-state';
import './shell-chrome.css';

/**
 * What is narrowing the feed, said ON the feed (direction 2026-08-18: "we
 * need to show what filters are applied on top so that they can clear
 * them"). The filter view is a curtain over the feed in the shell, so a
 * filter applied there would otherwise be invisible from the results it
 * narrows. One pill per active filter, each with its own clear; nothing
 * renders when nothing narrows. The verified-claims toggle is the page's
 * DEFAULT, not an applied filter, so it earns no pill.
 */
export function ActiveFilters({
  filters,
  dispatch,
  onSearchCleared,
}: {
  readonly filters: FilterState;
  readonly dispatch: (action: FilterAction) => void;
  /** Clears the search box's draft alongside the filter it wrote. */
  readonly onSearchCleared: () => void;
}): JSX.Element | null {
  const pills: Array<{
    readonly key: string;
    readonly text: string;
    readonly clear: () => void;
  }> = [];

  if (filters.picked !== null || filters.q !== '') {
    pills.push({
      key: 'search',
      text: filters.picked !== null ? filters.picked.head : `“${filters.q}”`,
      clear: () => {
        dispatch({ type: 'clearSearch' });
        onSearchCleared();
      },
    });
  }
  if (filters.topic !== '') {
    pills.push({
      key: 'topic',
      text: filters.topic,
      clear: () => dispatch({ type: 'chip', topic: '', plans: filters.plans }),
    });
  }
  if (filters.plans) {
    pills.push({
      key: 'plans',
      text: 'Plans only',
      clear: () =>
        dispatch({ type: 'chip', topic: filters.topic, plans: false }),
    });
  }

  if (pills.length === 0) return null;
  return (
    <div className="activefilters" data-ui="active-filters">
      {pills.map((pill) => (
        <button
          key={pill.key}
          type="button"
          className="activepill"
          data-ui={`active-${pill.key}`}
          aria-label={`Clear ${pill.text}`}
          onClick={pill.clear}
        >
          {pill.text}
          <span aria-hidden="true" className="pillx">
            ×
          </span>
        </button>
      ))}
    </div>
  );
}
