# Phase 7 — Table-kind completeness, local round-trip examples, skills, README: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the table kind's expressiveness gaps (CHECK, partial and
ordered indexes, FK `on update`, self-FKs), prove the whole pipeline against
a real Postgres with two generic showcase examples and a local Docker
round-trip, wire presets into the CLI config, ship the `hejbro` agent skill,
and turn the README into the landing page.

**Architecture:** Core grows inside the existing table kind — new
declaration fields (`checks`, index column objects + `where`, FK
`onUpdate`), one snapshot version bump (2 → 3), and the matching
serialize/diff/emit plumbing — with no new expression machinery (the
expression AST and the `sql` template already cover every predicate).
Two examples (`examples/postgres`, `examples/supabase`) each carry a
four-step declared history plus the committed migrations it generates; a
single Docker-CLI script applies the chain to one database and a fresh
single migration to another and diffs the two `pg_dump`s (D48/D49). A pure
`Preset` data object lets `hejbro.config.ts` list presets so the CLI
registers kinds and runs validators without preset-specific code (D55).
The skill is plain markdown in the repo installed with
`npx skills add` (D54).

**Tech Stack:** TypeScript strict, vitest, Biome, pnpm + turbo, tsdown,
zod (CLI only), jiti (CLI only), Docker CLI + `postgres:17-alpine` (local
round-trip only — never a test dependency). Core: zero new runtime deps,
zero I/O (unchanged).

