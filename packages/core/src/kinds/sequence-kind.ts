import type { SchemaDeclaration } from "../dsl/schema";
import { assertNever, throwHejbroError } from "../error";
import type { ObjectKind } from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import { qualifyName, quoteIdentifier } from "../sql/identifier";
import {
	deferredStatement,
	predropStatement,
	statement,
} from "../sql/statement";

/**
 * The sequence's own base-type clause (#23/D66) — `as integer`/
 * `as smallint` for a `serial`/`smallserial`-derived sequence; `null` for
 * `bigserial`, whose sequence needs no `as` clause at all, since
 * `create sequence` already defaults to the `bigint` range. Confirmed
 * against a real Postgres (`pg_dump` on a table declaring all three
 * variants): the dumped `posts_id_seq` (from `serial`) carried
 * `AS integer`, `posts_small_id_seq` (from `smallserial`) carried
 * `AS smallint`, and `posts_big_id_seq` (from `bigserial`) carried no
 * `AS` clause at all.
 */
export type SequenceBaseType = "smallint" | "integer" | null;

/**
 * A `serial`/`smallserial`/`bigserial` column's synthesized sequence
 * declaration (#23/D66). Never authored directly — there is no
 * `defineSequence()` in the public DSL (D66: "`serial` stays in the DSL");
 * `engine/generate.ts`'s `resolveDeclarations` synthesizes one per
 * serial-family column, the same way it already expands a table's `rls`
 * field into standalone `rls`/`policy` declarations, or a
 * `defineTrigger()` call into its own function declaration plus itself.
 */
export type SequenceDeclaration = {
	readonly declarationKind: "sequence";
	readonly schema: SchemaDeclaration;
	readonly sequenceName: string;
	readonly tableName: string;
	readonly columnName: string;
	readonly baseType: SequenceBaseType;
};

/**
 * A sequence's serialized snapshot node. `table`/`column` are the owning
 * column's identity (D57 vocabulary) — needed self-contained, since
 * `ObjectKind.emit` only ever sees this kind's own snapshot node, never
 * another kind's (the table's own snapshot is a separate object entirely).
 */
export type SequenceSnapshot = {
	readonly schema: string;
	readonly name: string;
	readonly table: string;
	readonly column: string;
	readonly baseType: SequenceBaseType;
};

// Internal invariant: this shape is exactly what sequenceKind.serialize below produces.
/** Narrows a raw snapshot `JsonValue` to {@link SequenceSnapshot} — exported so `core-validators.ts` can cross-reference a sequence's owning `table`/`column` without duplicating this kind's snapshot shape (D66's `not-null-without-default` fix). */
export const asSequenceSnapshot = (snapshot: JsonValue): SequenceSnapshot =>
	snapshot as SequenceSnapshot;

const sequenceIdentity = (schema: string, name: string): string =>
	`${schema}.${name}`;

const baseTypeClause = (baseType: SequenceBaseType): string => {
	if (baseType === null) {
		return "";
	}
	return ` as ${baseType}`;
};

const createSequenceSql = (snapshot: SequenceSnapshot): string =>
	`create sequence ${qualifyName(snapshot.schema, snapshot.name)}${baseTypeClause(snapshot.baseType)};`;

/**
 * `drop sequence …;` — bare, not `if exists`. A drop change's statements
 * (this and `dropDefaultSql` below) go out on the `predrop` stage (see
 * `emit` below), which runs before every `main`-stage statement across
 * every kind (`generate.ts`) — including this column's own table's
 * `drop table`/`drop column`. So this always runs *before* Postgres's own
 * `owned by` cascade (see `ownedBySql` below) could possibly remove it:
 * the owning table/column is structurally guaranteed to still exist here,
 * the same guarantee `policyKind`/`triggerKind` already lean on for the
 * identical reason (#122 — a dependent kind's drop must clear before the
 * kind it depends on is altered). `if exists` would swallow a genuine
 * drift (e.g. a hand-run migration against a database that's diverged
 * from the snapshot) silently instead of failing loudly, which every
 * other statement this kind emits already does.
 */
const dropSequenceSql = (snapshot: SequenceSnapshot): string =>
	`drop sequence ${qualifyName(snapshot.schema, snapshot.name)};`;

/**
 * `alter sequence … owned by …;` — links the sequence to its column so
 * Postgres auto-drops it when the column (or its table) is dropped.
 * Deferred: the owning table must already exist, which a brand-new
 * table's own `create table` (a separate, main-stage statement from a
 * different kind) is not guaranteed to have run yet at this point in the
 * `main` stage.
 */
const ownedBySql = (snapshot: SequenceSnapshot): string =>
	`alter sequence ${qualifyName(snapshot.schema, snapshot.name)} owned by ${qualifyName(snapshot.schema, snapshot.table)}.${quoteIdentifier(snapshot.column)};`;

/**
 * `alter table … alter column … set default nextval(…);` — the column's
 * default lives here, not in `ColumnSnapshot.default` (table-kind.ts never
 * sees a sequence-backed default at all): inlining it into `create table`
 * would need the sequence to exist before the table statement runs,
 * recreating the exact circular-dependency problem `pg_dump` itself
 * avoids by splitting the default into its own trailing `alter table`
 * (confirmed against a real Postgres, comparing this kind's own output
 * against `pg_dump`'s for a native `serial` column). A bare string-literal
 * argument (no `::regclass` cast) is valid Postgres — confirmed directly,
 * not assumed — so this reuses the existing expression codec's
 * `functionCall`/`literal` nodes conceptually, but is rendered as plain
 * SQL text here since the sequence kind owns this statement outright, not
 * through the expression codec.
 */
