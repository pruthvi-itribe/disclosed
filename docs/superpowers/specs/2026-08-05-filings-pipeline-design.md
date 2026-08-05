# Redbox — NSE/BSE Filings Pipeline

**Date:** 2026-08-05
**Status:** Design approved. Phases 1–3 implemented; corrected 2026-08-05 against the
recorded 32-day corpus after the whole-branch review (see **Corrections** below).

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

- `seq_id` — unique, and **global across all NSE announcement streams**, so the equities
  feed is a filtered view: gaps are normal and do NOT imply loss.

  **NOT monotonic and NOT totally ordered by dissemination time. CORRECTED
  2026-08-05.** The original claim here — "monotonic, unique, totally ordered …
  valid as a cursor" — was assumed, not measured, and the recorded corpus refutes it.
  Walking `data/corpus/05-07-2026_05-08-2026.jsonl` in `exchdisstime` order, **414 of
  17,442 filings (2.37%, ~12.9/day) on 23 of 32 IST days arrive with a `seq_id` BELOW
  the stream's running maximum**, and 355 of those carry a real `exchdisstime` rather
  than the `an_dt` fallback. Two shapes:

  | Shape | Evidence from the corpus |
  |---|---|
  | Adjacent-id reversal | `106689007` (RCOM) at 2026-07-07T10:03:43Z, then `106689006` (APTECHT) at 10:03:45Z — two seconds later, one id lower. |
  | Block excursion | At 2026-07-06T05:35:48Z the stream is at `106687146` (BODALCHEM); 117s later `106603022` (CONSOFINVT) arrives — **84,124 ids below** — followed by a descending run (`106603016`, `106603008`, `106602971`, …). |

  Concentrated in back-filled disclosure categories: SEBI Takeover Regulations (264),
  Spurt in Volume (50), Reply to Clarification (21), News Verification (20), Price
  movement (20).

  **`seq_id` is therefore invalid as a newness filter and invalid as a completeness
  proof.** It remains useful for exactly one thing: as a high-water mark for the
  rollover test, where "has the page moved past what we last overlapped" is the
  question. Newness is decided by the database — a unique index on `seq_id` plus an
  insert-only write — and never by comparison against a cursor.
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

1. Hot poll returns the 20 newest. Offer **the whole page** to the insert-only write and
   let the unique index on `seq_id` reject what is already held. Do NOT filter on
   `seq_id > cursor` — see the `seq_id` correction above; that filter silently discards
   2.37% of the feed.
2. **Rollover check** — if the *oldest* `seq_id` on the page is still `> cursor`, the page
   turned over between polls and a hole exists.
3. On rollover, immediately drain the full range and set-difference against stored
   `seq_id`s. The range runs from the IST day of the newest record already stored through
   today, bounded to 7 days — **a drain of today alone cannot close a hole that spans IST
   midnight**, because the IST day rolls at 18:30 UTC and a restart across that boundary
   would never re-fetch yesterday beyond the newest 20.
4. Scheduled drain every 5 minutes regardless. Final drain at 23:30 IST closes the day.
   The cursor never moves backwards, so an out-of-order excursion cannot manufacture a
   permanent rollover.

Because the drain endpoint is date-addressable and uncapped, any hole is recoverable by
re-pulling the day and diffing. There is no state in which a filing is silently lost.

**Step 4 is not optional, and the corpus is why.** No 2-second window in the recorded
month holds more than 6 filings, no 30-second window more than 9, and no 60-second window
more than 12 — against a 20-record page. So rollover CANNOT fire at either poll cadence:
replaying all 32 days through the implemented poller triggers it once, at cold start. Left
to rollover alone, reconciliation runs about once per process lifetime, and every
out-of-order filing goes from "recovered late" to "lost". With the scheduled drains the
same replay performs 9,059 periodic and 31 closing drains and stores 17,441 of 17,442.

(The earlier claim that "the 2s hot poll only loses data if more than 20 filings land
within 2s" was the reasoning that made step 4 look optional. It is true and it is not the
binding constraint: out-of-order dissemination loses filings at any rate.)

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

**Out-of-order dissemination.** 2.37% of filings arrive with a `seq_id` below the stream
position (see above). A cursor used as a newness filter drops them with no log, no counter
and no alert, and the rollover check cannot see it because the page's oldest id is below
the cursor. Mitigation: the database decides newness; the cursor is a rollover marker only.

**Partially unmappable pages.** A page where every record is rejected is loud — nothing is
ingested. A page where nineteen of twenty map is indistinguishable from a healthy poll:
the fetch succeeded, filings arrived, the breaker is clean, the cursor moved. Mitigation:
the skip count is alarmed in its own right, and the scheduled drain re-offers the day so a
mapper fix recovers the records without a backfill.

**The default watchlist is a firehose.** `WATCHLIST=` means alert on everything, and 71.2%
of the corpus (12,415 of 17,442) clears the routine-category gate — ~388 Telegram messages
a day, peak 106 in one hour. The operator mutes the channel within a day and every alert
above dies with it. Mitigation: the semantics are unchanged, but the measured volume is
stated at startup, in `.env.example` and in the README. Telegram's ~1 msg/s per-chat limit
also means an unpaced sender loses messages to 429s outright, so sends are queued, paced
and the drops counted.

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
- **Out-of-order dissemination** — replay the REAL reversed sequences from the corpus
  (both the adjacent-id case and the 84,124-id block excursion, with their recorded page
  compositions) through the poller and assert the previously-dropped filings are stored.
  Synthetic sequences cannot produce this shape, because nobody thought to write it.
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

## Corrections

Recorded here rather than edited away, because the failure mode is more useful than the
final text: every one of these was a premise stated confidently in this document, inherited
without question by the implementation plan, and implemented correctly against a brief that
was wrong. Mutation testing cannot detect a mechanism that was never built.

| Claim as written | What the corpus showed | Where it now stands |
|---|---|---|
| `seq_id` is "monotonic, unique, totally ordered … valid as a cursor" | 414 of 17,442 filings (2.37%, 23 of 32 days) disseminate BELOW the stream position | Corrected under *Verified source behaviour*; the database decides newness |
| The rollover drain covers the loss cases | No window shorter than a minute can roll a 20-record page; rollover fired once in 32 days | The spec's own step 4 (periodic + 23:30 drains) is now mandatory, not incidental |
| A day drain closes any hole | The IST day rolls at 18:30 UTC, so a restart across midnight never re-fetches yesterday | The drain spans from the last day with evidence through today, bounded to 7 |

The measurement that refutes all three was available from the moment the Phase 1 corpus
existed. It was not run against the ingest design, only against the content funnel.

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
