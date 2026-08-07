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
  /* Centred and capped. Without this the feed keeps adding columns on a very
     wide monitor until a card is 200px of text in a 2,500px row, and the
     header rule stretches to a hairline the eye cannot follow back. */
  max-width: 1680px;
  margin: 0 auto;
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
/* A quoted source sentence. Spans the box rather than sharing a column, because
   these are whole sentences of PDF text and a 280px column would shred them. */
.ditem.quote { grid-column: 1 / -1; align-items: flex-start; }
.ditem.quote .dvalue { color: var(--muted); font-size: 11.5px; line-height: 1.5; }
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

/* ==========================================================================
   FEED — the product view.
   Everything above this line dresses the instrument panel. This dresses the
   thing a reader came for, and the whole design rule is one sentence: the
   sentence a company said must be the largest, highest-contrast element on the
   screen, and every label around it must be quieter than it.
   ========================================================================== */

.topbar {
  display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
  padding-bottom: 14px; margin-bottom: 20px;
  border-bottom: 1px solid var(--line);
}
.topbar .brand { flex: 0 0 auto; }
.topbar .status { margin-left: auto; }

.tabs { display: flex; gap: 4px; }
.tab {
  background: transparent; color: var(--muted); border: 0;
  font: inherit; font-weight: 550; cursor: pointer;
  padding: 6px 14px; border-radius: 999px;
}
.tab:hover { color: var(--text); background: var(--panel); }
.tab.active { color: var(--bg); background: var(--text); }

.view[hidden] { display: none; }

/* --- hero ---------------------------------------------------------------- */
.hero { display: flex; gap: 40px; flex-wrap: wrap; margin-bottom: 22px; }
.herovalue {
  font-size: 40px; font-weight: 680; letter-spacing: -0.03em; line-height: 1.05;
  font-variant-numeric: tabular-nums;
}
.herovalue.accent { color: var(--ok); }
.herovalue.stale { color: var(--warn); }
.herovalue.down { color: var(--bad); }
.herolabel { color: var(--muted); font-size: 12px; margin-top: 2px; }

/* --- controls ------------------------------------------------------------ */
.feedbar { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
#symbol {
  width: 100%;
  background: var(--panel); color: var(--text);
  border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 14px; font: inherit;
}
#symbol:focus { outline: none; border-color: var(--accent); }

/*
 * THE TYPE-AHEAD.
 *
 * position:relative on the wrapper and absolute on the list, so the list
 * OVERLAYS the chips below it instead of pushing them down. That is not
 * cosmetic: the chips are a filter a reader may be about to use, and a control
 * row that jumps 200px down the page every time somebody types is a control row
 * that gets misclicked.
 *
 * z-index above the cards for the same reason, and a solid background rather
 * than a translucent one — a suggestion list you can read the feed through is a
 * list you cannot read.
 */
.searchbox { position: relative; max-width: 420px; }

.suggest {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 30;
  margin: 0; padding: 5px 0; list-style: none;
  background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
  max-height: 340px; overflow-y: auto;
}
.suggest[hidden] { display: none; }

/* A heading inside the list. role="presentation", so it is not arrowable —
   and styled so it is obviously not a row you can pick. */
.sgroup {
  padding: 7px 12px 3px; color: var(--muted);
  font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase;
}

.sopt {
  display: flex; align-items: baseline; gap: 9px;
  padding: 6px 12px; cursor: pointer; min-width: 0;
}
/*
 * ONE HIGHLIGHT CLASS FOR MOUSE AND KEYBOARD, and it is deliberately not
 * :hover. The arrow keys move a highlight without moving the pointer, so a
 * hover rule would light up whichever row the mouse happens to be resting over
 * as WELL as the one Enter would actually pick — two highlighted rows, one of
 * which is lying about what the next keypress does.
 */
