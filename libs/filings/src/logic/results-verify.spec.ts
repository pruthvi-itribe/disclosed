import {
  MAX_RESULTS_FIGURES,
  RESULTS_TABLE_REACH,
  renderResultsValue,
  verifyResults,
} from './results-verify';
import type { ProposedResults, ProposedResultsFigure } from './results.types';

/**
 * A document built the way `pdf-parse` produces one, from the real Apollo Tyres
 * Q1 FY27 filing: a covering letter naming BOTH statements, then the
 * consolidated statement, then — as that document really does — the standalone
 * statement's rows.
 */
const COLUMNS = '30.06.202631.03.202630.06.202531.03.2026';
const CONSOLIDATED_ROWS = [
  '1',
  'Revenue from operations',
  '73,977.90       ',
  '73,356.74   65,607.59    2,84,706.00     ',
  '3   Total income (1 + 2)74,561.21       73,708.95   65,796.53    2,86,040.05     ',
  '9   Profit before tax (7 - 8)4,676.93     1,616.53      383.58      13,092.04     ',
  '11  Profit for the period / year (9 - 10)3,488.72      6,309.73  128.78      13,724.16  ',
  '17  Earnings per equity share (face value of ₹ 1 each) (not annualised)',
  '(a) Basic (₹)',
  '5.52  ',
  '9.97   0.20     21.66    ',
].join('\n');

const STANDALONE_COLUMNS = '30.06.202631.03.202630.06.202531.03.2025';
const STANDALONE_ROWS = [
  'Revenue from operations',
  '54,618.69        ',
  '52,369.69        47,253.54  1,98,162.28    ',
].join('\n');

const DOCUMENT = [
  '(a) Un-audited Financial Results (Standalone and Consolidated) of the Company',
  'for the quarter ended June 30, 2026.',
  'x'.repeat(2_000),
  'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
  'FOR THE QUARTER ENDED JUNE 30, 2026',
  '₹ Million',
  COLUMNS,
  '(UNAUDITED)',
  CONSOLIDATED_ROWS,
  'y'.repeat(9_000),
  '₹ Million',
  STANDALONE_COLUMNS,
  STANDALONE_ROWS,
  'z'.repeat(200),
  'UNAUDITED STANDALONE FINANCIAL RESULTS',
].join('\n');

const REVENUE: ProposedResultsFigure = {
  metric: 'revenue',
  current: '73,977.90',
  prior: '65,607.59',
  span: 'Revenue from operations\n73,977.90       \n73,356.74   65,607.59    2,84,706.00',
};
const NET_PROFIT: ProposedResultsFigure = {
  metric: 'net-profit',
  current: '3,488.72',
  prior: '128.78',
  span: '11  Profit for the period / year (9 - 10)3,488.72      6,309.73  128.78      13,724.16',
};
const TOTAL_INCOME: ProposedResultsFigure = {
  metric: 'total-income',
  current: '74,561.21',
  prior: '65,796.53',
  span: '3   Total income (1 + 2)74,561.21       73,708.95   65,796.53    2,86,040.05',
};
const EPS: ProposedResultsFigure = {
  metric: 'eps',
  current: '5.52',
  prior: '0.20',
  span: '17  Earnings per equity share (face value of ₹ 1 each) (not annualised)\n(a) Basic (₹)\n5.52  \n9.97   0.20     21.66',
};

const proposal = (
  overrides: Partial<ProposedResults> = {},
): ProposedResults => ({
  basis: 'consolidated',
  columnsSpan: COLUMNS,
  figures: [REVENUE, NET_PROFIT],
  ...overrides,
});

const verify = (overrides: Partial<ProposedResults> = {}) =>
  verifyResults({ documentText: DOCUMENT, proposed: proposal(overrides) });

