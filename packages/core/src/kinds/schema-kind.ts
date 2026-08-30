import type { SchemaDeclaration } from "../dsl/schema";
import { throwHejbroError } from "../error";
import { requireNext, requirePrevious } from "../kind/emit-helpers";
import type {
	ChangeOperation,
	KindChange,
	ObjectKind,
} from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import { quoteIdentifier } from "../sql/identifier";
import type { SqlStatement } from "../sql/statement";
import { statement } from "../sql/statement";

type SchemaSnapshot = { readonly name: string };

// Internal invariant: this shape is exactly what schemaKind.serialize below produces.
const asSchemaSnapshot = (snapshot: JsonValue): SchemaSnapshot =>
	snapshot as SchemaSnapshot;

/** {@link schemaKind}'s `emit`, `"create"` case. */
const emitCreate = (change: KindChange): ReadonlyArray<SqlStatement> => [
	statement(
		`create schema ${quoteIdentifier(asSchemaSnapshot(requireNext(change)).name)};`,
	),
];

/** {@link schemaKind}'s `emit`, `"drop"` case. */
const emitDrop = (change: KindChange): ReadonlyArray<SqlStatement> => [
	statement(
		`drop schema ${quoteIdentifier(asSchemaSnapshot(requirePrevious(change)).name)};`,
	),
];

/** {@link schemaKind}'s `emit`, `"alter"` case: unreachable in practice ({@link schemaKind}'s own `diff` never produces one) — a real internal-bug guard, not a structurally-unreachable `assertNever` case. */
const emitAlter = (): ReadonlyArray<SqlStatement> =>
	throwHejbroError(
		"unsupported-operation",
		"schema kind never alters — this indicates an internal hejbro bug in diff().",
	);

/**
 * One handler per {@link ChangeOperation}, same technique used across this
 * phase's other `emit` splits (#154 ratchet-5).
 */
type EmitHandlers = {
	readonly [K in ChangeOperation]: (
		change: KindChange,
	) => ReadonlyArray<SqlStatement>;
};

const emitHandlers: EmitHandlers = {
	create: emitCreate,
	drop: emitDrop,
	alter: emitAlter,
};

/**
 * The built-in object kind for Postgres schemas (namespaces). Identity is
 * the schema name; schemas are only ever created or dropped, never altered.
 */
export const schemaKind: ObjectKind<SchemaDeclaration> = {
	kind: "schema",
	dependsOn: [],
	requiredKeys: ["name"],
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
	emit: (change) => emitHandlers[change.operation](change),
};
