import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExprNode, ProjectionNode } from "../src/expr/ast";
import {
	NODE_KIND_TO_SNAPSHOT,
	PROJECTION_KIND_TO_SNAPSHOT,
} from "../src/expr/codec";
import {
	and,
	between,
	buildSnapshot,
	check,
	createDefaultRegistry,
	defineTrigger,
	emptySnapshot,
	eq,
	exists,
	generateMigration,
	getTableMeta,
	grant,
	gt,
	inArray,
	index,
	integer,
	isNotNull,
	isNull,
	migrationPrefixStrategies,
	not,
	rls,
	roleName,
	schema,
	select,
	sql,
	table,
	timestamptz,
	uuid,
} from "../src/index";
import type { JsonValue } from "../src/snapshot/stable-json";

// D57 (#128): output tokens hejbro authors itself must be kebab-case
// (snapshot values, identity segments, kind ids, diagnostic codes, config
// values, golden directory names) — never camelCase. This scans *output*
// produced through the public API, not source text, so it can't be
// satisfied by renaming a variable without changing what actually ships.
//
// Explicit exception (not checked here): user-supplied SQL identifiers —
// table/column/role names — stay snake_case (D36, assertSqlName's own
// realm). This file only ever inspects hejbro's own closed-vocabulary
// tokens, never a value the user typed, so that exception needs no special
// case — it's satisfied by what this file simply never looks at.

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const GOLDEN_CASES_DIR = join(
	REPO_ROOT,
	"packages",
	"core",
	"test",
	"golden",
	"cases",
);

const app = schema("app");
const registry = createDefaultRegistry();

describe("D57 naming convention: output tokens are kebab-case", () => {
	it("kind ids (the object-kind registry) are all kebab-case", () => {
		const kindIds = registry.list().map((kind) => kind.kind);
		expect(kindIds.length).toBeGreaterThan(0);
		const offenders = kindIds.filter((id) => !KEBAB_CASE.test(id));
		expect(offenders).toEqual([]);
	});

	it("migration prefix strategy values are all kebab-case", () => {
		expect(migrationPrefixStrategies.length).toBeGreaterThan(0);
		const offenders = migrationPrefixStrategies.filter(
			(value) => !KEBAB_CASE.test(value),
		);
		expect(offenders).toEqual([]);
	});

	it("golden case directory names are all kebab-case", () => {
		const entries = readdirSync(GOLDEN_CASES_DIR, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
		expect(entries.length).toBeGreaterThan(0);
		const offenders = entries.filter((name) => !KEBAB_CASE.test(name));
		expect(offenders).toEqual([]);
	});

	it("the snapshot's own format-version field is `formatVersion`, not `hejbroSnapshot`", () => {
		expect(Object.hasOwn(emptySnapshot, "formatVersion")).toBe(true);
		expect(Object.hasOwn(emptySnapshot, "hejbroSnapshot")).toBe(false);
	});

	it("a schema snapshot's self-naming field is `name`, not `schemaName`", () => {
		const result = generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
			registry,
		});
		const schemaNode = result.snapshot.objects["schema:app"] as Record<
			string,
			unknown
		>;
		expect(schemaNode).toBeDefined();
		expect(Object.hasOwn(schemaNode, "name")).toBe(true);
		expect(Object.hasOwn(schemaNode, "schemaName")).toBe(false);
	});

	it("a trigger snapshot's function-reference field is `function`, not `functionName`", () => {
		const comments = table(app, "comments", {
			id: uuid().primaryKey(),
			postId: uuid().notNull(),
		});
		const guard = defineTrigger(
			comments,
			{ name: "guard", timing: "before", events: ["insert"], forEach: "row" },
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		const result = generateMigration({
			declarations: [comments, guard],
			previousSnapshot: emptySnapshot,
			registry,
		});
		const triggerNode = result.snapshot.objects[
			"trigger:app.comments.guard"
		] as Record<string, unknown>;
		expect(triggerNode).toBeDefined();
		expect(Object.hasOwn(triggerNode, "function")).toBe(true);
		expect(Object.hasOwn(triggerNode, "functionName")).toBe(false);
	});

	it("every grantKind value is kebab-case, and the migration banner carries the kebab token", () => {
		const readerRole = roleName("app_reader");
		const usageGrant = grant(app).usage.to(readerRole);
		const tablesGrant = grant(app).tables("select").to(readerRole);
		const defaultTablesGrant = grant(app)
			.defaultPrivileges.tables("select")
			.to(readerRole);

		const result = generateMigration({
			declarations: [app, usageGrant, tablesGrant, defaultTablesGrant],
			previousSnapshot: emptySnapshot,
			registry,
		});

		const grantChanges = result.changes.filter(
			(change) => change.kind === "grant",
		);
		expect(grantChanges.length).toBe(3);

		const grantKinds = grantChanges.map((change) => {
			const node = change.next as Record<string, unknown>;
			return node.grantKind as string;
		});
		const offenders = grantKinds.filter((value) => !KEBAB_CASE.test(value));
		expect(offenders).toEqual([]);

		// The identity — and therefore the migration banner — embeds the
		// same token (`<schema>.<grantKind>.<role>`); a passing snapshot
		// check alone wouldn't catch a mismatch between the two.
		for (const grantKind of grantKinds) {
			expect(result.sql).toContain(`.${grantKind}.`);
		}
	});

	it("a real error diagnostic code is kebab-case (ambiguous-column-rename)", () => {
		const postsV1 = table(app, "posts", {
			id: uuid().primaryKey(),
			slug: uuid().notNull(),
		});
		const previousSnapshot = buildSnapshot([getTableMeta(postsV1)], registry);
		const postsV2 = table(app, "posts", {
			id: uuid().primaryKey(),
			handle: uuid().notNull(),
		});
		const result = generateMigration({
			declarations: [postsV2],
			previousSnapshot,
			registry,
		});
		expect(result.errors.length).toBeGreaterThan(0);
		const offenders = result.errors
			.map((error) => error.code)
			.filter((code) => !KEBAB_CASE.test(code));
		expect(offenders).toEqual([]);
	});

	it("a real warning diagnostic code is kebab-case (not-null-without-default)", () => {
		const usersV1 = table(app, "users", { id: uuid().primaryKey() });
		const previousSnapshot = buildSnapshot([getTableMeta(usersV1)], registry);
		const usersV2 = table(app, "users", {
			id: uuid().primaryKey(),
			email: uuid().notNull(),
		});
		const result = generateMigration({
			declarations: [usersV2],
			previousSnapshot,
			registry,
		});
		expect(result.warnings.length).toBeGreaterThan(0);
		const offenders = result.warnings
			.map((warning) => warning.code)
			.filter((code) => !KEBAB_CASE.test(code));
		expect(offenders).toEqual([]);
	});
});

