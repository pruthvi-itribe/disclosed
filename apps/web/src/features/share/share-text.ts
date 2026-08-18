import type { FilingView } from '../../shared/types/api';

/**
 * The product's name, as the message signs itself. Mirrored against the
 * fragment by the spec, the same answer logo.ts gives its hex literals.
 */
export const SHARE_BRAND = 'Disclosed';

/**
 * The line above the name, italic in the message. The model is named as the
 * EXTRACTOR and never as the verifier — "AI verified" would be a claim about
 * the machine that made the claim, the one sentence this product cannot
 * afford to print.
 */
export const SHARE_TAIL =
  "AI-extracted. Every line verified against the company's filing.";

/**
 * One filing as a WhatsApp-shaped message, from the payload and nothing
 * else. PURE, AND READS THE FILING RATHER THAN THE RENDERED LINES: the
 * feed's headline list skips echoes — a property of that response, not of
 * this document — and somebody sending one filing to one person is sending
 * what the filing said. Every claim goes in as stored; the timestamp is the
 * server's readable string with the three letters IST appended and no
 * arithmetic whatsoever; the amount leads (a single order value is the
 * event itself) and the results table trails (many numbers secondary to the
 * sentences a person reads in a chat).
 */
export const shareText = (f: FilingView): string => {
  const e = f.enrichment;
  const out: string[] = [];

  out.push(`*${f.companyName} (${f.symbol})*`);
  out.push(`${f.category} · ${f.disseminatedAtIstHuman} IST`);

  if (e.amountDisplay) {
    out.push('');
    out.push(e.amountDisplay);
  }

  out.push('');
  for (const claim of e.claims) {
    out.push(`- ${claim.text}`);
  }

  if (e.resultsLine) {
    out.push('');
    out.push(e.resultsLine);
  }

  out.push('');
  out.push(`_${SHARE_TAIL}_`);
  out.push(SHARE_BRAND);

  return out.join('\n');
};
