/**
 * Matches a stack-frame location: either the parenthesized V8 form
 * (`at fn (/path/to/file.ts:12:34)`) or the bare form
 * (`at /path/to/file.ts:12:34`). Stack trace formats vary across
 * JS runtimes — this is a best-effort match, never a guarantee.
 */
const locationPattern = /(?:\(([^()]+:\d+:\d+)\)|\s(\S+:\d+:\d+))\s*$/;

const extractLocation = (line: string): string | null => {
	const match = line.match(locationPattern);
	if (match === null) {
		return null;
	}
	return match[1] ?? match[2] ?? null;
};

/** `true` when `location` isn't inside hejbro's own core source or a dependency. */
const isOutsideCore = (location: string): boolean =>
	!location.includes("packages/core/src") && !location.includes("node_modules");

/**
 * Best-effort capture of the source location that called into
 * `defineFunction`/`defineTrigger`, for attaching to declaration-time
 * errors (spec §7 decision A8). Parses `new Error().stack` — pure string
 * work, no filesystem access, so `@hejbro/core` stays pure. Returns the
 * first `file:line:col` frame outside `packages/core/src` and
 * `node_modules`, or `null` when the stack is unavailable or every frame
 * is inside core — this must degrade silently, never throw, since stack
 * formats vary across runtimes.
 */
export const captureDeclarationSite = (): string | null => {
	const stack = new Error().stack;
	if (stack === undefined) {
		return null;
	}
	const frames = stack.split("\n").slice(1);
	const found = frames
		.map((line) => extractLocation(line))
		.find(
			(location): location is string =>
				location !== null && isOutsideCore(location),
		);
	return found ?? null;
};
