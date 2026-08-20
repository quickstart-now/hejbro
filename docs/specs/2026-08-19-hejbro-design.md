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
| D21 | Row reads (`ctx.row`/`ctx.rowOrNull`) declare **one scalar local per projected column**, never a `record` variable — name `${rowName}_${snake(projectionKey)}`, `rowName` explicit or a deterministic counter (`row_1`, `row_2`, …); strictness lives in the method name (`ctx.row` → `select … into strict`, `ctx.rowOrNull` → `select … into`) (decided 2026-08-19, Phase 3 brainstorm; owner-approved) | a single `record` variable with field access (`parent.post_id`) | A `record` variable's fields are only valid after a successful `select into`; reading an unassigned field is a runtime trap plpgsql doesn't catch statically. Scalar locals make "was this row found" explicit per-field and match the hand-written dd.land trigger's own style |
| D22 | The determinism guard runs the body callback **twice** with fresh recording contexts and compares the two trees **structurally** via `stableJson`; `declaredAt` is filled **best-effort** by parsing `new Error().stack` at the `defineFunction`/`defineTrigger` call site (pure string parsing, no filesystem access — degrades to `null` on any runtime/format it can't read), and every declaration- and recording-time error carries the object's `identity` in its message body regardless of whether `declaredAt` resolved (decided 2026-08-19, Phase 3 brainstorm; owner-approved) | compare rendered SQL strings instead of the recorded trees; skip declaration-site capture entirely | Structural comparison catches non-determinism before rendering (cheaper, and pinpoints the AST shape that diverged, not just SQL text); best-effort stack capture gives most users a jump-to-source without making it a hard requirement — stack trace formats vary across JS runtimes |
| D23 | Functions `create or replace` only when the **structured signature is identical** (arg names + types in order, `returns`, `security`, `language`) and only the body differs; any signature difference emits a `drop` + `create` **pair of SQL statements**, rendered by a single `alter` `KindChange` (decided 2026-08-19, Phase 3 brainstorm; owner-approved; wording amended 2026-08-19 after #55 — see below) | attempt `create or replace` unconditionally and let Postgres reject an incompatible one | Postgres itself rejects `create or replace function` across an argument or return-type change; deciding this in the compiler (not at apply time) keeps generated migrations valid without a live database, matching hejbro's snapshot-diff posture (D6). A same-identity recreate (trigger, function-signature, or Phase 2 enum-value-removal) must be **one `KindChange`** whose `emit` orders its own drop before its own create — representing it as two separate `KindChange`s let the diff engine's global create/alter-before-drop ordering split the pair and hoist the create ahead of the drop (bug #55, fixed same-day by the Phase 3 acceptance golden review) |
| D24 | Function snapshot nodes additionally store the rendered **`bodySql`** alongside `bodyHash` — `bodyHash` remains the change-detection key (§6.4), `bodySql` is what `emit` renders verbatim on create/`alter` (decided 2026-08-19, Phase 3 brainstorm; escalated to and approved by the owner mid-phase) | keep only `bodyHash` in the snapshot and re-render from the original declaration at emit time | `ObjectKind.emit` is contractually snapshot-only (Phase 1 design, `kind/object-kind.ts`) — it never sees the original declaration, so it cannot re-render the body from scratch; drizzle-kit stores full SQL text in its snapshots for the same reason (precedent) |
| D25 | RLS is modeled as **two new object kinds** — `rls` (per-table enable/force, identity `<schema>.<table>`) and `policy` (identity `<schema>.<table>.<name>`) — expanded from `TableExtras.rls` in `resolveDeclarations`; the table kind's snapshot shape is untouched and the snapshot version stays 2 (decided 2026-08-19, Phase 4 brainstorm; owner-approved) | store RLS inside the table kind's snapshot | Embedding RLS in the table snapshot changes every existing table's serialized shape — a spurious diff for unchanged tables and a forced version bump; separate kinds are purely additive (Phase 3 precedent: the function/trigger kinds landed without a bump). A policy change recreates via a **single** `alter` `KindChange` whose emit orders drop before create (D23, bug #55) |
| D26 | Policy DSL: `rls.policy(name)` is a **type-state chain** — `for()` with select/delete exposes only `.using()`, insert only `.withCheck()`, update/all expose both with at least one required; `.to()` is **mandatory** (no implicit PUBLIC — an explicit `to("public")` renders the keyword); `rls.enabled`'s object keys are TS-side labels only (the SQL policy name is `rls.policy(name)`'s argument); `rls.enabled(policies, { force: true })` covers `force row level security` (decided 2026-08-19, Phase 4 brainstorm; owner-approved) | validate clause combinations at generate time; make the record key the SQL policy name | Postgres rejects `with check` on select/delete policies and `using` on insert policies — making illegal combinations unrepresentable moves the error into the editor (D18's by-construction posture applied to RLS); mandatory `to()` closes the implicit-full-exposure trap; label keys allow two policies for the same command on one table |
| D27 | `defineView(owner, name, query, options)` with a neutral `securityInvoker` option: the view kind's snapshot stores the **rendered select SQL plus the projected column-name list** (derived from the existing `SelectNode.projection`); diff uses the **prefix rule** — previous columns a prefix of next emits `create or replace view`, anything else recreates via a single `alter` change (decided 2026-08-19, Phase 4 brainstorm; owner-approved). The "view over an RLS-enabled table without security_invoker" warning is Supabase-preset work (#66, Phase 6) | re-render view SQL from the declaration at emit time; diff on rendered SQL alone; put the RLS-bypass warning in core | `ObjectKind.emit` is snapshot-only (D24 precedent); Postgres only allows `create or replace view` to append columns at the end — the prefix rule mirrors the engine's exact contract; definer-rights views silently bypassing RLS is a real Supabase pitfall, but core stays provider-neutral (§4.1) |
| D28 | Grants: identity is **(schema, grantKind, role)** with three grantKinds — `schemaUsage`, `allTablesPrivileges`, `defaultTablePrivileges` (the dd.land subset of `alter default privileges`: `in schema … grant … on tables to <role>` only; owner/for-role variants out of scope) — `to(...roles)` fans out into one declaration per role via a `grant-set` expansion; diff is a **privilege-set delta**: additions emit `grant`, removals emit `revoke`, declaration removal revokes the set; role names are plain strings for now (Phase 6 may widen to a branded role type non-breakingly) (decided 2026-08-19, Phase 4 brainstorm; owner-approved, including the default-privileges scope call) | one declaration per multi-role statement; diff whole grant statements textually | Per-role identity makes the snapshot-delta (`grant`/`revoke` only, §6.5) fall out of the ordinary per-identity kind diff, keeps banner lines per-role, and routes duplicate declarations through the existing `duplicate-identity` check |
| D29 | Declaration/config loader = **jiti only** (a self-contained Babel-based source transform run on import; tsx rejected). `hejbro.config.ts` loads through the same jiti path as declaration entries — the loader is fixed by the CLI, not configurable (decided 2026-08-20, Phase 5 brainstorm; owner-approved) | tsx; ts-node; Node's native type stripping; a user-configurable loader | jiti's transform-on-import path keeps a single, deterministic loading path across config and entries; a configurable loader would reintroduce mixed toolchains and a support burden. Node native type stripping was the most seriously considered alternative and was rejected: it hard-errors on enums and namespaces, fails on extension-less relative imports (a common TS authoring style), ignores `tsconfig` `paths`, and is only enabled by default from Node 22.18+ — short of D13's "Node ≥ 22" floor. D13's Node ≥ 22 floor is unchanged |
| D30 | `hejbro.config.ts` is authored via a **`defineConfig()`** helper and validated with **zod** at CLI load time (zod is a CLI-only dependency, never added to `@hejbro/core`); zod's own error text never reaches the user — every validation issue is re-wrapped into the spec §7 diagnostic grammar. Config fields: `entry`, `migrationsDir`, `snapshotPath`, `prefixStrategy` (D14); no preset fields reserved yet (decided 2026-08-20, Phase 5 brainstorm; owner-approved) | hand-rolled validation; no validation (trust TS types) | TS types don't survive a loosely-typed dynamic import (jiti returns `unknown`); zod gives one validation surface without leaking library-specific error text, honoring §7's error-quality bar |
| D31 | CLI framework = **citty** (decided 2026-08-20, Phase 5 brainstorm; owner-approved) | commander; yargs; a hand-rolled arg parser | citty's typed, declarative command definitions fit a small, single-purpose CLI (`init`/`generate`/`verify`) without extra ceremony |
| D32 | Column/table renames are resolved **non-interactively via CLI flags** — no TTY prompts, no prompt library, in v1. `--rename <schema>.<table>.<old>=<new>` for a column, `--rename <schema>.<old>=<new>` for a table (2 segments); `--confirm-drop <schema>.<table>.<column>` or the table-level `--confirm-drop <schema>.<table>` (2 segments), both flags repeatable. **Rule A**: any same-table drop+add pair, regardless of whether the types match, is treated as an ambiguous rename candidate; cross-table moves are never rename candidates; the no-flag path is the documented **expand–contract** pattern (add in one `generate` run, migrate data, drop in a second run). Every rename/confirm-drop error prints the exact rerun command (decided 2026-08-20, Phase 5 brainstorm; owner-approved) | an interactive TTY prompt (inquirer-style); a heuristic auto-rename (type+position matching) | CI/agent-drivability (the CLI must run non-interactively, matching the spec's AI-native posture, §2/D11) rules out TTY prompts; a heuristic silently guesses and risks data loss on a drop+add pair that merely shares a type — flags make the rename decision explicit, auditable, and (via the rerun-command output) a one-line fix when wrong |
| D33 | The **single committed snapshot file** (`snapshotPath`) stays the source of truth (no per-migration snapshot files); every migration's banner additionally carries `parent-snapshot:`/`snapshot:` sha256 lines (of the normalized snapshot text), forming a hash chain across migration files that lets `hejbro verify` detect divergent branches (`error[diverged-migrations]`) without a live database. The snapshot's JSON shape must stay **compact**: no duplicating a key's own identity inside its serialized node, and no recording a field's Postgres default value explicitly (e.g. `notNull: false`) — audited and enforced in Phase 5 (see the implementation plan's Task 3). The snapshot is **derived state**: recovery is via git history, never regeneration from a live database (decided 2026-08-20, Phase 5 brainstorm; owner-approved) | per-migration snapshot files (drizzle-kit style); no hash chain (trust the migrations directory alone); allow snapshot regeneration from a live database | A single file keeps the "declarations ↔ snapshot ↔ migrations agree" CI check (§6) simple; the hash chain is a cheap, pure (no DB) way to catch two branches that both extended the same snapshot state and were merged out of order; compactness keeps the file reviewable and its churn limited to real changes |
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
| D44 | Phase 6 acceptance = a **reduced `examples/dd-land`** exercising every preset feature once (an `authUsers` FK, an `authUid()` RLS policy, a storage bucket, role-preset grants) plus **`examples/preset-smoke`**, a toy preset proving interface genericity with one custom kind and one expression helper; the full dd.land port stays Phase 7 (decided 2026-08-20, Phase 6 brainstorm; owner-approved) | porting all of dd.land in Phase 6; extending `examples/cli-smoke` instead of a new example | Acceptance needs each preset feature end-to-end once, not the whole corpus; this reconciles the roadmap's Phase 6 acceptance line with its Phase 7 "full dd.land port" item |
| D45 | `authUid()` renders the **plain `auth.uid()` call** (`Expr<"uuid">`) — no automatic `(select auth.uid())` initPlan wrapping; the cached variant is a Phase 7 follow-up issue, and the preset README carries the RLS performance guidance (decided 2026-08-20, Phase 6 plan review; owner-approved) | wrapping by default; shipping a second wrapped helper alongside now | Subqueries are illegal in column `default`/`check` expressions, where `auth.uid()` is also idiomatic — auto-wrapping would break those call sites; the plain call is correct everywhere and the optimization stays an explicit opt-in later |

## 4. Architecture

```
hejbro/  (quickstart-now/hejbro)
├── packages/
│   ├── core        # @hejbro/core — DSL + compiler + diff engine (PURE: no fs, no DB)
│   ├── cli         # hejbro — user-facing package: re-exports core DSL + CLI (init/generate)
│   ├── supabase    # @hejbro/supabase — first provider preset
│   └── skills      # @hejbro/skills — agent skills for hejbro users
├── examples/       # real declarations doubling as integration tests (first: dd.land port)
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
extension mechanism.

Consequently the diff engine is **pluggable over "object kinds"**: each kind
implements the four stages (declare → snapshot-serialize → diff → emit SQL).
Built-in kinds (table, function, trigger, …) use the same interface presets do.

## 5. DSL surface

Schema objects feel like Drizzle (familiarity is a feature); the
function/trigger builder is the novelty.

### 5.1 Tables, RLS, indexes

```ts
import { schema, table, uuid, text, timestamptz, rls, index, isNotNull } from "hejbro";

export const ddland = schema("ddland");

export const posts = table(ddland, "posts", {
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

### 5.2 Functions (RPCs) — builder DSL

```ts
export const publishPost = defineFunction("ddland", "publish_post", {
	args: { postId: uuid() },
	returns: posts,              // table reference → emits `returns setof ddland.posts`
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
export const publishedPosts = defineView(ddland, "published_posts",
	select(posts).where(isNotNull(posts.publishedAt)));

export const ddlandGrants = grant(ddland).usage.to("authenticated", "anon");
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
   -- + function ddland.publish_post(post_id uuid) [new]
   -- ~ trigger comments_single_depth on ddland.comments [body changed]
   -- - view ddland.stale_view [dropped]
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
2. **Real Postgres round-trip** — CI applies generated migrations to a Docker
   Postgres, extracts state (`pg_dump`), compares against declarations.
   Catches "compiled fine but Postgres rejects it".
3. **Example-based** — `examples/` real schemas (first: dd.land port) run as
   whole-project integration tests.

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
