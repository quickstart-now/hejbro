import { describe, expect, it } from "vitest";
import { defineTrigger } from "../src/dsl/define-trigger";
import { defineView } from "../src/dsl/define-view";
import { pgEnum } from "../src/dsl/pg-enum";
import { rls } from "../src/dsl/rls";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { diffSnapshots, rankKinds } from "../src/engine/diff-engine";
import { generateMigration } from "../src/engine/generate";
import { isNull, literal } from "../src/expr/operators";
import type {
	ChangeOperation,
	HejbroDeclaration,
	ObjectKind,
} from "../src/kind/object-kind";
import {
	createDefaultRegistry,
	createKindRegistry,
} from "../src/kind/registry";
import { enumKind } from "../src/kinds/enum-kind";
import { schemaKind } from "../src/kinds/schema-kind";
import { sequenceKind } from "../src/kinds/sequence-kind";
import { tableKind } from "../src/kinds/table-kind";
import type {
	ColumnSnapshot,
	TableSnapshot,
} from "../src/kinds/table-snapshot";
import { select } from "../src/query/select";
import type { Snapshot } from "../src/snapshot/snapshot";
import { buildSnapshot, emptySnapshot } from "../src/snapshot/snapshot";
import type { JsonValue } from "../src/snapshot/stable-json";
import { serial, uuid } from "../src/types/column-builder-factories";

const app = schema("app");
const registry = createDefaultRegistry();

describe("diffSnapshots — kind dependency ordering", () => {
	it("orders creates: schema, then enum, then table", () => {
		const postStatus = pgEnum(app, "post_status", ["draft"]);
		const posts = table(app, "posts", { status: postStatus.column() });
		const next = buildSnapshot(
			[app, postStatus, getTableMeta(posts)],
			registry,
			emptySnapshot,
		);
		const changes = diffSnapshots(emptySnapshot, next, registry);
		expect(changes.map((change) => change.kind)).toEqual([
			"schema",
			"enum",
			"table",
		]);
		expect(changes.every((change) => change.operation === "create")).toBe(true);
	});

	it("orders drops in reverse: table, then enum, then schema", () => {
		const postStatus = pgEnum(app, "post_status", ["draft"]);
		const posts = table(app, "posts", { status: postStatus.column() });
		const previous = buildSnapshot(
			[app, postStatus, getTableMeta(posts)],
			registry,
			emptySnapshot,
		);
		const changes = diffSnapshots(previous, emptySnapshot, registry);
		expect(changes.map((change) => change.kind)).toEqual([
			"table",
			"enum",
			"schema",
		]);
		expect(changes.every((change) => change.operation === "drop")).toBe(true);
	});

	// D74/#23: table-kind.ts's add-column rendering inlines a serial
	// column's sequence-backed default (`nextval('…')`), which requires
	// the sequence to already exist -- so `sequence` creates must sort
	// *before* `table` creates. Before tableKind.dependsOn declared
	// "sequence", this held only because registry.ts happens to register
	// sequenceKind ahead of tableKind (confirmed by measurement during
	// #193 review: no dependsOn edge, no pinning test, `grep -rln
	// "rankKinds|topoSortKindNames" packages/core/test/` returned nothing)
	// -- a by-product of registration order, not a declared dependency.
	it("orders creates: sequence, then table, for a serial-family column", () => {
		const posts = table(app, "posts", { id: serial().primaryKey() });
		// generateMigration, not buildSnapshot directly -- buildSnapshot takes
		// already-resolved declarations and has no synthesis step of its own;
		// only generateMigration's resolveDeclarations synthesizes the
		// sequence declaration a raw serial() column implies.
		const next = generateMigration({
			declarations: [app, posts],
			previousSnapshot: emptySnapshot,
			registry,
		}).snapshot;
		const changes = diffSnapshots(emptySnapshot, next, registry);
		expect(changes.map((change) => change.kind)).toEqual([
			"schema",
			"sequence",
			"table",
		]);
	});

	// The structural half of the claim above: this order must survive a
	// registry that registers `table` *before* `sequence` -- the exact
	// registration-order flip that would have silently broken the old,
	// undeclared ordering. Built as a standalone registry (not a mutation
	// of registry.ts itself) so this test exercises the real risk directly
	// rather than asserting registry.ts's current line order stays put.
	it("keeps sequence-before-table even when a registry registers table first (registration-order independence)", () => {
		const reorderedRegistry = createKindRegistry();
		reorderedRegistry.register(schemaKind);
		reorderedRegistry.register(enumKind);
		reorderedRegistry.register(tableKind);
		reorderedRegistry.register(sequenceKind);

		const posts = table(app, "posts", { id: serial().primaryKey() });
		const next = generateMigration({
			declarations: [app, posts],
			previousSnapshot: emptySnapshot,
			registry: reorderedRegistry,
		}).snapshot;
		const changes = diffSnapshots(emptySnapshot, next, reorderedRegistry);
		expect(changes.map((change) => change.kind)).toEqual([
			"schema",
			"sequence",
			"table",
		]);
	});

	it("sorts changes by identity (byte order) within the same kind", () => {
		const zebra = table(app, "zebra", { id: uuid().primaryKey() });
		const alpha = table(app, "alpha", { id: uuid().primaryKey() });
		const next = buildSnapshot(
			[app, getTableMeta(zebra), getTableMeta(alpha)],
			registry,
			emptySnapshot,
		);
		const changes = diffSnapshots(emptySnapshot, next, registry).filter(
			(change) => change.kind === "table",
		);
		expect(changes.map((change) => change.identity)).toEqual([
			"app.alpha",
			"app.zebra",
		]);
	});
});

