# Proposal: harden-context-boundary

## Why

The adversarial spec-only review of `generalize-context-application`
(D106) left two findings that are not contradictions between spec and
code, and were therefore not repaired before that change archived. Both
are *design gaps at the same boundary*: the point where the query layer
decides that an execution context has been applied. Both ship today, and
both are documented as intended in the user-facing skill, so closing
either one is an observable contract change.

### 1. A mandatory context can be satisfied by a context that applies nothing

A driver declares `contextRequired: true` to make the query layer refuse
any uncontexted execution. The requirement's own rationale is that on a
fail-open platform "an unapplied context is a data-exposure outcome, not
a no-op" (`openspec/specs/rls-execution-context/spec.md`, "A driver can
require that nothing runs without a context").

The declaration is satisfiable while applying nothing, two ways:

- **An empty contributed rendering.** `applyContext`
  (`packages/query/src/db/context.ts:209-223`) invokes the rendering and
  sends whatever list comes back, never inspecting its length. A
  rendering that returns `[]` opens the transaction, sends no context
  statement at all, and runs the caller's statement inside it.
- **An empty context value.** Both members of the public `DbContext` are
  optional, so `db.as({})` is a well-typed context. On a driver that
  declares `roleLessPlatform: true`, it passes role validation, and the
  default rendering (`context.ts:196-201`) renders it to zero
  statements. The mandatory-context declaration is satisfied because an
  execution "has" a context.

Neither shape is reachable through any driver this repository ships. The
one preset that declares both members renders its own statements and
refuses an empty context by value
(`packages/nile/src/context.ts:137-146` — a missing tenant setting
becomes `""` and fails the canonical-UUID check with
`nile-context-value-invalid`). That defense is real but *unspecified*:
no scenario and no test pins it, and `renderContext`, `Driver`, and
`ContextRendering` are public exports (`packages/query/src/index.ts:56-63`),
so a driver outside this repository is a contract-sanctioned instance,
not a hypothetical. "No sample in this repository" is an absence of
observations, not an absence of the exposure.

### 2. The refusal names an operation the caller never invoked

`context-required` is thrown with an `operation` token that reaches both
the message text and the thrown object
(`packages/query/src/db/db.ts:355-366`). On the execute, chain, and
declared-function surfaces that token is the constant `"db.context"` —
the name of a `db()` *option*, not of anything the caller called. The
explicitly scoped path has the same shape with a different constant:
`context.ts:310/323/327` all pass `"db.as"` for execute, chain, and
`fn`. A caller reading either message cannot map it to their call site.

The token is not merely cosmetic within this file: it is the same value
the query layer passes to `assertCapability`
(`context.ts:251`, `context.ts:303`), so it is also the operation named
by `driver-missing-capability` on those paths. The shipped operation
vocabulary is per *entry point*, not per surface — `"transaction"`
(`db/transaction.ts:331`, and `packages/neon/src/http.ts:98`),
`"db.as"`, `"db.context"` — and the code comment at `db.ts:358` already
claims the opposite ("`operation` names the surface that was refused"),
so the defect is documented inside the source that has it.

No spec pins any of these literals: `driver-contract`'s missing-capability
requirement asks only that the error name the capability and the
operation, and `diagnostics` fixes the *code* while allowing message
prose to move. The token is therefore free to change; what is not free is
choosing how far the change reaches.

## What Changes

- **A context that applies nothing stops satisfying a mandatory-context
  declaration.** Where a driver declares a context mandatory and the
  rendering in effect for it produces no statements for the context at
  hand, the execution is refused before any caller statement is sent.
  The refusal is a property of the rendering's output, not of the
  context's shape, so it covers the contributed and default renderings
  alike and needs no inspection of statement text.
- **The `operation` token names the execution surface the caller
  invoked**, on the provider path and the explicitly scoped path alike.
- **The user-facing skill is rewritten where it currently promises the
  old behavior** — `skills/hejbro/references/query-layer.md:1105-1110`
  states both vacuous cases as intended boundaries, and the
  `context-required` entries at `:755-765`, `:1052`, `:1086-1089`
  describe the refusal.
- **Spec deltas**: `rls-execution-context` (the mandatory-context
  requirement gains what "satisfies" means, and the refusal gains its
  own scenarios); `driver-contract` (a contributed rendering's empty
  output is stated as "not an application of the context", so the
  obligation lands on the contract the way the injection-safety and
  transaction-locality obligations already do).