// D70 (#110): every discriminator anywhere in a serialized expression
// subtree is kebab-case (stated as a rule, not a node list, so it can't go
// stale as nodes are added — nodeKind, projectionKind, joinKind, queryKind,
// literalKind, chunkKind today); every field naming another schema/table/
// function object uses D57's vocabulary. Deliberately generic — not a list
// of known node shapes — so a brand-new node kind is checked automatically,
// with no carve-out to add or forget.
const FORBIDDEN_REFERENCE_KEYS = [
	"schemaName",
	"tableName",
	"columnName",
	"columnNames",
	"functionName",
];

/**
 * This relies on the convention that every discriminator field is named
 * `*Kind` (true across `ast.ts` today: `nodeKind`, `projectionKind`,
 * `joinKind`, `queryKind`, `literalKind`, `chunkKind`). A discriminator
 * introduced under another name would not be checked here.
 *
 * SQL's own tokens (`ComparisonNode.operator`, `OrderByTerm.direction`)
 * are excluded *by construction*, not by an exemption list: neither field
 * name ends in `Kind`, so this walker never inspects them (D36).
 */
const walkJson = (
	value: JsonValue,
	visit: (key: string, value: JsonValue) => void,
): void => {
	if (Array.isArray(value)) {
		for (const entry of value) {
			walkJson(entry, visit);
		}
		return;
	}
	if (typeof value !== "object" || value === null) {
		return;
	}
	for (const [key, entryValue] of Object.entries(value)) {
		if (entryValue === undefined) {
			continue;
		}
		visit(key, entryValue);
		walkJson(entryValue, visit);
	}
};

