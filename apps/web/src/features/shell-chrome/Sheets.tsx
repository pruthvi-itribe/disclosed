import './shell-chrome.css';

/**
 * The shell's two full-screen sheets, as one dumb frame: a title, a close
 * control, and whatever App composes in — the search-and-filters cluster
 * (the SAME FeedControls the web feed renders, relocated) or the profile.
 * Slots rather than imports, because features do not import features.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="sheet" role="dialog" aria-label={title} data-ui="sheet">
      <div className="sheethead">
        <h2>{title}</h2>
        <button
          type="button"
          className="sheetclose"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          Done
        </button>
      </div>
      <div className="sheetbody">{children}</div>
    </div>
  );
}

/**
 * The profile surface the top bar's small controls never gave a phone:
 * who is signed in, what they watch, and the door out.
 */
export function ProfileContent({
  email,
  countsLine,
  onSignOut,
}: {
  readonly email: string;
  readonly countsLine: string;
  readonly onSignOut: () => void;
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
