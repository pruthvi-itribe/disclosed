import type { PdfParser } from './pdf-text';
import type { ZipEntryHeader } from './zip-entries';
import { entryDelimiter, extractZipText, type ZipReader } from './zip-text';

const ARCHIVE = Buffer.from('PK-not-really-an-archive');

/** A reader over an in-memory description of an archive. */
const readerOf = (
  members: readonly (ZipEntryHeader & { body?: Buffer })[],
  overrides: Partial<ZipReader> = {},
): ZipReader => ({
  list: async () =>
    members.map(({ fileName, compressedSize, uncompressedSize }) => ({
      fileName,
      compressedSize,
      uncompressedSize,
    })),
  read: async (_archive, fileName) =>
    members.find((row) => row.fileName === fileName)?.body ?? null,
  ...overrides,
});

const member = (
  fileName: string,
  body: Buffer | undefined = Buffer.from('%PDF'),
  compressedSize = 100,
  uncompressedSize = 120,
): ZipEntryHeader & { body?: Buffer } => ({
  fileName,
  compressedSize,
  uncompressedSize,
  body,
});

/** A parser that returns text keyed off the buffer it was handed. */
const textParser =
  (byBody: Record<string, string>, pages = 1): PdfParser =>
  async (data) => ({ text: byBody[data.toString()] ?? '', numpages: pages });

describe('extractZipText — the ordinary archives', () => {
  it('reads the one PDF and reports what it ignored', async () => {
    const reader = readerOf([
      member('RESIGNATION.pdf', Buffer.from('one')),
      member('WebXMLFile.xml', Buffer.from('xml')),
    ]);
    const result = await extractZipText(ARCHIVE, reader, {
      parser: textParser({ one: 'the letter text' }),
    });

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.text).toContain('the letter text');
    expect(result.ignored).toEqual(['WebXMLFile.xml']);
    expect(result.members).toEqual([
      { fileName: 'RESIGNATION.pdf', bytes: 3, chars: 15, message: null },
    ]);
  });

  it('never inflates a non-PDF entry', async () => {
    const asked: string[] = [];
    const reader = readerOf(
      [
        member('a.pdf', Buffer.from('one')),
        member('call.mp3', Buffer.from('x')),
      ],
      {
        read: async (_archive, fileName) => {
          asked.push(fileName);
          return Buffer.from('one');
        },
      },
    );
    await extractZipText(ARCHIVE, reader, {
      parser: textParser({ one: 'text' }),
    });
    // One measured archive carries a 5.85 MB earnings-call recording. It is
    // never decompressed, because nothing here would read it.
    expect(asked).toEqual(['a.pdf']);
  });

  it('CONCATENATES every PDF rather than picking the largest', async () => {
    // REPL's archive holds the same document twice: a signed scan yielding 4
    // characters and the text original yielding 4,576. The scan is the LARGER
    // file, so a size rule picks the one with no text in it and the filing
    // records `no-text-layer` about a document we were holding.
    const scan = Buffer.alloc(9000, 0x41);
    const original = Buffer.alloc(1000, 0x42);
    const reader = readerOf([
      member('signed-scan.pdf', scan, 9000, 9000),
      member('original.pdf', original, 1000, 1000),
    ]);
    const result = await extractZipText(ARCHIVE, reader, {
      parser: async (data) => ({
        text: data.length === 9000 ? 'scan' : 'the whole readable letter',
        numpages: 1,
      }),
    });

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.text).toContain('scan');
    expect(result.text).toContain('the whole readable letter');
  });

  it('labels each part with the entry it came from', async () => {
    const reader = readerOf([
      member('a.pdf', Buffer.from('one')),
      member('b.pdf', Buffer.from('two')),
    ]);
    const result = await extractZipText(ARCHIVE, reader, {
      parser: textParser({ one: 'first', two: 'second' }),
    });
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    // The boundary is EXPLICIT, which is what answers the objection to
    // concatenating: a claim's span crossing it must quote this line verbatim,
    // and a page break inside a single PDF offers no such marker.
    expect(result.text).toContain(entryDelimiter('a.pdf'));
    expect(result.text).toContain(entryDelimiter('b.pdf'));
    expect(result.text.indexOf('first')).toBeLessThan(
      result.text.indexOf('second'),
    );
  });

  it('sums the pages and carries a truncation through', async () => {
    const reader = readerOf([
      member('a.pdf', Buffer.from('one')),
      member('b.pdf', Buffer.from('two')),
    ]);
    const result = await extractZipText(ARCHIVE, reader, {
      parser: async (data) => ({
        text: 'x',
        numpages: data.toString() === 'one' ? 700 : 3,
      }),
      maxPages: 400,
    });
    expect(result).toMatchObject({
      outcome: 'ok',
      pages: 703,
      truncated: true,
    });
  });
});

