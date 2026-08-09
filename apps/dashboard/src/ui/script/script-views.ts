/**
 * The tabs, the company view, the chip synchronisation, and the wiring that
 * starts the page.
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
export const SCRIPT_VIEWS = `
  // ---------------------------------------------------------------- tabs ----
  // The Admin tab and its section are absent on a host built without the panel,
  // so every touch of either goes through these. Written as helpers rather than
  // as an 'if' around each line because 'showView' runs on every tab press and
  // a null dereference here would freeze the whole page.
  function hideUnless(id, showing) {
    var node = el(id);
    if (node !== null) node.hidden = !showing;
  }

  function markTab(id, active) {
    var node = el(id);
    if (node === null) return;
    // The count is a child of the tab, so the class is set rather than the
    // whole element rebuilt - assigning textContent here would delete it.
    node.className = 'tab' + (active ? ' active' : '');
    node.setAttribute('aria-selected', String(active));
  }

  function showView(name) {
    state.view = name;
    el('view-brief').hidden = name !== 'brief';
    el('view-feed').hidden = name !== 'feed';
    el('view-watching').hidden = name !== 'watching';
    hideUnless('view-admin', name === 'admin');
    el('view-company').hidden = name !== 'company';
    // The company view is reached from a card, not from a tab, so no tab
    // is active while it is open. Leaving Feed lit would say the reader is
    // somewhere they are not.
    markTab('tab-brief', name === 'brief');
    markTab('tab-feed', name === 'feed');
    markTab('tab-watching', name === 'watching');
    markTab('tab-admin', name === 'admin');
    // THE DECK OWNS THE VIEWPORT WHILE IT IS OPEN: it is a scroll container
    // sized to the window, so the page behind it must not scroll too. Written
    // as one class on the body rather than inferred in CSS, so exactly one
    // view is ever in that mode and leaving it puts everything back.
    document.body.className = name === 'brief' ? 'briefing' : '';
    if (name !== 'company') state.company = null;
  }

  /** Opens one company, and asks for its filings unfiltered. */
  function openCompany(symbol) {
    state.company = symbol;
    state.offset = 0;
    showView('company');
    refresh(true);
  }
  el('company-back').addEventListener('click', function () {
    showView('feed');
    refresh(true);
  });
  // EVERY TAB REFRESHES NOW, and that is a change the Brief forced rather than
  // a tidy-up. The deck asks the server a different question from the feed —
  // the 200 most recent verified filings, ignoring the filter bar — so one
  // response can only draw one of them. A tab switch costs a round trip, which
  // is what 'company-back' has always cost, and the alternative is a view
  // showing rows it did not ask for.
  el('tab-brief').addEventListener('click', function () {
    showView('brief');
    refresh(true);
  });
  el('tab-feed').addEventListener('click', function () {
    showView('feed');
    refresh(true);
  });
  el('tab-watching').addEventListener('click', function () {
    showView('watching');
    refresh(true);
  });
  if (ADMIN_ENABLED) {
    el('tab-admin').addEventListener('click', function () {
      showView('admin');
      refresh(true);
    });
  }

  // --------------------------------------------------------------- chips ----
  // The group filter, twice: chips in the feed and a select in Admin. They
  // write the SAME state and re-read each other.
  //
  // THE FEED'S GROUP CHIPS ARE GONE and only Admin's select remains, so this
  // now keeps one control in step rather than two. The chips were removed
  // because they were a worse version of the topic row beside them: measured
  // over the whole collection, topic 'financial' finds 368 filings against
  // group 'results' 152, 'acquisition' 129 against 'mna' 31. NSE's category
  // names the document TYPE, and one results announcement arrives as a board
  // outcome, a press release and a presentation — three groups, one event.
  //
  // Written to survive the element being absent rather than assuming it,
  // because this runs on every filter change and a missing node here would
  // throw inside the refresh path and freeze the whole page.
  function syncChips() {
    var box = el('chips');
    if (box !== null) {
      var chips = box.getElementsByClassName('chip');
      for (var i = 0; i < chips.length; i++) {
        var mine = chips[i].getAttribute('data-group') === state.group;
        chips[i].className = 'chip' + (mine ? ' active' : '');
      }
    }
    var select = el('group');
    if (select !== null) select.value = state.group;
  }

  // The topic row: the same control shape as the group chips, over a different
  // question. Kept as its own state and its own sync so the two rows can be set
  // independently — a reader narrowing to Dividends has not said anything about
  // which category group they want.
  //
  // TWO AXES SHARE THIS ROW. Every chip but one narrows by TOPIC - what a claim
  // is about - and 'Plans' narrows by the claim's SHAPE, the two kinds in which
  // a company states something about its own future. They are in one row
  // because a reader uses them the same way, and the price of that is here:
  // exactly one chip may be lit, so picking either axis clears the other.
  function syncTopics() {
    var chips = el('topics').getElementsByClassName('chip');
    for (var i = 0; i < chips.length; i++) {
      var mine = chips[i].getAttribute('data-plans') !== null
        ? state.plans
        : !state.plans && chips[i].getAttribute('data-topic') === state.topic;
      chips[i].className = 'chip' + (mine ? ' active' : '');
    }
  }
  el('topics').addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var topic = target.getAttribute('data-topic');
    var plans = target.getAttribute('data-plans');
    // A click that landed on the row's padding rather than on a chip.
    if (topic === null && plans === null) return;
    // BOTH ARE WRITTEN ON EVERY CLICK, so the row cannot end up with two
    // filters applied and one chip lit - which would be a feed narrowed by a
    // control the reader cannot see.
    state.topic = topic === null ? '' : topic;
    state.plans = plans !== null;
    state.offset = 0;
    syncTopics();
    refresh(true);
  });

  el('only-insights').addEventListener('change', function (event) {
    state.onlyInsights = event.target.checked;
    state.offset = 0;
    refresh(true);
  });

  // The feed pages by GROWING rather than replacing, because a feed a reader is
  // part-way down must not jump to the top to show them more.
  //
  // GROWS THROUGH THE SELECT'S OWN STEPS, not by +25. The limit is also a
  // select in Admin holding 25/50/100/200, and assigning a select a value it
  // has no option for BLANKS it — after which the next filter change read
  // Number('') || DEFAULT_LIMIT and silently snapped a 75-row feed back to 25
  // under the reader. Two controls over one filter stay consistent only if
  // every writer uses values both can hold.
  var LIMIT_STEPS = [25, 50, 100, 200, 500];
  function growFeed() {
    var grew = false;
    for (var i = 0; i < LIMIT_STEPS.length; i++) {
      if (LIMIT_STEPS[i] > state.limit) { state.limit = LIMIT_STEPS[i]; grew = true; break; }
    }
    if (!grew) return;
    // Admin's select is the other writer of this filter and is absent on a host
    // without the panel; 'setControl' is what makes the feed's own Load more
    // independent of it.
    setControl('limit', String(state.limit));
    refresh(true);
  }
  el('feed-more').addEventListener('click', growFeed);

  // AUTO-LOAD ON SCROLL, with the button as its own sentinel. When the button
  // scrolls into view the feed grows one LIMIT_STEP, exactly as a click would —
  // one shared function, so the two paths cannot drift. The observer's shape is
  // what bounds it: it fires on ENTERING the viewport, so each firing loads one
  // step, the new cards push the button back out, and reaching it again is the
  // next request. When the server says there is no more, renderFeedInto hides
  // the button and a hidden element does not intersect. The button STAYS, for
  // keyboards, for reduced-motion readers, and for the browser without
  // IntersectionObserver, where it keeps being the whole mechanism.
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        if (el('feed-more').hidden) continue;
        // Only the feed grows this way. The company page has its own window
        // and Admin pages with prev/next.
        if (state.view !== 'feed' || state.company !== null) continue;
        growFeed();
      }
    }, { rootMargin: '200px' }).observe(el('feed-more'));
  }

  // '/' focuses the search from anywhere, unless something is already being
  // typed into.
  document.addEventListener('keydown', function (event) {
    if (event.key !== '/' || event.metaKey || event.ctrlKey) return;
    var active = document.activeElement;
    var tag = active && active.tagName ? active.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    event.preventDefault();
    el('symbol').focus();
  });

  // WHERE EACH VIEW IS RIGHT, decided once at load.
  //
  // The feed is a three-column grid whose card is 400px of text; the deck is
  // one claim at 25px filling a screen. 430px is the widest phone viewport in
  // common use, so at or below it the deck is what a reader lands on and above
  // it the feed stays. Neither reader is trapped: both tabs are on both.
  //
  // Read once rather than watched, deliberately. A viewport that crosses 430px
  // mid-session is a rotated phone or a dragged window, and swapping the view
  // out from under a reader who is part-way down a card is a worse answer than
  // leaving them where they are.
  if (window.matchMedia && window.matchMedia('(max-width: 430px)').matches) {
    showView('brief');
  }

  setLive('', 'connecting');
  refresh(true);
  window.setTimeout(loop, FAST_MS);
`;