// #753/task 1.2: diffSnapshots applies tableKind.dependsOnIdentities as a
// stable, intra-kind topological refinement of the order it already
// computes -- never `cascade`, and never a diff-time throw on a genuine
// cycle (a drop the database actually refuses surfaces through the
// apply-time coded failure, task 1.4).
describe("diffSnapshots — same-kind dependency ordering", () => {
	it("drops a referencing table before the table it references, and creates the referenced table first -- the pair sorting with the referenced table first alphabetically (the shape #753 itself reported)", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const reviews = table(
			app,
			"reviews",
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
		const next = buildSnapshot(
			[app, getTableMeta(posts), getTableMeta(reviews)],
			registry,
			emptySnapshot,
		);

		const createOrder = diffSnapshots(emptySnapshot, next, registry)
			.filter((change) => change.kind === "table")
			.map((change) => change.identity);
		expect(createOrder).toEqual(["app.posts", "app.reviews"]);

		const dropOrder = diffSnapshots(next, emptySnapshot, registry)
			.filter((change) => change.kind === "table")
			.map((change) => change.identity);
		expect(dropOrder).toEqual(["app.reviews", "app.posts"]);
	});

	it("leaves an already-correct drop order alone -- the same shape, but the referencing table's name already sorts first alphabetically", () => {
		const bananas = table(app, "bananas", { id: uuid().primaryKey() });
		const apples = table(
			app,
			"apples",
			{ id: uuid().primaryKey(), bananaId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.bananaId],
						references: { table: bananas, columns: [bananas.id] },
					},
				],
			}),
		);
		const next = buildSnapshot(
			[app, getTableMeta(bananas), getTableMeta(apples)],
			registry,
			emptySnapshot,
		);

		const dropOrder = diffSnapshots(next, emptySnapshot, registry)
			.filter((change) => change.kind === "table")
			.map((change) => change.identity);
		expect(dropOrder).toEqual(["app.apples", "app.bananas"]);
	});

	it("fully orders a three-table chain in both directions", () => {
		const grandparent = table(app, "grandparent", { id: uuid().primaryKey() });
		const parent = table(
			app,
			"parent",
			{ id: uuid().primaryKey(), grandparentId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.grandparentId],
						references: { table: grandparent, columns: [grandparent.id] },
					},
				],
			}),
		);
		const child = table(
			app,
			"child",
			{ id: uuid().primaryKey(), parentId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.parentId],
						references: { table: parent, columns: [parent.id] },
					},
				],
			}),
		);
		const next = buildSnapshot(
			[
				app,
				getTableMeta(grandparent),
				getTableMeta(parent),
				getTableMeta(child),
			],
			registry,
			emptySnapshot,
		);

		const createOrder = diffSnapshots(emptySnapshot, next, registry)
			.filter((change) => change.kind === "table")
			.map((change) => change.identity);
		expect(createOrder).toEqual(["app.grandparent", "app.parent", "app.child"]);

		const dropOrder = diffSnapshots(next, emptySnapshot, registry)
			.filter((change) => change.kind === "table")
			.map((change) => change.identity);
		expect(dropOrder).toEqual(["app.child", "app.parent", "app.grandparent"]);
	});

	it("orders a table referencing two independent tables after both, without asserting the independents' own relative order", () => {
		const alpha = table(app, "alpha", { id: uuid().primaryKey() });
		const beta = table(app, "beta", { id: uuid().primaryKey() });
		const gamma = table(
			app,
			"gamma",
			{ id: uuid().primaryKey(), alphaId: uuid(), betaId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.alphaId],
						references: { table: alpha, columns: [alpha.id] },
					},
					{
						columns: [t.betaId],
						references: { table: beta, columns: [beta.id] },
					},
				],
			}),
		);
		const next = buildSnapshot(
			[app, getTableMeta(alpha), getTableMeta(beta), getTableMeta(gamma)],
			registry,
			emptySnapshot,
		);

		const createOrder = diffSnapshots(emptySnapshot, next, registry)
			.filter((change) => change.kind === "table")
			.map((change) => change.identity);
		expect(createOrder.at(-1)).toBe("app.gamma");
		expect(new Set(createOrder)).toEqual(
			new Set(["app.alpha", "app.beta", "app.gamma"]),
		);

		const dropOrder = diffSnapshots(next, emptySnapshot, registry)
			.filter((change) => change.kind === "table")
			.map((change) => change.identity);
		expect(dropOrder.at(0)).toBe("app.gamma");
	});

	it("never throws on a genuine two-table cycle -- both operations keep the pair in its existing identity order", () => {
		// A genuine mutual foreign-key cycle can't be built through table()
		// itself (its `extras` callback resolves `references: { table }`
		// eagerly, and the two tables would each need the other to already
		// exist) -- spliced directly at the snapshot level instead, the same
		// way the malformed-snapshot-node test above does.
		const cycleColumns: ReadonlyArray<ColumnSnapshot> = [
			{ name: "id", typeNode: { typeName: "uuid" }, primaryKey: true },
		];
		const cycleA: TableSnapshot = {
			schema: "app",
			name: "cycle_a",
			columns: [
				...cycleColumns,
				{ name: "b_id", typeNode: { typeName: "uuid" } },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "cycle_a_b_id_fk",
					columns: ["b_id"],
					referencesTable: "app.cycle_b",
					referencesColumns: ["id"],
				},
			],
		};
		const cycleB: TableSnapshot = {
			schema: "app",
			name: "cycle_b",
			columns: [
				...cycleColumns,
				{ name: "a_id", typeNode: { typeName: "uuid" } },
			],
			indexes: [],
			foreignKeys: [
				{
					name: "cycle_b_a_id_fk",
					columns: ["a_id"],
					referencesTable: "app.cycle_a",
					referencesColumns: ["id"],
				},
			],
		};
		const next: Snapshot = {
			...emptySnapshot,
			objects: {
				"schema:app": { name: "app" },
				"table:app.cycle_a": cycleA,
				"table:app.cycle_b": cycleB,
			},
		};

		const createOrder = diffSnapshots(emptySnapshot, next, registry)
			.filter((change) => change.kind === "table")
			.map((change) => change.identity);
		expect(createOrder).toEqual(["app.cycle_a", "app.cycle_b"]);

		const dropOrder = diffSnapshots(next, emptySnapshot, registry)
			.filter((change) => change.kind === "table")
			.map((change) => change.identity);
		expect(dropOrder).toEqual(["app.cycle_a", "app.cycle_b"]);
	});

	it("ignores a foreign key to a table outside this diff's own same-kind change set -- ordinary identity order", () => {
		const external = table(app, "external", { id: uuid().primaryKey() });
		const previous = buildSnapshot(
			[app, getTableMeta(external)],
			registry,
			emptySnapshot,
		);
		const local = table(
			app,
			"local",
			{ id: uuid().primaryKey(), externalId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.externalId],
						references: { table: external, columns: [external.id] },
					},
				],
			}),
		);
		const next = buildSnapshot(
			[app, getTableMeta(external), getTableMeta(local)],
			registry,
			previous,
		);

		const changes = diffSnapshots(previous, next, registry).filter(
			(change) => change.kind === "table",
		);
		expect(changes.map((change) => change.identity)).toEqual(["app.local"]);
		expect(changes.map((change) => change.operation)).toEqual(["create"]);
	});

	// Regression pin (D110): the pre-existing "no foreign key between these
	// two" case, unchanged by this refinement -- see "sorts changes by
	// identity (byte order) within the same kind" above.
});

