# Design: harden-query-surface

Decisions taken during this change that outlive it. Each records who
decided, on what evidence, and what was rejected.

## The order-guard fork — a runtime guard over a documented boundary

**Decided 2026-08-30 by the lead session, under the owner's standing
delegation; to be surfaced to the owner on return.**

### What was found

`SameKeys` (`packages/core/src/query/select.ts`) is built on `keyof`,
and `keyof` carries no order. Postgres matches set-operation branches
**by position**. So the fix for #487 — which makes mismatched *key sets*
fail to type-check — leaves branches whose key sets match but whose
**order** differs still compiling.

Measured on `postgres:17` during review, with a positive control:

```
 email       |   city
-------------+-----------
 alice@x.com | Seoul        <- left branch, correct
 Busan       | bob@y.com    <- right branch, email holds a city
```

Control — when the types also diverge, the server catches it itself:

```
ERROR:  UNION types uuid and text cannot be matched
```

So the server is loud exactly when the types disagree, and **silent when
they agree and only the order differs** — which is the common case, two
same-shaped tables combined.

### The decision

Add a build-time guard (group 8) rather than record the gap and move on.

### Why not "document the residue and file an issue"

That is this slice's normal answer for a boundary, and it was the
planner's recommendation. It was rejected for one reason, which is worth
keeping because it draws a line for future boundaries:

The residue this slice leaves elsewhere — #464, #487's key-set half,
#489's nullability gap — is residue **because a type cannot express the
rule**. This one is different: TypeScript cannot compare key order, but
a *runtime* comparison can, cheaply and purely. The honest spec sentence
for (a) would therefore have read "we could fix this, we chose not to".
Shipping that sentence about a **silent data-corruption** class is not a
boundary; it is a decision to leave corruption in place. A gap the type
system cannot see is a boundary. A gap we can close and don't is a
defect.

### Why the cost was acceptable

The guard is a pure function over two projection objects — no I/O, so
core purity holds. It has **two** consumers, not one: `combineSetOp`
(`packages/core/src/query/select.ts:245`) and
`packages/query/src/db/chain.ts:280`, where the chain surface builds its
own `setOp` node instead of routing through core. Guarding only core
would have left the primary user-facing surface corrupting data. That
second site is why the first cost estimate ("one task") was wrong.

### What this corrects in this change's own proposal (order guard)

The proposal stated that `packages/query` "re-exports and does not
redeclare these names — to be confirmed by the first task that touches
each, not assumed". The qualifier was right and the claim was wrong:
`chain.ts` does build its own set-operation node. The sentence is
corrected in `proposal.md`, and it stands as a case of an unverified
convenience claim surviving into a plan document.

## Surface delta

Six parts, in this order. The structure is stated here rather than
assumed, because it is otherwise carried in the lead session and a
reader of this archived file has no way to recover it: **(1)** additions
and removals with their justification, **(2)** parameter widenings that
remove an asymmetry, **(3)** the machine checks that hold this
description true, **(4)** diagnostic naming, **(5)** a one-line verdict,
**(6)** what was deliberately not added.

### 1. Added and removed, each justified

Justification runs on two axes: **why a user could not compose it** from
what already exists, and **how the name sits against its siblings**.

| | |
|---|---|
| `IndexColumnOrigin` (type) | Not composable — an index column's declaring table is dropped by `toDeclarationColumn` before any check sees it, so nothing downstream could reconstruct it. Named after what it holds, matching `IndexColumn*`. |
| `OrderedTerm`, `NullsPlacement` (types) | Not composable — ordering had three spellings across two layers and `expr/` may not import `dsl/`, so no user-side type could unify them. Promoted downward so both media consume one shape. |
| `assertSameSetOpKeyOrder` (function) | **Public for an internal reason, and that is the justification**: `@hejbro/core` and `@hejbro/query` both construct set-operation nodes and must share one implementation. It is not user-facing vocabulary. |
| **removed:** `countWhere` | A pure duplicate of `count(expr)` under an invented name — `aggregate.ts`'s own rule is that the five aggregates carry Postgres's names verbatim, and this was the only invention. Absent from `@hejbro/core@0.1.1`, so nothing released moves. |

### 2. Parameter widenings — asymmetries removed

- `count()` → `count(operand?)`. Two names for one operation collapse to
  one; the argument form is SQL's own spelling.
- `OrderTermInput` accepts `asc()`/`desc()` with `nulls`. Three
  vocabularies (declaration, query, window) become one — the barrel
  already exported `asc`/`desc`, and `orderBy` simply refused them.

### 3. Machine checks holding this description true

- **A negative export assertion for the removal**, plus its own control:
  `type _Removed = typeof import("…/src/index").countWhere` under
  `@ts-expect-error` fails if `countWhere` ever returns, and an
  undirected `_PathControl` line beside it fails loudly if the import
  path rots — because `@ts-expect-error` swallows `TS2307` as readily as
  the error it was written for.
- **This is not an exact-set pin, and the difference matters.** The
  barrel's export list is *not* asserted as a whole anywhere: the tests
  check named exports individually (`packages/cli/test/exports.test.ts`)
  and check that this one name is gone. So a **removal** is caught and
  an **unintended addition is not**. Stated because the draft of this
  section claimed an exact-set assertion that does not exist — the claim
  was written from what such a section ought to contain rather than from
  the repository, which is the exact failure this change spent its
  length correcting elsewhere.
- **Type-only import block** — `tsc` carries the type axis, so the
  narrowings below are checked rather than described.
