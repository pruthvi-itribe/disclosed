import { forwardRef } from 'react';
import type { ApiResult } from '../shared/api/api-get';
import { FeedControls } from '../features/feed/FeedControls';
import { SearchBox, type SearchBoxHandle } from '../features/search/SearchBox';
import { SearchNote } from '../features/search/SearchNote';
import type { FilterAction, FilterState } from './filter-state';

/**
 * The search-and-filters cluster as ONE element with TWO homes: inline on
 * the web feed, inside the shell's explore sheet — the filters keep one
 * implementation either way. Split from App when the shell chrome pushed
 * it over the line cap; the ref reaches the search box's one external
 * write (Clear emptying the input).
 */
export const FilterControls = forwardRef<
  SearchBoxHandle,
  {
    readonly filters: FilterState;
    readonly apiGet: <T>(path: string) => Promise<ApiResult<T>>;
    readonly dispatch: (action: FilterAction) => void;
  }
>(function FilterControls({ filters, apiGet, dispatch }, searchBox) {
  return (
    <FeedControls
      filters={filters}
      search={
        <SearchBox
          ref={searchBox}
          onTyped={() => dispatch({ type: 'undoPick' })}
          apiGet={apiGet}
          onApply={(item) => dispatch({ type: 'applySuggestion', item })}
          onSubmit={(q) => dispatch({ type: 'submitSearch', q })}
        />
      }
      note={
        <SearchNote
          picked={filters.picked}
          q={filters.q}
          onClear={() => {
            dispatch({ type: 'clearSearch' });
            (searchBox as React.RefObject<SearchBoxHandle>).current?.clear();
          }}
        />
      }
      onChip={(topic, plans) => dispatch({ type: 'chip', topic, plans })}
      onOnlyInsights={(value) => dispatch({ type: 'onlyInsights', value })}
    />
  );
});
