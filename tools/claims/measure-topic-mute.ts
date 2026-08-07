/**
 * What muting the unnameable claims would do to the wire, counted on the live
 * collection.
 *
 * COSTS NOTHING and touches nothing. Every claim's text, kind and topic are
 * already stored; the mute is a pure predicate over them. This tool opens the
 * collection read-only, composes both lines for every claim-bearing filing —
 * the one that is stored today and the one the wire would carry — and counts
 * how they differ. It writes no document.
 *
 * WHY IT COUNTS FILINGS AND NOT ONLY CLAIMS. A share of muted claims says
 * nothing about what a reader would notice: `MAX_CLAIMS_ON_WIRE` is three, so
 * muting the first two claims of a filing that has five changes the line's
 * CONTENT without shortening it, and muting all of a filing's claims removes a
 * message rather than a phrase. Those are three different outcomes and only the
 * last one can lose a filing, so they are counted apart.
 *
 * THIS TOOL IS WHY `claim-mute.ts` LOOKS THE WAY IT DOES. The first predicate
 * muted `other` + `operational` outright; this said it would take the claim line
 * off 139 filings, and printing all 139 showed about 25 that a desk plainly
 * wants — a ₹400-per-share dividend, a cash tender offer for Nagarro, L&T's
 * ONGC orders. The rule was inverted to name the boilerplate instead, and the
 * same run now reports 45. The `--examples` dump is the point of the tool, not
 * a debugging aid: the counts alone would have shipped the first version.
 *
 * Usage:
 *   npm run claims:mute -- [--examples N]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  audibleClaims,
  composeClaimLine,
  composeHeadline,
  composeWireClaimLine,
  isMutedOnWire,
  topicOnWire,
  type VerifiedClaim,
} from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/** How many worked examples of each outcome are printed. */
const DEFAULT_EXAMPLES = 6;

interface Row {
  readonly symbol?: unknown;
  readonly seqId?: unknown;
  readonly category?: unknown;
  readonly enrichment?: {
    readonly claims?: unknown;
    readonly amountRupees?: unknown;
    readonly counterparty?: unknown;
    readonly resultsLine?: unknown;
  };
}

/**
 * Whether this filing would still send a follow-up with no claim line.
 *
 * REPLICATES `EnrichmentWorker.announce` RATHER THAN APPROXIMATING IT, because
 * the obvious approximation is wrong in a way that flatters the change. Testing
 * `enrichment.headline` for null answers "this filing still alerts" every single
 * time — it is non-null on every one of the claim-bearing filings, since
 * `composeHeadline` always returns text and falls back to the symbol and
 * category. The alert uses it only when its FORM is `enriched`, which needs both
 * a verified amount and a category the action-phrase table knows, and that form
 * is derived rather than stored. Getting this wrong reported 138 of 139 silenced
 * filings as harmless when the true figure was 9.
 */
const wouldStillAlert = (row: Row): boolean => {
  const amount = row.enrichment?.amountRupees;
  const headline = composeHeadline({
    symbol: typeof row.symbol === 'string' ? row.symbol : '',
    category: typeof row.category === 'string' ? row.category : '',
    amountRupees: typeof amount === 'number' ? amount : null,
    counterparty:
      typeof row.enrichment?.counterparty === 'string'
        ? row.enrichment.counterparty
        : null,
  });
  const results = row.enrichment?.resultsLine;
  return (
    headline.form === 'enriched' ||
    (typeof results === 'string' && results.trim().length > 0)
  );
};

/**
 * A stored claim read back as the type the predicate expects.
 *
 * The projection is trusted no further than its shape: a claim whose `text` is
 * missing becomes an empty string, which `claimTopic` files as `other` and the
 * composer drops. Nothing here can throw on a malformed row.
 */
const asClaim = (value: unknown): VerifiedClaim => {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    text: typeof row.text === 'string' ? row.text : '',
    span: typeof row.span === 'string' ? row.span : '',
    kind: (typeof row.kind === 'string'
      ? row.kind
      : 'operational') as VerifiedClaim['kind'],
    ...(typeof row.topic === 'string'
      ? { topic: row.topic as VerifiedClaim['topic'] }
      : {}),
    periodSpan: null,
  };
};

