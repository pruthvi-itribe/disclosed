/**
 * The account: who this browser is, the sign-in panel, the watch star, and the
 * Watching view.
 *
 * A FRAGMENT, NOT A MODULE. This is client-side ES5 source held as a string
 * and concatenated into one IIFE by `page-script.ts`; the pieces share that
 * function's scope, so a name declared here is visible to every other
 * fragment and the order they are joined in is the order they execute in.
 *
 * IT RUNS BEFORE `script-views`, which is where the page's three bootstrap
 * lines live. `api/me` has to be asked before the first refresh, or the first
 * paint draws a signed-in reader as signed out.
 *
 * NO BACKTICK AND NO `${` MAY APPEAR BELOW. Both are consumed by the
 * composing template literal before a browser ever sees this, which is the
 * failure this file split exists to make less likely — a test asserts it.
 */
export const SCRIPT_ACCOUNT = `
  // ------------------------------------------------------------ account ----

  // Which form the panel is showing. Not read off the DOM: the button labels
  // are copy and the mode is behaviour, and reading one from the other is how
  // a rewording starts registering people who meant to sign in.
  var authMode = 'login';

  function signedIn() {
    return state.me !== null && state.me.signedIn === true;
  }

  function isWatched(symbol) {
    // hasOwnProperty, because these keys are exchange-supplied tickers and
    // 'constructor' is a key on every object literal's prototype chain.
    return Object.prototype.hasOwnProperty.call(state.watched, symbol);
  }

  function watchedCount() {
    return Object.keys(state.watched).length;
  }

  // ---------------------------------------------------------- the star ----

  // The words and the ARIA, set together so the two can never disagree.
  //
  // A clip-path shape is INVISIBLE to a screen reader - there is no glyph and
  // no image to describe - so the control carries a text label of its own as
  // well as an aria-label naming the company.
  function setWatchLabel(button, symbol) {
    var on = isWatched(symbol);
    button.className = 'watch' + (on ? ' on' : '');
    button.setAttribute('aria-label', (on ? 'Stop watching ' : 'Watch ') + symbol);
    button.setAttribute('aria-pressed', String(on));
    var text = button.getElementsByClassName('watchtext')[0];
    if (!text) {
      text = document.createElement('span');
      text.className = 'watchtext';
      button.appendChild(text);
    }
    text.textContent = on ? 'Watching' : 'Watch';
  }

  // ABSENT, NOT DISABLED, WHEN SIGNED OUT. A control that is permanently
  // greyed out and never explains itself is worse than no control: it reads as
  // a broken page rather than as a feature behind a sign-in.
  function watchButton(symbol) {
    if (!signedIn()) return null;
    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-ui', 'watch');
    button.setAttribute('data-symbol', symbol);
    setWatchLabel(button, symbol);
    button.onclick = (function (sym, node) {
      return function (event) {
        event.stopPropagation();
        toggleWatch(sym, node);
      };
    })(symbol, button);
    return button;
  }

  // Repaints every star on screen from state.
  //
  // Needed because one company can be on several cards at once - a results
  // announcement, a press release and a presentation are three filings - and
  // starring one of them must fill all three rather than leaving the page
  // disagreeing with itself.
  function paintWatchButtons() {
    var stars = document.getElementsByClassName('watch');
    for (var i = 0; i < stars.length; i++) {
      var symbol = stars[i].getAttribute('data-symbol');
      if (symbol) setWatchLabel(stars[i], symbol);
    }
  }

  function toggleWatch(symbol, button) {
    var on = isWatched(symbol);
    var path = on
      ? 'api/watchlist/' + encodeURIComponent(symbol)
      : 'api/watchlist?symbol=' + encodeURIComponent(symbol);
    button.disabled = true;
    // NO BODY. The ticker travels in the path or the query string, which is
    // what keeps request-body parsing mounted on api/auth and nowhere else.
    postJson(path, on ? 'DELETE' : 'POST', undefined)
      .then(function (body) {
        if (on) delete state.watched[symbol];
        else state.watched[symbol] = true;
        applyWatchCounts(body.meta);
        paintWatchButtons();
        clearError();
      })
      .catch(function (err) {
        // WATCHLIST_FULL and UNKNOWN_SYMBOL are the two a reader has to see,
        // and the server writes both. Shown as-is rather than replaced with a
        // generic line.
        showError(err && err.message ? err.message : 'Could not change the watchlist.');
      })
      .then(function () {
        button.disabled = false;
      });
  }

  // --------------------------------------------------------- who am I ----

  function applyWatchCounts(meta) {
    if (!meta) return;
    setText('watch-count', groupInt(meta.used) + ' of ' + groupInt(meta.cap) + ' companies watched');
  }

  // The unread badge. ABSENT rather than zero when there is nothing new: a
  // badge reading 0 is furniture that teaches a reader to stop looking at it.
  function setUnread(count) {
    var badge = el('tab-watching-count');
    var n = typeof count === 'number' && count > 0 ? count : 0;
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? '99+' : String(n);
  }

  function applyMe(me) {
    state.me = me;
    var here = signedIn();

    el('signin').hidden = here;
    el('signout').hidden = !here;
    if (here) el('signout').textContent = 'Sign out';
    el('tab-watching').hidden = !here;
    setUnread(here ? me.unread : 0);

    if (here) {
      applyWatchCounts({ used: me.watchCount, cap: me.watchCap });
      loadWatchlist();
      return;
    }

    // Signed out: forget the watchlist and leave a view the reader can no
    // longer see. Leaving them on Watching would poll a route that answers 401
    // every four seconds.
    state.watched = {};
    paintWatchButtons();
    if (state.view === 'watching') {
      showView('feed');
      refresh(true);
    }
  }

  function refreshMe() {
    return getJson('api/me')
      .then(function (b) {
        applyMe(b.data);
      })
      .catch(function (err) {
        // Never swallowed. A page that cannot tell whether anybody is signed in
        // draws a signed-out header at a signed-in reader, which looks like
        // being logged out for no reason.
        showError('Could not read your account: ' + (err && err.message ? err.message : String(err)));
      });
  }

  function loadWatchlist() {
    return getJson('api/watchlist')
      .then(function (b) {
        var next = {};
        for (var i = 0; i < b.data.length; i++) next[b.data[i].symbol] = true;
        state.watched = next;
        applyWatchCounts(b.meta);
        paintWatchButtons();
      })
      .catch(function (err) {
        showError('Could not read your watchlist: ' + (err && err.message ? err.message : String(err)));
      });
  }

  // -------------------------------------------------------- the panel ----

  function openAuth(mode) {
    authMode = mode;
    var registering = mode === 'register';
    setText('auth-title', registering ? 'Create an account' : 'Sign in');
    setText('auth-lead', registering
      ? 'Twelve characters or more. No rules about capitals or symbols - length is what matters.'
      : 'Watch companies and see what they said, in one place.');
    setText('auth-go', registering ? 'Create account' : 'Sign in');
    setText('auth-alt', registering ? 'I already have an account' : 'Create an account');
    // The password manager needs to be told which of the two this is, or it
    // offers a saved password on a signup form and no generator on either.
    el('auth-password').setAttribute('autocomplete', registering ? 'new-password' : 'current-password');
    setText('auth-error', '');
    el('auth-back').hidden = false;
    el('auth-email').focus();
  }

  function closeAuth() {
    el('auth-back').hidden = true;
    el('auth-password').value = '';
    setText('auth-error', '');
  }

  el('signin').addEventListener('click', function () { openAuth('login'); });
  el('auth-close').addEventListener('click', closeAuth);
  el('auth-alt').addEventListener('click', function () {
    openAuth(authMode === 'register' ? 'login' : 'register');
  });
  el('auth-back').addEventListener('click', function (event) {
    if (event.target === el('auth-back')) closeAuth();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !el('auth-back').hidden) closeAuth();
  });

  el('auth-form').addEventListener('submit', function (event) {
    // MUST NOT SUBMIT NATIVELY. A native POST navigates away from a page whose
    // whole design is one document, and the reader lands on a JSON body.
    event.preventDefault();
    var go = el('auth-go');
    go.disabled = true;
    setText('auth-error', '');
    postJson(
      authMode === 'register' ? 'api/auth/register' : 'api/auth/login',
      'POST',
      { email: el('auth-email').value, password: el('auth-password').value }
    )
      .then(function () {
        closeAuth();
        return refreshMe();
      })
      .catch(function (err) {
        // textContent, never a markup string, and the server's own message: the login
        // failure is deliberately identical for a wrong password and an unknown
        // address, and rewriting it here would be this page inventing a
        // distinction the server refused to make.
        setText('auth-error', err && err.message ? err.message : 'That did not work.');
      })
      .then(function () {
        go.disabled = false;
      });
  });

  el('signout').addEventListener('click', function () {
    postJson('api/auth/logout', 'POST', undefined)
      .catch(function (err) {
        showError(err && err.message ? err.message : 'Could not sign out.');
      })
      .then(function () {
        return refreshMe();
      });
  });

  // The company page's star, wired once. renderCompany sets its label and its
  // hidden flag on every draw, the same way it already does the industry tag.
  el('co-watch').addEventListener('click', function () {
    if (state.company !== null) toggleWatch(state.company, el('co-watch'));
  });

  // ------------------------------------------------------- the view ----

  // The v1 alert surface. One authenticated read per poll while this tab is
  // open, and only while it is open - the Feed and Company tabs poll
  // anonymously and touch no session.
  function refreshWatching(fresh) {
    return postJson('api/watchlist/feed?limit=' + state.limit + '&offset=0', 'GET', undefined)
      .then(function (b) {
        if (!fresh()) return;
        renderWatching(b.data, b.meta);
      })
      .catch(function (err) {
        if (!fresh()) return;
        // A SESSION THAT ENDED UNDER AN OPEN TAB IS NOT A PAGE ERROR. Put the
        // reader back where they can act - the feed, with the header offering
        // Sign in - rather than painting a red banner every four seconds.
        if (err && err.status === 401) {
          applyMe({ signedIn: false });
          return;
        }
        showError(err && err.message ? err.message : 'Could not load Watching.');
      });
  }

  function renderWatching(items, meta) {
    var empty = el('watch-empty');
    var feed = el('watch-feed');

    if (watchedCount() === 0) {
      feed.textContent = '';
      clear(empty);
      var head = document.createElement('strong');
      head.textContent = 'You are not watching anything yet';
      empty.appendChild(head);
      empty.appendChild(document.createTextNode(
        'Press Watch on any card in the feed, or on a company page. Everything those companies file collects here.'
      ));
      empty.hidden = false;
      return;
    }

    if (items.length === 0) {
      feed.textContent = '';
      clear(empty);
      var quiet = document.createElement('strong');
      quiet.textContent = 'Nothing yet from the ' + watchedCount() + ' companies you watch';
      empty.appendChild(quiet);
      // "Nothing was found" and "nothing was looked for" must not read the
      // same, so this says which companies were asked about.
      empty.appendChild(document.createTextNode(
        'This collection holds no filings from them. It fills as they file.'
      ));
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    // THE SAME RENDERER THE FEED USES, unchanged. Results lines, claim lines,
    // quiet cards, Copy and Source all arrive with the createElement /
    // textContent / safeHref discipline already on them, and a second card
    // renderer would be a second place for exchange text to reach the DOM.
    renderFeedInto(feed, items, meta, false);
    // Looking at the tab IS reading it, and the server has already stamped it.
    setUnread(0);
  }

  refreshMe();
`;
