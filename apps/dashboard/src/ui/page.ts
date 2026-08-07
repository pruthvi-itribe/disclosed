import { PAGE_SCRIPT } from './page-script';
import { PAGE_STYLE } from './page-style';

/**
 * The dashboard page: one self-contained HTML document, in two views.
 *
 * SELF-CONTAINED IS A REQUIREMENT, not a preference. There is no `<link>`, no
 * `<script src>`, no web font, no CDN and no build step — the CSS and the
 * JavaScript are inlined from their own modules and the document references
 * nothing outside its own origin. Two reasons:
 *
 *   - this is a view of a local pipeline, and the moment you most need it is
 *     the moment the network is the suspect; and
 *   - a page that fetches code from a third party at render time is a third
 *     party with script access to a view of an unauthenticated database.
 *
 * ================================================================
 * WHY THERE ARE TWO VIEWS
 * ================================================================
 *
 * Everything on this page used to be one screen: a dense table beside eight
 * panels counting refusal reasons, parse routes, enrichment states and
 * confidence tiers. Every one of those panels is real and useful, and together
 * they answered a question nobody reading the product actually asks. A reader
 * wants to know what companies said this morning. An operator wants to know
 * whether the extractor is refusing more than it did yesterday. Those are
 * different people at different moments, and serving them the same screen meant
 * the wire line — the thing this whole pipeline exists to produce — was the
 * smallest element on it.
 *
 * So FEED is the product and ADMIN is the instrument panel. The split is by
 * QUESTION, not by importance: nothing is hidden because it is unimportant, and
 * nothing moved to Admin stopped being counted or clickable. The refusal
 * breakdown still filters the feed; it just no longer competes with the news.
 *
 * THE MARKUP IS A SHELL. It carries no filing data at all: every value is
 * placed by the script from the JSON routes, which is what lets the page poll
 * without a reload and what keeps exchange-supplied text out of a server-side
 * string concatenation where it would have to be escaped by hand.
 *
 * THE ONE EXCEPTION IS A TAXONOMY, NOT DATA. The category groups are written
 * out as filter chips and `<option>` elements rather than fetched, because the
 * set is closed and owned by this codebase (`libs/filings/src/logic/
 * category-group.ts`), so it cannot arrive late or differ per collection; and
 * because the filter has to work on a page whose first fetch has not returned.
 */
export const renderDashboardPage = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Turret — what Indian companies said today</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<header class="topbar">
  <div class="brand">
    <span class="mark">tur<span class="dotmark">ret</span></span>
  </div>
  <nav class="tabs" role="tablist">
    <button id="tab-feed" class="tab active" type="button" role="tab" aria-selected="true" aria-controls="view-feed">Feed</button>
    <button id="tab-admin" class="tab" type="button" role="tab" aria-selected="false" aria-controls="view-admin">Admin</button>
  </nav>
  <div class="status">
    <span id="live-dot" class="dot"></span>
    <span id="live-text">connecting</span>
    <span id="generated" class="muted mono"></span>
  </div>
</header>

<div id="alert" class="alert" hidden></div>

<!-- ============================ FEED ============================ -->
<section id="view-feed" class="view" role="tabpanel" aria-labelledby="tab-feed">

  <div class="hero">
    <div class="herostat">
      <div id="hero-today" class="herovalue">—</div>
      <div class="herolabel">filings today</div>
    </div>
    <div class="herostat">
      <div id="hero-insights" class="herovalue accent">—</div>
      <div class="herolabel">verified insights</div>
    </div>
    <div class="herostat">
      <div id="hero-lag" class="herovalue">—</div>
      <div class="herolabel">since the last one</div>
    </div>
  </div>

  <div class="feedbar">
    <!--
      A COMBOBOX, spelled out in ARIA rather than left as a styled input.

      The listbox is a sibling of the input inside a positioned wrapper, not a
      child of it, because an input cannot contain elements. Everything a screen
      reader needs to follow the arrow keys is on the input: aria-expanded
      tracks whether the list is open, aria-controls names it, and the script
      sets aria-activedescendant to the highlighted option's id — which is how
      a highlight that never moves DOM focus is still announced.

      The list is EMPTY IN THE MARKUP. Every option is built by the script with
      createElement and textContent, because a company name is exchange-supplied
      text and this page has one absolute rule about that.
    -->
    <div class="searchbox">
      <input id="symbol" type="search" placeholder="Search a company, a category, or what was said…"
             autocomplete="off" spellcheck="false"
             role="combobox" aria-expanded="false" aria-autocomplete="list"
             aria-controls="suggest" aria-label="Search filings">
      <ul id="suggest" class="suggest" role="listbox" aria-label="Suggestions" hidden></ul>
    </div>
    <div id="chips" class="chips">
      <button class="chip active" type="button" data-group="">Everything</button>
      <button class="chip" type="button" data-group="results">Results</button>
      <button class="chip" type="button" data-group="narrative">Narrative</button>
      <button class="chip" type="button" data-group="orders">Orders</button>
      <button class="chip" type="button" data-group="mna">M&amp;A</button>
      <button class="chip" type="button" data-group="ratings">Ratings</button>
      <button class="chip" type="button" data-group="capital">Capital</button>
      <button class="chip" type="button" data-group="governance">Governance</button>
      <button class="chip" type="button" data-group="legal">Legal</button>
      <button class="chip" type="button" data-group="verification">Verification</button>
      <button class="chip" type="button" data-group="routine">Routine</button>
      <button class="chip" type="button" data-group="other">Other</button>
    </div>
    <div id="search-note" class="searchnote" hidden></div>
    <label class="onlyinsights">
      <input id="only-insights" type="checkbox" checked>
      <span>Only filings that said something</span>
    </label>
  </div>

  <div id="feed" class="feed"></div>
  <div class="feedfoot">
    <span id="feed-info" class="muted"></span>
    <button id="feed-more" type="button" class="more">Load more</button>
  </div>
