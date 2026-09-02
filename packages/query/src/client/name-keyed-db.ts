import type {
	ColumnBuilder,
	Condition,
	Expr,
	FunctionDeclaration,
	OrderTermInput,
	Table,
} from "@hejbro/core";
import { roleName } from "@hejbro/core";
import type { CompileResult } from "../compile/compile";
import type { ChainApi } from "../db/chain";
import type { DbContext } from "../db/context";
import { db } from "../db/db";
import type { FnApi } from "../db/fn";
import type { Driver } from "../driver/contract";
import type { ContractMetadata, ContractTableMeta } from "./contract-types";
import { synthesizeTable } from "./synthesize";
import { synthesizeFunction } from "./synthesize-function";

/** {@link synthesizeTable}'s own return type (add-unmanaged-objects, J3): `authority: "usage"`, never migration authority — see that function's doc comment. */
type SynthesizedTable = Table<Record<string, ColumnBuilder>, "usage">;

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
	readonly Functions: Record<
		string,
		{
			readonly Args: unknown;
			readonly Returns: unknown;
		}
	>;
};

/**
 * A thenable select chain over a name-keyed table's own row type (owner
 * seal (가), R2-G6 6.2): `.where()`/`.orderBy()`/`.limit()`/`.offset()`
 * inherit `@hejbro/query`'s existing chain and compiler unchanged — the
 * same reasoning that rejected a second table-value expression (planner
 * condition B's own rationale) applies to a second query dialect: one
 * production and consumption repository speak the same query language,
 * or the difference is a permanent tax. Narrower than `db()`'s own
 * `SelectChainDistinctable` (no `.distinct()`/joins/`.groupBy()` yet,
 * and no `.related()` — those await the same design attention this
 * surface itself just received); `.where()`/`.orderBy()`/`.limit()`/
 * `.offset()` cover the scenario this seal was made for.
 */
export type NameKeyedSelectChain<TRow> = PromiseLike<ReadonlyArray<TRow>> & {
	compile(): CompileResult;
	where(condition: Condition): NameKeyedSelectChain<TRow>;
	orderBy(...terms: ReadonlyArray<OrderTermInput>): NameKeyedSelectChain<TRow>;
	limit(count: number): NameKeyedSelectChain<TRow>;
	offset(count: number): NameKeyedSelectChain<TRow>;
};

/** An `update`/`delete` chain's own filterable terminal — `.where()` narrows which rows are touched, mirroring `@hejbro/query`'s own `UpdateChainReturnable`/`DeleteChainReturnable` shape without `.returning()` (not yet exposed on this surface). */
export type NameKeyedMutationChain<TRow> = PromiseLike<ReadonlyArray<TRow>> & {
	compile(): CompileResult;
	where(condition: Condition): PromiseLike<ReadonlyArray<TRow>> & {
		compile(): CompileResult;
	};
};

/**
 * One table's public surface: `select`/`insert`/`update`/`delete`, plus
 * `columns` — a plain-`Expr` bag (owner seal (가)) a caller combines with
 * `eq`/`and`/`or` (already-public `@hejbro/query` exports) to build a
 * `.where()` predicate, e.g. `client.posts.select().where(eq(client.
 * posts.columns.id, value))`. `columns` carries no declaration
 * authority — no `.notNull()`/`.primaryKey()`/any other declaration-time
 * builder method, and no hidden `[tableMeta]` symbol (planner condition
 * ①, "no `Table` in the client's public types" — proven in
 * `no-table-leak.test.ts`, both the type-level exact-key check and a
 * runtime own-symbol-properties probe). Owner's own accessor name from
 * the sealed example (`db.post.columns.status`).
 */
export type NameKeyedTableClient<
	TTable extends {
		readonly Row: unknown;
		readonly Insert: unknown;
		readonly Update: unknown;
	},
> = {
	readonly columns: { readonly [K in keyof TTable["Row"]]: Expr };
	select(): NameKeyedSelectChain<TTable["Row"]>;
	insert(
		rows: TTable["Insert"] | ReadonlyArray<TTable["Insert"]>,
	): Promise<ReadonlyArray<TTable["Row"]>>;
	update(values: TTable["Update"]): NameKeyedMutationChain<TTable["Row"]>;
	delete(): NameKeyedMutationChain<TTable["Row"]>;
};

