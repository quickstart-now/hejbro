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
 * Neither `interactive-transactions` nor `session-state` nor
 * `prepared-statements` can the HTTP path offer (task 2.3, D95/D96): a
 * one-shot HTTP request has no connection to hold a transaction open
 * across round trips, and no session to preserve state across separate
 * requests -- see task 2.3's own note on why "the pins hold within one
 * batch" does not make `session-state` true. `batched-transactions` is
 * `true` (task 1.2b, #486/R5): `sql.transaction([...])` runs a
 * pre-assembled statement list as one atomic HTTP request, exactly the
 * shape the capability names.
 */
const CAPABILITIES: DriverCapabilities = Object.freeze({
	"interactive-transactions": false,
	"session-state": false,
	"prepared-statements": false,
	"batched-transactions": true,
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
 * The last entry of a batch result (task 2.2) -- `execute` is `batch` of
 * exactly one (task 1.2b, #486), so `results` always holds one entry;
 * a missing one is an internal-invariant failure, not a user-reachable
 * path.
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
 * Runs `statements` as one batch, the driver's own pins first (task
 * 1.2b, #486): `sql.transaction([...])` is Neon's own non-interactive
 * batch form, confirmed as one HTTP request regardless of member count
 * (measured, `design.md`) -- `execute` and `Driver.batch` both go
 * through this one function, never two separate pin-assembly/slicing
 * implementations. Returns one row list per member of `statements`, in
 * order: the pins' own (empty) result sets are sliced off the front,
 * never mistaken for a member's own (task 2.2). A failed member's error
 * is not caught here, so it surfaces unchanged (task 2.5) -- including
 * the documented boundary that it carries no member index. `statements`
 * empty sends nothing at all: a round trip for the pins alone would be
 * a side effect the caller never asked for, so this returns `[]`
 * without ever calling `sql`.
 */
const runBatch = async (
	sql: HttpQueryable,
	statements: ReadonlyArray<CompileResult>,
): Promise<ReadonlyArray<ReadonlyArray<DriverRow>>> => {
	if (statements.length === 0) {
		return [];
	}
	const pins = PIN_STATEMENTS.map((pinSql) => sql.query(pinSql, []));
	const members = statements.map((statement) =>
		sql.query(statement.sql, [...statement.params], {
			types: intervalPassthroughTypes,
		}),
	);
	const results = (await sql.transaction([
		...pins,
		...members,
	])) as ReadonlyArray<ReadonlyArray<DriverRow>>;
	return results.slice(pins.length);
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
	execute: async (compiled) => lastResultOf(await runBatch(sql, [compiled])),
	batch: (statements) => runBatch(sql, statements),
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