</section>

<!-- =========================== COMPANY ========================== -->
<!--
  A third view, entered by clicking a symbol in the feed. It costs no new route
  and no new index: it is 'api/filings?symbol=X' — which the existing
  'symbol_1_category_1_disseminatedAt_-1' index serves — and every widget in it
  is derived in the browser from that one payload.

  THE COVERAGE LINE IS NOT DECORATION. Measured on 2026-08-07, this collection
  holds 2,261 filings across 960 companies over four IST days: 460 companies
  have filed exactly ONCE and only 128 have filed five times or more. Any
  distribution drawn over that is computed from one or two observations for most
  of the population, so the page states what it was computed over and the
  group-mix bar suppresses itself below five filings. 'context-line.ts' already
  wrote the rule: a claim about thirty days of data, made by a database holding
  four, is the most confident lie the system is capable of.
-->
<section id="view-company" class="view" role="tabpanel" hidden>
  <button id="company-back" class="back" type="button">Back to feed</button>

  <div class="cohead">
    <div class="coident">
      <span id="co-symbol" class="cosym"></span>
      <span id="co-name" class="coname"></span>
      <span id="co-industry" class="tag" hidden></span>
    </div>
    <div id="co-coverage" class="cocoverage"></div>
  </div>

  <div class="hero">
    <div class="herostat">
      <div id="co-filings" class="herovalue">—</div>
      <div class="herolabel">filings held</div>
    </div>
    <div class="herostat">
      <div id="co-verified" class="herovalue accent">—</div>
      <div class="herolabel">verified</div>
    </div>
    <div class="herostat">
      <div id="co-last" class="herovalue">—</div>
      <div class="herolabel">last filed</div>
    </div>
  </div>

  <h2 class="bucket">Filing timeline</h2>
  <div id="co-strip" class="strip"></div>

  <div id="co-mix-wrap" hidden>
    <h2 class="bucket">What they file</h2>
    <div id="co-mix" class="mix"></div>
    <div id="co-mix-legend" class="mixlegend"></div>
  </div>

  <h2 class="bucket">Filings</h2>
  <div id="company-feed" class="feed"></div>
</section>

