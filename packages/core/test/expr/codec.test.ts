import { describe, expect, it } from "vitest";
import type { ExprNode, SetOpNode } from "../../src/expr/ast";
import {
	decodeExprNode,
	decodeQueryNode,
	decodeSelectNode,
	encodeExprNode,
	encodeQueryNode,
	encodeSelectNode,
	NODE_KIND_TO_SNAPSHOT,
	PROJECTION_KIND_TO_SNAPSHOT,
} from "../../src/expr/codec";
import { retargetExprNode } from "../../src/expr/retarget";
import {
	eq,
	jsonArrayFrom,
	jsonObjectFrom,
	schema,
	select,
	table,
	text,
	uuid,
} from "../../src/index";
import type { JsonValue } from "../../src/snapshot/stable-json";

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// #110: encode (ExprNode -> snapshot form) and decode (snapshot form ->
// ExprNode) must round-trip losslessly in both directions -- this is what
// lets rename-plan.ts decode a stored node, retarget identifiers, and
// re-encode it (D67), and what lets emit re-render a stored node back to
// SQL via the existing renderExpr (untouched by this codec).
describe("expr codec — round-trip", () => {
	const cases: ReadonlyArray<readonly [string, ExprNode]> = [
		[
			"literal (string)",
			{ nodeKind: "literal", literal: { literalKind: "string", value: "hi" } },
		],
		[
			"literal (number)",
			{ nodeKind: "literal", literal: { literalKind: "number", value: 42 } },
		],
		[
			"literal (boolean)",
			{
				nodeKind: "literal",
				literal: { literalKind: "boolean", value: false },
			},
		],
		[
			"literal (null)",
			{ nodeKind: "literal", literal: { literalKind: "null" } },
		],
		[
			"literal (timestamp)",
			{
				nodeKind: "literal",
				literal: {
					literalKind: "timestamp",
					isoValue: "2026-08-21T00:00:00.000Z",
				},
			},
		],
		[
			"columnRef",
			{
				nodeKind: "columnRef",
				schemaName: "app",
				tableName: "posts",
				columnName: "id",
			},
		],
		["plpgsqlRef", { nodeKind: "plpgsqlRef", path: ["new", "post_id"] }],
		[
			"comparison (SQL-token operator with a space, untouched)",
			{
				nodeKind: "comparison",
				operator: "not like",
				left: {
					nodeKind: "columnRef",
					schemaName: "app",
					tableName: "posts",
					columnName: "title",
				},
				right: {
					nodeKind: "literal",
					literal: { literalKind: "string", value: "draft%" },
				},
			},
		],
		[
			"logical",
			{
				nodeKind: "logical",
				operator: "and",
				operands: [
					{
						nodeKind: "literal",
						literal: { literalKind: "boolean", value: true },
					},
					{
						nodeKind: "literal",
						literal: { literalKind: "boolean", value: false },
					},
				],
			},
		],
		[
			"not",
			{
				nodeKind: "not",
				operand: {
					nodeKind: "literal",
					literal: { literalKind: "boolean", value: true },
				},
			},
		],
		[
			"nullTest",
			{
				nodeKind: "nullTest",
				negated: true,
				operand: {
					nodeKind: "columnRef",
					schemaName: "app",
					tableName: "posts",
					columnName: "published_at",
				},
			},
		],
		[
			"inList",
			{
				nodeKind: "inList",
				negated: false,
				operand: {
					nodeKind: "columnRef",
					schemaName: "app",
					tableName: "posts",
					columnName: "status",
				},
				values: [
					{
						nodeKind: "literal",
						literal: { literalKind: "string", value: "draft" },
					},
					{
						nodeKind: "literal",
						literal: { literalKind: "string", value: "published" },
					},
				],
			},
		],
		[
			"between",
			{
				nodeKind: "between",
				negated: false,
				operand: {
					nodeKind: "columnRef",
					schemaName: "app",
					tableName: "posts",
					columnName: "price",
				},
				lowerBound: {
					nodeKind: "literal",
					literal: { literalKind: "number", value: 0 },
				},
				upperBound: {
					nodeKind: "literal",
					literal: { literalKind: "number", value: 100 },
				},
			},
		],
		[
			"functionCall (schema-qualified)",
			{
				nodeKind: "functionCall",
				schemaName: "auth",
				functionName: "uid",
				args: [],
			},
		],
		[
			"functionCall (unqualified, null schema)",
			{
				nodeKind: "functionCall",
				schemaName: null,
				functionName: "now",
				args: [],
			},
		],
		[
			"sqlTemplate",
			{
				nodeKind: "sqlTemplate",
				chunks: [
					{ chunkKind: "text", text: "lower(" },
					{
						chunkKind: "expr",
						expr: {
							nodeKind: "columnRef",
							schemaName: "app",
							tableName: "posts",
							columnName: "title",
						},
					},
					{ chunkKind: "text", text: ")" },
				],
			},
		],
		["rawSql", { nodeKind: "rawSql", sql: "now() at time zone 'utc'" }],
		[
			"exists (full SelectNode: allColumns projection, join, orderBy, limit)",
			{
				nodeKind: "exists",
				negated: false,
				query: {
					queryKind: "select",
					projection: {
						projectionKind: "allColumns",
						columnNames: ["id", "post_id"],
					},
					from: { schemaName: "app", tableName: "comments" },
					joins: [
						{
							joinKind: "inner",
							table: { schemaName: "app", tableName: "posts" },
							on: {
								nodeKind: "comparison",
								operator: "=",
								left: {
									nodeKind: "columnRef",
									schemaName: "app",
									tableName: "comments",
									columnName: "post_id",
								},
								right: {
									nodeKind: "columnRef",
									schemaName: "app",
									tableName: "posts",
									columnName: "id",
								},
							},
						},
					],
					where: {
						nodeKind: "nullTest",
						negated: true,
						operand: {
							nodeKind: "columnRef",
							schemaName: "app",
							tableName: "posts",
							columnName: "published_at",
						},
					},
					orderBy: [
						{
							expr: {
								nodeKind: "columnRef",
								schemaName: "app",
								tableName: "comments",
								columnName: "created_at",
							},
							direction: "desc",
						},
					],
					limit: 1,
					offset: null,
					groupBy: [],
					having: null,
					distinct: null,
				},
			},
		],
		[
			"exists (columns projection, constantOne, no joins/where/orderBy/limit)",
			{
				nodeKind: "exists",
				negated: true,
				query: {
					queryKind: "select",
					projection: { projectionKind: "constantOne" },
					from: { schemaName: "app", tableName: "comments" },
					joins: [],
					where: null,
					groupBy: [],
					having: null,
					orderBy: [],
					limit: null,
					offset: null,
					distinct: null,
				},
			},
		],
	];

	it.each(cases)("round-trips: %s", (_label, node) => {
		const encoded = encodeExprNode(node);
		const decoded = decodeExprNode(encoded);
		expect(decoded).toEqual(node);
		// re-encoding the decoded node must be byte-identical to the first
		// encoding -- proves the round trip is stable, not just "decodable".
		expect(encodeExprNode(decoded)).toEqual(encoded);
	});

	it("kebab-cases every discriminator value it introduces (spot check, full audit lives in naming-conventions.test.ts)", () => {
		const encoded = encodeExprNode({
			nodeKind: "columnRef",
			schemaName: "app",
			tableName: "posts",
			columnName: "id",
		}) as { readonly nodeKind: string };
		expect(encoded.nodeKind).toBe("column-ref");
	});

	it("does not kebab-case SQL's own tokens (comparison operator, order-by direction)", () => {
		const encoded = encodeExprNode({
			nodeKind: "comparison",
			operator: "not like",
			left: { nodeKind: "rawSql", sql: "a" },
			right: { nodeKind: "rawSql", sql: "b" },
		}) as { readonly operator: string };
		expect(encoded.operator).toBe("not like");
	});

	// reviewer finding: round-trip tests structurally can't catch a
	// wrong-but-internally-consistent map entry -- encode and decode
	// share the SAME map, so encode(decode(encode(x))) === encode(x)
	// holds even if every entry is spelled wrong the same way. Proven by
	// reproducing the exact case the reviewer found: NODE_KIND_TO_SNAPSHOT
	// mapped "rawSql" -> "rawSql" (camelCase, not kebab) and every test
	// in this file -- and naming-conventions.test.ts's recursive walker,
	// which only ever sees whatever the one hand-written fixture happens
	// to construct -- stayed green. Only a direct assertion against the
	// map's own values closes this: the map IS the whole vocabulary,
	// independent of what any test declaration happens to construct.
	it("every discriminator value in the encoding maps is kebab-case (closes what round-trip tests structurally can't catch)", () => {
		const nodeKindOffenders = Object.values(NODE_KIND_TO_SNAPSHOT).filter(
			(value) => !KEBAB_CASE.test(value),
		);
		const projectionKindOffenders = Object.values(
			PROJECTION_KIND_TO_SNAPSHOT,
		).filter((value) => !KEBAB_CASE.test(value));
		expect(nodeKindOffenders).toEqual([]);
		expect(projectionKindOffenders).toEqual([]);
	});

	// reviewer round 2 (item 65's sibling, 🔴2a): "is kebab-case in
	// isolation" is a weaker check than it looks -- a single-segment value
	// like "columnref" (no hyphen) is valid kebab syntax too, so the check
	// above wouldn't catch a spelling that's kebab-*shaped* but wrong. This
	// computes the expected spelling independently from each map's own KEY
	// (the same transform D70 documents: split camelCase word boundaries,
	// lower-case, hyphenate) and asserts every VALUE equals it exactly --
	// pinning the map's own internal consistency, not just its syntax.
	const camelToKebab = (key: string): string =>
		key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

	it("every value in the encoding maps is exactly the kebab-case transform of its own key (not just kebab-shaped)", () => {
		const nodeKindOffenders = Object.entries(NODE_KIND_TO_SNAPSHOT).filter(
			([key, value]) => value !== camelToKebab(key),
		);
		const projectionKindOffenders = Object.entries(
			PROJECTION_KIND_TO_SNAPSHOT,
		).filter(([key, value]) => value !== camelToKebab(key));
		expect(nodeKindOffenders).toEqual([]);
		expect(projectionKindOffenders).toEqual([]);
	});

	// reviewer finding: decodeJoin/decodeSelectNode were fail-open --
	// they called asRecord to confirm the node is an object, then
	// hard-coded joinKind: "inner" / queryKind: "select" without ever
	// reading the actual field. A snapshot with joinKind: "left" (not a
	// value hejbro's own encoder ever writes today, but JoinNode only has
	// one variant, so nothing stopped a malformed or future-version file
	// from silently decoding as "inner" instead) -- a silent, meaning-
	// changing corruption. decodeProjection/decodeLiteral/
	// decodeSqlTemplateChunk all validate and throw on an unrecognized
	// value; these two now match that pattern.
	//
	// Reviewer round 2 sharpened the red-first reproduction of this exact
	// symptom: decoding `{ joinKind: "left", ... }` against the pre-fix
	// code and asserting the RESULT equals `"left"` is red for a reason
	// that "expect a throw" alone doesn't show -- it fails with
	// `Expected: "left", Received: "inner"`, i.e. the decoder didn't
	// merely fail to validate, it silently substituted a *different*,
	// wrong value. (Reproduced directly against the pre-fix decodeJoin
	// from commit f9b3523, then cleaned up -- not kept as a permanent
	// test, since JoinNode's type has only ever had the "inner" variant:
	// once the fix makes the decoder reject anything else, "assert the
	// result equals left" can no longer be the shape of a passing test --
	// the assertion below, "rejects instead of silently decoding wrong",
	// is what a decoder that validates its input looks like.)
	it("decodes a left join (#293 group 1: left is a real variant now)", () => {
		const decoded = decodeExprNode({
			nodeKind: "exists",
			negated: false,
			query: {
				queryKind: "select",
				projection: { projectionKind: "constant-one" },
				from: { schema: "app", table: "posts" },
				joins: [
					{
						joinKind: "left",
						table: { schema: "app", table: "authors" },
						on: {
							nodeKind: "literal",
							literal: { literalKind: "boolean", value: true },
						},
					},
				],
				where: null,
				groupBy: [],
				having: null,
				orderBy: [],
				limit: null,
				offset: null,
				distinct: null,
			},
		});
		if (decoded.nodeKind !== "exists") {
			throw new Error("expected an exists node");
		}
		expect(decoded.query.joins[0]?.joinKind).toBe("left");
	});

	it("rejects an unrecognized joinKind instead of silently decoding as inner", () => {
		const malformed = {
			nodeKind: "exists",
			negated: false,
			query: {
				queryKind: "select",
				projection: { projectionKind: "constant-one" },
				from: { schema: "app", table: "posts" },
				joins: [
					{
						joinKind: "right",
						table: { schema: "app", table: "authors" },
						on: {
							nodeKind: "literal",
							literal: { literalKind: "boolean", value: true },
						},
					},
				],
				where: null,
				groupBy: [],
				having: null,
				orderBy: [],
				limit: null,
				offset: null,
				distinct: null,
			},
		};
		expect(() => decodeExprNode(malformed)).toThrowError(
			expect.objectContaining({ code: "malformed-snapshot-node" }),
		);
	});

	it("rejects an unrecognized queryKind instead of silently decoding as select", () => {
		const malformed = {
			nodeKind: "exists",
			negated: false,
			query: {
				queryKind: "insert",
				projection: { projectionKind: "constant-one" },
				from: { schema: "app", table: "posts" },
				joins: [],
				where: null,
				groupBy: [],
				having: null,
				orderBy: [],
				limit: null,
				offset: null,
				distinct: null,
			},
		};
		expect(() => decodeExprNode(malformed)).toThrowError(
			expect.objectContaining({ code: "malformed-snapshot-node" }),
		);
	});

	// #154 ratchet-5: decodeLiteral's malformed-input fallback (an
	// unrecognized literalKind, unlike encodeLiteral's structurally
	// unreachable assertNever default -- literalKind comes from unvalidated
	// JSON, not a closed TypeScript union) had no test at all.
	it("rejects an unrecognized literalKind instead of silently decoding as one of the known kinds", () => {
		const malformed = {
			nodeKind: "literal",
			literal: { literalKind: "date", value: "2026-01-01" },
		};
		expect(() => decodeExprNode(malformed)).toThrowError(
			expect.objectContaining({ code: "malformed-snapshot-node" }),
		);
	});
});

