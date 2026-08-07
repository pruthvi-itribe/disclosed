import axios from 'axios';
import nock from 'nock';
import {
  BSE_ANNOUNCEMENTS_PATH,
  BSE_API_HOST,
  bseDateParam,
  BseClient,
  MAX_PAGES,
} from './bse.client';

const NOW = new Date('2026-08-07T02:00:00.000Z');
const DAY = new Date('2026-08-07T01:39:33.000Z');

const row = (id: string, at = '2026-08-07T07:09:33.413') => ({
  NEWSID: id,
  SCRIP_CD: 500825,
  SLONGNAME: 'Britannia Industries Ltd',
  SUBCATNAME: 'Investor Presentation',
  CATEGORYNAME: 'Company Update',
  NEWSSUB: 'subject line',
  DissemDT: at,
  ATTACHMENTNAME: `${id}.pdf`,
  Fld_Attachsize: 4439475,
});

const client = () =>
  new BseClient(
    { warn: () => undefined },
    axios.create({ baseURL: BSE_API_HOST }),
  );

const reply = (rows: unknown[], count: number | null) =>
  nock(BSE_API_HOST)
    .get(BSE_ANNOUNCEMENTS_PATH)
    .query(true)
    .reply(200, {
      Table: rows,
      Table1: count === null ? [] : [{ ROWCNT: count }],
    });

describe('bseDateParam', () => {
  it('formats an instant as its IST calendar date', () => {
    expect(bseDateParam(new Date('2026-08-07T01:39:33Z'))).toBe('20260807');
  });

  it('uses the IST day, not the UTC one, across the 18:30Z boundary', () => {
    // 18:31Z on the 6th is 00:01 IST on the 7th. Asking BSE for the 6th here
    // would silently skip the first five and a half hours of the IST day.
    expect(bseDateParam(new Date('2026-08-06T18:31:00Z'))).toBe('20260807');
    expect(bseDateParam(new Date('2026-08-06T18:29:00Z'))).toBe('20260806');
  });
});

describe('BseClient.fetchDay', () => {
  afterEach(() => nock.cleanAll());

  it('collects a single page and reports it complete', async () => {
    reply([row('a'), row('b')], 2);
    const result = await client().fetchDay(DAY, NOW);

    expect(result.announcements).toHaveLength(2);
    expect(result.totalForRange).toBe(2);
    expect(result.complete).toBe(true);
    expect(result.pages).toBe(1);
  });

  it('pages until it holds as many as BSE says exist', async () => {
    reply([row('a'), row('b')], 4);
    reply([row('c'), row('d')], 4);
    const result = await client().fetchDay(DAY, NOW);

    expect(result.announcements).toHaveLength(4);
    expect(result.pages).toBe(2);
    expect(result.complete).toBe(true);
  });

  it('does not count a repeated announcement twice', async () => {
    // THE BUG THIS GUARDS. Pages are served from a moving result set, so an
    // announcement arriving mid-drain shifts rows across the page boundary and
    // one comes back twice. Counting it twice would reach ROWCNT early and
    // declare a short day complete.
    reply([row('a'), row('b')], 4);
    reply([row('b'), row('c')], 4);
    reply([row('d')], 4);
    const result = await client().fetchDay(DAY, NOW);

    expect(result.announcements.map((a) => a.newsId).sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(result.complete).toBe(true);
  });

  it('reports a short day as incomplete rather than as everything', async () => {
    reply([row('a')], 9);
    reply([], 9);
    const result = await client().fetchDay(DAY, NOW);

    expect(result.announcements).toHaveLength(1);
    expect(result.totalForRange).toBe(9);
    expect(result.complete).toBe(false);
  });

  it('treats an uncounted day as incomplete, not as complete', async () => {
    // Unknown is not complete. A completeness claim resting on the absence of
    // evidence is exactly the thing this lane exists to avoid — the NSE side
    // can only infer completeness and needed 935,125 polls to justify it.
    reply([row('a')], null);
    reply([], null);
    const result = await client().fetchDay(DAY, NOW);

    expect(result.totalForRange).toBeNull();
    expect(result.complete).toBe(false);
  });

  it('stops when a page adds nothing new rather than spending the bound', async () => {
    reply([row('a')], 50);
    reply([row('a')], 50);
    const result = await client().fetchDay(DAY, NOW);

    expect(result.pages).toBe(2);
    expect(result.complete).toBe(false);
  });

  it('never asks for more than MAX_PAGES', async () => {
    // The exit condition is the server's number, so the loop needs a bound of
    // its own: a payload claiming an unreachable total would otherwise spin
    // against the exchange until something else broke.
    for (let i = 0; i < MAX_PAGES + 5; i += 1) {
      reply([row(`id-${i}`)], 10_000);
    }
    const result = await client().fetchDay(DAY, NOW);

    expect(result.pages).toBe(MAX_PAGES);
    expect(result.complete).toBe(false);
    nock.cleanAll();
  });

  it('sums unmappable records across pages instead of losing them', async () => {
    reply([row('a'), { NEWSID: null }], 3);
    reply([row('b'), 'not an object'], 3);
    reply([row('c')], 3);
    const result = await client().fetchDay(DAY, NOW);

    expect(result.skipped).toBe(2);
    expect(result.announcements).toHaveLength(3);
  });

  it('warns when a day is short so a shape change is not a quiet day', async () => {
    const warnings: string[] = [];
    const short = new BseClient(
      { warn: (m) => warnings.push(m) },
      axios.create({ baseURL: BSE_API_HOST }),
    );
    reply([row('a')], 7);
    reply([], 7);
    await short.fetchDay(DAY, NOW);

    expect(warnings.join(' ')).toMatch(/short/);
    expect(warnings.join(' ')).toContain('20260807');
  });

  it('returns announcements newest first', async () => {
    reply(
      [
        row('older', '2026-08-07T06:00:00.000'),
        row('newer', '2026-08-07T08:00:00.000'),
      ],
      2,
    );
    const result = await client().fetchDay(DAY, NOW);
    expect(result.announcements.map((a) => a.newsId)).toEqual([
      'newer',
      'older',
    ]);
  });
});
