import type { BseAnnouncement } from './bse.types';
import {
  bestMatch,
  companyKey,
  DISSEMINATION_WINDOW_MS,
  isinCompanyKey,
  matchAcrossExchanges,
  type MatchInput,
} from './cross-exchange-match';

const AT = new Date('2026-08-07T01:39:33.000Z');

const announcement = (
  overrides: Partial<BseAnnouncement> = {},
): BseAnnouncement => ({
  newsId: 'a0c67b24',
  scripCode: 500825,
  companyName: 'Britannia Industries Ltd',
  category: 'Investor Presentation',
  categoryName: 'Company Update',
  summary: 'subject',
  attachmentUrl: 'https://example.invalid/x.pdf',
  attachmentBytes: 4439475,
  announcedAt: AT,
  disseminatedAt: AT,
  ingestedAt: AT,
  ...overrides,
});

const match = (overrides: Partial<MatchInput> = {}) =>
  matchAcrossExchanges({
    filing: {
      isin: 'INE216A01014',
      companyName: 'Britannia Industries Limited',
      category: 'Investor Presentation',
      disseminatedAt: new Date(AT.getTime() + 201_000),
    },
    filingBytes: 4439475,
    announcement: announcement(),
    announcementIsin: 'INE216A01030',
    ...overrides,
  });

describe('isinCompanyKey', () => {
  it('keeps the company part and drops the series digits', () => {
    // THE MEASUREMENT THIS EXISTS FOR. NSE served INE216A01014 for Britannia
    // and BSE served INE216A01030 — the same company after a face-value change
    // minted a new ISIN, with NSE's feed still on the old one. Six of eight
    // companies agreed on the full string; all eight agreed on these nine.
    expect(isinCompanyKey('INE216A01014')).toBe('INE216A01');
    expect(isinCompanyKey('INE216A01030')).toBe('INE216A01');
    expect(isinCompanyKey('INE216A01014')).toBe(isinCompanyKey('INE216A01030'));
  });

  it('keeps genuinely different issuers apart', () => {
    expect(isinCompanyKey('INE326A01037')).not.toBe(
      isinCompanyKey('INE216A01030'),
    );
  });

  it.each([[null], [undefined], [''], ['INE216'], [42 as unknown as string]])(
    'returns null rather than a short key for %p',
    (input) => {
      expect(isinCompanyKey(input as string)).toBeNull();
    },
  );
});

describe('companyKey', () => {
  it('reconciles the two exchanges’ spellings of one company', () => {
    // BSE writes `Kokuyo Camlin Ltd-$`; NSE writes `Kokuyo Camlin Limited`.
    expect(companyKey('Kokuyo Camlin Ltd-$')).toBe(
      companyKey('Kokuyo Camlin Limited'),
    );
    expect(companyKey('Britannia Industries Ltd')).toBe(
      companyKey('Britannia Industries Limited'),
    );
  });

  it('does not collapse two different companies', () => {
    expect(companyKey('Lupin Ltd')).not.toBe(companyKey('Britannia Ltd'));
  });

  it('returns null when nothing survives normalisation', () => {
    expect(companyKey('Ltd.')).toBeNull();
    expect(companyKey('')).toBeNull();
  });
});

