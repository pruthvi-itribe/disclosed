import { deflateRawSync } from 'node:zlib';
import { yauzlReader } from './yauzl-reader';

/** CRC-32, because `zlib.crc32` does not exist on this project's Node. */
const CRC_TABLE = Array.from({ length: 256 }, (_v, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = (data: Buffer): number => {
  let value = 0xffffffff;
  for (const byte of data) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

/**
 * Builds a real ZIP archive in memory.
 *
 * Assembled here rather than committed as a fixture because the interesting
 * cases are the ones no ordinary tool will produce: an entry whose declared
 * `uncompressedSize` is a lie, and a name a well-behaved archiver refuses to
 * write. A committed fixture proves the fixture parses; this proves the reader
 * holds against an archive built to deceive it.
 */
function buildZip(
  entries: readonly {
    name: string;
    body: Buffer;
    /** Overrides the true uncompressed size in BOTH headers. */
    declaredSize?: number;
  }[],
): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.body);
    const crc = crc32(entry.body);
    const declared = entry.declaredSize ?? entry.body.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, deflated);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(deflated.length, 20);
    header.writeUInt32LE(declared, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += 30 + name.length + deflated.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

const HUGE = 8 * 1024 * 1024;

describe('yauzlReader — listing', () => {
  it('reads every entry’s name and declared sizes', async () => {
    const archive = buildZip([
      { name: 'RESIGNATION.pdf', body: Buffer.from('%PDF-1.4 hello') },
      { name: 'WebXMLFile.xml', body: Buffer.from('<x/>') },
    ]);

    const listed = await yauzlReader().list(archive);
    expect(listed.map((row) => row.fileName)).toEqual([
      'RESIGNATION.pdf',
      'WebXMLFile.xml',
    ]);
    expect(listed[0].uncompressedSize).toBe(14);
    expect(listed[0].compressedSize).toBeGreaterThan(0);
  });

  it('rejects an archive that is not one', async () => {
    await expect(
      yauzlReader().list(Buffer.from('not an archive at all')),
    ).rejects.toBeDefined();
  });

  it('stops the directory walk at its ceiling', async () => {
    // A directory declaring ten million entries must not cost ten million
    // events on the way to being refused.
    const archive = buildZip(
      Array.from({ length: 12 }, (_v, index) => ({
        name: `f${index}.pdf`,
        body: Buffer.from('x'),
      })),
    );
    expect(await yauzlReader(undefined, 4)).toBeDefined();
    expect(await yauzlReader(undefined, 4).list(archive)).toHaveLength(4);
  });
});

describe('yauzlReader — reading one entry', () => {
  it('inflates exactly the entry asked for', async () => {
    const archive = buildZip([
      { name: 'a.pdf', body: Buffer.from('first document') },
      { name: 'b.pdf', body: Buffer.from('second document') },
    ]);

    const reader = yauzlReader();
    expect((await reader.read(archive, 'b.pdf', HUGE))?.toString()).toBe(
      'second document',
    );
    expect((await reader.read(archive, 'a.pdf', HUGE))?.toString()).toBe(
      'first document',
    );
  });

  it('returns null for an entry that is not there', async () => {
    const archive = buildZip([{ name: 'a.pdf', body: Buffer.from('x') }]);
    expect(await yauzlReader().read(archive, 'b.pdf', HUGE)).toBeNull();
  });

  it('matches the name exactly, never loosely', async () => {
    // The name came from `list` and has been through `isSafeEntryName`. A loose
    // match here would open a different entry from the one that was checked.
    const archive = buildZip([{ name: 'report.pdf', body: Buffer.from('x') }]);
    expect(await yauzlReader().read(archive, 'report', HUGE)).toBeNull();
    expect(await yauzlReader().read(archive, 'REPORT.PDF', HUGE)).toBeNull();
  });

  it('STOPS AT THE BYTE BUDGET even when the header lies', async () => {
    // The load-bearing test. An archive that under-declares its
    // `uncompressedSize` walks past every header bound in `zip-entries.ts`,
    // and this counter is the only thing that sees the actual inflated bytes.
    const archive = buildZip([
      {
        name: 'bomb.pdf',
        body: Buffer.alloc(1_000_000, 0x41),
        declaredSize: 10,
      },
    ]);
    const listed = await yauzlReader().list(archive);
    expect(listed[0].uncompressedSize).toBe(10);

    // Either outcome is safe and both are asserted: yauzl's own size check may
    // reject first, and the counter refuses second. What must never happen is a
    // megabyte coming back from an entry that declared ten bytes.
    const read = await yauzlReader()
      .read(archive, 'bomb.pdf', 4096)
      .catch(() => null);
    expect(read).toBeNull();
  });

  it('STOPS AT THE BYTE BUDGET on an honestly-declared entry', async () => {
    // The counter itself, exercised on a real inflate. The lying-header case
    // above is caught by yauzl's own size validation before this line runs, so
    // without this test the one check that sees actual inflated bytes is
    // covered by nothing.
    const archive = buildZip([
      { name: 'big.pdf', body: Buffer.alloc(300_000, 0x41) },
    ]);
    expect(await yauzlReader().read(archive, 'big.pdf', 4096)).toBeNull();
  });

  it('returns the whole entry when it fits', async () => {
    const body = Buffer.alloc(300_000, 0x42);
    const archive = buildZip([{ name: 'big.pdf', body }]);
    const read = await yauzlReader().read(archive, 'big.pdf', HUGE);
    expect(read?.length).toBe(300_000);
    expect(read?.equals(body)).toBe(true);
  });

  it('rejects rather than resolving when the archive cannot be opened', async () => {
    await expect(
      yauzlReader().read(Buffer.from('rubbish'), 'a.pdf', HUGE),
    ).rejects.toBeDefined();
  });
});

describe('yauzlReader — traversal, which two layers refuse', () => {
  it.each([
    ['a parent traversal', '../../../etc/passwd'],
    ['an absolute path', '/etc/passwd'],
  ])('rejects the whole archive for %s', async (_label, name) => {
    // yauzl validates entry names itself and refuses the archive, which is a
    // large part of why it is the library chosen here. `isSafeEntryName` is
    // still the rule this project owns, because "the library happens to check"
    // is not a guarantee this project can state — and neither layer sanitises,
    // because a repaired name is one no archive contained.
    const archive = buildZip([{ name, body: Buffer.from('x') }]);
    await expect(yauzlReader().list(archive)).rejects.toBeDefined();
  });

  it('lists a name yauzl allows, leaving the decision to the planner', async () => {
    // A trailing-dot name is a legal ZIP entry and not a legal basename on
    // every filesystem. yauzl passes it; `isSafeEntryName` is what sees it.
    const archive = buildZip([
      { name: 'a.pdf', body: Buffer.from('x') },
      { name: 'nul .pdf', body: Buffer.from('x') },
    ]);
    const listed = await yauzlReader().list(archive);
    expect(listed.map((row) => row.fileName)).toContain('nul .pdf');
  });
});

/**
 * The failure paths, driven through the injected `fromBuffer`.
 *
 * A real archive cannot be made to fail these ways on demand — a corrupt
 * deflate stream is a different error from a `close` that throws — and the seam
 * exists precisely so the handling can be exercised rather than hoped for.
 */
describe('yauzlReader — when the library misbehaves', () => {
  interface FakeStream {
    on(event: string, handler: (value: never) => void): FakeStream;
    destroy(): void;
  }

  const emitter = (): {
    handlers: Map<string, (value: never) => void>;
    stream: FakeStream;
  } => {
    const handlers = new Map<string, (value: never) => void>();
    const stream: FakeStream = {
      on(event, handler) {
        handlers.set(event, handler);
        return stream;
      },
      destroy() {
        /* nothing to release in a fake */
      },
    };
    return { handlers, stream };
  };

  /** A ZipFile stand-in that emits whatever the test asks it to. */
  const fakeZip = (
    behaviour: {
      entries?: readonly { fileName: string }[];
      openReadStreamError?: Error;
      stream?: FakeStream;
      emitError?: Error;
    } = {},
  ): unknown => {
    const listeners = new Map<string, (value: never) => void>();
    let index = 0;
    return {
      on(event: string, handler: (value: never) => void) {
        listeners.set(event, handler);
      },
      readEntry() {
        setImmediate(() => {
          if (behaviour.emitError !== undefined) {
            listeners.get('error')?.(behaviour.emitError as never);
            return;
          }
          const entries = behaviour.entries ?? [];
          if (index < entries.length) {
            const entry = entries[index];
            index += 1;
            listeners.get('entry')?.(entry as never);
          } else {
            listeners.get('end')?.(undefined as never);
          }
        });
      },
      openReadStream(_entry: unknown, callback: unknown) {
        const done = callback as (
          error: Error | null,
          stream?: FakeStream,
        ) => void;
        setImmediate(() => {
          if (behaviour.openReadStreamError !== undefined) {
            done(behaviour.openReadStreamError);
          } else {
            done(null, behaviour.stream);
          }
        });
      },
      close() {
        /* nothing to release in a fake */
      },
    };
  };

  type FromBuffer = Parameters<typeof yauzlReader>[0];

  const opening = (behaviour: Parameters<typeof fakeZip>[0]): FromBuffer =>
    ((_buffer: Buffer, _options: unknown, callback: unknown) => {
      (callback as (error: null, zipFile: unknown) => void)(
        null,
        fakeZip(behaviour),
      );
    }) as unknown as FromBuffer;

  it('rejects when the library reports neither an error nor an archive', async () => {
    const nothing = ((_b: Buffer, _o: unknown, callback: unknown) => {
      (callback as (error: null, zipFile?: unknown) => void)(null, undefined);
    }) as unknown as FromBuffer;

    await expect(yauzlReader(nothing).list(Buffer.from('x'))).rejects.toThrow(
      'no archive was opened',
    );
  });

  it('rejects when the directory walk emits an error', async () => {
    await expect(
      yauzlReader(opening({ emitError: new Error('corrupt directory') })).list(
        Buffer.from('x'),
      ),
    ).rejects.toThrow('corrupt directory');
  });

  it('rejects when an entry cannot be read from the directory', async () => {
    // `entry.fileName` throwing is the shape a future yauzl with a lazy
    // decoder would present. The walk must reject rather than hang.
    const hostile = opening({
      entries: [
        Object.defineProperty({} as { fileName: string }, 'fileName', {
          get() {
            throw new Error('bad filename encoding');
          },
        }),
      ],
    });
    await expect(yauzlReader(hostile).list(Buffer.from('x'))).rejects.toThrow(
      'bad filename encoding',
    );
  });

  it('rejects when the entry stream cannot be opened', async () => {
    const failing = opening({
      entries: [{ fileName: 'a.pdf' }],
      openReadStreamError: new Error('crc mismatch'),
    });
    await expect(
      yauzlReader(failing).read(Buffer.from('x'), 'a.pdf', HUGE),
    ).rejects.toThrow('crc mismatch');
  });

  it('rejects when the entry stream is opened but absent', async () => {
    const absent = opening({ entries: [{ fileName: 'a.pdf' }] });
    await expect(
      yauzlReader(absent).read(Buffer.from('x'), 'a.pdf', HUGE),
    ).rejects.toThrow('could not be opened');
  });

  it('ignores a directory error that arrives after the walk ended', async () => {
    // The re-entrancy guard. yauzl emits `end` and can still emit `error`
    // afterwards on a partially-corrupt archive; without the latch the promise
    // would be settled twice and the second settle would be an unhandled
    // rejection that kills the worker loop.
    const listeners = new Map<string, (value: never) => void>();
    const late = ((_b: Buffer, _o: unknown, callback: unknown) => {
      (callback as (error: null, zipFile: unknown) => void)(null, {
        on(event: string, handler: (value: never) => void) {
          listeners.set(event, handler);
        },
        readEntry() {
          setImmediate(() => {
            listeners.get('end')?.(undefined as never);
            listeners.get('error')?.(new Error('too late') as never);
          });
        },
        close() {
          /* nothing to release in a fake */
        },
      });
    }) as unknown as FromBuffer;

    await expect(yauzlReader(late).list(Buffer.from('x'))).resolves.toEqual([]);
  });

  it('rejects a non-Error thrown while reading the directory', async () => {
    const hostile = opening({
      entries: [
        Object.defineProperty({} as { fileName: string }, 'fileName', {
          get(): string {
            throw 'a bare string';
          },
        }),
      ],
    });
    await expect(yauzlReader(hostile).list(Buffer.from('x'))).rejects.toThrow(
      'a bare string',
    );
  });

  it('ignores a stream error that arrives after the entry ended', async () => {
    const { handlers, stream } = emitter();
    const reading = yauzlReader(
      opening({ entries: [{ fileName: 'a.pdf' }], stream }),
    ).read(Buffer.from('x'), 'a.pdf', HUGE);

    for (let tries = 0; tries < 50 && !handlers.has('end'); tries += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    handlers.get('end')?.(undefined as never);
    handlers.get('error')?.(new Error('too late') as never);

    await expect(reading).resolves.toEqual(Buffer.alloc(0));
  });

  it('rejects when the entry stream errors mid-inflate', async () => {
    const { handlers, stream } = emitter();
    const reading = yauzlReader(
      opening({ entries: [{ fileName: 'a.pdf' }], stream }),
    ).read(Buffer.from('x'), 'a.pdf', HUGE);

    // Polled rather than slept: the read hops through the directory walk, a
    // reopen and `openReadStream` before it subscribes, and a fixed delay here
    // would be a flaky test rather than a fast one.
    for (let tries = 0; tries < 50 && !handlers.has('error'); tries += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    handlers.get('error')?.(new Error('inflate failed') as never);

    await expect(reading).rejects.toThrow('inflate failed');
  });
});
