import nock from 'nock';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NseAdapter } from './nse.adapter';
import type { NseRawRecord } from './nse.types';

const FIXTURES = join(__dirname, '../../../../test/fixtures');

/**
 * Both fixtures are verbatim recordings of live NSE responses. Their record
 * counts are read from the fixture rather than hard-coded: NSE's live page held
 * 20 records when these were taken, and a pinned literal would fail the suite
 * for a reason that has nothing to do with the adapter if that ever changes.
 */
const readFixture = (name: string): NseRawRecord[] =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as NseRawRecord[];

const livePage = readFixture('nse-live-page.json');
const dayRange = readFixture('nse-day-range.json');

const HOST = 'https://www.nseindia.com';

class StubSession {
  public invalidated = 0;
  public issued = 0;

  async getCookieHeader(): Promise<string> {
    this.issued += 1;
    return 'nsit=stub';
  }

  invalidate(): void {
    this.invalidated += 1;
  }
}

class StubLogger {
  public readonly warnings: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }
}

describe('NseAdapter', () => {
  let session: StubSession;
  let logger: StubLogger;
  let adapter: NseAdapter;

  beforeAll(() => {
    // Any request this suite forgets to mock must fail loudly rather than reach
    // the exchange. No spec is permitted to touch the live NSE endpoint.
    nock.disableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
    session = new StubSession();
    logger = new StubLogger();
    adapter = new NseAdapter(session, undefined, logger);
  });

  afterAll(() => {
    nock.enableNetConnect();
    nock.restore();
  });

  it('fetchLatest returns mapped filings from the live page', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, livePage);

    const filings = await adapter.fetchLatest();

    expect(filings).toHaveLength(livePage.length);
    expect(typeof filings[0].seqId).toBe('number');
    expect(filings[0].disseminatedAt).toBeInstanceOf(Date);
  });

  it('sends the session cookie on the request', async () => {
    const scope = nock(HOST, { reqheaders: { Cookie: 'nsit=stub' } })
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, livePage);

    await adapter.fetchLatest();

    expect(scope.isDone()).toBe(true);
    expect(session.issued).toBe(1);
  });

  it('fetchLatest sorts descending by seqId regardless of response order', async () => {
    const shuffled = [...livePage].reverse();
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, shuffled);

    const filings = await adapter.fetchLatest();
    const ids = filings.map((f) => f.seqId);
    const expected = shuffled
      .map((raw) => Number(raw.seq_id))
      .sort((a, b) => b - a);

    // The live page arrives newest-first, so the reversal above is ascending:
    // an adapter that failed to sort would return exactly that order.
    expect(ids.length).toBeGreaterThan(1);
    expect(ids[0]).toBeGreaterThan(ids[ids.length - 1]);
    expect(ids).toEqual(expected);
  });

  it('fetchDay requests the dd-mm-yyyy range for that IST day', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({
        index: 'equities',
        from_date: '04-08-2026',
        to_date: '04-08-2026',
      })
      .reply(200, dayRange);

    const filings = await adapter.fetchDay(
      new Date('2026-08-04T10:00:00.000Z'),
    );

    expect(filings).toHaveLength(dayRange.length);
  });

  it('invalidates the session and retries once on 403', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(403, 'Access Denied');
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, livePage);

    const filings = await adapter.fetchLatest();

    expect(session.invalidated).toBe(1);
    expect(session.issued).toBe(2);
    expect(filings).toHaveLength(livePage.length);
  });

  it('throws after the retry also fails, so the caller can trip the breaker', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .twice()
      .reply(403, 'Access Denied');

    await expect(adapter.fetchLatest()).rejects.toThrow(/NSE request failed/);
  });

  it('does not retry a non-auth failure', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(500, 'Internal Server Error');

    await expect(adapter.fetchLatest()).rejects.toThrow();
    expect(session.invalidated).toBe(0);
    expect(session.issued).toBe(1);
  });

  it('throws when the payload is not an array (NSE error strings)', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, '"No Record Found!"');

    await expect(adapter.fetchLatest()).rejects.toThrow(
      /Unexpected NSE payload/,
    );
  });

  it('skips unmappable records rather than failing the whole batch', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, [{ ...livePage[0], an_dt: 'garbage' }, livePage[1]]);

    const filings = await adapter.fetchLatest();

    expect(filings).toHaveLength(1);
    expect(filings[0].seqId).toBe(Number(livePage[1].seq_id));
  });

  it('logs every skipped record with its seq_id and the reason', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, [{ ...livePage[0], an_dt: 'garbage' }, livePage[1]]);

    await adapter.fetchLatest();

    const skipped = logger.warnings.filter((line) =>
      line.includes('Skipped unmappable'),
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain(`seq_id=${livePage[0].seq_id}`);
    expect(skipped[0]).toContain('Unparseable NSE date');
  });

  it('summarises the skip count so a wholly rejected page is one line', async () => {
    // The failure mode behind this: seq_id is validated as digits only, so an
    // exchange-side change to alphanumeric ids rejects every record on the page
    // and the feed goes silent. The summary makes that visible at a glance.
    const allBad = livePage.map((raw) => ({ ...raw, seq_id: 'A106726004' }));
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, allBad);

    const filings = await adapter.fetchLatest();

    expect(filings).toHaveLength(0);
    expect(logger.warnings).toContain(
      `Skipped ${allBad.length} of ${allBad.length} NSE records as unmappable`,
    );
  });

  it('skips a null element without crashing the batch', async () => {
    // mapNseRecord does not guard against a non-object `raw`; a null element
    // escapes as a bare TypeError, not a "Malformed NSE record" error. The
    // per-record catch must therefore be unconditional.
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, [null, livePage[0], 'not-a-record', 42]);

    const filings = await adapter.fetchLatest();

    expect(filings).toHaveLength(1);
    expect(
      logger.warnings.filter((line) => line.includes('Skipped unmappable')),
    ).toHaveLength(3);
    expect(logger.warnings[0]).toContain('seq_id=unknown');
  });

  it('does not let a throwing logger fail the batch', async () => {
    const hostile = {
      warn(): void {
        throw new Error('log sink is down');
      },
    };
    const guarded = new NseAdapter(session, undefined, hostile);
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, [null, livePage[0]]);

    await expect(guarded.fetchLatest()).resolves.toHaveLength(1);
  });
});