**Spec:** `docs/specs/2026-08-19-hejbro-design.md` — §4.1 (as amended),
§5.1, §7, §8, §11, decision-log rows D46–D56 (plus D16, D30 → D55,
D32–D34, D36, D37, D44 → D53). Roadmap: `docs/plans/2026-08-19-roadmap.md`
§Phase 7. Issues: #8 (phase); #104, #105, #106, #22, #107, #96, #108, #109
(with #83, #84, #85), #27, #102.

## Deliverables that need owner approval before they are final

| # | Artifact | Produced in | Gate |
|---|----------|-------------|------|
| O1 | Example domain for both showcases: a **team workspace** — `app` schema with `members`, `projects`, `tasks`, `comments` (self-FK on `comments.parent_id`), `attachments` (supabase only). Generic; no project or product name anywhere. | Task 14 / Task 24 | **Approved 2026-08-20** (owner; in use since Task 14) |
| O2 | New error-code wording (§7 grammar: why + `Next:`): `duplicate-index-name`, `duplicate-foreign-key-name`, `foreign-key-table-mismatch`, `foreign-key-mixed-reference-tables`, `check-foreign-column-ref`, `check-subquery`, `index-predicate-foreign-column-ref`, `index-predicate-subquery`, `check-name-missing`, `not-null-without-default` (#27) | Tasks 3–8, 10, 33 | **Approved 2026-08-20** (owner, 11 messages as drafted by the team — pinned in goldens; any later change needs re-approval) + `unsupported-snapshot-version` older/newer split (approved 2026-08-20) + `invalid-config` presets message (approved 2026-08-21) |
| O3 | CLI warning rendering golden (`warning[<code>]: …` on stderr after a successful generate, D55) | Task 22 | **Approved 2026-08-20** |
| O4 | README body (D56 order, no comparison table) | Task 30 | **Approved 2026-08-21** (owner, at PR F review) |
| O5 | `docs/guide/` titles + section outlines: `getting-started.md`, `renames.md`, `ci.md` | Task 31 | **Approved 2026-08-21** (owner, outlines) |
| O6 | `SKILL.md` frontmatter `description` (trigger sentence) and the four reference titles | Task 27 | **Approved 2026-08-21** (owner) |

## Owner decisions (2026-08-20 brainstorm — do not revisit)

| # | Decision |
|---|----------|
| D46 | Table-kind completeness (CHECK, partial indexes, index ordering, FK `on update`, self-FK #22) is Phase 7's leading work group; roadmap headline unchanged. |
| D47 | Stays in #8: #104, #105, #106, #22, #102, #96, #27, #83, #84, #85 (+ #88, which rode along in PR A2). Moved to #9: #23, #24, #25, #26, #87, #89, #97. Docs = markdown under `docs/`, no Pages site. |
| D48 | Round-trip = two-path dump comparison (chain-applied DB vs fresh single migration DB, container `pg_dump --schema-only --no-owner`, SET headers stripped, diff empty) + a row query for the storage bucket. Each example has a designed 4-step chain: baseline → add column + CHECK → change FK actions → move a column across tables (`--confirm-drop` path) — the step also adds a column to the source table so D32's same-table rule A engages. |
| D49 | The round-trip runs **locally via Docker** (`pnpm roundtrip`), not in CI. `postgres:17-alpine`; seed only for objects outside hejbro's scope (cluster-level roles; the preset's `storage.buckets` stub); Docker CLI only (psql/pg_dump inside the container); `ci.yml` unchanged; `pnpm test` stays DB-free; script output attached to the PR. |
| D50 | CHECK: `checks: [check(name, expr)]`; name required (`assertSqlName`); expression = any boolean `Expr` (helpers or `sql` template); snapshot `checks?: [{ name, expression }]` (rendered SQL, omitted when empty); change = drop + add; emit order FK drop → CHECK drop → index drop → column drop → column add/alter → index add → CHECK add → FK add (deferred); own-table refs only, no `exists`. |
| D51 | Index ordering via wrapper functions `asc(col)` / `desc(col, { nulls })`; partial = `.on(...).where(expr)`; **snapshot version 3** (`IndexSnapshot.columns` = `[{ name, desc?, nulls? }]` + `where?`), everything regenerates, no shim; FK `onUpdate?` + `set default`; `emitAlter` turns `indexDiff.changed` into drop + create; `duplicate-index-name` / `duplicate-foreign-key-name` hard errors. |
| D52 | Self-FK via the callback's refs: `references: { columns: [t.id] }`; `table` optional on every FK, identity derived from the refs' `exprNode`, cross-checked when `table` is given; all referenced columns share one table; snapshot/emit unchanged. |
| D53 | Showcases = `examples/postgres` (core only; still seeds the two roles its grants target, since hejbro manages grants and RLS but never `CREATE ROLE`) and `examples/supabase` (preset, seeded); generic content, no project name; the reduced Phase 6 example's content seeds `examples/supabase`; `cli-smoke`/`preset-smoke` are fixtures. |
| D54 | One `hejbro` skill installed via `npx skills add quickstart-now/hejbro`; `SKILL.md` + four references; samples are links into the examples + a path-existence vitest; source location and version field settled against the skills CLI source first. |
| D55 | Core `Preset = { name, kinds, validators }` data object; `supabasePreset`; config `presets: Preset[]`; `generate`/`verify` register kinds; `generate` renders warnings to stderr (§7 grammar), exit 0; golden texts owner-approved; `examples/supabase` gets a config + CLI e2e. |
| D56 | README landing order (pitch → 60-second example → how it works → packages/examples → agents → built AI-natively → status → license), **no comparison table**; `docs/guide/` three pages; repository-wide sweep replacing the earlier project-specific example naming with the generic examples. |
| D57 | Naming unification (decided 2026-08-21, mid-Phase-7): snapshot self/reference vocabulary (`schema`/`name`/`table`/`function`; `schemaName`→`name`, `functionName`→`function`) and kebab-case for artifact tokens (`GrantKind`'s three values). The snapshot's own version field, `hejbroSnapshot`→`formatVersion`, is itself a format change — **snapshot version 3 → 4**; `parseSnapshot` still recognizes the old key on a pre-v4 file so it gets the normal "older" message instead of misparsing. This rename postdates Tasks 1–29 below — their completed-step records below still show the pre-D57 key names (`hejbroSnapshot`) because that is what those tasks actually produced at the time; they are not rewritten. |

### Detail decisions (main, 2026-08-20)

- **Chain storage = A.** Each example keeps per-step declarations
  (`src/steps/step-1.schema.ts` … `step-4.schema.ts`, step 4 being the
  live entry) **and** the four committed migration files plus the
  snapshot. Tests assert "regenerating from the steps reproduces the
  committed files byte-for-byte" and that `hejbro verify`'s hash chain
  passes. The round-trip script applies the committed files.
- **Order: PR C (`Preset`/#96) before PR D (`examples/supabase`).**
  `examples/supabase` generates its chain through the CLI
  (`hejbro.config.ts` with `presets`) from the start and has a CLI e2e.
  `examples/postgres` needs only core and starts right after PR A2.
- **`cli-smoke` / `preset-smoke` stay where they are** and
  `examples/README.md` labels them as test fixtures (moving them would
  churn the turbo graph for no user-visible gain).
- **Round-trip script lives once at the repo root**
  (`scripts/roundtrip.sh`), parameterized by example directory and an
  optional seed file; each example's `pnpm roundtrip` calls it.

## Plan-time verifications (before any production code)

| # | Question | Resolved by | Outcome recorded in |
|---|----------|-------------|---------------------|
| V1 | Does PG17 accept 3-part qualified column refs (`"app"."posts"."status"`) inside `CHECK` (inline and `ALTER TABLE ADD CONSTRAINT`) and inside a partial-index `WHERE`? | Task 2 (Docker probe; the planner's environment had no Docker daemon, so the implementer runs it) | "Resolved at plan review" below; decides whether Task 5 needs a bare-column render mode |
| V2 | Does the skills CLI (`vercel-labs/skills`) discover `SKILL.md` recursively or only under repo-root `skills/`? Which version field do `check`/`update` read? | **Resolved** (researcher, `src/skills.ts`): discovery is not recursive — repo root depth 1, then the containers `skills/`, `.claude/skills/`, `.agents/skills/` to depth 3 (`DEFAULT_SKILL_CONTAINER_DEPTH = 3`), descent stops at the first `SKILL.md`; a depth-5 fallback runs only when nothing was found. `check`/`update` compare the skill folder's GitHub tree SHA (`skillFolderHash`), not the frontmatter version. | Task 27: source = repo-root `skills/hejbro/`; frontmatter `version` is display-only |
| V3 | Minimal `storage.buckets` stub DDL (columns the bucket upsert touches) with source comments from `supabase/storage-api` migrations | **Resolved** (researcher): `migrations/tenant/0002` (schema, roles, `buckets` with `id` PK + unique `name`), `0008` (`public`), `0013`/`0014` (`allowed_mime_types`, `file_size_limit bigint`) — full seed in Task 25 | Task 25 |
| V4 | #102 instrumentation design | Task 34 (design is in the task) | Task 34 |

### Resolved at plan review

- V1: **Accepted.** No Docker daemon was available in either the planner's
  or the implementer's environment, so the probe ran via PGlite (PostgreSQL
  18.3 WASM, `@electric-sql/pglite` 0.5.5 — see scratchpad
  `v1-probe/probe.mjs`) instead of the Task 2 Docker script. 6/6 statements
  succeeded: an `alter table … add constraint … check (…)` with a 3-part
  ref, a mixed 3-part CHECK expression, a partial index `where` with a
  3-part ref, a unique+ordered partial index (`desc nulls first` + `where`)
  with 3-part refs, an inline `create table … constraint … check (…)`, and
  a 2-part control — all accepted; `pg_get_constraintdef`/`pg_indexes`
  deparse them with bare column names, so the two-path dump comparison
  (D48) is unaffected. 3-part column-reference resolution is parser-level
  behavior shared across Postgres versions, and the `postgres:17` Docker
  round-trip in PR B re-confirms it on the target major. Tasks 5 and 10
  render predicates with the existing `renderExpr` (3-part refs); **Step
  3b (bare-column render mode) is not needed.**

## Global Constraints

- Core purity: `@hejbro/core` never reads files, never opens a connection,
  no new runtime deps. Only `packages/cli` touches the filesystem;
  `scripts/roundtrip.sh` is a shell script, not a package.
- `@hejbro/supabase` and both examples import **only from `@hejbro/core`'s
  public `index.ts`** (examples may also import `@hejbro/supabase` and,
  for CLI e2e, the `hejbro` package). A deep import = stop and surface it.
- TS style: no `any`, no `let`/`var`, no `for`/`while`, no ternary (owner's
  `typescript-rules`); Biome tabs + double quotes. Shell scripts are
  POSIX `sh`-compatible bash with `set -euo pipefail`.
- All GitHub-facing text in English; conventional commits, ≤72-char
  subject. **No project-specific example naming anywhere new** — the
  example schema is `app`; Task 32 removes the earlier naming from
  existing files.
- Every new error states why + `Next:` what to do (spec §7); codes are
  kebab-case. Warning text follows the same grammar.
- Determinism: every emitted statement order is fixed by this plan; golden
  tests pin all SQL and all user-facing text.
- **Snapshot version goes 2 → 3 exactly once, in Task 11** (PR A2). Tasks
  before it must keep existing snapshots byte-identical (compact fields
  only). Any other format change = stop-and-report gate.
- `pnpm test` must never require Docker. The round-trip is `pnpm
  roundtrip` only.
- Before claiming any PR done: `pnpm check`, `pnpm check-types`,
  `pnpm test` pass from a clean state (`rm -rf packages/*/dist` first),
  output shown; PRs B and D additionally attach `pnpm roundtrip` output.
- Never run `rm -rf dist`, `pnpm build`, or `turbo run` in a worktree
  another agent is actively using; review gates run in a detached `/tmp`
  worktree (`git worktree add --detach /tmp/<name> <sha>`) — team rule
  adopted 2026-08-21.

## PR map (each PR squash-merges to `dev`; body lists commits + `Closes`)

| PR | Issues | Tasks | Branch | Scope |
|----|--------|-------|--------|-------|
| A1 — table kind: FK `on update`, self-FK, CHECK | Closes #106, #22, #104 · Part of #8 | 1–9 | `phase7-plan` (carries the spec/roadmap/plan commits) | core |
| A2 — table kind: index ordering + partial indexes, snapshot v3 | Closes #105 · Part of #8 | 10–13 | `phase7-table-indexes` | core, cli fixtures, goldens |
| B — `examples/postgres` + `scripts/roundtrip.sh` | Part of #107, #8 | 14–19 | `phase7-examples-postgres` | examples, scripts |
| C — `Preset` + config `presets` + warning rendering | Closes #96 · Part of #8 | 20–23 | `phase7-preset-config` | core, supabase, cli |
| D — `examples/supabase` (+ seed, CLI e2e) | Closes #107 · Part of #8 | 24–26 | `phase7-examples-supabase` | examples |
| E — `hejbro` agent skill | Closes #108 · Part of #8 | 27–29 | `phase7-skills` | `skills/hejbro/`, packages/skills (test + README) |
| F — README + `docs/guide/` + naming sweep | Closes #109, #83, #84, #85 · Part of #8 | 30–32 | `phase7-docs` | docs, README, goldens |
| G — not-null-without-default warning | Closes #27 · Part of #8 | 33 | `phase7-not-null-warning` | core, cli |
| H — CLI e2e flake | Closes #102 · Part of #8 | 34 | `phase7-cli-flake` | cli tests |

---

## Task 1: Commit the phase docs (PR A1 opening commits — already on `phase7-plan`)

**Files:**
- Already committed: `docs/specs/2026-08-19-hejbro-design.md` (D46–D56), `docs/plans/2026-08-19-roadmap.md` (Phase 7/8) — commit `d705a7f`
- Create: `docs/plans/2026-08-20-phase7-implementation.md` (this file)

- [x] **Step 1: Commit the plan**

```bash
git add docs/plans/2026-08-20-phase7-implementation.md
git commit -m "docs(plans): phase 7 implementation plan"
```

## Task 2: Plan-time verification V1 — 3-part column refs in CHECK / index predicates (Docker)

**Files:**
- Modify: `docs/plans/2026-08-20-phase7-implementation.md` ("Resolved at plan review")

- [x] **Step 1: Run the probe** (Docker Desktop must be running; nothing is written to the repo) — run via PGlite instead, no Docker daemon was available — see `v1-probe/probe.mjs`

```bash
C=hejbro-probe
docker run -d --rm --name $C -e POSTGRES_PASSWORD=pg postgres:17-alpine
until docker exec $C pg_isready -U postgres -q; do sleep 1; done
docker exec -i $C psql -U postgres -v ON_ERROR_STOP=0 <<'SQL'
create schema "app";
create table "app"."posts" ("id" uuid primary key, "status" text not null, "slug" text, "published_at" timestamptz);
alter table "app"."posts" add constraint "posts_status_check" check ("app"."posts"."status" in ('draft','published'));
create table "app"."comments" ("id" uuid primary key, "body" text not null, constraint "comments_body_not_blank" check (length(btrim("app"."comments"."body")) > 0));
create index "posts_published_idx" on "app"."posts" ("published_at" desc nulls first) where "app"."posts"."status" = 'published';
create unique index "posts_slug_published_uidx" on "app"."posts" ("slug") where "app"."posts"."published_at" is not null;
SQL
docker exec $C pg_dump -U postgres --schema-only --no-owner --schema=app | grep -iE "check|create (unique )?index"
docker stop $C
```

- [x] **Step 2: Record the outcome** under "Resolved at plan review":
  - All four statements succeed → **V1 = accepted**; Tasks 5 and 10 render
    predicates with the existing `renderExpr` (3-part refs). Note the
    `pg_dump` deparse (bare column names) — irrelevant to the two-path
    comparison.
  - Any statement fails with `missing FROM-clause entry` or similar → **V1
    = rejected**; Task 5 step 3b adds the bare-column render mode and
    Task 10 uses it too.

- [x] **Step 3: Commit**

```bash
git add docs/plans/2026-08-20-phase7-implementation.md
git commit -m "docs(plans): record v1 probe outcome for phase 7"
```

## Task 3: FK `onUpdate` + `set default` (D51, #106)

**Files:**
- Modify: `packages/core/src/dsl/table.ts:16-21` (`foreignKeyActions`), `:33-41` (`ForeignKeyDeclaration`), `:84-92` (`ForeignKeyInput`), `:203-224` (`resolveForeignKey`)
- Modify: `packages/core/src/kinds/table-snapshot.ts:53-66` (`ForeignKeySnapshot` + accessor)
- Modify: `packages/core/src/kinds/table-kind.ts:100-110` (`onDeleteField` sibling), `:132-144` (`serializeForeignKeys`)
- Modify: `packages/core/src/kinds/table-kind-emit-sql.ts:109-133` (action clause)
- Test: `packages/core/test/table-kind-emit.test.ts`, `packages/core/test/table-kind-diff.test.ts`

**Interfaces:**
- Produces: `ForeignKeyInput.onUpdate?: ForeignKeyAction`; `ForeignKeyDeclaration.onUpdate: ForeignKeyAction | null`; `ForeignKeySnapshot.onUpdate?: ForeignKeyAction`; `foreignKeyOnUpdate(fk): ForeignKeyAction | null`; `foreignKeyActions` now includes `"set default"`.

- [x] **Step 1: Write the failing emit test** (append to `table-kind-emit.test.ts`)

```ts
describe("tableKind.emit — foreign key actions", () => {
	it("renders on delete and on update, including set default", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const comments = table(
			app,
			"comments",
			{ id: uuid().primaryKey(), postId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: posts, columns: [posts.id] },
						onDelete: "set null",
						onUpdate: "cascade",
					},
				],
			}),
		);
		const change = expectSingleChange(
			tableKind.diff(null, tableKind.serialize(getTableMeta(comments)), "app.comments"),
		);
		const sql = tableKind.emit(change).map((statement) => statement.sql);
		expect(sql).toContain(
			'alter table "app"."comments" add constraint "comments_post_id_fk" foreign key ("post_id") references "app"."posts" ("id") on delete set null on update cascade;',
		);
	});
});
```

- [x] **Step 2: Run it** — `pnpm --filter @hejbro/core test -- table-kind-emit` → FAIL (type error: `onUpdate` not in `ForeignKeyInput`).

- [x] **Step 3: Implement**

`dsl/table.ts`:
```ts
export const foreignKeyActions = [
	"cascade",
	"restrict",
	"set null",
	"set default",
	"no action",
] as const;
// ForeignKeyDeclaration: add
//   readonly onUpdate: ForeignKeyAction | null;
// ForeignKeyInput: add
//   readonly onUpdate?: ForeignKeyAction;
// resolveForeignKey return: add
//   onUpdate: input.onUpdate ?? null,
```

`kinds/table-snapshot.ts`:
```ts
export type ForeignKeySnapshot = {
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly referencesTable: string;
	readonly referencesColumns: ReadonlyArray<string>;
	readonly onDelete?: ForeignKeyAction;
	readonly onUpdate?: ForeignKeyAction;
};

/** `foreignKey.onUpdate`, defaulting to `null` when absent (compact snapshot). */
export const foreignKeyOnUpdate = (
	foreignKey: ForeignKeySnapshot,
): ForeignKeyAction | null => foreignKey.onUpdate ?? null;
```

`kinds/table-kind.ts` (next to `onDeleteField`):
```ts
const onUpdateField = (
	value: ForeignKeyAction | null,
): Pick<ForeignKeySnapshot, "onUpdate"> => {
	if (value === null) {
		return {};
	}
	return { onUpdate: value };
};
// serializeForeignKeys: spread ...onUpdateField(foreignKey.onUpdate) after onDeleteField
```

`kinds/table-kind-emit-sql.ts`:
```ts
const foreignKeyActionClause = (
	keyword: "delete" | "update",
	action: ForeignKeyAction | null,
): string => {
	if (action === null) {
		return "";
	}
	return ` on ${keyword} ${action}`;
};
// addForeignKeyConstraintSql tail:
//   ...)${foreignKeyActionClause("delete", foreignKeyOnDelete(foreignKey))}${foreignKeyActionClause("update", foreignKeyOnUpdate(foreignKey))};
```

- [x] **Step 4: Add a diff test** in `table-kind-diff.test.ts`: same FK with `onUpdate: "cascade"` vs `onUpdate: "restrict"` → one `alter` change whose notes contain `foreign key "comments_post_id_fk" changed`; emitted SQL = `drop constraint` then `add constraint … on update restrict`. `table-kind-diff.test.ts` has no `expectSingleChange` helper today (it compares full arrays with `toEqual`) — copy the local helper from `table-kind-emit.test.ts:10-16` into this file here; Tasks 6 and 11 reuse it. Helpers are per-file in this test suite, never shared.

- [x] **Step 5: Run** `pnpm --filter @hejbro/core test` → PASS. Confirm golden snapshots unchanged (`git status` shows no `expected/` diffs).

- [x] **Step 6: Commit** — `git commit -m "feat(core): foreign key on update action and set default"`

## Task 4: Self-FK via the callback's own refs (D52, #22)

**Files:**
- Modify: `packages/core/src/dsl/table.ts:33-41`, `:84-92`, `:203-224`
- Modify: `packages/core/src/kinds/table-kind.ts:132-144` (`serializeForeignKeys`)
- Test: `packages/core/test/table-surface.test.ts` (new describe), `packages/core/test/table-kind-emit.test.ts`

**Interfaces:**
- Produces: `ForeignKeyInput.references: { table?: Table; columns: ReadonlyArray<ColumnRef> }`; `ForeignKeyDeclaration.references: { schemaName: string; tableName: string; columns: ReadonlyArray<string> }` (the `TableDeclaration` reference is replaced by the identity parts — `serializeForeignKeys` is the only consumer).
- Error codes: `foreign-key-mixed-reference-tables`, `foreign-key-table-mismatch`, `foreign-key-empty-references`.

- [x] **Step 1: Failing tests** (`table-surface.test.ts`)

```ts
describe("table() — self-referencing foreign keys (D52)", () => {
	it("derives the referenced table from the callback's own column refs", () => {
		const comments = table(
			app,
			"comments",
			{ id: uuid().primaryKey().defaultRandom(), parentId: uuid() },
			(t) => ({
				foreignKeys: [
					{ columns: [t.parentId], references: { columns: [t.id] }, onDelete: "cascade" },
				],
			}),
		);
		const [fk] = getTableMeta(comments).foreignKeys;
		expect(fk?.references).toEqual({ schemaName: "app", tableName: "comments", columns: ["id"] });
	});

	it("still accepts an explicit table and cross-checks it", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const other = table(app, "other", { id: uuid().primaryKey() });
		expect(() =>
			table(app, "comments", { postId: uuid() }, (t) => ({
				foreignKeys: [{ columns: [t.postId], references: { table: other, columns: [posts.id] } }],
			})),
		).toThrowError(/foreign-key-table-mismatch|references columns of "app"."posts" but names table "app"."other"/);
	});

	it("rejects referenced columns from two different tables", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const users = table(app, "users", { id: uuid().primaryKey() });
		expect(() =>
			table(app, "comments", { a: uuid(), b: uuid() }, (t) => ({
				foreignKeys: [{ columns: [t.a, t.b], references: { columns: [posts.id, users.id] } }],
			})),
		).toThrow(/foreign-key-mixed-reference-tables/);
	});
});
```

- [x] **Step 2: Run** → FAIL (type errors / thrown messages missing).

- [x] **Step 3: Implement** in `dsl/table.ts`

```ts
export type ForeignKeyReferenceTarget = {
	readonly schemaName: string;
	readonly tableName: string;
	readonly columns: ReadonlyArray<string>;
};

export type ForeignKeyDeclaration = {
	readonly columns: ReadonlyArray<string>;
	readonly references: ForeignKeyReferenceTarget;
	readonly onDelete: ForeignKeyAction | null;
	readonly onUpdate: ForeignKeyAction | null;
};

export type ForeignKeyInput = {
	readonly columns: ReadonlyArray<ColumnRef>;
	readonly references: {
		/** optional since D52 — derived from `columns` when omitted, cross-checked when given */
		readonly table?: Table;
		readonly columns: ReadonlyArray<ColumnRef>;
	};
	readonly onDelete?: ForeignKeyAction;
	readonly onUpdate?: ForeignKeyAction;
};

const resolveReferenceTarget = (
	tableName: string,
	references: ForeignKeyInput["references"],
): ForeignKeyReferenceTarget => {
	const [first, ...rest] = references.columns;
	if (first === undefined) {
		return throwHejbroError(
			"foreign-key-empty-references",
			`table "${tableName}" declares a foreign key whose references.columns is empty. Next: list at least one referenced column, e.g. references: { columns: [posts.id] }.`,
		);
	}
	const derived = { schemaName: first.exprNode.schemaName, tableName: first.exprNode.tableName };
	const stray = rest.find(
		(ref) => ref.exprNode.schemaName !== derived.schemaName || ref.exprNode.tableName !== derived.tableName,
	);
	if (stray !== undefined) {
		return throwHejbroError(
			"foreign-key-mixed-reference-tables",
			`table "${tableName}" declares a foreign key referencing columns of both "${derived.schemaName}"."${derived.tableName}" and "${stray.exprNode.schemaName}"."${stray.exprNode.tableName}" — a foreign key targets exactly one table. Next: split it into one foreign key per referenced table.`,
		);
	}
	if (references.table !== undefined) {
		const meta = getTableMeta(references.table);
		if (meta.schema.schemaName !== derived.schemaName || meta.tableName !== derived.tableName) {
			return throwHejbroError(
				"foreign-key-table-mismatch",
				`table "${tableName}" declares a foreign key that references columns of "${derived.schemaName}"."${derived.tableName}" but names table "${meta.schema.schemaName}"."${meta.tableName}". Next: drop the table field (it is derived from the columns) or point both at the same table.`,
			);
		}
	}
	return { ...derived, columns: references.columns.map((column) => column.sqlName) };
};
// resolveForeignKey: replace the `references:` object with
//   references: resolveReferenceTarget(tableName, input.references),
```

`kinds/table-kind.ts` `serializeForeignKeys`:
```ts
referencesTable: tableIdentity(
	foreignKey.references.schemaName,
	foreignKey.references.tableName,
),
```

- [x] **Step 4: Emit test** — the self-FK from Step 1 emits
  `alter table "app"."comments" add constraint "comments_parent_id_fk" foreign key ("parent_id") references "app"."comments" ("id") on delete cascade;` as a **deferred** statement.

- [x] **Step 5: Run all core tests** → PASS; `pnpm check-types` across the repo (the reduced example, later renamed `examples/supabase`, and `packages/supabase` callers still pass `table:` — non-breaking).

- [x] **Step 6: Commit** — `git commit -m "feat(core): self-referencing foreign keys via the table's own refs"`

## Task 5: `check(name, expr)` DSL + declaration-time validation (D50, #104)

**Files:**
- Create: `packages/core/src/dsl/check.ts`
- Create: `packages/core/src/expr/walk.ts`
- Modify: `packages/core/src/dsl/table.ts:94-99` (`TableExtras`), `:43-56` (`TableDeclaration`), `table()` body
- Modify: `packages/core/src/index.ts` (export `check`, `CheckDeclaration`)
- Test: `packages/core/test/dsl/check.test.ts` (new)

**Interfaces:**
- Produces: `check(name: string, expression: Expr<"boolean"> | Expr<"unknown">): CheckDeclaration` — the union follows `operators.ts`'s `Operand<TFamily>` pattern: the `sql` template always yields `Expr<"unknown">`, so a `"boolean"`-only parameter would reject the template form D50 explicitly allows (implementation finding, Task 5); `CheckDeclaration = { readonly checkName: string; readonly expression: ExprNode }`; `TableExtras.checks?: ReadonlyArray<CheckDeclaration>`; `TableDeclaration.checks: ReadonlyArray<CheckDeclaration>`; `someExprNode(node, predicate): boolean` in `expr/walk.ts`.
- Error codes: `check-foreign-column-ref`, `check-subquery`, `duplicate-check-name` (name validation itself reuses `invalid-sql-name` via `assertSqlName(name, "check", null)`).

- [x] **Step 1: Failing tests** (`test/dsl/check.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { check } from "../../src/dsl/check";
import { schema } from "../../src/dsl/schema";
import { getTableMeta, table } from "../../src/dsl/table";
import { eq, gt, inArray } from "../../src/expr/operators";
import { sql } from "../../src/expr/sql-template";
import { exists, select } from "../../src/query/select";
import { text, uuid } from "../../src/types/column-builder-factories";

const app = schema("app");

describe("check()", () => {
	it("declares a named check on the table", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey(), status: text().notNull() }, (t) => ({
			checks: [check("posts_status_check", inArray(t.status, ["draft", "published"]))],
		}));
		expect(getTableMeta(posts).checks.map((c) => c.checkName)).toEqual(["posts_status_check"]);
	});

	it("accepts sql-template expressions with column interpolation", () => {
		const posts = table(app, "posts", { body: text() }, (t) => ({
			checks: [check("posts_body_not_blank", sql`length(btrim(${t.body})) > 0`)],
		}));
		expect(getTableMeta(posts).checks).toHaveLength(1);
	});

	it("rejects a column of another table", () => {
		const other = table(app, "other", { n: text() });
		expect(() =>
			table(app, "posts", { id: uuid() }, () => ({
				checks: [check("bad", eq(other.n, "x"))],
			})),
		).toThrow(/check-foreign-column-ref/);
	});

	it("rejects subqueries", () => {
		const other = table(app, "other", { id: uuid() });
		expect(() =>
			table(app, "posts", { id: uuid() }, (t) => ({
				checks: [check("bad", exists(select(other).where(eq(other.id, t.id))))],
			})),
		).toThrow(/check-subquery/);
	});

	it("rejects an invalid name and duplicate names", () => {
		expect(() => check("Bad Name", gt(sql`1`, sql`0`))).toThrow(/invalid-sql-name/);
		expect(() =>
			table(app, "posts", { n: text() }, (t) => ({
				checks: [check("dup", gt(t.n, "a")), check("dup", gt(t.n, "b"))],
			})),
		).toThrow(/duplicate-check-name/);
	});
});
```

- [x] **Step 2: Run** → FAIL (module not found).

- [x] **Step 3: Implement**

`expr/walk.ts`:
```ts
import { assertNever } from "../error";
import type { ExprNode } from "./ast";

/** Depth-first "some" over an expression tree. Does not descend into `exists` subqueries (they are opaque to the caller's scope) but does visit the `exists` node itself, so callers can reject it. */
export const someExprNode = (
	node: ExprNode,
	predicate: (candidate: ExprNode) => boolean,
): boolean => {
	if (predicate(node)) {
		return true;
	}
	switch (node.nodeKind) {
		case "literal":
		case "rawSql":
		case "exists":
		case "plpgsqlRef":
		case "columnRef":
			return false;
		case "comparison":
			return someExprNode(node.left, predicate) || someExprNode(node.right, predicate);
		case "logical":
			return node.operands.some((operand) => someExprNode(operand, predicate));
		case "not":
		case "nullTest":
			return someExprNode(node.operand, predicate);
		case "inList":
			return someExprNode(node.operand, predicate) || node.values.some((value) => someExprNode(value, predicate));
		case "between":
			return (
				someExprNode(node.operand, predicate) ||
				someExprNode(node.lowerBound, predicate) ||
				someExprNode(node.upperBound, predicate)
			);
		case "functionCall":
			return node.args.some((arg) => someExprNode(arg, predicate));
		case "sqlTemplate":
			return node.chunks.some((chunk) => chunk.chunkKind === "expr" && someExprNode(chunk.expr, predicate));
		default:
			return assertNever(node);
	}
};
```

`dsl/check.ts`:
```ts
import type { Expr, ExprNode } from "../expr/ast";
import { assertSqlName } from "../sql/identifier-rules";

/** A declared CHECK constraint: its SQL name and the boolean expression tree (D50). */
export type CheckDeclaration = {
	readonly declarationKind: "check";
	readonly checkName: string;
	readonly expression: ExprNode;
};

/** Declares a named CHECK constraint for a table's `extras.checks` — the name is required and validated like every other SQL name (D36). */
export const check = (name: string, expression: Expr<"boolean"> | Expr<"unknown">): CheckDeclaration => ({
	declarationKind: "check",
	checkName: assertSqlName(name, "check", null),
	expression: expression.exprNode,
});
```

`dsl/table.ts` — add to `TableExtras` `readonly checks?: ReadonlyArray<CheckDeclaration>;`, to `TableDeclaration` `readonly checks: ReadonlyArray<CheckDeclaration>;` (set `checks: []` in `existing-table.ts`), and in `table()`:
```ts
const validateChecks = (
	owner: SchemaDeclaration,
	tableName: string,
	checks: ReadonlyArray<CheckDeclaration>,
): void => {
	const duplicate = checks
		.map((c) => c.checkName)
		.find((name, index, all) => all.indexOf(name) !== index);
	if (duplicate !== undefined) {
		throwHejbroError(
			"duplicate-check-name",
			`table "${tableName}" declares two check constraints named "${duplicate}" — Postgres requires unique constraint names per table. Next: rename one of them.`,
		);
	}
	const subquery = checks.find((c) => someExprNode(c.expression, (n) => n.nodeKind === "exists"));
	if (subquery !== undefined) {
		throwHejbroError(
			"check-subquery",
			`check "${subquery.checkName}" on table "${tableName}" contains a subquery — Postgres forbids subqueries in CHECK constraints. Next: express the rule over this row's columns only, or enforce it with a trigger (defineTrigger).`,
		);
	}
	const foreign = checks
		.flatMap((c) => collectColumnRefs(c.expression).map((ref) => ({ c, ref })))
		.find(({ ref }) => ref.schemaName !== owner.schemaName || ref.tableName !== tableName);
	if (foreign !== undefined) {
		throwHejbroError(
			"check-foreign-column-ref",
			`check "${foreign.c.checkName}" on table "${tableName}" references column "${foreign.ref.schemaName}.${foreign.ref.tableName}.${foreign.ref.columnName}" — a CHECK can only see the row being written. Next: use this table's own columns (the callback's \`t\`), or enforce cross-table rules with a trigger.`,
		);
	}
};
// in table(): const checks = resolvedExtras.checks ?? []; validateChecks(owner, tableName, checks); declaration gets `checks`.
```
(`collectColumnRefs` is already exported from `expr/render-sql.ts`.)

- [x] **Step 3b (only if V1 = rejected): bare-column render mode. Not needed (V1 accepted).** Add to `expr/render-sql.ts`: `export type RenderColumnStyle = "qualified" | "bare";` and an optional third parameter `style: RenderColumnStyle = "qualified"` to `renderExpr`, threaded through every recursive call; the `columnRef` case returns `quoteIdentifier(node.columnName)` when `style === "bare"`. Tasks 6 and 10 then pass `"bare"` for check expressions and index predicates. Add one test in `test/expr/render-sql.test.ts` asserting both styles.

- [x] **Step 4: Export** `check` and `CheckDeclaration` from `src/index.ts`; run tests → PASS.

- [x] **Step 5: Commit** — `git commit -m "feat(core): check(name, expr) table declaration with validation"`

## Task 6: CHECK snapshot + diff (D50)

**Files:**
- Modify: `packages/core/src/kinds/table-snapshot.ts` (`CheckSnapshot`, `TableSnapshot.checks?`, `tableChecks()` accessor)
- Modify: `packages/core/src/kinds/table-kind.ts` (`serializeChecks`, diff notes)
- Test: `packages/core/test/table-kind-diff.test.ts`

**Interfaces:**
- Produces: `CheckSnapshot = { readonly name: string; readonly expression: string }`; `TableSnapshot.checks?: ReadonlyArray<CheckSnapshot>`; `tableChecks(snapshot): ReadonlyArray<CheckSnapshot>` (absent ⇒ `[]`).

- [x] **Step 1: Failing tests**

```ts
describe("tableKind.diff — checks", () => {
	const withCheck = (expression: Expr<"boolean">, name = "posts_status_check") =>
		table(app, "posts", { status: text().notNull() }, (t) => ({ checks: [check(name, expression(t))] }));
	// expression is a function of t: pass `(t) => inArray(t.status, [...])`

	it("serializes checks as rendered SQL and omits the field when empty", () => {
		const plain = tableKind.serialize(getTableMeta(table(app, "posts", { id: uuid() })));
		expect(asTableSnapshot(plain).checks).toBeUndefined();
		const snap = asTableSnapshot(tableKind.serialize(getTableMeta(withCheck((t) => inArray(t.status, ["draft", "published"])))));
		expect(snap.checks).toEqual([
			{ name: "posts_status_check", expression: `"app"."posts"."status" in ('draft', 'published')` },
		]);
	});

	it("reports an expression change as a single alter with a note", () => {
		const before = tableKind.serialize(getTableMeta(withCheck((t) => inArray(t.status, ["draft"]))));
		const after = tableKind.serialize(getTableMeta(withCheck((t) => inArray(t.status, ["draft", "published"]))));
		const change = expectSingleChange(tableKind.diff(before, after, "app.posts"));
		expect(change.operation).toBe("alter");
		expect(change.notes).toEqual(['check "posts_status_check" changed']);
	});
});
```
(If V1 = rejected, the expected expression string is `"status" in ('draft', 'published')`.)

- [x] **Step 2: Run** → FAIL.

- [x] **Step 3: Implement**

`table-snapshot.ts`:
```ts
/** A CHECK constraint as materialized in a table snapshot: its name and the rendered SQL of its expression (D50). */
export type CheckSnapshot = { readonly name: string; readonly expression: string };
// TableSnapshot: add `readonly checks?: ReadonlyArray<CheckSnapshot>;`
/** `snapshot.checks`, defaulting to `[]` when absent (compact snapshot, D33). */
export const tableChecks = (snapshot: TableSnapshot): ReadonlyArray<CheckSnapshot> => snapshot.checks ?? [];
```

`table-kind.ts`:
```ts
const serializeChecks = (declaration: TableDeclaration): ReadonlyArray<CheckSnapshot> =>
	declaration.checks.map((c) => ({ name: c.checkName, expression: renderExpr(c.expression) }));

/** `{ checks }` when the table declares any, else `{}` — absent means "none" (compact). */
const checksField = (checks: ReadonlyArray<CheckSnapshot>): Pick<TableSnapshot, "checks"> => {
	if (checks.length === 0) {
		return {};
	}
	return { checks };
};
// serialize: { schema, name, columns, indexes, foreignKeys, ...checksField(serializeChecks(declaration)) }
// diff: const checkDiff = diffByKey(keyed(tableChecks(previousSnapshot)), keyed(tableChecks(nextSnapshot)));
//       include in isEmptyKeyedDiff guard and notes: ...buildNotes("check", checkDiff)
```
where `keyed = (checks) => checks.map((c) => ({ key: c.name, value: c }))`.

- [x] **Step 4: Run** → PASS; confirm `UPDATE_GOLDEN` not needed (no golden declares checks yet; existing snapshots byte-identical).

- [x] **Step 5: Commit** — `git commit -m "feat(core): serialize and diff check constraints"`

## Task 7: CHECK emit — inline on create, ordered drop/add on alter (D50)

**Files:**
- Modify: `packages/core/src/kinds/table-kind-emit-sql.ts` (`createTableSql`, new `addCheckConstraintSql`/`dropConstraintSql`)
- Modify: `packages/core/src/kinds/table-kind-emit.ts:165-226` (`emitAlter` order)
- Test: `packages/core/test/table-kind-emit.test.ts`

- [x] **Step 1: Failing tests**

```ts
describe("tableKind.emit — checks", () => {
	it("inlines named checks in create table after the primary key", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey(), status: text().notNull() }, (t) => ({
			checks: [check("posts_status_check", inArray(t.status, ["draft", "published"]))],
		}));
		const change = expectSingleChange(tableKind.diff(null, tableKind.serialize(getTableMeta(posts)), "app.posts"));
		expect(tableKind.emit(change)[0]?.sql).toBe(
			'create table "app"."posts" (\n\t"id" uuid not null,\n\t"status" text not null,\n\tprimary key ("id"),\n\tconstraint "posts_status_check" check ("app"."posts"."status" in (\'draft\', \'published\'))\n);',
		);
	});

	it("drops checks before column drops and adds them after column adds", () => {
		const before = table(app, "posts", { id: uuid().primaryKey(), legacy: text() }, (t) => ({
			checks: [check("posts_legacy_check", isNotNull(t.legacy))],
		}));
		const after = table(app, "posts", { id: uuid().primaryKey(), status: text() }, (t) => ({
			checks: [check("posts_status_check", isNotNull(t.status))],
		}));
		const change = expectSingleChange(
			tableKind.diff(tableKind.serialize(getTableMeta(before)), tableKind.serialize(getTableMeta(after)), "app.posts"),
		);
		expect(tableKind.emit(change).map((s) => s.sql)).toEqual([
			'alter table "app"."posts" drop constraint "posts_legacy_check";',
			'alter table "app"."posts" drop column "legacy";',
			'alter table "app"."posts" add column "status" text;',
			'alter table "app"."posts" add constraint "posts_status_check" check ("app"."posts"."status" is not null);',
		]);
	});
});
```

- [x] **Step 2: Run** → FAIL.

- [x] **Step 3: Implement**

`table-kind-emit-sql.ts`:
```ts
const checkConstraintLines = (snapshot: TableSnapshot): ReadonlyArray<string> =>
	tableChecks(snapshot).map((c) => `constraint ${quoteIdentifier(c.name)} check (${c.expression})`);
