#!/usr/bin/env bash
#
# Mutation harness for the ATTACHMENT READING path: the code that decides how
# many bytes this worker will download, how much of a document it will parse,
# and what it will take out of an archive somebody else built.
#
# WHY THIS IS ITS OWN HARNESS. Everything here is a BOUND. A bound is the one
# kind of code whose tests routinely pass while the guarantee is gone — widen a
# cap and every functional test still passes, because widening a cap does not
# break anything until the day it does. So each bound is loosened in turn and
# the suite must notice.
#
# The guarantees broken one at a time:
#
#   1. THE DOWNLOAD CAP. 64 MiB, and it is a denial-of-service bound: an
#      unbounded download is an attack on our own worker. Enforced twice, on the
#      advertised content-length and on a running count of the bytes that
#      actually arrive, because a header is a claim by somebody else's server.
#   2. THE SIZE IS REPORTED. All 8 filings the previous cap refused recorded
#      `bytes: null`, so nobody could tell whether the cap had missed by a
#      kilobyte or a gigabyte. It had missed by 4%.
#   3. THE PAGE BUDGET. Bytes were measured NOT to predict parse cost: the
#      documents the old cap refused parse in 0.2-1.4 s and the one that costs
#      39.7 seconds and 501 MB is a 640-page report that passed it. The budget
#      is applied before the parse starts, because pdf-parse blocks the event
#      loop for its whole duration and no timeout can interrupt it.
#   4. THE ZIP BOMB BOUNDS. Entry count, whole-archive expansion, per-entry
#      expansion and total inflated bytes, every one checked from the central
#      directory BEFORE a byte is inflated. The per-entry ratio is separate from
#      the whole-archive one because a bomb beside a genuine 9 MB PDF has a mild
#      overall ratio and a lethal per-entry one.
#   5. THE ENTRY NAME. A traversal refuses the WHOLE archive, not the entry:
#      skipping it would quietly process the rest of an attack.
#   6. THE INFLATE COUNTER. A declared `uncompressedSize` is a claim by whoever
#      built the archive, and the stream is the only place it can be checked
#      against reality. The budget is spent ACROSS entries, so a hundred
#      individually-fine entries cannot add up past it.
#   7. NON-PDF ENTRIES ARE NEVER INFLATED. One measured archive carries a
#      5.85 MB earnings-call MP3.
#   8. FAILURES ARE VALUES. Neither the fetcher nor the parser nor the archive
#      reader may throw: an exception inside the worker loop is
#      indistinguishable from a transient failure and gets retried forever.
#
# Tally, so a report can quote it without recounting: 36 mutations across seven
# groups.
#
# Usage:  bash tools/mutation/attachment-reading-mutations.sh
# Exit:   0 only if every mutation applied AND was caught.
#
# Four outcomes per mutation, deliberately distinguished — see
# tools/mutation/alert-service-mutations.sh for the full rationale, which this
# script mirrors: CAUGHT, CRASHED, SURVIVED (a real test gap) and NO-OP (the
# perl pattern matched nothing, i.e. harness staleness, NOT a test gap).
#
# Safety: refuses to run on a dirty tree, backs up every file it touches,
# verifies each restore byte-for-byte, and exits rather than returns on INT/TERM.
#
# NOT covered by mutation, and why:
#
#   - The CONSTANTS' exact values. Mutating 64 MiB to 65 MiB mutates the
#     specification rather than the code. What IS mutated is every place a
#     bound is COMPARED, and the suites pin the constants against literals and
#     against the measured maxima they must clear.
#   - `ingest.module.ts`. Composition.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PDF=$ROOT/libs/filings/src/pdf
FILES=(
  "$ROOT/libs/filings/src/nse/attachment.fetcher.ts"
  "$PDF/pdf-text.ts"
  "$PDF/zip-entries.ts"
  "$PDF/zip-text.ts"
  "$PDF/yauzl-reader.ts"
  "$ROOT/libs/filings/src/logic/attachment.ts"
  "$ROOT/apps/ingest/src/enrichment/enrichment.worker.ts"
)
SUITE='(libs/filings/src/(pdf/|nse/attachment|logic/attachment)|apps/ingest/src/enrichment/enrichment.worker)'

