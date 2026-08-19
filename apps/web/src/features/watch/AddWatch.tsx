import { useState } from 'react';
import type { ApiResult } from '../../shared/api/api-get';
import { useSuggest } from '../../shared/api/use-suggest';
import type { WatchControls } from '../../shared/ui/WatchButton';
import './add-watch.css';

/**
 * Search-to-add, on the Watching screen itself (direction 2026-08-19:
 * "adding, deleting, search and add should be easy"). Company suggestions
 * only — a category is not watchable — and a tap ADDS: this box never
 * filters a feed. An already-watched row states the fact instead of
 * offering a second add; removal stays with the roster's own star. A
 * refused add (unknown symbol, full watchlist) surfaces through the same
 * banner every watch toggle reports to.
 */
export function AddWatch({
  apiGet,
  controls,
}: {
  readonly apiGet: <T>(path: string) => Promise<ApiResult<T>>;
  readonly controls: WatchControls | null;
}): JSX.Element | null {
  const [text, setText] = useState('');
  const suggest = useSuggest({ apiGet });
  if (controls === null) return null;

  const companies = suggest.items.filter((item) => item.kind === 'company');

  return (
    <div className="addwatch" data-ui="add-watch">
      <input
        id="add-watch-input"
        type="search"
        placeholder="Add a company…"
        autoComplete="off"
        spellCheck={false}
        aria-label="Add a company to your watchlist"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          suggest.onInput(event.target.value);
        }}
        onBlur={suggest.close}
      />
      {suggest.open && companies.length > 0 && (
        <ul
          className="addwatchlist"
          data-ui="add-watch-list"
          // Mousedown, not click: the row must land before the input's
          // blur closes the list — the search box's own rule.
          onMouseDown={(event) => event.preventDefault()}
        >
          {companies.map((item) => {
            const watched = controls.watched.has(item.value);
            return (
              <li key={item.value}>
                <button
                  type="button"
                  data-ui="add-watch-row"
                  data-symbol={item.value}
                  disabled={watched || controls.pending.has(item.value)}
                  onClick={() => {
                    controls.onToggle(item.value);
                    setText('');
                    suggest.close();
                  }}
                >
                  <span className="sym">{item.head}</span>
                  <span className="addname">{item.name}</span>
                  <span className="addstate">
                    {watched ? 'Watching' : 'Add'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
