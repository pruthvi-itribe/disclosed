/**
 * pdf.js repeats two lines until the log is useless, and cannot be asked to stop.
 *
 * MEASURED at the first production deploy, 2026-08-13: one enrichment worker
 * wrote 43,628 log lines in about ten minutes, almost all of them
 * `Warning: Ran out of space in font private use area`. Pod logs are this
 * deployment's only observability — nothing aggregates them and they die with
 * the pod — so `kubectl logs --tail=60` returned font warnings and nothing
 * about what the pipeline had decided. Finding three real lines meant grepping
 * forty-three thousand.
 *
 * ================================================================
 * WHY THE SUPPORTED SWITCH DOES NOT WORK, MEASURED BEFORE CHOOSING THIS
 * ================================================================
 *
 * pdf.js has a `verbosity` level, and setting it does nothing here. Two facts
 * from the bundled build, both checked rather than assumed:
 *
 *   1. The font warning exists ONLY in `pdf.worker.js`, not in `pdf.js`. The
 *      worker is a separate module with its own copy of the utility that holds
 *      the level, so the main thread's setting is not the one consulted.
 *   2. The main thread forwards its level to the worker with a `configure`
 *      message sent ONLY on the real-worker branch. `pdf-parse` sets
 *      `disableWorker = true`, which takes the `_setupFakeWorker()` path, and
 *      that path never sends it.
 *
 * So the level cannot reach the code that prints. Filtering the output is not
 * the lazy option here; it is the only one that touches the actual emitter.
 *
 * ================================================================
 * WHAT MAKES A FILTER ACCEPTABLE IN A CODEBASE THAT REFUSES SILENT FALLBACKS
 * ================================================================
 *
 * Two rules, and the second is the important one.
 *
 * ONLY LINES ON THE LIST ARE TOUCHED. Every other line — including pdf.js's
 * own `Warning: Indexing all PDF objects`, which says a document's cross
 * reference table was damaged and had to be rebuilt — passes through
 * unchanged. This is an allowlist of known noise, never a pattern for
 * "warnings".
 *
 * NOTHING IS DISCARDED WITHOUT SAYING SO. Suppressed lines are counted and the
 * running total is printed every `SUMMARISE_EVERY`, so the log records the
 * volume even though it no longer carries every line. "Nothing was noisy" and
 * "forty thousand lines were" stay different facts, which is the whole of the
 * fail-loudly rule as it applies here.
 */

/**
 * The lines this filter is allowed to swallow.
 *
 * ANCHORED AT BOTH ENDS, deliberately. An unanchored `Ran out of space` would
 * also match a future message that embedded it in a sentence carrying a page
 * number or a file name — which would be information, and would disappear.
 */
export const PDFJS_NOISE: readonly RegExp[] = [
  /^Warning: Ran out of space in font private use area\.?$/,
  /^Warning: TT: undefined function: \d+$/,
];

/**
 * How many suppressed lines pass before the count is printed.
 *
 * 1,000, from the measured 43,628-in-ten-minutes rate: that turns the worst
 * observed burst into about 44 lines, which a human can scroll past, while
 * still making the volume impossible to miss. A larger number would hide a
 * pathological document; a smaller one recreates the problem.
 */
export const SUMMARISE_EVERY = 1000;

/** Whether a line is pdf.js noise this filter may swallow. */
export const isPdfNoise = (line: string): boolean =>
  PDFJS_NOISE.some((pattern) => pattern.test(line));

/**
 * A filter over one log sink.
 *
 * Built as a factory around its own counter rather than reading a module
 * global, so a test can drive it without touching the real console and two
 * instances cannot interfere.
 */
export const createPdfLogFilter = (
  emit: (line: string) => void,
  summariseEvery: number = SUMMARISE_EVERY,
): ((line: string) => void) => {
  let suppressed = 0;

  return (line: string): void => {
    if (!isPdfNoise(line)) {
      emit(line);
      return;
    }

    suppressed += 1;
    if (suppressed % summariseEvery === 0) {
      emit(
        `pdf.js font warnings suppressed: ${suppressed} so far ` +
          `(see libs/filings/src/pdf/pdf-log-noise.ts)`,
      );
    }
  };
};

let installed = false;

/**
 * Wraps `console.log` once, for the process that actually parses PDFs.
 *
 * Called from `defaultPdfParser()`, which is already the one seam that owns
 * loading pdf.js — so a process that never parses never has its console
 * touched, and the dashboard is one of those.
 *
 * `console.log` and not `console.error`: pdf.js's `warn()` writes to `log`,
 * which is also why this cannot be done by pointing a stream somewhere.
 */
export function installPdfLogFilter(): void {
  if (installed) return;
  installed = true;

  const real = console.log.bind(console);
  const filter = createPdfLogFilter((line) => {
    real(line);
  });

  console.log = (...args: unknown[]): void => {
    // Only a single string argument can be one of pdf.js's warnings — it
    // builds them by concatenation before calling. Anything else is somebody
    // else's logging and is passed through untouched rather than joined and
    // pattern-matched, which would risk mangling an object dump.
    if (args.length === 1 && typeof args[0] === 'string') {
      filter(args[0]);
      return;
    }
    real(...args);
  };
}