const argOf = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const parsed = Number(process.argv[at + 1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

async function main(): Promise<void> {
  const config = loadConfig();
  const examples = argOf('--examples', DEFAULT_EXAMPLES);

  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (db === undefined) throw new Error('no database handle');

  const rows = (await db
    .collection('filings')
    .find({ 'enrichment.claims.0': { $exists: true } })
    .project({
      _id: 0,
      seqId: 1,
      symbol: 1,
      category: 1,
      'enrichment.claims': 1,
      'enrichment.amountRupees': 1,
      'enrichment.counterparty': 1,
      'enrichment.resultsLine': 1,
    })
    .toArray()) as Row[];

  let claims = 0;
  let mutedClaims = 0;
  let unchanged = 0;
  let shortened = 0;
  let rewritten = 0;
  let silenced = 0;
  /** Of the silenced, how many still have another reason to send a message. */
  let silencedButAlerting = 0;
  /** Of the silenced, how many lose their follow-up message entirely. */
  let silencedAndSilent = 0;

  const shown: Record<string, string[]> = {
    shortened: [],
    rewritten: [],
    silenced: [],
    'silenced, no other reason to send': [],
  };
  const keep = (bucket: string, line: string): void => {
    if (shown[bucket].length < examples) shown[bucket].push(line);
  };

  for (const row of rows) {
    const symbol = typeof row.symbol === 'string' ? row.symbol : '';
    const stored = (
      Array.isArray(row.enrichment?.claims) ? row.enrichment.claims : []
    ).map(asClaim);

    claims += stored.length;
    mutedClaims += stored.filter(isMutedOnWire).length;

    const before = composeClaimLine(symbol, stored);
    const after = composeWireClaimLine(symbol, stored);

    if (before === after) {
      unchanged += 1;
      continue;
    }

    if (after === null) {
      silenced += 1;
      if (wouldStillAlert(row)) {
        silencedButAlerting += 1;
        keep('silenced', before ?? '');
      } else {
        silencedAndSilent += 1;
        keep('silenced, no other reason to send', before ?? '');
      }
      continue;
    }

    // A line that lost claims from its tail versus one whose head changed. The
    // second is the promotion effect and is an improvement, not a cost.
    const kept = audibleClaims(stored);
    const wasCarried = stored.slice(0, kept.length);
    if (wasCarried.every((claim, i) => claim.text === kept[i].text)) {
      shortened += 1;
      keep('shortened', `${before ?? ''}\n        -> ${after}`);
    } else {
      rewritten += 1;
      keep('rewritten', `${before ?? ''}\n        -> ${after}`);
    }
  }

  const pct = (n: number, of: number): string =>
    of === 0 ? '0.0%' : `${((n / of) * 100).toFixed(1)}%`;

  const out = process.stdout;
  out.write(`claim-bearing filings: ${rows.length}\n`);
  out.write(`claims: ${claims}\n`);
  out.write(
    `claims muted: ${mutedClaims} (${pct(mutedClaims, claims)} of all claims)\n\n`,
  );

  out.write('filings, by what the wire line does:\n');
  for (const [label, count] of [
    ['unaffected', unchanged],
    ['shorter, same head', shortened],
    ['different head (a claim promoted)', rewritten],
    ['no claim line at all', silenced],
  ] as const) {
    out.write(
      `  ${label.padEnd(34)}${String(count).padStart(5)}  ${pct(count, rows.length)}\n`,
    );
  }

  out.write('\nof the filings that lose their claim line:\n');
  out.write(
    `  still alert on a headline or results  ${String(silencedButAlerting).padStart(5)}\n`,
  );
  out.write(
    `  send no follow-up at all              ${String(silencedAndSilent).padStart(5)}  ` +
      `(${pct(silencedAndSilent, rows.length)} of claim-bearing filings)\n`,
  );

  const topics: Record<string, number> = {};
  for (const row of rows) {
    const stored = (
      Array.isArray(row.enrichment?.claims) ? row.enrichment.claims : []
    ).map(asClaim);
    for (const claim of stored) {
      if (!isMutedOnWire(claim)) continue;
      const key = topicOnWire(claim);
      topics[key] = (topics[key] ?? 0) + 1;
    }
  }
  out.write(`\nmuted claims by topic (a check: only 'other' may appear):\n`);
  for (const [topic, count] of Object.entries(topics)) {
    out.write(`  ${topic.padEnd(12)}${String(count).padStart(5)}\n`);
  }

  for (const [bucket, lines] of Object.entries(shown)) {
    if (lines.length === 0) continue;
    out.write(`\n--- ${bucket} ---\n`);
    for (const line of lines) out.write(`     ${line}\n`);
  }

  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
