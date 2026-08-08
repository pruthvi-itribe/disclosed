/**
 * The sign-in page's client code, as fragments.
 *
 * SAME SHARP EDGE AS `ui/script/*`: these are TypeScript template literals, so
 * a backtick or a `${` anywhere below — including inside a comment — is eaten by
 * the compiler and ships a page that serves 200 and throws on load. Every regex
 * backslash is doubled for the same reason. `auth-page.spec.ts` asserts both,
 * beside the fragments the dashboard already guards.
 *
 * THE SHARED FRAGMENT RUNS FIRST in both modes, and the mode fragment after it,
 * inside one function scope — the same arrangement `page-script.ts` uses. The
 * Firebase mode's fragment additionally closes over the module-scope imports the
 * page writes above it, which is why that one is only ever emitted inside a
 * `<script type="module">`.
 */

/**
 * DOM helpers, the message lines, and the two things every path ends in.
 *
 * `goToApp` uses `location.replace` rather than `assign`, so the back button
 * from the feed does not land on the sign-in page of a session that now exists —
 * which presents as a sign-in form that ignores you, because you are already in.
 */
export const AUTH_SCRIPT_SHARED = `
  function el(id) { return document.getElementById(id); }

  function show(node, message) {
    node.textContent = message;
    node.hidden = false;
  }

  function hide(node) {
    node.hidden = true;
    node.textContent = '';
  }

  function fail(message) {
    hide(el('auth-ok'));
    show(el('auth-error'), message);
  }

  function tell(message) {
    hide(el('auth-error'));
    show(el('auth-ok'), message);
  }

  function clearMessages() {
    hide(el('auth-error'));
    hide(el('auth-ok'));
  }

  function busy(state) {
    var buttons = document.getElementsByClassName('authbtn');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = state;
  }

  function goToApp() {
    window.location.replace('/');
  }

  // The one write this page makes. Same envelope contract as the app's
  // 'postJson': a body that is not a success envelope is an error rather than an
  // empty result, and the server's own message is what a reader is shown.
  //
  // 'credentials: same-origin' is the default, stated: this cookie is the whole
  // session, and an edit that set 'omit' would make every sign-in appear to
  // succeed and then forget itself.
  function postJson(path, body) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (parsed) {
        if (res.ok && parsed && parsed.success === true) return parsed;
        var failure = new Error(
          parsed && parsed.error && parsed.error.message
            ? parsed.error.message
            : 'That did not work (' + res.status + ').'
        );
        failure.code = parsed && parsed.error ? parsed.error.code : '';
        throw failure;
      });
    });
  }

  // Which form is showing. Held in a variable rather than read back off the
  // button labels: the labels are copy and the mode is behaviour, and reading
  // one from the other is how a rewording starts registering people who meant
  // to sign in.
  var mode = 'login';

  function applyMode() {
    var registering = mode === 'register';
    el('auth-title').textContent = registering ? 'Create an account' : 'Sign in';
    el('auth-lead').textContent = registering
      ? 'Pick the companies you care about and everything they file collects in one place.'
      : 'Welcome back.';
    el('auth-go').textContent = registering ? 'Create account' : 'Sign in';
    el('auth-alt').textContent = registering
      ? 'I already have an account'
      : 'Create an account';
    // The password manager has to be told which of the two this is, or it offers
    // a saved password on a signup form and a generator on neither.
    el('auth-password').setAttribute(
      'autocomplete',
      registering ? 'new-password' : 'current-password'
    );
    clearMessages();
  }

  el('auth-alt').addEventListener('click', function () {
    mode = mode === 'register' ? 'login' : 'register';
    applyMode();
  });

  applyMode();
`;

/**
 * The in-house path: the same two routes the dashboard's panel has always
 * posted to.
 *
 * DORMANT ON A FIREBASE HOST, not deleted — this fragment is simply not emitted
 * there, and the routes answer 409. It is what runs before the founder's keys
 * arrive and what the browser suite signs in through.
 */
export const AUTH_SCRIPT_LOCAL = `
  el('auth-form').addEventListener('submit', function (event) {
    // MUST NOT SUBMIT NATIVELY. A native POST would navigate to a JSON body,
    // and the password would be in the URL if the form ever gained a GET.
    event.preventDefault();
    clearMessages();
    busy(true);

    postJson(
      mode === 'register' ? 'api/auth/register' : 'api/auth/login',
      { email: el('auth-email').value, password: el('auth-password').value }
    )
      .then(goToApp)
      .catch(function (err) {
        // The server's own sentence. The login failure is deliberately
        // identical for a wrong password and an unknown address, and rewriting
        // it here would be this page inventing a distinction the server
        // refused to make.
        fail(err && err.message ? err.message : 'That did not work.');
        busy(false);
      });
  });
`;

