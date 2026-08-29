import { throwHejbroError } from "@hejbro/core";
import type { Driver } from "@hejbro/query";

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

type PgDriverFactory = (connectionString: string) => Driver;

type PgDriverModule = { readonly pgDriver: PgDriverFactory };

/** Node's own code for "the package named in a dynamic `import()` could not be resolved" -- narrowed on so a real bug inside an *installed* `@hejbro/pg` (e.g. a syntax error) surfaces as itself, not misreported as "not installed". */
const isModuleNotFoundError = (error: unknown): boolean =>
	error instanceof Error &&
	(error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND";

/**
 * Imports `@hejbro/pg` dynamically, so its absence never surfaces as a raw
 * module-resolution stack trace -- only as this hejbro-coded diagnostic
 * naming the package to install.
 */
export const loadCheckDriver = async (): Promise<PgDriverFactory> => {
	try {
		const pgModule = (await import(CHECK_DRIVER_PACKAGE)) as PgDriverModule;
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

/** Resolves the connection string and the driver together, and opens the connection -- the one call the `check` command (group 4) makes. */
export const connectForCheck = async (
	url: string | undefined,
	env: ConnectionEnv,
): Promise<Driver> => {
	const connectionString = resolveConnectionString(url, env);
	const pgDriver = await loadCheckDriver();
	return pgDriver(connectionString);
};
