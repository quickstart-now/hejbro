import { throwHejbroError } from "@hejbro/core";
import type { Driver } from "@hejbro/query";
import type { ConnectionCodes } from "../check/driver";

/**
 * [design, task 7.2, #613] The three connection-acquisition codes every
 * apply-engine command (`migrate`/`status`/`reset`/`raise`) shares,
 * written out as literals here -- once, not once per command -- rather
 * than assembled from a prefix at `check/driver.ts`'s own throw sites
 * (owner/lead review: a code built by string concatenation exists
 * nowhere in the source as the string it actually throws, which neither
 * `check-diagnostic-xref` nor `grep` nor a human reading the source can
 * find). `ledger.ts`'s own rule decided the spelling: `apply-*`, because
 * applying is the one operation all four commands share, not any single
 * command's own name.
 */
export const APPLY_CONNECTION_CODES: ConnectionCodes = {
	connectionMissing: "apply-connection-missing",
	driverMissing: "apply-driver-missing",
	connectionFailed: "apply-connection-failed",
};

/**
 * [task 7.3] `migrate`, `reset`, and `raise` all send DDL inside
 * `driver.transaction()` (`execute.ts`'s `applyMigration`, `apply/
 * reset.ts`'s `applyReset`) -- refused up front, naming the capability,
 * rather than letting a driver that cannot hold one open fail confusingly
 * deep inside either. `@hejbro/neon`'s HTTP path is the concrete case
 * this guards: `interactive-transactions: false`, `transaction()` always
 * throws, and its endpoint accepts only one statement per batch member --
 * neither axis of this design fits it. `status` never calls this: it
 * only reads (`readLedger`/`readChainEntries`), so it needs no
 * transaction at all.
 */
export const assertInteractiveTransactions = (
	driver: Driver,
	commandName: string,
): void => {
	if (driver.capabilities["interactive-transactions"]) {
		return;
	}
	throwHejbroError(
		"apply-missing-capability",
		`${commandName} needs a driver that supports interactive transactions ("interactive-transactions"), but the connected driver does not declare it. Next: connect with a driver that can hold a transaction open across statements (e.g. @hejbro/pg), then rerun \`${commandName}\`.`,
	);
};
