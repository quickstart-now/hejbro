import { describe, expect, it } from "vitest";
import { check } from "../src/dsl/check";
import { desc, index } from "../src/dsl/index-builder";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import type { ColumnRef, Expr } from "../src/expr/ast";
import { inArray, isNotNull } from "../src/expr/operators";
import type { KindChange } from "../src/kind/object-kind";
import { createDefaultRegistry } from "../src/kind/registry";
import { tableKind } from "../src/kinds/table-kind";
import {
	asTableSnapshot,
	checkExpression,
	indexWhere,
} from "../src/kinds/table-snapshot";
import {
	bigserial,
	integer,
	serial,
	smallserial,
	text,
	timestamptz,
	uuid,
} from "../src/types/column-builder-factories";

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

	it("derives deterministic index and foreign key names", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const comments = table(app, "comments", { postId: uuid() }, (t) => ({
			indexes: [
				{
					columns: [{ name: t.postId.sqlName, desc: false, nulls: null }],
					unique: false,
					indexName: null,
					predicate: null,
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
					columns: [{ name: t.publishedAt.sqlName, desc: false, nulls: null }],
					unique: false,
					indexName: null,
					predicate: null,
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
			`"app"."posts"."status" in ('draft', 'published')`,
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
		expect(indexWhere(firstIndex)).toBe(
			'"app"."posts"."published_at" is not null',
		);
	});
});

describe("createDefaultRegistry", () => {
	it("registers the table kind", () => {
		expect(createDefaultRegistry().get("table").kind).toBe("table");
	});
});
