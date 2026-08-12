# Filings-processing audit — where the pipeline loses documents

**Measured 2026-08-11, 03:36–04:10 UTC**, read-only, against the live `turret`
database at `mongodb://127.0.0.1:27117`. Nothing was written, no index was
created, no model was called, no document was re-fetched from an exchange.

Corpus under measurement: **5,062 NSE filings**, disseminated
`2026-08-04T18:33:50Z` → `2026-08-11T03:22:12Z` (6.36 days), plus **2,104 BSE
announcements** which are stored and never processed at all (§8).

Every number below comes from a query in the appendix. Where a number could not
be measured because the collection does not record it, that is said rather than
estimated.

**The collection is live while being measured** — the ingest poller and the
enrichment worker were both running throughout, deliberately untouched. Totals
taken 30 minutes apart therefore differ by 1-3 documents (`enriched` reads 4,680
in the state tally and 4,683 in a later coverage query). Percentages below name
the denominator they used.

---

## 0. What the collection cannot answer

The brief asked for a page-count distribution and an attachment-size
distribution split by file type. **Neither is recordable from the live
collection.**

| Field | Stored on an NSE filing? | Consequence |
| --- | --- | --- |
| PDF page count | No | `pdf-parse` returns `numpages` (`pdf-text.ts:135`) and it is used only to pick a route. It is never persisted. |
| Attachment bytes | No | `AttachmentOk.bytes` exists (`attachment.fetcher.ts:82`) and is discarded. Only an `oversized` refusal records a size, and there is exactly 1. |
| File type | Partially | Inferable only from `documentSource` (ZIP, 45 filings) and `parseRoute`. There is no content-type field. |
| Document text | No | A `span-not-found` discard cannot be re-adjudicated without re-fetching from NSE. |
| Read was truncated at `MAX_PDF_PAGES` | **No — and it is computed** | `PdfTextOk.truncated` (`pdf-text.ts:56-63`) documents itself as "Reported rather than silent"; `grep -rn truncated apps libs` shows **no consumer in the worker and no schema field**. A 640-page annual report read to page 400 is stored identically to a complete read. |

So the size axis below is **`enrichment.documentChars`** — extracted characters,
which is what the extraction gates actually operate on. BSE rows do carry
`attachmentBytes`, and that distribution is in §8.

---

## 1. Corpus shape

| Metric | Value |
| --- | --- |
| Filings stored | 5,062 |
| Distinct NSE categories | 87 |
| `documentChars` p50 | 8,224 |
| `documentChars` p90 | 56,664 |
| `documentChars` p99 | 438,425 |
| `documentChars` max | 1,578,444 (RBLBANK, `Shareholders meeting`) |
| `documentChars` mean | 31,123 |
| Total extracted characters | 145,656,593 |

Size distribution, with claim yield per bucket (enriched filings only, n=4,680):

| `documentChars` | Filings | Chars held | Proposed | Verified | Verified rate | Filings with ≥1 claim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| < 1,500 (below the claim gate) | 434 | 0.55 M | 0 | 0 | — | 0 (0.0%) |
| 1,500 – 5,000 | 1,435 | 3.87 M | 920 | 731 | **79.5%** | 296 (20.6%) |
| 5,000 – 10,000 | 632 | 4.47 M | 1,623 | 1,268 | 78.1% | 317 (50.2%) |
| 10,000 – 24,000 | 707 | 11.82 M | 2,302 | 1,444 | 62.7% | 373 (52.8%) |
| 24,000 – 50,000 | 866 | 30.28 M | 3,663 | 2,202 | 60.1% | 505 (58.3%) |
| 50,000 – 96,000 | 458 | 29.91 M | 1,591 | 804 | 50.5% | 246 (53.7%) |
| **96,000 – 200,000** | 81 | 10.52 M | 271 | 127 | **46.9%** | 43 (53.1%) |
| 200,000 – 1,000,000 | 41 | 21.14 M | 172 | 98 | 57.0% | 25 (61.0%) |
| > 1,000,000 | 26 | 33.09 M | 110 | 86 | 78.2% | 18 (69.2%) |

**Verification yield falls monotonically with document size from 79.5% to 46.9%
across the range where documents are read whole**, then rises again in the two
largest buckets — which are AGM notices whose few claims are boilerplate
resolutions the model quotes correctly.

Claims per filing (enriched, n=4,680): 0 → 2,857; 1 → 467; 2 → 343; 3 → 455;
4-9 → 382; 10-12 → 176. The spike at exactly 3 (455 filings) and the tail at
exactly 12 (45 filings) are the two prompt bounds showing through.

---

## 2. Outcome per stage

| Stage | Count | % of stored |
| --- | ---: | ---: |
| Stored by the poller | 5,062 | 100% |
| Enrichment attempted at least once | 4,763 | 94.1% |
| **Never attempted** (no `enrichment` block) | **299** | **5.9%** |
| Text extracted (`state: enriched`) | 4,680 | 92.5% |
| Terminal, no document (`unparseable`) | 67 | 1.3% |
| Awaiting retry (`pending`) | 16 | 0.3% |
| `failed` (attempt budget spent) | 0 | 0% |

### Terminal no-document verdicts (n=67)

| `unparseableReason` | n | Class |
| --- | ---: | --- |
| `truncated-at-origin` | 27 | Source — NSE serves short bytes |
| `no-text-layer` | 26 | Source **+ pipeline** (see §4) |
| `no-attachment` | 12 | Source — no URL or `"-"` |
| `oversized` | 1 | Pipeline bound (64 MiB) |
| `not-a-pdf` | 1 | Source |

### Claim lane, per filing (n=5,062)

| `claimRefusalReason` | n | Reading |
| --- | ---: | --- |
| `null` (claims stored) | 2,205 | 1,823 real, 382 filings with no enrichment block |
| `no-claims` | 1,745 | Model was called and found nothing — a real answer |
| `not-eligible` | 567 | Never sent to a model — **deliberate**, see §6 |
| `all-discarded` | 441 | Model proposed, the gate refused every one |
| `extractor-error` | 104 | **Lost to the provider**, see §5 |

`coverageSkip` (why nothing was looked for): `covering-letter` 434,
`shared-page` 73, `legal-exposure` 60.

**"Nothing found" and "nothing looked for" are correctly separable in the claim
lane** — `claimRefusalReason` + `coverageSkip` distinguish all four states the
worker's header promises. They are **not** separable for the parser (§4).

### The verbatim gate

| | Count |
| --- | ---: |
| Claims proposed | 10,652 |
| Claims stored | 6,763 (63.5%) |
| Claims discarded | 3,892 (36.5%) |

| Discard reason | n | Class |
| --- | ---: | --- |
| `span-not-found` | 1,378 | Mixed — invention **and** a bound (§7) |
| `number-not-in-span` | 1,017 | Gate working as designed |
| `period-not-in-context` | 833 | Gate working as designed |
| `too-long` | 208 | Pipeline — claim over `MAX_CLAIM_CHARS` 120 |
| `direction-not-in-span` | 169 | Gate working as designed |
| `names-an-individual` | 92 | **Deliberate refusal** |
| `conditional-language` | 78 | **Deliberate refusal** |
| `legally-blocked` | 48 | **Deliberate refusal** |
| `span-too-short` | 33 | Pipeline — under `MIN_SPAN_CHARS` 12 |
| `advisory-language` | 31 | **Deliberate refusal** |
| `over-limit`, `empty-claim` | 5 | — |

### What a reader actually gets

| | Count | % of enriched (4,683) |
| --- | ---: | ---: |
| Carries a verified **amount** | 69 | 1.5% |
| Carries ≥1 verified **claim** | 1,823 | 38.9% |
| Carries a verified **results table** | 22 | 0.5% |
| **Carries any of the three** | **1,845** | **39.4%** |
| Carries an `outcome` (the coverage floor) | 4,683 | 100% |

