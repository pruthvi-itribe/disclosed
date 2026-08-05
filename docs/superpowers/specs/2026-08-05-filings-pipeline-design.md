# Redbox — NSE/BSE Filings Pipeline

**Date:** 2026-08-05
**Status:** Design approved, pending implementation plan

## Context

Build an automated pipeline that ingests NSE/BSE corporate filings and drives three
consumers: a low-latency personal alert feed, an Instagram content engine for
`@decodedpaisa`, and (later) a commercial API.

Reference point is Redbox Global (`in.redboxglobal.com`), a squawk service whose free
Telegram tier relays exchange filings as compressed headlines. Their edge is speed plus
a strict no-interpretation editorial rule. This system targets the same ingest edge, and
adds a content funnel they do not have.

## Goals

1. Ingest every NSE corporate announcement with no silent loss.
2. Alert to personal Telegram within ~2s of exchange dissemination.
3. Surface the small subset of filings worth an Instagram post, drafted and verified.
4. Keep the ingest core clean enough to become a licensed commercial API later.

## Non-goals

- Interpretation, recommendations, or price targets. The system relays and teaches; it
  never advises. This is what keeps it outside SEBI research-analyst obligations.
- Real-time price data. Out of scope; the securities master is reference data only.
- Redistribution of exchange data before a licence exists (see Legal below).

## Verified source behaviour

All figures below were measured directly on 2026-08-05, not assumed.

### NSE — `https://www.nseindia.com/api/corporate-announcements`

| Property | Finding |
|---|---|
| Auth | Works without cookies today. `bm_sz` / `_abck` present, so Akamai Bot Manager is live and will challenge under load. |
| Live feed (`?index=equities`) | Exactly 20 records. ~14KB, ~130ms. |
| Pagination | **None.** `page`, `pageNo`, `pageno`, `limit` are all silently ignored — identical payload. |
| Date range (`&from_date=dd-mm-yyyy&to_date=dd-mm-yyyy`) | Works. **Uncapped** — 31 days returned 17,254 records (12MB) in 5.7s. |
| Volume | ~600–1000 filings per weekday; peak observed 1,023 (04-Aug-2026). Weekends ~30–60. |
| Load profile | Evening-weighted. 05-Aug had only 23 filings by 10:30 IST. Results land 17:00–21:00. |

Relevant fields per record:

- `seq_id` — monotonic, unique, totally ordered. **Global across all NSE announcement
  streams**, so the equities feed is a filtered view: gaps are normal and do NOT imply
  loss. Valid as a cursor; invalid as a completeness proof.
- `exchdisstime` — exchange dissemination timestamp. Authoritative clock for all latency
  measurement. Never use local time.
- `an_dt`, `difference` — announcement time and NSE's own dissemination lag (observed
  0–2s). Gives ground-truth latency without benchmarking against any competitor.
- `desc` — category taxonomy, e.g. `Bagging/Receiving of orders/contracts`,
  `Credit Rating- Revision`, `Spurt in Volume`, `Press Release`, `Investor Presentation`.
  Primary key for the deterministic gate.
- `symbol`, `sm_isin`, `sm_name`, `smIndustry` — identity. **No market cap.**
- `attchmntText` — one-line summary. `attchmntFile` — source PDF. Numeric detail
  (order value, etc.) lives only in the PDF.

### BSE — unresolved

`api.bseindia.com/BseIndiaAPI/api/AnnGetData/w` returned `"No Record Found!"` for every
parameter variant attempted (both `yyyymmdd` and `dd/mm/yyyy` date formats, with and
without `subcategory`). **The BSE adapter is unproven and requires a spike before it is
specced.** NSE-only is acceptable for v1.

## Architecture

NestJS monorepo, two deployable apps over shared libs. Chosen over a single app because
the hot and cold paths have opposite change rates — ingest should sit untouched for weeks
while content logic changes daily, and a shared deploy unit would restart the poller
mid-session to ship a caption tweak.

```
redbox/
  apps/
    ingest/     hot path  — session, poller, cursor, normalize, alert
    studio/     cold path — pdf, gates, scorer, render, approval, publish
  libs/
    filings/    SourceAdapter interface, Filing schema, repository
    notify/     shared Telegram client
```