# --- precondition: refuse to mutate a dirty tree -----------------------------
for f in "${FILES[@]}"; do
  if ! git -C "$ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "refusing to run: $f is not tracked by git." >&2
    exit 1
  fi
  if ! git -C "$ROOT" diff --quiet -- "$f" ||
    ! git -C "$ROOT" diff --cached --quiet -- "$f"; then
    echo "refusing to run: uncommitted changes in a file this script mutates." >&2
    echo "  commit or stash them first — this script edits them in place." >&2
    git -C "$ROOT" status --short -- "$f" >&2
    exit 1
  fi
done

BACKUP=$(mktemp -d) || {
  echo "refusing to run: could not create a backup directory." >&2
  exit 1
}
for f in "${FILES[@]}"; do
  cp "$f" "$BACKUP/$(basename "$f")" || {
    echo "refusing to run: could not back up $f." >&2
    rm -rf "$BACKUP"
    exit 1
  }
done

FAILURES=0
NOOPS=0
CRASHES=0

restore_verified() {
  local f
  for f in "${FILES[@]}"; do
    cp "$BACKUP/$(basename "$f")" "$f" || return 1
    cmp -s "$BACKUP/$(basename "$f")" "$f" || return 1
  done
  return 0
}

on_exit() {
  if restore_verified; then
    rm -rf "$BACKUP"
  else
    echo "" >&2
    echo "FATAL: sources could NOT be restored. Backup kept at:" >&2
    echo "  $BACKUP" >&2
    echo "Recover with:" >&2
    echo "  git -C $ROOT checkout -- libs/filings/src apps/ingest/src/enrichment" >&2
    exit 1
  fi
}

trap on_exit EXIT
trap 'echo ""; echo "INTERRUPTED — restoring sources."; exit 130' INT TERM

dirty() {
  local f
  for f in "${FILES[@]}"; do
    cmp -s "$f" "$BACKUP/$(basename "$f")" || return 0
  done
  return 1
}

# check_in <suite-regex> <label>  run ONLY the named suite
check_in() {
  local suite="$1"
  local label="$2"
  local out

  if ! dirty; then
    echo "NO-OP    | $label"
    echo "           <-- HARNESS STALE: pattern matched nothing; not a test gap"
    NOOPS=$((NOOPS + 1))
    restore_verified || on_exit
    return
  fi

  out=$(cd "$ROOT" && npx jest "$suite" 2>&1)
  local rc=$?

  if [ "$rc" -ge 128 ]; then
    echo "ABORTED  | $label"
    echo "           test run killed by signal $((rc - 128)); no verdict."
    echo ""
    echo "INTERRUPTED — restoring sources and stopping."
    exit 130
  fi

  # ts-jest re-emits TypeScript's coloured diagnostics whether or not stdout is
  # a TTY, so the literal bytes between "error" and "TS####" are escape codes,
  # not a space. `.*` between them, never a literal space.
  if grep -qE "error.*TS[0-9]+" <<<"$out"; then
    echo "COMPILE  | $label"
    echo "           <-- mutation did not type-check; no assertion was exercised"
    FAILURES=$((FAILURES + 1))
    restore_verified || on_exit
    return
  fi

  # A non-zero exit with no `Tests:` line is also what a typo'd suite name or a
  # broken toolchain produces, so a CRASHED verdict requires positive evidence
  # that jest reached a suite at all. Anything else is a HARNESS ERROR.
  if ! grep -qE "^Tests:" <<<"$out"; then
    if [ "$rc" -eq 0 ]; then
      echo "SURVIVED | $label   <-- TEST GAP"
      FAILURES=$((FAILURES + 1))
    elif grep -qE "^(Test Suites:|PASS |FAIL )|node_modules/jest-(circus|runner)|Ran all test suites" <<<"$out"; then
      echo "CRASHED  | $label"
      echo "           runner died before reporting (exit $rc); the suite is red"
      CRASHES=$((CRASHES + 1))
    else
      echo "HARNESS ERROR | $label"
      echo "           jest never reached a suite (exit $rc). No verdict, and NOT"
      echo "           a kill — check the pattern, the config and the toolchain."
      FAILURES=$((FAILURES + 1))
    fi
    restore_verified || on_exit
    return
  fi

  if grep -qE "Tests:.*failed" <<<"$out"; then
    echo "CAUGHT   | $label"
    echo "$out" | grep -E "^\s+●\s" | grep -v Console | sed 's/^/           /' |
      sort -u | head -3
  else
    echo "SURVIVED | $label   <-- TEST GAP"
    FAILURES=$((FAILURES + 1))
  fi

  restore_verified || on_exit
}

