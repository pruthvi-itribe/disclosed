import corpus from './__fixtures__/results-header-corpus.json';
import { columnDatesIn } from './results-tokens';
import { verifyResults } from './results-verify';
import { basisReachFor, scaleReachFor } from '../pdf/parse-route';
import type { ProposedResults } from './results.types';

/**
 * What the results gate reads out of a real stacked column header, and what it
 * does not.
 *
 * ================================================================
 * WHAT THESE FIXTURES ARE
 * ================================================================
 *
 * `__fixtures__/results-header-corpus.json` holds three CONTIGUOUS SLICES of
 * markdown that `docling-serve` really produced, at the production settings, for
 * the three filings named in each entry. Each entry records the offset the slice
 * starts at and the character count of the whole conversion, and that count is
 * the `documentChars` the filing already carried in the collection — which is
 * what makes these the bytes the live gate actually read rather than a tidied
 * retelling of them.
 *
 * A slice rather than a whole document because the distances inside it are what
 * matter: the statement heading and the scale declaration sit where the document
 * puts them relative to the table, so `basisReach` and `scaleReach` are measured
 * over the real gap.
 *
 * ================================================================
 * WHY THEY ARE HERE
 * ================================================================
 *
 * An Indian statutory statement stacks its column header: a grouping tier
 * (`Quarter ended` / `Year ended`), often a basis tier above that, and the row
 * of dates under both. A markdown table has exactly ONE header row, so Docling
 * puts the first tier in it and the dates in the first BODY row — and the
 * proposal these fixtures were gathered to test was that the gate should merge
 * those tiers before aligning columns, on the theory that a model quoting "the
 * head of that table" quotes the tier and the gate reads no dates in it.
 *
 * IT WAS MEASURED AND IT IS NOT WHAT HAPPENS. The shape is the norm — 84 of 137
 * re-converted Docling results filings carry it — and the extractor quotes the
 * DATE row anyway; `tools/results/prove-header-merge.ts` is what asked it, and
 * on every `period-not-derivable` filing it asked, the quoted row was not a
 * tier. So no merge was built, and these three tables pin why: two of them are
 * read correctly the moment the date row is the quoted row, and the third is
 * refused for a reason no column model can reach.
 */
const entry = (seqId: number) => {
  const found = corpus.find((each) => each.seqId === seqId);
  if (found === undefined) throw new Error(`no fixture for ${seqId}`);
  return found;
};

const SHILPAMED = entry(106726125);
const RML = entry(106726089);
const LINDEINDIA = entry(106737549);

const rowContaining = (text: string, marker: string): string => {
  const at = text.indexOf(marker);
  if (at === -1) throw new Error(`no row containing ${marker}`);
  const start = text.lastIndexOf('\n', at) + 1;
  const end = text.indexOf('\n', at);
  return text.slice(start, end === -1 ? text.length : end);
};

const verify = (text: string, proposed: ProposedResults) =>
  verifyResults({
    documentText: text,
    proposed,
    // The bounds the live worker passes for this route, so the fixture is read
    // with the numbers the gate really used on it.
    basisReach: basisReachFor('docling-layout'),
    scaleReach: scaleReachFor('docling-layout'),
  });