`amountRefusalReason` is `no-candidate` on 4,473 filings — the amount extractor
finds nothing to consider in 95.5% of documents.

---

## 3. LOSS #1 — the enrichment worker cannot keep up (100% of filings delayed, 5.9% not read at all)

Ingest is healthy. Enrichment is 7 to 30 hours behind.

| Leg | p50 | p90 | p99 |
| --- | ---: | ---: | ---: |
| `disseminatedAt` → `ingestedAt` (poller) | **29.7 s** | 54.0 s | 144 s (day max) |
| `ingestedAt` → `enrichment.attemptedAt` | **25,962 s (7.2 h)** | 105,896 s (29.4 h) | 109,507 s (30.4 h) |
| `disseminatedAt` → `attemptedAt` | 25,985 s (7.2 h) | 129,413 s (35.9 h) | 151,732 s (42.1 h) |

Poller lag per day is flat at p50 23-30 s on every day except 2026-08-05, which
is the initial history backfill.

**These enrichment figures are lower bounds.** `attemptedAt` is the *tick's*
start time, not the document's: `tick(now = new Date())` (`enrichment.worker.ts:290`)
passes one `now` through `drain()` into every `claimNext` and every
`recordEnrichment` in a batch of 20. Three filings enriched 90 minutes apart
share the timestamp `2026-08-07T18:42:07.030Z`.

Throughput, measured hourly from `attemptedAt` after arrivals stopped:

| UTC hour (2026-08-10/11) | Arrived | Enrichment attempts |
| --- | ---: | ---: |
| 08-10 07 | 74 | 73 |
| 08-10 08 | 79 | 38 |
| 08-10 11 | 114 | 40 |
| 08-10 13 | **169** | 36 |
| 08-10 17 (arrivals over) | 8 | 40 |
| 08-10 19 | 3 | 20 |
| 08-10 21 | 0 | 40 |
| 08-10 23 | 0 | 40 |
| 08-11 01 | 2 | 20 |

**The attempt counts are quantised at exactly 20 and 40 — the batch size
(`ENRICH_BATCH_SIZE = 20`, `configuration.ts:208`).** One batch of 20 documents
takes 30 to 60 minutes, i.e. **90–180 seconds per document**, sustained
overnight with an empty arrival queue and no backpressure from anything but the
work itself.

Day totals for 2026-08-10: **1,042 filings arrived, 612 enrichment attempts** —
the worker lost 430 documents of ground in one day and recovered ~356 of them
overnight.

Residue at measurement time:

- **299 filings (5.9%) have no enrichment block at all.** Their dissemination
  window is `2026-08-10T07:21:47Z` → `2026-08-10T12:44:00Z`, i.e. 14.9 to 20.2
  hours old and untouched.
- Claimable queue depth: **315**, at 09:06 IST, just as the next trading day's
  filings begin.

`claimNext` sorts `disseminatedAt: -1` (`enrichment.repository.ts:201`), which
is argued and correct — but it means a saturated worker starves the *back* of
the queue permanently rather than degrading uniformly. The 299 are the oldest
unread, and on a heavy day they will never be read.

**Where the 90–180 seconds goes.** Not the politeness delay
(`ENRICH_REQUEST_DELAY_MS = 800`, 0.8 s) and not the parse (`pdf-parse` is 0.19 s
on a typical filing per `parse-route.ts:18`). It is the model calls:
`CLAIM_TIMEOUT_MS = 180_000` with `CLAIM_MAX_TOKENS = 32_000`
(`claim-provider.ts:118,135`), and up to two sequential calls per document. The
comment at `claim-provider.ts:128-134` already states the cost: "a results call
was already measured at 60 to 120 seconds".

**4,113 of 4,680 enriched filings (87.9%) reach a model.** That includes 619
`Copy of Newspaper Publication` (42 yield a claim, 6.8%) and 1,022
`Analysts/Con. Call Updates` intimations (171 yield a claim, 16.7%) — 1,641
documents, 35.1% of everything enriched, returning 213 claim-bearing filings
between them.

*Class: fixable in the pipeline.*

---

## 4. LOSS #2 — Docling has been unreachable since 2026-08-08 and the database cannot say so

`parseRoute` by IST day:

| Day | `pdf-parse` | `docling-layout` | `docling-ocr` |
| --- | ---: | ---: | ---: |
| 2026-08-05 | 801 | 191 | 13 |
| 2026-08-06 | 888 | 240 | 8 |
| 2026-08-07 | 1,121 | 139 | 8 |
| **2026-08-08** | **469** | **0** | **0** |
| 2026-08-09 | 79 | 0 | 0 |
| 2026-08-10 | 709 | 0 | 0 |
| 2026-08-11 | 14 | 0 | 0 |

Last Docling read: `attemptedAt 2026-08-07T18:42:07Z`. `DOCLING_URL` is absent
from `.env`, so `doclingUrl` falls back to `''` (`configuration.ts:562`) and
`docling.factory.ts` builds no converter.

**The collection cannot distinguish "pdf-parse was the right answer" from
"pdf-parse was the only reader left".** `parseFallbackReason` is `null` on
5,061 of 5,062 filings — the single non-null is one 300 s timeout on 2026-08-07.
The reason exists: `routeAfterFirstRead` returns
`'no Docling service is available, so the cheap parser is the only reader'`
(`parse-route.ts:311-316`), `readWithRouting` carries it as `routeReason`
(`routed-text.ts:96-102`) — and the worker writes `parseRoute` and
`parseFallbackReason` only (`enrichment.worker.ts:638-639`). `routeReason` has
no schema field (`filing.schema.ts:163-164`).

This is precisely the failure `routed-text.ts:40-49` says must never happen:
*"This is the field an operator reads to discover that the optional Python
service has been down since Tuesday and every results filing since has been read
by the parser that gets the standalone statement wrong."* The field is there;
the wire to it is not.

Measured cost of the outage so far:

| | Aug 5–7 (Docling up) | Aug 8–11 (Docling down) |
| --- | ---: | ---: |
| Scanned documents rescued by OCR | 29 | 0 |
| `no-text-layer` terminal verdicts | 10 | **16** |
| Results tables stored | 18 | 4 |
| Results tables per eligible filing | 18/362 = 5.0% | 4/162 = 2.5% |

Results-table success by route, over the whole window:

| Route | Results-eligible | Table stored | Rate |
| --- | ---: | ---: | ---: |
| `docling-layout` | 306 | 18 | **5.9%** |
| `pdf-parse` | 215 | 5 | **2.3%** |
| `docling-ocr` | 3 | 0 | 0% |

*Class: (a) fixable in the pipeline — one env var to restore the service, one
schema field to make its absence visible.*

---

## 5. LOSS #3 — the results lane publishes 4.2% of what it reads

Of 4,680 enriched filings, **525** carried a statutory results statement
(everything except the 4,156 `not-eligible`). What came out:

| | Count | % of 525 |
| --- | ---: | ---: |
| Results table stored | **22** | **4.2%** |
| Figures stored | 58 | — |
| Figures proposed by the model | **1,244** | — |
| Filings with ≥1 claim instead | 356 | 67.8% |
| **Filings producing nothing at all** | **159** | **30.3%** |

Refusal breakdown (n=525, plus 4,156 `not-eligible`):

| `resultsRefusalReason` | n | On `docling-layout` | On `pdf-parse` |
| --- | ---: | ---: | ---: |
| `extractor-error` | 107 | 77 | 30 |
| `period-not-derivable` | 97 | 53 | 42 |
| `basis-not-determinable` | 96 | 42 | 53 |
| `no-results` (a real answer) | 88 | 56 | 32 |
| `unit-not-determinable` | 70 | **53** | 17 |
| `columns-not-found` | 27 | 4 | 23 |
| `all-discarded` | 16 | 3 | 13 |

