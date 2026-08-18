import { BrandLogo } from './BrandLogo';
import { LiveIndicator } from '../features/feed/LiveIndicator';
import type { LiveKind } from '../shared/api/use-poll';
import type { SummaryView } from '../shared/types/api';
import type { ViewState } from './view-state';

/**
 * Brand, the tabs and the live indicator. The Brief tab is first because it
 * is what a phone lands on. NO TAB IS LIT WHILE COMPANY IS OPEN — the
 * company view is reached from a card, not a tab. The Watching tab and the
 * account controls arrive with Plan 3; the status block is a SIBLING of
 * nav.tabs, never a child, because a non-tab child of a role="tablist" is
 * an ARIA violation.
 */
export function TopBar({
  viewState,
  live,
  summary,
  onShowView,
}: {
  readonly viewState: ViewState;
  readonly live: LiveKind;
  readonly summary: SummaryView | null;
  readonly onShowView: (view: 'brief' | 'feed') => void;
}): JSX.Element {
  const tab = (view: 'brief' | 'feed', id: string, label: string) => {
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
      </button>
    );
  };
  return (
    <header className="topbar" data-ui="top-bar">
      <div className="brand">
        <BrandLogo />
      </div>
      <nav className="tabs" role="tablist">
        {tab('brief', 'tab-brief', 'Brief')}
        {tab('feed', 'tab-feed', 'Feed')}
      </nav>
      <LiveIndicator
        live={live}
        generatedAtIst={summary?.generatedAtIst ?? null}
      />
    </header>
  );
}
