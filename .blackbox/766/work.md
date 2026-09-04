# Work — quickstart-now/hejbro#766

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — nested planned paths refused; directory at snapshot path coded

_2026-09-04T14:11Z_

Nested planned paths refused; directory at the snapshot path coded.

Commits: c0bbb4e1 (nested-path refusal, first ask), d9f6edd8 (directory-
at-snapshot refusal, second ask).

First ask (`init.ts`): `checkNoNestedPaths` runs beside
`checkNoDuplicatePaths`, over the same `artifactPairs`, right after the
duplicate check and *before* the disk-based ancestor/kind walk — a
planned file (e.g. `snapshotPath`) whose own path is a strict ancestor
of another planned path (e.g. `migrationsDir`) is refused checking both
pair orientations, before anything is created. Ordering matters: the
nesting fault lives in the configuration itself, so it answers whatever
already sits on disk, the same priority `checkNoDuplicatePaths` already
gives an equal-path fault over a wrong-kind one.

Implementer tripwire, resolved by lead delegation to planner (recorded
in the piece's own status, not a fresh `D#`): the tasks.md table
originally placed two "as today" control rows (a pre-existing directory
or file already sitting at the shared node) claiming the *old*
wrong-kind/ancestor checks should still answer first for those — which
contradicted the design's own stated order (nested check runs before
the disk-based walk, unconditionally). The table was corrected in place
(those two rows now expect the same nested refusal; a new control row
pins that exact-equality stays the duplicate check's own case, unmoved)
rather than the design being changed.

Second ask (`snapshot-file.ts`): `readSnapshotFileText` now stats the
separator-stripped snapshot path before reading. A directory there
refuses with the new code `snapshot-not-a-file`, naming the configured
path and a `Next:`, instead of `readFileSync` dying with a raw `EISDIR`
+ Node stack. `ENOENT` still falls through to the existing snapshot-not-
found/snapshot-lost branches; any other stat failure rethrows raw
(explicitly left to #767, the next batch — not coded here). The mirror
case (a file sitting where `migrationsDir` should be a directory) is
#820, also next batch.

Full gate sweep green at commit time for both commits (91 files / 967,
then 972 tests). One `biome format` fixup on each commit before `check`
passed clean.

