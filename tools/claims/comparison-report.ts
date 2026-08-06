/**
 * What a two-provider run measured, and how it is written down.
 *
 * PURE. No network, no database, no clock — `compare-providers.ts` does the I/O
 * and hands the records here. Separated for one reason: the arithmetic in this
 * file is the product. A cost figure, a latency percentile and above all an
 * invention rate are numbers somebody will make a purchasing decision on, and a
 * number that only exists inside a CLI's print statement has never been checked
 * by anything.
 *
 * ================================================================
 * THE ONE METRIC THAT DECIDES
 * ================================================================
 *
 * **The invention rate: `span-not-found` as a share of claims proposed.** Every
 * other column is context for it. It is the rate at which a model quoted a
 * sentence the document does not contain — the exact failure the verbatim gate
 * exists to catch, counted at the point where the gate catches it.
 *
 * It is the deciding number because the gate is not a filter that improves a
 * cheap model, it is a floor under an expensive one. A model that invents twice
 * as often does not publish twice as many wrong claims — it publishes the same
 * zero, and proposes twice as much that has to be thrown away. What that costs
 * is COVERAGE: every invented claim is a slot on the wire line that a real claim
 * did not get. So a provider that is fifty times cheaper per token and invents
 * three times as often is not a saving; it is a quieter product at a lower unit
 * price, and the two have to be weighed against each other rather than one being
 * reported without the other.
 */
import type {
  ClaimDiscard,
  ClaimDiscardReason,
  ClaimProviderName,
  ClaimUsage,
} from '@app/filings';

/**
 * Eligible filings a day, from `claim-extraction-report.md` §6.
 *
 * 128 is the measured figure at 700 filings/day and an 18.3% combined
 * eligibility rate — not a round number chosen for arithmetic. Cost per day is
 * extrapolated from it because "cost per document" is not a quantity anybody
 * budgets in.
 */
export const ELIGIBLE_FILINGS_PER_DAY = 128;

/** List prices per million tokens, per provider. */
export interface ProviderPricing {
  /** The model these prices are for. Named so a mismatch is visible. */
  readonly model: string;
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  /** Cache reads. A fraction of input on Anthropic; assumed full elsewhere. */
  readonly cachedInputPerMTok: number;
  /** Cache writes. A premium on Anthropic; not reported elsewhere. */
  readonly cacheWritePerMTok: number;
}

/**
 * The prices the report costs a run at.
 *
 * STATED HERE rather than fetched, so the arithmetic is reproducible from the
 * file alone, and NAMED WITH A MODEL so a run against a different one is
 * flagged rather than silently mispriced.
 *
 * The OpenRouter cache rates are deliberately pessimistic — set equal to the
 * fresh input rate, because that API reports no separate cached price and
 * assuming a discount would flatter the cheaper provider in a report whose whole
 * purpose is to decide whether the cheaper provider is worth having.
 */
export const CLAIM_PROVIDER_PRICING: Readonly<
  Record<ClaimProviderName, ProviderPricing>
> = {
  anthropic: {
    model: 'claude-opus-5',
    inputPerMTok: 5,
    outputPerMTok: 25,
    cachedInputPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
  },
  openrouter: {
    model: 'deepseek/deepseek-v4-flash-0731',
    inputPerMTok: 0.09,
    outputPerMTok: 0.18,
    cachedInputPerMTok: 0.09,
    cacheWritePerMTok: 0.09,
  },
};

/** One provider's answer for one document. */
export interface CallRecord {
  readonly provider: ClaimProviderName;
  readonly symbol: string;
  readonly seqId: number;
  readonly documentChars: number;
  /** Wall clock around `extract`, measured by the caller. */
  readonly latencyMs: number;
  readonly proposed: number;
  /** The accepted claim texts, in the order the gate ranked them. */
  readonly accepted: readonly string[];
  /** The composed wire line, or null when nothing survived. */
  readonly line: string | null;
  readonly discards: readonly ClaimDiscard[];
  readonly usage: ClaimUsage | null;
  /** Set when the extractor failed. The call still counts; the claims do not. */
  readonly failure: string | null;
}

