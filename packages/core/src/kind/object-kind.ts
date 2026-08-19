import type { JsonValue } from "../snapshot/stable-json";
import type { SqlStatement } from "../sql/statement";

/** The three shapes a snapshot-to-snapshot change can take for any object kind. */
export const changeOperations = ["create", "drop", "alter"] as const;

/** @see changeOperations */
export type ChangeOperation = (typeof changeOperations)[number];

/**
 * One change to a single object, as computed by an {@link ObjectKind}'s
 * `diff`. `previous`/`next` carry the raw serialized snapshot nodes so
 * `emit` can render SQL without re-deriving state.
 */
export type KindChange = {
	readonly kind: string;
	readonly operation: ChangeOperation;
	readonly identity: string;
	readonly previous: JsonValue | null;
	readonly next: JsonValue | null;
	/** extra banner notes, e.g. ["column slug added"] */
	readonly notes: ReadonlyArray<string>;
};

/** The common shape every user declaration (schema, table, enum, …) satisfies. */
export type HejbroDeclaration = { readonly declarationKind: string };

/**
 * The extension interface every database object kind implements — built-in
 * kinds and provider-preset kinds alike (spec §4.1). Four explicit stages:
 * serialize a declaration into a snapshot node, derive its stable identity,
 * diff two snapshot nodes into changes, and emit SQL for a change.
 */
export interface ObjectKind<TDeclaration extends HejbroDeclaration> {
	readonly kind: string;
	/** kinds whose creates must precede this kind's creates (drops reverse) */
	readonly dependsOn: ReadonlyArray<string>;
	/** narrow an unknown declaration to this kind (used by buildSnapshot) */
	owns(declaration: HejbroDeclaration): declaration is TDeclaration;
	serialize(declaration: TDeclaration): JsonValue;
	identify(snapshot: JsonValue): string;
	diff(
		previous: JsonValue | null,
		next: JsonValue | null,
		identity: string,
	): ReadonlyArray<KindChange>;
	emit(change: KindChange): ReadonlyArray<SqlStatement>;
}
