# Proposal: add-nile-preset

## Why

`@hejbro/supabase` and `@hejbro/neon` express an execution context the same
way: a role plus JWT claims, applied as `SET LOCAL ROLE` and one
`set_config` per setting. This preset cannot, and that is why it exists.
Nile's context is a **tenant**, not an identity, and the platform refuses
the statements the query layer used to hardcode:

- `select set_config('nile.tenant_id', …, true)` is rejected permanently —
  `ERROR: changing nile.tenant_id within a transaction is only allowed
  before any queries are performed`, and `set_config` is itself a query.
  The working form is `SET LOCAL nile.tenant_id`, sent as the first
  statement after `BEGIN`. `[MEASURED, container-only]`
- `set local role …` is a silent no-op (`WARNING: GUC 'role' cannot be
  changed and the current setting is kept`) that additionally blocks the
  tenant setting behind it, and Nile has no application roles to name:
  `CREATE ROLE` is refused, and the platform's published authorization
  design assigns policy bundles over an HTTP API rather than SQL.
  `[MEASURED, container-only]` + `[DOC + first-party design]`
- Without a context, Nile is **fail-open**: "When no tenant context is set,
  the connection can access across all the tenant DBs". `[DOC ×2 + SDK]`

#553 (`generalize-context-application`) moved context application to
driver ownership precisely so this preset could be written without a
special case. This change is the other half: it uses that contract, and
in doing so it is the **first independent user** of `renderContext`,
`roleLessPlatform`, and `contextRequired`.

That makes this change a test of #553, and the test has a stated failure
condition: **if writing this preset requires modifying either capability's
general requirements, or editing any file under `packages/query`, the
widening did not work.** That is a stop-and-escalate, not a patch. Adding
this preset's own requirements beside the other presets' is not that — it
is what the corpus already does for Supabase and Neon.

**Approval basis.** Owner rulings already on record for this issue
(2026-08-31, in session): direction D+A sequenced #553 ahead of it, and
the preset **ships** despite Nile refusing RLS, functions, triggers and
`GRANT` — with the preset's validators failing those early. Neither is
revisited here; both are applied.

## What Changes

- **`@hejbro/nile`**, a new published package (the seventh), containing a
  provider preset and its driver contribution.
- **`nileDriver(driver)`** — a decorator over an existing driver, the
  `@hejbro/supabase` shape rather than the `@hejbro/neon` shape, because
  Nile speaks plain Postgres on 5432 with no second connection path and no
  HTTP client to wrap. It declares no runtime dependency on any Nile
  package. `[design]` settles the exact signature.
- **`asTenant(tenantId)` and the tenant-plus-user form**, producing a
  context whose settings the driver renders as `SET LOCAL nile.tenant_id`
  (then `SET LOCAL nile.user_id` when a user is given — the platform
  enforces that order: *"you must set a tenant context before setting the
  user context"*). `[design]` settles whether the user form is a second
  argument or a second builder.
- **`renderContext`** on the driver: the tenant statement is the **first**
  statement it returns, and anything else the driver needs in the
  transaction rides *after* it inside the same rendering — never in
  `transaction()` setup, where it would precede the context and make the
  platform refuse it (`driver-contract`, "first among its own").
- **`roleLessPlatform: true`** — the platform has no roles, so a context
  names none. This is not a whitelist exemption: a context that *does*
  name a role is still validated.
- **The rendering owns the safety of what it interpolates.** `SET LOCAL`
  takes no bind parameter, so the tenant and user values are interpolated,
  and #553 put that obligation on the contributing driver ("A contributed
  rendering owns its own values"). Both values are `uuid` on this
  platform, so the primary defense is *constraining* rather than escaping:
  a value that is not a canonical UUID is refused with a coded error
  **before anything is sent**, and what does get through is still wrapped
  by the literal-quoting rule. `[design]` settles the exact check and code.
- **The rendering is transaction-local, and that is verified here.**
  #553's paired obligation ("A contributed rendering leaves nothing
  behind") lands on this package: the statement form itself is
  `SET LOCAL` (asserted against the recorded statements), and the server
  side — the next transaction on the same connection cannot see the
  previous tenant's rows — is corroborated by the live witness below.
- **`contextRequired: true`** (`[design]`, but this is the expected
  answer): on a fail-open platform an unapplied context is a data-exposure
  outcome, not a no-op. Verified as safe for the CLI: `hejbro check` reads
  the catalog through `DriverSession.execute` directly
  (`packages/cli/src/check/catalog.ts`), not through a `db()` handle's
  execution surfaces, so a mandatory context does not block it. A scenario
  pins that.
- **Validators that fail early on what Nile refuses**, at generate time,
  with an explicit error naming the declaration, the platform's answer,
  and what to do instead — detect + options + commands, never a silent
  rewrite. The set: RLS enablement and policies, functions, triggers,
  grants, and the `serial`/`smallserial`/`bigserial` family in a
  tenant-aware table. Each error's text records its evidence grade:
  policies, functions and triggers are in the platform's published
  limitations table; **grants are not, and are refused anyway**, and the
  serial family is likewise measured (the published table documents
  `CREATE SEQUENCE` for tenant tables, which is adjacent but not the same
  declaration). `COMMENT` is refused by the platform too, but hejbro has
  no comment declaration for a validator to fire on — that fact is
  recorded in the preset's documentation instead, because a validator
  that can never fire is a spec sentence with no test behind it.
- **No new `ObjectKind` and no DSL change.** A tenant-aware table is an
  ordinary `CREATE TABLE` with a `tenant_id uuid` column — *"You can
  create a tenant aware table in Nile by creating a table with a
  'tenant_id' column of type uuid… This is all it takes"*. Core already
  expresses that.
- **Gate registrations for the seventh published package**:
  `scripts/pack-install-smoke.sh`'s hand-enumerated blocks (tarball
  resolution, scratch dependencies, assertions 1a/1b/1c/2, a **nile-specific**
  entry assertion, and the closing summary), `.changeset/config.json`'s
  fixed group (6 → 7), and AGENTS.md's "six published packages". The
  `DEP_COUNT` guard itself stays unmodified: it is the tripwire, and it
  names what to update.
  The entry assertion is **registration, not import**. Neon's block
  imports one exported value *because* that preset ships no bundle to
  register — its own comment says an empty bundle would be "surface
  invented only to satisfy this gate". This preset ships a real bundle
  with validators, so the equivalent check is the one assertion 3 already
  performs for Supabase: register the preset in the scratch config and
  let `generate` load it. Copying Neon's shape here would silently
  substitute a weaker check.
