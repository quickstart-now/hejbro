# Proposal: add-polyrepo-sync

## Why

A schema lives in one repository; the services that query it live in
others. Today a consumer repository has two options, and both are bad.
It can import the declaration source — which hands it migration
authority over a database it must never migrate — or it can hand-write
types, which are wrong the moment the schema moves and no tool can tell
you when.

Introspection cannot close the gap, because the database does not hold
what the type layer needs. Measured against `ColumnSnapshot`'s complete
field list (`packages/core/src/kinds/table-snapshot.ts:46-56`), five
facts a consumer needs are absent from the database, from the snapshot,
or from both:

- **numeric `mode`** — never reaches `typeNode`, the generated SQL, or
  the snapshot (`packages/core/src/types/column-builder.ts:27-28`), yet
  it decides both the visible type and the runtime conversion
  (`packages/query/src/db/convert.ts:718`).
- **`notNullElements`** — the flag itself is never serialized
  (`column-builder.ts:29-39`); without it every array element widens to
  `T | null` and the fail-fast guard disappears.
- **`columnKey`**, the column's TypeScript key — "TS-only meta, never
  serialized" (`packages/core/src/dsl/table.ts:114`), and
  `toSnakeCase` (`table.ts:192`) is one-way, so the SQL name cannot be
  turned back into it. Without it **every result row comes back with
  the wrong keys**.
- **the name each declaration was exported under** — a reverse relation
  key is `keyof TSchema` (`packages/query/src/types/relations.ts:67-79`)
  and a typed function call is keyed "exactly to the declarations
  record's own export names" (`packages/query/src/db/fn-types.ts:136-137`),
  yet the loader discards those names
  (`packages/cli/src/loader.ts:159-164`, `Object.values`). Views, enums,
  schemas and grants need no export name: none of them reaches a
  consumer's types.
- **role names** — the `db.as` whitelist is a union of four sources
  (`packages/query/src/db/db.ts:152-163`); a consumer holds no `grant`
  and no policy declaration, so two of the four are empty and every
  context is rejected fail-closed with no escape hatch.

So the schema has to travel, and the question is what carries it. This
change makes the **database itself** the medium: each migration carries,
inside its own SQL, an insert into an append-only manifest table, and a
consumer repository runs `hejbro sync` against that database to obtain a
schema module. The database is the one place both repositories already
agree on, it is exactly as fresh as the schema it describes, and it
needs no release, no registry, and no second distribution channel.

## What Changes

- **Manifest emission, opt-in, rendered by core.** When enabled, a
  generated migration carries an idempotent bootstrap
  (`create schema if not exists` / `create table if not exists`) and one
  insert into `hejbro.schema_manifest`. The payload is the snapshot plus
  a type-meta sidecar plus role names plus a format version, serialized
  by the same `stableJson` the snapshot itself uses
  (`packages/core/src/snapshot/snapshot.ts:185-186`) so it inherits that
  function's determinism rather than restating it, and minified onto a
  single line. A banner line carrying the manifest format version rides
  at the top of the file, machine-readable by its own prefix — the
  format's own extension point, which requires every parser to read its
  line by prefix and ignore unknown ones
  (`openspec/specs/migration-format/spec.md:18-25`). `[design]` settles
  the flag, the exact table shape, and the prefix.
- **hejbro writes these statements and never executes them.** The user's
  existing pipeline applies them, exactly as it applies every other
  statement in the file. D12 is untouched, and no command in this change
  acquires the authority to apply anything.
- **The CLI supplies, core renders.** The payload and its hash arrive as
  options on `generateMigration`, the way `hejbroVersion` already does
  (`packages/core/src/engine/generate.ts:135`), and core appends the
  statements to the array it already joins (`generate.ts:363-374`).
  Hashing and connections stay CLI-owned (`engine/chain.ts:118-119`).
  A CLI-side post-write would be caught — correctly — by
  `examples/postgres/test/chain.test.ts:86-88`, which compares the
  committed file against **core's** regenerated SQL.
- **Nothing clock-derived reaches the emitted SQL.** Generation is
  byte-deterministic (`openspec/specs/cli-commands/spec.md:418-431`),
  so the insert supplies no timestamp (the column defaults to `now()`,
  evaluated by the server at apply time) and **no migration id**: two of
  the three prefix strategies are clock-derived
  (`packages/core/src/sql/migration-file.ts:31-44`), and the file name
  is not even computed until after the SQL is rendered
  (`packages/cli/src/commands/generate.ts:587-607`). Ordering is owned
  by the database instead — an identity `seq` column — which is also
  what makes "behind by N" countable.
