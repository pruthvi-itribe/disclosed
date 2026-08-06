/**
 * What this pipeline emits for the three filings it failed on, next to what the
 * competitor published.
 *
 * THE ACCEPTANCE TEST, runnable. On 2026-08-06 a competitor published six wire
 * lines; three were about companies whose source documents this pipeline
 * already held, and this pipeline published nothing for any of them. The
 * documents in `libs/filings/src/logic/__fixtures__/claim-corpus.json` are those
 * three, fetched from NSE and parsed by the same code the worker runs.
 *
 * TWO MODES, and the difference matters:
 *
 *   default   Replays hand-written candidate claims through the real gate — the
 *             true ones quoting real sentences, the fabricated ones being the
 *             plausible inventions a model produces. This proves the
 *             DETERMINISTIC half: eligibility, the verbatim span match, the
 *             number rule, and the composed line. It does NOT prove what any
 *             model proposes, and must not be read as if it did.
 *
 *   --live    Calls the configured model on the real documents. Needs
 *             ANTHROPIC_API_KEY. This is the half a `.spec.ts` in this project
 *             is deliberately incapable of doing, because no test here makes a
 *             network request.
 *
 * Run:  npx ts-node -r tsconfig-paths/register tools/claims/verify-corpus.ts [--live]
 */
import {
  claimEligibility,
  composeClaimLine,
  verifyClaims,
  type ClaimExtractor,
  type ProposedClaim,
} from '@app/filings';
import { buildClaimExtractor } from '../../apps/ingest/src/enrichment/claim-extractor.factory';
import { loadConfig } from '../../apps/ingest/src/config/configuration';
import corpus from '../../libs/filings/src/logic/__fixtures__/claim-corpus.json';

interface CorpusFiling {
  readonly seqId: number;
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
  readonly text: string;
}

/** Exactly what the competitor published, for the side-by-side. */
const PUBLISHED: Readonly<Record<string, readonly string[]>> = {
  SWIGGY: ['SWIGGY: CO.TARGETS 100B RUPEES ADJ EBITDA BY FY31'],
  BIOCON: [
    'BIOCON: STRENGTHENED REGIONAL SUPPLY NETWORK THROUGH GLOBAL MFG FOOTPRINT',
    '|| EXPANDING COMMERCIAL FOOTPRINT IN FRANCE, PORTUGAL, SLOVENIA, SPAIN',
  ],
  WELENT: [
    'WELSPUN ENTERPRISES LOWERS TOPLINE GUIDANCE FROM 15-20% TO 10-20%   TV INTERVIEWS',
  ],
};

/**
 * Candidate claims, written by hand against the real documents.
 *
 * The `true` ones quote sentences that are in the filings. The `fabricated`
 * ones are what a model produces when it is confident and wrong, including the
 * two claims the competitor published that this pipeline's documents do not
 * contain.
 */
const CANDIDATES: Readonly<
  Record<string, readonly (ProposedClaim & { readonly fabricated?: boolean })[]>