describe("select-as-expression codec round-trip (add-relational-reads task 2.3)", () => {
	it("the node survives encode/decode with kebab discriminators", () => {
		const app = schema("app");
		const comments = table(app, "comments", {
			id: uuid().primaryKey(),
			postId: uuid().notNull(),
		});
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const node = jsonArrayFrom(
			select({ id: comments.id }, comments).where(
				eq(comments.postId, posts.id),
			),
		).exprNode;
		const encoded = encodeExprNode(node);
		expect(JSON.stringify(encoded)).toContain('"select-expr"');
		expect(JSON.stringify(encoded)).toContain('"json-array"');
		// `resultKey` is TS-side only and documented absent on a decoded
		// node (the ProjectionNode contract) -- compare modulo that field.
		const dropResultKey = (key: string, value: unknown): unknown => {
			if (key === "resultKey") {
				return undefined;
			}
			return value;
		};
		const withoutResultKeys = JSON.parse(JSON.stringify(node, dropResultKey));
		expect(decodeExprNode(encoded as never)).toEqual(withoutResultKeys);
	});
});

describe("select-as-expression retarget and both modes (group 2 review F3/F4)", () => {
	const app = schema("app");
	const comments = table(app, "comments", {
		id: uuid().primaryKey(),
		postId: uuid().notNull(),
	});
	const posts = table(app, "posts", { id: uuid().primaryKey() });

	it("retargets the embedded query on a table rename, and returns the same reference when unrelated (F3)", () => {
		const node = jsonArrayFrom(
			select({ id: comments.id }, comments).where(
				eq(comments.postId, posts.id),
			),
		).exprNode;
		const renamed = retargetExprNode(node, {
			oldSchema: "app",
			oldTable: "comments",
			newSchema: "app",
			newTable: "remarks",
			oldColumn: null,
			newColumn: null,
		});
		expect(JSON.stringify(renamed)).toContain('"remarks"');
		expect(JSON.stringify(renamed)).not.toContain('"comments"');
		const untouched = retargetExprNode(node, {
			oldSchema: "app",
			oldTable: "elsewhere",
			newSchema: "app",
			newTable: "nowhere",
			oldColumn: null,
			newColumn: null,
		});
		expect(untouched).toBe(node);
	});

	it("round-trips both modes and refuses an unknown one loudly (F4)", () => {
		const modes = [
			[jsonArrayFrom, '"json-array"'],
			[jsonObjectFrom, '"json-object"'],
		] as const;
		for (const [build, kebab] of modes) {
			const node = build(select({ id: comments.id }, comments)).exprNode;
			const encoded = encodeExprNode(node);
			expect(JSON.stringify(encoded)).toContain(kebab);
			const dropResultKey = (key: string, value: unknown): unknown => {
				if (key === "resultKey") {
					return undefined;
				}
				return value;
			};
			expect(decodeExprNode(encoded as never)).toEqual(
				JSON.parse(JSON.stringify(node, dropResultKey)),
			);
		}
		const corrupted = JSON.parse(
			JSON.stringify(
				encodeExprNode(
					jsonArrayFrom(select({ id: comments.id }, comments)).exprNode,
				),
			),
		);
		corrupted.mode = "json-mystery";
		expect(() => decodeExprNode(corrupted)).toThrowError(/json-mystery|mode/);
	});
});

