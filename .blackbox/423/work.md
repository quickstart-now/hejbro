# Work — quickstart-now/hejbro#423

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — add-body-statements — ctx.execute, the unused-builder guard, and returns accepting a builder (#426 #423 #433)

_2026-08-29T00:00Z_

Team piece (planner, researcher, implementer, reviewer; lead relayed the
owner), worktree `plpgsql-bodies` off dev `34be0bd`. Three defects in one
capability area: a body could not execute a statement for its effect
(#426), a builder it made and never used vanished with no diagnostic
(#423), and `returns` demanded a type node while `args` took a column
builder (#433).

### What the lead decided, and on what evidence

**The bundling.** One change, two groups: the body surface (#426 + #423 +
the `ctx.if` widening) and the declaration's `returns` surface (#433).
The researcher recommended splitting #433 out — zero file overlap, no
blocking dependency. The planner argued the opposite and the lead agreed:
zero file overlap is not a reason to split, it is the definition of a
parallel-safe group under D88. #423 and #426, by contrast, edit the same
function in the same file and depend on each other in both directions —
a guard without the vocabulary rejects code while naming no correct form
to write instead, and the vocabulary without the guard adds a second way
to build a statement and drop it.

**The lead's pre-hypothesis, half refuted.** The lead's prior was that
`ctx.execute` would absorb every legitimate use of an unreturned builder,
making "built and not returned" a clean error. Measurement said otherwise:
`exists`, `notExists`, `jsonArrayFrom`, `jsonObjectFrom`, the set-op
combinators, `ctx.row`/`rowOrNull`/`forEach`, `defineView`, and every
intermediate stage of every chain all take a builder that never reaches
`ctx.return`. The hypothesis survives at the semantic level — every
builder must reach *a consumer* — and fails at the mechanical level: the
contract is "created and not **consumed**", which needs consumer tracking
and does not get cheaper because `ctx.execute` exists. The ordering
(#426 before #423) survived for a different reason than the one it was
proposed for: the guard's `Next:` clause needed something to point at.

**The boundary exception.** `packages/core/src/query/{select,mutate}.ts`
were another team's slice. The guard needs to observe builder creation,
and builders are plain object literals produced by free functions in
exactly those two files — there is no other place to see them. Two
workarounds were examined and rejected with evidence: a barrel wrapper
around the four entry factories cannot see chain stages (they are created
inside `select.ts` and never pass the barrel), and a `ctx.select(...)`
family does not fix the bug #423 reported, since a user importing
`insert` from `hejbro` still loses the statement silently. The lead
granted an exception for wiring calls only.

**Explicit registration over reachability.** The remaining design
question was whether consumption could be inferred by walking the
recorded tree at `finish()` instead of instrumenting consumers. Measured
and rejected: 19 spread-copy sites across the two files with no
return-the-same-reference shortcut anywhere, so a chain's parent node is
never the node in the tree; `buildExists` rewrites its subquery's
projection, so the node in the tree is not the node that was registered;
`defineView` never enters the body's tree at all; and the json aggregates
keep the reference *or copy it depending on the selected column's type*,
which would make the same body pass or fail according to what it selects.
Every one of those failures is a false positive — working declarations
refused — which is the class of failure this project treats as
disqualifying.

**Three owner-delegated calls the planner made and the lead ratified.**
`returns` refusing a builder that carries `notNullElements()` (a column's
element-narrowing is backed by the check constraint `table()` derives; a
`returns` clause derives nothing, so honoring it would promise what
nothing enforces); `FnResult` resolving a builder-declared return through
`ColumnReadType` rather than `ScalarReturnTsType` (the latter takes a
`TypeNode`, which structurally cannot carry `jsonType` or `enumValues`,
so a `$type`-branded return would be `Payload` as an argument and
`unknown` as a return — the exact asymmetry #433 exists to remove,
reappearing one level down); and refusing a builder that was constructed
ahead of a choice and then not chosen (a discarded builder produces no
SQL, so Postgres has nothing to judge — this is an authoring rule, not a
place where hejbro becomes stricter than the database).

### What went wrong on the way

**The planner's site table was wrong three times.** The inventory of
`query/*` wiring sites — the very document the exception was scoped by —
missed the five transition functions in `mutate.ts`
(`makeInsertReturnable`, `makeUpdateReturnable`, `makeUpdateFilterable`,
`makeDeleteReturnable`, `makeDeleteFilterable`), listed three leaves
(`makeInsertFinal`, `makeUpdateFinal`, `makeDeleteFinal`) that have no
transitions and needed no edit at all, and classified `makeSetOpStage` as
an entry site when its own `orderBy`/`limit` make it a stage maker. Each
error had the same cause: the planner inferred the call hierarchy from
function names instead of reading the code. Left in, the first would have
made `update(t).set(v).where(c)` and `deleteFrom(t).where(c)` — the two
most common mutation chains — fail as unused builders; the third would
have done the same to `a.union(b).orderBy(...)`. All three were caught by
the implementer reading the code before touching it, and the rule that
came out of it is in `tasks.md`: the test is the transitions, never the
name.

**A false alarm on `perform`.** The planner read the plpgsql manual's
"replace the initial keyword SELECT with PERFORM" and raised an urgent
concern that the renderer might be emitting `perform select …`, which
Postgres would reject. It was not — the renderer already emitted the
documented form. The concern was raised without first reading the
rendered string. The check was cheap and produced something worth having
anyway: a live `postgres:17` probe that created the function *and called
it*, because plpgsql defers some body checks to the first call, which is
the same trap `scalar-return-missing` exists to close.

**A group verdict refused once.** The first "group 1 complete" report was
missing task 1.10 — the trigger-body-returns-a-query defect the lead had
approved absorbing, which already had a requirement in the spec. The
verdict was refused. Implementing it surfaced a real regression: checking
`returnKind === "trigger"` before checking the value's shape made a
`RowColumns` object (neither a query nor a trigger row) report as a
returned query, breaking the existing `unsupported-return-value` path.
The order was inverted — shape first, then declaration kind.

**A diagnostic hidden behind an exemption.** `ctx.execute`'s
unreachable-argument branch first reused the existing `"unreachable"`
code. That code is in `check-next-marker`'s `EXEMPT_CODES`, so the branch
would have skipped the `Next:` requirement without anyone adding
anything to an allowlist — the #461 blind spot reached by reuse rather
than by edit. The neighbouring `recordReturn` path already answered this:
it raises a real user-facing `unsupported-return-value`. Replaced with
`execute-expects-statement`, and a `@ts-expect-error` test pins that the
branch is reachable when the types are bypassed.

### Surface delta

**Added: one symbol.** `ctx.execute(<statement builder>)` — `BodyContext`
goes 6 → 7. No existing primitive expressed it: a body could select,
branch, raise, loop and return, and a mutation reached the tree only as
the *returned* query, which ends the function — so "write an audit row,
then return NEW" was not expressible at all. The name is a verb, like
every sibling.

**Not split into two verbs.** Postgres spells the same act two ways
(`perform` for a select, plain for a mutation). That is a rendering
detail decided by the statement's kind, not a distinction a user should
have to learn — splitting it into `ctx.perform`/`ctx.execute` would make
every user classify their own statement, and add a diagnostic for
choosing wrong. One verb; the renderer picks the spelling.

**Widened: two existing parameters, no new symbols.** `ctx.if`/`elseIf`
now take the `Condition` union the query side already took (#386's
deferred one-liner). `defineFunction`'s `returns` now takes a column
builder, as `args` already did (the same asymmetry the owner fixed once
for this function's schema argument in #269). Both remove an asymmetry
rather than adding a surface.

**New top-level exports: zero.** `packages/cli/test/exports.test.ts` is
untouched, which is the mechanical proof.

**New diagnostics: five.** `execute-expects-no-returning`,
`execute-expects-statement`, `trigger-return-expects-row`,
`statement-builder-unused`, `returns-not-null-elements-unsupported`. All
five follow the existing `scalar-return-*` naming shape, are raised
through the `throwHejbroError` factory with `declaredAt`, and end in a
`Next:` clause that names a form that actually works.

**Deliberately not added.** The second verb, above. An `INTO` target
invented for a returning mutation — the declaration never asked for that
variable, and inventing one violates the explicit-SQL rule. A
`perform`-style call of a declared function: that is an expression, and
admitting it means designing how one declaration references another's
callable. Set operations admitted into `ctx.execute` — the honest answer
is that no body statement carries one, and the diagnostic says so rather
than a new surface being invented to make the sentence true. A shared
`isColumnBuilder` predicate — kept local to `dsl/define-function.ts`,
because only this change needs it.

### Verification beyond the gates

The gates answer "did our own checks pass". They do not answer "does the
generated SQL run", and this piece emits SQL shapes the repository had
never emitted. So, on `postgres:17` in Docker: the `perform` render was
created *and called*; the `audit-posts` golden's full SQL was applied and
exercised with insert/update until the audit row appeared;
`scripts/roundtrip.sh` reported `round-trip OK: 185 dump lines
identical`; and the new `examples/postgres` step 9 trigger was run
against real data, with the expected `task_status_audit` row written.

Migrated from the single-file entry `.blackbox/2026-08-29-add-body-statements.md`, kept verbatim at `.blackbox/423/artifacts/2026-08-29-add-body-statements.md`.