describe('verifyResults — the accepting path', () => {
  it('publishes a real statement, with the document own bytes as evidence', () => {
    const verdict = verify({
      figures: [REVENUE, NET_PROFIT, TOTAL_INCOME, EPS],
    });
    if (verdict.outcome !== 'ok') {
      throw new Error(`expected acceptance, got ${verdict.reason}`);
    }
    expect(verdict.results.basis).toBe('consolidated');
    expect(verdict.results.period).toBe('Q1 FY27');
    expect(verdict.results.priorPeriod).toBe('Q1 FY26');
    expect(verdict.results.basisSpan).toContain(
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
    );
    expect(verdict.results.columnsSpan).toBe(COLUMNS);
    expect(verdict.discards).toEqual([]);
  });

  it('takes the values from the DOCUMENT, not from the extractor', () => {
    // The same discipline `claim-span.ts` applies to a sentence: what is stored
    // is the source's bytes at the matched position, so a reviewer reads the
    // filing rather than the model's transcription of it.
    const verdict = verify({ figures: [REVENUE] });
    if (verdict.outcome !== 'ok') throw new Error('expected acceptance');
    const [figure] = verdict.results.figures;
    expect(DOCUMENT).toContain(figure.current);
    expect(DOCUMENT).toContain(figure.prior);
    expect(
      DOCUMENT.slice(
        DOCUMENT.indexOf(figure.span),
        DOCUMENT.indexOf(figure.span) + figure.span.length,
      ),
    ).toBe(figure.span);
  });

  it('reads the scale from the table and never rescales', () => {
    const verdict = verify({ figures: [REVENUE] });
    if (verdict.outcome !== 'ok') throw new Error('expected acceptance');
    expect(verdict.results.figures[0].unit).toBe('MN');
    // 73,977.90 million IS 73.98 billion. The document does not say so, so
    // neither does this.
    expect(verdict.results.figures[0].current).toBe('73,977.90');
  });

  it('takes a per-share unit from the EPS row rather than the table scale', () => {
    const verdict = verify({ figures: [EPS] });
    if (verdict.outcome !== 'ok') throw new Error('expected acceptance');
    // Not `MN`: `₹5.52 MN` for an EPS of five rupees fifty-two would be wrong
    // by six orders of magnitude.
    expect(verdict.results.figures[0].unit).toBe('');
  });

  it('ranks net profit ahead of revenue', () => {
    const verdict = verify({ figures: [REVENUE, NET_PROFIT] });
    if (verdict.outcome !== 'ok') throw new Error('expected acceptance');
    expect(verdict.results.figures.map((row) => row.metric)).toEqual([
      'net-profit',
      'revenue',
    ]);
  });

  it('discards a repeated metric rather than printing it twice', () => {
    const verdict = verify({ figures: [REVENUE, REVENUE] });
    if (verdict.outcome !== 'ok') throw new Error('expected acceptance');
    expect(verdict.results.figures).toHaveLength(1);
    expect(verdict.discards.map((row) => row.reason)).toEqual(['duplicate']);
  });

  it('drops a figure past the limit rather than reporting it as refused', () => {
    const verdict = verifyResults({
      documentText: DOCUMENT,
      proposed: proposal({ figures: [REVENUE, NET_PROFIT, TOTAL_INCOME] }),
      maxFigures: 2,
    });
    if (verdict.outcome !== 'ok') throw new Error('expected acceptance');
    expect(verdict.results.figures).toHaveLength(2);
    expect(verdict.discards.map((row) => row.reason)).toEqual(['over-limit']);
  });

  it('bounds the line at a literal as well as at the constant', () => {
    expect(MAX_RESULTS_FIGURES).toBe(5);
    expect(RESULTS_TABLE_REACH).toBe(8_000);
  });
});

describe('verifyResults — consolidated against standalone', () => {
  it('REFUSES a standalone row offered under a consolidated header', () => {
    // THE ERROR THIS WHOLE LANE IS BUILT AROUND. The row is verbatim in the
    // document, the header is verbatim in the document, the figures are
    // verbatim in the row — and the number is 35% wrong.
    const verdict = verify({
      figures: [
        {
          metric: 'revenue',
          current: '54,618.69',
          prior: '47,253.54',
          span: STANDALONE_ROWS,
        },
      ],
    });
    expect(verdict.outcome).toBe('refused');
    if (verdict.outcome !== 'refused') return;
    expect(verdict.reason).toBe('all-discarded');
    expect(verdict.discards[0].reason).toBe('row-outside-table');
  });

  it('REFUSES when the extractor and the document disagree about the basis', () => {
    const verdict = verify({ basis: 'standalone' });
    expect(verdict).toMatchObject({
      outcome: 'refused',
      reason: 'basis-not-determinable',
      detail: expect.stringContaining('standalone'),
    });
  });

  it('REFUSES a table whose statement heading is out of reach', () => {
    // The real `pdf-parse` shape: the standalone statement's rows arrive before
    // its own title, so nothing close enough to the header says what it is.
    const verdict = verifyResults({
      documentText: DOCUMENT,
      proposed: {
        basis: 'standalone',
        columnsSpan: STANDALONE_COLUMNS,
        figures: [
          {
            metric: 'revenue',
            current: '54,618.69',
            prior: '47,253.54',
            span: STANDALONE_ROWS,
          },
        ],
      },
    });
    expect(verdict).toMatchObject({
      outcome: 'refused',
      reason: 'basis-not-determinable',
    });
  });
});

