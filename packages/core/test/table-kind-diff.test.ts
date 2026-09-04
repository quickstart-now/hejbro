// fs allowed HERE — the golden-byte-equality regression (T007) reads a
// committed expected/*.json the same way test/golden/golden.test.ts does.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/dsl/check";
import { desc, index, op } from "../src/dsl/index-builder";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import type { ColumnRef, Expr } from "../src/expr/ast";
import { decodeExprNode } from "../src/expr/codec";
import { inArray, isNotNull } from "../src/expr/operators";
import { renderExpr } from "../src/expr/render-sql";
import { sql } from "../src/expr/sql-template";
import type { KindChange } from "../src/kind/object-kind";
import { createDefaultRegistry } from "../src/kind/registry";
import { tableKind } from "../src/kinds/table-kind";
import type {
	IndexColumnSnapshot,
	IndexSnapshot,
	TableSnapshot,
} from "../src/kinds/table-snapshot";
import {
	asTableSnapshot,
	checkExpression,
	columnGenerated,
	columnIdentity,
	indexColumnExpression,
	indexColumnOpclass,
	indexMethod,
	indexWhere,
	isExpressionIndexColumn,
} from "../src/kinds/table-snapshot";
import {
	buildSnapshot,
	emptySnapshot,
	HEJBRO_SNAPSHOT_VERSION,
	parseSnapshot,
	renderSnapshot,
} from "../src/snapshot/snapshot";
import type { JsonValue } from "../src/snapshot/stable-json";
import {
	bigint,
	bigserial,
	integer,
	numeric,
	serial,
	smallserial,
	text,
	timestamptz,
	uuid,
} from "../src/types/column-builder-factories";
import {
	posts as tableIndexesPosts,
	app as tableIndexesSchema,
} from "./golden/cases/table-indexes/declarations";
import { steps as tableIndexesSteps } from "./golden/cases/table-indexes/steps";

const app = schema("app");

const expectSingleChange = (changes: ReadonlyArray<KindChange>): KindChange => {
	if (changes.length !== 1) {
		throw new Error(`expected exactly one change, got ${changes.length}`);
	}
	const [change] = changes;
	if (change === undefined) {
		throw new Error("expected a change");
	}
	return change;
};

describe("tableKind.owns", () => {
	it("owns table declarations only", () => {
		expect(
			tableKind.owns(
				getTableMeta(table(app, "posts", { id: uuid().primaryKey() })),
			),
		).toBe(true);
		expect(tableKind.owns({ declarationKind: "schema" })).toBe(false);
	});
});

