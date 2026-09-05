# Decisions — quickstart-now/hejbro#631

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The ledger records a body checksum; migrate refuses an applied migration whose body changed; status reports it

_lead · extension · basis 412/D24, D25; #616 (the offline limit stated); the ledger identity rule's own tolerance for a fifth column; Prisma checksum / Drizzle hash precedent · 2026-09-05T05:46Z · ratified: pending_

Design (design.md Q1-Q4): SHA-256 of the body below the banner (CRLF normalized; whole file for a raised snapshot; baseline hashed too), compared over every recorded file before anything pending is sent, apply-migration-body-changed with both checksums and the restore-or-new-migration remedy; the bootstrap adds the column to an older ledger and null rows are never compared; identity stays four columns. migration-apply: four MODIFIED + one ADDED requirement. Ratification: owner on return.

<a id="r2"></a>
## R2 — the banner boundary, the normalization and the checksum's stored form

_lead · interpretation · basis R1 · 2026-09-05T16:52Z · ratified: pending_

Task 1.1's open contract details, settled by the lead under the owner's
full delegation for this pass.

**The banner boundary is two predicates, not a scan.** A migration file
carries a banner exactly when its first line -- after `\r\n` is
normalized to `\n` -- is the literal `-- hejbro migration`. The body is
everything after the first `"\n\n"`, that separator excluded. A file
whose first line is anything else carries no banner and is hashed whole
(the snapshot SQL `raise` applies). A file that is a banner and nothing
else -- no `"\n\n"` anywhere -- has the empty body, and the checksum
recorded is the SHA-256 of the empty string. Two predicates make a
falsifying input mechanical to construct, and neither moves when the
banner gains a line: `-- hejbro: <version>`, `-- baseline:`, a
change-summary line, the two hash-chain lines and `-- upgraded-from:`
(#413) all sit inside the run this rule never counts. Rejected: a
maximal leading run of `--` lines, which leaves "how many blank lines
does the separator swallow" open, so one body can hash two ways; and
"up to the `-- snapshot:` line", which has no boundary at all on a
pre-hash-chain migration, where `parseBannerHashes` answers `null`.

**Nothing but line endings is normalized.** `\r\n` becomes `\n`; a lone
`\r`, a final newline gained or lost, and trailing whitespace inside a
body are edits like any other. A checkout the platform rewrote is the
one difference a user cannot avoid; every other one is a change to the
text that ran.

**The column holds bare lowercase hex, 64 characters.** The requirement
already fixes the algorithm and the column is named `checksum`. The
banner's own `sha256:` prefix is a file format describing itself, a
different obligation. A later algorithm change earns a second column or
its own change, not a prefix carried from the start.

`bodyChecksum` lives in `apply/ledger.ts` and hashes through the
existing `sha256Hex` in `packages/cli/src/hash.ts`, which is not
modified. The bootstrap's `alter table ... add column if not exists
"checksum" text` follows its `create table` on the same
`exec(..., "write", "bootstrap")` path, so a refused upgrade is
attributed to the bootstrap like every other ledger write.

`tasks.md`'s **Files edited** header omitted `commands/migrate.ts` (task
1.3) and `apply/ledger-identity.ts` (task 1.6) and numbered the
docs/changeset task 1.6 when it is 1.7. The per-task Files lines and the
team's file boundary are correct; the header is repaired to match them.
No file boundary changes.

<a id="r3"></a>
## R3 — the working-directory pattern: one cd per call, never a persistent one

_lead · interpretation · basis R1 · 2026-09-05T17:13Z · ratified: pending_

The brief said "absolute paths only, never cd". The team measured why
that fails here: `blackbox.mjs` resolves the repository root from
`process.cwd()` and reports "no work-item folder for 631" when run by
absolute path from the main checkout, and pnpm, turbo and vitest resolve
the workspace from cwd the same way; the Bash cwd resets to the main
checkout on every call. Followed literally, the rule makes commands run
in the main checkout -- the exact thing it exists to prevent. Ruling:
every Bash call a piece team makes starts with `cd <worktree absolute
path> &&` inside that single call; a persistent cd is still banned (the
reset makes it meaningless anyway); once per group the main checkout is
checked for pollution (`git status --short` clean, `git log --oneline -1`
at the recorded base). The lead propagates the same pattern to the ra
team and to every future brief; the brief's sentence was the lead's
error, not the team's.

<a id="r4"></a>
## R4 — the banner literal stays local to the ledger; the live witness is its drift detector

_lead · interpretation · basis R2 · 2026-09-05T17:13Z · ratified: pending_

`bodyChecksum` judges the first line against the literal
`-- hejbro migration`, which `@hejbro/core`'s `renderBanner`
(`packages/core/src/sql/migration-file.ts`) prints but does not export.
Option (B), exporting it from core, edits a file outside this piece's
boundary for a one-line constant. Ruling: option (A) -- the literal is a
local constant in `packages/cli/src/apply/ledger.ts` with a one-line
constraint comment (it must equal `renderBanner`'s first line; if the two
drift, the banner is hashed as body). The pair that keeps the drift from
returning is task 1.5's live witness, which hashes the real `generate`
output, not a hand-written string -- so a drift fails a test rather than
a review. The existing `apply-ledger` tests that count bootstrap
statements are this task's own tests (tasks.md: "and their tests");
updating their expected counts from the old number to the new one is in
scope, and the implementer reports the before/after assertion lines
rather than asking.

<a id="r5"></a>
## R5 — test fakes that identify statements by prefix gain one alter-table branch; production is untouched

_lead · extension · basis R4 · 2026-09-05T17:14Z · ratified: pending_

The bootstrap now sends a third statement, `alter table ... add column if
not exists "checksum" text`. Fifteen cases in
`packages/cli/test/apply-reset.test.ts` failed with "ledger statement
failed": that file's fake session identifies statements by prefix and
treats any unrecognised statement as the DROP DDL reset sends, so once a
drop failure is configured the fake throws it at the bootstrap's alter
instead. The planner confirmed the cause in the fixture's source, not by
inference; production is correct. Ruling: the piece's file boundary
extends to that file by one branch -- `alter table` is recognised above
the fallback and returns no rows -- plus a one-line constraint on the
fallback (every statement sent to the ledger must match above it, or a
bootstrap statement is mistaken for the DROP). The fake does not set
`bootstrapped` (the `create table` branch already does; a fake never
gains a second way to be bootstrapped) and does not throw 42P01, because
that file's fake is loose by design and each file keeps its own fixture
idiom. The same rule covers every other fake under `packages/cli/test`
that breaks the same way: one `alter table` branch, no production change,
the file added to the tasks.md Files-edited header and named in the
task's report. Any other shape of breakage still stops and reports.
`reset` sending the alter as part of its bootstrap is intended -- the
delta does not limit the bootstrap to one command, and an unprivileged
role still lands on `apply-ledger-unwritable` at the `bootstrap` site --
and the live witness pins it with one row: after `reset`, the ledger has
the `checksum` column.

<a id="r6"></a>
## R6 — the checksum argument is required; a fake that only lacks the new column changes minimally

_lead · extension · basis R2 · 2026-09-05T17:43Z · ratified: pending_

`recordAppliedMigration(session, filename, origin)` gains a required
checksum argument, for the reason `ledger.ts` already gives for `origin`:
every writer states the value because no default would be correct -- a
row without a checksum is a fact about the past (written before the
column existed), not a claim a new writer may make, and an optional
argument would open a path to silently null rows. The planner's first
count put three test files outside the boundary among the callers; a
read-only listing showed those were mentions in comments and test names,
not calls, so every call site is inside the piece: seeding calls in
`apply-ledger.test.ts` and `apply-reset.test.ts` gain the argument, and
the whole-row `toEqual` assertions in `apply-ledger.test.ts` and
`apply-raise.test.ts` gain the field. Conditional extension, ruled ahead
so the next breakage costs no round trip: the fakes in
`apply-ledger-diagnostics.test.ts`, its `.integration.` twin and
`raise-command.test.ts` imitate the ledger's SQL text by hand; if any of
them breaks only because it does not know the new column (the `select`
list, the `insert` list, the returned row shape), the file changes
minimally to know it -- the same class as R5: production untouched, the
file added to the tasks.md Files-edited header, one line in the task
report saying what changed. Any other shape of breakage stops and
reports. `readLedger` folds a missing or null checksum to `null` (never
the strings "undefined" or "null" the `String(...)` idiom would produce,
which would turn "not compared" into "never matches"); an old row reading
as `checksum: null` is one row of task 1.2's table.

<a id="r7"></a>
## R7 — a raised file is hashed whole, banner or not

_lead · interpretation · basis R2 · 2026-09-05T17:43Z · ratified: pending_

The delta says a raised database records the whole file's checksum,
unconditionally; design.md's "a raised snapshot file has no banner" is
the reason, not a condition. Two implementations differ on exactly one
input -- a file whose first line is the literal `-- hejbro migration`
handed to `raise --file`: routing `raise` through `bodyChecksum` would
hash only the body there and break the sentence. Ruling: `raise` hashes
the whole normalised file (CRLF to LF only, same rule as R2) through a
second export in `ledger.ts` that shares the normalisation with
`bodyChecksum` -- `wholeFileChecksum(text)` -- and never consults the
banner. Task 1.2's input table carries the one row that separates the
two (a banner-first file raised -> whole-file hash) together with the
mutation that must redden it (swap `raise`'s hash to `bodyChecksum`).
design.md's Q1 sentence is repaired in place to state the unconditional
rule.

<a id="r8"></a>
## R8 — a file that fails only because it lacks the new field or argument gains exactly that

_lead · extension · basis R6 · 2026-09-05T18:01Z · ratified: pending_

R5 named one fake, R6 named three files, and each time one more file of
the same kind appeared outside the named list (`apply-reset` ->
`migrate-command`, `status-command` -> `apply-plan`). The class is the
rule, not the list. Ruling: when this piece adds a required field or a
required argument and any file under `packages/cli` fails only because
that field or argument is absent -- an incomplete type literal, an
argument-count mismatch, a fake that does not know the new column -- the
file gains exactly that field or argument; no assertion and no logic
moves, production is untouched, the task report carries one line per file
saying what changed and why, and only a file the tasks.md Files-edited
header does not already cover is added to it. Any other shape of failure
still stops and reports. `packages/cli/test/apply-plan.test.ts` (four
`LedgerRow` literals, TS2322/TS2741) is the first file handled under this
clause.

<a id="r9"></a>
## R9 — apply-migration-body-changed: every changed file, abbreviated checksums, one pure comparison shared by migrate and status

_lead · interpretation · basis R2 · 2026-09-05T18:09Z · ratified: pending_

(a) Message register follows `plan.ts`'s two diagnostics: lower-case
fact, then `Next:`, then the rerun command. Text: `the body of a recorded
migration changed after it was applied: <list>. Nothing was applied: a
migration sent on top of a body that differs from what ran would build on
a history this repository no longer holds. Next: restore the file from
version control, or, if the change was deliberate, write it as a new
migration -- hejbro never rewrites applied history -- then rerun
\`hejbro migrate\`.` Each list item is `"<filename>" (recorded <12 hex>,
on disk <12 hex>)`, items joined by `, ` as `apply-chain-unverifiable`
joins its details. (b) The two checksums are abbreviated to their first
twelve hex digits: they identify "these differ", they never drive the
next action, and two full digests would bury the sentence; the delta
sentence says so, so the spec and the message agree. (c) One run names
every changed file, not the first: the code is one, the list grows; the
delta's singular becomes "each file whose body changed". (d) The
comparison is a pure function in `execute.ts` -- `(rows, bodiesOnDisk)
=> findings`, no filesystem, honouring that module's own "touches no
filesystem" contract; `migrate.ts` reads the files and throws on
findings, `status.ts` (task 1.4) reads the files and prints the same
findings -- the two halves share the one function. `plan.ts` is outside
the piece and stays untouched. (e) Exit code 2: a body change is a ledger
disagreement, the delta's own class. (f) The compared set: ledger rows
with a non-null checksum whose filename is a chain entry present on disk
-- `registered` rows included, `raised` rows structurally excluded (their
filenames are not chain entries, as `plan.ts` already treats them), a
recorded file missing from disk stays `apply-ledger-orphan-row`'s,
null-checksum rows are not compared. (g)
`skills/hejbro/references/generate-verify-workflow.md` gains the
`apply-migration-body-changed` entry in 1.3 and the `apply-ledger-filtered`
entry in 1.6, 1.7 adds the workflow sentence only; the Files-edited
header lists that file under (1.3, 1.6, 1.7). Task 1.3's red is the
five-class table with one mutation per row, row 2 (banner prose edited ->
proceeds) being the row that proves the piece's premise.

<a id="r10"></a>
## R10 — a run with nothing pending compares nothing; status is where a changed body is reported

_lead · interpretation · basis R9 · 2026-09-05T18:36Z · ratified: pending_

The delta says "before applying anything pending, `migrate` SHALL
hash...", and the wiring sits after the nothing-pending exit, so a run
with nothing to apply compares nothing and exits 0. Ruling: that stays.
The rule exists to keep hejbro from applying a migration on top of a body
that differs from what ran; with nothing pending there is nothing to
build on the changed history, and the moment a pending migration appears
the same run refuses -- so an edited applied body is never silently built
upon, only silently left alone for the run that had no work. Comparing on
an idle run would either exit 2 against `migrate`'s own code contract
(0 = nothing pending or all applied) or print a warning `migrate` has no
register for; the delta already names `status` as the command that
reports a changed body without acting. The delta gains one scenario so
the constructor-mode reviewer can answer the input from the spec.

<a id="r11"></a>
## R11 — status compares bodies on a run with no disagreement; a disagreement is reported alone, as today

_lead · interpretation · basis R9 · 2026-09-05T18:51Z · ratified: pending_

`runStatus` already short-circuits: a plan with a disagreement renders
the disagreement and nothing else -- not the applied set, not the pending
set -- and that shape predates this piece. The delta's `status` sentence
lists four things in one breath, but "together" was never true of the
first three, so reading it as a mandate to print bodies beside
disagreements would change a contract this piece did not open. Ruling:
option A -- on a run whose plan has no disagreement, `status` reads the
chain files, calls the shared `changedBodies`, reports one finding per
changed body after its existing sections, and exits 1; a run with a
disagreement keeps today's behaviour. The delta gains one scenario so the
reviewer can answer the mixed input from the spec.

The line is a diagnostic, not a stdout line: `status` renders one
`hejbroError` per changed file through
`renderDiagnostics([fromHejbroError(error, identity)])`, the path
`renderPlanFailure` already uses -- identity is the filename, code is
`apply-migration-body-changed`, message is `body changed after it was
applied (recorded <12 hex>, on disk <12 hex>). Next: restore the file
from version control, or, if the change was deliberate, write it as a new
migration -- hejbro never rewrites applied history -- before rerunning
\`hejbro migrate\`.` The same code thus carries two messages, `migrate`'s
one-list form and `status`'s per-file form, the precedent `ledger.ts`
records for `raise-not-empty` (one fact, two discovery paths). The
`hejbroError` call is an inline literal in `status.ts` so
`check:next-marker` resolves it in the same file.

