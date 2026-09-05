# D106 evaluation — add-snapshot-upgrade (round 1)

reviewer: context-free session, model fable (Claude Fable 5.1), 2026-09-05
worktree: `hejbro-worktrees/d106-add-snapshot-upgrade` detached at `9de88607` (upstream/dev), `pnpm build --force`
contract read: `npx openspec show add-snapshot-upgrade --diff` only (delta scenarios of `cli-commands`, `migration-format`, `snapshot-format`), plus the public exports of `packages/cli/src/index.ts` / `packages/core/src/index.ts`, `skills/hejbro/references/generate-verify-workflow.md`, and `hejbro --help` of the built CLI. Proposal/design/tasks, `.blackbox/`, implementation logic and tests were not read.

## Method

The change's input is a snapshot file written by a *released* hejbro, so the inputs were constructed from the real releases rather than from this build. `npm view hejbro versions` lists four releases: `0.1.0`, `0.1.1`, `0.2.0-pre.0`, `0.2.0-pre.1`. Each was installed into `/private/tmp/d106-su/<ver>/` (`npm i hejbro@<ver> @hejbro/core@<ver>`) and used, with its own CLI, to write real projects:

| base project | written by | format | shape |
|---|---|---|---|
| `p011` | hejbro 0.1.1 | 5 | the 0.1.1 postgres example's 7 steps (`examples/postgres/src/steps/step-1..7` at tag `hejbro@0.1.1`) generated as a 7-migration chain (tables, FKs incl. self-referencing, checks, partial/unique indexes, RLS + policies, trigger + function, view, schema/table/default-privilege grants; one `--confirm-drop` step), each step a git commit |
| `p010` | hejbro 0.1.0 | 5 | same declarations as a 2-migration chain (step-3 → step-7) |
| `p011sb` | hejbro 0.1.1 | 5 | the 0.1.1 supabase example taken verbatim from the tag (`hejbro.snapshot.json` + 4 migrations + config with `supabasePreset`) |
| `init-0.1.1` | hejbro 0.1.1 | 5 | `hejbro init` only — empty snapshot, no migrations |
| `p020pre0` | hejbro 0.2.0-pre.0 | 8 | 2-migration chain from the same declarations |
| `init-0.2.0-pre.1` | hejbro 0.2.0-pre.1 | 8 | `hejbro init` only |

Core inputs for the pure re-encoding: the two 0.1.1 example snapshots and the ten golden `expected/snapshot.json` files at tag `hejbro@0.1.1` (all ten golden cases have `declarations.ts`/`steps.ts` unchanged since that tag), the current `examples/*` snapshots, and hand-edited variants (format 3/4/6/7/9/100, `hejbroSnapshot` key, no version key, string version, broken JSON, empty string, `dialect: mysql`, missing `objects`).

Each base was copied into a case directory and `node_modules/hejbro` / `node_modules/@hejbro/*` replaced by symlinks to this worktree's `packages/*`, then driven with the built CLI. Docker Postgres 16 (`d106-su-pg`, port 55610) served the db-connected commands.