// createTableSql bodyLines: [...columns, ...primaryKeyConstraint(snapshot.columns), ...checkConstraintLines(snapshot)]

/** Renders `alter table … add constraint "name" check (…);`. */
export const addCheckConstraintSql = (schema: string, tableName: string, c: CheckSnapshot): string =>
	`alter table ${qualifyName(schema, tableName)} add constraint ${quoteIdentifier(c.name)} check (${c.expression});`;

/** Renders `alter table … drop constraint "name";` — shared by foreign keys and checks. */
export const dropConstraintSql = (schema: string, tableName: string, constraintName: string): string =>
	`alter table ${qualifyName(schema, tableName)} drop constraint ${quoteIdentifier(constraintName)};`;
// keep `dropForeignKeyConstraintSql` as an alias export to avoid touching callers: export const dropForeignKeyConstraintSql = dropConstraintSql;
```

`table-kind-emit.ts` `emitAlter` — compute `checkDiff` like the others; `checksToDrop = [...removed keys, ...changed keys]`, `checksToAdd = [...added values, ...changed next]`; final order:
```ts
return [
	...foreignKeysToDrop.map(dropFk),
	...checksToDrop.map((name) => statement(dropConstraintSql(next.schema, next.name, name))),
	...indexDiff.removed.map(dropIndex),
	...columnDiff.removed.map(dropColumn),
	...columnDiff.added.map(addColumn),
	...columnDiff.changed.flatMap(alterColumn),
	...indexDiff.added.map(createIndex),
	...checksToAdd.map((c) => statement(addCheckConstraintSql(next.schema, next.name, c))),
	...foreignKeysToAdd.map(addFkDeferred),
];
```

- [x] **Step 4: Run** → PASS. **Step 5: Commit** — `git commit -m "feat(core): emit check constraints on create and alter"`

## Task 8: Duplicate index / foreign-key name hard errors (D51)

**Files:**
- Modify: `packages/core/src/dsl/table.ts` (`validateColumnRefs` neighborhood)
- Test: `packages/core/test/table-surface.test.ts`

- [x] **Step 1: Failing tests**

```ts
it("rejects two indexes resolving to the same name", () => {
	expect(() =>
		table(app, "posts", { a: text(), b: text() }, (t) => ({
			indexes: [index("posts_a_idx").on(t.a), index().on(t.a)],
		})),
	).toThrow(/duplicate-index-name/);
});
it("rejects two foreign keys on the same local columns", () => {
	const posts = table(app, "posts", { id: uuid().primaryKey() });
	const users = table(app, "users", { id: uuid().primaryKey() });
	expect(() =>
		table(app, "comments", { ownerId: uuid() }, (t) => ({
			foreignKeys: [
				{ columns: [t.ownerId], references: { columns: [posts.id] } },
				{ columns: [t.ownerId], references: { columns: [users.id] } },
			],
		})),
	).toThrow(/duplicate-foreign-key-name/);
});
```

- [x] **Step 2: Implement** in `table()` after extras are resolved (names resolved with `deriveIndexName`/`deriveForeignKeyName` imported from `../kinds/table-kind` — if that import creates a cycle, move both `derive*Name` functions into a new `packages/core/src/sql/derived-names.ts` and re-export them from `table-kind.ts`):

```ts
const firstDuplicate = (names: ReadonlyArray<string>): string | undefined =>
	names.find((name, i, all) => all.indexOf(name) !== i);

