# Proposal: allow-sql-conditions

## Why

`query-builder`'s existing requirement "Condition expressions reuse the
declaration vocabulary" already states the contract: *"so an expression
valid in a declaration is valid in a query."* A `sql` fragment is valid
in every declaration-side condition — `check()` (D50), partial-index
`.where()` (D51), RLS policy `using`/`withCheck` (#113) — and is
rejected in every query-side condition. The implementation never
delivered the requirement's own sentence (#386).

The mechanism is one line of type, repeated: declaration conditions take
`Expr<"boolean"> | Expr<"unknown">`, query conditions take
`Expr<"boolean">`, and `` sql`…` `` produces `Expr<"unknown">` because a
template's family cannot be narrowed at compile time. Repo-wide usage of
`.where(sql`…`)` is zero — nothing had exercised the gap.

The consequence is not cosmetic. D93 makes the escape hatch the sanctioned
answer for everything the typed builder cannot express, which is a large
set today (no aggregates, no `distinct`, no arbitrary function calls or
operators). With conditions closed, a predicate the operators cannot
express — `lower(email) = $1`, a regex match, a function call — has no
path into a query at all, and D93's safety valve does not hold.

## What Changes

- **Query-side condition positions accept the declaration-side union.**
  `Expr<"boolean"> | Expr<"unknown">` — the exact union D50/D51/#113
  already adopted three times — replaces the bare `Expr<"boolean">` on
  select `where`, `innerJoin`/`leftJoin` `on`, update `where`, delete
  `where`, and the `related()` chain's `where`, in the core builder and
  the query chain alike.
- **One named type, reused.** The union gets a single exported name
  (`Condition`) in core's expression module, replacing the inline
  spelling at the widened sites. `rls.ts`'s local `PolicyCondition`
  keeps its own name and comment (it documents the D50→D51→#113
  lineage); this change adds the fourth application rather than
  refactoring the first three.
- **No new API surface.** No `sql.bool`-class tag, no cast helper. The
  issue listed those as alternatives; they are unnecessary once the
  existing union is applied, and each would add a second way to say the
  same thing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `query-builder`: the condition-input contract gains the scenario that
  the requirement's normative sentence already implied — a `sql`
  fragment is accepted wherever a declaration accepts one — and the
  escape-hatch requirement names condition positions explicitly.

## Impact

- **Affected code**: `packages/core` (`expr/ast.ts` for the exported
  `Condition`, `query/select.ts`, `query/mutate.ts`), `packages/query`
  (`db/chain.ts`), `skills/hejbro` (the query guide currently documents
  the limitation and cites #386).
- **Breaking**: none — a parameter widening. Every call that compiled
  before still compiles.
- **Runtime**: none. Conditions are stored as `exprNode` and rendered
  identically; `family` is read only when lifting an operand against a
  condition's operand type, which never applies to a condition used
  directly.
- **Decision log**: no new row. This applies D50/D51's settled union a
  fourth time — the same "not a new design" note `rls.ts` already
  carries.

## Out of scope

plpgsql body conditions (`ctx.if`/`elseIf`, `body-context.ts`) carry the
identical asymmetry and are deliberately left alone: the body statement
surface is being reworked in #423 (unrecorded-builder guard) and #426
(side-effect statements), and the body capability has no spec of its own
yet. Widening it there keeps the spec honest about which capability the
scenario belongs to. Recorded on #426.
