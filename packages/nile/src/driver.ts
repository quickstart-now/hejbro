import type { Driver } from "@hejbro/query";

/**
 * Decorates `driver` with Nile's two platform declarations (tasks
 * 2.1-2.4, #564) -- object spread, so every other member (`execute`,
 * `transaction`, `setupSession`, `capabilities`, and any `renderContext`/
 * `contributedRoles` the base already carries) passes through by
 * reference, unchanged. The decorator sends nothing of its own before the
 * base driver's `transaction` callback runs (driver-contract: "the
 * decorator SHALL NOT send any statement of its own before the caller's
 * callback runs") -- it never opens a connection or a transaction of its
 * own, and the platform's own rendering (#565) rides entirely on whatever
 * `renderContext` the decorated driver carries, applied by the query
 * layer itself.
 *
 * `roleLessPlatform`/`contextRequired` are the only two fields this
 * decorator ever adds -- Nile has no roles a context could name
 * (`roleLessPlatform`), and this platform's fail-open behavior on an
 * unapplied context makes an execution context mandatory
 * (`contextRequired`). Both are fixed data, never discovered from the
 * base or the platform at runtime.
 */
export const nileDriver = (driver: Driver): Driver => ({
	...driver,
	roleLessPlatform: true,
	contextRequired: true,
});
