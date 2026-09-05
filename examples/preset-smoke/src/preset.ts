import type { Expr, JsonValue, ObjectKind } from "@hejbro/core";
import {
	assertNever,
	expr,
	quoteIdentifier,
	quoteStringLiteral,
	requireNext,
	requirePrevious,
	sameJson,
	statement,
} from "@hejbro/core";

/**
 * A toy declaration proving `@hejbro/core`'s provider extension interface
 * (spec §4.1) is generic — it carries zero Supabase concepts, unlike
 * `@hejbro/supabase`'s built-in kinds.
 */
export type SchemaNoteDeclaration = {
	readonly declarationKind: "smoke-schema-note";
	readonly schemaName: string;
	readonly note: string;
};

/** Declares a `comment on schema` note. */
export const schemaNote = (
	schemaName: string,
	note: string,
): SchemaNoteDeclaration => ({
	declarationKind: "smoke-schema-note",
	schemaName,
	note,
});

type SchemaNoteSnapshot = {
	readonly schemaName: string;
	readonly note: string;
};

// Internal invariant: this shape is exactly what schemaNoteKind.serialize below produces.
const asSchemaNoteSnapshot = (snapshot: JsonValue): SchemaNoteSnapshot =>
	snapshot as SchemaNoteSnapshot;

/**
 * A custom object kind (`smoke-schema-note`) built entirely on
 * `@hejbro/core`'s public `ObjectKind` interface — the same interface
 * `@hejbro/supabase`'s storage bucket kind uses, proving it needs no
 * provider-specific special case. Identity is the schema name; `create`/
 * `alter` emit `comment on schema … is '…';`, `drop` clears the comment
 * (`is null`) — the standard create/drop/alter diff shape.
 */
export const schemaNoteKind: ObjectKind<SchemaNoteDeclaration> = {
	kind: "smoke-schema-note",
	dependsOn: ["schema"],
	owns: (declaration): declaration is SchemaNoteDeclaration =>
		declaration.declarationKind === "smoke-schema-note",
	serialize: (declaration) => ({
		schemaName: declaration.schemaName,
		note: declaration.note,
	}),
	identify: (snapshot) => asSchemaNoteSnapshot(snapshot).schemaName,
	diff: (previous, next, identity) => {
		if (previous === null && next !== null) {
			return [
				{
					kind: "smoke-schema-note",
					operation: "create",
					identity,
					previous: null,
					next,
					notes: [],
				},
			];
		}
		if (previous !== null && next === null) {
			return [
				{
					kind: "smoke-schema-note",
					operation: "drop",
					identity,
					previous,
					next: null,
					notes: [],
				},
			];
		}
		if (previous === null || next === null) {
			return [];
		}
		if (sameJson(previous, next)) {
			return [];
		}
		return [
			{
				kind: "smoke-schema-note",
				operation: "alter",
				identity,
				previous,
				next,
				notes: [],
			},
		];
	},
	emit: (change) => {
		switch (change.operation) {
			case "create":
			case "alter": {
				const snapshot = asSchemaNoteSnapshot(requireNext(change));
				return [
					statement(
						`comment on schema ${quoteIdentifier(snapshot.schemaName)} is ${quoteStringLiteral(snapshot.note)};`,
					),
				];
			}
			case "drop": {
				const snapshot = asSchemaNoteSnapshot(requirePrevious(change));
				return [
					statement(
						`comment on schema ${quoteIdentifier(snapshot.schemaName)} is null;`,
					),
				];
			}
			default:
				return assertNever(change.operation);
		}
	},
};

/**
 * `txid_current()` — the current transaction's ID. Proves the expression
 * helper contribution is a plain `expr()` call, no Supabase concepts
 * involved (mirrors `@hejbro/supabase`'s `authUid()` shape).
 */
export const txidCurrent = (): Expr<"numeric"> =>
	expr("numeric", {
		nodeKind: "functionCall",
		schemaName: null,
		functionName: "txid_current",
		args: [],
	});