const setDefaultSql = (snapshot: SequenceSnapshot): string =>
	`alter table ${qualifyName(snapshot.schema, snapshot.table)} alter column ${quoteIdentifier(snapshot.column)} set default nextval('${snapshot.schema}.${snapshot.name}');`;

/**
 * `alter table … alter column … drop default;` — bare, not `if exists`.
 * Same reasoning as `dropSequenceSql` above: the `predrop` stage this
 * statement runs on guarantees it always runs before the owning table's
 * own `drop table`/`drop column` (a `main`-stage statement, a different
 * kind), so the column is structurally guaranteed to still be there.
 */
const dropDefaultSql = (snapshot: SequenceSnapshot): string =>
	`alter table ${qualifyName(snapshot.schema, snapshot.table)} alter column ${quoteIdentifier(snapshot.column)} drop default;`;

const alterBaseTypeSql = (snapshot: SequenceSnapshot): string =>
	`alter sequence ${qualifyName(snapshot.schema, snapshot.name)} as ${snapshot.baseType ?? "bigint"};`;

/**
 * The built-in object kind for a `serial`/`smallserial`/`bigserial`
 * column's backing sequence (#23/D66). Identity is `"<schema>.<name>"`,
 * `name` auto-derived (`deriveSequenceName`, `engine/rename-plan.ts`) —
 * there is no way to declare a custom name today. `dependsOn` is just
 * `["schema"]`: unlike `viewKind`/`triggerKind`, this kind's `create`
 * statement never references the owning table (the `owned by`/
 * `set default` statements that do are `deferred`, which always runs
 * after every kind's `main`-stage statements — see the module doc above
 * `setDefaultSql`), so there is no dependency cycle with `tableKind` to
 * resolve, and `tableKind` needs no matching `dependsOn: ["sequence"]`
 * either.
 *
 * A `drop` change's statements (`dropDefaultSql`/`dropSequenceSql`) go
 * out on `predrop`, not `main` (#193 review) — the same stage
 * `policyKind`/`triggerKind` already use for their own drops, and for the
 * same reason (#122): `predrop` runs before every kind's `main`-stage
 * statements, so this drop always clears before the owning table's own
 * `drop table`/`drop column` could otherwise race it via Postgres's
 * `owned by` cascade (see `ownedBySql`'s doc comment). Confirmed directly
 * against a real Postgres: the reordered statements (drop default, drop
 * sequence, *then* the table's own change) succeed identically to the
 * original order for a change that doesn't touch the owning column at all
 * (the `serial()` → `integer()` type transition) — reordering a
 * statement is never itself a correctness risk here, only *not*
 * reordering the cascade-prone ones was.
 */
export const sequenceKind: ObjectKind<SequenceDeclaration> = {
	kind: "sequence",
	dependsOn: ["schema"],
	owns: (declaration): declaration is SequenceDeclaration =>
		declaration.declarationKind === "sequence",
	serialize: (declaration) => {
		const snapshot: SequenceSnapshot = {
			schema: declaration.schema.schemaName,
			name: declaration.sequenceName,
			table: declaration.tableName,
			column: declaration.columnName,
			baseType: declaration.baseType,
		};
		return snapshot;
	},
	identify: (snapshot) => {
		const sequenceSnapshot = asSequenceSnapshot(snapshot);
		return sequenceIdentity(sequenceSnapshot.schema, sequenceSnapshot.name);
	},
	diff: (previous, next, identity) => {
		if (previous === null && next !== null) {
			return [
				{
					kind: "sequence",
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
					kind: "sequence",
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
		const previousSnapshot = asSequenceSnapshot(previous);
		const nextSnapshot = asSequenceSnapshot(next);
		if (previousSnapshot.baseType === nextSnapshot.baseType) {
			return [];
		}
		return [
			{
				kind: "sequence",
				operation: "alter",
				identity,
				previous,
				next,
				notes: ["base type changed"],
			},
		];
	},
	emit: (change) => {
		switch (change.operation) {
			case "create": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"sequence create change is missing its next snapshot.",
					);
				}
				const nextSnapshot = asSequenceSnapshot(change.next);
				return [
					statement(createSequenceSql(nextSnapshot)),
					deferredStatement(ownedBySql(nextSnapshot)),
					deferredStatement(setDefaultSql(nextSnapshot)),
				];
			}
			case "drop": {
				if (change.previous === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"sequence drop change is missing its previous snapshot.",
					);
				}
				const previousSnapshot = asSequenceSnapshot(change.previous);
				return [
					predropStatement(dropDefaultSql(previousSnapshot)),
					predropStatement(dropSequenceSql(previousSnapshot)),
				];
			}
			case "alter": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"sequence alter change is missing its next snapshot.",
					);
				}
				return [statement(alterBaseTypeSql(asSequenceSnapshot(change.next)))];
			}
			default:
				return assertNever(change.operation);
		}
	},
};
