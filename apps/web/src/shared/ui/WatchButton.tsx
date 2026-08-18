import { IconSvg } from './IconSvg';
import { ICON_STAR } from './icons';

/**
 * What every star-drawing surface receives — null when signed out, and the
 * caller draws NOTHING: a control that is permanently greyed out and never
 * explains itself reads as a broken page.
 */
export interface WatchControls {
  readonly watched: ReadonlySet<string>;
  readonly pending: ReadonlySet<string>;
  readonly onToggle: (symbol: string) => void;
}

/**
 * The star. Filled when watching, outlined when not — the state is the
 * drawing's own fill, via the stylesheet's `.watch.on svg { fill:
 * currentColor }`, which is right on any background. aria-label, title and
 * aria-pressed stand in for the visible word it used to carry, all from one
 * string so they cannot disagree. The toggle is confirmed, not optimistic:
 * disabled-while-pending is the only immediate feedback.
 */
export function WatchButton({
  symbol,
  controls,
  id,
}: {
  readonly symbol: string;
  readonly controls: WatchControls;
  /** The company head's star carries the page's one id, `co-watch`. */
  readonly id?: string;
}): JSX.Element {
  const on = controls.watched.has(symbol);
  const label = `${on ? 'Stop watching ' : 'Watch '}${symbol}`;
  return (
    <button
      id={id}
      type="button"
      className={`iconbtn watch${on ? ' on' : ''}`}
      data-ui="watch"
      data-symbol={symbol}
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={controls.pending.has(symbol)}
      onClick={(event) => {
        // A star click must not open the card behind it.
        event.stopPropagation();
        controls.onToggle(symbol);
      }}
    >
      <IconSvg shapes={ICON_STAR} />
    </button>
  );
}
