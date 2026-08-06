import type { UnparseableReason } from './enrichment.types';
import { decideRequeue, REHANDLED_REASONS } from './requeue-policy';

const ZIP_URL =
  'https://nsearchives.nseindia.com/corporate/WONDERLA_ROID_95100_KMP_Doc.zip';
const PDF_URL =
  'https://nsearchives.nseindia.com/corporate/ADVANCE_06082026175740_IPfinal.pdf';

/**
 * Every reason the union carries, written out as LITERALS.
 *
 * Not derived from `REHANDLED_REASONS`, not derived from a keyof, and
 * deliberately not from the module under test: a fixture built out of the thing
 * it is checking agrees with any value of that thing, including the wrong one.
 * A new `UnparseableReason` fails the totality test below until it is added
 * here, which is the point.
 */
const ALL_REASONS: readonly UnparseableReason[] = [
  'no-attachment',
  'not-a-pdf',
  'untrusted-host',
  'truncated-at-origin',
  'unreadable-pdf',
  'no-text-layer',
  'oversized',
  'not-found',
  'rejected',
];

describe('decideRequeue', () => {
  describe('the reasons whose handling changed', () => {
    it.each([
      [
        'a document the 25 MiB cap refused',
        'oversized' as const,
        'https://nsearchives.nseindia.com/corporate/SALSTEEL_big.pdf',
      ],
      ['a ZIP archive that was never opened', 'not-a-pdf' as const, ZIP_URL],
    ])('re-queues %s', (_label, reason, attachmentUrl) => {
      expect(decideRequeue({ reason, attachmentUrl }).outcome).toBe('requeue');
    });

    it('re-queues an oversized filing whatever its url looks like', () => {
      // The cap is only consulted once a fetch has begun, so the verdict itself
      // is proof the url was fetchable. No second opinion is taken.
      expect(
        decideRequeue({ reason: 'oversized', attachmentUrl: ZIP_URL }).outcome,
      ).toBe('requeue');
    });

    it('names the cap change rather than merely saying yes', () => {
      const decision = decideRequeue({
        reason: 'oversized',
        attachmentUrl: PDF_URL,
      });
      expect(decision.explanation).toMatch(/64 MiB/);
      expect(decision.explanation).toMatch(/page budget/);
    });

    it('names the archive rather than merely saying yes', () => {
      expect(
        decideRequeue({ reason: 'not-a-pdf', attachmentUrl: ZIP_URL })
          .explanation,
      ).toMatch(/ZIP archive/);
    });
  });

  describe('not-a-pdf is not sharp enough on its own', () => {
    // The whole hazard: `not-a-pdf` is the fail-closed verdict for every
    // extension this pipeline does not read, and only ONE of them became
    // readable. Re-queuing the rest burns an NSE request per filing to reach
    // the identical string.
    it.each([
      [
        'an NSE WebXMLFile sidecar',
        'https://nsearchives.nseindia.com/corporate/CIM_15456_WebXMLFile.xml',
      ],
      [
        'a spreadsheet',
        'https://nsearchives.nseindia.com/corporate/shareholding.xlsx',
      ],
      [
        'a url with no extension at all',
        'https://nsearchives.nseindia.com/corporate/document',
      ],
      ['NSE’s no-attachment sentinel', '-'],
      ['an empty url', ''],
      ['a url off the archive hosts', 'https://evil-nseindia.com/a.zip'],
      ['a plaintext url', 'http://nsearchives.nseindia.com/corporate/a.zip'],
      ['a value that is not a url', 'not a url'],
      ['no url at all', null],
    ])('keeps %s terminal', (_label, attachmentUrl) => {
      expect(
        decideRequeue({ reason: 'not-a-pdf', attachmentUrl }).outcome,
      ).toBe('keep');
    });

    it('keeps a .pdf url that somehow recorded not-a-pdf', () => {
      // The current worker cannot produce this pairing, which is exactly why it
      // must not be acted on: it means an older build classified the filing by
      // rules this one does not run.
      const decision = decideRequeue({
        reason: 'not-a-pdf',
        attachmentUrl: PDF_URL,
      });
      expect(decision.outcome).toBe('keep');
      expect(decision.explanation).toMatch(/resolves to a PDF/);
    });

    it('reports which pre-fetch refusal the url still earns', () => {
      expect(
        decideRequeue({
          reason: 'not-a-pdf',
          attachmentUrl: 'https://nsearchives.nseindia.com/corporate/a.xml',
        }).explanation,
      ).toMatch(/as not-a-pdf/);
      expect(
        decideRequeue({ reason: 'not-a-pdf', attachmentUrl: '-' }).explanation,
      ).toMatch(/as no-attachment/);
      expect(
        decideRequeue({
          reason: 'not-a-pdf',
          attachmentUrl: 'https://evil-nseindia.com/a.zip',
        }).explanation,
      ).toMatch(/as untrusted-host/);
    });

    it('is case- and subdomain-tolerant exactly as the classifier is', () => {
      expect(
        decideRequeue({
          reason: 'not-a-pdf',
          attachmentUrl: 'https://NSEArchives.NSEIndia.com/corporate/a.ZIP',
        }).outcome,
      ).toBe('requeue');
    });
  });

  describe('the reasons nothing has changed about', () => {
    it.each([
      ['there is no url to fetch', 'no-attachment' as const],
      ['the host is off the allowlist', 'untrusted-host' as const],
      ['the bytes were cut off at origin', 'truncated-at-origin' as const],
      ['the parser could not read the document', 'unreadable-pdf' as const],
      ['the document is a raster scan', 'no-text-layer' as const],
      ['the exchange does not hold the document', 'not-found' as const],
      ['the exchange refused the request', 'rejected' as const],
    ])('keeps a filing terminal when %s', (_label, reason) => {
      expect(decideRequeue({ reason, attachmentUrl: PDF_URL }).outcome).toBe(
        'keep',
      );
    });

    it.each([
      ['truncated-at-origin' as const, /parse-retry\.ts/],
      ['unreadable-pdf' as const, /same budget/],
      ['no-text-layer' as const, /OCR/],
      ['not-found' as const, /404 or 410/],
      ['no-attachment' as const, /nothing to fetch/],
      ['untrusted-host' as const, /forgery/],
      ['rejected' as const, /retry cannot fix/],
    ])('argues the refusal of %s rather than asserting it', (reason, shape) => {
      expect(
        decideRequeue({ reason, attachmentUrl: null }).explanation,
      ).toMatch(shape);
    });

    it('keeps a raceable parse failure terminal even with a ZIP url', () => {
      // A .zip that reached `truncated-at-origin` was already opened by the new
      // reader; the ZIP work cannot be the thing that would move it.
      expect(
        decideRequeue({
          reason: 'truncated-at-origin',
          attachmentUrl: ZIP_URL,
        }).outcome,
      ).toBe('keep');
    });
  });

  describe('the allowlist itself', () => {
    it('admits exactly two reasons', () => {
      // Pinned against literals, so widening the set is a decision this test
      // reports rather than one it follows.
      expect([...REHANDLED_REASONS].sort()).toEqual(['not-a-pdf', 'oversized']);
    });

    it('says exactly what decideRequeue does, in both directions', () => {
      // The set is a DECLARATION and the function is the behaviour, so the two
      // can drift. A ZIP url is the one input that admits every member — the
      // cap change ignores the url and the archive change requires it — so
      // membership and outcome must agree on it, reason by reason.
      for (const reason of ALL_REASONS) {
        expect(
          decideRequeue({ reason, attachmentUrl: ZIP_URL }).outcome ===
            'requeue',
        ).toBe(REHANDLED_REASONS.has(reason));
      }
    });

    it('never re-queues a reason outside the allowlist', () => {
      for (const reason of ALL_REASONS) {
        if (REHANDLED_REASONS.has(reason)) continue;
        expect(decideRequeue({ reason, attachmentUrl: ZIP_URL }).outcome).toBe(
          'keep',
        );
      }
    });

    it.each(ALL_REASONS)('states a reason either way for %s', (reason) => {
      for (const attachmentUrl of [ZIP_URL, PDF_URL, '-', null]) {
        const decision = decideRequeue({ reason, attachmentUrl });
        expect(decision.explanation.length).toBeGreaterThan(20);
        expect(decision.explanation).not.toMatch(/undefined/);
      }
    });

    it('covers every reason the union carries', () => {
      // Guards the fixture rather than the module: a reason added to
      // `UnparseableReason` and not to `ALL_REASONS` would silently shrink
      // every sweep above.
      expect(new Set(ALL_REASONS).size).toBe(9);
    });
  });
});
