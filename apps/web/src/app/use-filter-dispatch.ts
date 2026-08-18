import { useCallback } from 'react';
import type { FilterAction } from './filter-state';

/**
 * The filter dispatch with the shell's one addition: COMMITTING a search
 * from the explore sheet closes it onto the results. The feed the filters
 * drive is BEHIND the sheet there, and a search that answered out of sight
 * read as no results at all (found live, 2026-08-18, searching SWIGGY).
 * Chips and the toggle keep the sheet open — a reader setting three
 * filters should not reopen it three times. The web passes shell=false and
 * gets the plain dispatch back.
 */
export const useFilterDispatch = ({
  shell,
  dispatchFilters,
  onCommitted,
}: {
  readonly shell: boolean;
  readonly dispatchFilters: (action: FilterAction) => void;
  readonly onCommitted: () => void;
}): ((action: FilterAction) => void) =>
  useCallback(
    (action: FilterAction) => {
      dispatchFilters(action);
      if (
        shell &&
        (action.type === 'submitSearch' || action.type === 'applySuggestion')
      ) {
        onCommitted();
      }
    },
    [shell, dispatchFilters, onCommitted],
  );