describe('verifyResults — the adversarial cases', () => {
  it.each([
    [
      'a row the document does not contain',
      {
        ...REVENUE,
        span: 'Revenue from operations 99,999.99 88,888.88 77,777.77',
      },
      'row-not-found',
    ],
    [
      'a current value the row does not state',
      { ...REVENUE, current: '73,977.80' },
      'value-not-in-row',
    ],
    [
      'a year-ago value the row does not state',
      { ...REVENUE, prior: '65,607.50' },
      'value-not-in-row',
    ],
    ['a rescaled value', { ...REVENUE, current: '73.98' }, 'value-not-in-row'],
    [
      'profit before tax offered as net profit',
      {
        ...NET_PROFIT,
        current: '4,676.93',
        prior: '383.58',
        span: '9   Profit before tax (7 - 8)4,676.93     1,616.53      383.58      13,092.04',
      },
      'label-mismatch',
    ],
    [
      'an EBITDA the statement never printed',
      {
        metric: 'ebitda' as const,
        current: '73,977.90',
        prior: '65,607.59',
        span: REVENUE.span,
      },
      'label-mismatch',
    ],
  ])('discards %s', (_label, figure, reason) => {
    const verdict = verify({ figures: [figure] });
    expect(verdict.outcome).toBe('refused');
    if (verdict.outcome !== 'refused') return;
    expect(verdict.discards.map((row) => row.reason)).toEqual([reason]);
  });

  it('REFUSES the previous quarter offered as the year-ago figure', () => {
    // `73,356.74` is the March quarter. Printed as `(YOY)` it turns +12.8%
    // growth into +0.8%, and every character of it is verbatim.
    const verdict = verify({
      figures: [{ ...REVENUE, prior: '73,356.74' }],
    });
    expect(verdict.outcome).toBe('refused');
    if (verdict.outcome !== 'refused') return;
    expect(['period-ambiguous', 'not-year-on-year']).toContain(verdict.reason);
  });

  it('REFUSES the previous quarter even when the header repeats no date', () => {
    // The same trap on a header where the uniqueness check cannot fire, so it
    // is `not-year-on-year` that catches it.
    const columns = '30.06.202631.03.202630.06.2025';
    const row = 'Revenue from operations 100.00 90.00 80.00';
    const text = [
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
      '₹ Million',
      columns,
      row,
    ].join('\n');
    expect(
      verifyResults({
        documentText: text,
        proposed: {
          basis: 'consolidated',
          columnsSpan: columns,
          figures: [
            { metric: 'revenue', current: '100.00', prior: '90.00', span: row },
          ],
        },
      }),
    ).toMatchObject({ outcome: 'refused', reason: 'not-year-on-year' });
  });

  it('REFUSES when the column the value sits in is printed twice', () => {
    // A March-quarter statement prints `31.03.2026` twice: once for the quarter
    // and once for the full year. The value's position then says which COLUMN
    // it came from and not which PERIOD, so nothing can be published.
    const columns = '31.03.2026 31.03.2025 31.03.2026 31.03.2025';
    const row = 'Revenue from operations 100.00 90.00 400.00 380.00';
    const text = [
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
      '₹ Million',
      columns,
      row,
    ].join('\n');
    expect(
      verifyResults({
        documentText: text,
        proposed: {
          basis: 'consolidated',
          columnsSpan: columns,
          figures: [
            { metric: 'revenue', current: '100.00', prior: '90.00', span: row },
          ],
        },
      }),
    ).toMatchObject({ outcome: 'refused', reason: 'period-ambiguous' });
  });

  it('REFUSES a column header that is not in the document', () => {
    expect(verify({ columnsSpan: '30.06.202730.06.2026' })).toMatchObject({
      outcome: 'refused',
      reason: 'columns-not-found',
    });
  });

  it('REFUSES a header that states fewer than two dates', () => {
    const columns = 'PARTICULARS QUARTER ENDED 30.06.2026';
    const row = 'Revenue from operations 100.00 90.00';
    const text = [
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
      '₹ Million',
      columns,
      row,
    ].join('\n');
    expect(
      verifyResults({
        documentText: text,
        proposed: {
          basis: 'consolidated',
          columnsSpan: columns,
          figures: [
            { metric: 'revenue', current: '100.00', prior: '90.00', span: row },
          ],
        },
      }),
    ).toMatchObject({ outcome: 'refused', reason: 'period-not-derivable' });
  });

  it('REFUSES a row whose cell count disagrees with the header', () => {
    const verdict = verify({
      figures: [
        {
          ...REVENUE,
          span: 'Revenue from operations\n73,977.90       \n73,356.74   65,607.59',
        },
      ],
    });
    expect(verdict.outcome).toBe('refused');
    if (verdict.outcome !== 'refused') return;
    expect(verdict.discards[0].reason).toBe('columns-not-aligned');
  });

  it('REFUSES a value that appears twice in its row', () => {
    const columns = '30.06.2026 30.06.2025';
    const row = 'Revenue from operations 100.00 100.00';
    const text = [
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
      '₹ Million',
      columns,
      row,
    ].join('\n');
    const verdict = verifyResults({
      documentText: text,
      proposed: {
        basis: 'consolidated',
        columnsSpan: columns,
        figures: [
          { metric: 'revenue', current: '100.00', prior: '100.00', span: row },
        ],
      },
    });
    expect(verdict.outcome).toBe('refused');
    if (verdict.outcome !== 'refused') return;
    expect(verdict.discards[0].reason).toBe('value-ambiguous');
  });

  it('REFUSES two rows read across different pairs of columns', () => {
    const columns = '30.06.2026 30.06.2025 30.06.2024';
    const first = 'Revenue from operations 100.00 90.00 80.00';
    const second = 'Total income 200.00 190.00 180.00';
    const text = [
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
      '₹ Million',
      columns,
      first,
      second,
    ].join('\n');
    expect(
      verifyResults({
        documentText: text,
        proposed: {
          basis: 'consolidated',
          columnsSpan: columns,
          figures: [
            {
              metric: 'revenue',
              current: '100.00',
              prior: '90.00',
              span: first,
            },
            {
              metric: 'total-income',
              current: '190.00',
              prior: '180.00',
              span: second,
            },
          ],
        },
      }),
    ).toMatchObject({ outcome: 'refused', reason: 'columns-inconsistent' });
  });

  it('REFUSES a table with no scale declared', () => {
    const columns = '30.06.2026 30.06.2025';
    const row = 'Revenue from operations 100.00 90.00';
    const text = [
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
      columns,
      row,
    ].join('\n');
    expect(
      verifyResults({
        documentText: text,
        proposed: {
          basis: 'consolidated',
          columnsSpan: columns,
          figures: [
            { metric: 'revenue', current: '100.00', prior: '90.00', span: row },
          ],
        },
      }),
    ).toMatchObject({ outcome: 'refused', reason: 'unit-not-determinable' });
  });

  it('REFUSES a period end that closes no statutory quarter', () => {
    const columns = '31.01.2026 31.01.2025';
    const row = 'Revenue from operations 100.00 90.00';
    const text = [
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
      '₹ Million',
      columns,
      row,
    ].join('\n');
    expect(
      verifyResults({
        documentText: text,
        proposed: {
          basis: 'consolidated',
          columnsSpan: columns,
          figures: [
            { metric: 'revenue', current: '100.00', prior: '90.00', span: row },
          ],
        },
      }),
    ).toMatchObject({ outcome: 'refused', reason: 'period-not-derivable' });
  });

  it('REFUSES when the document states a quarter the dates contradict', () => {
    const columns = '30.06.2026 30.06.2025';
    const row = 'Revenue from operations 100.00 90.00';
    const text = [
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
      'Q3 FY27 PERFORMANCE',
      '₹ Million',
      columns,
      row,
    ].join('\n');
    expect(
      verifyResults({
        documentText: text,
        proposed: {
          basis: 'consolidated',
          columnsSpan: columns,
          figures: [
            { metric: 'revenue', current: '100.00', prior: '90.00', span: row },
          ],
        },
      }),
    ).toMatchObject({ outcome: 'refused', reason: 'period-conflict' });
  });

  it('REFUSES an EPS row that declares no currency', () => {
    // The table's scale does not reach this row, so a row that names no unit of
    // its own leaves the figure denominated in nothing.
    const columns = '30.06.2026 30.06.2025';
    const row = 'Basic earnings per share 5.52 0.20';
    const text = [
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
      '₹ Million',
      columns,
      row,
    ].join('\n');
    const verdict = verifyResults({
      documentText: text,
      proposed: {
        basis: 'consolidated',
        columnsSpan: columns,
        figures: [{ metric: 'eps', current: '5.52', prior: '0.20', span: row }],
      },
    });
    expect(verdict.outcome).toBe('refused');
    if (verdict.outcome !== 'refused') return;
    expect(verdict.discards[0].reason).toBe('unit-not-in-row');
  });

  it('REFUSES a margin row that declares no per-cent', () => {
    const columns = '30.06.2026 30.06.2025';
    const row = 'EBITDA margin 11.73 13.23';
    const text = [
      'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
      '₹ Million',
      columns,
      row,
    ].join('\n');
    const verdict = verifyResults({
      documentText: text,
      proposed: {
        basis: 'consolidated',
        columnsSpan: columns,
        figures: [
          {
            metric: 'ebitda-margin',
            current: '11.73',
            prior: '13.23',
            span: row,
          },
        ],
      },
    });
    expect(verdict.outcome).toBe('refused');
    if (verdict.outcome !== 'refused') return;
    expect(verdict.discards[0].reason).toBe('unit-not-in-row');
  });

  it('bounds what a discard record keeps', () => {
    const verdict = verify({
      figures: [{ ...REVENUE, span: 'x'.repeat(500) }],
    });
    expect(verdict.outcome).toBe('refused');
    if (verdict.outcome !== 'refused') return;
    expect(verdict.discards[0].figure.length).toBeLessThanOrEqual(80);
    expect(verdict.discards[0].detail.length).toBeLessThanOrEqual(200);
  });
});

