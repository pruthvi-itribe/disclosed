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
  figuresIn,
  FilingSchema,
  findVerbatimSpan,
  isLegallyBlocked,
  isRoutine,
  MAX_DOCUMENT_CHARS,
  MIN_CLAIM_DOCUMENT_CHARS,
  PERIOD_CONTEXT_CHARS,
  periodLabelsIn,
  verifyClaims,
  type ClaimDiscardReason,
  type FilingDocument,
  type ProposedClaim,
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

/**
 * A sentence from the document long enough to be evidence.
 *
 * Split on line breaks rather than full stops, because that is how a PDF text
 * layer arrives and it keeps the probe honest: the span offered to the gate is
 * exactly the shape a model would quote.
 */
const probeSentence = (text: string): string | null => {
  const lines = text
    .split(/\n/)
    .map((row) => row.trim())
    .filter(
      (row) => row.length >= 40 && row.length <= 200 && /[a-z]{4}/.test(row),
    );
  // The middle of the document, to skip the address block at the top.
  return lines.length === 0 ? null : lines[Math.floor(lines.length / 2)];
};

/** The same sentence with one word replaced. What a paraphrase looks like. */
const perturbWord = (sentence: string): string =>
  sentence.replace(/\b([a-z]{5,})\b/, 'notwithstanding');

/**
 * The same sentence with one digit changed, or one appended when it has none.
 * The highest-consequence perturbation: a figure that is off by one order.
 */
const perturbDigit = (sentence: string): string =>
  /\d/.test(sentence)
    ? sentence.replace(/\d/, (d) => String((Number(d) + 1) % 10))
    : `${sentence} in 2029`;

/**
 * A quarter no filing in this corpus can be about.
 *
 * The corpus is filings from 2026. `Q3 FY09` is seventeen years earlier, so a
 * document that supports it is a bug in the probe rather than a gate failure —
 * and that is checked rather than assumed, by skipping the probe when the
 * document happens to name it.
 */
const IMPOSSIBLE_PERIOD = 'Q3 FY09';

/** One digit of the claim's own figure changed. */
const bumpFigure = (figure: string): string =>
  figure.replace(/\d/, (d) => String((Number(d) + 1) % 10));

/** What a probe expects the gate to do, and what it actually did. */
interface Probe {
  readonly name: string;
  readonly claim: ProposedClaim;
  readonly expect: 'accept' | 'refuse';
}

/**
 * Builds every probe for one document.
 *
 * WHY THE FIGURE AND PERIOD PROBES EXIST. Until they did, every probe here
 * changed the SPAN, so the only rule under test was `findVerbatimSpan`. The
 * number rule and the period rule — the two that decide whether a real sentence
 * can be made to say something it does not — were measured by nothing at all,
 * which is how a rule that threw away five real claims in a live run survived a
 * suite reporting 47/47.
 */
