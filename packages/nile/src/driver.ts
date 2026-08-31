import type { Driver } from "@hejbro/query";
import { nileContextRendering } from "./context";

/**
 * Decorates `driver` with Nile's platform declarations and its own
 * context rendering (tasks 2.1-2.4/3.2, #564/#565) -- object spread, so
 * every other member (`execute`, `transaction`, `setupSession`,
 * `capabilities`, and any `contributedRoles` the base already carries)
 * passes through by reference, unchanged. The decorator sends nothing of
 * its own before the base driver's `transaction` callback runs
 * (driver-contract: "the decorator SHALL NOT send any statement of its
 * own before the caller's callback runs") -- it never opens a connection
 * or a transaction of its own; everything the platform needs rides in
 * {@link nileContextRendering}, applied by the query layer itself.
 *
 * `renderContext` is added here rather than at group 2's own commit
 * (lead-approved, tasks.md group 3 file list) because the driver owns its
 * own rendering (#553's own contract) and this rendering did not exist
 * until this group built it -- an additive one-property/one-import edit
 * to an object literal group 2 already finished, not a redesign of it.
 * `roleLessPlatform`/`contextRequired` are fixed data, never discovered
 * from the base or the platform at runtime.
 */
export const nileDriver = (driver: Driver): Driver => ({
	...driver,
	renderContext: nileContextRendering,
	roleLessPlatform: true,
	contextRequired: true,
});
