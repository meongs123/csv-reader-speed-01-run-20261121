# csv-reader-speed — fast drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/meongs123/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/meongs123/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast, dependency-free drop-in replacement for **csv-reader 1.0.0**, built for the
[make.fun](https://make.fun/bounty/csv-reader-speed-01-run-20261121) bounty
**csv-reader-speed-01-run-20261121**. `solve.js` exports `run(input)` returning
`{columns, rows, errors}` with **byte-identical** output to the reference on
every input — including its exact broken-CSV semantics (stray CRs, quote junk,
unterminated quotes, short/long rows).

## Approach

The reference parser walks the text one character at a time and concatenates
strings per character (~10M iterations per set). This implementation replaces
that with bulk scanning:

- **Per-field fast path** — unquoted fields are found with `indexOf(',')` /
  `indexOf('\n')` (memchr-speed C++) and taken with `slice` (a zero-copy
  SlicedString in V8), never a per-character loop.
- **Quoted fields via `indexOf('"')`** — the closing quote is found directly;
  `""` pairs are skipped as escapes. The quoted span is sliced as-is unless
  it contains an escape, a CR, or a line break.
- **Record-end reuse** — the next `\n` is located once per record and reused
  for its unquoted fields; it is recomputed lazily only when a quoted field
  spans lines.
- **No work for rare paths** — error objects are only created when an error
  actually occurs; stray-CR handling runs only on fields that contain one.
- **Original code, written from the spec** — no papaparse / d3-dsv /
  csv-parser code (their outputs are not csv-reader's anyway).

`main.ts` is the baseline driver (unchanged in behavior): it enables
`--no-incremental-marking` before importing `solve.js`, reads
`/input/cases.json`, answers each case with `run`, and writes
`/output/answers.json`.

## Verification (local)

- Practice set: **6/6 cases byte-identical** to the kit's expected answers
  (`answers.json` matches `JSON.stringify(expected)` byte for byte).
- Fresh generator draws (3 new seeds, 18 cases): **18/18 byte-identical**.
- Differential test vs the reference `readCsv`: **1,124 checks, 0 failures**
  (6 practice + 118 hand-crafted edge cases + 500 random fuzz + 500
  structured generator-like cases), covering BOM, empty text, header-only,
  `""`, unterminated quotes at EOF, junk containing quotes, stray-CR-only
  lines, CRLF/LF mixes, CR inside quotes, short/long rows with
  `header: false`, final record without a line break, and non-ASCII text.
- Speed (this VM, Node 22, 6-case practice set): `run()` ~71–91 ms warm
  per set vs the baseline's ~544 ms warm (~6×); cold-process full run
  ~0.9–1.0 s CPU vs baseline ~2.0 s (~2×).

## Files

- `solve.js` — the parser (`run(input)` → `{columns, rows, errors}`).
- `main.ts` — the driver (reads `/input/cases.json`, writes `/output/answers.json`).
- `package.json` — `{"type": "module"}`.

Node 22, no dependencies, no install step, no WASM / native addon / binary.
Repo total is well under the 1 MiB cap.
