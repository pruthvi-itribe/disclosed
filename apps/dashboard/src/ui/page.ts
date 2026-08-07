import { PAGE_SCRIPT } from './page-script';
import { PAGE_STYLE } from './page-style';

/**
 * The dashboard page: one self-contained HTML document.
 *
 * SELF-CONTAINED IS A REQUIREMENT, not a preference. There is no `<link>`, no
 * `<script src>`, no web font, no CDN and no build step — the CSS and the
 * JavaScript are inlined from their own modules and the document references
 * nothing outside its own origin. Two reasons:
 *
 *   - this is a diagnostic view of a local pipeline, and the moment you most
 *     need it is the moment the network is the suspect; and
 *   - a page that fetches code from a third party at render time is a third
 *     party with script access to a view of an unauthenticated database.
 *
 * The markup here is a SHELL. It carries no filing data at all: every value is
 * placed by the script from the JSON routes, which is what lets the page poll
 * without a reload and what keeps exchange-supplied text out of a server-side
 * string concatenation where it would have to be escaped by hand.
 *
 * THE ONE EXCEPTION IS A TAXONOMY, NOT DATA. The eleven category groups are
 * written out as `<option>` elements rather than fetched like the categories
 * below them, for three reasons: the set is closed and owned by this codebase
 * (`libs/filings/src/logic/category-group.ts`), so it cannot arrive late or
 * differ per collection; the filter has to work on a page whose first fetch has
 * not returned; and the enrichment panel reads its group spellings back out of
 * these very options, so there is exactly ONE list of the eleven on the page and
 * no way for a panel label and a filter label to drift apart. The enrichment
 * state and amount filters above are already written the same way for the same
 * reason — a fixed allowlist belongs in the document, a measured distribution
 * does not.
 *
 * THE ORDER OF THE SIDEBAR IS AN ARGUMENT, not a layout. The panels that say
 * what filings CONTAIN come first — claims, results, confidence, groups — and
 * the amount extractor's refusal breakdown comes last, behind a `<details>` that
 * starts closed. It used to lead. That made sense when a refused amount meant an
 * empty row, and stopped making sense when every filing gained an outcome
 * composed from the exchange's own summary: two reasons, `no-candidate` and
 * `ambiguity-keyword`, then accounted for 95% of a collection none of whose rows
 * were blank any more.
 *
 * The disclosure is COLLAPSED, NOT REMOVED, and its summary line carries the
 * live refusal total precisely so the collapse costs no evidence — an extractor
 * whose refusals are invisible is indistinguishable from one that is not
 * running, and a number on a closed panel is the cheapest way to keep those two
 * apart. Everything inside it is still counted and still clickable to a filter.
 */
export const renderDashboardPage = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Turret — NSE filings ingest</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<header class="bar">
  <div class="brand">
    <span class="mark">tur<span class="dotmark">ret</span></span>
    <span class="sub">NSE corporate filings ingest — read-only view</span>
  </div>
  <div class="status">
    <span id="live-dot" class="dot"></span>
    <span id="live-text">connecting</span>
    <span id="generated" class="muted mono"></span>
  </div>
</header>

<div id="alert" class="alert" hidden></div>

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
  <label for="symbol">Symbol</label>
  <input id="symbol" type="text" placeholder="RELIANCE" autocomplete="off" spellcheck="false" size="14">
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
      <summary><span>Diagnostics</span><span id="diag-count" class="diag-count">—</span></summary>
      <h2><span>Why amounts were refused</span><span class="muted">click to filter</span></h2>
      <div id="refusals"></div>
    </details>
  </div>
</main>

<footer>
  Read-only. This view never writes to the filings collection. All times are IST (UTC+05:30), rendered server-side.
  Every headline component is traceable: the symbol and category are stored verbatim, the action phrase is a fixed lookup,
  and the amount and counterparty quote the source document. A refused amount degrades the headline to the exchange's own words.
  Every notable claim carries the verbatim sentence it was read from, matched against the source document before publication;
  a claim whose sentence is not in the document is discarded, and the discard is shown here with the rule that refused it.
  Every filing states an outcome and carries the tier that says how somebody would check it: verified means a span of the source
  document was matched character for character and is the only tier allowed near an alert; exchange-stated means NSE's own summary
  said it and nobody has checked it against the attached document; category only means all that is known is what kind of filing
  this is. Category only is an honest floor, not a failure — an investor presentation nobody verified is still an investor
  presentation. The confidence filter cuts at verified because that is the boundary with a consequence; the row badge is where all
  three tiers are told apart.
  Amount-path refusals are diagnostics, not headlines. no-candidate and ambiguity-keyword both say the document was
  read and stated no figure worth taking — the ordinary case, and true of 95% of this collection — so a row carries
  them as a muted "why" beside the dash in the Amount column, where hovering names the reason and clicking filters the
  table to it. A refusal that means something went wrong stays on the row as it always was: a document that could not
  be read at all, figures that disagreed with each other, a band published instead of a figure. Nothing was deleted.
  Every refusal, demoted or not, is still counted and still filterable under Diagnostics at the foot of the sidebar,
  whose summary line carries the running total even while it is closed, because an extractor whose refusals are
  invisible is indistinguishable from one that is not running.
</footer>

<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
