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

## Phase 1 measurement

    npm run corpus:fetch -- --days 31
    npm run corpus:analyse

Reports the deterministic funnel and the per-day newsjack candidate count.

## How the no-loss guarantee works

A 2s hot poll reads NSE's 20-record live page. If the OLDEST seq_id on that page
is still newer than our cursor, the page turned over between polls and we cannot
prove continuity — so we drain the full IST day from the uncapped date-range
endpoint and reconcile. seq_id is a global counter across NSE streams, so gaps in
it are normal and are never used as a loss signal.

The cursor is the load-bearing piece, and it only moves on proof. It does not
move from an empty page, past a drain that failed, past a write that threw, or
backwards. Every one of those advances would lose filings permanently while
reporting success.

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
| `INGEST DRAIN FAILED` | The page rolled over but the day re-pull failed, so the gap is open. |
| `INGEST WRITE FAILED` | The database refused a batch; rows may be stored but never alerted.  |

Polling continues through all four. The circuit breaker decides when to speak
up, never whether to send the next request — a retry is the only thing that can
recover.

`INGEST DRAIN FAILED` is the one worth waking up for. The other three are loud
in their consequences; this one is not. The hot fetch still succeeds so the
breaker stays healthy, the cursor is held so no filing is skipped, and nothing
downstream misbehaves — the records inside the gap are simply never fetched. It
is the only alert that says the no-loss guarantee is currently not being met.

## Configuration

Every setting is read in `apps/ingest/src/config/configuration.ts` and nowhere
else. Numeric settings must be whole numbers `>= 1`; anything else stops the
process at startup naming the key. A blank assignment (`KEY=`) is read as unset
and falls back to the default.

| Variable               | Default                              | Purpose                                       |
| ---------------------- | ------------------------------------ | --------------------------------------------- |
| `MONGO_URI`            | `mongodb://localhost:27017/redbox`   | Storage.                                      |
| `TELEGRAM_BOT_TOKEN`   | _(empty)_                            | Unset ⇒ alerts are logged, not sent.          |
| `TELEGRAM_CHAT_ID`     | _(empty)_                            | Unset ⇒ alerts are logged, not sent.          |
| `NSE_HOT_INTERVAL_MS`  | `2000`                               | Poll interval inside 07:00–23:00 IST.         |
| `NSE_IDLE_INTERVAL_MS` | `30000`                              | Poll interval outside it.                     |
| `ALERT_WINDOW_MS`      | `600000`                             | Older filings are stored silently.            |
| `BURST_THRESHOLD`      | `8`                                  | New records at which the next poll is immediate. |
| `FAILURE_THRESHOLD`    | `3`                                  | Consecutive failures before `INGEST DEGRADED`.   |
| `WATCHLIST`            | _(empty)_                            | Comma-separated symbols; empty ⇒ alert on all.   |

## Tests

    npm test                 # unit and integration suites
    npm run test:cov         # coverage
    npm run lint
    npm run build

Beyond the suites, each component that carries a silent failure mode has a
committed mutation harness under `tools/mutation/`. Each breaks the
implementation one way at a time, re-runs the tests, and asserts the break is
caught:

    bash tools/mutation/poller-mutations.sh

## Design docs

- Spec: `docs/superpowers/specs/2026-08-05-filings-pipeline-design.md`
- Plan: `docs/superpowers/plans/2026-08-05-ingest-core.md`
