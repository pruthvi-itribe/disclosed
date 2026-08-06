import { CLAIM_KINDS } from './claim.types';
import {
  buildClaimRequest,
  CLAIM_OUTPUT_SCHEMA,
  CLAIM_SYSTEM_PROMPT,
  MAX_DOCUMENT_CHARS,
  parseClaimResponse,
} from './claim-prompt';

describe('CLAIM_SYSTEM_PROMPT', () => {
  it.each([
    ['the quote-exactly rule', 'character for character'],
    ['the no-conversion rule', 'do not restate crore as billion'],
    ['the no-advisory rule', 'target price'],
    ['the no-individuals rule', 'about an individual'],
    ['the no-litigation rule', 'insolvency'],
    ['the conditional rule', 'letter of intent'],
    ['the empty-is-correct rule', 'Returning an empty list is the normal'],
  ])('states %s', (_label, phrase) => {
    expect(CLAIM_SYSTEM_PROMPT).toContain(phrase);
  });

  it('carries nothing filing-specific, or the cache misses on every call', () => {
    // The prompt is the cacheable prefix of every request. A symbol, a date or
    // a document length interpolated into it would make each call a cache miss,
    // which is the single most expensive mistake available here.
    expect(CLAIM_SYSTEM_PROMPT).not.toMatch(
      /\b(?:BIOCON|SWIGGY|20\d\d-\d\d-\d\d)\b/,
    );
  });

  it('is long enough to be worth caching', () => {
    // The minimum cacheable prefix is 512 tokens; at roughly four characters a
    // token this clears it with headroom.
    expect(CLAIM_SYSTEM_PROMPT.length).toBeGreaterThan(2_048);
  });
});

describe('CLAIM_OUTPUT_SCHEMA', () => {
  it('asks for the quote BEFORE the claim', () => {
    // Field order is the prompt's first defence: the model finds a sentence
    // before it writes a claim, rather than writing one and hunting for support.
    const item = CLAIM_OUTPUT_SCHEMA.properties.claims.items;
    expect(Object.keys(item.properties)).toEqual(['span', 'text', 'kind']);
  });

  it('requires every field and forbids extras', () => {
    const item = CLAIM_OUTPUT_SCHEMA.properties.claims.items;
    expect([...item.required]).toEqual(['span', 'text', 'kind']);
    expect(item.additionalProperties).toBe(false);
    expect(CLAIM_OUTPUT_SCHEMA.additionalProperties).toBe(false);
  });

  it('offers exactly the kinds the ranker knows', () => {
    expect([
      ...CLAIM_OUTPUT_SCHEMA.properties.claims.items.properties.kind.enum,
    ]).toEqual([...CLAIM_KINDS]);
  });

  it('states no array bound, because the API would ignore it', () => {
    // Array-size constraints are not among the supported JSON-Schema features.
    // A schema that claims a guarantee the API does not enforce is worse than
    // one that does not claim it; `verifyClaims` caps the count.
    expect(CLAIM_OUTPUT_SCHEMA.properties.claims).not.toHaveProperty(
      'maxItems',
    );
  });
});

describe('buildClaimRequest', () => {
  const input = {
    symbol: 'SWIGGY',
    category: 'Press Release',
    summary: 'Swiggy has informed the Exchange regarding a press release',
    documentText: 'The company targets a ₹10,000 Cr adjusted EBITDA business.',
  };

  it('carries the symbol, category and summary the exchange supplied', () => {
    const request = buildClaimRequest(input);
    expect(request).toContain('SWIGGY');
    expect(request).toContain('Press Release');
    expect(request).toContain('informed the Exchange');
  });

  it('fences the document, so exchange text cannot read as instruction', () => {
    const request = buildClaimRequest(input);
    expect(request).toContain('<document>');
    expect(request).toContain('</document>');
  });

  it('caps the document and says that it did', () => {
    const long = 'x'.repeat(MAX_DOCUMENT_CHARS + 5_000);
    const request = buildClaimRequest({ ...input, documentText: long });

    expect(request).toContain(`first ${MAX_DOCUMENT_CHARS} characters`);
    expect(request.length).toBeLessThan(MAX_DOCUMENT_CHARS + 1_000);
  });

  it('does not announce a cap it did not apply', () => {
    expect(buildClaimRequest(input)).toContain('Document text:');
  });
});

describe('parseClaimResponse', () => {
  const good = {
    claims: [
      {
        span: 'a real sentence from the filing',
        text: 'a real claim',
        kind: 'target',
      },
    ],
  };

  it('reads a well-formed reply', () => {
    expect(parseClaimResponse(good)).toEqual([
      {
        span: 'a real sentence from the filing',
        text: 'a real claim',
        kind: 'target',
      },
    ]);
  });

  it('reads an empty list, which is the usual answer', () => {
    expect(parseClaimResponse({ claims: [] })).toEqual([]);
  });

  it.each([
    ['null', null],
    ['a string', 'claims'],
    ['a number', 7],
    ['an object with no claims key', {}],
    ['claims that are not an array', { claims: 'one' }],
  ])('yields nothing for %s rather than throwing', (_label, raw) => {
    expect(parseClaimResponse(raw)).toEqual([]);
  });

  it.each([
    ['a missing span', { text: 'a claim', kind: 'target' }],
    ['a missing text', { span: 'a sentence', kind: 'target' }],
    ['a non-string span', { span: 7, text: 'a claim', kind: 'target' }],
    ['an unknown kind', { span: 'a sentence', text: 'a claim', kind: 'vibes' }],
    ['a null entry', null],
    ['a bare string entry', 'a claim'],
  ])('drops an entry with %s rather than repairing it', (_label, entry) => {
    // Repairing would be this module authoring a claim, which is exactly what
    // the verbatim gate exists to prevent.
    expect(parseClaimResponse({ claims: [entry] })).toEqual([]);
  });

  it('keeps the good entries alongside a bad one', () => {
    expect(
      parseClaimResponse({
        claims: [{ span: 's', text: 't', kind: 'nope' }, ...good.claims],
      }),
    ).toHaveLength(1);
  });
});
