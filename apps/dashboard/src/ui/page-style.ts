/**
 * The dashboard's stylesheet, inlined into the page.
 *
 * NOTHING here may reference a URL. No `@import`, no `url(...)`, no web font.
 * The page must render identically on a machine with no network at all, which
 * is the normal state of the box this runs on: it is a loopback-only viewer
 * onto a local database, and a stylesheet that half-arrives from a CDN is a
 * dashboard that half-works exactly when the network is the thing you were
 * trying to diagnose.
 *
 * Dark, because this is a wall-display for a process that runs from 07:00 to
 * 23:00 IST and is mostly looked at in the evening.
 */
export const PAGE_STYLE = `
:root {
  --bg: #0d1117;
  --panel: #161b22;
  --panel-2: #1c2430;
  --line: #2a323d;
  --text: #e6edf3;
  --muted: #8b949e;
  --accent: #58a6ff;
  --ok: #3fb950;
  --warn: #d29922;
  --bad: #f85149;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.45;
  padding: 16px 20px 32px;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.muted { color: var(--muted); }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }

header.bar {
  display: flex; flex-wrap: wrap; gap: 12px;
  align-items: baseline; justify-content: space-between;
  border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 16px;
}
.brand { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.mark { font-size: 20px; font-weight: 650; letter-spacing: -0.02em; }
.mark .dotmark { color: var(--bad); }
.sub { color: var(--muted); font-size: 13px; }
.status { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.dot.live { background: var(--ok); animation: pulse 2s ease-in-out infinite; }
.dot.stale { background: var(--warn); }
.dot.down { background: var(--bad); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

.alert {
  border: 1px solid var(--bad); background: rgba(248, 81, 73, 0.09);
  color: var(--text); border-radius: 6px; padding: 8px 12px; margin-bottom: 14px;
  font-size: 13px;
}

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
.stat .label { color: var(--muted); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.stat .value { font-family: var(--mono); font-size: 24px; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
.stat .note { color: var(--muted); font-size: 12px; font-family: var(--mono); }
.stat .value.ok { color: var(--ok); }
.stat .value.warn { color: var(--warn); }
.stat .value.bad { color: var(--bad); }

.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
.filters label { color: var(--muted); font-size: 12px; }
input, select, button {
  background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 6px 9px; font-size: 13px; font-family: inherit;
}
input:focus, select:focus, button:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
button { cursor: pointer; }
button:hover:enabled { border-color: var(--accent); }
button:disabled { opacity: 0.4; cursor: default; }
select { max-width: 330px; }

.grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(280px, 1fr); gap: 16px; align-items: start; }
@media (max-width: 1000px) { .grid { grid-template-columns: minmax(0, 1fr); } }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.panel h2 {
  margin: 0; padding: 10px 14px; font-size: 12px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
  border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; gap: 8px;
}
.side { display: grid; gap: 16px; }
.scroll { max-height: 68vh; overflow: auto; }

table { width: 100%; border-collapse: collapse; }
thead th {
  position: sticky; top: 0; z-index: 1; background: var(--panel-2);
  text-align: left; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--muted); font-weight: 600; padding: 8px 10px; border-bottom: 1px solid var(--line);
}
tbody td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: rgba(88, 166, 255, 0.06); }
/* Relative now ("14 min ago"), so it is prose rather than a monospaced instant.
   The exact IST time is the cell's title and a line in the detail row. */
td.time { white-space: nowrap; font-size: 12px; color: var(--muted); }

/* A row opens. Say so with the cursor rather than with an affordance column. */
tbody tr.clickable { cursor: pointer; }
tbody tr.open { background: rgba(88, 166, 255, 0.08); }
tbody tr.open td { border-bottom-color: transparent; }

tr.detail td { padding: 0 12px 12px; background: rgba(88, 166, 255, 0.04); }
.detailbox {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: .35rem 1.5rem;
  padding: .7rem .8rem;
  border-left: 2px solid rgba(88, 166, 255, .35);
  font-size: 12px;
  line-height: 1.45;
}
.ditem { display: flex; gap: .5rem; align-items: baseline; min-width: 0; }
.dlabel {
  flex: 0 0 auto;
  min-width: 96px;
  color: var(--muted);
  font-size: .68rem;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.dvalue { min-width: 0; overflow-wrap: anywhere; }
/* The one line in the box that no span was matched against keeps saying so. */
.ditem.unverified .dlabel, .ditem.unverified .dvalue { color: var(--muted); font-style: italic; }
.ditem.refused .dvalue { font-family: var(--mono); font-size: 11px; }
td.sym { font-family: var(--mono); font-weight: 600; white-space: nowrap; }
td.cat { color: var(--muted); font-size: 12px; max-width: 210px; }
td.sum { min-width: 260px; }
td.src { white-space: nowrap; font-size: 12px; }
.lag { font-family: var(--mono); font-size: 11px; color: var(--muted); }

tr.fresh td { animation: arrive 6s ease-out 1; }
tr.fresh td:first-child { box-shadow: inset 3px 0 0 var(--ok); }
@keyframes arrive {
  0% { background: rgba(63, 185, 80, 0.28); }
  100% { background: transparent; }
}
@media (prefers-reduced-motion: reduce) {
  tr.fresh td { animation: none; background: rgba(63, 185, 80, 0.1); }
  .dot.live { animation: none; }
}

.rows { padding: 4px 0; }
.row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 5px 14px; font-size: 12px; }
.row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .n { font-family: var(--mono); color: var(--muted); }
.row.clickable { cursor: pointer; }
.row.clickable:hover { background: rgba(88, 166, 255, 0.08); }
.row.active { background: rgba(88, 166, 255, 0.14); }
.meter { grid-column: 1 / -1; height: 3px; background: var(--accent); border-radius: 2px; opacity: 0.55; }

.days { display: flex; align-items: flex-end; gap: 3px; height: 110px; padding: 12px 14px 6px; }
.day { flex: 1 1 0; background: var(--accent); opacity: 0.6; border-radius: 2px 2px 0 0; min-height: 2px; }
.day.today { opacity: 1; background: var(--ok); }
.day.empty { background: var(--line); opacity: 1; }
.dayaxis { display: flex; justify-content: space-between; padding: 0 14px 10px; color: var(--muted); font-size: 11px; font-family: var(--mono); }

.empty-state { padding: 24px 14px; color: var(--muted); text-align: center; font-size: 13px; }
footer { margin-top: 18px; color: var(--muted); font-size: 12px; }

/* --- the composed headline and everything behind it ----------------------- */

/*
 * The headline is the row's first line and the summary is demoted beneath it.
 * That inversion is the whole change: the exchange's boilerplate is what the
 * row used to lead with, and it is the thing that carries no information.
 */
.headline { font-weight: 600; line-height: 1.35; }
.headline.enriched { color: var(--text); }
/* A degraded headline is the exchange's own words, and it reads as such. */
.headline.verbatim { color: var(--muted); font-weight: 500; }
.claimline{font-weight:600;letter-spacing:.01em;color:var(--claim,#7dd3fc);margin-top:.25rem;line-height:1.35}
/* The results line leads its cell and is deliberately unlike the claim line
   beside it: the two were admitted by different gates. */
.resultsline{color:var(--results,#fcd34d);margin-bottom:.3rem}
.claimspan{color:var(--muted,#94a3b8);font-size:.78rem;font-style:italic;margin-top:.15rem;line-height:1.3}
.periodspan{font-style:normal;opacity:.8}
/* The model summary. Visually UNLIKE a verified claim on purpose: a reader
   scanning a column of quoted evidence must be able to tell at a glance which
   line nothing verified. Dashed rule, muted, and prefixed with a label. */
.modelsummary{margin-top:.35rem;padding:.3rem .5rem;border-left:2px dashed var(--muted,#94a3b8);color:var(--muted,#94a3b8);font-size:.78rem;line-height:1.35;opacity:.9}
.modelsummary .tagm{display:inline-block;font-size:.62rem;letter-spacing:.06em;text-transform:uppercase;opacity:.75;margin-right:.35rem}
.discards{margin-top:.25rem}
.context { font-size: 12px; color: var(--accent); margin-top: 2px; }
.summary-line { font-size: 12px; color: var(--muted); margin-top: 4px; }

td.amt { font-family: var(--mono); white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
td.amt .value { font-weight: 600; }
td.amt .party { display: block; font-size: 11px; color: var(--muted); white-space: normal; text-align: right; max-width: 190px; }

/*
 * THE QUIET AFFORDANCE, and the whole point of it is that it is quiet.
 *
 * It replaces a warn-coloured pill that read 'no-candidate' or
 * 'ambiguity-keyword' on 95% of the rows in the table — the extractor correctly
 * reporting that a notice of a board meeting states no rupee figure, rendered at
 * the same weight as a document nothing could read. So this has no border, no
 * fill, no warn colour and no reason text: it is a four-letter word at 55%
 * opacity beside the dash it explains.
 *
 * IT IS A CONTROL AND NOT A LABEL, which is what makes the demotion survivable.
 * Hovering it names the reason and its detail; clicking it filters the table to
 * every filing refused the same way; and it lights up in the accent colour when
 * that filter is the one currently applied, so a reader who filtered to
 * 'no-candidate' can still see which rows they are looking at.
 *
 * A button element, so it is reachable by keyboard — it is one interaction away
 * from a reader with a mouse and must not be infinitely far from one without.
 * The shared button rule near the top of this file paints a background and a
 * border; every one of those is unset here rather than left to specificity luck.
 */
.why {
  background: none; border: none; border-radius: 3px; margin: 0; padding: 0 0 0 6px;
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.04em;
  color: var(--muted); opacity: 0.55; cursor: pointer; vertical-align: baseline;
}
.why:hover { opacity: 1; color: var(--accent); text-decoration: underline; }
/* Keyboard focus is the shared input/select/button outline near the top of this
   file, deliberately not overridden: this control has no border of its own to
   carry a focus ring. */
.why.active { opacity: 1; color: var(--accent); text-decoration: underline; }

/*
 * A refusal is rendered as a first-class value, not as an empty cell. The
 * extractor earns trust by explaining what it declined, and a blank here would
 * be indistinguishable from a filing nobody has looked at.
 */
.tag {
  display: inline-block; font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.04em; padding: 1px 6px; border-radius: 10px;
  border: 1px solid var(--line); color: var(--muted); white-space: nowrap;
}
.tag.clickable { cursor: pointer; }
.tag.clickable:hover { border-color: var(--accent); color: var(--accent); }
.tag.state-enriched { color: var(--ok); border-color: rgba(63, 185, 80, 0.45); }
.tag.state-pending { color: var(--warn); border-color: rgba(210, 153, 34, 0.45); }
.tag.state-unparseable { color: var(--bad); border-color: rgba(248, 81, 73, 0.45); }
.tag.state-failed { color: var(--bad); border-color: rgba(248, 81, 73, 0.45); }
.tag.refusal { color: var(--warn); border-color: rgba(210, 153, 34, 0.35); }
.tag.active { background: rgba(88, 166, 255, 0.18); border-color: var(--accent); color: var(--accent); }

td.enr { white-space: nowrap; font-size: 12px; }
.evidence {
  display: block; font-family: var(--mono); font-size: 11px; color: var(--muted);
  margin-top: 3px; white-space: normal; max-width: 210px; word-break: break-word;
}

.reasons { padding: 8px 14px 12px; display: flex; flex-wrap: wrap; gap: 6px; }
.reasons .tag { font-size: 11px; padding: 2px 8px; }
.reasons .n { font-family: var(--mono); color: var(--text); margin-left: 5px; }
.reason-group { padding: 4px 14px 0; color: var(--muted); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
/* A count that should normally be zero. Warn rather than bad: a parser fallback
   is a degraded read, not a lost filing. */
.reason-group.flagged { color: var(--warn); }

/*
 * THE DIAGNOSTICS DISCLOSURE, last in the sidebar and closed by default.
 *
 * The refusal breakdown used to be the first panel on the page. That was right
 * when a refused amount meant an empty row and wrong the moment every filing
 * gained an outcome composed from the exchange's own summary — at which point
 * the panel was leading with a lane that no longer decides whether a row says
 * anything, and two of its reasons covered 95% of the collection.
 *
 * THE SUMMARY LINE STILL CARRIES THE TOTAL WHILE CLOSED, which is the condition
 * on folding it away at all: the breakdown is on demand, the fact that there IS
 * one is not. A reader who never opens this still sees the count, and sees it
 * fall to zero on the day the extractor stops declining anything.
 */
.panel.diagnostics > summary {
  padding: 10px 14px; font-size: 12px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
  display: flex; align-items: baseline; gap: 8px;
  cursor: pointer; list-style: none; user-select: none;
}
.panel.diagnostics > summary::-webkit-details-marker { display: none; }
/* A textual marker rather than the native triangle, which a flex summary drops
   anyway. No image, for the reason the top of this file gives. */
.panel.diagnostics > summary::before {
  content: '+'; font-family: var(--mono); font-weight: 400; width: 8px; opacity: 0.8;
}
.panel.diagnostics[open] > summary::before { content: '-'; }
.panel.diagnostics > summary:hover { color: var(--text); }
.panel.diagnostics > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.panel.diagnostics .diag-count {
  margin-left: auto; font-family: var(--mono); font-weight: 400;
  letter-spacing: 0; text-transform: none;
}

/* --- the outcome, its group and its tier ---------------------------------- */

/*
 * THE OUTCOME COLUMN IS NEVER BLANK, and that is the change it exists to show.
 *
 * The pipeline used to gate on a category allowlist and 71% of filings produced
 * nothing at all - a row with a time, a symbol and empty space, which read
 * exactly like a filing nobody had got to yet. The outcome is derived from two
 * fields the poller writes for every filing, so this column is full even where
 * the worker never arrived, and a reader can tell "nothing was found here" from
 * "nothing has looked here yet" without opening the document.
 *
 * It is the widest and the boldest of the row's columns because for most rows it
 * is the only fact stated: the composed headline beside it degrades to the
 * exchange's own category whenever nothing was verified.
 */
td.out { min-width: 300px; max-width: 520px; }
.outcome { font-weight: 600; line-height: 1.35; color: var(--text); }
.outcome-source { font-family: var(--mono); font-size: 10px; color: var(--muted); margin-left: 7px; }

td.grp { white-space: nowrap; }
/* The group classifies the row rather than saying anything about it, so it is a
   pill and not a line: compact enough to scan a column of, wide enough to click. */
.tag.group { color: var(--text); }

/*
 * The confidence tier, on every row.
 *
 * 'verified' is the ONLY filled badge, because it is the only tier allowed near
 * an alert and that boundary has to survive being read from across a room - this
 * is a wall display. 'stated' is outlined in the accent colour: NSE's own words,
 * strong provenance, nobody checked them against the document.
 *
 * 'labelled' IS DELIBERATELY NOT AN ERROR STATE. It gets the same muted grey as
 * any other neutral fact on this page, and specifically not the red that marks
 * 'unparseable' and 'failed' above. It is an honest floor - the exchange restated
 * its own category, so all that is known is what kind of filing this is - and
 * that is roughly 27% of the collection. Colouring it red would teach a reader to
 * read a quarter of the day's filings as broken, when what they are is unchecked;
 * an investor presentation nobody verified is still an investor presentation.
 */
.tier {
  display: inline-block; font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.04em; padding: 1px 6px; border-radius: 10px;
  border: 1px solid var(--line); color: var(--muted); white-space: nowrap; margin-top: 4px;
}
.tier-verified { color: var(--ok); border-color: rgba(63, 185, 80, 0.55); background: rgba(63, 185, 80, 0.12); }
.tier-stated { color: var(--accent); border-color: rgba(88, 166, 255, 0.4); }
.tier-labelled { color: var(--muted); border-color: var(--line); }

/* Which parser read the document. A neutral fact and not a refusal, and not
   clickable - no filter accepts a parser, so it must not look like the pills
   that do. */
.tag.route { color: var(--muted); }
/*
 * A fallback, on the other hand, IS a warning: an expensive parser was wanted and
 * a service did not answer. This tag is how somebody finds out the optional
 * Docling service has been down since Tuesday, because its other symptom is
 * silence - reads keep succeeding on the cheap parser and results filings just
 * quietly yield fewer figures.
 */
.tag.fallback { color: var(--warn); border-color: rgba(210, 153, 34, 0.35); }
`;
