import { extractCounterparty } from './counterparty';
import corpus from './__fixtures__/amount-corpus.json';

/**
 * The counterparty precision gate, measured against the same 60 real filings
 * the amount extractor is measured against.
 *
 * Ten of them carry the Schedule III awarding-entity row. Six name an entity
 * and four deliberately anonymise it, and the module must get all ten right —
 * a wrong name here attributes a commercial relationship between two named
 * listed companies that does not exist, which is the most damaging thing this
 * pipeline could publish.
 *
 * The expected names below are the filers' OWN WORDS, copied out of the
 * committed corpus text. If a change to the module alters one of them, this
 * suite says which and how, rather than reporting a count that moved.
 */

/** Every row in the corpus, verdict recorded by reading the document. */
const EXPECTED: ReadonlyArray<readonly [string, string]> = [
  ['INNOVISION', 'NHAI (National Highways Authority of India)'],
  ['OMPOWER', 'Paschim Gujarat Vij Company Limited'],
  ['RMC', 'Genus Power Infrastructures Limited'],
  ['TEXRAIL', 'South Western Railway'],
  ['CEINSYS', 'Bhandara Municipal Council, Bhandara, Maharashtra'],
  ['CEINSYS', 'EKS InTec India Private Limited'],
];

/** The four rows that answer the regulator without identifying anybody. */
const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ['RAILTEL', 'illegible'],
  ['RPPL', 'described-not-named'],
  ['HFCL', 'described-not-named'],
  ['3IINFOLTD', 'described-not-named'],
];

const results = corpus.map((filing) => ({
  symbol: filing.symbol,
  category: filing.category,
  text: filing.text,
  result: extractCounterparty(filing.text),
}));

const withLabel = results.filter(
  (row) =>
    row.result.outcome === 'extracted' || row.result.reason !== 'no-label',
);

describe('counterparty extraction over the labelled corpus', () => {
  it('finds the awarding-entity row in exactly the filings that carry one', () => {
    expect(withLabel).toHaveLength(EXPECTED.length + REFUSED.length);
  });

  it('emits exactly the six names the filers wrote', () => {
    const emitted = results
      .filter((row) => row.result.outcome === 'extracted')
      .map((row) => [row.symbol, (row.result as { name: string }).name]);

    expect(emitted).toEqual(EXPECTED.map((pair) => [...pair]));
  });

  it('refuses the four anonymised rows, with the reason that explains them', () => {
    const refused = results
      .filter(
        (row) =>
          row.result.outcome === 'refused' && row.result.reason !== 'no-label',
      )
      .map((row) => [row.symbol, (row.result as { reason: string }).reason]);

    expect(refused).toEqual(REFUSED.map((pair) => [...pair]));
  });

  it.each(EXPECTED.map(([, name]) => name))(
    'quotes "%s" as an exact substring of its own source document',
    (name) => {
      const row = results.find(
        (candidate) =>
          candidate.result.outcome === 'extracted' &&
          candidate.result.name === name,
      );
      expect(row).toBeDefined();
      if (row === undefined || row.result.outcome !== 'extracted') return;

      const { evidence, offset } = row.result;
      expect(row.text.slice(offset, offset + evidence.length)).toBe(evidence);
      for (const word of name.split(' ')) {
        expect(evidence).toContain(word);
      }
    },
  );

  it('never emits from a category that does not award orders', () => {
    // The label is self-limiting by construction: it names an order. This
    // asserts that property rather than trusting it, because the day it stops
    // holding is the day an investor deck contributes a "counterparty".
    for (const row of results) {
      if (row.result.outcome !== 'extracted') continue;
      expect(row.category).toMatch(/order|contract/i);
    }
  });

  it('never emits a name the source describes rather than states', () => {
    for (const row of results) {
      if (row.result.outcome !== 'extracted') continue;
      expect(row.result.name).not.toMatch(
        /\b(?:customer|client|leading|reputed|undisclosed|confidential)\b/i,
      );
      expect(row.result.name).not.toMatch(/^(?:a|an)\s/i);
    }
  });
});