// #753/task 1.3: a regression witness that this change leaves the
// already-correct *cross-kind* order alone -- the dependency graph this
// proposal names (foreign keys, a view's/policy's/trigger's own table, a
// trigger's own function, a sequence's owning table) is wider than the
// one real gap 1.1/1.2 close.
describe("diffSnapshots — cross-kind order (regression witness, #753)", () => {
	it("a schema, a table, its sequence-backed column, a trigger, an RLS policy, and a view all drop before the schema, and the view/trigger/policy all drop before the table", () => {
		const widgets = table(
			app,
			"widgets",
			{ id: serial().primaryKey(), suspendedAt: uuid() },
			(t) => ({
				rls: rls.enabled({
					readAll: rls
						.policy("widgets_read_all")
						.for("select")
						.to("reader")
						.using(isNull(t.suspendedAt)),
				}),
			}),
		);
		const guardTrigger = defineTrigger(
			widgets,
			{ name: "guard", timing: "before", events: ["insert"], forEach: "row" },
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		const widgetsView = defineView(app, "widgets_view", select(widgets));

		const next = generateMigration({
			declarations: [app, widgets, guardTrigger, widgetsView],
			previousSnapshot: emptySnapshot,
			registry,
		}).snapshot;

		const dropKindOrder = diffSnapshots(next, emptySnapshot, registry).map(
			(change) => change.kind,
		);

		// Pinned against rankKinds' own computed order (reversed for drop),
		// not a hand-copied literal -- so this pin tracks the real
		// dependency graph (dependsOn) instead of restating today's
		// incidental array order (task 1.3's own instruction).
		const rankOf = rankKinds(registry);
		const expectedKindOrder = Array.from(new Set(dropKindOrder)).sort(
			(a, b) => rankOf(b) - rankOf(a),
		);
		expect(dropKindOrder).toEqual(expectedKindOrder);
		expect(new Set(dropKindOrder)).toEqual(
			new Set([
				"view",
				"trigger",
				"policy",
				"rls",
				"function",
				"table",
				"sequence",
				"schema",
			]),
		);
	});
});

describe("diffSnapshots — no-op", () => {
	it("has no changes between identical snapshots", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildSnapshot(
			[app, getTableMeta(posts)],
			registry,
			emptySnapshot,
		);
		expect(diffSnapshots(snapshot, snapshot, registry)).toEqual([]);
	});
});

