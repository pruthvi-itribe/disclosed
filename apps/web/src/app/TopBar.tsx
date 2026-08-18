import { BrandLogo } from './BrandLogo';
import { LiveIndicator } from '../features/feed/LiveIndicator';
import type { LiveKind } from '../shared/api/use-poll';
import type { SummaryView } from '../shared/types/api';
import type { MeView } from '../shared/types/account';
import type { ViewState } from './view-state';

/**
 * Brand, the tabs, the account controls and the live indicator. The Brief
 * tab is first because it is what a phone lands on; NO TAB IS LIT WHILE
 * COMPANY IS OPEN — the company view is reached from a card, not a tab.
 *
 * The account controls render NOTHING until api/me answers: "we do not know
 * yet" is a third state, and drawing either of the other two through it
 * makes the header flicker on load. Sign out is a SIBLING of nav.tabs — a
 * non-tab child of a role=tablist is an ARIA violation — sharing the tab's
 * styling by class and taking none of its role. The unread badge is a CHILD
 * of the Watching tab, absent at zero (a badge reading 0 is furniture that
 * teaches a reader to stop looking at it), capped at 99+.
 */
export function TopBar({
  viewState,
  live,
  summary,
  me,
  unread,
  onShowView,
  onSignOut,
  compact = false,
}: {
  /**
   * The shell's slim header: brand and the live dot only — the tabs live
   * in the bottom bar there and the account moved to the Profile sheet.
   * The web never passes it.
   */
  readonly compact?: boolean;
  readonly viewState: ViewState;
  readonly live: LiveKind;
  readonly summary: SummaryView | null;
  readonly me: MeView | undefined;
  readonly unread: number;
  readonly onShowView: (view: 'brief' | 'feed' | 'watching') => void;
  readonly onSignOut: () => void;
}): JSX.Element {
  const signedIn = me !== undefined && me.signedIn;

  const tab = (
    view: 'brief' | 'feed' | 'watching',
    id: string,
    label: string,
    badge?: JSX.Element | null,
  ) => {
    const active = viewState.view === view;
    return (
      <button
        id={id}
        className={`tab${active ? ' active' : ''}`}
        type="button"
        role="tab"
        aria-selected={active}
        aria-controls={`view-${view}`}
        onClick={() => onShowView(view)}
      >
        {label}
        {badge}
      </button>
    );
  };

  if (compact) {
    return (
      <header className="topbar" data-ui="top-bar">
        <div className="brand">
          <BrandLogo />
        </div>
        <LiveIndicator
          live={live}
          generatedAtIst={summary?.generatedAtIst ?? null}
        />
      </header>
    );
  }

  return (
    <header className="topbar" data-ui="top-bar">
      <div className="brand">
        <BrandLogo />
      </div>
      <nav className="tabs" role="tablist">
        {tab('brief', 'tab-brief', 'Brief')}
        {tab('feed', 'tab-feed', 'Feed')}
        {signedIn &&
          tab(
            'watching',
            'tab-watching',
            'Watching',
            unread > 0 ? (
              <span id="tab-watching-count" className="tabcount">
                {unread > 99 ? '99+' : String(unread)}
              </span>
            ) : null,
          )}
      </nav>
      <div className="account" data-ui="account">
        {signedIn && (
          <button
            id="signout"
            className="tab"
            type="button"
            onClick={onSignOut}
          >
            Sign out
          </button>
        )}
      </div>
      <LiveIndicator
        live={live}
        generatedAtIst={summary?.generatedAtIst ?? null}
      />
    </header>
  );
}
