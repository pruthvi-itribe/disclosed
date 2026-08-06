import { startInProcessLane, type LaneNotifier } from './in-process-lane';

class Recorder implements LaneNotifier {
  public readonly logs: string[] = [];
  public readonly warns: string[] = [];
  public readonly errors: string[] = [];

  log(message: string): void {
    this.logs.push(message);
  }
  warn(message: string): void {
    this.warns.push(message);
  }
  error(message: string): void {
    this.errors.push(message);
  }
}

const worker = (rejects: Error | null = null) => {
  const calls = { starts: 0 };
  return {
    calls,
    start: async (): Promise<void> => {
      calls.starts += 1;
      if (rejects !== null) throw rejects;
    },
  };
};

describe('startInProcessLane', () => {
  it('starts the worker when the lane is on and in-process', () => {
    const lane = worker();
    const logger = new Recorder();

    expect(
      startInProcessLane(
        { enrichmentEnabled: true, enrichmentInProcess: true },
        lane,
        logger,
      ),
    ).toBe(true);
    expect(lane.calls.starts).toBe(1);
  });

  it('warns loudly when the lane is off entirely', () => {
    // A worker that is not running looks exactly like a queue with nothing in
    // it, so the message has to name what is lost.
    const lane = worker();
    const logger = new Recorder();

    expect(
      startInProcessLane(
        { enrichmentEnabled: false, enrichmentInProcess: true },
        lane,
        logger,
      ),
    ).toBe(false);
    expect(lane.calls.starts).toBe(0);
    expect(logger.warns[0]).toContain('ENRICH_ENABLED is off');
    expect(logger.warns[0]).toContain('claim');
  });

  it('says where the lane is expected instead', () => {
    // The dangerous case: a process not running the worker and a worker with
    // nothing to do produce identical silence.
    const lane = worker();
    const logger = new Recorder();

    expect(
      startInProcessLane(
        { enrichmentEnabled: true, enrichmentInProcess: false },
        lane,
        logger,
      ),
    ).toBe(false);
    expect(lane.calls.starts).toBe(0);
    expect(logger.logs[0]).toContain('start:enrichment');
    expect(logger.logs[0]).toContain('the queue will grow');
  });

  it('keeps the switch-off message ahead of the where-it-runs message', () => {
    // With the lane off, where it would have run is not the operator's problem.
    const logger = new Recorder();
    startInProcessLane(
      { enrichmentEnabled: false, enrichmentInProcess: false },
      worker(),
      logger,
    );
    expect(logger.warns).toHaveLength(1);
    expect(logger.logs).toHaveLength(0);
  });

  it('never lets the worker take the poller down with it', async () => {
    // Detached on purpose: the worker's failures cost an amount, the poller's
    // failures cost a filing.
    const logger = new Recorder();
    const lane = worker(new Error('the loop died'));

    expect(
      startInProcessLane(
        { enrichmentEnabled: true, enrichmentInProcess: true },
        lane,
        logger,
      ),
    ).toBe(true);

    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.errors[0]).toContain('Enrichment worker stopped');
    expect(logger.errors[0]).toContain('the loop died');
  });
});
