# Decisions — quickstart-now/hejbro#686

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — ctx.return refuses a mutation without returning, in types and at runtime

_lead · interpretation · 2026-09-03T00:00Z · ratified: pending_

Ledger R6.

#686: `ctx.return` rejects a mutation that has no `returning()` both in the type system and at runtime. The diagnostic code follows the prefix-equals-operation rule (`return-expects-returning` proposed, sealed after the planner's comparison).

<a id="r2"></a>
## R2 — Type-level rejection through a phantom mutation stage; one new public symbol pending ratification

_lead · extension · 2026-09-03T07:50Z · ratified: pending_

Ledger R18.

#686's type-level rejection is a phantom parameter on the mutation stage (Returnable = "returnable"), `TReturning = never` stays (query's `ReturningRow` untouched). This adds one public symbol — core `ExecutableQuery`, a stage-agnostic union for `ctx.execute` — which awaits the owner's ratification. Condition: every existing public type annotation stays valid (workspace-wide check-types).

Reinforcement (18:00 KST): the phantom stage's default is not "final" but the union `"returnable" | "final"`, because query's `chain.ts` uses the two-argument spelling for the pre-return stage and a "final" default would make existing spellings a false claim. Only `.returning()`'s return and `ReturnableQuery` say "final" explicitly. Success criterion: `packages/query` unchanged.

<a id="r3"></a>
## R3 — Code name return-expects-returning; one MODIFIED requirement in schema-vendoring

_lead · interpretation · 2026-09-03T07:50Z · ratified: pending_

Ledger R19.

The code is `return-expects-returning`, raised after the scalar/trigger branch and only for setof declarations. schema-vendoring's "Every emitted key compiles" is MODIFIED (one requirement only, separate from cl).

<a id="r2-ratification"></a>
## R2 accepted

_evaluator · 2026-09-04T07:21Z_

Adding a public symbol is not on AGENTS.md's owner-gated list, so the rules are silent and this is a real extension; the phantom stage rejects an invalid ctx.return at the type level instead of rendering invalid plpgsql, and the default union avoids making existing two-argument spellings a false claim.

