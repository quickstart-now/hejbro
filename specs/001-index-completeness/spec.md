# Feature Specification: Index completeness — access method, operator classes, expression indexes

**Feature Directory**: `specs/001-index-completeness` | **Issue**: #284 (sub-issue of #282) | **Target release**: next 0.1.x `patch` (0.2.0 is the owner-cut stability milestone, D83)

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "Index completeness: `using` access method (btree/hash/gin/gist/spgist/brin/hnsw/ivfflat), expression indexes, operator classes — the most-used index capabilities hejbro cannot express today; first Phase 10 feature and the Spec Kit pilot."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose the index access method (Priority: P1)

A hejbro user declaring a table with a `jsonb`, array, or text-search column wants an index that Postgres can actually use for containment / overlap / similarity queries. Today `index().on(t.tags)` always emits a B-tree index, which is useless for `@>` / `&&` / `%` operators; the user is forced to hand-write a migration, which breaks the "everything is declared" promise. With this story the user writes `index().using("gin").on(t.tags)` and `hejbro generate` emits `create index … using gin (…)`.

**Why this priority**: GIN on `jsonb` / arrays is the single most common non-B-tree index in Supabase projects and the first thing the gap analysis lists; it unblocks real schemas without any other capability.

**Independent Test**: Declare a table with a `jsonb` column and `index().using("gin").on(t.data)` in a fresh project, run `hejbro generate`: the migration contains `create index "…" on "…"."…" using gin ("data");`. Change the method to `"btree"` (or remove `.using`), generate again: the migration drops and re-creates the index. Remove the index: the migration drops it.

**Acceptance Scenarios**:

1. **Given** a table with `index().using("gin").on(t.tags)`, **When** `hejbro generate` runs from an empty snapshot, **Then** the migration's `create index` statement carries `using gin` and the snapshot records the method.
2. **Given** an existing 0.1.x project whose indexes never name a method, **When** `hejbro generate` runs on the next 0.1.x without any declaration change, **Then** no migration is produced (B-tree stays the default and is not recorded as a change).
3. **Given** an index whose method changes between two generates, **When** the second generate runs, **Then** the migration drops the old index and creates the new one (same drop + create path every other index change already takes).
4. **Given** `index().unique().using("gin").on(…)`, **When** the declaration is evaluated, **Then** hejbro fails at declaration time: Postgres only supports `unique` on B-tree, and the message says so and names the fix (`Next:`).
5. **Given** a method name outside the closed list (FR-002), **When** the declaration is evaluated, **Then** hejbro fails at declaration time with the list of accepted methods.

---

### User Story 2 - Operator class per index column (Priority: P2)

A user with a GIN index on `jsonb` wants `jsonb_path_ops` (smaller, faster for `@>`), or a trigram index (`gin_trgm_ops`) on a text column for `ilike '%…%'`, or a cosine-distance index for pgvector (`vector_cosine_ops`). All of these are "the same index, with an operator class after the column". With this story the user writes `index().using("gin").on(op(t.data, "jsonb_path_ops"))` and the migration emits `("data" jsonb_path_ops)`.

**Why this priority**: operator classes are the difference between a working and a useless non-B-tree index for trigram and vector search; they depend on Story 1 and add one per-column token.

**Independent Test**: Declare `index().using("gin").on(op(t.body, "gin_trgm_ops"))`, generate: the `create index` column list reads `("body" gin_trgm_ops)`. Change the class, generate: drop + create. The round-trip example applies such an index on a local Postgres with the extension present and the two-path `pg_dump` outputs match.

**Acceptance Scenarios**:

1. **Given** an index column wrapped in `op(column, "<class>")`, **When** `hejbro generate` runs, **Then** the emitted column list carries the class after the column and the snapshot records it.
2. **Given** `op(...)` combined with `desc(...)` / nulls placement on the same column, **When** the declaration is evaluated, **Then** the column renders as `"col" <class> desc nulls first` in Postgres' order.
3. **Given** an operator-class name that is not a valid SQL identifier (D36), **When** the declaration is evaluated, **Then** hejbro fails at declaration time with `Next:`; hejbro does **not** check that the class exists in the database — Postgres does at apply time (see Assumptions: extensions are outside hejbro).

---

### User Story 3 - Expression indexes (Priority: P3)

A user wants case-insensitive lookups (`lower(email)`), an index on a JSON path (`(data->>'status')`), or a date truncation — an index over an **expression**, not a column. Today `.on()` only takes column references. With this story `.on()` also accepts an expression (the existing `sql` template / expression AST), the expression is stored structurally in the snapshot like partial-index predicates already are, and `--rename` retargets a renamed column inside it.

**Why this priority**: less frequent than GIN / operator classes, and it raises a naming question (an expression has no column name to derive the index name from — see Clarifications); it is still part of "complete" because Drizzle covers it and users hit it early on `email` columns.

