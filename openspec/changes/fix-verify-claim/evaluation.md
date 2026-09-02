# D106 adversarial spec-only evaluation — fix-verify-claim

**FAIL** — 1 blocking / 2 major / 4 minor.

Method: the delta as rendered by `openspec show fix-verify-claim --diff`, read
against the shipped surface, with every claim about `verify` exercised against
the built CLI on a three-migration fixture chain (`hejbro init`, three
`generate` runs, then one mutation per run, `hejbro verify` after each).
Reproduction commands are quoted per finding; all findings below are verified by
execution unless marked UNVERIFIED.

---

## B1 (BLOCKING) — the hand-edit scenario's WHEN is still broader than `verify`

**Delta sentence** (`specs/cli-commands/spec.md:31-35`):

> #### Scenario: A hand-edited artifact is reported
> - **WHEN** a migration's banner line or the snapshot is edited by hand
>   and `hejbro verify` runs
> - **THEN** it fails naming the artifact whose hash no longer matches,
>   with a non-zero exit code

and the SHALL that carries it (`specs/cli-commands/spec.md:10-12`): "so a
hand-edited snapshot, **an edited banner line**, or a missing, renamed or
reordered migration file is reported as a mismatch naming the artifact".

**Observed.** A migration's banner is not two lines; it is the whole comment
block a generated file opens with — `-- hejbro migration`, `-- hejbro: <version>`,
the `-- + …` / `-- ~ …` summary lines, `-- parent-snapshot:`, `-- snapshot:`, and
on a baseline the `-- baseline:` marker (`migration-format` spec lines 11-27;
see `examples/postgres/migrations/0002_alter_tasks.sql:1-5`). `verify` reads
exactly two of them — `readChainEntries` (`packages/cli/src/commands/verify.ts:276-287`)
keeps only `parseBannerHashes`' `parent`/`current`; nothing else in the file is
hashed or compared. Three distinct banner-line edits pass:

| mutation | `verify` |
|---|---|
| `-- + table app.posts [new]` → `-- + table app.posts [TAMPERED]` (migration 1) | `5 checks passed`, exit 0 |
| `-- hejbro: 0.1.1` → `-- hejbro: 9.9.9` (migration 2) | `5 checks passed`, exit 0 |
| migration 1's `-- parent-snapshot:` set to `sha256:000…0` | `5 checks passed`, exit 0 |

The third case is the sharp one: it is a **hash** line, and it still passes,
because `checkChain` accepts the first entry's `parent` unconditionally as the
chain root (`packages/core/src/engine/chain.ts:104-110`, `128-132`) — the walk
only starts comparing at the second entry
(`walkFromRoot`, `chain.ts:50-65`). So even under the narrowest possible reading
of "banner line" (= one of the two hash lines) the scenario is false for the
first migration in the directory.

