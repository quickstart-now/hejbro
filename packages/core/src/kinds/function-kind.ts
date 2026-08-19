import type { FunctionDeclaration } from "../dsl/define-function";
import { assertNever, throwHejbroError } from "../error";
import { sameJson } from "../kind/diff-helpers";
import type { KindChange, ObjectKind } from "../kind/object-kind";
import { fnv1aHex } from "../plpgsql/body-hash";
import {
	renderFunctionReturnsClause,
	renderFunctionSql,
} from "../plpgsql/render-body";
import type { JsonValue } from "../snapshot/stable-json";
import { qualifyName } from "../sql/identifier";
import { statement } from "../sql/statement";
import { renderTypeNode } from "../types/type-node";

/** One argument in a {@link FunctionSnapshot}'s signature. */
export type FunctionArgSnapshot = {
	readonly name: string;
	readonly type: string;
};

/** A function's serialized snapshot node (spec §6.4, decision A11: `bodySql` stored alongside `bodyHash` so `emit` can reproduce the statement from the snapshot alone). */
export type FunctionSnapshot = {
	readonly schema: string;
	readonly name: string;
	readonly args: ReadonlyArray<FunctionArgSnapshot>;
	readonly returns: string;
	readonly security: "invoker" | "definer";
	readonly language: "plpgsql";
	readonly bodyHash: string;
	readonly bodySql: string;
};

// Internal invariant: this shape is exactly what functionKind.serialize below produces.
const asFunctionSnapshot = (snapshot: JsonValue): FunctionSnapshot =>
	snapshot as FunctionSnapshot;

const functionIdentity = (schema: string, name: string): string =>
	`${schema}.${name}`;

/** The signature portion of a {@link FunctionSnapshot} — everything except `bodyHash`/`bodySql`, compared for the `create or replace` vs drop+create decision (spec §6.4). */
const signatureOf = (snapshot: FunctionSnapshot): JsonValue => ({
	schema: snapshot.schema,
	name: snapshot.name,
	args: snapshot.args,
	returns: snapshot.returns,
	security: snapshot.security,
	language: snapshot.language,
});

const argTypeList = (args: ReadonlyArray<FunctionArgSnapshot>): string =>
	args.map((arg) => arg.type).join(", ");

const SIGNATURE_CHANGED_NOTE = "signature changed; recreating";

const dropFunctionStatementSql = (snapshot: FunctionSnapshot): string =>
	`drop function ${qualifyName(snapshot.schema, snapshot.name)}(${argTypeList(snapshot.args)});`;

/**
 * The built-in object kind for Postgres functions. Identity is
 * `"<schema>.<name>"`. `diff` compares the signature (args/returns/
 * security/language) structurally: an identical signature with a changed
 * `bodyHash` emits a single `alter` (`create or replace`); any signature
 * difference **also** emits a single `alter` (**not** a separate drop +
 * create pair — the diff engine's global create/alter-before-drop
 * ordering would otherwise hoist a same-identity create ahead of its own
 * drop, deleting the function it just created; see #55), whose `emit`
 * renders `drop function <old signature>` followed by
 * `create or replace function <new body>` in that order, since Postgres
 * can't `create or replace` across an argument or return-type change.
 */
export const functionKind: ObjectKind<FunctionDeclaration> = {
	kind: "function",
	dependsOn: ["schema", "enum", "table"],
	owns: (declaration): declaration is FunctionDeclaration =>
		declaration.declarationKind === "function",
	serialize: (declaration) => {
		const bodySql = renderFunctionSql(declaration);
		const snapshot: FunctionSnapshot = {
			schema: declaration.schemaName,
			name: declaration.functionName,
			args: declaration.args.map((arg) => ({
				name: arg.argName,
				type: renderTypeNode(arg.typeNode),
			})),
			returns: renderFunctionReturnsClause(declaration.returns),
			security: declaration.security,
			language: "plpgsql",
			bodyHash: fnv1aHex(bodySql),
			bodySql,
		};
		return snapshot;
	},
	identify: (snapshot) => {
		const functionSnapshot = asFunctionSnapshot(snapshot);
		return functionIdentity(functionSnapshot.schema, functionSnapshot.name);
	},
	diff: (previous, next, identity) => {
		if (previous === null && next !== null) {
			return [
				{
					kind: "function",
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
					kind: "function",
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

		const previousSnapshot = asFunctionSnapshot(previous);
		const nextSnapshot = asFunctionSnapshot(next);
		const signatureSame = sameJson(
			signatureOf(previousSnapshot),
			signatureOf(nextSnapshot),
		);

		if (signatureSame && previousSnapshot.bodyHash === nextSnapshot.bodyHash) {
			return [];
		}
		if (signatureSame) {
			return [
				{
					kind: "function",
					operation: "alter",
					identity,
					previous,
					next,
					notes: ["body changed"],
				},
			];
		}
		return [
			{
				kind: "function",
				operation: "alter",
				identity,
				previous,
				next,
				notes: [SIGNATURE_CHANGED_NOTE],
			},
		];
	},
	emit: (change: KindChange) => {
		switch (change.operation) {
			case "create": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"function create change is missing its next snapshot.",
					);
				}
				return [statement(asFunctionSnapshot(change.next).bodySql)];
			}
			case "drop": {
				if (change.previous === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"function drop change is missing its previous snapshot.",
					);
				}
				return [
					statement(
						dropFunctionStatementSql(asFunctionSnapshot(change.previous)),
					),
				];
			}
			case "alter": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"function alter change is missing its next snapshot.",
					);
				}
				const nextSnapshot = asFunctionSnapshot(change.next);
				if (change.previous === null) {
					return [statement(nextSnapshot.bodySql)];
				}
				const previousSnapshot = asFunctionSnapshot(change.previous);
				const signatureSame = sameJson(
					signatureOf(previousSnapshot),
					signatureOf(nextSnapshot),
				);
				if (signatureSame) {
					return [statement(nextSnapshot.bodySql)];
				}
				return [
					statement(dropFunctionStatementSql(previousSnapshot)),
					statement(nextSnapshot.bodySql),
				];
			}
			default:
				return assertNever(change.operation);
		}
	},
};
