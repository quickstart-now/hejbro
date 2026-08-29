import { throwHejbroError } from "@hejbro/core";
import type { Driver, DriverSession } from "@hejbro/query";
import { describeDriverError } from "./error-message";

/** The subset of `process.env` this module reads -- caller-supplied so `resolveConnectionString` stays a pure function under test. */
export type ConnectionEnv = Readonly<Record<string, string | undefined>>;

/**
 * `--url`, else `DATABASE_URL`, else a coded refusal (spec: "cli-commands"
 * delta, "Declarations can be checked against a live database"). Never
 * reads `hejbro.config.ts`: that file is committed and a connection
 * string carries a secret.
 */
export const resolveConnectionString = (
	url: string | undefined,
	env: ConnectionEnv,
): string => {
	if (url !== undefined && url !== "") {
		return url;
	}
	if (env.DATABASE_URL !== undefined && env.DATABASE_URL !== "") {
		return env.DATABASE_URL;
	}
	return throwHejbroError(
		"check-connection-missing",
		"hejbro check needs a database connection, but neither --url nor the DATABASE_URL environment variable is set. Next: pass --url <connection-string>, or set DATABASE_URL, then rerun `hejbro check`.",
	);
};

/** An optional peer, never a hard dependency of this package (proposal.md: installing hejbro must not pull in a driver for commands that never connect). */
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
			"check-driver-missing",
			`hejbro check needs the "${CHECK_DRIVER_PACKAGE}" package to connect to Postgres, and it is not installed. Next: run \`pnpm add -D ${CHECK_DRIVER_PACKAGE}\` (or your package manager's equivalent), then rerun \`hejbro check\`.`,
		);
	}
};

/** Resolves the connection string and the driver together, and opens the connection. `importer` threads through to {@link loadCheckDriver}, defaulting the same way. */
export const connectForCheck = async (
	url: string | undefined,
	env: ConnectionEnv,
	importer?: CheckDriverImporter,
): Promise<CheckDriverConnection> => {
	const connectionString = resolveConnectionString(url, env);
	const pgDriver = await loadCheckDriver(importer);
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
): Promise<void> => {
	try {
		await session.execute(CONNECTIVITY_PROBE);
	} catch (error) {
		throwHejbroError(
			"check-connection-failed",
			`hejbro check could not connect to the database: ${describeDriverError(error)}. Next: confirm --url/DATABASE_URL is correct and the database is reachable, then rerun \`hejbro check\`.`,
		);
	}
};

/**
 * Opens a connection, confirms it actually works (1.5's connectivity
 * probe), runs `body`, and closes the connection afterward -- on the
 * success path and on a rejection alike, since a caller that only closes
 * on success leaves the pool open exactly when there was something to
 * report. This is the only place `check` opens a connection, so it is
 * the only place that needs to close one.
 */
export const withCheckConnection = async <T>(
	url: string | undefined,
	env: ConnectionEnv,
	body: (driver: CheckDriverConnection) => Promise<T>,
	importer?: CheckDriverImporter,
): Promise<T> => {
	const driver = await connectForCheck(url, env, importer);
	try {
		await assertConnected(driver);
		return await body(driver);
	} finally {
		await driver.client.end();
	}
};
