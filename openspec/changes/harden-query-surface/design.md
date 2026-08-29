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

### What this corrects in this change's own proposal

The proposal stated that `packages/query` "re-exports and does not
redeclare these names — to be confirmed by the first task that touches
each, not assumed". The qualifier was right and the claim was wrong:
`chain.ts` does build its own set-operation node. The sentence is
corrected in `proposal.md`, and it stands as a case of an unverified
convenience claim surviving into a plan document.