/** What one provider did over the whole sample. */
export interface ProviderSummary {
  readonly provider: ClaimProviderName;
  readonly model: string;
  readonly documents: number;
  readonly failures: number;
  readonly proposed: number;
  readonly accepted: number;
  readonly discarded: number;
  readonly linesEmitted: number;
  readonly discardsByReason: Readonly<
    Partial<Record<ClaimDiscardReason, number>>
  >;
  /**
   * `span-not-found` over claims proposed. Null when nothing was proposed —
   * NOT zero, because "invented nothing" and "proposed nothing" are different
   * facts and a zero would report the second as the first.
   */
  readonly inventionRate: number | null;
  readonly latencyMedianMs: number | null;
  readonly latencyP90Ms: number | null;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  /** Null when no call reported usage: unpriceable, not free. */
  readonly costUsd: number | null;
  readonly costPerDocumentUsd: number | null;
  readonly costPerDayUsd: number | null;
  /** How many calls reported usage. Below `documents`, the cost is partial. */
  readonly callsWithUsage: number;
}

/**
 * The nearest-rank percentile.
 *
 * No interpolation, deliberately: every value it can return is a latency that
 * actually happened. On a sample of ten calls an interpolated p90 is an average
 * of two observations, which is a number no request ever took.
 */
export const percentile = (
  values: readonly number[],
  fraction: number,
): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
};

const costOf = (usage: ClaimUsage, pricing: ProviderPricing): number =>
  (usage.inputTokens / 1e6) * pricing.inputPerMTok +
  (usage.cachedInputTokens / 1e6) * pricing.cachedInputPerMTok +
  (usage.cacheWriteInputTokens / 1e6) * pricing.cacheWritePerMTok +
  (usage.outputTokens / 1e6) * pricing.outputPerMTok;

/**
 * Rolls one provider's calls into the numbers the report prints.
 *
 * Documents that were never sent to a model — ruled out by the deterministic
 * eligibility gate — are not passed in at all. Counting them would dilute every
 * rate here with filings no provider was asked about, and the two providers see
 * exactly the same eligible set anyway.
 */
export const summarise = (
  provider: ClaimProviderName,
  model: string,
  records: readonly CallRecord[],
  pricing: ProviderPricing,
  filingsPerDay: number = ELIGIBLE_FILINGS_PER_DAY,
): ProviderSummary => {
  const mine = records.filter((record) => record.provider === provider);
  const discardsByReason: Partial<Record<ClaimDiscardReason, number>> = {};
  for (const discard of mine.flatMap((record) => record.discards)) {
    discardsByReason[discard.reason] =
      (discardsByReason[discard.reason] ?? 0) + 1;
  }

  const proposed = mine.reduce((sum, record) => sum + record.proposed, 0);
  const withUsage = mine.filter(
    (record): record is CallRecord & { usage: ClaimUsage } =>
      record.usage !== null,
  );
  const costUsd =
    withUsage.length === 0
      ? null
      : withUsage.reduce(
          (sum, record) => sum + costOf(record.usage, pricing),
          0,
        );
  // Per DOCUMENT rather than per priced call: the run's cost divided by the
  // documents it covered is what extrapolates, and dividing by the subset that
  // happened to report usage would overstate a run with gaps.
  const perDocument =
    costUsd === null || mine.length === 0 ? null : costUsd / mine.length;
  const latencies = mine.map((record) => record.latencyMs);

  return {
    provider,
    model,
    documents: mine.length,
    failures: mine.filter((record) => record.failure !== null).length,
    proposed,
    accepted: mine.reduce((sum, record) => sum + record.accepted.length, 0),
    discarded: mine.reduce((sum, record) => sum + record.discards.length, 0),
    linesEmitted: mine.filter((record) => record.line !== null).length,
    discardsByReason,
    inventionRate:
      proposed === 0
        ? null
        : (discardsByReason['span-not-found'] ?? 0) / proposed,
    latencyMedianMs: percentile(latencies, 0.5),
    latencyP90Ms: percentile(latencies, 0.9),
    inputTokens: withUsage.reduce((sum, r) => sum + r.usage.inputTokens, 0),
    cachedInputTokens: withUsage.reduce(
      (sum, r) => sum + r.usage.cachedInputTokens,
      0,
    ),
    cacheWriteTokens: withUsage.reduce(
      (sum, r) => sum + r.usage.cacheWriteInputTokens,
      0,
    ),
    outputTokens: withUsage.reduce((sum, r) => sum + r.usage.outputTokens, 0),
    costUsd,
    costPerDocumentUsd: perDocument,
    costPerDayUsd: perDocument === null ? null : perDocument * filingsPerDay,
    callsWithUsage: withUsage.length,
  };
};

