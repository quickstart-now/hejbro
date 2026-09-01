import type { DeclaredTable } from "@hejbro/core";
import { roleName } from "@hejbro/core";
import type { ChainApi } from "../db/chain";
import type { DbContext } from "../db/context";
import { db } from "../db/db";
import type { Driver } from "../driver/contract";
import type { ContractMetadata, ContractTableMeta } from "./contract-types";
import { synthesizeTable } from "./synthesize";

/** The shape a vendored `Database` interface always has — just enough to key {@link NameKeyedDb} off it, never imported from `hejbro`/`@hejbro/cli` (this package has no dependency on either, `AGENTS.md`'s own repo map). */
export type DatabaseShape = {
	readonly Tables: Record<
		string,
		{
			readonly Row: unknown;
			readonly Insert: unknown;
			readonly Update: unknown;
		}
	>;
};

/**
 * One table's public surface — every member resolves to a plain row
 * array, never the `Table` value this package builds internally
 * (planner condition ①: "no `Table` in the client's public types" is
 * enforced by construction here, not by convention — nothing below ever
 * names {@link DeclaredTable} or imports `tableMeta`). No `.where()`/
 * predicate parameter yet: the filter surface is an owner-gated decision
 * still pending (R2-G6 6.2's own open question) — `select`/`insert`/
 * `update`/`delete` cover the whole table until it lands, the same way
 * `@hejbro/query`'s own `deleteFrom(target)` covers the whole table
 * until `.where()` is chained.
 */
export type NameKeyedTableClient<
	TTable extends {
		readonly Row: unknown;
		readonly Insert: unknown;
		readonly Update: unknown;
	},
> = {
	select(): Promise<ReadonlyArray<TTable["Row"]>>;
	insert(
		rows: TTable["Insert"] | ReadonlyArray<TTable["Insert"]>,
	): Promise<ReadonlyArray<TTable["Row"]>>;
	update(values: TTable["Update"]): Promise<ReadonlyArray<TTable["Row"]>>;
	delete(): Promise<ReadonlyArray<TTable["Row"]>>;
};

/** Every table client, keyed exactly as `Database["Tables"]` is — the shape both the unscoped and `.as(context)`-scoped surfaces share (mirrors `@hejbro/query`'s own unscoped `db()` vs `db.as(context)` pair: a scoped handle never re-nests its own `.as`, task 4.6's "no nesting" rule). */
export type NameKeyedTables<TDatabase extends DatabaseShape> = {
	readonly [K in keyof TDatabase["Tables"] & string]: NameKeyedTableClient<
		TDatabase["Tables"][K]
	>;
};

/**
 * `createNameKeyedDb`'s own return type: every table client, plus
 * `.as(context)` (Requirement: "Role names travel with the contract and
 * the consumer opts in" — R2-G5 5.8's own metadata-only half is closed
 * here, the runtime accept/reject half). `.as` never needs a `Table`/
 * column-ref parameter (`DbContext` is a plain `{role, settings?}`
 * value), so it is in scope now even though the filter surface (`.where`)
 * is not.
 */
export type NameKeyedDb<TDatabase extends DatabaseShape> =
	NameKeyedTables<TDatabase> & {
		as(context: DbContext): NameKeyedTables<TDatabase>;
	};

/**
 * Builds one table's client over any `select`/`insert`/`update`/
 * `deleteFrom` source — `db()`'s own unscoped handle or its
 * `.as(context)`-scoped one, which share this same shape
 * (`ChainApi<TSchema>`) — using the internally-held synthesized `table`
 * (never returned, never assigned to an enumerable property of the
 * client object this function returns — the structural half of planner
 * condition ①). Casts at this one boundary, not scattered: the chain
 * source's own generic inference over a loosely-typed synthesized table
 * can never equal the contract's own precise `Row`/`Insert`/`Update`
 * types (they are two different sources of the same fact by design,
 * R2-G5's own type synthesis versus this reconstruction) — the cast is
 * the seam where the contract's static claim takes over, exactly like
 * `db.ts`'s own `execute`'s cast comment: the runtime value is correct
 * because both sides are built from the same vendored metadata, not
 * because the two inferred types happen to match structurally.
 */
const buildTableClient = <
	TTable extends {
		readonly Row: unknown;
		readonly Insert: unknown;
		readonly Update: unknown;
	},