describe("set-op codec round-trip (add-set-operations task 1.3)", () => {
	const app = schema("app");
	const posts = table(app, "posts", { id: uuid().primaryKey() });
	const others = table(app, "others", { id: uuid().primaryKey() });

	it("a set-op statement survives encode/decode with kebab discriminators", () => {
		const node: SetOpNode = {
			queryKind: "setOp",
			operator: "except",
			all: true,
			left: {
				queryKind: "setOp",
				operator: "union",
				all: false,
				left: select(posts).selectQuery,
				right: select(others).selectQuery,
				orderBy: [],
				limit: null,
				offset: null,
			},
			right: select(posts).selectQuery,
			orderBy: [{ expr: posts.id.exprNode, direction: "asc" }],
			limit: 5,
			offset: null,
		};
		const encoded = encodeQueryNode(node);
		expect(JSON.stringify(encoded)).toContain('"set-op"');
		expect(JSON.stringify(encoded)).not.toContain('"setOp"');
		expect(decodeQueryNode(encoded)).toEqual(
			JSON.parse(
				JSON.stringify(node, (key, value) => {
					if (key === "resultKey") {
						return undefined;
					}
					return value;
				}),
			),
		);
	});

	it("the plain-select decoder rejects a set-op loudly", () => {
		const encoded = encodeQueryNode({
			queryKind: "setOp",
			operator: "union",
			all: false,
			left: select(posts).selectQuery,
			right: select(others).selectQuery,
			orderBy: [],
			limit: null,
			offset: null,
		});
		expect(() => decodeSelectNode(encoded)).toThrowError(/set-op|queryKind/);
	});
});

