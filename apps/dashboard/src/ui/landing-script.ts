/**
 * The landing page's client code: sign in with Google without leaving the page.
 *
 * SAME SHARP EDGE AS `auth-script.ts` AND `ui/script/*`: this is a TypeScript
 * template literal, so a backtick or a `${` anywhere below — including inside a
 * comment — is eaten by the compiler and ships a page that serves 200 and throws
 * on load. `landing.spec.ts` asserts both, beside the fragments the sign-in page
 * and the dashboard already guard.
 *
 * EMITTED IN FIREBASE MODE ONLY, inside a `<script type="module">` whose imports
 * it closes over. A `local` host, and a host that asked for Firebase before its
 * keys arrived, ship no byte of this and no script element at all — see
 * `landing.ts`.
 *
 * ================================================================
 * WHY THIS IS A SECOND COPY OF SOME OF `auth-script.ts` AND NOT A SHARED ONE
 * ================================================================
 *
 * The two pages run the same exchange — popup, ID token, our own POST, sign the
 * browser out of Firebase again — and about twenty lines of it read alike. They
 * share nothing else. `/auth` has one button, a busy state over `.authbtn`, two
 * message lines it owns, and the verification lane; this page has three call-to-
 * action links scattered down a marketing page, no busy state, a message line
 * per link, and a fallback the sign-in page cannot have (it IS the fallback).
 * A shared fragment would have to be parameterised on all four, which is more
 * code than the twenty lines it saves and puts the sign-in page one edit away
 * from a change made for the landing page. The pinned SDK version, the origin
 * and the JSON encoder ARE shared — those are facts about Firebase rather than
 * about a page, and they live in `firebase-sdk.ts`.
 *
 * ================================================================
 * WHAT A FAILING POPUP DOES, EXPLICITLY
 * ================================================================
 *
 *   - Blocked by the browser, or a browser that cannot do popups at all: the
 *     page navigates to `/auth`, which signs people in the way it always has.
 *     The anchors keep their `href="/auth"` for the same reason — with this
 *     script broken or still loading, every button on the page is still a link
 *     that works.
 *   - Closed by the reader, or superseded by a second press: nothing is said.
 *     Shutting a window is a decision and so is pressing the button again, and
 *     a red box under the button for a decision teaches people to ignore red
 *     boxes.
 *   - Anything else: the sentence `/auth` would have shown, in the line under
 *     the button that was pressed. The two pages must not disagree about what a
 *     failure means.
 *
 * WHAT IT DOES NOT DO: send the verification mail. `/auth` owns that lane, and
 * a Google sign-in arrives verified, so a copy of it here would be a branch
 * nobody reaches maintained on the marketing page. An unverified record is
 * signed out of Firebase and handed to `/auth`, which sends the link and says so.
 */
export const LANDING_SCRIPT_FIREBASE = `
  var settings = JSON.parse(document.getElementById('firebase-config').textContent);
  var auth = getAuth(initializeApp({
    apiKey: settings.apiKey,
    authDomain: settings.authDomain,
    projectId: settings.projectId
  }));

  // The two codes that mean there is no popup to be had. Both are answered by
  // going to the sign-in page, which is where this button pointed before any of
  // this ran.
  var NO_POPUP = {
    'auth/popup-blocked': true,
    'auth/operation-not-supported-in-this-environment': true
  };

  // The sentences the sign-in page shows, for the codes a Google popup can
  // still produce once it has opened. Anything unmapped gets the last line, as
  // it does there.
  var MESSAGES = {
    'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.'
  };

  // The two codes that are the reader's own doing, and are answered with
  // silence. A red box under the button for something somebody chose to do
  // teaches people to ignore red boxes.
  //
  // NO 'ONE POPUP AT A TIME' LATCH, MEASURED RATHER THAN ASSUMED. The first
  // draft held one until the promise settled, which is what the sign-in page's
  // disabled button does. Firebase does not notice a closed window immediately:
  // measured against the real project in headless chromium, the rejection
  // arrived 10.0s after the popup was closed, so the button sat dead for ten
  // seconds after a reader closed the window and reached for it again. Letting
  // the second press through instead opens the window they asked for, and
  // Firebase cancels the request behind it and says so with the second code.
  var SILENT = {
    'auth/popup-closed-by-user': true,
    'auth/cancelled-popup-request': true
  };

  function clearLines() {
    var lines = document.getElementsByClassName('ctaerr');
    for (var i = 0; i < lines.length; i++) {
      lines[i].hidden = true;
      lines[i].textContent = '';
    }
  }

  function toAuthPage() {
    window.location.assign('/auth');
  }

  // The one write this page makes, and the only api path it names. Same
  // envelope contract as the sign-in page's 'postJson': a body that is not a
  // success envelope is an error rather than an empty result.
  //
  // 'credentials: same-origin' is the default, stated: this cookie is the whole
  // session, and an edit that set 'omit' would make every sign-in appear to
  // succeed and then forget itself.
  function postToken(idToken) {
    return fetch('api/auth/firebase', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: idToken })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (parsed) {
        if (res.ok && parsed && parsed.success === true) return parsed;
        var failure = new Error('The sign-in service refused (' + res.status + ').');
        failure.code = parsed && parsed.error ? parsed.error.code : '';
        throw failure;
      });
    });
  }

  // Token out, our cookie back, Firebase session dropped. From here the opaque
  // cookie our server set is the session, so there is nothing to keep.
  //
  // 'replace' rather than 'assign': the back button from the feed must not land
  // on a landing page that now belongs to a signed-in reader.
  function handOver(user) {
    return user.getIdToken()
      .then(postToken)
      .then(function () { return signOut(auth).catch(function () { return null; }); })
      .then(function () { window.location.replace('/'); });
  }

  function report(error, line) {
    var code = error && error.code ? String(error.code) : '';
    if (Object.prototype.hasOwnProperty.call(SILENT, code)) return;
    if (Object.prototype.hasOwnProperty.call(NO_POPUP, code)) {
      toAuthPage();
      return;
    }
    line.textContent = Object.prototype.hasOwnProperty.call(MESSAGES, code)
      ? MESSAGES[code]
      : 'That sign-in did not work. Try again.';
    line.hidden = false;
  }

  function start(event, line) {
    // The anchor still points at the sign-in page and still works; this
    // replaces that navigation with the popup, which is the whole change.
    event.preventDefault();
    clearLines();

    var provider = new GoogleAuthProvider();
    // Always ask which account. Without this a shared browser silently reuses
    // whoever signed in last, which on a phone handed to a colleague is the
    // wrong person's watchlist.
    provider.setCustomParameters({ prompt: 'select_account' });

    signInWithPopup(auth, provider)
      .then(function (credential) {
        if (credential.user.emailVerified !== true) {
          return signOut(auth).catch(function () { return null; }).then(toAuthPage);
        }
        return handOver(credential.user);
      })
      .catch(function (error) { report(error, line); });
  }

  // THE SLOT IS THE PAIRING. Each call to action is a link and a line to speak
  // into, wrapped together, so the message goes under the button that was
  // pressed without any index arithmetic between two lists.
  var slots = document.getElementsByClassName('ctaslot');
  for (var s = 0; s < slots.length; s++) {
    (function (slot) {
      var line = slot.getElementsByClassName('ctaerr')[0];
      slot.getElementsByTagName('a')[0].addEventListener('click', function (event) {
        start(event, line);
      });
    })(slots[s]);
  }
`;