// #701/D3: diffSnapshots canonicalizes both sides before any kind's own
// diff runs, so a set-shaped array in a non-canonical order -- whichever
// side carries it, a hand-written previous or a snapshot on disk written
// before this order was canonical -- never surfaces as a change. A real
// member added is still reported, on either side.
describe("diffSnapshots — canonicalizes both sides before comparing (#701)", () => {
	const buildPolicySnapshot = (roles: ReadonlyArray<string>): Snapshot => {
		const posts = table(app, "posts", { id: uuid().primaryKey() }, () => ({
			rls: rls.enabled({
				read: rls
					.policy("posts_read")
					.for("select")
					.to(...roles)
					.using(literal(true)),
			}),
		}));
		const meta = getTableMeta(posts);
		if (meta.rls === null) {
			throw new Error("expected rls declaration");
		}
		return buildSnapshot(
			[app, meta, meta.rls, ...meta.rls.policies],
			registry,
			emptySnapshot,
		);
	};

	const withUncanonicalRoles = (
		snapshot: Snapshot,
		roles: ReadonlyArray<string>,
	): Snapshot => ({
		...snapshot,
		objects: {
			...snapshot.objects,
			"policy:app.posts.posts_read": {
				...(snapshot.objects["policy:app.posts.posts_read"] as Record<
					string,
					unknown
				>),
				roles,
			},
		},
	});

	it("an uncanonical previous against a canonical next is not a change", () => {
		const canonical = buildPolicySnapshot(["a", "b"]);
		const uncanonicalPrevious = withUncanonicalRoles(canonical, ["b", "a"]);
		expect(diffSnapshots(uncanonicalPrevious, canonical, registry)).toEqual([]);
	});

	it("a canonical previous against an uncanonical next is not a change", () => {
		const canonical = buildPolicySnapshot(["a", "b"]);
		const uncanonicalNext = withUncanonicalRoles(canonical, ["b", "a"]);
		expect(diffSnapshots(canonical, uncanonicalNext, registry)).toEqual([]);
	});

	it("a role added is still a reported alter, whichever side started uncanonical", () => {
		const before = withUncanonicalRoles(buildPolicySnapshot(["a", "b"]), [
			"b",
			"a",
		]);
		const after = buildPolicySnapshot(["a", "b", "c"]);
		const changes = diffSnapshots(before, after, registry);
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ kind: "policy", operation: "alter" });
	});
});

