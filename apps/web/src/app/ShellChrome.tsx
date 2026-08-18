import { BottomNav, type NavPick } from '../features/shell-chrome/BottomNav';
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
  view,
  company,
  sheet,
  unread,
  email,
  counts,
  controls,
  onShowView,
  onSheet,
  onSignOut,
}: {
  readonly view: string;
  readonly company: string | null;
  readonly sheet: 'explore' | 'profile' | null;
  readonly unread: number;
  readonly email: string;
  readonly counts: { readonly used: number; readonly cap: number } | null;
  readonly controls: JSX.Element;
  readonly onShowView: (view: 'brief' | 'feed' | 'watching') => void;
  readonly onSheet: (sheet: 'explore' | 'profile' | null) => void;
  readonly onSignOut: () => void;
}): JSX.Element {
  // Null while a company is open: reached from a card, not a tab.
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
        <Sheet title="Search and filters" onClose={() => onSheet(null)}>
          {controls}
        </Sheet>
      )}
      {sheet === 'profile' && (
        <Sheet title="Profile" onClose={() => onSheet(null)}>
          <ProfileContent
            email={email}
            countsLine={countsLine}
            onSignOut={onSignOut}
          />
        </Sheet>
      )}
      <BottomNav active={sheet ?? navView} unread={unread} onPick={pick} />
    </>
  );
}
