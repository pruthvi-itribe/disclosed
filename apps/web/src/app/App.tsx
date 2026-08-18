import { useCallback, useReducer, useRef, useState } from 'react';
import type { ApiEnvelope, ApiResult } from '../shared/api/api-get';
import type { SendMethod } from '../shared/api/api-send';
import { usePoll } from '../shared/api/use-poll';
import type { WatchControls } from '../shared/ui/WatchButton';
import type { FilingView } from '../shared/types/api';
import { filterReducer, INITIAL_FILTERS } from './filter-state';
import { useFilterDispatch } from './use-filter-dispatch';
import { useBriefBodyClass } from './use-brief-body-class';
import { initialViewState, viewReducer } from './view-state';
import { TopBar } from './TopBar';
import { Hero } from '../features/feed/Hero';
import { FeedGrid } from '../shared/ui/FeedGrid';
import { BriefView } from '../features/brief/BriefView';
import { CompanyView } from '../features/company/CompanyView';
import { FocusDialog } from '../features/focus/FocusDialog';
import { WatchingView } from '../features/watching/WatchingView';
import { useShareSlots } from '../features/share/share-slots';
import { AlertsToggle } from '../features/alerts/AlertsToggle';
import { useAccountSurfaces } from './use-account-surfaces';
import { ShellChrome } from './ShellChrome';
import { FilterControls } from './FilterControls';
import type { SearchBoxHandle } from '../features/search/SearchBox';
import type { WatchlistFeedMeta } from '../shared/types/account';

export interface AppProps {
  /** Injected, so a test needs no network. */
  readonly apiGet: <T>(
    path: string,
    current?: () => boolean,
  ) => Promise<ApiResult<T>>;
  readonly apiSend: <T>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ) => Promise<ApiEnvelope<T>>;
  readonly onSessionEnded: () => void;
}

/**
 * The shell: three views behind one poll, exactly one visible. All three
 * sections stay MOUNTED with `hidden`, the way the old page kept every view
 * in the document — a tab switch must not cost the feed its scroll
 * position. The focus dialog lives outside the polled sections and holds a
 * snapshot; the Watching view and account controls arrive with Plan 3.
 */
