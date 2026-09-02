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

---

# Round 2

**FAIL** — 0 blocking / 2 major / 3 minor.

Method: the delta as rendered by `openspec show fix-verify-claim --diff`, read
fresh against the shipped surface (`packages/cli/src/commands/verify.ts`,
`packages/core/src/engine/chain.ts`, `packages/cli/test/verify.test.ts`,
`docs/guide/renames.md`, `openspec/specs/migration-format/spec.md`,
`openspec/specs/migration-apply/spec.md`). Every executable claim was exercised
against the built CLI (`packages/cli/dist/cli.js`) on throwaway fixtures: a
three-migration chain and a one-migration chain, each mutated one way per run
(18 + 3 mutations; hash-line edits at first/middle/last, snapshot edit, body
edit, three non-hash banner edits, renames at two positions, deletions at three
positions plus the degenerate cases, reorder at head and tail, a forged
`-- baseline:` marker, an added hash-less file), plus four `migrate` runs against
an unreachable URL to observe the apply path's pre-flight. Findings are verified
by execution unless marked UNVERIFIED.

Every scenario in the delta reproduces exactly as written; no delta scenario
contradicts shipped behaviour, so nothing here is blocking. The two majors are
sentences elsewhere in the corpus that the delta's own carve-outs now falsify,
one of them in a file this change edits.

---

## M3 (MAJOR) — `migration-apply` still asserts the two properties this delta carves out

**Delta sentences** (`specs/cli-commands/spec.md:10-14, 26-28`): an edited hash
line is reported "other than the first migration's own `parent-snapshot:`, which
is the chain root and is taken as given"; "a migration missing from anywhere but
the start of the chain … is reported"; "the removal of the first migration"
SHALL pass.

**Shipped sentence it contradicts** (`openspec/specs/migration-apply/spec.md:199-200`):
"This is why the chain catches a hash-chain line edited, **a file removed**, or
the order rearranged" — with its own scenario (lines 211-215): "**WHEN** a
migration's hash-chain banner line has been edited, or a migration has been
removed or reordered, and `migrate` runs — **THEN** it fails naming the artifact
whose hash no longer matches, no connection is opened, and no statement is sent
to the database".

**Observed.** `migrate` reads the same chain as `verify`
(`packages/cli/src/commands/migrate.ts:22-23, 332-333` import `readChainEntries`
from `verify.ts` and hand it to the same `checkChain`), so the carve-outs are
`migrate`'s too. Against an unreachable database (`--url=postgres://…:59999/none`),
so that a pre-flight refusal is distinguishable from a connection attempt:

| chain state | `migrate` |
|---|---|
| intact (control) | `error[apply-connection-failed]` — connection attempted |
| middle migration's `parent-snapshot:` edited (control) | `error[broken-chain]`, no connection |
| **first migration removed** | `error[apply-connection-failed]` — connection attempted |
| **first migration's `parent-snapshot:` edited** | `error[apply-connection-failed]` — connection attempted |

So `migration-apply`'s scenario is false in exactly the two positions
`cli-commands` now declares as passing, and its "no connection is opened" is
false with it: the apply path opens the connection and would go on to apply.