`libs/filings` is the eventual product surface. `SourceAdapter` exposes one method,
`fetchSince(cursor): RawFiling[]`. `NseAdapter` implements it today; `VendorAdapter`
replaces it when a redistribution licence is acquired, with no changes above the adapter.

Shared MongoDB. Redis + Bull for the cold-path queues. This matches the house stack
(`cat-trader`, `swiggy-options`).

## Ingest: the no-loss guarantee

Two tiers over the same adapter.

| Tier | Endpoint | Cadence | Payload |
|---|---|---|---|
| Hot | `?index=equities` | 2s in 07:00–23:00 IST, 30s outside | ~14KB |
| Drain | `?from_date=today&to_date=today` | on rollover, plus every 5 min | 15KB → ~700KB as day builds |

Loop:

1. Hot poll returns the 20 newest. Ingest everything with `seq_id > cursor`.
2. **Rollover check** — if the *oldest* `seq_id` on the page is still `> cursor`, the page
   turned over between polls and a hole exists.
3. On rollover, immediately drain today's full range and set-difference against stored
   `seq_id`s.
4. Scheduled drain every 5 minutes regardless. Final drain at 23:30 closes the day.

Because the drain endpoint is date-addressable and uncapped, any hole is recoverable by
re-pulling the day and diffing. There is no state in which a filing is silently lost.

The 2s hot poll only loses data if more than 20 filings land within 2s — plausible at the
17:00:00 results spike, and precisely what rollover detection catches.

Adaptive tightening: if a poll returns ≥8 new records, re-poll immediately rather than
waiting out the interval.

## Failure modes

Ranked by cost. All the dangerous ones are silent.

**Cold-start alert storm.** First run or restart-after-downtime drains ~1,000 filings that
all look new. Mitigation: alert only when `exchdisstime` is within 10 minutes of now;
older records are stored silently. This is the most likely bug in the build.

**Going blind undetected.** Akamai begins challenging, poller 403s, quiet market assumed.
Mitigation: `SessionService` re-bootstraps the cookie jar with exponential backoff; a
circuit breaker emits a Telegram `ingest degraded` alert after 3 consecutive failed polls
(~6s of blindness at hot cadence). A dead poller must be louder than a live one.

**Duplicate alerts on restart.** Cursor persists in Mongo, never memory. Unique index on
`seq_id`; alerts fire on insert only, never on upsert-update.

**Double-posting to Instagram.** Telegram callback tapped twice, or retry after an
ambiguous API response. Approval state flips `pending → approved` atomically via
`findOneAndUpdate` keyed by approval id, *before* the publish call.

**Degradation direction.** Every failure resolves toward a human, never toward silence:

- PDF fetch fails → content path falls back to `attchmntText`, flags `pdfUnavailable`.
  The alert already went out and is unaffected.
- LLM fails or times out → route to the teardown lane for manual review, never discard.

## Consumers

### Alert lane (hot, <2s)

Fires on `desc` category plus watchlist match, using `attchmntText` alone. **Never waits
on the PDF** — a 3s download does not belong in a 2s budget. Format follows wire
convention: one atomic fact per line, source-faithful, no interpretation.

### Content lanes (cold)

Two lanes, because staleness kills newsjacking but is irrelevant to teardowns:

| Lane | Latency | Human review |
|---|---|---|
| Newsjack | minutes | one-tap approve |
| Teardown | days | full review |

Rendering reuses the existing `decoded.paisa` brand system rather than rebuilding it.

## Gate 1 — Materiality

Cheapest checks first:

1. **Hard discard** on routine `desc` values (demat status, newspaper publication,
   trading window closure). Removes most of the daily volume immediately.
2. **Category allowlist** with per-category rules.
3. **Size-relative threshold** — order value ÷ market cap, banded by cap tier. A ₹78cr
   order is noise for a largecap and a re-rating for a smallcap.
4. **Recency** — lane-dependent window.

Fails closed.

## Gate 2 — Postability

Material and postable are different properties. A Reg 32 deviation statement can move a
stock and be unusable as content; an immaterial related-party transaction can be a strong
carousel.

**Stage A — Legal blocklist. Hard block, not LLM-overridable.**

