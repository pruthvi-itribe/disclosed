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
    <h2><span>Recent filings</span><span class="muted">newest first, by dissemination</span></h2>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Time (IST)</th>
            <th>Symbol</th>
            <th>Headline</th>
            <th>Amount</th>
            <th>Enrichment</th>
            <th>Source</th>
            <th>Seq</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </div>

  <div class="side">
    <div class="panel">
      <h2><span>Why amounts were refused</span><span class="muted">click to filter</span></h2>
      <div id="refusals"></div>
    </div>
    <div class="panel">
      <h2><span>Notable claims</span><span class="muted">click to filter</span></h2>
      <div id="claims"></div>
    </div>
    <div class="panel">
      <h2><span>Filings per IST day</span></h2>
      <div id="days" class="days"></div>
      <div class="dayaxis"><span id="day-from">—</span><span id="day-to">—</span></div>
    </div>
    <div class="panel">
      <h2><span>Categories</span><span class="muted">click to filter</span></h2>
      <div id="categories" class="rows scroll"></div>
    </div>
  </div>
</main>

<footer>
  Read-only. This view never writes to the filings collection. All times are IST (UTC+05:30), rendered server-side.
  Every headline component is traceable: the symbol and category are stored verbatim, the action phrase is a fixed lookup,
  and the amount and counterparty quote the source document. A refused amount degrades the headline to the exchange's own words.
  Every notable claim carries the verbatim sentence it was read from, matched against the source document before publication;
  a claim whose sentence is not in the document is discarded, and the discard is shown here with the rule that refused it.
</footer>

<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
