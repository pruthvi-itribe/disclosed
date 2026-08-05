/**
 * The signal handler that closes the dashboard.
 *
 * Extracted from `main.ts` rather than written inline, because it is the one
 * part of a bootstrap that is real behaviour instead of composition — it has a
 * re-entrancy latch and an error path, and both are silent when wrong. The
 * equivalent code in `apps/ingest/src/main.ts` carries the same latch and no
 * test can see it; `jest.config.js` says so in its own comment.
 */

/** The part of a Nest application this handler touches. */
export interface Closable {
  close(): Promise<void>;
}

export interface ShutdownDeps {
  readonly app: Closable;
  readonly log: (message: string) => void;
  readonly logError: (message: string) => void;
  /** Injected so a test can observe the exit instead of ending the run. */
  readonly exit: (code: number) => void;
  /** Renders a thrown value for the log line; `describeError` in production. */
  readonly describe: (error: unknown) => string;
}

/**
 * Builds a handler that closes the app once, whatever happens.
 *
 * THE LATCH IS THE POINT. A second Ctrl-C — which is exactly what an impatient
 * operator does when the first appears to hang — would otherwise start a second
 * teardown while the first is still running, closing the same server twice and
 * turning an orderly stop into an unhandled rejection.
 *
 * A failed close is LOGGED, never swallowed: it means the port is still held,
 * and the next start then fails with a bare EADDRINUSE that explains nothing.
 * The process still exits, because a viewer that will not die is worse than one
 * that dies untidily.
 *
 * The latch is the one piece of mutable state here and it is deliberate: "has
 * this already run" cannot be expressed as a new value when the whole purpose
 * is to be seen by the next call.
 */
export const createShutdownHandler = (
  deps: ShutdownDeps,
): ((signal: string) => Promise<void>) => {
  let closing = false;

  return async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;

    deps.log(`${signal} received, closing dashboard`);

    try {
      await deps.app.close();
    } catch (error) {
      deps.logError(`Shutdown failed: ${deps.describe(error)}`);
    }

    deps.exit(0);
  };
};
