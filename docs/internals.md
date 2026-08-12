# Internals

The load-bearing arguments, kept out of the README's way but not out of the
repo. Each section was written when the mechanism shipped and is kept truthful
as measurements change.

## The no-loss guarantee

Three mechanisms, and they are independent on purpose.

**The database decides what is new.** A 2s hot poll reads NSE's 20-record live
page and offers the WHOLE page to `insertNew` every time; the unique index on
`seqId` rejects what we already hold. The cursor is not a newness filter.
`seq_id` is not the total order the design assumed — measured over a recorded
32-day corpus, 414 of 17,442 filings (2.37%, ~13/day, on 23 of 32 IST days) are
disseminated with an id BELOW the stream position, including adjacent-id
reversals two seconds apart and block excursions of 84,000 ids followed by a
descending run. Filtering on `id > cursor` discards every one of them silently.

**Rollover detection.** If the OLDEST seq_id on the page is still newer than the
cursor, the page turned over between polls and continuity cannot be proved, so
the day is re-pulled from the uncapped date-range endpoint and reconciled. Gaps
in `seq_id` are normal — it is a global counter across NSE streams — and are
never used as a loss signal.

**Scheduled reconciliation.** Rollover alone is not enough, and the corpus says
why: no 2-second window holds more than 6 filings and no 30-second window more
than 9, against a 20-record page, so the page cannot roll at the poll cadence.
Replaying all 32 days fires rollover ONCE. So the day is also re-pulled every
`NSE_DRAIN_INTERVAL_MS` regardless, and once more at 23:30 IST to close the day.
Each drain runs from the IST day of the newest record already stored through
now, bounded to 7 days — a drain of today alone cannot close a hole that spans
IST midnight, because the day rolls at 18:30 UTC.

The cursor still only moves on proof, and only forward. It does not move from an
empty page, past a rollover drain that failed, past a write that threw, or
backwards — a backwards step would report a hole on every subsequent poll and
re-drain the day forever.

## What stops a restart re-alerting the whole day

Two independent gates, because either alone is a single point of failure:

- **The unique index on `seqId`.** `insertNew` does not decide for itself
  whether a filing is new; it asks the database to reject the ones it already
  holds, and alerts only on what comes back. `assertIndexes()` runs at startup
  and stops the process if that index is missing, because without it every
  re-seen filing reads as new and the alert gate inverts.
- **The alert window.** A cold start drains a day of filings that are all new to
  an empty database. Anything disseminated more than `ALERT_WINDOW_MS` ago is
  stored silently and logged, never sent.

## When it goes quiet

A silent pipeline and a quiet market look identical from outside, so each way of
going silent has its own operator alert, sent once per episode rather than once
per poll:

| Alert                 | Means                                                               |
| --------------------- | ------------------------------------------------------------------- |
| `INGEST DEGRADED`     | N consecutive poll failures — usually Akamai blocking the requests.  |
| `INGEST BLIND`        | NSE returned records and every one failed to map (format change).    |
| `INGEST RECORDS SKIPPED` | Some records failed to map and the rest were ingested.           |
| `INGEST DRAIN FAILED` | A day re-pull failed, so a gap it would have closed is still open.   |
| `INGEST WRITE FAILED` | The database refused a batch; rows may be stored but never alerted.  |

Polling continues through all five. The circuit breaker decides when to speak
up, never whether to send the next request — a retry is the only thing that can
recover.

`INGEST RECORDS SKIPPED` is the quietest of the five and the reason it exists:
a page where nineteen of twenty records map looks identical to a healthy poll in
every other signal — the fetch succeeded, filings arrived, the breaker is clean,
the cursor moved. The scheduled drain re-offers the whole day indefinitely, so
fixing the mapper recovers those records without a backfill.

It is also the only one of the five that watches **two** fetch surfaces, so it
carries two independent latches — one for the live page, one for the drained IST
day — and each is re-armed only by its own surface coming back clean. A single
shared latch does not hold: a skip on the drained day is visible on drain polls
alone, the sweeps are 5 minutes apart, and the ~150 clean hot polls in between
re-armed it every time. One persistently unmappable record produced 7 alerts
across 30 simulated minutes that way, or roughly 288 a day at the shipped
interval — the same flood that mutes the channel every alert above shares. So a
poll in which BOTH surfaces are dropping records sends two messages, one per
surface, and a persistent skip on either sends exactly one until it clears.

`INGEST DRAIN FAILED` is the one worth waking up for. The others are loud
in their consequences; this one is not. The hot fetch still succeeds so the
breaker stays healthy, the cursor is held so no filing is skipped, and nothing
downstream misbehaves — the records inside the gap are simply never fetched. It
is the only alert that says the no-loss guarantee is currently not being met.

## Why the dashboard is a separate application

`apps/ingest` has no HTTP server: it runs
`NestFactory.createApplicationContext`, and `@nestjs/platform-express` is
deliberately absent from it because it pulls in `multer`, whose advisory
history is a run of high-severity denial-of-service reports, for a process that
serves nothing. The dashboard is where that dependency lives. It registers no
multipart route, runs with `bodyParser: false` for JSON handled by Nest's own
pipeline, and `package.json` carries `overrides` pinning `multer`, `express`,
`body-parser` and `qs` past the advisories that `@nestjs/platform-express@10`
would otherwise pin in — `npm audit --omit=dev` reports the same findings with
the dashboard as without it. The reasoning is written out at the top of
`apps/dashboard/src/dashboard.module.ts`.

