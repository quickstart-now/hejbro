# Work — quickstart-now/hejbro#671

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — adoption creates the table's declared children, normalizes the adopted sequence, and generate names both

_2026-09-06T02:48Z_

Five tasks, five content commits: 7691529d (core: adoption creates the
table's declared children), 5472127b (core: the adopted sequence is
created idempotently and normalized), bcd7f739 (cli: generate names what
an adoption will create), be925dec (live witnesses), 742bb3b0 (the
brownfield reference, the extension-interface field, one minor
changeset).

Mechanism: `KindChange.transition?: "adopted"` (optional, public), which
`engine/diff-engine.ts` stamps once after every kind's own `diff`
returns -- the engine is the field's one writer, no kind sets it.
`kinds/table-kind.ts`'s guard narrowed from "either side existing" to
"either side existing, adoption excepted"; `kinds/table-kind-emit.ts`'s
`isAdoption` suppresses the three column statements while the children
still render; `kinds/sequence-kind.ts` reads the same field to choose
`create sequence if not exists` plus the two alters over a plain create.
`commands/generate.ts` reads the field off the migrations it already
computed and renders one `warning[adoption-creates]` block per adopted
table, before the core warnings, counted in the summary line.

Measured, mutations (each reverted, none committed). Task 1.1: removing
the stamp reddens four cells, all of them ones where a primary key makes
the column diff non-empty; removing the guard entirely reddens eight
handover-shaped cells; suppressing the children reddens exactly the
seven adoption cells. A `toContain` assertion missed a column leak that
the full-text `toBe` caught. Task 1.2: ignoring the transition reddens
the five adoption cells and nothing else; treating every create as
adopted reddens the new-table cases and the sequence-lifecycle goldens
instead -- the two sets are disjoint. Task 1.3: five mutations, of which
two red exactly one cell each (block order, identity sort).

Measured, live on postgres:17-alpine. A managed table whose only managed
object is a sequence round-trips through a handover and back and applies
cleanly; a table created by hand with psql adopts with its index, check,
foreign key and primary key, all four present in the catalog afterwards;
`hejbro check` reports no differences in both.

Found and referred out rather than fixed here: #1009 (a handover leaves
the table's children in the database, and the children's own creates
carry no idempotence guard -- two separate axes, the second measured
against policy's own long-standing `drop ... if exists` plus `create`
pattern), #1001 (banner notes describe column diffs that emit no
statements), #993 and #994 (the two diagnostic gates do not cover what
their names suggest).

<a id="w2"></a>
## W2 — review rounds one to three: the missing-column risk, the withdrawn refusal, and the four-branch measurement

_2026-09-06T05:59Z_

After W1 the piece went through three constructor-mode review rounds and
two reworks.

Round 1 found two blocking facts. B1: adoption emitted a child against a
column the database does not have, so `migrate` failed with 42703 and
the whole migration, primary key included, rolled back -- a failure
shape this piece introduced, which the review's A/B against fd92e4bb
settled by measurement (the base wrote an empty migration instead). The
input tables had never built the crossing cell: the column-list cases
carried no children, and the child cases held the columns identical on
both sides. B2: "one diagnostic per adopted table" was falsified by an
adoption with nothing to name.

The lead first ruled a generate-time refusal keyed on the existing
declaration's columns. The review then measured that a column absent
from the database and a column merely left off `existingTable()`'s list
are identical to a declaration-only comparison -- same declarations,
same snapshots, same emitted SQL -- and that an existing declaration is
a partial claim by design, so the refusal would have turned a common,
working shape into an error. That ruling was withdrawn. The risk is
named instead, and `hejbro check --url` is the command that tells the
two apart; it already could, and the review ran it before `migrate` to
show it names the column.

Round 2 passed with two notices. The second branch of the notice's
`Next:` was a correct recipe for writing the adoption edit but
incomplete as recovery, because the diagnostic prints after the
migration is already written. The changeset had not been updated for the
round.

