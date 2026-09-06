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