describe("diffSnapshots — malformed snapshot node (#26)", () => {
	it("wraps a raw crash from a malformed table node into malformed-snapshot-node, naming the entry", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const next = buildSnapshot(
			[app, getTableMeta(posts)],
			registry,
			emptySnapshot,
		);
		const corruptedPrevious = {
			...next,
			objects: {
				...next.objects,
				"table:app.posts": { schema: "app", name: "posts" }, // missing columns/indexes/foreignKeys
			},
		};
		expect(() => diffSnapshots(corruptedPrevious, next, registry)).toThrowError(
			expect.objectContaining({
				code: "malformed-snapshot-node",
				message: expect.stringContaining('"table:app.posts"'),
			}),
		);
	});
});

// #774: a kind reporting more than one change for the same identity in the
// same direction must not lose any of them through the same-kind
// refinement's byIdentity reassembly. This kind is a bare `ObjectKind`
// literal, not `tableKind` -- the refinement is generic over any kind's
// `dependsOnIdentities`, and no built-in kind ever reports two
// same-identity, same-direction changes, so exercising the real gap needs
// a purpose-built kind. `identify` is never called on this path
// (`diffSnapshots` derives identity from the snapshot key itself), so it
// is a stub.
type TestKindNode = {
	readonly dependsOn: ReadonlyArray<string>;
	readonly reports: ReadonlyArray<{
		readonly operation: ChangeOperation;
		readonly note: string;
	}>;
};

const asTestKindNode = (node: JsonValue): TestKindNode =>
	node as unknown as TestKindNode;

/** A create/alter's own change carries the node under `next`; a drop's under `previous` -- never both null, since `nodeForOrdering` (diff-engine.ts) reads whichever side a given operation carries. */
const sideForOperation = (
	operation: ChangeOperation,
	node: TestKindNode,
): { readonly previous: JsonValue | null; readonly next: JsonValue | null } => {
	if (operation === "create") {
		return { previous: null, next: node as unknown as JsonValue };
	}
	if (operation === "drop") {
		return { previous: node as unknown as JsonValue, next: null };
	}
	return {
		previous: node as unknown as JsonValue,
		next: node as unknown as JsonValue,
	};
};

/** `withDependsOnIdentities` toggles whether the registered kind takes part in the same-kind refinement at all -- the control row (#774) needs a kind that doesn't. */
const makeTestKind = (
	kindName: string,
	withDependsOnIdentities: boolean,
): ObjectKind<HejbroDeclaration> => {
	const base: ObjectKind<HejbroDeclaration> = {
		kind: kindName,
		dependsOn: [],
		owns: (declaration: HejbroDeclaration): declaration is HejbroDeclaration =>
			declaration !== null && false,
		serialize: (declaration) => declaration as unknown as JsonValue,
		identify: () => "unused",
		diff: (previousNode, nextNode, identity) => {
			const node = asTestKindNode((nextNode ?? previousNode) as JsonValue);
			return node.reports.map((report) => ({
				kind: kindName,
				operation: report.operation,
				identity,
				...sideForOperation(report.operation, node),
				notes: [report.note],
			}));
		},
		emit: () => [],
	};
	if (!withDependsOnIdentities) {
		return base;
	}
	return {
		...base,
		dependsOnIdentities: (node) => asTestKindNode(node).dependsOn,
	};
};