> = {
  SWIGGY: [
    {
      span: 'outlined its FY31 vision at Capital Markets Day 2026, setting out its goal to build a ₹10,000 Cr. Adjusted EBITDA business',
      text: 'targets ₹10,000 Cr adjusted EBITDA business by FY31',
      kind: 'target',
    },
    {
      span: 'By FY31, Swiggy expects Food Delivery GOV to grow 2.5-3.5x',
      text: 'expects Food Delivery GOV to grow 2.5-3.5x by FY31',
      kind: 'guidance',
    },
    {
      // The competitor's own unit conversion. ₹10,000 Cr IS 100 billion rupees.
      span: 'outlined its FY31 vision at Capital Markets Day 2026, setting out its goal to build a ₹10,000 Cr. Adjusted EBITDA business',
      text: 'targets 100B rupees adj EBITDA by FY31',
      kind: 'target',
      fabricated: true,
    },
    {
      span: 'Swiggy will be EBITDA positive across all segments by FY28.',
      text: 'expects all segments EBITDA positive by FY28',
      kind: 'guidance',
      fabricated: true,
    },
  ],
  BIOCON: [
    {
      span: 'Regional supply network strengthened through local capabilities and strategic partnerships',
      text: 'strengthened regional supply network through local capabilities and partnerships',
      kind: 'expansion',
    },
    {
      span: 'EMA approval for second insulin drug product line in Malaysia doubles capacity',
      text: 'EMA approval for second insulin line in Malaysia doubles capacity',
      kind: 'approval',
    },
    {
      span: 'Combined portfolio of 11 biosimilars and eight generic medicines',
      text: 'combined portfolio of 11 biosimilars and eight generic medicines',
      kind: 'operational',
    },
    {
      // The competitor's second Biocon claim. This document names no European
      // country at all.
      span: 'Expanding commercial footprint in France, Portugal, Slovenia, Spain',
      text: 'expanding commercial footprint in France, Portugal, Slovenia, Spain',
      kind: 'expansion',
      fabricated: true,
    },
  ],
  WELENT: [
    {
      // The competitor tagged this TV INTERVIEWS. It is not in any filing.
      span: 'The Company lowers its topline guidance from 15-20% to 10-20%',
      text: 'lowers topline guidance from 15-20% to 10-20%',
      kind: 'guidance',
      fabricated: true,
    },
  ],
};

const line = (text = ''): void => {
  process.stdout.write(`${text}\n`);
};

async function proposalsFor(
  filing: CorpusFiling,
  extractor: ClaimExtractor | null,
): Promise<readonly ProposedClaim[]> {
  if (extractor === null) {
    return CANDIDATES[filing.symbol] ?? [];
  }
  const result = await extractor.extract({
    symbol: filing.symbol,
    category: filing.category,
    summary: filing.summary,
    documentText: filing.text,
  });
  if (result.outcome === 'failed') {
    line(`    EXTRACTOR FAILED: ${result.message}`);
    return [];
  }
  return result.claims;
}

async function main(): Promise<void> {
  const live = process.argv.includes('--live');
  const config = loadConfig();
  const extractor = live ? buildClaimExtractor(config) : null;

  if (live && extractor === null) {
    process.stderr.write(
      '--live needs ANTHROPIC_API_KEY (and CLAIM_ENABLED not off).\n',
    );
    process.exit(1);
  }

  line(
    live
      ? `mode: LIVE — ${config.claimModel} at ${config.claimEffort} effort`
      : 'mode: REPLAY — hand-written candidates through the real gate. ' +
          'This does NOT show what a model proposes.',
  );

  let emitted = 0;
  let discarded = 0;

  for (const filing of corpus as readonly CorpusFiling[]) {
    line();
    line('='.repeat(78));
    line(`${filing.symbol}  seqId ${filing.seqId}  ${filing.category}`);
    line(`${filing.text.length} characters of document text`);
    line();

    line('  REDBOX PUBLISHED:');
    for (const published of PUBLISHED[filing.symbol] ?? []) {
      line(`    ${published}`);
    }
    line();

    const eligibility = claimEligibility(filing, filing.text);
    if (!eligibility.eligible) {
      line(`  TURRET EMITS: nothing — ${eligibility.reason}`);
      continue;
    }

    const proposed = await proposalsFor(filing, extractor);
    const { claims, discards } = verifyClaims({
      documentText: filing.text,
      proposed,
    });
    const composed = composeClaimLine(filing.symbol, claims);
    emitted += claims.length;
    discarded += discards.length;

    line(`  TURRET EMITS: ${composed ?? 'nothing'}`);
    line();
    for (const claim of claims) {
      line(`    accepted [${claim.kind}] ${claim.text}`);
      line(`      quoting: "${claim.span.replace(/\s+/g, ' ').trim()}"`);
    }
    for (const row of discards) {
      line(`    DISCARDED [${row.reason}] ${row.claim}`);
      line(`      because: ${row.detail}`);
    }
  }

  line();
  line('='.repeat(78));
  line(`${emitted} claim(s) emitted, ${discarded} discarded by the gate.`);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `corpus verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