**Why it is a defect.** This is the exact defect class the change exists to
remove: a scenario whose WHEN admits cases the product does not report. The
delta narrowed `hand-edited migration` → `banner line`, which is more accurate
than what shipped but still over-broad on two axes (non-hash banner lines; the
chain root's `parent`). Left as written, the corpus keeps claiming an integrity
property `verify` does not have — now with a scenario, i.e. a pin the test suite
is supposed to be able to hold, that no test can hold as stated.

**Repair.** Name the two lines and exclude the root, e.g.:

- **WHEN** a migration's `parent-snapshot:` or `snapshot:` hash line — other
  than the first migration's `parent-snapshot:`, which is the chain root and
  accepted as given — or the snapshot file is edited by hand, and `hejbro
  verify` runs
- **THEN** it fails naming the artifact whose hash no longer matches, with a
  non-zero exit code

and mirror the narrowing in the SHALL ("an edited hash-chain line" rather than
"an edited banner line"). `migration-apply`'s sibling sentence already says
"hash-chain line" (`openspec/specs/migration-apply/spec.md:212`); `cli-commands`
should not be the looser of the two. Whether the unchecked chain root is
acceptable or a bug is a separate question — but the requirement must not claim
it away.

Reproduction:

```
sed -i '' 's/^-- + table app.posts \[new\]/-- + table app.posts [TAMPERED]/' migrations/<first>.sql
node packages/cli/dist/cli.js verify   # -> "verify: 5 checks passed", exit 0
sed -i '' 's|^-- parent-snapshot: .*|-- parent-snapshot: sha256:000…0|' migrations/<first>.sql
node packages/cli/dist/cli.js verify   # -> "verify: 5 checks passed", exit 0
```

---

## M1 (MAJOR) — "renamed … is reported" is new in this delta and is false

**Delta sentence** (`specs/cli-commands/spec.md:10-12`): "a missing, **renamed**
or reordered migration file is reported as a mismatch naming the artifact".

**Observed.** `renamed` does not appear in the shipped sentence
(`openspec/specs/cli-commands/spec.md`: "a missing or reordered file") — this
delta adds it. Nothing in `verify` binds a filename to a hash: `readChainEntries`
(`verify.ts:276-287`) uses the filename only as a label to report back, and
`checkChain` (`chain.ts:128-149`) compares hashes only. Renaming the middle
migration to `20260902030802_totally_different_name.sql` — same version prefix,
same sort position — yields `verify: 5 checks passed`, exit 0.

Only a rename that *changes the sort position* is caught, and then it is caught
as a reordering (moving the middle file's prefix past the last one produced
`error[broken-chain]`, exit 1) — which the sentence's own word "reordered"
already covers.

**Why it is a defect.** A change whose stated purpose is to delete an overclaim
introduces a fresh one, in the same sentence it is correcting. "Renamed" reads
to a user as "`verify` will notice if I rename a migration file", and it will
not.

**Repair.** Drop `renamed` from the list. If the rename case is worth stating,
state it as the limit it is, next to the body-edit limit: a rename that keeps a
file's sort position is invisible to `verify`, because no hash covers the
filename.

Reproduction: `mv migrations/<second>.sql migrations/<same-prefix>_other.sql && node packages/cli/dist/cli.js verify` → exit 0.

---

## M2 (MAJOR) — "a missing … migration file is reported" is false for the first file

**Delta sentence** (`specs/cli-commands/spec.md:10-12`): "a **missing**, renamed
or reordered migration file is reported as a mismatch naming the artifact",
reinforced by the new paragraph's "`verify` vouches for the declared history a
chain records" (`specs/cli-commands/spec.md:17-18`).

**Observed.** Deleting the **first** migration of a three-migration chain gives
`verify: 5 checks passed (2 migrations, …)`, exit 0. Same root cause as B1's
third case: with the first file gone, the second becomes the root and its
`parent` is accepted unconditionally (`chain.ts:104-110`, `128-132`); the tip is
unchanged, so check 4 (`verify.ts:536-547`) passes too. Deleting a middle file is
reported (`broken-chain`, exit 1) and deleting the last file is reported
(`chain-tip-mismatch`, exit 1) — the claim holds for two of three positions and
fails for the one that silently discards the chain's origin.

The same paragraph's positive framing — `verify` "vouches for the declared
history a chain records" — is therefore itself stronger than the code: the chain
records a first `parent-snapshot`, and `verify` vouches for nothing about it.

**Why it is a defect.** This is the identical shape of defect the change was
opened to fix (a sentence promising an integrity property the product does not
have), one clause away from the sentence being repaired, and the repair pass
rewrote this very sentence without testing the claim it kept.

**Repair.** Qualify the sentence to what the chain walk actually detects, e.g.
"a migration file missing from anywhere but the start of the chain, or one whose
order changed, is reported…", and soften the "vouches for the declared history"
sentence to say the chain is checked link by link from its first hashed file
onward — the root's own `parent` is taken as given.

Reproduction: `rm migrations/<first>.sql && node packages/cli/dist/cli.js verify` → `5 checks passed`, exit 0.

---

## m1 (MINOR) — "naming the artifact" has no observer in the tip-mismatch case

**Delta sentence** (`specs/cli-commands/spec.md:33-35`): "**THEN** it fails
naming the artifact whose hash no longer matches".

**Observed.** When the failing check is check 4, the rendered diagnostic is:

```
error[chain-tip-mismatch]: snapshot:
  the migration chain's tip hash doesn't match the current snapshot — …
```

The identity slot is filled by `identityFromMessage` (`verify.ts:250-257`), which
lifts the first `"…"` substring out of the message; for
`CHAIN_TIP_MISMATCH_MESSAGE` (`verify.ts:53-54`) that substring is the banner
prefix `snapshot:`, not a file. No migration filename and no snapshot path appear
anywhere in the output. The scenario's THEN is unfalsifiable here as written.

**Repair.** Either weaken the THEN to "fails with a non-zero exit code, naming
the artifact when the failing check knows one", or (better, but this is a source
change and out of this change's stated scope) leave the sentence and file the
tip-mismatch diagnostic's missing identity as a defect. Pre-existing, not
introduced by this delta.

---

## m2 (MINOR, UNVERIFIED) — the transaction-control refusal is not `migrate`'s alone

**Delta sentence** (`specs/cli-commands/spec.md:21-23`): "The one body edit
hejbro does catch — a transaction-control statement — is refused at apply time by
`migrate` (migration-apply)".

**Observed** (by reading, not by execution — exercising it needs a database):
the refusal lives in `assertNoTransactionControl`
(`packages/cli/src/apply/execute.ts:162, 192, 365`), inside `applyMigration`,
which `raise` reuses deliberately as "the same mechanism `migrate` uses, not a
second one" (`packages/cli/src/apply/raise.ts:129-140`). So `raise` refuses a
transaction-control body too. `migration-apply`'s own requirement is written
command-agnostically ("A migration hejbro applies SHALL NOT contain…",
`openspec/specs/migration-apply/spec.md:123-137`).

**Repair.** "…is refused at apply time (migration-apply)", or "by the apply path
(`migrate`, `raise`)". Naming one command narrows a contract that is not
command-scoped.

---

## m3 (MINOR) — the new scenario's THEN carries rationale instead of an observation

**Delta sentence** (`specs/cli-commands/spec.md:40-41`): "**THEN** it passes with
exit code zero — **the chain never hashed the body, and this requirement says so
rather than implying otherwise**".

The clause after the dash is not observable from the product; the second half is
a statement *about this requirement's own prose*. The observable half ("passes
with exit code zero") is correct and confirmed: a `create ` → `create /* hand-edited */ `
edit in the body leaves `verify` at `5 checks passed`, exit 0, matching the pin
at `packages/cli/test/verify.test.ts:435-462`.

**Repair.** End the THEN at "it passes with exit code zero"; the reasoning
already lives in the requirement paragraph above (`specs/cli-commands/spec.md:15-24`),
which is where it belongs.

---

## m4 (MINOR) — the corrected guide keeps the same over-broad claim in its other half

**Surface** (`docs/guide/renames.md:109`): "…so reverting a file (**or editing a
banner line** or the snapshot) breaks chain linearity (`hejbro verify`'s check
3). They are not hashes of the file's SQL body: a body edit that leaves the
banner lines intact is not something `verify` can see…".