describe("tableKind.serialize", () => {
	it("materializes notNull from primaryKey", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = tableKind.serialize(getTableMeta(posts)) as {
			readonly columns: ReadonlyArray<{
				readonly name: string;
				readonly notNull: boolean;
			}>;
		};
		expect(snapshot.columns[0]?.notNull).toBe(true);
	});

	// #23/D66 (measured against a real Postgres, not assumed): serial/
	// smallserial/bigserial always imply NOT NULL on the column, independent
	// of primaryKey status -- confirmed via `pg_dump` on a table declaring
	// bigserial/smallserial columns with neither .primaryKey() nor
	// .notNull() chained; pg_dump still showed NOT NULL on both. None of
	// the three serial factories set `notNull` on their own
	// (`column-builder-factories.ts`'s `initialColumnBuilder` defaults it to
	// `false` for every simple type), so without this, a bare `serial()`/
	// `bigserial()`/`smallserial()` column (no `.primaryKey()`, no
	// `.notNull()`) would materialize as nullable -- a real column a real
	// Postgres would never let exist, since the pseudo-type sugar itself
	// carries the constraint.
	it("materializes notNull for serial/smallserial/bigserial, independent of primaryKey", () => {
		const widgets = table(app, "widgets", {
			id: serial(),
			bigId: bigserial(),
			smallId: smallserial(),
			label: text(),
		});
		const snapshot = tableKind.serialize(getTableMeta(widgets)) as {
			readonly columns: ReadonlyArray<{
				readonly name: string;
				readonly notNull?: boolean;
			}>;
		};
		const byName = new Map(
			snapshot.columns.map((column) => [column.name, column]),
		);
		expect(byName.get("id")?.notNull).toBe(true);
		expect(byName.get("big_id")?.notNull).toBe(true);
		expect(byName.get("small_id")?.notNull).toBe(true);
		// a genuinely nullable column stays compact (D33) -- not touched by
		// the serial-family rule, still absent rather than `false`.
		expect(byName.get("label")?.notNull).toBeUndefined();
	});

	// D106 R3-B3 (lead ruling, CI-R3-07): ForeignKeyDeclaration.name is
	// `string | null`, but the snapshot stays compact regardless -- an
	// unnamed foreign key's own serialized shape carries exactly the
	// four fields it always has (name resolved to the derived string,
	// never a literal `null`), so an existing project's own committed
	// snapshot text never moves a byte for adopting this slot without
	// using it.
	it("keeps an unnamed foreign key's own serialized shape unchanged -- no extra key, name resolved to the derived string", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const comments = table(
			app,
			"comments",
			{ id: uuid().primaryKey(), postId: uuid().notNull() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: posts, columns: [posts.id] },
					},
				],
			}),
		);
		const snapshot = tableKind.serialize(getTableMeta(comments)) as {
			readonly foreignKeys: ReadonlyArray<Record<string, unknown>>;
		};
		const [foreignKey] = snapshot.foreignKeys;
		if (foreignKey === undefined) {
			throw new Error("expected one foreign key in the serialized snapshot");
		}
		expect(Object.keys(foreignKey).sort()).toEqual([
			"columns",
			"name",
			"referencesColumns",
			"referencesTable",
		]);
		expect(foreignKey.name).toBe("comments_post_id_fk");
	});

	// D81: the oracle, not declaration order, decides the snapshot's column
	// order once one is supplied — `generate`'s only real caller of this
	// (`buildSnapshot`) always supplies one built from the parent snapshot.
	it("serializes columns in the oracle's order, declaration order when the oracle is silent", () => {
		const declaration = getTableMeta(
			table(app, "projects", {
				id: uuid(),
				description: text(),
				archivedAt: timestamptz(),
			}),
		);
		const silent = tableKind.serialize(declaration) as TableSnapshot;
		expect(silent.columns.map((c) => c.name)).toEqual([
			"id",
			"description",
			"archived_at",
		]);
		const ordered = tableKind.serialize(declaration, {
			columnOrder: () => ["id", "archived_at", "description"],
		}) as TableSnapshot;
		expect(ordered.columns.map((c) => c.name)).toEqual([
			"id",
			"archived_at",
			"description",
		]);
	});

	it("ignores a stale name the oracle returns for a column the declaration no longer has", () => {
		const declaration = getTableMeta(
			table(app, "projects", { id: uuid(), title: text() }),
		);
		const ordered = tableKind.serialize(declaration, {
			columnOrder: () => ["id", "archived_at", "title"],
		}) as TableSnapshot;
		expect(ordered.columns.map((c) => c.name)).toEqual(["id", "title"]);
	});

	it("emits create table in the snapshot's column order (D81)", () => {
		const declaration = getTableMeta(
			table(app, "projects", {
				id: uuid(),
				description: text(),
				archivedAt: timestamptz(),
			}),
		);
		const ordered = tableKind.serialize(declaration, {
			columnOrder: () => ["id", "archived_at", "description"],
		});
		const change = expectSingleChange(
			tableKind.diff(null, ordered, "app.projects"),
		);
		const sql = tableKind
			.emit(change)
			.map((statement) => statement.sql)
			.join("\n");
		expect(sql).toMatch(
			/"id" uuid[\s\S]*"archived_at" timestamp with time zone[\s\S]*"description" text/,
		);
	});

	it("derives deterministic index and foreign key names", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const comments = table(app, "comments", { postId: uuid() }, (t) => ({
			indexes: [
				{
					columns: [
						{
							name: t.postId.sqlName,
							origin: { schemaName: "app", tableName: "comments" },
							desc: false,
							nulls: null,
							opclass: null,
						},
					],
					unique: false,
					indexName: null,
					predicate: null,
					method: null,
				},
			],
			foreignKeys: [
				{
					columns: [t.postId],
					references: { table: posts, columns: [posts.id] },
					onDelete: "cascade",
				},
			],
		}));
		const snapshot = tableKind.serialize(getTableMeta(comments)) as {
			readonly indexes: ReadonlyArray<{ readonly name: string }>;
			readonly foreignKeys: ReadonlyArray<{
				readonly name: string;
				readonly referencesTable: string;
			}>;
		};
		expect(snapshot.indexes[0]?.name).toBe("comments_post_id_idx");
		expect(snapshot.foreignKeys[0]?.name).toBe("comments_post_id_fk");
		expect(snapshot.foreignKeys[0]?.referencesTable).toBe("app.posts");
	});
});

