import {
  claimDirection,
  unprintedMovement,
  type ClaimDirection,
} from './claim-direction';
import corpus from './__fixtures__/claim-direction-corpus.json';

/**
 * The coverage gate for the direction tag.
 *
 * ================================================================
 * WHAT THE CORPUS IS
 * ================================================================
 *
 * Every verified claim in the live collection on 2026-08-08 — 3,461 of them
 * across 1,169 filings — projected as `{seqId, symbol, text, span}` with
 * whitespace collapsed, and nothing else. The `span` is the document's own
 * bytes at the position `claim-span.ts` matched, so these are the exact strings
 * the classifier sees in production. Committed so the measurement in
 * `claim-direction.ts`'s header is reproducible rather than asserted:
 *
 *   mongosh mongodb://localhost:27117/turret --eval \
 *     'db.filings.find({"enrichment.claims.0":{$exists:true}},
 *                      {seqId:1,symbol:1,"enrichment.claims":1})'
 *
 * ================================================================
 * WHY THE DISTRIBUTION IS PINNED
 * ================================================================
 *
 * The tag is a rule list, and a rule list drifts. Adding one word to `UP`
 * silently moves coverage across three thousand claims, and the only way that
 * shows up as a decision somebody made rather than as a number nobody noticed
 * is a red build. `amount-corpus.spec.ts` pins recall the same way and for the
 * same reason: passing by refusing everything must not be available.
 */

interface CorpusClaim {
  readonly seqId: number;
  readonly symbol: string;
  readonly text: string;
  readonly span: string;
}

const claims = corpus as readonly CorpusClaim[];

const tally = (): Readonly<Record<ClaimDirection, number>> => {
  const counts: Record<ClaimDirection, number> = {
    expansion: 0,
    contraction: 0,
    mixed: 0,
    unrated: 0,
  };
  for (const claim of claims) counts[claimDirection(claim.span).direction] += 1;
  return counts;
};

describe('the corpus itself', () => {
  it('is the whole claim collection, one row per claim', () => {
    expect(claims).toHaveLength(3_461);
    expect(new Set(claims.map((claim) => claim.seqId)).size).toBe(1_169);
  });

  it('carries a span for every claim, collapsed as the classifier reads them', () => {
    for (const claim of claims) {
      expect(claim.span.length).toBeGreaterThan(0);
      expect(claim.span).toBe(claim.span.replace(/\s+/g, ' ').trim());
    }
  });
});

describe('the measured distribution', () => {
  it('tags 803 of 3,461 claims — 23.2%', () => {
    const counts = tally();
    const tagged = counts.expansion + counts.contraction + counts.mixed;
    expect(tagged).toBe(803);
    expect(Number(((tagged / claims.length) * 100).toFixed(1))).toBe(23.2);
  });

  it('splits them 746 expansion / 45 contraction / 12 mixed', () => {
    // 16.6 up for every one down. THE CORPUS IS STRUCTURALLY OPTIMISTIC and
    // that is not a fact about the market: a company files an investor
    // presentation about a good quarter and a bare results table about a bad
    // one, and `legal-block.ts` refuses litigation, enforcement and insolvency
    // filings outright — 41 of them, which produced zero claims between them.
    // Any surface that AGGREGATES these counts is publishing a cheerful lie it
    // manufactured itself, which is why the product shows the mark per claim
    // and refuses to total it.
    expect(tally()).toEqual({
      expansion: 746,
      contraction: 45,
      mixed: 12,
      unrated: 2_658,
    });
  });

  it('leaves 76.8% unrated, and that is the honest floor', () => {
    // NOT A FAILURE AND NOT TO BE TUNED AWAY, for the reason `claim-topic.ts`
    // keeps `other` at 39.4%: an absent mark means the filing printed no
    // checkable movement, which is a real answer about a real claim.
    const counts = tally();
    expect(Number(((counts.unrated / claims.length) * 100).toFixed(1))).toBe(
      76.8,
    );
  });

  it('reaches 348 of 1,169 claim-bearing filings — 29.8%', () => {
    // The number that reframes the feature: a direction mark is a SOMETIMES
    // marker on a minority of cards, not a rating on every update.
    const tagged = new Set<number>();
    for (const claim of claims) {
      if (claimDirection(claim.span).direction !== 'unrated')
        tagged.add(claim.seqId);
    }
    expect(tagged.size).toBe(348);
  });
});

