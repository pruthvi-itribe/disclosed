# Enrichment speed — where the seconds go, and what buys them back

**Measured 2026-08-11, 04:20–05:55 UTC.** Read-only against the live `turret`
database at `mongodb://127.0.0.1:27117`; **nothing was written to Mongo**, no
running process was touched, and **no document was re-fetched from an exchange**
(§2 says how that was avoided). Model calls WERE made — deliberately, and
counted: see §10 for the exact number and the spend.

The question is not the backlog. It is **seconds per document** and **documents
per hour** for a single sequential worker.

---

## 0. The headline

**96% of every model reply is reasoning tokens that are thrown away.** The
answer is 300–400 tokens of JSON; the mean reply at production's `medium` effort
is 9,681 output tokens of which 9,321 are thinking. That is the whole of the
per-document time, and it is why the time is flat across document sizes — a
whole call that does no thinking returns in a few seconds whatever the document
(the `none` arm's median on a zero-yield document is **4.1 s**), so what varies
is how long the model thinks, and that does not track the document. The same document at the same setting was
measured at 10,021 output tokens on one call and 490 on another.

Three things follow, in the order they should be done:

| | Change | docs/hour | evidence |
| --- | --- | --- | --- |
| today | — | **36** | measured, §3 |
| **1** | `k8s/20-enrichment.yaml` `replicas: 1` → `4` | **122** | §6: parallelism 3.40 measured, no 429, no per-call degradation |
| 2 | `enrichment.worker.ts:625-626` → `Promise.all` | +15% | §7 |
| 3 | `reasoning: { effort: 'none' }` (needs a new rung) | 97 alone, **330** with 1 | §5 — fast, but the quality evidence is underpowered; §9 says do not ship it yet |

The effort knob **as the repository exposes it** is not the answer: `low` is the
lowest rung available and buys 7%. The knob that matters, `none`, is not
reachable from configuration today.

---

## 1. The time structure, read off the code

`EnrichmentWorker.drain()` claims one filing at a time and processes it to
completion before claiming the next. Per document, in order
(`apps/ingest/src/enrichment/enrichment.worker.ts`):

| # | Await | Line | Cost |
| --- | --- | --- | --- |
| 1 | `repository.claimNext(now, leaseMs)` | 323 | one indexed `findOneAndUpdate` |
| 2 | `sleep(requestDelayMs)` — **between** documents only, not before the first | 339 | **800 ms**, fixed |
| 3 | `fetcher.fetch(url)` | 401 | NSE archive GET. The file's own header cites 206 ms median, 3.6 s p99 |
| 4 | `extractPdfText(body, pdfParser)` | 448 | `pdf-parse`, CPU, bounded by `MAX_PDF_PAGES` |
| 5 | `readRouted(...)` → `readWithRouting` | 466 | **pass-through today**: `DOCLING_URL` is unset, so the converter is null and no HTTP happens. Confirmed in the data — every one of the 828 filings enriched in the last two days stored `parseRoute: 'pdf-parse'` |
| 6 | `contextFor(...)` | 619 | 0–2 indexed counts; the coverage read is memoised for 60 s |
| 7 | **`claimsFor(...)` — model call #1** | 625 | the claim lane |
| 8 | **`resultsFor(...)` — model call #2** | 626 | the results lane, only when `resultsEligibility` passes |
| 9 | `repository.recordEnrichment(...)` | 675 | one update |
| 10 | `announce(...)` | — | Telegram, gated; skipped for most filings |

Between ticks: `sleep(requestDelayMs)` (800 ms) after a tick that claimed
anything, `sleep(idleIntervalMs)` (10 s) after an empty one. `batchSize` is 20,
the lease is 600 s, and `enrichment.lane.ts` plus `k8s/20-enrichment.yaml` both
state that a second worker is **already safe** — the claim is a single atomic
`findOneAndUpdate` that stamps a lease before the fetch begins.

**Nothing in that loop can cost seconds except 3, 4, and 7–8.** The 800 ms delay
is 19 × 0.8 s + 0.8 s = **16 s per batch of 20 = 0.8 s/document**, under 1% of
the measured p50.

### 7 and 8 are sequential and independent

```
625:    const claims = await this.claimsFor(filing, documentText);
626:    const results = await this.resultsFor(filing, documentText, routed.route);
```

`resultsFor` reads `filing`, `documentText` and `routed.route`. It does not read
`claims`. On a results-bearing filing the two calls are serialised for no reason
the code gives.

### What the calls send

From `openrouter-claim-extractor.ts:ask()` and `claim-provider.ts`:

| Parameter | Value | Where |
| --- | --- | --- |
| model | `deepseek/deepseek-v4-flash-0731` | `.env` `CLAIM_MODEL` |
| `max_tokens` | **32,000** | `CLAIM_MAX_TOKENS` |
| `temperature` | 0 | hardcoded |
| `reasoning.effort` | **`medium`** | `DEFAULT_CLAIM_EFFORT` (configuration.ts:308) → `openAiEffort` (claim-provider.ts:193) → `reasoning: { effort }` (openrouter-claim-extractor.ts:280) |
| `response_format` | `json_schema`, `strict: true` | per lane |
| `provider` | `require_parameters`, `quantizations: ['fp8']`, `order: [Novita, GMICloud, AtlasCloud, Cloudflare, SiliconFlow]`, `allow_fallbacks: true` | openrouter-claim-extractor.ts |
| axios `timeout` | 180,000 ms | `CLAIM_TIMEOUT_MS` |
| document cap | 96,000 chars, **both lanes** | `CLAIM_MAX_DOCUMENT_CHARS` |

The effort ladder the repo exposes is `low | medium | high | xhigh | max`
(`CLAIM_EFFORT_LEVELS`, claim-provider.ts:46), clamped to OpenAI's three by
`openAiEffort`. **There is no rung below `low`.**

---

## 2. The sample, and why no exchange was touched

The pipeline does not store document text (`filing.schema.ts` keeps
`documentChars` and nothing else), so a sweep needs the bytes back. It did not
need the exchange: `tools/extraction/measure-ambiguity-scope.ts` keeps a text
cache at `data/corpus/.ambiguity-scope-cache/`, keyed
`sha256(seqId)[0:16].txt`, written by the same `extractPdfText` call the worker
makes.

**1,257 cached documents; 970 of them are filings whose stored `parseRoute` is
`pdf-parse`; for all 970 the cached text length equals the stored
`enrichment.documentChars` exactly — 970/970, zero off by even one character.**
That is the proof the cache is the text the worker read, and it is why **zero
documents were re-fetched from NSE**.

30 documents were drawn from those 970 (all enriched 2026-08-06 → 2026-08-07),
stratified to match what the worker meets:

| Stratum | n | What it is |
| --- | --- | --- |
| `results` | 5 | results-lane eligible — **two** model calls per document |
| `claims` | 10 | production stored ≥ 1 verified claim (1 to 12 of them) |
| `zero` | 15 | claim lane ran and yielded nothing — 4 newspaper pages, 4 con-call intimations, 7 other |

All 30 pass `claimEligibility`; 5 pass `resultsEligibility` — checked offline
with the repo's own gates before a single call was made, so **35 model calls per
effort arm** is the same shape the worker would produce.

The sweep calls the production path: `new OpenRouterClaimExtractor(...)` with
`buildClaimRequest` / `buildResultsRequest`, the real schemas, `temperature: 0`,
`max_tokens: 32000`, the real `provider` routing block. The only injected
difference is a recording wrapper around `chat.create`, and — **for the `none`
arm only** — `reasoning` replaced with `{ effort: 'none' }`. Outputs go through
the repo's own `verifyClaims` / `verifyResults` / `vetSummary`.

---

## 3. What production actually does today, measured independently

`enrichment.attemptedAt` is stamped once per **tick**, not per document, so a
tick's timestamp and the next one bound how long that tick took. Over the last
three days, restricted to ticks that filled the batch (20 documents):

| Metric | Value |
| --- | --- |
| Full ticks (20 docs) | 35 |
| **Seconds per document, p50** | **100.3 s** |
| Seconds per document, p90 | 162.8 s |
| **Implied documents/hour** | **35.9** |
| All ticks ≥ 5 docs (n=56) | p50 89.9 s, p90 162.8 s, mean 99.5 s |

That is an independent confirmation of the p50 ≈ 106 s / ≈ 34 docs/hour figure
this task was given, arrived at from a different field.

### Model calls per document

Over the 828 filings enriched in the last two days, and over yesterday's day
alone:

| | last 2 days | 2026-08-10 (IST) |
| --- | --- | --- |
| enriched | 828 | 741 |
| claim call made | 711 (85.9%) | 634 (85.6%) |
| results call made | 102 (12.3%) | 94 (12.7%) |
| **model calls per document** | **0.98** | **0.98** |

14% of documents are refused by `claimEligibility` and cost no model time at
all. 12.7% cost two calls.

### 4.2% of all calls burn the whole 32,000-token budget and return nothing

| Lane, last 3 days | calls | `the reply was truncated at 32000 tokens` |
| --- | --- | --- |
| claims | 1,117 | 29 (2.6%) |
| results | 166 | **25 (15.1%)** |
| both | 1,283 | 54 (**4.2%**) |

These are the slowest calls in the system and they produce nothing: the reply is
discarded and the filing records `extractor-error`. Document size only partly
explains them — truncated claim calls have a median of 28,351 document
characters against 11,207 for the rest, so the tail is long documents, but the
p10 of the truncated set is 6,646 characters, which is an ordinary covering
letter. The remaining failures over the same window are 3 × `the model returned
no text`, 1 malformed body and 1 `OpenRouter responded 200: aborted` — 5 in
1,283, against the ceiling's 54.

---

## 4. Where the seconds actually go: reasoning tokens

The pipeline does not record this. `usageOf` in `openrouter-claim-extractor.ts`
reads `prompt_tokens`, `completion_tokens` and `prompt_tokens_details`, and
`grep -rn reasoning_tokens apps libs tools` returns nothing — so the component
that dominates the cost has never been visible to the system measuring it.

`completion_tokens_details.reasoning_tokens`, over all 105 sweep calls:

| Arm | mean output tokens | of which reasoning | share |
| --- | --- | --- | --- |
| medium | 9,681 | 9,321 | **96.3%** |
| low | 8,782 | 8,463 | **96.4%** |
| none | 3,242 | 3,001 | 92.6% |

**Between 93% and 96% of every reply is thinking that is thrown away.** The
answer itself — up to twelve claims of JSON — is 300 to 400 tokens.

That is also the answer to "why is the time flat across document sizes": the
prompt is 6,300–10,000 tokens (92 of the 105 calls had a warm prefix cache) and
reading it is not what costs the time — a `none`-effort call over the same
documents returns in a median of 9.3 s. What varies is how long the model
thinks, and that does not track the document. The same document at the same
setting was measured at **10,021 output tokens on one call and 490 on another**
(SETL, medium, c=1 then c=4) — a 20× spread with nothing changed.

### `CLAIM_TIMEOUT_MS` is not a wall-clock cap

One claim call in this sweep ran **354.6 s and returned HTTP 200** against a
configured `timeout: 180_000`. axios 1.19's Node adapter arms the request
through `req.setTimeout(timeout, handleTimeout)`
(`node_modules/axios/lib/adapters/http.js:1335`), which is Node's **socket
inactivity** timer; the wall-clock `connectPhaseTimer` beside it is cleared once
the connection is up. A provider that keeps the socket warm can therefore run
for as long as it likes. So `CLAIM_TIMEOUT_MS = 180_000` bounds a stalled
connection, not a runaway generation, and a document's p90 of 337 s can be **one**
call rather than two.

---

## 5. The effort sweep

30 documents, 3 arms, 105 calls, at concurrency 4. `medium` is production's
setting; `low` is the lowest rung the repo's ladder exposes; `none` is
`reasoning: { effort: 'none' }`, which OpenRouter accepts for this model —
**and which is not reachable from the repo's configuration today**.

**`none` is a request, not a guarantee, and the sweep measured that.** Every one
of the 105 sweep calls was routed to AtlasCloud, which honours `none` only
sometimes: 7 of 35 `none` calls returned `reasoning_tokens: 0` and the rest
still reasoned, with a median of 742 tokens and a p90 of 10,021 (against a
median of 7,527 and a p90 of 21,768 at `medium`, and a maximum of 23,230 at
`none` against 24,822). A GMICloud probe returned a clean 0. So the arm below is
"ask for no reasoning", which cuts the median by 10× and the tail by half — not
"reasoning is off".

### Claim lane, all 30 documents

| Arm | p50 s | p90 s | mean s | failures | mean out tok | mean reasoning tok | proposed | accepted | span-verify pass | recall vs production |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **medium** (today) | **94.3** | 240.2 | **120.2** | 1/30 | 9,681 | 9,321 | 97 | 65 | **88%** | **52%** (35/67) |
| low | 63.5 | 242.6 | 106.2 | 2/30 | 8,782 | 8,463 | 99 | 66 | 85% | 57% (38/67) |
| **none** | **9.3** | 114.2 | **41.0** | 0/30 | 3,242 | 3,001 | 72 | 42 | 86% | 48% (32/67) |

*Recall* counts a production claim as recovered when the re-run quoted a span
that **overlaps it in the document**. Exact span equality is the wrong test and
was tried first: the two runs pick the same sentence and cut it at different
clause boundaries, which scores a perfect re-read as a total miss (AJMERA scored
1/12 exact and 10/12 by overlap for the same answer).

*Span-verify pass* is `1 − span-not-found / proposed`, computed by the repo's own
`verifyClaims`. It is the invention rate the verbatim gate exists to catch.

### By stratum

| Stratum | arm | p50 s | mean s | proposed | accepted | recall |
| --- | --- | --- | --- | --- | --- | --- |
| claim-bearing (10) | medium | 234.6 | 204.5 | 68 | 45 | 54% (29/54) |
| | low | 169.7 | 164.4 | 69 | 48 | 63% (34/54) |
| | none | 78.1 | 79.7 | 57 | 37 | 52% (28/54) |
| zero-yield (15) | medium | 8.4 | 56.6 | 7 | 4 | — |
| | low | 7.8 | 48.5 | 7 | 3 | — |
| | none | 4.1 | 10.6 | 1 | 0 | — |
| results-eligible (5) | medium | 195.4 | 159.3 | 22 | 16 | 46% (6/13) |
| | low | 226.9 | 201.1 | 23 | 15 | 31% (4/13) |
| | none | 57.6 | 54.7 | 14 | 5 | 31% (4/13) |

### Results lane (5 documents, one call each)

| Arm | p50 s | p90 s | mean out tok | mean reasoning tok | truncated at 32k |
| --- | --- | --- | --- | --- | --- |
| medium | 202.9 | 202.9 | 14,506 | 14,343 | **2/5** |
| low | 65.5 | 245.0 | 13,822 | 13,412 | 1/5 |
| none | 10.6 | 169.6 | 7,747 | 7,490 | **0/5** |

No arm produced an accepted results table on these five: the sample's documents
refuse downstream at `basis-not-determinable`, `columns-not-found`,
`period-not-derivable` and `no-table`, which is the live rate too (3 filings in
the last two days carried a stored results table).

### What this does and does not establish

**Established.** The time difference is large and unambiguous: `none` is a
**2.9× cut in the mean claim call** (120.2 s → 41.0 s) and a 10× cut in the
median. `low` is worth **12%** on the mean and nothing you would deploy for.
The span-verify pass rate does not move: 88% / 85% / 86%, i.e. **lowering the
effort does not make the model invent more**, which is the safety-relevant
question.

**Not established.** Recall differences. The 30 documents carry **67** stored
claims between them, so the standard error of each recall figure is ±6.1 pp and
52% / 57% / 48% sit inside one standard error of each other. A call that failed
counts as recovering nothing, which is why the denominator is the same 67 for
every arm. The control that says the comparison is underpowered is the **medium
arm itself**: re-running production's own setting on production's own documents
recovered **52%** of production's claims. Half of what this
pipeline publishes is not reproducible run to run, and no 30-document comparison
can see a smaller effect than that.

What *is* visible is volume: `none` accepted **42** verified claims against
medium's 65 (−35%). That is a real drop in output, and it is not the same thing
as a drop in recall — the extra claims medium proposed were largely ones
production had not kept either.

---

## 6. Concurrency

The same 8 documents, the same medium effort, at 1, 4 and 8 in flight.

| Concurrency | batch wall-clock | sum of call times | **parallelism** | longest call | calls/hour | 429s / failures |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1,084.2 s | 1,084.0 s | 1.00 | 354.6 s | 27 | none |
| **4** | **243.6 s** | 829.2 s | **3.40** | 243.6 s | 118 | **none** |
| 8 | 237.6 s | 750.6 s | 3.16 | 237.6 s | 121 | none |

*Parallelism* is call-seconds completed per wall-second. It is the honest figure:
the raw batch speedup reads 4.45× at c=4, but only because that run's calls
happened to be shorter (SETL was 122.8 s at c=1 and 6.9 s at c=4 — run-to-run
reasoning variance, not concurrency).

- **Per-call latency does not degrade.** AJMERA: 135.7 s at c=1, 148.5 s at c=4,
  179.2 s at c=8. SANGHVIMOV: 354.6 s, 201.2 s, 157.9 s. The spread between
  repeats of one document exceeds the concurrency effect entirely.
- **No rate limiting at all.** No 429, no error, no `content_filter`, across 24
  calls with up to 8 in flight. All 24 were served by AtlasCloud.
- **c=8 is inconclusive above 4.** A batch of 8 at c=8 is bounded by its single
  slowest call (237.6 s of a 237.6 s batch), so this experiment cannot show
  parallelism beyond ~4 whatever the provider would allow. 3.40 at c=4 is the
  measured number; 3.16 at c=8 is a floor, not a ceiling.

**The politeness budget is not the constraint.** `ENRICH_REQUEST_DELAY_MS` is
800 ms and exists because 60 sequential NSE requests at ~2.5 req/s drew no rate
limiting. At 36 documents/hour the worker issues **0.01 NSE requests/second** —
250× under the only rate ever proven safe. Four workers would make it 0.04/s.

---

## 7. Projected documents/hour

The sweep sample is heavier than the live mix: at `medium` it costs **132.9
s/document** against the **100.3 s/document** production actually runs at (§3),
a factor of **1.33**. Every projection below divides the sweep figure by that,
so the `medium, 1 worker` row reproduces the measured baseline by construction
and every other row is a *relative* claim resting on a measurement, not an
absolute extrapolation from a small sample.

Per-document seconds = 2 s overhead + 0.859 × mean claim-call seconds + 0.123 ×
mean results-call seconds, using production's measured call mix (§3). Failed
calls are included — a truncated reply still costs its seconds.

Concurrency multipliers are the measured parallelism: **3.40 at 4 workers**,
1.9 assumed at 2 (interpolated, not measured), 3.16 at 8 (a floor, §6).

| Configuration | s/document | **docs/hour** | hours for yesterday's 1,035 | vs today |
| --- | --- | --- | --- | --- |
| **medium, 1 worker — TODAY** | 100.3 | **36** | 28.8 | 1.00× |
| low, 1 worker | 93.6 | 38 | 26.9 | 1.07× |
| medium, lanes in `Promise.all` | 87.5 | 41 | 25.2 | 1.15× |
| **medium, 4 workers** | 100.3 | **122** | **8.5** | **3.40×** |
| low, 4 workers | 93.6 | 131 | 7.9 | 3.64× |
| **none, 1 worker** | 37.0 | **97** | 10.7 | 2.71× |
| none + `Promise.all`, 1 worker | 33.1 | 109 | 9.5 | 3.03× |
| none, 2 workers | 37.0 | 185 | 5.6 | 5.14× |
| **none, 4 workers** | 37.0 | **330** | **3.1** | **9.20×** |
| none + `Promise.all`, 4 workers | 33.1 | 369 | 2.8 | 10.29× |

`Promise.all` on the two lanes saves the *shorter* of the two calls on a
two-call document — measured at **137.8 s** per such document at medium, 42.0 s
at `none` — which is 12.3% of documents, so 17.0 s and 5.2 s off the average.

**Yesterday's 1,035 arrivals need 28.8 hours at today's rate.** They do not fit
in a day, which is why 265 of them were still unattempted when this was
measured. Any row at or above 43 docs/hour clears a 1,035-document day inside 24
hours; the first row that clears it inside a *market* day is `medium, 4 workers`.

---

## 8. The triage probe: what a cheaper call buys on the documents that yield nothing

15 zero-yield documents (4 newspaper pages, 4 con-call intimations, 7 other),
same documents, three arms:

| Arm | p50 | mean | total for all 15 |
| --- | --- | --- | --- |
| medium | 8.4 s | 56.6 s | 849 s |
| low | 7.8 s | 48.5 s | 727 s (**−14%**) |
| none | 4.1 s | 10.6 s | **158 s (−81%)** |

The median zero-yield document already costs only 8.4 s at medium — **the mean
is 6.7× the median** because a few of the fifteen run away. At medium the four
slowest are INDTERRAIN (233.4 s, 18,969 output tokens), CANDC (218.1 s, 17,823),
GALAPREC (94.3 s) and VIKRAN (93.2 s — on a **1,913-character** con-call
intimation, which is the point: the runaway is not a property of the document).
At `none` the same four are 82.8 s, 17.6 s, 12.9 s and 1.9 s.

So triage by effort level is not the shape of the win: `low` removes 14% and
leaves the runaways intact. `none` removes 81% because it removes the runaways
themselves — 1 claim proposed across 15 documents and 0 accepted, against
medium's 7 proposed and 4 accepted, none of which production had kept either.

---

## 9. Recommendation

**Change nothing about the model or the prompt. Run more than one worker.**

### First — zero code, zero quality risk

`k8s/20-enrichment.yaml`, `replicas: 1` → `4`.

**36 → ~122 docs/hour (3.40×).** Yesterday's 1,035 arrivals in 8.5 hours instead
of 28.8. The measurement that supports it is §6: no per-call degradation, no
429, no failure at 8 in flight. The safety argument is already written in that
file — "documents are claimed under a lease (`ENRICH_LEASE_MS`, ten minutes)
precisely so two workers cannot both write a verdict onto one filing" — and the
comment says what stopped it was *arithmetic, not safety*: "a second worker
doubles the spend against a queue that a single worker drains". Both halves of
that are now false: the queue is **not** drained (265 of 1,035 unattempted), and
the spend is per call, not per worker — four workers make the same number of
calls, four times sooner. Total cost is unchanged. The claim order stays
newest-first, and `contextCounts` already races today because `claimNext` sorts
`disseminatedAt: -1`, so priors are enriched *after* the filing that counts them.

The one real cost is memory: 4 × 512Mi on a one-node pool
(`k8s/20-enrichment.yaml` sets the limit at 2.4× the 210 MiB parsing peak). If
the node cannot hold four, **two** workers is 68 docs/hour and still clears a
1,035-document day.

### Second — one line, 138 s off every two-call document

`apps/ingest/src/enrichment/enrichment.worker.ts:625-626`:

```
const claims  = await this.claimsFor(filing, documentText);
const results = await this.resultsFor(filing, documentText, routed.route);
```

`resultsFor` does not read `claims`. Awaiting them together costs the longer of
the two rather than their sum — measured at **137.8 s** saved per two-call
document at medium, which over the 12.3% of documents that make two calls is
17.0 s off the average and **1.15×** on throughput. It is the change with the
smallest surface in this document, and it composes with the first.

### Third — the big one, and it needs a rung that does not exist

`reasoning: { effort: 'none' }` is **2.71×** on its own and 9.20× with four
workers. It is not reachable from configuration: it needs `'none'` added to
`CLAIM_EFFORT_LEVELS` (`libs/filings/src/llm/claim-provider.ts:46`) and to
`openAiEffort` (`:193`), then `CLAIM_EFFORT=none` in the deployment's env. Three
lines and their specs.

It is also **not a guarantee**: §5 shows AtlasCloud honouring `none` on 7 of 35
calls and merely reasoning less on the rest. The speed is real and measured; the
mechanism is a request to somebody else's server, so anything built on it has to
keep working when an upstream ignores it — which, since the reply still goes
through `verifyClaims`, it does.

**Do not ship it on this evidence.** §5 says the span-verify pass rate does not
move (86% against 88%) — the model does not invent more — but accepted claims
fall from 65 to 42 and a 30-document sample cannot separate a 48% recall from a
52% one when re-running *production's own setting* scores 52%. What it needs is
the sample that would settle it: `tools/claims/compare-providers.ts` already has
the shape (`--seq-ids` pins the corpus so two runs are comparable), and the
number to beat is claims accepted per hundred documents at equal span-verify
pass, over ~300 documents rather than 30.

`CLAIM_EFFORT=low` — the one rung the config *can* reach today — buys 7% and is
not worth a deployment.

### Not recommended

- **Lowering `CLAIM_MAX_TOKENS`** (32,000, `claim-provider.ts`). It would cap the
  runaways, but 4.2% of live calls already end at that ceiling with nothing to
  show (§3) and lowering it converts long-but-successful calls into failures. The
  ceiling is not what makes them long; the reasoning is.
- **In-worker document concurrency** inside `drain()`. It reaches the same place
  as replicas but has to re-argue the NSE pacing that `ENRICH_REQUEST_DELAY_MS`
  owns, and `k8s/20-enrichment.yaml` already argues the replica case.

---

## 10. What this cost, and what it touched

- **137 model calls** — 6 provider-capability probes, 2 smoke, 24 concurrency,
  105 effort sweep. **$0.42** total, all `deepseek/deepseek-v4-flash-0731`. Every
  one of the 129 measured calls was served by AtlasCloud; only the six probes
  drew Novita and GMICloud.
- **No writes to Mongo.** Every query in this document is a `find`, `count` or
  `aggregate`.
- **No exchange requests.** The 30 documents came from the on-disk parse cache
  (§2), verified character-exact against `enrichment.documentChars`.
- **No running process was touched.** The poller and the enrichment worker were
  live throughout.
- Scratch data, the sweep harness and the raw per-call JSONL are outside the
  repository, in `~/.claude/jobs/b8a6c401/tmp/`.
