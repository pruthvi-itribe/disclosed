import {
  decideAttachment,
  isTrustedAttachmentHost,
  NO_ATTACHMENT_SENTINEL,
  TRUSTED_ATTACHMENT_HOSTS,
} from './attachment';

const ARCHIVE = 'https://nsearchives.nseindia.com/corporate';

describe('decideAttachment — what may be fetched', () => {
  it.each([
    [`${ARCHIVE}/RAILTEL_05082026_intimation.pdf`],
    [`${ARCHIVE}/KEC_05082026_PressRelease.PDF`],
    ['https://www.nseindia.com/content/some/file.pdf'],
    [`${ARCHIVE}/file.pdf?v=2`],
    [`${ARCHIVE}/name with spaces.pdf`],
  ])('fetches the PDF at %s', (url) => {
    const decision = decideAttachment(url);
    expect(decision.outcome).toBe('fetch');
  });

  it('returns the parsed absolute URL, not the raw string', () => {
    const decision = decideAttachment(`  ${ARCHIVE}/a.pdf  `);
    expect(decision).toEqual({
      outcome: 'fetch',
      url: `${ARCHIVE}/a.pdf`,
      kind: 'pdf',
    });
  });
});

describe('decideAttachment — the ZIP attachments', () => {
  it.each([
    ['a ZIP', `${ARCHIVE}/RESIGNATION_05082026.zip`],
    ['an uppercase ZIP', `${ARCHIVE}/RESIGNATION.ZIP`],
  ])('fetches %s, labelled as an archive', (_label, url) => {
    // 249 of 17,442 filings carry one, and three categories are 100% ZIP —
    // `Resignation of Director/KMP/SMP` alone is 213 filings a month. Refusing
    // them was never a judgement about the filings; it was never opening the
    // envelope. Every bound that makes it safe is in `zip-entries.ts`.
    const decision = decideAttachment(url);
    expect(decision).toMatchObject({ outcome: 'fetch', kind: 'zip' });
  });

  it('labels a PDF and an archive differently, because they need different readers', () => {
    expect(decideAttachment(`${ARCHIVE}/a.pdf`)).toMatchObject({ kind: 'pdf' });
    expect(decideAttachment(`${ARCHIVE}/a.zip`)).toMatchObject({ kind: 'zip' });
  });
});

describe('decideAttachment — the terminal verdicts', () => {
  it.each([
    ['null', null],
    ['an empty string', ''],
    ['whitespace', '   '],
    ["NSE's own sentinel", NO_ATTACHMENT_SENTINEL],
    ['a padded sentinel', ' - '],
    ['a value that is not a URL at all', 'not a url'],
    ['a relative path', '/corporate/file.pdf'],
  ])('skips %s as no-attachment', (_label, url) => {
    expect(decideAttachment(url)).toEqual({
      outcome: 'skip',
      reason: 'no-attachment',
    });
  });

  it.each([
    ['a spreadsheet', `${ARCHIVE}/shp.xlsx`],
    ['an XML filing', `${ARCHIVE}/filing.xml`],
    ['no extension at all', `${ARCHIVE}/document`],
    ['a directory URL', `${ARCHIVE}/`],
    ['a dot in the directory only', 'https://nseindia.com/a.b/document'],
  ])('skips %s as not-a-pdf', (_label, url) => {
    expect(decideAttachment(url)).toEqual({
      outcome: 'skip',
      reason: 'not-a-pdf',
    });
  });

  it.each([
    ['plain http', 'http://nsearchives.nseindia.com/a.pdf'],
    ['a file URL', 'file:///etc/passwd'],
    ['loopback', 'https://127.0.0.1/a.pdf'],
    ['link-local metadata', 'https://169.254.169.254/latest/meta-data.pdf'],
    ['an unrelated host', 'https://example.com/a.pdf'],
    ['a lookalike suffix', 'https://evil-nseindia.com/a.pdf'],
    ['a lookalike subdomain trick', 'https://nseindia.com.evil.io/a.pdf'],
    ['credentials pointing elsewhere', 'https://nseindia.com@evil.io/a.pdf'],
  ])('skips %s as untrusted-host', (_label, url) => {
    expect(decideAttachment(url)).toEqual({
      outcome: 'skip',
      reason: 'untrusted-host',
    });
  });
});

describe('isTrustedAttachmentHost', () => {
  it.each(TRUSTED_ATTACHMENT_HOSTS)('trusts %s exactly', (host) => {
    expect(isTrustedAttachmentHost(host)).toBe(true);
  });

  it.each([
    ['nsearchives.nseindia.com'],
    ['NSEARCHIVES.NSEINDIA.COM'],
    ['www.nseindia.com'],
    ['archives.nseindia.com'],
  ])('trusts %s', (host) => {
    expect(isTrustedAttachmentHost(host)).toBe(true);
  });

  it.each([
    ['evil-nseindia.com'],
    ['nseindia.com.evil.io'],
    ['nseindia.co'],
    ['nseindia.com.br'],
    ['xnseindia.com'],
    [''],
    ['localhost'],
  ])('does not trust %s', (host) => {
    // The suffix test must be label-wise. `'evil-nseindia.com'.endsWith(
    // 'nseindia.com')` is true, and that is the whole attack.
    expect(isTrustedAttachmentHost(host)).toBe(false);
  });
});

describe('decideAttachment — the reason a terminal verdict carries', () => {
  it.each([
    ['a value that is not a URL at all', 'not a url'],
    ['a relative path', '/corporate/file.pdf'],
    ['a bare filename', 'RAILTEL.pdf'],
  ])('files %s under no-attachment, not under not-a-pdf', (_label, url) => {
    // The reason is what a human reviewing the queue reads. `not-a-pdf` says
    // the exchange published something this pipeline does not parse;
    // `no-attachment` says the field held nothing usable. They lead to
    // different fixes and must not be interchangeable.
    expect(decideAttachment(url).outcome).toBe('skip');
    expect(decideAttachment(url)).toEqual({
      outcome: 'skip',
      reason: 'no-attachment',
    });
  });

  it("treats NSE's sentinel exactly as it treats an unusable value", () => {
    // `new URL('-')` throws, so the explicit sentinel check and the catch reach
    // the same verdict. The check stays because it states the exchange's
    // contract where a reader looks for it, and this pins the equivalence so a
    // future URL parser that ACCEPTS `-` cannot make them diverge silently.
    expect(decideAttachment(NO_ATTACHMENT_SENTINEL)).toEqual(
      decideAttachment('not a url'),
    );
  });
});
