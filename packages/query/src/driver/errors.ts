import type { Driver, DriverCapabilityKey } from "./contract";

/** Builds and throws the `driver-missing-capability`-coded, enriched plain `Error` (D57: new packages don't extend `HejbroError`) — a `function` declaration, not `const f = (): never => …`, so a caller after this line is actually narrowed (handoff note, g2/g3). */
function throwMissingCapabilityError(
	capability: DriverCapabilityKey,
	operation: string,
): never {
	throw Object.assign(
		new Error(
			`this driver does not declare the "${capability}" capability, needed for ${operation}. Next: use a driver whose capabilities record sets "${capability}": true, or avoid ${operation} on this driver.`,
		),
		{ code: "driver-missing-capability", capability, operation },
	);
}

/**
 * Guards that `driver` declares `capability` before any statement for
 * `operation` is sent (task 4.2; owner criterion ③: `false` always fails
 * closed, explicitly, never a silent no-op). Reads only
 * `driver.capabilities` — never calls `execute`/`transaction`/
 * `setupSession` on `driver` itself, so a caller that checks this first
 * structurally cannot have already sent anything. Consumed by 4.6's
 * `transaction()` and 4.7's `db.as(context)`, both before their own first
 * `execute`/`transaction` call.
 */
export const assertCapability = (
	driver: Driver,
	capability: DriverCapabilityKey,
	operation: string,
): void => {
	if (!driver.capabilities[capability]) {
		throwMissingCapabilityError(capability, operation);
	}
};