- **A live round-trip witness**, in its own group and its own vitest
  configuration, excluded from the default `pnpm test` and from CI —
  the `packages/neon` integration wiring, reused. See below.
- **`.claude/rules/provider-preset.md`**: `packages/nile/**` joins the
  `paths:` frontmatter, or the boundary rule never loads for this package.
- **Skill**: `skills/hejbro/references/nile-preset.md`, plus its row in
  `skills/hejbro/SKILL.md`'s References table — and, in the same table,
  the missing row for `references/neon-preset.md`, which ships today with
  no index entry.
- **One `minor` changeset.**

## Capabilities

The corpus already houses per-preset requirements: `rls-execution-context`
carries "Presets define the context type", the Supabase builders, and "The
Neon preset fixes the authentication mode at construction";
`driver-contract` carries "Presets ship their own driver". This preset
follows that placement rather than opening a capability of its own for
work the corpus already has a home for.

### New Capabilities

- `preset-validation` — a preset refusing, at generate time, declarations
  its platform will not accept. The concept is not Nile's: any preset on a
  platform that rejects part of the DSL needs the same guarantee, and the
  first requirement being Nile's does not make the capability Nile's.
  Nothing in the corpus covers it today.

### Modified Capabilities

None. Requirements are **added** to `rls-execution-context` (how this
preset renders a tenant context, in what order, with what value safety,
and which of #553's driver declarations it makes) and to
`driver-contract` (the decorator driver and the base-driver shapes it
supports). Adding a preset's own requirements next to the other presets'
is the corpus precedent; **modifying** either capability's general
requirements is not, and would mean #553's widening did not work — that
is a stop, not a second widening.

## Impact

- **Affected code**: `packages/nile` (new), plus the gate registrations
  and the two documentation surfaces named above. **No file under
  `packages/core`, `packages/query`, `packages/cli`, `packages/pg`,
  `packages/supabase`, or `packages/neon` is edited.**
- **Breaking**: none. New package.
- **The first smoke task is the gate, not a surprise.** The pack-install
  smoke's dependency-count guard fails by design the moment a seventh
  published package exists. Group 1 starts there: empty package skeleton →
  guard red → hand blocks extended → green.
- **Publishing**: `@hejbro/nile` joins the fixed changeset group, so it
  versions with the other six.

## Open decisions (`[design]`, settled before the code that depends on them)

1. `nileDriver`'s signature — what it decorates and how the base is
   handed to it.
2. The user axis of `asTenant` — a second argument or a second builder.
   The platform's ordering rule (tenant before user) holds either way.
3. `contextRequired`'s default. The expected answer is `true`; what makes
   it safe is verified rather than assumed — the CLI reads the catalog
   through `DriverSession.execute` (`packages/cli/src/check/catalog.ts`)
   and `assertSchema` reads only the handle's `schema`/`driver` members,
   neither of which is a `db()` execution surface.
4. Each validator's error text, including how it states its own evidence
   grade.
5. How an interpolated value is constrained — canonical-UUID refusal
   before send, plus literal quoting, versus quoting alone.

## Why the driver decorates rather than wraps a client

`@hejbro/neon` is a driver because Neon's client library exposes two
connection paths whose capabilities differ. Nile exposes one: plain
Postgres on 5432. Its own SDK's runtime dependency is `pg`. There is no
second path to model and no wire to reimplement, so the preset takes a
driver the user already built — the `@hejbro/supabase` shape — and adds
what Nile needs: a context rendering and two declarations.

Which base drivers this supports is a **testable requirement**, not a
warning in prose. Three things are specified and asserted against a
recording base driver:

1. the decorator passes the base's `transaction` through and sends
   nothing of its own before the callback — everything it needs is in the
   rendering;
2. the decorator passes the base's `capabilities` through unchanged, so a
   base declaring `interactive-transactions: false` is refused by the
   existing capability gate (#553's "Contributing a context rendering does
   not widen who may run one", from the other side);
3. a base that pins **inside its own transaction** — the Supabase pooler
   shape — places those pins ahead of the tenant statement, which this
   platform refuses. The spec states the supported shape positively; the
   skill documents the unsupported one, so the reader meets it before
   production does.

## Measurement protocol (Rule 50, pre-registered)

This change makes **no performance claim**, so no dispersion measurement
is planned and none of the four dispersion estimators applies. What it
does have is a set of platform-behavior claims that rest on container
measurement, and those are pre-registered here, before implementation:

- Instrument: Nile's official test container
  `ghcr.io/niledatabase/testingcontainer@sha256:188a7230…` (PostgreSQL
  15.12, image built 2025-05-20).
- Judgment rule, fixed before any further data is touched: a statement is
  recorded as *refused* only on a verbatim server error, and as
  *accepted* only on a verbatim success tag. Ambiguity resolves **against**
  the claim we would like to ship.
- Direction of the caveat: every refusal is a **floor, not a ceiling** —
  if the cloud has since widened support, the measurement is superseded,
  not contradicted. Validator error text therefore says what was measured
  and when, not what is eternally true.
- Evidence grades stay attached: `[DOC]`, `[SDK]`, `[GH]`, `[MEASURED,
  container-only]`. `GRANT` and `COMMENT` are measured-only.

## The live witness, and what it is not

Two obligations #553 placed on a contributing driver are verified *in the
driver's own package*: that a rendering which interpolates owns the safety
of what it interpolates, and that its statements leave nothing behind on
the connection. A stub proves what we **sent**. Only a server proves what
was **received** — and this platform, unlike the one Neon's HTTP path
faced, publishes a first-party image and documents a TestContainers
recipe. Declining to use it would mean leaving a verifiable safety claim
unverified.

Five constraints keep the witness honest and cheap:

1. **Wiring mirrors `packages/neon`**: a separate vitest configuration, a
   `test:integration` script, excluded from the default `pnpm test` and
   never required in CI.
2. **The image is pinned by digest** — in full, in the test and here:
   `ghcr.io/niledatabase/testingcontainer@sha256:188a7230d9f39e615bc584d90e8ec6f4754d0ef298701a1d6811d394f3d35696`
   (PostgreSQL 15.12, image built 2025-05-20). The measurement command and
   the floor-not-ceiling caveat travel with it, and a digest change means
   re-measurement — stated in a comment rather than assumed.
3. **No silent pass when Docker is absent.** The run is either performed
   or it fails explicitly. A skip that reports success would reproduce, in
   our own test suite, the exact failure mode this preset exists to
   prevent: something that looks safe because nothing checked.
4. **The witness is a witness, not the gate.** Every spec scenario's
   failing test lives in the stub-driven suite; the witness is cited by
   the scenarios it corroborates. Two are required — an adversarial tenant
   value (our escaping keeps the raw text out of the statement, *and* the
   server rejects it as a non-`uuid`), and no leakage (after a context
   transaction, the next transaction on the same connection cannot see the
   previous tenant's rows). A third is wanted if it stays cheap: rows are
   actually scoped by the tenant our rendering applied — the end-to-end
   proof of the first-statement constraint that motivated #553.
5. **Its own task group**, so a Docker dependency never contaminates the
   parallelism of the groups that have none.

## Out of scope

- **A reserved-area protection list.** Nile's internal shadow tables
  (`public_nile_internal.<table>_pdb_N`) are exposed only through
  `information_schema`; hejbro's own catalog reader queries `pg_class`/
  `pg_namespace` exclusively (`packages/cli/src/check/catalog.ts`). Both
  sides measured: the hazard cannot reach us, so the protection list would
  guard nothing.
- **Constants for the platform's own tables** (`users.users`,
  `users.tenant_users`, `public.tenants`). They exist in every Nile
  database, so unlike Neon's case a constant would not lie — but nothing
  in this change needs them, and a surface added "because it could be" is
  the thing the neon proposal refused. Reopen when a declaration needs the
  foreign-key anchor.
- **Cross-tenant and tenant↔shared write validators.** Nile documents
  both as unsupported, but they are properties of a *transaction at run
  time*, not of a declaration, so a generate-time validator cannot see
  them. Documenting them in the skill is in scope; inventing a static
  check that cannot be right is not.
- **`examples/nile`.** The DSL is identical to `examples/postgres`; a
  third example would restate it.
- **Editing `packages/query/src/testing/driver-conformance.ts`** (#528).
  The kit's observation is taken at the contract's execute domain, and
  the same-transaction property it cannot observe is pinned in this
  package's own tests.
- **The vacuous-context question** (#561): whether `db.as({})` should
  satisfy `contextRequired`, and the `operation` token's wording.