check() { check_in "$SUITE" "$1"; }

F=$ROOT/libs/filings/src/nse/attachment.fetcher.ts
T=$PDF/pdf-text.ts
Z=$PDF/zip-entries.ts
K=$PDF/zip-text.ts
Y=$PDF/yauzl-reader.ts
A=$ROOT/libs/filings/src/logic/attachment.ts
W=$ROOT/apps/ingest/src/enrichment/enrichment.worker.ts

echo "=== the download cap: a denial-of-service bound on our own worker ==="

perl -0pi -e 's/      if \(bytes > this\.maxBytes\) \{/      if (false) {/' "$F"
check "the running byte count never refuses anything"

perl -0pi -e 's/      if \(advertised !== null && advertised > this\.maxBytes\) \{/      if (false) {/' "$F"
check "an advertised size over the cap read anyway"

perl -0pi -e 's/      if \(bytes > this\.maxBytes\) \{/      if (bytes > this.maxBytes * 1000) {/' "$F"
check "the cap widened a thousandfold"

perl -0pi -e 's/export const MAX_ATTACHMENT_BYTES = 64 \* 1024 \* 1024;/export const MAX_ATTACHMENT_BYTES = 1024;/' "$F"
check "the shipped cap dropped below every real document"

perl -0pi -e 's/        stream\.destroy\?\.\(\);\n        \/\/ Thrown rather than returned/        \/\/ Thrown rather than returned/' "$F"
check "the refused stream left running rather than destroyed"

echo ""
echo "=== the size is reported: the whole reason for streaming ==="

perl -0pi -e 's/          bytes: advertised \?\? bytes,/          bytes: 0,/' "$F"
check "an oversized refusal that misreports how big the document was"

perl -0pi -e 's/  if \(header === null \|\| header\.trim\(\)\.length === 0\) return null;//' "$F"
check "an absent content-length read as a zero-byte body"

perl -0pi -e 's/  return Number\.isInteger\(raw\) && raw >= 0 \? raw : null;/  return raw;/' "$F"
check "a non-numeric content-length trusted"

echo ""
echo "=== the parse budget, which is what bytes were measured not to predict ==="

perl -0pi -e 's/    const parsed = await parser\(data, \{ max: maxPages \}\);/    const parsed = await parser(data);/' "$T"
check "the page budget never reaching the parser"

perl -0pi -e 's/export const MAX_PDF_PAGES = 400;/export const MAX_PDF_PAGES = 1_000_000;/' "$T"
check "the page budget widened past every document"

perl -0pi -e 's/      truncated: maxPages > 0 && pages > maxPages,/      truncated: false,/' "$T"
check "a truncated read reported as a complete one"

echo ""
echo "=== the zip bomb bounds, checked before a byte is inflated ==="

perl -0pi -e 's/  if \(headers\.length > maxEntries\) \{/  if (false) {/' "$Z"
check "an archive of any number of entries accepted"

perl -0pi -e 's/    if \(ratio > maxEntryExpansion\) \{/    if (false) {/' "$Z"
check "the per-entry expansion ratio never checked"

perl -0pi -e 's/  if \(expansion > maxExpansion\) \{/  if (false) {/' "$Z"
check "the whole-archive expansion ratio never checked"

perl -0pi -e 's/  if \(uncompressed > maxBytes\) \{/  if (false) {/' "$Z"
check "the declared inflated size never checked"

perl -0pi -e "s/        \? entry\.uncompressedSize === 0\n          \? 0\n          : Number\.POSITIVE_INFINITY/        ? 0/"  "$Z"
check "an entry inflating from zero bytes treated as harmless"

perl -0pi -e 's/export const MAX_ENTRY_EXPANSION = 200;/export const MAX_ENTRY_EXPANSION = 1e9;/' "$Z"
check "the shipped per-entry ratio widened to admit a bomb"