describe('a fall is not bad news', () => {
  /**
   * Metrics whose DECREASE every reader would call an improvement. Written as a
   * list rather than a judgement so the count below is reproducible.
   */
  const GOOD_NEWS_FALL =
    /\b(?:NPA|non-performing|slippages?|net debt|gross debt|cost of (?:debt|borrowing|funds)|borrowing cost|provisions?|emissions?|energy consumption|restructured assets)\b/i;

  it('finds 13 of the 45 contractions are falls a reader wants — 28.9%', () => {
    // THE MEASUREMENT THAT FORBIDS COLOUR. Red on these thirteen would be
    // wrong: ESAF's gross NPA down from 7.5% to 5.4%, Muthoot Capital's GNPA
    // down from 25.93% to 3.94%, Lemon Tree's cost of debt down 53 bps,
    // Chambal's Scope 1 emissions down 7.7%. The mark follows the figure and
    // never the company, and `page-style.ts` gives it `color: inherit` because
    // of this line.
    const falls = claims.filter(
      (claim) => claimDirection(claim.span).direction === 'contraction',
    );
    const good = falls.filter((claim) => GOOD_NEWS_FALL.test(claim.span));
    expect(falls).toHaveLength(45);
    expect(good).toHaveLength(13);
    expect([...new Set(good.map((claim) => claim.symbol))].sort()).toEqual([
      'CHAMBLFERT',
      'EDELWEISS',
      'ESAFSFB',
      'KPITTECH',
      'LEMONTREE',
      'MASFIN',
      'MUTHOOTCAP',
      'PDSL',
      'TENNIND',
      'VISHNU',
    ]);
  });
});

describe('every tag is checkable against the document', () => {
  it('quotes evidence verbatim from the span, on all 803 of them', () => {
    // The whole promise of the mark: the `title` shows the characters the
    // document printed, so a reader can check it without opening the PDF. An
    // evidence string that is not IN the span would be this pipeline writing a
    // sentence, which is the one thing it may not do.
    for (const claim of claims) {
      const reading = claimDirection(claim.span);
      if (reading.direction === 'unrated') {
        expect(reading.evidence).toBe('');
        continue;
      }
      expect(claim.span).toContain(reading.evidence);
    }
  });
});

/**
 * THE SIZE OF THE HOLE THE GATE NOW CLOSES.
 *
 * These claims are already stored and already published. Nothing here purges
 * them — this suite MEASURES what the new rule would refuse, so the decision to
 * leave the collection alone is a decision somebody made against a number
 * rather than an omission. The rule applies from now on, at acceptance.
 */
describe('what the direction rule would have refused', () => {
  const flagged = claims.filter(
    (claim) => unprintedMovement(claim.text, claim.span) !== null,
  );

  it('refuses 86 of the 3,461 stored claims — 2.5%', () => {
    expect(flagged).toHaveLength(86);
    expect(Number(((flagged.length / claims.length) * 100).toFixed(1))).toBe(
      2.5,
    );
  });

  it('touches 53 filings, of which 7 would keep no claim at all', () => {
    // The number that decides whether this is a discard or a downgrade. Seven
    // filings out of 1,169 would go silent, and every one of them says its
    // figures moved on the strength of a table the document never labelled.
    const perFiling = new Map<number, { total: number; flagged: number }>();
    for (const claim of claims) {
      const row = perFiling.get(claim.seqId) ?? { total: 0, flagged: 0 };
      row.total += 1;
      if (unprintedMovement(claim.text, claim.span) !== null) row.flagged += 1;
      perFiling.set(claim.seqId, row);
    }
    const touched = [...perFiling.values()].filter((row) => row.flagged > 0);
    expect(touched).toHaveLength(53);
    expect(touched.filter((row) => row.flagged === row.total)).toHaveLength(7);
  });

  it('refuses the direction and not the paraphrase', () => {
    // THE LINE, ASSERTED AS A RATIO. Requiring the claim's exact word to be in
    // the span — the eight commonest, below — flags 567 claims (16.4%), and
    // reading them, nearly all are honest paraphrase: "growth of 15.1%"
    // written as "up 15.1%". This rule flags 86, so 481 true claims survive a
    // reading that would have refused them over a synonym.
    const exactWord = claims.filter((claim) => {
      const words = claim.text.toLowerCase().match(/\b[a-z-]+\b/g) ?? [];
      const span = claim.span.toLowerCase();
      return words.some(
        (word) =>
          /^(up|down|rose|fell|grew|growth|increased|declined)$/.test(word) &&
          !span.includes(word),
      );
    });
    expect(exactWord).toHaveLength(567);
    expect(flagged.length).toBeLessThan(exactWord.length / 4);
  });
});