.sopt.active { background: rgba(88, 166, 255, 0.16); }
.ssym { font-weight: 650; font-size: 13px; white-space: nowrap; }
.sname {
  color: var(--muted); font-size: 12px; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The filing count, right-aligned. It is how a reader tells two companies whose
   names both complete what they typed apart. */
.scount {
  margin-left: auto; flex: 0 0 auto;
  font-family: var(--mono); font-size: 11px; color: var(--muted);
}

/* What a picked suggestion applied, and how to undo it. Shown only when the
   search box is actually filtering something, so it costs nothing the rest of
   the time. */
.searchnote { color: var(--muted); font-size: 12px; }
.searchnote[hidden] { display: none; }
.searchnote .clearq {
  background: none; border: 0; padding: 0 0 0 8px;
  color: var(--accent); font: inherit; font-size: 12px; cursor: pointer;
}
.searchnote .clearq:hover { text-decoration: underline; }

.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  background: var(--panel); color: var(--muted);
  border: 1px solid var(--line); border-radius: 999px;
  padding: 5px 13px; font: inherit; font-size: 12.5px; cursor: pointer;
}
.chip:hover { color: var(--text); border-color: var(--muted); }
.chip.active { background: var(--accent); border-color: var(--accent); color: #06101f; font-weight: 600; }

.onlyinsights { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12.5px; cursor: pointer; }
.onlyinsights input { accent-color: var(--accent); }

/* --- the feed ------------------------------------------------------------ */
/* A GRID THAT FILLS THE WIDTH, not one card per row.
   A card carrying a single short claim is a full-width strip of mostly empty
   space on any monitor wider than a laptop, and the feed is mostly such cards:
   at 2.4 claims per filing, most of them are three lines tall.

   ROW-MAJOR, WHICH IS WHY IT IS GRID AND NOT COLUMNS. A CSS multi-column
   layout packs cards tighter but fills column one top to bottom before column
   two, so the newest filing sits above one from an hour ago and a
   chronological feed stops being chronological. Grid flows left to right, row
   by row, which is the order the eye already reads in.

   ROWS STRETCH, and the earlier design said the opposite for a reason that
   stopped being true. 'align-items: start' let each card keep its own height so
   a tall one would not pad its neighbour — correct while a card could be 330px,
   because stretching to that leaves 126px of empty panel in the two beside it.
   The fix was not to smooth the result but to bound the input: at two claims a
   card is 211-279px, so a row's tallest is close enough to its shortest that
   matching them costs less than the ragged edge did.

   Measured at 1440px over the live feed, and the trade is visible in one line:

     variant                       spread   worst row gap   worst void
     floor 170, align start         1.94        149px          40px
     stretch, three claims          1.41          0            149px
     stretch, two claims            1.32          0            104px

   There is no arrangement with neither, because the content itself is the
   variable — one filing says two things and another says eleven. The choice is
   only ever WHERE the slack goes, and it goes inside the card: a flat row edge
   with a little air above an aligned footer reads as rhythm, while a 149px step
   between two card bottoms reads as breakage. */
.feed {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 10px;
}
/* The time buckets are dividers across the whole feed, not cards in it. */
.feed .bucket { grid-column: 1 / -1; }

.bucket {
  font-size: 11px; text-transform: uppercase; letter-spacing: .1em;
  color: var(--muted); font-weight: 600;
  margin: 18px 0 2px; padding-bottom: 6px; border-bottom: 1px solid var(--line);
}
.bucket:first-child { margin-top: 0; }

.card {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 14px; padding: 16px 18px;
  transition: border-color .12s ease, transform .12s ease;
  /* A floor for the row that is short all the way across. The grid matches
     heights WITHIN a row, so this only does anything when every card in a row
     is small — without it a row of three one-line record dates collapses to a
     band thinner than the filter chips above it. 150px was measured free: no
     card's own content stops short of it, so nothing is padded to reach it. */
  min-height: 150px;
  display: flex;
  flex-direction: column;
}
/* THE FOOTERS ALIGN, and that is what makes the space above them read as air
   rather than as a card that gave up early. Every card in a row is now the same
   height, so pushing each footer to its own bottom puts all three on one line
   across the feed — the horizontal rule a reader's eye follows. This one
   declaration is doing the work that a fixed card height would otherwise need,
   without freezing a height that content will outgrow. */
.card .cardfoot { margin-top: auto; }
.card:hover { border-color: #3a4553; }
/* A filing that said nothing verifiable is drawn quieter, not dropped.
   Pretending it is as substantial as a results card would be a lie told in
   CSS — so it recedes, and stays readable. */
.card.quiet { background: transparent; padding: 11px 18px; }
.card.quiet .sym { font-size: 14px; }

/* ONE LINE, and the company name is what gives. In a 400px grid column a long
   name like "Aditya Birla Lifestyle Brands Limited" pushed the timestamp and
   the group chip onto a second row, so cards in the same row started at
   different heights for no reason a reader could see. The ticker never
   truncates — it is the identifier — and the full name is the title attribute. */
.cardhead { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.who { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1 1 auto; }
.who .coname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.cardmeta { flex: 0 0 auto; }
.sym { font-size: 17px; font-weight: 680; letter-spacing: -0.01em; }
.coname { color: var(--muted); font-size: 12.5px; }
.cardmeta { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.when { color: var(--muted); font-size: 12px; white-space: nowrap; }

/* THE HERO. Bigger than the company name, brighter than everything else. */
.insights { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.insights li {
  font-size: 15.5px; line-height: 1.45; font-weight: 480;
  padding-left: 14px; position: relative;
}
.insights li::before {
  content: ""; position: absolute; left: 0; top: .62em;
  width: 5px; height: 5px; border-radius: 50%; background: var(--accent);
}
.andmore {
  background: transparent; border: 0; color: var(--accent);
  font: inherit; font-size: 12px; cursor: pointer;
  margin-top: 8px; padding: 2px 0 2px 14px; text-align: left;
}
.andmore:hover { text-decoration: underline; }

.stated { margin: 0; color: var(--muted); font-size: 13.5px; line-height: 1.45; }

.cardfoot {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 13px; padding-top: 11px; border-top: 1px solid var(--line);
  font-size: 11.5px;
}
/* A quiet card's footer is drawn without its rule, but it is still pushed to
   the bottom — 'margin-top: 8px' here used to override the 'auto' above, which
   left the footer floating under two lines of text with the rest of the card
   empty below it. That was the one thing in a stretched row that still looked
   like a mistake: every other footer on the line sat on the baseline and these
   two did not. The 8px separation moves to padding, where it cannot compete
   with the push. */
.card.quiet .cardfoot { margin-top: auto; padding-top: 8px; border-top-color: transparent; }
.cardcat { color: var(--muted); }
.grow { flex: 1 1 auto; }
.copy, .srclink {
  background: transparent; border: 1px solid var(--line); border-radius: 7px;
  color: var(--muted); font: inherit; font-size: 11.5px;
  padding: 4px 11px; cursor: pointer; text-decoration: none;
}
.copy:hover, .srclink:hover { color: var(--text); border-color: var(--muted); text-decoration: none; }

.feedfoot { display: flex; align-items: center; gap: 14px; margin-top: 22px; }
.more {
  background: var(--panel); color: var(--text); border: 1px solid var(--line);
  border-radius: 10px; padding: 9px 20px; font: inherit; cursor: pointer;
}
.more:hover { border-color: var(--muted); }
.more[hidden] { display: none; }

.emptyfeed { padding: 56px 20px; text-align: center; }
.emptytitle { font-size: 17px; font-weight: 600; margin-bottom: 8px; }
.emptyhint { color: var(--muted); font-size: 13px; max-width: 460px; margin: 0 auto; line-height: 1.5; }

@media (max-width: 640px) {
  .hero { gap: 26px; }
  .herovalue { font-size: 30px; }
  .cardmeta { margin-left: 0; width: 100%; }
}

/* ===================== COMPANY PAGE ===================================== */

.back {
  background: transparent; border: 0; color: var(--muted);
  font: inherit; font-size: 12.5px; cursor: pointer; padding: 4px 0;
  margin-bottom: 12px;
}
.back:hover { color: var(--text); }
/* The arrow is drawn in CSS rather than typed as a character, and NOT as a
   unicode escape. This file is a TypeScript template literal, so a backslash
   followed by digits is read as an octal escape and rejected by the compiler —
   which is true of the comment as much as of the rule, because a comment
   inside a template literal is still string content. A rotated border draws
   the same arrow with nothing to escape. */
.back::before {
  content: ""; display: inline-block; width: 6px; height: 6px;
  margin-right: 8px; border-left: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor; transform: rotate(45deg);
  vertical-align: middle;
}

.cohead { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.coident { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.cosym { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
.cocoverage { margin-left: auto; color: var(--muted); font-size: 12px; }

/* The symbol on a card is the way into the company page. Styled as text, not
   as a button, because a border on every card would be nine borders of chrome
   competing with the sentence the card exists to show. */
button.sym {
  background: transparent; border: 0; padding: 0; cursor: pointer;
  color: var(--text); font: inherit;
  font-size: 17px; font-weight: 680; letter-spacing: -0.01em;
}
button.sym:hover { color: var(--accent); }
.card.quiet button.sym { font-size: 14px; }

/* --- the filing strip ---------------------------------------------------
   One column per IST day, one square per filing. A square rather than a bar
   because at ~2.4 filings a company a bar chart is two bars of height one and
   needs an axis; squares are countable at a glance. */
.strip { display: flex; gap: 6px; align-items: flex-end; overflow-x: auto; padding: 4px 0 0; }
.stripday { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 18px; }
.stripstack { display: flex; flex-direction: column-reverse; gap: 2px; min-height: 12px; justify-content: flex-start; }
.stripcell {
  width: 12px; height: 12px; border-radius: 3px; padding: 0;
  border: 0; cursor: pointer; background: var(--accent); opacity: .65;
}
.stripcell:hover { opacity: 1; }
.stripcell.results { background: var(--results, #fcd34d); opacity: .85; }
.stripcell.claim { background: var(--claim, #7dd3fc); opacity: .85; }
/* routine and governance are 57% of everything filed. Making them recede is
   the most informative thing colour does on this page. */
.stripcell.quiet { background: var(--line); opacity: 1; }
/* A day with NO filings is a rule, not a short column: on real data a Sunday
   is 26 filings against a Tuesday's 832, so a proportional bar renders an
   ordinary weekend as an outage. */
.stripnone { width: 12px; height: 2px; border-radius: 1px; background: var(--line); }
.striplabel { color: var(--muted); font-size: 10px; line-height: 1; }
.stripday-num { color: var(--muted); font-size: 10px; opacity: .6; line-height: 1; }
.stripday.weekend .striplabel, .stripday.weekend .stripday-num { opacity: .35; }

/* --- the group mix ------------------------------------------------------ */
.mix { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--line); }
.mixseg { min-width: 2px; }
.mixlegend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px; font-size: 12px; color: var(--muted); }
.mixitem { display: flex; align-items: center; gap: 6px; }
.mixdot { width: 8px; height: 8px; border-radius: 2px; background: var(--accent); }

.g-results { background: var(--results, #fcd34d); }
.g-narrative, .g-orders, .g-mna, .g-ratings, .g-capital, .g-legal, .g-verification, .g-other { background: var(--accent); }
.g-routine, .g-governance { background: var(--line); }

#company-feed { margin-top: 10px; }
/* On a page headed GODREJCP, repeating "GODREJCP Godrej Consumer Products
   Limited" on all six cards is six lines of chrome answering a question the
   heading answered. The identity is hidden and the time moves left into the
   space it leaves, so the insight starts where the eye already is. */
#company-feed .who { display: none; }
#company-feed .cardmeta { margin-left: 0; width: 100%; }
#company-feed .cardhead { margin-bottom: 8px; }

/* --- the day bar and figure emphasis ----------------------------------- */
.daybar { margin-bottom: 20px; }
.daybar .mix { height: 6px; }
.daysentence { margin-top: 9px; color: var(--muted); font-size: 12.5px; }

/* A figure the DOCUMENT printed, set apart so the eye finds it. It is
   typography, never arithmetic: nothing here computes, converts or compares a
   number, because a percentage derived from two other figures is a calculation
   and nothing downstream can tell a right one from a wrong one. */
.insights .fig {
  font-variant-numeric: tabular-nums;
  font-weight: 620;
  color: #fff;
}

/* A weekend bar is short because the exchange is quiet, not because ingestion
   stopped. Marked so the two cannot be confused: measured over 32 days a
   Sunday is 26 filings against a Tuesday's 832. */
.day.weekend { opacity: .45; }
.day.weekend.empty { background: var(--line); opacity: .7; }

/* The topic row sits under the group row and reads as the quieter question:
   what a filing is ABOUT rather than what KIND it is. Same control, one step
   back, so two rows of chips do not compete for the same attention. */
.chips.topics .chip { font-size: 12px; opacity: .85; }
.chips.topics .chip.active { opacity: 1; background: var(--claim, #7dd3fc); border-color: var(--claim, #7dd3fc); color: #06101f; }
`;
