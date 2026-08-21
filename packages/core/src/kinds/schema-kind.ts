import type { SchemaDeclaration } from "../dsl/schema";
import { assertNever, throwHejbroError } from "../error";
import type { ObjectKind } from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import { quoteIdentifier } from "../sql/identifier";
import { statement } from "../sql/statement";

type SchemaSnapshot = { readonly name: string };

// Internal invariant: this shape is exactly what schemaKind.serialize below produces.
const asSchemaSnapshot = (snapshot: JsonValue): SchemaSnapshot =>
	snapshot as SchemaSnapshot;

/**
 * The built-in object kind for Postgres schemas (namespaces). Identity is
 * the schema name; schemas are only ever created or dropped, never altered.
 */
export const schemaKind: ObjectKind<SchemaDeclaration> = {
	kind: "schema",
	dependsOn: [],
	owns: (declaration): declaration is SchemaDeclaration =>
		declaration.declarationKind === "schema",
	serialize: (declaration) => ({ name: declaration.schemaName }),
	identify: (snapshot) => asSchemaSnapshot(snapshot).name,
	diff: (previous, next, identity) => {
		if (previous === null && next !== null) {
			return [
				{
					kind: "schema",
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
					kind: "schema",
					operation: "drop",
					identity,
					previous,
					next: null,
					notes: [],
				},
			];
		}
		return [];
	},
	emit: (change) => {
		switch (change.operation) {
			case "create": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"schema create change is missing its next snapshot.",
					);
				}
				return [
					statement(
						`create schema ${quoteIdentifier(asSchemaSnapshot(change.next).name)};`,
					),
				];
			}
			case "drop": {
				if (change.previous === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"schema drop change is missing its previous snapshot.",
					);
				}
				return [
					statement(
						`drop schema ${quoteIdentifier(asSchemaSnapshot(change.previous).name)};`,
					),
				];
			}
			case "alter":
				return throwHejbroError(
					"unsupported-operation",
					"schema kind never alters — this indicates an internal hejbro bug in diff().",
				);
			default:
				return assertNever(change.operation);
		}
	},
};