/** Every table client, keyed exactly as `Database["Tables"]` is — the shape both the unscoped and `.as(context)`-scoped surfaces share (mirrors `@hejbro/query`'s own unscoped `db()` vs `db.as(context)` pair: a scoped handle never re-nests its own `.as`, task 4.6's "no nesting" rule). */
export type NameKeyedTables<TDatabase extends DatabaseShape> = {
	readonly [K in keyof TDatabase["Tables"] & string]: NameKeyedTableClient<
		TDatabase["Tables"][K]
	>;
};

/** One vendored function's public surface (#587/G3): a single callable, keyed by its export name — never the declaration shape `synthesizeFunction` builds internally (`no-fn-leak.test.ts`'s own probe). */
export type NameKeyedFnCaller<
	TFn extends {
		readonly Args: unknown;
		readonly Returns: unknown;
	},
> = (args: TFn["Args"]) => Promise<TFn["Returns"]>;

/** Every function client, keyed exactly as `Database["Functions"]` is — the contract's own export-name keying (schema-vendoring spec: `Functions` is keyed by export name, unlike `Tables`' SQL-name keying), never the internal collision-avoiding key `buildFunctionKeyMap` may have assigned it. */
export type NameKeyedFn<TDatabase extends DatabaseShape> = {
	readonly [K in keyof TDatabase["Functions"] & string]: NameKeyedFnCaller<
		TDatabase["Functions"][K]
	>;
};

/**
 * `createNameKeyedDb`'s own return type: every table client, plus
 * `.as(context)` (Requirement: "Role names travel with the contract and
 * the consumer opts in" — R2-G5 5.8's own metadata-only half is closed
 * here, the runtime accept/reject half). `.as` never needs a `Table`/
 * column-ref parameter (`DbContext` is a plain `{role, settings?}`
 * value), so it was in scope from 6.2's own first draft.
 */
export type NameKeyedDb<TDatabase extends DatabaseShape> =
	NameKeyedTables<TDatabase> & {
		readonly fn: NameKeyedFn<TDatabase>;
		as(
			context: DbContext,
		): NameKeyedTables<TDatabase> & { readonly fn: NameKeyedFn<TDatabase> };
	};

/**
 * `table`'s own enumerable column-ref properties, copied without its
 * hidden `[tableMeta]` symbol (`Object.entries` never sees a symbol key)
 * — the runtime half of planner condition ①: even though this function
 * reads the same object `getTableMeta`/`isTable` recognize, the value it
 * returns carries none of that recognition.
 */
const buildColumnsBag = (table: SynthesizedTable): Record<string, unknown> =>
	Object.fromEntries(Object.entries(table));

/**
 * Builds one table's client over any `select`/`insert`/`update`/
 * `deleteFrom` source — `db()`'s own unscoped handle or its
 * `.as(context)`-scoped one, which share this same shape
 * (`ChainApi<TSchema>`) — using the internally-held synthesized `table`
 * (never returned as itself, only as its column-ref bag with the
 * `[tableMeta]` symbol stripped — the structural half of planner
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
	table: SynthesizedTable,
): NameKeyedTableClient<TTable> => ({
	columns: buildColumnsBag(
		table,
	) as unknown as NameKeyedTableClient<TTable>["columns"],
	select: () =>
		chainSource.select(table) as unknown as NameKeyedSelectChain<TTable["Row"]>,
	insert: async (rows) =>
		(await chainSource
			.insert(table)
			.values(rows as never)) as unknown as ReadonlyArray<TTable["Row"]>,
	update: (values) =>
		chainSource
			.update(table)
			.set(values as never) as unknown as NameKeyedMutationChain<TTable["Row"]>,
	delete: () =>
		chainSource.deleteFrom(table) as unknown as NameKeyedMutationChain<
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
 * never disagree with what's actually reachable) and excludes `as`/`fn`,
 * which are real members, not tables.
 */
