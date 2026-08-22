import type { FunctionDeclaration } from "../dsl/define-function";
import { throwHejbroError } from "../error";
import { createOrDropDiff, sameJson } from "../kind/diff-helpers";
import { dispatchEmit } from "../kind/emit-helpers";
import type { KindChange, ObjectKind } from "../kind/object-kind";
import { fnv1aHex } from "../plpgsql/body-hash";
import {
	renderFunctionReturnsClause,
	renderFunctionSql,
} from "../plpgsql/render-body";
import { noColumnOrder } from "../snapshot/column-order";
import type { JsonValue } from "../snapshot/stable-json";
import { qualifyName } from "../sql/identifier";
import type { SqlStatement } from "../sql/statement";
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

const emitCreate = (change: KindChange): ReadonlyArray<SqlStatement> => {
	if (change.next === null) {
		return throwHejbroError(
			"invalid-kind-change",
			"function create change is missing its next snapshot.",
		);
	}
	return [statement(asFunctionSnapshot(change.next).bodySql)];
};

const emitDrop = (change: KindChange): ReadonlyArray<SqlStatement> => {
	if (change.previous === null) {
		return throwHejbroError(
			"invalid-kind-change",
			"function drop change is missing its previous snapshot.",
		);
	}
	return [
		statement(dropFunctionStatementSql(asFunctionSnapshot(change.previous))),
	];
};

const emitAlter = (change: KindChange): ReadonlyArray<SqlStatement> => {
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
};

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
	requiredKeys: [
		"schema",
		"name",
		"args",
		"returns",
		"security",
		"language",
		"bodyHash",
		"bodySql",
	],
	owns: (declaration): declaration is FunctionDeclaration =>
		declaration.declarationKind === "function",
	serialize: (declaration, context) => {
		const bodySql = renderFunctionSql(
			declaration,
			context?.columnOrder ?? noColumnOrder,
		);
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
		const guard = createOrDropDiff("function", previous, next, identity);
		if (guard.done) {
			return guard.changes;
		}

		const previousSnapshot = asFunctionSnapshot(guard.previous);
		const nextSnapshot = asFunctionSnapshot(guard.next);
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
					previous: guard.previous,
					next: guard.next,
					notes: ["body changed"],
				},
			];
		}
		return [
			{
				kind: "function",
				operation: "alter",
				identity,
				previous: guard.previous,
				next: guard.next,
				notes: [SIGNATURE_CHANGED_NOTE],
			},
		];
	},
	emit: (change, siblingChanges) =>
		dispatchEmit(
			{ create: emitCreate, alter: emitAlter, drop: emitDrop },
			change,
			siblingChanges,
		),
};