- **0.1.1-era snapshot decode test** — `OrderByTerm` is a released
  serialized shape, so the additive-compact claim is executed.
- Per-site mutations proved each of the three set-op construction sites
  is guarded individually, rather than one test appearing to cover all.

### 4. Diagnostic naming

Two codes, one family, and the split is semantic rather than cosmetic:
`set-op-key-set-mismatch` (different keys, including a missing one) and
`set-op-key-order-mismatch` (same keys, wrong order). **Discrimination
order is load-bearing** — sets are compared first, so the order code is
only ever raised where reordering actually helps. Reversed, the code
would stop pointing at its own remedy. `foreign-column-ref` is reused,
not added: #464's case joins a family that already had three members.

### 5. Verdict

Five defects closed; three types and one function added, one function
removed for a net reduction in vocabulary; two new diagnostics whose
discrimination order is itself machine-enforced; one consumption site
touched outside `@hejbro/core`.

### 6. Deliberately not added

- A real `FILTER (WHERE …)` aggregate — **#501**. A rename must not
  carry a new capability in behind it.
- Cross-family set-operation rejection — **#503**. The server refuses
  these loudly, so it is a late failure worth moving earlier rather than
  silent corruption; and adding it would leave #489's own case (within
  one family) still uncaught while looking like #489 had been handled.
- A decode-path guard — stated as a boundary, with both input surfaces
  named.
- A directional same-family type rule — **#489's residue, #500**. Every
  numeric SQL type shares one family, so the family system cannot
  express the direction at all.
- The `.$type<T>()` brand axis — out of scope and recorded as such;
  since no rule tightened, it is not a defect today.

### Appendix (not part of the six)

**New compile-time refusals**: mismatched key sets in core's `union()`
family; branch column-order mismatch at all three construction sites;
an index column belonging to another table, including the same-named
case. No new refusal on recursive-term types — that outcome was "not
expressible", not "not attempted".

**Snapshot format**: `OrderByTerm.nulls` is additive-compact and
`formatVersion` stays 8.

## Task durations: none recorded, and why

**Decided 2026-08-30 by the lead session, under the owner's standing
delegation; to be surfaced to the owner on return.**

`openspec/task-times.csv` gains **no rows from this change**.

Collected: none. The reason is a process failure, not a property of the
work: per-task actuals were never reported at completion time, and the
planner never asked for them until the release-hygiene task came due.
Two substitutes existed and both were rejected:

- **The `(~Xm)` figures in `tasks.md` are pre-task estimates**, written
  before each task began. Copying an estimate into an actuals column
  makes the column mean two different things.
- **Git timestamps measure wall-clock**, which here includes review
  round-trips and waiting on messages — not the "pure work minutes"
  the ledger is defined in.

The ledger's only value is that rows are comparable to one another. A
labelled-but-incomparable row damages that more than an absent one
does, so an absent row — neutral to any ratio computed from the file —
is the honest gap. This is also the standing rule for retroactive
entry: a duration may be back-filled only if someone can defend that
task's pure work minutes now, and here nobody can, for any task.

The obvious fix — "the implementer reports the figure, the planner
records it" — was prescribed and then **tested and found not to work**,
which is the more useful finding. Asked for the numbers going forward,
the implementer reported being unable to produce any: there is no
persistent clock readable across their own tool calls, so a "~Xm"
figure would be invented, not observed. The planner has no shell at
all. The only role with clock access is the reviewer, who does not do
the work being timed.

So in this team's shape, **pure work minutes are not observable by the
role that performs the work**, and the ledger's unit assumes a measurer
that does not exist here. What *is* observable, and was offered
instead, is a round count — 7.1 took two passes (four deltas, plus one
scenario-title correction the validator caught), the 6.3 repair took
one. That is a different quantity and is deliberately not written into
a minutes column.

**And that conclusion was itself half wrong** — corrected the same day,
which is why it is written out rather than replaced. There is no
*introspective* elapsed-time sense, so a remembered "~Xm" is indeed
fabrication and refusing to supply one was right. But the implementer
has a shell: `date -u` at a task's start and end is an **instrument**,
and a pair of stamps is an observation, not a recollection. Wall-clock
between task boundaries is an honest approximation of work minutes in
this setting precisely because the waiting sits *between* tasks rather
than inside them; where an inbox interruption does land mid-task, that
is noted alongside. The reviewer had been doing exactly this for gate
windows all along.

So the defect was never a missing instrument. It was a prescription
that asked for recall and called it measurement. From this point the
remaining tasks carry boundary stamps, and their ledger rows are marked
`clock-stamped` to distinguish them from recall-based rows in earlier
slices — that distinction being, itself, a record of the ledger's
quality over time. The groups already finished keep the empty-row
decision above: their stamps were never taken and cannot be invented
now.

**Two visible clocks are not substitutes, and are named here so the
back-fill is not attempted later.** Commit timestamps are readable for
every handed-off SHA (`git log --format='%h %ad %s' --date=iso-strict`),
and the reviewer's gate windows are recorded in UTC throughout. Neither
measures the quantity the ledger holds. Commit-to-commit elapsed time is
an **upper bound** containing waiting, review round-trips and idle
stretches; a gate window measures **the reviewer running gates**, not
the implementer doing the work. Both are more precise-looking than an
estimate and no closer to work minutes, which makes them the more
tempting error: someone who can see a timestamp will reasonably think
the number was there all along.
