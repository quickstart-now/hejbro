/**
 * Phantom marker, never assigned at runtime (the `columnOriginBrand`
 * precedent, `types/column-builder.ts`) — a select stage carries its
 * left-joined set here because a type parameter no part of a type's
 * structure otherwise uses is erased for inference: `ExecuteResult`
 * (`@hejbro/query`) could not recover it otherwise.
 *
 * Public (task 1.4): `@hejbro/query`'s `ExecuteResult` and chain stage
 * types (G2/G3) `infer` against this exact symbol-keyed property across
 * the package boundary — a private symbol here would leave them no way to
 * name the property they read.
 */
export const leftJoinedBrand: unique symbol = Symbol("hejbro:left-joined");

/**
 * This position does not carry the statement's left-joined set, so every
 * projected field stays widened (the fail-safe direction) — the default
 * for every stage type below and for any position that only ever takes a
 * bare `SelectLimited<T>` (a nested read's subselect, `withCte`,
 * `defineView`).
 *
 * `unknown`, not a branded string literal (narrow-join-nullability G1,
 * corrected mid-group after a measured `TS2379`): a literal sentinel put
 * this position and a TRACKED position (`TLeftJoined | TJoined`) in two
 * unrelated types, so passing a tracked stage where only the untracked
 * default was expected failed to assign under `exactOptionalPropertyTypes`
 * — the exact break a consumer that only ever names the one-argument form
 * (`SelectJoinable<T>`, defaulting here) must never hit. `unknown` is the
 * type top, so every tracked stage is assignable to it, AND `unknown |
 * TJoined` collapses to `unknown` by TypeScript's own union simplification
 * — "untracked wins over any union" (the frozen contract) becomes a fact
 * the type checker enforces on its own, not a rule a downstream matcher
 * has to separately implement.
 *
 * Public (task 1.4): `@hejbro/query`'s `SelectResult` (G2) names this type
 * directly to test set membership (`[UntrackedJoins] extends
 * [TLeftJoined]`) — that comparison cannot be written against a type
 * internal to this package.
 */
export type UntrackedJoins = unknown;

/**
 * What a select stage carries about its left joins: a union of the
 * left-joined `Table`s, or {@link UntrackedJoins}. Optional, so an
 * `infer` against it yields `… | undefined` at the use site — the same
 * `NonNullable`-at-use-site shape `OriginBrand`/`ReadAsBrand` already
 * establish.
 *
 * Public (task 1.4): `SelectLimited` (this package) mixes this in by
 * intersection, so it is already part of every select stage's public
 * shape; `@hejbro/query`'s chain stage types (G3) mirror it structurally
 * on their own thenable wrappers, which is only possible if the shape
 * itself is nameable outside this package.
 */
export type LeftJoinedBrand<TLeftJoined> = {
	readonly [leftJoinedBrand]?: TLeftJoined;
};
