import { describeError, stackOf } from '@app/common';

/**
 * Running the enrichment lane as a process of its own.
 *
 * ================================================================
 * WHY A SECOND PROCESS AND NOT JUST A SECOND LOOP
 * ================================================================
 *
 * `main.ts` can run the worker in-process, and for a small deployment that is
 * the right shape — one process, one thing to supervise. But "off the hot path"
 * has to mean more than "in a different async function", because Node runs both
 * loops on one thread and `pdf-parse` is not I/O. Parsing a PDF is CPU work
 * inside pdf.js with no `await` for the event loop to escape through, and while
 * it runs the poller's timers do not fire. The poller's budget is two seconds
 * and it is the reason this project exists, so the strongest available answer is
 * a separate OS process with its own event loop: a twenty-megabyte investor
 * presentation can then occupy a core for a second without the poller noticing.
 *
 * NOTHING IS DUPLICATED. The process boots the same `IngestModule`, so the
 * worker gets the same repository, fetcher, validated configuration and
 * politeness pacing as the in-process one. `PollerService` is constructed and
 * never started — a provider is inert until something calls it — so this process
 * polls nothing and holds no NSE session.
 *
 * RUNNING BOTH AT ONCE IS SAFE. Two workers cannot fetch the same document
 * twice: the claim is a single atomic `findOneAndUpdate` that stamps a lease
 * before the fetch begins. That is what makes this deployable without a flag
 * day — start the second process, then turn `ENRICH_IN_PROCESS` off at the next
 * restart of the first.
 *
 * ================================================================
 * WHY THIS IS A MODULE AND NOT THE ENTRYPOINT
 * ================================================================
 *
 * Everything below takes its world as an argument. A bootstrap that reaches for
 * `NestFactory`, `process.on` and `process.exit` directly is a file no test can
 * run, and the parts worth testing are exactly the parts that only run when
 * something has gone wrong: the re-entrancy latch that stops a second Ctrl-C
 * starting a second teardown, the stop-before-close ordering that keeps a
 * SIGTERM from waiting out the idle interval, and the container close that must
 * be logged rather than thrown. `enrichment.main.ts` supplies the real world;
 * the spec supplies a fake one.
 */

/** The two calls the lane makes into the worker. */
export interface LaneWorker {
  start(): Promise<void>;
  stop(): void;
}

/** A booted application container, narrowed to what the lane needs. */
export interface LaneContext {
  /**
   * Waits for the indexes the schema declares. The claim query is served by
   * `enrichment_state_1_disseminatedAt_-1`, and this process may well be the
   * first thing to run after the schema changed; awaiting the build removes the
   * race where the first claim runs as a collection scan against a collection
   * the poller is inserting into.
   */
  initModel(): Promise<void>;
  /** The effective configuration, secrets named but not printed. */
  describeConfig(): string;
  worker(): LaneWorker;
  close(): Promise<void>;
}

export interface LaneLogger {
  log(message: string): void;
  error(message: string, stack?: string): void;
}

/** Everything the lane needs from outside itself. */
export interface LaneRuntime {
  createContext(): Promise<LaneContext>;
  onSignal(signal: string, handler: () => void): void;
  exit(code: number): void;
  readonly logger: LaneLogger;
}

/** The signals a supervisor uses to ask a process to stop. */
export const SHUTDOWN_SIGNALS: readonly string[] = ['SIGINT', 'SIGTERM'];

/**
 * Builds the shutdown handler.
 *
 * IDEMPOTENT BY CONSTRUCTION. A supervisor that sends SIGTERM and then SIGKILL,
 * or an operator pressing Ctrl-C twice, must not start a second teardown while
 * the first is still closing the mongo connection out from under it.
 *
 * The ORDER is load-bearing: `stop()` first, `close()` second. `stop()` cuts the
 * worker's idle sleep short, and that sleep is ten seconds — long enough that
 * closing first would leave the container tearing down underneath a loop that is
 * still going to wake up and issue a query.
 */
export function makeShutdown(
  context: LaneContext,
  worker: LaneWorker,
  runtime: LaneRuntime,
): (signal: string) => Promise<void> {
  let closing = false;

  return async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;

    runtime.logger.log(`${signal} received, stopping the enrichment worker`);
    worker.stop();

    try {
      await context.close();
    } catch (error) {
      // Logged, never rethrown. A container that will not close cleanly is
      // worth knowing about and is not worth hanging the process over.
      runtime.logger.error(`Shutdown failed: ${describeError(error)}`);
    }
    runtime.exit(0);
  };
}

/**
 * Boots the container, wires the signals, and drains until told to stop.
 *
 * The worker's `start()` is AWAITED here, unlike in `main.ts` where it is
 * detached. There it is a second loop that must not be able to stop the poller;
 * here it is the only thing the process does, so a rejection escaping it has to
 * stop the process rather than leave it alive and idle — which would look
 * exactly like a queue with nothing in it.
 */
export async function runEnrichmentLane(runtime: LaneRuntime): Promise<void> {
  try {
    // Creating the context validates the configuration, so a malformed setting
    // stops the process here rather than at the first fetch.
    const context = await runtime.createContext();
    runtime.logger.log(context.describeConfig());
    await context.initModel();

    const worker = context.worker();
    const shutdown = makeShutdown(context, worker, runtime);
    for (const signal of SHUTDOWN_SIGNALS) {
      runtime.onSignal(signal, () => void shutdown(signal));
    }

    runtime.logger.log('Starting the enrichment drain loop');
    await worker.start();
  } catch (error) {
    runtime.logger.error(
      `Enrichment worker failed to start: ${describeError(error)}`,
      stackOf(error),
    );
    runtime.exit(1);
  }
}