const indexNames = indexes.map((ix) => ix.indexName ?? deriveIndexName(tableName, ix.columns));
const duplicateIndex = firstDuplicate(indexNames);
if (duplicateIndex !== undefined) {
	throwHejbroError(
		"duplicate-index-name",
		`table "${tableName}" declares two indexes named "${duplicateIndex}" (derived names are "<table>_<columns>_idx"). Next: give one of them an explicit name with index("…").`,
	);
}
const duplicateFk = firstDuplicate(foreignKeys.map((fk) => deriveForeignKeyName(tableName, fk.columns)));
if (duplicateFk !== undefined) {
	throwHejbroError(
		"duplicate-foreign-key-name",
		`table "${tableName}" declares two foreign keys on the same local columns (both named "${duplicateFk}"). Next: a column set can reference one table — merge or remove one of them.`,
	);
}
```
(Task 10 changes `IndexDeclaration.columns` to objects; the name derivation then maps `ix.columns.map((c) => c.name)` — keep that in mind, it is adjusted in Task 10.)

- [x] **Step 3: Run** → PASS. **Step 4: Commit** — `git commit -m "feat(core): duplicate index and foreign key name errors"`

## Task 9: Golden case `table-constraints` + exports + PR A1

**Files:**
- Create: `packages/core/test/golden/cases/table-constraints/{declarations.ts,steps.ts}` + `expected/` via `UPDATE_GOLDEN=1`
- Modify: `packages/core/src/index.ts` — `check`, `CheckDeclaration`, `ForeignKeyReferenceTarget` exported; snapshot helpers (`CheckSnapshot`, `foreignKeyOnUpdate`, `tableChecks`) stay internal — decided at PR A1 review

- [x] **Step 1: Write the case** — `declarations.ts` declares `app.posts` (status CHECK, slug regex CHECK via `sql`), `app.comments` (self-FK `parentId → id` cascade, FK to posts `on update cascade on delete set null`, body-length CHECK). `steps.ts` exports three steps: `[from-empty]`, `step-1` changes the status CHECK list and the FK actions, `step-2` drops the comments body CHECK.
- [x] **Step 2:** `UPDATE_GOLDEN=1 pnpm --filter @hejbro/core test -- golden` then **read every generated `expected/*.sql` line by line** and confirm the D50 ordering; commit the goldens only after review.
- [x] **Step 3:** Clean-state gates: `rm -rf packages/*/dist && pnpm check && pnpm check-types && pnpm test`.
- [x] **Step 4: Commit** — `git commit -m "test(core): table-constraints golden case"`; open PR A1 from `phase7-plan` → `dev` with body: `Closes #106, #22, #104. Part of #8.` + commit list + gate output.

## Task 10: `asc`/`desc` wrappers, `.on(...).where(expr)`, builder changes (D51, #105)

**Files:**
- Modify: `packages/core/src/dsl/index-builder.ts` (whole file)
- Modify: `packages/core/src/dsl/table.ts:26-31` (`IndexDeclaration`), `validateColumnRefs`, Task 8's name derivation
- Modify: `packages/core/src/index.ts` (export `asc`, `desc`, `IndexColumn`, `IndexColumnInput`)
- Test: `packages/core/test/dsl/index-builder.test.ts` (new)

