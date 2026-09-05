/** Whether `error` is an object carrying a string `message` -- structural, never `instanceof Error` (#458 review round 1, task 1.9): a thrown `ErrorEvent` (Neon's WebSocket `Pool` path throws exactly this on a failed connection) is not an `Error` instance, and a narrower type check would keep describing it as `[object ErrorEvent]`. Its own `message` is empty, though (measured, task 1.12) -- this guard alone does not resolve it; {@link errorConstructorName} is the rung that does. */
const hasStringMessage = (
	error: unknown,
): error is { readonly message: string } =>
	typeof error === "object" &&
	error !== null &&
	typeof (error as { readonly message?: unknown }).message === "string";

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

/** `error`'s own constructor name, when it names something more specific than a plain object (task 1.12) -- the last rung before `String()`'s own coercion artifact (`[object …]`). Plain `Object` is excluded: `"Object"` says nothing `[object Object]` doesn't already say. */
const errorConstructorName = (error: unknown): string | undefined => {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}
	const name = (error as { readonly constructor?: { readonly name?: unknown } })
		.constructor?.name;
	if (typeof name !== "string" || name === "" || name === "Object") {
		return undefined;
	}
	return name;
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
 * a more specific constructor name after that (task 1.12, e.g. a real
 * `ErrorEvent`, empty `message` and no `code`); `String(error)` only as
 * the last resort.
 */
export const describeDriverError = (error: unknown): string => {
	if (hasStringMessage(error) && error.message !== "") {
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
	const constructorName = errorConstructorName(error);
	if (constructorName !== undefined) {
		return constructorName;
	}
	return String(error);
};
