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
