import { vi } from "vitest";
import type {
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
	};
	return { driver, sentPerTransaction, topLevelSent };
};