>(
	chainSource: Pick<ChainApi, "select" | "insert" | "update" | "deleteFrom">,
	table: DeclaredTable,
): NameKeyedTableClient<TTable> => ({
	select: async () =>
		(await chainSource.select(table)) as unknown as ReadonlyArray<
			TTable["Row"]
		>,
	insert: async (rows) =>
		(await chainSource
			.insert(table)
			.values(rows as never)) as unknown as ReadonlyArray<TTable["Row"]>,
	update: async (values) =>
		(await chainSource
			.update(table)
			.set(values as never)) as unknown as ReadonlyArray<TTable["Row"]>,
	delete: async () =>
		(await chainSource.deleteFrom(table)) as unknown as ReadonlyArray<
			TTable["Row"]
		>,
});

/**
 * Refuses an unknown table by name, naming the contract's own vendored
 * list — never a raw "Cannot read properties of undefined" crash (R2-G6
 * 6.8, "errors name the contract, not internals"). Reachable when a
 * caller's own `TDatabase` type disagrees with `contractMetadata` at
 * runtime (a hand-edited type, or a type generated against a different
 * commit than the metadata it's paired with) — the type system cannot
 * catch that drift on its own, since `TDatabase` is a static claim this
 * function trusts at compile time only. Derives the known-table list
 * from `target`'s own keys (never a separately threaded list, so it can
 * never disagree with what's actually reachable) and excludes `as`,
 * which is a real member, not a table.
 */
const wrapWithTableGuard = <T extends object>(target: T): T =>
	new Proxy(target, {
		get(obj, prop, receiver) {
			if (typeof prop === "string" && !(prop in obj)) {
				const known = Object.keys(obj)
					.filter((key) => key !== "as")
					.sort();
				const buildList = (): string => {
					if (known.length === 0) {
						return "(none vendored)";
					}
					return known.join(", ");
				};
				const list = buildList();
				throw Object.assign(
					new Error(
						`"${prop}" is not a table this contract vendors. Vendored tables: ${list}. Next: check the table name for a typo, or re-run \`hejbro vendor\` if the schema recently changed.`,
					),
					{ code: "unknown-contract-table" },
				);
			}
			return Reflect.get(obj, prop, receiver);
		},
	});

const buildTables = <TDatabase extends DatabaseShape>(
	chainSource: Pick<ChainApi, "select" | "insert" | "update" | "deleteFrom">,
	tables: Readonly<Record<string, DeclaredTable>>,
): NameKeyedTables<TDatabase> => {
	const plain = Object.fromEntries(
		Object.entries(tables).map(([name, table]) => [
			name,
			buildTableClient(chainSource, table),
		]),
	);
	return wrapWithTableGuard(plain) as unknown as NameKeyedTables<TDatabase>;
};

/**
 * The name-keyed client (R2-G6): `createDb`'s own real body, once R2-G5's
 * 6.12 replaces its placeholder. Reconstructs a real `Table` per
 * vendored table (`synthesizeTable`), feeds them all into one `db()`
 * handle so relation-following (`db/related.ts`) sees every table at
 * once, and wraps each table in a thin, name-keyed façade — no `Table`
 * value ever reaches this function's own return value (planner condition
 * ①). `TDatabase` is the one type parameter this whole package needs;
 * the generated contract itself supplies it at the one call site that
 * matters (`createDb(conn) => createNameKeyedDb<Database>(conn,
 * contractMetadata)`), so no caller of the *generated* factory ever
 * writes it out (proposal.md, "no type parameter reaches the user").
 */
export const createNameKeyedDb = <TDatabase extends DatabaseShape>(
	conn: Driver,
	metadata: ContractMetadata,
): NameKeyedDb<TDatabase> => {
	const tables: Readonly<Record<string, DeclaredTable>> = Object.fromEntries(
		Object.entries(metadata.tables).map(
			([name, tableMeta]: [string, ContractTableMeta]) => [
				name,
				synthesizeTable(tableMeta),
			],
		),
	);
	const internalDb = db(tables, conn, {
		roles: metadata.roles.map(roleName),
	});
	const plain = {
		...buildTables<TDatabase>(internalDb, tables),
		as: (context: DbContext) =>
			buildTables<TDatabase>(internalDb.as(context), tables),
	};
	return wrapWithTableGuard(plain);
};
