/** Phantom marker, never assigned at runtime (the `leftJoinedBrand` precedent in `@hejbro/core`'s `query/left-joined.ts`): a chain stage carries its projection here because `SelectResult<TProjection, …>` cannot be inverted, so a set-operation combinator has no other way to read the other branch's families (#503). */
export const chainProjectionBrand: unique symbol = Symbol(
	"hejbro:chain-projection",
);

/** What a chain stage carries about its own projection. Optional, so an `infer` at the use site yields `… | undefined` and a branch that carries no projection (a `related()` terminal) resolves to none and is accepted rather than refused (503/R9 decision 4). */
export type ChainProjectionBrand<TProjection> = {
	readonly [chainProjectionBrand]?: TProjection;
};