**Independent Test**: Declare `index("users_email_lower_idx").on(sql\`lower(${t.email})\`)`, generate: `create index "users_email_lower_idx" on … (lower("email"))`. Rename `email` → `emailAddress` with `--rename`, generate: the index is re-created with `lower("email_address")` and no ambiguity error. Restore to the previous commit: the expression renders identically.

**Acceptance Scenarios**:

1. **Given** an index whose `.on()` list contains an expression, **When** `hejbro generate` runs, **Then** the expression renders parenthesised in the column list and the snapshot stores it as a structured expression node (not SQL text).
2. **Given** a column referenced inside an index expression is renamed with `--rename`, **When** generate runs, **Then** the expression is retargeted exactly as partial-index predicates and CHECK expressions already are.
3. **Given** an index expression that references a column of another table or contains a subquery, **When** the declaration is evaluated, **Then** hejbro fails at declaration time (same rule as partial predicates today).
4. **Given** an expression index without an explicit name, **When** the declaration is evaluated, **Then** hejbro fails at declaration time and the `Next:` line proposes a name (FR-009).

---

### Edge Cases

- **Alter path**: any change to method, operator class, expression, columns, uniqueness or predicate = drop + create of that index (existing behaviour, unchanged); the migration banner lists the index by name.
- **Drop path**: removing `.using(...)`, `op(...)` or an expression is a change like any other — drop + create; removing the index drops it.
- **Rename path**: `--rename` of a column used in an expression or operator-class column retargets the snapshot; derived index names that include the renamed column are re-derived as today.
- **Restore**: `hejbro restore` re-renders method / class / expression from the snapshot alone (D24: emit from the snapshot).
- **Existing snapshots**: a snapshot written by 0.1.x has no method / class / expression fields; the next 0.1.x reads it as-is (format 5, absent = default) — FR-010.
- **Diagnostics**: unknown method, `unique` with a non-B-tree method, invalid class identifier, expression with foreign column / subquery, duplicate derived names — all fail at declaration time with why + `Next:`.
- **Extensions**: `hnsw` / `ivfflat` / `gin_trgm_ops` / `vector_*_ops` need `vector` / `pg_trgm`; hejbro does not create extensions (not in scope) — the user enables them outside hejbro, and a missing extension fails at apply time with Postgres' own message.

## Clarifications

### Session 2026-08-22

- Q: Which access methods does `.using()` accept? → A: a closed list — `btree`, `hash`, `gin`, `gist`, `spgist`, `brin`, `hnsw`, `ivfflat`; anything else is a declaration-time error listing them (FR-002, → D85).
- Q: How is an expression index named when no name is given? → A: it is not — an explicit name is required; the error's `Next:` proposes `<table>_<referenced columns>_idx` (FR-009, → D86).
- Q: How does the next 0.1.x read a 0.1.1 snapshot (format 5)? → A: unchanged, format stays 5; new index fields are additive and compact; rule: additive compact fields never bump the version (FR-010, SC-004, → D84).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: hejbro MUST let an index declaration name its access method; B-tree stays the default when none is given and is never recorded as a change for existing projects.
- **FR-002**: hejbro MUST accept exactly the **closed list** of access methods `btree`, `hash`, `gin`, `gist`, `spgist`, `brin` (Postgres built-ins) and `hnsw`, `ivfflat` (pgvector), and reject any other value at declaration time with the accepted list in the message (owner decision 2026-08-22, Q1; further extension methods are added to the list on request, not accepted as free text).
- **FR-003**: hejbro MUST reject `unique` combined with a non-B-tree method at declaration time.
- **FR-004**: hejbro MUST let each index column carry an operator class; the class is validated as a SQL identifier (D36) and otherwise passed through to Postgres unverified.
- **FR-005**: hejbro MUST render the per-column tokens in Postgres' order: `<column or (expression)> [<opclass>] [asc|desc] [nulls first|last]`.
- **FR-006**: hejbro MUST accept an expression (the existing expression AST / `sql` template) as an index column, render it parenthesised, and store it in the snapshot as a structured expression node.
- **FR-007**: hejbro MUST retarget column references inside index expressions on `--rename`, identically to partial-index predicates and CHECK expressions.
- **FR-008**: hejbro MUST reject index expressions that reference another table's columns or contain a subquery at declaration time (the partial-predicate rule).
- **FR-009**: An expression index MUST carry an **explicit name**; when `.on()` contains an expression and the index was started as `index()` without a name, hejbro fails at declaration time with `Next: name the index — index("<table>_<referenced columns>_idx")` (owner decision 2026-08-22, Q2; no derivation for expressions). Column-only indexes keep today's derivation.
- **FR-010**: `hejbro generate` on the next 0.1.x MUST read a snapshot written by 0.1.1 unchanged: the snapshot format version **stays 5**; the new index fields are additive and compact (absent = default), so a project that only uses B-tree indexes produces no migration and an unchanged snapshot hash. Rule (owner decision 2026-08-22, Q3 → D84): additive compact fields never bump the format version; only a change to an existing field's meaning or shape does.
- **FR-011**: `hejbro generate`, `verify`, `history --links` and `restore` MUST render method, operator classes and expressions from the snapshot alone (no declaration needed at restore time).
- **FR-012**: Every invalid declaration above MUST fail at declaration time (never at generate time) with why + `Next:`.