describe("set-op codec guards (review F6)", () => {
	it("an unknown operator in a stored set-op is refused loudly", () => {
		const app2 = schema("app");
		const posts2 = table(app2, "posts2", { id: uuid().primaryKey() });
		const corrupted = JSON.parse(
			JSON.stringify(
				encodeQueryNode(select(posts2).union(select(posts2)).setOpQuery),
			),
		);
		corrupted.operator = "symmetric-difference";
		expect(() => decodeQueryNode(corrupted)).toThrowError(
			/symmetric-difference|operator/,
		);
	});
});

describe("distinct codec round-trip and guards (#437)", () => {
	const app3 = schema("app");
	const posts3 = table(app3, "posts3", {
		id: uuid().primaryKey(),
		status: text().notNull(),
	});

	it("round-trips distinct, distinct on, and the absent case", () => {
		const plain = select(posts3).distinct().selectQuery;
		expect(decodeSelectNode(encodeSelectNode(plain))).toEqual(plain);

		const on = select(posts3)
			.distinctOn(posts3.status)
			.limit(5)
			.offset(2).selectQuery;
		const revived = decodeSelectNode(encodeSelectNode(on));
		expect(revived).toEqual(on);
		expect(revived.offset).toBe(2);

		const absent = select(posts3).selectQuery;
		expect(decodeSelectNode(encodeSelectNode(absent)).distinct).toBeNull();
	});

	it("an unknown distinctKind is refused loudly", () => {
		const corrupted = JSON.parse(
			JSON.stringify(encodeSelectNode(select(posts3).distinct().selectQuery)),
		);
		corrupted.distinct.distinctKind = "on-steroids";
		expect(() => decodeSelectNode(corrupted)).toThrowError(
			/on-steroids|distinctKind/,
		);
	});

	// #444 F7 revises this: a MISSING clause key is now the pre-#437/#438/
	// #443 v8 shape leniency exists for (a v8 file written before this
	// field existed at all), so it decodes to the field's empty value
	// instead of throwing -- superseding the narrower pre-#444 guard this
	// test used to assert ("fails loudly, never silently"). A distinct key
	// that IS present but malformed still throws (the test right below).
	it("a snapshot missing the distinct key entirely decodes as no distinct (pre-#437 v8 shape, F7)", () => {
		const corrupted = JSON.parse(
			JSON.stringify(encodeSelectNode(select(posts3).distinct().selectQuery)),
		);
		corrupted.distinct = undefined;
		expect(decodeSelectNode(corrupted).distinct).toBeNull();
	});

	it("a present but malformed distinct value still fails loudly", () => {
		const corrupted = JSON.parse(
			JSON.stringify(encodeSelectNode(select(posts3).distinct().selectQuery)),
		);
		corrupted.distinct = "not an object";
		expect(() => decodeSelectNode(corrupted)).toThrowError(
			expect.objectContaining({ code: "malformed-snapshot-node" }),
		);
	});

	// #444 review R4: decodeDistinct's "on" branch used to call
	// `.map(decodeExprNode)` on `node.columns` unconditionally, raw-
	// TypeErroring instead of a coded diagnostic when `columns` was
	// missing or not an array -- the same missing-vs-malformed leniency
	// group 2 already gave `groupBy` (decodeExprArrayField), reused here.
	it("a distinct on node missing its columns key decodes as an empty column list", () => {
		const corrupted = JSON.parse(
			JSON.stringify(
				encodeSelectNode(select(posts3).distinctOn(posts3.status).selectQuery),
			),
		);
		corrupted.distinct.columns = undefined;
		expect(decodeSelectNode(corrupted).distinct).toEqual({
			distinctKind: "on",
			columns: [],
		});
	});

	it("a distinct on node with a non-array columns value fails loudly, never a raw TypeError", () => {
		const corrupted = JSON.parse(
			JSON.stringify(
				encodeSelectNode(select(posts3).distinctOn(posts3.status).selectQuery),
			),
		);
		corrupted.distinct.columns = "not an array";
		expect(() => decodeSelectNode(corrupted)).toThrowError(
			expect.objectContaining({ code: "malformed-snapshot-node" }),
		);
	});
});

