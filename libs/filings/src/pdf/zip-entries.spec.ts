import {
  isPdfEntry,
  isSafeEntryName,
  MAX_ENTRY_EXPANSION,
  MAX_IGNORED_NAMES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_EXPANSION,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  planZipEntries,
  type ZipEntryHeader,
} from './zip-entries';

const entry = (
  fileName: string,
  compressedSize = 1000,
  uncompressedSize = 1200,
): ZipEntryHeader => ({ fileName, compressedSize, uncompressedSize });

describe('isSafeEntryName', () => {
  it.each([
    ['a plain name', 'RESIGNATION.pdf'],
    ['a name with spaces', 'Disclosure under Reg 30.pdf'],
    ['a name with dots', 'a.b.c.pdf'],
    ['an upper-case extension', 'SCAN.PDF'],
  ])('accepts %s', (_label, name) => {
    expect(isSafeEntryName(name)).toBe(true);
  });

  it.each([
    ['a parent traversal', '../../../etc/passwd'],
    ['a bare parent segment', '..'],
    ['a current segment', '.'],
    ['a forward-slash path', 'nested/file.pdf'],
    ['a backslash path', 'nested\\file.pdf'],
    ['an absolute path', '/etc/passwd'],
    ['a Windows absolute path', 'C:\\Windows\\system32'],
    ['a drive-relative name', 'C:file.pdf'],
    ['an empty name', ''],
    ['a name of 256 characters', `${'a'.repeat(252)}.pdf`],
  ])('refuses %s', (_label, name) => {
    expect(isSafeEntryName(name)).toBe(false);
  });

  it('refuses a NUL, which is how a checked name and an opened name differ', () => {
    expect(isSafeEntryName('safe.pdf\u0000/../../evil')).toBe(false);
  });

  it('refuses a control character, because the name reaches a log line', () => {
    expect(isSafeEntryName('a\nb.pdf')).toBe(false);
    expect(isSafeEntryName('a\u007fb.pdf')).toBe(false);
  });
});

describe('isPdfEntry', () => {
  it.each([
    ['lower case', 'a.pdf', true],
    ['upper case', 'A.PDF', true],
    ['mixed case', 'a.Pdf', true],
    ['an XML sidecar', 'WebXMLFile.xml', false],
    ['an MP3 recording', 'earnings-call.mp3', false],
    ['pdf in the middle', 'a.pdf.exe', false],
    ['no extension', 'README', false],
  ])('reads %s', (_label, name, expected) => {
    expect(isPdfEntry(name)).toBe(expected);
  });
});

describe('planZipEntries — the ordinary archives', () => {
  it('takes the PDFs and names what it ignored', () => {
    // The shape every measured NSE archive has: one PDF beside the exchange's
    // own XML sidecar.
    const plan = planZipEntries([
      entry('RESIGNATION.pdf'),
      entry('WebXMLFile.xml', 1499, 9750),
    ]);
    expect(plan).toEqual({
      outcome: 'accepted',
      entries: [entry('RESIGNATION.pdf')],
      ignored: ['WebXMLFile.xml'],
    });
  });

  it('keeps every PDF, in the archive’s own order', () => {
    // 5 of 11 measured archives carry more than one, up to three.
    const plan = planZipEntries([
      entry('b.pdf'),
      entry('WebXMLFile.xml'),
      entry('a.pdf'),
    ]);
    expect(plan.outcome).toBe('accepted');
    if (plan.outcome !== 'accepted') return;
    expect(plan.entries.map((row) => row.fileName)).toEqual(['b.pdf', 'a.pdf']);
  });

  it('accepts the measured worst case comfortably', () => {
    // BLISSGVS: 3 entries, 9.26 MB compressed, 9.41 MB uncompressed, 1.02x.
    const plan = planZipEntries([
      entry('a.pdf', 3_000_000, 3_050_000),
      entry('b.pdf', 3_000_000, 3_050_000),
      entry('c.pdf', 3_258_639, 3_311_974),
    ]);
    expect(plan.outcome).toBe('accepted');
  });

  it('accepts the measured worst single-entry ratio', () => {
    // A 1,499-byte XML inflating to 9,750: 6.50x, the largest measured.
    const plan = planZipEntries([entry('a.pdf'), entry('x.xml', 1499, 9750)]);
    expect(plan.outcome).toBe('accepted');
  });

  it('bounds how many ignored names it keeps', () => {
    const headers = [
      entry('a.pdf'),
      ...Array.from({ length: 40 }, (_v, index) => entry(`x${index}.xml`)),
    ];
    const plan = planZipEntries(headers, { maxEntries: 100 });
    expect(plan.outcome).toBe('accepted');
    if (plan.outcome !== 'accepted') return;
    expect(plan.ignored).toHaveLength(MAX_IGNORED_NAMES);
  });
});