describe('a stacked column header, in real Docling output', () => {
  describe('SHILPAMED 106726125 — a grouping tier over the dates', () => {
    const tier = rowContaining(SHILPAMED.text, '| SI.');
    const dates = rowContaining(SHILPAMED.text, '| Particulars');
    const figures = [
      {
        metric: 'net-profit' as const,
        current: '6,492',
        prior: '1,871',
        span: rowContaining(SHILPAMED.text, 'Net profit/(loss) for the period'),
      },
      {
        metric: 'total-income' as const,
        current: '19,860',
        prior: '10,648',
        span: rowContaining(SHILPAMED.text, '| Total Income'),
      },
    ];

    it('prints its grouping labels one row above its dates', () => {
      expect(tier).toContain('Quarter ended');
      expect(columnDatesIn(tier)).toHaveLength(0);
      expect(columnDatesIn(dates).map((date) => date.raw)).toEqual([
        '30.06.2026',
        '31.03.2026',
        '30.06.2025',
        '31.03.2026',
      ]);
    });

    it('refuses the whole block when the tier is the quoted header', () => {
      const verdict = verify(SHILPAMED.text, {
        basis: 'standalone',
        columnsSpan: tier,
        figures,
      });

      expect(verdict.outcome).toBe('refused');
      if (verdict.outcome !== 'refused') return;
      expect(verdict.reason).toBe('period-not-derivable');
      expect(verdict.detail).toBe(
        'the quoted column header states 0 period-end date(s), so no column ' +
          'can be identified',
      );
    });

    it('publishes the year-on-year pair when the date row is quoted', () => {
      // THE MEASUREMENT THAT SANK THE MERGE. Nothing about this table is
      // unreadable; the only question was ever which of its four header rows
      // gets quoted, and the extractor quotes this one.
      const verdict = verify(SHILPAMED.text, {
        basis: 'standalone',
        columnsSpan: dates,
        figures,
      });

      expect(verdict.outcome).toBe('ok');
      if (verdict.outcome !== 'ok') return;
      expect(verdict.results.period).toBe('Q1 FY27');
      expect(verdict.results.priorPeriod).toBe('Q1 FY26');
      expect(
        verdict.results.figures.map((figure) => [
          figure.metric,
          figure.current,
          figure.prior,
          figure.unit,
        ]),
      ).toEqual([
        ['net-profit', '6,492', '1,871', 'LAKH'],
        ['total-income', '19,860', '10,648', 'LAKH'],
      ]);
    });

    it('reads the year-ago column and not the previous quarter', () => {
      // The whole reason the gate exists: 6,492 against 7,096 is a fall of 8%
      // and against 1,871 it is the tripling the filing states. Both sit in the
      // same row and only the column order tells them apart.
      const verdict = verify(SHILPAMED.text, {
        basis: 'standalone',
        columnsSpan: dates,
        figures,
      });

      expect(verdict.outcome).toBe('ok');
      if (verdict.outcome !== 'ok') return;
      expect(verdict.results.figures[0].prior).toBe('1,871');
      expect(verdict.results.figures[0].prior).not.toBe('7,096');
    });
  });

  describe('RML 106726089 — basis over grouping over the dates', () => {
    const tier = rowContaining(RML.text, '| Standalone ');
    const dates = rowContaining(RML.text, '| 30.06.2026');
    const figures = [
      {
        metric: 'net-profit' as const,
        current: '32.15',
        prior: '18.72',
        span: rowContaining(RML.text, '7. Profit for the period/ year'),
      },
      {
        metric: 'total-income' as const,
        current: '1,050.64',
        prior: '882.67',
        span: rowContaining(RML.text, '| Total income '),
      },
    ];

    it('stacks three tiers, and the dates are the third', () => {
      expect(columnDatesIn(tier)).toHaveLength(0);
      expect(
        columnDatesIn(rowContaining(RML.text, '| Particulars')),
      ).toHaveLength(0);
      expect(columnDatesIn(dates)).toHaveLength(4);
    });

    it('refuses on the basis tier and publishes on the date row', () => {
      const onTier = verify(RML.text, {
        basis: 'standalone',
        columnsSpan: tier,
        figures,
      });
      expect(onTier.outcome).toBe('refused');
      if (onTier.outcome === 'refused') {
        expect(onTier.reason).toBe('period-not-derivable');
      }

      const onDates = verify(RML.text, {
        basis: 'standalone',
        columnsSpan: dates,
        figures,
      });
      expect(onDates.outcome).toBe('ok');
      if (onDates.outcome !== 'ok') return;
      expect(onDates.results.period).toBe('Q1 FY27');
      expect(onDates.results.priorPeriod).toBe('Q1 FY26');
      expect(
        onDates.results.figures.map((figure) => [
          figure.metric,
          figure.current,
          figure.prior,
          figure.unit,
        ]),
      ).toEqual([
        ['net-profit', '32.15', '18.72', 'CR'],
        ['total-income', '1,050.64', '882.67', 'CR'],
      ]);
    });
  });

  describe('LINDEINDIA 106737549 — refused, and not for a tier', () => {
    /**
     * The filing this work started from. Its consolidated statement prints ONE
     * header row with four date cells and `columnDatesIn` reads two of them:
     * Docling emits `30june 2026` and `30June 2025` with no space between the
     * day and the month name, and `NAMED_DATE_DMY` requires one. Four-value rows
     * against a two-date header is `columns-not-aligned`, and merging the tier
     * above it changes nothing, because that tier states no date either.
     *
     * The fix is a date spelling in `results-tokens.ts` and it is a different
     * change. Pinned here so the next reader does not re-diagnose it as a tier.
     */
    const tier = rowContaining(LINDEINDIA.text, '(Rs. Million)');
    const header = rowContaining(LINDEINDIA.text, '| Particulars ');
    const proposed: ProposedResults = {
      basis: 'consolidated',
      columnsSpan: header,
      figures: [
        {
          metric: 'total-income',
          current: '7,001.91',
          prior: '5,754.18',
          span: rowContaining(LINDEINDIA.text, '3. Total income {1+2)'),
        },
      ],
    };

    it('names four columns and the parser reads two of them', () => {
      // Both spellings exactly as Docling emitted them: no space between the
      // day and the month name, and the case of the `j` differs between the two.
      expect(header).toContain('30june 2026');
      expect(header).toContain('30June 2025');
      expect(columnDatesIn(header).map((date) => date.raw)).toEqual([
        '31 March 2026',
        '31 March 2026',
      ]);
    });

    it('gains no column from the tier above it', () => {
      const from = LINDEINDIA.text.indexOf(tier);
      const stacked = LINDEINDIA.text.slice(
        from,
        LINDEINDIA.text.indexOf(header, from) + header.length,
      );

      expect(stacked).toContain('(Rs. Million)');
      expect(columnDatesIn(stacked).map((date) => date.raw)).toEqual([
        '31 March 2026',
        '31 March 2026',
      ]);
    });

    it('refuses every figure, and says four values against two columns', () => {
      const verdict = verify(LINDEINDIA.text, proposed);

      expect(verdict.outcome).toBe('refused');
      if (verdict.outcome !== 'refused') return;
      expect(verdict.reason).toBe('all-discarded');
      expect(verdict.discards).toEqual([
        {
          reason: 'columns-not-aligned',
          metric: 'total-income',
          figure: expect.stringContaining('3. Total income {1+2)'),
          detail:
            "the row states 4 value(s) against the header's 2 column(s), so " +
            'no value can be placed in a column',
        },
      ]);
    });
  });
});
