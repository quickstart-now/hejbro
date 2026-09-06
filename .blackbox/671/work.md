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