/**
 * The Firebase path.
 *
 * ================================================================
 * WHAT THE BROWSER DOES, AND WHAT IT DOES NOT
 * ================================================================
 *
 * The SDK proves who somebody is to Google and hands back a short-lived ID
 * token. This fragment posts that token ONCE to our own server and then signs
 * the browser out of Firebase again, because from that moment the only session
 * that matters is the opaque cookie our server set. There is no Firebase state
 * to keep, no refresh token to store and nothing in `localStorage` — which also
 * means a shared machine does not keep a Google session alive behind a signed
 * out reader.
 *
 * ================================================================
 * A VERIFIED ADDRESS, AND THE PAGE HELPS RATHER THAN SCOLDS
 * ================================================================
 *
 * The server requires `email_verified` on every sign-in — `firebase-sign-in.ts`
 * has the argument, and the short version is that requiring it only when
 * linking turns the refusal into a registered-address oracle. The cost lands
 * here, on the person who just made a password account, so this fragment sends
 * the verification email itself rather than leaving them at a wall. Firebase
 * sends it; this product still has no mail lane of its own.
 */
export const AUTH_SCRIPT_FIREBASE = `
  var settings = JSON.parse(el('firebase-config').textContent);
  var app = initializeApp({
    apiKey: settings.apiKey,
    authDomain: settings.authDomain,
    projectId: settings.projectId
  });
  var auth = getAuth(app);

  // Firebase's own codes, translated once.
  //
  // THE FOUR CREDENTIAL FAILURES COLLAPSE INTO ONE SENTENCE. Firebase
  // distinguishes 'user-not-found' from 'wrong-password', which is a
  // registered-address oracle; this product's password path spends its whole
  // header refusing to build one and this page is not the place it reappears.
  var MESSAGES = {
    'auth/invalid-email': 'That does not look like an email address.',
    'auth/weak-password': 'Pick a longer password - at least six characters.',
    'auth/email-already-in-use': 'That address already has an account. Sign in instead.',
    'auth/popup-closed-by-user': 'The Google window closed before sign-in finished.',
    'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
    'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.'
  };

  var SAME_ANSWER = {
    'auth/user-not-found': true,
    'auth/wrong-password': true,
    'auth/invalid-credential': true,
    'auth/invalid-login-credentials': true
  };

  function explain(error) {
    var code = error && error.code ? String(error.code) : '';
    if (Object.prototype.hasOwnProperty.call(SAME_ANSWER, code)) {
      return 'Email or password is incorrect.';
    }
    if (Object.prototype.hasOwnProperty.call(MESSAGES, code)) return MESSAGES[code];
    return 'That sign-in did not work. Try again.';
  }

  // The whole exchange: token out, our cookie back, Firebase session dropped.
  function handOver(user) {
    return user.getIdToken().then(function (idToken) {
      return postJson('api/auth/firebase', { idToken: idToken });
    }).then(function () {
      // Dropped rather than kept. Our cookie is the session from here.
      return signOut(auth).catch(function () { return null; });
    }).then(goToApp);
  }

  // An unverified address, handled rather than reported. Firebase sends the
  // mail; we sign the browser out again so a half-finished sign-up leaves no
  // Google session behind on a shared machine.
  function askForVerification(user) {
    return sendEmailVerification(user)
      .then(function () {
        tell('Check your inbox - we sent a link to ' + user.email +
          '. Open it, then sign in again.');
      })
      .catch(function (error) {
        fail(explain(error));
      })
      .then(function () {
        return signOut(auth).catch(function () { return null; });
      });
  }

  function afterFirebase(credential) {
    var user = credential.user;
    if (user.emailVerified !== true) return askForVerification(user);
    return handOver(user);
  }

  el('auth-google').addEventListener('click', function () {
    clearMessages();
    busy(true);
    var provider = new GoogleAuthProvider();
    // Always ask which account. Without this a shared browser silently reuses
    // whoever signed in last, which on a phone handed to a colleague is the
    // wrong person's watchlist.
    provider.setCustomParameters({ prompt: 'select_account' });
    signInWithPopup(auth, provider)
      .then(afterFirebase)
      .catch(function (error) { fail(explain(error)); })
      .then(function () { busy(false); });
  });

  el('auth-form').addEventListener('submit', function (event) {
    event.preventDefault();
    clearMessages();
    busy(true);

    var email = el('auth-email').value;
    var password = el('auth-password').value;
    var attempt = mode === 'register'
      ? createUserWithEmailAndPassword(auth, email, password)
      : signInWithEmailAndPassword(auth, email, password);

    attempt
      .then(function (credential) {
        // A brand new account is never verified, so this always lands in the
        // "check your inbox" branch rather than in a refusal.
        return afterFirebase(credential);
      })
      .catch(function (error) { fail(explain(error)); })
      .then(function () { busy(false); });
  });
`;
