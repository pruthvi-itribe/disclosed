/**
 * The query the page asks, the refresh that asks it, the poll loop, and the
 * filter controls that change what is asked.
 *
 * A FRAGMENT, NOT A MODULE. This is client-side ES5 source held as a string
 * and concatenated into one IIFE by `page-script.ts`; the pieces share that
 * function's scope, so a name declared here is visible to every other
 * fragment and the order they are joined in is the order they execute in.
 *
 * NO BACKTICK AND NO `${` MAY APPEAR BELOW. Both are consumed by the
 * composing template literal before a browser ever sees this, which is the
 * failure this file split exists to make less likely — a test asserts it.
 */
export const SCRIPT_POLL = `
  function query() {
    var parts = ['limit=' + state.limit, 'offset=' + state.offset];
    // A COMPANY PAGE IS THE SAME ROUTE WITH A SYMBOL. It deliberately ignores
    // the feed's filters — a reader who opened RELIANCE wants RELIANCE's
    // filings, not the ones that survive whatever group chip was active when
    // they clicked. 200 is roughly ten months of the heaviest measured filer.
    if (state.company !== null) {
      return (
        'api/filings?limit=200&offset=0&symbol=' +
        encodeURIComponent(state.company)
      );
    }
    // THE DECK'S WINDOW, and it ignores the feed's filters for the same reason
    // the company page does: a reader who opened the Brief asked for the day,
    // not for whatever topic chip was lit when they tapped the tab. It is a
    // WINDOW rather than the day — the server caps a page at 200 and a verified
    // IST day is 326 to 463 filings — which is why the cover states it.
    if (state.view === 'brief') {
      return 'api/filings?tier=verified&offset=0&limit=' + BRIEF_WINDOW;
    }
    // The feed's "verified claims" toggle IS the verified tier. Expressed here
    // rather than as a separate parameter because the server already filters on
    // exactly this set, and inventing a second name for it would be two ways to
    // ask one question — which is how the two views start disagreeing.
    if (state.onlyInsights && !state.tier) parts.push('tier=verified');
    // BOTH ARE SENT, and they are not the same question. 'q' is ranked free
    // text over the text index; 'symbol' is an exact match. Only one is ever
    // set at a time - picking a company clears the query and typing clears the
    // pick - but the server ANDs them if both arrive, which is the harmless
    // reading of a state this page does not produce.
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.symbol) parts.push('symbol=' + encodeURIComponent(state.symbol));
    if (state.category) parts.push('category=' + encodeURIComponent(state.category));
    if (state.group) parts.push('group=' + encodeURIComponent(state.group));
    if (state.topic) parts.push('topic=' + encodeURIComponent(state.topic));
    // ONE VALUE, SENT LITERALLY, because the pair IS the question: the server
    // allowlists 'only' and answers 'plans=guidance' with a 400 rather than
    // filtering to 748 of the 813 plan-kind claims and looking right.
    if (state.plans) parts.push('plans=only');
    if (state.tier) parts.push('tier=' + encodeURIComponent(state.tier));
    if (state.enrichState) parts.push('state=' + encodeURIComponent(state.enrichState));
    if (state.amount) parts.push('amount=' + encodeURIComponent(state.amount));
    if (state.refusal) parts.push('refusal=' + encodeURIComponent(state.refusal));
    return 'api/filings?' + parts.join('&');
  }

  function refresh(force) {
    var slow = force === true || state.ticks % SLOW_EVERY === 0;
    // Claimed BEFORE the requests go out. Responses do not arrive in the order
    // requests were sent, and the filings callback decides which view to draw
    // by reading state at response time — so without this, a poll request sent
    // just before a ticker click can land after openCompany() and paint the
    // whole feed as that company's filings. Same fix, same shape, as
    // suggestState.seq.
    var seq = state.refreshSeq + 1;
    state.refreshSeq = seq;
    var fresh = function () { return seq === state.refreshSeq; };
    var jobs = [
      getJson('api/summary').then(function (b) {
        if (fresh()) renderSummary(b.data);
      }),
      // THE ONE AUTHENTICATED POLL. Watching asks a different route with a
      // session cookie on it, and it handles its own 401 rather than reporting
      // a session that ended as a page failure - see 'refreshWatching'. Every
      // other view polls anonymously and touches no session.
      state.view === 'watching' ? refreshWatching(fresh) : getJson(query()).then(function (b) {
        if (!fresh()) return;
        // NOTHING CHANGED SINCE THE LAST ASK, so the server sent 304 and no
        // body - see the header on 'api/filings' for what that is worth in
        // bytes. There is nothing to draw and what is on screen is current.
        //
        // THE CLOCK IS THE EXCEPTION. Each card's "3 min ago" is read against
        // the BROWSER's clock rather than against the payload, so it goes wrong
        // whether or not a filing changed; 'touchFeedTimes' rewrites those four
        // characters in place, from the timestamp on the card itself.
        if (b === NOT_MODIFIED) {
          touchFeedTimes(document);
          return;
        }
        // BOTH VIEWS, FROM ONE REQUEST. Rendering only the visible one would
        // save a few milliseconds of DOM work and cost a tab switch a round
        // trip — and the two would then be able to disagree, which is the one
        // thing a page showing the same rows twice must never do.
        if (state.company !== null) {
          renderCompany(b.data, b.meta);
          return;
        }
        // The deck asked a different question of the server than the feed
        // does, so it is the only thing this response can honestly draw: the
        // feed's chrome counts rows against the feed's own limit, and painting
        // it from a 200-row verified window would snap a reader's paging under
        // them the moment they came back to it.
        if (state.view === 'brief') {
          renderBrief(b.data, b.meta);
          return;
        }
        renderFeed(b.data, b.meta);
        // The same rows, drawn a second way for the operator. On a host built
        // without the panel there is no table to draw them into and no
        // 'renderFilings' in this scope at all.
        if (ADMIN_ENABLED) renderFilings(b.data, b.meta);
      })
    ];
    // THE THREE ROUTES ONLY THE PANEL READS, asked for by the panel's own
    // fragment. They are not merely skipped when it is absent — the fragment
    // that names them is not in the document, so the page a non-local host
    // serves contains no mention of a route that answers 404 there.
    if (slow && ADMIN_ENABLED) pushAdminJobs(jobs);

    return Promise.all(jobs).then(function () {
      if (!fresh()) return;
      state.failures = 0;
      clearError();
      setLive('live', 'live');
    }).catch(function (err) {
      // A STALE FAILURE SAYS NOTHING. A refresh superseded mid-flight can only
      // report on a question nobody is asking any more, and marking the page
      // down for it would contradict the newer refresh that succeeded.
      if (!fresh()) return;
      // A SESSION THAT ENDED UNDER AN OPEN TAB IS NOT A PIPELINE FAULT.
      //
      // Every read on this page is behind the session now, so an expired or
      // revoked one turns the whole feed into a red banner reappearing every
      // four seconds - which reads as an outage and tells the reader nothing
      // they can act on. Reloading hands the decision back to the server, and
      // the server answers the front door with the landing page.
      //
      // Guarded on the flag rather than reloading unconditionally, because a
      // reload loop is the one failure worse than a stale page.
      if (err && err.status === 401 && !state.signedOut) {
        state.signedOut = true;
        window.location.reload();
        return;
      }
      state.failures += 1;
      // Never swallowed. A dashboard that silently stops updating is worse
      // than one that says it stopped, because the stale numbers still read
      // as current.
      setLive(state.failures > 2 ? 'down' : 'stale', 'refresh failed');
      showError('Refresh failed (' + state.failures + ' in a row): ' + (err && err.message ? err.message : String(err)));
    });
  }

  function loop() {
    // Paused while the tab is hidden: an unattended tab polling every four
    // seconds for a week is load on the same database the poller is writing to.
    if (!document.hidden) {
      state.ticks += 1;
      refresh(false);
    }
    window.setTimeout(loop, FAST_MS);
  }

  // ------------------------------------------------- the panel's controls ----
  //
  // SIX SELECTS AND FOUR BUTTONS THAT LIVE INSIDE THE ADMIN SECTION, so on a
  // host built without it none of them is in the document. Every read and every
  // wiring below goes through these two helpers rather than through 'el()'
  // directly, because 'el('limit').value' on a missing node is a TypeError
  // thrown at load — and the fragments share one scope, so it would take the
  // feed, the deck and the search box down with it.
  //
  // A MISSING CONTROL READS AS ITS DEFAULT, never as empty. 'state' is the one
  // description of what the feed is asking for and the selects are one way to
  // write it; where they are absent the state simply keeps what it was born
  // with, which is what 'script-base.ts' set.
  function controlValue(id, fallback) {
    var node = el(id);
    return node === null ? fallback : node.value;
  }

  function onControl(id, event, handler) {
    var node = el(id);
    if (node !== null) node.addEventListener(event, handler);
  }

  function setControl(id, value) {
    var node = el(id);
    if (node !== null) node.value = value;
  }

  function applyFilters() {
    // DELIBERATELY DOES NOT READ '#symbol'. It used to, and that was the whole
    // search: the box's text was the exact-symbol filter. It now drives two
    // different filters depending on whether a suggestion was picked, so it has
    // its own handlers - and a stray read here would overwrite 'state.symbol'
    // with the display text of a category every time a select changed.
    state.category = controlValue('category', state.category);
    state.group = controlValue('group', state.group);
    state.tier = controlValue('tier', state.tier);
    state.enrichState = controlValue('state', state.enrichState);
    state.amount = controlValue('amount', state.amount);
    state.limit = Number(controlValue('limit', state.limit)) || DEFAULT_LIMIT;
    state.offset = 0;
    // Admin's select and the feed's chips are two controls over one filter.
    // Whichever moved, both must show the same answer afterwards.
    syncChips();
    refresh(true);
  }

  onControl('category', 'change', applyFilters);
  onControl('group', 'change', applyFilters);
  onControl('tier', 'change', applyFilters);
  onControl('state', 'change', applyFilters);
  onControl('amount', 'change', applyFilters);
  onControl('limit', 'change', applyFilters);
  onControl('clear', 'click', function () {
    el('symbol').value = '';
    setControl('category', '');
    setControl('group', '');
    setControl('tier', '');
    setControl('state', '');
    setControl('amount', '');
    // Cleared through the same three fields the search box owns, rather than
    // by emptying the input and hoping: 'symbol' and 'q' are state, not markup,
    // and a Clear that left one of them set would leave the feed filtered by a
    // control that now looks empty.
    state.symbol = '';
    state.q = '';
    state.picked = null;
    state.refusal = '';
    // WRITTEN TO STATE AS WELL AS TO THE SELECTS, because the selects are not
    // always there. 'applyFilters' below reads a missing control as "leave this
    // as it was", which is right for a control nobody touched and wrong for the
    // one button whose entire job is to put every filter back.
    state.category = '';
    state.group = '';
    state.tier = '';
    state.enrichState = '';
    state.amount = '';
    // The topic row is a filter like any other, so Clear must reach it. A
    // Clear that left one chip lit would leave the feed narrowed by a control
    // the reader believes they just reset. Both axes in that row are cleared,
    // because the reader sees one row and reset one thing.
    state.topic = '';
    state.plans = false;
    syncTopics();
    closeSuggest();
    renderSearchNote();
    if (ADMIN_ENABLED) renderRefusalChip();
    applyFilters();
  });
  onControl('prev', 'click', function () {
    state.offset = Math.max(0, state.offset - state.limit);
    refresh(true);
  });
  onControl('next', 'click', function () {
    state.offset = state.offset + state.limit;
    refresh(true);
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh(true);
  });

  // ---------------------------------------------------------- type-ahead ----
  //
  // A combobox over 'api/suggest'. Three things make it safe to fire while
  // somebody is typing, and all three are here rather than on the server:
  //
  //   1. It is DEBOUNCED, so a word is one request and not nine.
  //   2. Every response carries the sequence number of the request that asked
  //      for it, and a stale one is dropped. fetch does not promise ordering.
  //   3. Every node is built with createElement and textContent. A company
  //      name is exchange-supplied text that reached this page through an
  //      unauthenticated database, and this list renders more of it, closer
  //      together, than anything else on the page.

  var suggestState = {
    // What is currently in the list, in the order it is drawn, so the arrow
    // keys and a click both resolve to the same thing by index.
    items: [],
    active: -1,
    open: false,
    timer: null,
    // Monotonic, and this is the bug it exists for: responses do not arrive in
    // the order the requests were sent. Typing 'brit' and then 'britannia' can
    // land 'brit''s slower answer last and leave the reader looking at
    // suggestions for a word they have already typed past - which reads as the
    // box being wrong rather than late.
    seq: 0
  };

`;
