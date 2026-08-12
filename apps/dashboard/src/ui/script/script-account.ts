/**
 * The account: who this browser is, the watch star, signing out, and the
 * Watching view.
 *
 * NO SIGN-IN PANEL. It used to hold one; the gate made it unreachable and it
 * was removed rather than left green — see the "signing out" section below.
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

  function signedIn() {
    return state.me !== null && state.me.signedIn === true;
  }

  function isWatched(symbol) {
    // hasOwnProperty, because these keys are exchange-supplied tickers and
    // 'constructor' is a key on every object literal's prototype chain.
    return Object.prototype.hasOwnProperty.call(state.watched, symbol);
  }

  // ---------------------------------------------------------- the star ----

  // The words and the ARIA, set together so the two can never disagree.
  //
  // A DRAWING IS INVISIBLE TO A SCREEN READER - there is no glyph and no image
  // to describe - so the control carries an aria-label naming the company and
  // the same string as a title, which is what a pointer discovers. It used to
  // carry a visible word too, and that word is what the drawings replaced: four
  // spelled-out controls do not fit on a card footer, and four drawn ones do.
  // The state is in aria-pressed, which a screen reader reads out with the
  // name, and in the star being filled rather than outlined.
  //
  // THE ELEMENT MAY ARRIVE FROM THE MARKUP. The company page's star is in the
  // document ('co-watch'), so the star is appended only if it is not already
  // there, and the class is rewritten from scratch on every paint.
  function setWatchLabel(button, symbol) {
    var on = isWatched(symbol);
    button.className = 'iconbtn watch' + (on ? ' on' : '');
    var label = (on ? 'Stop watching ' : 'Watch ') + symbol;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(on));
    button.title = label;
    if (!button.getElementsByTagName('svg')[0]) {
      button.appendChild(iconSvg(ICON_STAR));
    }
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
        // A star pressed ON THE ROSTER removes the row it sits in, and only a
        // poll redraws that list - so without this the reader watches a company
        // they have just unwatched sit in their watchlist for up to four
        // seconds. Asking for the repaint the poll would have done is cheaper,
        // and safer, than teaching this function to edit a list the poll owns.
        if (state.view === 'watching') refresh(true);
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

    if (!signedIn()) {
      // NOT A STATE THIS DOCUMENT CAN BE IN ANY MORE, so it is not repainted
      // into one. Every read here is behind the session and the front door
      // serves a signed-out browser the landing page, so the only way to be
      // here without a session is to have lost one mid-visit - and the honest
      // answer to that is to ask the server again rather than to redraw this
      // page as a signed-out version of itself that cannot load a single row.
      //
      // Reloading also takes the watchlist with it. The old code emptied the
      // Watching view by hand so a signed-out reader's cards would not sit
      // hidden in the DOM on a shared machine; replacing the whole document is
      // a stronger version of the same guarantee.
      if (!state.signedOut) {
        state.signedOut = true;
        window.location.reload();
      }
      return;
    }

    el('signout').hidden = false;
    el('signout').textContent = 'Sign out';
    el('tab-watching').hidden = false;
    setUnread(me.unread);
    applyWatchCounts({ used: me.watchCount, cap: me.watchCap });
    loadWatchlist();
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

  // ---------------------------------------------------- signing out ----
  //
  // THE PANEL THAT USED TO LIVE HERE IS GONE. It was a modal inside this
  // document with two inputs, a mode toggle and a submit that posted to
  // api/auth - and every line of it became unreachable when the front door
  // started serving a signed-out browser the landing page instead of this one.
  // The sign-in surface is '/auth' now, built from the resolved AUTH_MODE.
  // Two sign-in forms on one origin is two places for auth UI to drift, and
  // only one of them would have been the one anybody used.

  el('signout').addEventListener('click', function () {
    postJson('api/auth/logout', 'POST', undefined)
      .then(function () {
        // RELOADS RATHER THAN REPAINTING. Every read on this page is behind the
        // session now, so a signed-out reader left on this document watches
        // every poll fail. The server answers the front door with the landing
        // page, so the honest thing to do with a session that just ended is ask
        // it again.
        state.signedOut = true;
        window.location.reload();
      })
      .catch(function (err) {
        showError(err && err.message ? err.message : 'Could not sign out.');
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
        // A SESSION THAT ENDED UNDER AN OPEN TAB IS NOT A PAGE ERROR, and it
        // is no longer survivable either: every read on this page is behind
        // the session, so there is no view left to put the reader back on.
        // applyMe reloads, and the server answers with the landing page.
        if (err && err.status === 401) {
          applyMe({ signedIn: false });
          return;
        }
        showError(err && err.message ? err.message : 'Could not load Watching.');
      });
  }

  // ONE LINE FOR ONE WATCHED COMPANY, whether or not it has filed lately.
  //
  // The row exists to answer "is this watch working", so it carries the four
  // things that answer it: the ticker, the name, when the company last filed
  // anything held here, and the star that takes it off the list.
  function watchRow(row) {
    var li = document.createElement('li');
    li.className = 'rosterrow';
    li.setAttribute('data-ui', 'watching-row');
    li.setAttribute('data-symbol', row.symbol);

    // The same way into the company page the feed card's ticker is - a
    // watchlist whose rows are dead ends is a list you cannot act on.
    var sym = document.createElement('button');
    sym.type = 'button';
    sym.className = 'sym';
    sym.textContent = row.symbol;
    sym.title = 'All filings from ' + row.symbol;
    sym.onclick = (function (symbol) {
      return function () { openCompany(symbol); };
    })(row.symbol);
    li.appendChild(sym);

    var name = document.createElement('span');
    name.className = 'rostername';
    name.textContent = row.companyName;
    // The name truncates in a narrow row and vanishes below 560px, so the whole
    // of it stays reachable rather than being merely absent.
    name.title = row.companyName;
    li.appendChild(name);

    var when = document.createElement('span');
    when.className = 'rosterwhen';
    if (row.lastFiledAt) {
      when.textContent = 'last filed ' + relativeTime(row.lastFiledAt);
      when.title = row.lastFiledAtIst + ' IST';
    } else {
      // NOT 'never filed'. This collection is a window on the exchange's
      // output, not the whole of it, and the honest sentence is about what is
      // held here rather than about what the company has ever done.
      when.textContent = 'nothing yet in our window';
    }
    li.appendChild(when);

    var star = watchButton(row.symbol);
    if (star) li.appendChild(star);
    return li;
  }

  /** The signature of the roster on screen. See 'renderWatching'. */
  var drawnRoster = '';

  /**
   * "last filed 3 min ago", rewritten where it stands on a tick that drew
   * nothing. The same job 'touchFeedTimes' does for a card, against the row's
   * own symbol - which is the identity a roster row carries, because the list
   * is one row per COMPANY rather than one per filing.
   */
  function touchRosterTimes(roster, rows) {
    var at = {};
    for (var i = 0; i < rows.length; i++) at[rows[i].symbol] = rows[i].lastFiledAt;
    var drawn = roster.getElementsByClassName('rosterrow');
    for (var r = 0; r < drawn.length; r++) {
      var symbol = drawn[r].getAttribute('data-symbol');
      if (!Object.prototype.hasOwnProperty.call(at, symbol)) continue;
      // The row that has never filed says so in words that do not age.
      if (!at[symbol]) continue;
      var when = drawn[r].getElementsByClassName('rosterwhen')[0];
      if (!when) continue;
      var text = 'last filed ' + relativeTime(at[symbol]);
      if (when.textContent !== text) when.textContent = text;
    }
  }

  // THE WATCHLIST FIRST, THEN WHAT IT SAID.
  //
  // 'items' is a page of FILINGS - the newest meta.limit of them across the
  // whole watchlist - and it is not the watchlist. A company that files less
  // often than its neighbours contributes no card to it, and while this view
  // drew nothing but that page, such a company had no row anywhere and its
  // reader could not tell a working watch from a broken one. So the roster is
  // drawn from meta.watching, which is every watched company unpaged.
  //
  // Drawn from meta rather than from state.watched because state.watched holds
  // only symbols; a row has to name a company and say when it last spoke.
  function renderWatching(items, meta) {
    var empty = el('watch-empty');
    var feed = el('watch-feed');
    var roster = el('watch-roster');
    var note = el('watch-feed-note');
    var rows = meta && meta.watching ? meta.watching : [];

    // THE STARS FOLLOW THE ROSTER, and they have to be told before it is drawn.
    // state.watched was last filled by loadWatchlist() at page load, and the
    // response in hand is the newer fact - so a watchlist that changed anywhere
    // but on this page (a second tab, a reload-less session) would otherwise
    // draw a row for a company whose own star said 'Watch'. Rebuilt rather than
    // patched, because this list is the whole watchlist and not a delta.
    var known = {};
    for (var w = 0; w < rows.length; w++) known[rows[w].symbol] = true;
    state.watched = known;
    // state.me is set before this tab can be reached: applyMe is what unhides
    // it, and every poll of this route carries the session it checked.
    applyWatchCounts({ used: rows.length, cap: state.me.watchCap });

    // REBUILT ONLY WHEN THE ROSTER ACTUALLY CHANGED, the answer
    // 'renderFeedInto' and 'renderBrief' already give the four-second repaint.
    // The roster is the only node-building part of this view; the feed below
    // it carries its own signature and the two notes are single text writes.
    //
    // A watchlist changes when a reader presses a star, and 'toggleWatch'
    // repaints the stars from state itself - so between presses this list is
    // identical on every tick, and rebuilding it took the reader's text
    // selection with it.
    var signature = JSON.stringify(rows);
    if (signature === drawnRoster) {
      touchRosterTimes(roster, rows);
    } else {
      drawnRoster = signature;
      clear(roster);
      for (var i = 0; i < rows.length; i++) roster.appendChild(watchRow(rows[i]));
    }

    // Everything above the feed belongs to the watchlist and is hidden with it,
    // so an empty view is one sentence rather than two headings over nothing.
    roster.hidden = rows.length === 0;
    el('watch-roster-note').hidden = rows.length === 0;
    el('watch-feed-head').hidden = rows.length === 0;

    if (rows.length === 0) {
      // Emptied through the feed renderer's own helper, so the signature it
      // holds for this container cannot outlive the cards it describes.
      emptyFeedInto(feed);
      note.hidden = true;
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
      // A DIFFERENT SENTENCE FROM THE ONE ABOVE, and now it can be a stronger
      // one: the roster is on screen, so the reader can see the watches exist
      // and this only has to say what is missing.
      emptyFeedInto(feed);
      note.hidden = true;
      clear(empty);
      var quiet = document.createElement('strong');
      quiet.textContent = 'None of the ' + rows.length + ' companies above has filed anything we hold';
      empty.appendChild(quiet);
      empty.appendChild(document.createTextNode(
        'The watches are working - they are listed above. This fills the moment one of them files.'
      ));
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    // SAYS WHAT IT IS LEAVING OUT, IN NUMBERS. The feed below is the newest
    // meta.limit filings across the whole watchlist, and that cut used to be
    // silent: a reader whose company was past it saw a short list and no reason
    // for it. The roster above is complete whatever this says, which is the
    // half of the sentence that matters.
    note.hidden = false;
    note.textContent = meta.hasMore
      ? 'The newest ' + groupInt(meta.returned) + ' of ' + groupInt(meta.total)
        + ' filings from these companies. The list above is complete; this one is not.'
      : 'All ' + groupInt(meta.total) + ' filings from these companies.';

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