Input table axes: 17 subcommands (`hejbro --help` enumeration) × snapshot state {format 8 written by this build's line (pre.0, pre.1), format 5 from 0.1.0 / 0.1.1 / supabase example / empty, format 4, `hejbroSnapshot` key, format 7, format 9, broken JSON, absent} × migration state {none (dir empty / dir absent), chain ok, tip hash mismatch (banner edited / snapshot bytes edited), mid-chain break, duplicate-version tips, tip already carrying `upgraded-from`, upgraded-then-committed}. Rows executed: 31 core re-encoding rows, ~110 CLI rows (exit code, stdout, file-change fingerprint of snapshot + every migration, banner lines).

## Blocking findings

### B1. A format-8 snapshot written by a released hejbro (0.2.0-pre.0) is not a fixed point of the re-encoding

Delta (`snapshot-format`, ADDED requirement): "SHALL be the identity on a current-format snapshot"; scenario *The current format is a fixed point*: "WHEN a current-format snapshot is re-encoded THEN the result is byte-identical to the input".

Reproduction (a project written by the released `hejbro@0.2.0-pre.0`, `formatVersion: 8`, passing that release's own `verify`):

```
$ node reenc.mjs p020pre0/hejbro.snapshot.json p020pre0.reenc.json   # core.upgradeSnapshot(text, createDefaultRegistry())
fromVersion 8 identical false
$ node jdiff.mjs p020pre0/hejbro.snapshot.json p020pre0.reenc.json
$.objects.table:app.tasks.checks: array REORDERED (4 items)
```

The released pre.0 writer stored a table's `checks` in declaration order; this build's canonical form sorts them, and the re-encoding renders the sorted order — 139 differing lines for a snapshot whose `formatVersion` is the current one. The two current `examples/*` snapshots and an `init`-written empty snapshot are byte-identical fixed points, so the property holds for files this build wrote and fails for a released format-8 file.

The CLI side is internally consistent with the *cli-commands* delta (`hejbro upgrade` on that project: exit 0, "snapshot is already at format 8", no file written; `verify` passes; the next `generate` chains onto it), but that leaves the non-canonical file in place: the next `generate` on the pre.0 project rewrote the snapshot with `tasks.checks` reordered alongside the one column it actually added (`jdiff p020pre0/hejbro.snapshot.json cases/b1/hejbro.snapshot.json` → `task_labels.columns` differs *and* `tasks.checks` REORDERED), a diff hunk the user did not cause.

Why blocking: the scenario's universal claim is stated over "a current-format snapshot", and a file a released hejbro wrote at `formatVersion: 8` is one. Either the sentence needs to say what it means (identity on a snapshot *as the current writer renders it* — canonical order — rather than on any file carrying the current version number), or the re-encoding/`upgrade` has to re-canonicalize a same-version file (which would also mean re-chaining its tip, since the bytes change). Both are owner-facing decisions about the contract, not an implementation slip; the delta as written is contradicted by a real released input.

## Non-blocking findings

1. **No-migrations upgrade "reports no re-chaining" only by omission.** `init-0.1.1` (empty format-5 snapshot, no `migrations/*.sql`), a format-5 snapshot with an emptied `migrations/`, and one with the directory absent all print exactly one line, `upgraded hejbro.snapshot.json: format 5 → 8`, exit 0. The scenario says the command "reports no re-chaining"; the shipped output does not say anything about re-chaining, it just lacks the `re-chained …` line. Readers of the scenario can expect an explicit "no migrations — nothing to re-chain" line. Wording or output should pick one.

2. **The pin-or-reset diagnostic still says no upgrade path exists.** For format 4 and the `hejbroSnapshot` key, every command (and `upgrade` itself) prints "snapshot version 4 is older than this build supports (expects 8) — hejbro is pre-1.0 and has no format-migration path yet …" followed by the pin-or-reset guidance. The delta only requires that the upgrade command not be offered here, which holds; but "has no format-migration path yet" is now false as a statement about hejbro (it has one, from format 5 up), and a user on an unreleased pre-5 file who reads this will not learn that the path stops at 5. Suggest "no format-migration path from this format".

3. **Broken tip on an older-format snapshot: `verify` and `upgrade` point at each other.** With a format-5 snapshot whose tip hash disagrees with the file (banner edited, or a trailing newline appended to the snapshot): `verify` refuses with the older-format diagnostic "Next: run `hejbro upgrade`" and *skips* the chain-tip check ("needs a parseable snapshot"), while `upgrade` refuses with `chain-tip-mismatch` "Next: restore the snapshot … from version control". The delta's rationale "an already-broken chain is `verify`'s business" presumes `verify` can look at the chain, which it cannot until the format is current. Nothing is written (correct), but the guidance loop is real; the `chain-tip-mismatch` text from `upgrade` could say that `verify`'s chain checks are unavailable until the snapshot is restored to the bytes the tip pins.

4. **Only the tip is checked; a chain broken elsewhere is upgraded over.** Editing migration 0004's `-- snapshot:` line (tip intact) → `upgrade` exit 0, writes both files; `verify` then fails with `broken-chain` at 0005. The delta promises only the tip check, so this is not a contradiction, but the same sentence's reasoning ("upgrading over it would hide the break") applies to a middle break the user will now find with a rewritten tip on top. Consider stating explicitly that only the tip is checked, or running the chain-link check first.

5. **Duplicate-version tips: one is re-chained silently.** With `0007_other.sql` duplicated from `0007_step7.sql`, `upgrade` re-chained `0007_step7.sql` only and exited 0; `verify` afterwards fails with `duplicate-migration-version`. The delta speaks of "the tip migration" as if unique. `upgrade` could refuse (as `verify` does) instead of choosing.

6. **Skills reference is accurate but incomplete on the unaffected set.** `generate-verify-workflow.md` lists `history`, `status` (unaffected) and `restore` (succeeds with a note) — all confirmed — and `generate`/`baseline`/`verify`/`check`/`reset` as refusing (all confirmed, each naming `hejbro upgrade`). `migrate`, `import` and `pull` also run normally against a format-5 snapshot (they read migration files / the ledger / the catalog); `migrate` in particular applies an older-format project's chain without comment, which is the most consequential of the three and worth a sentence.

7. **`upgradeSnapshot` is exported from `@hejbro/core` only.** The banner parsers (`parseBannerUpgradedFrom` included) are re-exported from the `hejbro` package; the re-encoding is not, and the skills reference documents the parsers but never the core function or its `SnapshotUpgrade` return shape (`{ text, fromVersion }`). The delta says "the core SHALL expose", so this is consistent — noted only because a tool author reading the skill will not find the re-encoding at all.

8. **Out of scope, observed while building rows:** `hejbro verify` has no `--config` option while `upgrade`/`generate`/`baseline`/`history` do (a project with a non-default config path can upgrade but not verify through the same flag); `hejbro raise --file=<path>` (equals form) reports `raise-file-missing`. Neither is touched by this change.

## Scenarios verified

| capability | scenario | result | evidence |
|---|---|---|---|
| cli-commands | An older snapshot is upgraded and the chain verifies | pass | `a1`/`a2`/`a3`: snapshot 5→8, tip `-- snapshot:` = sha256 of new file, `-- upgraded-from:` = old tip hash directly under it, migrations 0001–0006 byte-identical, output names both files, `verify` 5/6 checks pass |
| cli-commands | The next migration chains onto the upgraded snapshot | pass | `a1`/`g1`: `0008_addcolor.sql` `parent-snapshot` = upgraded hash, `verify` passes |
| cli-commands | A broken tip is refused, nothing written | pass | `sm` (banner edited), `sm2` (snapshot bytes edited), `s7`: `chain-tip-mismatch`, exit 1, snapshot and tip md5 unchanged |
| cli-commands | A current-format snapshot is a no-op | pass (see B1) | `b1` (pre.0), `a1` after upgrade, `init-0.2.0-pre.1`: exit 0, "snapshot is already at format 8", files unchanged |
| cli-commands | A project without migrations upgrades the snapshot alone | pass, wording (NB1) | `a4`/`a5`/`a6`: snapshot rewritten at 8, no re-chain line |
| cli-commands | Other commands point at the upgrade | pass | `generate`, `verify`, also `baseline`, `check`, `reset`: older-format diagnostic ending "Next: run `hejbro upgrade`", exit 1, files unchanged |
| cli-commands | A command that never reads the snapshot is unaffected | pass | `history` on format 5/4/7/9/broken/absent: exit 0, states `ok`; `status`, `migrate`, `import`, `pull` likewise |
| cli-commands | history and restore still resolve the upgraded tip | pass | `g1`: after upgrade committed, `history` reports 7 `ok` at `913498b` (the original commit); `restore 7` verifies that commit's snapshot against the tip's banner hash and reports "restored declarations reproduce migration 7's recorded snapshot"; `restore 3` (pre-upgrade commit) still works with the format note |
| migration-format | An upgraded tip records the hash it replaced | pass | `parseBannerUpgradedFrom` returns the old hash on the tip, `null` on 0006; `parseBannerHashes(...).current` is the new hash on the tip |
| migration-format | A second upgrade keeps the first recorded hash | pass | `t1`: tip carrying `-- upgraded-from: sha256:111…` + format-5 snapshot → after upgrade exactly one line, value still `111…`, parser returns it, `verify` passes |
| snapshot-format | A released format-5 snapshot re-encodes to the current format | pass | 12/12 released format-5 files: `formatVersion: 8`, object keys and kinds preserved, second re-encoding byte-identical |
| snapshot-format | A golden case with unchanged declarations reproduces the writer's bytes | pass | 10/10 goldens (declarations unchanged since the tag): re-encoded bytes == current `expected/snapshot.json` |
| snapshot-format | The current format is a fixed point | **FAIL** | B1: `p020pre0` (released 0.2.0-pre.0, format 8) re-encodes with `tasks.checks` reordered; current `examples/*` and `init` files are fixed points |
| snapshot-format | Formats outside the released range are refused | pass | format 4 and 3: older diagnostic with pin-or-reset; `hejbroSnapshot` key: same, "version 3"; format 9/100: newer diagnostic; nothing rendered |
| snapshot-format (MODIFIED) | A version-7 snapshot is refused as older, loudly | pass | `s7`: `generate`/`verify` refuse "version 7 is older … Next: run `hejbro upgrade`" |
| snapshot-format (MODIFIED) | A format no release wrote keeps the pin-or-reset guidance | pass, wording (NB2) | `s4`, `sk`: pin-or-reset guidance, upgrade not offered |

## Verdict

**BLOCKED** — one contradiction (B1): the *fixed point* scenario is stated over "a current-format snapshot" and fails on a format-8 snapshot written by the released `hejbro@0.2.0-pre.0`. Every other delta scenario passes on real released inputs. The remedy is a contract decision (reword the identity claim to the canonical current rendering, or make a same-version non-canonical file upgradeable with its tip re-chained), after which round 2 needs only that scenario re-run against `p020pre0`.