export function App({
  apiGet,
  apiSend,
  onSessionEnded,
}: AppProps): JSX.Element {
  const [filters, dispatchFilters] = useReducer(filterReducer, INITIAL_FILTERS);
  const [viewState, dispatchView] = useReducer(
    viewReducer,
    undefined,
    initialViewState,
  );
  const [focused, setFocused] = useState<FilingView | null>(null);
  // The search DRAFT is the box's own state (see SearchBox's header) — held
  // here it re-rendered the whole shell per keystroke. This ref is the one
  // external write the box allows: Clear emptying the input.
  const searchBox = useRef<SearchBoxHandle>(null);
  // The shell's boot mark, set by main.tsx before React runs; a browser
  // never carries it, so every shell-only branch below is dead code there.
  const shell = document.documentElement.classList.contains('native-shell');
  const [sheet, setSheet] = useState<'explore' | 'profile' | null>(null);

  const { account, watch, alerts, onHealthy } = useAccountSurfaces({
    apiSend,
    onSessionEnded,
  });

  const { filings, meta, summary, live, failure, refresh } = usePoll({
    apiGet,
    apiSend,
    view: viewState.view,
    company: viewState.company,
    filters,
    onSessionEnded,
    onHealthy,
  });

  // Null when signed out, so every star-drawing surface draws nothing. A
  // toggle from inside the Watching view asks for an immediate poll — the
  // poll owns that list, and an unwatched row must not sit there for four
  // seconds.
  const watchControls: WatchControls | null =
    account.me?.signedIn === true
      ? {
          watched: watch.watched,
          pending: watch.pending,
          onToggle: (symbol) => {
            void watch.toggle(symbol).then(() => {
              if (viewState.view === 'watching') refresh();
            });
          },
        }
      : null;

  useBriefBodyClass(viewState.view);

  const openCompany = useCallback((symbol: string) => {
    dispatchView({ type: 'openCompany', symbol });
  }, []);
  const openFocus = useCallback((filing: FilingView) => {
    setFocused(filing);
  }, []);
  const pickGroup = useCallback((group: string) => {
    dispatchFilters({ type: 'pickGroup', group });
  }, []);
  const { onCard: shareOnCard, onFocus: shareOnFocus } = useShareSlots();

  const items = filings ?? [];

  // One controls element, two homes — see FilterControls; the commit
  // behaviour is use-filter-dispatch's.
  const filterDispatch = useFilterDispatch({
    shell,
    dispatchFilters,
    onCommitted: useCallback(() => {
      setSheet(null);
      dispatchView({ type: 'show', view: 'feed' });
    }, []),
  });
  const controls = (
    <FilterControls
      ref={searchBox}
      filters={filters}
      apiGet={apiGet}
      dispatch={filterDispatch}
    />
  );

  return (
    <>
      <TopBar
        compact={shell}
        viewState={viewState}
        live={live}
        summary={summary}
        me={account.me}
        unread={account.unread}
        onShowView={(view) => dispatchView({ type: 'show', view })}
        onSignOut={account.signOut}
      />
      {/* One banner, last-writer-wins the way the old #alert did; the poll's
          sentence outranks the account's because it is the fresher fact. */}
      <div
        id="alert"
        className="alert"
        hidden={
          failure === null && account.failure === null && watch.failure === null
        }
      >
        {failure ?? account.failure ?? watch.failure ?? ''}
      </div>

      <section
        id="view-brief"
        data-ui="view-brief"
        className="view"
        role="tabpanel"
        aria-labelledby="tab-brief"
        hidden={viewState.view !== 'brief'}
      >
        <BriefView
          items={viewState.view === 'brief' ? items : []}
          meta={viewState.view === 'brief' ? meta : null}
          summary={summary}
          onOpenCompany={openCompany}
          onPickTopic={(topic) => {
            // The recorded asymmetry: the pill sets the topic and ONLY the
            // topic, unlike the chip row's both-axes write — then lands the
            // reader on the feed it just filtered.
            dispatchFilters({ type: 'chip', topic, plans: filters.plans });
            dispatchView({ type: 'show', view: 'feed' });
          }}
          onToFeed={() => dispatchView({ type: 'show', view: 'feed' })}
        />
      </section>

      <section
        id="view-feed"
        data-ui="view-feed"
        className="view"
        role="tabpanel"
        aria-labelledby="tab-feed"
        hidden={viewState.view !== 'feed'}
      >
        <Hero summary={summary} compact={shell} />
        {!shell && controls}
        <FeedGrid
          items={viewState.view === 'feed' ? items : []}
          meta={viewState.view === 'feed' ? meta : null}
          chrome
          filters={filters}
          todayIstDay={summary?.todayIstDay ?? null}
          previousIstDay={summary?.previousIstDay ?? null}
          onOpenCompany={openCompany}
          onOpenFocus={openFocus}
          onPickGroup={pickGroup}
          onGrow={() => dispatchFilters({ type: 'grow' })}
          watch={watchControls}
          share={shareOnCard}
        />
      </section>

      <section
        id="view-watching"
        data-ui="view-watching"
        className="view"
        role="tabpanel"
        aria-labelledby="tab-watching"
        hidden={viewState.view !== 'watching'}
      >
        {/* MOUNTED FROM SIGN-IN, hidden with its section — the old page kept
            the whole Watching section in the document, and #watch-count
            updates on every toggle before the tab is ever opened. */}
        <WatchingView
          // UNTIL THE WATCHLIST RESPONSE LANDS, the poll's meta is still
          // the FEED's — a page window with no roster in it. The view must
          // see null (its loading state), never a meta of the wrong shape:
          // handing it one crashed the page live on 2026-08-18.
          items={meta !== null && 'watching' in meta ? items : []}
          meta={
            meta !== null && 'watching' in meta
              ? (meta as WatchlistFeedMeta)
              : null
          }
          filters={filters}
          todayIstDay={summary?.todayIstDay ?? null}
          previousIstDay={summary?.previousIstDay ?? null}
          watch={watchControls}
          // Server-owned, on two channels (api/me, the watchlist read's
          // meta) — never invented: a hardcoded 50 here would print a
          // denominator no server sent.
          watchCap={account.me?.watchCap ?? watch.counts?.cap ?? null}
          counts={watch.counts}
          alerts={
            <AlertsToggle
              permission={alerts.permission}
              onRequest={alerts.request}
            />
          }
          onOpenCompany={openCompany}
          onOpenFocus={openFocus}
          onPickGroup={pickGroup}
          share={shareOnCard}
          onRoster={watch.setFromRoster}
          onSeen={account.clearUnread}
        />
      </section>

      {viewState.company !== null && (
        <CompanyView
          symbol={viewState.company}
          items={items}
          meta={meta}
          filters={filters}
          todayIstDay={summary?.todayIstDay ?? null}
          previousIstDay={summary?.previousIstDay ?? null}
          onBack={() => {
            dispatchView({ type: 'show', view: 'feed' });
            refresh();
          }}
          onOpenCompany={openCompany}
          onOpenFocus={openFocus}
          onPickGroup={pickGroup}
          watch={watchControls}
          share={shareOnCard}
        />
      )}

      {focused !== null && (
        <FocusDialog
          filing={focused}
          onClose={() => setFocused(null)}
          watch={watchControls}
          share={shareOnFocus}
        />
      )}

      {shell && (
        <ShellChrome
          view={viewState.view}
          company={viewState.company}
          sheet={sheet}
          unread={account.unread}
          email={account.me?.email ?? ''}
          counts={watch.counts}
          controls={controls}
          onShowView={(view) => dispatchView({ type: 'show', view })}
          onSheet={setSheet}
          onSignOut={account.signOut}
        />
      )}
    </>
  );
}