describe("tableKind.identify", () => {
	it("identifies as schema.tableName", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		expect(tableKind.identify(tableKind.serialize(getTableMeta(posts)))).toBe(
			"app.posts",
		);
	});
});

// #753/task 1.1: dependsOnIdentities names a table's own foreign-key
// targets -- the intra-kind edge diffSnapshots (engine/diff-engine.ts)
// refines the create/drop order by, reversed on drop.
describe("tableKind.dependsOnIdentities (#753)", () => {
	const dependsOnIdentitiesOf = (node: JsonValue): ReadonlyArray<string> => {
		const fn = tableKind.dependsOnIdentities;
		if (fn === undefined) {
			throw new Error(
				"expected tableKind.dependsOnIdentities to be implemented",
			);
		}
		return fn(node);
	};

	it("names a table's own foreign-key targets", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });

		// no foreign key -> empty
		const tags = table(app, "tags", { id: uuid().primaryKey() });
		expect(
			dependsOnIdentitiesOf(tableKind.serialize(getTableMeta(tags))),
		).toEqual([]);

		// one foreign key to another table -> that table's identity
		const comments = table(
			app,
			"comments",
			{ id: uuid().primaryKey(), postId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: posts, columns: [posts.id] },
					},
				],
			}),
		);
		expect(
			dependsOnIdentitiesOf(tableKind.serialize(getTableMeta(comments))),
		).toEqual(["app.posts"]);

		// two foreign keys to two different tables -> both, in the table's own
		// foreign-key order (D1: table()'s `foreignKeys` getter sorts
		// canonically by local column name, independent of which declaration
		// form wrote each one -- "author_id" < "post_id", so authors' target
		// surfaces first regardless of the array literal's own order below)
		const authors = table(app, "authors", { id: uuid().primaryKey() });
		const reviews = table(
			app,
			"reviews",
			{
				id: uuid().primaryKey(),
				postId: uuid(),
				authorId: uuid(),
			},
			(t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: posts, columns: [posts.id] },
					},
					{
						columns: [t.authorId],
						references: { table: authors, columns: [authors.id] },
					},
				],
			}),
		);
		expect(
			dependsOnIdentitiesOf(tableKind.serialize(getTableMeta(reviews))),
		).toEqual(["app.authors", "app.posts"]);

		// two foreign keys both targeting the same table -> one identity, not two
		const replies = table(
			app,
			"replies",
			{
				id: uuid().primaryKey(),
				postId: uuid(),
				replyToPostId: uuid(),
			},
			(t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: posts, columns: [posts.id] },
					},
					{
						columns: [t.replyToPostId],
						references: { table: posts, columns: [posts.id] },
					},
				],
			}),
		);
		expect(
			dependsOnIdentitiesOf(tableKind.serialize(getTableMeta(replies))),
		).toEqual(["app.posts"]);

		// a self-referencing foreign key -- excluded, empty
		const nodes = table(
			app,
			"nodes",
			{ id: uuid().primaryKey().defaultRandom(), parentId: uuid() },
			(t) => ({
				foreignKeys: [
					{ columns: [t.parentId], references: { columns: [t.id] } },
				],
			}),
		);
		expect(
			dependsOnIdentitiesOf(tableKind.serialize(getTableMeta(nodes))),
		).toEqual([]);

		// a composite, multi-column foreign key -- still one identity, not one per column
		const projects = table(app, "projects", {
			tenantId: uuid(),
			id: uuid().primaryKey(),
		});
		const tasks = table(
			app,
			"tasks",
			{ tenantId: uuid(), projectId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.tenantId, t.projectId],
						references: {
							table: projects,
							columns: [projects.tenantId, projects.id],
						},
					},
				],
			}),
		);
		expect(
			dependsOnIdentitiesOf(tableKind.serialize(getTableMeta(tasks))),
		).toEqual(["app.projects"]);
	});
});

