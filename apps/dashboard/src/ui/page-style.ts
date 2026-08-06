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
td.time, td.seq { font-family: var(--mono); white-space: nowrap; font-size: 12px; color: var(--muted); }
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
.claimspan{color:var(--muted,#94a3b8);font-size:.78rem;font-style:italic;margin-top:.15rem;line-height:1.3}
.periodspan{font-style:normal;opacity:.8}
.discards{margin-top:.25rem}
.context { font-size: 12px; color: var(--accent); margin-top: 2px; }
.summary-line { font-size: 12px; color: var(--muted); margin-top: 4px; }

td.amt { font-family: var(--mono); white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
td.amt .value { font-weight: 600; }
td.amt .party { display: block; font-size: 11px; color: var(--muted); white-space: normal; text-align: right; max-width: 190px; }

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
`;
