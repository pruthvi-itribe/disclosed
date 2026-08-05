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
<title>redbox — NSE filings ingest</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<header class="bar">
  <div class="brand">
    <span class="mark">red<span class="dotmark">box</span></span>
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
</section>

<section class="filters">
  <label for="symbol">Symbol</label>
  <input id="symbol" type="text" placeholder="RELIANCE" autocomplete="off" spellcheck="false" size="14">
  <label for="category">Category</label>
  <select id="category"><option value="">All categories</option></select>
  <label for="limit">Rows</label>
  <select id="limit">
    <option value="25" selected>25</option>
    <option value="50">50</option>
    <option value="100">100</option>
    <option value="200">200</option>
  </select>
  <button id="clear" type="button">Clear</button>
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
            <th>Category</th>
            <th>Summary</th>
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
</footer>

<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
