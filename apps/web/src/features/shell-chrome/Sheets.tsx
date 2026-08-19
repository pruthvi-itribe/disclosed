import './shell-chrome.css';

/**
 * The shell's two full-screen sheets, as one dumb frame: a title and
 * whatever App composes in — the search-and-filters cluster (the SAME
 * FeedControls the web feed renders, relocated) or the profile. Slots
 * rather than imports, because features do not import features.
 *
 * NO CLOSE BUTTON. It carried a "Done" that duplicated a control the
 * screen already has (called out 2026-08-19): the bottom bar stays
 * visible beneath the sheet, so tapping the lit tab closes it and
 * tapping any other tab leaves for that view — both through
 * ShellChrome's pick(). A second way out of one screen is one too many.
 */
export function Sheet({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="sheet" role="dialog" aria-label={title} data-ui="sheet">
      <div className="sheethead">
        <h2>{title}</h2>
      </div>
      <div className="sheetbody">{children}</div>
    </div>
  );
}

/**
 * The profile surface the top bar's small controls never gave a phone:
 * who is signed in, what they watch, the preferences composed in, and —
 * LAST, under all of it — the door out. Sign out sat directly under the
 * identity rows and pushed the notification preferences below the fold
 * (called out 2026-08-19); a destructive control belongs at the end of a
 * screen, not in the middle of it.
 */
export function ProfileContent({
  email,
  countsLine,
  onSignOut,
  children,
}: {
  readonly email: string;
  readonly countsLine: string;
  readonly onSignOut: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="profile" data-ui="profile">
      <div className="profilerow">
        <span className="profilelabel">Signed in as</span>
        <span className="profilevalue" data-ui="profile-email">
          {email}
        </span>
      </div>
      <div className="profilerow">
        <span className="profilelabel">Watching</span>
        <span className="profilevalue" data-ui="profile-watching">
          {countsLine}
        </span>
      </div>
      {children}
      <button
        type="button"
        className="profilesignout"
        data-ui="profile-sign-out"
        onClick={onSignOut}
      >
        Sign out
      </button>
    </div>
  );
}
