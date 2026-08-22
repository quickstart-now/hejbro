import type { Snapshot } from "../snapshot/snapshot";
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
	/**
	 * `siblingChanges` (D74) is the *whole* diff's change list — every
	 * `KindChange`, across every kind, `generate.ts` is about to emit in
	 * this run, `change` included — passed read-only and optional: a kind
	 * whose SQL for one change depends on a sibling kind's change in the
	 * *same* diff can render both facts in a single statement instead of
	 * two that can't work independently (the motivating case, #23: a
	 * `not null` column backfills from a default only when the default is
	 * present in the *same* `add column` statement — a separate
	 * `set default` afterwards is too late for a table that already has
	 * rows). `ObjectKind` **is** the extension interface
	 * (`packages/supabase`'s storage bucket kind implements it), so this
	 * widens that interface itself — additively and optionally: 9 of the
	 * 11 in-repo `emit` implementations (8 in `packages/core`, 1 in
	 * `packages/supabase`) ignore the second parameter and need no change;
	 * only `sequenceKind`/`tableKind` (both core) read it. The nearest
	 * precedent is core's own **built-in** `notNullWithoutDefaultWarnings`
	 * diagnostic (#115, Phase 7), which already reads the full
	 * `KindChange[]` at diff level — but that function is explicitly *not*
	 * a preset `Validator` (`engine/validate.ts`, D37, whose signature
	 * takes only `(snapshot, declarations)`, never `KindChange[]`), so it
	 * shows the *engine* already granted this view internally, not that
	 * this *extension interface* did before now.
	 */
	/**
	 * `nextSnapshot` (D78) is the full snapshot `generateMigration` is
	 * diffing *toward* — read-only, optional, and additive the same way
	 * `siblingChanges` (D74) was: 10 of the 11 in-repo `emit`
	 * implementations (9 in `packages/core`, 1 in `packages/supabase`)
	 * ignore this third parameter and need no change; only `tableKind`
	 * reads it. `siblingChanges` alone can't cover this case: it's the
	 * *diff's own* change list, so a sibling object that *didn't* change
	 * in this run — a standing schema-wide grant, unaffected by adding a
	 * table — never appears there at all. `tableKind`'s `create` emit
	 * reads `nextSnapshot` to find every `all-tables-privileges` grant
	 * already declared for the new table's schema and re-issue that exact
	 * schema-wide statement again right after `create table` (#121): the
	 * statement Postgres ran when *that* grant was first created only
	 * ever covered the tables that existed at that moment, so without
	 * this a table added by a *later*
	 * migration silently ends up ungranted — a defect a golden test can't
	 * see (it never runs real SQL) but the local round-trip did (chain
	 * path vs. a fresh single-migration regenerate disagreeing on exactly
	 * this table's grants).
	 */
	emit(
		change: KindChange,
		siblingChanges?: ReadonlyArray<KindChange>,
		nextSnapshot?: Snapshot,
	): ReadonlyArray<SqlStatement>;
}