Closing those raised one more measurement. The reference claimed that
reverting either file alone breaks the chain; reverting the migration
alone was measured not to, because a migration that failed at apply was
never recorded in the ledger, so removing its file leaves the ledger
consistent. The sentence was rewritten to what reproduced: reverting
only the migration leaves the snapshot still recording the adoption, so
the next `generate` reports no changes; reverting only the snapshot is
refused by `verify` with `snapshot-stale` and `chain-tip-mismatch`,
while `migrate` never reads the snapshot's content at all.

Round 3 passed and settled the disagreement by building four branches
from one starting state. Reverting both files and re-adopting succeeds.
Reverting the migration with the declaration unchanged reports no
changes. Reverting the snapshot alone is refused by `verify`. Reverting
the migration after the declaration has already changed writes a
diverging migration and is then refused by `migrate` and `verify` with
`broken-chain`. The reviewer's round-one report had generalised that
last branch into "reverting either one", and corrected its own sentence
against the measurement; the branch is now named in the reference.

Measured across the rounds: the notice's text is pinned in full for
every adoption cell; the live suite grew from two witnesses to six
(sequence-only round trip, brownfield adoption with four children, a
column present but unlisted, adopt-then-add-in-a-following-edit,
`check --url` naming the column before 42703, and the recovery path);
no golden changed at any point.

Not fixed here, referred out: #1009, #1001, #1015, #993, #994.


Addendum (lead, in place under 412/R34): the reference paragraph on the half-followed way out went through four commits after the review passed — twice it carried claims nobody had measured (that restoring the snapshot alone resolves `broken-chain`; that the divergent migration forks from the same prior state) and once a quotation that rested on a reading of the diagnostic text; the reviewer measured each with an offline `verify` and the final text (`f7134ea9`) states only what was measured. One of those commits was contract text committed before planner approval, against the piece rule.
<a id="w3"></a>
## W3 — D106 round 1 corrections: B1 (671/R9) and B2 (671/R10) fixed

_2026-09-07T16:15Z · per R9, R10_

D106 round 1 corrections (harden-adoption group 2, PR pending): B1 (671/R9) and B2 (671/R10) fixed, plus three review-round-1 findings on 2.1 (F1, F3, F5-2).