Per-figure discards (n=86): `label-mismatch` 33, `columns-not-aligned` 25,
`row-not-found` 9, `malformed-grouping` 7, `row-outside-table` 6,
`value-not-in-row` 3, `unit-not-in-row` 3.

### The named defect: `SCALE_REACH` is route-blind and carries no measurement

```
libs/filings/src/logic/results-unit.ts:78
  /** How far above a column header a scale declaration may sit. */
  export const SCALE_REACH = 400;
```

That is the whole comment. Compare its sibling one file away:

- `BASIS_HEADING_REACH = 400` (`results-basis.ts:87`) — 20 lines of measured
  bimodal distribution over 16 live filings.
- `DOCLING_BASIS_HEADING_REACH = 2_400` (`results-basis.ts:132`) — 40 lines
  recording that **"At 400 exactly three of those 77 are reachable"** in Docling
  markdown, and that reusing the `pdf-parse` number "would make results coverage
  WORSE while looking like an upgrade".
- `basisReachFor(route)` (`parse-route.ts:302`) selects between them by route.

`governingScale` takes `reach: number = SCALE_REACH` (`results-unit.ts:121`) and
**no caller passes anything else** — `results-verify.ts:427` threads
`basisReach` through for the basis and lets the scale default. The identical
markdown-padding problem therefore still bites the unit check, and the data
shows it: **53 of the 70 `unit-not-determinable` refusals are on
`docling-layout`**, and every one of them reads
`no currency scale is declared in the 400 characters above the table's column header`.

Two examples, both real Q1 statements with the numbers present:

- ASPINWALL (seqId 106726670), 50,932 chars, `docling-layout`: 4 figures
  proposed, refused `unit-not-determinable`; claim lane proposed 0. **The
  document's own stored summary says "reporting a net loss of Rs 134 lakhs on
  standalone".** Nothing published.
- CANDC (seqId 106731630), 76,977 chars, `docling-layout`: results extractor
  returned no text; claim lane proposed 0. Nothing published.

### Second defect: a category allowlist survived here

`RESULTS_BEARING_CATEGORIES` (`results-eligibility.ts:122`) is five names —
`outcome of board meeting`, `integrated filing- financial`, `press release`,
`press release (revised)`, `investor presentation` — covering **1,127 of 5,062
filings (22.3%)** against the 87 distinct categories NSE used this week.