**Interfaces:**
- Produces:
```ts
export type IndexNulls = "first" | "last";
export type IndexColumn = { readonly column: ColumnRef; readonly desc: boolean; readonly nulls: IndexNulls | null };
export type IndexColumnInput = ColumnRef | IndexColumn;
export const asc = (column: ColumnRef, options?: { readonly nulls?: IndexNulls }): IndexColumn;
export const desc = (column: ColumnRef, options?: { readonly nulls?: IndexNulls }): IndexColumn;
export type IndexDeclaration = {
	readonly columns: ReadonlyArray<{ readonly name: string; readonly desc: boolean; readonly nulls: IndexNulls | null }>;
	readonly unique: boolean;
	readonly indexName: string | null;
	readonly where: ExprNode | null;
};
export type IndexBuilder = { unique(): IndexBuilder; on(...columns: ReadonlyArray<IndexColumnInput>): IndexDeclarationBuilder };
export type IndexDeclarationBuilder = IndexDeclaration & { where(predicate: Expr<"boolean"> | Expr<"unknown">): IndexDeclaration };  // same union as check()
```
- Error codes: `index-predicate-subquery`, `index-predicate-foreign-column-ref`, `index-name-required-with-where` is **not** introduced (D51 keeps naming optional; Task 8's duplicate error is the safety net).

- [x] **Step 1: Failing tests**

```ts
describe("index builder — ordering and partial predicates", () => {
	it("records direction and nulls per column", () => {
		const posts = table(app, "posts", { createdAt: timestamptz(), publishedAt: timestamptz() }, (t) => ({
			indexes: [index("posts_recent_idx").on(t.createdAt, desc(t.publishedAt, { nulls: "first" }))],
		}));
		expect(getTableMeta(posts).indexes[0]?.columns).toEqual([
			{ name: "created_at", desc: false, nulls: null },
			{ name: "published_at", desc: true, nulls: "first" },
		]);
	});
	it("records a where predicate after on()", () => {
		const posts = table(app, "posts", { slug: text(), publishedAt: timestamptz() }, (t) => ({
			indexes: [index("posts_slug_published_uidx").unique().on(t.slug).where(isNotNull(t.publishedAt))],
		}));
		const [ix] = getTableMeta(posts).indexes;
		expect(ix?.unique).toBe(true);
		expect(ix?.where?.nodeKind).toBe("nullTest");
	});
	it("validates the predicate like a check", () => {
		const other = table(app, "other", { id: uuid() });
		expect(() =>
			table(app, "posts", { id: uuid() }, (t) => ({
				indexes: [index("bad").on(t.id).where(exists(select(other).where(eq(other.id, t.id))))],
			})),
		).toThrow(/index-predicate-subquery/);
	});
	it("validates explicit index names (#88 ride-along)", () => {
		expect(() => index("Bad Name")).toThrow(/invalid-sql-name/);
	});
});
```

- [x] **Step 2: Run** → FAIL.

- [x] **Step 3: Implement** `dsl/index-builder.ts`

```ts
import type { ColumnRef, Expr, ExprNode } from "../expr/ast";
import { isExpr } from "../expr/ast";
import { assertSqlName } from "../sql/identifier-rules";
import type { IndexDeclaration, IndexNulls } from "./table";

export type IndexColumn = { readonly column: ColumnRef; readonly desc: boolean; readonly nulls: IndexNulls | null };
export type IndexColumnInput = ColumnRef | IndexColumn;

const isIndexColumn = (input: IndexColumnInput): input is IndexColumn => "column" in input && isExpr(input.column);

const orderedColumn = (desc: boolean) =>
	(column: ColumnRef, options?: { readonly nulls?: IndexNulls }): IndexColumn => ({
		column,
		desc,
		nulls: options?.nulls ?? null,
	});
/** Ascending index column, optionally with an explicit nulls placement. */
export const asc = orderedColumn(false);
/** Descending index column, optionally with an explicit nulls placement (`desc(t.publishedAt, { nulls: "first" })`). */
export const desc = orderedColumn(true);

const toDeclarationColumn = (input: IndexColumnInput): IndexDeclaration["columns"][number] => {
	if (isIndexColumn(input)) {
		return { name: input.column.sqlName, desc: input.desc, nulls: input.nulls };
	}
	return { name: input.sqlName, desc: false, nulls: null };
};

export type IndexDeclarationBuilder = IndexDeclaration & {
	where(predicate: Expr<"boolean">): IndexDeclaration;
};

export type IndexBuilder = {
	unique(): IndexBuilder;
	on(...columns: ReadonlyArray<IndexColumnInput>): IndexDeclarationBuilder;
};

const withWhere = (declaration: IndexDeclaration): IndexDeclarationBuilder => ({
	...declaration,
	where: null,
	// the method is not enumerable data; table() reads only the declaration fields
	...{ where: (predicate: Expr<"boolean">): IndexDeclaration => ({ ...declaration, where: predicate.exprNode }) },
});
```
Because `where` is both a data field (`ExprNode | null`) and a method name on the builder, do **not** overload it — instead name the data field `predicate`:
```ts
// IndexDeclaration.predicate: ExprNode | null   (snapshot field stays `where`, Task 11)
const createIndexBuilder = (indexName: string | null, unique: boolean): IndexBuilder => ({
	unique: () => createIndexBuilder(indexName, true),
	on: (...columns) => {
		const declaration: IndexDeclaration = { columns: columns.map(toDeclarationColumn), unique, indexName, predicate: null };
		return { ...declaration, where: (p) => ({ ...declaration, predicate: p.exprNode }) };
	},
});

/** Resolves an optional index name: `undefined` stays `null` (derive later), else validated per D36. */
const resolveIndexName = (indexName: string | undefined): string | null => {
	if (indexName === undefined) {
		return null;
	}
	return assertSqlName(indexName, "index", null);
};

/** Starts an index declaration, optionally named (validated per D36) — chain `.unique()`, finish with `.on(...columns)`, optionally `.where(predicate)`. */
export const index = (indexName?: string): IndexBuilder =>
	createIndexBuilder(resolveIndexName(indexName), false);
```
`dsl/table.ts`: `IndexDeclaration` as above with `predicate: ExprNode | null`; `IndexNulls` type lives here; `validateColumnRefs` maps `index.columns.map((c) => c.name)`; add `validateIndexPredicates(owner, tableName, indexes)` mirroring Task 5's check validation with codes `index-predicate-subquery` / `index-predicate-foreign-column-ref` (messages: `index "<name>" on table "<t>" … Next: …`). Task 8's derivation uses `ix.columns.map((c) => c.name)`. Update **every** existing test that builds an `IndexDeclaration` literal to the object shape `columns: [{ name, desc: false, nulls: null }]` — seven sites in three files: `table-kind-emit.test.ts` (lines 35-38, 85, 293), `table-kind-diff.test.ts` (41-42, 195-198), `dsl.test.ts` (99 — an expected value, 106 — an input). `grep -rn "indexName:" packages/core/test packages/supabase/test examples` must come back clean of string-array `columns` before this task's commit. `table()` must copy only the four `IndexDeclaration` fields out of what `.on()` returns (`resolveIndex`, mirroring `resolveForeignKey`) — otherwise the builder's `where` method leaks into the stored declaration.

- [x] **Step 4: Run** core tests → PASS (serialization still writes strings until Task 11 — `serializeIndexes` temporarily maps `c.name`; Task 11 replaces it).
- [x] **Step 5: Commit** — `git commit -m "feat(core): ordered index columns and partial index predicates in the dsl"`

## Task 11: Snapshot v3 — index columns as objects, `where`, version bump (D51)

**Files:**
- Modify: `packages/core/src/kinds/table-snapshot.ts:43-50` (`IndexSnapshot`)
- Modify: `packages/core/src/kinds/table-kind.ts` (`serializeIndexes`)
- Modify: `packages/core/src/snapshot/snapshot.ts:8-23` (`HEJBRO_SNAPSHOT_VERSION = 3` + doc comment)
- Modify: `packages/core/src/engine/rename-plan.ts:740-770` (index column rename rewrite uses `entry.columns.map((c) => c.name)` and rebuilds objects)
- Test: `packages/core/test/snapshot.test.ts`, `packages/core/test/rename-plan.test.ts`, `packages/core/test/table-kind-diff.test.ts`

**Interfaces:**
- Produces:
```ts
export type IndexColumnSnapshot = { readonly name: string; readonly desc?: true; readonly nulls?: IndexNulls };
export type IndexSnapshot = { readonly name: string; readonly columns: ReadonlyArray<IndexColumnSnapshot>; readonly unique?: true; readonly where?: string };
export const indexColumnDesc = (c: IndexColumnSnapshot): boolean; export const indexColumnNulls = (c): IndexNulls | null; export const indexWhere = (ix): string | null;
export const HEJBRO_SNAPSHOT_VERSION = 3;
```

- [x] **Step 1: Failing tests** — `snapshot.test.ts`: `renderSnapshot(emptySnapshot)` contains `"hejbroSnapshot": 3`; `parseSnapshot` of a version-2 text throws `unsupported-snapshot-version`. `table-kind-diff.test.ts`: serializing the index from Task 10 yields `{ name: "posts_recent_idx", columns: [{ name: "created_at" }, { name: "published_at", desc: true, nulls: "first" }] }` and the partial unique index yields `{ …, unique: true, where: '"app"."posts"."published_at" is not null' }`. `rename-plan.test.ts`: renaming a column inside an ordered index keeps `desc`/`nulls` on the renamed entry.

- [x] **Step 2: Run** → FAIL.

- [x] **Step 3: Implement** — snapshot types + accessors (compact: `desc` only when true, `nulls` only when set, `where` only when present); `serializeIndexes`:
```ts
const serializeIndexColumn = (c: IndexDeclaration["columns"][number]): IndexColumnSnapshot => ({
	name: c.name,
	...(c.desc ? { desc: true as const } : {}),   // write as two `if` helpers, no ternary
	...(c.nulls === null ? {} : { nulls: c.nulls }),
});
// serializeIndexes: { name, columns: index.columns.map(serializeIndexColumn), ...indexUniqueField(index.unique), ...whereField(renderPredicate(index.predicate)) }
```
(`renderPredicate` = `renderExpr(node)` or the bare mode per V1; `null` → `{}`.) Bump `HEJBRO_SNAPSHOT_VERSION` to `3` and extend its doc comment: "Bumped to 3 in Phase 7 (D51): `IndexSnapshot.columns` entries became objects (`{ name, desc?, nulls? }`) and indexes gained `where`; tables gained the additive `checks` field at the same time. Pre-publication, no shim." In `rename-plan.ts` `rewriteIndexesForRename` (`:733-771`), both `deriveIndexName(...)` calls (old name at `:746`, new name at `:756`) and the `resolveRenamedColumns` call now take `entry.columns.map((c) => c.name)`; zip the renamed names back onto the objects: `entry.columns.map((c, i) => ({ ...c, name: newNames[i] ?? c.name }))` so `desc`/`nulls` survive the rename.

- [x] **Step 4: Run** core tests → the golden suite and CLI fixtures now fail (expected); **do not** regenerate yet. Commit the source change alone: `git commit -m "feat(core)!: snapshot v3 — index column objects and where"` (the `!` marks the format break; body: "BREAKING: snapshot files from version 2 are rejected; regenerate with hejbro generate from an empty snapshot (pre-publication, D51)").

## Task 12: Index emit with ordering/`where`; changed indexes → drop + create (D51 bug fix)

**Files:**
- Modify: `packages/core/src/kinds/table-kind-emit-sql.ts:97-107`
- Modify: `packages/core/src/kinds/table-kind-emit.ts` (`emitAlter` index section)
- Test: `packages/core/test/table-kind-emit.test.ts`

- [x] **Step 1: Failing tests**

```ts
it("renders ordered columns and a where predicate", () => {
	// posts_recent_idx + posts_slug_published_uidx from Task 10
	expect(sql).toContain('create index "posts_recent_idx" on "app"."posts" ("created_at", "published_at" desc nulls first);');
	expect(sql).toContain('create unique index "posts_slug_published_uidx" on "app"."posts" ("slug") where "app"."posts"."published_at" is not null;');
});
it("recreates an index whose definition changed under the same name (was silently skipped)", () => {
	const before = table(app, "posts", { a: text(), b: text() }, (t) => ({ indexes: [index("posts_ab_idx").on(t.a)] }));
	const after = table(app, "posts", { a: text(), b: text() }, (t) => ({ indexes: [index("posts_ab_idx").unique().on(t.a, t.b)] }));
	const change = expectSingleChange(tableKind.diff(tableKind.serialize(getTableMeta(before)), tableKind.serialize(getTableMeta(after)), "app.posts"));
	expect(tableKind.emit(change).map((s) => s.sql)).toEqual([
		'drop index "app"."posts_ab_idx";',
		'create unique index "posts_ab_idx" on "app"."posts" ("a", "b");',
	]);
});
```

- [x] **Step 2: Implement**

```ts
const indexColumnSql = (c: IndexColumnSnapshot): string =>
	[quoteIdentifier(c.name), ...descKeyword(c), ...nullsClause(c)].join(" ");
// descKeyword: indexColumnDesc(c) ? ["desc"] : [] — written with if; nullsClause: nulls === null ? [] : [`nulls ${nulls}`]
const whereClause = (index: IndexSnapshot): string => {
	const predicate = indexWhere(index);
	if (predicate === null) {
		return "";
	}
	return ` where ${predicate}`;
};
export const createIndexSql = (schema, tableName, index) =>
	`create ${uniqueIndexKeyword(index)}index ${quoteIdentifier(index.name)} on ${qualifyName(schema, tableName)} (${index.columns.map(indexColumnSql).join(", ")})${whereClause(index)};`;
```
`emitAlter`: `indexesToDrop = [...indexDiff.removed.map((e) => e.key), ...indexDiff.changed.map((e) => e.key)]`, `indexesToAdd = [...indexDiff.added.map((e) => e.value), ...indexDiff.changed.map((e) => e.next)]`; use them in the existing drop/add slots.

- [x] **Step 3: Run** → PASS (unit). **Step 4: Commit** — `git commit -m "fix(core): recreate changed indexes and render ordering and where"`

## Task 13: Regenerate goldens, snapshots, fixtures for v3 (single regeneration task)

**Files:**
- Regenerate: `packages/core/test/golden/cases/*/expected/snapshot.json` (+ any `.sql` whose index lines changed)
- Modify: `packages/cli/test/init.test.ts` (`"hejbroSnapshot": 2` → `3`), any CLI golden under `packages/cli/test/fixtures/**` or inline snapshot text mentioning version 2
- Verify: the reduced example (later renamed `examples/supabase`), `examples/cli-smoke`, `examples/preset-smoke` tests (in-process; no committed snapshots yet)
- Create: `packages/core/test/golden/cases/table-indexes/…` (added at review — pins the v3 index shape and the changed-index recreate path)

- [x] **Step 1:** `UPDATE_GOLDEN=1 pnpm --filter @hejbro/core test -- golden`; `git diff --stat packages/core/test/golden` — **every** `snapshot.json` changes on its version line and on index `columns` entries only; no `.sql` may change except index `create` lines. Read the diff; anything else = stop and report.
- [x] **Step 2:** `grep -rn '"hejbroSnapshot": 2' packages examples` → fix each remaining literal to `3` (CLI `init` writes `emptySnapshot` through core, so only hard-coded test texts change).
- [x] **Step 3:** Clean-state gates. **Step 4: Commit** — `git commit -m "test: regenerate goldens and fixtures for snapshot v3"`; open PR A2 (`Closes #105`) with the gate output and a one-paragraph note that #88 landed inside Task 10 (close #88 with the PR only if the owner agrees; otherwise leave it in Phase 8 and say so).

## Task 14: `examples/postgres` — package scaffold + step-1 declarations (O1 domain)

**Files:**
- Create: `examples/postgres/package.json`, `tsconfig.json`, `vitest.config.ts`, `turbo.json`, `hejbro.config.ts`, `src/steps/step-1.schema.ts`
- Create: `examples/postgres/src/app.schema.ts` (the live entry — at first identical to step 1; by Task 16 identical to step 4)

**Interfaces:**
- Produces the `app` schema (team workspace, O1): `members(id, email unique, display_name, role text CHECK in (owner, admin, member))`, `projects(id, slug unique + regex CHECK via sql, name, owner_id → members on delete restrict on update cascade, archived_at)`, `tasks(id, project_id → projects cascade, title length CHECK, status CHECK, priority smallint between 1 and 5 CHECK, due_at; partial index on (project_id, due_at desc nulls last) where status <> 'done'; partial unique index on (project_id, lower-free slug-like key) — keep it simple: unique (project_id, title) where status <> 'done')`, `comments(id, task_id → tasks cascade, parent_id → comments cascade (self-FK), body CHECK length(btrim(body)) > 0)`, RLS on all four (select to `app_reader` role name string; insert/update to `app_writer` with `using`/`withCheck` on `members`), trigger `comments_single_depth` (before insert/update of parent_id: raise when the parent itself has a parent — `ctx.rowOrNull` + `ctx.if` + `ctx.raise`), a view `open_tasks` with `securityInvoker: true`, grants `grant(app).usage.to("app_reader", "app_writer")` + `.tables("select").to("app_reader")` + `.tables("select","insert","update","delete").to("app_writer")`. `app_reader`/`app_writer` are cluster-level roles hejbro never creates (it manages grants and RLS, not `CREATE ROLE`) — the round-trip seeds them (see the `seed/roles.sql` addendum below).

- [ ] **Step 1:** `package.json`
```json
{
	"name": "example-postgres",
	"version": "0.0.0",
	"private": true,
	"description": "Showcase: a generic team-workspace schema on plain Postgres — tables, CHECK constraints, partial and ordered indexes, a self-referencing FK, RLS, a trigger, grants, a view — with a four-step migration history and a local Docker round-trip.",
	"type": "module",
	"scripts": {
		"check-types": "tsc --noEmit",
		"test": "vitest run",
		"roundtrip": "sh ../../scripts/roundtrip.sh ."
	},
	"dependencies": { "hejbro": "workspace:*" },
	"devDependencies": { "typescript": "catalog:", "vitest": "catalog:" }
}
```
`turbo.json` = copy of `examples/cli-smoke/turbo.json` plus `check-types: { dependsOn: ["^build"] }`. `tsconfig.json` = copy of the reduced example's `tsconfig.json` (later renamed `examples/supabase/tsconfig.json`). `hejbro.config.ts` = copy of `examples/cli-smoke/hejbro.config.ts` with `prefixStrategy: "index"` and `entry: ["src/app.schema.ts"]` — a single file, not `cli-smoke`'s recursive `src/**/*.schema.ts` (stable file names `0001_…sql`). The single-file form is load-bearing, not cosmetic: `src/steps/*.schema.ts` (Task 15) each declare their own `schema("app")`, so a recursive glob sweeps them all into one `generate` run and fails with `duplicate-identity: schema:app` (found during Task 16 — the step files are for `test/chain.test.ts` to import directly, never a declaration source for the CLI).
- [ ] **Step 2:** Write `src/steps/step-1.schema.ts` with the domain above **minus** the three later changes (no `tasks.estimate_hours`, `projects.owner_id` FK with default actions only, `tasks.due_at` living on `tasks`), importing only from `"hejbro"`. Copy it to `src/app.schema.ts`.
- [ ] **Step 3:** `pnpm install` (workspace link) → `pnpm --filter example-postgres check-types` passes. Commit: `git commit -m "feat(examples): postgres showcase scaffold and step 1 declarations"`.

## Task 15: Steps 2–4 declarations

**Files:**
- Create: `examples/postgres/src/steps/step-2.schema.ts` (add `tasks.estimate_hours numeric` + CHECK `estimate_hours >= 0`), `step-3.schema.ts` (`projects.owner_id` FK becomes `on update cascade on delete restrict`; tasks' due index gains `nulls last`), `step-4.schema.ts` (move `due_at` from `tasks` to a new `task_schedules(task_id pk → tasks cascade, due_at, reminder_at CHECK reminder_at < due_at)`; drop the partial index that used `due_at`; add a new ordered index on `task_schedules(due_at desc)`; also add `tasks.closed_at` (nullable, unrelated to the move) in the same step so D32 rule A's same-table drop + add pair engages the `--confirm-drop` path — see D48)
- Modify: `src/app.schema.ts` = step 4 content

- [ ] **Step 1:** Write the three files as full copies (each step is a complete, self-contained declaration set — no imports between steps). Each step file ends with `export const declarations = [app, members, projects, tasks, …]` so tests can feed them in order.
- [ ] **Step 2:** `check-types` passes. Commit: `git commit -m "feat(examples): postgres showcase steps 2-4"`.

## Task 16: Generate the committed chain with the CLI

**Files:**
- Create (generated): `examples/postgres/migrations/0001_*.sql` … `0004_*.sql`, `examples/postgres/hejbro.snapshot.json`

- [ ] **Step 1:** From `examples/postgres` (after `pnpm build`): copy step 1 to `src/app.schema.ts`, run `node ../../packages/cli/dist/cli.js init` (keeps the existing config; creates the empty snapshot) then `… generate`. Repeat for steps 2 and 3. For step 4 run `generate` once to get the `--confirm-drop` diagnostic, then rerun with the suggested flags (expected: `--confirm-drop app.tasks.due_at`). Leave `src/app.schema.ts` = step 4.
- [ ] **Step 2:** Read all four migration files; confirm banners (`+ table app.task_schedules`, `~ table app.tasks [column due_at dropped, …]`, `parent-snapshot:`/`snapshot:` lines) and that step 3's SQL is a `drop constraint` + `add constraint … on delete restrict on update cascade` pair and a `drop index` + `create index … nulls last` pair.
- [ ] **Step 3:** Commit: `git commit -m "feat(examples): postgres showcase migration chain"`.

## Task 17: Tests — regeneration equals committed files; verify hash chain

**Files:**
- Create: `examples/postgres/test/chain.test.ts`, `examples/postgres/test/cli.test.ts`

- [ ] **Step 1:** `chain.test.ts` (in-process, DB-free):

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChainEntry, ConfirmDropSpec } from "hejbro";
import { checkChain, emptySnapshot, generateMigration, parseBannerHashes, renderSnapshot } from "hejbro";
import { describe, expect, it } from "vitest";
import { declarations as step1 } from "../src/steps/step-1.schema";
import { declarations as step2 } from "../src/steps/step-2.schema";
import { declarations as step3 } from "../src/steps/step-3.schema";
import { declarations as step4 } from "../src/steps/step-4.schema";