describe("tableKind.diff", () => {
	it("diffs none -> some as a create", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const next = tableKind.serialize(getTableMeta(posts));
		expect(tableKind.diff(null, next, "app.posts")).toEqual([
			{
				kind: "table",
				operation: "create",
				identity: "app.posts",
				previous: null,
				next,
				notes: [],
			},
		]);
	});

	it("diffs some -> none as a drop", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const previous = tableKind.serialize(getTableMeta(posts));
		expect(tableKind.diff(previous, null, "app.posts")).toEqual([
			{
				kind: "table",
				operation: "drop",
				identity: "app.posts",
				previous,
				next: null,
				notes: [],
			},
		]);
	});

	it("has no changes when unchanged", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text(),
		});
		const snapshot = tableKind.serialize(getTableMeta(posts));
		expect(tableKind.diff(snapshot, snapshot, "app.posts")).toEqual([]);
	});

	it("has no changes when only column declaration order changes", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text(),
		});
		const after = table(app, "posts", {
			title: text(),
			id: uuid().primaryKey(),
		});
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		expect(tableKind.diff(previous, next, "app.posts")).toEqual([]);
	});

	it("notes an added column", () => {
		const before = table(app, "posts", { id: uuid().primaryKey() });
		const after = table(app, "posts", {
			id: uuid().primaryKey(),
			slug: text(),
		});
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		expect(tableKind.diff(previous, next, "app.posts")).toEqual([
			{
				kind: "table",
				operation: "alter",
				identity: "app.posts",
				previous,
				next,
				notes: ['column "slug" added'],
			},
		]);
	});

	it("notes a dropped column", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			slug: text(),
		});
		const after = table(app, "posts", { id: uuid().primaryKey() });
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		expect(tableKind.diff(previous, next, "app.posts")).toEqual([
			{
				kind: "table",
				operation: "alter",
				identity: "app.posts",
				previous,
				next,
				notes: ['column "slug" dropped'],
			},
		]);
	});

	it("notes a changed column type", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			views: integer(),
		});
		const after = table(app, "posts", {
			id: uuid().primaryKey(),
			views: text(),
		});
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		expect(tableKind.diff(previous, next, "app.posts")).toEqual([
			{
				kind: "table",
				operation: "alter",
				identity: "app.posts",
				previous,
				next,
				notes: ['column "views" changed'],
			},
		]);
	});

	it("notes an added index", () => {
		const before = table(app, "posts", { publishedAt: timestamptz() });
		const after = table(app, "posts", { publishedAt: timestamptz() }, (t) => ({
			indexes: [
				{
					columns: [
						{
							name: t.publishedAt.sqlName,
							origin: { schemaName: "app", tableName: "posts" },
							desc: false,
							nulls: null,
							opclass: null,
						},
					],
					unique: false,
					indexName: null,
					predicate: null,
					method: null,
				},
			],
		}));
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		expect(tableKind.diff(previous, next, "app.posts")).toEqual([
			{
				kind: "table",
				operation: "alter",
				identity: "app.posts",
				previous,
				next,
				notes: ['index "posts_published_at_idx" added'],
			},
		]);
	});

	it("notes an added foreign key", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const before = table(app, "comments", { postId: uuid() });
		const after = table(app, "comments", { postId: uuid() }, (t) => ({
			foreignKeys: [
				{
					columns: [t.postId],
					references: { table: posts, columns: [posts.id] },
					onDelete: "cascade",
				},
			],
		}));
		const previous = tableKind.serialize(getTableMeta(before));
		const next = tableKind.serialize(getTableMeta(after));
		expect(tableKind.diff(previous, next, "app.comments")).toEqual([
			{
				kind: "table",
				operation: "alter",
				identity: "app.comments",
				previous,
				next,
				notes: ['foreign key "comments_post_id_fk" added'],
			},
		]);
	});

	it("reports a foreign key on-update change as a single alter", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const withOnUpdate = (onUpdate: "cascade" | "restrict") =>
			table(app, "comments", { postId: uuid() }, (t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: posts, columns: [posts.id] },
						onUpdate,
					},
				],
			}));
		const previous = tableKind.serialize(getTableMeta(withOnUpdate("cascade")));
		const next = tableKind.serialize(getTableMeta(withOnUpdate("restrict")));
		const change = expectSingleChange(
			tableKind.diff(previous, next, "app.comments"),
		);
		expect(change.notes).toEqual(['foreign key "comments_post_id_fk" changed']);
		expect(tableKind.emit(change).map((statement) => statement.sql)).toEqual([
			'alter table "app"."comments" drop constraint "comments_post_id_fk";',
			'alter table "app"."comments" add constraint "comments_post_id_fk" foreign key ("post_id") references "app"."posts" ("id") on update restrict;',
		]);
	});
});

