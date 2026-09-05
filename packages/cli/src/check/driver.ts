import { throwHejbroError } from "@hejbro/core";
import type { Driver, DriverSession } from "@hejbro/query";
import { describeDriverError } from "./error-message";

/** The subset of `process.env` this module reads -- caller-supplied so `resolveConnectionString` stays a pure function under test. */
export type ConnectionEnv = Readonly<Record<string, string | undefined>>;

/**
 * [design, task 7.2, #613] `commandName`/`codes` for every function in
 * this module below -- required everywhere, never defaulted, for the same
 * reason `execute.ts`'s own `nextCommand` is required: this module has
 * more than one production caller (`hejbro check`, and now every apply-
 * engine command that needs a connection -- `migrate`/`reset`/`raise`), so
 * a default would be a silent channel for the wrong command's name to
 * ship the moment a second caller appeared -- which is exactly what
 * reusing `check-*` as-is would have done here (task 7.2's own
 * originating question: `hejbro migrate` answering under a code that
 * names `check`).
 *
 * `codes` are three literal strings the CALLER supplies, never assembled
 * here from a prefix (owner/lead review, #613, correcting this module's
 * own first draft): a code built as `` `${prefix}-connection-missing` ``
 * exists nowhere in the source as the string it actually throws, which
 * `check-diagnostic-xref`'s definition scan (literal-argument-only, by
 * design) cannot see, `grep` cannot find, and a future citation of it
 * would be wrongly flagged as undefined -- exactly the "reference a tool
 * can't see" failure mode this whole change has already paid for three
 * times (string pins, the public surface, a hardcoded command name).
 * Each of `check`/`migrate`/`status`/`reset`/`raise` writes its own three
 * codes out as literals at its own call site instead; `ledger.ts`'s own
 * rule (a prefix names the OPERATION, never the one command that minted
 * it first) still decides what those literals spell -- `check-*` for
 * `hejbro check` (command and operation coincide there), `apply-*` for
 * the four apply-engine commands (they share one operation through this
 * same path) -- it just no longer decides it by string concatenation.
 */
export type ConnectionCodes = {
	readonly connectionMissing: string;
	readonly driverMissing: string;
	readonly connectionFailed: string;
	/** Fourth literal (add-config-driver, #458, design Q2 (i)): a configured factory's driver with no way to close is refused under this code, spelled at each call site like the other three. */
	readonly driverUnclosable: string;
};

export type ConnectionContext = {
	readonly commandName: string;
	/** The flag this command reads a connection string from (add-config-driver, #458 review round 1, task 1.8) -- `"--url"` for six commands, `"--db-url"` for `pull` -- named here, beside `commandName`, so the connection-missing/connection-failed messages point at the flag this command actually accepts, never a hardcoded one a caller ignores. Supplied as a literal at each call site, exactly like `codes`. */
	readonly connectionFlag: string;
	readonly codes: ConnectionCodes;
};

/**
 * `--url`, else `DATABASE_URL`, else a coded refusal (spec: "cli-commands"
 * delta, "Declarations can be checked against a live database"). Never
 * reads `hejbro.config.ts`: that file is committed and a connection
 * string carries a secret.
 */
export const resolveConnectionString = (
	url: string | undefined,
	env: ConnectionEnv,
	context: ConnectionContext,
): string => {
	if (url !== undefined && url !== "") {
		return url;
	}
	if (env.DATABASE_URL !== undefined && env.DATABASE_URL !== "") {
		return env.DATABASE_URL;
	}
	return throwHejbroError(
		context.codes.connectionMissing,
		`${context.commandName} needs a database connection, but neither ${context.connectionFlag} nor the DATABASE_URL environment variable is set. Next: pass ${context.connectionFlag} <connection-string>, or set DATABASE_URL, then rerun \`${context.commandName}\`.`,
	);
};

/** Declared as no dependency kind of this package at all -- not a runtime dependency, not a peer, optional or otherwise (proposal.md: installing hejbro must not pull in a driver for commands that never connect). */
export const CHECK_DRIVER_PACKAGE = "@hejbro/pg";

