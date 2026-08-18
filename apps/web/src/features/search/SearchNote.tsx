import type { PickedSuggestion } from '../../app/filter-state';

/**
 * What the current query matched, in one line, with the one control that
 * clears it.
 */
export function SearchNote({
  picked,
  q,
  onClear,
}: {
  readonly picked: PickedSuggestion | null;
  readonly q: string;
  readonly onClear: () => void;
}): JSX.Element {
  const label =
    picked !== null
      ? picked.kind === 'company'
        ? `Every filing by ${picked.value}`
        : picked.kind === 'category'
          ? `Category: ${picked.value}`
          : `Group: ${picked.head}`
      : q !== ''
        ? `Searching for ${q}`
        : null;

  return (
    <div id="search-note" className="searchnote" hidden={label === null}>
      {label !== null && (
        <>
          {label}
          <button type="button" className="clearq" onClick={onClear}>
            clear
          </button>
        </>
      )}
    </div>
  );
}
