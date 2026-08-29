/**
 * Repo-internal conformance kit (#481, tasks.md 1.4) — never exported
 * from `./index.ts` or `package.json`'s `exports` map. It judges a
 * driver's own declared tier against what its caller already recorded,
 * never a transport it opens itself (`.claude/rules/query-purity.md`):
 * the caller's own stub (mirroring `packages/pg/test/driver.test.ts`'s
 * `stubPoolWithClient`, or neon http's `stubSuccess`) captures what was
 * actually sent, in order, and hands that list here. The kit reads no
 * driver's pin SQL text — only where the caller's own statement lands
 * relative to whatever preceded it, which is what the spec's "in that
 * order" (driver-contract, "A driver without session state guarantees
 * its own statements") actually names.
 */

/** One statement as a caller's own stub already captured it -- the same two fields a `CompileResult` carries onward to a driver. */
export type ConformanceStatement = {
	readonly sql: string;
	readonly params: ReadonlyArray<unknown>;
};

/**
 * Builds and throws the kit's own failure -- same enriched-`Error` idiom
 * as `driver/errors.ts` (D57: this package doesn't extend `HejbroError`).
 */
function throwConformanceViolation(tier: string, reason: string): never {
	throw Object.assign(
		new Error(
			`driver conformance violation (${tier}): ${reason} Next: fix the driver's session handling for this tier, or its capabilities declaration if it doesn't actually belong in this tier.`,
		),
		{ code: "driver-conformance-violation", tier },
	);
}

/**
 * The `session-state: false` tier's own obligation (driver-contract: "A
 * driver without session state guarantees its own statements") — the
 * caller's own compiled statement must be the LAST thing sent for that
 * one `execute()` call, with at least one entry ahead of it. Matched by
 * `sql` text only (never `params`): a settings statement and the
 * caller's own statement never share SQL text, so this is enough to
 * place the caller's statement without the kit ever needing to know what
 * the settings text actually is.
 */
export const assertFalseTierConformance = (
	recordedForOneExecute: ReadonlyArray<ConformanceStatement>,
	callerStatement: ConformanceStatement,
): void => {
	const last = recordedForOneExecute[recordedForOneExecute.length - 1];
	if (last === undefined || last.sql !== callerStatement.sql) {
		throwConformanceViolation(
			"session-state:false",
			"the caller's own statement was not the last thing sent for this execution.",
		);
	}
	if (recordedForOneExecute.length < 2) {
		throwConformanceViolation(
			"session-state:false",
			"the caller's statement was the only thing sent -- a session-state:false driver must carry the settings with every execution, not just declare the capability false.",
		);
	}
};
