# Phase 4 — RLS, Views, and Grants Kinds: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `rls`/`policy`, `view`, and `grant` object kinds with their
declaration DSL (`rls.enabled`/`rls.policy`, `defineView`, `grant`), so the
full dd.land `sql/grants.ts` corpus and its legacy RLS policies are
expressible declaratively and diff into deterministic migration SQL.

**Architecture:** Three new DSL surfaces feed four new object kinds through
the existing `ObjectKind` 4-stage contract (`serialize`/`identify`/`diff`/
`emit`). RLS attaches to `table()` via a new `TableExtras.rls` field and is
expanded into standalone `rls` + `policy` declarations in
`resolveDeclarations` (the `defineTrigger` expansion precedent); views and
grants are standalone declarations (`grant`'s multi-role `to()` fans out via
a `grant-set` expansion). The table kind's snapshot shape is untouched and
the snapshot version stays 2 (D25). Every same-identity recreate is a
**single** `alter` `KindChange` whose emit orders drop before create (D23,
bug #55).

**Tech Stack:** TypeScript strict (no `any`/`let`/`for`/`while`/ternary),
vitest, Biome, pnpm + turbo. Pure core: no fs, no DB, no new runtime deps.

**Spec:** `docs/specs/2026-08-19-hejbro-design.md` — §5.1, §5.4, §6.5, and
decisions D15–D28 (D25–D28 are this phase's brainstorm outcomes, already
recorded). Roadmap: `docs/plans/2026-08-19-roadmap.md` §Phase 4.

## Global Constraints

- Core purity: `@hejbro/core` never reads files or opens connections.
- TS style: no `any`, no `let`/`var`, no `for`/`while`, no ternary
  (owner's `typescript-rules`); Biome tabs + double quotes.
- All GitHub-facing text in English; conventional commits ≤72-char subject.
- Every error message states **why it failed AND what to do** (spec §7) and
  carries `declaredAt` where a declaration site exists.
- Snapshot version stays `2` — do not touch `HEJBRO_SNAPSHOT_VERSION`.
- Recreate pairs: one `KindChange`, emit drop-then-create (D23/#55).
- Before claiming any PR done: `pnpm check`, `pnpm check-types`,
  `pnpm test` all pass with output shown.

## PR map (each PR is a sub-issue of #5, squash-merged to `dev`)

| PR | Issue | Tasks | Branch |
|----|-------|-------|--------|
| A — rls/policy kinds + DSL | #62 | 1–6 | `phase4-rls-policy-kinds` |
| B — view kind + defineView | #63 | 7–9 | `phase4-view-kind` |
| C — grant kind + grant DSL | #64 | 10–12 | `phase4-grant-kind` |
| D — acceptance golden + close-out | #65 | 13 | `phase4-acceptance` |

PR bodies list the squashed commits and reference `Closes #N`. After each
squash merge: `issue.sh close N --comment "Merged in PR #M."`, then rebase
the next branch on `upstream/dev`.

---

## Task 1: Commit the phase docs (PR-A opening commit)

**Files:**
- Already edited: `docs/specs/2026-08-19-hejbro-design.md` (D25–D28 rows)
- Already written: `docs/plans/2026-08-19-phase4-implementation.md` (this file)

- [ ] **Step 1: Commit**

```bash
git add docs/specs/2026-08-19-hejbro-design.md docs/plans/2026-08-19-phase4-implementation.md
git commit -m "docs(spec): record phase 4 brainstorm decisions d25-d28"
```

---

## Task 2: Policy builder chain (`rls.policy`) and `rls.enabled`

**Files:**
- Create: `packages/core/src/dsl/rls.ts`
- Test: `packages/core/test/dsl/rls.test.ts`

**Interfaces:**
- Consumes: `Expr<"boolean">` (`../expr/ast`), `ExprNode`,
  `captureDeclarationSite` (`../declaration-site`), `throwHejbroError`
  (`../error`).
- Produces (used by Tasks 3–5):

```ts
export type PolicyCommand = "select" | "insert" | "update" | "delete" | "all";

/**
 * A finished, not-yet-table-bound policy (chain output). Clause data
 * fields are named `usingExpr`/`withCheckExpr` — not `using`/`withCheck`
 * — so they can never collide with the `PolicyBothStage` chain methods of
 * the same name that get `Object.assign`-ed onto a just-built object
 * (PR #70 review: the original `using`/`withCheck` names collided with
 * those methods, so ending an update/all chain after one clause silently
 * overwrote the other clause's `null` with a function).
 */
export type PolicyInput = {
	readonly policyInputKind: "policy";
	readonly policyName: string;
	readonly permissive: boolean;
	readonly command: PolicyCommand;
	readonly roles: ReadonlyArray<string>;
	readonly usingExpr: ExprNode | null;
	readonly withCheckExpr: ExprNode | null;
	readonly declaredAt: string | null;
};

/** `rls.enabled(...)` output, not yet bound to a table. */
export type RlsInput = {
	readonly rlsInputKind: "rls";
	readonly force: boolean;
	readonly policies: Readonly<Record<string, PolicyInput>>;
	readonly declaredAt: string | null;
};

export const rls: {
	enabled(
		policies: Readonly<Record<string, PolicyInput>>,
		options?: { readonly force?: boolean },
	): RlsInput;
	policy(policyName: string): PolicyPending;
};
```

Type-state chain (D26). Illegal clause combinations must not exist on the
returned types:

```ts
type PolicyUsingStage = {
	using(condition: Expr<"boolean">): PolicyInput;
};
type PolicyCheckStage = {
	withCheck(condition: Expr<"boolean">): PolicyInput;
};
type PolicyBothStage = {
	using(condition: Expr<"boolean">): PolicyInput & PolicyCheckStage;
	withCheck(condition: Expr<"boolean">): PolicyInput & PolicyUsingStage;
};
type PolicyRolesStage<TStage> = {
	to(...roles: ReadonlyArray<string>): TStage;
};
type PolicyPending = {
	as(kind: "permissive" | "restrictive"): PolicyPending;
	for(command: "select" | "delete"): PolicyRolesStage<PolicyUsingStage>;
	for(command: "insert"): PolicyRolesStage<PolicyCheckStage>;
	for(command: "update" | "all"): PolicyRolesStage<PolicyBothStage>;
};
```

Implementation notes:
- `for` is declared with the three overload signatures above on the
  `PolicyPending` type; the single implementation takes `PolicyCommand` and
  branches internally (`if`/`else if` returning the right stage object).
- `rls.policy(name)` captures `captureDeclarationSite()` once and threads
  it through every stage into the final `PolicyInput` and every error.
- `.to()` with zero roles throws `rls-policy-missing-roles`:
  `policy "<name>" calls .to() with no roles — Postgres requires at least
  one role after TO; pass .to("anon") or the specific roles this policy
  applies to.`
- For update/all, the object returned by `.to()` is **not** a `PolicyInput`
  (no `policyInputKind`), so a chain that never calls `.using()`/
  `.withCheck()` fails to type-check inside `rls.enabled({...})`. After the
  first clause call the result **is** a `PolicyInput` and also offers the
  other clause; calling it returns a new `PolicyInput` (objects stay
  immutable — each step builds a fresh object, never mutates).
- `rls.enabled` captures its own `captureDeclarationSite()` and defaults
  `force` to `false`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/dsl/rls.test.ts
import { describe, expect, it } from "vitest";
import { eq, isNotNull } from "../../src/expr/operators";
import { rls } from "../../src/dsl/rls";
import { schema } from "../../src/dsl/schema";
import { table } from "../../src/dsl/table";
import { text, timestamptz, uuid } from "../../src/types/column-builder-factories";

const ddland = schema("ddland");
const posts = table(ddland, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});

describe("rls.policy chain", () => {
	it("builds a select policy with using", () => {
		const built = rls
			.policy("posts_read_published")
			.for("select")
			.to("anon")
			.using(isNotNull(posts.publishedAt));
		expect(built.policyInputKind).toBe("policy");
		expect(built.policyName).toBe("posts_read_published");
		expect(built.permissive).toBe(true);
		expect(built.command).toBe("select");
		expect(built.roles).toEqual(["anon"]);
		expect(built.using).not.toBeNull();
		expect(built.withCheck).toBeNull();
	});

	it("builds a restrictive insert policy with withCheck", () => {
		const built = rls
			.policy("insert_gate")
			.as("restrictive")
			.for("insert")
			.to("authenticated")
			.withCheck(eq(posts.status, "draft"));
		expect(built.permissive).toBe(false);
		expect(built.command).toBe("insert");
		expect(built.using).toBeNull();
		expect(built.withCheck).not.toBeNull();
	});

	it("builds an update policy with both clauses in either order", () => {
		const one = rls
			.policy("update_own")
			.for("update")
			.to("authenticated")
			.using(eq(posts.status, "draft"))
			.withCheck(eq(posts.status, "draft"));
		expect(one.using).not.toBeNull();
		expect(one.withCheck).not.toBeNull();
	});

	it("rejects .to() with no roles", () => {
		expect(() => rls.policy("p").for("select").to()).toThrowError(
			expect.objectContaining({ code: "rls-policy-missing-roles" }),
		);
	});

	it("select policies do not expose withCheck (type-level)", () => {
		const stage = rls.policy("p").for("select").to("anon");
		// @ts-expect-error select policies cannot take a with-check clause
		const bad = () => stage.withCheck;
		expect(bad).toBeDefined();
		const insertStage = rls.policy("p").for("insert").to("anon");
		// @ts-expect-error insert policies cannot take a using clause
		const alsoBad = () => insertStage.using;
		expect(alsoBad).toBeDefined();
	});
});

describe("rls.enabled", () => {
	it("wraps policies with force defaulting to false", () => {
		const input = rls.enabled({
			read: rls
				.policy("posts_read_published")
				.for("select")
				.to("anon")
				.using(isNotNull(posts.publishedAt)),
		});
		expect(input.rlsInputKind).toBe("rls");
		expect(input.force).toBe(false);
		expect(Object.keys(input.policies)).toEqual(["read"]);
	});

	it("accepts force: true", () => {
		expect(rls.enabled({}, { force: true }).force).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @hejbro/core exec vitest run test/dsl/rls.test.ts`
Expected: FAIL — `Cannot find module '../../src/dsl/rls'`.

- [ ] **Step 3: Implement `packages/core/src/dsl/rls.ts`** per the interface
  block above. Runtime clause methods exist only on the stage objects that
  declare them (build three distinct stage factories — do not put all
  methods on one object).

- [ ] **Step 4: Run test to verify it passes**, then `pnpm check-types`
  (validates the `@ts-expect-error` assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/dsl/rls.ts packages/core/test/dsl/rls.test.ts
git commit -m "feat(core): rls policy builder chain and rls.enabled"
```

---

## Task 3: Bind RLS to tables (`TableExtras.rls`) and expand declarations

**Files:**
- Modify: `packages/core/src/dsl/rls.ts` (add bound declaration types +
  binder), `packages/core/src/dsl/table.ts`,
  `packages/core/src/engine/generate.ts`
- Test: `packages/core/test/dsl/rls-binding.test.ts`

**Interfaces:**
- Produces (used by Tasks 4–5):

```ts
// in dsl/rls.ts
export type PolicyDeclaration = {
	readonly declarationKind: "policy";
	readonly schemaName: string;
	readonly tableName: string;
	readonly policyName: string;
	readonly permissive: boolean;
	readonly command: PolicyCommand;
	readonly roles: ReadonlyArray<string>;
	readonly using: ExprNode | null;
	readonly withCheck: ExprNode | null;
	readonly declaredAt: string | null;
};
export type RlsDeclaration = {
	readonly declarationKind: "rls";
	readonly schemaName: string;
	readonly tableName: string;
	readonly force: boolean;
	readonly policies: ReadonlyArray<PolicyDeclaration>;
	readonly declaredAt: string | null;
};
/** Binds an RlsInput to its owning table; validates policies. */
export const bindRls = (
	schemaName: string,
	tableName: string,
	input: RlsInput,
): RlsDeclaration;
```

- `TableExtras` gains `readonly rls?: RlsInput;`; `TableDeclaration` gains
  `readonly rls: RlsDeclaration | null;` (`table()` passes
  `resolvedExtras.rls === undefined ? null : bindRls(owner.schemaName,
  tableName, resolvedExtras.rls)` — use an `if` helper, not a ternary; no
  `knownColumnNames` parameter — policy expressions are always built from
  this table's own typed `ColumnRef`s, so there is nothing to check
  against a column-name set). **`tableKind.serialize` must not change** —
  the snapshot
  shape stays identical (D25); add a test asserting a table with RLS
  serializes byte-identically to the same table without.
- `resolveDeclarations` (generate.ts) table branch becomes:

```ts
if (isTable(input)) {
	const meta = getTableMeta(input);
	if (meta.rls === null) {
		return [meta];
	}
	return [meta, meta.rls, ...meta.rls.policies];
}
```

`bindRls` validations (all carry the policy's `declaredAt`):
1. `duplicate-policy-name` — two `PolicyInput`s under different labels share
   one `policyName`: `table "<table>" declares two policies named "<name>"
   — Postgres requires unique policy names per table; rename one (the TS
   object key is just a label, the string passed to rls.policy() is the
   SQL name).`
2. `rls-policy-clause-not-allowed` — defensive runtime guard (types already
   prevent it): select/delete with a non-null `withCheck`, or insert with a
   non-null `using`: `policy "<name>" is FOR <command> and cannot take
   <clause> — Postgres rejects it; use <other clause> instead.`
3. `rls-policy-foreign-column` — a **top-level** column ref in `using`/
   `withCheck` that does not belong to the policed table. Use
   `collectColumnRefs` (`../expr/render-sql`) — it deliberately does not
   descend into `exists` subqueries (those self-validate at render with
   `outerScope`): `policy "<name>" on "<schema>.<table>" references column
   "<s>.<t>.<c>" — a policy expression may only reference its own table's
   columns directly; reach other tables through exists().`

- [ ] **Step 1: Write the failing test** — cover: a table with
  `extras.rls` carries a bound `RlsDeclaration` (schema/table stamped onto
  every policy); `resolveDeclarations` expansion via `generateMigration`
  snapshot keys (`rls:ddland.posts`, `policy:ddland.posts.<name>` present
  after Task 5 — for now assert `getTableMeta(posts).rls` shape); the three
  error codes above; and the serialize-unchanged guarantee:

```ts
import { tableKind } from "../../src/kinds/table-kind";
import { stableJson } from "../../src/snapshot/stable-json";
// …declare `bare` (no extras) and `secured` (same columns, rls extras)…
expect(stableJson(tableKind.serialize(getTableMeta(secured)))).toBe(
	stableJson(tableKind.serialize(getTableMeta(bare))),
);
```

For the foreign-column test, declare a second table `comments` and use
`eq(comments.postId, …)` inside a policy on `posts` (top level, not inside
`exists`) — expect `rls-policy-foreign-column`. Also assert the **legal**
correlated form passes: `exists(select(comments).where(eq(comments.postId,
posts.id)))` in a policy on `posts`.

- [ ] **Step 2: Run to verify it fails** (missing `bindRls`, missing
  `TableExtras.rls`).

- [ ] **Step 3: Implement** `bindRls`, the `table.ts` wiring, and the
  `generate.ts` expansion.

- [ ] **Step 4: Run tests + `pnpm check-types`.** The rls-binding test and
  all existing table tests must pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/dsl/rls.ts packages/core/src/dsl/table.ts packages/core/src/engine/generate.ts packages/core/test/dsl/rls-binding.test.ts
git commit -m "feat(core): bind rls declarations to tables and expand in generate"
```

---

## Task 4: `rls` object kind (enable/force/disable)

**Files:**
- Create: `packages/core/src/kinds/rls-kind.ts`
- Modify: `packages/core/src/kind/registry.ts` (register in
  `createDefaultRegistry`)
- Test: `packages/core/test/rls-kind.test.ts`

**Interfaces:**
- Produces:

```ts
export type RlsSnapshot = {
	readonly schema: string;
	readonly table: string;
	readonly force: boolean;
};
export const rlsKind: ObjectKind<RlsDeclaration>; // kind "rls", dependsOn ["table"]
```

Behavior (identity `` `${schema}.${table}` ``):
- `serialize` → `{ schema, table, force }` (policies are separate
  declarations — not serialized here).
- `diff`: create / drop as usual; `force` flip → single `alter` with note
  `"force row level security"` or `"no force row level security"`.
- `emit` (use `qualifyName` from `../sql/identifier`):
  - create → `alter table "s"."t" enable row level security;` plus, when
    `force` is true, a second statement
    `alter table "s"."t" force row level security;`
  - alter → only the force statement (`force` / `no force` per `next`).
  - drop → `alter table "s"."t" disable row level security;` (drops order
    before the table's own drop — reverse topological order — so the
    statement is always valid).

- [ ] **Step 1: Write the failing test** — serialize shape; identify;
  diff create/drop/no-change/force-flip (assert single `alter`, note text);
  emit for all four paths asserting exact SQL strings above; registration
  (`createDefaultRegistry().get("rls")` does not throw).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** following `trigger-kind.ts`'s structure
  (`asRlsSnapshot` cast with the invariant comment, `sameJson` from
  `../kind/diff-helpers`, `statement` from `../sql/statement`,
  `throwHejbroError("invalid-kind-change", …)` on missing snapshots,
  `assertNever` default).

- [ ] **Step 4: Run tests.**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/kinds/rls-kind.ts packages/core/src/kind/registry.ts packages/core/test/rls-kind.test.ts
git commit -m "feat(core): rls object kind with enable, force, and disable emission"
```

---

## Task 5: `policy` object kind (drop+create recreate)

**Files:**
- Create: `packages/core/src/kinds/policy-kind.ts`
- Modify: `packages/core/src/kind/registry.ts`,
  `packages/core/src/sql/identifier.ts` (add `renderRoleName`)
- Test: `packages/core/test/policy-kind.test.ts`

**Interfaces:**
- Produces:

```ts
// sql/identifier.ts — shared with Task 11
/** Quotes a role name, except the PUBLIC pseudo-role which must stay a bare keyword. */
export const renderRoleName = (role: string): string;
// role === "public" ? bare `public` : quoteIdentifier(role) — via if/return

export type PolicySnapshot = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly permissive: boolean;
	readonly command: PolicyCommand;
	readonly roles: ReadonlyArray<string>;
	readonly using: string | null;     // rendered SQL (D16 precedent)
	readonly withCheck: string | null; // rendered SQL
};
export const policyKind: ObjectKind<PolicyDeclaration>; // kind "policy", dependsOn ["rls", "table"]
```

Behavior (identity `` `${schema}.${table}.${name}` ``):
- `serialize` renders expressions with the policed table as outer scope:
  `renderExpr(declaration.using, [{ schemaName, tableName }])` — this is
  what lets `exists (select 1 from comments where comments.post_id =
  posts.id)` correlate (render-sql.ts documents exactly this RLS case).
- `diff`: any field difference → single `alter`, note
  `"policy changed; recreating"` (D23/#55 — never two changes).
- `emit`:
  - create and alter both render, from `change.next`:
    `drop policy if exists "name" on "s"."t";` then
    `create policy "name" on "s"."t"[ as restrictive] for <command> to
    <roles> [using (<sql>)] [with check (<sql>)];` — in that clause order;
    omit ` as permissive` (Postgres default), join roles with `, ` through
    `renderRoleName`. (Idempotent recreate on first create mirrors
    `trigger-kind.ts`.)
  - drop → the `drop policy if exists` statement from `change.previous`.

- [ ] **Step 1: Write the failing test** — exact SQL assertions:

```ts
const created = policyKind.emit({
	kind: "policy", operation: "create", identity: "ddland.posts.posts_read_published",
	previous: null,
	next: {
		schema: "ddland", table: "posts", name: "posts_read_published",
		permissive: true, command: "select", roles: ["anon"],
		using: `"ddland"."posts"."published_at" is not null`, withCheck: null,
	},
	notes: [],
});
expect(created.map((s) => s.sql)).toEqual([
	`drop policy if exists "posts_read_published" on "ddland"."posts";`,
	`create policy "posts_read_published" on "ddland"."posts" for select to "anon" using ("ddland"."posts"."published_at" is not null);`,
]);
```

Also cover: restrictive + multi-role + with-check rendering
(`as restrictive`, `to "anon", "authenticated"`, `with check (…)`); the
`public` role rendering bare; serialize (correlated `exists` renders — build
a real declaration through `rls.policy(...)` + `bindRls`); diff no-change /
change→single alter / drop; and a **full-pipeline recreate-order test**
mirroring `test/recreate-order.test.ts`: two `generateMigration` runs where
step 2 changes a policy's `using`; assert the emitted SQL has exactly one
`drop policy` and it precedes its `create policy`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** `renderRoleName` + `policy-kind.ts`; register
  after `rlsKind` in `createDefaultRegistry`.

- [ ] **Step 4: Run the new tests and the full suite** (`pnpm test`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/kinds/policy-kind.ts packages/core/src/kind/registry.ts packages/core/src/sql/identifier.ts packages/core/test/policy-kind.test.ts
git commit -m "feat(core): policy object kind with single-change recreate emission"
```

---

## Task 6: Public exports + `rls-policies` golden case (closes PR-A)

**Files:**
- Modify: `packages/core/src/index.ts` (export `rls`, `PolicyInput`,
  `RlsInput`, `PolicyDeclaration`, `RlsDeclaration`, `PolicyCommand`,
  plus the kind objects and their snapshot types — `rlsKind`,
  `RlsSnapshot`, `policyKind`, `PolicySnapshot` — matching the existing
  kind-export convention (every other built-in kind and its snapshot
  type is exported); follow the file's existing grouped-export style)
- Create: `packages/core/test/golden/cases/rls-policies/{declarations.ts,steps.ts}`

Golden case shape (harness runs every directory automatically):
- `declarations.ts`: schema `ddland`; table `posts` (id uuid pk
  defaultRandom, status text notNull, publishedAt timestamptz); table
  `comments` (id uuid pk defaultRandom, postId uuid notNull, deletedAt
  timestamptz) — with an rls extras block on each. Policies: `posts` —
  `posts_read_published` for select to anon using
  `and(eq(posts.status, "published"), isNotNull(posts.publishedAt))`;
  `comments` — `comments_read_visible` for select to anon using
  `and(isNull(comments.deletedAt), exists(select(posts).where(and(eq(posts.id, comments.postId), eq(posts.status, "published")))))`.
- `steps.ts` exports three steps:
  1. from-empty: both tables as declared.
  2. step-1: same, but `posts`' policy expression changes (drop the
     `status` conjunct) **and** `posts`' rls gains `{ force: true }` —
     expect a single policy `~` recreate pair and a single rls `~` force
     statement in the SQL.
  3. step-2: `comments` loses its `rls` extras entirely — expect
     `drop policy if exists` + `alter table … disable row level security`
     (policy drop ordered before rls drop).

- [ ] **Step 1: Add exports; run `pnpm check-types`.**
- [ ] **Step 2: Write the golden case, run
  `UPDATE_GOLDEN=1 pnpm -F @hejbro/core test`, then hand-review every
  generated `expected/*.sql` and `expected/snapshot.json` against the
  intent above** (this review is the step that caught #55 — do not skip).
- [ ] **Step 3: Run `pnpm check && pnpm check-types && pnpm test`.**
- [ ] **Step 4: Commit, push, open PR**

```bash
git add packages/core/src/index.ts packages/core/test/golden/cases/rls-policies
git commit -m "feat(core): export rls dsl and add rls-policies golden case"
git push upstream phase4-rls-policy-kinds
git ls-remote --heads upstream phase4-rls-policy-kinds
gh pr create --repo quickstart-now/hejbro --base dev --head phase4-rls-policy-kinds \
  --title "feat(core): rls and policy object kinds with policy builder dsl" \
  --body "…(commit list + Closes #62)…"
```

---

## Task 7: `defineView` DSL

**Files:**
- Create: `packages/core/src/dsl/define-view.ts`
- Test: `packages/core/test/dsl/define-view.test.ts`

**Interfaces:**
- Consumes: `SelectLimited` (`../query/select` — every select chain stage
  structurally satisfies it), `SchemaDeclaration`, `SelectNode`,
  `captureDeclarationSite`.
- Produces (used by Task 8):

```ts
export type ViewDeclaration = {
	readonly declarationKind: "view";
	readonly schema: SchemaDeclaration;
	readonly viewName: string;
	readonly query: SelectNode;
	readonly securityInvoker: boolean;
	readonly declaredAt: string | null;
};
export const defineView = (
	owner: SchemaDeclaration,
	viewName: string,
	query: SelectLimited,
	options?: { readonly securityInvoker?: boolean },
): ViewDeclaration;
```

`defineView` copies `query.selectQuery` into `query` and defaults
`securityInvoker` to `false`. No other validation — the select builder
already validated itself.

- [ ] **Step 1: Failing test** — spec §5.4 example verbatim
  (`defineView(ddland, "published_posts",
  select(posts).where(isNotNull(posts.publishedAt)))`): assert
  `declarationKind`, `viewName`, `query.queryKind === "select"`,
  `securityInvoker === false`; and `{ securityInvoker: true }` passthrough.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Commit** — `feat(core): defineView declaration surface`

---

## Task 8: `view` object kind (prefix rule)

**Files:**
- Create: `packages/core/src/kinds/view-kind.ts`
- Modify: `packages/core/src/kind/registry.ts`
- Test: `packages/core/test/view-kind.test.ts`

**Interfaces:**

```ts
export type ViewSnapshot = {
	readonly schema: string;
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly selectSql: string;          // renderSelect(query) output
	readonly securityInvoker: boolean;
};
export const viewKind: ObjectKind<ViewDeclaration>; // kind "view", dependsOn ["schema", "table"]
```

Behavior (identity `` `${schema}.${name}` ``):
- `serialize`: `columns` from `query.projection` — `allColumns` →
  `columnNames`; `columns` → the aliases in order (`constantOne` is
  unreachable from `select()`; throw `invalid-view-projection` if seen).
  `selectSql = renderSelect(declaration.query)`.
- `diff` prefix rule (D27): with `previous`/`next` both present and
  different — if `previous.columns` is a prefix of `next.columns`
  (`previous.columns.every((name, i) => next.columns[i] === name)`), emit
  single `alter` note `"view changed"`; otherwise single `alter` note
  `"view columns changed; recreating"`.
- `emit`: `createOrReplaceSql(next)` =
  `create or replace view "s"."v" as <selectSql>;` — with
  ` with (security_invoker = true)` inserted before ` as` when
  `securityInvoker`. create → that statement alone. alter with prefix note
  → that statement alone. alter with recreate note →
  `drop view if exists "s"."v";` then the create statement (one change, two
  statements). drop → `drop view if exists "s"."v";`.

- [ ] **Step 1: Failing test** — serialize (both projection forms; exact
  `selectSql`); diff: no-change / body-only change → `"view changed"` /
  column append → `"view changed"` / column removal and column rename each
  → recreate note; emit for all paths with exact SQL; full-pipeline
  recreate-order check (column removal step: one `drop view`, before its
  `create or replace view`); registration.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** (same structural conventions as Task 4/5).
- [ ] **Step 4: Run full suite.**
- [ ] **Step 5: Commit** — `feat(core): view object kind with prefix-rule diff`

---

## Task 9: Exports + `view-lifecycle` golden case (closes PR-B)

**Files:**
- Modify: `packages/core/src/index.ts` (export `defineView`,
  `ViewDeclaration`, plus `viewKind` and `ViewSnapshot` matching the
  existing kind-export convention)
- Create: `packages/core/test/golden/cases/view-lifecycle/{declarations.ts,steps.ts}`

Steps: (0) schema + `posts` table + `published_posts` view
(`select(posts).where(isNotNull(posts.publishedAt))`); (1) same view with a
tightened where clause (same columns → `create or replace`, no drop);
(2) view switches to an object projection dropping a column → recreate
pair; (3) view removed → `drop view if exists`.

- [ ] Export, golden-record, **hand-review the expected SQL**, full
  gates (`pnpm check && pnpm check-types && pnpm test`), commit
  (`feat(core): export defineView and add view-lifecycle golden case`),
  push `phase4-view-kind` to upstream, verify with `git ls-remote`, open
  PR titled `feat(core): view object kind and defineView` (body: commits +
  `Closes #63`).

---

## Task 10: `grant()` DSL

**Files:**
- Create: `packages/core/src/dsl/grant.ts`
- Test: `packages/core/test/dsl/grant.test.ts`

**Interfaces:**
- Produces (used by Task 11):

```ts
export const tablePrivileges = ["select", "insert", "update", "delete"] as const;
export type TablePrivilege = (typeof tablePrivileges)[number];
export type GrantKind = "schemaUsage" | "allTablesPrivileges" | "defaultTablePrivileges";

export type GrantDeclaration = {
	readonly declarationKind: "grant";
	readonly grantKind: GrantKind;
	readonly schemaName: string;
	readonly privileges: ReadonlyArray<TablePrivilege>; // [] for schemaUsage
	readonly role: string;
	readonly declaredAt: string | null;
};
/** `to(...roles)` output — one GrantDeclaration per role (D28 fan-out). */
export type GrantSetDeclaration = {
	readonly declarationKind: "grant-set";
	readonly grants: ReadonlyArray<GrantDeclaration>;
};

type GrantRolesStage = {
	to(...roles: ReadonlyArray<string>): GrantSetDeclaration;
};
type SchemaGrantBuilder = {
	readonly usage: GrantRolesStage;
	tables(...privileges: ReadonlyArray<TablePrivilege>): GrantRolesStage;
	readonly defaultPrivileges: {
		tables(...privileges: ReadonlyArray<TablePrivilege>): GrantRolesStage;
	};
};
export const grant = (owner: SchemaDeclaration): SchemaGrantBuilder;
```

Rules:
- Privileges normalize to the canonical `tablePrivileges` order,
  deduplicated (deterministic snapshots regardless of call order).
- `.tables()` (either form) with zero privileges →
  `grant-empty-privileges`: `grant(<schema>).tables() lists no privileges —
  pass at least one of "select" | "insert" | "update" | "delete".`
- `.to()` with zero roles → `grant-missing-roles`:
  `grant(<schema>)….to() has no roles — Postgres requires at least one role
  after TO; pass .to("anon") or the intended role list.`
- `grant()` captures `captureDeclarationSite()` once; each fanned-out
  declaration carries it.
- Duplicate (schema, grantKind, role) across declarations is caught by
  `buildSnapshot`'s existing `duplicate-identity` error — no bespoke check
  (D28); add a test proving that.

- [ ] **Step 1: Failing test** — the four dd.land corpus forms (spec §5.4
  `grant(ddland).usage.to("authenticated", "anon")` verbatim among them):
  assert fan-out count, grantKind, normalized privileges, role per
  declaration; both error codes; privilege normalization
  (`tables("delete", "select", "select")` → `["select", "delete"]`).
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.**
- [ ] **Step 5: Commit** — `feat(core): grant declaration chain with per-role fan-out`

---

## Task 11: `grant` object kind (privilege-set delta)

**Files:**
- Create: `packages/core/src/kinds/grant-kind.ts`
- Modify: `packages/core/src/kind/registry.ts`,
  `packages/core/src/engine/generate.ts` (expand `grant-set`)
- Test: `packages/core/test/grant-kind.test.ts`

**Interfaces:**

```ts
export type GrantSnapshot = {
	readonly schema: string;
	readonly grantKind: GrantKind;
	readonly role: string;
	readonly privileges: ReadonlyArray<TablePrivilege>;
};
export const grantKind: ObjectKind<GrantDeclaration>; // kind "grant", dependsOn ["schema"]
```

- `resolveDeclarations` gains (before the fallback return):

```ts
if (isGrantSetDeclaration(input)) {
	return input.grants;
}
```

- Identity: `` `${schema}.${grantKind}.${role}` `` (e.g.
  `ddland.allTablesPrivileges.service_role`).
- `diff`: create / drop as usual; both present and privileges differ →
  single `alter` with notes listing the delta in canonical privilege
  order, `+` for added, `-` for removed (e.g. `["+insert", "-delete"]`).
  (`schemaUsage` never alters — its privilege list is always `[]`.)
- `emit` per grantKind (roles through `renderRoleName` from Task 5;
  `privList` = privileges joined with `", "`):
  - `schemaUsage`: create `grant usage on schema "s" to <role>;` — drop
    `revoke usage on schema "s" from <role>;`
  - `allTablesPrivileges`: create `grant <privList> on all tables in schema
    "s" to <role>;` — drop revokes the full previous list — alter emits a
    grant statement for added privileges and/or a revoke statement for
    removed ones (one or two statements in the one change).
  - `defaultTablePrivileges`: create `alter default privileges in schema
    "s" grant <privList> on tables to <role>;` — drop `alter default
    privileges in schema "s" revoke <privList> on tables from <role>;` —
    alter mirrors allTablesPrivileges with the `alter default privileges`
    wrapper.

- [ ] **Step 1: Failing test** — serialize/identify; diff no-change /
  delta notes exact / create / drop; emit exact SQL for all nine paths
  above (three grantKinds × create/alter/drop, skipping the impossible
  schemaUsage alter); `grant-set` expansion through `generateMigration`
  (snapshot keys `grant:ddland.schemaUsage.anon` etc.); duplicate identity
  through `buildSnapshot` errors `duplicate-identity`; registration.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run full suite.**
- [ ] **Step 5: Commit** — `feat(core): grant object kind with privilege-set delta diff`

---

## Task 12: Exports + `grants-delta` golden case (closes PR-C)

**Files:**
- Modify: `packages/core/src/index.ts` (export `grant`, `GrantDeclaration`,
  `GrantSetDeclaration`, `TablePrivilege`, plus `grantKind` and
  `GrantSnapshot` matching the existing kind-export convention — every
  built-in kind and its snapshot type is exported)
- Create: `packages/core/test/golden/cases/grants-delta/{declarations.ts,steps.ts}`

Steps: (0) schema + usage for anon/service_role + all-tables select for
anon + all-tables select/insert/update/delete for service_role + default
privileges select for anon; (1) anon gains insert on all tables (alter →
`grant insert …`), service_role loses delete (alter → `revoke delete …`);
(2) the anon default-privileges declaration is removed entirely (drop →
`alter default privileges … revoke …`).

- [ ] Export, golden-record, **hand-review the expected SQL**, full gates,
  commit (`feat(core): export grant dsl and add grants-delta golden
  case`), push `phase4-grant-kind`, verify, open PR
  `feat(core): grant object kind and grant dsl with default privileges`
  (body: commits + `Closes #64`).

---

## Task 13: Acceptance golden `ddland-security` + close-out (PR-D)

**Files:**
- Create: `packages/core/test/golden/cases/ddland-security/{declarations.ts,steps.ts}`
- Modify: `docs/plans/2026-08-19-roadmap.md` (Phase 4 section → landed
  prose, following the Phase 3 section's format)

`declarations.ts` header comment must cite the sources (Phase 3 precedent —
`comments-single-depth/declarations.ts:29-36`):
- Grants: 1:1 port of
  `quickstart-labs/infra/dd-land-supabase/sql/grants.ts` (quote the six
  statements in the comment). Note the one intentional divergence: hejbro
  emits one statement per role where the original groups
  `to anon, service_role` — semantically equivalent.
- RLS: ported from the **legacy** dd.land migrations (current production
  dd.land is grants-only — brainstorm note A6):
  `legacy/migrations/20260812090000_create_reading_schema.sql:74-106`
  (`posts_read_published`, `post_translations_read_published`) and
  `legacy/migrations/20260813020000_create_comments_and_reactions.sql:121-152`
  (`comments_read_visible`), plus one insert/`with check` policy shaped
  after `infra/planner-supabase/…/20260702052212_dogfood_probe_scope_gate.sql`
  (expressed with core operators only — no `auth.jwt()`, which is Phase 6
  preset territory).

Steps: (0) full corpus from empty (tables + rls + policies + views are not
required here — tables + rls + policies + grants); (1) one policy
expression change + one privilege delta (exercises both recreate-pair and
grant/revoke delta in a single migration — check the banner lists both);
(2) drop one policy + revoke one grant declaration.

- [ ] **Step 1: Write the case, record goldens, and hand-review the
  emitted SQL against the quoted originals for semantic equivalence** —
  every policy clause, every grant/revoke. This is the phase's acceptance
  gate; #55 was caught here last phase.
- [ ] **Step 2: Update the roadmap** Phase 4 section: "Landed: …" prose
  naming the kinds, decisions D25–D28, PRs and issues (#62–#65), the A6
  acceptance-source note, and the #66 Phase 6 follow-up.
- [ ] **Step 3: Full gates** (`pnpm check && pnpm check-types &&
  pnpm test`) with output shown.
- [ ] **Step 4: Commit, push `phase4-acceptance`, verify, open PR**
  `test(core): ddland-security golden acceptance case and phase 4
  close-out` (body: commits + `Closes #65`).
- [ ] **Step 5: After the squash merge of each PR** (A–D):
  `issue.sh close <62|63|64|65> --comment "Merged in PR #M."`; after PR-D,
  run `issue.sh check` over #62–#65 and close phase issue #5 the same way.

## Out of scope (do not build)

- Function-level `grant execute` (spec §5.2's `grants:` option on
  `defineFunction`) — not in the Phase 4 roadmap scope; the dd.land corpus
  has no function grants.
- `alter policy` emission — recreate-only by design (spec §6.5).
- Typed roles, `auth.uid()`/`auth.jwt()` helpers, RLS-related warnings —
  Phase 6 preset work (#66).
- Per-table (non-`all tables`) grants and sequence/function default
  privileges — not in the corpus; defer until a real declaration needs
  them.
