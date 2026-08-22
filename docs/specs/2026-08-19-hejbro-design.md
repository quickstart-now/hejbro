# hejbro — Design Specification

Date: 2026-08-19
Status: Approved by the project owner. This document is the single source of
truth for what hejbro is and every design decision made so far. It was
produced in a brainstorming session between the owner and Claude; the
implementation is handed off to fresh Claude sessions running in this repo.

## 1. One-line definition

**hejbro** — declare *everything* in your Postgres database (tables, RLS,
functions, triggers, views, grants) in TypeScript, and generate deterministic
migration SQL from the diff.

Name: Swedish *hej* ("hello") + *bro* ("bridge") — "hello, bridge": a bridge
between TypeScript and Postgres. Fits the genre's naming convention (Kysely is
Finnish for "query"). npm names `hejbro` and PyPI `hejbro` were verified free
on 2026-08-19; the `@hejbro` npm scope (public org) is already owned by the
project owner (confirmed 2026-08-19). The GitHub org (`quickstart-now`) and
the npm scope intentionally differ: the scope follows the product brand, the
org follows the operating entity. Publishing remains owner-gated.

## 2. Motivation

The project owner runs production Supabase projects and hit this wall:

1. **MCP is not the answer for DB work.** Letting an AI create/alter/drop
   schema objects or RPCs through MCP is high-risk: changes are hard to
   review from the user's point of view and hard to trace afterwards.
2. **Raw SQL is not the answer either.** It is unintuitive and painful to
   review and maintain.
3. **Drizzle's declarative schema management is excellent but incomplete.**
   Tables and RLS are covered; functions (RPCs), triggers, grants, and
   storage objects are not. In practice this forces a hybrid where the
   uncovered objects live as hand-written SQL strings appended to migrations
   by convention (see `quickstart-labs/infra/*-supabase/sql/*.ts` for the
   real-world workaround that motivated this project).

hejbro closes that gap: **code is the single artifact an AI writes and a
human reviews; the migration SQL is generated, deterministic, and traceable.**

## 3. Decision log

Every decision below was made explicitly by the project owner during design.
Do not silently revisit them; if implementation reveals a blocker, surface it
and ask.