<!-- ============================ ADMIN =========================== -->
<section id="view-admin" class="view" role="tabpanel" aria-labelledby="tab-admin" hidden>

  <section class="stats">
    <div class="stat">
      <div class="label">Total filings</div>
      <div id="stat-total" class="value">—</div>
      <div class="note">stored</div>
    </div>
    <div class="stat">
      <div class="label">Today</div>
      <div id="stat-today" class="value">—</div>
      <div id="stat-today-note" class="note">—</div>
    </div>
    <div class="stat">
      <div class="label">Feed lag</div>
      <div id="stat-lag" class="value">—</div>
      <div class="note">since newest filing</div>
    </div>
    <div class="stat">
      <div class="label">Newest filing</div>
      <div id="stat-newest" class="value mono" style="font-size:15px">—</div>
      <div class="note">disseminated, IST</div>
    </div>
    <div class="stat">
      <div class="label">Cursor</div>
      <div id="stat-cursor" class="value" style="font-size:19px">—</div>
      <div class="note">max seqId</div>
    </div>
    <div class="stat">
      <div class="label">Outcome coverage</div>
      <div id="stat-outcome" class="value">—</div>
      <div id="stat-outcome-note" class="note">—</div>
    </div>
    <div class="stat">
      <div class="label">Amounts read</div>
      <div id="stat-amounts" class="value">—</div>
      <div id="stat-amounts-note" class="note">—</div>
    </div>
    <div class="stat">
      <div class="label">Awaiting read</div>
      <div id="stat-pending" class="value">—</div>
      <div id="stat-pending-note" class="note">source PDFs</div>
    </div>
  </section>

  <section class="filters">
    <label for="category">Category</label>
    <select id="category"><option value="">All categories</option></select>
    <label for="group">Group</label>
    <select id="group">
      <option value="">All groups</option>
      <option value="results">Results</option>
      <option value="narrative">Narrative</option>
      <option value="orders">Orders</option>
      <option value="mna">M&amp;A</option>
      <option value="ratings">Ratings</option>
      <option value="capital">Capital</option>
      <option value="governance">Governance</option>
      <option value="legal">Legal</option>
      <option value="verification">Verification</option>
      <option value="routine">Routine</option>
      <option value="other">Other</option>
    </select>
    <label for="state">Enrichment</label>
    <select id="state">
      <option value="">Any state</option>
      <option value="enriched">enriched</option>
      <option value="pending">pending</option>
      <option value="unparseable">unparseable</option>
      <option value="failed">failed</option>
    </select>
    <label for="amount">Amount</label>
    <select id="amount">
      <option value="">Any</option>
      <option value="extracted">extracted</option>
      <option value="refused">refused</option>
    </select>
    <label for="tier">Confidence</label>
    <select id="tier">
      <option value="">Any confidence</option>
      <option value="verified">verified</option>
      <option value="unverified">unverified</option>
    </select>
    <label for="limit">Rows</label>
    <select id="limit">
      <option value="25" selected>25</option>
      <option value="50">50</option>
      <option value="100">100</option>
      <option value="200">200</option>
    </select>
    <button id="clear" type="button">Clear</button>
    <span id="refusal-chip"></span>
    <span style="flex:1 1 auto"></span>
    <span id="page-info" class="muted mono">—</span>
    <button id="prev" type="button" disabled>Prev</button>
    <button id="next" type="button" disabled>Next</button>
  </section>

  <main class="grid">
    <div class="panel">
      <h2><span>Recent filings</span><span class="muted">newest first — click a row for the detail behind it</span></h2>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Symbol</th>
              <th>What was said</th>
              <th>Group</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>

    <div class="side">
      <div class="panel">
        <h2><span>Notable claims</span><span class="muted">click to filter</span></h2>
        <div id="claims"></div>
      </div>
      <div class="panel">
        <h2><span>Financial results</span><span class="muted">click to filter</span></h2>
        <div id="results"></div>
      </div>
      <div class="panel">
        <h2><span>Confidence</span><span class="muted">click to filter</span></h2>
        <div id="tiers" class="rows"></div>
      </div>
      <div class="panel">
        <h2><span>Category groups</span><span class="muted">click to filter</span></h2>
        <div id="groups" class="rows"></div>
      </div>
      <div class="panel">
        <h2><span>Categories</span><span class="muted">click to filter</span></h2>
        <div id="categories" class="rows scroll"></div>
      </div>
      <div class="panel">
        <h2><span>How documents were read</span><span class="muted">no filter accepts a parser</span></h2>
        <div id="reading"></div>
      </div>
      <div class="panel">
        <h2><span>Filings per IST day</span></h2>
        <div id="days" class="days"></div>
        <div class="dayaxis"><span id="day-from">—</span><span id="day-to">—</span></div>
      </div>
      <details class="panel diagnostics" id="diagnostics">
        <summary><span>Diagnostics</span><span id="diag-count" class="muted"></span></summary>
        <div class="panel-body">
          <h2><span>Why amounts were refused</span><span class="muted">click to filter</span></h2>
          <div id="refusals"></div>
        </div>
      </details>
    </div>
  </main>
</section>

<footer>
  Read-only. This view never writes to the filings collection. All times are IST (UTC+05:30).
  Every insight is traceable: the symbol and category are stored verbatim, the action phrase is a fixed lookup,
  and the amount and counterparty quote the source document.
  A refused amount degrades the headline to the exchange's own words.
  Every claim carries the sentence it was read from, matched against the source document before it is shown;
  a claim whose sentence is not in the document is discarded, and the discard is kept under Admin with the rule that refused it.
  Verified means a span of the source was matched character for character and is the only tier allowed near an alert;
  exchange-stated means NSE's own summary said it and nobody has checked it against the attached document;
  category only means all that is known is what kind of filing this is.
  Category only is an honest floor, not a failure — an investor presentation nobody verified is still an investor presentation.
  Amount-path refusals are diagnostics, not headlines: no-candidate and ambiguity-keyword together accounted for
  95% of a collection none of whose rows are blank, so they are still counted and still filterable under Diagnostics
  rather than shouted from every row. The panel is collapsed and not removed, and its summary carries the live
  refusal total, because an extractor whose refusals are invisible is indistinguishable from one that is not running.
</footer>

<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
