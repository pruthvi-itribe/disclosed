import { describeError, stackOf } from '@app/common';

/**
 * Whether the ingest process runs the enrichment worker itself.
 *
 * ================================================================
 * DETACHED IS NOT THE SAME AS OFF THE HOT PATH
 * ================================================================
 *
 * Running the worker in-process puts a second async loop in the poller's
 * process, and Node runs both on one thread. `pdf-parse` is not I/O: parsing a
 * PDF is CPU work inside pdf.js with no `await` for the event loop to escape
 * through, and while it runs the poller's timers do not fire. The poller's
 * budget is two seconds and it is the reason this project exists.
 *
 * So `ENRICH_IN_PROCESS=false` moves the lane into its own OS process
 * (`npm run start:enrichment`), which is the only arrangement that genuinely
 * guarantees the budget. It is opt-in rather than the default so a
 * single-process deployment keeps working unchanged.
 *
 * ================================================================
 * WHY THIS IS A MODULE AND NOT THREE LINES IN main.ts
 * ================================================================
 *
 * There are three outcomes and each one has a different consequence an operator
 * has to be told about — the lane is running here, the lane is expected
 * somewhere else, or the lane is off entirely and no filing will carry an
 * amount, a counterparty, a headline or a claim. The middle one is the
 * dangerous one: a process that is *not* running the worker and a worker that
 * has nothing to do produce identical silence, so the message has to say which
 * this is. Written inline in `main.ts` none of that is reachable by a test.
 */

/** The worker, narrowed to the one call this makes. */
export interface StartableLane {
  start(): Promise<void>;
}

export interface LaneNotifier {
  log(message: string): void;
  warn(message: string): void;
  error(message: string, stack?: string): void;
}

export interface InProcessConfig {
  readonly enrichmentEnabled: boolean;
  readonly enrichmentInProcess: boolean;
}

/**
 * Starts the worker here, or says why it did not.
 *
 * DETACHED WHEN IT DOES START, deliberately. The worker must not be able to
 * stop the poller: its failures cost an amount, the poller's failures cost a
 * filing. It is contained by its own `tick()` contract, so the catch here is
 * the last resort for a rejection that escapes `start()` itself.
 *
 * @returns whether the worker was started in this process.
 */
export function startInProcessLane(
  config: InProcessConfig,
  worker: StartableLane,
  logger: LaneNotifier,
): boolean {
  if (!config.enrichmentEnabled) {
    logger.warn(
      'ENRICH_ENABLED is off: source PDFs will not be read, so no filing ' +
        'will carry an amount, a counterparty, a composed headline or a claim.',
    );
    return false;
  }

  if (!config.enrichmentInProcess) {
    logger.log(
      'ENRICH_IN_PROCESS is off: this process polls only. The enrichment lane ' +
        'is expected to run separately (npm run start:enrichment); if it is ' +
        'not running, nothing will read a source PDF and the queue will grow.',
    );
    return false;
  }

  void worker.start().catch((error: unknown) => {
    logger.error(
      `Enrichment worker stopped: ${describeError(error)}`,
      stackOf(error),
    );
  });
  return true;
}
