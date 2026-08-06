/**
 * Measures what narrowing the `ambiguity-keyword` refusal actually did, over
 * the real documents it was refusing.
 *
 * ================================================================
 * WHAT THIS MEASURES AND WHY IT IS NOT THE CORPUS MEASUREMENT
 * ================================================================
 *
 * `measure-amount-precision.ts` answers "does the extractor ever emit a wrong
 * number", against a hand-labelled fixture. It cannot answer this question,
 * because the filings that refuse for `ambiguity-keyword` are by definition the
 * ones nobody labelled — the extractor never got far enough to have an opinion
 * about them.
 *
 * So this tool takes the live population instead: every filing whose stored
 * `enrichment.amountRefusalReason` is `ambiguity-keyword`, re-fetches its
 * attachment from NSE, and runs the extractor over it TWICE — once with the old
 * document-wide gate reconstructed in front of it, once as it now stands. The
 * output is a transition matrix, so a refusal that merely changed its NAME (a
 * filing that has no candidate figure at all is now refused `no-candidate`, and
 * always should have been) is never counted as a filing the change rescued.
 *
 * ================================================================
 * THE HALF THAT MATTERS: NONE OF THE NEWLY ADMITTED MAY BE WRONG
 * ================================================================
 *
 * Every figure this change newly admits is printed with the sentence it was
 * read from and the label or anchor that named it, so it can be read by a
 * human — that is the only check that can catch a figure which is anchored,
 * unconditional and still not what the filing is about.
 *
 * The machine-checkable half is the PROBE. For every newly-admitted figure, the
 * document is rewritten with a conditional phrase inserted at the head of that
 * figure's own sentence, and the extractor must stop emitting it. That is a
 * per-document proof that the protection did not merely stop firing: it proves
 * the figure was admitted because its sentence was clean, not because the check
 * broke. Fixed synthetic probes run alongside for the phrases the live sample
 * may not contain.
 *
 * Run:  npx ts-node -r tsconfig-paths/register tools/extraction/measure-ambiguity-scope.ts [--limit N] [--delay MS] [--cache DIR]
 * Exit: non-zero if any probe still yields a figure, i.e. if the
 *       conditional-language protection has a hole.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import {
  AttachmentFetcher,
  decideAttachment,
  extractMaterialAmount,
  extractPdfText,
  FilingSchema,
  hasAmbiguityKeyword,
  type AmountExtraction,
  type FilingDocument,
} from '@app/filings';
import { sentenceAt } from '@app/filings/logic/sentence-scope';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/** One filing, as much of it as this measurement needs. */
interface Subject {
  readonly seqId: number;
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
  readonly attachmentUrl: string | null;
}

interface Document extends Subject {
  readonly text: string;
}