const wrapWithTableGuard = <T extends object>(target: T): T =>
	new Proxy(target, {
		get(obj, prop, receiver) {
			if (typeof prop === "string" && !(prop in obj)) {
				const known = Object.keys(obj)
					.filter((key) => key !== "as" && key !== "fn")
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
	tables: Readonly<Record<string, SynthesizedTable>>,
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
 * Refuses an unknown function by name, the `fn` sibling of
 * {@link wrapWithTableGuard} (#587/G3, R2-G6 6.8's own "errors name the
 * contract, not internals" applied to the second name-keyed surface).
 * `target`'s own keys are always export names (the façade's public key
 * space, built by {@link buildFn}) — never the internal, collision-
 * avoiding key `buildFunctionKeyMap` may have assigned, so the vendored
 * list this names is exactly what a caller of `fn` sees, not an
 * implementation detail.
 */
const wrapWithFunctionGuard = <T extends object>(target: T): T =>
	new Proxy(target, {
		get(obj, prop, receiver) {
			if (typeof prop === "string" && !(prop in obj)) {
				const known = Object.keys(obj).sort();
				const buildList = (): string => {
					if (known.length === 0) {
						return "(none vendored)";
					}
					return known.join(", ");
				};
				const list = buildList();
				throw Object.assign(
					new Error(
						`"${prop}" is not a function this contract vendors. Vendored functions: ${list}. Next: check the function name for a typo, or re-run \`hejbro vendor\` if the schema recently changed.`,
					),
					{ code: "unknown-contract-function" },
				);
			}
			return Reflect.get(obj, prop, receiver);
		},
	});

/**
 * The first candidate `db()`'s own merged schema record doesn't already
 * hold, for `exportName` — deterministic (the same `exportName`/`occupied`
 * pair always yields the same key) and guaranteed to terminate: `occupied`
 * is finite (the vendored table names plus whatever this function has
 * already assigned), while the candidate space (`exportName`, then
 * `exportName#1`, `exportName#2`, …) is infinite, so some attempt is
 * always free. Recursive, not iterative (`check:bans` forbids `for`/
 * `while`/`let` in this repo's own source) — each call either returns a
 * free key or tries the next candidate.
 */
const candidateInternalKey = (exportName: string, attempt: number): string => {
	if (attempt === 0) {
		return exportName;
	}
	return `${exportName}#${attempt}`;
};

const freeInternalKey = (
	occupied: ReadonlySet<string>,
	exportName: string,
	attempt: number,
): string => {
	const candidate = candidateInternalKey(exportName, attempt);
	if (!occupied.has(candidate)) {
		return candidate;
	}
	return freeInternalKey(occupied, exportName, attempt + 1);
};

/**
 * Assigns every vendored function an internal key `db()`'s own merged
 * schema record can carry alongside the vendored tables, without ever
 * silently losing an entry to a name collision (#587/G3) — a function's
 * export name and a table's SQL name are two independently-sourced
 * namespaces (`Database["Functions"]` is export-name-keyed,
 * `Database["Tables"]` is SQL-name-keyed, schema-vendoring spec), forced
 * into one merged record only so `db()`'s own classification can wire
 * `fn` through the exact call plan `db.fn` already uses, with no second
 * renderer. `tableKeys` is checked first (tables never move), and each
 * assigned function key is added to what the *next* function must also
 * avoid, so two functions can never collide with each other either (their
 * export names are already unique — `metadata.functions`'s own keys — but
 * this keeps the invariant true even if two internal keys otherwise would
 * have coincided). The returned map is export name → internal key; `fn`'s
 * own public surface is built from it, so the internal key is never the
 * one a caller ever sees.
 */
const buildFunctionKeyMap = (
	tableKeys: ReadonlySet<string>,
	functionExportNames: ReadonlyArray<string>,
): ReadonlyMap<string, string> =>
	functionExportNames.reduce((assigned, exportName) => {
		const occupied = new Set([...tableKeys, ...assigned.values()]);
		const internalKey = freeInternalKey(occupied, exportName, 0);
		assigned.set(exportName, internalKey);
		return assigned;
	}, new Map<string, string>());

/**
 * Builds the merged record `db()` classifies (#587/G3): tables first
 * (their keys are the SQL names {@link buildFunctionKeyMap} avoided),
 * then functions under their own collision-avoiding internal key —
 * `db()`'s own `functionsOf` reads this record's keys directly, so this
 * is the one place that determines what `internalDb.fn` is keyed by
 * (never what the public `fn` façade is keyed by; {@link buildFn} handles
 * that translation).
 *
 * Tables are spread first so a colliding function key never evicts a
 * table — never reverse this order.
 */
const buildInternalSchema = (
	tables: Readonly<Record<string, DeclaredTable>>,
	functions: Readonly<Record<string, FunctionDeclaration>>,
	keyMap: ReadonlyMap<string, string>,
): Readonly<Record<string, unknown>> => ({
	...tables,
	...Object.fromEntries(
		Object.entries(functions).map(([exportName, declaration]) => [
			keyMap.get(exportName) ?? exportName,
			declaration,
		]),
	),
});

/**
 * Builds the public `fn` façade: every entry keyed by its export name
 * (never the internal key {@link buildFunctionKeyMap} assigned it),
 * reading the underlying callable off `internalFn` (`db()`'s own `fn`,
 * `FnApi`'s loose runtime shape) through that same map — the one seam
 * where the internal-key world and the export-name world meet.
 */
const buildFn = <TDatabase extends DatabaseShape>(
	internalFn: FnApi,
	keyMap: ReadonlyMap<string, string>,
): NameKeyedFn<TDatabase> => {
	const plain = Object.fromEntries(
		[...keyMap.entries()].map(([exportName, internalKey]) => [
			exportName,
			internalFn[internalKey],
		]),
	);
	return wrapWithFunctionGuard(plain) as unknown as NameKeyedFn<TDatabase>;
};

/**
 * The name-keyed client (R2-G6): `createDb`'s own real body (R2-G5
 * 6.12). Reconstructs a real `Table` per vendored table
 * (`synthesizeTable`), feeds them all into one `db()` handle so
 * relation-following (`db/related.ts`) sees every table at once, and
 * wraps each table in a thin, name-keyed façade — the `Table` value
 * itself never reaches this function's own return value, only its
 * column-ref bag with the declaration-authority symbol stripped
 * (planner condition ①). `TDatabase` is the one type parameter this
 * whole package needs; the generated contract itself supplies it at the
 * one call site that matters (`createDb(conn) => createNameKeyedDb
 * <Database>(conn, contractMetadata)`), so no caller of the *generated*
 * factory ever writes it out (proposal.md, "no type parameter reaches
 * the user").
 */
export const createNameKeyedDb = <TDatabase extends DatabaseShape>(
	conn: Driver,
	metadata: ContractMetadata,
): NameKeyedDb<TDatabase> => {
	const tables: Readonly<Record<string, SynthesizedTable>> = Object.fromEntries(
		Object.entries(metadata.tables).map(
			([name, tableMeta]: [string, ContractTableMeta]) => [
				name,
				synthesizeTable(tableMeta),
			],
		),
	);
	const functions: Readonly<Record<string, FunctionDeclaration>> =
		Object.fromEntries(
			Object.entries(metadata.functions).map(([name, fnMeta]) => [
				name,
				synthesizeFunction(fnMeta),
			]),
		);
	const keyMap = buildFunctionKeyMap(
		new Set(Object.keys(tables)),
		Object.keys(functions),
	);
	const internalSchema = buildInternalSchema(tables, functions, keyMap);
	const internalDb = db(internalSchema, conn, {
		roles: metadata.roles.map(roleName),
	});
	const internalFn = internalDb.fn as unknown as FnApi;
	const plain = {
		...buildTables<TDatabase>(internalDb, tables),
		fn: buildFn<TDatabase>(internalFn, keyMap),
		as: (context: DbContext) => {
			const scoped = internalDb.as(context);
			return {
				...buildTables<TDatabase>(scoped, tables),
				fn: buildFn<TDatabase>(scoped.fn as unknown as FnApi, keyMap),
			};
		},
	};
	return wrapWithTableGuard(plain);
};
