import type { QueryNode } from "../expr/ast";

/**
 * One recording in progress: every statement-builder `QueryNode`
 * produced while it is open, and whether each has been consumed. A `Map`
 * keyed by the node's own object identity — the same reference-equality
 * contract `noteBuilder`/`markConsumed` below rely on throughout.
 */
type RecordingSession = {
	readonly produced: Map<QueryNode, boolean>;
};

/**
 * Recording sessions nest, not stack-of-one: the determinism guard (D22)
 * runs one body twice in sequence, and nothing stops a body from
 * triggering another declaration's own recording (e.g. calling
 * `defineFunction` from inside a body). A single module-scope slot would
 * let an inner open/close clobber the outer session instead of
 * restoring it; a stack makes closing the innermost session always
 * correct regardless of what is nested inside it.
 */
const sessionStack: Array<RecordingSession> = [];

/** Opens a new recording session, nested on top of any already open. */
export const openRecordingSession = (): void => {
	sessionStack.push({ produced: new Map() });
};

/**
 * Closes the innermost open session and returns every builder it
 * produced that was never marked consumed, in the order it was produced
 * — `finish()`'s own material for `statement-builder-unused` (#426). A
 * close with no session open is a no-op returning `[]`: `finish()` calls
 * this unconditionally, and a session that was already force-closed by
 * {@link closeRecordingSession}'s own caller on an earlier throw (see
 * `body-context.ts`'s `recordOnce`) must not double-pop the next one
 * down the stack.
 */
export const closeRecordingSession = (): ReadonlyArray<QueryNode> => {
	const session = sessionStack.pop();
	if (session === undefined) {
		return [];
	}
	return Array.from(session.produced.entries())
		.filter(([, consumed]) => !consumed)
		.map(([node]) => node);
};

/**
 * `true` while at least one recording session is open. `query/*` builder
 * factories call `noteBuilder`/`markConsumed` unconditionally on every
 * chain stage (#426) — they never check this themselves; it is
 * `noteBuilder`/`markConsumed` that no-op when no session is open, so a
 * factory tracks nothing while `@hejbro/query`'s runtime chain builds the
 * exact same factories outside a body. This flag exists for tests that
 * assert the session lifecycle directly.
 */
export const hasOpenRecordingSession = (): boolean => sessionStack.length > 0;

/**
 * Marks `node` consumed, searching every open session from the innermost
 * outward — a builder produced in an outer session can be consumed by
 * code running while an inner one is on top (a body that triggers a
 * nested declaration), so only the top session would miss it. A no-op
 * for a node no open session produced (built outside any session, e.g.
 * at module scope — the guard's one documented blind spot) or already
 * marked: consumption is idempotent, since a builder consumed twice
 * simply renders twice, which Postgres accepts.
 */
export const markConsumed = (node: QueryNode): void => {
	const owner = sessionStack.find((session) => session.produced.has(node));
	if (owner === undefined) {
		return;
	}
	owner.produced.set(node, true);
};

/**
 * Registers `produced` as a builder made while the innermost session is
 * open, and — in the same call — marks `supersedes` consumed when it is
 * not `null`. The two are one event, never two: every chain stage both
 * creates a new node and retires the one it was built from (`.where()`
 * supersedes the stage it was called on; a set-operation combinator
 * supersedes its receiver and consumes its argument in the same call, so
 * a combinator site calls this once per side). A no-op outside any open
 * session, for the same reason {@link markConsumed} is.
 */
export const noteBuilder = (
	produced: QueryNode,
	supersedes: QueryNode | null,
): void => {
	const session = sessionStack.at(-1);
	if (session === undefined) {
		return;
	}
	session.produced.set(produced, false);
	if (supersedes !== null) {
		markConsumed(supersedes);
	}
};
