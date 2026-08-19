import { BottomNav, type NavPick } from '../features/shell-chrome/BottomNav';
import { ActiveFilters } from '../features/shell-chrome/ActiveFilters';
import type { FilterAction, FilterState } from './filter-state';
import type { ViewState } from './view-state';
import { groupInt } from '../shared/format/group-int';
import { ProfileContent, Sheet } from '../features/shell-chrome/Sheets';

/**
 * Everything the shell adds around the three views: the bottom bar and the
 * two sheets (direction set 2026-08-18 — tabs at the thumb, search and
 * filters behind their own screen, a real profile surface). App composes
 * the SAME FeedControls element the web feed renders into the explore
 * sheet, so the filters keep their one implementation. Rendered only when
 * the document carries the shell's boot mark; the web never sees any of it.
 */
export function ShellChrome({
  viewState,
  sheet,
  unread,
  email,
  counts,
  filters,
  dispatch,
  onSearchCleared,
  controls,
  prefs,
  onShowView,
  onSheet,
  onSignOut,
}: {
  readonly viewState: ViewState;
  readonly sheet: 'explore' | 'profile' | null;
  readonly unread: number;
  readonly email: string;
  readonly counts: { readonly used: number; readonly cap: number } | null;
  readonly filters: FilterState;
  readonly dispatch: (action: FilterAction) => void;
  readonly onSearchCleared: () => void;
  readonly controls: JSX.Element;
  readonly prefs: JSX.Element | null;
  readonly onShowView: (view: 'brief' | 'feed' | 'watching') => void;
  readonly onSheet: (sheet: 'explore' | 'profile' | null) => void;
  readonly onSignOut: () => void;
}): JSX.Element {
  // Null while a company is open: reached from a card, not a tab.
  const { view, company } = viewState;
  const navView: NavPick | null =
    company === null &&
    (view === 'brief' || view === 'feed' || view === 'watching')
      ? view
      : null;
  const countsLine =
    counts === null
      ? ''
      : `${groupInt(counts.used)} of ${groupInt(counts.cap)} companies`;

  const pick = (picked: NavPick): void => {
    if (picked === 'explore' || picked === 'profile') {
      onSheet(sheet === picked ? null : picked);
      return;
    }
    onSheet(null);
    onShowView(picked);
  };

  return (
    <>
      {sheet === 'explore' && (
        <Sheet title="Search and filters">{controls}</Sheet>
      )}
      {sheet === 'profile' && (
        <Sheet title="Profile">
          {/* Preferences BETWEEN the identity rows and the way out: sign
              out is the last thing on the screen, not a wall in it. */}
          <ProfileContent
            email={email}
            countsLine={countsLine}
            onSignOut={onSignOut}
          >
            {prefs}
          </ProfileContent>
        </Sheet>
      )}
      {navView === 'feed' && sheet === null && (
        <ActiveFilters
          filters={filters}
          dispatch={dispatch}
          onSearchCleared={onSearchCleared}
        />
      )}
      <BottomNav active={sheet ?? navView} unread={unread} onPick={pick} />
    </>
  );
}
