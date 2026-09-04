# Work — quickstart-now/hejbro#701

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Canonical set order across serialize, diff, generate and verify

_2026-09-04T21:19Z_

`ObjectKind` gained an optional, additive `canonicalize?(node: JsonValue):
JsonValue` member (`packages/core/src/kind/object-kind.ts`), applied by
`buildSnapshot` right after `serialize` and before `identify`
(`packages/core/src/snapshot/snapshot.ts`). Three built-in kinds
implement it:

| kind | array | canonical order |
|------|-------|-----------------|
| `table` | `indexes` | sorted by `name` |
| `table` | `checks` | sorted by `name`; absent stays absent |
| `policy` | `roles` | sorted by name (`compareKeys`) |
| `trigger` | `events` | fixed rank insert, update, delete |
| `trigger` | `events[].columns` (`update of`) | sorted by name |

A new `canonicalizeSnapshot(snapshot, registry)` (pure, exported from
core) maps every entry through its kind's `canonicalize`, tolerant of a
malformed or unregistered-kind entry (never throws itself). It is
consumed at three comparison points:

- `diffSnapshots` (`packages/core/src/engine/diff-engine.ts`): a
  per-key `canonicalizeNode(node, kind)` helper runs INSIDE the
  existing per-key `guardSnapshotRead` wrapper, not as a whole-snapshot
  pass — a whole-snapshot pass was tried first and broke the
  `malformed-snapshot-node` contract (a malformed node crashed with a
  raw `TypeError` before the guard could catch it); moving the call
  inside the guard fixed it.
- `generate.ts`'s `snapshotChangedFrom` (now takes a `registry`
  parameter) canonicalizes both sides before comparing, so a run whose
  only movement is a set's order writes nothing.
- `verify.ts`'s check 2 (`buildCheck2Outcome`) compares
  `renderSnapshot(currentSnapshot)` against
  `renderSnapshot(canonicalizeSnapshot(diskSnapshot, registry))`; check
  1 (the tip migration's recorded hash against the file as stored)
  stays byte-exact and untouched, so a hand edit is still reported
  there (`chain-tip-mismatch`).

`formatVersion` stays 8 (design.md mechanism 2, the lead's pick over a
format bump to 9). Rendering follows canonical order only for objects
created or recreated after this change; committed migrations are
history and do not move.

Golden and example replay (task 1.3c): 2 golden cases
(`table-constraints`, `table-index-methods`) regenerated via
`UPDATE_GOLDEN=1`, order-only diffs. Both `examples/postgres` and
`examples/supabase` snapshots and every migration's two hash banner
lines were regenerated with the built CLI and reconstructed by hand
(each file's non-hash banner lines and body kept verbatim except where
the body actually differs) — a first reconstruction script had a no-op
bug (skipped the write when the rebuilt text equaled the original,
leaving the file at its raw live-regenerated state instead) that was
caught and fixed before landing. `examples/{postgres,supabase}`'s chain
and verify tests are green against the reconstructed files.

Four `packages/cli/test/generate-command.test.ts` repro tests were
rewritten (a set reorder is now no-change, not a restate migration) via
a shared `writeNonCanonicalSnapshot` fixture helper instead of the old
byte-exact assumption; a fifth (slug-determinism) test that depended on
the old restate-migration path was deleted as no longer reachable.

Task commits: 1.1/1.2 canonicalize hook + table/policy/trigger kinds,
1.3 `canonicalizeSnapshot` + `diffSnapshots`/`generate.ts`, 1.3b
`verify.ts` check 2 + the CLI repro-test rewrite, 1.3c golden/example
replay.

