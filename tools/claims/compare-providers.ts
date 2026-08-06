// Load .env before anything reads process.env. The Nest apps get this from
// ConfigModule.forRoot, but this is a plain ts-node script with no Nest
// container, so without this line a key that is correctly sitting in .env
// reads as absent and the run exits claiming there are no credentials.
import 'dotenv/config';

/**
 * Runs BOTH providers over the SAME filings and reports what each one did.
 *
 * WHY THIS EXISTS. `claude-claim-extractor.ts` asserts that a cheaper model
 * which invents more is not cheaper. That is a claim about the world, and until
 * this tool is run against real documents with real keys it is an opinion in a
 * comment. The number it exists to produce is the INVENTION RATE — how often a
 * model quotes a sentence the document does not contain — because that is the
 * one the verbatim gate is built to catch and the one that decides whether the
 * cheap provider buys coverage or costs it.
 *
 * WHAT IS HELD CONSTANT. The same documents, in the same order, through the same
 * eligibility gate, with the same prompt, schema, document cap, token ceiling
 * and timeout. Both providers' proposals go through the same `verifyClaims`.
 * The only variable is which model answered.
 *
 * WHAT IT COSTS. Bounded by `--sample`, which caps how many stored filings are
 * added to the three committed ones. The estimate is printed before the first
 * call and the measured spend after the last, so a run that costs more than it
 * said is visible rather than discovered on a bill.
 *
 * IT REFUSES TO PRETEND. With no key for a provider it says so and reports the
 * other one alone; with no key at all it exits non-zero. There is no offline
 * mode here on purpose — `verify-corpus.ts` already replays hand-written
 * candidates through the gate, and a second tool that could print a table
 * without calling a model is a table somebody will eventually mistake for a
 * measurement.
 *
 * Run:  npm run claims:compare -- --sample 8
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import mongoose from 'mongoose';
import {
  AttachmentFetcher,
  CLAIM_BEARING_CATEGORIES,
  CLAIM_PROVIDERS,
  claimEligibility,
  composeClaimLine,
  DEFAULT_CLAIM_MODEL,
  extractPdfText,
  FilingSchema,
  isLegallyBlocked,
  isRoutine,
  MAX_DOCUMENT_CHARS,
  MIN_CLAIM_DOCUMENT_CHARS,
  verifyClaims,
  type ClaimExtractor,
  type ClaimProviderName,
  type FilingDocument,
} from '@app/filings';
import { ClaudeClaimExtractor } from '@app/filings/llm/claude-claim-extractor';
import { OpenRouterClaimExtractor } from '@app/filings/llm/openrouter-claim-extractor';
import { loadConfig } from '../../apps/ingest/src/config/configuration';
import corpus from '../../libs/filings/src/logic/__fixtures__/claim-corpus.json';
import {
  CLAIM_PROVIDER_PRICING,
  ELIGIBLE_FILINGS_PER_DAY,
  renderComparison,
  summarise,
  type CallRecord,
} from './comparison-report';

interface Document {
  readonly seqId: number;
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
  readonly text: string;
}

const DEFAULT_OUT =
  '.superpowers/sdd/2026-08-05-ingest-core/provider-ab-comparison.md';

/** The three documents this project benchmarks against, always included. */
const CORPUS = corpus as readonly Document[];

const line = (text = ''): void => {
  process.stdout.write(`${text}\n`);
};

const readFlag = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
};

