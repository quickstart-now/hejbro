import { vi } from "vitest";
import type {
	ContextRendering,
	Driver,
	DriverRow,
	DriverSession,
} from "../../src/driver/contract";

/** One statement as this fixture records it -- exactly the two fields a driver actually receives, never `kind` (irrelevant to what these tests assert). */
export type SentStatement = {
	readonly sql: string;
	readonly params: ReadonlyArray<unknown>;
};

export type RecordingTransactionalDriverOptions = {
	readonly interactiveTransactions?: boolean;
	readonly contributedRoles?: ReadonlyArray<string>;
	/** Rows every `execute()` call resolves to -- top-level and every transactional session alike (a fixture, not per-call scripting; tests that need a poisoned/varying row build a bespoke `Driver` instead, same as `context.test.ts`'s own fail-stop scenario). */
	readonly rows?: ReadonlyArray<DriverRow>;
	/** The driver's own context-rendering contribution (task 2.2, #555) -- omitted means the driver contributes none, so the query layer applies its own default rendering instead. */
	readonly renderContext?: ContextRendering;
	/** Declares this driver's platform has no roles a context could name (task 2.4, #555). */
	readonly roleLessPlatform?: true;
	/** Declares that no statement may run against this driver without an execution context (task 3.1, #556). */
	readonly contextRequired?: true;
};

/** `{ contributedRoles }` when given a value, or `{}` when omitted -- avoids ever spreading an explicit `contributedRoles: undefined` (`exactOptionalPropertyTypes`); no ternary (house style), a guard clause per branch instead. */
const contributedRolesField = (
	contributedRoles: ReadonlyArray<string> | undefined,
): Pick<Driver, "contributedRoles"> | Record<string, never> => {
	if (contributedRoles === undefined) {
		return {};
	}
	return { contributedRoles };
};

/** Same reasoning as {@link contributedRolesField}, for the context-rendering contribution. */
const renderContextField = (
	renderContext: ContextRendering | undefined,
): Pick<Driver, "renderContext"> | Record<string, never> => {
	if (renderContext === undefined) {
		return {};
	}
	return { renderContext };
};

/** Same reasoning as {@link contributedRolesField}, for the role-less-platform declaration. */
const roleLessPlatformField = (
	roleLessPlatform: true | undefined,
): Pick<Driver, "roleLessPlatform"> | Record<string, never> => {
	if (roleLessPlatform === undefined) {
		return {};
	}
	return { roleLessPlatform };
};

/** Same reasoning as {@link contributedRolesField}, for the context-mandatory declaration. */
const contextRequiredField = (
	contextRequired: true | undefined,
): Pick<Driver, "contextRequired"> | Record<string, never> => {
	if (contextRequired === undefined) {
		return {};
	}
	return { contextRequired };
};

/**
 * A driver that models one BEGIN/COMMIT per `driver.transaction()` call and
 * records every statement sent on that connection, in order -- distinct
 * from the top-level (non-transactional) `driver.execute()` calls, which
 * land in their own array. Originally `context.test.ts`'s own private
 * fixture (task 4.7's `db.as(context)` tests); promoted here so
 * `chain.test.ts` (tasks 7.1-7.4) shares it rather than growing a second,
 * flatter recorder -- a flat "every statement in one list" fixture can't
 * distinguish "this statement ran in the same transaction as that one"
 * from "these two happened to run in two different transactions", which
 * is exactly the claim a scoped chain (`db.as(ctx)`'s chain, task 7.4)
 * has to prove: role/settings and the chain's own SQL landing in the
 * *same* `sentPerTransaction` entry, in order.
 */
export const recordingTransactionalDriver = (
	options: RecordingTransactionalDriverOptions = {},
): {
	readonly driver: Driver;
	readonly sentPerTransaction: Array<Array<SentStatement>>;
	readonly topLevelSent: Array<SentStatement>;
} => {
	const rows = options.rows ?? [];
	const sentPerTransaction: Array<Array<SentStatement>> = [];
	const topLevelSent: Array<SentStatement> = [];
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": options.interactiveTransactions ?? true,
			"session-state": true,
		},
		execute: vi.fn(async (compiled) => {
			topLevelSent.push({ sql: compiled.sql, params: compiled.params });
			return rows;
		}),
		transaction: vi.fn(async (callback) => {
			const sent: Array<SentStatement> = [];
			sentPerTransaction.push(sent);
			const session: DriverSession = {
				execute: vi.fn(async (compiled) => {
					sent.push({ sql: compiled.sql, params: compiled.params });
					return rows;
				}),
			};
			return callback(session);
		}),
		setupSession: vi.fn(async () => {}),
		...contributedRolesField(options.contributedRoles),
		...renderContextField(options.renderContext),
		...roleLessPlatformField(options.roleLessPlatform),
		...contextRequiredField(options.contextRequired),
	};
	return { driver, sentPerTransaction, topLevelSent };
};
