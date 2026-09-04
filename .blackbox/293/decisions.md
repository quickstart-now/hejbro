# Decisions — quickstart-now/hejbro#293

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — start the session with the rebase, then the proposal

_owner · 2026-08-26T00:00Z_

> For the next session, let's start with `git fetch upstream && git
> rebase upstream/dev` and then go straight into `/opsx:propose` (the
> ORM spec, #293).

This executes the entry point recorded at the previous session's close:
dev push CI at `0c42b17` had already been confirmed green, so the
session opens with the sync, a worktree (`phase10-orm-spec`, issue-first
satisfied by #293), and the first OpenSpec change of the D87 process.

<a id="d2"></a>
## D2 — merge and start implementing

_owner · 2026-08-26T00:00Z_

> Merge it, and let's start implementing with /opsx:apply.

PR #304 was squash-merged by this instruction (dev `9496d49`, push CI
green: ci + release-version both success), and the apply workflow
started on change `add-query-layer`, group 1, in worktree branch
`phase10-query-ir`.

<a id="d3"></a>
## D3 — the discovery, and the owner's call

_owner · 2026-08-26T00:00Z_

After task 1.1 (the `packages/query` scaffold), the implementation
inventory contradicted a premise of the plan: core already owns the
complete statement vocabulary — `QueryNode`
(select/insert/update/delete) in `expr/ast.ts` and the
`select`/`insert`/`update`/`deleteFrom` builders in `query/` — because
declarations contain queries (view bodies, function bodies, RLS
`exists()`). D91–D98's D94 said "the statement IR and its compiler live
in a new pure package", with "the statement IR inside core" listed as a
rejected alternative — wording written before this inventory existed.
Building the planned second IR would have produced two `select()`
surfaces and duplicated the exact vocabulary decision ④ exists to
unify.

Presented to the owner as one decision with the inventory as
background (deep-background-then-one-question cadence), two options:
(가) reuse core's vocabulary as the single statement vocabulary, close
the v1 gaps (left join, returning column selection) additively in core,
and amend D94's wording; (나) keep D94's letter and build the separate
IR. The owner chose:

> (가) — reuse the core vocabulary.

That answer is the owner approval for the D94 amendment (decision-log
changes are a hard gate); the amended row records both the original
decision and the amendment with its reason. proposal.md and design.md
were updated in the same commit to stay coherent; the six capability
delta specs needed no change (behavior contracts, not IR-location
statements).

<a id="d4"></a>
## D4 — AI-native performance badges (filed, separate change)

_owner · 2026-08-26T00:00Z_

> Also: I think the root README should carry badges for values we can
> treat as metrics — average time per task, percentage-style figures.
> Since this project is being developed AI-natively, shouldn't we be
> recording what that performance actually looks like? (As I said
> before, time spent waiting on the user's decisions is excluded.)

Filed as #305 (Task, documentation, sub-issue of #282), modeled on the
CRAP badge precedent (#278/#280: README block + refresh script + CI
drift check), reading `openspec/task-times.csv`, whose separate
`waited_user_min` column is what makes the exclusion structural. Not
part of this PR; scheduled after the ledger has real rows.

<a id="d5"></a>
## D5 — s and decisions in this piece

_owner · 2026-08-26T00:00Z_

**Compiler contract (task 2.1, six decisions).** The owner reviewed each
item with full background (after asking that the items be spelled out
one by one rather than batch-approved): ① result shape — the owner chose
`{ sql, params, kind }` over the recommended `{ sql, params }`, adding
the `kind` metadata; ② placeholders in render order `$1..$n`, no
dedup; ③ parameterization boundary — all literals bound, with `limit`
inline (validated integer), `sql.raw()`/internal `default` marker
verbatim, timestamps as `$n::timestamptz` with ISO string values,
null/boolean uniformly parameterized; ④ renderer — lift-preprocessing
plus core `renderQuery` reuse (same renderer as declarations, so "same
SQL text, literals lifted" holds by construction); ⑤ input — structural
union of the builder products plus raw `QueryNode`; ⑥ single
option-free `compile(statement)`.

**sql tagged-template contract (task 2.6, S1–S6).** Owner-settled: thin
wrapper delegating to core's `sql` tag (one tag, one meaning; extra
members live in the query package); single tag dual-use (fragment AND
statement — the `Compilable` union gains a `{ statementExpr }` branch);
`sql.identifier(...names)` added (each part quoted by core's rule);
nested fragments rely on core's structural insertion with a
render-order numbering proof test; the medium-dependent literal
behavior (inline in migrations, bound parameter in queries) is a
spec-stated property; core's `ambiguous-literal` rejection stays
(`param()` and jsonb-brand interplay parked); an empty statement
compiles to an `empty-sql-statement` error.

**Security directive.** Mid-piece the owner directed: "ORM injection
and ORM security issues must be considered." Landed as the spec delta's
"Injection safety" requirement (three SHALLs: values never in text —
params only; identifiers always quoted; `sql.raw()` the sole verbatim
path) with six adversarial scenarios, plus adversarial red tests folded
into each task (not a separate task — D88). Two exceptions are
explicitly written into the requirement because the owner had already
decided them (③): `limit` (validated integer, not caller text) and the
internal `default` marker.

**`kind: "sql"` (follow-up decision).** The implementer stopped before
code on a genuine gap at the intersection of two owner decisions: a
`sql` statement has no `queryKind` to classify. The owner chose adding
a fifth value `"sql"` ("an unclassified statement from the sql tag")
over `"unknown"` (different axis than core's type-family vocabulary)
and over making `kind` optional.

**Token ledger (owner-directed, rides this PR).** "Record token usage
alongside time — how efficiently it was done." D88's row gains the
`openspec/task-tokens.csv` clause (per-piece grain; exact because a
piece is one session per role; lead-session work is interleaved and
excluded; `waited_user_min` keeps the owner-wait exclusion structural).
This piece's row: 898 requests, 881,848 output tokens across
planner+implementer+reviewer at PR-open time.

<a id="d6"></a>
## D6 — s and decisions in this piece

_owner · 2026-08-26T00:00Z_

**The eight-decision round (before code).** ① `ColumnBuilder` gains a
defaulted `TMeta` type parameter (runtime unchanged, existing call
sites compile unchanged). ② Left-join nullability (3.3) is parked as
#307 with its SHALL clause removed from the delta (D87: specs describe
what the product does now). ③ The planner recommended plain `string`
for bigint/numeric; the owner asked how Drizzle handles it, and after
the comparison (Drizzle converts at a result-mapping layer, forces a
mode choice) chose the **larger** scope: mode options plus a result
conversion layer in this change — with the house difference that
`'number'`-mode conversion throws on the unsafe range instead of
silently losing precision. ④ For interval the owner rejected
`unknown`/`string` as irresponsible ("we should define the category")
→ structural `IntervalValue`. ⑤ `.$type<T>()` as an identity method.
⑥ Generated columns start as their own change (#308) rather than
widening this one. ⑦ Test-file naming (lead call, repo precedent).
⑧ Insert optionals as `col?: T` under `exactOptionalPropertyTypes`.

**The `$type` saga (three rounds).** First: brand jsonb-only → owner
asked whether json and jsonb are really different types; given the
Postgres storage/semantics differences and Drizzle's tag-anywhere
behavior, chose **json and jsonb both**. Then the planner corrected the
premise — `$type` already exists on every builder, so a json/jsonb-only
*read* just relocates the silent ignore to twenty other column types.
The owner asked to be convinced before widening ("정한 건 아닌데 날
이해시켜봐"); the honest case included the risk their skepticism
pointed at (Drizzle's unconstrained override is a user-operated lying
device) and the middle form: **all columns, narrowing-only** —
`T extends` the column's base mapped type, so `uuid().$type<UserId>()`
and CHECK-backed unions work while `integer().$type<string>()` is a
compile error; json/jsonb stay fully free because their base is
`unknown`. Chosen. Contract sentence: "the brand can narrow, never
lie." Implementing it exposed a dependency-direction fact — the base
mapping must live where `$type` lives — so the type-level map and
`IntervalValue` moved to core (`ts-type-map.ts`) under a lead-set
boundary: **types only, zero runtime symbols in core** (proven in
review by `Object.keys(module)` being empty); parsers and conversion
functions stay in `@hejbro/query`.

**Interval details.** Fields: the implementer deliberately deviated
from the planned `milliseconds` to `microseconds` (Postgres outputs
six fractional digits; stopping at milliseconds silently drops three) —
owner accepted the deviation. Shape: all seven fields required, parser
returns the canonical form (absent axes zero) so equal intervals are
structurally equal. The 7-field set maps each field to exactly one of
Postgres's three internal axes (months/days/microseconds), hiding no
cross-axis conversion.

**Measurement standard (owner, mid-piece).** "The ledger should record
actual processing time — agent waits and user-decision waits don't
count." Re-derived from git/commit timestamps and session event logs,
the reported "3.6×" collapsed to **0.81×**: the estimates were fine;
the cost was process. That reversal flipped the group-4 prescription
from "split tasks smaller" to "settle [design] decisions before
summoning" — splitting would multiply exactly the coordination that
cost the time. Process costs got their own named ledger rows
(`3.pivot` 20m for a decision arriving mid-implementation;
`3.9-rework` 18m for a red-first lapse; `3.9-crap` 12m for the gate
itself widening between bases). The owner also directed recording
**token usage** per piece; this piece: 2,506 requests, 2,178,887
output tokens across the three role sessions (~2.5× group 2 — the
piece with more decisions and rework).

**Conflict-free ledgers (owner, after watching the rebase conflict).**
"Order the measurements or merge the procedure so they don't
conflict." Merged: both CSV ledgers and the README metric block are
written only by the lead's close-out commit, from team-reported
figures — one writer, no piece-branch conflicts. D88's row now carries
the full ledger discipline.

<a id="d7"></a>
## D7 — s and decisions in this piece

_owner · 2026-08-26T00:00Z_

Group 4 started with its `[design]` decisions **pre-settled in the
tasks.md group header** — the direct application of group 3's measured
lesson (the cost was coordination, not implementation). It worked: all
four owner decisions that did arise mid-piece were absorbed in parallel
with other batches, and every ledger row shows `waited_user_min = 0`
because **no task ever stopped to wait** — not because waits were
hidden.

The four mid-piece decisions:

1. **`db.fn` static typing needs core (task 4.10 blocker).**
   `defineFunction` erased its args/returns types, so no query-side
   typing could exist without touching core. Owner chose **(B): core
   additive generic extension** — `FunctionDeclaration` gains defaulted
   type parameters; non-generic consumers compile unchanged (proven by
   first-try unchanged compilation of all three).
2. **Mutation `returning` typing** — same shape, owner chose **(a)**:
   generic type surface on core `mutate.ts`, runtime untouched.
3. **`db()` argument shape = (c′)**: a flat schema-module record;
   declarations are auto-collected by `declarationKind`, roles join
   validation only via an explicit `roles: [...]` opt-in. The
   owner-rejected (b) (name-based collection) died on the reviewer's
   fixture analysis: a typo'd export name would silently drop a role,
   making typo rejection probabilistic. The (c′) tsdoc must carry the
   *reason* string exports are not collected as roles — conclusion-only
   comments invite the next person to "improve" it back to (b).
4. **`db.fn` arguments = named object** (`db.fn.searchByStatus({
   status, limit })`), owner picked (A) after a full-UX comparison.

<a id="d8"></a>
## D8 — s (English rewrites, in order)

_owner · 2026-08-27T00:00Z_

1. Session opener: "What should I do next — is it g5 and g6's turn?"
2. On go-ahead: "Yes. For the record: the reason brainstorming happens
   *after* the OpenSpec proposal is for **elaboration, not drift**. If a
   fundamental problem exists, drift is possible — but I wanted you to
   know the intent."
3. D1 (pg factory): chose **instance-based with nominal `pg` typing**
   (the Drizzle-parallel option), over the assistant's recommended
   structural typing.
4. D2 (row representation): first replied "How does Drizzle handle
   this?"; after the assistant verified Drizzle's node-postgres session
   source (per-query `types.getTypeParser` overrides, identity for
   TIMESTAMP/TIMESTAMPTZ/DATE/INTERVAL plus array oids, delegation for
   the rest), accepted the recommended per-query override, scoped to
   interval only.
5. D3 (Supabase driver composition): "How does Drizzle do it? The
   difference between us seems large. Show (1) the Drizzle comparison
   and (2) the user UX of each option." After the comparison (Drizzle
   has no Supabase driver at all; its supabase module ships only
   role/table/helper constants, and its docs tell users to hand-write
   an RLS wrapper that splices JWT claims into SQL via `sql.raw`):
   "Let's go with option 1, the decorator. But looking at
   orm.drizzle.team/docs/connect-supabase, our syntax is more complex
   than theirs."
6. D4 (the complexity remark, turned into a decision): approved adding
   the `pgDriver(connectionString)` convenience overload to group 5.
7. D5 (asUser surface) — an extended exchange:
   - "Shouldn't it be both? Something like Supabase takes just the JWT
     and verifies it itself, while other setups decode sub/claims in
     the app and pass them."
   - "Why would I pass a secret? If I just hand over the JWT, the
     Supabase service verifies it on its own."
   - "I don't see why the secret is needed — isn't JWKS-based
     decoding the Supabase default? Hasn't HS256 gone away?"
   - "How does Drizzle do it?" (for this exact question)
   - "What if the user is on a custom JWKS — Supabase for the DB but
     Clerk or Auth0 for auth?"
   - "With Supabase third-party auth enabled, can't we just set
     `accessToken: async () => Clerk session token` in `createClient`
     like their example? Research it further."
   - "Show me the DX/UX a user gets under each option."
   - "No — I'm asking why *we* should verify at all. With Supabase or
     Clerk, their own verify functions run in middleware/providers and
     hand you verified claims (`getClaims`, `sessionClaims`). Why
     would an ORM carry verification? Just delegate to them."
   - "What exactly is the 'callback form'?"
   - Settled: **A — claims object only**, verification delegated to
     the app's auth layer, the claims-provider callback automation
     parked.
8. D6 (operations batch): approved as presented (prerequisite re-plan
   PR, `test:integration` convention, spec-delta file split, group 6
   changeset, parking issues, lockfile handling by the lead).
9. Mid-turn, separate thread: agent model names must be bare family
   names only (`opus`/`fable`/`sonnet`), never version-suffixed — and
   when the assistant saved that to session memory: "Not memory — put
   it into the skill." (Landed in the team-up skill's own blackbox.)
10. Mid-turn: "Where did the operations-batch queue go?" — calling out
    that the decision-queue ledger line had stopped appearing.

