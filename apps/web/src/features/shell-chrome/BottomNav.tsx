import { IconSvg } from '../../shared/ui/IconSvg';
import { ICON_STAR } from '../../shared/ui/icons';
import {
  ICON_NAV_BRIEF,
  ICON_NAV_FEED,
  ICON_NAV_PROFILE,
} from '../../shared/ui/nav-icons';
import './shell-chrome.css';

export type NavPick = 'brief' | 'feed' | 'watching' | 'profile';

/**
 * The shell's bottom bar — the tabs moved to where thumbs are (direction
 * set 2026-08-18 after the first hands-on build). FOUR DESTINATIONS: the
 * three views and the profile sheet, the active mark following whichever
 * is on top so an open sheet unlights the view behind it. Filters left
 * this bar on 2026-08-19 for a floating control on the feed — a bar names
 * places, and a filter is an action on one view, not a place. The unread
 * badge is the top bar's rule restated: absent at zero, capped at 99+.
 */
export function BottomNav({
  active,
  unread,
  onPick,
}: {
  /** Null while the company view is open: reached from a card, not a tab. */
  readonly active: NavPick | null;
  readonly unread: number;
  readonly onPick: (pick: NavPick) => void;
}): JSX.Element {
  const item = (
    pick: NavPick,
    label: string,
    icon: JSX.Element,
    badge?: JSX.Element | null,
  ): JSX.Element => (
    <button
      type="button"
      className={`navitem${active === pick ? ' on' : ''}`}
      data-ui={`nav-${pick}`}
      aria-label={label}
      aria-current={active === pick ? 'page' : undefined}
      onClick={() => onPick(pick)}
    >
      {icon}
      <span className="navlabel">{label}</span>
      {badge}
    </button>
  );

  return (
    <nav className="bottomnav" data-ui="bottom-nav">
      {item('brief', 'Brief', <IconSvg shapes={ICON_NAV_BRIEF} size={22} />)}
      {item('feed', 'Feed', <IconSvg shapes={ICON_NAV_FEED} size={22} />)}
      {item(
        'watching',
        'Watching',
        <IconSvg shapes={ICON_STAR} size={22} />,
        unread > 0 ? (
          <span className="navbadge" data-ui="nav-unread">
            {unread > 99 ? '99+' : String(unread)}
          </span>
        ) : null,
      )}
      {item(
        'profile',
        'Profile',
        <IconSvg shapes={ICON_NAV_PROFILE} size={22} />,
      )}
    </nav>
  );
}