perl -0pi -e 's/export const MAX_ZIP_ENTRIES = 64;/export const MAX_ZIP_ENTRIES = 900;/' "$Z"
check "the shipped entry bound widened away from the literal it is pinned to"

echo ""
echo "=== the entry name: a traversal refuses the WHOLE archive ==="

perl -0pi -e 's/    if \(!isSafeEntryName\(entry\.fileName\)\) \{/    if (false) {/' "$Z"
check "entry names never checked at all"

perl -0pi -e 's/      return refuse\(\n        .unsafe-entry-name.,/      continue;\n      void refuse(\n        (\x27unsafe-entry-name\x27),/' "$Z"
check "a traversal name skipped rather than refusing the archive"
perl -0pi -e "s/name\\.includes\\('\\/'\\) \\|\\| //" "$Z"
check "a forward-slash path accepted in an entry name"

perl -0pi -e "s/  if \(name === '\.' \|\| name === '\.\.'\) return false;//" "$Z"
check "a bare parent segment accepted as a file name"

perl -0pi -e 's/  if \(\/\[\\u0000-\\u001f\\u007f\]\/\.test\(name\)\) return false;//' "$Z"
check "a NUL accepted in an entry name"

echo ""
echo "=== the inflate counter: the declared size is not believed ==="

perl -0pi -e 's/            if \(bytes > maxBytes\) \{/            if (false) {/' "$Y"
check "the inflate stream never counted against the budget"

perl -0pi -e 's/    remaining -= body\.length;/    remaining -= 0;/' "$K"
check "the inflate budget spent per entry rather than across the archive"

perl -0pi -e 's/      body = await reader\.read\(archive, entry\.fileName, remaining\);/      body = await reader.read(archive, entry.fileName, Number.MAX_SAFE_INTEGER);/' "$K"
check "every entry offered an unbounded inflate budget"

echo ""
echo "=== what is taken out of an archive, and what is not ==="

perl -0pi -e 's/    if \(isPdfEntry\(entry\.fileName\)\) pdfs\.push\(entry\);/    if (entry.fileName.length >= 0) pdfs.push(entry);/' "$Z"
check "every entry treated as a PDF, including the earnings-call MP3"

perl -0pi -e 's/export const isPdfEntry = \(name: string\): boolean =>\n  name\.toLowerCase\(\)\.endsWith\(.\.pdf.\);/export const isPdfEntry = (name: string): boolean =>\n  name.toLowerCase().includes(\x27.pdf\x27);/' "$Z"
check "a name merely containing .pdf accepted as one"

perl -0pi -e 's/  if \(pdfs\.length === 0\) \{/  if (false) {/' "$Z"
check "an archive with no PDF in it accepted"

perl -0pi -e 's/    parts\.push\(`\$\{entryDelimiter\(entry\.fileName\)\}\$\{parsed\.text\}`\);/    parts.push(parsed.text);/' "$K"
check "archive entries concatenated with no boundary between them"

perl -0pi -e 's/  const parts: string\[\] = \[\];/  const parts: string[] = [" "];/' "$K"
check "an archive whose every entry was unreadable reported as read"

echo ""
echo "=== the routing, and failures as values ==="

perl -0pi -e "s/  if \(extension === 'zip'\) \{/  if (false) {/" "$A"
check "ZIP attachments refused again, and the category blind again"

perl -0pi -e "s/    return \{ outcome: 'fetch', url: parsed\.toString\(\), kind: 'zip' \};/    return { outcome: 'fetch', url: parsed.toString(), kind: 'pdf' };/" "$A"
check "an archive handed to the PDF parser"

perl -0pi -e "s/    if \\(decision\\.kind === 'zip'\\) \\{/    if (decision.kind === 'pdf') {/" "$W"
check "the reader chosen by the wrong extension"

perl -0pi -e 's/    if \(!hasUsableTextLayer\(opened\.text\)\) \{/    if (hasUsableTextLayer(opened.text)) \{/' "$W"
check "the archive text-layer check inverted"

perl -0pi -e 's/      documentSource,/      documentSource: null,/' "$W"
check "the archive provenance dropped on its way to the database"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught ($CRASHES by crashing the"
  echo "        runner rather than by an assertion); no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest "$SUITE" 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
