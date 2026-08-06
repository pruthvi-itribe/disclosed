import type { LaneRuntime } from './enrichment/enrichment.lane';

/**
 * The entrypoint's wiring, which is the one part of the lane a test cannot get
 * at any other way.
 *
 * Everything with a decision in it lives in `enrichment/enrichment.lane.ts` and
 * is tested there against a fake world. What is left in `enrichment.main.ts` is
 * the four things only the real process can supply — a Nest container, the
 * signal table, the exit code and a logger — and this suite proves that each of
 * them is connected to the right thing. `main.ts` is the cautionary example:
 * its shutdown re-entrancy latch is real behaviour that no test covers, because
 * it is written inline in a file nothing can import.
 *
 * Nest, mongoose and the module graph are all mocked. Importing the real
 * `IngestModule` would open a database connection from a unit test.
 */

const mockRuntime: { value: LaneRuntime | null } = { value: null };

jest.mock('./enrichment/enrichment.lane', () => ({
  runEnrichmentLane: (runtime: LaneRuntime) => {
    mockRuntime.value = runtime;
    return Promise.resolve();
  },
}));

const mockModel = { init: jest.fn(async () => undefined) };
const mockWorker = { start: jest.fn(), stop: jest.fn() };
const mockApp = {
  get: jest.fn((token: unknown) =>
    token === 'token:Filing' ? mockModel : mockWorker,
  ),
  close: jest.fn(async () => undefined),
};

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: jest.fn(async () => mockApp),
  },
}));

jest.mock('@nestjs/mongoose', () => ({
  getModelToken: (name: string) => `token:${name}`,
}));

jest.mock('./ingest.module', () => ({
  FILING_MODEL: 'Filing',
  IngestModule: class MockIngestModule {},
}));

describe('the enrichment entrypoint', () => {
  beforeAll(() => {
    // The module runs `runEnrichmentLane` on import; the mock above captures
    // the runtime it was handed rather than letting it boot anything.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./enrichment.main');
  });

  const runtime = (): LaneRuntime => {
    if (mockRuntime.value === null) throw new Error('the lane was never run');
    return mockRuntime.value;
  };

  it('runs the lane on import', () => {
    expect(mockRuntime.value).not.toBeNull();
  });

  it('describes the configuration in force', async () => {
    const context = await runtime().createContext();
    // Reads the real config loader, so a default that silently applied is
    // distinguishable from a setting that was read.
    expect(context.describeConfig()).toContain('enrich=');
  });

  it('waits for the claim index before the first tick', async () => {
    const context = await runtime().createContext();
    await context.initModel();

    expect(mockApp.get).toHaveBeenCalledWith('token:Filing');
    expect(mockModel.init).toHaveBeenCalled();
  });

  it('hands the lane the worker from the container', async () => {
    const context = await runtime().createContext();
    expect(context.worker()).toBe(mockWorker);
  });

  it('closes the container it opened', async () => {
    const context = await runtime().createContext();
    await context.close();
    expect(mockApp.close).toHaveBeenCalled();
  });

  it('registers signal handlers on the process itself', () => {
    const on = jest.spyOn(process, 'on').mockReturnValue(process);
    const handler = jest.fn();

    runtime().onSignal('SIGTERM', handler);

    expect(on).toHaveBeenCalledWith('SIGTERM', handler);
    on.mockRestore();
  });

  it('exits the process with the code it is given', () => {
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    runtime().exit(1);

    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });
});