describe('renderResultsValue', () => {
  it.each([
    ['a scaled figure', '73,977.90', 'MN', '₹73,977.90 MN'],
    ['a crore figure', '10,000', 'CR', '₹10,000 CR'],
    ['a per-share figure', '5.52', '', '₹5.52'],
    ['a margin', '11.73', '%', '11.73%'],
    ['an accounting negative', '(4,191.73)', 'MN', '-₹4,191.73 MN'],
    ['a minus sign', '-4,191.73', 'MN', '-₹4,191.73 MN'],
    ['a negative margin', '(2.50)', '%', '-2.50%'],
  ])('renders %s', (_label, raw, unit, expected) => {
    expect(renderResultsValue(raw, unit)).toBe(expected);
  });

  it('never turns a loss into a profit', () => {
    expect(renderResultsValue('(4,191.73)', 'MN')).not.toBe(
      renderResultsValue('4,191.73', 'MN'),
    );
  });
});

describe('verifyResults — a filer that states its own EBITDA', () => {
  // The one shape where EBITDA is publishable: the document PRINTS it. A
  // statutory statement never does, so this comes from a press release or a
  // results presentation.
  const columns = '30.06.2026 30.06.2025';
  const ebitdaRow = 'EBITDA 8,679.69 8,677.46';
  const marginRow = 'EBITDA margin 11.73% 13.23%';
  const text = [
    'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
    '₹ Million',
    columns,
    ebitdaRow,
    marginRow,
  ].join('\n');

  it('publishes both, each in the unit its own row declares', () => {
    const verdict = verifyResults({
      documentText: text,
      proposed: {
        basis: 'consolidated',
        columnsSpan: columns,
        figures: [
          {
            metric: 'ebitda',
            current: '8,679.69',
            prior: '8,677.46',
            span: ebitdaRow,
          },
          {
            metric: 'ebitda-margin',
            current: '11.73',
            prior: '13.23',
            span: marginRow,
          },
        ],
      },
    });
    if (verdict.outcome !== 'ok') {
      throw new Error(`expected acceptance, got ${verdict.reason}`);
    }
    expect(
      verdict.results.figures.map((row) => [row.metric, row.unit]),
    ).toEqual([
      ['ebitda', 'MN'],
      ['ebitda-margin', '%'],
    ]);
    // And the margin is the one the DOCUMENT printed. The competitor's own
    // year-ago margin for this filing reads 13.32%, which is 13.23% with two
    // digits transposed — a figure the filing never stated at all.
    expect(verdict.results.figures[1].prior).toBe('13.23');
  });
});
