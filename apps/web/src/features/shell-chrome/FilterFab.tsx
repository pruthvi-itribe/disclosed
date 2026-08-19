import { IconSvg } from '../../shared/ui/IconSvg';
import { ICON_NAV_FILTER, ICON_CLOSE } from '../../shared/ui/nav-icons';
import './shell-chrome.css';

/**
 * Search and filters, ON THE FEED — a floating control at the thumb's
 * corner rather than a fifth tab (direction 2026-08-19: "filters icon
 * also can be moved directly to feed screen like floating button on
 * bottom right, its actually part of feed right").
 *
 * It is: a tab bar names DESTINATIONS, and filters are not a place — they
 * are an action on the one view they narrow. Off the bar, the remaining
 * four tabs are four real screens and each gets a wider thumb target.
 *
 * It also owns the way out, because the sheet has no close button: the
 * control stays ABOVE the sheet it opened and becomes a close while it is
 * open, so the thumb that opened the filters shuts them without moving.
 */
export function FilterFab({
  open,
  narrowed,
  onToggle,
}: {
  readonly open: boolean;
  /** Any filter applied: the control says so where the thumb already is. */
  readonly narrowed: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`filterfab${open ? ' open' : ''}${narrowed ? ' narrowed' : ''}`}
      data-ui="filter-fab"
      aria-label={open ? 'Close search and filters' : 'Search and filters'}
      aria-expanded={open}
      onClick={onToggle}
    >
      <IconSvg shapes={open ? ICON_CLOSE : ICON_NAV_FILTER} size={22} />
    </button>
  );
}
