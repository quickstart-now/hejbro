import type {
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverRow,
} from "@hejbro/query";
import { throwMissingCapability } from "@hejbro/query";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { intervalPassthroughTypes } from "./type-overrides";

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
const CAPABILITIES: DriverCapabilities = Object.freeze({
	"interactive-transactions": false,
	"session-state": false,
	"prepared-statements": false,
});

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
export const buildHttpDriver = (
	sql: HttpQueryable,
): Driver & { readonly client: { end(): Promise<void> } } => ({
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
	// #458 review round 1, task 1.11, lead ruling 458/R4: this path opens
	// nothing, so there is nothing to close -- `end` is a no-op the CLI's
	// own close path can still call, never a stand-in for `sql` itself.
	client: { end: async () => {} },
});