const root = join(import.meta.dirname, "..");
const migrationFiles = readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort();
const stripBanner = (sql: string): string => sql.split("\n").filter((line) => !line.startsWith("-- ")).join("\n");
// Step 4 moves due_at across tables — the same --confirm-drop the CLI asked for in Task 16.
const confirmedDropsForStep = (stepIndex: number): ReadonlyArray<ConfirmDropSpec> => {
	if (stepIndex !== 3) {
		return [];
	}
	return [{ target: "column", schemaName: "app", tableName: "tasks", columnName: "due_at" }];
};

describe("examples/postgres migration chain", () => {
	it("regenerating from the step declarations reproduces the committed migrations", () => {
		const steps = [step1, step2, step3, step4];
		const outcome = steps.reduce(
			(state, declarations, i) => {
				const result = generateMigration({
					declarations,
					previousSnapshot: state.snapshot,
					confirmedDrops: confirmedDropsForStep(i),
				});
				expect(result.errors).toEqual([]);
				const committed = readFileSync(join(root, "migrations", migrationFiles[i] as string), "utf8");
				expect(stripBanner(result.sql)).toBe(stripBanner(committed));
				return { snapshot: result.snapshot };
			},
			{ snapshot: emptySnapshot },
		);
		expect(renderSnapshot(outcome.snapshot)).toBe(readFileSync(join(root, "hejbro.snapshot.json"), "utf8"));
	});

	it("the committed banners form an unbroken hash chain", () => {
		const entries: ReadonlyArray<ChainEntry> = migrationFiles.map((name) => {
			const hashes = parseBannerHashes(readFileSync(join(root, "migrations", name), "utf8"));
			if (hashes === null) {
				throw new Error(`${name} has no banner hash lines`);
			}
			return { fileName: name, parent: hashes.parent, current: hashes.current };
		});
		const report = checkChain(entries);
		expect(report.ok).toBe(true);
	});
});
```
(Field names verified against `engine/chain.ts:12-30` — `ChainEntry { fileName, parent, current }`, `ChainReport = { ok: true; tip } | { ok: false; code; details }` — and `engine/rename-plan.ts:45-58` — `ConfirmDropSpec` is a union discriminated by `target: "column" | "table"`. `hejbro` re-exports all of `@hejbro/core` (`packages/cli/src/index.ts:10`), so the imports above resolve.)

- [ ] **Step 2:** `cli.test.ts` mirrors `examples/cli-smoke/test/e2e.test.ts`'s tmp-copy harness, copies the example **with** its committed `migrations/` and snapshot, runs the built CLI `verify` → exit 0 and stdout contains `verify:`; then `generate` → `no changes`.
- [ ] **Step 3:** Run → PASS. Commit: `git commit -m "test(examples): postgres chain regeneration and verify"`.

## Task 18: `scripts/roundtrip.sh` + `pnpm roundtrip`

**Files:**
- Create: `scripts/roundtrip.sh`

- [ ] **Step 1:** Write the script

```sh
#!/usr/bin/env bash
# Local round-trip (D48/D49): applies an example's committed migration chain
# to one database and a single fresh migration to another, then diffs the
# two schema dumps. Docker CLI only — psql/pg_dump run inside the container.
# Usage: scripts/roundtrip.sh <example-dir> [seed.sql]
set -euo pipefail

EXAMPLE_DIR="$(cd "$1" && pwd)"
SEED_FILE="${2:-}"
IMAGE="${HEJBRO_PG_IMAGE:-postgres:17-alpine}"
CONTAINER="hejbro-roundtrip-$$"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO_ROOT/packages/cli/dist/cli.js"
WORK="$(mktemp -d)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

[ -f "$CLI" ] || { echo "build the CLI first: pnpm build" >&2; exit 2; }
[ -e "$EXAMPLE_DIR/node_modules/hejbro" ] || { echo "run pnpm install first: $EXAMPLE_DIR/node_modules/hejbro is missing (pnpm workspace link)" >&2; exit 2; }

docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
until docker exec "$CONTAINER" pg_isready -U postgres -q; do sleep 1; done
psql() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql -c 'create database chain;' -c 'create database fresh;'
if [ -n "$SEED_FILE" ]; then
  psql -d chain < "$SEED_FILE"
  psql -d fresh < "$SEED_FILE"
fi

