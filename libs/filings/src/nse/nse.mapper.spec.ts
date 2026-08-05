import { readFileSync } from 'fs';
import { join } from 'path';
import type { Filing } from '../filing.types';
import { mapNseRecord } from './nse.mapper';
import type { NseRawRecord } from './nse.types';

const FIXTURE: NseRawRecord[] = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../test/fixtures/nse-live-page.json'),
    'utf8',
  ),
);

const sample: NseRawRecord = {
  seq_id: '106725630',
  symbol: 'PANACEABIO',
  sm_name: 'Panacea Biotec Limited',
  sm_isin: 'INE922B01023',
  smIndustry: 'Pharmaceuticals',
  desc: 'Bagging/Receiving of orders/contracts',
  attchmntText:
    'Panacea Biotec Limited has informed the Exchange about an order.',
  attchmntFile: 'https://nsearchives.nseindia.com/corporate/X.pdf',
  an_dt: '05-Aug-2026 10:28:17',
  exchdisstime: '05-Aug-2026 10:28:18',
};

describe('mapNseRecord', () => {
  it('maps identity fields', () => {
    const filing = mapNseRecord(sample);
    expect(filing.seqId).toBe(106725630);
    expect(filing.symbol).toBe('PANACEABIO');
    expect(filing.isin).toBe('INE922B01023');
    expect(filing.companyName).toBe('Panacea Biotec Limited');
    expect(filing.category).toBe('Bagging/Receiving of orders/contracts');
  });

  it('uses exchdisstime as the authoritative dissemination clock', () => {
    const filing = mapNseRecord(sample);
    expect(filing.disseminatedAt.toISOString()).toBe(
      '2026-08-05T04:58:18.000Z',
    );
    expect(filing.announcedAt.toISOString()).toBe('2026-08-05T04:58:17.000Z');
  });

  it('coerces seq_id to a number for ordering', () => {
    expect(typeof mapNseRecord(sample).seqId).toBe('number');
  });

  it('nulls an empty attachment url rather than storing ""', () => {
    const filing = mapNseRecord({ ...sample, attchmntFile: '' });
    expect(filing.attachmentUrl).toBeNull();
  });

  it('falls back to an_dt when exchdisstime is missing', () => {
    const { exchdisstime, ...withoutDiss } = sample;
    const filing = mapNseRecord(withoutDiss as NseRawRecord);
    expect(filing.disseminatedAt.toISOString()).toBe(
      '2026-08-05T04:58:17.000Z',
    );
  });

  it('throws on a record whose category is absent or not a string', () => {
    // NSE JSON is untrusted: the NseRawRecord type does not validate at runtime,
    // and a non-string category would make isRoutine() throw far downstream.
    const { desc, ...withoutDesc } = sample;
    expect(() => mapNseRecord(withoutDesc as NseRawRecord)).toThrow(
      /Malformed NSE record/,
    );
    expect(() =>
      mapNseRecord({ ...sample, desc: 42 as unknown as string }),
    ).toThrow(/Malformed NSE record/);
  });

  it('maps every record in the recorded fixture without throwing', () => {
    expect(FIXTURE.length).toBeGreaterThan(0);
    for (const raw of FIXTURE) {
      const filing = mapNseRecord(raw);
      expect(Number.isFinite(filing.seqId)).toBe(true);
      expect(filing.disseminatedAt.getTime()).not.toBeNaN();
    }
  });
});

