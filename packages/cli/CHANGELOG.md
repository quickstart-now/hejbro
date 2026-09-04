# hejbro

## 0.2.0-pre.1

### Patch Changes

- 75f0bbe: Fixes three silent failures: `hejbro init` now honours an existing `hejbro.config.ts`'s `migrationsDir`/`snapshotPath` instead of always scaffolding the default paths, a vendored contract no longer silently drops a table, column, or function named `__proto__`, and `db.fn` now refuses a pre-built argument object that names a key its declaration doesn't, instead of silently sending `null`/`undefined` for the misspelled argument.
- d5cda78: `hejbro init` now refuses, with a coded diagnostic instead of a raw filesystem crash or a silent partial run: a configured migrations directory or snapshot path spelled with a trailing separator that holds a file, a file sitting in a configured artifact's own ancestor directory chain, two configured fields that resolve to the same path, and a directory sitting where `hejbro.config.ts` itself belongs. The name-keyed vendored client (`createDb`) also now refuses a table or function lookup by an inherited `Object.prototype` name (`__proto__`, `hasOwnProperty`, ...) the contract doesn't actually vendor, instead of silently resolving to `Object.prototype` and throwing an uncoded error on the call.
- adb916c: `check` under a preset that declares no planning (`explainUnavailable`) no longer normalizes the inside of a string literal — a quoted word or a qualifier-like name inside a literal is content and a difference it carries is reported as not compared; a reserved keyword stays quoted under the identifier-unquoting step; and a failed catalog read in that mode gets a `Next:` that names the catalog read instead of `EXPLAIN` (naming `pg_get_expr`, the read that fails). The cast-stripping step now strips the whole cast the server appends to a string literal — `text[]`, `character varying(20)`, `timestamp with time zone`, a schema-qualified or quoted type name — not only a single-word type name.
- 6973aab: `hejbro reset` on a database that was never migrated by hejbro (every migration applied via `psql -f` or another external pipeline, so `hejbro.migration_ledger` never existed) now drops the declared objects instead of reporting success and doing nothing. Its coded `reset-drop-failed` error now names which step actually failed (dropping the objects or clearing the ledger afterward) instead of always claiming a failed drop, carries the database's own `DETAIL` line, and — only when the run's own declared objects include a pair that reference each other — adds that possibility alongside the existing one (an object outside your declarations), without asserting either as the cause: the server's own `DETAIL` is what names the actual dependent.
- e22ea23: `hejbro reset` now orders its drops by the declared tables' own foreign keys, so a table referenced by another declared table drops after its dependent instead of failing on an arbitrary alphabetical order; a drop the database refuses (something outside your declarations still depends on what's being dropped) is now reported as a coded `reset-drop-failed` error with the transaction rolled back, instead of an uncaught crash — the database and the migration ledger are left exactly as they were. `hejbro verify` now also runs any registered preset validators as an additional check, refusing a declaration with the same coded error `hejbro generate` itself would report for it, rather than passing a declaration `generate` would refuse. `hejbro generate` now emits statements in dependency order within a kind (a referenced table before the table referencing it, alters included); the migration's file name is unchanged by this ordering.
- Updated dependencies [333dae8]
- Updated dependencies [b02443a]
- Updated dependencies [17f5495]
  - @hejbro/core@0.2.0-pre.1
  - @hejbro/query@0.2.0-pre.1

## 0.2.0-pre.0

### Minor Changes