/** The same `Number.isFinite` discipline the configuration uses, for a flag. */
const readCount = (name: string, fallback: number): number => {
  const raw = readFlag(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} must be a whole number >= 0, but was "${raw}".`);
  }
  return value;
};

/**
 * Builds one extractor per provider that has a key.
 *
 * The model follows the same rule the configuration does: the provider the
 * pipeline is actually configured for uses its configured model, so the run
 * measures what production would do; the other uses its own default, so it is
 * never handed a model id it cannot resolve. `--model-<provider>` overrides
 * either.
 */
const extractorsFor = (
  config: ReturnType<typeof loadConfig>,
): {
  provider: ClaimProviderName;
  model: string;
  extractor: ClaimExtractor;
}[] =>
  CLAIM_PROVIDERS.flatMap((provider) => {
    const apiKey =
      provider === 'openrouter'
        ? config.openrouterApiKey
        : config.anthropicApiKey;
    const model =
      readFlag(`model-${provider}`) ??
      (config.claimProvider === provider
        ? config.claimModel
        : DEFAULT_CLAIM_MODEL[provider]);
    const options = { model, effort: config.claimEffort };
    const extractor =
      provider === 'openrouter'
        ? OpenRouterClaimExtractor.fromApiKey(apiKey, options)
        : ClaudeClaimExtractor.fromApiKey(apiKey, options);
    return extractor === null ? [] : [{ provider, model, extractor }];
  });

/**
 * Adds stored filings to the corpus, refetching and reparsing each one.
 *
 * The same two passes `measure-claim-gate.ts` uses: the cheap stored-field gates
 * first, then the document itself. Fetches are paced at the configured delay
 * against NSE's archive host, which is the reason this is the slow part of a run
 * and not the model calls.
 */
async function storedSample(
  config: ReturnType<typeof loadConfig>,
  wanted: number,
): Promise<Document[]> {
  if (wanted === 0) return [];

  const documents: Document[] = [];
  await mongoose.connect(config.mongoUri);
  try {
    const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
    const rows = (await model
      .find(
        {},
        {
          _id: 0,
          seqId: 1,
          symbol: 1,
          category: 1,
          summary: 1,
          attachmentUrl: 1,
          'enrichment.documentChars': 1,
        },
      )
      .sort({ seqId: -1 })
      .lean()
      .exec()) as unknown as {
      seqId: number;
      symbol: string;
      category: string;
      summary: string;
      attachmentUrl: string | null;
      enrichment?: { documentChars?: number | null };
    }[];

    const fetcher = new AttachmentFetcher(config.enrichmentMaxBytes);
    const seen = new Set(CORPUS.map((filing) => filing.seqId));

    for (const row of rows) {
      if (documents.length >= wanted) break;
      if (seen.has(row.seqId) || row.attachmentUrl === null) continue;
      if (isRoutine(row.category)) continue;
      if (!CLAIM_BEARING_CATEGORIES.has(row.category.trim().toLowerCase())) {
        continue;
      }
      if (isLegallyBlocked(row)) continue;
      if ((row.enrichment?.documentChars ?? 0) < MIN_CLAIM_DOCUMENT_CHARS) {
        continue;
      }

      const fetched = await fetcher.fetch(row.attachmentUrl);
      await new Promise((done) =>
        setTimeout(done, config.enrichmentRequestDelayMs),
      );
      if (fetched.outcome !== 'ok') continue;
      const parsed = await extractPdfText(fetched.body);
      if (parsed.outcome !== 'ok') continue;

      seen.add(row.seqId);
      documents.push({
        seqId: row.seqId,
        symbol: row.symbol,
        category: row.category,
        summary: row.summary,
        text: parsed.text,
      });
      line(
        `  sampled ${row.symbol} seqId ${row.seqId} (${parsed.text.length} chars)`,
      );
    }
  } finally {
    await mongoose.disconnect();
  }
  return documents;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sampleSize = readCount('sample', 8);
  const outPath = resolve(readFlag('out') ?? DEFAULT_OUT);

  const providers = extractorsFor(config);
  for (const provider of CLAIM_PROVIDERS) {
    const built = providers.find((entry) => entry.provider === provider);
    line(
      built === undefined
        ? `${provider}: NO KEY — skipped`
        : `${provider}: ${built.model} at ${config.claimEffort} effort`,
    );
  }

  if (providers.length === 0) {
    process.stderr.write(
      'No provider has a key. Set ANTHROPIC_API_KEY and/or OPENROUTER_API_KEY.\n',
    );
    process.exit(1);
  }
  if (providers.length === 1) {
    line('');
    line(
      'WARNING: only one provider has a key, so this run is a measurement of ' +
        'that provider and not a comparison.',
    );
  }

  line('');
  line('Collecting documents...');
  const documents = [...CORPUS, ...(await storedSample(config, sampleSize))];

  // Eligibility runs ONCE, before any provider is called, exactly as it does in
  // the worker — so both providers see the identical set and neither is charged
  // for a filing the deterministic gate had already ruled out.
  const eligible: Document[] = [];
  const ineligible: { symbol: string; reason: string }[] = [];
  for (const document of documents) {
    const verdict = claimEligibility(document, document.text);
    if (verdict.eligible) eligible.push(document);
    else ineligible.push({ symbol: document.symbol, reason: verdict.reason });
  }

  const promptChars = eligible.reduce(
    (sum, document) => sum + Math.min(document.text.length, MAX_DOCUMENT_CHARS),
    0,
  );
  line('');
  line(
    `${eligible.length} eligible document(s), ${ineligible.length} refused by ` +
      `the deterministic gate. ${providers.length * eligible.length} model ` +
      `call(s) to make, ~${Math.round(promptChars / 4)} prompt tokens each way.`,
  );
  line('');

  const records: CallRecord[] = [];
  for (const document of eligible) {
    for (const { provider, extractor } of providers) {
      const startedAt = Date.now();
      const result = await extractor.extract({
        symbol: document.symbol,
        category: document.category,
        summary: document.summary,
        documentText: document.text,
      });
      const latencyMs = Date.now() - startedAt;

      if (result.outcome === 'failed') {
        records.push({
          provider,
          symbol: document.symbol,
          seqId: document.seqId,
          documentChars: document.text.length,
          latencyMs,
          proposed: 0,
          accepted: [],
          line: null,
          discards: [],
          usage: null,
          failure: result.message,
        });
        line(`  ${document.symbol} / ${provider}: FAILED — ${result.message}`);
        continue;
      }

      const { claims, discards } = verifyClaims({
        documentText: document.text,
        proposed: result.claims,
        maxClaims: config.claimMaxClaims,
      });
      records.push({
        provider,
        symbol: document.symbol,
        seqId: document.seqId,
        documentChars: document.text.length,
        latencyMs,
        proposed: result.claims.length,
        accepted: claims.map((claim) => claim.text),
        line: composeClaimLine(document.symbol, claims),
        discards,
        usage: result.usage ?? null,
        failure: null,
      });
      line(
        `  ${document.symbol} / ${provider}: ${result.claims.length} proposed, ` +
          `${claims.length} accepted, ${discards.length} discarded, ${latencyMs}ms`,
      );
    }
  }

  const summaries = providers.map(({ provider, model }) =>
    summarise(
      provider,
      model,
      records,
      CLAIM_PROVIDER_PRICING[provider],
      ELIGIBLE_FILINGS_PER_DAY,
    ),
  );

  const report = renderComparison({
    generatedAt: new Date().toISOString(),
    effort: config.claimEffort,
    summaries,
    records,
    ineligible,
    filingsPerDay: ELIGIBLE_FILINGS_PER_DAY,
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${report}\n`, 'utf8');

  line('');
  line(report);
  line('');
  line(`Written to ${outPath}`);

  const spend = summaries.reduce(
    (sum, summary) => sum + (summary.costUsd ?? 0),
    0,
  );
  line(`Measured spend for this run: $${spend.toFixed(4)}`);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `provider comparison failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
