# Proposal: add-context-provider

> Draft — pending owner approval. No production code until the contract
> below is accepted and the `[design]` decision is settled.

## Why

Today every call site that needs an authorization context writes it:
`handle.as(asUser(claims)).execute(...)`. That was the deliberate v1 cut
(owner decision, 2026-08-27), and it stays available. What it does not
give is a way to say "this handle serves this request" once. The cost is
not typing — it is that a *forgotten* wrap is silent. An unwrapped call
does not fail; it runs under whatever role the connection already holds,
which is the one authorization failure that produces rows instead of an
error.

Issue #318 parked the automation for this and sketched it as a callback
on the Supabase driver factory. The 2026-08-30 layer finding
(owner-delegated ruling, recorded on the issue) rejected that placement
against the approved corpus, on grounds worth restating because they
also fix this change's shape:

1. `rls-execution-context` requires a context's role to be validated
   before any statement is sent, fail-closed, with no escape hatch — and
   the requirement's subject is *the role*, not `db.as()`. It is
   path-independent.
2. That validation unions four sources; three of them (schema grants,
   table policies, handle options) do not exist on a driver value. A
   driver-level path cannot *perform* the validation, only skip it.
3. The same spec forbids a preset from supplying "an alternative path
   that would apply the context another way".

So the provider belongs on the query layer, where the whitelist already
lives. The decisive consequence: once it is there, the Supabase preset's
own share of this feature collapses to approximately zero, because
`asUser(claims)`/`asAnon()` already produce the context value. This is a
query-layer feature that was mis-assigned to a preset — the case the
provider-preset rule exists to catch.

## What Changes

- **`DbOptions` gains `context`.** A provider registered once at
  construction resolves the execution context for each execution:
  `db(schema, driver, { context })`. Absent the option, nothing about a
  handle changes.
