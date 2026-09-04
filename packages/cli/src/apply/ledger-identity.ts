import { throwHejbroError } from "@hejbro/core";
import type { CompileResult, Driver, DriverRow } from "@hejbro/query";
import { LEDGER_SCHEMA, LEDGER_TABLE } from "./ledger";

/**
 * [design.md, 783/R2] What sits at hejbro's own ledger name -- read once,
 * by identity, never by existence alone. `absent`: no relation. `ledger`:
 * hejbro's own bootstrapped table. `occupied`: a relation is there but it
 * is not the ledger -- `relation` is the kind word a caller's diagnostic
 * names, `columns` the attribute names the catalog read found (empty for
 * a zero-column table).
 */
export type LedgerIdentity =
	| { readonly kind: "absent" }
	| { readonly kind: "ledger" }
	| {
			readonly kind: "occupied";
			readonly relation: string;
			readonly columns: ReadonlyArray<string>;
	  };

/**
 * The four columns `ledger.ts`'s `bootstrapLedger` creates, each under the
 * `format_type` spelling Postgres itself reports back (measured on
 * `postgres:17-alpine`) -- the identity `probeLedgerIdentity` checks a
 * candidate table against, never a second, hand-derived list.
 */
const BOOTSTRAP_COLUMNS: Readonly<Record<string, string>> = {
	id: "bigint",
	filename: "text",
	origin: "text",
	// biome-ignore lint/style/useNamingConvention: Postgres's own bootstrapped column name
	applied_at: "timestamp with time zone",
};

/** [design.md, 783/R2; 2.1, review repair of 51c0d7d5] `relkind` letter to the word a diagnostic names -- every relation kind PostgreSQL 17 has, so the fallback below is reached only by a letter a later Postgres version adds. */
const RELATION_WORDS: Readonly<Record<string, string>> = {
	r: "table",
	p: "partitioned table",
	v: "view",
	m: "materialized view",
	f: "foreign table",
	c: "composite type",
	i: "index",
	// biome-ignore lint/style/useNamingConvention: Postgres's own relkind letter
	I: "partitioned index",
	t: "TOAST table",
	// biome-ignore lint/style/useNamingConvention: Postgres's own relkind letter
	S: "sequence",
};

/** [2.1, 783/R5] Relation kinds whose `(columns: …)` clause says something a user can act on -- a sequence's or an index's own catalog columns are internal machinery, not a schema. Matched against {@link relationWord}'s output after stripping any `"unlogged "` prefix (783/R5 2.2) -- an unlogged table is still a table for this purpose. */
const COLUMN_BEARING_WORDS = new Set([
	"table",
	"partitioned table",
	"view",
	"materialized view",
	"foreign table",
	"composite type",
]);

/** [783/R5, 2.2] `"unlogged "` when `relpersistence = 'u'`, `""` otherwise -- prefixed onto whatever the relkind's own word is, never special-cased to `relkind = 'r'` alone: a partitioned table, a sequence (PG15+) and an index (inheriting its table's persistence) can all be unlogged too. */
const persistencePrefix = (persistence: string): string => {
	if (persistence === "u") {
		return "unlogged ";
	}
	return "";
};

const relationWord = (relkind: string, persistence: string): string =>
	`${persistencePrefix(persistence)}${RELATION_WORDS[relkind] ?? `relation (${relkind})`}`;

const UNLOGGED_PREFIX = "unlogged ";

/** Strips {@link UNLOGGED_PREFIX} before a {@link COLUMN_BEARING_WORDS} lookup -- "unlogged table" carries columns exactly as "table" does; the prefix names persistence, never a different kind. */
const withoutPersistencePrefix = (relation: string): string => {
	if (relation.startsWith(UNLOGGED_PREFIX)) {
		return relation.slice(UNLOGGED_PREFIX.length);
	}
	return relation;
};

/**
 * [design.md, 783/R2] Never `information_schema` (role-dependent) and
 * never `to_regclass` (answers non-null for every relation kind,
 * measured) -- one statement over the catalog itself, no transaction,
 * schema/table spelled once through `ledger.ts`'s own exported constants.
 * `relpersistence` (783/R5) travels beside `relkind` -- both are
 * properties of the relation itself, so every attribute row carries the
 * identical pair.
 */
