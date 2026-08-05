import axios, { type AxiosError } from 'axios';
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
    adapter = new NseAdapter(session, logger);
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

    const { filings } = await adapter.fetchLatest();

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

    const { filings } = await adapter.fetchLatest();
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

    const { filings } = await adapter.fetchDay(
      new Date('2026-08-04T10:00:00.000Z'),
    );

    expect(filings).toHaveLength(dayRange.length);
  });

  describe('completeness accounting', () => {
    it('reports every record mapped on a clean page', async () => {
      nock(HOST)
        .get('/api/corporate-announcements')
        .query({ index: 'equities' })
        .reply(200, livePage);

      const result = await adapter.fetchLatest();

      expect(result.received).toBe(livePage.length);
      expect(result.skipped).toBe(0);
      expect(result.filings).toHaveLength(result.received);
    });

    it('reports the counts when only some records are unmappable', async () => {
      const page = [
        { ...livePage[0], an_dt: 'garbage' },
        livePage[1],
        livePage[2],
      ];
      nock(HOST)
        .get('/api/corporate-announcements')
        .query({ index: 'equities' })
        .reply(200, page);

      const result = await adapter.fetchLatest();

      expect(result.received).toBe(3);
      expect(result.skipped).toBe(1);
      expect(result.filings).toHaveLength(2);
      expect(result.received - result.skipped).toBe(result.filings.length);
    });

    it('reports a wholly rejected page as received > 0 with no filings', async () => {
      // This is the case Task 12 alarms on. seq_id is validated digits-only, so
      // an exchange-side move to alphanumeric ids rejects every record and the
      // feed goes silent - indistinguishable from a quiet market on the filings
      // alone, which is why the counts are part of the return value.
      const allBad = livePage.map((raw) => ({ ...raw, seq_id: 'A106726004' }));
      nock(HOST)
        .get('/api/corporate-announcements')
        .query({ index: 'equities' })
        .reply(200, allBad);

      const result = await adapter.fetchLatest();

      expect(result.received).toBe(allBad.length);
      expect(result.received).toBeGreaterThan(0);
      expect(result.skipped).toBe(result.received);
      expect(result.filings).toHaveLength(0);
    });

    it('distinguishes an empty page from a wholly rejected one', async () => {
      nock(HOST)
        .get('/api/corporate-announcements')
        .query({ index: 'equities' })
        .reply(200, []);

      const result = await adapter.fetchLatest();

      // Both return zero filings; only `received` tells them apart.
      expect(result.received).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.filings).toHaveLength(0);
    });

    it('reports counts on fetchDay as well as fetchLatest', async () => {
      nock(HOST)
        .get('/api/corporate-announcements')
        .query({
          index: 'equities',
          from_date: '04-08-2026',
          to_date: '04-08-2026',
        })
        .reply(200, dayRange);

      const result = await adapter.fetchDay(
        new Date('2026-08-04T10:00:00.000Z'),
      );

      expect(result.received).toBe(dayRange.length);
      expect(result.skipped).toBe(0);
    });
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

    const { filings } = await adapter.fetchLatest();

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

    // The retry budget is exactly one, and Task 12 designs its load arithmetic
    // against that number. Without these, an implementation that looped three
    // times would exhaust the interceptors, fail on nock's net-connect guard,
    // get wrapped in the same message and still pass.
    expect(session.issued).toBe(2);
    expect(session.invalidated).toBe(1);
  });

  it('exposes the underlying failure as the error cause', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .twice()
      .reply(403, 'Access Denied');

    const error = await adapter.fetchLatest().catch((e: unknown) => e);

    // Task 12's breaker should read the status off the cause rather than
    // pattern-matching the message text.
    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error & { cause?: unknown }).cause;
    expect(axios.isAxiosError(cause)).toBe(true);
    expect((cause as AxiosError).response?.status).toBe(403);
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

  describe('non-array payloads', () => {
    // The exchange answers with a bare JSON string rather than an error status
    // when it has nothing to give. That is an empty day, not a fault: a market
    // holiday or a pre-open drain must not look like a contract change, or the
    // poller alarms every quiet evening.
    it.each([
      ['the recorded marker', '"No Record Found!"'],
      ['no trailing exclamation', '"No Record Found"'],
      ['different case', '"NO RECORD FOUND!"'],
      ['surrounding whitespace', '"  No Record Found!  "'],
    ])('treats %s as an empty day, not a fault', async (_label, body) => {
      nock(HOST)
        .get('/api/corporate-announcements')
        .query({ index: 'equities' })
        .reply(200, body);

      const result = await adapter.fetchLatest();

      expect(result.filings).toHaveLength(0);
      expect(result.received).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('still throws on a block page, which is a genuine fault', async () => {
      nock(HOST)
        .get('/api/corporate-announcements')
        .query({ index: 'equities' })
        .reply(200, '<html><body>Access Denied</body></html>');

      await expect(adapter.fetchLatest()).rejects.toThrow(
        /Unexpected NSE payload/,
      );
    });

    it('still throws on an error object, keeping its diagnostic content', async () => {
      nock(HOST)
        .get('/api/corporate-announcements')
        .query({ index: 'equities' })
        .reply(200, { error: 'Bot detected' });

      // An object body must not render as a bare "object" - the message is the
      // only record of what the exchange actually said.
      await expect(adapter.fetchLatest()).rejects.toThrow(/Bot detected/);
    });

    it('does not mistake a message that merely mentions no records', async () => {
      nock(HOST)
        .get('/api/corporate-announcements')
        .query({ index: 'equities' })
        .reply(200, '"No Record Found for this query, contact support"');

      await expect(adapter.fetchLatest()).rejects.toThrow(
        /Unexpected NSE payload/,
      );
    });
  });

  it('skips unmappable records rather than failing the whole batch', async () => {
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, [{ ...livePage[0], an_dt: 'garbage' }, livePage[1]]);

    const { filings } = await adapter.fetchLatest();

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
    const allBad = livePage.map((raw) => ({ ...raw, seq_id: 'A106726004' }));
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, allBad);

    await adapter.fetchLatest();

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

    const result = await adapter.fetchLatest();

    expect(result.filings).toHaveLength(1);
    expect(result.received).toBe(4);
    expect(result.skipped).toBe(3);
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
    const guarded = new NseAdapter(session, hostile);
    nock(HOST)
      .get('/api/corporate-announcements')
      .query({ index: 'equities' })
      .reply(200, [null, livePage[0]]);

    const result = await guarded.fetchLatest();

    expect(result.filings).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });
});
