import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { ApiResult } from '../../shared/api/api-get';
import type { PickedSuggestion } from '../../app/filter-state';
import { groupInt } from '../../shared/format/group-int';
import { useSuggest, type SuggestItem } from './use-suggest';

const HEADINGS: Readonly<Record<SuggestItem['kind'], string>> = {
  company: 'Companies',
  category: 'Categories',
  group: 'Groups',
};

/** What the one external writer — the note's Clear control — may do. */
export interface SearchBoxHandle {
  readonly clear: () => void;
}

/**
 * The combobox, spelled out in ARIA. DOM focus stays on the input the whole
 * time — the reader is still typing — and the highlight is announced via
 * aria-activedescendant naming the option's stable id. The listbox is a
 * SIBLING of the input (an input cannot contain elements), and its
 * onMouseDown calls preventDefault so a click on a row lands before the
 * input's blur closes the list — it must be mousedown, not click.
 *
 * THE DRAFT IS THE BOX'S OWN STATE. It lived in App once, and every
 * character re-rendered the whole shell while the reader typed (review
 * finding #10); nothing outside the box needs the draft until Enter or a
 * pick turns it into a filter. The one external write — Clear emptying the
 * input — comes through the imperative handle, which is a ref precisely so
 * it costs the shell nothing; deriving the reset from filter state instead
 * cannot work, because "the pick was just undone by typing" and "Clear was
 * pressed" leave the same filters and must treat the draft oppositely.
 */
export const SearchBox = forwardRef<
  SearchBoxHandle,
  {
    /** Typing invalidates a pick: the parent undoes exactly what it did. */
    readonly onTyped: () => void;
    readonly apiGet: <T>(path: string) => Promise<ApiResult<T>>;
    readonly onApply: (item: PickedSuggestion) => void;
    readonly onSubmit: (q: string) => void;
  }
>(function SearchBox({ onTyped, apiGet, onApply, onSubmit }, handle) {
  const [text, setText] = useState('');
  const suggest = useSuggest({ apiGet });
  const inputRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(handle, () => ({ clear: () => setText('') }), []);

  // `/` focuses the box from anywhere that is not already a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey) return;
      const tag = document.activeElement?.tagName.toLowerCase() ?? '';
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const apply = (index: number): void => {
    const item = suggest.items[index];
    if (item === undefined) return;
    onApply(item);
    setText(item.head);
    suggest.close();
  };

  const rows: JSX.Element[] = [];
  let lastKind: SuggestItem['kind'] | null = null;
  suggest.items.forEach((item, index) => {
    if (item.kind !== lastKind) {
      lastKind = item.kind;
      rows.push(
        // Presentational, so arrow keys never land on a heading.
        <li key={`h-${item.kind}`} className="sgroup" role="presentation">
          {HEADINGS[item.kind]}
        </li>,
      );
    }
    rows.push(
      <li
        key={`${item.kind}-${item.value}`}
        id={`suggest-opt-${index}`}
        className={`sopt${index === suggest.active ? ' active' : ''}`}
        role="option"
        aria-selected={index === suggest.active}
        data-index={index}
        onMouseOver={() => suggest.setActive(index)}
        onClick={() => apply(index)}
      >
        <span className="ssym">{item.head}</span>
        {item.name !== '' && <span className="sname">{item.name}</span>}
        <span className="scount">{groupInt(item.filings)}</span>
      </li>,
    );
  });

  return (
    <div className="searchbox" data-ui="search">
      <input
        id="symbol"
        ref={inputRef}
        type="search"
        placeholder="Search a company, a category, or what was said…"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={suggest.open}
        aria-autocomplete="list"
        aria-controls="suggest"
        aria-label="Search filings"
        aria-activedescendant={
          suggest.open && suggest.active >= 0
            ? `suggest-opt-${suggest.active}`
            : undefined
        }
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onTyped();
          suggest.onInput(event.target.value);
        }}
        onBlur={suggest.close}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            // Reopens a dismissed list immediately, bypassing the debounce.
            if (!suggest.open) suggest.openNow(text);
            else suggest.moveActive(1);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            suggest.moveActive(-1);
            return;
          }
          if (event.key === 'Escape') {
            // Only while open: an empty-handed Escape keeps the browser's
            // own clear-the-search-input behaviour.
            if (suggest.open) {
              event.preventDefault();
              suggest.close();
            }
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (suggest.open && suggest.active >= 0) apply(suggest.active);
            else onSubmit(text.trim());
            suggest.close();
            return;
          }
          if (event.key === 'Tab') suggest.close();
        }}
      />
      <ul
        id="suggest"
        className="suggest"
        role="listbox"
        aria-label="Suggestions"
        hidden={!suggest.open}
        onMouseDown={(event) => event.preventDefault()}
      >
        {rows}
      </ul>
    </div>
  );
});
