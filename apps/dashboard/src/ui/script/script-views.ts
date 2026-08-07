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
  function showView(name) {
    state.view = name;
    el('view-feed').hidden = name !== 'feed';
    el('view-admin').hidden = name !== 'admin';
    el('view-company').hidden = name !== 'company';
    // The company view is reached from a card, not from a tab, so neither tab
    // is active while it is open. Leaving Feed lit would say the reader is
    // somewhere they are not.
    el('tab-feed').className = 'tab' + (name === 'feed' ? ' active' : '');
    el('tab-admin').className = 'tab' + (name === 'admin' ? ' active' : '');
    el('tab-feed').setAttribute('aria-selected', String(name === 'feed'));
    el('tab-admin').setAttribute('aria-selected', String(name === 'admin'));
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
  el('tab-feed').addEventListener('click', function () { showView('feed'); });
  el('tab-admin').addEventListener('click', function () { showView('admin'); });

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
  function syncTopics() {
    var chips = el('topics').getElementsByClassName('chip');
    for (var i = 0; i < chips.length; i++) {
      var mine = chips[i].getAttribute('data-topic') === state.topic;
      chips[i].className = 'chip' + (mine ? ' active' : '');
    }
  }
  el('topics').addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var topic = target.getAttribute('data-topic');
    if (topic === null) return;
    state.topic = topic;
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
  el('feed-more').addEventListener('click', function () {
    state.limit = Math.min(200, state.limit + 25);
    el('limit').value = String(state.limit);
    refresh(true);
  });

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

  setLive('', 'connecting');
  refresh(true);
  window.setTimeout(loop, FAST_MS);
`;