describe('mapNseRecord boundary validation', () => {
  const REQUIRED_FIELDS: ReadonlyArray<keyof NseRawRecord> = [
    'seq_id',
    'symbol',
    'sm_name',
    'sm_isin',
    'desc',
    'an_dt',
  ];

  /** Reading an absent key and reading an explicitly undefined key are the same
   * thing at runtime, so this expresses "field missing" without a helper. */
  const withValue = (field: keyof NseRawRecord, value: unknown): NseRawRecord =>
    ({ ...sample, [field]: value }) as unknown as NseRawRecord;

  it.each(REQUIRED_FIELDS)('rejects a record with %s absent', (field) => {
    expect(() => mapNseRecord(withValue(field, undefined))).toThrow(
      new RegExp(`Malformed NSE record.*"${field}"`),
    );
  });

  it.each(REQUIRED_FIELDS)('rejects a record with %s blank', (field) => {
    expect(() => mapNseRecord(withValue(field, '   '))).toThrow(
      new RegExp(`Malformed NSE record.*"${field}"`),
    );
  });

  it.each(REQUIRED_FIELDS)('rejects a record with %s not a string', (field) => {
    expect(() => mapNseRecord(withValue(field, 42))).toThrow(
      new RegExp(`Malformed NSE record.*"${field}"`),
    );
  });

  // Every one of these is a cursor hazard, not a style point: a seq_id that
  // parses to the wrong number, or to a double that cannot represent it
  // exactly, makes `seqId > cursor` compare against something that is not the
  // exchange's id - so a filing is skipped or replayed with no error.
  const BAD_SEQ_IDS: ReadonlyArray<[string, string]> = [
    ['not-a-number', 'NaN, and NaN > cursor is false, so the record vanishes'],
    ['Infinity', 'not NaN, so a finite check alone would admit it'],
    ['1.5', 'a decimal is not an exchange sequence id'],
    ['0x1F', 'hex silently becomes 31, a different record'],
    ['1e5', 'scientific notation silently becomes 100000'],
    ['9007199254740993', 'past MAX_SAFE_INTEGER: distinct ids alias'],
  ];

  it.each(BAD_SEQ_IDS)('rejects seq_id %s (%s)', (seqId) => {
    expect(() => mapNseRecord({ ...sample, seq_id: seqId })).toThrow(
      /Malformed NSE record.*"seq_id".*safe integer/,
    );
  });

  it('still maps a valid numeric seq_id string', () => {
    const filing = mapNseRecord({ ...sample, seq_id: '106725631' });
    expect(filing.seqId).toBe(106725631);
    expect(Number.isSafeInteger(filing.seqId)).toBe(true);
  });

  it('maps the largest seq_id that a double still represents exactly', () => {
    const filing = mapNseRecord({
      ...sample,
      seq_id: String(Number.MAX_SAFE_INTEGER),
    });
    expect(filing.seqId).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('names the offending field and the seq_id so a skip is diagnosable', () => {
    const { symbol, ...withoutSymbol } = sample;
    expect(() => mapNseRecord(withoutSymbol as NseRawRecord)).toThrow(
      /Malformed NSE record \(seq_id=106725630\): "symbol"/,
    );
  });

  it('reports seq_id as unknown when seq_id itself is the bad field', () => {
    const { seq_id, ...withoutSeqId } = sample;
    expect(() => mapNseRecord(withoutSeqId as NseRawRecord)).toThrow(
      /Malformed NSE record \(seq_id=unknown\): "seq_id"/,
    );
  });

  it('accepts a record carrying only the required fields', () => {
    const {
      smIndustry,
      attchmntText,
      attchmntFile,
      exchdisstime,
      ...onlyRequired
    } = sample;
    const filing = mapNseRecord(onlyRequired as NseRawRecord);
    expect(filing.industry).toBeNull();
    expect(filing.summary).toBe('');
    expect(filing.attachmentUrl).toBeNull();
    expect(filing.disseminatedAt.toISOString()).toBe(
      '2026-08-05T04:58:17.000Z',
    );
  });

  // Optional fields are genuinely optional, so junk normalises to absent
  // rather than throwing. `value?.trim()` guarded only null and undefined, so
  // a non-string used to escape as a bare TypeError carrying no field name and
  // no seq_id - an undiagnosable skip in a per-record catch.
  const JUNK_VALUES: readonly unknown[] = [42, {}, [], true];

  const OPTIONAL_FIELD_CASES: ReadonlyArray<
    [keyof NseRawRecord, (filing: Filing) => unknown, unknown]
  > = [
    ['smIndustry', (filing) => filing.industry, null],
    ['attchmntText', (filing) => filing.summary, ''],
    ['attchmntFile', (filing) => filing.attachmentUrl, null],
    [
      'exchdisstime',
      (filing) => filing.disseminatedAt.toISOString(),
      '2026-08-05T04:58:17.000Z',
    ],
  ];

  it.each(OPTIONAL_FIELD_CASES)(
    'normalises a non-string %s to absent instead of throwing',
    (field, read, expected) => {
      for (const junk of JUNK_VALUES) {
        const filing = mapNseRecord(withValue(field, junk));
        expect(read(filing)).toEqual(expected);
      }
    },
  );

  it('keeps the error contract: nothing escapes as a bare TypeError', () => {
    // Every rejection a caller can see must be identifiable, so Task 5's
    // catch-and-skip logs a field and a seq_id rather than "x.trim is not a
    // function".
    const cases: ReadonlyArray<keyof NseRawRecord> = [
      ...REQUIRED_FIELDS,
      'smIndustry',
      'attchmntText',
      'attchmntFile',
      'exchdisstime',
    ];
    for (const field of cases) {
      for (const junk of JUNK_VALUES) {
        try {
          mapNseRecord(withValue(field, junk));
        } catch (error) {
          expect((error as Error).message).toMatch(/^Malformed NSE record/);
        }
      }
    }
  });
});