const readArg = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${name} must be a finite number >= 0`);
  }
  return value;
};

const readPath = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};

/**
 * The extractor as it behaved BEFORE the split, reconstructed exactly.
 *
 * The old gate was `hasAmbiguityKeyword` over the document and the summary,
 * ahead of everything else. When that gate is false no conditional pattern
 * exists anywhere in the document, so no candidate's sentence can carry one and
 * the current extractor's remaining checks are unreachable — which makes this
 * composition the old function rather than an approximation of it.
 */
function extractBefore(document: Document): AmountExtraction {
  if (
    hasAmbiguityKeyword(document.text) ||
    hasAmbiguityKeyword(document.summary)
  ) {
    return {
      outcome: 'refused',
      reason: 'ambiguity-keyword',
      detail:
        'the filing uses conditional or rumour language, so the event is not confirmed',
    };
  }
  return extractAfter(document);
}

const extractAfter = (document: Document): AmountExtraction =>
  extractMaterialAmount({
    documentText: document.text,
    category: document.category,
    summary: document.summary,
  });

const outcomeOf = (result: AmountExtraction): string =>
  result.outcome === 'extracted' ? 'EXTRACTED' : result.reason;

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Phrases inserted into a real sentence to prove the protection still bites.
 *
 * Each one is written as a clause that genuinely qualifies whatever follows it,
 * because a phrase dropped in as a bare token would prove only that the pattern
 * list still matches strings.
 */
const PROBE_CLAUSES: readonly string[] = [
  'having emerged as the L1 bidder, ',
  'under a Letter of Intent, ',
  'under an MoU, ',
  'as the preferred bidder, ',
  'subject to statutory approvals, ',
];

/** Documents whose figure must never be extracted, whatever else changes. */
const SYNTHETIC_PROBES: readonly { name: string; text: string }[] = [
  {
    name: 'L1 bidder names the figure',
    text: 'Sub: Update\n\nThe Company, having emerged as the L1 bidder, reports an order amounting to Rs. 5 crore.\n',
  },
  {
    name: 'letter of intent names the figure',
    text: 'Sub: Update\n\nThe Company has received a Letter of Intent amounting to Rs. 5 crore.\n',
  },
  {
    name: 'MoU names the figure',
    text: 'Sub: Update\n\nThe Company has signed an MoU with the customer amounting to Rs. 5 crore.\n',
  },
  {
    name: 'the phrase is a line wrap away from the figure',
    text: 'Sub: Update\n\nThe Company has received a Letter of Intent\nfrom the customer\namounting to Rs. 5 crore.\n',
  },
];

const SYNTHETIC_SUMMARY =
  'Company has informed the Exchange about Bagging/Receiving of orders/contracts';

async function loadSubjects(limit: number): Promise<readonly Subject[]> {
  const config = loadConfig();
  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
  const rows = await model
    .find(
      { 'enrichment.amountRefusalReason': 'ambiguity-keyword' },
      { seqId: 1, symbol: 1, category: 1, summary: 1, attachmentUrl: 1 },
    )
    .limit(limit)
    .lean()
    .exec();
  await mongoose.disconnect();
  return rows.map((row) => ({
    seqId: row.seqId,
    symbol: row.symbol,
    category: row.category,
    summary: row.summary,
    attachmentUrl: row.attachmentUrl,
  }));
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Extracted text for one filing, from the cache when possible.
 *
 * Cached because the measurement is re-run while reading its own output, and
 * re-downloading hundreds of documents from the exchange's archive host to
 * answer the same question twice is neither fast nor polite.
 */
async function readDocument(
  subject: Subject,
  fetcher: AttachmentFetcher,
  cacheDir: string,
  delayMs: number,
): Promise<Document | null> {
  const key = createHash('sha256')
    .update(String(subject.seqId))
    .digest('hex')
    .slice(0, 16);
  const cached = join(cacheDir, `${key}.txt`);
  if (existsSync(cached)) {
    return { ...subject, text: readFileSync(cached, 'utf8') };
  }

  const decision = decideAttachment(subject.attachmentUrl);
  if (decision.outcome !== 'fetch' || decision.kind !== 'pdf') return null;

  const fetched = await fetcher.fetch(decision.url);
  await sleep(delayMs);
  if (fetched.outcome !== 'ok') return null;

  const parsed = await extractPdfText(fetched.body);
  if (parsed.outcome !== 'ok' || parsed.text.trim().length === 0) return null;

  writeFileSync(cached, parsed.text, 'utf8');
  return { ...subject, text: parsed.text };
}

interface Admission {
  readonly document: Document;
  readonly rupees: number;
  readonly evidence: string;
  /** Where the evidence starts in the document, as the extractor reported it. */
  readonly offset: number;
  readonly anchor: string;
  readonly label: string | null;
  readonly sentence: string;
}

/**
 * How far back inside its own sentence a probe clause is planted.
 *
 * Two positions per admitted figure, because they prove different things.
 * ADJACENT proves the phrase is read when it directly qualifies the figure.
 * The second, planted as far back inside the sentence as the reach allows,
 * proves the check is SENTENCE-scoped rather than merely looking at the words
 * touching the figure — which a check reading only the nearest few tokens would
 * pass while missing "received a Letter of Intent ... worth Rs 5 crore".
 */
const PROBE_SETBACK_CHARS = 200;

/**
 * The first position at or after `from` where a word starts.
 *
 * Every pattern in `CONDITIONAL_PATTERNS` is `\b`-anchored, so a clause spliced
 * into the middle of a token — `appointed by the B` + `subject to …` + `oard` —
 * cannot match, and the probe would report a leak that is an artifact of where
 * it cut rather than a hole in the check. Measured: that is exactly what a
 * character-counted insertion did on the first run of this tool.
 */
function wordStartAt(text: string, from: number, limit: number): number {
  for (let index = Math.max(0, from); index < limit; index += 1) {
    if (/\s/.test(text[index])) return index + 1;
  }
  return limit;
}

async function main(): Promise<void> {
  const limit = readArg('limit', 1_000);
  const delayMs = readArg('delay', 400);
  const cacheDir = readPath('cache', 'data/corpus/.ambiguity-scope-cache');
  mkdirSync(cacheDir, { recursive: true });

  const subjects = await loadSubjects(limit);
  process.stdout.write(
    `live filings refusing ambiguity-keyword: ${subjects.length}\n`,
  );

  const fetcher = new AttachmentFetcher();
  const documents: Document[] = [];
  for (const subject of subjects) {
    const document = await readDocument(subject, fetcher, cacheDir, delayMs);
    if (document !== null) documents.push(document);
  }
  process.stdout.write(`readable attachments: ${documents.length}\n`);

  const transitions = new Map<string, number>();
  const admissions: Admission[] = [];
  let beforeAmbiguity = 0;
  let afterAmbiguity = 0;

  for (const document of documents) {
    const before = extractBefore(document);
    const after = extractAfter(document);
    if (outcomeOf(before) === 'ambiguity-keyword') beforeAmbiguity += 1;
    if (outcomeOf(after) === 'ambiguity-keyword') afterAmbiguity += 1;

    const key = `${outcomeOf(before)} -> ${outcomeOf(after)}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);

    if (after.outcome !== 'extracted') continue;
    admissions.push({
      document,
      rupees: after.rupees,
      evidence: after.provenance.evidence,
      offset: after.provenance.offset,
      anchor: after.provenance.anchor,
      label: after.provenance.label,
      sentence: squash(sentenceAt(document.text, after.provenance.offset).text),
    });
  }

  process.stdout.write('\n=== refusal counts ===\n');
  process.stdout.write(`  ambiguity-keyword BEFORE  ${beforeAmbiguity}\n`);
  process.stdout.write(`  ambiguity-keyword AFTER   ${afterAmbiguity}\n`);
  process.stdout.write(
    `  narrowed by               ${beforeAmbiguity - afterAmbiguity}\n`,
  );

  process.stdout.write('\n=== transitions (before -> after) ===\n');
  for (const [key, count] of [...transitions].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${String(count).padStart(5)}  ${key}\n`);
  }

  process.stdout.write(
    `\n=== newly admitted figures: ${admissions.length} ===\n`,
  );
  for (const admission of admissions) {
    process.stdout.write(
      `\n  ${admission.document.symbol} (${admission.document.seqId}) — ${admission.document.category}\n` +
        `    rupees   ${admission.rupees}\n` +
        `    evidence "${squash(admission.evidence)}"\n` +
        `    anchor   ${admission.anchor}${
          admission.label === null ? '' : ` — "${admission.label}"`
        }\n` +
        `    sentence "${admission.sentence.slice(0, 400)}"\n` +
        `    summary  "${squash(admission.document.summary)}"\n`,
    );
  }

  // ---- the protection still holds -----------------------------------------
  process.stdout.write(
    '\n=== probes: conditional framing must still refuse ===\n',
  );
  let leaks = 0;
  let probes = 0;
  let stillAmbiguity = 0;

  for (const probe of SYNTHETIC_PROBES) {
    probes += 1;
    const result = extractMaterialAmount({
      documentText: probe.text,
      category: 'Bagging/Receiving of orders/contracts',
      summary: SYNTHETIC_SUMMARY,
    });
    const verdict = outcomeOf(result);
    if (verdict === 'ambiguity-keyword') stillAmbiguity += 1;
    if (result.outcome === 'extracted') {
      leaks += 1;
      process.stdout.write(
        `  LEAK  synthetic: ${probe.name} -> ${result.rupees}\n`,
      );
    } else {
      process.stdout.write(`  ok    synthetic: ${probe.name} -> ${verdict}\n`);
    }
  }

  // The real half: rewrite each admitted document so the phrase qualifies the
  // figure's OWN sentence, and require the figure to disappear. The offset is
  // the extractor's own, not a re-search for the evidence string, which in an
  // AGM notice that repeats a resolution would find a different occurrence.
  for (const admission of admissions) {
    const span = sentenceAt(admission.document.text, admission.offset);
    const positions: readonly { readonly name: string; readonly at: number }[] =
      [
        { name: 'adjacent', at: admission.offset },
        {
          name: 'same sentence',
          at: wordStartAt(
            admission.document.text,
            Math.max(span.start, admission.offset - PROBE_SETBACK_CHARS),
            admission.offset,
          ),
        },
      ];
    for (const position of positions) {
      for (const clause of PROBE_CLAUSES) {
        probes += 1;
        const rewritten =
          admission.document.text.slice(0, position.at) +
          clause +
          admission.document.text.slice(position.at);
        const result = extractMaterialAmount({
          documentText: rewritten,
          category: admission.document.category,
          summary: admission.document.summary,
        });
        const verdict = outcomeOf(result);
        if (verdict === 'ambiguity-keyword') stillAmbiguity += 1;
        const label = `${admission.document.symbol} [${position.name}] "${clause.trim()}"`;
        if (result.outcome === 'extracted') {
          leaks += 1;
          process.stdout.write(`  LEAK  ${label} -> ${result.rupees}\n`);
        } else {
          process.stdout.write(`  ok    ${label} -> ${verdict}\n`);
        }
      }
    }
  }

  process.stdout.write(
    `\n  ${probes - leaks}/${probes} probes refused ` +
      `(${stillAmbiguity} of them for ambiguity-keyword); ${leaks} leaked\n`,
  );

  process.exitCode = leaks > 0 ? 1 : 0;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `measurement failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
