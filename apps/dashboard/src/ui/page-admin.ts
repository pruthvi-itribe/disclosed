import { BRAND } from './brand';

/**
 * The operator panel: the filings table, the enrichment and refusal
 * breakdowns, the confidence tiers, the parse routes and the daily bars.
 *
 * ITS OWN FILE BECAUSE IT IS ITS OWN DEPLOYMENT DECISION. Every element here
 * describes THIS PIPELINE rather than a company — how much it refused, how much
 * it could not read, how far behind it is — and outside a local run that is our
 * machinery described to somebody who did not ask. `configuration.ts` carries
 * the rule that decides; this file is what it switches off, whole.
 *
 * OFF, THE MARKUP IS NOT HERE AT ALL. Not `hidden`, not display:none: a section
 * that is not in the document cannot be un-hidden from a console, and the six
 * `<select>` filters it carries are simply absent — which is why every fragment
 * that touches them is guarded. See `page-script.ts`.
 *
 * NO BACKTICK AND NO `${` MAY APPEAR INSIDE THE MARKUP BELOW beyond the ones
 * written here on purpose: this is a template literal, and both are consumed by
 * the compiler before a browser sees them. See CLAUDE.md.
 */

/** The tab that opens it, and the empty string that stands in its place. */
export const ADMIN_TAB = `<button id="tab-admin" class="tab" type="button" role="tab" aria-selected="false" aria-controls="view-admin">Admin</button>`;

/**
 * WHAT A HOST WITHOUT THE PANEL PUTS THERE: nothing.
 *
 * Named rather than written as an empty string at each site, so the two
 * branches read as a decision and `page.spec.ts` can assert on the name.
 */
export const ADMIN_TAB_ABSENT = '';

/** The same, for the view itself. */
export const ADMIN_ABSENT = '';

export const ADMIN_VIEW = `<!-- ============================ ADMIN =========================== -->
<section id="view-admin" data-ui="view-admin" class="view" role="tabpanel" aria-labelledby="tab-admin" hidden>

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
  
  <!-- THE METHODOLOGY, MOVED OFF THE READER'S FLOOR. This block stood at the
       bottom of every view and is a wall: twelve lines a reader scrolls past
       daily and an operator needs once. It lives with the other operator
       reading now. Nothing was cut — the tier meanings, the traceability
       story, the arrow rule and the "read the claim, not the arrow" warning
       are all still on the page, where the tests can still hold them. -->
<footer>
  This view never writes to the filings collection. All times are IST (UTC+05:30).
  Every insight is traceable: the symbol and category are stored verbatim, the action phrase is a fixed lookup,
  and the amount and counterparty quote the source document.
  A refused amount degrades the headline to the exchange's own words.
  Every claim carries the sentence it was read from, matched against the source document before it is shown;
  a claim whose sentence is not in the document is discarded, and the discard is kept under Admin with the rule that refused it.
  Verified means a span of the source was matched character for character and is the only tier allowed near an alert;
  exchange-stated means NSE's own summary said it and nobody has checked it against the attached document;
  category only means all that is known is what kind of filing this is.
  Category only is an honest floor, not a failure — an investor presentation nobody verified is still an investor presentation.
  A ▲, ▼ or ◆ appears on a claim only where the document printed both a direction — up, down, grew, declined —
  and the amount, as a percentage or in basis points. Where a filing did not print both, no mark appears;
  that is the case for about three-quarters of verified claims, and an absent mark means the filing was silent, not that nothing happened.
  A fall is not bad news and a rise is not good news: these marks follow the figure, not the company.
  In the current collection, 13 of 45 marked decreases are falling bad loans, debt, borrowing costs or emissions —
  a decrease every reader would call an improvement. Read the claim, not the arrow.
  ${BRAND} does not rate companies or securities. It reports what documents say and shows you where they say it.
  Amount-path refusals are diagnostics, not headlines: no-candidate and ambiguity-keyword together accounted for
  95% of a collection none of whose rows are blank, so they are still counted and still filterable under Diagnostics
  rather than shouted from every row. The panel is collapsed and not removed, and its summary carries the live
  refusal total, because an extractor whose refusals are invisible is indistinguishable from one that is not running.
</footer>
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
      <option value="500">500</option>
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
</section>`;