// #444 F7: `groupBy`/`having`/`distinct`/`limit`/`offset` were all added
// after v8's original shape (#437/#438/#443) -- a pre-extension v8
// snapshot has none of them, and decodeSelectNode used to raw-TypeError
// on the first one it touched (`node.groupBy.map` on `undefined`) instead
// of a coded diagnostic or a lenient default.
describe("decodeSelectNode leniency for a pre-extension v8 snapshot (#444 F7)", () => {
	const preExtensionSelect = (): { readonly [key: string]: JsonValue } => ({
		queryKind: "select",
		projection: { projectionKind: "constant-one" },
		from: { schema: "app", table: "posts" },
		joins: [],
		where: null,
		orderBy: [],
		// groupBy, having, limit, offset, distinct: absent, as a v8 file
		// written before #438/#443 would have them.
	});

	it("decodes a pre-extension v8 select node without its clause fields", () => {
		const decoded = decodeSelectNode(preExtensionSelect());
		expect(decoded.groupBy).toEqual([]);
		expect(decoded.having).toBeNull();
		expect(decoded.limit).toBeNull();
		expect(decoded.offset).toBeNull();
		expect(decoded.distinct).toBeNull();
	});

	it("fails with a coded diagnostic on a malformed clause field", () => {
		const malformed = { ...preExtensionSelect(), groupBy: "not an array" };
		expect(() => decodeSelectNode(malformed)).toThrowError(
			expect.objectContaining({ code: "malformed-snapshot-node" }),
		);
	});
});