**671/R9 (B1) implementation.** `table-kind.ts`'s `adoptionCreatesPrimaryKey` now overrides `isEmptyTableFieldDiffs` whenever an existing→managed transition's own `next` declares a primary key, regardless of what the existing side's column already carried — the root cause was that `existingTable()` structurally zeroes `indexes`/`foreignKeys`/`checks` but a primary key's membership lives on the column builder flag (`columnState.primaryKey`), which `existingTable()` never zeroes, so `columnDiff` saw no difference when both sides listed the same key. `table-kind-emit.ts`'s `planPrimaryKeyChange` gained an `isAdoption` early return mirroring the column-touch guards already there, so the create fires unconditionally on `next` alone and never drops. Live witness: a self-built replay of the review's `p2-children` `posts` shape (existing PK/two indexes/a check/two FKs onto `ext.accounts`+`app.users`) on `postgres:17-alpine` — `migrate` now applies (previously `42830`), the catalog carries `posts_pkey` plus every other child, and `check` reports exactly one line (R6's own column-default line, N1, by design) and zero lines for the index/check/FK/PK set.

**671/R10 (B2) branch confirmation basis**, measured by the researcher on dev `dbd74fbc`/`408e9996` (`/private/tmp/har1-research/logs/`, `REPRO-mid-chain-baseline.md` plus the labeled run logs), independently reconfirmed against this PR's own 2.1+2.2 build:

(A) A mid-chain migration carrying the `-- baseline:` marker, inserted by hand, *is* registered rather than run: `s4-migrate-nomarker` (no marker, `42P07`, exit 1) vs. `s5-migrate-marker` (`migrate: registered 1 baseline migration(s) (statements not executed)`, exit 0); `a1`-`a4` confirm the edit is inert otherwise — `verify` passes before and after (same snapshot hash), `status` still reports the file pending until `migrate` registers it, and `check --url` reports no differences afterward. This is `migration-apply`'s own *A baseline is registered rather than run* working exactly as specified — the registration mechanism is not the gap.

(B) No command writes that marker outside `hejbro baseline`: `generate.ts`'s `baseline: mode === "baseline"` is the only code path that sets it, `mode` is `"baseline"` only for the `baseline` command; `--help` on the root, `generate`, `baseline` and `migrate` commands lists no flag for it; `migration-format`'s own requirement text scopes the marker "on a baseline migration only". Combined with `error[baseline-not-first]` refusing the moment `migrations/` is non-empty (`s3-baseline-refusal`, matching this PR's own live witness), an adoption's own prior snapshot guarantees `migrations/` is never empty at the point `adoption-creates` prints — so `hejbro baseline` can never be the promised way through, on any build, not just this one's.

(C) With no mid-chain registration path, both ways in branch (b) were measured on the same `p3b`-shaped state (managed → handed over → re-adopted):
  - Revert: reverting only the migration and the snapshot (`b3i`) leaves the declaration still managed and `verify` refuses `error[snapshot-stale]`; reverting all three — migration, snapshot, declaration (`b3ii`) — leaves `verify`/`status`/`generate` clean. Reverting *only* the migration file with the declaration already back at the handover state (`r1`) is a distinct half-revert this PR's own reference text now calls out: `verify` refuses `error[chain-tip-mismatch]` (not `snapshot-stale`), because the surviving migration's own recorded tip no longer matches; reverting only the snapshot (`r2`) is `error[snapshot-stale]`.
  - Drop: pre-671/R9 (`e1`-`e3`, `d0`-`d4`), dropping the index and the check alone was sufficient (no primary key was ever created to collide) — `d3` additionally measured that dropping the sequence too leaves `check-object-differs: app.orders.id` (N1, the `nextval` default never re-attaches) with no `generate` able to self-heal. Post-671/R9 (`f1`-`f6`, this PR's own build), the same recipe no longer applies as-is: `f1` (nothing dropped) still fails `42P07`; `f2` (index and check dropped, primary key left) now fails `42P16: multiple primary keys for table "orders" are not allowed` instead, because 671/R9 makes the migration attempt the primary key create too, sorted ahead of the index/check statements; `f3` (the primary key dropped as well) applies cleanly, `f4`-`f6` confirm `status`/`check`/`verify` all clean afterward. Two further risks apply only to the primary-key member of the drop set (not index/check/FK): dropping a primary key another table's foreign key still references is refused by Postgres (`cannot drop constraint … because other objects depend on it`), and a row inserted between the drop and the apply can make the primary key's re-creation fail on a duplicate.

Ruling: branch (b) — the `Next:` line names the two ways above, never `hejbro baseline`; a mid-chain "register what the database already holds" path does not exist and is filed as a follow-up under #995 (issue #1037).

**Review round 1 on 2.1 (owner-ratified via the lead, not originally scoped):**
- F1: the narrowed silent cell (an existing→managed adoption with zero declared children, no primary key on either side) lost its only test the moment the pre-existing test sharing its shape was rewritten to assert 671/R9's own create. Re-pinned at both layers (`generate.test.ts`, `generate-command.test.ts`), plus a CLI-surface control for a primary-key-only adoption naming the key.
- F3: the migration banner's own notes builder (`tableFieldDiffNotes`) never named a primary-key-only adoption's create — `-- ~ table …`, instead of no note list at all, beside a file carrying `add constraint … primary key`. First fixed condition-scoped to the one shape none of the four keyed diffs can surface on their own (adoption, nothing else to note); review round 1 NB-3 (lead ruling) widened it to name the primary key on every adoption that creates one, `isAdoption` its only guard, since the banner states what the file does and the file always carries the statement — an adopted table with another child now names both (e.g. `column "…" changed, primary key "…" added`). `isAdoption` alone still keeps a managed→managed primary key move (already a `column "…" changed` note) and a new table's inline primary key from gaining a second note — verified against the full core/cli/examples suites, not just the new cases.
- F5-2: an 18-line derivation comment on `adoptionCreatesPrimaryKey` trimmed to its one trap sentence (AGENTS.md: comments state the constraint only).

Not fixed here, referred out: mid-chain registration (#1037, under #995); F4, a `<t>_pkey` name-collision `check` wording gap (#1042, reviewer's own `app.c13` repro).

<a id="w4"></a>
## W4 — W3 correction: the f1-f6 drop-order claim measured a hand-edited pre-671/R9 file, not the real build

_2026-09-08T13:43Z_

Final review correction to W3's own drop-path measurement (append-only: W3's text above is left as it was written, not edited).

**W3's `f1`-`f6` claim was wrong about which build produced it.** W3 framed `f1`-`f6` as "post-671/R9, this PR's own build" and read `f1`'s `42P07` (nothing dropped) as evidence that the real fix still fails on the index first. Checked against the actual files: `p3bc/migrations/20260907144403_add_orders_id_seq.sql` (the file `f1`/`f2`/`f3` all replay against, in a rollback loop — the researcher's own `run3.sh` never regenerates it between labels) carries `create sequence if not exists …`, `alter sequence … as integer`, `alter sequence … owned by …`, `create index "orders_total_idx" …`, `alter table … add constraint "orders_total_nonneg" check (…)`, then a sixth statement, `alter table … add constraint "orders_pkey" primary key ("id")`, appended at the *tail*. That file's own banner — `~ table app.orders [index "orders_total_idx" added, check "orders_total_nonneg" added]` — names no primary key at all, matching the pre-671/R9 CLI's real output (671/R9 did not exist yet: `REPRO-mid-chain-baseline.md`'s own header names the measurement SHA as `dbd74fbc`/`408e9996`, before `679920e6`). So the sixth statement was hand-appended to explore what an eventual PK-creating fix would still need dropped, at the tail — not the position 671/R9 actually gives it.

Corrected reading: `f1` (nothing dropped) fails `42P07` first only because the *hand-appended* statement sorts after the index in that specific file; `f2` (index and check dropped) then reaches the appended statement and fails `42P16`; `f3` (also dropped) applies. None of the three measures 671/R9's own real statement order.

671/R9's real, unedited build sorts the opposite way: `table-kind-emit.ts`'s `emitAlter` places `planPrimaryKeyChange`'s `addStatement` before `indexesToAdd`/`checksToAdd`. This PR's own live-witness test, `adoption-handover.integration.test.ts`'s `"brownfield adoption / live witness -- the Next: line's second way, dropping what a held copy would collide on (671/task 2.2, B2 drop path)"` (`"migrate fails 42P16 with the primary key left in place, and applies cleanly once the index, the check and the primary key are dropped -- the sequence untouched"`), measures this directly against a real, unedited build: a single "nothing dropped" `migrate` attempt fails `42P16` immediately and never reaches `42P07` at all, because the primary key's own `add constraint` is the first colliding statement in the file. Dropping the index and the check alone (without the primary key) was never tried as an intermediate step in that test, since it would not change the outcome — the primary key statement fails before the parser ever reaches the index or the check statements.

Basis: `/private/tmp/har1-research/logs/f1-migrate-nodrop.err`, `f2-migrate-idxcheck.err`, `f3-migrate-alldrop.out`, `p3bc/migrations/20260907144403_add_orders_id_seq.sql` (read directly, not summarized from a script); `packages/cli/test/adoption-handover.integration.test.ts` (this PR).