echo "== applying committed chain to 'chain'"
for f in "$EXAMPLE_DIR"/migrations/*.sql; do
  echo "   $(basename "$f")"
  psql -d chain < "$f"
done

echo "== generating one fresh migration from the live declarations"
cp -R "$EXAMPLE_DIR" "$WORK/example"
rm -rf "$WORK/example/migrations" "$WORK/example/node_modules"
cp "$EXAMPLE_DIR/hejbro.snapshot.json" "$WORK/final.snapshot.json"
(cd "$WORK/example" && mkdir -p node_modules && ln -s "$EXAMPLE_DIR/node_modules/hejbro" node_modules/hejbro \
  && node "$CLI" init >/dev/null && node "$CLI" generate >/dev/null)
FRESH="$(ls "$WORK"/example/migrations/*.sql)"
psql -d fresh < "$FRESH"
cmp -s "$WORK/final.snapshot.json" "$WORK/example/hejbro.snapshot.json" || { echo "snapshot from fresh generate differs from the committed snapshot" >&2; exit 1; }

dump() { docker exec "$CONTAINER" pg_dump -U postgres -d "$1" --schema-only --no-owner --schema=app \
  | grep -vE '^(SET |SELECT pg_catalog\.set_config|--|\\restrict|\\unrestrict|$)'; }
dump chain > "$WORK/chain.sql"
dump fresh > "$WORK/fresh.sql"

echo "== diff (chain vs fresh)"
if diff -u "$WORK/chain.sql" "$WORK/fresh.sql"; then
  echo "round-trip OK: $(wc -l < "$WORK/chain.sql") dump lines identical"
else
  echo "round-trip FAILED: the migration chain and a fresh migration produce different schemas" >&2
  exit 1
fi

if [ -f "$EXAMPLE_DIR/roundtrip.rows.sql" ]; then
  echo "== row-data comparison ($EXAMPLE_DIR/roundtrip.rows.sql)"
  psql -d chain -At < "$EXAMPLE_DIR/roundtrip.rows.sql" > "$WORK/rows.chain"
  psql -d fresh -At < "$EXAMPLE_DIR/roundtrip.rows.sql" > "$WORK/rows.fresh"
  diff -u "$WORK/rows.chain" "$WORK/rows.fresh" && cat "$WORK/rows.chain"
fi
```
Notes for the implementer: `init` on a copy without a snapshot creates an empty one; `generate` then produces exactly one migration. The `\restrict`/`\unrestrict` lines are pg_dump ≥ 17.6 safety markers — keep them in the filter. The `app` schema name is the only hard-coded value; if an example uses another schema, pass `HEJBRO_PG_SCHEMA` (add `--schema="${HEJBRO_PG_SCHEMA:-app}"`).
- [ ] **Step 2:** `chmod +x scripts/roundtrip.sh`; `pnpm build && pnpm --filter example-postgres roundtrip` → `round-trip OK`. Paste the full output into the PR body.
- [ ] **Step 3:** Commit: `git commit -m "feat(examples): local docker round-trip script"`.

**Addendum (found by the round-trip itself, D48/D49's purpose):** the first run against a bare `postgres:17-alpine` container failed with `role "app_reader" does not exist` — hejbro manages grants and RLS but never `CREATE ROLE`, so a schema's grant/policy target roles must already exist. `examples/postgres/seed/roles.sql` seeds `app_reader`/`app_writer` (same do-block-guard style as `examples/supabase/seed/supabase.sql`); `package.json`'s `roundtrip` script passes it as the seed argument. See D48/D49/D53 in the spec.

## Task 19: `examples/README.md` rewrite + PR B

**Files:**
- Modify: `examples/README.md`

- [ ] **Step 1:** Replace the file with: purpose (showcases double as integration tests), a table — `postgres` (core only, no seed), `supabase` (preset, seeded; "lands in PR D"), `cli-smoke` (CLI e2e fixture), `preset-smoke` (extension-interface fixture) — and a "Running the round-trip locally" section (`pnpm build`, Docker Desktop running, `pnpm --filter example-postgres roundtrip`), plus how the four-step history is laid out (`src/steps/`, `migrations/`, the regeneration test).
- [ ] **Step 2:** Clean-state gates; commit `docs(examples): readme for the showcase examples`; open PR B (`Part of #107, #8`) with the round-trip output attached.

## Task 20: Core `Preset` type + `registerPresets` (D55)

**Files:**
- Create: `packages/core/src/engine/preset.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/preset.test.ts`

**Interfaces:**
```ts
export type Preset = {
	readonly name: string;
	readonly kinds: ReadonlyArray<ObjectKind<HejbroDeclaration>>;
	readonly validators: ReadonlyArray<Validator>;
};
/** Registers every kind of every preset into `registry` (duplicate kinds surface core's existing `duplicate-kind` error). */
export const registerPresets = (registry: KindRegistry, presets: ReadonlyArray<Preset>): void;
/** Flattens preset validators in preset order. */
export const presetValidators = (presets: ReadonlyArray<Preset>): ReadonlyArray<Validator>;
```
(`ObjectKind<HejbroDeclaration>` is the erased form — presets cast their typed kind once when building the object; document that cast as sanctioned, like `roleName()`'s.)

- [x] **Step 1: Failing test** — a toy preset with one custom kind (reuse `examples/preset-smoke`'s `smoke-schema-note` shape inline) and one validator; `registerPresets` makes `registry.get("smoke-schema-note")` succeed; `presetValidators` returns the validator; registering the same preset twice throws `duplicate-kind`.
- [x] **Step 2: Implement** (pure, ~20 lines). Export `Preset`, `registerPresets`, `presetValidators`.
- [x] **Step 3:** PASS; commit `feat(core): preset data object and registerPresets`.

## Task 21: `supabasePreset`

**Files:**
- Modify: `packages/supabase/src/index.ts`
- Test: `packages/supabase/test/preset.test.ts`

- [x] **Step 1: Failing test** — `supabasePreset.name === "supabase"`, `kinds.map((k) => k.kind)` equals `["supabase-storage-bucket"]`, `validators` deep-equals `supabaseValidators`.
- [x] **Step 2: Implement**
```ts
import type { Preset } from "@hejbro/core";
/** The Supabase preset as a config-listable data object (D55): `presets: [supabasePreset]` in hejbro.config.ts. */
export const supabasePreset: Preset = {
	name: "supabase",
	kinds: [storageBucketKind as ObjectKind<HejbroDeclaration>],
	validators: supabaseValidators,
};
```
- [x] **Step 3:** PASS; commit `feat(supabase): supabasePreset`.

## Task 22: CLI — config `presets`, registry from presets, warnings on stderr (D55, #96)

**Files:**
- Modify: `packages/cli/src/config.ts` (`HejbroConfig.presets`, zod shape)
- Modify: `packages/cli/src/commands/generate.ts` (`runGenerate`: registry + validators + warning rendering), `packages/cli/src/commands/verify.ts` (registry)
- Modify: `packages/cli/src/diagnostics.ts` (`severity` on `Diagnostic`, header `warning[<code>]`)
- Modify: `packages/cli/src/commands/init.ts` (scaffolded config gains `presets: []`)
- Test: `packages/cli/test/config.test.ts`, `packages/cli/test/generate-command.test.ts`, `packages/cli/test/verify.test.ts`

**Interfaces:**
- `HejbroConfig.presets: ReadonlyArray<Preset>` (default `[]`); zod: `presets: z.array(z.object({ name: z.string(), kinds: z.array(z.unknown()), validators: z.array(z.unknown()) })).default([])` — shape only (D55); the `z.unknown()` arrays are then narrowed by a type predicate `isPreset` that checks each kind has string `kind` and function `serialize`/`diff`/`emit`/`identify`/`owns`, each validator is a function; failure → `invalid-config` with "config field \"presets[i]\" … Next: pass preset objects exported by a preset package (e.g. `supabasePreset` from @hejbro/supabase)."
- `diagnostics.Diagnostic.severity?: "error" | "warning"` — **optional**, so every existing constructor (`fromHejbroError`, the rename-ambiguity builder, verify's diagnostics) stays unchanged; `renderDiagnostic` replaces the hard-coded `error[` (`diagnostics.ts:53-57`) with `${diagnostic.severity ?? "error"}[${diagnostic.code}]: ${diagnostic.identity}`. New `fromWarning(diagnostic: CoreDiagnostic, identity: string): Diagnostic` sets `severity: "warning"`.

- [x] **Step 1: Failing tests**
  - `config.test.ts`: config without `presets` parses with `presets: []`; `presets: [{ name: "x", kinds: [], validators: [] }]` parses; `presets: [42]` → `invalid-config` mentioning `presets[0]`.
  - `generate-command.test.ts`: fixture config `presets: [{ name: "warn", kinds: [], validators: [() => [{ severity: "warning", code: "demo-warning", message: "table \"app\".\"posts\" is exposed. Next: declare rls(...).", declaredAt: null }]] }]` → exit 0, migration written, stderr equals the golden:
    ```
    warning[demo-warning]: app.posts
      table "app"."posts" is exposed. Next: declare rls(...).
    ```
    (O3 — exact wording to be approved; identity = first `"schema"."table"` pair found in the message, else the config identity.)
  - `verify.test.ts`: a fixture declaring a `storageBucket` with `presets: [supabasePreset]` verifies with exit 0; without the preset it exits 1 with `unowned-declaration` (`buildSnapshot` rejects a declaration no registered kind owns before any registry lookup — not `unknown-kind`, which only fires once `diffSnapshots` looks up a kind name already present in a snapshot). The fixture needs `test/support/cli-runner.ts`'s `createCliFixtureDir()` to also symlink `node_modules/@hejbro/supabase`, and `packages/cli/package.json` to add `@hejbro/supabase: workspace:*` as a devDependency (not a runtime one).
- [x] **Step 2: Implement** — `buildRegistry(config)` helper in a new `packages/cli/src/presets.ts`: `const registry = createDefaultRegistry(); registerPresets(registry, config.presets); return registry;`. `runGenerate`: pass `registry` and `validators: presetValidators(config.presets)` to both passes; after writing the migration, if `finalPass.warnings.length > 0` set `stderr` to `renderDiagnostics(warnings.map(fromWarning), null)` while keeping `exitCode: 0`. `runVerify`: pass `registry`. `init`: scaffold `presets: []` in the config template (and update its golden).
- [x] **Step 3:** PASS; commit `feat(cli): presets config field, preset registry, warning rendering`.

## Task 23: PR C close-out

- [x] **Step 1:** `packages/supabase/README.md`: replace the "register kinds manually" snippet with `presets: [supabasePreset]` and keep `registerSupabaseKinds` as "programmatic use". `packages/cli` README/`--help` untouched (no new flags).
- [x] **Step 2:** Clean-state gates; open PR C (`Closes #96`) with the warning golden quoted in the body for O3 approval.

## Task 24: `examples/supabase` — rename + genericize + config + chain

**Files:**
- Move: the reduced example's directory (project-specific-named at the time) → `examples/supabase/` (`git mv`), package name `example-supabase`
- Modify: `src/app.schema.ts` (renamed from the old schema file; schema `app`; entities: `profiles(id, user_id → authUsers, display_name)`, `attachments(id, profile_id → profiles, storage_path, size_bytes CHECK > 0)`, a deliberately RLS-less `drafts` table (keeps the D40 warning), bucket `attachments` (public false, size limit, mime list), grants to `anonRole`/`authenticatedRole`, view `profiles_public` without `securityInvoker` (keeps the #66 warning))
- Create: `hejbro.config.ts` with `presets: [supabasePreset]` and `entry: ["src/app.schema.ts"]` (single file, not a recursive glob — see Task 14's note: `src/steps/*.schema.ts` each declare their own `schema("app")` and must never be swept into a `generate` run), `src/steps/step-1..4.schema.ts`, `migrations/0001..0004`, `hejbro.snapshot.json`, `roundtrip.rows.sql`
- Modify: `test/` → `chain.test.ts` + `cli.test.ts` (same shape as Task 17; the CLI test additionally asserts the two warnings on stderr with exit 0), keep the two negative tests (reserved schema hard error, bucket-drop banner note) in `preset.test.ts`

Unlike `examples/postgres` (Task 14 addendum), this example's grants/RLS target `anonRole`/`authenticatedRole` — roles Task 25's seed already creates, so no extra seeding is needed here.

- [ ] **Step 1:** `git mv`, rename identifiers, rewrite the file header comment (no project name; "Showcase: the Supabase preset on a generic schema"). Design the four steps: 1 baseline; 2 add `attachments.content_type` + CHECK on allowed values; 3 `attachments.profile_id` FK → `on delete cascade on update cascade`; 4 move `storage_path` into a new `attachment_blobs(attachment_id pk → attachments, storage_path, checksum)` (`--confirm-drop app.attachments.storage_path`); also add one unrelated nullable column to `attachments` in the same step (e.g. `archived_at`) so D32 rule A's same-table drop + add pair engages the `--confirm-drop` path — see D48, and the postgres example's `tasks.closed_at` (Task 15).
- [ ] **Step 2:** Generate the chain through the built CLI exactly as Task 16 (the bucket upsert appears in `0001`; its `alter` appears if a step changes the mime list — make step 2 also widen the bucket's `allowedMimeTypes` so the row-data alter path is exercised).
- [ ] **Step 3:** `roundtrip.rows.sql`:
```sql
select id, name, public, file_size_limit, array_to_string(allowed_mime_types, ',') from storage.buckets order by id;
```
- [ ] **Step 4:** Tests pass (`pnpm --filter example-supabase test`); commit `feat(examples): supabase showcase with config presets and migration chain`.

## Task 25: Seed SQL + round-trip for the supabase example

**Files:**
- Create: `examples/supabase/seed/supabase.sql` (from V3 — researcher's `phase7-plan-checks.md`; every column carries a `-- source: supabase/storage-api migrations/tenant/<file>.sql` comment)
- Modify: `examples/supabase/package.json` scripts: `"roundtrip": "sh ../../scripts/roundtrip.sh . seed/supabase.sql"`

- [ ] **Step 1:** Write `seed/supabase.sql` (V3 — re-runnable, and a no-op on a real Supabase database):
```sql
-- roundtrip seed: the Supabase-isms a generic Postgres lacks.
-- Roles: modeled on supabase/storage migrations/tenant/0002-storage-schema.sql
-- (CREATE ROLE … NOLOGIN NOINHERIT; service_role additionally BYPASSRLS).
do $$
begin
	if not exists (select 1 from pg_roles where rolname = 'anon') then
		create role anon nologin noinherit;
	end if;
	if not exists (select 1 from pg_roles where rolname = 'authenticated') then
		create role authenticated nologin noinherit;
	end if;
	if not exists (select 1 from pg_roles where rolname = 'service_role') then
		create role service_role nologin noinherit bypassrls;
	end if;
end
$$;

-- storage.buckets stub: only the columns hejbro's bucket upsert touches
-- (packages/supabase/src/storage/bucket-kind.ts), with per-column sources:
create schema if not exists storage;          -- 0002-storage-schema.sql

create table if not exists storage.buckets (
	id text not null primary key,               -- 0002-storage-schema.sql (PK — target of the upsert's on conflict ("id"))
	name text not null,                         -- 0002-storage-schema.sql
	public boolean default false,               -- 0008-add-public-to-buckets.sql
	file_size_limit bigint,                     -- 0013 (max_file_size_kb int) → 0014-use-bytes-for-max-size.sql (rename + bigint)
	allowed_mime_types text[]                   -- 0013-add-bucket-custom-limits.sql
);
create unique index if not exists bname
	on storage.buckets (name);                  -- 0002-storage-schema.sql

-- auth.users stub: only the column `authUsers` (D41) references as an FK target.
create schema if not exists auth;
create table if not exists auth.users (id uuid not null primary key);
```
- [ ] **Step 2:** `pnpm build && pnpm --filter example-supabase roundtrip` → `round-trip OK` and the bucket row printed identically for both databases. Paste output into the PR body.
- [ ] **Step 3:** Commit `feat(examples): supabase seed and round-trip`.

## Task 26: PR D close-out

- [ ] **Step 1:** Update `examples/README.md`'s supabase row (drop "lands in PR D"); grep the repo for the reduced example's earlier project-specific name in package names/paths (`pnpm-lock.yaml` regenerates on install) — the naming sweep in prose files is Task 32, but **paths and package names** must be gone here.
- [ ] **Step 2:** Clean-state gates; open PR D (`Closes #107`) with both round-trip outputs.

## Task 27: Skill source location (V2) + `SKILL.md` + references

**Files:**
- Create: `skills/hejbro/SKILL.md` (repo root — V2: the skills CLI scans `skills/` to depth 3 and does not recurse into `packages/`), plus `skills/hejbro/references/dsl-cheatsheet.md`, `references/function-builder-pitfalls.md`, `references/generate-verify-workflow.md`, `references/supabase-preset.md`
- Modify: `packages/skills/README.md` (source of truth = `/skills/hejbro`; this package bundles it on npm in Phase 8)

- [ ] **Step 1:** Create `skills/hejbro/` at the repo root (V2 resolved: only root-level containers are discovered). Rewrite `packages/skills/README.md` to say the skill source lives in `/skills/hejbro` and that this package will bundle those files on npm in Phase 8 (D54). Frontmatter `version` is display-only — `npx skills check/update` compares the folder's tree SHA, so bump `version` only on meaningful content changes.
- [ ] **Step 2:** `SKILL.md` frontmatter (O6):
```yaml
---
name: hejbro
description: Use when declaring or changing a Postgres schema with hejbro (tables, RLS, functions/triggers, grants, views), generating or verifying migrations, or when a function body needs control flow — real JS if/for is forbidden inside bodies; use ctx.if()/ctx.forEach().
version: 0.1.0
license: MIT
---
```
Body ≤ 40 lines: the five always-true rules (declare, never hand-edit migrations/snapshot; `ctx.if`/`ctx.forEach` not JS control flow; read the banner before merging; `--rename`/`--confirm-drop` are explicit; presets go in `hejbro.config.ts`), then a references table (file → when to read it).
- [ ] **Step 3:** Each reference: ≤ 120 lines, **links** to concrete files (`examples/postgres/src/app.schema.ts`, `examples/postgres/migrations/0004_*.sql`, `examples/supabase/hejbro.config.ts`, `packages/supabase/README.md`) instead of copied code; at most one 5-line inline snippet per page.
- [ ] **Step 4:** Commit `feat(skills): hejbro agent skill and references`.

## Task 28: Path-existence test

**Files:**
- Create: `packages/skills/test/links.test.ts`, `packages/skills/vitest.config.ts`, `packages/skills/package.json` scripts `test: vitest run` + devDependency `vitest: catalog:`, `packages/skills/turbo.json` (`test.dependsOn: []`)

- [ ] **Step 1:**
```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SKILL_DIR = join(REPO_ROOT, "skills", "hejbro");
const files = ["SKILL.md", ...readdirSync(join(SKILL_DIR, "references")).map((f) => join("references", f))];
const repoLinks = (text: string): ReadonlyArray<string> =>
	[...text.matchAll(/\]\((?:\.\.\/)*((?:examples|packages|docs)\/[^)#]+)/g)].map((m) => m[1] as string);

describe("hejbro skill links", () => {
	files.map((file) =>
		it(`${file} links only to files that exist`, () => {
			const missing = repoLinks(readFileSync(join(SKILL_DIR, file), "utf8")).filter((p) => !existsSync(join(REPO_ROOT, p)));
			expect(missing).toEqual([]);
		}),
	);
});
```
- [ ] **Step 2:** Run → PASS (fix any dead link). Commit `test(skills): referenced paths exist`.

## Task 29: Install smoke + PR E

- [ ] **Step 1:** In a tmp dir: `npx skills add quickstart-now/hejbro@hejbro --dry-run` (or the CLI's equivalent list command against the local branch if it supports a path) — record the exact command and output in the PR body; if the CLI can only install from GitHub, note that the smoke runs after merge and add a follow-up checkbox to #108.
- [ ] **Step 2:** Clean-state gates; open PR E (`Closes #108`).

## Task 30: README landing page (D56, O4)

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Rewrite in this order, each section ≤ 25 lines: title + one-line definition (§1) → pitch (§11, verbatim) → "60 seconds" (a `hejbro.config.ts` + an `app` schema with one table, one RLS policy, one `defineFunction` using `ctx.if`; the `hejbro generate` command; a 10-line SQL excerpt including the banner) → "How it works" (declarations → snapshot → diff → migration; `hejbro verify` and the hash chain, D33) → "Packages" table (existing four rows) + "Examples" (two links + `pnpm --filter example-postgres roundtrip`) → "For agents" (`npx skills add quickstart-now/hejbro`) → "Built AI-natively" (existing text) → "Status" (pre-alpha, not on npm; links to spec/roadmap) → "License". Precedent honesty as one prose sentence in "How it works". **No comparison table.**
- [ ] **Step 2:** Commit `docs: readme landing page`.

## Task 31: `docs/guide/` (O5)

**Files:**
- Create: `docs/guide/getting-started.md` (#83), `docs/guide/renames.md` (#84), `docs/guide/ci.md` (#85)

- [ ] **Step 1:** Outlines for O5 approval (in the PR description): getting-started = install (workspace for now) → `hejbro init` → first declaration → `generate` → read the banner → `verify`; renames = rule A, flag grammar, worked ambiguous-column example (copy the exact diagnostic from `examples/cli-smoke`'s e2e), expand–contract walkthrough; ci = `hejbro verify` GitHub Actions job YAML (checkout, pnpm, `pnpm hejbro verify`), exit codes, and "the local round-trip (`scripts/roundtrip.sh`) is the deeper check".
- [ ] **Step 2:** Write the pages; every CLI output quoted must come from running the CLI (paste real output). Link them from the README "How it works". Commit `docs(guide): getting started, renames, ci`.

## Task 32: Naming sweep (D53/D56) + PR F

**Files:**
- Rename (F2, #118, mechanical half): the two golden case directories carrying the earlier project-specific name → `app-posts`, `app-security` (update their `declarations.ts` schema name to `app` and regenerate those two cases' `expected/`)
- Modify (F, this task): `packages/core/test/golden/cases/comments-single-depth/*` comments, `docs/plans/2026-08-19-roadmap.md` (Phase 1–6 history lines), `docs/specs/2026-08-19-hejbro-design.md` (D21, D28, D44 prose), `examples/README.md`, `packages/supabase/README.md`, any `*.test.ts` describe strings

- [ ] **Step 1:** Grep the repo (case-insensitive, excluding `node_modules`/`dist`/`pnpm-lock.yaml`) for the earlier project's name in its three written forms → rewrite each hit as neutral prose ("an earlier project-specific example", or simply the `app` schema). Decision-log rows keep their decision content but lose the name.
- [ ] **Step 2:** The same grep returns zero hits for this PR's scope (F2 owns the mechanical test/golden half separately, #118) (add this grep as a step in the PR body). Clean-state gates.
- [ ] **Step 3:** Commit `docs: replace project-specific example naming with the generic examples`; open PR F (`Closes #109, #83, #84, #85`).

## Task 33: `not-null-without-default` warning (#27)

**Files:**
- Create: `packages/core/src/engine/core-validators.ts` (`notNullWithoutDefaultValidator`)
- Modify: `packages/core/src/index.ts`, `packages/cli/src/commands/generate.ts` (prepend core validators to preset validators)
- Test: `packages/core/test/core-validators.test.ts`, `packages/cli/test/generate-command.test.ts`

- [x] **Step 1: Failing test** — a table diff that **adds** a `not null` column without a default to an existing table yields one warning `not-null-without-default` with message `column "app"."posts"."status" is added as not null without a default — this migration will fail if the table already has rows. Next: add .default(...), or add the column nullable now and set it not null in a later migration.`; a new table (create) yields no warning; adding with a default yields none.
- [x] **Step 2: Implement** — validators receive `(snapshot, declarations)` only, not the previous snapshot, so this check needs the diff: implement it inside `generateMigration` as a built-in post-diff warning (`engine/generate.ts`, after `changes` are computed: for each table `alter` change, compare `previous`/`next` column lists) and expose it through the same `warnings` array — no validator signature change. Keep the pure function in `core-validators.ts` as `notNullWithoutDefaultWarnings(changes: ReadonlyArray<KindChange>): ReadonlyArray<Diagnostic>` and call it from `generateMigration`.
- [x] **Step 3:** CLI renders it like any warning (Task 22). Golden text = O2. PASS; commit `feat(core): warn when adding a not-null column without a default`; open PR G (`Closes #27`).

## Task 34: CLI e2e flake — instrument, then remove the shared jiti cache (#102)

**Files:**
- Modify: `packages/cli/test/support/cli-runner.ts`, `examples/cli-smoke/test/e2e.test.ts`, `packages/cli/src/loader.ts`

- [x] **Step 1 (instrument):** in `cli-runner.ts` add
```ts
import { existsSync } from "node:fs";
export const assertBuiltCli = (): void => {
	const missing = [CLI_PATH, join(CLI_PACKAGE_ROOT, "dist", "index.js")].filter((p) => !existsSync(p));
	if (missing.length > 0) {
		throw new Error(`built CLI artifacts missing: ${missing.join(", ")} — run pnpm build (turbo should have built hejbro before its tests; if you see this under turbo, capture the turbo log for #102)`);
	}
};
```
and call it from a `beforeAll` in every spawning test file (`generate-command`, `golden`, `help`, `verify`, `cli-smoke`). In `runCli`, when `exitCode !== 0`, append `stderr` to the resolved object **and** log `[cli-runner] exit ${exitCode}\n${stderr}` so a flaky failure leaves the full child output in the vitest report.
- [x] **Step 2 (suspect #1):** `createJiti(configPath, { fsCache: false })` in both `loadConfig` and `loadDeclarations` (`loader.ts:44,136`) — the CLI loads a handful of files per run; the on-disk transpile cache buys nothing and is shared across parallel test workers. Add a comment citing #102.
- [x] **Step 3 (stress):** `for i in $(seq 1 30); do rm -rf packages/*/dist && npx turbo run test --force >/tmp/flake-$i.log 2>&1 || echo "run $i failed"; done` — record pass count in the PR body. If any run fails, the instrumented output identifies the layer; fix accordingly (next suspect: `fileParallelism: false` for the spawning files only). **Result: 30/30 green in isolation; the one reproduction during this phase's investigation was shared-worktree interference (another agent's clean gate running `rm -rf packages/*/dist` in the same worktree mid-run), proven by the new instrumentation — not a hejbro bug.**
- [x] **Step 4:** Commits (3, per the PR H kickoff brief, not the single commit originally sketched here): `test(cli): assert the built cli exists and keep child stderr`, `fix(cli): disable jiti fs cache`, `chore(examples): type-check cli-smoke`; open PR H (`Closes #102`).

---

## Self-review notes (kept for executors)

- **Spec coverage:** D50 → Tasks 5–7, 9; D51 → Tasks 3, 8, 10–13; D52 → Task 4; D48/D49 → Tasks 16–18, 25; D53 → Tasks 14–19, 24–26, 32; D54 → Tasks 27–29; D55 → Tasks 20–23 (+ Task 24 uses it); D56 → Tasks 30–32; #27 → Task 33; #102 → Task 34; D47's "#88 if free" → Task 10 step 1 last test.
- **Type consistency:** `IndexDeclaration.predicate` (declaration) vs `IndexSnapshot.where` (snapshot string) is deliberate — the builder method is named `where`, so the data field on the declaration cannot be. `ForeignKeyDeclaration.references` is `ForeignKeyReferenceTarget` from Task 4 onward; `ForeignKeySnapshot.referencesTable` stays a string identity. `CheckDeclaration.checkName` (declaration) / `CheckSnapshot.name` (snapshot) follow the index naming precedent (`indexName` / `name`).
- **Known follow-up (filed as #110, Phase 8):** `rename-plan.ts` does not re-target rendered expression text (policy `using`/`withCheck`, CHECK `expression`, index `where`), so the generate after a `--rename` emits one valid-but-unnecessary drop + add for each affected object. Documented behavior in Phase 7; not a blocker.
- **Ordering hazards:** Task 11 bumps the version; Task 13 is the only regeneration. Tasks 3–8 must leave every `expected/snapshot.json` untouched — run the golden suite after each and stop if it changes.
- **Round-trip script assumptions:** the fresh-generate copy symlinks the example's own `node_modules/hejbro` (pnpm workspace link) so `import … from "hejbro"` resolves; `init` must tolerate an existing `hejbro.config.ts` (it does — see `commands/init.ts`); the `--schema=app` filter means objects outside `app` (roles, the seed) are not compared — intended.
- **Verified at plan time (researcher R4, `phase7-plan-checks.md`):** all type/function names used in the tasks exist with the stated shapes; `kinds/table-kind.ts` → `dsl/table.ts` is a type-only import, so Task 8's `derive*Name` import into `dsl/table.ts` creates no runtime cycle; pg_dump's `\restrict`/`\unrestrict` markers exist from PG 17.6 (2025-08-14), which `postgres:17-alpine` carries; zod v4 accepts `z.array(z.unknown()).default([])` and its output assigns to `ReadonlyArray`. Remaining project-specific-name strings in this plan name paths that Tasks 24 and 32 delete — not new naming.
- **Verified at plan time (planner):** Task 17's `ConfirmDropSpec`/`ChainEntry`/`ChainReport` shapes, `hejbro`'s `export * from "@hejbro/core"`, `assertSqlName` returning the validated name, `isExpr`/`collectColumnRefs` exports, `hejbro init` idempotence (existing artifacts skipped), `packages/core/test/dsl/` existing. The worktree needs `pnpm install` before Task 14 (no `node_modules` yet — the round-trip script relies on the workspace symlink `examples/<x>/node_modules/hejbro`).
- Phase 7 closed 2026-08-21.
