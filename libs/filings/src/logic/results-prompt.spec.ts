import {
  buildResultsRequest,
  MAX_RESULTS_DOCUMENT_CHARS,
  parseResultsResponse,
  RESULTS_OUTPUT_SCHEMA,
  RESULTS_SYSTEM_PROMPT,
} from './results-prompt';
import { RESULTS_METRICS } from './results.types';

const reply = (results: unknown): unknown => ({ results });

const figure = (overrides: Record<string, unknown> = {}): unknown => ({
  metric: 'revenue',
  span: 'Revenue from operations 73,977.90 65,607.59',
  current: '73,977.90',
  prior: '65,607.59',
  ...overrides,
});

describe('RESULTS_SYSTEM_PROMPT', () => {
  it.each([
    [
      'tells the model to prefer the consolidated statement',
      /CONSOLIDATED one/,
    ],
    ['forbids computing a figure', /Never compute, convert, rescale or round/],
    ['names the year-ago column explicitly', /SAME PERIOD ONE YEAR EARLIER/],
    ['warns that both statements are present', /BOTH statements/],
    ['forbids deriving EBITDA', /Do not derive EBITDA/],
    ['names the profit row to use', /profit AFTER tax/],
    ['asks for basic EPS', /BASIC earnings per share/],
    ['states that no table is a normal answer', /normal answer, not a failure/],
  ])('%s', (_label, pattern) => {
    expect(RESULTS_SYSTEM_PROMPT).toMatch(pattern);
  });

  it('names every metric the gate will accept', () => {
    for (const metric of RESULTS_METRICS) {
      expect(RESULTS_SYSTEM_PROMPT).toContain(metric);
    }
  });

  it('carries nothing filing-specific, so it stays cacheable', () => {
    // The cacheable prefix of every request in this lane. Interpolating a
    // symbol or a document into it would make every call a cache miss.
    expect(RESULTS_SYSTEM_PROMPT).not.toMatch(/APOLLOTYRE|seqId|<document>/);
  });
});

describe('RESULTS_OUTPUT_SCHEMA', () => {
  it('lets the model say there is no table', () => {
    // A nullable `results` is what stops a model inventing an empty table it
    // then has to fill.
    expect(RESULTS_OUTPUT_SCHEMA.properties.results.type).toEqual([
      'object',
      'null',
    ]);
  });

  it('closes every object, which is what strict validation needs', () => {
    expect(RESULTS_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(RESULTS_OUTPUT_SCHEMA.properties.results.additionalProperties).toBe(
      false,
    );
    expect(
      RESULTS_OUTPUT_SCHEMA.properties.results.properties.figures.items
        .additionalProperties,
    ).toBe(false);
  });

  it('constrains the basis and the metric to the unions the gate knows', () => {
    expect(
      RESULTS_OUTPUT_SCHEMA.properties.results.properties.basis.enum,
    ).toEqual(['consolidated', 'standalone']);
    expect(
      RESULTS_OUTPUT_SCHEMA.properties.results.properties.figures.items
        .properties.metric.enum,
    ).toEqual([...RESULTS_METRICS]);
  });
});

describe('buildResultsRequest', () => {
  const input = {
    symbol: 'APOLLOTYRE',
    category: 'Outcome of Board Meeting',
    summary:
      'has submitted the financial results for the period ended Jun 30, 2026',
    documentText: 'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
  };

  it('labels the exchange text as the exchange own', () => {
    const request = buildResultsRequest(input);
    expect(request).toContain('Symbol: APOLLOTYRE');
    expect(request).toContain('Exchange category: Outcome of Board Meeting');
    expect(request).toContain('<document>');
    expect(request).toContain('</document>');
  });

  it('caps the document and says it did', () => {
    const request = buildResultsRequest({
      ...input,
      documentText: 'x'.repeat(500),
      maxDocumentChars: 100,
    });
    expect(request).toContain('first 100 characters of 500');
    expect(request).not.toContain('x'.repeat(101));
  });

  it.each([
    ['zero', 0],
    ['a negative', -1],
  ])(
    'ignores %s override rather than sending an empty document',
    (_label, override) => {
      // Obeying it would record "no results statement" on every eligible filing,
      // which looks exactly like a market that filed nothing.
      const request = buildResultsRequest({
        ...input,
        documentText: 'REAL TEXT',
        maxDocumentChars: override,
      });
      expect(request).toContain('REAL TEXT');
    },
  );

  it('sends more of the document than the claim lane does', () => {
    // A statutory statement is not at the front. In the acceptance filing the
    // consolidated statement starts at character 7,400 and the standalone one
    // at 21,900.
    expect(MAX_RESULTS_DOCUMENT_CHARS).toBe(96_000);
  });
});

describe('parseResultsResponse', () => {
  it('reads a well-formed reply', () => {
    expect(
      parseResultsResponse(
        reply({
          basis: 'consolidated',
          columnsSpan: '30.06.202630.06.2025',
          figures: [figure()],
        }),
      ),
    ).toEqual({
      basis: 'consolidated',
      columnsSpan: '30.06.202630.06.2025',
      figures: [
        {
          metric: 'revenue',
          span: 'Revenue from operations 73,977.90 65,607.59',
          current: '73,977.90',
          prior: '65,607.59',
        },
      ],
    });
  });

  it.each([
    ['a null results block', reply(null)],
    ['a reply that is not an object', 'not json'],
    ['null', null],
    ['no results key at all', {}],
    [
      'a basis outside the union',
      reply({ basis: 'combined', columnsSpan: 'x', figures: [figure()] }),
    ],
    [
      'a missing columns span',
      reply({ basis: 'consolidated', figures: [figure()] }),
    ],
    [
      'figures that are not an array',
      reply({ basis: 'consolidated', columnsSpan: 'x', figures: {} }),
    ],
    [
      'no usable figure',
      reply({ basis: 'consolidated', columnsSpan: 'x', figures: [] }),
    ],
  ])('returns nothing for %s', (_label, raw) => {
    expect(parseResultsResponse(raw)).toBeNull();
  });

  it.each([
    ['a metric outside the union', figure({ metric: 'gross-margin' })],
    ['a missing span', figure({ span: undefined })],
    ['a numeric current value', figure({ current: 73_977.9 })],
    ['a missing prior value', figure({ prior: undefined })],
    ['an entry that is not an object', 'x'],
    ['a null entry', null],
  ])('drops %s rather than repairing it', (_label, bad) => {
    // Repairing would be this module authoring a number.
    const parsed = parseResultsResponse(
      reply({
        basis: 'consolidated',
        columnsSpan: '30.06.202630.06.2025',
        figures: [bad, figure({ metric: 'net-profit' })],
      }),
    );
    expect(parsed?.figures.map((row) => row.metric)).toEqual(['net-profit']);
  });

  it('never throws on anything a provider can send', () => {
    for (const raw of [undefined, 0, [], { results: [] }, { results: 3 }]) {
      expect(() => parseResultsResponse(raw)).not.toThrow();
    }
  });
});
