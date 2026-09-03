import type { ColumnOrderOracle } from "../snapshot/column-order";
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

/** What `buildSnapshot` knows while serializing that a single declaration cannot: the physical column order of every table in this build (D81). Optional on `serialize` so kinds that never read it — and every preset kind written before it existed — are untouched. */
export type SerializeContext = {
	readonly columnOrder: ColumnOrderOracle;
};

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
	serialize(declaration: TDeclaration, context?: SerializeContext): JsonValue;
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
	/**
	 * `requiredKeys` (D79, #159) — the top-level keys this kind's own
	 * `serialize` always produces, checked against every one of this
	 * kind's snapshot nodes by `parseSnapshot` (optional there too:
	 * passing no map at all keeps today's behavior). A hand-edited or
	 * corrupted snapshot missing one of these is reported by kind and key
	 * name at parse time — before `identify`/`diff`/`emit` ever run and
	 * crash on the `undefined` instead — rather than only after some
	 * downstream accessor happens to dereference the missing field.
	 * Optional and additive, the same way `siblingChanges` (D74) and
	 * `nextSnapshot` (D78) widened this interface: every existing kind
	 * that doesn't set it (including any third-party preset kind
	 * predating this field) is simply never checked, unaffected.
	 */
	readonly requiredKeys?: ReadonlyArray<string>;
	/**
	 * `noCatalogObjectReason` (#482, task 2.1) — states that no catalog
	 * object ever backs this kind's declared objects, and why (e.g.
	 * `@hejbro/supabase`'s storage bucket kind: the Storage API owns that
	 * row, not this database's own migrations). Named for what its value
	 * *is*, the same way `requiredKeys`'s value is keys and
	 * `siblingChanges`'s value is changes — a predicate-shaped name
	 * (`notCatalogComparable`) paired with a prose value would build a
	 * naming/value mismatch into the type itself. This is the kind-level
	 * fact only; `hejbro check` (a CLI concern, not this interface's) is
	 * what turns a declared reason into a coverage-boundary statement,
	 * comparing nothing for the kind and never counting one of its
	 * objects as a difference just because it was never compared.
	 * Optional and additive, the same way `siblingChanges` (D74),
	 * `nextSnapshot` (D78), and `requiredKeys` (D79) widened this
	 * interface: a kind that doesn't set it is compared exactly as it
	 * always was. Data, not a function: a comparator that ran its own
	 * logic here would drag `hejbro check`'s catalog and finding types
	 * across the preset boundary for a need no kind has yet — tracked as
	 * #508, decided when one does.
	 */
	readonly noCatalogObjectReason?: string;
	/**
	 * `ownerTableIdentity` (D106 R1, B2) — answers "which table declaration
	 * gave rise to this node", for a kind whose objects are always the
	 * fan-out of a table declaration (`sequenceKind`/`rlsKind`/
	 * `policyKind`; `tableKind` answers with its own identity). Optional
	 * and additive, the same way every other member here widened this
	 * interface: a kind that doesn't set it (a `grant`, for instance — a
	 * grant is the user's own standalone declaration, never a table
	 * fan-out, and MUST NOT answer this) is never asked. `diffSnapshots`
	 * is the only reader: a key whose owning table identity resolves to
	 * an `existing` table in `next` is skipped before this kind's own
	 * `diff` ever runs — a table hejbro does not own gets no drop *or*
	 * create for what it fans out into, on either side of a handover.
	 */
	ownerTableIdentity?(node: JsonValue): string;
}