describe('extractZipText — one bad member does not sink the archive', () => {
  it('keeps the readable members when one will not parse', async () => {
    // 4 of the 17 measured zipped PDFs are raster scans yielding two to four
    // characters. Refusing the filing because one member was a scan would lose
    // the 13 that were readable.
    const reader = readerOf([
      member('scan.pdf', Buffer.from('bad')),
      member('text.pdf', Buffer.from('one')),
    ]);
    const result = await extractZipText(ARCHIVE, reader, {
      parser: async (data) => {
        if (data.toString() === 'bad') throw new Error('not a pdf');
        return { text: 'the readable one', numpages: 1 };
      },
    });

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.text).toContain('the readable one');
    expect(result.members).toEqual([
      { fileName: 'scan.pdf', bytes: 3, chars: null, message: 'not a pdf' },
      { fileName: 'text.pdf', bytes: 3, chars: 16, message: null },
    ]);
  });

  it('records a member the reader refused to inflate', async () => {
    const reader = readerOf(
      [member('too-big.pdf'), member('ok.pdf', Buffer.from('one'))],
      {
        read: async (_archive, fileName) =>
          fileName === 'too-big.pdf' ? null : Buffer.from('one'),
      },
    );
    const result = await extractZipText(ARCHIVE, reader, {
      parser: textParser({ one: 'text' }),
    });
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.members[0]).toMatchObject({
      fileName: 'too-big.pdf',
      chars: null,
    });
  });

  it('records a member whose inflate threw', async () => {
    const reader = readerOf([member('a.pdf'), member('b.pdf')], {
      read: async (_archive, fileName) => {
        if (fileName === 'a.pdf') throw new Error('crc mismatch');
        return Buffer.from('one');
      },
    });
    const result = await extractZipText(ARCHIVE, reader, {
      parser: textParser({ one: 'text' }),
    });
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.members[0].message).toBe('crc mismatch');
  });

  it('spends the inflate budget ACROSS members, not per member', async () => {
    // A hundred entries each individually within budget must not add up past
    // it, so the budget handed to the reader shrinks as bytes are taken.
    const offered: number[] = [];
    const reader = readerOf([member('a.pdf'), member('b.pdf')], {
      read: async (_archive, _fileName, maxBytes) => {
        offered.push(maxBytes);
        return Buffer.alloc(1000, 0x41);
      },
    });
    await extractZipText(ARCHIVE, reader, {
      maxUncompressedBytes: 5000,
      parser: textParser({}),
    });
    expect(offered).toEqual([5000, 4000]);
  });
});

describe('extractZipText — the refusals', () => {
  it('reports an archive it could not open', async () => {
    const reader = readerOf([], {
      list: async () => {
        throw new Error('end of central directory record signature not found');
      },
    });
    expect(await extractZipText(ARCHIVE, reader)).toEqual({
      outcome: 'unusable',
      reason: 'unreadable-archive',
      detail: 'end of central directory record signature not found',
    });
  });

  it('never throws for a non-Error rejection', async () => {
    const reader = readerOf([], {
      list: async () => {
        throw 'a string';
      },
    });
    await expect(extractZipText(ARCHIVE, reader)).resolves.toMatchObject({
      outcome: 'unusable',
      reason: 'unreadable-archive',
    });
  });

  it('passes a bomb’s refusal through with its reason', async () => {
    const reader = readerOf([member('bomb.pdf', undefined, 1, 1_000_000_000)]);
    expect(await extractZipText(ARCHIVE, reader)).toMatchObject({
      outcome: 'unusable',
      reason: 'compression-ratio',
    });
  });

  it('refuses an archive whose entries are all unreadable', async () => {
    const reader = readerOf([member('a.pdf', Buffer.from('bad'))]);
    expect(
      await extractZipText(ARCHIVE, reader, {
        parser: async () => {
          throw new Error('not a pdf');
        },
      }),
    ).toMatchObject({ outcome: 'unusable', reason: 'no-text' });
  });

  it('never inflates anything from a refused archive', async () => {
    let inflated = false;
    const reader = readerOf([member('../evil.pdf')], {
      read: async () => {
        inflated = true;
        return Buffer.from('x');
      },
    });
    expect(await extractZipText(ARCHIVE, reader)).toMatchObject({
      outcome: 'unusable',
      reason: 'unsafe-entry-name',
    });
    expect(inflated).toBe(false);
  });
});

describe('extractZipText — a reader that misbehaves', () => {
  it('records a non-Error rejection from an inflate without losing it', async () => {
    const reader = readerOf([member('a.pdf'), member('b.pdf')], {
      read: async (_archive, fileName) => {
        if (fileName === 'a.pdf') throw 'a bare string';
        return Buffer.from('one');
      },
    });
    const result = await extractZipText(ARCHIVE, reader, {
      parser: textParser({ one: 'text' }),
    });
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.members[0].message).toBe('a bare string');
  });
});