describe("D70 naming convention: expression subtree discriminators are kebab-case", () => {
	// Exercises every reachable ExprNode/ProjectionNode kind at least once
	// (all but `plpgsqlRef`, `allColumns`, `columns` -- see
	// UNREACHABLE_NODE_KINDS/UNREACHABLE_PROJECTION_KINDS below for why
	// those three are excluded on purpose) so the completeness assertion
	// further down has something real to compare the maps against, not
	// just whatever a narrower fixture happened to construct.
	const authors = table(app, "authors", { id: uuid().primaryKey() });
	const posts = table(
		app,
		"posts",
		{
			id: uuid().primaryKey(),
			authorId: uuid().notNull(),
			price: integer(),
			publishedAt: timestamptz().defaultNow(),
		},
		(t) => ({
			checks: [
				// comparison, literal (number)
				check("posts_price_check", gt(t.price, 0)),
				// logical(and), between, inList, not, nullTest
				check(
					"posts_price_range_check",
					and(
						between(t.price, 0, 1000),
						inArray(t.price, [10, 20, 30]),
						not(isNull(t.price)),
					),
				),
				// sqlTemplate (text chunk + expr chunk, columnRef inside)
				check("posts_price_sql_template_check", sql`${t.price} > 0`),
				// rawSql
				check("posts_price_raw_sql_check", sql.raw("price > 0")),
			],
			indexes: [
				index("posts_published_idx")
					.on(t.publishedAt)
					.where(isNotNull(t.publishedAt)),
			],
		}),
	);
	const comments = table(
		app,
		"comments",
		{ id: uuid().primaryKey(), postId: uuid().notNull() },
		(t) => ({
			rls: rls.enabled({
				read: rls
					.policy("comments_read_visible")
					.for("select")
					.to("anon")
					.using(
						// exists (constantOne projection, join, where, orderBy, limit)
						exists(
							select(posts)
								.innerJoin(authors, eq(posts.authorId, authors.id))
								.where(eq(posts.id, t.postId))
								.orderBy({ by: posts.publishedAt, direction: "desc" })
								.limit(1),
						),
					),
			}),
		}),
	);

	const result = generateMigration({
		declarations: [app, authors, posts, comments],
		previousSnapshot: emptySnapshot,
		registry,
	});

	it("every *Kind field's value is kebab-case, and no D57 camelCase reference key survives, across a snapshot exercising column default, CHECK, partial index, and a cross-table exists() policy", () => {
		const kebabOffenders: Array<{
			readonly key: string;
			readonly value: string;
		}> = [];
		const forbiddenKeyOffenders: Array<string> = [];
		for (const node of Object.values(result.snapshot.objects)) {
			walkJson(node, (key, value) => {
				if (FORBIDDEN_REFERENCE_KEYS.includes(key)) {
					forbiddenKeyOffenders.push(key);
					return;
				}
				if (key.endsWith("Kind") && typeof value === "string") {
					if (!KEBAB_CASE.test(value)) {
						kebabOffenders.push({ key, value });
					}
				}
			});
		}
		expect(forbiddenKeyOffenders).toEqual([]);
		expect(kebabOffenders).toEqual([]);
	});

	// reviewer round 2 (🔴2b, refined by item 65): the walker above only
	// ever sees whatever the fixture happens to construct -- it can prove
	// "everything this fixture reached is spelled correctly", never
	// "everything the map claims to support was checked". Closing that
	// needs the map's own key set compared against what got reached, with
	// every gap accounted for explicitly. This must NOT decay into a
	// silent allowlist (#87's rejected pattern, reused as `import type`
	// only in spirit here -- there is no bare `Record<string, true>`
	// below, every entry carries a reason and a category).
	//
	// Two categories of reason, backed differently on purpose:
	//  - "constructional": the DSL has no code path that can ever build
	//    this shape, full stop -- a structural fact independent of any
	//    other function's current implementation. Prose is enough because
	//    nothing else could silently make it false.
	//  - "current-code-dependent": the shape COULD be built, but is
	//    unreachable only because some *other* function currently
	//    discards/overrides it. That fact can silently stop being true
	//    the next time that function is edited, which is exactly the
	//    staleness failure mode this whole completeness check exists to
	//    catch -- one level up. Every such entry is backed by an actual
	//    pinning test (named in the `reason`), not just a comment, so that
	//    changing the other function's behavior turns the pinning test red
	//    first and forces the list below to be revisited.
	const UNREACHABLE_NODE_KINDS: ReadonlyArray<{
		readonly kind: ExprNode["nodeKind"];
		readonly category: "constructional" | "current-code-dependent";
		readonly reason: string;
	}> = [
		{
			kind: "plpgsqlRef",
			category: "constructional",
			reason:
				"the DSL has no way to construct a plpgsqlRef outside a plpgsql function body (defineTrigger/defineFunction's ctx.* helpers), and none of the four fields expression nodes are stored in today (column default, CHECK, partial-index where, policy using/withCheck) are plpgsql body statements",
		},
	];

	const UNREACHABLE_PROJECTION_KINDS: ReadonlyArray<{
		readonly kind: ProjectionNode["projectionKind"];
		readonly category: "constructional" | "current-code-dependent";
		readonly reason: string;
	}> = [
		{
			kind: "allColumns",
			category: "current-code-dependent",
			reason:
				"select(table) resolves to an allColumns projection, but exists()/notExists() (query/select.ts's buildExists) unconditionally overwrites the subquery's projection with constantOne regardless of what was selected -- pinned by the buildExists test below",
		},
		{
			kind: "columns",
			category: "current-code-dependent",
			reason:
				"select({ ... }, table) resolves to a columns projection, but buildExists overwrites it the exact same way as allColumns -- pinned by the same test below",
		},
	];

	// Backs the two `current-code-dependent` entries above: if buildExists
	// is ever changed to pass through the real projection instead of
	// hardcoding constantOne, THIS test goes red first, forcing whoever
	// makes that change to also revisit the unreachable-set above (which
	// would otherwise go stale silently, reproducing the exact failure
	// mode the completeness assertion below exists to prevent).
	it("exists()/notExists() always normalize their subquery's projection to constantOne (backs the projection-kind unreachable-set entries above)", () => {
		const widgets = table(app, "widgets", {
			id: uuid().primaryKey(),
			label: uuid().notNull(),
		});
		const viaAllColumns = exists(select(widgets));
		const viaColumns = exists(select({ id: widgets.id }, widgets));
		expect(viaAllColumns.exprNode).toMatchObject({
			nodeKind: "exists",
			query: { projection: { projectionKind: "constantOne" } },
		});
		expect(viaColumns.exprNode).toMatchObject({
			nodeKind: "exists",
			query: { projection: { projectionKind: "constantOne" } },
		});
	});

	it("the encoding maps' full vocabulary equals what the fixture above actually reached, plus the explicitly-unreachable set (no silent allowlist)", () => {
		const seenNodeKinds = new Set<string>();
		const seenProjectionKinds = new Set<string>();
		for (const node of Object.values(result.snapshot.objects)) {
			walkJson(node, (key, value) => {
				if (key === "nodeKind" && typeof value === "string") {
					seenNodeKinds.add(value);
				}
				if (key === "projectionKind" && typeof value === "string") {
					seenProjectionKinds.add(value);
				}
			});
		}

		const declaredUnreachableNodeKindValues = new Set(
			UNREACHABLE_NODE_KINDS.map((entry) => NODE_KIND_TO_SNAPSHOT[entry.kind]),
		);
		const expectedReachableNodeKindValues = Object.values(
			NODE_KIND_TO_SNAPSHOT,
		).filter((value) => !declaredUnreachableNodeKindValues.has(value));
		expect([...seenNodeKinds].sort()).toEqual(
			[...expectedReachableNodeKindValues].sort(),
		);
		// every declared-unreachable entry really is unreached by the
		// fixture -- otherwise its reason is already stale.
		expect(
			[...seenNodeKinds].filter((value) =>
				declaredUnreachableNodeKindValues.has(value),
			),
		).toEqual([]);

		const declaredUnreachableProjectionKindValues = new Set(
			UNREACHABLE_PROJECTION_KINDS.map(
				(entry) => PROJECTION_KIND_TO_SNAPSHOT[entry.kind],
			),
		);
		const expectedReachableProjectionKindValues = Object.values(
			PROJECTION_KIND_TO_SNAPSHOT,
		).filter((value) => !declaredUnreachableProjectionKindValues.has(value));
		expect([...seenProjectionKinds].sort()).toEqual(
			[...expectedReachableProjectionKindValues].sort(),
		);
		expect(
			[...seenProjectionKinds].filter((value) =>
				declaredUnreachableProjectionKindValues.has(value),
			),
		).toEqual([]);
	});
});