**Filing reads are structurally read-only.** The query service is handed a
`FilingReadModel` — the mongoose model narrowed to `find`, `findOne`,
`countDocuments` and `aggregate` — so a write to the filings collection is a
compile error, not a review comment. It connects with `autoIndex: false`, so it
cannot create an index behind the poller. That matters because it shares a live
collection: a stray write would corrupt the cursor the poller resumes from.
(The dashboard does write to its **own** collections — users, sessions,
watchlists — which the ingest never touches; the boundary is per-collection,
enforced by which models each app is handed.)

**All times shown are IST**, rendered server-side from
`libs/common/src/ist.ts` — the one definition of the offset in the codebase.
The browser is never asked to format a stored instant, because a browser left
on UTC would render every filing five and a half hours early and look entirely
normal doing it.

## The Admin view is local-only

The Admin tab is the instrument panel: the filings table, the enrichment and
refusal breakdowns, the parse routes, the confidence tiers and the daily bars.
Every one of those describes **this pipeline** rather than a company — how much
it refused, how much it could not read, how far behind it is. That is useful on
a laptop and is nobody else's business.

So it is not hidden behind a role. It is **not shipped**:

- no Admin tab and no Admin section in the served HTML — absent, not `hidden`;
- no Admin fragment in the inlined script, so none of its renderers exist;
- its API routes answer **404**.

404 rather than 403, because 403 says "this exists and you may not have it" —
which is a fact about our machinery given to whoever asked. 404 says what is
true on that host. The session guard stays on all of them: this is a second
condition, never a replacement for one.

**The rule.** `ADMIN_ENABLED=true|false` is explicit and wins in both
directions. Unset, the panel is built when `NODE_ENV` is not `production`
**and** `PUBLIC_ORIGIN` names this machine (`127.0.0.1`, `localhost`, `[::1]`).

Two signals, both required, because either alone is one line an operator can
forget. `NODE_ENV` is a convention nothing enforces — a server started without
it looks exactly like a laptop. And the loopback *bind* cannot discriminate:
`DASHBOARD_HOST` is hard-coded to `127.0.0.1` and deliberately not
configurable, so every deployment binds loopback, including the one behind the
public reverse proxy. What separates them is `PUBLIC_ORIGIN`, which is not
optional there — leave it at the loopback default and every mutation from the
real page is refused by the origin guard. A host serving the internet has
therefore necessarily set it. An origin that cannot be parsed is not loopback,
so the gate fails closed.

The startup line says which way it went: `admin=on` or `admin=off`.

## Running Docling outside compose

The shipped path is `docker compose up -d` — a pinned `docling-serve` on host
port 5501 with a memory cap, a restart policy, and a single conversion at a
time (each of those three lines exists because of a real incident recorded in
the compose file's comments). To run it without Docker (needs Python 3.10+,
with [`uv`](https://github.com/astral-sh/uv)):

```bash
uv venv --python 3.13 .venv-docling
uv pip install --python .venv-docling/bin/python docling-serve

# Models (~1 GB) download on the first conversion, not at startup.
DOCLING_SERVE_MAX_SYNC_WAIT=1800 \
  .venv-docling/bin/docling-serve run --host 127.0.0.1 --port 5001
```

Then set `DOCLING_URL` accordingly and restart the workers.

`DOCLING_SERVE_MAX_SYNC_WAIT` is not optional in practice. It defaults to **120
seconds**, and past it the service answers **504 while still completing the
conversion** — a live run lost a 15-page scan that finished in 131 seconds
exactly that way. Set it above `DOCLING_TIMEOUT_MS`.

Bind it to `127.0.0.1`. `docling-serve run` defaults to `0.0.0.0`, and this is
an unauthenticated service that converts arbitrary uploaded files.

**When it is not there, nothing fails.** Every failure resolves to "keep what
the fast parser already gave us and write down that we did":

- `enrichment.parseRoute` records which parser actually read the document;
- `enrichment.parseRouteReason` records why the router chose it — so an absent
  Docling shows up as a rising count in a day, not as three silent ones (that
  outage happened; the field exists because of it);
- `enrichment.parseFallbackReason` records a parser that was chosen and did
  not run.

A failure to *reach* the service opens an availability latch for
`DOCLING_COOLDOWN_MS`, so a service that is down does not cost the full timeout
on every filing. The latch opens only when **no response arrived at all** — an
HTTP status is proof the service is alive, and treating a 504 on one oversized
document as an outage skipped 19 convertible filings behind it in a live run.

**Re-reading filings already marked unreadable.** `unparseable` is terminal by
design. After starting Docling for the first time, raster scans recorded as
`no-text-layer` need an explicit sweep:

```bash
npm run enrich:requeue -- --reason no-text-layer            # dry run
npm run enrich:requeue -- --reason no-text-layer --write
```

The sweep reads `DOCLING_URL` itself and refuses these filings when it is
unset, because on a machine with no OCR parser it would spend archive requests
to re-measure the same zero characters.

## Mutation harnesses

Beyond the suites, each component that carries a silent failure mode has a
committed mutation harness under `tools/mutation/`. Each breaks the
implementation one way at a time, re-runs the tests, and asserts the break is
caught:

```bash
bash tools/mutation/poller-mutations.sh
```

A harness distinguishes CAUGHT, SURVIVED (a real test gap), NO-OP (the pattern
matched nothing, so the harness is stale after a refactor), COMPILE (the mutant
did not type-check, so no assertion ran) and HARNESS ERROR (jest never reached a
suite). Only CAUGHT is a pass; every other verdict fails the exit code except
CRASHED, which requires positive evidence that jest reached a suite before it
may be scored as a kill.

## Corpus measurement

```bash
npm run corpus:fetch -- --days 31
npm run corpus:analyse
```

Reports the deterministic funnel over a recorded corpus — the numbers cited
throughout the code's comments come from sweeps like this one, and the
convention is that changing a threshold means re-running the sweep, not
re-guessing.