**Why it is a defect.** After this delta the corpus holds both "the removal of
the first migration SHALL pass `verify`" and "a migration has been removed →
`migrate` fails, no connection is opened", about one chain walk shared by both
commands. That is the same defect class the change exists to delete — one
sentence claiming an integrity property the product does not have, next to one
saying it does not — moved one capability sideways rather than removed. Round 1
saw this coming and recorded it under "Considered and rejected as a finding"
("a repair to M2 that does not also touch it will leave the two capabilities
disagreeing"); the repair landed and the sibling sentence was not touched, so
the risk is now realised text.

**Repair.** Either extend the delta to `migration-apply` (its sentence and
scenario need the same two qualifiers — "a file removed from anywhere but the
start of the chain", and the root's own `parent-snapshot:` excluded), or, if the
change is deliberately kept to one capability, say so in the proposal's "Out of
scope" and file the sibling correction — an out-of-scope item that is not stated
is indistinguishable from one that was missed.

Reproduction:

```
rm migrations/<first>.sql
node packages/cli/dist/cli.js migrate --url=postgres://nobody:nobody@127.0.0.1:59999/none
# -> error[apply-connection-failed]  (chain pre-flight passed)
```

---

## M4 (MAJOR) — the corrected guide sentence still overclaims for the chain root

**Surface** (`docs/guide/renames.md:109`, the sentence this change rewrote):

> …so reverting a file, **editing one of those two hash lines**, or editing the
> snapshot breaks the chain (`hejbro verify`'s check 3, or check 4 for the last
> migration's `snapshot:` line).

**Observed.** Editing the first migration's `parent-snapshot:` line to
`sha256:000…0` in a three-migration chain: `verify: 5 checks passed (3
migrations, …)`, exit 0. Same in a one-migration chain: `5 checks passed (1
migrations, …)`, exit 0. `checkChain` accepts the root's `parent`
unconditionally (`packages/core/src/engine/chain.ts:104-110, 128-132`), which is
precisely what `specs/cli-commands/spec.md:10-12` now carves out. "Reverting a
file" is false in the same position: reverting the first migration's addition
(i.e. deleting it) passes, exit 0.

**Why it is a defect.** m4's other half was repaired well — the guide now names
the two hash lines and attributes check 3 *and* check 4 correctly — but the
remaining half of the same sentence is the guide's operative instruction
("never …, because it breaks the chain") and it is now the one place in the
corpus that still asserts what the requirement was rewritten to deny. The file
is in this change's own Impact list, so it is not out-of-scope drift.

**Repair.** "…so reverting a file, editing one of those two hash lines (except
the first migration's own `parent-snapshot:`, which is the chain root and is
taken as given), or editing the snapshot breaks the chain…" — or drop the
exception into the paragraph's existing "not hashes of the file's SQL body"
sentence, next to the body-edit limit it already states.

Reproduction:

```
sed -i '' 's|^-- parent-snapshot: .*|-- parent-snapshot: sha256:000…0|' migrations/<first>.sql
node packages/cli/dist/cli.js verify   # -> "verify: 5 checks passed", exit 0
```

---

## m5 (MINOR) — the new scenario's THEN carries a rationale, and the rationale is false for a one-file chain

**Delta sentence** (`specs/cli-commands/spec.md:51-55`):

> #### Scenario: Removing the first migration passes
> - **WHEN** the first migration of a chain is deleted and `hejbro verify` runs
> - **THEN** it passes with exit code zero, **because the next file's
>   `parent-snapshot:` is now the chain root and the root is taken as given**

**Observed.** The observable half is correct at every arity tested (3-file chain
→ `5 checks passed (2 migrations…)`; 3-file chain with the first two deleted →
`(1 migrations…)`; one-file chain → `5 checks passed (0 migrations…)`), all exit
0. The rationale is not: when the deleted first migration was the only one there
is no "next file", and the pass comes from a different branch —
`runCheck4`'s `tip === null` early return (`verify.ts:536-540`), an empty chain
having nothing to compare. The scenario's WHEN admits that case; its THEN
explains a mechanism that does not run there.

Two further notes on the same clause: it is rationale inside a THEN, the exact
shape round 1's m3 asked to be removed from the body-edit scenario — removed
there, reintroduced here — and the same reasoning already appears verbatim in
the requirement paragraph above (lines 26-28), where it belongs.

**Repair.** End the THEN at "it passes with exit code zero".

---

## m6 (MINOR) — two of the four stated limits have no scenario, and the rename limit has no pin at all

**Delta sentences** (`specs/cli-commands/spec.md:22-28`) state four limits with
SHALL force: body edit, any other banner line, a rename that keeps sort
position, removal of the first migration. Two carry scenarios (body edit, first
removal); the other-banner-line limit has a subprocess pin but no scenario
(`packages/cli/test/verify.test.ts:483-499`); the **rename** limit has neither —
no scenario, and no test in `verify.test.ts` renames a migration file.

**Observed.** The limit itself is real: renaming the middle migration to
`20260902031631_totally_other.sql` and renaming the first to
`20260902031619_zzz_other.sql` (same version prefixes, same sort positions) both
give `verify: 5 checks passed`, exit 0. So the sentence is true — it is simply
the one stated limit nothing holds, in a change whose own argument is that these
pins "are the day a body hash ships turning red on purpose"
(proposal, "What Changes"). A limit with no pin decays silently.

**Repair.** Add the one-line rename case to the subprocess tests, or drop the
rename clause to a non-normative aside; do not leave a SHALL unheld.

---

## m7 (MINOR) — the enumerated limits omit an added hash-less file, which `verify` counts as a migration

**Delta sentence** (`specs/cli-commands/spec.md:21-22`): "`verify` therefore
vouches for the recorded sequence of declared states, and for nothing else about
a file:" followed by a closed list.

**Observed.** Dropping a new file into the migrations directory with arbitrary
SQL and no banner (`printf 'drop table app.posts;\n' > migrations/20260902031640_evil.sql`)
gives `verify: 5 checks passed (4 migrations, …)`, exit 0 — the file is skipped
by `readChainEntries` (`verify.ts:276-287`, hash-less files filtered) but counted
in the success line, which reads the raw directory listing. So a passing
`verify` reports "4 migrations" for a chain of which it checked three. The apply
path is unaffected (`migrate` iterates the same filtered chain), so the exposure
is the report, not execution.

**Why it is a defect.** The requirement's list is written as the full account of
what `verify` does not see ("and for nothing else about a file"), and it stops
at edits, renames and removals. An added file is the fourth mutation of that
class, and it is the one that makes `verify`'s own success line overstate its
coverage. Pre-existing behaviour; the defect is the delta enumerating limits
exhaustively and leaving this one out.

**Repair.** Add the case to the limit list ("a migration file added with no hash
lines at all is skipped by the walk, though `verify`'s summary still counts
it"), or replace "and for nothing else about a file" with a non-exhaustive
phrasing so the list is not read as complete.

---

## Checked and clean

- **`#### Scenario: An untouched chain passes`** — freshly generated
  three-migration and one-migration chains both give `5 checks passed`, exit 0.
- **`#### Scenario: A hand-edited artifact is reported`** — every hash line the
  WHEN admits was edited to `sha256:000…0` and every one is reported with exit
  1: first migration's `snapshot:` (`broken-chain`), middle `parent-snapshot:`
  and `snapshot:`, last `parent-snapshot:` (all `broken-chain`), last
  `snapshot:` (`chain-tip-mismatch`), one-file chain's `snapshot:`
  (`chain-tip-mismatch`). A hand-edited `hejbro.snapshot.json` gives
  `error[snapshot-stale]` naming the file, exit 1. The excluded case (first
  migration's `parent-snapshot:`) passes, exactly as the WHEN's exception says.
- **The narrowed THEN ("naming the artifact when the failing check knows one")** —
  round 1's m1 is repaired and the THEN is now satisfiable: `broken-chain` and
  `snapshot-stale` name a file, `chain-tip-mismatch` renders `error[…]: snapshot:`
  with no path (`identityFromMessage`, `verify.ts:250-257`), which the hedge
  admits.
- **`#### Scenario: A body edit that keeps the hash lines passes`** — a
  `/* hand-edited */` insertion into the middle migration's `alter table`
  statement leaves `verify` at `5 checks passed`, exit 0; the check-4 pin is its
  control. Round 1's m3 rationale clause is gone from this THEN.
- **"an edit to any other banner line (the summary lines, the `hejbro:` version
  line)"** — three edits tried, all exit 0: a `-- + table app.posts [new]` →
  `[TAMPERED]` summary line, `-- hejbro: 0.1.1` → `9.9.9`, and deleting the
  `-- hejbro migration` line outright. Also true of the `-- baseline:` marker: a
  forged `-- baseline: adopted 2026-09-02` line inserted into the first migration
  passes `verify` (the marker is read by the apply path, never by any of
  `verify`'s five checks — `readBaselineFileNames` is exported from `verify.ts`
  but not called by them). Accurate as written; noted, not a finding, since the
  sentence is about `verify` alone.
- **"a migration missing from anywhere but the start of the chain … is
  reported"** — middle deleted → `broken-chain` naming the following file, exit
  1; last deleted → `chain-tip-mismatch`, exit 1; first deleted → passes; first
  two deleted → passes. The boundary is exactly where the sentence puts it.
- **"a migration whose order changed is reported"** — reordering at the tail
  (middle file's prefix moved past the last) and at the head (first file's
  prefix moved past the second) both give `error[broken-chain]`, exit 1. No
  position where a reorder slips through was found.
- **"the chain is checked link by link from its first hashed file onward"** —
  matches `checkChain`'s contract (`chain.ts:104-132`) and `readChainEntries`'
  filtering of hash-less files; the legacy-prefix integration test
  (`verify.test.ts:816`) exercises the same path.
- **"The two hash lines are hashes of the normalized declaration snapshot before
  and after the migration, never of the file's own SQL text
  (migration-format)"** — agrees with `migration-format` lines 13-17 and
  `migration-apply` line 195. The parenthetical credits `migration-format`, which
  states the positive definition; the outright "never" is `migration-apply`'s
  sentence. Attribution nit only, same call as round 1.
- **"The one body edit hejbro does catch — a transaction-control statement — is
  refused at apply time (migration-apply)"** (UNVERIFIED — exercising the refusal
  needs a reachable database) — round 1's m2 is repaired: the command name is
  gone, and the claim now matches `migration-apply`'s command-agnostic
  requirement (lines 123-137) and the shared `assertNoTransactionControl` on the
  `migrate`/`raise` path.
- **The three subprocess pins** (`verify.test.ts:435-467`, `468-482`, `483-499`)
  pin exactly the delta's body-edit, first-removal and non-hash-banner-line
  limits, on chains of the right arity (the removal test uses a two-migration
  chain and asserts `checks passed (1 migrations`), and each names the control
  that turns red.
- **No "No matching main requirement" warning** from `openspec show
  fix-verify-claim --diff`; the MODIFIED header still matches the shipped one.
- **`verify` SHALL accept the chain a `baseline` starts** — carried over
  unchanged by this delta; not re-reviewed (no `baseline` run is possible without
  a database).

---

## Round 1 findings — status

| # | Finding | Status |
|---|---|---|
| B1 | hand-edit scenario's WHEN broader than `verify` | repaired — WHEN now names the two hash lines and excludes the root's `parent-snapshot:`; all seven admitted positions verified reported, the excluded one verified passing |
| M1 | "renamed … is reported" is false | repaired — `renamed` is gone from the SHALL and the rename case is restated as a limit (though unpinned, see m6) |
| M2 | "a missing … file is reported" false for the first file | repaired in `cli-commands` — "missing from anywhere but the start of the chain", plus a scenario; **not repaired corpus-wide**, see M3 (`migration-apply` still carries the unqualified claim) |
| m1 | "naming the artifact" has no observer in the tip-mismatch case | repaired — THEN now hedges "when the failing check knows one" |
| m2 | transaction-control refusal is not `migrate`'s alone | repaired — reads "refused at apply time (migration-apply)" |
| m3 | scenario THEN carries rationale instead of an observation | partially repaired — removed from the body-edit scenario, reintroduced in the new first-removal scenario, where it is also false for a one-file chain (m5) |
| m4 | guide keeps the over-broad claim in its other half | partially repaired — the hash-line/body-hash half and the check-3/check-4 attribution are now correct; "editing one of those two hash lines … breaks the chain" is still false for the chain root (M4) |

---

# Round 3

**FAIL** — 1 blocking / 0 major / 3 minor.

Method: the delta as rendered by `openspec show fix-verify-claim --diff` (two
capabilities now), read fresh against the shipped surface
(`packages/cli/src/commands/verify.ts`, `packages/cli/src/commands/migrate.ts`,
`packages/cli/src/apply/plan.ts`, `packages/core/src/engine/chain.ts`,
`packages/cli/test/verify.test.ts`, `packages/cli/test/migrate-command.test.ts`,
`docs/guide/renames.md`, the shipped `cli-commands`, `migration-apply` and
`migration-format` specs). Every executable claim was exercised against the
built CLI (`packages/cli/dist/cli.js`) on throwaway fixtures — a three-migration
chain and a one-migration chain, one mutation per run (24 `verify` runs: hash-line
edits at all six positions, snapshot-file edit, body edit, two non-hash banner
edits, renames at two positions, deletions at every position and every prefix
including the whole chain, reorders at head and tail, an added hash-less file;
plus 11 `migrate`/`status` runs against `postgres://nobody:nobody@127.0.0.1:59999/none`,
so a pre-flight refusal is distinguishable from a connection attempt). The two
named test files were also run (`vitest run test/verify.test.ts
test/migrate-command.test.ts` → 51 passed). Findings are verified by execution
unless marked UNVERIFIED.

---

## B2 (BLOCKING) — `migration-apply`'s rewritten scenario is still false, now at the tail of the chain

**Delta sentences** (`specs/migration-apply/spec.md:16-22, 31-37`):

> The walk starts at the first hashed file and takes that file's own
> `parent-snapshot:` as given …, so **two** mutations at the head of the chain
> are outside its reach and SHALL NOT be refused …
>
> #### Scenario: An unverifiable chain opens no connection
> - **WHEN** a migration's hash-chain banner line **other than the first
>   migration's `parent-snapshot:`** has been edited, or a migration **other than
>   the first** has been removed, or the order has been rearranged, and `migrate`
>   runs
> - **THEN** it fails naming the artifact whose hash no longer matches, **no
>   connection is opened**, and no statement is sent to the database

**Observed.** Two mutations the WHEN admits open the connection:

| chain state (3-migration chain) | `migrate --url=…:59999/none` |
|---|---|
| intact (control) | `error[apply-connection-failed]` — connection attempted |
| mid `parent-snapshot:` edited (control) | `error[broken-chain]`, no connection |
| first `parent-snapshot:` edited (delta's carve-out) | `apply-connection-failed` — connection attempted |
| first migration removed (delta's carve-out) | `apply-connection-failed` — connection attempted |
| **last migration's `snapshot:` line edited** | `apply-connection-failed` — **connection attempted** |
| **last migration removed** | `apply-connection-failed` — **connection attempted** |

Both of the last two are admitted by the WHEN as written (a `snapshot:` hash
line is not "the first migration's `parent-snapshot:`"; the last migration is
"other than the first"), and `verify` reports both — `error[chain-tip-mismatch]`,
exit 1 — so they are not cases anyone would expect to slip.

**Root cause.** `migrate`'s pre-flight is `checkChainOffline`
(`packages/cli/src/commands/migrate.ts:333-345`), which is `checkChain` and
nothing else (`packages/cli/src/apply/plan.ts:193-208`). `verify` runs five
checks; the two tail mutations are caught by **check 4** — tip hash vs the
on-disk snapshot (`verify.ts:535-547`) — which has no counterpart in the apply
path. So the delta's premise that `migrate` "walks the same chain" as `verify`,
and therefore needs only `verify`'s two root qualifiers, is wrong in kind:
`migrate` runs a strictly weaker check, and its unreachable set is larger at
both ends. The word "two" in line 18 is measurably four (and an added hash-less
file makes five: `printf 'drop table app.posts;' > migrations/29990101000000_evil.sql`
also passes the pre-flight — not admitted by the WHEN, noted for the prose only).

**Why it is a defect.** This is the change's own defect class, in the sentence
the change adds: a scenario claiming an integrity property (`no connection is
opened`) the product does not have, in a requirement whose stated purpose is to
enumerate exactly where that property stops. Round 2 raised the untouched
sibling (M3); the repair extended the delta to `migration-apply` and copied
`verify`'s head qualifiers across without measuring whether `migrate`'s
pre-flight is `verify`. It is not.

**Repair.** Say what the pre-flight actually is, and qualify both ends:
`migrate` runs the chain walk only — `verify`'s tip check (check 4) is not part
of it — so the last migration's `snapshot:` line and the removal of the last
migration pass the pre-flight as well as the two head mutations, and the
"unverifiable chain opens no connection" scenario's WHEN must exclude all four.
(Alternatively, if the apply path is meant to run the tip check, that is a
source change and a different proposal — but the requirement must not claim it
today.)

Reproduction:

```
rm migrations/<last>.sql
node packages/cli/dist/cli.js verify    # -> error[chain-tip-mismatch], exit 1
node packages/cli/dist/cli.js migrate --url=postgres://nobody:nobody@127.0.0.1:59999/none
# -> error[apply-connection-failed]  (chain pre-flight passed)

sed -i '' 's|^-- snapshot: .*|-- snapshot: sha256:000…0|' migrations/<last>.sql
node packages/cli/dist/cli.js migrate --url=postgres://nobody:nobody@127.0.0.1:59999/none
# -> error[apply-connection-failed]  (chain pre-flight passed)
```

---

## m8 (MINOR) — the guide grants the root exception to the hash lines and withholds it from "reverting a file"

**Surface** (`docs/guide/renames.md:109`, the sentence this change rewrote
twice):

> …so **reverting a file**, editing one of those two hash lines (except the first
> migration's own `parent-snapshot:`, which is the chain root and is taken as
> given), or editing the snapshot breaks the chain…

**Observed.** Reverting the commit that added the first migration — i.e.
deleting it — does not break the chain: `verify: 5 checks passed (2 migrations,
…)`, exit 0, and `migrate` opens its connection. The exception is granted, in
the same sentence, to the clause next to it and not to this one.

**Why it is a defect.** Round 2's M4 named both halves ("'Reverting a file' is
false in the same position"); the repair took one. The harm direction is
conservative here — the guide tells a user to be more careful than necessary,
not less — which is why this is minor rather than major, but a corrected
sentence that leaves a known-false clause in place next to the correction is the
half-repair the round exists to catch.

**Repair.** Move the exception to cover both clauses, or state it once for the
chain root generally: "…except at the chain root — the first migration's own
`parent-snapshot:` is taken as given, and deleting the first migration is not
detected either."

---

## m9 (MINOR) — the stated first-removal limit is narrower than the measured one, and its parenthetical mechanism is false at the boundary

**Delta sentence** (`specs/cli-commands/spec.md:27-29`): "**the removal of the
first migration** (the next file's own `parent-snapshot:` becomes the root and
is taken as given)".

**Observed.** The limit is not one file — it is any *prefix* of the chain, up to
and including all of it:

| mutation (3-migration chain) | `verify` |
|---|---|
| first deleted | `5 checks passed (2 migrations, …)`, exit 0 |
| first two deleted | `5 checks passed (1 migrations, …)`, exit 0 |
| **all three deleted** | `5 checks passed (0 migrations, …)`, exit 0 |
| one-file chain, its only migration deleted | `5 checks passed (0 migrations, …)`, exit 0 |

So an empty `migrations/` directory passes `verify` while the snapshot on disk
still declares the tables no remaining migration creates. In those last two rows
there is no "next file", and the pass comes from a different branch —
`runCheck4`'s `tip === null` early return (`verify.ts:536-538`) — so the
parenthetical explains a mechanism that does not run there. (Round 2's m5 asked
for this rationale to leave the scenario's THEN; it left the THEN and reappeared
in the prose, where rationale belongs but where it is still wrong for the
degenerate case.)

**Why it is a defect.** The paragraph's own stated purpose is "so that nobody
reads a passing `verify` as proof" of more than it checks. "The removal of the
first migration" reads as one lost file; the measured hole is the whole prefix,
which is the difference between a nick and a chain a user can delete outright
while `verify` says five checks passed.

**Repair.** "…the removal of any leading run of migrations — the next remaining
file's own `parent-snapshot:` becomes the root and is taken as given, and an
empty directory has no chain to check at all."

---

## m10 (MINOR) — half of `migration-apply`'s new scenario has no pin

**Delta sentence** (`specs/migration-apply/spec.md:39-43`): the root scenario's
WHEN names two mutations — the first migration's `parent-snapshot:` edited, *or*
the first migration removed.

**Observed.** `packages/cli/test/migrate-command.test.ts:467` pins the removal
half ("opens a connection when the first migration was removed"). Nothing pins
the edited-root half; no test in that file edits a first migration's
`parent-snapshot:` and asserts the connection opens. Both halves reproduce by
hand (see B2's table), so the sentence is true — it is simply half-held.

**Why it is a defect.** Round 2's m6 made the same objection about
`cli-commands`' unpinned rename limit and the repair delivered a pin
(`verify.test.ts:501`). A new `SHALL NOT` arriving in the sibling capability with
one of its two cases unheld reintroduces the pattern the previous round closed.

**Repair.** Add the one-line case to `migrate-command.test.ts`'s 17.1 describe
block, alongside the removal pin it already has.

---

## Checked and clean

- **`#### Scenario: An untouched chain passes`** — three-migration and
  one-migration chains both give `5 checks passed`, exit 0.
- **`#### Scenario: A hand-edited artifact is reported`** — all six hash-line
  positions exercised with `sha256:000…0`: first `snapshot:`, mid
  `parent-snapshot:`, mid `snapshot:`, last `parent-snapshot:` → `broken-chain`
  naming a file, exit 1; last `snapshot:` → `chain-tip-mismatch`, exit 1 (no
  filename — which the THEN's "when the failing check knows one" admits); the
  one-file chain's `snapshot:` → `chain-tip-mismatch`, exit 1. The excluded
  case (first `parent-snapshot:`) passes at both arities, exactly as the WHEN's
  exception says. A hand-edited `hejbro.snapshot.json` → `snapshot-stale`
  naming the file, exit 1.
- **`#### Scenario: A body edit that keeps the hash lines passes`** — a
  `/* hand-edited */` insertion into a middle migration's `alter table` leaves
  `verify` at `5 checks passed`, exit 0.
- **`#### Scenario: Removing the first migration passes`** — exit 0 at every
  arity tested (see m9 for the understated scope only; the scenario as written
  is true).
- **`#### Scenario: A rename that keeps a file's position passes`** — renaming
  the middle file and the first file to a new slug behind the same version
  prefix both give `5 checks passed`, exit 0; same on a one-file chain.
- **`#### Scenario: A file with no hash lines is skipped but counted`** —
  `printf 'drop table app.posts;' > migrations/29990101000000_evil.sql` gives
  `5 checks passed (4 migrations, …)`, exit 0 on a three-migration chain: the
  count claim in the THEN is exact.
- **"an edit to any other banner line (the summary lines, the `hejbro:` version
  line)"** — `-- + table app.posts [new]` → `[TAMPERED]` and `-- hejbro: 0.1.1`
  → `9.9.9` both exit 0.
- **"a migration missing from anywhere but the start of the chain … is
  reported"** — middle deleted → `broken-chain`, exit 1; last deleted →
  `chain-tip-mismatch`, exit 1; first *and* last deleted → `chain-tip-mismatch`,
  exit 1. The boundary is where the sentence puts it.
- **"a migration whose order changed is reported"** — a middle file's prefix
  moved past the last, and the first file's prefix moved past the second, both
  give `broken-chain`, exit 1.
- **`#### Scenario: A mutation at the chain root passes the pre-flight`
  (migration-apply)** — both halves reproduce: first `parent-snapshot:` edited
  and first migration removed each reach `apply-connection-failed`, i.e. the
  pre-flight passed and the connection was attempted; the one-file chain's sole
  migration removed does the same. (Pin coverage: m10.)
- **`#### Scenario: An unverifiable chain opens no connection` — the cases it
  gets right** — first `snapshot:` edited, mid `parent-snapshot:` edited, last
  `parent-snapshot:` edited, middle migration removed, and a reorder all give
  `error[broken-chain]` with no connection attempt, and the message names the
  file ("does not verify at `<file>`"), satisfying the THEN's "naming the
  artifact". Only the two tail cases fail (B2).
- **"never of the file's own SQL text (migration-format)"** — agrees with
  `migration-format` and with `migration-apply`'s own "never a file's own SQL
  bytes". Attribution nit only, same call as rounds 1-2.
- **"The one body edit hejbro does catch — a transaction-control statement — is
  refused at apply time (migration-apply)"** (UNVERIFIED — the refusal needs a
  reachable database) — unchanged from round 2, where it was judged repaired.
- **`verify` SHALL accept the chain a `baseline` starts** — carried over
  unchanged by this delta; not re-reviewed (no `baseline` run without a
  database).
- **The five subprocess pins** (`verify.test.ts:435, 468, 483, 501, 520`) now
  cover all five stated `verify` limits, at the right arities, each naming its
  control. `vitest run test/verify.test.ts test/migrate-command.test.ts` → 2
  files, 51 tests passed.
- **No "No matching main requirement" warning** from `openspec show
  fix-verify-claim --diff`; both MODIFIED headers match the shipped ones
  (`cli-commands/spec.md:521`, `migration-apply/spec.md:192`), and `openspec
  validate fix-verify-claim --strict` reports the change valid.
- **Considered and not raised:** `hejbro status` also opens a connection on a
  chain `verify` reports as broken (measured: `apply-connection-failed` with a
  mid `parent-snapshot:` edited). The requirement's "the apply path SHALL verify
  … before opening a database connection at all" is shipped text this delta does
  not touch, and its scenarios speak of `migrate`; recorded so the next reader
  of that sentence knows the measurement exists.

---

## Round 2 findings — status

| # | Finding | Status |
|---|---|---|
| M3 | `migration-apply` still asserts the two properties this delta carves out | **partially repaired** — the delta now covers `migration-apply` and carves out both head mutations (verified passing), but the same scenario is still false at the tail: the last migration removed, and the last migration's `snapshot:` line edited, both open the connection (B2) |
| M4 | the corrected guide sentence still overclaims for the chain root | **partially repaired** — the hash-line clause now excepts the root; the "reverting a file" clause in the same sentence still does not (m8) |
| m5 | the first-removal scenario's THEN carries a false rationale | **repaired** — the THEN now ends at "it passes with exit code zero"; the rationale moved to the requirement paragraph, where it is still imprecise for the empty-chain case (m9) |
| m6 | two stated limits unpinned, the rename limit unpinned entirely | **repaired** — `verify.test.ts:501` pins the rename and a scenario states it; all five limits now carry both a scenario and a subprocess pin (51 tests green) |
| m7 | the limit list omits an added hash-less file | **repaired** — the case is in the list, has its own scenario (count claim verified exactly), a pin (`verify.test.ts:520`), and the list now carries a non-exhaustive hedge |

---

# Round 4

**PASS** — 0 blocking / 0 major / 4 minor.

Method: the two deltas as rendered by `openspec show fix-verify-claim --diff`,
read fresh against the shipped surface (`packages/cli/src/commands/verify.ts`,
`packages/cli/src/commands/migrate.ts`, `packages/cli/src/apply/plan.ts`,
`packages/core/src/engine/chain.ts`, `packages/cli/test/verify.test.ts`,
`packages/cli/test/migrate-command.test.ts`, `docs/guide/renames.md`, the
shipped `cli-commands`, `migration-apply` and `migration-format` specs). Fresh
fixtures were generated for this round (`hejbro init` + three `generate` runs =
a three-migration chain; a separate one-migration chain), one mutation per run,
against the built CLI: **32 `verify` runs** (hash-line edits at all six
positions of the three-chain and both of the one-chain, snapshot-file edit and
deletion, two body edits, two non-hash banner edits, renames keeping and
changing sort position, deletions of first / leading run / all / middle / last /
trailing run / the sole file, two reorders, a hash-less file added before the
root, in the middle and at the tail, and two coordinated multi-line forgeries)
and **28 `migrate` runs** against `postgres://nobody:nobody@127.0.0.1:59999/none`,
so a pre-flight refusal (`error[broken-chain]`, exit 2) is distinguishable from
a connection attempt (`error[apply-connection-failed]`, exit 2) — every
hash-line position at three arities (3-file, 2-file, 1-file), every deletion
shape, both reorders, a rename, a body edit, a hash-less file, and the snapshot
file deleted. `vitest run test/verify.test.ts test/migrate-command.test.ts` →
2 files, **55 tests passed**. `openspec validate fix-verify-claim --strict` →
valid; `--diff` emits no "No matching main requirement" warning.

**Every scenario in both deltas reproduces exactly as written.** All eight were
executed at every arity the wording admits, including the degenerate ones (a
one-file chain, where `migration-apply`'s WHEN excludes both of the sole file's
hash lines and admits no removal; a two-file chain, where "a migration between
the first and the last" is vacuous and the single link is admitted from both
sides). No delta scenario contradicts shipped behaviour, so nothing here is
blocking. The four minors are prose and pin gaps, three of them in
`migration-apply` — the capability this round is the first to see in its
repaired form.

---

## m11 (MINOR) — `migration-apply` keeps the blanket "the chain catches … a file removed" three lines above its own carve-out

**Delta sentence** (`specs/migration-apply/spec.md:12-15`, carried unchanged
from the shipped requirement at `openspec/specs/migration-apply/spec.md:199`):

> This is why the chain catches **a hash-chain line edited, a file removed**, or
> the order rearranged, but not a hand-edit to a migration's own SQL body…

**Observed** (`migrate --url=…:59999/none`, three-migration chain):

| mutation | result |
|---|---|
| first `parent-snapshot:` edited | `apply-connection-failed` — connection attempted |
| last `snapshot:` edited | `apply-connection-failed` — connection attempted |
| first migration removed | `apply-connection-failed` — connection attempted |
| last migration removed | `apply-connection-failed` — connection attempted |

So "a hash-chain line edited" and "a file removed" are each false at both ends
of the chain — which is exactly what the delta's own next paragraph
(`:20-28`) then says: "That leaves both ends of the chain outside its reach,
and the following SHALL NOT be refused…".

**Why it is a defect, and why only minor.** The change exists because the corpus
carried "one sentence that claims an integrity property the product does not
have, next to two that say it does not" (proposal, Why). After this delta the
same requirement carries one such sentence next to a paragraph that says it does
not. It is minor rather than major because the retraction is three lines below,
explicit, and in the same requirement — a reader who reads on is corrected, and
the sibling `cli-commands` SHALL was repaired by qualifying its own sentence
inline, which is the shape available here too. The harm direction is still the
unsafe one (it overstates what `migrate` refuses), which is why it is raised at
all rather than left in the clean list.

**Repair.** Qualify it where it stands: "…the chain catches a hash-chain line
edited between its ends, a file removed from between them, or the order
rearranged, but not…" — and let the paragraph below keep the precise
enumeration.

---

## m12 (MINOR) — "That leaves **both ends** of the chain outside its reach" is a completeness claim the pre-flight does not meet, and the list carries no hedge

**Delta sentence** (`specs/migration-apply/spec.md:20-26`): "That leaves both
ends of the chain outside its reach, and the following SHALL NOT be refused: …"

**Observed.** A file with no banner hash lines at all also passes the pre-flight,
at every position — it is not at either end, and it is not in the list:

```
printf 'drop table app.posts;\n' > migrations/00000000000000_evil.sql   # before the root
printf 'drop table app.posts;\n' > migrations/20260902034500_evil.sql   # mid-chain
printf 'drop table app.posts;\n' > migrations/29990101000000_evil.sql   # after the tip
node packages/cli/dist/cli.js migrate --url=postgres://nobody:nobody@127.0.0.1:59999/none
# -> error[apply-connection-failed] in all three cases (pre-flight passed)
```

`verify` behaves the same and the sibling delta states it (`cli-commands`
`:30-32`, plus its own scenario and pin). `migration-apply` omits it, and —
unlike `cli-commands`, which gained "this list names the measured ones, not
every possible one" as m7's repair — its list has no non-exhaustive hedge, so
"both ends" reads as the whole of what the pre-flight cannot see. Round 3's B2
recorded this measurement in passing ("an added hash-less file makes five …
noted for the prose only"); the repair addressed the four and not the note.

**Why it is a defect.** An arbitrary unhashed `.sql` file dropped into
`migrations/` is applied-adjacent content the pre-flight ignores, and it is the
one case a reader is most likely to construct by accident (a hand-written
patch file, a `.sql` scratch file committed by mistake). A requirement that
enumerates its blind spots and stops one short of the list its sibling ships is
the half-repair the round exists to catch.

**Repair.** Add the case to the list, or carry the sibling's hedge: "…and the
following SHALL NOT be refused — this list names the measured ones, not every
possible one: … and a file with no hash lines at all, at any position (the walk
skips it)."

---

## m13 (MINOR) — the guide's repaired sentence now has a dangling second half, and its exception is narrower than the measured one

**Surface** (`docs/guide/renames.md:109`, the sentence this change has now
rewritten three times):

> …so reverting a file, editing one of those two hash lines, or editing the
> snapshot **breaks the chain** — except at the chain's head, which is taken as
> given: the first migration's own `parent-snapshot:` line is not checked, and
> deleting the first migration leaves a chain that still verifies. Never rely on
> either; the point is what `verify` catches, not what it cannot — **it breaks
> the chain** (`hejbro verify`'s check 3, or check 4 for the last migration's
> `snapshot:` line).

**Observed.** Two defects, both introduced by the splice, neither factual about
the CLI:

1. `breaks the chain` now appears twice, and the second occurrence is a fragment
   whose subject has no antecedent — the nearest candidates are "the point" and
   "what it cannot [catch]", and the parenthetical that belongs to the *first*
   occurrence ("`verify`'s check 3, or check 4 …") is stranded on the second.
   m8's repair inserted the exception clause between the verb and its
   parenthetical without re-joining them.
2. The exception granted is "deleting the first migration", where the measured
   hole is any leading run: first deleted → `5 checks passed (2 migrations)`,
   first two deleted → `(1 migrations)`, all three deleted → `(0 migrations)`,
   each exit 0. `cli-commands`' own delta says "any leading run of migrations up
   to and including all of them" (m9's repair); the guide it corrects in the
   same change does not.

**Why it is a defect, and why only minor.** (2) errs conservative — the guide
tells a user to be more careful than necessary. (1) is not a factual error at
all, but it is a user-facing sentence this change edited into an unparseable
state, in the document the change's own "What Changes" lists as one of its four
outputs.

**Repair.** Re-join the parenthetical and widen the exception in one pass:
"…breaks the chain (`hejbro verify`'s check 3, or check 4 for the last
migration's `snapshot:` line) — except at the chain's head, which is taken as
given: the first migration's own `parent-snapshot:` line is not checked, and
deleting the first migration, or any leading run of them, leaves a chain that
still verifies. Never rely on either."

---

## m14 (MINOR) — the two "any … run" clauses of `migration-apply`'s new `SHALL NOT` have no pin

**Delta sentence** (`specs/migration-apply/spec.md:23-26`): the carve-out names
four things, two of which are runs — "the removal of the first migration **or
of any leading run of migrations**" and "the removal of the last migration **or
of any trailing run**".

**Observed.** `packages/cli/test/migrate-command.test.ts`'s 17.1 block now pins
four cases (`:483` first `parent-snapshot:` edited, `:497` last `snapshot:`
edited, `:510` last removed, `:516` first removed) — m10's repair, and it lands
exactly on the scenario's four halves. Neither run clause is pinned. Both hold
by hand: first two of three removed → `apply-connection-failed`; middle and last
removed → `apply-connection-failed`; all three removed →
`apply-connection-failed`. So the sentence is true and half-held.

**Why it is a defect.** Round 2's m6 and round 3's m10 both objected to a stated
limit arriving without a pin, and both repairs delivered one. The runs are new
prose in this round's repair and arrive unheld, which is the third instance of
the pattern the previous two rounds closed. The runs are also the cases with the
larger blast radius: a whole prefix or suffix of the chain can be missing and
`migrate` still connects.

**Repair.** One case in the same describe block — remove two of three migrations
and assert the connection opens — covers both clauses' shape at once.

---

## Checked and clean

- **`#### Scenario: An untouched chain passes`** — three-migration and
  one-migration chains, freshly generated: `5 checks passed`, exit 0.
- **`#### Scenario: A hand-edited artifact is reported`** — all five admitted
  hash-line positions on the three-chain (`first snapshot:`, `mid
  parent-snapshot:`, `mid snapshot:`, `last parent-snapshot:` →
  `error[broken-chain]` naming a file, exit 1; `last snapshot:` →
  `error[chain-tip-mismatch]`, exit 1) and the one-file chain's `snapshot:`
  (`chain-tip-mismatch`, exit 1). A hand-edited `hejbro.snapshot.json` →
  `error[snapshot-stale]` naming the file, exit 1. The excluded case (first
  `parent-snapshot:`) passes at both arities. The THEN's "naming the artifact
  when the failing check knows one" is exactly right: the tip check names
  `snapshot:`, not a file.
- **`#### Scenario: A body edit that keeps the hash lines passes`** — a changed
  `create schema` statement and an appended `drop table` both leave `verify` at
  `5 checks passed`, exit 0.
- **`#### Scenario: Removing a leading run of migrations passes`** — the
  scenario's two named cases (the first migration; every migration) and the
  intermediate they bracket (the first two of three) all give exit 0 at
  `(2 migrations)`, `(0 migrations)`, `(1 migrations)`; the one-file chain's sole
  migration deleted gives `(0 migrations)`, exit 0. The rewritten scenario title
  and the widened prose (m9's repair) are both exact.
- **`#### Scenario: A rename that keeps a file's position passes`** — renaming
  the middle file behind the same version prefix → exit 0; changing the prefix
  so the file sorts last → `error[broken-chain]`, exit 1. The boundary is where
  the sentence puts it.
- **`#### Scenario: A file with no hash lines is skipped but counted`** — exit 0
  with `(4 migrations, …)` on a three-chain, whether the file sorts before the
  root, mid-chain, or after the tip. The count claim in the THEN is exact and
  position-independent.
- **"an edit to any other banner line (the summary lines, the `hejbro:` version
  line)"** — `-- + table app.posts [new]` → `[LIES]` and `-- hejbro: 0.1.1` →
  `9.9.9` both exit 0.
- **"a migration missing from anywhere but the start of the chain … is
  reported"** — middle deleted → `broken-chain`, exit 1; last deleted and
  mid+last deleted → `chain-tip-mismatch`, exit 1.
- **"a migration whose order changed is reported"** — first↔mid prefix swap and
  mid↔last prefix swap both → `broken-chain` naming a file, exit 1; the same two
  under `migrate` → `broken-chain`, no connection.
- **"the chain is checked link by link from its first hashed file onward"** —
  matches `checkChain`/`walkFromRoot` (`packages/core/src/engine/chain.ts:50-65,
  128-149`), which is strict positional adjacency against the *immediately*
  preceding entry, not "any earlier snapshot" (#129). Reproduced: a hash-less
  file before the root does not become the root.
- **`#### Scenario: An unverifiable chain opens no connection`** — every case
  the WHEN admits refuses with no connection: `first snapshot:`, `mid
  parent-snapshot:`, `mid snapshot:`, `last parent-snapshot:` edited; the middle
  migration removed; both reorders. Also checked at two-file arity, where the
  WHEN admits the single link from both sides (`file1 snapshot:`, `file2
  parent-snapshot:`) — both refuse. The message names the file ("the migration
  chain does not verify at `<file>`"), satisfying "naming the artifact".
  Round 3's B2 is gone: the two tail cases the old WHEN wrongly admitted are now
  excluded by it.
- **`#### Scenario: A mutation at either end of the chain passes the pre-flight`**
  — all four halves reproduce (`apply-connection-failed`, i.e. the pre-flight
  passed and the connection was attempted), plus the one-file chain's three
  degenerate forms (root edit, tip edit, sole migration removed).
- **"the apply path reads no snapshot file"** — reproduced directly: `rm
  hejbro.snapshot.json` then `migrate` → `apply-connection-failed` (the run
  proceeds), while `verify` on the same tree → `error[snapshot-lost]`, exit 1.
  Confirmed in source: `runMigrate` (`migrate.ts:326-345`) reads config,
  `listMigrationFiles`, `readChainEntries`, `readBaselineFileNames`, then
  `checkChainOffline`, which is `checkChain` and nothing else
  (`plan.ts:193-208`). `verify`'s check 4 has no counterpart there.
- **"`verify` is the command that sees the tail cases, through the snapshot"** —
  last `snapshot:` edited and last removed both → `chain-tip-mismatch`, exit 1
  under `verify` while `migrate` connects. True as written.
- **"never of the file's own SQL text (migration-format)"** — agrees with
  `migration-format`'s own requirement and with `migration-apply`'s "never a
  file's own SQL bytes". Attribution nit only, same call as rounds 1-3.
- **"The one body edit hejbro does catch — a transaction-control statement — is
  refused at apply time"** (UNVERIFIED — the refusal needs a reachable database;
  `assertInteractiveTransactions` and the statement scan run inside the
  connection callback). Unchanged since round 2, where it was judged repaired.
- **`verify` SHALL accept the chain a `baseline` starts** (UNVERIFIED for this
  round — no `baseline` run without a database). Carried over unchanged by this
  delta.
- **The six subprocess pins in `verify.test.ts`** (`:435`, `:468`, `:483`,
  `:501`, `:513`, `:532`) cover all five stated `verify` limits plus the
  hash-less file, each naming its control; **four in
  `migrate-command.test.ts`** (`:483`, `:497`, `:510`, `:516`) cover the new
  scenario's four halves (m10's repair, see m14 for what is left). `vitest run
  test/verify.test.ts test/migrate-command.test.ts` → 55 tests passed.
- **`openspec validate fix-verify-claim --strict`** → valid; `--diff` renders
  both MODIFIED requirements against their shipped headers with no "No matching
  main requirement" warning.
- **Considered and not raised — coordinated multi-line forgeries.** Two states
  pass `verify` at `5 checks passed`, exit 0: (a) a middle file's `snapshot:`
  and the next file's `parent-snapshot:` edited to the same value, (b) the
  middle file deleted *and* the last file's `parent-snapshot:` re-pointed at the
  first file's `snapshot:`. Both are admitted by a literal reading of the
  hand-edit scenario's WHEN ("a migration's … hash line … is edited by hand"),
  but each requires two coordinated edits, and every scenario in both deltas is
  written for one mutation at a time. Recorded because (b) is a plausible
  manual "repair" path a user might take after deleting a migration, and
  because no sentence in the corpus tells them the re-link is undetectable.
- **Considered and not raised (again):** `hejbro status` opens a connection on a
  chain `verify` reports broken — unchanged shipped text this delta does not
  touch, as round 3 recorded.

---

## Round 3 findings — status

| # | Finding | Status |
|---|---|---|
| B2 | `migration-apply`'s rewritten scenario still false at the tail | **repaired** — the pre-flight is now described as the chain walk alone with no tip check, the `SHALL NOT` list covers both ends, the WHEN excludes the first `parent-snapshot:` and the last `snapshot:` and narrows removal to "between the first and the last", and a scenario states the pass. All four cases re-measured: each opens the connection, and every case the WHEN still admits refuses without one |
| m8 | the guide grants the root exception to the hash lines and withholds it from "reverting a file" | **repaired** (with residue) — the exception is now stated for the chain's head generally and names the deletion case explicitly; the splice left the sentence's second half dangling and the exception one notch narrower than measured (m13) |
| m9 | the stated first-removal limit is narrower than measured, and its parenthetical is false at the boundary | **repaired** — the prose now says "any leading run of migrations up to and including all of them", the parenthetical is "whatever file is first is the root", and the empty case has its own clause ("an empty directory has no tip to compare"); the scenario is retitled and covers both ends. Re-measured at all four arities |
| m10 | half of `migration-apply`'s new scenario has no pin | **repaired** — `migrate-command.test.ts:483/497/510/516` pin all four halves of the (now wider) scenario; the prose's two "any … run" clauses remain unheld (m14) |
