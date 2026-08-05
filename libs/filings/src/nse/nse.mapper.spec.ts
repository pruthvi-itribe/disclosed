import { readFileSync } from 'fs';
import { join } from 'path';
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

/**
 * Returns a copy of the record with `field` genuinely absent, mirroring an NSE
 * payload that omits the key. The cast is deliberate: it is the runtime shape
 * the mapper must survive, which the compile-time type cannot express.
 */
const withoutField = (
  record: NseRawRecord,
  field: keyof NseRawRecord,
): NseRawRecord =>
  Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== field),
  ) as unknown as NseRawRecord;

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
    const filing = mapNseRecord(withoutField(sample, 'exchdisstime'));
    expect(filing.disseminatedAt.toISOString()).toBe(
      '2026-08-05T04:58:17.000Z',
    );
  });

  it('throws on a record whose category is absent or not a string', () => {
    // NSE JSON is untrusted: the NseRawRecord type does not validate at runtime,
    // and a non-string category would make isRoutine() throw far downstream.
    expect(() => mapNseRecord(withoutField(sample, 'desc'))).toThrow(
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
