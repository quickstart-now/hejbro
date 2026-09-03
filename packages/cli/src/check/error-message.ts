/** A `.code` string, the shape every Node/pg error this module sees carries even when its own `message` does not (e.g. `ECONNREFUSED`). */
const errorCode = (error: unknown): string | undefined => {
	if (error === null || typeof error !== "object" || !("code" in error)) {
		return undefined;
	}
	const code = (error as { readonly code?: unknown }).code;
	if (typeof code === "string") {
		return code;
	}
	return undefined;
};

/** Only ever called from inside {@link describeDriverError}'s own body, at runtime after module evaluation -- never at module-load time -- so the forward reference to a `const` declared below it is not a TDZ hazard (mirrors packages/pg/src/driver.ts's own `ensurePinned`/`driver` forward reference). */
const flattenAggregateError = (error: AggregateError): string =>
	error.errors
		.map((inner) => describeDriverError(inner))
		.filter((text) => text !== "")
		.join("; ");

/**
 * Flattens a driver error into a human-readable reason, never an empty
 * string (1.5). node-postgres reports a refused connection to a host
 * that resolves to more than one address (Node's own dual-stack dial)
 * as an `AggregateError` whose own `message` is `""`, with the real
 * per-attempt reasons only in `.errors[]` -- measured: connecting to
 * "localhost" with nothing listening throws one, `.code` still reads
 * "ECONNREFUSED" but `.message` is empty and the two real per-address
 * reasons sit in `.errors`. Using that empty message verbatim would
 * answer "confirm pg_catalog privileges" to a user whose real problem
 * is an unreachable server -- the same failure mode C4 already fixed
 * once for a wrong-target message, here for an empty one. Order: a
 * non-empty own `message` wins first (the common case, plain `Error`);
 * an `AggregateError`'s flattened `.errors` next; a `.code` after that;
 * `String(error)` only as the last resort.
 */
export const describeDriverError = (error: unknown): string => {
	if (error instanceof Error && error.message !== "") {
		return error.message;
	}
	if (error instanceof AggregateError && error.errors.length > 0) {
		const flattened = flattenAggregateError(error);
		if (flattened !== "") {
			return flattened;
		}
	}
	const code = errorCode(error);
	if (code !== undefined) {
		return code;
	}
	return String(error);
};
