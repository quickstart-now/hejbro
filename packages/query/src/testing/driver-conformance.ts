import type { DriverCapabilities } from "../driver/contract";

/**
 * Repo-internal conformance kit (#481, tasks.md 1.4/1.5) — never exported
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
 *
 * The single exported surface, {@link assertSessionStateConformance},
 * reads which tier applies from the driver's own `capabilities` — a
 * caller never hands it a tier directly. Picking the obligation any
 * other way (letting the caller choose which internal check runs,
 * independent of the declaration) reopens the same hole from the other
 * side of the forbidden move this kit exists to avoid: inferring or
 * correcting a *declaration* from observed behavior is banned, and so is
 * applying an obligation that doesn't match the declaration in hand.
 */

/** One statement as a caller's own stub already captured it -- the same two fields a `CompileResult` carries onward to a driver. */
export type ConformanceStatement = {
	readonly sql: string;
	readonly params: ReadonlyArray<unknown>;
};

/**
 * What a caller hands {@link assertSessionStateConformance} — exactly one
 * of the two shapes below, never both, never neither. Which one is
 * *required* is decided by `capabilities["session-state"]`, not by which
 * fields happen to be present: a caller that records the wrong shape for
 * the driver's actual declaration is a conformance failure, not a type
 * escape hatch.
 */
export type ConformanceObservation =
	| {
			readonly recordedForOneExecute: ReadonlyArray<ConformanceStatement>;
			readonly callerStatement: ConformanceStatement;
	  }
	| {
			readonly recordedForSetupSession: ReadonlyArray<ConformanceStatement>;
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
 * the settings text actually is. Internal -- {@link assertSessionStateConformance}
 * is the one exported surface.
 */
const assertFalseTierConformance = (
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

/**
 * The `session-state: true` tier's own obligation — the setup hook, not
 * `execute()`, is where the settings ride; something must have actually
 * been sent through it. Internal -- {@link assertSessionStateConformance}
 * is the one exported surface.
 */
const assertTrueTierConformance = (
	recordedForSetupSession: ReadonlyArray<ConformanceStatement>,
): void => {
	if (recordedForSetupSession.length === 0) {
		throwConformanceViolation(
			"session-state:true",
			"the session-setup hook sent nothing -- a session-state:true driver must deliver the settings through its setup hook.",
		);
	}
};

/**
 * The kit's one exported entry point. `capabilities["session-state"]`
 * decides which tier's obligation applies and which half of `observation`
 * it reads — never the other way around, and never inferred from
 * `observation`'s own shape as a substitute for reading the declaration.
 * A `true` declaration checked against a false-tier-shaped observation
 * (or the reverse) is a conformance failure in its own right: the caller
 * recorded the wrong thing for what this driver actually declares.
 */
export const assertSessionStateConformance = (
	capabilities: DriverCapabilities,
	observation: ConformanceObservation,
): void => {
	if (capabilities["session-state"]) {
		if (!("recordedForSetupSession" in observation)) {
			throwConformanceViolation(
				"session-state:true",
				"capabilities declares session-state true, but this driver was checked with a false-tier observation (recordedForOneExecute/callerStatement) instead of recordedForSetupSession.",
			);
		}
		assertTrueTierConformance(observation.recordedForSetupSession);
		return;
	}
	if (!("callerStatement" in observation)) {
		throwConformanceViolation(
			"session-state:false",
			"capabilities declares session-state false, but this driver was checked with a true-tier observation (recordedForSetupSession) instead of recordedForOneExecute/callerStatement.",
		);
	}
	assertFalseTierConformance(
		observation.recordedForOneExecute,
		observation.callerStatement,
	);
};