| # | Decision | Alternatives considered | Rationale |
|---|----------|------------------------|-----------|
| D1 | **Standalone tool**, not a Drizzle companion/wrapper | Drizzle companion (manage only "the rest"); drizzle-kit wrapper | Full freedom over the declaration model; no coupling to drizzle-kit internals |
| D2 | **Pure TS DSL compiled to plpgsql** for function bodies | Signature-in-TS + SQL-string body; .sql files + declaration headers | The compiler *is* the novelty; bodies become typed, reviewable code |
| D3 | **v1 ships both** the compiler and the schema/diff engine | Compiler first; schema engine first | Owner wants the full vision in v1 (decomposition happens at the plan level, not the product level) |
| D4 | Compile mechanism: **builder DSL with execution tracing** (option A) | TS AST static analysis (B); hybrid (C) | Realistic implementation cost; the API surface *is* the supported boundary; TS inference comes free. B builds a full compiler frontend and hides semantic traps (code that looks like TS but behaves like SQL). C is a possible later extension on top of A |
| D5 | **Generic Postgres core + provider presets** | Supabase-only; generic-only | Wider open-source audience, no vendor lock; Supabase pain solved via the first preset. Owner explicitly wants **Neon and Nile presets later**, so the preset interface is a first-class extension point, not a special case |
| D6 | **Snapshot-based diff** (drizzle-kit style) | Live-DB introspection diff (Atlas style); snapshot + drift check | Deterministic, no DB connection, CI-friendly. Drift check against a live DB is a possible v2 command |
| D7 | v1 object scope: tables, columns, indexes, FKs, enums, functions, triggers **+ RLS policies + views + grants/roles + Supabase preset objects** | Narrower subsets | Owner chose full scope for v1 |
| D8 | Repo: **`quickstart-now/hejbro`** (org repo) | Personal repo; new org | Reuses existing org management/CI conventions |
| D9 | License: **MIT** | Apache-2.0 | Widest adoption, genre norm |
| D10 | Name: **hejbro** | plts, pgform, declpg (all verified free) | Owner's choice |
| D11 | "AI native" means the **development process**: this OSS is built by AI agents (Claude Code), openly. Agent skills for *users* of hejbro ship as a feature (`@hejbro/skills`) | AI-native as product identity | Owner's clarification |
| D12 | **Applying migrations is out of scope for v1.** hejbro generates SQL files; the user's existing pipeline (supabase CLI, GitHub integration, etc.) applies them | Built-in apply/push | Keeps core pure and deterministic; avoids owning credentials |
| D13 | Build tooling: **tsdown, ESM-only output**, Node ≥ 22 (decided 2026-08-19, Phase 1 brainstorm; amended 2026-08-19) | tsup; plain tsc; dual ESM+CJS | tsdown is tsup's endorsed successor; ESM-only avoids the dual-package hazard for a new dev tool. Node ≥ 22 is the runtime support floor promised to hejbro users; the repo's own toolchain requires ≥ 22.18.0 (tsdown's engines range). Amended 2026-08-19, owner-approved: Node 20 reached EOL 2026-04, so the original "Node ≥ 20" floor was raised |
| D14 | Migration filenames default to **Supabase-style timestamps**: `YYYYMMDDHHMMSS_<slug>.sql`, with a configurable prefix strategy (`timestamp` \| `index` \| `unix`) (decided 2026-08-19) | drizzle-style index prefix (`0001_`) as default | The owner hit real ordering mismatches between drizzle's default and the supabase CLI (`drizzle-kit generate --prefix supabase` exists for this reason); Supabase-first means Supabase-compatible by default |
| D15 | `table()` returns a **drizzle-style table object**: column references as top-level properties (`posts.id`), declaration metadata hidden behind a symbol (accessed via `getTableMeta()`) (decided 2026-08-19, Phase 2 brainstorm) | keep metadata top-level + reserve column names; nested namespace (`posts.c.id`) | §5's examples (`posts.id`, `t.publishedAt`) are normative; the symbol pattern removes column-name collisions entirely. Breaking change to the Phase 1 `table()` surface, approved pre-publication |
| D16 | `ColumnDefault` is **fully replaced by the Phase 2 expression AST**; snapshots store defaults as rendered SQL strings; snapshot version bumps 1 → 2 (decided 2026-08-19, Phase 2 brainstorm) | keep the 4-shape union and add an `expr` variant alongside | One representation, one emit path; pre-publication is the only cheap moment. `defaultRandom()` / `defaultNow()` keep their surface (now sugar over AST nodes) |
| D17 | Expressions carry a **phantom type by Postgres type family** (`Expr<"uuid">`, `Expr<"boolean">`, …), not per-type or untyped; `ColumnBuilder` and column factories are generified to carry the family (decided 2026-08-19, Phase 2 brainstorm) | untyped `Expr`; fully-typed per Postgres type | Catches the common uuid-vs-text class of mistakes (both `string` in JS) while combinators collapse to `Expr<"boolean">`, keeping type errors shallow. Phase 3 proxies reuse the same system |
| D18 | Injection posture: the `sql` tagged template **always renders interpolated non-expression values as quoted literals** — plain strings can never splice in as raw SQL; raw text requires the separate, greppable `sql.raw()` (decided 2026-08-19, Phase 2 brainstorm) | no raw escape hatch at all; raw strings allowed in the template | Injection-by-construction is prevented on the default path structurally; `sql.raw` stays reviewable (`rg "sql.raw"`) |
| D19 | Phase 2 query-builder scope is the **expanded standard-clause set** (adds `order by`, `limit`, `on conflict`, `inArray` beyond the corpus minimum; exact list in the Phase 2 plan), and `with check`-shaped expressions join the golden corpus (decided 2026-08-19, Phase 2 brainstorm; owner overrode the minimal-scope recommendation) | corpus-derived minimum (where/inner join/exists/returning only) | Owner chose broader standard coverage now over a second pass later |
| D20 | New `ExprNode` variant `plpgsqlRef` (`{ nodeKind: "plpgsqlRef", path: string[] }`) represents NEW/OLD fields, function args, and plpgsql locals, under a **dual quoting policy**: database object identifiers stay quoted (existing `quoteIdentifier`), plpgsql local identifiers render **unquoted**, guarded by a reserved-word blocklist that raises `reserved-local-name` at declaration time (decided 2026-08-19, Phase 3 brainstorm; owner-approved) | widen `columnRef` to cover locals; quote every identifier including plpgsql locals | plpgsql locals must be unquoted to be valid syntax (`new.parent_id`, not `"new"."parent_id"`); a dedicated node keeps the Phase 2 `columnRef` invariants (and its scope validation) untouched — `plpgsqlRef` is invisible to `collectColumnRefs` |
| D21 | Row reads (`ctx.row`/`ctx.rowOrNull`) declare **one scalar local per projected column**, never a `record` variable — name `${rowName}_${snake(projectionKey)}`, `rowName` explicit or a deterministic counter (`row_1`, `row_2`, …); strictness lives in the method name (`ctx.row` → `select … into strict`, `ctx.rowOrNull` → `select … into`) (decided 2026-08-19, Phase 3 brainstorm; owner-approved) | a single `record` variable with field access (`parent.post_id`) | A `record` variable's fields are only valid after a successful `select into`; reading an unassigned field is a runtime trap plpgsql doesn't catch statically. Scalar locals make "was this row found" explicit per-field and match the original production schema's hand-written trigger style |
| D22 | The determinism guard runs the body callback **twice** with fresh recording contexts and compares the two trees **structurally** via `stableJson`; `declaredAt` is filled **best-effort** by parsing `new Error().stack` at the `defineFunction`/`defineTrigger` call site (pure string parsing, no filesystem access — degrades to `null` on any runtime/format it can't read), and every declaration- and recording-time error carries the object's `identity` in its message body regardless of whether `declaredAt` resolved (decided 2026-08-19, Phase 3 brainstorm; owner-approved) | compare rendered SQL strings instead of the recorded trees; skip declaration-site capture entirely | Structural comparison catches non-determinism before rendering (cheaper, and pinpoints the AST shape that diverged, not just SQL text); best-effort stack capture gives most users a jump-to-source without making it a hard requirement — stack trace formats vary across JS runtimes |
| D23 | Functions `create or replace` only when the **structured signature is identical** (arg names + types in order, `returns`, `security`, `language`) and only the body differs; any signature difference emits a `drop` + `create` **pair of SQL statements**, rendered by a single `alter` `KindChange` (decided 2026-08-19, Phase 3 brainstorm; owner-approved; wording amended 2026-08-19 after #55 — see below) | attempt `create or replace` unconditionally and let Postgres reject an incompatible one | Postgres itself rejects `create or replace function` across an argument or return-type change; deciding this in the compiler (not at apply time) keeps generated migrations valid without a live database, matching hejbro's snapshot-diff posture (D6). A same-identity recreate (trigger, function-signature, or Phase 2 enum-value-removal) must be **one `KindChange`** whose `emit` orders its own drop before its own create — representing it as two separate `KindChange`s let the diff engine's global create/alter-before-drop ordering split the pair and hoist the create ahead of the drop (bug #55, fixed same-day by the Phase 3 acceptance golden review) |
| D24 | Function snapshot nodes additionally store the rendered **`bodySql`** alongside `bodyHash` — `bodyHash` remains the change-detection key (§6.4), `bodySql` is what `emit` renders verbatim on create/`alter` (decided 2026-08-19, Phase 3 brainstorm; escalated to and approved by the owner mid-phase) | keep only `bodyHash` in the snapshot and re-render from the original declaration at emit time | `ObjectKind.emit` is contractually snapshot-only (Phase 1 design, `kind/object-kind.ts`) — it never sees the original declaration, so it cannot re-render the body from scratch; drizzle-kit stores full SQL text in its snapshots for the same reason (precedent) |
| D25 | RLS is modeled as **two new object kinds** — `rls` (per-table enable/force, identity `<schema>.<table>`) and `policy` (identity `<schema>.<table>.<name>`) — expanded from `TableExtras.rls` in `resolveDeclarations`; the table kind's snapshot shape is untouched and the snapshot version stays 2 (decided 2026-08-19, Phase 4 brainstorm; owner-approved) | store RLS inside the table kind's snapshot | Embedding RLS in the table snapshot changes every existing table's serialized shape — a spurious diff for unchanged tables and a forced version bump; separate kinds are purely additive (Phase 3 precedent: the function/trigger kinds landed without a bump). A policy change recreates via a **single** `alter` `KindChange` whose emit orders drop before create (D23, bug #55) |
| D26 | Policy DSL: `rls.policy(name)` is a **type-state chain** — `for()` with select/delete exposes only `.using()`, insert only `.withCheck()`, update/all expose both with at least one required; `.to()` is **mandatory** (no implicit PUBLIC — an explicit `to("public")` renders the keyword); `rls.enabled`'s object keys are TS-side labels only (the SQL policy name is `rls.policy(name)`'s argument); `rls.enabled(policies, { force: true })` covers `force row level security` (decided 2026-08-19, Phase 4 brainstorm; owner-approved) | validate clause combinations at generate time; make the record key the SQL policy name | Postgres rejects `with check` on select/delete policies and `using` on insert policies — making illegal combinations unrepresentable moves the error into the editor (D18's by-construction posture applied to RLS); mandatory `to()` closes the implicit-full-exposure trap; label keys allow two policies for the same command on one table |
| D27 | `defineView(owner, name, query, options)` with a neutral `securityInvoker` option: the view kind's snapshot stores the **rendered select SQL plus the projected column-name list** (derived from the existing `SelectNode.projection`); diff uses the **prefix rule** — previous columns a prefix of next emits `create or replace view`, anything else recreates via a single `alter` change (decided 2026-08-19, Phase 4 brainstorm; owner-approved). The "view over an RLS-enabled table without security_invoker" warning is Supabase-preset work (#66, Phase 6) | re-render view SQL from the declaration at emit time; diff on rendered SQL alone; put the RLS-bypass warning in core | `ObjectKind.emit` is snapshot-only (D24 precedent); Postgres only allows `create or replace view` to append columns at the end — the prefix rule mirrors the engine's exact contract; definer-rights views silently bypassing RLS is a real Supabase pitfall, but core stays provider-neutral (§4.1) |
| D28 | Grants: identity is **(schema, grantKind, role)** with three grantKinds — `schemaUsage`, `allTablesPrivileges`, `defaultTablePrivileges` (a representative production subset of `alter default privileges`: `in schema … grant … on tables to <role>` only; owner/for-role variants out of scope) — `to(...roles)` fans out into one declaration per role via a `grant-set` expansion; diff is a **privilege-set delta**: additions emit `grant`, removals emit `revoke`, declaration removal revokes the set; role names are plain strings for now (Phase 6 may widen to a branded role type non-breakingly) (decided 2026-08-19, Phase 4 brainstorm; owner-approved, including the default-privileges scope call) | one declaration per multi-role statement; diff whole grant statements textually | Per-role identity makes the snapshot-delta (`grant`/`revoke` only, §6.5) fall out of the ordinary per-identity kind diff, keeps banner lines per-role, and routes duplicate declarations through the existing `duplicate-identity` check |
| D29 | Declaration/config loader = **jiti only** (a self-contained Babel-based source transform run on import; tsx rejected). `hejbro.config.ts` loads through the same jiti path as declaration entries — the loader is fixed by the CLI, not configurable (decided 2026-08-20, Phase 5 brainstorm; owner-approved) | tsx; ts-node; Node's native type stripping; a user-configurable loader | jiti's transform-on-import path keeps a single, deterministic loading path across config and entries; a configurable loader would reintroduce mixed toolchains and a support burden. Node native type stripping was the most seriously considered alternative and was rejected: it hard-errors on enums and namespaces, fails on extension-less relative imports (a common TS authoring style), ignores `tsconfig` `paths`, and is only enabled by default from Node 22.18+ — short of D13's "Node ≥ 22" floor. D13's Node ≥ 22 floor is unchanged |
| D30 | `hejbro.config.ts` is authored via a **`defineConfig()`** helper and validated with **zod** at CLI load time (zod is a CLI-only dependency, never added to `@hejbro/core`); zod's own error text never reaches the user — every validation issue is re-wrapped into the spec §7 diagnostic grammar. Config fields: `entry`, `migrationsDir`, `snapshotPath`, `prefixStrategy` (D14); no preset fields reserved yet (decided 2026-08-20, Phase 5 brainstorm; owner-approved). **Superseded by D55** (Phase 7): the config gains an optional `presets` field | hand-rolled validation; no validation (trust TS types) | TS types don't survive a loosely-typed dynamic import (jiti returns `unknown`); zod gives one validation surface without leaking library-specific error text, honoring §7's error-quality bar |
| D31 | CLI framework = **citty** (decided 2026-08-20, Phase 5 brainstorm; owner-approved) | commander; yargs; a hand-rolled arg parser | citty's typed, declarative command definitions fit a small, single-purpose CLI (`init`/`generate`/`verify`) without extra ceremony |
| D32 | Column/table renames are resolved **non-interactively via CLI flags** — no TTY prompts, no prompt library, in v1. `--rename <schema>.<table>.<old>=<new>` for a column, `--rename <schema>.<old>=<new>` for a table (2 segments); `--confirm-drop <schema>.<table>.<column>` or the table-level `--confirm-drop <schema>.<table>` (2 segments), both flags repeatable. **Rule A**: any same-table drop+add pair, regardless of whether the types match, is treated as an ambiguous rename candidate; cross-table moves are never rename candidates; the no-flag path is the documented **expand–contract** pattern (add in one `generate` run, migrate data, drop in a second run). Every rename/confirm-drop error prints the exact rerun command (decided 2026-08-20, Phase 5 brainstorm; owner-approved) | an interactive TTY prompt (inquirer-style); a heuristic auto-rename (type+position matching) | CI/agent-drivability (the CLI must run non-interactively, matching the spec's AI-native posture, §2/D11) rules out TTY prompts; a heuristic silently guesses and risks data loss on a drop+add pair that merely shares a type — flags make the rename decision explicit, auditable, and (via the rerun-command output) a one-line fix when wrong |
| D33 | The **single committed snapshot file** (`snapshotPath`) stays the source of truth (no per-migration snapshot files); every migration's banner additionally carries `parent-snapshot:`/`snapshot:` sha256 lines (of the normalized snapshot text), forming a hash chain across migration files that lets `hejbro verify` detect divergent branches (`error[diverged-migrations]`) without a live database. The snapshot's JSON shape must stay **compact**: no duplicating a key's own identity inside its serialized node, and no recording a field's Postgres default value explicitly (e.g. `notNull: false`) — audited and enforced in Phase 5 (see the implementation plan's Task 3). The snapshot is **derived state**: recovery is via git history, never regeneration from a live database (decided 2026-08-20, Phase 5 brainstorm; owner-approved; amended 2026-08-21) | per-migration snapshot files (drizzle-kit style); no hash chain (trust the migrations directory alone); allow snapshot regeneration from a live database | A single file keeps the "declarations ↔ snapshot ↔ migrations agree" CI check (§6) simple; the hash chain is a cheap, pure (no DB) way to catch two branches that both extended the same snapshot state and were merged out of order; compactness keeps the file reviewable and its churn limited to real changes. Amended 2026-08-21, owner-approved: expression nodes are stored **structurally** rather than as rendered SQL strings, so a rename can retarget the identifiers inside them exactly (D67); the two original compactness rules — no duplicating a key's own identity, no recording a field's Postgres default — stand |
| D34 | The consistency-check command is **`hejbro verify`** (`hejbro check` stays reserved for a future §9 live-DB drift check). `verify` runs four checks in one pass: the snapshot file parses; declarations, once built, byte-match the on-disk snapshot; the migrations directory's banner hash chain is linear; the chain's tip hash equals the current snapshot's hash (decided 2026-08-20, Phase 5 brainstorm; owner-approved) | naming the command `hejbro check`; a single combined check instead of four; checking only the migrations directory (not declarations) | `check` is reserved for the live-DB command already named in §9's out-of-scope list, avoiding a future rename; four isolated checks (corrupt file, stale snapshot, merged-out-of-order migrations, hand-edited snapshot) let `verify`'s output tell the user exactly what to fix |
| D35 | `hejbro init` scaffolds exactly three artifacts — `hejbro.config.ts` (via `defineConfig`), the migrations directory, and an **empty** snapshot file — never an example declaration file. It is **idempotent**: existing artifacts are left untouched and reported as skipped, and it always exits 0. The missing-`entry`-file case is the onboarding surface, whose error message carries a full example (decided 2026-08-20, Phase 5 brainstorm; owner-approved) | also scaffolding an example schema file; failing if any artifact already exists | An example file would need to be kept in sync with the DSL surface indefinitely (deferred to a docs issue instead); idempotency lets `init` double as a "repair missing pieces" command, safe to run in CI or by an agent without checking state first |
| D36 | `schema()`/`table()` (and every column, index, and foreign-key name they derive) validate their final SQL name against `^[a-z][a-z0-9_]*$` at declaration time, hard-erroring (`invalid-sql-name`) on violation (decided 2026-08-20, Phase 5 brainstorm; owner-approved) | allowing arbitrary identifiers and quoting everything; validating only at emit time | The `--rename`/`--confirm-drop` flag grammar (D32) uses `.` and `=` as separators — an identifier containing either would make flags ambiguous or unparseable; declaration-time validation surfaces the error at the earliest point, next to the offending TypeScript |
| D37 | Preset validation channel: `generateMigration` takes an optional **`validators`** array — pure functions `(snapshot, declarations) => ReadonlyArray<Diagnostic>` — and its result gains a **`warnings`** field. A `Diagnostic` is a `HejbroError` plus a `severity` (`"warning"` \| `"error"`); error-severity diagnostics join `errors` and short-circuit generation exactly like rename errors. §4.1 grows from four to five preset contributions (decided 2026-08-20, Phase 6 brainstorm; owner-approved) | a fifth `validate` stage on `ObjectKind` (breaks the "diff sees only its own kind" invariant, breaking redesign); preset-exported checks wired only through CLI config (drags CLI work into the phase and leaves core's result incomplete) | The two Supabase warnings (exposed table without RLS; view over RLS, #66) need cross-kind visibility no single kind's `diff` has; with validators, core stays a pure executor that never knows what a check does — §4.1's spirit intact with the smallest surface change |
| D38 | Reserved-schema protection is a **hard error, not a warning**: the Supabase preset ships a validator erroring on any *managed* declaration (schema, table, view, function, trigger, grant, RLS/policy) that targets `auth`/`storage`/`realtime`; reference-only existing tables (D41) are exempt by construction — they are never declarations (the *declaration* path hard-errors, the *reference* path is allowed). Supersedes §4.1's original "excluded from diffing, warn when touched" wording (decided 2026-08-20, Phase 6 brainstorm; owner-approved) | warning severity (the original wording); a schema blacklist hardcoded in core | Emitting `create schema auth` against a real Supabase database can only fail at apply time — failing at generate time is strictly safer; keeping the list in the preset keeps core free of Supabase knowledge |
| D39 | The #66 "view over an RLS-enabled table without `security_invoker`" warning judges from the **original declarations** (`ViewDeclaration.query.from`/`joins` cross-checked against RLS declarations), not from snapshots; `ViewSnapshot` stays `selectSql` + `columns` (decided 2026-08-20, Phase 6 brainstorm; owner-approved) | adding a `references` table list to `ViewSnapshot` for snapshot-side judging | The warning is a property of the *current* declaration set — no history needed; D37's validators already receive declarations, so the snapshot format (D33 compactness) stays untouched |
| D40 | The "exposed table without RLS" warning fires only when the table's schema carries an `allTablesPrivileges` or `defaultTablePrivileges` grant to `anon` or `authenticated` **and** the table declares no RLS (decided 2026-08-20, Phase 6 brainstorm; owner-approved) | Supabase-advisor style: warn on every `public`-schema table without RLS, grants ignored | The grant-based condition matches what hejbro can actually observe — PostgREST's exposed-schema list lives outside the database; the advisor approach's blanket rule would false-positive on schemas the user never granted to API roles |
| D41 | **Existing-table references become a core primitive**: `existingTable(schemaName, tableName, columns)` builds a reference-only `Table` — usable as an FK target, in RLS `exists()`, and in view from/joins — whose name and type say it sits outside the diff/emit lifecycle: it is never passed to `generateMigration`, and passing one as a declaration is a hard error (`existing-table-declared`). Presets package prebuilt references — Supabase ships `authUsers`, which `drizzle-orm/supabase` does not offer (a deliberate differentiation) (decided 2026-08-20, Phase 6 brainstorm; owner-approved) | documenting the hand-built `tableMeta` workaround — technically possible today (FK serialization stores only identity strings) but an undocumented low-level surface hejbro cannot support; Drizzle's shape: `.existing()` exists only on roles and views, tables are declared normally and scoped out via drizzle-kit's `schemaFilter` | `public → auth.users(id)` FKs are the single most common Supabase pattern and deserve a first-class, typed, documented surface; the underlying mechanism already exists, so this names and types it instead of adding engine complexity, and it keeps D38 airtight (a reference is not a declaration). Generic by design: Neon/Nile need the same concept |
| D42 | Storage buckets are the **first row-data object kind** (`supabase-storage-bucket`): `create`/`alter` emit one idempotent `insert into storage.buckets … on conflict (id) do update set …`; `drop` emits **no SQL** — the migration banner notes that the bucket (and its objects) must be deleted manually (decided 2026-08-20, Phase 6 brainstorm; owner-approved) | emitting `delete from storage.buckets` on removal; a `where not exists` guard plus separate `update` | Buckets are rows in a Supabase-owned table, not DDL; auto-deleting a bucket destroys user files — beyond what a generated migration may do. D24 holds: the snapshot carries every bucket field, so `emit` renders from the snapshot alone |
| D43 | **Branded `Role` type lands now** (the path D28 reserved): core exports `Role` (a branded string) and `roleName()`; `grant().to()` / `rls.policy().to()` widen to `string \| Role` (non-breaking); preset role constants (`anonRole`, `authenticatedRole`, `serviceRole`) are typed `Role` (decided 2026-08-20, Phase 6 brainstorm; owner-approved) | staying with plain strings + constants; requiring `Role` everywhere (breaking) | Typo-safety for preset constants at zero migration cost — every existing string call site keeps compiling; tightening to `Role`-only remains possible later |
| D44 | Phase 6 acceptance = a **reduced example, ported from the original production schema**, exercising every preset feature once (an `authUsers` FK, an `authUid()` RLS policy, a storage bucket, role-preset grants) plus **`examples/preset-smoke`**, a toy preset proving interface genericity with one custom kind and one expression helper; the full production-schema port stays Phase 7 (decided 2026-08-20, Phase 6 brainstorm; owner-approved). **Superseded by D53** (Phase 7): showcase examples are generic and named by database (`examples/postgres`, `examples/supabase`); no project port | porting the full production schema in Phase 6; extending `examples/cli-smoke` instead of a new example | Acceptance needs each preset feature end-to-end once, not the whole corpus; this reconciles the roadmap's Phase 6 acceptance line with its Phase 7 "full production-schema port" item |
| D45 | `authUid()` renders the **plain `auth.uid()` call** (`Expr<"uuid">`) — no automatic `(select auth.uid())` initPlan wrapping; the cached variant is a Phase 7 follow-up issue, and the preset README carries the RLS performance guidance (decided 2026-08-20, Phase 6 plan review; owner-approved) | wrapping by default; shipping a second wrapped helper alongside now | Subqueries are illegal in column `default`/`check` expressions, where `auth.uid()` is also idiomatic — auto-wrapping would break those call sites; the plain call is correct everywhere and the optimization stays an explicit opt-in later |
| D46 | **Table-kind completeness is absorbed into Phase 7 as its leading work group**: CHECK constraints, partial indexes (`where`), index column ordering (`desc` / `nulls first\|last`), FK `on update`, and self-referencing FKs (#22) land before the examples; the roadmap headline is unchanged (decided 2026-08-20, Phase 7 brainstorm; owner-approved) | inserting a separate phase; relaxing the acceptance bar so the examples only use what the DSL expresses today | Roughly a third of a realistic production schema's declarations (CHECKs, partial/ordered indexes, FK actions, a self-FK) were inexpressible; the expression AST and `sql` template already exist, so the work is table DSL/snapshot/emit/diff plumbing, not a new expression system |
| D47 | **Phase 7 sub-issue triage**: stays in #8 — the table-kind issues (#104, #105, #106), #22, #102, #96, #27, #83, #84, #85 (docs as markdown under `docs/` only); moves to Phase 8 (#9) — #23, #24, #25, #26, #87, #89, #97 (decided 2026-08-20, Phase 7 brainstorm; owner-approved; #88 rode along in PR A2) | keeping every carried issue in Phase 7; a GitHub Pages site in Phase 7 | Only #22 blocks the acceptance examples; #23 self-normalizes under the two-path dump comparison (D48); #24 has no driver in the designed migration chain; #97 is unused by the examples |
| D48 | **Round-trip = two-path dump comparison**: DB1 applies the migration chain in order, DB2 applies one fresh `generateMigration(empty → final snapshot)`; `pg_dump --schema-only --no-owner` from the *container's* `pg_dump` on both, SET headers stripped, diff must be empty. Row-data kinds (storage bucket) are compared by a query since `--schema-only` omits rows. Each showcase example carries a designed 4-step chain: baseline → add a column + CHECK → change FK actions → move a column across tables (the `--confirm-drop` path, D32) — the step also adds a column to the source table so D32's same-table rule A engages (decided 2026-08-20, Phase 7 brainstorm; owner-approved) | apply-only (the first half of this); comparing against a hand-written reference dump | Postgres renders the catalog, not hejbro's SQL — a neutral judge of the "diff path ≡ create path" promise; auto-generated constraint names, serial decomposition (#23), and grant fan-out appear identically on both sides. A reference dump costs maintenance on every change and couples to `pg_dump`'s format |
| D49 | **The round-trip runs locally via Docker, not in CI** (roadmap change): a `pnpm roundtrip` script per example on plain `postgres:17-alpine` (seed SQL only for objects outside hejbro's scope — cluster-level roles; the preset's `storage.buckets` stub), Docker CLI only — `psql`/`pg_dump` run inside the container, no Postgres driver dependency. `.github/workflows/ci.yml` is unchanged and `pnpm test` stays DB-free; acceptance = local round-trip green with the output attached to the PR (decided 2026-08-20, Phase 7 brainstorm; owner-approved) | a GitHub Actions `services: postgres` job; the `supabase/postgres` image; a two-job split | The owner wants a runnable local example, not CI machinery; the same script can be called from a CI job later. The Supabase image costs ~360 MB for two roles and one table |
| D50 | **CHECK constraints**: `checks: [check(name, expr)]` in the table `extras` callback — name required (`assertSqlName`, D36), expression = any boolean `Expr` (operator helpers or the `sql` template with `${t.col}` interpolation; no generic function-call helpers this phase). Snapshot stores the rendered SQL string (`checks?: [{ name, expression }]`, omitted when empty per D33). Change = drop + add; rename = removed + added. Emit order: FK drop → CHECK drop → index drop → column drop → column add/alter → index add → CHECK add → FK add (deferred). Validation: own-table column refs only, `exists` rejected (decided 2026-08-20, Phase 7 brainstorm; owner-approved) | optional names with a derived fallback; generic function helpers now | A CHECK has no natural key — two constraints on one column would collide under any derived name — so names are the diff key, as in Drizzle's `check(name, sql)`. The template already covers `length`/`btrim`/`jsonb_typeof`/regex |
| D51 | **Partial indexes, index ordering, FK `on update`, snapshot v3**: ordering via wrapper functions on column refs (`desc(t.col, { nulls: "first" })`, `asc`), `ColumnRef` stays a plain object; partial index = `.on(...).where(expr)` (SQL reading order; `.on()` is no longer terminal), predicate rules = CHECK rules. **Snapshot version bumps to 3**: `IndexSnapshot.columns` becomes `[{ name, desc?, nulls? }]` plus `where?: string`; all goldens/snapshots/banner hashes regenerate, no shim. FK gains `onUpdate?` symmetric to `onDelete` and `set default` joins `foreignKeyActions`. In scope: `emitAlter` turns `indexDiff.changed` into drop + create (today it only notes it), and new `duplicate-index-name` / `duplicate-foreign-key-name` hard errors (decided 2026-08-20, Phase 7 brainstorm; owner-approved) | Drizzle-style column methods (`t.col.desc()`); an options object; an additive snapshot keeping `columns: string[]` with a parallel ordering array (version 2) | Functions match hejbro's "expressions are functions" convention and keep column refs light; the owner chose the clean object-array shape over additive compatibility while pre-publication (D16 precedent). The changed-index omission is a silent-omission bug that partial predicates would make common |
| D52 | **Self-referencing FKs use the callback's own column refs**: `references: { columns: [t.id] }` — `table` becomes optional on every FK (one rule, not a self-only exception); the referenced table identity is derived from the column refs' `exprNode`, cross-checked against `table` when given (`foreign-key-table-mismatch`), and all referenced columns must share one table. Existing `{ table: posts, columns: [posts.id] }` keeps compiling; snapshot and emit unchanged (decided 2026-08-20, Phase 7 brainstorm; owner-approved) | the thunk form from #22 (`references: () => ({ table: comments, columns: [comments.id] })`); string column names; removing `table` entirely | The thunk fails under strict TS with TS7022/TS7023 (a const referenced in its own initializer — the same limit behind Drizzle's `(): AnyPgColumn =>` annotations), reproduced with a scratch `tsc --strict` probe; strings break D15's typed refs; dropping `table` churns every existing example for no gain |
| D53 | **Showcase examples are named by database and their content is generic** (roadmap change): `examples/postgres` (core only — tables, CHECK, partial/ordered indexes, a self-FK, RLS, a trigger, grants, a view; plain Postgres round-trip) and `examples/supabase` (the preset — role presets, `authUsers`, `authUid()`, a storage bucket, validators; seeded round-trip) — the plain-Postgres example still seeds the two roles its grants target, since hejbro manages grants and RLS but never `CREATE ROLE`. Neither is a port of any particular project and neither carries a project name. Acceptance = both examples' local round-trip green; the existing reduced example's content seeds `examples/supabase`; `cli-smoke`/`preset-smoke` are test fixtures, not showcases (decided 2026-08-20, Phase 7 brainstorm; owner-approved) | porting a specific production schema; naming the example after its domain | Showcase examples must read as documentation for every user rather than as a port of one project; a generic schema plus a designed migration chain exercises the same change classes a real history would |
| D54 | **`@hejbro/skills` ships as a repo-distributed agent skill**: installed with `npx skills add quickstart-now/hejbro` (the GitHub repo is the unit; npm bundling of the same files is Phase 8). One skill, `hejbro`: a short `SKILL.md` of always-true rules plus a references index, with four references — `dsl-cheatsheet`, `function-builder-pitfalls`, `generate-verify-workflow`, `supabase-preset`. Code samples are links to files under `examples/postgres` / `examples/supabase` plus a small vitest asserting every referenced path exists. Source location (`packages/skills/` vs repo-root `skills/hejbro/`) and the frontmatter version field are settled against the skills CLI source as the first implementation task (decided 2026-08-20, Phase 7 brainstorm; owner-approved) | npm + a `hejbro skills install` subcommand; separate core/supabase skills now; a marker-extraction build step for samples | Repo distribution completes without the Phase 8 npm gate and avoids re-implementing the CLI's per-agent install paths; the examples are already behind the check-types/test gates, so linking beats copying |
| D55 | **D30 reopened — config `presets` field**: core gains a pure data type `Preset = { name; kinds: ReadonlyArray<ObjectKind>; validators: ReadonlyArray<Validator> }` (no side effects at config load; zod validates shape only). `@hejbro/supabase` exports `supabasePreset`; `registerSupabaseKinds` stays as the lower-level helper. `hejbro.config.ts` gains optional `presets: Preset[]`; `generate` and `verify` both register preset kinds, `generate` passes validators and renders `warnings` to stderr in the §7 grammar after writing the migration (exit 0; warning golden texts need owner approval). `examples/supabase` gets a config + CLI e2e. Out of scope: `--fail-on-warning` (decided 2026-08-20, Phase 7 brainstorm; owner-approved) | keeping D30 (presets only via the programmatic API) | Without config wiring a Supabase user cannot reach the bucket kind or validators from `hejbro generate`; a data object keeps config loading side-effect free and lets zod stay a shape check |
| D56 | **README becomes the landing page and docs live as markdown**: README order = §11 pitch → 60-second example (generic schema name, table + RLS + a `ctx.if` function → `hejbro generate` → SQL excerpt) → how it works (declarations → snapshot → diff → migration; `verify` hash chain, D33) → packages table + links to the two examples and the local round-trip → agents (`npx skills add quickstart-now/hejbro`) → built AI-natively → status (pre-alpha, not on npm) → license. **No competitor comparison table**; §11's precedent honesty stays as prose. Docs pass = `docs/guide/getting-started.md` (#83), `renames.md` (#84), `ci.md` (#85); no GitHub Pages (Phase 8); plus a repository-wide sweep replacing the earlier project-specific example naming with the generic examples (decided 2026-08-20, Phase 7 brainstorm; owner-approved) | a comparison table against Drizzle/Prisma/Supabase CLI; a docs site now | The owner rejected comparison tables; leading with the TS → PL/pgSQL builder compiler states the novelty without scoring competitors, and markdown under `docs/` ships without site tooling |
| D57 | **Naming unification — snapshot vocabulary and artifact-token case**: a snapshot field that names the object itself is `name`; a field naming another object takes that object's noun (`schema`/`table`/`function`) — only the serialized key changes, never TypeScript declaration fields/parameters/locals. Tokens that reach generated artifacts (snapshot values, identities, migration banners, config values, error/warning codes) are kebab-case; a TypeScript-only union stays camelCase, and internal expression/statement AST discriminators are out of scope entirely (they never reach an artifact — that ceased to hold with D67; see D70). Landed: `schema` kind's `schemaName` → `name`; `trigger` kind's `functionName` → `function`; `GrantKind`'s three values → `schema-usage`/`all-tables-privileges`/`default-table-privileges`; the snapshot's own top-level version field, `hejbroSnapshot` → `formatVersion` (the rule reaching its own format marker) — **snapshot version bumps `3` → `4`** for this one (D16/D51 precedent: a key rename is a format change), while `HEJBRO_SNAPSHOT_VERSION` keeps its name (no public-export-surface change). `parseSnapshot` still recognizes the old `hejbroSnapshot` key on a pre-v4 file well enough to give it the normal "older" message rather than misparse it. Enforced by `packages/core/test/naming-conventions.test.ts`, which scans generated output, not source text (decided 2026-08-21, Phase 7 brainstorm; owner-approved) | leaving the two vocabularies mixed; a Biome `useNamingConvention` lint instead of a scanning test | A snapshot/banner/identity is a data interchange format read by humans, diffs, and other tools — camelCase there is a TypeScript habit leaking across the boundary; a test over real output can't be satisfied by a source-only rename the way a grep-based check could |
| D58 | Every published package declares `engines: { node: ">=22.18.0" }`, and CI gains a Node 22 matrix entry so the floor D13 promises is actually exercised. D13's floor itself is unchanged (decided 2026-08-21, Phase 8 brainstorm; owner-approved) | raise the floor to 24 (a D13 amendment); declare `engines` but keep testing only on 24 | The promise (D13), the declaration (`engines`) and the verification (CI) have to agree at v1: no published package declared `engines` at all, and the promised floor of 22 was never run. A support floor is a breaking change to raise after publishing, so it is settled now |
| D59 | Versioning and releases run on **Changesets**, with the published packages in a **fixed (lockstep) group**; every PR carries one `.changeset/*.md`; a release is `changeset version` → build → `changeset publish` (decided 2026-08-21, Phase 8 brainstorm; owner-approved) | independent per-package versions; hand-maintained lockstep | The packages are one functional unit — the CLI is meaningless without core — so the worst failure a user can hit is a mismatched combination, and lockstep removes it by construction. Changeset files written at PR time keep the CHANGELOG honest, and the tool handles `workspace:` rewriting, dependency-ordered publishing, and skipping versions already on the registry |
| D60 | The first published version is **0.1.0** across the group; no separate pre-1.0 stability policy document is written (decided 2026-08-21, Phase 8 brainstorm; owner-approved) | `0.1.0` plus a written stability policy; `1.0.0` | The snapshot format has moved three times (D16, D51, D57), each time justified by "pre-publication, no shim" — an argument that expires at publication, and `0.x` keeps that room in semver terms. The roadmap's deferred items (apply, drift check) also do not match a `1.0.0` completeness claim. A policy document was judged low value against its upkeep |
| D61 | Phase 8 ships the **maximum set** before publishing: packaging and hygiene, the code blockers, the pack-install smoke test, the docs, and the items carried out of Phase 7 — the breaking-change surface is exhausted pre-publication. Deferred to 0.2.0: #130 (new commands, four design questions still open), #131 (internal tooling; the release path already rebuilds from a clean install), #132 (needs a per-path lint design first), and #139 (the OIDC switch, which cannot be configured until the packages exist) (decided 2026-08-21, Phase 8 brainstorm; owner-approved) | a minimum set (packaging plus the four crash/correctness blockers); the minimum set plus the cheap additions | Anything that would later require breaking a user's committed snapshot is free now and expensive afterwards. The owner accepted a Phase 7-sized phase to buy that |
| D62 | **`@hejbro/skills` gets no npm channel**: the repository stays the only distribution (`npx skills add quickstart-now/hejbro`) and the package is `private: true`. D54 is unchanged; the roadmap's "npm half" wording is corrected instead (decided 2026-08-21, Phase 8 brainstorm; owner-approved) | bundle the files into the tarball with a `prepack` copy (verified to work); add a `hejbro skills install` subcommand (a D54 amendment) | A skill is not executed code — it is a file an agent reads from an agreed location. Publishing it puts those files under `node_modules/`, where no agent looks, so the package would hand the user nothing. The subcommand is the better UX but is exactly the alternative D54 rejected |
| D63 | **Publishing is automated from GitHub Actions**: `changesets/action` opens a "Version Packages" PR and merging it releases; provenance is on. Two workflows, split by branch — `release-version.yml` on `dev` (version only) and `release-publish.yml` on `main` (publish only). **This relaxes the AGENTS.md hard gate**: the human gate moves from running the publish command to approving and merging that PR, and AGENTS.md is updated in the same phase (decided 2026-08-21, Phase 8 brainstorm; owner-approved) | a `workflow_dispatch` manual trigger; publishing by hand from a local machine | Local publishing cannot produce provenance and cannot guarantee a fresh `dist`. `npm publish` is ruled out entirely because it does not rewrite `workspace:*` — a tarball published that way fails to install — so the pnpm/changesets path is forced. Provenance is enabled through the `NPM_CONFIG_PROVENANCE` environment variable, because changesets never passes a `--provenance` flag. The first release must use an automation token: a trusted publisher cannot be configured for a package that does not yet exist, so OIDC follows the first publish (#139). Splitting the workflows by branch keeps the version commit flowing `dev` → `main` and removes any need for a back-merge |
| D64 | The **GitHub Pages docs site is out of Phase 8** and becomes a follow-up: 0.1.0 ships with the README and the `docs/guide/` markdown, and `homepage` points at the repository (decided 2026-08-21, Phase 8 brainstorm; owner-approved) | build the site as part of Phase 8 | The guides already read on GitHub, so the site does not block publishing. Choosing a generator, designing navigation and adding a deploy workflow is a different kind of work from the release critical path |
| D65 | **0.1.0 is not a deadline — the format goes where it belongs first.** Anything that would later require breaking the snapshot format, or changing how an unchanged user declaration renders into a snapshot, is done before publishing. The judgement question is "is there an active reason not to do this now?", and the axis that matters is "known defect or new feature?", not "does this change rendered output?" (decided 2026-08-21, Phase 8 brainstorm; owner-approved) | publish on the earliest date that works and migrate users afterwards; keep deferring anything that is safe to defer | This is not a new principle: D16 already recorded that **pre-publication is the only cheap moment**, and D51 and D57 each invoked it to move the snapshot format without a shim. D65 states it explicitly and widens it from format bumps to anything that changes rendered snapshot output. It was adopted after three "safe to defer" judgements were shown wrong in the same brainstorm — `serial` was emitting invalid SQL, #24 concealed a silently dropped primary key, and both of #110's cheap options turned out to be breaking after publication. `verify`'s tip-hash check re-normalises the on-disk snapshot, and `parseSnapshot` demands an exact `formatVersion` with no migration path, so a post-publication change of either kind strands users |
| D66 | **#23 is implemented now as a `sequence` object kind**: `serial` stays in the DSL and is modelled properly — a new kind, its emit path, a rename drift guard in the same family as the existing index/FK guards, and type-change semantics that close the invalid `alter column … type serial` path (decided 2026-08-21, Phase 8 brainstorm; owner-approved) | remove the `serial` family in 0.1.0 and restore it additively in 0.2.0; keep it and document the gap | A public API that emits invalid SQL must not be published. Four of the seven scenarios were broken: `integer()` → `serial()` renders `alter column … type serial`, which Postgres rejects outright because `serial` is a `CREATE TABLE`/`ADD COLUMN` pseudo-type; `serial()` → `integer()` silently omits the `drop default` and the sequence drop; and column and table renames leave the derived sequence name behind, a drift the index/FK guards already handle. **For the record**: D48 counted serial decomposition among the things that appear identically on both sides of the two-path dump comparison. That was true, but it meant *undetectable*, not *safe* — the round-trip compares a chain-built database against a freshly built one, so a symmetric omission passes on both sides |
| D67 | **#110 is fixed now, with option (b)**: expressions are stored as structured nodes in the snapshot so a rename retargets the identifiers inside them exactly. D33 is amended to carry the matching exception (decided 2026-08-21, Phase 8 brainstorm; owner-approved) | defer it with an up-front commitment to option (a), token substitution inside the rendered string; option (c), bare column references | Option (a) rewrites rendered SQL text and is fragile wherever the same identifier appears inside a string literal; option (c) changes the stored value and the emitted SQL, so it is breaking after publication just as (b) would be. (b) is the structurally correct fix, and D65 puts it in this phase |
| D68 | **The snapshot `formatVersion` moves to 5**, carrying #110(b) and **#24(iii)** — primary-key and unique constraint names are recorded in the snapshot. #23's new kind needs no bump of its own but lands in the same wave (decided 2026-08-21, Phase 8 brainstorm; owner-approved) | open v5 for #24(iii) only, with #110 on option (a); do not open v5 at all, taking (a) and (ii) | Both are debts that cannot be repaid after publication without breaking users' snapshots, and D65 makes now the only free moment. Option (ii) — recomputing constraint names from a derivation rule — would freeze that rule permanently: changing it later would disagree with the constraint names already in users' databases. Adding a kind does not by itself require a bump (Phase 6 added `supabase-storage-bucket` without one), so v5 is opened for the two changes that genuinely alter rendered output |
| D69 | **The Supabase preset is verified against a real `supabase/postgres` image before publishing**, as a second local-Docker script alongside the plain-Postgres round-trip — not in CI (D49 stands). The image is pinned by tag, and the script resolves the image's digest on every run and fails if it no longer matches the recorded value, so a re-tag cannot silently change what was verified (decided 2026-08-21, Phase 8 plan review; owner-approved) | defer it to 0.2.0; include it but narrow the bar to "the generated chain applies without error" | `examples/supabase`'s round-trip runs on plain Postgres against **stubs we wrote ourselves** (a role and a `storage.buckets` table), so it verifies our assumptions against our assumptions — the same structural blind spot that let `serial` pass: a chain-vs-fresh comparison cannot see an error both sides make. `@hejbro/supabase` ships in 0.1.0 and the provider-preset claim is the product thesis, so a mismatch with the real `auth`/`storage` schemas, extensions or role grants has to surface before publication, not after |
| D70 | **Expression nodes serialize by D57's rules**, stated as a rule rather than a list so it cannot go stale as nodes are added: **every discriminator anywhere in the serialized expression subtree** is kebab-case (`nodeKind`, `projectionKind`, `returningKind`, and any later sibling — e.g. `column-ref`, `function-call`, `all-columns`, `constant-one`), and **every field that names another object** takes D57's vocabulary (`columnName` → `column`, `functionName` → `function`, `tableName` → `table`, `schemaName` → `schema`). The TypeScript unions keep their camelCase discriminators and field names (decided 2026-08-21, Phase 8 plan review; owner-approved) | amend D57's exemption so camelCase discriminators are allowed in artifacts | D57 already separates the two: *only the serialized key changes, never TypeScript declaration fields/parameters/locals* — so this applies the existing principle rather than adding an exception. D57 exempted AST discriminators **because** they never reach an artifact; D67 removes that premise, so the exemption lapses with it. The alternative would re-open the vocabulary unified one phase earlier and require a carve-out in `naming-conventions.test.ts` — a test that scans generated output rather than source, which is the point of it. Cost is one serialization mapping in the expression codec |
| D72 | **A view's own query is stored as a structured `SelectNode`** (`ViewSnapshot.query`), reusing #110/D67's expression codec (`encodeSelectNode`/`decodeSelectNode`/`retargetSelectNode`, all exported unchanged from `expr/codec.ts`/`expr/retarget.ts`) instead of pre-rendered SQL text (`ViewSnapshot.selectSql`, D27's original shape) — so a table/column rename retargets the identifiers inside a view's query exactly, the same way D67 already does for the other four expression fields. **Not a defect fix**: `create or replace view` already resolves a renamed dependency correctly today (Postgres re-resolves the view body against current names at replace time, not the stored text), and a column change to a view's own query is already a single `drop`+`create` pair (D27's prefix rule), never a rename-heuristic-misreadable pair. Done now anyway because pre-1.0 is the only free moment to change a snapshot's shape (D65) — after publication this would cost a real format-version bump plus a migration path hejbro doesn't have, and it changes how an *unchanged* view declaration renders in the snapshot (D65's own trigger condition), even though it changes no emitted SQL. **`formatVersion` stays `5`**: v5 was opened by #152/D68 for exactly this kind of change (a rename-render-affecting shift, landed in the same pre-publication wave); v5 carries the view field as well, D68's single pre-publication bump is unchanged (decided 2026-08-22, Phase 8 #157 brainstorm; owner-approved) | leave `selectSql` as pre-rendered text (status quo, defensible since nothing is broken); bump `formatVersion` to `6` for this change specifically | D67's own precedent — expressions are stored structurally so renames retarget exactly — applies identically to a view's query, which is itself just a `SelectNode` (already fully covered by the codec, since `ExistsNode.query` has the same type); bumping the format version here would break the wave's "one pre-publication bump carries every rename-render-affecting change" principle D68 established, forcing every later PR in the same wave (`sequence-kind`, `constraint-names`) to bump its own version too |
| D73 | **`formatVersion` tracks the snapshot's *field shape*, not its *vocabulary***: adding a new object kind — including a **core** kind such as `sequence` (#23) — never bumps the version, before or after publication; only a change to how existing fields are spelled or structured does (D68's v5 wave: expression nodes, view queries, sequence-bearing columns). An older hejbro meeting a kind it does not know therefore fails **on the kind, not on the version**, and the `unknown-kind` diagnostic carries the remedy: it must distinguish *"this snapshot was written by a newer hejbro — upgrade"* from *"a preset providing this kind is not registered"*, and should eventually fail at parse time rather than in the diff engine (a later change; #196 records why it is not done there yet). Extends D68's wave principle past publication rather than replacing it (decided 2026-08-22, Phase 8 #23 review; owner-approved) | bump once per new core kind, making the version a running counter of core kinds; keep the status quo and let `formatVersion` guard forward compatibility unaided (**measured not to: the version passed and the engine threw**) | Measured in both directions rather than argued. A `serial()` snapshot written by #23's code and read by its parent commit **parses cleanly** — both sides say `formatVersion: 5` — and then throws `unknown-kind` from the diff engine advising the user to *"register the preset that provides it"*; **no such preset exists**, so the version number protected nothing and the diagnostic named a remedy that cannot be performed. The reverse direction is clean, so the exposure is forward-only. D68's Phase 6 precedent (`supabase-storage-bucket` landed without a bump) transfers **only to preset kinds**: a bucket enters a snapshot because the user opted into a preset, so its absence is recoverable from configuration and the version has no work to do; a core kind enters because the user typed `serial()` once, and its absence is recoverable only by upgrading — which is a message, not a number. Making the version a kind counter would move it on nearly every release and cost the signal it exists to send: *"your reader cannot read this"* degrades to *"these differ"*. #193 is harmless under either alternative because v5 has never been published (all three packages sit at `0.0.0`; #179 is the first release) — but that fact expires at 0.1.0, which is why it is not the reason of record |
| D74 | **`ObjectKind.emit` receives the diff's sibling changes**, read-only and optional (`siblingChanges?: ReadonlyArray<KindChange>`, the second parameter) — the whole diff's change list, `change` itself included — so a kind whose SQL depends on another kind's change in the same diff can render it in one statement instead of two. The motivating case is a serial column added to an *existing* table (#23): `add column … not null` and a separate `set default nextval(…)` cannot work as two statements, because Postgres backfills a `not null` column only from a default present **in the same `add column` statement** — a table with existing rows fails outright on the first statement alone (decided 2026-08-22, Phase 8 #23 review; owner-approved) | (b) stitch the default into the emitted SQL text in `generate.ts` after the fact; (c) keep the default in `ColumnSnapshot.default` so `table-kind` can inline it without any cross-kind help; (e) refuse the case with an `unsupported-*` guard and defer the real fix to 0.2.0 | Restores no symmetry it does not have: `ObjectKind` **is** the extension interface (`packages/supabase` implements it), so this widens that interface — additively and optionally. The argument is read-only; 9 of the 11 in-repo `emit` implementations (8 in `packages/core`, 1 in `packages/supabase`) ignore it and compile unchanged, and only `sequenceKind`/`tableKind` (both core) read it. The nearest precedent is core's own built-in `notNullWithoutDefaultWarnings` (#115, `4bdfb50`, Phase 7), which already reads the full `KindChange[]` at diff level — but that is a **built-in** check, explicitly *not* a preset `Validator` (D37, whose signature takes only `(snapshot, declarations)`), so it shows the engine already grants this view internally, not that the extension interface already did. What carries the decision is the functional case: `dev` has no serial support at all, so #23 is where it either works or does not, and adding an id column to a table that already has rows is the most common serial usage there is. (b) is string surgery on already-generated SQL text that no type checks. (c) was measured and costs more than it saves: the sequence's name would then live in two places (the sequence node's own `name` field and a `nextval('…')` literal inside the column's `default`), so a rename must move both together or the default silently points at a sequence that no longer exists — and retargeting that literal needs either a new expression node (invalidating this PR's own "no new node kind" result and half-reverting its snapshot design) or a pattern-matching special case that two files must independently agree on. (e) leaves the first published release able to add a serial column only to an *empty* table, because hejbro cannot know a table's row count at generate time and so would have to refuse the working case along with the broken one |

## 4. Architecture

```
hejbro/  (quickstart-now/hejbro)
├── packages/
│   ├── core        # @hejbro/core — DSL + compiler + diff engine (PURE: no fs, no DB)
│   ├── cli         # hejbro — user-facing package: re-exports core DSL + CLI (init/generate)
│   ├── supabase    # @hejbro/supabase — first provider preset
│   └── skills      # @hejbro/skills — agent skills for hejbro users
├── examples/       # showcase declarations doubling as integration tests (postgres, supabase; local Docker round-trip)
└── docs/           # this spec, roadmap, ADRs as they accrue
```

**Core purity is the load-bearing boundary.** `@hejbro/core` takes declaration
objects and returns SQL strings and diff structures. It never reads files,
never opens a connection. This makes golden-file testing trivial and future
launchers (e.g. a Vite plugin) cheap.

### 4.1 Provider preset interface (the Neon/Nile door)

Presets are built ONLY on a public extension interface of core. If a preset
needs a special case inside core, the interface is wrong — fix the interface.
A preset can contribute exactly five things (grown from four by D37/D38,
Phase 6 — the interface's first real test):

1. **Custom object kinds** — e.g. Supabase storage bucket → compiles to
   `storage.buckets` inserts + policies. A Nile preset would add tenant-aware
   table helpers here.
2. **Role/grant presets** — Supabase: `anon` / `authenticated` /
   `service_role`; Neon and Nile bring their own role models. Constants are
   typed with core's branded `Role` type (D43).
3. **Typed expression helpers** — e.g. `auth.uid()` as a typed builder.
4. **Reserved-area protection** — schemas like `auth`, `storage`,
   `realtime`: a validator (contribution 5) that **hard-errors** when a
   managed declaration targets them (D38; supersedes the earlier
   "excluded from diffing, warn when touched" wording).
5. **Validators** — pure functions
   `(snapshot, declarations) => ReadonlyArray<Diagnostic>` passed to
   `generateMigration({ validators })` (D37). Warning-severity diagnostics
   land in the result's `warnings`; error-severity diagnostics join
   `errors` and block generation. Core executes validators without knowing
   what they check — cross-kind checks (e.g. "exposed table without RLS")
   live here, never as core special cases.

Presets may additionally *package* core DSL values — prebuilt
`existingTable()` references (Supabase: `authUsers`, D41) and role
constants — but that is re-exporting core primitives, not a separate
extension mechanism. A preset also *bundles* its contributions as a pure
`Preset` data object (`{ name, kinds, validators }`, D55) so
`hejbro.config.ts` can list it under `presets` and the CLI registers kinds
and runs validators without preset-specific code.

Consequently the diff engine is **pluggable over "object kinds"**: each kind
implements the four stages (declare → snapshot-serialize → diff → emit SQL).
Built-in kinds (table, function, trigger, …) use the same interface presets do.

## 5. DSL surface

Schema objects feel like Drizzle (familiarity is a feature); the
function/trigger builder is the novelty.

### 5.1 Tables, RLS, indexes

```ts
import { schema, table, uuid, text, timestamptz, rls, index, isNotNull } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	slug: text().notNull().unique(),
	publishedAt: timestamptz(),
}, (t) => ({
	rls: rls.enabled({
		select: rls.policy("anyone can read published")
			.for("select").to("anon", "authenticated")
			.using(isNotNull(t.publishedAt)),
	}),
	indexes: [index().on(t.publishedAt)],
}));
```

A column's `notNull` in the snapshot is not always exactly what was chained: `.primaryKey()` implies it, and so does a `serial`/`smallserial`/`bigserial` type (D66) — the pseudo-type sugar itself carries the constraint in Postgres, independent of primary-key status, so a bare `serial()` column materializes as not-null even without `.notNull()` chained.

### 5.2 Functions (RPCs) — builder DSL

```ts
export const publishPost = defineFunction("app", "publish_post", {
	args: { postId: uuid() },
	returns: posts,              // table reference → emits `returns setof app.posts`
	security: "definer",
	grants: ["authenticated"],
}, (ctx, { postId }) => {
	const post = ctx.row(select(posts).where(eq(posts.id, postId)));
	ctx.if(isNotNull(post.publishedAt), () => {
		ctx.raise("already published: %", postId);
	});
	ctx.return(
		update(posts).set({ publishedAt: now() }).where(eq(posts.id, postId)).returning()
	);
});
```

Key properties:

- The body function is **executed once at build time**; every `ctx.*` /
  builder call records a node into an AST. Values like `post.publishedAt` are
  recording proxies (column references), not real values.
- **Real JS control flow is forbidden inside bodies** — a real `if` would
  bake in one branch at build time. Control flow uses DSL constructs:
  `ctx.if()`, `ctx.forEach()`, `ctx.while()` (added incrementally; v1 may
  start with a subset — see roadmap).
- `returns: posts` (a table object) is the hook for future client-type
  generation (e.g. supabase-js `Database` types). Not in v1; keep the door
  open.

### 5.3 Triggers — define + attach in one declaration

```ts
export const commentsSingleDepth = defineTrigger(comments, {
	name: "comments_single_depth",
	timing: "before",
	events: ["insert", { update: ["parentId", "postId"] }],
	forEach: "row",
}, (ctx, { new: row }) => { /* same builder DSL; OLD/NEW rows are typed from the table */ });
```

### 5.4 Views and grants

```ts
export const publishedPosts = defineView(app, "published_posts",
	select(posts).where(isNotNull(posts.publishedAt)));

export const appGrants = grant(app).usage.to("authenticated", "anon");
```

## 6. Compile pipeline (`hejbro generate`)

```
load declarations → execute builders (collect trees) → validate
  → serialize snapshot → diff against previous snapshot → emit migration SQL
```

1. **Load** — `hejbro.config.ts` points at entry file(s); declarations are
   exported objects, so loading is registration.
2. **Execute builders** — function/trigger bodies run and record their trees.
   **Determinism guard: every body is executed twice; if the two trees
   differ, non-deterministic code (real JS branching, `Date.now()`, etc.)
   leaked in — hard error.** An ESLint plugin catching real `if`/`for` inside
   bodies is planned for v1.x as a second layer.
3. **Validate** — referential integrity (column references that don't exist,
   triggers on dropped tables), name collisions, and preset-provided checks
   (e.g. Supabase: exposed table without RLS → warning). Everything a
   compiler can catch before human review, catch here.
4. **Serialize snapshot** — one normalized JSON of the full declared state.
   Function snapshots store the rendered **`bodySql` alongside a
   `bodyHash`** (plus the structured signature); `bodyHash` is the
   change-detection key, and `bodySql` lets `emit` reproduce the full
   `create or replace function` statement from the snapshot alone, since
   `ObjectKind.emit` only ever sees snapshot nodes, never the original
   declaration (Phase 3 decision D24 amends this paragraph — see §3).
5. **Diff** — per-kind strategies:

   | Kind | Change strategy |
   |------|-----------------|
   | Tables/columns | `alter table`; renames need interactive confirmation (same problem and solution as drizzle-kit) |
   | Functions | `create or replace`; signature changes (args/return) emit `drop` + `create` — the compiler knows in advance when Postgres would reject a replace |
   | Triggers | `drop trigger if exists` + `create` (idempotent recreate) |
   | Views | `create or replace view`; column removals emit `drop` + `create` |
   | RLS policies | `drop policy` + `create policy` (alter policy can't take expression changes in many cases; recreate is simpler) |
   | Grants | diff against previous snapshot → only the `grant`/`revoke` delta |

6. **Emit** — one migration file per generate run, named
   `YYYYMMDDHHMMSS_<slug>.sql` by default (Supabase-compatible ordering; see
   D14 — prefix strategy configurable in `hejbro.config.ts`, slug from
   `--name` or auto-derived from the first change). The clock is injected by
   the CLI so core stays pure. The file carries a **structured change
   summary as a banner comment**:

   ```sql
   -- hejbro migration
   -- + function app.publish_post(post_id uuid) [new]
   -- ~ trigger comments_single_depth on app.comments [body changed]
   -- - view app.stale_view [dropped]
   ```

   The banner is the product's soul: it is the first thing a human reads in a
   PR review. Its quality decides whether "review the generated SQL" is real
   or theater. From Phase 5 on, the banner additionally carries two hash
   lines (`-- parent-snapshot: sha256:<hex>` / `-- snapshot: sha256:<hex>`,
   D33) forming the chain `hejbro verify` walks to detect divergent
   branches.

The snapshot file is committed alongside migrations, enabling a CI check that
declarations ↔ snapshot ↔ migrations agree.

## 7. Error handling principles

- Every compile error carries the **declaration site** (file + export name).
- Every error message states **why it failed AND what to do**, as a pair.
- The builder DSL's advantage (the API is the boundary) is completed by error
  message quality — this is a stated quality bar, not a nice-to-have.

## 8. Testing strategy (three layers)

1. **Golden files** — declaration → emitted SQL snapshot comparison. Core is
   pure, so this layer is the thickest and cheapest.
2. **Real Postgres round-trip** — a local Docker script (D49) applies each
   example's migration chain to one database and a fresh single migration
   to another, then compares the two `pg_dump` outputs (D48). Catches
   "compiled fine but Postgres rejects it" and "the diff path and the
   create path disagree".
3. **Example-based** — `examples/postgres` and `examples/supabase` run as
   whole-project integration tests (D53).

## 9. Out of scope for v1 (explicit)

- Applying migrations to a database (D12)
- Live-DB drift check (`hejbro check`) — v2 candidate
- Hybrid authoring (real TS arrow functions for single-expression SQL
  functions) — possible later extension on top of the builder (D4)
- Client type generation from `returns` metadata — door kept open (§5.2)
- Neon / Nile presets — designed for (§4.1) but not built in v1
- Watch mode — permanently out of scope: regenerating on every keystroke
  contradicts migration-per-change-set; `generate` is a deliberate, explicit
  action (Phase 5 brainstorm, owner decision 2026-08-20)

## 10. Conventions for this repository

- **All GitHub-facing text in English** (README, docs, issues, PRs, commits).
- pnpm + Turborepo; Biome (tabs, double quotes); commitlint (conventional
  commits, husky `commit-msg` hook) — all already scaffolded.
- TypeScript: strict; the owner's global `typescript-rules` skill applies
  (no `any`, no `let`/`var`, no `for`/`while` loops in our own source, no
  ternary, etc.).
- Publishing to npm requires explicit owner approval; the `@hejbro` scope is
  already owned by the project owner.

## 11. Positioning notes (for README/marketing, when the time comes)

- The pitch: *"The safe middle ground between letting AI touch your database
  and writing raw SQL — everything is code, every change is a reviewable,
  generated migration."*
- Precedent honesty: schema diffing is well-trodden (drizzle-kit, Atlas);
  the TS→plpgsql builder compiler is the novel part. Lead with it.
- This project is itself built AI-natively (D11); the design docs and plans
  in this repo are part of the public story.
