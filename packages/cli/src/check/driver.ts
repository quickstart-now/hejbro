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
};

export type ConnectionContext = {
	readonly commandName: string;
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
		`${context.commandName} needs a database connection, but neither --url nor the DATABASE_URL environment variable is set. Next: pass --url <connection-string>, or set DATABASE_URL, then rerun \`${context.commandName}\`.`,
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

/** Resolves the connection string and the driver together, and opens the connection. `importer` threads through to {@link loadCheckDriver}, defaulting the same way. */
export const connectForCheck = async (
	url: string | undefined,
	env: ConnectionEnv,
	context: ConnectionContext,
	importer?: CheckDriverImporter,
): Promise<CheckDriverConnection> => {
	const connectionString = resolveConnectionString(url, env, context);
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
			`${context.commandName} could not connect to the database: ${describeDriverError(error)}. Next: confirm --url/DATABASE_URL is correct and the database is reachable, then rerun \`${context.commandName}\`.`,
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
): Promise<T> => {
	const driver = await connectForCheck(url, env, context, importer);
	try {
		await assertConnected(driver, context);
		return await body(driver);
	} finally {
		await driver.client.end();
	}
};
