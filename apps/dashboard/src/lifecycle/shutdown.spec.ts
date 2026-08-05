import { createShutdownHandler, type ShutdownDeps } from './shutdown';

interface Harness {
  readonly handler: (signal: string) => Promise<void>;
  readonly logs: string[];
  readonly errors: string[];
  readonly exits: number[];
  readonly closes: () => number;
}

const harness = (close: () => Promise<void>): Harness => {
  const logs: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  let closeCalls = 0;

  const deps: ShutdownDeps = {
    app: {
      close: async () => {
        closeCalls += 1;
        await close();
      },
    },
    log: (message) => logs.push(message),
    logError: (message) => errors.push(message),
    exit: (code) => exits.push(code),
    describe: (error) =>
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
  };

  return {
    handler: createShutdownHandler(deps),
    logs,
    errors,
    exits,
    closes: () => closeCalls,
  };
};

const succeeds = async (): Promise<void> => undefined;

describe('createShutdownHandler', () => {
  it('closes the app and exits cleanly', async () => {
    const h = harness(succeeds);

    await h.handler('SIGINT');

    expect(h.closes()).toBe(1);
    expect(h.exits).toEqual([0]);
    expect(h.errors).toEqual([]);
  });

  it('names the signal in the log line', async () => {
    const h = harness(succeeds);

    await h.handler('SIGTERM');

    expect(h.logs).toEqual(['SIGTERM received, closing dashboard']);
  });

  it('closes once however many signals arrive', async () => {
    // A second Ctrl-C is what an operator does when the first looks like it
    // hung. Without the latch it starts a second teardown over the first and
    // closes the same server twice.
    const h = harness(succeeds);

    await h.handler('SIGINT');
    await h.handler('SIGINT');
    await h.handler('SIGTERM');

    expect(h.closes()).toBe(1);
    expect(h.exits).toEqual([0]);
    expect(h.logs).toHaveLength(1);
  });

  it('latches before the close resolves, not after', async () => {
    // The realistic race: the second signal arrives WHILE the first close is
    // still in flight. A latch set after the await would not catch it.
    let release: () => void = () => undefined;
    const h = harness(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    const first = h.handler('SIGINT');
    const second = h.handler('SIGINT');
    release();
    await Promise.all([first, second]);

    expect(h.closes()).toBe(1);
    expect(h.exits).toEqual([0]);
  });

  it('logs a failed close instead of swallowing it', async () => {
    // A close that failed means the port is still held, and the next start
    // then fails with a bare EADDRINUSE that explains nothing.
    const h = harness(async () => {
      throw new Error('server still has open connections');
    });

    await h.handler('SIGINT');

    expect(h.errors).toEqual([
      'Shutdown failed: Error: server still has open connections',
    ]);
  });

  it('still exits when the close fails', async () => {
    // A viewer that will not die is worse than one that dies untidily.
    const h = harness(async () => {
      throw new Error('nope');
    });

    await h.handler('SIGINT');

    expect(h.exits).toEqual([0]);
  });

  it('describes a non-Error rejection rather than rendering "undefined"', async () => {
    const h = harness(async () => {
      throw 'a bare string';
    });

    await h.handler('SIGINT');

    expect(h.errors).toEqual(['Shutdown failed: a bare string']);
  });
});