Scope is exactly these two findings. Any new execution surface, new
driver member, or new `db()` option is out of scope and is not to be
introduced while settling a detail below.

## Capabilities

### New Capabilities

None. Nothing here is a `DriverCapabilityKey`, and no new driver-declared
member is added: the change constrains what the existing
`contextRequired` declaration means and what the existing `operation`
token says.

### Modified Capabilities

- `rls-execution-context`: the mandatory-context requirement states what
  satisfies it; the surface-uniform refusal scenario gains the operation
  naming it can be checked against.
- `driver-contract`: the context-rendering contribution states that
  producing no statements is not an application of the context.

## Open decisions

Each decision below is settled before implementation. Options carry
measured costs; the recommendation is the planner's, not a settled
answer.

### D-F6-SCOPE — which executions the new refusal covers

- **`required-only`** — refuse only where the driver declares
  `contextRequired: true`. **Recommended.** On a driver that permits
  uncontexted execution, a vacuous context is not a new exposure: the
  same statement without `.as()` was already allowed, so refusing it
  would remove a permitted execution without closing anything. It is
  also the only option that is a pure addition to the test suite —
  `packages/query/test/db/context.test.ts:136-147` ("proceeds on a
  role-less driver, and no role statement is emitted") pins exactly the
  vacuous shape on a driver that does *not* declare a mandatory context.
- **`all-applications`** — refuse in `applyContext` regardless of the
  declaration. Closes nothing extra (per the argument above) and breaks
  the pinned case, forcing a MODIFIED scenario for
  "A role-less context is admitted where the platform has none".
- **`rendering-level`** — make the default rendering itself refuse an
  empty context. Rejected: `packages/query/test/exports.test.ts:126-130`
  pins `defaultContextRendering({})` to `[]` through the public barrel,
  and the pin exists for a reason the change would have to overturn —
  a role-less platform's own composed rendering depends on being able to
  see that empty shape. It also puts the refusal in a pure function that
  a driver may call for its own composition, where it cannot know
  whether the caller's driver declares a context mandatory.
- **`docs-only`** — leave the mechanism and state the boundary in the
  spec plus a Nile regression test. Cheapest, and it matches the fact
  that no shipped driver is exposed; but it leaves the public
  `renderContext` contract able to satisfy a fail-closed declaration
  with zero statements, which is the finding itself. If chosen, the
  documentation obligation should be machine-checked, following the
  precedent already in this capability ("The documentation obligation is
  machine-checked").

### D-F6-CODE — how the refusal is coded

- **`new-code`** — **Recommended.** Reusing `context-required` would
  make an already-shipped scenario false: it promises the refusal
  happens "before anything reaches the database", while this refusal can
  only be decided after the rendering runs, which is inside the
  transaction the query layer already opened. Its message ("none was
  provided") would also be untrue of a caller who did provide one.
- **`reuse-context-required`** — one fewer code for users to learn, at
  the cost above.

If `new-code`: **D-F6-NAME** — `context-applies-nothing` (recommended;
names the observable effect, matches the corpus's subject-predicate
shape as in `baseline-not-first`, `scalar-return-missing`),
`context-renders-nothing` (names the mechanism), `context-vacuous`
(shortest, but jargon), `context-empty` (rejected: collides with the
existing `context-provider-empty`, which means something else).

### D-F6-POINT — where the refusal happens

- **`after-rendering`** — **Recommended.** The rendering must run before
  its output can be counted, and for a contributed rendering that is
  inside the wrapping transaction. The corpus already has this exact
  shape and states it plainly for the Nile refusals ("the wrapping
  transaction the query layer had opened carries none"), so no new
  concept is introduced.
- **`early-when-possible`** — refuse `db.as({})` synchronously at call
  time when the default rendering applies. Splits one rule into two
  behaviors depending on whether a driver contributes, which is the kind
  of query-layer branch on driver identity the corpus forbids.

### D-F7-GRAIN — how finely the operation token names the surface

- **`per-verb`** — **Recommended.** `db.execute`, `db.select`,
  `db.insert`, `db.update`, `db.deleteFrom`, `db.with`, `db.fn`, and the
  existing `transaction` — the exact surface list the skill already
  enumerates for `context-required` (`query-layer.md:755-765`, `:1052`),
  so the error and the documentation match one-for-one. Cost: the
  private `createChainApi` takes a per-member run factory instead of one
  run. Measured blast radius: four source files, all in
  `packages/query/src/db/`; **zero test files** (every test reference to
  `createChainApi`/`ChainRun` is a comment); no public type changes —
  `ChainRun`, `ProviderRun`, `createChainApi`, `createFnApi` are all
  absent from `packages/query/src/index.ts`.
- **`coarse-four`** — `db.execute`, `db.chain`, `db.fn`, `transaction`.
  Cheaper (`providerChainRun` is already called separately for chain and
  for `fn`, so `chain.ts` is untouched), but `db.chain` is still not a
  member the caller invoked, which is the finding.

### D-F7-SYMMETRY — which paths are fixed

- **`both-paths`** — **Recommended.** The scoped path (`db.as(...)`) has
  the identical defect and costs three literal replacements in
  `context.ts`. Fixing only the provider path leaves the same complaint
  standing on the other path, and that asymmetry would have to be
  asserted as intentional in the spec to survive the next adversarial
  review.
- **`provider-only`** — no measured cost saving.

### D-F7-SURFACE — which errors the token change reaches

- **`both-errors`** — **Recommended, and close to unavoidable.** The
  same value is passed to `assertCapability` and to the
  `context-required` thrower on both paths, so per-surface tokens change
  `driver-missing-capability`'s message on those paths automatically.
  Keeping that message on `"db.context"` would require deliberately
  splitting one token into two, which is more code for a worse result.
  Cost specific to this option: the cross-driver uniformity requirement
  ("the same code, message, and enriched fields … for the same
  capability and operation") must keep holding. Audited: exactly one
  driver-side thrower exists, `packages/neon/src/http.ts:98`, which
  passes `"transaction"` — a token this change does not touch. The skill
  line that enumerates operation examples for
  `driver-missing-capability` (`query-layer.md:1045`) is updated in the
  same PR.
- **`context-required-only`** — costs extra code to achieve less.

## Impact

- **Affected code**: `packages/query/src/db/` only (`context.ts`,
  `db.ts`, `chain.ts`, `fn.ts`), plus a regression test in
  `packages/nile/test/`. No file under `packages/core` is touched. No
  public type changes; the observable change is error behavior and error
  prose.
- **Affected docs**: `skills/hejbro/references/query-layer.md` in the
  same PR (the boundary-cases paragraph, the `context-required`
  description and error-table row, and — under `both-errors` — the
  `driver-missing-capability` row's operation examples). There is no
  variant of this change that leaves the skill untouched.
- **Existing pins, by option**: `required-only` breaks none;
  `all-applications` breaks one
  (`packages/query/test/db/context.test.ts:136-147`);
  `rendering-level` breaks that one plus the public-barrel pin
  (`packages/query/test/exports.test.ts:126-130`), the second of which is
  a change in a public value's behavior. No new runtime export is added
  under any option, so the barrel's exact-set assertion
  (`exports.test.ts:110-121`) stays untouched.
- **Automatic obligations if a new code lands**: `pnpm
  check:next-marker` scans `packages/query/src` and requires a literal
  `Next:` line in the message, kept inline or within a one-to-two-level
  helper; `pnpm check:diagnostic-xref` adds nothing unless the code is
  cited in bracket form inside another message.
- **Breaking**: a `contextRequired` driver whose rendering yields no
  statements now fails instead of running. That is the intended change,
  and it is documented behavior today, so it is called out in the
  changeset rather than treated as a fix.
- **Publishing**: one changeset; `minor` under `required-only` or
  `all-applications` (a new refusal), `patch` under `docs-only`.

## Out of scope

- **Any new public surface.** No new driver member, no new `db()`
  option, no new execution surface.
- **Inspecting what a rendering returns.** The corpus forbids the query
  layer from reading or rewriting contributed statements; counting them
  is the only observation this change makes.
- **The other D106 findings.** F1, F2, F3, F4, F5 and F8 were repaired
  or ruled before that change archived; this change reopens none of
  them.
- **Enforcing the operation vocabulary on third-party drivers.**
  `throwMissingCapability` is a public export, so any driver may pass
  any token; the cross-driver uniformity rule stays a contract sentence
  and this change does not pretend to mechanize it.
- **Nile behavior.** The preset's refusals are unchanged; it gains a
  regression test for a defense it already has.
