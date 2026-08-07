import {
  mapBseAnnouncement,
  mapBsePage,
  BSE_ATTACHMENT_BASE,
} from './bse.mapper';
import type { BseRawRecord } from './bse.types';

const INGESTED = new Date('2026-08-07T02:00:00.000Z');

/** BRITANNIA's investor presentation, as BSE actually sent it. */
const REAL: BseRawRecord = {
  NEWSID: 'a0c67b24-3be3-4073-94db-65c9c497a6e0',
  SCRIP_CD: 500825,
  SLONGNAME: 'Britannia Industries Ltd',
  NEWSSUB:
    'Britannia Industries Ltd - 500825 - Announcement under Regulation 30 (LODR)-Investor Presentation',
  CATEGORYNAME: 'Company Update',
  SUBCATNAME: 'Investor Presentation',
  HEADLINE: 'Pursuant to Regulation 30 read with Clause 15 of Para A of Part A',
  DissemDT: '2026-08-07T07:09:33.413',
  NEWS_DT: '2026-08-07T07:09:33.413',
  ATTACHMENTNAME: '7c0debbe-46c2-4f78-806d-1b527f625f33.pdf',
  Fld_Attachsize: 4439475,
};

const map = (overrides: Partial<BseRawRecord> = {}) =>
  mapBseAnnouncement({ ...REAL, ...overrides }, INGESTED);

describe('mapBseAnnouncement', () => {
  it('maps the record BSE actually sent', () => {
    const row = map();
    expect(row).not.toBeNull();
    expect(row?.newsId).toBe('a0c67b24-3be3-4073-94db-65c9c497a6e0');
    expect(row?.scripCode).toBe(500825);
    expect(row?.companyName).toBe('Britannia Industries Ltd');
    expect(row?.category).toBe('Investor Presentation');
    expect(row?.categoryName).toBe('Company Update');
    expect(row?.attachmentBytes).toBe(4439475);
    expect(row?.disseminatedAt.toISOString()).toBe('2026-08-07T01:39:33.413Z');
    expect(row?.ingestedAt).toBe(INGESTED);
  });

  it('builds the attachment URL BSE actually serves', () => {
    // Verified on the wire: this URL answered 200 with 4,439,475 bytes, exactly
    // the size the feed advertised. `AttachHis` — the obvious sibling — answered
    // 404 for the same file WITH 8,405 bytes of HTML error page, which is why
    // the fetcher must trust the status and never the byte count.
    expect(map()?.attachmentUrl).toBe(
      `${BSE_ATTACHMENT_BASE}/7c0debbe-46c2-4f78-806d-1b527f625f33.pdf`,
    );
  });

  it('prefers the fine category over the broad one', () => {
    // SUBCATNAME is the resolution NSE's `desc` sits at and the one the
    // category-group table was built against. CATEGORYNAME is kept beside it
    // rather than instead of it, because the two are not a hierarchy: a
    // "Company Update" may be a presentation, a press release or neither.
    expect(map({ SUBCATNAME: 'Press Release / Media Release' })?.category).toBe(
      'Press Release / Media Release',
    );
  });

  it('falls back to the broad category when the fine one is absent', () => {
    const row = map({ SUBCATNAME: null });
    expect(row?.category).toBe('Company Update');
    expect(row?.categoryName).toBe('Company Update');
  });

  it('carries no attachment when BSE names no file', () => {
    // An announcement with no PDF is normal, not a failure. What must never
    // happen is a URL ending in the base with nothing after it, which would
    // fetch BSE's directory listing and parse as an unreadable document.
    for (const empty of [null, '', '   ', undefined]) {
      const row = map({ ATTACHMENTNAME: empty });
      expect(row?.attachmentUrl).toBeNull();
    }
  });

  it('refuses an attachment name that would escape the base URL', () => {
    // BSE supplies this string and it is concatenated into a URL that is then
    // fetched. A name carrying a path traversal or its own scheme must not
    // become a request to somewhere else.
    for (const hostile of [
      '../../etc/passwd',
      'https://evil.example/x.pdf',
      '//evil.example/x.pdf',
      'a/b.pdf',
    ]) {
      expect(map({ ATTACHMENTNAME: hostile })?.attachmentUrl).toBeNull();
    }
  });

  it.each([
    ['no news id', { NEWSID: null }],
    ['a blank news id', { NEWSID: '   ' }],
    ['no scrip code', { SCRIP_CD: null }],
    ['a non-numeric scrip code', { SCRIP_CD: 'FIVEHUNDRED' }],
    ['no company name', { SLONGNAME: null }],
    ['no category at all', { SUBCATNAME: null, CATEGORYNAME: null }],
    ['no dissemination time', { DissemDT: null }],
    ['an unparseable dissemination time', { DissemDT: 'yesterday' }],
  ])('returns null for a record with %s', (_label, overrides) => {
    // NULL RATHER THAN THROWING, so one malformed row in a page of eleven costs
    // that row and not the poll. The page mapper counts what it dropped, which
    // is what stops a feed that has changed shape from looking like a quiet day.
    expect(map(overrides as Partial<BseRawRecord>)).toBeNull();
  });

  it('accepts a scrip code sent as a numeric string', () => {
    // BSE sends a number today. A string of digits is the same identifier and
    // rejecting it would drop real announcements on a payload change.
    expect(map({ SCRIP_CD: '500825' })?.scripCode).toBe(500825);
  });

  it('falls back to the announcement time when dissemination is absent', () => {
    // Only for `announcedAt`. `disseminatedAt` has no fallback: it is the clock
    // every latency figure is measured against, and a guessed one is worse than
    // a dropped record.
    const row = map({ NEWS_DT: null });
    expect(row?.announcedAt.toISOString()).toBe('2026-08-07T01:39:33.413Z');
  });

  it('reports no attachment size rather than zero when BSE states none', () => {
    // Zero is a size a document could have; "BSE did not say" is not. Collapsing
    // the two would make a missing value look like an empty file to any
    // duplicate check keyed on size.
    for (const absent of [null, undefined, 'unknown', -1]) {
      expect(map({ Fld_Attachsize: absent })?.attachmentBytes).toBeNull();
    }
  });
});

describe('mapBsePage', () => {
  const page = (rows: unknown, count?: unknown) =>
    mapBsePage({ Table: rows, Table1: count }, INGESTED);

  it('maps a page and reads the range count BSE states', () => {
    const result = page([REAL], [{ ROWCNT: 11 }]);
    expect(result.announcements).toHaveLength(1);
    expect(result.totalForRange).toBe(11);
    expect(result.skipped).toBe(0);
  });

  it('counts what it could not map instead of dropping it silently', () => {
    // The number that tells an operator the feed changed shape. Without it a
    // payload BSE restructured reads as an afternoon with no announcements.
    const result = page([REAL, { NEWSID: null }, 'not even an object']);
    expect(result.announcements).toHaveLength(1);
    expect(result.skipped).toBe(2);
  });

  it('reports a null range count rather than guessing one', () => {
    // `totalForRange` is what makes a BSE day provably complete. A guess here
    // would turn a completeness proof into a completeness assumption, which is
    // the exact thing the NSE lane had to be measured over 935,125 polls to
    // justify.
    for (const missing of [undefined, [], [{}], 'eleven', [{ ROWCNT: 'x' }]]) {
      expect(page([REAL], missing).totalForRange).toBeNull();
    }
  });

  it('treats a missing or malformed Table as an empty page, not an error', () => {
    for (const bad of [undefined, null, {}, 'rows']) {
      const result = page(bad);
      expect(result.announcements).toEqual([]);
      expect(result.skipped).toBe(0);
    }
  });
});