- **Monotonicity.** Once a chain carries manifest statements, it keeps
  carrying them: `generate` refuses with a coded error when the chain
  has them and the current configuration does not, and `verify` detects
  the same condition locally against a hand-edited chain. Turning the
  option off silently would leave the database's newest manifest row
  describing an older schema, and every freshness check downstream would
  pass — the exact silent fail-open this change exists to remove.
- **`DeclaredTable`: migration authority becomes a type.** `table()`
  returns a branded declaration; the brand is an optional phantom member
  on the intersection, so `Table` itself is unchanged and its hover
  output is preserved (the technique is already in use —
  `column-builder.ts:168-198`). `HejbroInput`
  (`packages/core/src/engine/generate.ts:36`) narrows to the branded
  form: measured, that is the single type-level chokepoint, and the
  query layer needs only `Table` (`packages/query/src/db/db.ts:45`,
  `:112-117`), so a synced module queries exactly as a declared one
  does. A synced module reaching `generate` is refused by a coded
  error at one structural point — the shape `existingTable` already
  proves (`existing-table-declared`, `engine/generate.ts:83-89`).
  `[design]` settles the code name and which of the two candidate
  points owns the refusal. The brand is acquired by calling `table()`
  and by nothing else, which is what makes the refusal a decision
  rather than a heuristic.
- **`hejbro sync`.** Entry is `--db-url` then `DATABASE_URL` then a
  coded refusal, and the driver is a dynamic import declared as no
  dependency kind at all — the `check` command's own contract
  (`packages/cli/src/check/driver.ts:14-28`, `:30-31`). It reads the
  newest manifest row and writes one schema module: one **usage
  constructor** call per table, an exported role list, and an exported
  stamp. `--check` compares without writing. `--schema` parses and
  refuses as reserved.
- **A synced module never calls `table()`.** The brand exists only where
  `table()` puts it, so a generated module that called it would hand
  itself the very authority this change removes. `sync` emits a usage
  constructor instead — it yields a plain `Table`, carries everything a
  consumer needs (columns, `mode`, `notNullElements`, the TypeScript
  keys, the export name, references), and cannot produce a
  `DeclaredTable`. `[design]` settles its name and whether it extends
  the `existingTable` shape (a `Table` already built without migration
  authority) or stands on its own. Nothing stops a consumer from
  writing `table()` by hand; the guide says why not to.
- **The stamp is an exported value, not a header comment.** Both
  consumers must read it, and `assertSchema`'s import graph forbids
  `node:*` (`packages/cli/test/assert-schema-imports.test.ts:23-27`,
  specified at `openspec/specs/query-execution/spec.md:642-651`), so it
  can never read its own source file. A human-readable header comment
  rides on top; the contract is the value.
- **Drift is three states, not one.** (i) no manifest table, (ii) the
  table exists but holds no row for this chain — the state a `baseline`
  adoption sits in, because a baseline migration is registered rather
  than run (`openspec/specs/cli-commands/spec.md:14-17`, `:47-51`) —
  and (iii) a row exists and newer rows follow it: *behind by N*. Each
  state gets its own code and its own remedy.
- **`assertSchema` gains the same three states without gaining a
  hash.** The CLI's only hash function imports `node:crypto`
  (`packages/cli/src/hash.ts:1`), which that import graph forbids, so
  the check is a string comparison between the module's exported stamp
  and the manifest row, plus a count of the rows after it. The handle
  type is unchanged: the stamp arrives inside `handle.schema`, and the
  query goes out through `handle.driver`.
