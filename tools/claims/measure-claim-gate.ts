/**
 * Measures what the claim gate would cost, against the live collection.
 *
 * WHY THIS EXISTS. The claim lane's one operational risk is spend: it calls a
 * frontier model, and the difference between calling it on every filing and
 * calling it on the ones that could possibly carry a claim is the difference
 * between a line item and a rounding error. "About a fifth of filings" is not a
 * number anybody should ship on, so this counts it.
 *
 * TWO PASSES, because the two halves of the gate cost different things to check:
 *
 *   1. Over the WHOLE collection, with no network at all: the routine check,
 *      the category allowlist, the legal block, and the covering-letter length
 *      bound. Every input is a stored field, so this is exact.
 *   2. Over a SAMPLE, re-fetching and re-parsing the documents: the claim
 *      vocabulary test, which needs the text. Reported separately, because it
 *      is an estimate and should be read as one.
 *
 * The cost figure is then computed from the REAL document lengths of the
 * documents that survive, capped exactly as `buildClaimRequest` caps them.
 *
 * Run:  npx ts-node -r tsconfig-paths/register tools/claims/measure-claim-gate.ts [--sample 40]
 */
import mongoose from 'mongoose';
import {
  AttachmentFetcher,
  CLAIM_BEARING_CATEGORIES,
  claimEligibility,
  extractPdfText,
  FilingSchema,
  isLegallyBlocked,
  isRoutine,
  MAX_DOCUMENT_CHARS,
  MIN_CLAIM_DOCUMENT_CHARS,
  type FilingDocument,
} from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/**
 * Claude Opus 5 list prices, per million tokens. Stated here rather than
 * fetched so the arithmetic below is reproducible from the file alone; they are
 * the only numbers in this tool that are not measured.
 */
const INPUT_PER_MTOK = 5;
const OUTPUT_PER_MTOK = 25;

/** Characters per token, the usual English-prose approximation. */
const CHARS_PER_TOKEN = 4;

/** Tokens a three-claim JSON reply costs, generously. */
const OUTPUT_TOKENS = 500;

const readArg = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${name} must be a finite number >= 0`);
  }
  return value;
};

const pct = (part: number, whole: number): string =>
  whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;

interface Row {
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
  readonly attachmentUrl: string | null;
  readonly enrichment?: { documentChars?: number | null };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sampleSize = readArg('sample', 40);

  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);

  const rows = (await model
    .find(
      {},
      {
        _id: 0,
        symbol: 1,
        category: 1,
        summary: 1,
        attachmentUrl: 1,
        'enrichment.documentChars': 1,
      },
    )
    .lean()
    .exec()) as unknown as Row[];

  // ---- pass 1: the cheap gates, over everything -----------------------------
  let routine = 0;
  let offCategory = 0;
  let blocked = 0;
  let tooShort = 0;
  const survivors: Row[] = [];

  for (const row of rows) {
    if (isRoutine(row.category)) {
      routine += 1;
      continue;
    }
    if (!CLAIM_BEARING_CATEGORIES.has(row.category.trim().toLowerCase())) {
      offCategory += 1;
      continue;
    }
    if (isLegallyBlocked(row)) {
      blocked += 1;
      continue;
    }
    const chars = row.enrichment?.documentChars ?? 0;
    if (chars < MIN_CLAIM_DOCUMENT_CHARS) {
      tooShort += 1;
      continue;
    }
    survivors.push(row);
  }

  const total = rows.length;
  process.stdout.write(
    `collection: ${total} filing(s)\n\n` +
      `--- pass 1: the deterministic gates, exact over the whole collection ---\n` +
      `routine category            ${String(routine).padStart(5)}  ${pct(routine, total)}\n` +
      `not a claim-bearing category${String(offCategory).padStart(5)}  ${pct(offCategory, total)}\n` +
      `legally blocked             ${String(blocked).padStart(5)}  ${pct(blocked, total)}\n` +
      `covering letter (<${MIN_CLAIM_DOCUMENT_CHARS} chars)${String(tooShort).padStart(4)}  ${pct(tooShort, total)}\n` +
      `SURVIVE pass 1              ${String(survivors.length).padStart(5)}  ${pct(survivors.length, total)}\n\n`,
  );

  // ---- pass 2: the vocabulary gate, on a sample -----------------------------
  const fetcher = new AttachmentFetcher(config.enrichmentMaxBytes);
  const sample = survivors.slice(0, sampleSize);
  let eligible = 0;
  let noVocabulary = 0;
  let unreadable = 0;
  let promptChars = 0;

  for (const row of sample) {
    if (row.attachmentUrl === null) continue;
    const fetched = await fetcher.fetch(row.attachmentUrl);
    if (fetched.outcome !== 'ok') {
      unreadable += 1;
      continue;
    }
    const parsed = await extractPdfText(fetched.body);
    if (parsed.outcome !== 'ok') {
      unreadable += 1;
      continue;
    }
    const verdict = claimEligibility(row, parsed.text);
    if (verdict.eligible) {
      eligible += 1;
      promptChars += Math.min(parsed.text.length, MAX_DOCUMENT_CHARS);
    } else {
      noVocabulary += 1;
      process.stdout.write(`  skipped ${row.symbol}: ${verdict.reason}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  const read = eligible + noVocabulary;
  const keep = read === 0 ? 0 : eligible / read;

  process.stdout.write(
    `\n--- pass 2: the vocabulary gate, on ${sample.length} sampled document(s) ---\n` +
      `read successfully           ${String(read).padStart(5)}\n` +
      `unreadable (not the gate)   ${String(unreadable).padStart(5)}\n` +
      `eligible                    ${String(eligible).padStart(5)}  ${pct(eligible, read)}\n` +
      `no claim vocabulary         ${String(noVocabulary).padStart(5)}  ${pct(noVocabulary, read)}\n`,
  );

  // ---- the cost --------------------------------------------------------------
  const eligibleRate = (survivors.length / total) * keep;
  const meanPromptChars = eligible === 0 ? 0 : promptChars / eligible;
  const promptTokens = meanPromptChars / CHARS_PER_TOKEN;
  const perCall =
    (promptTokens / 1e6) * INPUT_PER_MTOK + (OUTPUT_TOKENS / 1e6) * OUTPUT_PER_MTOK;

  for (const perDay of [500, 700, 1000]) {
    const calls = perDay * eligibleRate;
    process.stdout.write(
      `\nat ${perDay} filings/day: ${calls.toFixed(0)} model call(s)/day ` +
        `(${pct(eligibleRate, 1)}), ~${promptTokens.toFixed(0)} prompt tokens each, ` +
        `$${(calls * perCall).toFixed(2)}/day, $${(calls * perCall * 30).toFixed(0)}/month\n`,
    );
  }
  process.stdout.write(
    '\nUNCACHED prices. The system prompt is a cache breakpoint and is ' +
      'byte-identical on every call, so the steady-state figure is lower.\n',
  );

  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `claim gate measurement failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