describe("diffSnapshots — every change a kind reports for one identity survives the same-kind refinement (#774)", () => {
	type Row = {
		readonly label: string;
		readonly kindName: string;
		readonly withDependsOnIdentities: boolean;
		readonly nodes: ReadonlyArray<{
			readonly identity: string;
			readonly dependsOn?: ReadonlyArray<string>;
			readonly reports: ReadonlyArray<{
				readonly operation: ChangeOperation;
				readonly note: string;
			}>;
		}>;
		readonly expected: ReadonlyArray<{
			readonly identity: string;
			readonly operation: ChangeOperation;
			readonly notes: ReadonlyArray<string>;
		}>;
	};

	const rows: ReadonlyArray<Row> = [
		{
			label: "two creates for one identity",
			kindName: "test-kind",
			withDependsOnIdentities: true,
			nodes: [
				{
					identity: "app.b",
					reports: [
						{ operation: "create", note: "b#1" },
						{ operation: "create", note: "b#2" },
					],
				},
			],
			expected: [
				{ identity: "app.b", operation: "create", notes: ["b#1"] },
				{ identity: "app.b", operation: "create", notes: ["b#2"] },
			],
		},
		{
			label: "three alters for one identity",
			kindName: "test-kind",
			withDependsOnIdentities: true,
			nodes: [
				{
					identity: "app.b",
					reports: [
						{ operation: "alter", note: "b#1" },
						{ operation: "alter", note: "b#2" },
						{ operation: "alter", note: "b#3" },
					],
				},
			],
			expected: [
				{ identity: "app.b", operation: "alter", notes: ["b#1"] },
				{ identity: "app.b", operation: "alter", notes: ["b#2"] },
				{ identity: "app.b", operation: "alter", notes: ["b#3"] },
			],
		},
		{
			label: "two drops for one identity",
			kindName: "test-kind",
			withDependsOnIdentities: true,
			nodes: [
				{
					identity: "app.b",
					reports: [
						{ operation: "drop", note: "b#1" },
						{ operation: "drop", note: "b#2" },
					],
				},
			],
			expected: [
				{ identity: "app.b", operation: "drop", notes: ["b#1"] },
				{ identity: "app.b", operation: "drop", notes: ["b#2"] },
			],
		},
		{
			label: "a create and a drop for one identity",
			kindName: "test-kind",
			withDependsOnIdentities: true,
			nodes: [
				{
					identity: "app.b",
					reports: [
						{ operation: "create", note: "b-create" },
						{ operation: "drop", note: "b-drop" },
					],
				},
			],
			expected: [
				{ identity: "app.b", operation: "create", notes: ["b-create"] },
				{ identity: "app.b", operation: "drop", notes: ["b-drop"] },
			],
		},
		{
			label:
				"two creates for app.b, which depends on app.c -- app.c first though app.b sorts first alphabetically",
			kindName: "test-kind",
			withDependsOnIdentities: true,
			nodes: [
				{
					identity: "app.b",
					dependsOn: ["app.c"],
					reports: [
						{ operation: "create", note: "b#1" },
						{ operation: "create", note: "b#2" },
					],
				},
				{
					identity: "app.c",
					reports: [{ operation: "create", note: "c#1" }],
				},
			],
			expected: [
				{ identity: "app.c", operation: "create", notes: ["c#1"] },
				{ identity: "app.b", operation: "create", notes: ["b#1"] },
				{ identity: "app.b", operation: "create", notes: ["b#2"] },
			],
		},
		{
			label:
				"control: a kind without dependsOnIdentities reporting two creates for one identity",
			kindName: "control-kind",
			withDependsOnIdentities: false,
			nodes: [
				{
					identity: "app.b",
					reports: [
						{ operation: "create", note: "b#1" },
						{ operation: "create", note: "b#2" },
					],
				},
			],
			expected: [
				{ identity: "app.b", operation: "create", notes: ["b#1"] },
				{ identity: "app.b", operation: "create", notes: ["b#2"] },
			],
		},
	];

	it.each(rows)(
		"$label",
		({ kindName, withDependsOnIdentities, nodes, expected }) => {
			const testRegistry = createKindRegistry();
			testRegistry.register(makeTestKind(kindName, withDependsOnIdentities));
			const next: Snapshot = {
				...emptySnapshot,
				objects: Object.fromEntries(
					nodes.map((node) => {
						const value: TestKindNode = {
							dependsOn: node.dependsOn ?? [],
							reports: node.reports,
						};
						return [
							`${kindName}:${node.identity}`,
							value as unknown as JsonValue,
						] as const;
					}),
				),
			};
			const changes = diffSnapshots(emptySnapshot, next, testRegistry)
				.filter((change) => change.kind === kindName)
				.map((change) => ({
					identity: change.identity,
					operation: change.operation,
					notes: change.notes,
				}));
			expect(changes).toEqual(expected);
		},
	);
});
