/**
 * Constants, the poll cadence, and the small helpers every other fragment
 * uses: DOM lookup, text setting, number and duration formatting, the URL
 * scheme check, and the JSON fetch.
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
export const SCRIPT_BASE = `

  var FAST_MS = 4000;
  var SLOW_EVERY = 5;
  var DEFAULT_LIMIT = 25;
  // The server's MAX_LIMIT, restated for the growth steps and the at-cap note.
  var LIMIT_MAX = 500;

  // Columns in the filings table. Named because the empty-state row AND the
  // per-row detail row both have to span all of them, and a colspan that
  // silently drifts short of the real count renders as a torn row rather than
  // as an error. Asserted against the rendered header-cell count in
  // page.spec.ts, so the two cannot drift apart silently.
  var COLUMN_COUNT = 5;

  // The ordinary parser. A route equal to this is not worth a tag - it is what
  // reading a PDF normally means - and the tag exists to mark the exceptions.
  var DEFAULT_PARSE_ROUTE = 'pdf-parse';

  // THE AMOUNT-PATH REFUSALS THAT ARE NOT A PROBLEM.
  //
  // Both of these say the same thing about a filing: the document was read and
  // it stated no figure worth taking. That is the ORDINARY case - a board
  // meeting notice, a trading window closure, an investor presentation - and it
  // was true of 95% of the collection, so rendering each one as a warn-coloured
  // pill made a diagnostic about one lane the loudest thing on almost every row.
  // It no longer decides whether the row says anything either: every filing
  // states an outcome composed from the exchange's own summary, whatever the
  // amount extractor did with the attachment.
  //
  // AN ALLOWLIST OF THE QUIET, NOT A DENYLIST OF THE LOUD, and that direction is
  // the safety property. A refusal reason this file has never heard of renders
  // loud, so the failure mode of forgetting to update this list is noise rather
  // than silence. 'multiple-candidates' (the document stated two different
  // numbers), 'range-only' (a band, not a figure), 'unit-scaled-header' and
  // 'verbatim-mismatch' all mean something needs a look and stay where they
  // were, as does every unparseableReason - a document nothing could read is a
  // filing nobody has looked inside, not an extractor exercising judgement.
  //
  // DEMOTED IS NOT DELETED. The quiet two keep a control on their own row, keep
  // their count and their filter in the Diagnostics panel, and keep the chip in
  // the filter bar. An extractor whose refusals are invisible is
  // indistinguishable from one that is not running.
  var QUIET_AMOUNT_REFUSALS = { 'no-candidate': true, 'ambiguity-keyword': true };

  // hasOwnProperty rather than a bare lookup, for the reason 'describe' below
  // gives: these keys arrive from the database and 'constructor' is a key on
  // every object literal's prototype chain.
  function isQuietRefusal(reason) {
    return Object.prototype.hasOwnProperty.call(QUIET_AMOUNT_REFUSALS, reason);
  }

  // What each tier permits, in the words of libs/filings/src/logic/confidence
  // -tier.ts. Carried as tooltips rather than as visible prose because the badge
  // appears on every row and three explanatory sentences per row is a wall.
  var TIER_TITLE = {
    verified: 'a span of the source document was matched character for character, and the period, basis, column and scale were checked against the document. The only tier allowed near an alert.',
    stated: 'the exchange said this in its own summary line. Strong provenance, but nobody has checked it against the attached document.',
    labelled: 'all that is known is what kind of filing this is. An honest floor, not a failure - an investor presentation nobody verified is still an investor presentation.'
  };

  // Whose words the outcome line is. Worth showing even next to the tier: on a
  // verified row the tier says a document was checked and says nothing about
  // where the OUTCOME sentence itself came from, which is the one place these
  // two do not overlap.
  var SOURCE_TITLE = {
    'exchange-summary': "the exchange's own summary line, which said something its category does not",
    category: 'the summary restated the category and nothing more, so the outcome is the category'
  };

  // How long the box waits after the last keystroke before asking.
  //
  // 140ms, which is under the ~200ms a fluent typist spends per character, so a
  // reader typing 'britannia' straight through issues ONE request rather than
  // nine. It is also short enough to be invisible: a suggestion list that
  // appears 140ms after you stop typing reads as instant, and one that appears
  // after 400ms reads as slow. The server is not what this protects - a
  // suggestion costs it no database read at all - it is the request per
  // character that a shared loopback box does not need.
  var SUGGEST_DEBOUNCE_MS = 140;

  // Shortest query that is asked about at all. The server applies the same
  // floor and would answer an empty list anyway; this is the round trip that
  // does not have to happen. Measured there: one character matches 87 of 954
  // companies on average, which is a list rather than a suggestion.
  var SUGGEST_MIN = 2;

  var state = {
    limit: DEFAULT_LIMIT,
    offset: 0,
    // The two halves of the search box, and they are NOT the same filter.
    // 'symbol' is exact and is set only when a reader PICKS a company from the
    // list; 'q' is free text and is what they typed when they did not. A reader
    // who chose BRITANNIA wants Britannia, not every filing that mentions it.
    q: '',
    symbol: '',
    // The suggestion currently applied, so editing the box can undo exactly
    // what picking it did and nothing else. Without this, typing after picking
    // a category would either leave the category filter stuck on or clear a
    // category the reader had set from the Admin panel instead.
    picked: null,
    category: '',
    group: '',
    tier: '',
    enrichState: '',
    amount: '',
    refusal: '',
    highestSeen: null,
    ticks: 0,
    failures: 0,
    // 'feed' is the product, 'admin' is the instrument panel. Which one is
    // showing changes nothing about what is fetched — both views read the same
    // rows from the same request, so switching tabs costs no round trip and a
    // filter set in one is honoured by the other.
    view: 'feed',
    // ON BY DEFAULT, and it is the single most consequential default on the
    // page. Roughly three filings in five say nothing a reader would want —
    // a notice of a board meeting, a newspaper publication, a change of
    // registered office — and a feed that opens on all of them reads as noise
    // no matter how well each row is drawn. This maps to the 'verified' tier,
    // which is exactly "a span of the source document was matched", so the
    // default is not a guess about what is interesting: it is the set the
    // pipeline can stand behind.
    onlyInsights: true,
    // 'expanded' USED TO LIVE HERE, and its removal is the point of the focus
    // card. It recorded which cards a reader had grown in place, purely so the
    // four-second repaint would redraw them grown — state kept to make a layout
    // survive a poll. The dialog is outside '#feed' and no poll touches it, so
    // there is nothing to remember.
    //
    // The company whose page is open, or null. In 'state' because the page
    // repaints every four seconds, and a view that forgot which company it was
    // showing would snap back to the feed under a reader mid-scroll.
    company: null,
    // What the reader asked the claims to be ABOUT. Empty means any. A separate
    // axis from 'group', which is what KIND of filing NSE says it is.
    topic: '',
    // WHO THIS BROWSER IS, as api/me last answered. Null before the first
    // answer, which is why both header buttons start hidden: "we do not know
    // yet" is a third state and drawing either of the other two through it is
    // a header that flickers on every load.
    me: null,
    // WHICH COMPANIES THIS READER WATCHES, keyed by SYMBOL and not by seqId.
    //
    // IN STATE FOR THE REASON 'company' IS. The feed repaints every four
    // seconds and no DOM node survives a poll, so a star that lived in the DOM
    // would un-fill itself under the reader's cursor. Keyed by symbol because
    // one company files repeatedly and the star belongs to the company, not to
    // the filing that happens to be on screen.
    watched: {},
    // LATCHED ONCE, so a 401 reloads the page exactly once. Every read is
    // behind the session, so an expired one fails several polls at the same
    // instant; without this each of them would call reload() and the reader
    // would watch the page restart in a loop rather than land on the landing
    // page. A reload loop is the one failure worse than a stale page.
    signedOut: false,
    // Monotonic id of the LATEST refresh, for the same bug the suggest box
    // already guards against: fetch does not promise ordering. The filings
    // callback decides which view to draw by reading state at RESPONSE time,
    // so a poll request sent just before a ticker click could land after
    // openCompany() and paint the whole feed as that company's filings. A
    // response whose id is stale renders nothing.
    refreshSeq: 0
  };

  // A lookup that cannot be walked into the prototype chain. The keys come from
  // the server and are a closed set, but 'constructor' is a key too and an
  // unguarded lookup would put a function's source text in a tooltip.
  function describe(table, key) {
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
  }

  function el(id) { return document.getElementById(id); }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function cell(row, className, value) {
    var td = document.createElement('td');
    td.className = className;
    if (value !== null && value !== undefined) td.textContent = String(value);
    row.appendChild(td);
    return td;
  }

  function groupInt(value) {
    if (value === null || value === undefined) return '—';
    return String(value).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  }

  function duration(ms) {
    if (ms === null || ms === undefined) return '—';
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + (s % 60) + 's';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60) + 'm';
    return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }

  // How long ago, in the words a person uses.
  //
  // READ AGAINST THE BROWSER'S CLOCK, which is the one exception to this page's
  // rule that the server owns every time calculation. The rule exists because
  // IST is a fixed offset the server holds one definition of and a browser in
  // another timezone would render differently; "how long ago" is not a timezone
  // question at all — it is a difference between two instants, identical in
  // every timezone, and it has to move as the reader watches without a refetch.
  // The absolute IST string the server computed is still what the title carries.
  //
  // Falls back to the raw value rather than inventing one: an unparseable date
  // shows as itself, which is debuggable, instead of "just now", which is a lie.
  function relativeTime(iso) {
    if (typeof iso !== 'string' || iso === '') return '—';
    var then = Date.parse(iso);
    if (isNaN(then)) return iso;
    var s = Math.round((Date.now() - then) / 1000);
    if (s < 0) return 'just now';
    if (s < 45) return 'just now';
    if (s < 90) return 'a minute ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60 ? (m % 60) + 'm ago' : 'ago');
    var d = Math.floor(h / 24);
    if (d === 1) return 'yesterday';
    if (d < 7) return d + ' days ago';
    return Math.floor(d / 7) + 'w ago';
  }

  // Only http(s) links are ever rendered. Anything else - including the
  // 'javascript' scheme - returns null and the cell stays plain text.
  function safeHref(raw) {
    if (typeof raw !== 'string' || raw === '') return null;
    try {
      var parsed = new URL(raw, window.location.href);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.href;
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  function showError(message) {
    var box = el('alert');
    box.textContent = message;
    box.hidden = false;
  }

  function clearError() {
    var box = el('alert');
    box.hidden = true;
    box.textContent = '';
  }

  function setLive(kind, label) {
    var dot = el('live-dot');
    dot.className = 'dot ' + kind;
    setText('live-text', label);
  }

  // Every response is an envelope. A body that is not one is a proxy, an error
  // page or a version mismatch, and is reported rather than rendered as empty.
  function getJson(path) {
    return fetch(path, { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            var failure = new Error(path + ' returned ' + res.status + ': ' + body.slice(0, 200));
            // CARRIED, so a caller can branch on it. Every read on this page is
            // now behind the session, and a 401 is not a failure to report - it
            // is a session that ended under an open tab, which the poll answers
            // by reloading into the landing page.
            failure.status = res.status;
            throw failure;
          });
        }
        return res.json();
      })
      .then(function (body) {
        if (!body || body.success !== true) {
          throw new Error(path + ' returned a body that is not a success envelope');
        }
        return body;
      });
  }

  // The only WRITE this page makes, and a sibling of getJson rather than an
  // option on it, because the two differ in exactly the place that matters: a
  // failed read is reported as "refresh failed" and a failed write carries a
  // message the reader has to see. WATCHLIST_FULL, UNKNOWN_SYMBOL and
  // INVALID_CREDENTIALS are all sentences somebody is waiting for.
  //
  // The rejection carries 'status', 'code' and 'meta' as well as the message,
  // so a caller can branch on the code rather than on the prose - a copy edit
  // must not be a behaviour change.
  //
  // A JSON body ONLY for the auth routes. Watchlist mutations pass undefined
  // and carry their parameter in the path or the query string, which is what
  // keeps body parsing mounted on one prefix on the server.
  function postJson(path, method, body) {
    var init = {
      method: method,
      // The default, stated: this cookie is the whole session and a future
      // edit that set 'omit' would sign everybody out silently.
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };
    if (body !== undefined && body !== null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (res) {
      return res
        .json()
        .catch(function () { return null; })
        .then(function (parsed) {
          if (res.ok && parsed && parsed.success === true) return parsed;
          var message =
            parsed && parsed.error && parsed.error.message
              ? parsed.error.message
              : 'That did not work (' + res.status + ').';
          var failure = new Error(message);
          failure.status = res.status;
          failure.code = parsed && parsed.error ? parsed.error.code : '';
          failure.meta = parsed ? parsed.meta : null;
          throw failure;
        });
    });
  }

  function lagClass(ms) {
    if (ms === null || ms === undefined) return '';
    if (ms < 120000) return 'ok';
    if (ms < 1800000) return 'warn';
    return 'bad';
  }

`;