describe("tableKind.diff — checks", () => {
	const withCheck = (
		expression: (t: { readonly status: ColumnRef<"text"> }) => Expr<"boolean">,
		name = "posts_status_check",
	) =>
		table(app, "posts", { status: text().notNull() }, (t) => ({
			checks: [check(name, expression(t))],
		}));

	it("serializes checks as rendered SQL and omits the field when empty", () => {
		const plain = tableKind.serialize(
			getTableMeta(table(app, "posts", { id: uuid() })),
		);
		expect(asTableSnapshot(plain).checks).toBeUndefined();
		const snap = asTableSnapshot(
			tableKind.serialize(
				getTableMeta(
					withCheck((t) => inArray(t.status, ["draft", "published"])),
				),
			),
		);
		// expression is a structured node (D67/D70); assert the final SQL
		// via checkExpression, the same accessor emit uses, rather than the
		// node's internal shape.
		expect(snap.checks?.map((c) => c.name)).toEqual(["posts_status_check"]);
		expect(snap.checks?.map(checkExpression)).toEqual([
			`"posts"."status" in ('draft', 'published')`,
		]);
	});

	it("reports an expression change as a single alter with a note", () => {
		const before = tableKind.serialize(
			getTableMeta(withCheck((t) => inArray(t.status, ["draft"]))),
		);
		const after = tableKind.serialize(
			getTableMeta(withCheck((t) => inArray(t.status, ["draft", "published"]))),
		);
		const change = expectSingleChange(
			tableKind.diff(before, after, "app.posts"),
		);
		expect(change.operation).toBe("alter");
		expect(change.notes).toEqual(['check "posts_status_check" changed']);
	});
});

