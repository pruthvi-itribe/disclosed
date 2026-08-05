# Redbox — NSE filings ingest

Low-latency ingest of NSE corporate announcements with a no-loss guarantee,
feeding a Telegram alert lane.

## Quick start

    docker compose up -d
    cp .env.example .env      # set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
    npm install --legacy-peer-deps
    npm run start:dev

Without Telegram credentials the pipeline still boots, polls and persists —
alerts are written to the log instead. That is deliberate: a missing
notification channel must never become a total outage.

## Watching it work

    npm run start:dashboard    # then open http://127.0.0.1:7717

A separate, **read-only** Nest application (`apps/dashboard`) that serves one
self-contained HTML page and four JSON routes. It polls itself every four
seconds, so filings appear as they land.

| Route             | Returns                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `/`               | The page. Inline CSS and JS, no CDN, no external font, no build step.      |
| `/api/summary`    | Total, count for the current IST day, newest `disseminatedAt`, max `seqId`, feed lag. |
| `/api/filings`    | Newest-first page. `?limit=&offset=&symbol=&category=`                     |
| `/api/categories` | Category breakdown with counts, largest first. `?limit=`                   |
| `/api/daily`      | Filings per IST day, zero-filled, oldest first. `?days=`                   |

Every JSON route answers with `{ success, data, error, meta }`. A malformed
query is a `400` naming the key, never a silently applied default.

**It is a separate application on purpose, and must stay one.** `apps/ingest`
has no HTTP server: it runs `NestFactory.createApplicationContext`, and
`@nestjs/platform-express` is deliberately absent from it because it pulls in
`multer`, whose advisory history is a run of high-severity denial-of-service
reports, for a process that serves nothing. The dashboard is where that
dependency lives. It registers no multipart route, runs with `bodyParser: false`
so no request body is read at all, and `package.json` carries `overrides`
pinning `multer`, `express`, `body-parser` and `qs` past the advisories that
`@nestjs/platform-express@10` would otherwise pin in — `npm audit --omit=dev`
reports the same findings with the dashboard as without it. The reasoning is
written out at the top of `apps/dashboard/src/dashboard.module.ts`.

**It never writes.** The query service is handed a `FilingReadModel` — the
mongoose model narrowed to `find`, `findOne`, `countDocuments` and `aggregate` —
so a write is a compile error, not a review comment. It also connects with
`autoIndex: false`, so it cannot even create an index behind the poller. That
matters because it shares a live collection: a stray write would corrupt the
cursor the poller resumes from.

**All times shown are IST**, rendered server-side from
`libs/common/src/ist.ts` — the one definition of the offset in the codebase. The
browser is never asked to format a stored instant, because a browser left on UTC
would render every filing five and a half hours early and look entirely normal
doing it.

## Phase 1 measurement

    npm run corpus:fetch -- --days 31
    npm run corpus:analyse

Reports the deterministic funnel and the per-day newsjack candidate count.

## How the no-loss guarantee works

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

`INGEST DRAIN FAILED` is the one worth waking up for. The other three are loud
in their consequences; this one is not. The hot fetch still succeeds so the
breaker stays healthy, the cursor is held so no filing is skipped, and nothing
downstream misbehaves — the records inside the gap are simply never fetched. It
is the only alert that says the no-loss guarantee is currently not being met.

## Configuration

Every ingest setting is read in `apps/ingest/src/config/configuration.ts` and
nowhere else; the dashboard's own port is read in
`apps/dashboard/src/config/configuration.ts` and nowhere else. Numeric settings
must be whole numbers `>= 1`; anything else stops the process at startup naming
the key. A blank assignment (`KEY=`) is read as unset and falls back to the
default.

| Variable               | Default                              | Purpose                                       |
| ---------------------- | ------------------------------------ | --------------------------------------------- |
| `MONGO_URI`            | `mongodb://localhost:27117/redbox`   | Storage. Read by both apps.                   |
| `DASHBOARD_PORT`       | `7717`                               | Dashboard listen port, 1024–65535. Always bound to `127.0.0.1`; the interface is not configurable. |
| `TELEGRAM_BOT_TOKEN`   | _(empty)_                            | Unset ⇒ alerts are logged, not sent.          |
| `TELEGRAM_CHAT_ID`     | _(empty)_                            | Unset ⇒ alerts are logged, not sent.          |
| `NSE_HOT_INTERVAL_MS`  | `2000`                               | Poll interval inside 07:00–23:00 IST.         |
| `NSE_IDLE_INTERVAL_MS` | `30000`                              | Poll interval outside it.                     |
| `NSE_DRAIN_INTERVAL_MS` | `300000`                            | How often the whole IST day is reconciled.    |
| `TELEGRAM_MIN_SEND_INTERVAL_MS` | `1000`                      | Minimum gap between two Telegram sends.       |
| `ALERT_WINDOW_MS`      | `600000`                             | Older filings are stored silently.            |
| `BURST_THRESHOLD`      | `8`                                  | New records at which the next poll is immediate. |
| `FAILURE_THRESHOLD`    | `3`                                  | Consecutive failures before `INGEST DEGRADED`.   |
| `WATCHLIST`            | _(empty)_                            | Comma-separated symbols; empty ⇒ alert on all.   |

### The shipped watchlist is a firehose

`WATCHLIST=` means alert on every non-routine filing, and that is the value
`.env.example` ships. Measured over the recorded 32-day corpus, 12,415 of 17,442
filings (71.2%) clear the routine-category gate — about **388 Telegram messages
a day, peaking at 106 in one hour.**

A channel at that volume gets muted within a day, and every operator alert in
the table above is muted with it, so the pipeline goes dark exactly when it most
needs to be heard. The semantics are deliberately unchanged — an operator who
wants the whole feed should get it — but the poller logs a startup WARNING
naming these numbers whenever the watchlist is empty. Set one before pointing
this at a chat you rely on.

## Tests

    npm test                 # unit and integration suites
    npm run test:cov         # coverage, with the threshold enforced
    npm run lint
    npm run build

`jest.config.js` carries a `coverageThreshold`, so the bar is enforced rather
than aspirational. `main.ts` and `ingest.module.ts` stay in the report at 0%
rather than being excluded to flatter the number: they are composition, verified
by running the process, and hiding them would also hide `main.ts`'s shutdown
re-entrancy latch, which no test covers.

The dashboard's equivalent latch is the exception: it lives in
`apps/dashboard/src/lifecycle/shutdown.ts` rather than inline in `main.ts`
precisely so it can be tested, including the race where a second signal arrives
while the first close is still in flight. `apps/dashboard/src/dashboard.e2e.spec.ts`
boots the real module against an in-memory mongod on a loopback port and drives
the routes over HTTP, so the module wiring is covered too.

Beyond the suites, each component that carries a silent failure mode has a
committed mutation harness under `tools/mutation/`. Each breaks the
implementation one way at a time, re-runs the tests, and asserts the break is
caught:

    bash tools/mutation/poller-mutations.sh

A harness distinguishes CAUGHT, SURVIVED (a real test gap), NO-OP (the pattern
matched nothing, so the harness is stale after a refactor), COMPILE (the mutant
did not type-check, so no assertion ran) and HARNESS ERROR (jest never reached a
suite). Only CAUGHT is a pass; every other verdict fails the exit code except
CRASHED, which requires positive evidence that jest reached a suite before it
may be scored as a kill.

## Design docs

- Spec: `docs/superpowers/specs/2026-08-05-filings-pipeline-design.md`
- Plan: `docs/superpowers/plans/2026-08-05-ingest-core.md`
