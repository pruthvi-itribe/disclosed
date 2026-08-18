import { useCallback, useEffect, useReducer, useState } from 'react';
import type { ApiResult } from '../shared/api/api-get';
import { usePoll } from '../shared/api/use-poll';
import type { FilingView } from '../shared/types/api';
import { filterReducer, INITIAL_FILTERS } from './filter-state';
import { initialViewState, viewReducer } from './view-state';
import { TopBar } from './TopBar';
import { Hero } from '../features/feed/Hero';
import { FeedControls } from '../features/feed/FeedControls';
import { FeedGrid } from '../shared/ui/FeedGrid';
import { BriefView } from '../features/brief/BriefView';
import { CompanyView } from '../features/company/CompanyView';
import { FocusDialog } from '../features/focus/FocusDialog';

export interface AppProps {
  /** Injected, so a test needs no network. */
  readonly apiGet: <T>(
    path: string,
    current?: () => boolean,
  ) => Promise<ApiResult<T>>;
  readonly onSessionEnded: () => void;
}

/**
 * The shell: three views behind one poll, exactly one visible. All three
 * sections stay MOUNTED with `hidden`, the way the old page kept every view
 * in the document — a tab switch must not cost the feed its scroll
 * position. The focus dialog lives outside the polled sections and holds a
 * snapshot; the Watching view and account controls arrive with Plan 3.
 */
export function App({ apiGet, onSessionEnded }: AppProps): JSX.Element {
  const [filters, dispatchFilters] = useReducer(filterReducer, INITIAL_FILTERS);
  const [viewState, dispatchView] = useReducer(
    viewReducer,
    undefined,
    initialViewState,
  );
  const [focused, setFocused] = useState<FilingView | null>(null);

  const { filings, meta, summary, live, failure, refresh } = usePoll({
    apiGet,
    view: viewState.view,
    company: viewState.company,
    filters,
    onSessionEnded,
  });

  // ONE CLASS ON THE BODY, so exactly one view is ever in scroll-lock: the
  // deck is a scroll container sized to the window, and the page behind it
  // must not scroll too.
  useEffect(() => {
    document.body.className = viewState.view === 'brief' ? 'briefing' : '';
    return () => {
      document.body.className = '';
    };
  }, [viewState.view]);

  const openCompany = useCallback((symbol: string) => {
    dispatchView({ type: 'openCompany', symbol });
  }, []);
  const openFocus = useCallback((filing: FilingView) => {
    setFocused(filing);
  }, []);
  const pickGroup = useCallback((group: string) => {
    dispatchFilters({ type: 'pickGroup', group });
  }, []);

  const items = filings ?? [];

  return (
    <>
      <TopBar
        viewState={viewState}
        live={live}
        summary={summary}
        onShowView={(view) => dispatchView({ type: 'show', view })}
      />
      <div id="alert" className="alert" hidden={failure === null}>
        {failure ?? ''}
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
        <Hero summary={summary} />
        <FeedControls
          filters={filters}
          onChip={(topic, plans) =>
            dispatchFilters({ type: 'chip', topic, plans })
          }
          onOnlyInsights={(value) =>
            dispatchFilters({ type: 'onlyInsights', value })
          }
        />
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
        />
      )}

      {focused !== null && (
        <FocusDialog filing={focused} onClose={() => setFocused(null)} />
      )}
    </>
  );
}
