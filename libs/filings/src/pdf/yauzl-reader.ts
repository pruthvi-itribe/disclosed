import type { Entry, ZipFile } from 'yauzl';
import type { ZipEntryHeader } from './zip-entries';
import type { ZipReader } from './zip-text';

/**
 * The one place this project touches a ZIP decompressor.
 *
 * ================================================================
 * WHY yauzl AND NOT SOMETHING WITH A ONE-LINE API
 * ================================================================
 *
 * Because the one-line APIs are the ones with the traversal CVEs. `adm-zip` and
 * friends offer `extractAllTo`, which is a function that writes attacker-named
 * files to disk, and their convenience is exactly the property that makes them
 * unsafe here. `yauzl` refuses to have that function on principle: it hands over
 * the central directory and makes the caller ask for each entry, which is the
 * shape a bounded reader needs and the reason `extract-zip` is built on it.
 *
 * ================================================================
 * WHAT THIS FILE IS RESPONSIBLE FOR
 * ================================================================
 *
 * Only the transport. Every bound lives in `zip-entries.ts` and every decision
 * in `zip-text.ts`, so both are pure and testable without a fixture archive —
 * the same split as `pdf-text.ts` and its injected parser. What CANNOT be moved
 * out is the byte counter in `read`: a declared `uncompressedSize` is a claim by
 * whoever built the archive, and the inflate stream is the only place it can be
 * checked against reality.
 *
 * The import is lazy for the same reason `pdf-parse`'s is: `@app/filings`'s
 * barrel is imported by the read-only dashboard, which never opens an archive.
 */

/** `yauzl.fromBuffer`, resolved on first use. */
type FromBuffer = (
  buffer: Buffer,
  options: { lazyEntries: boolean },
  callback: (error: Error | null, zipFile?: ZipFile) => void,
) => void;

let cached: FromBuffer | null = null;

export function defaultFromBuffer(): FromBuffer {
  if (cached === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = (require('yauzl') as { fromBuffer: FromBuffer }).fromBuffer;
  }
  return cached;
}

/** Opens an archive, or rejects. `lazyEntries` so nothing is read unasked. */
const open = (buffer: Buffer, fromBuffer: FromBuffer): Promise<ZipFile> =>
  new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true }, (error, zipFile) => {
      if (error !== null) reject(error);
      else if (zipFile === undefined)
        reject(new Error('no archive was opened'));
      else resolve(zipFile);
    });
  });

/**
 * Walks the central directory, calling `onEntry` for each.
 *
 * `readEntry` is pulled once per `entry` event, which is what `lazyEntries`
 * buys: the walk stops the moment `onEntry` says it has what it needs, and an
 * archive declaring a million entries costs one event rather than a million.
 */
function walk(
  zipFile: ZipFile,
  onEntry: (entry: Entry) => 'continue' | 'stop',
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      zipFile.close();
      if (error === undefined) resolve();
      else reject(error);
    };

    zipFile.on('entry', (entry: Entry) => {
      let verdict: 'continue' | 'stop';
      try {
        verdict = onEntry(entry);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (verdict === 'stop') finish();
      else zipFile.readEntry();
    });
    zipFile.on('end', () => {
      finish();
    });
    zipFile.on('error', (error: Error) => {
      finish(error);
    });
    zipFile.readEntry();
  });
}

/**
 * A `ZipReader` backed by yauzl.
 *
 * @param entryCeiling how many entries the directory walk will read before it
 *   gives up. A separate, larger bound from `MAX_ZIP_ENTRIES`: that one decides
 *   whether an archive is acceptable, this one stops a directory with ten
 *   million entries costing ten million events on the way to finding out.
 */
export function yauzlReader(
  fromBuffer: FromBuffer = defaultFromBuffer(),
  entryCeiling = 4096,
): ZipReader {
  return {
    async list(archive: Buffer): Promise<readonly ZipEntryHeader[]> {
      const zipFile = await open(archive, fromBuffer);
      const headers: ZipEntryHeader[] = [];
      await walk(zipFile, (entry) => {
        headers.push({
          fileName: entry.fileName,
          compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize,
        });
        return headers.length >= entryCeiling ? 'stop' : 'continue';
      });
      return headers;
    },

    async read(
      archive: Buffer,
      fileName: string,
      maxBytes: number,
    ): Promise<Buffer | null> {
      const zipFile = await open(archive, fromBuffer);
      let found: Entry | null = null;
      await walk(zipFile, (entry) => {
        // STRICT EQUALITY on the name the caller was given, which came from
        // `list` and has already been through `isSafeEntryName`. Matching
        // loosely here would let a second entry with a similar name be opened
        // instead of the one that was checked.
        if (entry.fileName !== fileName) return 'continue';
        found = entry;
        return 'stop';
      });
      if (found === null) return null;

      const reopened = await open(archive, fromBuffer);
      return await new Promise<Buffer | null>((resolve, reject) => {
        reopened.openReadStream(found as Entry, (error, stream) => {
          if (error !== null || stream === undefined) {
            reopened.close();
            reject(error ?? new Error('the entry could not be opened'));
            return;
          }

          const chunks: Buffer[] = [];
          let bytes = 0;
          let done = false;
          const settle = (value: Buffer | null, failure?: Error): void => {
            if (done) return;
            done = true;
            reopened.close();
            if (failure === undefined) resolve(value);
            else reject(failure);
          };

          stream.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            // THE DECLARED SIZE IS NOT BELIEVED. This is the only check that
            // sees actual inflated bytes, and a bomb that under-declares its
            // `uncompressedSize` walks past every header test to reach it.
            if (bytes > maxBytes) {
              stream.destroy();
              settle(null);
              return;
            }
            chunks.push(chunk);
          });
          stream.on('end', () => {
            settle(Buffer.concat(chunks, bytes));
          });
          stream.on('error', (streamError: Error) => {
            settle(null, streamError);
          });
        });
      });
    },
  };
}