- **Roles ride the existing opt-in.** The synced module exports its role
  list and the consumer passes it as `options.roles`. No file under
  `packages/query` is edited and `rls-execution-context` is not
  modified — measured, and the code states the reason itself
  (`packages/query/src/db/db.ts:53-64`: auto-collecting string exports
  "would let a *typo'd* role name coincidentally match one of them and
  pass validation", while "opt-in via `roles` keeps that rejection
  deterministic").
- **Config becomes honest about who needs what.** `migrationsDir`,
  `snapshotPath` and `prefixStrategy` are meaningless in a repository
  with no migration authority; they become optional and the commands
  that need them refuse with a coded error, the shape `baseline`
  already uses to narrow its own flag surface
  (`openspec/specs/cli-commands/spec.md:36-42`). `[design]` settles how
  far the relaxation goes and what a consumer repository is asked for.
- **The loader preserves export names**, because the reverse relation
  key is one. `[design]` settles the shape.
- **Documentation**: `docs/guide/polyrepo.md` with a CI drift-check
  workflow template (triggered by change, never by schedule),
  `skills/hejbro/references/polyrepo-sync.md`, and its row in
  `skills/hejbro/SKILL.md`'s References table.
- **One `minor` changeset**, and a `sync` reachability assertion in
  `scripts/pack-install-smoke.sh`'s assertion 3 — a database-free
  assertion, because that script has no server.

## What crosses the boundary and what does not

This section is a contract, not a caveat.

**Crosses**: the snapshot; the four facts the snapshot does not hold
(`mode`, `notNullElements`, `columnKey`, the table's export name); role
names; the manifest format version; the snapshot format version.

**Does not cross**: `$type` brands. `.$type<T>()` is a runtime identity
method whose only effect is on `TMeta`, leaving "no brand trace anywhere
runtime-visible" (`column-builder.ts:424-429`) — so the generator cannot
read the brand at emission time. The deeper reason is that a brand *is*
a TypeScript type, and that type does not exist in the consumer
repository at all. A synced consumer therefore sees a branded `json`/
`jsonb` column as `unknown`, which is D97's own default for an unbranded
one — the honest answer, not a degraded one. The guide and the skill say
so, and say where to put code that needs the brand: in the
schema-owning repository.

There is a shape that would carry a brand — `$type<T>(name)` recording a
name, the manifest carrying `{column → brandName}`, `sync` emitting
`import type` against a consumer-supplied brand module, and a missing
export failing closed. It is not impossible; what is unsettled is
whether that module is the consumer-side override patch layer the owner
rejected. That classification is filed as **#576** and is not decided
here. The manifest format therefore carries a version field from the
first row, so a `brands` field can be added later without a migration
of its own.

## Size, and why the payload is carried whole

A manifest row must be self-contained, because `sync` reads only the
newest one. So every enabled migration carries the whole payload, and
that is measurable rather than arguable. Against `examples/postgres`:
the payload is ≈17.9 kB minified, which turns the smallest migration in
that chain (417 B) into ≈18.3 kB — **44×** — and the whole chain
(15.4 kB) into ≈177 kB — **11.5×**.

The cost is accepted, for three reasons that are also measurable. The
same content already ships on every generate: `hejbro.snapshot.json` is
24.6 kB and changes in full whenever the schema does, so the manifest
adds a second copy of an artifact reviewers already skip rather than a
new class of noise — and a test pins that it *is* the same content, so a
reviewer who reads the snapshot has read the payload. Minified, that
copy is **one line** in a diff, while the DDL a reviewer actually reads
stays above it, ahead of the marker. And the guide states the size
property in numbers, so enabling the option is an informed act.

Three smaller payloads were measured and rejected.

**A consumer projection** — tables, columns, foreign keys, enums, view
column lists, function signatures, roles, sidecar; policy bodies,
grants, RLS nodes, triggers, checks and indexes dropped — is 6.9 kB,
61.7% smaller, and still 17.5× the smallest migration. It does not
change the character of the cost, and it buys that reduction at a poor
price: 60% of the saving comes from policy bodies and table checks,
which are large only because expressions are stored as structured nodes
(D67/D70), not because a consumer has no use for them; it forecloses
the static grant/RLS warnings D96 keeps open; it needs a second format
with its own version axis and its own determinism tests, where reusing
the snapshot's serializer costs zero lines; and it reopens a settled
discipline — `check` and `assertSchema` must report what they did not
compare, by name and reason (`openspec/specs/cli-commands/spec.md:284-308`),
and a projection makes "absent from the manifest" a third category
nobody has defined.

**Dropping only the expression nodes** — policy bodies and table checks,
the two items that account for 60% of the projection's saving — is
6.5 kB smaller and keeps every object the schema has. It is the smallest
conceptual change of the three, and it is still rejected: the payload
stops being the snapshot while `snapshot_hash` continues to be the
snapshot's hash, so the row carries a hash of something it does not
contain. Restoring that correspondence means hashing the payload
separately, which adds a second integrity axis to save four kilobytes.

**Reconstructing from the sidecar plus live introspection** — carrying
only the four missing facts and reading the rest from the database — is
smaller still and is rejected on principle. It reintroduces two sources
for one truth, where the declarations say one thing and the catalog says
another, which is the failure mode this project exists to remove and the
one a result-shape type layer with an override patch already
demonstrated elsewhere.

## Capabilities

### New Capabilities

- **`schema-manifest`** — what a migration writes into the database
  about itself: when it is written, what it contains, how it is ordered,
  how the chain stays monotone, and what a reader may conclude from a
  row. This is the positive contract for an on-disk-and-in-database
  artifact, and it is the anchor for everything this change generates:
  an exception carved out of a prohibition would not state what is
  written, only what is permitted.
- **`schema-sync`** — the boundary command: how a database becomes a
  schema module, what that module contains and guarantees, the three
  freshness states and their remedies, and what the module is forbidden
  to do (migrate).

### Modified Capabilities

- **`cli-commands`** — the new command joins the command surface, and
  the configuration fields that only a migration-authoring repository
  needs become optional with per-command refusals.
- **`query-type-inference`** — a **clarification**, not a carve-out. The
  existing requirement forbids generating "`.d.ts` or any other on-disk
  type artifacts **for queries**"
  (`openspec/specs/query-type-inference/spec.md:323-326`), and a synced
  module is not one: it is a module of runtime values, and query types
  are still *inferred* from them, because a table's type is captured
  from its argument literal (`packages/core/src/dsl/table.ts:1255-1260`).
  Carving an exception out of a prohibition that never covered this
  would license the artifact without describing it — the appearance of
  a rule where there is none. So the prohibition stays whole and gains
  one sentence placing the boundary module outside it, the existing
  scenario stays untouched, and the load-bearing anchor is
  `schema-manifest`'s and `schema-sync`'s positive requirements.

### Explicitly not modified

- **`rls-execution-context`** — the four-source union stands as
  specified. A synced module supplies role names through the source the
  specification already names ("a role the caller explicitly opted into
  on the db handle itself"), so the whitelist's fail-closed guarantee is
  used, not widened.
- **`snapshot-format`** — the manifest embeds the snapshot; it does not
  change it. No format version moves.
- **`migration-format`** — the banner is unchanged in meaning. Whether
  the monotonicity marker is a new banner line is `[design]`, and
  `[design]` alone decides whether that touches this capability.

## Impact

- **Affected code**: `packages/core/src/engine` and `packages/core/src/sql`
  (render only — text, no I/O, no hashing), `packages/cli` (new command,
  payload assembly, loader export names, config, `assertSchema`),
  `skills/hejbro`, `docs/guide`, `scripts/pack-install-smoke.sh`.
  **No file under `packages/query`, `packages/pg`, `packages/supabase`,
  `packages/neon` or `packages/nile` is edited.**
- **Breaking**: none. The emission is opt-in, and with it off, core's 50
  golden `.sql` files and every committed example chain are
  byte-identical — the same shape the `-- hejbro: <version>` banner line
  already demonstrates (present in examples, absent from all 50
  goldens).
- **Core purity**: rendering a statement is string construction, which
  core already does for every statement it emits. The hash and the
  connection stay in the CLI, as `chain.ts:118-119` requires.
- **`examples/`**: unchanged. The two-repository witness lives beside
  the CLI's existing live suites rather than in a new example package,
  so no workspace package, no vitest configuration and no derived gate
  (package counts, source roots, the pack-install smoke) moves.
- **CI**: the witness needs a real Postgres, and CI runs none
  (`.github/workflows/ci.yml:81-164` has no `services:` block and no
  `test:integration` step). It is therefore excluded by pattern, the way
  the existing live suites are (`packages/cli/vitest.config.ts:13-17`),
  and every specification scenario keeps a database-free failing test in
  the default run.

## Open decisions (`[design]`, settled before the code that depends on them)

1. The opt-in flag: its name, and whether it lives in `hejbro.config.ts`
   or on the command.
2. The bootstrap and table shape: column set, the identity column, and
   whether the payload column is `jsonb` (queryable by plain SQL —
   the owner's stated diagnostic requirement) or `text` (byte-preserving,
   required only if the design re-hashes the payload itself). The two
   are mutually exclusive; settled as `text`, for the reason recorded
   under Known limits.
3. How the payload is quoted inside the emitted SQL. Core's only helper
   doubles single quotes (`packages/core/src/sql/literal.ts:2-3`), which
   leaves a backslash in the payload at the mercy of a server with
   `standard_conforming_strings` off — a risk we have not measured and
   will not carry. The leading candidate is a fixed dollar-quote tag
   with a fail-closed guard: if the payload contains the tag as a
   substring, generation refuses with a coded error rather than emitting
   something that might parse differently than it reads.
4. The monotonicity marker: what it is, where it is read, and whether an
   unknown banner line is ignored or refused by today's parser.
5. The refusal code for a synced module reaching `generate`, and which
   of the two candidate points owns it (single chokepoint).
6. The five freshness codes and their remedies, including whether the
   "no row yet" remedy prints the insert statement the baseline file
   already contains, and how the two format-skew directions are named.
7. How a foreign key whose target is outside the manifest is emitted —
   a schema that references a table it declares as pre-existing has an
   edge whose other end the manifest does not contain. The leading
   candidate keeps the column and omits only the derived relation.
8. Which row a stamp matches when more than one row carries the same
   snapshot hash — a schema reverted and then restored produces exactly
   that. The leading candidate is the newest such row, which makes the
   counted distance the smallest true one.
7. The upper bound on what a drift failure's text may assert. What is
   detected is a hash mismatch and a row distance; the text may say
   that and nothing more — never a cause it did not observe.
8. The synced module: file name, header, and the exact names of the
   exported stamp and role list.
9. How far the config relaxation goes, and what a consumer repository is
   asked to provide — including where the module's path comes from,
   given that a consuming repository's declaration entry is the module
   `sync` has not written yet on the first run.
10. The loader change that preserves export names.
11. `seq` presentation in diagnostics (the owner's "0042" form).
12. The two-repository witness's shape.
13. The usage constructor `sync` emits: its name, and whether it extends
    the shape of the existing authority-free `Table` builder or stands
    on its own. It must carry columns, `mode`, `notNullElements`, the
    TypeScript keys, the export name and references, and it must be
    unable to yield a branded declaration.

## Decision log entries (draft — this change's approval gate)

**D97, amended.** Inside the schema-owning repository, query types come
from type-level inference over the declarations and nothing is
generated — unchanged and absolute. At a polyrepo boundary, where a
repository queries a schema it does not own and must not migrate,
`hejbro sync` writes a **declaration** module of runtime values, from
which query types are still inferred. What D97 rejected was an artifact
"periodically overwritten and hoped fresh"; an artifact whose staleness
is a loud, quantified failure in CI and at startup is not that. The
carve-out is the boundary and nothing wider.

**D108 (new).** **Schema distribution across repositories is a
database-mediated manifest, not a package.** Each migration carries an
append-only manifest row inside its own SQL — hejbro writes those
statements and never executes them, so applying stays out of scope
(D12). Emission is opt-in and, once enabled on a chain, monotone: a
chain that carried a manifest and stops is refused, because the stale
newest row would make every downstream freshness check pass. Ordering is
the database's (an identity column), never a file name, because two of
three prefix strategies are clock-derived and the emitted SQL must stay
byte-deterministic. History exists to make drift quantitative ("behind
by N"); there is no version-pin flag. The boundary artifact is a runtime
value module carrying the four facts the snapshot does not hold plus
role names; `$type` brands do not cross, and a branded column reads as
`unknown` in the consumer. Connection entry is `--db-url` then
`DATABASE_URL` only — the presets hold no connection knowledge to
shorten (zero of the three read a connection string, and Supabase's
endpoint is declared, never detected), so a preset shortcut would be an
alias invented to look helpful.
*Rejected*: distributing types as an npm package (staleness with no
verification, and a release coupling between repositories that ship on
different cadences); generating from introspection alone (four of the
five needed facts are not in the database); a type-only artifact (the
query API is value-driven, so the consumer needs values); a
consumer-side override patch layer; a version-pin flag (it would make a
consumer's staleness a supported configuration). Migration authority is
a type brand acquired by calling the declaration constructor and by
nothing else, so a synced module — which calls a usage constructor
instead — is refused by the generator structurally rather than by
inspection.

## Measurement protocol (Rule 50, pre-registered)

This change makes no performance claim, so no dispersion estimator
applies. It does make a determinism claim, and the way that claim is
tested is fixed here, before implementation:

- **Instrument**: two `generate` runs over identical declarations and an
  identical parent snapshot, separated by an injected clock difference
  large enough to move every prefix strategy, compared byte for byte.
- **Judgment rule, fixed in advance**: any byte difference fails the
  claim. A difference is never explained away as "only the timestamp" —
  that is precisely the failure mode.
- **A second, independent check** asserts the absence of the cause
  rather than of the symptom: the emitted manifest statements contain no
  value derived from a clock or from a file name. Two checks because a
  passing byte comparison could be an accident of a fast test run.
- **The live witness is corroboration, never the gate.** Every scenario
  keeps a database-free failing test; the Docker-gated two-repository
  run proves what a server actually received and is excluded from
  `pnpm test` and from CI by pattern.
- **Direction of the caveat**: measurements of today's repository are a
  floor. Where a claim rests on reading source rather than running it,
  the specification states what is asserted and the task names the test
  that makes it true.

## The two-repository witness, and what it is not

A stub proves what `sync` wrote. Only a server proves that a migration's
own SQL put the row there and that a second repository read it back. The
witness is therefore end to end: apply a schema repository's chain to a
container, run `sync` in a consumer fixture, type-check the consumer's
queries against the generated module, and let `assertSchema` pass and
then — after one more migration is applied — fail with a counted
distance. One more end-to-end assertion belongs here and nowhere else:
running `generate` against the synced module is refused with its coded
error, which is the only place the whole authority boundary is exercised
by real files rather than by types.

Four constraints keep it honest and cheap: it reuses the existing
recipes rather than inventing one (`examples/cli-smoke/test/e2e.test.ts`
for the built-CLI spawn and its stale-build guard,
`scripts/roundtrip.sh:57-83` for a temporary project with relinked
`node_modules`); it needs no new workspace package and no new vitest
configuration, joining the CLI package's existing Docker-gated suites,
which are already excluded from the default run by pattern; it never
reports success when Docker is absent; and it lives in its own task
group so a Docker dependency never contaminates a group that has none.

Both "repositories" are temporary directories the test builds, so the
witness pins the boundary rather than a checked-in example, and the
scenarios that need a server — a chain applied from a later migration,
a distance counted across rows applied within the same second — are
paired here with the shape assertions that stand in the default run.

## Known limits

One is accepted rather than defended against, because the defense would
cost more than the failure.

- **A naive apply tool that splits on semicolons can mis-split the
  dollar-quoted payload.** Tools that parse SQL — psql included — do not,
  and psql is what the witness exercises. Working around the naive case
  would mean giving up dollar quoting, which is the thing that makes the
  payload safe to embed in the first place.

The payload column is `text`, not `jsonb`, for one reason: `jsonb` does
not preserve key order, so the stored row would stop being the snapshot
bytes while `snapshot_hash` went on being the snapshot's hash — a row
carrying the hash of something it does not contain. Diagnosing a stored
manifest in plain SQL costs one `::jsonb` cast and is otherwise
unaffected.

The manifest table is invisible to `check`: that command compares
declared schemas only, so an undeclared schema and everything in it is
never reported as drift. That invisibility is a consequence of a choice,
not a property of the name — **the manifest table is deliberately not
declared through the DSL.** Declaring it would put its schema into the
declared set, and everything else that ever appears in that schema would
begin reporting as unmanaged. Anyone converting the bootstrap from
rendered SQL into declarations is changing this outcome too.

## Out of scope

- **Carrying `$type` brands across the boundary** (#576) — the
  classification question is the owner's, and the manifest's version
  field keeps the door open.
- **Preset connection shortcuts.** Measured: no preset reads a
  connection string or an environment variable, and Supabase's endpoint
  is "declared, never detected". A `--supabase` flag would shorten
  nothing it is entitled to know.
- **Implementing `--schema`.** It is parsed and refused as reserved, so
  the flag's meaning is fixed now and its behavior can arrive without a
  surface change.
- **Emitting function declarations into a synced module** (#587). The
  approved consumer surface is the type layer of tables; a typed function
  surface is a new scope, not a detail of this one. The manifest carries
  function export names anyway, so that version needs no format change —
  which is exactly why the fact is carried now rather than later.
- **Applying migrations** (D12), including any command that would write
  the manifest row itself.
- **A version-pin flag** (`--at`). Owner-settled: pinning would make a
  consumer's staleness supported instead of visible.
- **Regenerating the existing example chains.** The option is off for
  them, and turning it on would rewrite committed migrations for a
  demonstration the witness already provides.
