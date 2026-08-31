import { throwHejbroError } from "@hejbro/core";
import type { Driver, DriverSession } from "@hejbro/query";
import { describeDriverError } from "../check/error-message";

/** The subset of `process.env` this module reads — caller-supplied so `resolveConnectionString` stays a pure function under test. Mirrors `check/driver.ts`'s own type; not imported from there because the two commands' messages name themselves, not each other. */
export type ConnectionEnv = Readonly<Record<string, string | undefined>>;

/**
 * `--url`, else `DATABASE_URL`, else a coded refusal (schema-sync delta,
 * "No connection is a coded failure"). Never reads `hejbro.config.ts`:
 * that file is committed and a connection string carries a secret —
 * same reasoning as `check`'s own resolution, restated here under
 * `sync`'s own code and message rather than imported, since the two
 * differ in which command name they tell the caller to rerun.
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
		"sync-connection-missing",
		"hejbro sync needs a database connection, but neither --url nor the DATABASE_URL environment variable is set. Next: pass --url <connection-string>, or set DATABASE_URL, then rerun `hejbro sync`.",
	);
};

/** Declared as no dependency kind of this package at all (cli-commands delta: "the database driver is an optional dependency", extended to `sync`). Same package `check` uses — both commands read Postgres, neither needs a driver capability beyond a plain read. */
export const SYNC_DRIVER_PACKAGE = "@hejbro/pg";

/** Same shape as `check/driver.ts`'s `CheckDriverConnection` — `sync` opens one connection for one run and closes it itself, so it needs `.client.end()` too. */
export type SyncDriverConnection = Driver & {
	readonly client: { end(): Promise<void> };
};

type PgDriverFactory = (connectionString: string) => SyncDriverConnection;

type PgDriverModule = { readonly pgDriver: PgDriverFactory };

/** {@link loadSyncDriver}'s own dynamic-import call, injectable so a test can simulate the package's absence without depending on whether `@hejbro/pg` actually happens to be installed. */
export type SyncDriverImporter = () => Promise<PgDriverModule>;

const importSyncDriver: SyncDriverImporter = () =>
	import(SYNC_DRIVER_PACKAGE) as Promise<PgDriverModule>;

/** Node's own code for "the package named in a dynamic `import()` could not be resolved" — narrowed on so a real bug inside an *installed* `@hejbro/pg` surfaces as itself, not misreported as "not installed". */
const isModuleNotFoundError = (error: unknown): boolean =>
	error instanceof Error &&
	(error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND";

/**
 * Imports `@hejbro/pg` dynamically, so its absence never surfaces as a
 * raw module-resolution stack trace — only as this hejbro-coded
 * diagnostic naming the package to install.
 */
export const loadSyncDriver = async (
	importer: SyncDriverImporter = importSyncDriver,
): Promise<PgDriverFactory> => {
	try {
		const pgModule = await importer();
		return pgModule.pgDriver;
	} catch (error) {
		if (!isModuleNotFoundError(error)) {
			throw error;
		}
		return throwHejbroError(
			"sync-driver-missing",
			`hejbro sync needs the "${SYNC_DRIVER_PACKAGE}" package to connect to Postgres, and it is not installed. Next: run \`pnpm add -D ${SYNC_DRIVER_PACKAGE}\` (or your package manager's equivalent), then rerun \`hejbro sync\`.`,
		);
	}
};

/** Resolves the connection string and the driver together, and opens the connection. */
export const connectForSync = async (
	url: string | undefined,
	env: ConnectionEnv,
	importer?: SyncDriverImporter,
): Promise<SyncDriverConnection> => {
	const connectionString = resolveConnectionString(url, env);
	const pgDriver = await loadSyncDriver(importer);
	return pgDriver(connectionString);
};

const CONNECTIVITY_PROBE = {
	sql: "select 1",
	params: [],
	kind: "sql" as const,
};

/** One trivial read before the manifest read — same reasoning as `check`'s own connectivity probe: any failure here is `sync-connection-failed`, classified by asking the database directly rather than by inspecting the driver's own error shape. */
export const assertConnected = async (
	session: DriverSession,
): Promise<void> => {
	try {
		await session.execute(CONNECTIVITY_PROBE);
	} catch (error) {
		throwHejbroError(
			"sync-connection-failed",
			`hejbro sync could not connect to the database: ${describeDriverError(error)}. Next: confirm --url/DATABASE_URL is correct and the database is reachable, then rerun \`hejbro sync\`.`,
		);
	}
};

/**
 * Opens a connection, confirms it works, runs `body`, and closes the
 * connection afterward on both the success and the rejection path —
 * `sync` is the only place that opens one, so it is the only place that
 * needs to close one.
 */
export const withSyncConnection = async <T>(
	url: string | undefined,
	env: ConnectionEnv,
	body: (driver: SyncDriverConnection) => Promise<T>,
	importer?: SyncDriverImporter,
): Promise<T> => {
	const driver = await connectForSync(url, env, importer);
	try {
		await assertConnected(driver);
		return await body(driver);
	} finally {
		await driver.client.end();
	}
};