function probesFor(sentence: string, documentText: string): Probe[] {
  const base = (span: string, text: string): ProposedClaim => ({
    span,
    text,
    kind: 'operational',
  });

  const probes: Probe[] = [];
  const changedWord = perturbWord(sentence);

  probes.push({
    name: 'real',
    claim: base(sentence, 'the company stated something notable here'),
    expect: 'accept',
  });
  if (changedWord !== sentence) {
    probes.push({
      name: 'word-changed',
      claim: base(changedWord, 'the company stated something notable here'),
      expect: 'refuse',
    });
  }
  probes.push({
    name: 'digit-changed',
    claim: base(
      perturbDigit(sentence),
      'the company stated something notable here',
    ),
    expect: 'refuse',
  });

  // THE FIGURE PROBES. The span is left real and the CLAIM is what changes, so
  // what is under test is `unsupportedNumbers` rather than the span match.
  const [figure] = figuresIn(sentence);
  if (figure !== undefined) {
    probes.push({
      name: 'figure-quoted',
      claim: base(sentence, `the company reported a figure of ${figure}`),
      expect: 'accept',
    });
    const bumped = bumpFigure(figure);
    if (bumped !== figure) {
      probes.push({
        name: 'figure-digit-changed',
        claim: base(sentence, `the company reported a figure of ${bumped}`),
        expect: 'refuse',
      });
    }
  }

  // THE PERIOD PROBES. One period the neighbourhood really states, which must
  // be accepted, and one from seventeen years ago, which must not.
  const offset = findVerbatimSpan(documentText, sentence)?.offset ?? null;
  if (offset !== null) {
    const window = documentText.slice(
      Math.max(0, offset - PERIOD_CONTEXT_CHARS),
      offset + sentence.length + PERIOD_CONTEXT_CHARS,
    );
    const [nearby] = periodLabelsIn(window);
    if (nearby !== undefined) {
      probes.push({
        name: 'period-in-context',
        claim: base(sentence, `${nearby.raw} figures were reported as stated`),
        expect: 'accept',
      });
    }
    if (periodLabelsIn(window).every((row) => row.canonical !== 'Q3FY09')) {
      probes.push({
        name: 'period-not-in-context',
        claim: base(
          sentence,
          `${IMPOSSIBLE_PERIOD} figures were reported as stated`,
        ),
        expect: 'refuse',
      });
    }
  }

  return probes;
}

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

  // Pass 3 runs alongside pass 2, on the documents it has already fetched.
  const accepted = new Map<string, number>();
  const rejected = new Map<string, number>();
  const discardReasons = new Map<ClaimDiscardReason, number>();
  let probed = 0;
  // Counted and reported apart, because it is a limit of the PROBE and not a
  // result: a sentence with no five-letter lower-case word comes back from
  // `perturbWord` unchanged, so the gate is being handed the real sentence and
  // is right to accept it. Folding those into the accepted column would report
  // a false-accept rate the gate does not have.
  let unperturbable = 0;
  const bump = (into: Map<string, number>, key: string): void => {
    into.set(key, (into.get(key) ?? 0) + 1);
  };

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

      const sentence = probeSentence(parsed.text);
      if (sentence !== null) {
        probed += 1;
        if (perturbWord(sentence) === sentence) unperturbable += 1;

        for (const probe of probesFor(sentence, parsed.text)) {
          const result = verifyClaims({
            documentText: parsed.text,
            proposed: [probe.claim],
          });
          if (result.claims.length === 1) {
            bump(accepted, probe.name);
          } else {
            bump(rejected, probe.name);
            const reason = result.discards[0]?.reason;
            if (reason !== undefined) {
              discardReasons.set(reason, (discardReasons.get(reason) ?? 0) + 1);
            }
          }
        }
      }
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

  // ---- pass 3: does the gate tell a real sentence from a changed one? -------
  //
  // The question the whole design turns on, asked at scale on real documents
  // rather than on a fixture. For each eligible document a real sentence is
  // lifted out of it and offered as a claim's span, then the same sentence is
  // offered again with ONE WORD changed and again with ONE DIGIT changed. A
  // gate that works accepts the first every time and refuses the other two
  // every time; anything else is the rate at which an invented claim would
  // reach the wire.
  const PROBE_LABELS: readonly (readonly [
    string,
    string,
    'accept' | 'refuse',
  ])[] = [
    ['real', 'the real sentence', 'accept'],
    ['word-changed', 'one word changed in the span', 'refuse'],
    ['digit-changed', 'one digit changed in the span', 'refuse'],
    ['figure-quoted', 'a figure the span really states', 'accept'],
    ['figure-digit-changed', 'that figure with one digit changed', 'refuse'],
    ['period-in-context', 'a period the neighbourhood states', 'accept'],
    ['period-not-in-context', 'a period from seventeen years ago', 'refuse'],
  ];

  process.stdout.write(
    `\n--- pass 3: the verbatim gate on ${probed} real document(s) ---\n` +
      `(${unperturbable} sentence(s) the word probe could not change, excluded)\n`,
  );
  let wrong = 0;
  for (const [key, label, want] of PROBE_LABELS) {
    const yes = accepted.get(key) ?? 0;
    const no = rejected.get(key) ?? 0;
    if (yes + no === 0) continue;
    const bad = want === 'accept' ? no : yes;
    wrong += bad;
    process.stdout.write(
      `${label.padEnd(36)} must ${want.padEnd(6)}  accepted ${String(yes).padStart(4)}  refused ${String(no).padStart(4)}` +
        `${bad === 0 ? '' : `   <-- ${bad} WRONG`}\n`,
    );
  }
  process.stdout.write(
    `\n${wrong === 0 ? 'every probe went the way it must.' : `${wrong} probe(s) went the wrong way.`}\n`,
  );
  for (const [reason, count] of [...discardReasons].sort(
    (a, b) => b[1] - a[1],
  )) {
    process.stdout.write(`  ${reason.padEnd(24)} ${count}\n`);
  }

  // ---- the cost --------------------------------------------------------------
  const eligibleRate = (survivors.length / total) * keep;
  const meanPromptChars = eligible === 0 ? 0 : promptChars / eligible;
  const promptTokens = meanPromptChars / CHARS_PER_TOKEN;
  const perCall =
    (promptTokens / 1e6) * INPUT_PER_MTOK +
    (OUTPUT_TOKENS / 1e6) * OUTPUT_PER_MTOK;

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