- **The provider covers every execution surface on that handle** —
  `execute`, every thenable chain member, `db.fn.*`, and
  `transaction(callback)`. `query-execution`'s uniformity requirement
  already states the trap in the general case ("applying a context can
  never cover one of these surfaces while missing another"); registering
  a provider must not become the exception.
- **An explicit `handle.as(context)` always wins.** The scoped handle is
  unchanged and consults no provider — its context was named at the call
  site, which is more specific than a handle-wide default.
- **The provider path performs the same validation, not a parallel
  one.** The resolved context's role goes through the existing
  declared-role whitelist — the same four-source union computed at
  construction — and a role outside it is rejected fail-closed *before
  any statement reaches the database*, including before the wrapping
  transaction is opened. A second validation path would be this change's
  own failure mode; the implementation reuses the existing one.
- **Resolution happens once per execution, uncached** — and once per
  `transaction(callback)`, not once per statement inside it, because the
  context applies to the transaction.
- **A missing interactive-transaction capability fails on first
  execution**, symmetric with `db.as()`, and is asserted *before* the
  provider is called, so the failure does not depend on whether the
  caller's auth layer happened to answer.
- **An execution never runs uncontexted once a provider is registered.**
  If the provider resolves nothing, the request does not silently
  degrade to the connection's own role. The mechanism is the one open
  decision below.
- **The Supabase preset gains no logic.** Its share is an adapter
  example and its reference documentation. If preset *code* turns out to
  be needed, the generic shape is wrong — that is a tripwire to
  escalate, not to work around.

## Capabilities

### Modified Capabilities

- `rls-execution-context`: adds the registered-provider requirements
  (registration, precedence under an explicit `as()`, per-execution
  resolution, validation and capability timing, and the no-uncontexted-
  execution guarantee).
No `query-execution` delta (owner decision). The provider adds no
execution surface, changes no inferred type, and leaves `Declarations`
as built. Its "what is sent SHALL be exactly the statement's pure
`compile()` output" is a fidelity claim about the caller's own statement
— never rewritten, re-rendered, or re-parameterized — not an
exclusivity claim about the connection: `db.as(context)` already
precedes statements with role and setting statements, so the exclusive
reading is already false in the approved corpus and needs no amendment
to stay so.

The behavior change that reading would otherwise obscure — that
registering a provider makes a previously unwrapped execution
transaction-wrapped, observably — is stated as its own scenario in the
`rls-execution-context` delta, together with the fact that the
statement's own SQL and parameters are untouched by the wrapping. If an
adversarial reading of `query-execution`'s sentence is raised later,
that scenario is the answer.

## Impact

- **Affected code**: `packages/query/src/db/db.ts` (the option and its
  threading), `packages/query/src/db/context.ts` (resolution and reuse
  of `assertDeclaredRole`/`applyContext`), their tests;
  `packages/cli/src/index.ts` (re-export of any new public type);
  `skills/hejbro/references/` (the surface is the user contract);
  `packages/supabase` — adapter example and reference only.
- **Breaking**: none. `context` is optional; a handle built without it
  behaves exactly as today, and `db.as()` is untouched.
- **Decision log**: no new row expected — this lands the automation
  half already recorded on #318, at the layer the 2026-08-30 finding
  assigned it to.

## The settled shape, and the one it was chosen over

Provisional detail ② from the issue reads: "a provider returning no
claims applies the anon context rather than leaking an uncontexted
request." The intent is not in question. The *mechanism* is, because the
query layer cannot know the word `anon`: it is Supabase's role name, and
Neon's is `anonymous`. A generic layer that hardcodes either has a
preset leaking into it — the exact defect this change exists to undo.

Two shapes preserve the intent. Both keep the preset's share at zero.

**(B) — recommended. The provider returns a context, always.**

```ts
db(schema, driver, {
  context: async () => {
    const { data } = await supabase.auth.getClaims(token);
    return data?.claims ? asUser(data.claims) : asAnon();
  },
});
```

The return type is not optional, so "no context" is a type error, and a
caller who bypasses the type (plain JS, an `any`) gets a coded,
fail-closed rejection — never an unscoped send. Smallest surface;
closest to the issue's own sketch; the anonymous *value* is named by the
caller, who is the only party that knows their platform's role name.

**(A) — considered alternative. Resolver plus a registered fallback.**

```ts
db(schema, driver, {
  context: {
    resolve: async () => { /* … */ },   // may resolve to nothing
    fallback: asAnon(),
  },
});
```

This is ② taken literally: the layer itself applies the fallback. It
also forces the caller to declare, once and reviewably, what an
unauthenticated request runs as. The cost is a second field that
`?? asAnon()` already expresses, and it has no good answer for a caller
whose correct behavior is "no identity, no query" — they must invent a
fallback they never want applied, or throw from `resolve` anyway.

**Settled: (B)** (owner decision, final). Two things decided it.

A required `fallback` field is dead surface for a caller whose correct
behavior is "no identity, no query": they would have to invent a value
they never want applied (D104 — type information no user can read is
dead surface). Such a resolver simply throws, and a throwing resolver
propagates without any fallback being consulted.

(A)'s advantage was that a fallback is a value known at construction, so
its role could be validated there rather than on the first request that
resolves to none. That advantage was measured, not assumed, and found
narrow. The whitelist *is* complete at that point — `declarations.roles`
folds all four sources synchronously before the handle is assembled,
with no dependency on the `context` option and so no cycle — so the
check was buildable. But a preset's own `asAnon()` carries a
driver-contributed role, which is always in the whitelist and has
nothing to catch; the exposure narrows to a caller hand-writing an
anonymous role, and that caller still fails **loudly**, on the same
fail-closed check, at the first request that reaches it. Later-but-loud
is not the failure class this project converts; silent is. Moving a loud
failure earlier did not justify the surface.

Decisively, (B) keeps "yields no context" unrepresentable in the *type*.
An optional fallback would have demoted that guarantee to a runtime
check while still paying for a field — losing the compile-time property
and adding surface at once.

Provisional detail ②'s intent holds as a property of the layer rather
than of the caller's diligence: once a provider is registered, an
execution applies a context or it fails. There is no unscoped path out.