/**
 * The discard reasons the table always shows, in the order it shows them.
 *
 * `span-not-found` first because it is the invention rate. The rest are listed
 * so a reason that never fired is reported as a zero rather than by omission —
 * a table that silently drops empty rows cannot be read as evidence that the
 * rule was exercised and found nothing.
 */
export const REPORTED_DISCARD_REASONS: readonly ClaimDiscardReason[] = [
  'span-not-found',
  'number-not-in-span',
  'names-an-individual',
  'advisory-language',
  'duplicate',
  'legally-blocked',
  'conditional-language',
  'span-too-short',
  'empty-claim',
  'too-long',
  'over-limit',
];

const usd = (value: number | null): string =>
  value === null ? 'n/a' : `$${value.toFixed(value < 0.01 ? 5 : 2)}`;

const rate = (value: number | null): string =>
  value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;

const ms = (value: number | null): string =>
  value === null ? 'n/a' : `${Math.round(value)} ms`;

const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;

const table = (
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string =>
  [
    row(header),
    row(header.map(() => '---')),
    ...rows.map((cells) => row(cells)),
  ].join('\n');

export interface ReportInput {
  readonly generatedAt: string;
  readonly effort: string;
  readonly summaries: readonly ProviderSummary[];
  readonly records: readonly CallRecord[];
  /** Documents the deterministic gate refused, with its reason. */
  readonly ineligible: readonly { symbol: string; reason: string }[];
  readonly filingsPerDay: number;
}

/**
 * The whole comparison, as markdown.
 *
 * ONE RENDERING for the file and for stdout. A separate terminal formatter is
 * how the number an operator reads on screen comes to differ from the one in
 * the committed report.
 */
export const renderComparison = (input: ReportInput): string => {
  const { summaries, records } = input;
  const sections: string[] = [];

  sections.push(
    '# Provider A/B — notable-claim extraction',
    '',
    `**Generated:** ${input.generatedAt}`,
    `**Effort requested:** ${input.effort} ` +
      '(the OpenAI-compatible ladder has three rungs, so `xhigh` and `max` ' +
      'reach OpenRouter as `high`)',
    `**Documents per provider:** ${summaries[0]?.documents ?? 0}` +
      (input.ineligible.length > 0
        ? `, plus ${input.ineligible.length} the deterministic gate refused before any model was called`
        : ''),
    '',
    'Both providers were sent the identical system prompt, user turn, document',
    'cap, output schema, token ceiling and timeout. Every claim either proposed',
    'was then put through the same verbatim gate.',
    '',
  );

  sections.push(
    '## The headline',
    '',
    table(
      [
        'Provider',
        'Model',
        'Proposed',
        'Accepted',
        'Discarded',
        '**Invention rate**',
      ],
      summaries.map((summary) => [
        summary.provider,
        `\`${summary.model}\``,
        String(summary.proposed),
        String(summary.accepted),
        String(summary.discarded),
        `**${rate(summary.inventionRate)}**`,
      ]),
    ),
    '',
    'The invention rate is `span-not-found` over claims proposed: how often the',
    'model quoted a sentence the document does not contain. It is the number',
    'that decides, because the gate refuses those either way — what a higher',
    'rate costs is not correctness but coverage, one wire-line slot at a time.',
    '',
  );

  sections.push(
    '## Latency and cost',
    '',
    table(
      [
        'Provider',
        'Calls',
        'Failures',
        'Lines emitted',
        'Median',
        'p90',
        'Cost/doc',
        `Cost/day @ ${input.filingsPerDay}`,
      ],
      summaries.map((summary) => [
        summary.provider,
        String(summary.documents),
        String(summary.failures),
        String(summary.linesEmitted),
        ms(summary.latencyMedianMs),
        ms(summary.latencyP90Ms),
        usd(summary.costPerDocumentUsd),
        usd(summary.costPerDayUsd),
      ]),
    ),
    '',
    table(
      [
        'Provider',
        'Input tokens',
        'Cache reads',
        'Cache writes',
        'Output tokens',
        'Run cost',
        'Calls priced',
      ],
      summaries.map((summary) => [
        summary.provider,
        String(summary.inputTokens),
        String(summary.cachedInputTokens),
        String(summary.cacheWriteTokens),
        String(summary.outputTokens),
        usd(summary.costUsd),
        `${summary.callsWithUsage}/${summary.documents}`,
      ]),
    ),
    '',
  );

  for (const summary of summaries) {
    const pricing = CLAIM_PROVIDER_PRICING[summary.provider];
    if (summary.model !== pricing.model) {
      sections.push(
        `> **Cost for ${summary.provider} is approximate.** It is priced at ` +
          `\`${pricing.model}\` rates and the run used \`${summary.model}\`.`,
        '',
      );
    }
    if (summary.callsWithUsage < summary.documents) {
      sections.push(
        `> **${summary.provider} reported usage on only ` +
          `${summary.callsWithUsage} of ${summary.documents} calls.** The cost ` +
          'above covers those; it is a floor, not a total.',
        '',
      );
    }
  }

  sections.push(
    '## Why each refused claim was refused',
    '',
    table(
      ['Reason', ...summaries.map((summary) => summary.provider)],
      REPORTED_DISCARD_REASONS.map((reason) => [
        reason === 'span-not-found' ? `**${reason}**` : reason,
        ...summaries.map((summary) =>
          String(summary.discardsByReason[reason] ?? 0),
        ),
      ]),
    ),
    '',
  );

  sections.push('## What each provider would have published', '');

  const symbols = [...new Set(records.map((record) => record.symbol))];
  for (const symbol of symbols) {
    const forSymbol = records.filter((record) => record.symbol === symbol);
    sections.push(`### ${symbol}`, '');
    sections.push(
      `seqId ${forSymbol[0].seqId}, ${forSymbol[0].documentChars} characters`,
      '',
    );
    for (const record of forSymbol) {
      sections.push(
        `**${record.provider}** — ${record.line ?? '_nothing_'}`,
        '',
      );
      if (record.failure !== null) {
        sections.push(`- FAILED: ${record.failure}`, '');
        continue;
      }
      for (const claim of record.accepted) {
        sections.push(`- accepted: ${claim}`);
      }
      for (const discard of record.discards) {
        sections.push(`- DISCARDED \`${discard.reason}\`: ${discard.claim}`);
      }
      sections.push('');
    }
  }

  if (input.ineligible.length > 0) {
    sections.push(
      '## Never sent to a model',
      '',
      'The deterministic gate ran first, as it does in production, and these',
      'cost nothing on either provider.',
      '',
      table(
        ['Symbol', 'Reason'],
        input.ineligible.map((row) => [row.symbol, row.reason]),
      ),
      '',
    );
  }

  return sections.join('\n');
};