The second sentence is the correction this change makes and it is accurate. The
first sentence still says "editing a banner line breaks chain linearity", which
is false for every non-hash banner line and for the chain root (B1), and
misattributes the check: an edit to the *last* migration's `snapshot:` line trips
check 4 (`chain-tip-mismatch`, `verify.ts:536-547`), not check 3. The guide is
listed in the change's own impact, so the half-correction is in scope.

**Repair.** "…or editing a `parent-snapshot:`/`snapshot:` hash line, or the
snapshot" and "breaks the chain (`hejbro verify`'s check 3 or check 4)".

---

## Checked and clean

- **`#### Scenario: An untouched chain passes`** — reproduced: a freshly
  generated three-migration chain gives `verify: 5 checks passed`, exit 0.
- **`#### Scenario: A body edit that keeps the banner lines passes`** — WHEN is
  reachable and the THEN's exit code is observable and correct (see m3 for the
  trailing clause only). It is a genuine pin, not a tautology: the check-4 test
  is its control, and the same file with a hash line altered exits 1.
- **"The two banner hashes are hashes of the normalized declaration snapshot
  before and after the migration, never of the file's own SQL text"** — agrees
  with `migration-format` (spec lines 11-17), with `migration-apply` ("never a
  file's own SQL bytes", line 195), and with the implementation's own account
  (`packages/cli/src/apply/execute.ts:105-117`). No contradiction. The
  parenthetical credits `migration-format`, which states the positive definition;
  `migration-apply` is the one that states the "never" outright — not worth a
  finding.
- **"detecting other body edits needs a record of what was applied, which is a
  separate capability"** — a scoping statement, not a behavioural claim; nothing
  in the surface contradicts it.
- **"`verify` SHALL accept the chain a `baseline` starts exactly as one
  `generate` starts"** — carried over unchanged from the shipped requirement, not
  touched by this delta; not re-reviewed.
- **Reordering is reported** — confirmed: moving a middle migration's version
  prefix past the last one gives `error[broken-chain]` naming the following file,
  exit 1. The "reordered" clause of the SHALL stands.
- **A middle or last migration deleted is reported** — confirmed (`broken-chain`
  / `chain-tip-mismatch`, exit 1). Only the first-file case fails (M2).
- **No "No matching main requirement" warning** was emitted by
  `openspec show fix-verify-claim --diff`; the MODIFIED requirement header
  matches the shipped one exactly.
- **The delta describes no behaviour that lacks an owning sentence.** The one
  cross-capability claim it makes (the transaction-control refusal) is owned by
  `migration-apply` and cited as such (see m2 for the command name only).
- **Considered and rejected as a finding:** that the delta leaves
  `migration-apply`'s own "the chain catches … a file removed" (line 197-200)
  carrying the same first-file falsehood as M2. That sentence is shipped text
  outside this delta; it is noted here only because a repair to M2 that does not
  also touch it will leave the two capabilities disagreeing about what a removed
  file costs.