describe('planZipEntries — the hostile archives', () => {
  it('refuses an archive declaring more entries than allowed', () => {
    // The fixture is sized from an EXPLICIT limit, never from
    // `MAX_ZIP_ENTRIES`. A fixture built as `MAX_ZIP_ENTRIES + 1` passes for
    // any value of the constant it is supposed to pin, and at a mutated value
    // of 1e9 it allocates a billion-element array and hangs the run rather
    // than failing it. This is the fourth time this shape has appeared in this
    // project; the literal bound is asserted separately below.
    const headers = Array.from({ length: 9 }, (_v, index) =>
      entry(`f${index}.pdf`),
    );
    expect(planZipEntries(headers, { maxEntries: 8 })).toMatchObject({
      outcome: 'refused',
      reason: 'too-many-entries',
    });
  });

  it('accepts an archive exactly at the entry bound', () => {
    const headers = Array.from({ length: 8 }, (_v, index) =>
      entry(`f${index}.pdf`),
    );
    expect(planZipEntries(headers, { maxEntries: 8 })).toMatchObject({
      outcome: 'accepted',
    });
  });

  it('refuses a zip bomb by its single-entry ratio', () => {
    // The classic shape: a few kilobytes of deflate stream declaring gigabytes.
    expect(
      planZipEntries([entry('bomb.pdf', 1_000, 1_000_000_000)]),
    ).toMatchObject({ outcome: 'refused', reason: 'compression-ratio' });
  });

  it('refuses a bomb hidden beside a genuine document', () => {
    // The whole-archive ratio is mild because the real PDF dominates the
    // compressed size. Only the per-entry test sees this one.
    const plan = planZipEntries(
      [
        entry('real.pdf', 9_000_000, 9_100_000),
        entry('bomb.pdf', 500, 200_000),
      ],
      { maxUncompressedBytes: 1 << 30 },
    );
    expect(plan).toMatchObject({
      outcome: 'refused',
      reason: 'compression-ratio',
    });
  });

  it('refuses a whole archive that expands too far overall', () => {
    const plan = planZipEntries(
      Array.from({ length: 10 }, (_v, index) =>
        entry(`f${index}.pdf`, 100, 15_000),
      ),
      { maxEntryExpansion: 1_000_000 },
    );
    expect(plan).toMatchObject({
      outcome: 'refused',
      reason: 'compression-ratio',
    });
  });

  it('treats a zero compressed size carrying content as unbounded', () => {
    // Division by zero, and the direction that matters: an entry claiming to
    // inflate from nothing is refused, not accepted with a ratio of NaN.
    expect(planZipEntries([entry('odd.pdf', 0, 5_000)])).toMatchObject({
      outcome: 'refused',
      reason: 'compression-ratio',
    });
  });

  it('accepts a genuinely empty entry', () => {
    expect(
      planZipEntries([entry('a.pdf'), entry('empty.pdf', 0, 0)]),
    ).toMatchObject({ outcome: 'accepted' });
  });

  it('refuses an archive declaring more inflated bytes than allowed', () => {
    const plan = planZipEntries([
      entry(
        'a.pdf',
        MAX_ZIP_UNCOMPRESSED_BYTES,
        MAX_ZIP_UNCOMPRESSED_BYTES + 1,
      ),
    ]);
    expect(plan).toMatchObject({
      outcome: 'refused',
      reason: 'uncompressed-too-large',
    });
  });

  it('REFUSES THE WHOLE ARCHIVE for one traversal name', () => {
    // Not "skip that entry". An archive containing `../../../etc/passwd` is not
    // an archive with one bad file in it; skipping it would quietly process the
    // rest of an attack.
    expect(
      planZipEntries([entry('good.pdf'), entry('../../../etc/passwd')]),
    ).toMatchObject({ outcome: 'refused', reason: 'unsafe-entry-name' });
  });

  it('names the offending entry, bounded, so a refusal can be reviewed', () => {
    const plan = planZipEntries([entry(`../${'a'.repeat(200)}`)]);
    expect(plan.outcome).toBe('refused');
    if (plan.outcome !== 'refused') return;
    expect(plan.detail.length).toBeLessThan(160);
  });

  it('refuses an archive with no PDF in it', () => {
    expect(planZipEntries([entry('WebXMLFile.xml')])).toMatchObject({
      outcome: 'refused',
      reason: 'no-pdf-entries',
    });
  });

  it('refuses an empty archive', () => {
    expect(planZipEntries([])).toMatchObject({
      outcome: 'refused',
      reason: 'no-pdf-entries',
      detail: 'the archive is empty',
    });
  });
});

describe('planZipEntries — the bounds themselves', () => {
  it('sits well clear of every measured archive', () => {
    // Measured over 11 real NSE archives: 3 entries, 1.23x whole-archive
    // expansion, 6.50x for one entry, 9.4 MB inflated. The bounds are two
    // orders of magnitude away on purpose — a bound set at the observed maximum
    // refuses the next ordinary filing, and a real bomb starts at 1000:1.
    // Pinned against a LITERAL as well as against the measurement. A bound
    // asserted only in terms of what it must clear can be widened to a
    // billion and still pass, which is the third shape of this bug this
    // project has now found.
    expect(MAX_ZIP_ENTRIES).toBe(64);
    expect(MAX_ZIP_UNCOMPRESSED_BYTES).toBe(128 * 1024 * 1024);
    expect(MAX_ZIP_EXPANSION).toBe(100);
    expect(MAX_ENTRY_EXPANSION).toBe(200);
    expect(MAX_ZIP_ENTRIES).toBeGreaterThan(3);
    expect(MAX_ZIP_EXPANSION).toBeGreaterThan(1.23);
    expect(MAX_ENTRY_EXPANSION).toBeGreaterThan(6.5);
    expect(MAX_ZIP_UNCOMPRESSED_BYTES).toBeGreaterThan(9.4 * 1024 * 1024);
  });

  it('is still a bound', () => {
    expect(MAX_ZIP_ENTRIES).toBeLessThanOrEqual(1024);
    expect(MAX_ZIP_EXPANSION).toBeLessThanOrEqual(1000);
    expect(MAX_ENTRY_EXPANSION).toBeLessThanOrEqual(1000);
    expect(MAX_ZIP_UNCOMPRESSED_BYTES).toBeLessThanOrEqual(512 * 1024 * 1024);
  });
});
