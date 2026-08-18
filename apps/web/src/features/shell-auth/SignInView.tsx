import { useState } from 'react';
import type { ApiEnvelope } from '../../shared/api/api-get';
import type { SendMethod } from '../../shared/api/api-send';
import './shell-auth.css';

/**
 * The shell's front door. The web app never needed one — the server answers
 * a signed-out browser with the landing page — but the shell has no front
 * door: its first build painted a themed void and polled 401s forever
 * (found on the simulator, 2026-08-18). Direction set the same day: a
 * SIMPLE sign-in with a three-slide story, not the website's dense landing.
 *
 * The slides are a scroll-snap carousel — the Brief's own gesture, no
 * library — and the sign-in card sits beneath them on every slide, so the
 * story never stands between a returning reader and the door.
 */
const SLIDES = [
  {
    head: 'Every claim, verified',
    body:
      'Disclosed reads every NSE and BSE filing as it is published, and ' +
      'shows only what it can match, character for character, against the ' +
      'source document.',
  },
  {
    head: 'Your companies find you',
    body:
      'Watch the companies you care about. Their verified filings reach ' +
      'you minutes after the exchange publishes them.',
  },
  {
    head: 'No ratings, no advice',
    body:
      'Disclosed reports what documents say and shows you where they say ' +
      'it. Nothing else.',
  },
];

export type ShellAuthMode = 'local' | 'firebase';

export interface SignInViewProps {
  /**
   * The same mark the top bar draws, composed in by main.tsx — the door
   * must say whose door it is. A slot rather than an import, because
   * features do not reach into app/.
   */
  readonly brand: JSX.Element;
  readonly authMode: ShellAuthMode;
  readonly apiSend: <T>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ) => Promise<ApiEnvelope<T>>;
  /** Reboots the shell; the session cookie is set by the answer above. */
  readonly onSignedIn: () => void;
  /**
   * The native Google door: resolves a Firebase ID token, exchanged at the
   * existing POST /api/auth/firebase for the same session the web gets.
   * Null until the native module is wired — the button then explains
   * itself instead of doing nothing.
   */
  readonly signInWithGoogle: (() => Promise<string>) | null;
}

export function SignInView({
  brand,
  authMode,
  apiSend,
  onSignedIn,
  signInWithGoogle,
}: SignInViewProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [at, setAt] = useState(0);

  const fail = (error: unknown): void => {
    setFailure(
      error instanceof Error ? error.message : 'That sign-in did not work.',
    );
  };

  const google = (): void => {
    if (signInWithGoogle === null) {
      setFailure(
        'Google sign-in needs the native module, which arrives with the next build.',
      );
      return;
    }
    signInWithGoogle()
      .then((idToken) => apiSend('/api/auth/firebase', 'POST', { idToken }))
      .then(onSignedIn, fail);
  };

  return (
    <div className="shellauth" data-ui="shell-auth">
      <div className="doorbrand" data-ui="shell-brand">
        {brand}
      </div>
      <div
        className="slides"
        data-ui="shell-slides"
        onScroll={(event) => {
          const box = event.currentTarget;
          if (box.clientWidth > 0) {
            setAt(Math.round(box.scrollLeft / box.clientWidth));
          }
        }}
      >
        {SLIDES.map((slide) => (
          <section key={slide.head} className="slide">
            <h2>{slide.head}</h2>
            <p>{slide.body}</p>
          </section>
        ))}
      </div>
      <div className="slidedots" aria-hidden="true">
        {SLIDES.map((slide, i) => (
          <span key={slide.head} className={`dot${i === at ? ' on' : ''}`} />
        ))}
      </div>

      <div className="doorcard" data-ui="shell-door">
        {authMode === 'firebase' ? (
          <button id="shell-google" type="button" onClick={google}>
            Continue with Google
          </button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              apiSend('/api/auth/login', 'POST', { email, password }).then(
                onSignedIn,
                fail,
              );
            }}
          >
            <input
              id="shell-email"
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <input
              id="shell-password"
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button id="shell-signin" type="submit">
              Sign in
            </button>
          </form>
        )}
        {/* The server's sentence, verbatim: INVALID_CREDENTIALS and its
            siblings are copy somebody wrote to be read. */}
        <div id="shell-failure" className="doorfail" hidden={failure === null}>
          {failure ?? ''}
        </div>
      </div>
    </div>
  );
}