This is the exact shape CLAUDE.md forbids ("Never key a fail-closed gate on a
category name NSE controls") and that `claim-eligibility.ts:9-31` records as
having hidden every quarterly result for weeks. The claim lane was rewritten to
remove its allowlist; the results lane still has one, and the argument written
above it (`results-eligibility.ts:91-121`) justifies the *exclusions* without
addressing the *unknown-name* failure mode the claim lane's header names.

*Class: (a) fixable in the pipeline.*

---

## 6. LOSS #4 — model replies that never arrive

211 extractions returned nothing usable:

| Detail | Claim lane | Results lane |
| --- | ---: | ---: |
| `the reply was truncated at 32000 tokens` | 59 | 36 |
| `the reply was truncated at 16000 tokens` (historic ceiling) | 14 | 60 |
| `the model returned no text` | 26 | 11 |
| `Unexpected token … in JSON` | 4 | 0 |
| `OpenRouter responded 200: aborted` | 1 | 0 |
| **Total** | **104** | **107** |

Across all causes the claim lane loses **104 of 4,680 enriched filings (2.2%)**
and the results lane loses **107 of 525 results-eligible filings (20.4%)**. At
the *current* 32,000-token ceiling alone the loss is still 95 extractions — 59
claim lanes (1.3% of enriched) and 36 results lanes (6.9% of results-eligible) —
to a provider that will not stop reasoning.
`claim-provider.ts:104-117` already says raising the ceiling "removes a floor on
the failure rate; it does not remove the failures" — the data confirms it, and
the raise also bought the latency in §3.

The configured provider is `openrouter` / `deepseek/deepseek-v4-flash-0731`
(`.env:73-75`).

*Class: (a) fixable — a bounded-reasoning setting, a cheaper effort level, or a
retry-once-on-truncation, all of which also buy back throughput.*

---

## 7. LOSS #5 — 34.7% of the corpus's characters never reach any extractor

| | Value |
| --- | ---: |
| Total extracted characters | 145,656,593 |
| Characters sent to a model (capped at 96,000/filing) | 95,113,054 |
| **Characters sliced off** | **50,543,539 (34.7%)** |
| Filings where the cap binds | **148 (3.2% of enriched)** |
| Filings over the old 24,000 cap | 1,472 (31.5%) |

The cap is applied at `claim-prompt.ts:159` and `results-prompt.ts:168`; the
live value is `CLAIM_MAX_DOCUMENT_CHARS = 96_000` (`configuration.ts:258`),
wired to *both* lanes by `claim-extractor.factory.ts:67-70`.

Truncation can only cost a claim, never admit a false one — spans are verified
against the full text (`claim-verify.ts:330`). But the loss is real and it is
concentrated: the 148 truncated filings hold 64.7 M characters and the pipeline
reads 14.2 M of them.

### A stale constant

```
libs/filings/src/logic/claim-prompt.ts:37-50
 * Investor presentations reach 87,000 characters in the live collection, most
 * of it appendix tables. …
 * A cap is also a cost control: 24,000 characters is about 6,000 tokens …
export const MAX_DOCUMENT_CHARS = 24_000;
```

Measured today over the 227 `Investor Presentation` filings: **max 146,601
chars** (1.7× the cited 87,000), p50 23,997, p90 38,794, p99 69,355, and **113 of
227 (49.8%) exceed 24,000**. The constant is also dead in production — the
config default overrides it on every call — so the comment describes a bound
nothing enforces, using a number the corpus outgrew.

### A second bound inside `span-not-found`

`findVerbatimSpan` returns `null` — indistinguishable from "the document does
not contain this" — when the canonical needle exceeds `MAX_SPAN_CHARS = 400`
(`claim-span.ts:116`). **421 of the 1,378 `span-not-found` discards (30.6%) hit
the 200-character `MAX_DISCARD_DETAIL_CHARS` ceiling**, meaning the quoted span
was at least ~158 characters and is in the long half of the distribution. The
recorded reason for a claim refused for quoting *too much* is the same string as
for a claim that was invented — a "nothing found / nothing looked for" collapse
inside the gate itself.

`span-not-found` also concentrates in the middle size bands (52 under 5k, 390 at
5k-24k, 839 at 24k-96k, 97 over 96k) — i.e. on decks and statements, where the
model quotes table rows.

`docling-layout` verifies **839 of 1,819 proposals (46.1%)** against
`pdf-parse`'s **5,899 of 8,799 (67.0%)**. The routes are not comparable
document-for-document (Docling only ever sees results filings and scans), but
the direction is worth a measurement of its own: markdown pipes and cell padding
are exactly what a model must reproduce byte-for-byte to clear the gate.

*Class: (a) fixable — but the character cap is the smallest of the five levers.*

---

## 7b. Yield by document kind

Enriched filings only (n=4,680), top 15 categories by volume. "Skipped" =
`coverageSkip` set, i.e. no model was called.

| Category | n | Mean chars | Skipped | Proposed | Verified | Filings with ≥1 claim | Extractor errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Analysts/Institutional Investor Meet/Con. Call Updates | 1,022 | 9,732 | 250 | 1,334 | 971 | 171 (**16.7%**) | 13 |
| Copy of Newspaper Publication | 619 | 29,942 | 105 | 489 | 85 | 42 (**6.8%**) | 12 |
| Outcome of Board Meeting | 537 | 38,574 | 6 | 2,049 | 846 | 293 (54.6%) | 13 |
| General Updates | 416 | 26,447 | 54 | 895 | 627 | 180 (43.3%) | 10 |
| Shareholders meeting | 326 | **125,252** | 13 | 440 | 305 | 134 (41.1%) | 12 |
| Updates | 263 | 43,347 | 39 | 544 | 390 | 111 (42.2%) | 3 |
| Press Release | 257 | 11,338 | 1 | 1,414 | 1,177 | 235 (**91.4%**) | 6 |
| Investor Presentation | 227 | 25,402 | 2 | 1,539 | 1,158 | 204 (**89.9%**) | 11 |
| Appointment | 111 | 25,047 | 0 | 234 | 73 | 35 (31.5%) | 0 |
| Record Date | 98 | 76,220 | 7 | 179 | 116 | 62 (63.3%) | 0 |
| Change in Management | 75 | 29,447 | 0 | 144 | 53 | 21 (28.0%) | 1 |
| Monitoring Agency Report | 67 | 23,038 | 2 | 248 | 201 | 56 (83.6%) | 4 |
| Change in Director(s) | 53 | 25,520 | 1 | 50 | 18 | 14 (26.4%) | 1 |
| Resignation of Director/KMP/SMP | 39 | 8,331 | 9 | 28 | 11 | 3 (7.7%) | 0 |
| Trading Window | 17 | 1,885 | 3 | 0 | 0 | 0 (0.0%) | 0 |

**Near-zero-yield kinds, hand-checked through the stored (never-published)
`documentSummary`:**

| Kind | Yield | Verdict |
| --- | --- | --- |
| `Trading Window` (17) | 0% | **Genuine absence.** A closure notice states nothing but dates. |
| `Resignation of Director/KMP/SMP` (39), `Cessation` (25), `Appointment` (111) | 7.7% / 4.0% / 31.5% | **Deliberate refusal.** `names-an-individual` is the whole content of the document. |
| `Copy of Newspaper Publication` (619) | 6.8% | **Mostly genuine + deliberate.** Samples: physical-share re-lodgement windows (AUROPHARMA, MANGLMCEM), an annual-report corrigendum (MAMATA). 105 correctly refused as `shared-page`. But it is 619 model calls for 42 claim-bearing filings. |
| `Analysts/Con. Call Updates` (1,022) | 16.7% | **Genuine.** Median 9,732 chars and 250 already skipped as covering letters — the rest are "a recording exists" intimations. 1,022 model calls for 171 results. |
| `Shareholders meeting` (326) | 41.1% but only 0.94 claims/filing at a 125,252-char mean | **Genuine + capped.** Samples are AGM notices and scrutinizer voting reports. Five of the six sampled zero-claim filings proposed 0 or 1 claim. This is the kind that eats the 96,000-char cap for no return. |
| **`Outcome of Board Meeting` zero-claim tail** | 244 of 537 (45.4%) | **Pipeline limit.** Two of six sampled are results filings whose own summary states the numbers — ASPINWALL "net loss of Rs 134 lakhs", CANDC "unaudited standalone and consolidated financial results" — and both failed §5. |

No zero-yield class was traced to a glyph/font problem or to an unread table
*that the pipeline had text for*: `hasCorruptTextLayer` + `docling-ocr` handled
29 of those while the service was up, and the class that is now unhandled is the
16 `no-text-layer` filings in §4.

---

## 8. LOSS #6 — BSE is collected and never processed

| | Value |
| --- | ---: |
| `bse_announcements` stored | 2,104 |
| Window | 2026-08-05T18:30Z → **2026-08-07T04:25Z** (collection stopped 4 days ago) |
| Total attachment bytes | 612,085,780 (612 MB) |
| `attachmentBytes` p50 / p90 / p99 / max | 856 KB / 6.30 MB / 15.85 MB / 29.30 MB |
| Enrichment block on any of them | **0** |

`bse.schema.ts` has no enrichment sub-document. `cross-exchange-match.ts` — 255
lines with a measured ISIN-prefix rule and a measured 90-minute dissemination
window — has exactly one caller, `tools/bse/measure-overlap.ts`. Nothing in
`apps/` reads it.

So: **612 MB of documents that the pipeline has the URL for, has decided how to
de-duplicate against NSE, and does not read.** This is the only place in the
audit where the loss is 100% of a source.

*Class: (a) fixable — but it is unbuilt work, not a defect.*

---

## 9. Deliberate refusals — working as designed, NOT losses

These are counted here so they are never mistaken for the losses above.

| Refusal | n | % of enriched | Where |
| --- | ---: | ---: | --- |
| `covering-letter` (< 1,500 chars) | 434 | 9.3% | `claim-eligibility.ts:109` |
| `shared-page` (≥4 company identities) | 73 | 1.6% | `shared-page.ts`, `claim-eligibility.ts:175` |
| `legal-exposure` | 60 | 1.3% | `legal-block.ts` |
| Claim discard `names-an-individual` | 92 | — | `claim-verify.ts:161` |
| Claim discard `conditional-language` | 78 | — | `claim-verify.ts:186` |
| Claim discard `legally-blocked` | 48 | — | `claim-verify.ts:170` |
| Claim discard `advisory-language` | 31 | — | `claim-verify.ts:154` |
| Summary refused `advisory-language` / `legally-blocked` | 71 | — | `claim-summary.ts` |
| `Copy of Newspaper Publication` excluded from results | 661 filings | — | `results-eligibility.ts:117-120` |

The verbatim gate's `number-not-in-span` (1,017) and `period-not-in-context`
(833) are also working as designed: they are the checks that stop a model
supplying a figure or a quarter the document did not print.

**Losses inherent to the source**, also not pipeline defects:
`truncated-at-origin` 27, `no-attachment` 12, `not-a-pdf` 1 — 40 filings (0.8%).
`no-text-layer` (26) is *partly* source and partly §4: 16 of them were recorded
while the OCR route was unavailable.

---

## 10. Retry and backlog health

Nothing is poisoned and nothing retries forever.

| | Value |
| --- | ---: |
| `state: failed` (budget spent) | **0** |
| `attempts` distribution | 1 → 2,485; 2 → 1,507; 3 → 578; 4 → 150; 5 → 35; 6 → 9; 7 → 1; 8 → 1 |
| `parseAttempts` > 0 | 1 → 101; 2 → 4; 3 → 7 |
| `pending` filings | 16 (13 at `attempts` 1, 3 at 2) |
| `pending` reasons | 12 × `Request failed with status code 404`, 2 × `truncated-at-origin: Invalid PDF structure`, 2 × no error yet |

The 404s are the documented archive-upload race (`enrichment-policy.ts:42-57`)
and are retried correctly.

### Latent: the lease is stamped from a stale clock

`claimNext(now, leaseMs)` sets `nextAttemptAt = now + 600,000 ms`
(`enrichment.repository.ts:196`) where `now` is the **tick's** start
(`enrichment.worker.ts:290, 323`). A batch of 20 documents at the measured
90-180 s each runs 30-60 minutes. **Every document claimed after roughly
position 6 in a batch receives a lease that has already expired at the moment it
is claimed.**

Harmless today — one worker, and the `ticking` guard prevents overlap. It stops
being harmless the moment `ENRICH_IN_PROCESS=false` puts a second process
alongside, or an operator runs `enrich:backfill` while the service is up: two
workers would both hold the same document and both `$set` the whole enrichment
block. The 11 filings at `attempts` ≥ 6 and the 1,507 at `attempts` = 2 are
consistent with re-claims already happening under load.

---

## 11. Telemetry defects that hide the above

| Defect | Measured | Where |
| --- | --- | --- |
| `routeReason` never persisted — "pdf-parse was right" and "pdf-parse was all there was" are one record | 5,061 / 5,062 filings carry `parseFallbackReason: null` | `enrichment.worker.ts:638-639`, `filing.schema.ts:163-164` |
| `PdfTextOk.truncated` computed, documented as "reported rather than silent", never read | 0 consumers | `pdf-text.ts:56-63` |
| `attemptedAt` is the tick's clock, not the document's | 3 filings share `2026-08-07T18:42:07.030Z` | `enrichment.worker.ts:290` |
| Page count and attachment bytes discarded | see §0 | `pdf-text.ts:135`, `attachment.fetcher.ts:82` |
| Document text not stored — a `span-not-found` cannot be re-adjudicated offline | 1,378 discards, none re-checkable | — |
| **497 of 6,763 stored claims (7.3%) carry no `topic`; 242 carry no `direction`** — all written 2026-08-07, before those fields moved into `verifyClaims` | The topic filter is a Mongo query on the stored field, so those claims are **unfindable** by the dashboard's own control | `claim-verify.ts:290`; fix is `npm run claims:topics` |

---

## 12. Cap and threshold inventory

Every bound on the processing path, with whether its comment cites a measurement.

| Constant | Value | File:line | Measurement in comment? |
| --- | ---: | --- | --- |
| `MAX_ATTACHMENT_BYTES` | 64 MiB | `nse/attachment.fetcher.ts:71` | Yes — 8 refusals at 25.05-41.52 MB |
| `ATTACHMENT_TIMEOUT_MS` | 30 s | `nse/attachment.fetcher.ts:77` | Yes — p99 3.4 s, worst 7.2 s |
| `MAX_PDF_PAGES` | 400 | `pdf/pdf-text.ts:43` | Yes — 640-page NHPC at 39.69 s |
| `MAX_ZIP_ENTRIES` / `_UNCOMPRESSED_BYTES` / `_EXPANSION` | 64 / 128 MiB / 100× / 200× | `pdf/zip-entries.ts:51-60` | Partial — bomb bounds, no sweep |
| `MIN_TEXT_LAYER_CHARS` | 100 | `logic/enrichment-policy.ts:23` | Yes — bimodal 0.5 vs 559 chars/page |
| `MIN_READABLE_WINDOW_FRACTION` | 0.50 | `logic/enrichment-policy.ts:188` | Yes — 849 filings, full distribution |
| `DOCLING_OCR_MAX_PAGES` | 40 | `pdf/parse-route.ts:106` | Yes — largest live scan 15 pages |
| `DOCLING_LAYOUT_MAX_PAGES` | 150 | `pdf/parse-route.ts:121` | Yes — POLICYBZR 129, NHPC 640 |
| `DOCLING_TIMEOUT_MS` / `_COOLDOWN_MS` | 300 s / 300 s | `config/configuration.ts:266,271` | Yes — 414 s for 129 pages |
| `MIN_CLAIM_DOCUMENT_CHARS` | 1,500 | `logic/claim-eligibility.ts:109` | Yes — median intimation 1,967 |
| `SHARED_PAGE_MIN_IDENTITIES` | 4 | `logic/shared-page.ts:111` | Yes (in module header) |
| **`MAX_DOCUMENT_CHARS`** | **24,000** | `logic/claim-prompt.ts:50` | **Stale** — cites 87,000-char decks; today's max is 146,601. Dead in prod. |
| `CLAIM_MAX_DOCUMENT_CHARS` (live) | 96,000 | `config/configuration.ts:258` | Yes — points at a sweep report |
| `MAX_RESULTS_DOCUMENT_CHARS` | 96,000 | `logic/results-prompt.ts:151` | Yes — Apollo statement at char 7,400/21,900 |
| `MAX_CLAIMS_EXTRACTED` | 12 | `logic/claim-verify.ts:70` | Yes — 803/1,096 filings stopped at 3 |
| `MAX_CLAIMS_ON_WIRE` | 3 | `logic/claim-line.ts:44` | Presentation bound |
| `MAX_CLAIM_CHARS` | 120 | `logic/claim-verify.ts:73` | No — costs 208 discards |
| `MIN_SPAN_CHARS` / `MAX_SPAN_CHARS` | 12 / 400 | `logic/claim-span.ts:82,92` | Partial — the 400 is justified by the Telegram limit, not by span-length data |
| `PERIOD_CONTEXT_CHARS` | 800 | `logic/claim-period.ts:90` | Yes — 43 / 272 / 593 chars |
| `BASIS_HEADING_REACH` | 400 | `logic/results-basis.ts:87` | Yes — full bimodal listing |
| `DOCLING_BASIS_HEADING_REACH` | 2,400 | `logic/results-basis.ts:132` | Yes — 77 pairings listed |
| **`SCALE_REACH`** | **400** | `logic/results-unit.ts:79` | **No measurement, and route-blind. 53 of 70 `unit-not-determinable` refusals are on the Docling route.** |
| `RESULTS_TABLE_REACH` | 8,000 | `logic/results-verify.ts:91` | Yes — Apollo 3,220 / 14,400 |
| `MAX_RESULTS_FIGURES` | 5 | `logic/results-verify.ts:78` | No — not binding (1,244 proposed / 525 filings ≈ 2.4) |
| `MIN_RESULTS_DOCUMENT_CHARS` | 2,000 | `logic/results-eligibility.ts:148` | Partial |
| `RESULTS_BEARING_CATEGORIES` | 5 names | `logic/results-eligibility.ts:122` | Exclusions measured; **the fail-closed shape is not addressed** |
| `CLAIM_MAX_TOKENS` | 32,000 | `llm/claim-provider.ts:118` | Yes — and says it is not a cure |
| `CLAIM_TIMEOUT_MS` | 180 s | `llm/claim-provider.ts:135` | Yes |
| `DEFAULT_MAX_ATTEMPTS` / `RETRY_BASE` / `RETRY_MAX` | 5 / 60 s / 3,600 s | `logic/enrichment-policy.ts:26-32` | Partial |
| `PARSE_RETRY_WINDOW_MS` / `MAX_PARSE_ATTEMPTS` | 3,600 s / 3 | `logic/parse-retry.ts:91,94` | Yes — LICHSGFIN |
| `ENRICH_BATCH_SIZE` / `_REQUEST_DELAY_MS` / `_LEASE_MS` | 20 / 800 ms / 600 s | `config/configuration.ts:205,208,232` | Yes — 60 requests at 2.5 req/s. **The lease measurement assumed one document, not a batch (§10).** |

---

## 13. Findings ranked by reader-visible impact

| # | Finding | Measured | Class | Code |
| --- | --- | --- | --- | --- |
| 1 | **Enrichment runs 7–30 hours behind and drops the queue's tail.** The worker sustains 20–40 documents/hour against 1,042 arrivals on 2026-08-10. | p50 7.2 h, p90 29.4 h, p99 42.1 h from dissemination to first read; **299 filings (5.9%) unread after 15–20 h**; queue depth 315 | (a) fixable | `enrichment.worker.ts:308-346`; `claim-provider.ts:118,135` |
| 2 | **The optional parser has been gone for 3 days and no filing records it.** | 599 Docling reads on Aug 5–7, **0** since; `parseFallbackReason` null on 5,061/5,062; `no-text-layer` 10 → 16; results yield 5.0% → 2.5% | (a) fixable | `enrichment.worker.ts:638-639`; `routed-text.ts:96-102`; `filing.schema.ts:163` |
| 3 | **The results lane publishes 4.2% of what it reads.** 1,244 figures proposed, 58 stored. 159 results filings (30.3%) produce nothing at all. The unit-scale bound was never retuned for Docling output the way the basis bound was. | 525 eligible → 22 tables; **53 of 70 `unit-not-determinable` on `docling-layout`** | (a) fixable | `results-unit.ts:79` (no measurement, route-blind); `results-eligibility.ts:122` (category allowlist) |
| 4 | **211 extractions lost to truncated or empty model replies**, 95 of them at the current 32,000-token ceiling. | claim lane 104 (2.2% of enriched); results lane 107 (**20.4% of results-eligible**) | (a) fixable | `claim-provider.ts:118` |
| 5 | **34.7% of extracted characters never reach an extractor**, and the constant documenting the cap is stale. | 50.5 M of 145.7 M chars; 148 filings (3.2%) truncated; verified rate falls 79.5% → 46.9% with size | (a) fixable | `claim-prompt.ts:50,159`; `results-prompt.ts:168` |
| 6 | **612 MB of BSE documents collected and never read**; BSE collection itself stopped on 2026-08-07. | 2,104 announcements, 0 enrichment blocks | (a) unbuilt | `bse.schema.ts`; `cross-exchange-match.ts` (tool-only caller) |
| 7 | **497 stored claims (7.3%) are invisible to the dashboard's topic filter.** | 497 without `topic`, 242 without `direction`, all written 2026-08-07 | (a) fixable, one command | `claim-verify.ts:290`; `npm run claims:topics` |
| 8 | `span-not-found` conflates invention with a 400-character quoting bound. | 421 of 1,378 discards (30.6%) quoted ≥ ~158 chars | (a) fixable | `claim-span.ts:116` |
| 9 | The lease is stamped from the tick's clock, so most of a batch is claimed already-expired. | batch 20 × 90-180 s ≈ 33 min vs a 600 s lease | (a) latent | `enrichment.repository.ts:196`; `enrichment.worker.ts:290` |
| 10 | Source losses. | 40 filings (0.8%): 27 truncated at origin, 12 no attachment, 1 not a PDF | (b) inherent | — |
| 11 | Deliberate refusals. | 567 filings never read (11.2%); 249 claims refused on safety grounds | (c) **working as designed** | §9 |

### The single biggest lever

**Cut the per-document model cost.** It is one change that moves findings 1, 4
and 3 at once:

- Throughput is 20-40 documents/hour and it is *entirely* the model calls —
  measured with an empty arrival queue, no network contention, and a 0.8 s
  politeness delay that accounts for 0.5% of the time. Getting a document under
  30 seconds returns the pipeline to real-time and empties the 299-filing tail.
- The same reasoning length is what truncates 95 replies at 32,000 tokens and
  loses 20.4% of the results lane.
- 87.9% of enriched filings reach a model, including 619 newspaper pages (6.8%
  yield) and 1,022 con-call intimations (16.7% yield) — 35.1% of the enriched
  corpus returning 213 claim-bearing filings. The cheapest throughput available
  is not calling a model on documents whose structure already says they hold
  nothing.

The two smallest high-value fixes, both one-liners: **persist `routeReason`**
(finding 2 — the outage would have announced itself three days ago) and **make
`SCALE_REACH` route-aware like `BASIS_HEADING_REACH` already is** (finding 3 —
53 refused results tables on the Docling route alone).

---

## Appendix — every query run

All against `mongodb://127.0.0.1:27117/turret`, read-only.

```js
// §1, §2 — states, reasons, corpus window
db.filings.aggregate([{$group:{_id:{$ifNull:["$enrichment.state","(absent)"]},n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$group:{_id:"$enrichment.unparseableReason",n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$group:{_id:null,min:{$min:"$disseminatedAt"},max:{$max:"$disseminatedAt"},n:{$sum:1}}}])
db.filings.aggregate([{$group:{_id:"$enrichment.parseRoute",n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$group:{_id:"$enrichment.documentSource",n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$group:{_id:"$enrichment.coverageSkip",n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$group:{_id:"$enrichment.claimRefusalReason",n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$group:{_id:"$enrichment.resultsRefusalReason",n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$group:{_id:"$enrichment.amountRefusalReason",n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$group:{_id:{state:{$ifNull:["$enrichment.state","(absent)"]},
  hasOutcome:{$ne:[{$ifNull:["$enrichment.outcome",null]},null]}},n:{$sum:1}}},{$sort:{n:-1}}])

// §1 — size distribution and per-bucket yield
db.filings.aggregate([
 {$match:{"enrichment.documentChars":{$ne:null}}},
 {$group:{_id:null,n:{$sum:1},
   p50:{$percentile:{input:"$enrichment.documentChars",p:[0.5],method:"approximate"}},
   p90:{$percentile:{input:"$enrichment.documentChars",p:[0.9],method:"approximate"}},
   p99:{$percentile:{input:"$enrichment.documentChars",p:[0.99],method:"approximate"}},
   max:{$max:"$enrichment.documentChars"}, mean:{$avg:"$enrichment.documentChars"},
   sum:{$sum:"$enrichment.documentChars"}}}])

db.filings.aggregate([
 {$match:{"enrichment.documentChars":{$ne:null}}},
 {$bucket:{groupBy:"$enrichment.documentChars",
  boundaries:[0,1500,5000,10000,24000,50000,96000,200000,1000000,100000000], default:"other",
  output:{n:{$sum:1}, chars:{$sum:"$enrichment.documentChars"},
    claims:{$sum:{$size:{$ifNull:["$enrichment.claims",[]]}}},
    withClaim:{$sum:{$cond:[{$gt:[{$size:{$ifNull:["$enrichment.claims",[]]}},0]},1,0]}},
    proposed:{$sum:{$ifNull:["$enrichment.claimsProposed",0]}},
    discards:{$sum:{$size:{$ifNull:["$enrichment.claimDiscards",[]]}}},
    withResults:{$sum:{$cond:[{$ne:["$enrichment.results",null]},1,0]}},
    extractorError:{$sum:{$cond:[{$eq:["$enrichment.claimRefusalReason","extractor-error"]},1,0]}}}}}])

db.filings.aggregate([{$match:{"enrichment.state":"enriched"}},
 {$group:{_id:{$size:{$ifNull:["$enrichment.claims",[]]}},n:{$sum:1}}},{$sort:{_id:1}}])

// §7 — characters lost to the 96,000 cap
db.filings.aggregate([
 {$match:{"enrichment.documentChars":{$ne:null}}},
 {$group:{_id:null,n:{$sum:1},total:{$sum:"$enrichment.documentChars"},
   over:{$sum:{$cond:[{$gt:["$enrichment.documentChars",96000]},1,0]}},
   sentChars:{$sum:{$min:["$enrichment.documentChars",96000]}},
   lostChars:{$sum:{$max:[0,{$subtract:["$enrichment.documentChars",96000]}]}}}}])
db.filings.aggregate([{$match:{"enrichment.documentChars":{$ne:null}}},
 {$group:{_id:null,over:{$sum:{$cond:[{$gt:["$enrichment.documentChars",24000]},1,0]}}}}])
db.filings.find({"enrichment.documentChars":{$ne:null}},
 {seqId:1,symbol:1,category:1,"enrichment.documentChars":1,"enrichment.parseRoute":1,
  "enrichment.claimsProposed":1,"enrichment.claimRefusalReason":1})
 .sort({"enrichment.documentChars":-1}).limit(15)
db.filings.aggregate([{$match:{category:"Investor Presentation","enrichment.documentChars":{$ne:null}}},
 {$group:{_id:null,n:{$sum:1},max:{$max:"$enrichment.documentChars"},
   p50:{$percentile:{input:"$enrichment.documentChars",p:[0.5,0.9,0.99],method:"approximate"}},
   over96k:{$sum:{$cond:[{$gt:["$enrichment.documentChars",96000]},1,0]}},
   over24k:{$sum:{$cond:[{$gt:["$enrichment.documentChars",24000]},1,0]}}}}])

// §2, §7 — the verbatim gate
db.filings.aggregate([{$unwind:"$enrichment.claimDiscards"},
 {$group:{_id:"$enrichment.claimDiscards.reason",n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$unwind:"$enrichment.resultsDiscards"},
 {$group:{_id:"$enrichment.resultsDiscards.reason",n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$group:{_id:null,
  proposed:{$sum:{$ifNull:["$enrichment.claimsProposed",0]}},
  verified:{$sum:{$size:{$ifNull:["$enrichment.claims",[]]}}},
  discarded:{$sum:{$size:{$ifNull:["$enrichment.claimDiscards",[]]}}}}}])
db.filings.aggregate([{$unwind:"$enrichment.claimDiscards"},
 {$match:{"enrichment.claimDiscards.reason":"span-not-found"}},
 {$group:{_id:{$cond:[{$gte:[{$strLenCP:"$enrichment.claimDiscards.detail"},200]},
   "detail-capped(>=158 span chars)","shorter"]},n:{$sum:1}}}])
db.filings.aggregate([{$match:{"enrichment.documentChars":{$ne:null}}},
 {$project:{bucket:{$switch:{branches:[
   {case:{$lt:["$enrichment.documentChars",5000]},then:"a <5k"},
   {case:{$lt:["$enrichment.documentChars",24000]},then:"b 5k-24k"},
   {case:{$lt:["$enrichment.documentChars",96000]},then:"c 24k-96k"}],default:"d >96k"}},
   d:"$enrichment.claimDiscards"}},
 {$unwind:"$d"},{$group:{_id:{b:"$bucket",r:"$d.reason"},n:{$sum:1}}},{$sort:{"_id.b":1,n:-1}}])
db.filings.aggregate([{$match:{"enrichment.state":"enriched"}},
 {$group:{_id:"$enrichment.parseRoute",n:{$sum:1},
   proposed:{$sum:{$ifNull:["$enrichment.claimsProposed",0]}},
   verified:{$sum:{$size:{$ifNull:["$enrichment.claims",[]]}}}}}])

// §2 — what a reader gets
db.filings.aggregate([{$match:{"enrichment.state":"enriched"}},
 {$group:{_id:null,n:{$sum:1},
  withAmount:{$sum:{$cond:[{$ne:["$enrichment.amountRupees",null]},1,0]}},
  withHeadline:{$sum:{$cond:[{$ne:[{$ifNull:["$enrichment.headline",null]},null]},1,0]}},
  withClaimLine:{$sum:{$cond:[{$ne:[{$ifNull:["$enrichment.claimLine",null]},null]},1,0]}},
  withAnything:{$sum:{$cond:[{$or:[{$ne:["$enrichment.amountRupees",null]},
    {$gt:[{$size:{$ifNull:["$enrichment.claims",[]]}},0]},
    {$gt:["$enrichment.results",null]}]},1,0]}}}}])

// §4 — the Docling outage
db.filings.aggregate([{$match:{"enrichment.state":"enriched"}},
 {$group:{_id:{d:{$dateToString:{format:"%Y-%m-%d",date:{$add:["$disseminatedAt",19800000]}}},
   r:"$enrichment.parseRoute"},n:{$sum:1}}},{$sort:{"_id.d":1,"_id.r":1}}])
db.filings.aggregate([{$group:{_id:"$enrichment.parseFallbackReason",n:{$sum:1}}},{$sort:{n:-1}},{$limit:15}])
db.filings.find({"enrichment.parseRoute":{$in:["docling-layout","docling-ocr"]}},
 {seqId:1,disseminatedAt:1,"enrichment.attemptedAt":1,"enrichment.parseRoute":1})
 .sort({"enrichment.attemptedAt":-1}).limit(3)
db.filings.aggregate([{$match:{"enrichment.state":"unparseable"}},
 {$group:{_id:{d:{$dateToString:{format:"%Y-%m-%d",date:"$disseminatedAt"}},
   r:"$enrichment.unparseableReason"},n:{$sum:1}}},{$sort:{"_id.d":1}}])

// §5 — the results lane
db.filings.aggregate([{$match:{"enrichment.state":"enriched",
  "enrichment.resultsRefusalReason":{$ne:"not-eligible"}}},
 {$group:{_id:{route:"$enrichment.parseRoute",
   reason:{$ifNull:["$enrichment.resultsRefusalReason","STORED"]}},n:{$sum:1}}},
 {$sort:{"_id.route":1,n:-1}}])
db.filings.aggregate([{$match:{"enrichment.state":"enriched",
  "enrichment.resultsRefusalReason":{$ne:"not-eligible"}}},
 {$group:{_id:null,n:{$sum:1},
   withTable:{$sum:{$cond:[{$gt:["$enrichment.results",null]},1,0]}},
   withClaims:{$sum:{$cond:[{$gt:[{$size:{$ifNull:["$enrichment.claims",[]]}},0]},1,0]}},
   nothing:{$sum:{$cond:[{$and:[{$eq:["$enrichment.results",null]},
     {$eq:[{$size:{$ifNull:["$enrichment.claims",[]]}},0]}]},1,0]}},
   claimsTotal:{$sum:{$size:{$ifNull:["$enrichment.claims",[]]}}},
   proposedC:{$sum:{$ifNull:["$enrichment.claimsProposed",0]}},
   proposedR:{$sum:{$ifNull:["$enrichment.resultsProposed",0]}}}}])
db.filings.aggregate([{$group:{_id:null,
  resultsObj:{$sum:{$cond:[{$gt:["$enrichment.results",null]},1,0]}},
  resultsLine:{$sum:{$cond:[{$ne:[{$ifNull:["$enrichment.resultsLine",null]},null]},1,0]}},
  figures:{$sum:{$size:{$ifNull:["$enrichment.results.figures",[]]}}},
  proposedRes:{$sum:{$ifNull:["$enrichment.resultsProposed",0]}}}}])
db.filings.aggregate([{$match:{"enrichment.resultsRefusalReason":"unit-not-determinable"}},
 {$group:{_id:"$enrichment.parseRoute",n:{$sum:1}}}])
db.filings.aggregate([{$match:{"enrichment.resultsRefusalReason":
  {$in:["unit-not-determinable","period-not-derivable","basis-not-determinable","columns-not-found"]}}},
 {$sample:{size:8}},{$project:{seqId:1,symbol:1,route:"$enrichment.parseRoute",
   reason:"$enrichment.resultsRefusalReason",detail:{$substrCP:["$enrichment.resultsRefusalDetail",0,180]}}}])
db.filings.find({seqId:{$in:[106731630,106726670]}},
 {seqId:1,symbol:1,"enrichment.documentChars":1,"enrichment.parseRoute":1,
  "enrichment.claimsProposed":1,"enrichment.claimRefusalReason":1,"enrichment.claimDiscards":1,
  "enrichment.resultsProposed":1,"enrichment.resultsRefusalReason":1,"enrichment.resultsRefusalDetail":1})

// §6 — model failures
db.filings.aggregate([{$match:{"enrichment.claimRefusalReason":"extractor-error"}},
 {$group:{_id:{$substrCP:[{$ifNull:["$enrichment.claimRefusalDetail","(none)"]},0,90]},n:{$sum:1}}},
 {$sort:{n:-1}},{$limit:12}])
db.filings.aggregate([{$match:{"enrichment.resultsRefusalReason":"extractor-error"}},
 {$group:{_id:{$substrCP:[{$ifNull:["$enrichment.resultsRefusalDetail","(none)"]},0,90]},n:{$sum:1}}},
 {$sort:{n:-1}},{$limit:12}])

// §3 — latency and throughput
db.filings.aggregate([{$match:{"enrichment.attemptedAt":{$ne:null}}},
 {$project:{store:{$divide:[{$subtract:["$ingestedAt","$disseminatedAt"]},1000]},
   enrich:{$divide:[{$subtract:["$enrichment.attemptedAt","$ingestedAt"]},1000]},
   total:{$divide:[{$subtract:["$enrichment.attemptedAt","$disseminatedAt"]},1000]}}},
 {$group:{_id:null,n:{$sum:1},
   store_p50:{$percentile:{input:"$store",p:[0.5,0.9,0.99],method:"approximate"}},
   enrich_p:{$percentile:{input:"$enrich",p:[0.5,0.9,0.99],method:"approximate"}},
   total_p:{$percentile:{input:"$total",p:[0.5,0.9,0.99],method:"approximate"}},
   enrich_max:{$max:"$enrich"}}}])
db.filings.aggregate([{$project:{d:{$dateToString:{format:"%Y-%m-%d",date:"$ingestedAt"}},
   lag:{$divide:[{$subtract:["$ingestedAt","$disseminatedAt"]},1000]}}},
 {$group:{_id:"$d",n:{$sum:1},p50:{$percentile:{input:"$lag",p:[0.5],method:"approximate"}},
   p90:{$percentile:{input:"$lag",p:[0.9],method:"approximate"}},max:{$max:"$lag"}}},{$sort:{_id:1}}])
db.filings.aggregate([{$match:{"enrichment.attemptedAt":{$ne:null},"enrichment.documentChars":{$ne:null}}},
 {$project:{chars:"$enrichment.documentChars",
   enrich:{$divide:[{$subtract:["$enrichment.attemptedAt","$ingestedAt"]},1000]}}},
 {$bucket:{groupBy:"$chars",boundaries:[0,1500,10000,24000,96000,200000,100000000],default:"o",
   output:{n:{$sum:1},p50:{$percentile:{input:"$enrich",p:[0.5],method:"approximate"}},
     p90:{$percentile:{input:"$enrich",p:[0.9],method:"approximate"}},max:{$max:"$enrich"}}}}])
// hourly arrivals vs attempts (48 h)
const since = new Date(Date.now()-48*3600*1000);
db.filings.aggregate([{$match:{ingestedAt:{$gte:since}}},
 {$group:{_id:{$dateToString:{format:"%m-%d %H",date:"$ingestedAt"}},n:{$sum:1}}}])
db.filings.aggregate([{$match:{"enrichment.attemptedAt":{$gte:since}}},
 {$group:{_id:{$dateToString:{format:"%m-%d %H",date:"$enrichment.attemptedAt"}},n:{$sum:1}}}])
db.filings.countDocuments({"enrichment.state":{$in:[null,"pending"]},
 $or:[{"enrichment.nextAttemptAt":null},{"enrichment.nextAttemptAt":{$lte:new Date()}}]})
db.filings.aggregate([{$match:{enrichment:{$exists:false}}},
 {$group:{_id:null,n:{$sum:1},oldest:{$min:"$disseminatedAt"},newest:{$max:"$disseminatedAt"}}}])
db.filings.aggregate([{$match:{"enrichment.state":"enriched"}},
 {$group:{_id:{$dateToString:{format:"%Y-%m-%d",date:{$add:["$disseminatedAt",19800000]}}},
   enriched:{$sum:1},
   eligible:{$sum:{$cond:[{$ne:["$enrichment.resultsRefusalReason","not-eligible"]},1,0]}},
   stored:{$sum:{$cond:[{$gt:["$enrichment.results",null]},1,0]}},
   claimFilings:{$sum:{$cond:[{$gt:[{$size:{$ifNull:["$enrichment.claims",[]]}},0]},1,0]}},
   claims:{$sum:{$size:{$ifNull:["$enrichment.claims",[]]}}},
   extractorErr:{$sum:{$cond:[{$eq:["$enrichment.claimRefusalReason","extractor-error"]},1,0]}}}},
 {$sort:{_id:1}}])

// §10 — retry health
db.filings.aggregate([{$group:{_id:{a:"$enrichment.attempts",
  s:{$ifNull:["$enrichment.state","(absent)"]}},n:{$sum:1}}},{$sort:{"_id.a":1}}])
db.filings.aggregate([{$match:{"enrichment.parseAttempts":{$gt:0}}},
 {$group:{_id:"$enrichment.parseAttempts",n:{$sum:1}}},{$sort:{_id:1}}])
db.filings.find({"enrichment.state":"pending"},{seqId:1,symbol:1,category:1,
 "enrichment.attempts":1,"enrichment.parseAttempts":1,"enrichment.nextAttemptAt":1,
 "enrichment.lastError":1,disseminatedAt:1}).limit(20)
db.filings.aggregate([{$match:{"enrichment.state":"failed"}},
 {$group:{_id:"$enrichment.lastError",n:{$sum:1}}}])

// document kinds
db.filings.aggregate([{$group:{_id:"$category",n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$match:{"enrichment.state":"enriched"}},
 {$group:{_id:"$category",n:{$sum:1},chars:{$avg:"$enrichment.documentChars"},
   withClaim:{$sum:{$cond:[{$gt:[{$size:{$ifNull:["$enrichment.claims",[]]}},0]},1,0]}},
   claims:{$sum:{$size:{$ifNull:["$enrichment.claims",[]]}}},
   proposed:{$sum:{$ifNull:["$enrichment.claimsProposed",0]}},
   skipped:{$sum:{$cond:[{$ne:[{$ifNull:["$enrichment.coverageSkip",null]},null]},1,0]}},
   extErr:{$sum:{$cond:[{$eq:["$enrichment.claimRefusalReason","extractor-error"]},1,0]}}}},
 {$sort:{n:-1}},{$limit:25}])
// zero-yield hand samples, read through the stored (never-published) documentSummary
db.filings.aggregate([{$match:{"enrichment.state":"enriched",category:"Outcome of Board Meeting",
  "enrichment.claims":{$size:0},"enrichment.claimRefusalReason":"no-claims"}},{$sample:{size:6}},
 {$project:{seqId:1,symbol:1,chars:"$enrichment.documentChars",route:"$enrichment.parseRoute",
   sum:{$substrCP:[{$ifNull:["$enrichment.documentSummary","(none)"]},0,180]}}}])
// (same, for "Copy of Newspaper Publication" and "Shareholders meeting")

// §11 — telemetry
db.filings.aggregate([{$unwind:"$enrichment.claims"},
 {$group:{_id:{$ifNull:["$enrichment.claims.topic","(null)"]},n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$unwind:"$enrichment.claims"},
 {$group:{_id:{$ifNull:["$enrichment.claims.direction","(null)"]},n:{$sum:1}}},{$sort:{n:-1}}])
db.filings.aggregate([{$unwind:"$enrichment.claims"},
 {$match:{$expr:{$eq:[{$ifNull:["$enrichment.claims.topic",null]},null]}}},
 {$group:{_id:{$dateToString:{format:"%Y-%m-%d",date:"$enrichment.attemptedAt"}},n:{$sum:1}}},{$sort:{_id:1}}])
db.filings.aggregate([{$group:{_id:null,n:{$sum:{$size:{$ifNull:["$enrichment.claims",[]]}}}}}])
db.filings.aggregate([{$group:{_id:"$enrichment.documentSummaryRefusalReason",n:{$sum:1}}},{$sort:{n:-1}}])

// §8 — BSE
db.bse_announcements.aggregate([{$group:{_id:null,n:{$sum:1},
  min:{$min:"$disseminatedAt"},max:{$max:"$disseminatedAt"},bytes:{$sum:"$attachmentBytes"},
  p50b:{$percentile:{input:"$attachmentBytes",p:[0.5,0.9,0.99],method:"approximate"}},
  maxb:{$max:"$attachmentBytes"}}}])
Object.keys(db.bse_announcements.findOne())
```

Code-side commands used (read-only):

```
grep -rn "truncated" --include='*.ts' apps libs | grep -v spec
grep -rn "^export const [A-Z_]* *\(:[^=]*\)\?= *[0-9_]" --include='*.ts' libs/filings/src apps/ingest/src
grep -rn "bse_announcements\|BseRepository" --include='*.ts' apps libs tools
grep -vE 'KEY|TOKEN|SECRET|PASSWORD|URI|PRIVATE' .env
```
