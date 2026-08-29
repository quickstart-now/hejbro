import type {
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverCapabilityKey,
	DriverRow,
} from "@hejbro/query";
import type {
	CustomTypesConfig,
	NeonQueryFunction,
} from "@neondatabase/serverless";
import { types as neonTypes } from "@neondatabase/serverless";

/**
 * The Neon HTTP one-shot client this driver wraps -- `neon(connectionString)`'s
 * default return shape (array-of-objects rows, no `fullResults` envelope).
 * A caller who constructs `sql` with `arrayMode`/`fullResults` options
 * would hand this driver a shape its own row-mapping does not expect;
 * `neonDriver` (group 3) is the only place that choice is offered.
 */
export type HttpQueryable = NeonQueryFunction<false, false>;

/**
 * Neither capability the HTTP path can offer (task 2.3, D95/D96): a
 * one-shot HTTP request has no connection to hold a transaction open
 * across round trips, and no session to preserve state across separate
 * requests. Both read `false` and neither is softened -- see task 2.3's
 * own note on why "the pins hold within one batch" does not make
 * `session-state` true.
 */
const CAPABILITIES: DriverCapabilities = {
	"interactive-transactions": false,
	"session-state": false,
};

/**
 * Same builtin oids `@hejbro/pg` pins (`packages/pg/src/driver.ts`) --
 * duplicated here, never imported: a preset may only use `@hejbro/query`'s
 * driver contract type, never a concrete driver implementation
 * (`.claude/rules/provider-preset.md`).
 */
const INTERVAL_OID = 1186;
const INTERVAL_ARRAY_OID = 1187;
const NUMERIC_ARRAY_OID = 1231;

/**
 * The per-statement `types` override the caller's own batch member sends
 * (mirrors `@hejbro/pg`'s `intervalPassthroughTypes`): oid 1186/1187/1231
 * pass through as raw text for `@hejbro/query`'s own conversion layer to
 * parse, every other oid keeps `@neondatabase/serverless`'s own default
 * parser (its bundled `pg-types` fallback, re-exported here as
 * `neonTypes`).
 */
const intervalPassthroughTypes: CustomTypesConfig = {
	getTypeParser: (oid, format) => {
		const oidValue = oid as number;
		if (
			oidValue === INTERVAL_OID ||
			oidValue === INTERVAL_ARRAY_OID ||
			oidValue === NUMERIC_ARRAY_OID
		) {
			return (value: string): string => value;
		}
		return neonTypes.getTypeParser(oid, format);
	},
};

/**
 * The two session pins `@hejbro/pg` sends once per connection
 * (`IntervalStyle`, `bytea_output`) -- sent as two separate batch members
 * here, never one semicolon-joined string: Neon's HTTP endpoint runs
 * every batch member through the extended query protocol, which (unlike
 * node-postgres's own simple-query form `@hejbro/pg` uses for its own
 * setup statement) accepts exactly one statement per member.
 */
const PIN_STATEMENTS: ReadonlyArray<string> = [
	"set intervalstyle to 'postgres'",
	"set bytea_output to 'hex'",
];

/**
 * Builds and throws the `driver-missing-capability`-coded, enriched plain
 * `Error` -- the same code and wording `@hejbro/query`'s own guard throws
 * (`packages/query/src/driver/errors.ts`, not re-exported publicly), kept
 * byte-identical here rather than diverging just because this driver has
 * no access to the original.
 */
function throwMissingCapability(
	capability: DriverCapabilityKey,
	operation: string,
): never {
	throw Object.assign(
		new Error(
			`this driver does not declare the "${capability}" capability, needed for ${operation}. Next: use a driver whose capabilities record sets "${capability}": true, or avoid ${operation} on this driver.`,
		),
		{ code: "driver-missing-capability", capability, operation },
	);
}

/**
 * The last entry of a batch result (task 2.2) -- `results` always holds
 * at least one entry (the caller's own statement, appended last by
 * {@link runBatch}), so a missing last entry is an internal-invariant
 * failure, not a user-reachable path.
 */
const lastResultOf = (
	results: ReadonlyArray<ReadonlyArray<DriverRow>>,
): ReadonlyArray<DriverRow> => {
	const last = results[results.length - 1];
	if (last === undefined) {
		throw new Error(
			"neon http batch returned zero results. Next: this is an internal invariant failure, not a user-reachable path -- file an issue.",
		);
	}
	return last;
};

/**
 * Sends `compiled` as the last member of a batch that pins both session
 * settings first (task 2.1) -- `sql.transaction([...])` is Neon's own
 * non-interactive batch form, confirmed as one HTTP request regardless of
 * member count (measured, `design.md`). Reads the **last** result entry
 * only: the pins' own (empty) result sets are never mistaken for the
 * caller's rows (task 2.2). A failed member's error is not caught here,
 * so it surfaces unchanged (task 2.5) -- including the documented
 * boundary that it carries no member index.
 */
const runBatch = async (
	sql: HttpQueryable,
	compiled: CompileResult,
): Promise<ReadonlyArray<DriverRow>> => {
	const pins = PIN_STATEMENTS.map((pinSql) => sql.query(pinSql, []));
	const statement = sql.query(compiled.sql, [...compiled.params], {
		types: intervalPassthroughTypes,
	});
	const results = await sql.transaction([...pins, statement]);
	return lastResultOf(results as ReadonlyArray<ReadonlyArray<DriverRow>>);
};

/**
 * Builds the HTTP one-shot `Driver` -- `neonDriver`'s (task 3.1) target
 * when handed a `neon()` query function. Every execution carries its own
 * pins (task 2.1/2.2, no connection to hold them once per checkout), and
 * `transaction()` fails with the contract's own missing-capability error
 * before anything is sent (task 2.4) -- this driver supplies no
 * substitute behavior for the capability it lacks, on its own, ever.
 */
export const buildHttpDriver = (sql: HttpQueryable): Driver => ({
	capabilities: CAPABILITIES,
	execute: (compiled) => runBatch(sql, compiled),
	transaction: async () => {
		throwMissingCapability("interactive-transactions", "transaction");
	},
	setupSession: async () => {
		// No connection to pin: the HTTP path has none. Deliberate no-op --
		// the two session pins ride with every execution instead
		// (runBatch above), never once per connection.
	},
});