describe('matchAcrossExchanges', () => {
  it('calls it the same document when both exchanges state one byte count', () => {
    const result = match();
    expect(result.confidence).toBe('same-document');
    expect(result.key).toBe('INE216A01');
    expect(result.sizeAgrees).toBe(true);
  });

  it('reports which exchange was first, signed toward BSE', () => {
    // The real Britannia pair: BSE disseminated 201 seconds before NSE.
    expect(match().bseLeadMs).toBe(201_000);
    expect(
      match({
        filing: {
          isin: 'INE216A01014',
          companyName: 'Britannia Industries Limited',
          category: 'Investor Presentation',
          disseminatedAt: new Date(AT.getTime() - 60_000),
        },
      }).bseLeadMs,
    ).toBe(-60_000);
  });

  it('matches on the ISIN prefix where the full ISIN disagrees', () => {
    // Without this the Britannia and Lupin pairs are two distinct events and
    // every one of their documents is extracted twice.
    expect(match().key).toBe('INE216A01');
  });

  it('falls back to the company name when a scrip has no ISIN', () => {
    const result = match({ announcementIsin: null });
    expect(result.confidence).toBe('same-document');
    expect(result.key).toBe('britannia industries');
  });

  it('drops to same-event when neither side states a size', () => {
    const result = match({
      filingBytes: null,
      announcement: announcement({ attachmentBytes: null }),
    });
    expect(result.confidence).toBe('same-event');
    expect(result.sizeAgrees).toBe(false);
  });

  it('does NOT treat two absent sizes as agreement', () => {
    // The inversion worth guarding: "neither exchange said" is not evidence of
    // sameness, and promoting it to the strongest tier would make the pairs we
    // know least about the ones we act on most confidently.
    expect(
      match({
        filingBytes: null,
        announcement: announcement({ attachmentBytes: null }),
      }).sizeAgrees,
    ).toBe(false);
  });

  it('drops to same-company when the categories do not overlap', () => {
    const result = match({
      filingBytes: 1,
      announcement: announcement({ attachmentBytes: 2, category: 'AGM' }),
    });
    expect(result.confidence).toBe('same-company');
  });

  it('reconciles the exchanges’ different category words', () => {
    // NSE `Press Release` against BSE `Press Release / Media Release`.
    const result = match({
      filing: {
        isin: 'INE216A01014',
        companyName: 'Britannia Industries Limited',
        category: 'Press Release',
        disseminatedAt: AT,
      },
      filingBytes: null,
      announcement: announcement({
        attachmentBytes: null,
        category: 'Press Release / Media Release',
      }),
    });
    expect(result.categoryAgrees).toBe(true);
    expect(result.confidence).toBe('same-event');
  });

  it('refuses a pairing outside the dissemination window', () => {
    const result = match({
      filing: {
        isin: 'INE216A01014',
        companyName: 'Britannia Industries Limited',
        category: 'Investor Presentation',
        disseminatedAt: new Date(AT.getTime() + DISSEMINATION_WINDOW_MS + 1),
      },
    });
    expect(result.confidence).toBe('none');
  });

  it('admits the widest gap the exchanges were actually measured at', () => {
    // 1,672 seconds, the worst of eight observed pairs. A window that refused
    // it would split a real duplicate and pay for it twice.
    const result = match({
      filing: {
        isin: 'INE216A01014',
        companyName: 'Britannia Industries Limited',
        category: 'Investor Presentation',
        disseminatedAt: new Date(AT.getTime() + 1_672_000),
      },
    });
    expect(result.confidence).toBe('same-document');
  });

  it('refuses two different companies however well everything else agrees', () => {
    const result = match({
      filing: {
        isin: 'INE326A01029',
        companyName: 'Lupin Limited',
        category: 'Investor Presentation',
        disseminatedAt: AT,
      },
    });
    expect(result.confidence).toBe('none');
  });
});

describe('bestMatch', () => {
  const candidate = (
    confidence: 'same-document' | 'same-event' | 'same-company' | 'none',
    bseLeadMs: number,
  ) => ({
    key: 'INE216A01',
    confidence,
    bseLeadMs,
    sizeAgrees: confidence === 'same-document',
    categoryAgrees: confidence !== 'same-company',
  });

  it('returns null when nothing matched', () => {
    expect(bestMatch([])).toBeNull();
    expect(bestMatch([candidate('none', 0)])).toBeNull();
  });

  it('prefers the stronger confidence over the closer time', () => {
    // A company files several times in a morning — LUPIN filed a deck, a press
    // release and a board outcome inside nine minutes — so proximity alone
    // picks the wrong one.
    const best = bestMatch([
      candidate('same-company', 1_000),
      candidate('same-document', 600_000),
    ]);
    expect(best?.confidence).toBe('same-document');
  });

  it('breaks a tie on closeness in time', () => {
    const best = bestMatch([
      candidate('same-event', 500_000),
      candidate('same-event', 20_000),
    ]);
    expect(best?.bseLeadMs).toBe(20_000);
  });
});