describe("tableKind.serialize — index columns and where (v3, D51)", () => {
	it("serializes column order/desc/nulls compactly", () => {
		const posts = table(
			app,
			"posts",
			{ createdAt: timestamptz(), publishedAt: timestamptz() },
			(t) => ({
				indexes: [
					index("posts_recent_idx").on(
						t.createdAt,
						desc(t.publishedAt, { nulls: "first" }),
					),
				],
			}),
		);
		const snapshot = asTableSnapshot(tableKind.serialize(getTableMeta(posts)));
		expect(snapshot.indexes[0]).toEqual({
			name: "posts_recent_idx",
			columns: [
				{ name: "created_at" },
				{ name: "published_at", desc: true, nulls: "first" },
			],
		});
	});

	it("serializes a partial unique index's where predicate as rendered sql", () => {
		const posts = table(
			app,
			"posts",
			{ slug: text(), publishedAt: timestamptz() },
			(t) => ({
				indexes: [
					index("posts_slug_published_uidx")
						.unique()
						.on(t.slug)
						.where(isNotNull(t.publishedAt)),
				],
			}),
		);
		const snapshot = asTableSnapshot(tableKind.serialize(getTableMeta(posts)));
		const [firstIndex] = snapshot.indexes;
		if (firstIndex === undefined) {
			throw new Error("expected one index");
		}
		expect(firstIndex.name).toBe("posts_slug_published_uidx");
		expect(firstIndex.columns).toEqual([{ name: "slug" }]);
		expect(firstIndex.unique).toBe(true);
		// where is a structured node (D67/D70); assert the final SQL via
		// indexWhere, the same accessor emit uses.
		expect(indexWhere(firstIndex)).toBe('"posts"."published_at" is not null');
	});

	// #284 US1 (T011): access method — serialize writes `method` for a
	// non-btree index and omits it for btree/unset (SC-004).
	it("serializes method for a non-btree index, and omits it for btree/unset", () => {
		const posts = table(app, "posts", { data: text() }, (t) => ({
			indexes: [
				index("posts_data_idx").using("gin").on(t.data),
				index("posts_data2_idx").using("btree").on(t.data),
				index("posts_data3_idx").on(t.data),
			],
		}));
		const snapshot = asTableSnapshot(tableKind.serialize(getTableMeta(posts)));
		const byName = new Map(snapshot.indexes.map((ix) => [ix.name, ix]));
		expect(byName.get("posts_data_idx")?.method).toBe("gin");
		expect(byName.get("posts_data2_idx")?.method).toBeUndefined();
		expect(byName.get("posts_data3_idx")?.method).toBeUndefined();
	});

	// #284 US2 (T021): operator class — serialize writes `opclass` only
	// when set.
	it("serializes opclass only when set", () => {
		const posts = table(app, "posts", { data: text(), plain: text() }, (t) => ({
			indexes: [
				index("posts_data_idx").on(op(t.data, "text_pattern_ops")),
				index("posts_plain_idx").on(t.plain),
			],
		}));
		const snapshot = asTableSnapshot(tableKind.serialize(getTableMeta(posts)));
		const byName = new Map(snapshot.indexes.map((ix) => [ix.name, ix]));
		expect(byName.get("posts_data_idx")?.columns).toEqual([
			{ name: "data", opclass: "text_pattern_ops" },
		]);
		expect(byName.get("posts_plain_idx")?.columns).toEqual([{ name: "plain" }]);
	});

	// #284 US3 (T032): expression indexes — serialize writes `expression`
	// as `encodeExprNode` output (D57 vocabulary) and round-trips through
	// `decodeExprNode`.
	it("serializes an expression column as encodeExprNode output, round-tripping through decodeExprNode", () => {
		const posts = table(app, "posts", { email: text() }, (t) => ({
			indexes: [index("posts_email_lower_idx").on(sql`lower(${t.email})`)],
		}));
		const snapshot = asTableSnapshot(tableKind.serialize(getTableMeta(posts)));
		const [firstIndex] = snapshot.indexes;
		if (firstIndex === undefined) {
			throw new Error("expected one index");
		}
		const [column] = firstIndex.columns;
		if (column === undefined || !isExpressionIndexColumn(column)) {
			throw new Error("expected an expression column");
		}
		expect(column.expression).toEqual({
			nodeKind: "sql-template",
			chunks: [
				{ chunkKind: "text", text: "lower(" },
				{
					chunkKind: "expr",
					expr: {
						nodeKind: "column-ref",
						schema: "app",
						table: "posts",
						column: "email",
					},
				},
				{ chunkKind: "text", text: ")" },
			],
		});
		expect(renderExpr(decodeExprNode(column.expression))).toBe(
			'lower("app"."posts"."email")',
		);
		// indexColumnExpression is the accessor emit/preset code actually uses
		// (table-bound, unlike plain renderExpr above).
		expect(indexColumnExpression(column)).toBe('lower("posts"."email")');
	});
});

