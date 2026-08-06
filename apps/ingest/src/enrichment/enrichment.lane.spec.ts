import {
  makeShutdown,
  runEnrichmentLane,
  SHUTDOWN_SIGNALS,
  type LaneContext,
  type LaneLogger,
  type LaneRuntime,
  type LaneWorker,
} from './enrichment.lane';

class StubWorker implements LaneWorker {
  public starts = 0;
  public stops = 0;
  public startRejects: Error | null = null;
  /** Resolves once `start()` has been called, so a test need not count ticks. */
  public readonly started: Promise<void>;
  private announce!: () => void;
  /** Resolves the pending `start()`, so a test can drive the loop's lifetime. */
  private finish: (() => void) | null = null;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.announce = resolve;
    });
  }

  async start(): Promise<void> {
    this.starts += 1;
    this.announce();
    if (this.startRejects !== null) throw this.startRejects;
    await new Promise<void>((resolve) => {
      this.finish = resolve;
    });
  }

  stop(): void {
    this.stops += 1;
    this.finish?.();
  }
}

class StubLogger implements LaneLogger {
  public readonly lines: string[] = [];
  public readonly errors: string[] = [];

  log(message: string): void {
    this.lines.push(message);
  }

  error(message: string): void {
    this.errors.push(message);
  }
}

interface Harness {
  readonly runtime: LaneRuntime;
  readonly worker: StubWorker;
  readonly logger: StubLogger;
  readonly context: LaneContext;
  readonly exits: number[];
  readonly signals: Map<string, () => void>;
  readonly closes: { count: number };
}

function harness(
  overrides: {
    createRejects?: Error;
    initRejects?: Error;
    closeRejects?: Error;
    startRejects?: Error;
  } = {},
): Harness {
  const worker = new StubWorker();
  worker.startRejects = overrides.startRejects ?? null;
  const logger = new StubLogger();
  const exits: number[] = [];
  const signals = new Map<string, () => void>();
  const closes = { count: 0 };

  const context: LaneContext = {
    describeConfig: () => 'mongo=mongodb://x enrich=on',
    initModel: async () => {
      if (overrides.initRejects) throw overrides.initRejects;
    },
    worker: () => worker,
    close: async () => {
      closes.count += 1;
      if (overrides.closeRejects) throw overrides.closeRejects;
    },
  };

  const runtime: LaneRuntime = {
    logger,
    exit: (code) => exits.push(code),
    onSignal: (signal, handler) => signals.set(signal, handler),
    createContext: async () => {
      if (overrides.createRejects) throw overrides.createRejects;
      return context;
    },
  };

  return { runtime, worker, logger, context, exits, signals, closes };
}

describe('runEnrichmentLane', () => {
  it('boots, reports the configuration, and drains', async () => {
    const h = harness();
    const running = runEnrichmentLane(h.runtime);

    // The loop is still running: `start()` has been entered and has not resolved.
    await h.worker.started;
    expect(h.worker.starts).toBe(1);
    expect(h.logger.lines).toContain('mongo=mongodb://x enrich=on');
    expect(h.logger.lines).toContain('Starting the enrichment drain loop');

    h.worker.stop();
    await running;
    expect(h.exits).toEqual([]);
  });

  it.each(SHUTDOWN_SIGNALS)('stops on %s', async (signal) => {
    const h = harness();
    const running = runEnrichmentLane(h.runtime);
    await h.worker.started;

    h.signals.get(signal)?.();
    await running;

    expect(h.worker.stops).toBe(1);
    expect(h.closes.count).toBe(1);
    expect(h.exits).toEqual([0]);
  });

  it('registers a handler for every shutdown signal', async () => {
    const h = harness();
    const running = runEnrichmentLane(h.runtime);
    await h.worker.started;

    expect([...h.signals.keys()].sort()).toEqual([...SHUTDOWN_SIGNALS].sort());

    h.worker.stop();
    await running;
  });

  it.each([
    ['the container will not boot', { createRejects: new Error('mongo down') }],
    ['the indexes will not build', { initRejects: new Error('index failed') }],
    ['the loop rejects outright', { startRejects: new Error('loop died') }],
  ])('exits non-zero when %s', async (_label, overrides) => {
    const h = harness(overrides);

    await runEnrichmentLane(h.runtime);

    expect(h.exits).toEqual([1]);
    expect(h.logger.errors.join(' ')).toContain('failed to start');
  });

  it('never starts the worker when the indexes will not build', async () => {
    // Draining against a collection with no claim index is a scan per tick
    // against the collection the poller is inserting into.
    const h = harness({ initRejects: new Error('index failed') });
    await runEnrichmentLane(h.runtime);
    expect(h.worker.starts).toBe(0);
  });
});

describe('makeShutdown', () => {
  const build = (overrides: { closeRejects?: Error } = {}) => {
    const h = harness(overrides);
    const shutdown = makeShutdown(h.context, h.worker, h.runtime);
    return { ...h, shutdown };
  };

  it('stops the worker before it closes the container', async () => {
    // The idle sleep is ten seconds. Closing first would tear the container
    // down underneath a loop that is still going to wake up and query.
    const order: string[] = [];
    const h = harness();
    const worker: LaneWorker = {
      start: async () => undefined,
      stop: () => order.push('stop'),
    };
    const context: LaneContext = {
      ...h.context,
      close: async () => {
        order.push('close');
      },
    };

    await makeShutdown(context, worker, h.runtime)('SIGTERM');

    expect(order).toEqual(['stop', 'close']);
  });

  it('is safe to call twice, so a second Ctrl-C is a no-op', async () => {
    const { shutdown, worker, closes, exits } = build();

    await shutdown('SIGINT');
    await shutdown('SIGINT');

    expect(worker.stops).toBe(1);
    expect(closes.count).toBe(1);
    expect(exits).toEqual([0]);
  });

  it('latches before the close resolves, not after', async () => {
    // The realistic double signal arrives WHILE the first teardown is still in
    // flight. A latch set after the await would let the second one through.
    const { shutdown, closes } = build();

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGTERM')]);

    expect(closes.count).toBe(1);
  });

  it('still exits when the container will not close', async () => {
    const { shutdown, logger, exits } = build({
      closeRejects: new Error('connection already gone'),
    });

    await shutdown('SIGTERM');

    expect(logger.errors.join(' ')).toContain('Shutdown failed');
    expect(exits).toEqual([0]);
  });

  it('names the signal it acted on', async () => {
    const { shutdown, logger } = build();
    await shutdown('SIGTERM');
    expect(logger.lines.join(' ')).toContain('SIGTERM received');
  });
});