Litigation, arbitration, court orders · SEBI/RBI/ED enforcement and show-cause notices ·
IBC/NCLT/insolvency · auditor qualification or resignation · whistleblower complaints ·
fraud, default, misstatement · anything naming an individual.

These are the defamation and SEBI-exposure categories. They route to manual-only or
discard; the LLM never gets a vote. Reuses the existing `filings-to-content` guardrails.

**Stage B — Content quality. Deterministic.**

- No extractable number → no hook → discard for newsjack.
- **Ambiguity keywords force manual review:** "letter of intent", "L1 bidder", "MoU",
  "in-principle". This kills the exact class of error seen in competitor headlines
  ("received order" when the company was merely L1).
- **Recognizability tier**, distinct from market cap. An unknown smallcap can carry a
  teardown on teaching value but cannot newsjack.

**Stage C — LLM editorial score.** Survivors only. Returns hook, fundamental-to-teach and
lane, and must cite the source line for every number used.

**Stage D — Numeric verification. The core correctness mechanism.**

Every number in the drafted post must appear verbatim in the source PDF or
`attchmntText`. Deterministic post-generation check. A figure absent from the source is a
**hard block, not a warning**. This is stronger than human review — a transposed digit
will not be caught on a phone at 17:05, but a string match catches it every time.

**Stage E — one-tap Telegram approval.** Rendered post plus source PDF link, with
Approve/Reject. A human sees every public claim before it is published.

### Expected yield

~1,000 filings/day → materiality → ~10 → legal blocklist → ~7 → quality gate → ~4 →
LLM + verification → **1–2 postable/day.**

If measured yield falls below ~1/day the newsjack lane cannot sustain a cadence and only
the teardown lane justifies itself. **This is measurable before any scorer is built** by
replaying the deterministic stages over the 31-day corpus.

## Testing

- **Rollover logic** — table-driven tests over synthetic `seq_id` sequences. Highest-value
  test in the system; it guards the no-loss guarantee.
- **Adapter** — recorded NSE fixtures. Never live NSE in CI.
- **Gate tuning** — replay job over the 31-day corpus (17,254 filings, 5.7s to fetch)
  against a hand-labelled subset, measuring precision/recall offline before shipping.
- **Cold-start** — explicit test that a drain of 1,000 historical filings produces zero
  alerts.

Target 80% coverage per project standards.

## Legal

Direct polling for personal use is a grey area. **Commercial redistribution of NSE/BSE
data requires a licence** — both exchanges restrict it, and an API business built on a
scraper is untenable. The `SourceAdapter` interface exists specifically so the commercial
path is a licensed-vendor swap rather than a rewrite.

Content output carries no recommendations, keeping it clear of SEBI research-analyst
registration requirements.

## Open questions

1. **Securities master.** The materiality gate needs market cap and float joined on ISIN;
   the NSE feed provides neither. Options: derive from NSE bhavcopy plus shares
   outstanding, or buy reference data. Unresolved — must be settled before Gate 1 is
   implementable.
2. **BSE adapter.** Endpoint behaviour unknown (see above). Needs a spike. NSE-only is
   acceptable for v1.
3. **Recognizability tiering.** Needs a concrete data source — index membership is the
   likely proxy.

## Phasing

1. **Measure first.** Replay deterministic gates over the 31-day corpus; establish real
   yield. De-risks the entire content leg before the scorer exists.
2. **Ingest core.** `libs/filings` + `apps/ingest`, hot/drain loop, rollover, cold-start
   protection, degraded alerting.
3. **Alert lane.** Telegram, watchlist, wire formatting.
4. **Content lanes.** PDF extraction, gates, scorer, verification, approval, publish.
5. **API surface.** Only after a licence path is settled.

### Scope of the first implementation plan

Phases 1–3 only. That is a coherent, independently valuable deliverable: a corpus-backed
yield measurement plus a trustworthy alert feed, which is the trading-edge half of the
brief and the foundation the other two consumers sit on.

Phase 4 (content lanes) gets its own spec once phase 1 has produced real yield numbers —
those numbers determine whether the newsjack lane is worth building at all, so specifying
it now would be speculative. Phase 5 is blocked on the licensing question.