- 93c2caf: The apply engine (#603, D12 amended): hejbro now owns applying a
  migration chain to a database, production included. `hejbro migrate`
  applies every pending migration in chain order, each inside its own
  transaction with a transaction-scoped advisory lock
  (`pg_advisory_xact_lock`) serializing concurrent runs — a runner that
  has to wait rechecks the ledger inside that same lock before sending
  anything, so it applies only what the winner did not already commit,
  and neither run fails. `hejbro status` reports what the ledger records
  and what is pending, read-only. `hejbro reset` destroys only what the
  declarations manage and clears the ledger, refusing without an exact
  `<database>:<count>` confirmation naming what it would drop. `hejbro
  raise` stands an empty database up from a snapshot SQL file (a vendored
  one, or any other) in one transaction, refusing a database that already
  has hejbro history. A migration that fails reports the database's own
  code and message plus the next command to rerun; one that adds an enum
  value and uses it in the same run is split across two migration files
  at the transaction boundary Postgres itself requires
  (`generateMigrations`, `@hejbro/core`'s new plural entry point). The
  supported Postgres floor is now an explicit, tested policy — currently
  15, for `security_invoker` on views.
  
  The ledger now records how each row entered it, and `hejbro status`
  reports what that history shows: which migrations it applied, which
  baseline migration it registered without running, and — told apart —
  a ledger table that has never existed versus one that exists with no
  rows yet. `hejbro migrate` verifies the migration chain before it opens
  a database connection at all, so an unverifiable chain is refused
  without sending anything. `hejbro reset` refuses a declaration set that
  exports nothing, before touching the database, the same way `check` and
  `baseline` already do for a misconfigured entry point. A migration run
  that adds a value to an existing enum type and also spells that value
  inside a `sql` template or `sql.raw` — a check constraint, a policy
  expression, an index predicate — is now split the same way a typed
  column default already was, instead of shipping one migration that
  fails against the database after passing every check hejbro has.
- eb09af8: `assertSchema(handle, options?)` checks that the database
  `handle.driver` is actually connected to matches every declaration
  `handle.schema` exports — the same comparison `hejbro check` runs from
  the CLI, callable from application code (a startup check, a health
  endpoint, a test suite) instead of only the command line. Opt-in and
  explicit: constructing a `db()` handle never connects or reads anything
  on its own, and `assertSchema` is the only thing in this surface that
  does.
  
  Resolves to a report (`{ compared, notCompared }`) on a clean match —
  `compared` names every declared identity actually compared against the
  live catalog, `notCompared` names any it could not, each with a reason.
  Every failure carries a stable `code` — the error's own class is not
  part of the contract — and `assertSchema` itself raises exactly three:
  `assert-schema-diverged` (at least one compared declaration doesn't
  match the database), `assert-schema-not-compared` (a declaration should
  have been compared and couldn't, or the schema module declares nothing
  at all — `options.allowNotCompared` opts out of failing on the former
  without silencing a real divergence), and
  `assert-schema-catalog-unreadable` (the database catalog itself could
  not be read). A declaration no registered kind owns at all propagates
  `generateMigration`'s own `unowned-declaration` unchanged, before the
  catalog is ever read.
- 3a7f645: `hejbro baseline` adopts a database hejbro did not create. It writes the
  same first migration and snapshot `generate` would, marks that migration
  in its banner as describing objects that already exist — register it as
  applied, do not run it — and says so in its report before you can run the
  file. `verify` accepts the chain it starts, and every later `generate`
  emits only what changed. It refuses on a project that already has
  migrations, naming `generate` instead (#385).
- ef12376: Catalog inference (#604): `hejbro import --schema <name> --out <dir>`
  reads a live database's catalog, read-only, and writes one starter
  declaration file per schema using the DSL's own builders — the
  introspection-assisted seeding half of #385 that hand-writing
  `table()` declarations previously left entirely manual. `--schema` and
  `--out` are both required with no default (a hosted Postgres's own
  platform schemas are schemas too, and adopting them by default is
  never wanted). A column whose SQL name no declaration key can
  round-trip is left out of the starter file and named in the loss
  report, which every file's own header also carries in full; two
  schemas whose tables reference each other never produce files whose
  imports form a cycle — the closing foreign keys go through an
  unexported reference-only handle instead. `import` never overwrites an
  existing file.
  
  `hejbro pull --db-url <db> --schema <name>` is the new database-sourced
  fallback for a vendored contract, for when the schema repository
  `link`/`vendor` need isn't reachable: it writes into the exact
  destination `hejbro vendor` does, marked with no commit, so `vendor
  --check`/`outdated` refuse to compare it against one (naming `link` as
  the way to a commit-anchored contract instead).
  
  `ContractOrigin`/`ContractMetadata` (`@hejbro/query`) are now a
  discriminated union on `source` — `"git"` (vendor's own, `commit`/
  `exportHash`) or `"database"` (pull's own, `database`/`schemas`) — so
  code that forgets the database-sourced case fails to compile rather
  than at run time. A contract a pre-#604 `hejbro vendor` already wrote
  and committed keeps type-checking unchanged after upgrading.
- e423f30: `hejbro check` compares your declarations against a live database's
  catalog, object by object, without ever writing to it — read-only, no
  transaction, no migration applied. It resolves a connection from `--url`
  or `DATABASE_URL` (never `hejbro.config.ts`) and needs `@hejbro/pg`
  installed — declared as no dependency kind at all, not a dependency and
  not a peer, optional or otherwise, so installing `hejbro` never pulls in
  a Postgres client for the commands that never connect. Every declared kind is checked for existence
  by identity; a column's type, `notNull`, and default are compared with
  the measured display normalizations (`format_type`'s long names, a
  default's trailing cast, a negative literal's quoting); primary keys,
  unique constraints, foreign keys, and indexes are checked for existence
  only; a check constraint's expression is compared by rendering the
  declared and the catalog's own text through the server in one
  statement, so a rewrite-on-write (`in (...)` becoming `= ANY(...)`, for
  instance) never false-positives, and a constraint the database is not
  enforcing on existing rows (`NOT VALID`) is reported even when its
  expression matches. Every catalog read is role-independent (grants read
  through `aclexplode(coalesce(relacl, acldefault(...)))`, never a
  role-filtered `information_schema` view), and a read that fails outright
  is a coded error, never silently read as "the object does not exist".
  
  The exit code answers three questions, not two: `0` everything compared
  agreed, `1` at least one declared object is missing or differs (the
  stronger fact, so it wins even alongside something else that could not
  be compared), `2` the run could not answer — something could not be
  compared (e.g. a role without EXPLAIN privilege on a table), or the
  declaration set was empty. `2` is never folded into `0` or `1`, so a
  read-only CI role's "could not compare" never reads as either a false
  pass or indistinguishable real drift. The report always states its own
  coverage boundary (view bodies are not compared; several axes are
  existence-only; its reads are not one snapshot) and prints an inventory
  of tables inside your declared schemas that no declaration covers, and
  the database's installed extensions — informational, never a finding,
  never affecting the exit code.
- 518dcdd: Schema across repositories (#314): a schema repository commits an
  export (`hejbro generate --export`) and a consuming repository vendors
  it over git — `hejbro link <repository>` records the source, `hejbro
  vendor` fetches one commit's export and writes `.hejbro/vendor/
  {schema.json, snapshot.sql, contract.ts}` plus `hejbro.lock`, `hejbro
  vendor --check` compares offline (CI's own gate), and `hejbro outdated`
  reports staleness without failing. The generated `contract.ts` exports
  a `Database` interface, `contractMetadata`, and `createDb(conn)` —
  `@hejbro/query`'s new `createNameKeyedDb` binds a real, unmodified
  `db()` handle to it, so a vendored contract queries exactly like a
  locally declared schema (`select`/`insert`/`update`/`deleteFrom`,
  `.where(eq(...))`, relations), with no `Table`-typed value anywhere in
  its public surface. Role names travel with the contract and opt-in is
  a call (`client.as({role})`), not a construction-time argument — the
  generated client adopts nothing on its own. Eleven named failures are
  each their own coded diagnostic with its own remedy repository;
  `--strict`/`--no-strict` (default: fail outside a TTY) governs the one
  situation still open to judgement — a lock resolved from a non-default
  ref. A monorepo consumer in the same workspace as the schema keeps
  using a plain alias import instead — `link`/`vendor` are for an actual
  repository boundary, including a locally cloned neighbor repository.
- 9a41a5b: The `hejbro` barrel now re-exports `@hejbro/core`'s declaration and
  query vocabulary only — schema and table builders, column types,
  expression, aggregate and window helpers, the query builders, the
  banner readers, `HejbroError` and the user-facing utilities — plus every
  core type. Core's engine (renderers, codecs, the diff and generation
  machinery, kind definitions, the snapshot codec, traversal tables,
  internal brands and helpers) no longer appears on `hejbro`; import it
  from `@hejbro/core`, where presets and sibling packages always did. The
  classification is complete by construction: a core export in neither
  list fails `hejbro`'s own tests, and the barrel's runtime export set is
  pinned by set equality.
- 0c31123: An exported `existingTable()` is now a declaration, not just a
  reference — it reaches the snapshot (marked existing), the export
  description, and a vendored contract's `Tables` entry, the same as a
  managed table's shape does. `generateMigration` diffs nothing about an
  existing table's own identity and emits no statement for it: adding
  one, changing its declared columns, renaming it, or removing the
  declaration entirely all write a migration named after that table but
  carrying no DDL for it — the run anchors the new state in the chain
  without ever creating, altering or dropping anything the table owns —
  and none of them can block or refuse an unrelated managed change in
  the same schema either. A managed table's foreign key onto an
  existing one resolves to a relation in the contract exactly as one
  onto a managed table does; a reference to a table the schema does not
  declare at all still has none. Preset validators (Supabase, Nile)
  skip existing declarations — they judge managed DDL, not table
  references.
  
  Handing a managed table to `existingTable()` emits nothing at all —
  neither the table nor anything on it (its sequence, its row-level
  security, its policies) is dropped. Adopting an `existingTable()` into
  a managed `table()` the other way emits no `create table` for the
  table itself, and creates exactly three things a handover also spares
  — a serial column's sequence, row-level security, its policies. It does
  not yet create the declaration's own indexes, check constraints,
  foreign keys, or primary key, even though the snapshot afterwards
  records them as if it had (#671).
  
  A run whose snapshot moves without any statement — an `existingTable()`
  recorded, forgotten, released, adopted or reshaped, or an ordinary managed
  declaration merely restated (two `index()` or `check()` entries swapped in
  order) — writes a migration carrying no statements, named after the table
  (`restate_<table>` for the plain reorder), so `verify` stays anchored to
  the chain.
- 3b5b348: A vendored contract (`hejbro vendor`) now carries every `defineFunction`
  declaration the schema repository exports, not just its tables. The
  generated `createDb(conn)` client gains a typed `fn` member — `db.fn
  .searchByStatus({ status: "published" })` — calling a vendored function
  exactly like `db.fn` already does for a local `db()` handle built from
  declarations in the same repository, including through `db.as(context)
  .fn` for a role-scoped call. `Functions` is keyed by each function's own
  export name from the schema module (`Tables` stays keyed by SQL name,
  matching `db()`'s own table keying) — the two groups use different rules
  on purpose, since a function's export name and a table's SQL name are
  independently-sourced namespaces that can collide without either one
  disappearing from the generated client.
- e6c802c: D106 R3-B3: a foreign key can now carry an explicit `name`
  (`extras.foreignKeys`'s own optional field, validated per D36 the same
  way `index()`'s optional name already is) — `hejbro import`/`pull` set
  it automatically whenever a database's own foreign key name is
  expressible, so a database hejbro did not create (most often named
  `<table>_<column>_fkey`, Postgres's own default) keeps its real
  constraint name through `generate`/`check` instead of drifting
  permanently to hejbro's own derived `<table>_<columns>_fk`. A name
  identical to the derived one is never written, so a hejbro-created
  database's own starter files stay byte-identical. When the catalog's
  own name isn't a valid hejbro SQL identifier, the reading falls back
  to the derived name and the loss report names the approximation.
  
  `@hejbro/core` exports `deriveForeignKeyName` and `assertSqlName` (the
  same D36 rule this feature validates a foreign key's own name against)
  for callers that need the same derivation/validation rule this feature
  uses internally.
- aad5078: Fixes from an adversarial review of the day's nested-transaction and
  `hejbro baseline` merges (#445).
  
  A second nested transaction started on the same `tx` while the first is
  still in flight now fails fast with `concurrent-nested-transaction`,
  before any savepoint statement is sent — concurrent siblings used to
  interleave one `SAVEPOINT` sequence on a single connection, silently
  discarding one sibling's work or aborting the whole transaction
  depending on the interleaving. A `RELEASE` that fails after a swallowed
  statement error now attempts `ROLLBACK TO` and surfaces
  `savepoint-release-failed` advising rethrow over swallow, instead of a
  bare `query-execution-failed`. A synchronously throwing nested callback
  now rolls back like a rejected one, and a rolled-back savepoint is
  released too, so no savepoint outlives the nested transaction that
  created it on any exit path. `savepoint-rollback-failed`'s message no
  longer asserts a false outcome.
  
  `hejbro baseline` over declarations that load but export nothing now
  fails with `baseline-nothing-to-adopt` instead of reporting a false "no
  changes" success and writing nothing; `--rename`/`--confirm-drop` are
  dropped from its `--help` and refused pre-parse with
  `baseline-flag-not-applicable`, since a baseline diffs against an empty
  snapshot and has nothing to rename or drop. `parseBannerBaseline` joins
  `parseBannerHashes`/`parseBannerVersion` as a public parser for the
  `-- baseline:` banner marker, matching its own prefix only.
  
  `ctx.return()` inside a plpgsql function/trigger body now dispatches by
  brand before duck-typing, so a table with a column literally named
  `exprNode` no longer misroutes `ctx.return(ctx.new)` down the expression
  path.

### Patch Changes

- b6747ce: `import`/`pull`'s loss report no longer announces an approximation for
  a UNIQUE constraint or a `nextval` default that its own report already
  says was omitted for its name. A UNIQUE constraint whose catalog name
  isn't a valid hejbro identifier, or a column of that same kind holding
  a `nextval` default, now gets only its omission line -- an ordinary
  UNIQUE constraint or `nextval` default elsewhere on the same table is
  still announced as before.
- a3c3d80: `import` and `pull` no longer stop when a table, schema, index or check
  has a name a declaration cannot carry: that object is left out and
  named in the loss report, and the rest of the database is still read.
- 2146480: `@hejbro/core` exports `isSqlName` (the same D36 rule `assertSqlName`
  enforces, as a boolean query), so a caller that must decide whether a
  name is declarable has one rule to ask, not a second, hand-rolled copy
  of it. `import`/`pull` now use it to decide the same question `table()`
  itself already enforces: a column whose SQL name begins with an
  underscore (`_id`) round-trips through its own TypeScript key but is
  not a valid hejbro identifier, and used to abort the entire reading;
  it is now omitted and named in the loss report instead, like every
  other name a declaration cannot carry.
  
  `import`/`pull` no longer abort when a foreign key's own *target*
  table or schema has a name a declaration cannot carry: that one
  relation is left out and named in the loss report (its own name is
  still declared as a column), and the rest of the database is still
  read. A `UNIQUE` constraint on an omitted table is no longer announced
  as an approximation for an object the same report says was never
  inferred, and a database whose named schemas are all omitted for their
  own names now refuses with its own diagnostic -- naming the reason in
  the loss report first -- instead of the misleading "found no table,
  enum, or sequence to infer": that message is now reserved for schemas
  that genuinely hold nothing, never for one hejbro just couldn't name.
  Either way, nothing is written and the `--out` directory is never
  created.
  
  Two tables in the same schema that each carry a check constraint of
  the same name no longer swap expressions: `import`/`pull` used to
  attach the wrong table's own check condition to whichever table came
  second, so the starter file declared a check asserting against columns
  that table doesn't have -- DDL the source database itself refused.
  Each table's own check expression is now read correctly, regardless of
  what its check constraints happen to be named.
- 310d229: `import` and `pull` no longer drop a foreign key into a schema
  `--schema` didn't name -- the ordinary shape a hosted database's own
  platform schemas (`auth`, `storage`, …) have. That reference is kept,
  declared against a table this repository doesn't own, and the
  generated DDL still carries the constraint.
  
  A column the DSL can't name now gets the reason that actually applies
  to it in the loss report -- no declaration key produces its SQL name
  back, or a key does but the identifier rule itself rejects the name --
  and the only remedy that exists: renaming it in the database. Neither
  line says "declared by hand" anymore; no hand-written declaration, in
  this repository or a linked one, could ever carry either kind of name.
  
  `import`'s loss report always ends with its own way-out line again,
  even when some of the named schemas hold nothing to infer.
- 636541b: A table named the same as the extras callback's own parameter (`t`) no
  longer breaks its own starter file: it's now written under a different
  identifier, and the file loads and type-checks like any other.
  
  A file that carries more than one foreign key into the same
  out-of-scope table now declares one reference-only handle for that
  table, not one per foreign key -- the handle names the table the same
  way regardless of how many of its own foreign keys reach it.
  
  That handle's own comment now says why it exists instead of always
  claiming a declaration-file cycle: a handle standing in for a table
  this run never read says so, and a handle cutting an actual cycle
  keeps its previous wording.
  
  The loss report's omitted-index and omitted-check lines no longer
  suggest declaring the object by hand -- an index or check constraint
  whose catalog name isn't a valid hejbro identifier can't be carried by
  any declaration, hand-written or not; renaming it in the database is
  the only way back.
- 4cc85c4: `hejbro check` no longer reports every `serial`/`smallserial`/`bigserial` column as missing its default (#716). The column's `nextval(...)` default lives on the snapshot's own synthesized sequence, not on the column itself — `check` now joins that sequence and accepts the catalog's `nextval(...)` text whether or not it is schema-qualified.
- 629289b: A managed table's own removal, paired with a same-shaped
  `existingTable()` declaration appearing under a different name in the
  same schema and run, no longer drops the managed table's DDL (its
  table, sequence, row-level security, policies) without asking —
  `hejbro generate` now refuses it with `ambiguous-table-rename`, the
  same way it already refuses two managed tables in that shape. The safe
  path is two runs: `--rename` the table while both sides are still
  `table()` declarations, then hand the renamed table over to
  `existingTable()` in a later run. `--rename` targeting a declaration
  that's already `existingTable()` is refused too, with a message that
  says the target is declared but not DDL-owned rather than "unknown."
- 9242b4b: Fixes vendoring compatibility with older exports and closes several
  contract-compilation gaps:
  
  - `hejbro vendor` reads an export written before the typed function
    surface existed (pre-#587) without refusing it; the untyped function
    is simply not carried into the contract's `Functions` section.
  - `createNameKeyedDb` accepts a contract vendored before functions were
    carried at all (no `functions` member in `contractMetadata`) and
    builds a client whose `fn` carries no callables.
  - A vendored client's bare `insert()`/`update()`/`delete()` now types
    as resolving to `ReadonlyArray<never>` — no statement it sends
    carries a `RETURNING` clause, so it never resolves the table's row
    type.
  - A table column key or function argument key that is not a valid
    TypeScript identifier is quoted in the emitted contract instead of
    breaking compilation.
  - An `interval` column or function argument/return compiles in a
    vendored contract; `IntervalValue` is imported only when the
    contract actually names it.
- 623c53b: `verify`'s documented contract now says what its hashes cover: the
  declaration snapshot before and after each migration, never a file's SQL
  body. A hand-edited banner line, a hand-edited snapshot, or a missing or
  reordered file is still reported; a body edit that leaves the banner
  lines intact passes `verify`, and the requirement and the renames guide
  now say so instead of implying the opposite. No behaviour changes.
- ef00b1b: Four fixes (#677):
  
  - `hejbro verify`'s `chain-tip-mismatch` now names the migration file
    whose `snapshot:` hash is the chain tip and the snapshot path it
    disagrees with, instead of misreading the message's own quoted
    `"snapshot:"` substring as the identity (#632).
  - `synced-function-declared` (a synthesized function declaration reaching
    `generate`) is now specified and documented, mirroring the existing
    table guard (#658, function half) — the error text itself was already
    correct.
  - A column-level `.references(() => target.column)` thunk no longer runs
    during `table()` itself — it resolves on the declaration's first
    `foreignKeys` read instead, so two declaration files (or two tables in
    one file) that reference each other now load under either order,
    including a genuine circular import between two schema files. Previously
    this crashed with a TDZ error (same file) or "Cannot read properties of
    undefined" (cross-file), regardless of which side was declared first
    (#669).
  - `ctx.return` now accepts a mutation ending in a projected
    `.returning({...})`, exactly as it already accepted the bare
    `.returning()` form — the rendered `return query ...` carries exactly
    the projected `RETURNING` list (#634).
- 7bbdc8b: Index declarations gain three capabilities they lacked: an access method (`index().using("gin" | "hash" | "gist" | "spgist" | "brin" | "hnsw" | "ivfflat")`, with `btree` the unchanged default), an operator class per column (`op(column, "jsonb_path_ops" | "gin_trgm_ops" | …)`, composable with `asc`/`desc`), and expression indexes (`.on(sql\`lower(${t.email})\`)`, requiring an explicit index name since there's no column to derive one from). Every invalid combination — an unknown method, `unique` on a non-B-tree method, an invalid operator-class identifier, an expression referencing another table or a subquery, an unnamed expression index — fails at declaration time with a message naming the fix. Expression columns are stored in the snapshot as structured nodes, so `--rename` retargets the identifiers inside them exactly like partial-index predicates and CHECK expressions already do. A 0.1.1 project that only uses B-tree indexes regenerates unchanged: the snapshot format stays 5, and the new fields are additive and absent by default.
- Updated dependencies [6b3cc7f]
- Updated dependencies [5aebe5c]
- Updated dependencies [ef12376]
- Updated dependencies [99b659e]
- Updated dependencies [65936ca]
- Updated dependencies [9963d04]
- Updated dependencies [9f58667]
- Updated dependencies [e530909]
- Updated dependencies [27d5554]
- Updated dependencies [31c7ffd]
- Updated dependencies [5f8b97f]
- Updated dependencies [46b902c]
- Updated dependencies [28aec17]
- Updated dependencies [effda0a]
- Updated dependencies [1f459d1]
- Updated dependencies [e6c802c]
- Updated dependencies [2146480]
- Updated dependencies [f2e7781]
- Updated dependencies [70e68cc]
- Updated dependencies [aad5078]
- Updated dependencies [32a8f11]
- Updated dependencies [387a2cc]
- Updated dependencies [19e7aeb]
- Updated dependencies [16e1c92]
- Updated dependencies [fec58f9]
- Updated dependencies [dafb897]
- Updated dependencies [ef00b1b]
- Updated dependencies [0f19390]
- Updated dependencies [1aa05f2]
- Updated dependencies [71033ca]
- Updated dependencies [7bbdc8b]
- Updated dependencies [6345323]
- Updated dependencies [232293e]
- Updated dependencies [43bbebd]
- Updated dependencies [67ebf69]
- Updated dependencies [4be9551]
- Updated dependencies [d3c39bc]
- Updated dependencies [7c472b7]
- Updated dependencies [221d650]
- Updated dependencies [9394b37]
- Updated dependencies [b2be9b9]
- Updated dependencies [34afb30]
  - @hejbro/core@0.2.0-pre.0
  - @hejbro/query@0.2.0-pre.0

## 0.1.1

### Patch Changes

- 2ff02b7: `hejbro restore --help` documents the `<n>` positional; `hejbro --help` keeps each command on one line; `restore`'s undo hint notes that restored files are staged.
- 66117ac: Fix: a function declared `returns: <table>` failed at call time (`structure of query does not match function result type`) — or silently returned values under the wrong column names when the swapped columns share a type — once a column had been added to that table in the middle of its TypeScript declaration in a later migration. Snapshot column order is now the table's physical order: existing columns keep their order, new columns are appended, a renamed column keeps its position — the rule Postgres applies. `select(table)` / `.returning()` lists in function bodies and view definitions follow it. No snapshot format change; unchanged declarations render unchanged. Known limitation: a snapshot that already diverged from the database on 0.1.0 (a mid-declaration insert generated before this fix) is not repaired — hejbro has no database access by design; regenerate that table's functions by hand once, or drop and re-add the column.
- 1ebb306: `defineFunction` now takes the declared schema object as its first argument, like `table`/`defineView`/`grant` (#269) --
  `defineFunction(app, "archive_project", …)` instead of `defineFunction("app", "archive_project", …)`. The string form is still accepted on the 0.1.x line for compatibility (deprecated in JSDoc) and will be removed in 0.2.0.
- Updated dependencies [2ff02b7]
- Updated dependencies [66117ac]
- Updated dependencies [1ebb306]
  - @hejbro/core@0.1.1

## 0.1.0

### Minor Changes

- 2e125e8: Add Changesets-based release tooling: `.changeset/config.json` (a fixed
  version group across the three published packages, public npm access,
  `dev` as the base branch), root `changeset`/`version-packages`/`release`
  scripts, and the one-`.changeset/*.md`-per-PR rule in `AGENTS.md`.
  Introducing the release infrastructure itself is not a patch.
- e131220: `@hejbro/supabase` adds `authUidCached()`/`authJwtCached()` (#97) --
  the initPlan-cached form of `authUid()`/`authJwt()`, for use in RLS
  `using`/`withCheck` clauses (they render `(select auth.uid())`/
  `(select auth.jwt())`, which Postgres evaluates once per statement
  instead of once per row). `authUid()`/`authJwt()` are unchanged and
  remain the correct form inside a column `default`/`check` expression,
  where a scalar subquery is illegal.
  
  A new validator, `rls-uncached-auth-call` (part of
  `supabaseValidators`), warns when a policy calls the plain form where
  the cached one belongs. It does not look at column `default`/`check`
  expressions at all.
- 1b9d4fa: Every migration generated from now on records the hejbro version that
  wrote it: a `-- hejbro: <version>` line directly below `-- hejbro
  migration` (#229). `@hejbro/core`'s `renderBanner` takes the version as
  an optional third argument (`undefined` by default, so every existing
  call site and golden fixture is unaffected) and `parseBannerVersion`
  reads it back; the CLI reads its own `package.json` at runtime to supply
  the string, so core never touches the filesystem or knows its own
  version. Pre-#229 migration files (no version line) keep parsing
  unchanged.
- 58dcafa: The Supabase storage bucket kind's `alter` change now reports which
  fields actually changed (`"public changed"`, `"file size limit
  changed"`, `"allowed mime types changed"`) instead of an empty `notes:
  []`. Previously every bucket config change rendered a bare `-- ~
  supabase-storage-bucket <name> []` in the migration banner -- the only
  kind that emitted an empty notes list on an alter (#116).
- d5151ad: `@hejbro/core` re-exports `decodeExprNode` from its public index, paired
  with the already-public `renderExpr` — tooling outside the package can
  now render a declared column's default expression back to SQL text the
  same way core itself does, without reimplementing the expression codec.
  No behavior change: this is purely a new public export exposing
  existing, already-tested internal logic.
  
  (This capability is exercised by `scripts/check-declared-vs-catalog.mjs`,
  a private, non-published tool — #218 — which is why the fixed group's
  other two packages carry no code changes of their own here beyond the
  version bump their `.changeset/config.json` fixed grouping requires.)
- f27cbea: `hejbro` now records a table's primary key constraint name
  (`TableSnapshot.primaryKeyName`) and every unique column's constraint
  name (`ColumnSnapshot.uniqueName`) in the snapshot, matching Postgres's
  own naming convention exactly (`<table>_pkey`, `<table>_<column>_key`)
  — frozen now, pre-1.0, so a later feature never has to disagree with a
  name already committed to a user's database (#24/D68).
  
  `generateMigration` diffs a primary key as one table-level constraint
  (the set of `.primaryKey()` columns), replacing #137's silent gaps —
  adding a primary-key column to an existing table, and a composite
  primary key's partial drop — with real `add constraint`/`drop
  constraint ... primary key` emission. A column's own `.primaryKey()`
  flag flipping in place is folded into the same rule.
  
  `hejbro verify`/rename plans keep both names in step with a table or
  column rename (mirrors the existing index/foreign-key drift guard).
  
  UNIQUE constraint *emission* stays out of scope this wave — a changed
  `.unique()` flag still throws `unsupported-column-alter`, now with a
  reason (table-level, not expressible as a column alter).
- fb76507: Add CRAP score (complexity² × (1 − coverage)³ + complexity) tooling for
  `@hejbro/core` and `@hejbro/supabase`: `@vitest/coverage-v8`, a
  `test:coverage` task, and `scripts/check-crap.mjs`. Reporting only for
  now — no CI gate yet. `package.json` (a `devDependencies` entry and a
  new script) does change in all three published packages; `package.json`
  is always packed regardless of `files`, so D59's changeset rule applies
  literally here, not by analogy to a prior PR's precedent.
- 77120e7: `HejbroError` is now a real `Error` subclass instead of a plain object
  type. `code`, `message`, and `declaredAt` remain accessible the same way,
  but the CLI's `catch`-clause discriminator now checks `instanceof
  HejbroError` instead of duck-typing on "has a `code` and a `message`" —
  the old check misidentified any Node runtime error carrying a `.code`
  (e.g. `ERR_MODULE_NOT_FOUND`) as a HejbroError (#125). A plain object
  literal shaped like `{ code, message, declaredAt }` no longer satisfies
  the `HejbroError` type; build `HejbroError`s via the `hejbroError`
  factory instead — this can break consumer code that constructed one by
  hand rather than through the factory, hence `minor`, not `patch`.
- 99b853c: `hejbro generate` now accepts `--flag=value` as well as `--flag value`
  for every value-taking flag (`--config`, `--name`, `--rename`,
  `--confirm-drop`). The equals form used to be silently dropped —
  for `--rename`/`--confirm-drop` specifically, that meant an unresolved
  rename ambiguity fell back to a destructive drop+create instead of a
  rename. The suggested rerun command printed on an ambiguity diagnostic
  was corrupted by the same bug — it echoed the unparsed `--flag=value`
  token and appended a duplicate — and is now correct for either form.
- 8b22258: `hejbro` now keeps a schema-wide `grant(schema).tables(...)` (one-shot
  `all-tables-privileges`) in step with tables added by a later migration
  (#121). Postgres's own `grant ... on all tables in schema ...` only ever
  covers the tables that exist when it runs — a table declared after that
  grant already existed silently ended up ungranted, a chain-vs-fresh
  asymmetry the local round-trip caught but golden tests can't (they never
  run real SQL). `hejbro generate` now re-issues the exact schema-wide
  statement right after `create table` for every standing
  `all-tables-privileges` grant already covering the new table's schema.
  
  Extension interface change (D78): `ObjectKind.emit` gains a third,
  optional, read-only parameter — the full snapshot the diff is generating
  *toward*. `siblingChanges` (D74) can't cover this case: it's the diff's
  own change list, and a standing grant unaffected by the new table never
  appears there. Additive and backward compatible — every existing `emit`
  implementation (10 across `@hejbro/core` and `@hejbro/supabase`) ignores
  it and needs no change; only `tableKind`'s `create` case reads it.
- aedffb6: Adds two new CLI commands (#130): `hejbro history` lists every migration
  with its commit, date, state (`ok`/`lost`/`rewritten`/`uncommitted`),
  recorded snapshot hash, and subject line, computed purely from git
  plumbing against `migrationsDir` — `--links`/`--no-links` add
  GitHub/GitLab URL columns (or OSC8 terminal hyperlinks) for the origin
  remote. `hejbro restore <n>` restores declaration files matching
  `config.entry`'s glob back to migration `<n>`'s recorded state, guarding
  against a dirty working tree, an out-of-range target, and a
  lost/rewritten history state, then verifying the restored declarations
  reload, their format version pre-checks, and re-serializing them
  reproduces migration `<n>`'s recorded snapshot hash — reporting a
  colorized file-diff and the exact `git`/`rm` commands to undo it.
  
  Both commands are read/git-only: `@hejbro/core` is unchanged, and
  `packages/cli/src/git.ts` is the only module that spawns git
  subprocesses.
- 50f0e85: `hejbro generate`/`hejbro verify` no longer crash with a raw, uncaught
  Node error when `hejbro.config.ts` or a declaration file imports a
  package that fails to resolve (not installed, or installed with an
  `exports` field that doesn't resolve) — this now renders as a proper §7
  diagnostic (`config-load-failed`/`declaration-load-failed`) naming the
  failing file and the underlying reason, instead of the uncaught stack
  trace #125 reported. A declaration file's own DSL validation errors
  (e.g. an invalid identifier) are unaffected and keep rendering with
  their own code and location, exactly as before.
- c9b8852: `registry.register()` now requires a namespace prefix (a hyphen) from
  every kind id it doesn't already own itself -- previously this was
  only advice inside `duplicate-kind`'s message, surfaced solely once
  two kind ids actually collided. A preset registering an unprefixed
  kind id now fails immediately with `preset-kind-needs-prefix` instead
  of silently succeeding until a future collision. `@hejbro/supabase`'s
  own kind (`supabase-storage-bucket`) already satisfies this and needs
  no change.
  
  This is a new registration-time check a preset could start failing
  under, hence `minor` rather than `patch`. It buys predictable preset
  kind ids and an earlier, clearer error -- it does not make
  `unknown-kind`'s classification sound (see #196/#199): the reverse
  direction, "a core kind id never carries a hyphen," can't be enforced
  the same way, so `unknown-kind` still states both possible causes
  rather than guessing from a kind id's shape.
- fe5c20c: `ObjectKind` gains an optional `requiredKeys?: ReadonlyArray<string>` —
  every built-in core kind (and `@hejbro/supabase`'s storage-bucket kind)
  now declares its own snapshot node's mandatory top-level keys.
  `parseSnapshot` takes an optional second argument, a plain
  `ReadonlyMap<string, ReadonlyArray<string>>` built by the new
  `requiredKeysByKind(registry)` helper — when given, a hand-edited or
  corrupted snapshot entry missing one of its own kind's required keys is
  now reported by kind and key name at parse time, before the diff engine
  crashes on the `undefined` field downstream instead. Omitting the second
  argument (every pre-#159 call site) keeps `parseSnapshot`'s prior
  behavior unchanged. Follow-up to #26/PR #152's deferred "option 3".
- adcb680: `rls.policy(...).using(...)`/`.withCheck(...)` now accept
  `Expr<"boolean"> | Expr<"unknown">` — the same union `check()` (D50) and
  partial-index `.where()` (D51) already adopted, so a raw `sql` template
  (e.g. `` sql`${t.status} <> 'done'` ``) can be used directly as a policy
  predicate. Adds a `literal(value: boolean)` helper so an intentionally
  permissive "allow every row" policy can be written as
  `.using(literal(true))` instead of a borrowed-meaning workaround like
  `isNotNull(someNotNullColumn)`.
- 1206fd5: A policy `using`/`withCheck` expression that references a table outside
  its own schema/table — including one buried inside a correlated
  `exists()` subquery, referencing neither the subquery's own `from`/joins
  nor the outer policy's table — is now rejected at **declaration time**
  (`rls-policy-foreign-column`), the same moment every other policy
  validation runs. Previously this specific shape (a foreign reference
  *inside* `exists()`) only surfaced later, at `hejbro generate` time
  (`foreign-column-ref`), as a side effect of rendering the policy's SQL
  (#160).
  
  Fixing this closed a gap, not a new rule: a *direct* out-of-table
  reference (not inside `exists()`) was already rejected at declaration
  time before this change. If your declarations pass today, this changes
  nothing for you — a policy an earlier `hejbro generate` already accepted
  was already valid under the old, narrower check too.

### Patch Changes

- 76e676e: Fix `hejbro verify`'s chain-linearity check (#129): a rollback that
  re-declares an earlier schema state was misclassified as
  `diverged-migrations` (a fork), because the old check grouped entries
  by parent value globally with no notion of position. `checkChain` now
  walks strict positional adjacency instead, so a rollback's own
  `current` returning to an earlier state satisfies the very next
  entry's `parent` immediately and never trips the fork check.
- 22e5766: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154), continuing #241's slice split. Ten
  `@hejbro/core` functions the ratchet-5 measurement found over the new
  threshold — `validateFormatVersion` (`snapshot/snapshot.ts`),
  `retargetColumnRef`/`retargetSelectNode` (`expr/retarget.ts`),
  `encodeLiteral`/`decodeLiteral`/`decodeProjection` (`expr/codec.ts`),
  `liftLiteral`/`renderLiteral` (`expr/literal.ts`), `recordReturn`
  (`plpgsql/body-context.ts`), `renderStatementLines`
  (`plpgsql/render-body.ts`) — are now built on a `.some()`/`.every()`
  over-an-array dispatch or a closed handler map instead of an `if`/`||`
  chain or a `switch`, mirroring the technique #154 PR2 and #241 already
  used elsewhere. Several (`encodeLiteral`, `decodeProjection`,
  `renderLiteral`, `renderStatementLines`) close a coverage gap no test
  could ever have closed the other way: their former `switch`'s `default:
  assertNever(...)` branch was structurally unreachable. The rest needed
  test coverage only, no code change (`decodeLiteral`'s malformed-input
  fallback, `liftLiteral`'s unsupported-JS-type fallback, `recordReturn`'s
  insert/delete-returning-query branches).
- ebea52a: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154), closing out the `engine` +
  `kind/diff-helpers.ts` slice #249 started. `generateMigration`
  (`engine/generate.ts`, complexity 10 — the widest single split in this
  slice) splits into `resolveGenerateMigrationOptions`/`blockedResult`/
  `sortPredropStatements`, each answering one question the original
  function's own branches asked inline. Two functions that surfaced
  after #249 opened also clear: `validateRequiredKeys`
  (`snapshot/snapshot.ts`) splits out its own gap-detection question into
  `requiredKeyGapFor`; `findExprScopeViolation`'s `sqlTemplate` handler
  (`expr/walk.ts`) moves from an inline `if` inside a `.flatMap()`
  callback to a `.filter().map()` chain (previously untested — added a
  test using a `sql\`\`` template with an embedded foreign-column
  reference). `engine/duplicate-version-fix.ts`'s `orderGroupByChain`
  also gains a one-line comment naming why its root-count check exists,
  even though (like the `hasFork` check #249 already removed) it's
  subsumed by `walkGroup`'s own failure mode for the same inputs.
- 869376c: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154), continuing #241/#242's slice
  split with the `engine` + `kind/diff-helpers.ts` slice. Twelve
  functions the ratchet-5 measurement found over the new threshold —
  `validateConfirmDropTarget`/`rewriteSequencesForRename`/
  `validateTableRenameTarget`/`validateColumnRenameTarget`/
  `residualTableAmbiguities`/`retargetTableFields`
  (`engine/rename-plan.ts`), `createOrDropDiff`
  (`kind/diff-helpers.ts`, shared by all 8 built-in kinds),
  `notNullWithoutDefaultWarnings` (`engine/core-validators.ts`),
  `resolveDeclarations` (`engine/generate.ts`), and
  `orderGroupByChain`/`parseVersionAsInstant`/`planDuplicateVersionFix`
  (`engine/duplicate-version-fix.ts`) — are now split into named helpers
  that each answer one question the original function's own branches
  asked inline, the same de-nesting/extraction technique #154 PR2 and
  #241/#242 already used. `orderGroupByChain` also drops a `hasFork`
  pre-check found to be fully redundant with checks already below it.
  Several needed test coverage only, no code change (a `--confirm-drop
  target: "table"` spec, the `"unix"` migration-prefix strategy, a
  single-member duplicate-version group).
- b2776c4: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154), continuing #241/#242/#249/#253's
  slice split with the `packages/core/src/kinds` slice (①-B). Five
  built-in kinds' `emit` the ratchet-5 measurement found over the new
  threshold — `rls-kind`, `sequence-kind`, `schema-kind`, `grant-kind`,
  `trigger-kind` — each move their `"create"`/`"alter"`/`"drop"` switch
  case into its own named module-scope handler, dispatched through a
  mapped `EmitHandlers` type over `ChangeOperation` (the object-literal
  handler-map technique #154 PR2/#241 already used) so a missing case is
  a compile error instead of a `switch`'s `default: assertNever(...)` at
  runtime — each handler is then scored as its own independent function.
  `sequence-kind`'s `diff` is also converted to reuse the shared
  `createOrDropDiff` guard, matching the other built-in kinds that
  already use it. No array-of-predicates tricks; every extraction is
  covered by a red-first mutation (swapped/inverted dispatch, confirmed
  to fail the existing golden tests) proving it's genuinely load-bearing.
- 2d0a2bd: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154). The four `@hejbro/supabase`
  functions the ratchet-5 measurement found over the new threshold
  (`schemaOf`/`declaredAtOf` in `validators/schema-of.ts`,
  `childrenOfVariableArity` in `validators/rls-uncached-auth-call.ts`,
  `storageBucketKind.diff` in `storage/bucket-kind.ts`) are now built on
  `.some()`-over-an-array dispatch or a closed handler map instead of an
  `if`/`||` chain or a `switch`, mirroring the technique #154 PR2 already
  used across `@hejbro/core`. `@hejbro/core`'s `renderQuery`
  (`expr/render-sql.ts`) and `@hejbro/supabase`'s `storageBucketKind.emit`
  move from a `switch` with a structurally-unreachable `default:
  assertNever(...)` branch to the same handler-map technique, closing a
  coverage gap no test could ever have closed the other way. Six other
  functions (`retargetForeignKeyReferenceColumn`,
  `rewriteForeignKeysForRename`, `ambiguousTableRenameMessage` in
  `engine/rename-plan.ts`, `resolveEvent` in `dsl/define-trigger.ts`,
  `storageBucketKind.emit`'s invariant guard, `renderQuery`) needed test
  coverage only, no code change.
- b66c122: Internal readability refactor (#154 ratchet-5, no behavior change):
  `dsl/rls.ts`'s `assertClauseAllowed` and `dsl/table.ts`'s
  `resolveReferenceTarget`/`validateIndexPredicates` each split their
  independent rules/steps into their own named functions.
- fa49e8f: Internal readability refactor (#154 ratchet-5, no behavior change):
  `kinds/policy-kind.ts`'s `emit` now uses the established `dispatchEmit`
  handler-map pattern (`emitCreateChange`/`emitAlterChange`/`emitDropChange`)
  instead of an inline `switch`; `kinds/table-kind.ts`'s `diff` splits its
  four keyed-diff computation into `tableFieldDiffs`, and the emptiness/note
  checks that use them into `isEmptyTableFieldDiffs`/`tableFieldDiffNotes`;
  `kinds/table-kind-emit.ts`'s `sequenceForAddedColumn` splits its two
  compound conditions into `isMatchingSequenceCreate`/`sequenceOwnsColumn`.
- 836fa7b: Internal refactor, no behavior change: closes out #154's CRAP work
  (PR2/#210, PR3/#222) by splitting the three remaining violations that
  were never `switch`-over-closed-union walkers, so a handler map
  couldn't apply to them the way it did for PR2/PR3's conversions --
  `retargetProjection` (split by `projectionKind`, plus new test coverage
  for its previously-untested `"columns"` branch), `parseSnapshot` (split
  into five named validator steps), and the rename-target validator
  (split by table vs column target, plus a new table-target test for a
  previously-untested `unknown-rename-target` boundary). `pnpm check:crap`
  now reports zero violations across `@hejbro/core` and `@hejbro/supabase`.
- cdaa442: Internal refactor, no behavior change: lowers CRAP scores further (#154
  PR3, following PR2's #210). `renderTypeNode`'s 28-case `switch` over
  `TypeNode`'s `typeName` is now a type-closed handler map, same technique
  as PR2's `ExprNode` walkers. `view-kind.ts`, `function-kind.ts`,
  `enum-kind.ts`, and `table-kind-emit.ts`'s own `emit` — a
  `switch (change.operation) { "create" | "alter" | "drop" }` each opened
  with, deliberately left untouched by PR2 — now share one dispatch helper
  (`kind/emit-helpers.ts`'s `dispatchEmit`), with each operation's own body
  extracted into its own named function per kind.
- 63afd9c: `policy` and `trigger`'s `alter`/`drop` migration steps now emit a bare
  `drop policy`/`drop trigger` instead of `drop ... if exists` (D75) — an
  out-of-band removal of a policy or trigger hejbro still declares now
  fails loudly at the next `hejbro generate`/apply instead of silently
  being re-created. The `create` path is unchanged: a first-time create
  still emits the idempotent `if exists` guard, since there is no
  previous snapshot identity for drift to hide behind there. Matches
  `sequence`'s existing (#193) bare-drop behavior on the same two paths.
- 8261b88: `hejbro verify` gains a fifth check (#220): two migration files sharing
  the same version prefix are now a hard error, caught before the chain
  walk (chain order is undefined when versions collide) — Supabase
  applies migrations by this exact prefix, so a collision means one of
  them silently never runs. `Next:` gives a computed `mv` command per
  extra file rather than asking you to work it out. `diverged-migrations`'
  own `Next:` is rewritten the same way: one fully computed
  `rm ... && hejbro generate` option per candidate file, instead of prose.
- a854f21: Adding a `.primaryKey()` column to an existing table, or dropping a
  column out of a composite primary key while another column still
  declares `.primaryKey()`, now fails loudly with `unsupported-column-
  alter` instead of silently emitting incomplete SQL (#137).
  
  Both paths were real defects, not just missing features:
  
  - **Add path**: `renderColumnDefinition` (used for `add column`) never
    emitted a `primary key` clause -- that's a `create table`-only,
    table-level concern -- so `alter table … add column "x" uuid not
    null;` looked plausible while the constraint itself never appeared.
  - **Drop path**: dropping one column of a composite primary key drops
    the *entire* constraint on Postgres's side, with no warning
    (confirmed directly against a real Postgres) -- silently leaving any
    surviving `.primaryKey()` column without one, so a chain-built
    database and a fresh build of the same declaration disagree.
  
  This is a smaller, standalone fix -- `phase8-constraint-names` (#24)
  replaces this guard with the real `add constraint`/`drop constraint`
  emission for both paths. Landing the guard first means the silent
  corruption is closed even if `phase8-constraint-names` takes longer.
- aea1cf9: Internal refactor, no behavior change: lowers CRAP scores across
  several core walkers and kind-diff functions (#154). The create/drop/
  neither-exists guard every built-in `ObjectKind`'s own `diff` opened
  with (identical across all eight kind files that use it, differing
  only in the literal `kind` value, including `table-kind.ts`) is now
  one shared helper (`createOrDropDiff`, `packages/core/src/kind/
  diff-helpers.ts`). A new `familyOfTypeNode` lookup table replaces a
  type-family switch. `plpgsql`'s recording context now carries its
  state explicitly instead of through nested closures. Five other
  tree-walker switches (rename-retarget, the expression renderer,
  `codec.ts`'s encode/decode, a column-scope walker, and a general tree
  walker) are now type-closed handler maps instead of `switch`
  statements.
- 54c3394: The `unknown-kind` error no longer always suggests a missing preset,
  which was actively wrong for a snapshot written by a newer hejbro (a
  core kind this build predates, e.g. a future `sequence` kind, #23) --
  no preset could ever provide it, so the advice sent readers hunting
  for one that doesn't exist. The message now says so explicitly for any
  unrecognized kind id, alongside the original "check your presets"
  advice, since this build can't always tell the two causes apart
  (#196).
- 2cb855d: `hejbro verify --fix` (#220) automatically resolves a
  `duplicate-migration-version` collision it can actually order by chain
  history: it renames every "later" file in a resolvable group to a version
  after the directory's current latest (staggered a second apart for a
  3+-way collision), leaving migration content and the checked-in snapshot
  untouched, prints each `<before> -> <after>` rename, then continues into
  the normal five checks against the refreshed file listing.
  
  A group `--fix` can't safely reorder — a genuine fork (two migrations
  sharing the same parent snapshot), or a member with no readable
  hash-chain banner — is left untouched (`--fix` prints a `skipped: ...
  chain order undetermined, see Next` line for it, never silent), and
  `duplicate-migration-version`'s `Next:` offers one full `mv` option per
  group member instead ("assume this one is later; rename it; rerun
  verify") rather than a single confident guess, since hejbro genuinely
  doesn't know the order. Both the resolvable-group `(a) hejbro verify
  --fix` / `(b) mv ...` pick and the unresolvable-group per-member `mv`
  options are computed from the exact same chain-order check `--fix`
  itself runs, so the diagnostic text and what `--fix` actually does can
  never disagree.
- Updated dependencies [2e125e8]
- Updated dependencies [e131220]
- Updated dependencies [1b9d4fa]
- Updated dependencies [58dcafa]
- Updated dependencies [d5151ad]
- Updated dependencies [76e676e]
- Updated dependencies [51d4c20]
- Updated dependencies [f27cbea]
- Updated dependencies [22e5766]
- Updated dependencies [ebea52a]
- Updated dependencies [869376c]
- Updated dependencies [b2776c4]
- Updated dependencies [2d0a2bd]
- Updated dependencies [b66c122]
- Updated dependencies [fa49e8f]
- Updated dependencies [836fa7b]
- Updated dependencies [fb76507]
- Updated dependencies [cdaa442]
- Updated dependencies [02f5388]
- Updated dependencies [908e2f5]
- Updated dependencies [63afd9c]
- Updated dependencies [8261b88]
- Updated dependencies [77120e7]
- Updated dependencies [67b9670]
- Updated dependencies [a8430ea]
- Updated dependencies [8b22258]
- Updated dependencies [aedffb6]
- Updated dependencies [84670f9]
- Updated dependencies [a854f21]
- Updated dependencies [7391c48]
- Updated dependencies [c9b8852]
- Updated dependencies [fe5c20c]
- Updated dependencies [adcb680]
- Updated dependencies [1206fd5]
- Updated dependencies [626c57f]
- Updated dependencies [aea1cf9]
- Updated dependencies [75f2d0a]
- Updated dependencies [50ac657]
- Updated dependencies [54c3394]
- Updated dependencies [2cb855d]
- Updated dependencies [92f075b]
  - @hejbro/core@0.1.0
