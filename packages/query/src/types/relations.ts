import type { ColumnBuilder, Table } from "@hejbro/core";
import type { SelectColumnResult } from "./select-result";

/**
 * Relation-key derivation over the declared foreign-key edges (D102,
 * add-relational-reads task 3.2). One truth, two readers: the same
 * `.references()` declaration that emits the DDL carries its edge in
 * `TMeta` (group 1), and everything here derives from that edge — no
 * second relations declaration exists anywhere.
 *
 * Forward keys strip one trailing `Id` from the FK column's TypeScript
 * name (`ownerId` → `owner`; a name without the tail keeps itself), so
 * multiple foreign keys to one table resolve naturally
 * (`authorId`/`editorId` → `author`/`editor`). Reverse keys are the
 * schema map's own export names. A rename breaks call sites loudly (the
 * key vanishes from the type) — never silently.
 *
 * Known edge (recorded in the change's design.md): reverse matching is
 * STRUCTURAL — two tables with identical column maps would both match.
 * The runtime derivation matches by declared identity and throws for an
 * underivable key, so the false positive surfaces as a loud runtime
 * error, never a silent wrong read.
 */

/** `ownerId` → `owner`; a key with nothing before the tail (or no tail) keeps itself. */
type StripId<K extends string> = K extends `${infer TBase}Id`
	? TBase extends ""
		? K
		: TBase
	: K;

/** The `references` edge on one column builder, or `never`. */
type EdgeOf<TColumn> =
	TColumn extends ColumnBuilder<infer _TFamily, infer TMeta>
		? TMeta extends { references: infer TEdge }
			? TEdge
			: never
		: never;

/** Structural equality via the mutual-assignability tuple trick. */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** `true` when any column of `TCandidate` declares a references edge whose target column map is `TColumns`. */
type HasEdgeTo<
	TCandidate extends Record<string, ColumnBuilder>,
	TColumns extends Record<string, ColumnBuilder>,
> = true extends {
	[K in keyof TCandidate]: EdgeOf<TCandidate[K]> extends {
		columns: infer TTarget;
	}
		? Equals<TTarget, TColumns>
		: false;
}[keyof TCandidate]
	? true
	: false;

/** Forward relations of a table's own columns: `{ author: users-columns, … }`. */
type ForwardRelations<TColumns extends Record<string, ColumnBuilder>> = {
	readonly [K in keyof TColumns as EdgeOf<TColumns[K]> extends never
		? never
		: StripId<K & string>]: EdgeOf<TColumns[K]> extends {
		columns: infer TTarget extends Record<string, ColumnBuilder>;
	}
		? { readonly mode: "one"; readonly columns: TTarget }
		: never;
};

/** Reverse relations from the schema map: `{ comments: comments-columns, … }`. */
type ReverseRelations<
	TSchema,
	TColumns extends Record<string, ColumnBuilder>,
> = {
	readonly [E in keyof TSchema as TSchema[E] extends Table<infer TCandidate>
		? HasEdgeTo<TCandidate, TColumns> extends true
			? E
			: never
		: never]: TSchema[E] extends Table<infer TCandidate>
		? { readonly mode: "many"; readonly columns: TCandidate }
		: never;
};

/** Every derivable relation of `TTable` inside `TSchema`, keyed per the D102 naming policy. */
type RelationsOf<TSchema, TTable> =
	TTable extends Table<infer TColumns>
		? ForwardRelations<TColumns> & ReverseRelations<TSchema, TColumns>
		: never;

/** The derivable relation keys — `related()`'s key domain (autocomplete = exactly these). */
export type RelationKeysOf<TSchema, TTable> = keyof RelationsOf<
	TSchema,
	TTable
> &
	string;

/** A rich row over a plain column map — the same shape a whole-table select resolves. */
type RowOfColumns<TColumns extends Record<string, ColumnBuilder>> = {
	readonly [K in keyof TColumns]: SelectColumnResult<TColumns[K]>;
};

/** The nested keys a `related(spec)` call adds to the result row: `many` → a rich row array, `one` → `Row | null`. */
export type RelatedResult<
	TSchema,
	TTable,
	TSpec extends Partial<Record<RelationKeysOf<TSchema, TTable>, true>>,
> = {
	readonly [K in keyof TSpec & string]: K extends keyof RelationsOf<
		TSchema,
		TTable
	>
		? RelationsOf<TSchema, TTable>[K] extends {
				readonly mode: infer TMode;
				readonly columns: infer TColumns extends Record<string, ColumnBuilder>;
			}
			? [TMode] extends ["many"]
				? ReadonlyArray<RowOfColumns<TColumns>>
				: RowOfColumns<TColumns> | null
			: never
		: never;
};

/** `related()`'s parameter type — `true` per derivable key, nothing else. */
export type RelatedSpec<TSchema, TTable> = Partial<
	Record<RelationKeysOf<TSchema, TTable>, true>
>;
