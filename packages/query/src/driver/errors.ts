import type { Driver, DriverCapabilityKey } from "./contract";

/**
 * The `throwMissingCapability` public signature is frozen (#490: `@hejbro/
 * neon`'s `http.ts` and the barrel's exports test call it with one key) —
 * this internal builder carries the one-or-many-keys message and field
 * shape instead, so a multi-key caller (task 1.1, #486) never widens the
 * public single-key export's signature.
 */
function throwMissingCapabilities(
	capabilities: ReadonlyArray<DriverCapabilityKey>,
	operation: string,
): never {
	if (capabilities.length === 1) {
		const [capability] = capabilities;
		throw Object.assign(
			new Error(
				`this driver does not declare the "${capability}" capability, needed for ${operation}. Next: use a driver whose capabilities record sets "${capability}": true, or avoid ${operation} on this driver.`,
			),
			{ code: "driver-missing-capability", capability, operation },
		);
	}

	const names = capabilities.map((capability) => `"${capability}"`).join(", ");
	throw Object.assign(
		new Error(
			`this driver declares none of the ${names} capabilities, one of which is needed for ${operation}. Next: use a driver whose capabilities record sets one of them true, or avoid ${operation} on this driver.`,
		),
		{ code: "driver-missing-capability", capabilities, operation },
	);
}

/**
 * Builds and throws the `driver-missing-capability`-coded, enriched plain
 * `Error` (D57: new packages don't extend `HejbroError`) — a `function`
 * declaration, not `const f = (): never => …`, so a caller after this line
 * is actually narrowed. Exported (#490) so a driver package constructs
 * this failure instead of copying its message text. Signature frozen at
 * one key (task 1.1, #486): delegates to the internal one-or-many builder.
 */
export function throwMissingCapability(
	capability: DriverCapabilityKey,
	operation: string,
): never {
	throwMissingCapabilities([capability], operation);
}

/**
 * Guards that `driver` declares at least one of `capabilities` before any
 * statement for `operation` is sent (task 4.2; extended to many keys by
 * task 1.1, #486 — an operation with more than one qualifying capability
 * passes if any of them reads `true`; owner criterion ③: none `true`
 * always fails closed, explicitly, never a silent no-op). Reads only
 * `driver.capabilities` — never calls `execute`/`transaction`/`batch`/
 * `setupSession` on `driver` itself, so a caller that checks this first
 * structurally cannot have already sent anything. Consumed by 4.6's
 * `transaction()` and 4.7's `db.as(context)`, both before their own first
 * `execute`/`transaction`/`batch` call.
 */
export const assertCapability = (
	driver: Driver,
	capabilities: ReadonlyArray<DriverCapabilityKey>,
	operation: string,
): void => {
	if (capabilities.some((capability) => driver.capabilities[capability])) {
		return;
	}
	throwMissingCapabilities(capabilities, operation);
};