### Key Entities

- **Index declaration**: name (explicit or derived), uniqueness, **access method** (new), ordered list of **index columns**, optional predicate. Unchanged identity: the index name.
- **Index column**: either a column reference or (new) an expression; sort direction; nulls placement; (new) operator class.
- **Snapshot index shape**: records method (absent = B-tree), per-column class (absent = default), expression columns as structured nodes; compact — absent means default, so 0.1.x-era indexes are byte-identical after upgrade.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can declare a GIN index on a `jsonb` column, a trigram index on a text column, and an expression index on `lower(email)` and get a correct migration on the first `hejbro generate` without editing SQL.
- **SC-002**: `examples/postgres` (or `examples/supabase`) gains at least one non-B-tree index with an operator class and one expression index, and its two-path round-trip (`pnpm roundtrip`) produces identical `pg_dump` output.
- **SC-003**: Every invalid declaration listed under Edge Cases fails at declaration time with a message that names the fix; none reaches `generate`.
- **SC-004**: A 0.1.1 project that only uses B-tree indexes regenerates on the next 0.1.x with **zero** migration output and an unchanged snapshot hash (no spurious migration, no format-induced noise beyond what Q3 decides).
- **SC-005**: A `--rename` of a column used in an index expression produces one migration that drops and re-creates the index with the new name and no ambiguity error.

## Decision-log impact *(mandatory)*

- **Reads**: D24 (emit from the snapshot alone), D32 rule A (flag-driven renames, structured ambiguity), D36 (identifier rule), D46 (table-kind completeness absorbed as DSL/snapshot/emit/diff plumbing, not a new expression system), D51 (index columns as objects, partial `where`), D67 / D70 (expression nodes stored structurally), D81 (physical column order — unaffected), D59 + D83 (one `patch` changeset).
- **Proposes** (answers fixed in the 2026-08-22 clarification session; rows to be written into the decision log by the implementation PR):
  - **D84** — snapshot format policy: index method / operator class / expression columns are additive compact fields (absent = default); `HEJBRO_SNAPSHOT_VERSION` stays 5; **additive compact fields never bump the format version, only a change to an existing field's meaning or shape does**. Alternatives rejected: bump to 6 with a hard error on 5 (no upgrade path for 0.1.x users); bump to 6 and read 5 as 6 (a version-only rewrite changes the snapshot hash that is the chain tip → `chain-tip-mismatch` or an empty migration).
  - **D85** — access methods are a closed list (`btree`, `hash`, `gin`, `gist`, `spgist`, `brin`, `hnsw`, `ivfflat`); unknown names fail at declaration time. Alternative rejected: open identifier (typos surface only at apply time).
  - **D86** — expression indexes require an explicit name; the error proposes `<table>_<referenced columns>_idx`. Alternative rejected: derivation from referenced columns (collisions such as `lower(email)` vs `upper(email)`, unreadable names).
- **Conflicts**: none found. D7's "full table-kind scope" and D46's completeness framing are extended, not revisited.
- **Deferred-list check**: nothing under *Deferred* is required (no apply, no live DB, no hybrid authoring).

## Out of scope

- `include (…)` covering indexes, `concurrently`, `with (fillfactor …)` storage parameters, tablespaces, `nulls not distinct`.
- `create extension` (pgvector, pg_trgm, PostGIS) — the user enables extensions outside hejbro; a later feature may add an extension kind.
- New column types (`vector`, `geometry`, `tsvector`) — the gap-analysis "Columns" candidates; this feature renders whatever column the table has.
- Indexes on materialized views (no materialized views yet), `reindex`, index comments.
- Composite `unique` *constraints* (a constraint, not an index — separate feature).

## Assumptions

- The existing `index()` builder is extended (`.using(method)`, `op(column | expression, class)`, expressions accepted by `.on()`); no second builder. `op` is a wrapper like `asc` / `desc` so the three compose in any order.
- Index changes stay drop + create; `alter index` is not introduced (Postgres has no `alter index … set method`).
- Expression indexes reuse the expression AST and the `sql` template already used by partial predicates, so validation (no subquery, no foreign column) and rename retargeting are the same code paths.
- Operator classes and extension-provided methods are passed through to Postgres; hejbro validates identifiers, not catalog existence (detect-not-prevent, #220).
- One `patch` changeset (D83); docs touched: `docs/guide` (tables / indexes page), `skills/hejbro/references/dsl-cheatsheet.md`, README feature list if it enumerates index options.