describe("createDefaultRegistry", () => {
	it("registers the table kind", () => {
		expect(createDefaultRegistry().get("table").kind).toBe("table");
	});
});

// #284 Foundational (T004/T005): the widened snapshot types and their
// accessors — no `method`/`opclass`/`expression` is ever *written* by
// today's builder (US1/US2/US3 add that), so these accessors are exercised
// directly against hand-built snapshot fixtures, the same way indexWhere's
// own tests do for `where`.
describe("index snapshot accessors — Foundational types (#284)", () => {
	it("HEJBRO_SNAPSHOT_VERSION is 8", () => {
		expect(HEJBRO_SNAPSHOT_VERSION).toBe(8);
	});

	it("indexMethod defaults to btree when absent, and reads a recorded method", () => {
		const bare: IndexSnapshot = { name: "idx", columns: [] };
		const gin: IndexSnapshot = { name: "idx", columns: [], method: "gin" };
		expect(indexMethod(bare)).toBe("btree");
		expect(indexMethod(gin)).toBe("gin");
	});

	it("indexColumnOpclass defaults to null when absent, and reads a recorded class", () => {
		const bare: IndexColumnSnapshot = { name: "data" };
		const withClass: IndexColumnSnapshot = {
			name: "data",
			opclass: "jsonb_path_ops",
		};
		expect(indexColumnOpclass(bare)).toBeNull();
		expect(indexColumnOpclass(withClass)).toBe("jsonb_path_ops");
	});

	// indexColumnExpression/isExpressionIndexColumn land in US3 (T038) with
	// the expression-column variant itself (owner decision, #284
	// Foundational review) — see IndexColumnSnapshot's doc comment.
});

// #284 Foundational (T007, SC-004): the type widening above must not move a
// single byte of an existing snapshot. `golden/golden.test.ts` already pins
// this generically for every case's expected/*.json on every `pnpm test`
// run (it passed, unchanged, alongside these Foundational tests); this is
// the same guarantee pinned specifically to `table-indexes` (D51's own
// acceptance case, the one this feature's `IndexDeclaration`/
// `IndexSnapshot` widening touches most directly), so a future regression
// here fails right next to the types it would have broken, not only in the
// generic golden runner. Its committed `expected/snapshot.json` is the
// snapshot *after* `steps.ts`'s full 3-step chain (declarations.ts's
// `[app, posts]` is only step 0 — steps.ts redefines `posts` twice more),
// so this replays that chain via `generateMigration` — same technique
// `golden.test.ts` itself uses — rather than a single `buildSnapshot` call
// on `declarations.ts` alone, which would land on step 0's shape instead.
describe("SC-004 regression: table-indexes still serializes byte-identical (#284)", () => {
	it("declarations.ts's [app, posts] carries no method/opclass — btree stays absent (D85/R2)", () => {
		const rendered = renderSnapshot(
			buildSnapshot(
				[tableIndexesSchema, getTableMeta(tableIndexesPosts)],
				createDefaultRegistry(),
				emptySnapshot,
			),
		);
		expect(rendered).not.toContain('"method"');
		expect(rendered).not.toContain('"opclass"');
	});

	it("replaying table-indexes' full step chain still matches the committed expected/snapshot.json byte-for-byte", () => {
		const finalSnapshot = tableIndexesSteps.reduce(
			(previousSnapshot, declarations) =>
				generateMigration({ declarations, previousSnapshot }).snapshot,
			emptySnapshot,
		);
		const rendered = renderSnapshot(finalSnapshot);
		const expected = readFileSync(
			join(
				import.meta.dirname,
				"golden",
				"cases",
				"table-indexes",
				"expected",
				"snapshot.json",
			),
			"utf8",
		);
		expect(rendered).toBe(expected);
	});
});