/**
 * `@hejbro/pg`'s connection-string form is never auto-closed (its own
 * contract, `packages/pg/src/driver.ts`: "pool lifetime = process
 * lifetime" -- a caller that needs teardown calls `driver.client.end()`
 * itself). `check` is exactly that caller: it opens one connection for
 * one report and exits, so the widened type is what lets
 * {@link withCheckConnection} close it -- narrower than `Driver` alone,
 * which erases `.client` entirely.
 */
export type CheckDriverConnection = Driver & {
	readonly client: { end(): Promise<void> };
};

/** `HejbroConfig.driver` itself (add-config-driver, #458, design Q1): a factory, never an instance -- called once, per command, with the resolved connection string. */
export type DriverFactory = (
	connectionString: string,
) => Driver | Promise<Driver>;

type PgDriverFactory = (connectionString: string) => CheckDriverConnection;

type PgDriverModule = { readonly pgDriver: PgDriverFactory };

/** {@link loadCheckDriver}'s own dynamic-import call, injectable so a test can simulate the package's absence (or an unrelated failure inside it) without depending on whether `@hejbro/pg` actually happens to be installed in this environment. */
export type CheckDriverImporter = () => Promise<PgDriverModule>;

const importCheckDriver: CheckDriverImporter = () =>
	import(CHECK_DRIVER_PACKAGE) as Promise<PgDriverModule>;

