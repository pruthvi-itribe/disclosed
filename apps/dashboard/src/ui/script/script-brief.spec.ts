import { renderDashboardPage } from '../page';

/**
 * `briefSignature`, run as the served document carries it — the cut
 * `script-base.spec.ts` makes, for the reason it gives: these fragments are
 * template literals and the served string is the only one worth asserting.
 */
const html = renderDashboardPage(true);

const SCRIPT = html.slice(
  html.indexOf('<script>') + '<script>'.length,
  html.lastIndexOf('</script>'),
);

const cutFunction = (source: string, signature: string): string => {
  const at = source.indexOf(signature);
  if (at < 0) throw new Error(`"${signature}" is not in the served script.`);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error(`"${signature}" is never closed in the served script.`);
};

const signatureOf = (cards: readonly unknown[]): string =>
  new Function(
    'cards',
    'briefLede',
    `${cutFunction(SCRIPT, 'function briefSignature(')}
return briefSignature(cards);`,
  )(cards, (card: { seqId?: number }) => ({
    filing: { seqId: card.seqId ?? 1 },
  })) as string;

describe('briefSignature', () => {
  const card = (claims: readonly string[]) => ({
    symbol: 'AAA',
    seqId: 7,
    claims: claims.map((text) => ({ text })),
  });

  it('is stable for an identical deck', () => {
    expect(signatureOf([card(['a claim'])])).toBe(
      signatureOf([card(['a claim'])]),
    );
  });

  // Enrichment rewrites a filing's claims, state and outcome IN PLACE
  // without moving any arrival time — the exact event the filings route's
  // ETag header documents, and what every backfill tool does. A signature
  // of symbol:seqId alone kept a deck of outdated claims on screen until
  // card order changed; the feed's own feedSignature hashes the whole item
  // for exactly this stated reason.
  it('changes when a claim is rewritten in place', () => {
    expect(signatureOf([card(['the old words'])])).not.toBe(
      signatureOf([card(['the corrected words'])]),
    );
  });
});