// Snapshot format version 6 records the generated/identity family as
// compact optional column fields (D100).
describe("generated/identity columns — snapshot v6", () => {
	it("HEJBRO_SNAPSHOT_VERSION is 8 — #437's offset/distinct bump; canonical foreign-key order arrived at 7, generated/identity at 6", () => {
		expect(HEJBRO_SNAPSHOT_VERSION).toBe(8);
	});

	it("serializes a generated expression as an encoded fragment, and an identity's kind kebab-cased with only its declared options", () => {
		const widgets = table(app, "widgets", {
			id: integer().generatedAlwaysAsIdentity(),
			seq: bigint().generatedByDefaultAsIdentity({ startWith: 1000 }),
			total: numeric().generatedAlwaysAs(sql`price * qty`),
		});
		const snapshot = asTableSnapshot(
			tableKind.serialize(getTableMeta(widgets)),
		);
		const [idColumn, seqColumn, totalColumn] = snapshot.columns;
		if (
			idColumn === undefined ||
			seqColumn === undefined ||
			totalColumn === undefined
		) {
			throw new Error("expected three columns");
		}

		expect(columnIdentity(idColumn)).toEqual({ kind: "always" });
		expect(columnIdentity(seqColumn)).toEqual({
			kind: "by-default",
			startWith: 1000,
		});
		expect(columnGenerated(totalColumn)).toBe("price * qty");

		// declaration-is-truth (design decision 3): an option the declaration
		// never mentioned is absent, never filled in with a Postgres default.
		expect(Object.hasOwn(columnIdentity(seqColumn) ?? {}, "increment")).toBe(
			false,
		);
	});

	it("an identity column's compact notNull is true, both identity kinds alike -- every identity column is NOT NULL by Postgres rule", () => {
		const widgets = table(app, "widgets", {
			id: integer().generatedAlwaysAsIdentity(),
			seq: bigint().generatedByDefaultAsIdentity(),
		});
		const snapshot = asTableSnapshot(
			tableKind.serialize(getTableMeta(widgets)),
		);
		const [idColumn, seqColumn] = snapshot.columns;
		if (idColumn === undefined || seqColumn === undefined) {
			throw new Error("expected two columns");
		}
		expect(idColumn.notNull).toBe(true);
		expect(seqColumn.notNull).toBe(true);
		expect(tableKind.diff(snapshot, snapshot, "app.widgets")).toEqual([]);
	});

	it("round-trips a generated expression, an identity kind, and explicit identity options through render/parse with an empty diff, reading formatVersion 8 back", () => {
		const widgets = table(app, "widgets", {
			id: integer().generatedAlwaysAsIdentity(),
			seq: bigint().generatedByDefaultAsIdentity({ startWith: 1000 }),
			total: numeric().generatedAlwaysAs(sql`price * qty`),
		});
		const declared = tableKind.serialize(getTableMeta(widgets));
		const snapshot = buildSnapshot(
			[app, getTableMeta(widgets)],
			createDefaultRegistry(),
			emptySnapshot,
		);

		const parsed = parseSnapshot(renderSnapshot(snapshot));
		expect(parsed.formatVersion).toBe(8);

		const roundTrippedNode = parsed.objects["table:app.widgets"];
		if (roundTrippedNode === undefined) {
			throw new Error(
				"expected table:app.widgets in the round-tripped snapshot",
			);
		}
		const roundTripped = asTableSnapshot(roundTrippedNode);
		expect(tableKind.diff(declared, roundTripped, "app.widgets")).toEqual([]);

		const [idColumn, seqColumn, totalColumn] = roundTripped.columns;
		if (
			idColumn === undefined ||
			seqColumn === undefined ||
			totalColumn === undefined
		) {
			throw new Error("expected three columns");
		}
		expect(columnIdentity(idColumn)).toEqual({ kind: "always" });
		expect(columnIdentity(seqColumn)).toEqual({
			kind: "by-default",
			startWith: 1000,
		});
		expect(columnGenerated(totalColumn)).toBe("price * qty");
	});
});