const PROBE_SQL = `select c.relkind as "relkind", c.relpersistence as "persistence", a.attname as "name", format_type(a.atttypid, a.atttypmod) as "type" from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped where n.nspname = '${LEDGER_SCHEMA}' and c.relname = '${LEDGER_TABLE}' order by a.attnum`;

/** A relation with zero columns still comes back as one `pg_class` row, its attribute columns null from the left join -- filtered out here rather than counted as a found column. */
const isColumnRow = (
	row: DriverRow,
): row is DriverRow & { readonly name: string; readonly type: string } =>
	row.name !== null && row.name !== undefined;

/** [783/R5] `ledger` requires `relkind = 'r'` **and** `relpersistence = 'p'` (logged) -- an unlogged table's rows vanish on a crash, so it can never hold the record of what was applied. */
const isLedgerShape = (
	relkind: string,
	persistence: string,
	columnTypes: ReadonlyMap<string, string>,
): boolean =>
	relkind === "r" &&
	persistence === "p" &&
	Object.entries(BOOTSTRAP_COLUMNS).every(
		([name, type]) => columnTypes.get(name) === type,
	);

/**
 * [design.md, 783/R2] `migrate`, `status`, `reset` and `raise` each call
 * this once, before any other read or write of the ledger -- the one
 * judgement they share, so the same relation is never called the ledger
 * by one command and something else by another.
 */
export const probeLedgerIdentity = async (
	driver: Driver,
): Promise<LedgerIdentity> => {
	const rows = await driver.execute({
		sql: PROBE_SQL,
		params: [],
		kind: "sql",
	} satisfies CompileResult);
	if (rows.length === 0) {
		return { kind: "absent" };
	}
	const relkind = String(rows[0]?.relkind);
	const persistence = String(rows[0]?.persistence);
	const columnRows = rows.filter(isColumnRow);
	const columns = columnRows.map((row) => String(row.name));
	const columnTypes = new Map(
		columnRows.map((row) => [String(row.name), String(row.type)]),
	);
	if (isLedgerShape(relkind, persistence, columnTypes)) {
		return { kind: "ledger" };
	}
	return {
		kind: "occupied",
		relation: relationWord(relkind, persistence),
		columns,
	};
};

/** [2.1, 783/R5] `null` when `relation`'s kind carries no columns worth naming (a sequence, an index, a partitioned index, a TOAST table) -- the clause is omitted entirely, never rendered empty. `"no columns"` is reserved for a column-bearing kind that happens to have none (a zero-column table). */
const columnsClause = (
	relation: string,
	columns: ReadonlyArray<string>,
): string | null => {
	if (!COLUMN_BEARING_WORDS.has(withoutPersistencePrefix(relation))) {
		return null;
	}
	if (columns.length === 0) {
		return "no columns";
	}
	return `columns: ${columns.join(", ")}`;
};

/** `" (columns: …)"`/`" (no columns)"`, or `""` when {@link columnsClause} omits the clause -- the leading space and parentheses live here, not at each call site. */
const columnsSuffix = (
	relation: string,
	columns: ReadonlyArray<string>,
): string => {
	const clause = columnsClause(relation, columns);
	if (clause === null) {
		return "";
	}
	return ` (${clause})`;
};

/**
 * [design.md, 783/R3] Refuses with `apply-ledger-occupied` when `identity`
 * is `occupied`; a no-op for `absent`/`ledger` -- every one of the four
 * ledger-touching commands calls this right after {@link probeLedgerIdentity},
 * before any other read or write of the ledger, so an occupied name is
 * refused the same way regardless of which command found it.
 */
export const assertLedgerNotOccupied = (
	identity: LedgerIdentity,
	commandName: string,
): void => {
	if (identity.kind !== "occupied") {
		return;
	}
	throwHejbroError(
		"apply-ledger-occupied",
		`"${LEDGER_SCHEMA}"."${LEDGER_TABLE}" is held by a ${identity.relation} that is not hejbro's ledger${columnsSuffix(identity.relation, identity.columns)}. hejbro reads, writes and clears only the ledger it created, so this database is not one hejbro has applied to. Next: move or drop that ${identity.relation} yourself (hejbro will not touch it), or point --url at the database hejbro manages, then rerun \`${commandName}\`.`,
	);
};