/** Node's own code for "the package named in a dynamic `import()` could not be resolved" -- narrowed on so a real bug inside an *installed* `@hejbro/pg` (e.g. a syntax error) surfaces as itself, not misreported as "not installed". */
const isModuleNotFoundError = (error: unknown): boolean =>
	error instanceof Error &&
	(error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND";

/**
 * Imports `@hejbro/pg` dynamically, so its absence never surfaces as a raw
 * module-resolution stack trace -- only as this hejbro-coded diagnostic
 * naming the package to install. `importer` defaults to the real dynamic
 * `import()`; passing one in is how a test exercises the missing-package
 * path without relying on the package's real absence from this
 * environment (which group 6's own devDependency would otherwise
 * silently invalidate).
 */
export const loadCheckDriver = async (
	context: ConnectionContext,
	importer: CheckDriverImporter = importCheckDriver,
): Promise<PgDriverFactory> => {
	try {
		const pgModule = await importer();
		return pgModule.pgDriver;
	} catch (error) {
		if (!isModuleNotFoundError(error)) {
			throw error;
		}
		return throwHejbroError(
			context.codes.driverMissing,
			`${context.commandName} needs the "${CHECK_DRIVER_PACKAGE}" package to connect to Postgres, and it is not installed. Next: run \`pnpm add -D ${CHECK_DRIVER_PACKAGE}\` (or your package manager's equivalent), then rerun \`${context.commandName}\`.`,
		);
	}
};

/** The `client.end` member every closable driver carries (design Q2 (i)) -- named here once so the refusal message and the runtime check never drift apart. */
const CLOSE_MEMBER = "client.end";

/** Runtime narrowing only: the driver contract has no closing member, so a factory-built driver is checked for one at the moment it would be used, never assumed from its declared type -- including the shape a factory returns when its own arrow function forgot `return` (#458 review round 1, task 1.7). */
const hasClosableClient = (driver: Driver): driver is CheckDriverConnection => {
	if (typeof driver !== "object" || driver === null) {
		return false;
	}
	const client = (driver as { readonly client?: unknown }).client;
	if (typeof client !== "object" || client === null) {
		return false;
	}
	return typeof (client as { readonly end?: unknown }).end === "function";
};

/** Refuses, before any statement is sent, a configured factory's driver with no way to close (design Q2 (i)) -- an open pool with nothing to close it is a hang, not a driver. */
const assertClosable = (
	driver: Driver,
	context: ConnectionContext,
): CheckDriverConnection => {
	if (hasClosableClient(driver)) {
		return driver;
	}
	return throwHejbroError(
		context.codes.driverUnclosable,
		`${context.commandName}'s configured driver (hejbro.config.ts's "driver" field) has no "${CLOSE_MEMBER}" to close it, and an unclosable connection would hang the process. Next: return a driver whose "${CLOSE_MEMBER}" closes the connection from "driver", then rerun \`${context.commandName}\`.`,
	);
};

/** Calls the configured factory once with the resolved connection string; a thrown error surfaces as the command's own connection-failed diagnostic (design Q3) -- from the command's point of view the driver could not be opened, the same as a refused connection. */
const callConfiguredFactory = async (
	connectionString: string,
	factory: DriverFactory,
	context: ConnectionContext,
): Promise<Driver> => {
	try {
		return await factory(connectionString);
	} catch (error) {
		return throwHejbroError(
			context.codes.connectionFailed,
			`${context.commandName} could not connect to the database: ${describeDriverError(error)}. Next: confirm the configured driver (hejbro.config.ts's "driver" field) can open a connection, then rerun \`${context.commandName}\`.`,
		);
	}
};

/**
 * Resolves the connection string and the driver together, and opens the
 * connection. `factory` is `HejbroConfig.driver` threaded in by the
 * caller; when set it is preferred over the dynamic `@hejbro/pg` import
 * and `importer` is never consulted (design Q1/Q3). `importer` threads
 * through to {@link loadCheckDriver} only on the no-factory path,
 * defaulting the same way it always has.
 */
export const connectForCheck = async (
	url: string | undefined,
	env: ConnectionEnv,
	context: ConnectionContext,
	importer?: CheckDriverImporter,
	factory?: DriverFactory,
): Promise<CheckDriverConnection> => {
	const connectionString = resolveConnectionString(url, env, context);
	if (factory !== undefined) {
		const driver = await callConfiguredFactory(
			connectionString,
			factory,
			context,
		);
		return assertClosable(driver, context);
	}
	const pgDriver = await loadCheckDriver(context, importer);
	return pgDriver(connectionString);
};

const CONNECTIVITY_PROBE = {
	sql: "select 1",
	params: [],
	kind: "sql" as const,
};

/**
 * One trivial read before any catalog read (1.5) -- "can I talk to this
 * database at all?" answered directly, rather than inferred after the
 * fact from which catalog read failed and how. A wrong port, a wrong
 * password, and a nonexistent database name all fail here the same way:
 * this SHALL NOT classify by the driver's own error code (a code taxonomy
 * is guesswork about a specific driver's behavior; asking the database
 * directly is not) -- any failure of this one read is
 * `check-connection-failed`. Anything failing *after* this succeeds is
 * `readCatalog`'s own `check-catalog-unreadable` instead: the two codes
 * are mutually exclusive by construction, never by inspecting the error.
 */
export const assertConnected = async (
	session: DriverSession,
	context: ConnectionContext,
): Promise<void> => {
	try {
		await session.execute(CONNECTIVITY_PROBE);
	} catch (error) {
		throwHejbroError(
			context.codes.connectionFailed,
			`${context.commandName} could not connect to the database: ${describeDriverError(error)}. Next: confirm ${context.connectionFlag}/DATABASE_URL is correct and the database is reachable, then rerun \`${context.commandName}\`.`,
		);
	}
};

/**
 * Opens a connection, confirms it actually works (1.5's connectivity
 * probe), runs `body`, and closes the connection afterward -- on the
 * success path and on a rejection alike, since a caller that only closes
 * on success leaves the pool open exactly when there was something to
 * report. This is the only place `check` opens a connection, so it is
 * the only place that needs to close one -- and, since G7, the only place
 * every apply-engine command that needs one does too.
 */
export const withCheckConnection = async <T>(
	url: string | undefined,
	env: ConnectionEnv,
	context: ConnectionContext,
	body: (driver: CheckDriverConnection) => Promise<T>,
	importer?: CheckDriverImporter,
	factory?: DriverFactory,
): Promise<T> => {
	const driver = await connectForCheck(url, env, context, importer, factory);
	try {
		await assertConnected(driver, context);
		return await body(driver);
	} finally {
		await driver.client.end();
	}
};
